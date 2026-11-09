// Server keys on a big server, without every open app doing the same work: the server names one online member's app to
// make the next key or hand the current one out (keyLead), the others step in only if that doesn't happen; a state that
// comes in while an app is already at it is looked at again afterwards; members are wrapped for several at a time
// (limit.js mapLimit), with the same result and the same failure as one at a time; and a post-quantum public key is
// checked (e2ee.js pqModulusOk) exactly as an encapsulation checks it. None of this changes who may make or share a
// key, or any check on one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const H = require('./helpers');

const js = (f) => pathToFileURL(path.join(__dirname, '..', 'public', f)).href;
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ mapLimit
test('mapLimit: results in the list’s order, never more than the limit at once, an empty list, a limit past the list', async () => {
  const { mapLimit } = await import(js('js/limit.js'));
  let running = 0; let most = 0;
  const out = await mapLimit([30, 5, 20, 1, 15, 2, 9, 4, 12, 7], 3, async (ms, i) => {
    running++; most = Math.max(most, running);
    await sleep(ms);
    running--;
    return `${i}:${ms}`;
  });
  assert.deepEqual(out, ['0:30', '1:5', '2:20', '3:1', '4:15', '5:2', '6:9', '7:4', '8:12', '9:7']);
  assert.equal(most, 3);
  assert.deepEqual(await mapLimit([], 8, async () => 1), []);
  assert.deepEqual(await mapLimit(new Set(['a', 'b']), 99, async (x) => x + x), ['aa', 'bb']);
  assert.deepEqual(await mapLimit([1, 2, 3], 0, async (x) => x * 2), [2, 4, 6], 'a limit below 1 runs them one at a time');
  assert.deepEqual(await mapLimit([1, 2], 2, (x) => x + 1), [2, 3], 'fn may answer without a promise');
});

test('mapLimit: on a failure no more are started, and it throws what the first item in the list to fail threw, as a loop would', async () => {
  const { mapLimit } = await import(js('js/limit.js'));
  // Item 4 fails first in time, item 2 later: a loop would have stopped at item 2.
  const started = [];
  const delays = [5, 5, 40, 5, 1, 5, 5, 5, 5, 5];
  await assert.rejects(mapLimit(delays, 4, async (ms, i) => {
    started.push(i);
    await sleep(ms);
    if (i === 2 || i === 4) throw new Error(`item ${i}`);
    return i;
  }), /item 2/);
  assert.ok(!started.includes(9), 'nothing more is started once one failed');
  // Everything before the one that failed ran, so the error is the one a loop would have met.
  for (const limit of [1, 2, 5, 16]) {
    const ran = [];
    await assert.rejects(mapLimit([0, 1, 2, 3, 4, 5], limit, async (i) => { ran.push(i); await sleep(i === 3 ? 1 : 10); if (i >= 3) throw new Error(`item ${i}`); }), /item 3/);
    for (const i of [0, 1, 2, 3]) assert.ok(ran.includes(i));
  }
  // A synchronous throw counts the same.
  await assert.rejects(mapLimit([1, 2, 3], 2, (x) => { if (x === 2) throw new Error('two'); return x; }), /two/);
});

// ------------------------------------------------------------------ the post-quantum key check
test('pqModulusOk: accepts exactly the public keys an encapsulation accepts (FIPS 203 7.2), and real keys', async () => {
  globalThis.window = globalThis.window || { crypto: globalThis.crypto, hashwasm: require('hash-wasm') };
  const E = await import(js('js/e2ee.js'));
  const { ml_kem768 } = await import(js('vendor/ml-kem.js'));
  let refused = 0;
  for (let n = 0; n < 600; n++) {
    const pk = ml_kem768.keygen(crypto.getRandomValues(new Uint8Array(64))).publicKey.slice();
    // Real keys, then one to three random bytes changed (in the numbers or in the 32-byte seed at the end).
    for (let j = 0; j < n % 4; j++) pk[crypto.randomInt(1184)] = crypto.randomInt(256);
    let accepted = true;
    try { ml_kem768.encapsulate(pk); } catch { accepted = false; }
    assert.equal(E.pqModulusOk(pk), accepted, `key ${n}`);
    if (!accepted) refused++;
    if (n % 4 === 0) assert.ok(accepted, 'a real key passes');
  }
  assert.ok(refused > 20, 'the changed keys include ones refused');
  // One number at q exactly, and at q - 1: refused and accepted, whichever half of its 3 bytes it's in.
  const pk = ml_kem768.keygen(new Uint8Array(64)).publicKey;
  for (const [i, q] of [[0, 3329], [1, 3329], [0, 3328], [1, 3328]]) {
    const k = pk.slice();
    if (i === 0) { k[0] = q & 0xff; k[1] = (k[1] & 0xf0) | (q >> 8); } else { k[1] = (k[1] & 0x0f) | ((q & 0x0f) << 4); k[2] = q >> 4; }
    let ok = true;
    try { ml_kem768.encapsulate(k); } catch { ok = false; }
    assert.equal(E.pqModulusOk(k), ok);
    assert.equal(ok, q < 3329);
  }
  assert.equal(E.pqModulusOk(pk.slice(0, 1183)), false, 'the wrong size');
  assert.equal(E.pqModulusOk(Array.from(pk)), false, 'not bytes');
  assert.equal(E.isPqPublicKey(Buffer.from(pk).toString('base64')), true);
});

test('static: the key check is still made for every key used, only no longer by a trial encapsulation', () => {
  const e2ee = src('public/js/e2ee.js');
  const fn = e2ee.slice(e2ee.indexOf('function pqPublicBytes'), e2ee.indexOf('export const isPqPublicKey'));
  assert.match(fn, /pqModulusOk\(bytes\)/);
  assert.doesNotMatch(fn, /encapsulate/);
  // Both wrapping to a key and checking a signed one go through it.
  assert.match(e2ee, /async function wrapGroupKey2[\s\S]{0,200}pqPublicBytes\(recipientPq\)/);
  assert.match(e2ee, /export async function verifyPqKey[\s\S]{0,120}isPqPublicKey\(pqPublicKey\)/);
});

// ------------------------------------------------------------------ the app: one at a time, looked at again
test('static: wrapFor checks each member as before, several at once; maintain looks again after a state it was busy for, and waits for the lead', () => {
  const s = src('public/js/secure.js');
  const wrapFor = s.slice(s.indexOf('async function wrapFor'), s.indexOf('const WRAP_AT_ONCE'));
  // Every check, in its old order, inside the one function each member goes through.
  const order = ['!u.publicKey', 'trust(u)', 'ownKeysOk()', 'pqKeyOf(u)', "e.code !== 'untrusted'", 'E2EE.wrapGroupKey('];
  let at = wrapFor.indexOf('mapLimit(users');
  assert.ok(at > 0);
  for (const step of order) { const i = wrapFor.indexOf(step, at); assert.ok(i > at, step); at = i; }
  assert.match(wrapFor, /S\.me\.publicKey !== pubs\[S\.me\.id\]\) throw ownKeysMismatch/);
  assert.match(s, /const WRAP_AT_ONCE = 8;/);
  const maintain = s.slice(s.indexOf('function maintain('), s.indexOf('function backUp('));
  assert.match(maintain, /if \(busy\.has\(serverId\)\) \{ again\.set\(serverId/);
  assert.match(maintain, /finally \{\s*busy\.delete\(serverId\);\s*if \(again\.has\(serverId\)\)/);
  assert.match(maintain, /const waitForLead = !late && !!st\.keyLead && st\.keyLead !== S\.me\.id;/);
  // Those waiting step in one after the other (the named backups in order, everyone else after them), not all at once.
  const backUp = s.slice(s.indexOf('function backUp('), s.indexOf('const mayMakeKey'));
  assert.match(maintain, /backUp\(serverId, rotateDue \? LEAD_WAIT : SHARE_WAIT\)/);
  assert.match(backUp, /Array\.isArray\(b\)/);
  assert.match(backUp, /rank \? wait \* rank : wait \* \(named\.length \+ 1\) \+ Math\.random\(\)/);
  // Owed keys (only the app that left someone out may hand them over) never wait for the lead.
  assert.doesNotMatch(maintain.slice(maintain.indexOf('const owed')), /waitForLead/);
  const ready = s.slice(s.indexOf('async function ready('), s.indexOf('async function refresh('));
  assert.doesNotMatch(ready, /keyLead|waitForLead/, 'someone about to send makes the key at once, as before');
  assert.match(ready, /busy\.delete\(serverId\);\s*if \(again\.has\(serverId\)\)/);
});

// ------------------------------------------------------------------ the server: who leads
let srv;
const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const b64 = (n) => crypto.randomBytes(n).toString('base64');
const fakeWrap = () => ['w1', b64(65), b64(12), b64(48), b64(64)].join(':');
const memberIds = (sid) => srv.sql('SELECT user_id FROM members WHERE server_id = ?', sid).map((r) => r.user_id);
const epochOf = (sid) => srv.sql('SELECT key_epoch FROM servers WHERE id = ?', sid)[0].key_epoch;
const sockets = [];
const connect = async (u) => { const s = await srv.socket(u.token); sockets.push(s); await sleep(50); return s; };
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 25) { if (await fn()) return true; await sleep(25); } return false; };
async function rotate(by, sid, epoch = epochOf(sid) + 1) {
  return as(by, 'POST', `/servers/${sid}/keys/rotate`, { epoch, check: b64(24), wraps: Object.fromEntries(memberIds(sid).map((id) => [id, fakeWrap()])) });
}
const stateOf = async (u, sid) => (await as(u, 'GET', `/servers/${sid}/keys`)).json;

before(async () => { srv = await H.startServer(); });
after(async () => { sockets.forEach((s) => s.close()); if (srv) await srv.stop(); });

test('keyLead: only when there’s work, only someone online who can do it, the key’s maker first, the same for everyone', async () => {
  const A = await srv.register(); const B = await srv.register(); const C = await srv.register(); const D = await srv.register();
  const s = (await as(A, 'POST', '/servers', { name: 'lead' })).json;
  const code = (await as(A, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [B, C]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  // No key yet and nobody online: nobody named, so any app that opens makes it at once, as before.
  assert.equal((await stateOf(A, s.id)).keyLead, undefined);
  const sockB = await connect(B);
  assert.equal((await stateOf(A, s.id)).keyLead, B.id, 'the one member online makes the first key');
  assert.equal((await rotate(B, s.id)).status, 200);
  // Everyone holds it: nothing to do, nobody named.
  assert.equal((await stateOf(A, s.id)).keyLead, undefined);
  // D joins while A and B are open: B made the key, so B hands it over (A, the owner, has been here longer).
  await connect(A);
  const seen = [];
  sockB.on('keys:state', (st) => { if (st.serverId === s.id) seen.push(st); });
  assert.equal((await as(D, 'POST', `/invites/${code}/join`, {})).status, 200);
  assert.ok(await until(() => seen.some((st) => st.missing.includes(D.id))));
  const st = seen.find((x) => x.missing.includes(D.id));
  assert.equal(st.keyLead, B.id);
  for (const u of [A, B, C]) assert.equal((await stateOf(u, s.id)).keyLead, B.id, 'the same for every member');
  // B goes: the longest-standing member online who holds the key, never the one waiting for it.
  sockB.close();
  assert.ok(await until(async () => (await stateOf(A, s.id)).keyLead === A.id));
  await connect(D);
  assert.equal((await stateOf(D, s.id)).keyLead, A.id, 'not D, who has no key to hand out');
  // Handed over: nothing left, nobody named.
  assert.equal((await as(A, 'POST', `/servers/${s.id}/keys/share`, { epoch: 1, wraps: { [D.id]: fakeWrap() } })).json.shared, 1);
  assert.equal((await stateOf(A, s.id)).keyLead, undefined);
  // C leaves: a new key is needed, and any member online (here the owner, there longest) is named to make it.
  assert.equal((await as(C, 'POST', `/servers/${s.id}/leave`, {})).status, 200);
  const after = await stateOf(D, s.id);
  assert.equal(after.needsRotation, true);
  assert.equal(after.keyLead, A.id);
  // Only a hint: anyone may still make it (D here), and the server keeps the first one as before.
  assert.equal((await rotate(D, s.id)).status, 200);
  assert.equal((await rotate(A, s.id, 2)).json.code, 'epoch', 'a second key for the same epoch is refused, before its copies are looked at');
  assert.equal((await stateOf(A, s.id)).keyLead, undefined);
});

test('keyLead: never someone held back until verified, nor a bot', async () => {
  const A = await srv.register(); const B = await srv.register(); const N = await srv.register();
  const s = (await as(A, 'POST', '/servers', { name: 'held' })).json;
  const code = (await as(A, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [B, N]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  assert.equal((await rotate(A, s.id)).status, 200);
  // A reset without the recovery key, after B joined: B is held back here. N lost their copy (keys/bad).
  srv.sql('UPDATE users SET keys_reset_at = ? WHERE id = ?', Date.now(), B.id);
  srv.sql('UPDATE members SET joined_at = joined_at - 100000 WHERE server_id = ? AND user_id = ?', s.id, B.id);
  srv.sql('DELETE FROM server_keys WHERE server_id = ? AND user_id = ?', s.id, N.id);
  await connect(B);
  const st = await stateOf(A, s.id);
  assert.ok(st.held.includes(B.id), 'B is held back');
  assert.ok(st.missing.includes(N.id));
  assert.equal(st.keyLead, undefined, 'B is online, but may not hand the key out');
  await connect(A);
  assert.equal((await stateOf(A, s.id)).keyLead, A.id);
});

test('keyLead: never someone Invisible; anyone Away after those who aren’t; the next ones in order as keyBackups', async () => {
  const A = await srv.register(); const B = await srv.register(); const C = await srv.register(); const D = await srv.register(); const E = await srv.register();
  const s = (await as(A, 'POST', '/servers', { name: 'seen' })).json;
  const code = (await as(A, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of [B, C, D]) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  assert.equal((await rotate(A, s.id)).status, 200);
  // B is Invisible: connected, but nobody may learn that from the key state.
  assert.equal((await as(B, 'PATCH', '/me/status', { status: 'invisible' })).status, 200);
  await connect(B);
  assert.equal((await as(E, 'POST', `/invites/${code}/join`, {})).status, 200);
  let st = await stateOf(C, s.id);
  assert.ok(st.missing.includes(E.id));
  assert.equal(st.keyLead, undefined, 'only B is connected, and B is Invisible: nobody named, so any app steps in at once');
  assert.equal(st.keyBackups, undefined);
  // A (the key's maker, here longest) and C, D come online: A leads, then C and D, never B.
  const sockA = await connect(A); await connect(C); await connect(D);
  st = await stateOf(C, s.id);
  assert.equal(st.keyLead, A.id);
  assert.deepEqual(st.keyBackups, [C.id, D.id]);
  // A's app goes unused (shown as Away): C, who isn't, leads now, and A comes after the others.
  sockA.emit('presence:idle', { idle: true });
  assert.ok(await until(async () => (await stateOf(C, s.id)).keyLead === C.id));
  assert.deepEqual((await stateOf(D, s.id)).keyBackups, [D.id, A.id]);
  for (const u of [A, B, C, D]) assert.ok(![(await stateOf(u, s.id)).keyLead, ...((await stateOf(u, s.id)).keyBackups || [])].includes(B.id));
});

test('keys/share: what’s handed over goes in as before, all in one go', async () => {
  const A = await srv.register(); const others = [];
  for (let i = 0; i < 6; i++) others.push(await srv.register());
  const s = (await as(A, 'POST', '/servers', { name: 'many' })).json;
  assert.equal((await rotate(A, s.id)).status, 200);
  const code = (await as(A, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of others) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  const outsider = await srv.register();
  const wraps = Object.fromEntries([...others, outsider].map((u) => [u.id, fakeWrap()]));
  wraps[others[0].id] = 'not a key';
  const r = await as(A, 'POST', `/servers/${s.id}/keys/share`, { epoch: 1, wraps });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.shared, 5, 'every member but the one with a bad copy; never the outsider');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM server_keys WHERE server_id = ? AND epoch = 1', s.id)[0].n, 6);
  // Shared again: nothing changes (the first copy stays).
  assert.equal((await as(A, 'POST', `/servers/${s.id}/keys/share`, { epoch: 1, wraps })).json.shared, 0);
});
