// Post-quantum keys in use, with the app's real client code (public/js/e2ee.js, secure.js, api.js) in Node against a
// real server, as in crypto-hardening.test.js. An account from before post-quantum keys and a new one talk; the old one
// upgrades at its next sign-in with the password and keeps reading everything; its other device, already signed in,
// gets the key handed over without the password; server keys go out hybrid to whoever has a post-quantum key; and a
// server that hides or swaps someone's post-quantum key is refused instead of quietly getting P-256 alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const H = require('./helpers');

let store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { crypto: globalThis.crypto, hashwasm: require('hash-wasm') };

let srv; let E; let API; let createSecure;
let curIp = '198.51.100.9';
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (f) => pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href;
const b64 = (u8) => Buffer.from(u8).toString('base64');

before(async () => {
  srv = await H.startServer();
  globalThis.fetch = (url, opts = {}) => (String(url).startsWith('/')
    ? realFetch(srv.base + url, { ...opts, headers: { ...(opts.headers || {}), 'x-forwarded-for': curIp } })
    : realFetch(url, opts));
  E = await import(js('e2ee.js'));
  API = await import(js('api.js'));
  ({ createSecure } = await import(js('secure.js')));
});
after(async () => { globalThis.fetch = realFetch; await srv.stop(); });

const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };
const uname = (base) => `${base}${H.hex(3)}`;

// An envelope as accounts made before post-quantum keys have it: the PKCS#8 bytes alone.
async function legacyIdentity(wrapKey) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, wrapKey, pkcs8));
  const encPrivateKey = `${b64(iv)}:${b64(ct)}`;
  return { publicKey: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), encPrivateKey, privateKey: await E.unwrapPrivateKey(wrapKey, encPrivateKey), pqSeed: null };
}
async function uploadSignKey(p, sk) {
  const ch = (await as(p, 'POST', '/me/sign-key/challenge')).json;
  const keyProof = await E.signKeyProof(p.privateKey, ch.serverPublicKey, ch.nonce, p.id, sk.signPublicKey);
  const signature = await E.sign(sk.signKey, `hearth-sign-key|${p.id}|${p.publicKey}|${ch.nonce}`);
  return as(p, 'POST', '/me/sign-key', { signPublicKey: sk.signPublicKey, encSignPrivateKey: sk.encSignPrivateKey, nonce: ch.nonce, keyProof, signature });
}
// Registered the way the app does it; legacy: an account (and signing key) from before post-quantum keys.
async function person(name, { legacy = false, sign = true } = {}) {
  const kdfSalt = E.newKdfSalt();
  const { authKey, wrapKey } = await E.deriveKeys(name, `pw-${name}`, { kdf: 'argon2id', salt: kdfSalt });
  const id = legacy ? await legacyIdentity(wrapKey) : await E.createIdentity(wrapKey);
  const ip = H.newIp();
  const r = await srv.api('POST', '/auth/register', { ip, body: { username: name, authKey, kdfSalt, publicKey: id.publicKey, encPrivateKey: id.encPrivateKey, acceptTos: srv.config.termsVersion || undefined } });
  assert.equal(r.status, 200, r.text);
  const p = { username: name, ip, authKey, wrapKey, kdfSalt, token: r.json.token, id: r.json.user.id, ...id };
  if (!sign) return p; // (a new account's first start makes its signing key: secure.js ensureSigningKey)
  const sk = await E.createSigningKey(id.privateKey, id.publicKey);
  Object.assign(p, sk);
  assert.equal((await uploadSignKey(p, sk)).status, 200);
  return p;
}
// What a sign-in with the password hands the app (app.js finishLogin): the envelope as the server has it now.
async function passwordCtx(user) {
  const r = await as(user, 'POST', '/me/keys/wrapped', { authKey: user.authKey });
  assert.equal(r.status, 200, r.text);
  const { pqSeed } = await E.unwrapIdentity(user.wrapKey, r.json.encPrivateKey);
  return { authKey: user.authKey, wrapKey: user.wrapKey, encPrivateKey: r.json.encPrivateKey, pqSeed };
}
// The app's start-up on one device (app.js loadBootstrap): its own pins, and its own copy of the post-quantum seed.
// ctx: a sign-in with the password just before (else a device that was already signed in).
// edit(boot): what a server that changes its answers hands this device.
async function device(user, { pins = new Map(), pqSeed = null, ctx = null, token = user.token, edit = null } = {}) {
  store = pins; curIp = user.ip; API.setToken(token);
  const boot = (await as({ ...user, token }, 'GET', '/bootstrap')).json;
  if (edit) edit(boot);
  const dmEvents = [];
  const needs = [];
  const S = { me: boot.me, users: boot.users, servers: boot.servers, dms: boot.dms, privateKey: user.privateKey, e2eeSince: boot.e2eeSince, pqSeed: ctx && ctx.pqSeed ? ctx.pqSeed : pqSeed };
  const sec = createSecure({ S, onDmKeys: (id) => dmEvents.push(id), onNeedPassword: (why) => needs.push(why) });
  await sec.ensureSigningKey(boot.encSignPrivateKey);
  await sec.ensurePqKey(ctx);
  Object.values(S.users).forEach((u) => sec.trust(u));
  for (const st of Object.values(boot.keyStates || {})) await sec.applyState(st);
  for (const s of S.servers) await sec.keysSaved(s.id);
  return { sec, S, pins, boot, dmEvents, needs, token, user };
}
// Switch the "browser" (fetch token, pins) to this device before using it.
function use(d) { store = d.pins; curIp = d.user.ip; API.setToken(d.token); return d; }
async function friends(a, b) {
  assert.equal((await as(a, 'POST', '/friends', { username: b.username })).status, 200);
  assert.equal((await as(b, 'POST', '/friends', { username: a.username })).status, 200);
}
async function dmBetween(a, b) { return (await as(a, 'POST', '/dms', { userId: b.id })).json; }
async function sendDm(d, dmId, t) {
  use(d);
  await refreshDms(d);
  const ciphertext = await d.sec.encryptDm(dmId, { t, ts: Date.now() }); // (ts: when it was sent, as binding.js puts it in)
  const r = await as({ ...d.user, token: d.token }, 'POST', `/dms/${dmId}/messages`, { ciphertext });
  assert.equal(r.status, 200, r.text);
  return ciphertext;
}
async function refreshServers(d) { use(d); const boot = (await as({ ...d.user, token: d.token }, 'GET', '/bootstrap')).json; d.S.servers = boot.servers; for (const st of Object.values(boot.keyStates || {})) await d.sec.applyState(st); }
async function refreshDms(d) { d.S.dms = (await as({ ...d.user, token: d.token }, 'GET', '/bootstrap')).json.dms; }
async function readDms(d, dmId) {
  use(d);
  await refreshDms(d);
  const msgs = (await as({ ...d.user, token: d.token }, 'GET', `/dms/${dmId}/messages`)).json.messages;
  for (const m of msgs) await d.sec.decryptDmMessage(m);
  return msgs;
}
const texts = (msgs) => msgs.map((m) => (m.dec.pending ? '(waiting)' : m.dec.error ? '(error)' : m.dec.t));
const fresh = async (d, id) => { d.S.users[id] = (await as({ ...d.user, token: d.token }, 'GET', `/users/${id}`)).json; return d.S.users[id]; };

test('an account from before post-quantum keys and a new one: P-256 until both have one, then hybrid; nothing old is lost', async () => {
  const alice = await person(uname('pqold'), { legacy: true });
  const bob = await person(uname('pqnew'));
  await friends(alice, bob);
  const dm = await dmBetween(alice, bob);
  // Bob's first start after signing up publishes his post-quantum key (its seed is in his envelope already).
  const bobD = await device(bob, { ctx: await passwordCtx(bob) });
  const bobRow = srv.sql('SELECT pq_public_key, pq_sig FROM users WHERE id = ?', bob.id)[0];
  assert.equal(bobRow.pq_public_key, E.pqKeyPair(bobD.S.pqSeed).publicKey);
  assert.ok(await E.verifyPqKey(bob.signPublicKey, bob.id, bob.publicKey, bobRow.pq_public_key, bobRow.pq_sig), 'published signed');
  // Alice's device was signed in before the update: no password here, so no post-quantum key yet.
  const aliceD = await device(alice);
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', alice.id)[0].pq_public_key, null);
  assert.equal(aliceD.S.pqSeed, null);
  const a1 = await sendDm(aliceD, dm.id, 'from the old account');
  const b1 = await sendDm(bobD, dm.id, 'from the new account');
  assert.match(a1, /^d2:/); assert.match(b1, /^d2:/, 'P-256 while one of them has no post-quantum key');
  assert.deepEqual(texts(await readDms(bobD, dm.id)), ['from the old account', 'from the new account']);
  assert.deepEqual(texts(await readDms(aliceD, dm.id)), ['from the old account', 'from the new account']);

  // Alice signs in with her password: the one-time upgrade, inside her envelope, published signed.
  const ctx = await passwordCtx(alice);
  assert.equal(ctx.pqSeed, null);
  const aliceD2 = await device(alice, { ctx });
  const row = srv.sql('SELECT pq_public_key, pq_sig, enc_private_key FROM users WHERE id = ?', alice.id)[0];
  assert.ok(row.pq_public_key);
  assert.equal(row.pq_public_key, E.pqKeyPair(aliceD2.S.pqSeed).publicKey);
  const env = await E.unwrapIdentity(alice.wrapKey, row.enc_private_key);
  assert.deepEqual(Buffer.from(env.pqSeed), Buffer.from(aliceD2.S.pqSeed), 'the seed travels with the password envelope');
  assert.ok(await E.ownsPublicKey(env.privateKey, alice.publicKey), 'same identity key');
  assert.ok(await E.verifyPqKey(alice.signPublicKey, alice.id, alice.publicKey, row.pq_public_key, row.pq_sig));
  // A sign-in on a brand new device later gets the seed from the envelope, no handoff needed.
  assert.ok((await passwordCtx(alice)).pqSeed);

  // From now on: hybrid both ways, each message with its own key inside it, and the old messages still open.
  await fresh(bobD, alice.id);
  const a2 = await sendDm(aliceD2, dm.id, 'hybrid from alice');
  const b2 = await sendDm(bobD, dm.id, 'hybrid from bob');
  assert.match(a2, /^d3:/); assert.match(b2, /^d3:/);
  assert.equal(a2.split(':').length, 8, 'a copy of its key for each of them, in the message');
  const want = ['from the old account', 'from the new account', 'hybrid from alice', 'hybrid from bob'];
  assert.deepEqual(texts(await readDms(bobD, dm.id)), want);
  assert.deepEqual(texts(await readDms(aliceD2, dm.id)), want);
  // A brand new device of Bob's (signed in with the password) reads the whole history too.
  const bobD3 = await device(bob, { ctx: await passwordCtx(bob) });
  assert.deepEqual(texts(await readDms(bobD3, dm.id)), want);

  // Alice's device that was signed in all along: it can't read what's locked to her new key until she enters her
  // password there once (no device hands the seed to another: review findings 2 and 8).
  const aliceOld = await device(alice, { pins: aliceD.pins, token: alice.token });
  assert.equal(aliceOld.S.pqSeed, null);
  assert.equal(aliceOld.sec.neededPassword(), 'seed');
  assert.deepEqual(aliceOld.needs, ['seed'], 'the app is asked to show the password bar');
  assert.deepEqual(texts(await readDms(aliceOld, dm.id)), ['from the old account', 'from the new account', '(waiting)', '(waiting)']);
  assert.equal((await as(alice, 'GET', '/me/pq-handoff')).status, 404, 'no handoff route');
  assert.equal(E.sealPqHandoff, undefined);
  use(aliceOld); await aliceOld.sec.ensurePqKey(await passwordCtx(alice));
  assert.deepEqual(Buffer.from(aliceOld.S.pqSeed), Buffer.from(aliceD2.S.pqSeed));
  assert.equal(aliceOld.sec.neededPassword(), null);
  assert.ok(aliceOld.dmEvents.includes(null), 'the app is told to open what waited');
  assert.deepEqual(texts(await readDms(aliceOld, dm.id)), want);
  // It can write hybrid too.
  assert.match(await sendDm(aliceOld, dm.id, 'from the old device'), /^d3:/);
  assert.deepEqual(texts(await readDms(bobD, dm.id)).slice(-1), ['from the old device']);

  // Downgrade: a server that stops listing Alice's post-quantum key gets nothing encrypted to her, not P-256 alone.
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', alice.id);
  await fresh(bobD, alice.id);
  use(bobD);
  await assert.rejects(() => bobD.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'untrusted' && /isn’t listed right now/.test(e.message));
  // Nor one that swaps in a post-quantum key of its own (it can't sign it as Alice).
  const mallory = E.pqKeyPair(E.newPqSeed()).publicKey;
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', mallory, row.pq_sig, alice.id);
  await fresh(bobD, alice.id);
  await assert.rejects(() => bobD.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'untrusted' && /didn’t check out/.test(e.message));
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', row.pq_public_key, row.pq_sig, alice.id);
  await fresh(bobD, alice.id);
  assert.match(await sendDm(bobD, dm.id, 'back to normal'), /^d3:/);
});

test('d3 messages carry their own keys: nothing about them is kept or listed apart; one made with a key the server only lists as theirs reads as not verified', async () => {
  const a = await person(uname('pqep'));
  const b = await person(uname('pqep'));
  await friends(a, b);
  const dm = await dmBetween(a, b);
  const aD = await device(a, { ctx: await passwordCtx(a) });
  const bD = await device(b, { ctx: await passwordCtx(b) });
  await fresh(aD, b.id); await fresh(bD, a.id);
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:/);
  assert.match(await sendDm(bD, dm.id, 'two'), /^d3:/);
  // No DM keys anywhere else: nothing for a server to hold back, roll back or re-date.
  assert.equal((await as(a, 'GET', `/dms/${dm.id}/keys`)).status, 404);
  assert.equal((await as(a, 'POST', `/dms/${dm.id}/keys`, { epoch: 1 })).status, 404);
  // The server plants a message "from b", made with a key it lists as one of b's past keys (its own): a's app reads it
  // only as "older key, not verified".
  const fake = await E.createIdentity(a.wrapKey);
  const t0 = Date.now();
  srv.sql('INSERT INTO user_key_history (user_id, public_key, sign_public_key, retired_at) VALUES (?, ?, NULL, ?)', b.id, fake.publicKey, t0 - 60000);
  const rowOf = (id) => srv.sql('SELECT public_key, pq_public_key FROM users WHERE id = ?', id)[0];
  const forged = await E.encryptDm3({ dmId: dm.id, authorId: b.id, myPriv: fake.privateKey, myPub: fake.publicKey, myPq: rowOf(b.id).pq_public_key, peerId: a.id, peerPub: rowOf(a.id).public_key, peerPq: rowOf(a.id).pq_public_key, payload: { t: 'planted' } });
  srv.sql('INSERT INTO dm_messages (id, dm_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)', `zz${H.hex(8)}`, dm.id, b.id, forged, t0 - 100000);
  await fresh(aD, b.id);
  const seen = (await readDms(aD, dm.id)).find((m) => m.dec.t === 'planted');
  assert.equal(seen && seen.dec.keyNote, 'listed', 'shown as not verified');
  assert.deepEqual(texts(await readDms(bD, dm.id)).slice(0, 2), ['one', 'two']);
});

test('server keys: hybrid (w2) to members with a post-quantum key, P-256 (w1) to the others; everyone reads; old self-copies are upgraded', async () => {
  const owner = await person(uname('pqown'));
  const pq = await person(uname('pqmem'));
  const old = await person(uname('pqleg'), { legacy: true });
  const s = (await as(owner, 'POST', '/servers', { name: 'pq' })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [pq, old]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  // The legacy member's device first (no post-quantum key), then the others publish theirs.
  const oldD = await device(old);
  const pqD = await device(pq, { ctx: await passwordCtx(pq) });
  const ownerD = await device(owner, { ctx: await passwordCtx(owner) });
  use(ownerD);
  const { ciphertext, epoch } = await ownerD.sec.encryptChannel(s.id, ch, { t: 'hello all' });
  const post = await as(owner, 'POST', `/channels/${ch}/messages`, { ciphertext, epoch });
  assert.equal(post.status, 200, post.text);
  const rows = Object.fromEntries(srv.sql('SELECT user_id, wrapped FROM server_keys WHERE server_id = ? AND epoch = ?', s.id, epoch).map((r) => [r.user_id, r.wrapped]));
  assert.equal(E.wrapFormat(rows[owner.id]), 'w2', 'own copy');
  assert.equal(E.wrapFormat(rows[pq.id]), 'w2', 'member with a post-quantum key');
  assert.equal(E.wrapFormat(rows[old.id]), 'w1', 'member without one yet');
  const read = async (d) => {
    use(d);
    await d.sec.refresh(s.id);
    const m = (await as({ ...d.user, token: d.token }, 'GET', `/channels/${ch}/messages`)).json.messages[0];
    await d.sec.decryptChannelMessage(m);
    return m.dec;
  };
  for (const d of [pqD, oldD]) {
    const dec = await read(d);
    assert.equal(dec.t, 'hello all');
    assert.equal(dec.verified, true);
  }
  // The legacy member's copy, once they have kept it for themselves, is still w1; when they upgrade, their own copies
  // are stored again as w2.
  await oldD.sec.keysSaved(s.id);
  const ctx = await passwordCtx(old);
  const oldD2 = await device(old, { ctx, pins: oldD.pins });
  await oldD2.sec.keysSaved(s.id);
  assert.ok(await until(() => E.wrapFormat(srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, old.id, epoch)[0].wrapped) === 'w2'), 'upgraded at rest');
  assert.equal((await read(oldD2)).t, 'hello all');

  // The server refuses a w1 copy for someone it knows has a post-quantum key, when the app says what it wrapped for
  // (pqs): that's how a member's first post-quantum key reaches every server they're in.
  const raw = E.newGroupKey();
  const w1 = await E.wrapGroupKey({ raw, serverId: s.id, epoch: epoch + 1, recipientId: pq.id, recipientPub: pq.publicKey, wrapperId: owner.id, signKey: owner.signKey });
  const r = await as(owner, 'POST', `/servers/${s.id}/keys/share`, { epoch, wraps: { [pq.id]: w1 }, pubs: { [pq.id]: pq.publicKey }, pqs: { [pq.id]: null } });
  assert.deepEqual(r.json.stale, [pq.id]);
  // …and whatever the app says, or if it says nothing (an old cached app): a w1 copy for someone with one is stale.
  for (const body of [{ pubs: { [pq.id]: pq.publicKey } }, {}]) {
    const r2 = await as(owner, 'POST', `/servers/${s.id}/keys/share`, { epoch, wraps: { [pq.id]: w1 }, ...body });
    assert.deepEqual(r2.json.stale, [pq.id]);
  }
  // Nor does an own copy go back to w1 over a w2 one.
  const w1own = await E.wrapGroupKey({ raw, serverId: s.id, epoch, recipientId: owner.id, recipientPub: owner.publicKey, wrapperId: owner.id, signKey: owner.signKey });
  assert.equal((await as(owner, 'POST', `/servers/${s.id}/keys/self`, { wraps: { [epoch]: w1own } })).json.updated, 0);
  // Junk in the w2 shape is refused like junk w1.
  const bad = rows[pq.id].split(':'); bad[2] = bad[2].slice(8);
  assert.equal((await as(owner, 'POST', `/servers/${s.id}/keys/self`, { wraps: { [epoch]: bad.join(':') } })).json.updated, 0);
});

test('publishing a post-quantum key: signed by the account, never replaced without the password', async () => {
  const u = await person(uname('pqpub'));
  const seed = E.newPqSeed();
  const pq = E.pqKeyPair(seed).publicKey;
  const other = E.pqKeyPair(E.newPqSeed()).publicKey;
  const sig = await E.signPqKey(u.signKey, u.id, u.publicKey, pq);
  const pw = { authKey: u.authKey };
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: pq, pqSig: await E.signPqKey(u.signKey, u.id, u.publicKey, other), ...pw })).status, 403, 'signature for another key');
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: 'AAAA', pqSig: sig, ...pw })).status, 400);
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: pq, pqSig: sig })).status, 401, 'a session and the keys, without the password');
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: pq, pqSig: sig, ...pw })).status, 200);
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: pq, pqSig: sig, ...pw })).status, 200, 'the same again is fine');
  const sig2 = await E.signPqKey(u.signKey, u.id, u.publicKey, other);
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: other, pqSig: sig2, ...pw })).status, 409, 'a second key, without a new envelope');
  const { encPrivateKey } = await E.addPqToEnvelope(u.wrapKey, u.encPrivateKey, { replace: true });
  assert.equal((await as(u, 'POST', '/me/pq-key', { pqPublicKey: other, pqSig: sig2, encPrivateKey, replace: true, authKey: 'f'.repeat(64) })).status, 401, 'the wrong password');
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, pq, 'unchanged');
  // Everyone sees the fingerprint; the key itself on request.
  const other2 = await person(uname('pqview'));
  const listed = (await as(other2, 'GET', `/users/${u.id}`)).json;
  assert.equal(listed.pq, await E.pqFingerprint(pq));
  const k = (await as(other2, 'GET', `/users/${u.id}/pq-key`)).json;
  assert.equal(k.pqPublicKey, pq);
  assert.equal((await as(other2, 'POST', '/users/pq-keys', { ids: [u.id] })).json.keys[u.id].pqPublicKey, pq);
  // A recovery key made since the account has its post-quantum key holds the seed; one from before is flagged.
  const env = (await as(u, 'POST', '/me/keys/wrapped', { authKey: u.authKey })).json.encPrivateKey;
  const recSalt = E.newKdfSalt();
  const encPrivateKeyRecovery = await E.rewrapPrivateKey(u.wrapKey, await E.recoveryWrapKey(E.newRecoveryCode(), recSalt), env);
  assert.equal((await as(u, 'PUT', '/me/recovery', { encPrivateKeyRecovery, recoverySalt: recSalt, authKey: u.authKey, fromEnvelope: await E.envelopeHash(env) })).status, 200);
  const me = async () => (await as(u, 'GET', '/bootstrap')).json.me;
  assert.equal((await me()).recoveryStale, false);
  // Second review, N9: one that doesn't say which envelope it was made from (or names an older one) counts as older.
  assert.equal((await as(u, 'PUT', '/me/recovery', { encPrivateKeyRecovery, recoverySalt: recSalt, authKey: u.authKey })).status, 200);
  assert.equal((await me()).recoveryStale, true);
  assert.equal((await as(u, 'PUT', '/me/recovery', { encPrivateKeyRecovery, recoverySalt: recSalt, authKey: u.authKey, fromEnvelope: await E.envelopeHash(env) })).status, 200);
  assert.equal((await me()).recoveryStale, false);
  srv.sql('UPDATE users SET recovery_pq = 0 WHERE id = ?', u.id);
  assert.equal((await me()).recoveryStale, true);

  // A password change made from an older envelope than the stored one (another device just upgraded it) is refused,
  // so the seed isn't dropped; made from the current one, it goes through.
  const salt = E.newKdfSalt();
  const nk = await E.deriveKeys(u.username, 'pw-changed', { kdf: 'argon2id', salt });
  const enc2 = await E.rewrapPrivateKey(u.wrapKey, nk.wrapKey, env);
  const change = (fromEnvelope) => as(u, 'POST', '/me/password', { oldAuthKey: u.authKey, newAuthKey: nk.authKey, encPrivateKey: enc2, salt, fromEnvelope });
  const stale = await change(await E.envelopeHash(`${env}x`));
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.json.code, 'envelope_changed');
  assert.equal((await change(await E.envelopeHash(env))).status, 200);
  assert.ok((await E.unwrapIdentity(nk.wrapKey, srv.sql('SELECT enc_private_key FROM users WHERE id = ?', u.id)[0].enc_private_key)).pqSeed, 'the seed came along');
});

test('a reset with an older recovery key (no seed in it) gets a new post-quantum key; a reset without one starts over', async () => {
  const u = await person(uname('pqrec'));
  const d = await device(u, { ctx: await passwordCtx(u) });
  const first = srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key;
  assert.equal(first, E.pqKeyPair(d.S.pqSeed).publicKey);
  // A reset without the recovery key: new identity, so the post-quantum key goes too, and the new one is published.
  await H.confirmEmail(srv, u, `${u.username}@example.test`);
  await srv.api('POST', '/auth/forgot', { ip: H.newIp(), body: { login: u.username } });
  const tok = H.resetTokenFrom((await srv.mails()).filter((m) => m.to === `${u.username}@example.test` && /reset your password/.test(m.subject)).pop());
  const kdfSalt = E.newKdfSalt();
  const k = await E.deriveKeys(u.username, 'new-pw', { kdf: 'argon2id', salt: kdfSalt });
  const ident = await E.createIdentity(k.wrapKey);
  const ip = H.newIp();
  const rr = await srv.api('POST', '/auth/reset', { ip, body: { token: tok, authKey: k.authKey, kdfSalt, encPrivateKey: ident.encPrivateKey, publicKey: ident.publicKey } });
  assert.equal(rr.status, 200, rr.text);
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, null, 'cleared with the old keys');
  const nu = { ...u, ip, token: rr.json.token, authKey: k.authKey, wrapKey: k.wrapKey, ...ident };
  const sk = await E.createSigningKey(ident.privateKey, ident.publicKey);
  Object.assign(nu, sk);
  assert.equal((await uploadSignKey(nu, sk)).status, 200);
  const d2 = await device(nu, { ctx: await passwordCtx(nu) });
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, E.pqKeyPair(ident.pqSeed).publicKey);
  assert.deepEqual(Buffer.from(d2.S.pqSeed), Buffer.from(ident.pqSeed));
  // An envelope without the seed while the account lists a key (an old recovery copy): replace, with the password.
  const ctx = { ...(await passwordCtx(nu)), pqSeed: null, replace: true };
  const d3 = await device(nu, { ctx });
  const now = srv.sql('SELECT pq_public_key, enc_private_key FROM users WHERE id = ?', u.id)[0];
  assert.notEqual(now.pq_public_key, E.pqKeyPair(ident.pqSeed).publicKey, 'replaced');
  assert.equal(now.pq_public_key, E.pqKeyPair(d3.S.pqSeed).publicKey);
  assert.deepEqual(Buffer.from((await E.unwrapIdentity(nu.wrapKey, now.enc_private_key)).pqSeed), Buffer.from(d3.S.pqSeed));
});

// ------------------------------------------------------------------ regressions for docs/PQ-REVIEW-FINDINGS.md
// (Each of these failed on the code the review looked at.)

// A reset by email without the recovery key: new identity, signing and post-quantum keys, published as the app does.
async function resetNew(u, pw = `new-${H.hex(4)}`) {
  await H.confirmEmail(srv, u, `${u.username}@example.test`);
  await srv.api('POST', '/auth/forgot', { ip: H.newIp(), body: { login: u.username } });
  const tok = H.resetTokenFrom((await srv.mails()).filter((m) => m.to === `${u.username}@example.test` && /reset your password/.test(m.subject)).pop());
  const kdfSalt = E.newKdfSalt();
  const k = await E.deriveKeys(u.username, pw, { kdf: 'argon2id', salt: kdfSalt });
  const ident = await E.createIdentity(k.wrapKey);
  const ip = H.newIp();
  const rr = await srv.api('POST', '/auth/reset', { ip, body: { token: tok, authKey: k.authKey, kdfSalt, encPrivateKey: ident.encPrivateKey, publicKey: ident.publicKey } });
  assert.equal(rr.status, 200, rr.text);
  const nu = { ...u, ip, token: rr.json.token, authKey: k.authKey, wrapKey: k.wrapKey, ...ident };
  const sk = await E.createSigningKey(ident.privateKey, ident.publicKey);
  Object.assign(nu, sk);
  assert.equal((await uploadSignKey(nu, sk)).status, 200);
  return nu;
}
async function twoWithPq(base) {
  const a = await person(uname(base));
  const b = await person(uname(base));
  await friends(a, b);
  const dm = await dmBetween(a, b);
  const aD = await device(a, { ctx: await passwordCtx(a) });
  const bD = await device(b, { ctx: await passwordCtx(b) });
  await fresh(aD, b.id); await fresh(bD, a.id);
  return { a, b, dm, aD, bD };
}

test('review 1: a rotation never wraps your own copy to an identity key the server lists for you', async () => {
  const owner = await person(uname('rv1o'));
  const m = await person(uname('rv1m'));
  const s = (await as(owner, 'POST', '/servers', { name: 'rv1' })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  assert.equal((await as(m, 'POST', `/invites/${code}/join`, {})).status, 200);
  const oD = await device(owner, { ctx: await passwordCtx(owner) });
  await device(m, { ctx: await passwordCtx(m) });
  use(oD);
  await oD.sec.encryptChannel(s.id, s.channels.find((c) => c.type === 'text').id, { t: 'x' });
  const before = srv.sql('SELECT MAX(epoch) AS e FROM server_keys WHERE server_id = ?', s.id)[0].e;
  // The server says your identity key is one it holds (a socket user:update for yourself does exactly this).
  const evil = await E.createIdentity(owner.wrapKey);
  oD.S.me = { ...oD.S.me, publicKey: evil.publicKey };
  await assert.rejects(() => oD.sec.forceRotate(s.id), (e) => e.code === 'own_key_mismatch');
  assert.equal(srv.sql('SELECT MAX(epoch) AS e FROM server_keys WHERE server_id = ?', s.id)[0].e, before, 'no key went out');
});

test('review 3 and 9: no quiet P-256 fallback on your own side: own keys that don’t check out, or your listed key gone', async () => {
  const { a, b, dm, aD } = await twoWithPq('rv3');
  assert.match(await sendDm(aD, dm.id, 'hybrid'), /^d3:/);
  // (a) The server lists another signing key for you: nothing is sent, rather than d2.
  const realSign = aD.S.me.signPublicKey;
  aD.S.me = { ...aD.S.me, signPublicKey: b.signPublicKey };
  use(aD);
  await assert.rejects(() => aD.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'own_key_mismatch');
  aD.S.me = { ...aD.S.me, signPublicKey: realSign };
  // (b) A device of yours without the seed reads, and writes nothing post-quantum until the password is entered
  // (second review: then the server hiding your key, or the peer's, gets it nothing either).
  const aL = await device(a);
  assert.equal(aL.sec.neededPassword(), 'seed');
  use(aL);
  await assert.rejects(() => aL.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password');
  aL.S.me = { ...aL.S.me, pqPublicKey: null, pqSig: null };
  await assert.rejects(() => aL.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password' || e.code === 'own_key_mismatch');
  // (c) The receiving side flags a d2 in a DM that already went post-quantum (an app that fell back), as both messages
  // date themselves (here a quarter of an hour later: within ten minutes it could be clocks).
  const d2 = await E.encryptDm({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: dm.id, authorId: a.id, payload: { t: 'fallback', ts: Date.now() + 15 * 60000 } });
  assert.equal((await as(a, 'POST', `/dms/${dm.id}/messages`, { ciphertext: d2 })).status, 200);
  const { bD } = { bD: await device(b, { ctx: await passwordCtx(b) }) };
  await fresh(bD, a.id);
  await readDms(bD, dm.id); // (pins a's post-quantum key)
  const m = (await readDms(bD, dm.id)).find((x) => x.dec.t === 'fallback');
  assert.equal(m.dec.noPq, true);
});

test('review 4, 5 and 7: after accepting someone’s new keys nothing goes P-256 alone; an old key of theirs opens only what was written before this device saw the change', async () => {
  const { aD: aD2, dm: dm2, a: a2, b: b2 } = await twoWithPq('rv5');
  assert.match(await sendDm(aD2, dm2.id, 'before'), /^d3:/);
  const bOld = { ...b2 };
  const bNew = await resetNew(b2);
  await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD2);
  const u = await fresh(aD2, b2.id);
  assert.equal(aD2.sec.keyChanged(u), true);
  const seen = Date.now();
  assert.equal(aD2.sec.acceptKeys(u), true);
  assert.match(await sendDm(aD2, dm2.id, 'after'), /^d3:/);
  // Second review, N2: had the server left b's new post-quantum key out when a accepted his new keys, a's app still
  // wouldn't write P-256 alone in a DM it has seen go post-quantum.
  const pqRow = srv.sql('SELECT pq_public_key, pq_sig FROM users WHERE id = ?', b2.id)[0];
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', b2.id);
  const stripped = await fresh(aD2, b2.id);
  aD2.sec.acceptKeys(stripped);
  use(aD2);
  await assert.rejects(() => aD2.sec.encryptDm(dm2.id, { t: 'x' }), (e) => e.code === 'untrusted');
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', pqRow.pq_public_key, pqRow.pq_sig, b2.id);
  await fresh(aD2, b2.id);
  // Review 5: messages "from b" made with b's old (pinned) key: one dated after this device saw the change doesn't
  // open; one dated before does, as written with an older key.
  const ra = srv.sql('SELECT public_key, pq_public_key FROM users WHERE id = ?', a2.id)[0];
  for (const [t, at] of [['forged now', Date.now()], ['from before', seen - 60000]]) {
    const text = await E.encryptDm3({ dmId: dm2.id, authorId: b2.id, myPriv: bOld.privateKey, myPub: bOld.publicKey, myPq: E.pqKeyPair(bOld.pqSeed).publicKey, peerId: a2.id, peerPub: ra.public_key, peerPq: ra.pq_public_key, payload: { t, ts: at } });
    srv.sql('INSERT INTO dm_messages (id, dm_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)', `zz${H.hex(8)}`, dm2.id, b2.id, text, at);
  }
  const msgs = await readDms(aD2, dm2.id);
  assert.ok(!msgs.some((m) => m.dec.t === 'forged now'), 'an old key doesn’t vouch for a message dated after it was replaced');
  const ok = msgs.find((m) => m.dec.t === 'from before');
  assert.equal(ok && ok.dec.keyNote, 'pinned');
});

test('review 10, 11 and 13: a device never locks things for itself to a key it can’t open; the password unlocks it', async () => {
  // An account from before post-quantum keys, with a recovery key from then, in a server with history.
  const o = await person(uname('rv10'), { legacy: true });
  const rec = E.newRecoveryCode();
  const recSalt = E.newKdfSalt();
  const env0 = (await as(o, 'POST', '/me/keys/wrapped', { authKey: o.authKey })).json.encPrivateKey;
  assert.equal((await as(o, 'PUT', '/me/recovery', { encPrivateKeyRecovery: await E.rewrapPrivateKey(o.wrapKey, await E.recoveryWrapKey(rec, recSalt), env0), recoverySalt: recSalt, authKey: o.authKey })).status, 200);
  const s = (await as(o, 'POST', '/servers', { name: 'rv10' })).json;
  const ch = s.channels.find((c) => c.type === 'text').id;
  const laptop = await device(o);
  use(laptop);
  const { ciphertext, epoch } = await laptop.sec.encryptChannel(s.id, ch, { t: 'from before the upgrade' });
  assert.equal((await as(o, 'POST', `/channels/${ch}/messages`, { ciphertext, epoch })).status, 200);
  const own = () => srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, o.id, epoch)[0].wrapped;
  assert.equal(E.wrapFormat(own()), 'w1');
  const w1copy = own();
  // The upgrade on another device: the recovery key is older than the new key, so the w1 copy stays as it is (review
  // 11: a reset with that recovery key would otherwise lose it).
  const other = await device(o, { ctx: await passwordCtx(o) });
  await other.sec.keysSaved(s.id);
  assert.equal(other.S.me.recoveryStale, true);
  assert.equal(E.wrapFormat(own()), 'w1', 'not re-locked while the recovery key doesn’t hold the seed');
  // The laptop, signed in all along, without the seed: it never re-locks its readable copy (review 10), keeps reading
  // and writing, and asks for the password.
  const laptop2 = await device(o, { pins: laptop.pins, token: o.token });
  await laptop2.sec.keysSaved(s.id);
  assert.equal(E.wrapFormat(own()), 'w1');
  assert.equal(laptop2.sec.neededPassword(), 'seed');
  const read = async (d) => {
    use(d);
    await d.sec.refresh(s.id);
    const m = (await as({ ...d.user, token: d.token }, 'GET', `/channels/${ch}/messages`)).json.messages[0];
    await d.sec.decryptChannelMessage(m);
    return m.dec;
  };
  assert.equal((await read(laptop2)).t, 'from before the upgrade');
  // A new recovery key holds the seed: then the copy goes hybrid.
  const env1 = (await as(o, 'POST', '/me/keys/wrapped', { authKey: o.authKey })).json.encPrivateKey;
  assert.equal((await as(o, 'PUT', '/me/recovery', { encPrivateKeyRecovery: await E.rewrapPrivateKey(o.wrapKey, await E.recoveryWrapKey(E.newRecoveryCode(), recSalt), env1), recoverySalt: recSalt, authKey: o.authKey, fromEnvelope: await E.envelopeHash(env1) })).status, 200);
  const other2 = await device(o, { ctx: await passwordCtx(o), pins: other.pins });
  await other2.sec.keysSaved(s.id);
  assert.ok(await until(() => E.wrapFormat(own()) === 'w2'), 'upgraded once the recovery key holds the seed');
  // A device without the seed, with the recovery key up to date now: it still never re-locks its readable w1 copy.
  srv.sql('UPDATE server_keys SET wrapped = ?, wrapper_id = ? WHERE server_id = ? AND user_id = ? AND epoch = ?', w1copy, o.id, s.id, o.id, epoch);
  const laptop3 = await device(o, { pins: new Map(), token: o.token });
  await laptop3.sec.keysSaved(s.id);
  assert.equal(E.wrapFormat(own()), 'w1', 'not locked to a key this device can’t open');
  assert.equal((await read(laptop3)).t, 'from before the upgrade');
  // Review 13: the laptop's password (as after a password change there) gives it the seed from the envelope.
  use(laptop2);
  await laptop2.sec.ensurePqKey(await passwordCtx(o));
  assert.equal(laptop2.sec.neededPassword(), null);
  assert.ok(laptop2.S.pqSeed instanceof Uint8Array);
  assert.equal((await read(laptop2)).t, 'from before the upgrade');
});

test('review 12 and 15: a reset with an old recovery key leaves no key published that nobody holds; reset info says what it keeps', async () => {
  const u = await person(uname('rv12'));
  // The recovery key from before the post-quantum key (made from an envelope without a seed).
  const rec = E.newRecoveryCode();
  const recSalt = E.newKdfSalt();
  const d = await device(u, { ctx: await passwordCtx(u) });
  const pk1 = srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key;
  assert.ok(pk1);
  await H.confirmEmail(srv, u, `${u.username}@example.test`);
  // (Made here from the current envelope; marked as from before, as one made before the upgrade would be. The app's
  // side of "no seed in it" is pqInEnvelope below.)
  assert.equal((await as(u, 'PUT', '/me/recovery', { encPrivateKeyRecovery: await E.rewrapPrivateKey(u.wrapKey, await E.recoveryWrapKey(rec, recSalt), u.encPrivateKey), recoverySalt: recSalt, authKey: u.authKey })).status, 200);
  srv.sql('UPDATE users SET recovery_pq = 0 WHERE id = ?', u.id);
  await srv.api('POST', '/auth/forgot', { ip: H.newIp(), body: { login: u.username } });
  const tok = H.resetTokenFrom((await srv.mails()).filter((m) => m.to === `${u.username}@example.test` && /reset your password/.test(m.subject)).pop());
  const info = (await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: tok } })).json;
  assert.equal(info.hasPq, true);
  assert.equal(info.recoveryPq, false);
  assert.equal(info.pqPublicKey, pk1);
  // The app found no seed in that recovery copy (as for one made before the upgrade) and says so: the server drops the
  // key nobody could open, and the next start (interrupted first) asks for the password and publishes a new one.
  const kdfSalt = E.newKdfSalt();
  const k = await E.deriveKeys(u.username, 'after-reset', { kdf: 'argon2id', salt: kdfSalt });
  const rk = await E.recoveryWrapKey(rec, info.recoverySalt);
  const encPrivateKey = await E.rewrapPrivateKey(rk, k.wrapKey, info.encPrivateKeyRecovery);
  const { privateKey } = await E.unwrapIdentity(k.wrapKey, encPrivateKey);
  const keyProof = await E.resetKeyProof(privateKey, info.keyChallenge.serverPublicKey, info.keyChallenge.nonce, info.userId);
  const ip = H.newIp();
  const rr = await srv.api('POST', '/auth/reset', { ip, body: { token: tok, authKey: k.authKey, kdfSalt, encPrivateKey, keepKeys: true, keyProof, pqInEnvelope: false } });
  assert.equal(rr.status, 200, rr.text);
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, null, 'no key left published that nobody holds');
  const nu = { ...u, ip, token: rr.json.token, authKey: k.authKey, wrapKey: k.wrapKey, privateKey };
  // Second review, N1: a browser that never saw the key asks too.
  assert.equal((await device(nu, { pins: new Map() })).sec.neededPassword(), 'upgrade');
  const next = await device(nu, { pins: d.pins });
  assert.equal(next.sec.neededPassword(), 'seed', 'the next start asks for the password (it saw the account had a key)');
  use(next);
  const ctx = await passwordCtx(nu);
  await next.sec.ensurePqKey({ ...ctx, pqSeed: null });
  const pk2 = srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key;
  assert.ok(pk2 && pk2 !== pk1);
  assert.equal(next.sec.neededPassword(), null);
  // An account that never got a post-quantum key: reset info says so (nothing is lost with any recovery key).
  const old = await person(uname('rv15'), { legacy: true });
  await H.confirmEmail(srv, old, `${old.username}@example.test`);
  await srv.api('POST', '/auth/forgot', { ip: H.newIp(), body: { login: old.username } });
  const tok2 = H.resetTokenFrom((await srv.mails()).filter((m) => m.to === `${old.username}@example.test` && /reset your password/.test(m.subject)).pop());
  assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: tok2 } })).json.hasPq, false);
});

test('review 14: a seed that was never published asks for the password to publish; P-256 DMs to people without a key still go', async () => {
  const peer = await person(uname('rv14p'));
  const u = await person(uname('rv14u'));
  await friends(u, peer);
  const dm = await dmBetween(u, peer);
  await device(peer, { ctx: await passwordCtx(peer) });
  // u's first start after sign-up stopped before publishing: the seed is on the device, nothing on the server.
  const seed = (await passwordCtx(u)).pqSeed;
  const d = await device(u, { pqSeed: seed, pins: new Map() });
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, null);
  assert.equal(d.sec.neededPassword(), 'publish');
  await fresh(d, peer.id);
  // Second review: this device can't tell a key that was never published from one the server hides, so it writes
  // nothing to someone with a post-quantum key until the password is entered; to someone without one, P-256 as ever.
  use(d);
  await assert.rejects(() => d.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password');
  const old = await person(uname('rv14o'), { legacy: true });
  await friends(u, old);
  const dmOld = await dmBetween(u, old);
  await fresh(d, old.id);
  assert.match(await sendDm(d, dmOld.id, 'works'), /^d2:/);
  use(d);
  await d.sec.ensurePqKey(await passwordCtx(u));
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', u.id)[0].pq_public_key, E.pqKeyPair(seed).publicKey);
  assert.match(await sendDm(d, dm.id, 'hybrid now'), /^d3:/);
});

// ======================================================================= second review (docs/PQ-REVIEW-FINDINGS-2.md)
// A d3 message someone with these keys writes (by: { id, privateKey, publicKey, pq }), as the server would put it in
// front of d, dated at; d's own keys are what it's written to.
async function forgedD3(d, { dmId, by, authorId = by.id, t, at = Date.now() }) {
  use(d);
  const me = srv.sql('SELECT public_key, pq_public_key FROM users WHERE id = ?', d.user.id)[0];
  const text = await E.encryptDm3({ dmId, authorId, myPriv: by.privateKey, myPub: by.publicKey, myPq: by.pq, peerId: d.user.id, peerPub: me.public_key, peerPq: me.pq_public_key, payload: { t, ts: at } });
  const m = { id: H.hex(8), dmId, authorId, createdAt: at, ciphertext: text };
  await d.sec.decryptDmMessage(m);
  return m.dec;
}
const thief = (u, seed) => ({ id: u.id, privateKey: u.privateKey, publicKey: u.publicKey, pq: E.pqKeyPair(seed).publicKey });
// One browser's IndexedDB (secure.js keeps the seed there), shared by every "tab" until the returned function is called.
function fakeIdb() {
  const idb = new Map();
  globalThis.indexedDB = { open() {
    const r = {};
    setTimeout(() => {
      r.result = { transaction() {
        const t = {};
        const st = { put: (v, k) => { idb.set(k, v); return {}; }, get: (k) => ({ result: idb.get(k) }), delete: (k) => { idb.delete(k); return {}; } };
        t.objectStore = () => st;
        setTimeout(() => t.oncomplete && t.oncomplete());
        return t;
      } };
      r.onsuccess();
    });
    return r;
  } };
  return () => { delete globalThis.indexedDB; };
}
function failPost(suffix, status = 503) {
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).endsWith(suffix) && opts.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Service unavailable' }), { status, headers: { 'content-type': 'application/json' } }) : f(url, opts));
  return () => { globalThis.fetch = f; };
}

test('second review 1: a thief with someone’s old keys writes nothing dated after this device saw their keys change, as them or as you (after a reload too)', async () => {
  const { a, b, dm, aD } = await twoWithPq('r2a');
  const stolen = thief(b, (await passwordCtx(b)).pqSeed);
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:/);
  // b's device is stolen; b resets with new keys and a accepts them, then reloads.
  const bNew = await resetNew(b);
  await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD);
  assert.equal(aD.sec.acceptKeys(await fresh(aD, b.id)), true);
  const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
  await fresh(aR, b.id);
  assert.equal((await forgedD3(aR, { dmId: dm.id, by: stolen, t: 'forged as b' })).error, true);
  assert.equal((await forgedD3(aR, { dmId: dm.id, by: stolen, authorId: a.id, t: 'forged as a' })).error, true);
  // What was really written then still reads.
  assert.deepEqual(texts(await readDms(aR, dm.id)), ['one']);
});

test('second review 2: a tab that still has their old record judges their old key by the change another tab accepted', async () => {
  const { a, b, dm, aD, bD } = await twoWithPq('r2b');
  const stolen = thief(b, (await passwordCtx(b)).pqSeed);
  assert.match(await sendDm(bD, dm.id, 'from b'), /^d3:/);
  const tab2 = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
  await fresh(tab2, b.id);
  assert.deepEqual(texts(await readDms(aD, dm.id)), ['from b']);
  assert.deepEqual(texts(await readDms(tab2, dm.id)), ['from b']);
  const bNew = await resetNew(b);
  await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD);
  assert.equal(aD.sec.acceptKeys(await fresh(aD, b.id)), true);
  await sleep(5);
  assert.equal((await forgedD3(tab2, { dmId: dm.id, by: stolen, t: 'forged after acceptance' })).error, true);
});

test('second review 3: a device without the seed writes nothing P-256 alone for a post-quantum account, whatever its own record lists', async () => {
  const { a, b, dm, aD } = await twoWithPq('r2c');
  assert.match(await sendDm(aD, dm.id, 'pq'), /^d3:/);
  const s = (await as(a, 'POST', '/servers', { name: 'r2c' })).json;
  const code = (await as(a, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  assert.equal((await as(b, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  await refreshServers(aD);
  const first = await aD.sec.encryptChannel(s.id, ch, { t: 'hello' });
  // The server leaves the key out of the laptop's own record from the start.
  const laptop = await device(a, { edit: (boot) => { boot.me = { ...boot.me, pqPublicKey: null, pqSig: null }; } });
  assert.equal(laptop.sec.neededPassword(), 'seed', 'not "turn it on": the account has one');
  await fresh(laptop, b.id);
  use(laptop);
  await assert.rejects(() => laptop.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password');
  const before = srv.sql('SELECT MAX(epoch) AS e FROM server_keys WHERE server_id = ?', s.id)[0].e;
  await assert.rejects(() => laptop.sec.forceRotate(s.id));
  assert.equal(srv.sql('SELECT MAX(epoch) AS e FROM server_keys WHERE server_id = ?', s.id)[0].e, before, 'no rotation with a w1 own copy');
  assert.ok(first.epoch >= 1);
});

test('second review 5: a device waiting for the seed remembers what it read: the server hiding either key gets no d2', async () => {
  const { a, b, dm, aD } = await twoWithPq('r2e');
  assert.match(await sendDm(aD, dm.id, 'pq'), /^d3:/);
  const phone = await device(a);
  assert.equal(phone.sec.neededPassword(), 'seed');
  await fresh(phone, b.id);
  assert.deepEqual(texts(await readDms(phone, dm.id)), ['(waiting)']);
  // (a) The server pushes your own record without your key (and without its fingerprint).
  phone.S.me = { ...phone.S.me, pqPublicKey: null, pqSig: null };
  phone.S.users[a.id] = { ...phone.S.users[a.id], pq: null };
  use(phone);
  await phone.sec.ensurePqKey();
  assert.equal(phone.sec.neededPassword(), 'seed');
  await assert.rejects(() => phone.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password');
  // (b) …or lists b without his.
  const phone2 = await device(a);
  await fresh(phone2, b.id);
  await readDms(phone2, dm.id);
  phone2.S.users[b.id] = { ...phone2.S.users[b.id], pq: null };
  use(phone2);
  await assert.rejects(() => phone2.sec.encryptDm(dm.id, { t: 'x' }), (e) => ['need_password', 'untrusted'].includes(e.code));
});

test('second review 6: the "without post-quantum encryption" flag goes by the messages’ own times; nothing the server lists or dates switches it off', async () => {
  const { a, b, dm, aD, bD } = await twoWithPq('r2f');
  assert.match(await sendDm(aD, dm.id, 'pq'), /^d3:/);
  await readDms(bD, dm.id);
  const d2 = await E.encryptDm({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: dm.id, authorId: a.id, payload: { t: 'fallback', ts: Date.now() + 15 * 60000 } });
  const id = (await as(a, 'POST', `/dms/${dm.id}/messages`, { ciphertext: d2 })).json.id;
  assert.equal((await readDms(bD, dm.id)).find((x) => x.dec.t === 'fallback').dec.noPq, true);
  // Re-dated by the server to long before, on a fresh load of the DM: still flagged.
  srv.sql('UPDATE dm_messages SET created_at = 1 WHERE id = ?', id);
  const bR = await device(b, { ctx: await passwordCtx(b), pins: bD.pins });
  await fresh(bR, a.id);
  assert.equal((await readDms(bR, dm.id)).find((x) => x.dec.t === 'fallback').dec.noPq, true);
});

test('second review 8: a rotation leaves out a member whose post-quantum key is gone (a restore), and shares with them once it’s back', async () => {
  const owner = await person(uname('r2ho'));
  const m1 = await person(uname('r2hm'));
  const m2 = await person(uname('r2hl'));
  const s = (await as(owner, 'POST', '/servers', { name: 'r2h' })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [m1, m2]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  await device(m1, { ctx: await passwordCtx(m1) });
  const oD = await device(owner, { ctx: await passwordCtx(owner) });
  use(oD);
  const e1 = (await oD.sec.encryptChannel(s.id, ch, { t: 'one' })).epoch;
  assert.equal(E.wrapFormat(srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, e1)[0].wrapped), 'w2');
  assert.ok(await oD.sec.pqKeyOf(await fresh(oD, m1.id)), 'the owner’s app has seen m1’s post-quantum key');
  // Restored from before m1 had a post-quantum key; then someone leaves, so the key must change.
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', m1.id);
  assert.equal((await as(m2, 'POST', `/servers/${s.id}/leave`)).status, 200);
  await fresh(oD, m1.id);
  await refreshServers(oD);
  const e2 = (await oD.sec.encryptChannel(s.id, ch, { t: 'two' })).epoch;
  assert.ok(e2 > e1, 'the owner rotated');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, e2)[0].n, 0, 'no P-256 copy for m1');
  // m1 publishes again (the password, after the restore): the owner's app shares the key with m1, hybrid.
  await device(m1, { ctx: await passwordCtx(m1) });
  await fresh(oD, m1.id);
  await refreshServers(oD);
  oD.sec.maintain(s.id);
  assert.ok(await until(() => srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, e2).length > 0), 'shared once m1’s key is back');
  assert.equal(E.wrapFormat(srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, e2)[0].wrapped), 'w2');
});

test('second review 10: devices without the seed write nothing post-quantum, and post nothing', async () => {
  const { a, b, dm, aD } = await twoWithPq('r2j');
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:/);
  const p1 = await device(a);
  const p2 = await device(a);
  for (const p of [p1, p2]) await fresh(p, b.id);
  for (let i = 0; i < 6; i++) {
    const p = i % 2 ? p2 : p1;
    use(p);
    await assert.rejects(() => p.sec.encryptDm(dm.id, { t: `try ${i}` }), (e) => e.code === 'need_password');
  }
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM dm_messages WHERE dm_id = ?', dm.id)[0].n, 1);
});

test('second review 11: when the password’s publish doesn’t go through, the bar stays and says why; DMs to people without a key still go', async () => {
  const u = await person(uname('r2k'));
  const old = await person(uname('r2ko'), { legacy: true });
  await friends(u, old);
  const dm = await dmBetween(u, old);
  const x = await device(u, { ctx: await passwordCtx(u) }); // this browser saw the account's key
  // A reset elsewhere dropped the key; this browser's first start with the password can't publish it.
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', u.id);
  const undo = failPost('/me/pq-key');
  let x2;
  try { x2 = await device(u, { ctx: await passwordCtx(u), pins: x.pins }); } finally { undo(); }
  assert.ok(x2.sec.neededPassword(), 'the bar is there');
  assert.ok(x2.sec.lastPqError(), 'and the unlock can say what went wrong');
  await fresh(x2, old.id);
  assert.match(await sendDm(x2, dm.id, 'still goes'), /^d2:/);
});

test('second review 12: a DM scheduled as P-256 before the other person got a post-quantum key is held for re-encrypting', async () => {
  const a = await person(uname('r2l'));
  const b = await person(uname('r2l'), { legacy: true });
  await friends(a, b);
  const dm = await dmBetween(a, b);
  await device(a, { ctx: await passwordCtx(a) });
  const ciphertext = await E.encryptDm({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: dm.id, authorId: a.id, payload: { t: 'later' } });
  const r = await as(a, 'POST', `/dms/${dm.id}/scheduled-messages`, { ciphertext, ref: H.hex(12), draft: `x1:${H.b64(48)}`, sendAt: Date.now() + 3600000 });
  assert.equal(r.status, 200, r.text);
  assert.equal((await as(a, 'GET', '/scheduled-messages')).json.items.find((x) => x.id === r.json.id).status, 'pending');
  await device(b, { ctx: await passwordCtx(b) }); // b's upgrade
  const it = (await as(a, 'GET', '/scheduled-messages')).json.items.find((x) => x.id === r.json.id);
  assert.equal(it.status, 'held');
  assert.equal(it.reason, 'pq');
});

test('second review 13: a channel whose key waits for this device’s seed says so (not "waiting for another member")', async () => {
  const owner = await person(uname('r2m'));
  const s = (await as(owner, 'POST', '/servers', { name: 'r2m' })).json;
  const ch = s.channels.find((c) => c.type === 'text').id;
  const d = await device(owner, { ctx: await passwordCtx(owner) });
  use(d);
  await d.sec.encryptChannel(s.id, ch, { t: 'hello' });
  const laptop = await device(owner);
  assert.equal(laptop.sec.waitingForPq(s.id), true);
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const notice = app.slice(app.indexOf('function keyNotice()'), app.indexOf('function blockedDmNotice()'));
  assert.match(notice, /sec\.waitingForPq\(S\.view\.serverId\)/);
});

test('second review 14: the password bar doesn’t come back right after the password: simultaneous sign-ins, and another tab', async () => {
  // (a) Two sign-ins with the password at about the same time on an account from before.
  const o = await person(uname('r2n'), { legacy: true });
  const early = await passwordCtx(o); // the second device's envelope, from before the first one upgraded
  await device(o, { ctx: await passwordCtx(o) });
  const second = await device(o, { ctx: early, edit: (boot) => { boot.me = { ...boot.me, pqPublicKey: null, pqSig: null }; } });
  assert.equal(second.sec.neededPassword(), null);
  assert.ok(second.S.pqSeed instanceof Uint8Array);
  assert.equal(E.pqKeyPair(second.S.pqSeed).publicKey, srv.sql('SELECT pq_public_key FROM users WHERE id = ?', o.id)[0].pq_public_key);
  // (b) Two tabs of one browser (one IndexedDB): the password in one, then the other hears the account has a key.
  const undoIdb = fakeIdb();
  try {
    const t = await person(uname('r2t'), { legacy: true });
    const pins = new Map();
    const tabB = await device(t, { pins });
    assert.equal(tabB.sec.neededPassword(), 'upgrade');
    const tabA = await device(t, { pins, ctx: await passwordCtx(t) });
    assert.equal(tabA.sec.neededPassword(), null);
    await sleep(20); // (the seed is stored)
    use(tabB);
    Object.assign(tabB.S.me, (await as(t, 'GET', `/users/${t.id}/pq-key`)).json); // user:update
    await tabB.sec.ensurePqKey();
    assert.equal(tabB.sec.neededPassword(), null);
  } finally { undoIdb(); }
});

test('second review 4 and 9: the vault key comes from your proven identity key; the password bar sits in the page and can wait', async () => {
  const { a, aD } = await twoWithPq('r2d');
  use(aD);
  assert.equal(await aD.sec.provenIdentity(), a.publicKey);
  const evil = await E.createIdentity(a.wrapKey);
  const real = aD.S.me.publicKey;
  aD.S.me = { ...aD.S.me, publicKey: evil.publicKey };
  await assert.rejects(() => aD.sec.provenIdentity(), (e) => e.code === 'own_key_mismatch');
  aD.S.me = { ...aD.S.me, publicKey: real };
  assert.equal(aD.sec.provenKeys().e, a.publicKey);
  const read = (f) => require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const app = read('app.js');
  const vault = app.slice(app.indexOf('async function myVaultKey()'), app.indexOf('async function myVaultKey()') + 300);
  assert.match(vault, /sec\.provenIdentity\(\)/);
  assert.doesNotMatch(vault, /S\.me\.publicKey/);
  assert.match(app, /createRecall\(\{ S, vaultKey: \(\) => myVaultKey\(\)/);
  assert.match(read('recall-host.js'), /if \(ctx\.vaultKey\) return ctx\.vaultKey\(\);/);
  // (Third review, R3-6: and no record the server pushes sets your own keys.)
  const setUserFn = app.slice(app.indexOf('function setUser(u)'), app.indexOf('function getUser(id)'));
  assert.match(setUserFn, /OWN_KEYS\.forEach\(\(k\) => \{ delete mine\[k\]; \}\)/);
  assert.match(app, /const OWN_KEYS = \['publicKey', 'signPublicKey', 'pqPublicKey', 'pqSig'\];/);
  // Review 9: in the layout above the message box, with "Later" for this tab; nothing fixed over the page.
  const bar = app.slice(app.indexOf('function pqNotice('), app.indexOf('async function unlockPq()'));
  assert.match(bar, /'Later'/);
  assert.match(bar, /class: 'key-bar pq-bar'/);
  assert.match(app, /sessionStorage\.setItem\('hearth\.pqLater', '1'\)/);
  assert.doesNotMatch(app, /id: 'pq-unlock'[^\n]*document\.body\.append/);
  assert.doesNotMatch(app.slice(app.indexOf('function pqUnlockBar('), app.indexOf('function pqUnlockBar(') + 400), /announce/);
});

// ======================================================================= the fixes' own review
const shown = (msgs) => msgs.map((m) => (m.dec.error ? '(error)' : m.dec.t));
async function acceptedOnce(base) {
  const { a, b, dm, aD } = await twoWithPq(base);
  assert.match(await sendDm(aD, dm.id, 'e1'), /^d3:/);
  const bNew = await resetNew(b);
  const bN = await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD);
  assert.equal(aD.sec.acceptKeys(await fresh(aD, b.id)), true);
  await sleep(20);
  await fresh(bN, a.id);
  assert.match(await sendDm(aD, dm.id, 'e2 from a'), /^d3:/);
  assert.match(await sendDm(bN, dm.id, 'e2 from b'), /^d3:/);
  return { a, b, dm, aD, bNew, bN };
}

test('third review 1: an earlier accepted key change refuses nothing written after it (a post-quantum key replaced, a second reset, a failed lookup)', async () => {
  // b's post-quantum key alone is replaced later (same identity key).
  {
    const { a, b, dm, aD, bNew, bN } = await acceptedOnce('r3e');
    use(bN);
    bN.S.pqSeed = null;
    await bN.sec.ensurePqKey({ ...(await passwordCtx(bNew)), pqSeed: null });
    const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
    await fresh(aR, b.id);
    assert.deepEqual(shown(await readDms(aR, dm.id)), ['e1', 'e2 from a', 'e2 from b']);
    assert.match(await sendDm(aR, dm.id, 'e3'), /^d3:/);
  }
  // b resets a second time; a hasn't compared numbers yet.
  {
    const { a, b, dm, aD, bNew } = await acceptedOnce('r3a');
    await sleep(20);
    const bNew2 = await resetNew(bNew);
    await device(bNew2, { ctx: await passwordCtx(bNew2) });
    const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
    await fresh(aR, b.id);
    assert.deepEqual(shown(await readDms(aR, dm.id)), ['e1', 'e2 from a', 'e2 from b']);
  }
  // A reload while the server can't answer for b's post-quantum key.
  {
    const { a, b, dm, aD } = await acceptedOnce('r3b');
    const f = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => (String(url).endsWith(`/users/${b.id}/pq-key`) ? new Response('{"error":"busy"}', { status: 503, headers: { 'content-type': 'application/json' } }) : f(url, opts));
    try {
      const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
      await fresh(aR, b.id);
      assert.deepEqual(shown(await readDms(aR, dm.id)), ['e1', 'e2 from a', 'e2 from b']);
    } finally { globalThis.fetch = f; }
  }
});

test('third review 2: a member’s app can’t leave members with a post-quantum key out of a new server key', async () => {
  const owner = await person(uname('r3do'));
  const evil = await person(uname('r3de'));
  const m2 = await person(uname('r3dm'));
  const m3 = await person(uname('r3dx'));
  const s = (await as(owner, 'POST', '/servers', { name: 'r3d' })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [evil, m2, m3]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  const eD = await device(evil, { ctx: await passwordCtx(evil) });
  await device(m2, { ctx: await passwordCtx(m2) });
  const oD = await device(owner, { ctx: await passwordCtx(owner) });
  use(oD);
  const e1 = (await oD.sec.encryptChannel(s.id, ch, { t: 'one' })).epoch;
  assert.equal((await as(m3, 'POST', `/servers/${s.id}/leave`)).status, 200);
  use(eD);
  const raw = E.newGroupKey();
  const epoch = e1 + 1;
  const wraps = { [evil.id]: await E.wrapGroupKey({ raw, serverId: s.id, epoch, recipientId: evil.id, recipientPub: evil.publicKey, recipientPq: E.pqKeyPair(eD.S.pqSeed).publicKey, wrapperId: evil.id, signKey: eD.S.signKey }) };
  const r = await as(evil, 'POST', `/servers/${s.id}/keys/rotate`, { epoch, check: await E.keyCheck(raw, s.id, epoch), wraps, pubs: { [evil.id]: evil.publicKey }, pqs: {}, deferred: [owner.id, m2.id] });
  assert.equal(r.status, 409);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM server_keys WHERE server_id = ? AND epoch = ?', s.id, epoch)[0].n, 0);
});

test('third review 3: a device without the seed that the server shows no sign of the key still knows the account has one', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3c');
  assert.match(await sendDm(aD, dm.id, 'pq'), /^d3:/);
  const s = (await as(a, 'POST', '/servers', { name: 'r3c' })).json;
  const ch = s.channels.find((c) => c.type === 'text').id;
  await refreshServers(aD);
  use(aD);
  await aD.sec.encryptChannel(s.id, ch, { t: 'hello' });
  const carol = await person(uname('r3cc'));
  await device(carol, { ctx: await passwordCtx(carol) });
  await friends(a, carol);
  const dmC = await dmBetween(a, carol);
  const strip = (boot) => { boot.me = { ...boot.me, pqPublicKey: null, pqSig: null }; if (boot.users[a.id]) boot.users[a.id] = { ...boot.users[a.id], pq: null }; };
  const laptop = await device(a, { edit: strip });
  assert.equal(laptop.sec.waitingForPq(s.id), true);
  assert.equal(laptop.sec.neededPassword(), 'seed', 'a hybrid copy for you says the account has a key');
  let body = null;
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { if (String(url).endsWith(`/servers/${s.id}/keys/rotate`)) body = JSON.parse(opts.body); return f(url, opts); };
  use(laptop);
  try { await assert.rejects(() => laptop.sec.forceRotate(s.id)); } finally { globalThis.fetch = f; }
  assert.equal(body, null, 'no rotation was even tried');
  await fresh(laptop, carol.id);
  laptop.S.users[a.id] = { ...laptop.S.users[a.id], pq: null };
  use(laptop);
  await assert.rejects(() => laptop.sec.encryptDm(dmC.id, { t: 'to carol' }), (e) => e.code === 'need_password');
});

test('third review 6: a scheduled DM in an epoch made for a post-quantum key they no longer have is held for re-encrypting', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3s');
  use(aD);
  await refreshDms(aD);
  const ciphertext = await aD.sec.encryptDm(dm.id, { t: 'later' });
  assert.match(ciphertext, /^d3:/);
  const r = await as(a, 'POST', `/dms/${dm.id}/scheduled-messages`, { ciphertext, ref: H.hex(12), draft: `x1:${H.b64(48)}`, sendAt: Date.now() + 3600000 });
  assert.equal(r.status, 200, r.text);
  assert.equal((await as(a, 'GET', '/scheduled-messages')).json.items.find((x) => x.id === r.json.id).status, 'pending');
  const other = E.pqKeyPair(E.newPqSeed ? E.newPqSeed() : crypto.getRandomValues(new Uint8Array(64))).publicKey;
  srv.sql('UPDATE users SET pq_public_key = ? WHERE id = ?', other, b.id);
  const it = (await as(a, 'GET', '/scheduled-messages')).json.items.find((x) => x.id === r.json.id);
  assert.equal(it.status, 'held');
  assert.equal(it.reason, 'pq');
});

// ======================================================================= third review (docs/PQ-REVIEW-FINDINGS-3.md)
// DMs no longer have epochs: each d3 message carries its own key, and how far it's trusted is decided as for d2, from
// this device's pins and the message's own date, never from anything the server lists about it.
const countRequests = (match) => {
  const f = globalThis.fetch;
  const seen = [];
  globalThis.fetch = (url, opts = {}) => { if (match(String(url), opts.method || 'GET')) seen.push(String(url)); return f(url, opts); };
  return { seen, undo: () => { globalThis.fetch = f; } };
};

test('third review R3-3 and R3-7: the cutoff for someone’s old key is this device’s own time, whatever retiredAt the server lists', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3g');
  const stolen = thief(b, (await passwordCtx(b)).pqSeed);
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:/);
  const bNew = await resetNew(b);
  await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD);
  // When a compares numbers, the server lists b's old key as retired long before anything was written.
  const u = await fresh(aD, b.id);
  assert.equal(aD.sec.acceptKeys({ ...u, pastKeys: [{ publicKey: b.publicKey, signPublicKey: b.signPublicKey, retiredAt: 1 }] }), true);
  const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
  await fresh(aR, b.id);
  assert.equal((await forgedD3(aR, { dmId: dm.id, by: stolen, t: 'forged as b, dated now' })).error, true);
  assert.equal((await forgedD3(aR, { dmId: dm.id, by: stolen, authorId: a.id, t: 'forged as a' })).error, true);
  assert.deepEqual(texts(await readDms(aR, dm.id)), ['one']);
});

test('third review R3-5: their record held back doesn’t lift the cutoff: nothing opens without it', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3h');
  const stolen = thief(b, (await passwordCtx(b)).pqSeed);
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:/);
  const bNew = await resetNew(b);
  await device(bNew, { ctx: await passwordCtx(bNew) });
  use(aD);
  assert.equal(aD.sec.acceptKeys(await fresh(aD, b.id)), true);
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).endsWith(`/users/${b.id}`) ? new Response('{"error":"busy"}', { status: 503, headers: { 'content-type': 'application/json' } }) : f(url, opts));
  try {
    const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins, edit: (boot) => { delete boot.users[b.id]; } });
    const dec = await forgedD3(aR, { dmId: dm.id, by: stolen, t: 'forged, record held back' });
    assert.equal(dec.error, true);
  } finally { globalThis.fetch = f; }
});

test('third review R3-6: a new account’s signing key is locked to its own identity key, whatever record the server pushes meanwhile', async () => {
  const n = await person(uname('r3k'), { sign: false });
  const evil = await E.createIdentity(n.wrapKey);
  store = new Map(); curIp = n.ip; API.setToken(n.token);
  const boot = (await as(n, 'GET', '/bootstrap')).json;
  const S = { me: boot.me, users: boot.users, servers: boot.servers, dms: boot.dms, privateKey: n.privateKey, pqSeed: null };
  const sec = createSecure({ S });
  // A self user:update with the server's key while the app works, and the real one back before it signs.
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { if (String(url).endsWith('/me/sign-key/challenge')) S.me = { ...S.me, publicKey: n.publicKey }; return f(url, opts); };
  let r;
  try {
    const going = sec.ensureSigningKey(null);
    S.me = { ...S.me, publicKey: evil.publicKey };
    r = await going.then(() => 'done', (e) => e.code || e.message);
  } finally { globalThis.fetch = f; }
  const stored = srv.sql('SELECT enc_sign_private_key FROM users WHERE id = ?', n.id)[0].enc_sign_private_key;
  if (stored) {
    assert.ok(await E.unwrapSigningKey(n.privateKey, n.publicKey, stored).then(() => true, () => false), 'locked to the real key');
    assert.ok(await E.unwrapSigningKey(evil.privateKey, n.publicKey, stored).then(() => false, () => true), 'not to the server’s');
  } else assert.equal(r, 'own_key_mismatch');
});

test('third review R3-8: a device without the seed takes any d3 message as a sign the account has a key; a refused publish leaves it read-only', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3i');
  assert.match(await sendDm(aD, dm.id, 'pq'), /^d3:/);
  const carol = await person(uname('r3ic'));
  await device(carol, { ctx: await passwordCtx(carol) });
  await friends(a, carol);
  const dmC = await dmBetween(a, carol);
  const strip = (boot) => { boot.me = { ...boot.me, pqPublicKey: null, pqSig: null }; if (boot.users[a.id]) boot.users[a.id] = { ...boot.users[a.id], pq: null }; };
  // (When DMs had epochs the server could list none, too: GET /dms/:id/keys, which no longer exists.)
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).endsWith(`/dms/${dm.id}/keys`) ? new Response('{"epochs":[]}', { status: 200, headers: { 'content-type': 'application/json' } }) : f0(url, opts));
  const laptop = await device(a, { edit: strip });
  await fresh(laptop, b.id); await fresh(laptop, carol.id);
  laptop.S.users[a.id] = { ...laptop.S.users[a.id], pq: null };
  try { assert.deepEqual(texts(await readDms(laptop, dm.id)), ['(waiting)']); } finally { globalThis.fetch = f0; }
  use(laptop);
  await assert.rejects(() => laptop.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'need_password');
  await assert.rejects(() => laptop.sec.encryptDm(dmC.id, { t: 'x' }), (e) => e.code === 'need_password');
  // The password entered there, the server refusing the publish (it lists nothing for the account): the envelope's
  // seed is kept, so the device is read-only, never P-256 alone.
  const d2 = await device(a, { edit: strip, pins: laptop.pins });
  const undo = failPost('/me/pq-key');
  try { use(d2); await d2.sec.ensurePqKey(await passwordCtx(a)); } finally { undo(); }
  assert.ok(d2.S.pqSeed instanceof Uint8Array);
  assert.ok(d2.sec.neededPassword());
  await fresh(d2, carol.id);
  d2.S.users[a.id] = { ...d2.S.users[a.id], pq: null };
  use(d2);
  await assert.rejects(() => d2.sec.encryptDm(dmC.id, { t: 'x' }), (e) => e.code === 'need_password');
});

test('third review R3-9: the upgrade landing while server keys are opened doesn’t re-lock a copy the old recovery key can open', async () => {
  const o = await person(uname('r3jo'));
  const v = await person(uname('r3jv'), { legacy: true });
  const rec = E.newRecoveryCode();
  const recSalt = E.newKdfSalt();
  const env0 = (await as(v, 'POST', '/me/keys/wrapped', { authKey: v.authKey })).json.encPrivateKey;
  assert.equal((await as(v, 'PUT', '/me/recovery', { encPrivateKeyRecovery: await E.rewrapPrivateKey(v.wrapKey, await E.recoveryWrapKey(rec, recSalt), env0), recoverySalt: recSalt, authKey: v.authKey })).status, 200);
  const s = (await as(o, 'POST', '/servers', { name: 'r3j' })).json;
  const code = (await as(o, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  assert.equal((await as(v, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  const oD = await device(o, { ctx: await passwordCtx(o) });
  use(oD);
  const { epoch } = await oD.sec.encryptChannel(s.id, ch, { t: 'before the upgrade' });
  const copy = () => srv.sql('SELECT wrapped, wrapper_id FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, v.id, epoch)[0];
  assert.equal(E.wrapFormat(copy().wrapped), 'w1');
  // v's upgrade sign-in, with the publish answered only after the server keys were opened.
  const ctx = await passwordCtx(v);
  store = new Map(); curIp = v.ip; API.setToken(v.token);
  const boot = (await as(v, 'GET', '/bootstrap')).json;
  const S = { me: boot.me, users: boot.users, servers: boot.servers, dms: boot.dms, privateKey: v.privateKey, pqSeed: null };
  const sec = createSecure({ S });
  await sec.ensureSigningKey(boot.encSignPrivateKey);
  // The publish lands just after the server keys started opening (here: while o's record is fetched, which comes after
  // the app has looked at what it may keep), and before they're done.
  let snapTaken;
  const snap = new Promise((r) => { snapTaken = r; setTimeout(r, 3000); });
  let published;
  const pubDone = new Promise((r) => { published = r; });
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/me/pq-key') && opts.method === 'POST') { await snap; const r = await f(url, opts); published(); return r; }
    if (u.endsWith(`/users/${o.id}`) && (!opts.method || opts.method === 'GET')) { snapTaken(); await pubDone; await sleep(30); }
    return f(url, opts);
  };
  delete S.users[o.id];
  try {
    const up = sec.ensurePqKey(ctx);
    const applied = Promise.all(Object.values(boot.keyStates || {}).map((st) => sec.applyState(st)));
    await up; await applied;
    await sleep(50);
    await sec.keysSaved(s.id);
  } finally { globalThis.fetch = f; }
  assert.ok(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', v.id)[0].pq_public_key, 'upgraded');
  assert.equal(E.wrapFormat(copy().wrapped), 'w1', 'still the copy the old recovery key can open');
});

test('third review R3-10 and R3-12: a restore from an older backup with apps left open: what they write next reads everywhere', async () => {
  const { a, b, dm, aD, bD } = await twoWithPq('r3l');
  assert.match(await sendDm(aD, dm.id, 'before the backup'), /^d3:/);
  const backup = srv.sql('SELECT id FROM dm_messages WHERE dm_id = ?', dm.id).map((r) => r.id);
  assert.match(await sendDm(bD, dm.id, 'after the backup'), /^d3:/);
  // The restore: everything since the backup is gone from the server (an older version kept DM epoch keys too).
  srv.sql(`DELETE FROM dm_messages WHERE dm_id = ? AND id NOT IN (${backup.map(() => '?').join(',')})`, dm.id, ...backup);
  try { srv.sql('DELETE FROM dm_keys WHERE dm_id = ?', dm.id); } catch { /* none here */ }
  // The open apps go on writing.
  assert.match(await sendDm(aD, dm.id, 'a, after the restore'), /^d3:/);
  assert.match(await sendDm(bD, dm.id, 'b, after the restore'), /^d3:/);
  const bR = await device(b, { ctx: await passwordCtx(b), pins: bD.pins });
  await fresh(bR, a.id);
  assert.deepEqual(texts(await readDms(bR, dm.id)), ['before the backup', 'a, after the restore', 'b, after the restore']);
  const aR = await device(a, { ctx: await passwordCtx(a), pins: aD.pins });
  await fresh(aR, b.id);
  assert.deepEqual(texts(await readDms(aR, dm.id)), ['before the backup', 'a, after the restore', 'b, after the restore']);
});

test('third review R3-13: a member left out of a rotation is given that key once theirs is back, so no epoch is lost to them', async () => {
  const owner = await person(uname('r3mo'));
  const m1 = await person(uname('r3mm'));
  const m2 = await person(uname('r3ml'));
  const s = (await as(owner, 'POST', '/servers', { name: 'r3m' })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [m1, m2]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  const ch = s.channels.find((c) => c.type === 'text').id;
  await device(m1, { ctx: await passwordCtx(m1) });
  const oD = await device(owner, { ctx: await passwordCtx(owner) });
  use(oD);
  const e1 = (await oD.sec.encryptChannel(s.id, ch, { t: 'one' })).epoch;
  assert.ok(await oD.sec.pqKeyOf(await fresh(oD, m1.id)));
  const pqRow = srv.sql('SELECT pq_public_key, pq_sig FROM users WHERE id = ?', m1.id)[0];
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', m1.id);
  assert.equal((await as(m2, 'POST', `/servers/${s.id}/leave`)).status, 200);
  await fresh(oD, m1.id);
  await refreshServers(oD);
  const sent = await oD.sec.encryptChannel(s.id, ch, { t: 'while m1 was left out' });
  assert.ok(sent.epoch > e1);
  assert.equal((await as(owner, 'POST', `/channels/${ch}/messages`, { ciphertext: sent.ciphertext, epoch: sent.epoch })).status, 200);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM key_owed WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, sent.epoch)[0].n, 1, 'owed');
  // Before m1's key is back, the server rotates again (a member leaves): that one goes to m1 as usual later.
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', pqRow.pq_public_key, pqRow.pq_sig, m1.id);
  srv.sql('UPDATE servers SET needs_rotation = 1 WHERE id = ?', s.id);
  await fresh(oD, m1.id);
  await refreshServers(oD);
  const later = await oD.sec.encryptChannel(s.id, ch, { t: 'next key' });
  assert.ok(later.epoch > sent.epoch);
  // The owed (older) key goes to m1 too, from the owner's app, hybrid.
  await refreshServers(oD);
  oD.sec.maintain(s.id);
  assert.ok(await until(() => srv.sql('SELECT 1 FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, sent.epoch).length > 0), 'the owed key was shared');
  assert.equal(E.wrapFormat(srv.sql('SELECT wrapped FROM server_keys WHERE server_id = ? AND user_id = ? AND epoch = ?', s.id, m1.id, sent.epoch)[0].wrapped), 'w2');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM key_owed WHERE server_id = ? AND user_id = ?', s.id, m1.id)[0].n, 0, 'no longer owed');
  const mD = await device(m1, { ctx: await passwordCtx(m1) });
  use(mD);
  await mD.sec.refresh(s.id);
  const msg = (await as(m1, 'GET', `/channels/${ch}/messages`)).json.messages.find((x) => x.epoch === sent.epoch);
  await mD.sec.decryptChannelMessage(msg);
  assert.equal(msg.dec.t, 'while m1 was left out');
  // Nobody can share an older key with someone it isn't owed to.
  assert.equal((await as(owner, 'POST', `/servers/${s.id}/keys/share`, { epoch: e1, wraps: {}, pubs: {}, pqs: {} })).status, 409);
});

test('third review R3-14: no limit on how many DMs a new conversation or a new week starts (there are no epochs to make)', async () => {
  const { dm, aD } = await twoWithPq('r3n');
  const realNow = Date.now;
  try {
    for (let i = 0; i < 31; i++) {
      Date.now = () => realNow() + i * 8 * 86400000; // (each in a new week, as epochs went)
      if (i === 20) await new Promise((r) => setTimeout(r, 10500)); // (the server's 25 messages per 10 s)
      assert.match(await sendDm(aD, dm.id, `week ${i}`), /^d3:/);
    }
  } finally { Date.now = realNow; }
});

test('third review R3-15 and R3-17: reading d3 messages costs no extra requests, and a failed key lookup marks nothing', async () => {
  const { a, b, dm, aD } = await twoWithPq('r3o');
  for (let i = 0; i < 3; i++) assert.match(await sendDm(aD, dm.id, `m${i}`), /^d3:/);
  const bR = await device(b, { ctx: await passwordCtx(b) });
  const c = countRequests((url) => /\/dms\/[^/]+\/keys$|\/users\/[^/]+\/pq-key$|\/users\/pq-keys$/.test(url));
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).endsWith(`/users/${a.id}/pq-key`) ? new Response('{"error":"busy"}', { status: 503, headers: { 'content-type': 'application/json' } }) : f(url, opts));
  try {
    const msgs = await readDms(bR, dm.id);
    assert.deepEqual(texts(msgs), ['m0', 'm1', 'm2']);
    assert.ok(msgs.every((m) => !m.dec.keyNote), 'no "older key" note');
  } finally { globalThis.fetch = f; c.undo(); }
  assert.deepEqual(c.seen, []);
});

test('third review R3-16: a slow clock on the device that wrote first post-quantum doesn’t flag the honest messages just before', async () => {
  const alice = await person(uname('r3p'), { legacy: true });
  const bob = await person(uname('r3p'));
  await friends(alice, bob);
  const dm = await dmBetween(alice, bob);
  const bobD = await device(bob, { ctx: await passwordCtx(bob) });
  const aliceD = await device(alice);
  await fresh(aliceD, bob.id);
  assert.match(await sendDm(aliceD, dm.id, 'alice before (d2)'), /^d2:/);
  await fresh(bobD, alice.id);
  assert.match(await sendDm(bobD, dm.id, 'bob before (d2)'), /^d2:/);
  // Alice signs in with her password on a laptop whose clock is five minutes slow, and writes.
  const laptop = await device(alice, { ctx: await passwordCtx(alice) });
  await fresh(laptop, bob.id); await fresh(bobD, alice.id);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 5 * 60000;
    assert.match(await sendDm(laptop, dm.id, 'alice, post-quantum'), /^d3:/);
  } finally { Date.now = realNow; }
  const flagged = (msgs) => msgs.filter((m) => m.dec.noPq).map((m) => m.dec.t);
  assert.deepEqual(flagged(await readDms(bobD, dm.id)), []);
  assert.deepEqual(flagged(await readDms(laptop, dm.id)), []);
});

test('third review R3-18 and R3-11: the password entered in one tab reaches the browser’s other tabs', async () => {
  const { a, b, dm } = await twoWithPq('r3q'); // (a's key is published by another device)
  const undoIdb = fakeIdb(); // (this browser's)
  try {
    const pins = new Map();
    const tabB = await device(a, { pins });
    assert.equal(tabB.sec.neededPassword(), 'seed');
    const tabA = await device(a, { pins, ctx: await passwordCtx(a) });
    assert.equal(tabA.sec.neededPassword(), null);
    await sleep(20); // (the seed is stored)
    await fresh(tabB, b.id);
    assert.match(await sendDm(tabB, dm.id, 'from tab B'), /^d3:/);
    assert.equal(tabB.sec.neededPassword(), null);
    assert.equal(pins.has(`hearth.pqseed.${a.id}`), true, 'the other tabs are told');
  } finally { undoIdb(); }
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /e\.key === `hearth\.pqseed\.\$\{S\.me\.id\}`\) sec\.ensurePqKey\(\)/);
});

test('third review R3-19: after a restore that lost the published key, the password publishes the seed devices already hold', async () => {
  const o = await person(uname('r3r'), { legacy: true });
  const env0 = (await as(o, 'POST', '/me/keys/wrapped', { authKey: o.authKey })).json.encPrivateKey; // (the backup's)
  const d1 = await device(o, { ctx: await passwordCtx(o) });
  const pk = srv.sql('SELECT pq_public_key FROM users WHERE id = ?', o.id)[0].pq_public_key;
  const d2 = await device(o, { ctx: await passwordCtx(o) });
  assert.equal(E.pqKeyPair(d2.S.pqSeed).publicKey, pk);
  // The restore: the account's row as it was, with no post-quantum key and an envelope without the seed.
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL, enc_private_key = ? WHERE id = ?', env0, o.id);
  const again = await device(o, { ctx: await passwordCtx(o), pins: d1.pins, pqSeed: d1.S.pqSeed });
  assert.equal(again.sec.neededPassword(), null);
  assert.equal(srv.sql('SELECT pq_public_key FROM users WHERE id = ?', o.id)[0].pq_public_key, pk, 'the same key, published again');
  assert.equal(E.pqKeyPair((await passwordCtx(o)).pqSeed).publicKey, pk, 'and back in the envelope');
  const d2b = await device(o, { pins: d2.pins, pqSeed: d2.S.pqSeed });
  assert.equal(d2b.sec.neededPassword(), null, 'the other device keeps its seed');
});

test('third review R3-20 and R3-21: a locked message has its own "Enter password"; the account check names the password, not a handoff', () => {
  const read = (f) => require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const app = read('app.js');
  const locked = app.slice(app.indexOf("Locked to your account\\u2019s post-quantum key"), app.indexOf("Locked to your account\\u2019s post-quantum key") + 400);
  assert.match(locked, /onclick: \(\) => unlockPq\(\)/);
  assert.match(locked, /'Enter password'/);
  assert.doesNotMatch(read('selftest.js'), /another of your devices/);
  assert.doesNotMatch(read('secure.js'), /hand it over\)/);
});
