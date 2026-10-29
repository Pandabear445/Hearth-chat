// Hybrid post-quantum encryption (public/js/e2ee.js, ML-KEM-768 + P-256), with the app's real code in Node. Proves
// the vendored ML-KEM is the published one, that every hybrid form round-trips and needs BOTH halves (the ML-KEM secret
// and the P-256 one), that tampering and moving things between contexts fail, that the password envelope carries the
// post-quantum seed through every re-lock, and that old formats still open.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let E; let NOBLE; let VENDORED;
const store = new Map();
before(async () => {
  globalThis.window = { crypto: globalThis.crypto, hashwasm: require('hash-wasm') };
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  E = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'e2ee.js')).href);
  NOBLE = await import('@noble/post-quantum/ml-kem.js');
  VENDORED = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'vendor', 'ml-kem.js')).href);
});

// scripts/vendor-ml-kem.sh prints this when it rebuilds the file. A change to the file that wasn't made on purpose
// (by hand, or by a compromised build) fails here.
const ML_KEM_SHA256 = '1abe7fb6be4b242bc3f64651f16be5b6aab0a1add72516387e108dfb200440c6';
const VENDOR = path.join(__dirname, '..', 'public', 'vendor', 'ml-kem.js');

const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
function tamper(text, field, { tag = false } = {}) {
  const p = text.split(':');
  const bytes = unb64(p[field]);
  bytes[tag ? bytes.length - 1 : Math.floor(bytes.length / 2)] ^= 1;
  p[field] = b64(bytes);
  return p.join(':');
}
const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
async function person(name) {
  const { wrapKey } = await E.deriveKeys(name, `pw-${name}`, { kdf: 'argon2id', salt: E.newKdfSalt() });
  const id = await E.createIdentity(wrapKey);
  const s = await E.createSigningKey(id.privateKey, id.publicKey);
  return { ...id, ...s, wrapKey, id: name, pq: E.pqKeyPair(id.pqSeed) };
}
// An envelope as accounts from before post-quantum keys have it: the PKCS#8 bytes alone, AES-GCM with the password key.
async function legacyIdentity(wrapKey) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, wrapKey, pkcs8));
  return { publicKey: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), encPrivateKey: `${b64(iv)}:${b64(ct)}` };
}

test('the vendored ML-KEM is pinned, and is exactly @noble/post-quantum 0.7.1 (the same keys, ciphertexts and secrets)', async () => {
  const src = fs.readFileSync(VENDOR);
  assert.equal(crypto.createHash('sha256').update(src).digest('hex'), ML_KEM_SHA256, 'public/vendor/ml-kem.js changed: rebuild it with scripts/vendor-ml-kem.sh and update the pin');
  assert.match(src.toString('utf8', 0, 600), /@noble\/post-quantum@0\.7\.1 npm integrity: sha512-/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@noble/post-quantum/ml-kem.js')), 'package.json'), 'utf8')).version, '0.7.1');
  for (let i = 0; i < 5; i++) {
    const seed = crypto.getRandomValues(new Uint8Array(64));
    const ours = E.pqKeyPair(seed);
    const theirs = NOBLE.ml_kem768.keygen(seed);
    assert.equal(ours.publicKey, b64(theirs.publicKey));
    assert.deepEqual(Buffer.from(ours.secretKey), Buffer.from(theirs.secretKey));
    // Encapsulated by one, opened by the other, both ways.
    const one = NOBLE.ml_kem768.encapsulate(theirs.publicKey);
    assert.deepEqual(Buffer.from(VENDORED.ml_kem768.decapsulate(one.cipherText, ours.secretKey)), Buffer.from(one.sharedSecret));
    const two = VENDORED.ml_kem768.encapsulate(unb64(ours.publicKey));
    assert.equal(two.cipherText.length, 1088);
    assert.deepEqual(Buffer.from(NOBLE.ml_kem768.decapsulate(two.cipherText, theirs.secretKey)), Buffer.from(two.sharedSecret));
    // Encapsulation from a fixed message is deterministic: the very same ciphertext from both.
    const msg = crypto.getRandomValues(new Uint8Array(32));
    assert.deepEqual(Buffer.from(VENDORED.ml_kem768.encapsulate(theirs.publicKey, msg).cipherText), Buffer.from(NOBLE.ml_kem768.encapsulate(theirs.publicKey, msg).cipherText));
  }
});

test('ML-KEM-768 key checks: bad sizes and an encapsulation key that fails the FIPS 203 modulus check are refused', () => {
  const ok = E.pqKeyPair(E.newPqSeed()).publicKey;
  assert.ok(E.isPqPublicKey(ok));
  assert.equal(E.isPqPublicKey(ok.slice(0, -4)), false);
  assert.equal(E.isPqPublicKey(b64(new Uint8Array(1184).fill(0xff))), false, 'coefficients above q');
  assert.equal(E.isPqPublicKey(''), false);
  assert.equal(E.isPqPublicKey(null), false);
  assert.throws(() => E.pqKeyPair(new Uint8Array(32)));
});

test('the password envelope: new accounts carry the post-quantum seed, old envelopes still open, every re-lock keeps the seed', async () => {
  const { wrapKey } = await E.deriveKeys('env', 'pw-env', { kdf: 'argon2id', salt: E.newKdfSalt() });
  const other = (await E.deriveKeys('env', 'other-pw', { kdf: 'argon2id', salt: E.newKdfSalt() })).wrapKey;
  // New account.
  const id = await E.createIdentity(wrapKey);
  assert.equal(id.pqSeed.length, 64);
  const opened = await E.unwrapIdentity(wrapKey, id.encPrivateKey);
  assert.deepEqual(Buffer.from(opened.pqSeed), Buffer.from(id.pqSeed));
  assert.ok(await E.ownsPublicKey(opened.privateKey, id.publicKey));
  assert.ok(await E.ownsPublicKey(await E.unwrapPrivateKey(wrapKey, id.encPrivateKey), id.publicKey), 'unwrapPrivateKey reads the new form');
  // A new password or a recovery key copies the bytes as they are: the seed comes along.
  const relocked = await E.rewrapPrivateKey(wrapKey, other, id.encPrivateKey);
  assert.deepEqual(Buffer.from((await E.unwrapIdentity(other, relocked)).pqSeed), Buffer.from(id.pqSeed));
  assert.ok(await fails(() => E.unwrapIdentity(other, id.encPrivateKey)), 'wrong password');
  assert.ok(await fails(() => E.unwrapIdentity(wrapKey, tamper(id.encPrivateKey, 1))), 'tampered');
  // An account from before: no seed, and the upgrade adds one without touching the identity key.
  const old = await legacyIdentity(wrapKey);
  const o = await E.unwrapIdentity(wrapKey, old.encPrivateKey);
  assert.equal(o.pqSeed, null);
  assert.ok(await E.ownsPublicKey(o.privateKey, old.publicKey));
  const up = await E.addPqToEnvelope(wrapKey, old.encPrivateKey);
  assert.equal(up.changed, true);
  const u = await E.unwrapIdentity(wrapKey, up.encPrivateKey);
  assert.deepEqual(Buffer.from(u.pqSeed), Buffer.from(up.pqSeed));
  assert.ok(await E.ownsPublicKey(u.privateKey, old.publicKey), 'same identity key after the upgrade');
  // Already has one: left as it is, unless replaced (or given the seed to put back).
  const again = await E.addPqToEnvelope(wrapKey, up.encPrivateKey);
  assert.equal(again.changed, false);
  assert.equal(again.encPrivateKey, up.encPrivateKey);
  const repl = await E.addPqToEnvelope(wrapKey, up.encPrivateKey, { replace: true });
  assert.notDeepEqual(Buffer.from(repl.pqSeed), Buffer.from(up.pqSeed));
  const back = await E.addPqToEnvelope(wrapKey, repl.encPrivateKey, { replace: true, seed: up.pqSeed });
  assert.deepEqual(Buffer.from((await E.unwrapIdentity(wrapKey, back.encPrivateKey)).pqSeed), Buffer.from(up.pqSeed));
});

test('post-quantum public keys are signed for one account and one identity key; nothing else verifies', async () => {
  const a = await person('a'); const m = await person('mallory');
  const sig = await E.signPqKey(a.signKey, 'a', a.publicKey, a.pq.publicKey);
  assert.equal(await E.verifyPqKey(a.signPublicKey, 'a', a.publicKey, a.pq.publicKey, sig), a.signPublicKey);
  assert.equal(await E.verifyPqKey([m.signPublicKey, a.signPublicKey], 'a', a.publicKey, a.pq.publicKey, sig), a.signPublicKey, 'any of a list');
  assert.equal(await E.verifyPqKey(a.signPublicKey, 'mallory', a.publicKey, a.pq.publicKey, sig), null, 'moved to another account');
  assert.equal(await E.verifyPqKey(a.signPublicKey, 'a', m.publicKey, a.pq.publicKey, sig), null, 'next to another identity key');
  assert.equal(await E.verifyPqKey(a.signPublicKey, 'a', a.publicKey, m.pq.publicKey, sig), null, 'another post-quantum key (the server swapping it)');
  assert.equal(await E.verifyPqKey(m.signPublicKey, 'a', a.publicKey, a.pq.publicKey, sig), null, 'someone else’s signing key');
  const forged = await E.signPqKey(m.signKey, 'a', a.publicKey, m.pq.publicKey);
  assert.equal(await E.verifyPqKey(a.signPublicKey, 'a', a.publicKey, m.pq.publicKey, forged), null);
  // The fingerprint the server lists (server/index.js pqFp).
  const fp = crypto.createHash('sha256').update(Buffer.from(a.pq.publicKey, 'base64')).digest().subarray(0, 16).toString('base64');
  assert.equal(await E.pqFingerprint(a.pq.publicKey), fp);
});

test('server key handoff, hybrid (w2): round trip; tampering, other contexts and either half missing all fail', async () => {
  const a = await person('a'); const b = await person('b'); const eve = await person('eve');
  const raw = E.newGroupKey();
  const w = await E.wrapGroupKey({ raw, serverId: 's1', epoch: 3, recipientId: 'b', recipientPub: b.publicKey, recipientPq: b.pq.publicKey, wrapperId: 'a', signKey: a.signKey });
  assert.equal(E.wrapFormat(w), 'w2');
  assert.equal(w.split(':').length, 6);
  const open = (x, o = {}) => E.unwrapGroupKey({ wrapped: x, serverId: 's1', epoch: 3, myId: 'b', myPriv: b.privateKey, myPub: b.publicKey, myPq: b.pq, wrapperId: 'a', wrapperSignPub: a.signPublicKey, ...o });
  assert.deepEqual(Buffer.from(await open(w)), Buffer.from(raw));
  for (const f of [1, 2, 3, 4, 5]) assert.ok(await fails(() => open(tamper(w, f))), `field ${f}`);
  assert.ok(await fails(() => open(tamper(w, 4, { tag: true }))), 'tag');
  assert.ok(await fails(() => open(w, { epoch: 4 })), 'another epoch');
  assert.ok(await fails(() => open(w, { serverId: 's2' })), 'another server');
  assert.ok(await fails(() => open(w, { myId: 'eve' })), 'claimed for someone else');
  assert.ok(await fails(() => open(w, { wrapperId: 'eve' })), 'another sharer');
  assert.ok(await fails(() => open(w, { wrapperSignPub: eve.signPublicKey })), 'not signed by the sharer');
  // Both halves are needed: the right P-256 key with the wrong ML-KEM key, and the other way round.
  assert.ok(await fails(() => open(w, { myPq: eve.pq })), 'P-256 alone');
  assert.ok(await fails(() => open(w, { myPriv: eve.privateKey })), 'ML-KEM alone');
  assert.ok(await fails(() => open(w, { myPub: eve.publicKey })), 'transcript names another identity key');
  // This device without the seed yet: a clear "wait", not a broken key.
  await assert.rejects(() => open(w, { myPq: null }), (e) => e.code === 'no_pq');
  // Pieces from another wrap of the same key don't fit (the ML-KEM ciphertext is bound in).
  const w2 = await E.wrapGroupKey({ raw, serverId: 's1', epoch: 3, recipientId: 'b', recipientPub: b.publicKey, recipientPq: b.pq.publicKey, wrapperId: 'a', signKey: a.signKey });
  const p = w.split(':'); const q = w2.split(':');
  assert.ok(await fails(() => open([p[0], p[1], q[2], p[3], p[4], p[5]].join(':'))), 'ML-KEM ciphertext swapped in');
  // The signature of one form never verifies as the other (labels hearth-gk vs hearth-gk2).
  const w1 = await E.wrapGroupKey({ raw, serverId: 's1', epoch: 3, recipientId: 'b', recipientPub: b.publicKey, wrapperId: 'a', signKey: a.signKey });
  assert.equal(E.wrapFormat(w1), 'w1');
  assert.deepEqual(Buffer.from(await open(w1)), Buffer.from(raw), 'the P-256 form still opens');
  const [, e1, iv1, ct1, s1] = w1.split(':');
  assert.ok(await fails(() => open(`w2:${e1}:${p[2]}:${iv1}:${ct1}:${s1}`)), 'w1 signature on a w2');
  assert.ok(await fails(() => open(`w1:${p[1]}:${p[3]}:${p[4]}:${p[5]}`)), 'w2 signature on a w1');
});

test('DM epoch keys (dk1): round trip both ways; only the two of them can make one; its time and key set are authenticated', async () => {
  const a = await person('a'); const b = await person('b'); const eve = await person('eve');
  const raw = E.newDmKey();
  const keys = { a: { publicKey: a.publicKey, pq: a.pq.publicKey }, b: { publicKey: b.publicKey, pq: b.pq.publicKey } };
  const tag = await E.dmKeysTag(keys);
  const madeAt = Date.now();
  const mk = (o) => E.wrapDmKey({ raw, dmId: 'dm1', epoch: 1, madeAt, tag, recipientId: 'b', recipientPub: b.publicKey, recipientPq: b.pq.publicKey, senderId: 'a', myPriv: a.privateKey, myPub: a.publicKey, ...o });
  const w = await mk();
  const self = await mk({ recipientId: 'a', recipientPub: a.publicKey, recipientPq: a.pq.publicKey });
  const open = (x, o = {}) => E.unwrapDmKey({ wrapped: x, dmId: 'dm1', epoch: 1, myId: 'b', myPriv: b.privateKey, myPub: b.publicKey, myPq: b.pq, senderId: 'a', senderPub: a.publicKey, ...o });
  const got = await open(w);
  assert.deepEqual(Buffer.from(got.raw), Buffer.from(raw));
  assert.equal(got.madeAt, madeAt);
  assert.equal(got.tag, tag);
  assert.deepEqual(Buffer.from((await open(self, { myId: 'a', myPriv: a.privateKey, myPub: a.publicKey, myPq: a.pq })).raw), Buffer.from(raw), 'the sender’s own copy');
  for (const f of [3, 4, 5, 6]) assert.ok(await fails(() => open(tamper(w, f))), `field ${f}`);
  // The time and the key set can't be changed: they're inside the authenticated context.
  const p = w.split(':');
  assert.ok(await fails(() => open([p[0], String(madeAt + 86400000 * 30), ...p.slice(2)].join(':'))), 'made-at moved');
  const otherTag = await E.dmKeysTag({ ...keys, b: { publicKey: eve.publicKey, pq: eve.pq.publicKey } });
  assert.notEqual(otherTag, tag);
  assert.ok(await fails(() => open([p[0], p[1], otherTag, ...p.slice(3)].join(':'))), 'key set swapped');
  assert.ok(await fails(() => open(w, { dmId: 'dm2' })), 'another DM');
  assert.ok(await fails(() => open(w, { epoch: 2 })), 'another epoch');
  assert.ok(await fails(() => open(w, { senderId: 'eve' })), 'another sender named');
  assert.ok(await fails(() => open(w, { myPq: eve.pq })), 'P-256 alone');
  assert.ok(await fails(() => open(w, { myPriv: eve.privateKey })), 'ML-KEM alone');
  await assert.rejects(() => open(w, { myPq: null }), (e) => e.code === 'no_pq');
  // The server (or eve) wrapping a key "from a": it can't compute ECDH(a, b), so it doesn't open as a's.
  const forged = await mk({ raw: E.newDmKey(), myPriv: eve.privateKey, myPub: eve.publicKey });
  assert.ok(await fails(() => open(forged)), 'not from a');
  // The key set tag depends on every key, and on nothing else.
  assert.equal(await E.dmKeysTag({ b: keys.b, a: keys.a }), tag, 'order doesn’t matter');
  await assert.rejects(() => E.dmKeysTag({ a: keys.a }));
});

test('DM messages in an epoch (d3): round trip; tampering, another DM, epoch or author fail; d2 and v1 still open', async () => {
  const a = await person('a'); const b = await person('b');
  const raw = E.newDmKey();
  const text = await E.encryptDm3({ raw, epoch: 2, dmId: 'dm1', authorId: 'a', payload: { t: 'post-quantum hello' } });
  assert.equal(E.dmEpoch(text), 2);
  assert.equal(E.dmEpoch('d2:x:y:z'), null);
  const open = (t, o = {}) => E.decryptDm3({ raw, dmId: 'dm1', authorId: 'a', text: t, ...o });
  assert.equal((await open(text)).payload.t, 'post-quantum hello');
  for (const f of [2, 3, 4]) assert.ok(await fails(() => open(tamper(text, f))), `field ${f}`);
  assert.ok(await fails(() => open(tamper(text, 4, { tag: true }))), 'tag');
  assert.ok(await fails(() => open(text.replace(/^d3:2:/, 'd3:3:'))), 'relabelled epoch');
  assert.ok(await fails(() => open(text, { dmId: 'dm2' })), 'another DM');
  assert.ok(await fails(() => open(text, { authorId: 'b' })), 'another author');
  assert.ok(await fails(() => open(text, { raw: E.newDmKey() })), 'another epoch key');
  // Same length padding as d2.
  assert.equal(unb64(text.split(':')[4]).length, 256 + 16);
  // Older DMs keep opening as they did.
  const d2 = await E.encryptDm({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: 'dm1', authorId: 'a', payload: { t: 'classic' } });
  assert.equal((await E.decryptDm({ myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'dm1', authorId: 'a', text: d2 })).payload.t, 'classic');
  assert.ok(await fails(() => E.decryptDm({ myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'dm1', authorId: 'a', text })), 'd3 is never read as d2');
});

test('downgrade pins: once seen, a missing post-quantum key is noticed; only a new identity key starts over', () => {
  store.clear();
  const bob = { id: 'bob', publicKey: 'E1', signPublicKey: 'S1', pq: 'fp1' };
  assert.equal(E.checkPin('me', bob), 'ok');
  assert.equal(E.pinnedPq('me', bob), false);
  E.pinPq('me', bob, 'fp1');
  assert.equal(E.pinnedPq('me', bob), true);
  assert.equal(E.pinnedPq('me', { ...bob, publicKey: 'E2' }), false, 'only next to the identity key it was seen with');
  assert.equal(E.checkPin('me', { ...bob, pq: null }), 'ok', 'the pin check itself is unchanged');
  // Review finding 6: "Numbers match" for someone whose keys didn't change keeps the post-quantum pin.
  assert.equal(E.acceptPin('me', bob), true);
  assert.equal(E.pinnedPq('me', bob), true, 'kept for the same identity key');
  assert.equal(E.acceptPin('me', { ...bob, publicKey: 'E2', signPublicKey: 'S2' }), true);
  assert.equal(E.pinnedPq('me', { ...bob, publicKey: 'E2' }), false, 'a new identity key starts over');
});

test('your own post-quantum pin and the DM epoch high-water mark are kept per account', () => {
  store.clear();
  assert.equal(E.ownPqPinned('me'), false);
  E.pinOwnPq('me', 'fp');
  assert.equal(E.ownPqPinned('me'), true);
  assert.equal(E.ownPqPinned('other'), false);
  assert.equal(E.dmHighWater('me', 'dm1'), 0);
  E.noteDmEpoch('me', 'dm1', 3);
  E.noteDmEpoch('me', 'dm1', 2);
  assert.equal(E.dmHighWater('me', 'dm1'), 3, 'never goes down');
  assert.equal(E.dmHighWater('other', 'dm1'), 0);
});
