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
async function person(name, { legacy = false } = {}) {
  const kdfSalt = E.newKdfSalt();
  const { authKey, wrapKey } = await E.deriveKeys(name, `pw-${name}`, { kdf: 'argon2id', salt: kdfSalt });
  const id = legacy ? await legacyIdentity(wrapKey) : await E.createIdentity(wrapKey);
  const ip = H.newIp();
  const r = await srv.api('POST', '/auth/register', { ip, body: { username: name, authKey, kdfSalt, publicKey: id.publicKey, encPrivateKey: id.encPrivateKey, acceptTos: srv.config.termsVersion || undefined } });
  assert.equal(r.status, 200, r.text);
  const p = { username: name, ip, authKey, wrapKey, kdfSalt, token: r.json.token, id: r.json.user.id, ...id };
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
async function device(user, { pins = new Map(), pqSeed = null, ctx = null, token = user.token } = {}) {
  store = pins; curIp = user.ip; API.setToken(token);
  const boot = (await as({ ...user, token }, 'GET', '/bootstrap')).json;
  const dmEvents = [];
  const S = { me: boot.me, users: boot.users, servers: boot.servers, dms: boot.dms, privateKey: user.privateKey, e2eeSince: boot.e2eeSince, pqSeed: ctx && ctx.pqSeed ? ctx.pqSeed : pqSeed };
  const sec = createSecure({ S, onDmKeys: (id) => dmEvents.push(id) });
  await sec.ensureSigningKey(boot.encSignPrivateKey);
  await sec.ensurePqKey(ctx);
  Object.values(S.users).forEach((u) => sec.trust(u));
  for (const st of Object.values(boot.keyStates || {})) await sec.applyState(st);
  for (const s of S.servers) await sec.keysSaved(s.id);
  return { sec, S, pins, boot, dmEvents, token, user };
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
  const ciphertext = await d.sec.encryptDm(dmId, { t });
  const r = await as({ ...d.user, token: d.token }, 'POST', `/dms/${dmId}/messages`, { ciphertext });
  assert.equal(r.status, 200, r.text);
  return ciphertext;
}
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

  // From now on: hybrid both ways, in one epoch, and the old messages still open.
  await fresh(bobD, alice.id);
  const a2 = await sendDm(aliceD2, dm.id, 'hybrid from alice');
  const b2 = await sendDm(bobD, dm.id, 'hybrid from bob');
  assert.match(a2, /^d3:1:/); assert.match(b2, /^d3:1:/);
  const epochs = srv.sql('SELECT epoch, user_id, wrapped, wrapper_id FROM dm_keys WHERE dm_id = ? ORDER BY user_id', dm.id);
  assert.equal(epochs.length, 2, 'one copy each');
  assert.ok(epochs.every((e) => e.epoch === 1 && /^dk1:/.test(e.wrapped) && e.wrapper_id === alice.id));
  const want = ['from the old account', 'from the new account', 'hybrid from alice', 'hybrid from bob'];
  assert.deepEqual(texts(await readDms(bobD, dm.id)), want);
  assert.deepEqual(texts(await readDms(aliceD2, dm.id)), want);
  // A brand new device of Bob's (signed in with the password) reads the whole history too.
  const bobD3 = await device(bob, { ctx: await passwordCtx(bob) });
  assert.deepEqual(texts(await readDms(bobD3, dm.id)), want);

  // Alice's device that was signed in all along: it waits for the seed, then reads, without her password.
  const aliceOld = await device(alice, { pins: aliceD.pins, token: alice.token });
  assert.equal(aliceOld.S.pqSeed, null);
  assert.deepEqual(texts(await readDms(aliceOld, dm.id)), ['from the old account', 'from the new account', '(waiting)', '(waiting)']);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM pq_handoffs WHERE user_id = ? AND sealed IS NULL', alice.id)[0].n, 1, 'it asked');
  use(aliceD2); await aliceD2.sec.onHandoff(); // (the pq:handoff event)
  await until(async () => !!srv.sql('SELECT sealed FROM pq_handoffs WHERE user_id = ?', alice.id)[0]?.sealed);
  use(aliceOld); aliceOld.sec.onHandoff();
  assert.ok(await until(() => aliceOld.S.pqSeed instanceof Uint8Array), 'the seed arrived');
  assert.deepEqual(Buffer.from(aliceOld.S.pqSeed), Buffer.from(aliceD2.S.pqSeed));
  assert.ok(aliceOld.dmEvents.includes(null), 'the app is told to open what waited');
  assert.deepEqual(texts(await readDms(aliceOld, dm.id)), want);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM pq_handoffs WHERE user_id = ?', alice.id)[0].n, 0, 'cleaned up');
  // It can write hybrid too.
  assert.match(await sendDm(aliceOld, dm.id, 'from the old device'), /^d3:1:/);
  assert.deepEqual(texts(await readDms(bobD, dm.id)).slice(-1), ['from the old device']);

  // Downgrade: a server that stops listing Alice's post-quantum key gets nothing encrypted to her, not P-256 alone.
  srv.sql('UPDATE users SET pq_public_key = NULL, pq_sig = NULL WHERE id = ?', alice.id);
  await fresh(bobD, alice.id);
  use(bobD);
  await assert.rejects(() => bobD.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'untrusted' && /stopped listing/.test(e.message));
  // Nor one that swaps in a post-quantum key of its own (it can't sign it as Alice).
  const mallory = E.pqKeyPair(E.newPqSeed()).publicKey;
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', mallory, row.pq_sig, alice.id);
  await fresh(bobD, alice.id);
  await assert.rejects(() => bobD.sec.encryptDm(dm.id, { t: 'x' }), (e) => e.code === 'untrusted' && /didn’t check out/.test(e.message));
  srv.sql('UPDATE users SET pq_public_key = ?, pq_sig = ? WHERE id = ?', row.pq_public_key, row.pq_sig, alice.id);
  await fresh(bobD, alice.id);
  assert.match(await sendDm(bobD, dm.id, 'back to normal'), /^d3:/);
});

test('DM epochs: a new one once the week is up, one at a time, only as the server checks them; old epochs keep opening', async () => {
  const a = await person(uname('pqep'));
  const b = await person(uname('pqep'));
  await friends(a, b);
  const dm = await dmBetween(a, b);
  const aD = await device(a, { ctx: await passwordCtx(a) });
  const bD = await device(b, { ctx: await passwordCtx(b) });
  await fresh(aD, b.id); await fresh(bD, a.id);
  assert.match(await sendDm(aD, dm.id, 'one'), /^d3:1:/);
  assert.match(await sendDm(bD, dm.id, 'two'), /^d3:1:/);
  // A week later: the next message starts epoch 2.
  srv.sql('UPDATE dm_keys SET created_at = created_at - ? WHERE dm_id = ?', 8 * 24 * 3600 * 1000, dm.id);
  bD.sec.dmKeysChanged(dm.id);
  assert.match(await sendDm(bD, dm.id, 'three'), /^d3:2:/);
  // Both started the same new epoch at once: one wins, the other uses it.
  assert.deepEqual(texts(await readDms(aD, dm.id)), ['one', 'two', 'three']);
  assert.match(await sendDm(aD, dm.id, 'four'), /^d3:2:/);
  // The server only takes the next epoch, in the right format, for these two and their keys as they are now.
  const w = (await as(a, 'GET', `/dms/${dm.id}/keys`)).json.epochs[1];
  assert.equal((await as(a, 'POST', `/dms/${dm.id}/keys`, { epoch: 2, wraps: { [a.id]: w.wrapped, [b.id]: w.wrapped }, pubs: w.keys })).status, 409, 'epoch taken');
  assert.equal((await as(a, 'POST', `/dms/${dm.id}/keys`, { epoch: 3, wraps: { [a.id]: 'dk1:junk', [b.id]: w.wrapped }, pubs: w.keys })).status, 400);
  const stale = { ...w.keys, [b.id]: { ...w.keys[b.id], pq: 'AAAAAAAAAAAAAAAAAAAAAA==' } };
  assert.equal((await as(a, 'POST', `/dms/${dm.id}/keys`, { epoch: 3, wraps: { [a.id]: w.wrapped, [b.id]: w.wrapped }, pubs: stale })).status, 409);
  const outsider = await person(uname('pqout'));
  assert.equal((await as(outsider, 'GET', `/dms/${dm.id}/keys`)).status, 404);
  assert.deepEqual(texts(await readDms(bD, dm.id)), ['one', 'two', 'three', 'four']);

  // The server plants an epoch "from b", made with a key it lists as one of b's past keys (its own): a's app reads
  // what's in it only as "older key, not verified", and never writes in it.
  const fake = await E.createIdentity(a.wrapKey);
  const t0 = Date.now();
  srv.sql('INSERT INTO user_key_history (user_id, public_key, sign_public_key, retired_at) VALUES (?, ?, NULL, ?)', b.id, fake.publicKey, t0 - 60000);
  const rowOf = (id) => srv.sql('SELECT public_key, pq_public_key FROM users WHERE id = ?', id)[0];
  const planted = E.newDmKey();
  for (const who of [a, b]) {
    const r = rowOf(who.id);
    const wrapped = await E.wrapDmKey({ raw: planted, dmId: dm.id, epoch: 3, recipientId: who.id, recipientPub: r.public_key, recipientPq: r.pq_public_key, senderId: b.id, myPriv: fake.privateKey, myPub: fake.publicKey });
    srv.sql('INSERT INTO dm_keys (dm_id, epoch, user_id, wrapped, wrapper_id, public_key, pq_public_key, created_at) VALUES (?, 3, ?, ?, ?, ?, ?, ?)', dm.id, who.id, wrapped, b.id, r.public_key, r.pq_public_key, t0 - 120000);
  }
  const forged = await E.encryptDm3({ raw: planted, epoch: 3, dmId: dm.id, authorId: b.id, payload: { t: 'planted' } });
  srv.sql('INSERT INTO dm_messages (id, dm_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)', `zz${H.hex(8)}`, dm.id, b.id, forged, t0 - 100000);
  aD.sec.dmKeysChanged(dm.id);
  await fresh(aD, b.id);
  const seen = (await readDms(aD, dm.id)).find((m) => m.dec.t === 'planted');
  assert.equal(seen && seen.dec.keyNote, 'listed', 'shown as not verified');
  assert.match(await sendDm(aD, dm.id, 'five'), /^d3:4:/, 'a new epoch, not the planted one');
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
  // Handoff requests must be signed by the account.
  const req = await E.pqHandoffRequest(other2.signKey, u.id);
  assert.equal((await as(u, 'POST', '/me/pq-handoff', { id: req.id, devicePk: req.devicePk, sig: req.sig })).status, 403);
  const ok = await E.pqHandoffRequest(u.signKey, u.id);
  assert.equal((await as(u, 'POST', '/me/pq-handoff', { id: ok.id, devicePk: ok.devicePk, sig: ok.sig })).status, 200);
  assert.equal((await as(other2, 'GET', '/me/pq-handoff')).json.requests.length, 0, 'only the account’s own');
  assert.equal((await as(u, 'POST', `/me/pq-handoff/${ok.id}`, { sealed: 'ph1:junk' })).status, 400);

  // A recovery key made since the account has its post-quantum key holds the seed; one from before is flagged.
  const env = (await as(u, 'POST', '/me/keys/wrapped', { authKey: u.authKey })).json.encPrivateKey;
  const recSalt = E.newKdfSalt();
  const encPrivateKeyRecovery = await E.rewrapPrivateKey(u.wrapKey, await E.recoveryWrapKey(E.newRecoveryCode(), recSalt), env);
  assert.equal((await as(u, 'PUT', '/me/recovery', { encPrivateKeyRecovery, recoverySalt: recSalt, authKey: u.authKey })).status, 200);
  const me = async () => (await as(u, 'GET', '/bootstrap')).json.me;
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
