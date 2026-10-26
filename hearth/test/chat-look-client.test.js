// Chat backgrounds, the app's side (public/js/chat-look.js, e2ee.js lkc1 / lkd1, secure.js encryptLook / openLook /
// cleanLook). The modules run here as they are, with the same WebCrypto the browser uses. Proves that a background opens
// only where it was set (that conversation, that version, that author, that group key), that a background, a tag and a
// message can never pass for one another, that tampering is caught, that only a background a key this device trusts
// vouches for counts, that every one is the same size, that the app keeps to the version rule (one more try when someone
// changed it meanwhile), that a picture is shown only through a blob: URL this module made and is let go of when it
// changes, that the device's switch is honoured, and that app.js, settings.js and appearance.js are wired to it.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Browser bits the client code needs: WebCrypto, pins in localStorage, and a document the UI helpers only touch when
// they draw (no dialog is drawn here). fetch answers the routes a test sets.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { crypto: globalThis.crypto, hashwasm: require('hash-wasm') };
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null };
let routes = () => null;
const asked = [];
globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  asked.push({ method: opts.method || 'GET', url: String(url), body });
  const r = await routes(String(url), opts.method || 'GET', body);
  const status = r === null ? 404 : r && r.status ? r.status : 200;
  const data = r && r.status ? r.json : r;
  return { ok: status < 300, status, headers: { get: () => null }, json: async () => data || { error: 'Not found.' } };
};
// Every blob: URL made and revoked, to check none is left behind and only those reach the page.
const madeUrls = new Set();
const revoked = new Set();
const realCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { const u = realCreate(b); madeUrls.add(u); return u; };
URL.revokeObjectURL = (u) => { revoked.add(u); };

const js = (f) => pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href;
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
let E; let CL; let SEC; let BG;
before(async () => {
  E = await import(js('e2ee.js'));
  SEC = await import(js('secure.js'));
  CL = await import(js('chat-look.js'));
  ({ BACKGROUNDS: BG } = await import(js('appearance.js')));
});
beforeEach(() => { store.clear(); routes = () => null; asked.length = 0; });

const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
function tamper(text, field) {
  const p = text.split(':');
  const bytes = unb64(p[field]);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  p[field] = b64(bytes);
  return p.join(':');
}
async function person(id) {
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const k = await E.createIdentity(wrapKey);
  const s = await E.createSigningKey(k.privateKey, k.publicKey);
  return { ...k, ...s, id };
}
const URL1 = '/uploads/mo2x1k9a7f3e1c2b4d5e6f708192a3b4c.bin';
const KEY1 = b64(new Uint8Array(32).fill(7));
const PRESET = { bg: { kind: 'preset', preset: 'aurora' }, dim: 0 };
const PICTURE = { bg: { kind: 'image', url: URL1, k: KEY1, w: 2560, h: 1440, type: 'image/webp' }, dim: 0.4 };

// ------------------------------------------------------------------ e2ee.js: the formats
test('group chat backgrounds: sealed and opened, signed by their author; every one is exactly 512 bytes inside', async () => {
  const a = await person('alice');
  const raw = E.newGroupKey();
  const at = { serverId: 'g1', version: 3, authorId: a.id };
  const seal = (payload, extra = {}) => E.encryptGroupLook({ raw, epoch: 2, signKey: a.signKey, ...at, payload, ...extra });
  const text = await seal(PICTURE);
  assert.match(text, /^lkc1:2:/);
  assert.equal(E.lookEpoch(text), 2);
  const p = text.split(':');
  assert.equal(p.length, 6);
  assert.deepEqual([unb64(p[2]).length, unb64(p[3]).length, unb64(p[4]).length], [32, 12, 528], 'salt, iv, and the 512 bytes with their tag');
  const sig = unb64(p[5]).length;
  assert.ok(sig >= 64 && sig <= 72, `signature ${sig}`);
  const r = await E.decryptGroupLook({ raw, ...at, authorSignPub: [a.signPublicKey], text });
  assert.deepEqual(r.payload, PICTURE);
  assert.equal(r.verified, true);
  assert.equal(r.signedBy, a.signPublicKey);
  assert.equal(E.LOOK_BYTES, 512);
  // A preset and the largest picture there can be: the same length.
  const big = { bg: { kind: 'image', url: '/uploads/' + 'z'.repeat(80) + '.bin', k: KEY1, w: 20000, h: 20000, type: 'image/jpeg' }, dim: 0.8 };
  assert.deepEqual(SEC.cleanLook(big), big, 'the largest one there can be is a valid one');
  const lengths = new Set();
  for (const payload of [PRESET, PICTURE, big]) lengths.add((await seal(payload)).split(':').slice(0, 5).join(':').length);
  assert.equal(lengths.size, 1, 'the same length every time');
  assert.equal(E.lookEpoch('c2:3:x'), null);
  assert.equal(E.lookEpoch('tc1:3:x'), null);
  assert.equal(E.lookEpoch('lkc1:03:x'), null, 'one way to write an epoch');
  // Too long for the one size: refused, never cut. And the version is a whole number from 1.
  await assert.rejects(seal({ bg: { kind: 'preset', preset: 'x'.repeat(520) } }), /doesn’t fit/);
  for (const version of [0, -1, 1.5, '3', null]) await assert.rejects(seal(PRESET, { version }), /version/, String(version));
});

test('every background the app can make fits the 512 bytes: each preset, and any picture cleanLook lets through', async () => {
  const a = await person('alice'); const b = await person('bob');
  const sizes = new Set();
  const payloads = [...BG.map((x) => ({ bg: { kind: 'preset', preset: x.id }, dim: 0 })),
    ...SEC.LOOK_TYPES.map((type) => ({ bg: { kind: 'image', url: '/uploads/' + 'a'.repeat(80) + '.bin', k: KEY1, w: 20000, h: 20000, type }, dim: 0.8 })),
    { bg: { kind: 'image', url: URL1, k: KEY1, w: 0, h: 0, type: 'image/gif' }, dim: 0.35 }];
  for (const payload of payloads) {
    assert.deepEqual(SEC.cleanLook(payload), payload, JSON.stringify(payload));
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 512);
    const t = await E.encryptDmLook({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: 'd1', version: 1, authorId: a.id, payload });
    sizes.add(t.length);
  }
  assert.equal(sizes.size, 1, 'a DM background is always the same length');
});

test('group chat backgrounds: tampering, and moving one to another group, epoch, version, author or key, all fail', async () => {
  const a = await person('alice'); const mallory = await person('mallory');
  const raw = E.newGroupKey();
  const at = { serverId: 'g1', version: 3, authorId: a.id };
  const text = await E.encryptGroupLook({ raw, epoch: 2, signKey: a.signKey, ...at, payload: PRESET });
  const open = (over = {}, t = text, key = raw, pubs = [a.signPublicKey]) => E.decryptGroupLook({ raw: key, ...at, authorSignPub: pubs, text: t, ...over });
  assert.ok(!(await fails(() => open())));
  for (const [what, over] of [['another group', { serverId: 'g2' }], ['another version', { version: 4 }], ['an older version', { version: 2 }], ['another author', { authorId: mallory.id }]]) {
    assert.ok(await fails(() => open(over)), what);
  }
  assert.ok(await fails(() => open({}, text.replace(/^lkc1:2:/, 'lkc1:3:'))), 'another epoch');
  assert.ok(await fails(() => open({}, text, E.newGroupKey())), 'another key');
  for (const field of [2, 3, 4]) assert.ok(await fails(() => open({}, tamper(text, field))), `field ${field}`);
  // Signed by someone else in Alice's name (any member holds the key): it opens, but nothing vouches for it.
  const forged = await E.encryptGroupLook({ raw, epoch: 2, signKey: mallory.signKey, ...at, payload: PRESET });
  assert.equal((await open({}, forged)).verified, false);
  assert.equal((await open({}, tamper(text, 5))).verified, false, 'a damaged signature');
});

test('DM backgrounds: sealed and opened by either person; tampering and moving fail', async () => {
  const a = await person('alice'); const b = await person('bob'); const eve = await person('eve');
  const at = { dmId: 'd1', version: 1, authorId: a.id };
  const text = await E.encryptDmLook({ myPriv: a.privateKey, theirPub: b.publicKey, ...at, payload: PICTURE });
  assert.match(text, /^lkd1:/);
  const p = text.split(':');
  assert.deepEqual([p.length, unb64(p[1]).length, unb64(p[2]).length, unb64(p[3]).length], [4, 32, 12, 528]);
  const open = (over = {}, t = text, who = b, from = a) => E.decryptDmLook({ myPriv: who.privateKey, theirPub: from.publicKey, ...at, text: t, ...over });
  assert.deepEqual((await open()).payload, PICTURE);
  assert.deepEqual((await E.decryptDmLook({ myPriv: a.privateKey, theirPub: b.publicKey, ...at, text })).payload, PICTURE, 'its author reads it too');
  for (const [what, over] of [['another DM', { dmId: 'd2' }], ['another version', { version: 2 }], ['another author', { authorId: b.id }]]) {
    assert.ok(await fails(() => open(over)), what);
  }
  assert.ok(await fails(() => open({}, text, eve)), 'an outsider');
  for (const field of [1, 2, 3]) assert.ok(await fails(() => open({}, tamper(text, field))), `field ${field}`);
});

test('a background never opens as a tag or a message, nor either of those as a background, in either kind of conversation', async () => {
  const a = await person('alice'); const b = await person('bob');
  const raw = E.newGroupKey();
  const payload = PRESET;
  // A group chat: its channel id and server id the same, so only the formats keep them apart.
  const g = { serverId: 'g1', channelId: 'g1', epoch: 1, authorId: a.id, signKey: a.signKey };
  const look = await E.encryptGroupLook({ raw, ...g, version: 1, payload });
  const msg = await E.encryptGroup({ raw, ...g, payload });
  const tag = await E.encryptGroupTag({ raw, ...g, messageId: 'm1', fileIndex: 0, tagId: 'T'.repeat(22), payload });
  const asLook = (text) => E.decryptGroupLook({ raw, serverId: 'g1', version: 1, authorId: a.id, authorSignPub: a.signPublicKey, text });
  const asMsg = (text) => E.decryptGroup({ raw, serverId: 'g1', channelId: 'g1', authorId: a.id, authorSignPub: a.signPublicKey, text });
  const asTag = (text) => E.decryptGroupTag({ raw, serverId: 'g1', channelId: 'g1', messageId: 'm1', fileIndex: 0, tagId: 'T'.repeat(22), authorId: a.id, authorSignPub: a.signPublicKey, text });
  assert.ok(await fails(() => asMsg(look)), 'a background as a message');
  assert.ok(await fails(() => asTag(look)), 'a background as a tag');
  assert.ok(await fails(() => asLook(msg)), 'a message as a background');
  assert.ok(await fails(() => asLook(tag)), 'a tag as a background');
  // Even relabelled: the key derivation and the additional data are their own.
  assert.ok(await fails(() => asMsg(look.replace(/^lkc1:/, 'c2:'))));
  assert.ok(await fails(() => asTag(look.replace(/^lkc1:/, 'tc1:'))));
  assert.ok(await fails(() => asLook(msg.replace(/^c2:/, 'lkc1:'))));
  assert.ok(await fails(() => asLook(tag.replace(/^tc1:/, 'lkc1:'))));
  // A DM.
  const d = { myPriv: a.privateKey, theirPub: b.publicKey, dmId: 'd1', authorId: a.id };
  const dLook = await E.encryptDmLook({ ...d, version: 1, payload });
  const dMsg = await E.encryptDm({ ...d, payload });
  const dTag = await E.encryptDmTag({ ...d, messageId: 'm1', fileIndex: 0, tagId: 'T'.repeat(22), payload });
  const r = { myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'd1', authorId: a.id };
  const dAsLook = (text) => E.decryptDmLook({ ...r, version: 1, text });
  const dAsTag = (text) => E.decryptDmTag({ ...r, messageId: 'm1', fileIndex: 0, tagId: 'T'.repeat(22), text });
  assert.ok(await fails(() => E.decryptDm({ ...r, text: dLook })));
  assert.ok(await fails(() => E.decryptDm({ ...r, text: dLook.replace(/^lkd1:/, 'd2:') })));
  assert.ok(await fails(() => dAsTag(dLook.replace(/^lkd1:/, 'td1:'))));
  assert.ok(await fails(() => dAsLook(dMsg)));
  assert.ok(await fails(() => dAsLook(dMsg.replace(/^d2:/, 'lkd1:'))));
  assert.ok(await fails(() => dAsLook(dTag.replace(/^td1:/, 'lkd1:'))));
  // Nor a group chat's in a DM, or the other way round.
  assert.ok(await fails(() => dAsLook(look)));
  assert.ok(await fails(() => asLook(dLook)));
});

test('cleanLook: a preset by its id, or a picture on this server with its key and a picture type; dim from 0 to 0.8; nothing else', () => {
  const C = SEC.cleanLook;
  assert.deepEqual(C(PRESET), PRESET);
  assert.deepEqual(C(PICTURE), PICTURE);
  assert.deepEqual(C({ ...PICTURE, dim: 5 }).dim, 0.8);
  assert.deepEqual(C({ ...PICTURE, dim: -1 }).dim, 0);
  assert.deepEqual(C({ ...PICTURE, dim: '0.5' }).dim, 0, 'only a number');
  assert.deepEqual(C({ ...PICTURE, dim: 0.123 }).dim, 0.12);
  assert.deepEqual(C({ bg: { ...PICTURE.bg, w: -5, h: 1.5, extra: 'x' }, dim: 0, more: 1 }), { bg: { ...PICTURE.bg, w: 0, h: 0 }, dim: 0 }, 'only what it knows');
  const img = (over) => C({ bg: { ...PICTURE.bg, ...over }, dim: 0 });
  for (const [what, over] of [
    ['another site', { url: 'https://evil.example/x.png' }], ['a quote in it', { url: '/uploads/x".bin' }], ['a path out', { url: '/uploads/../x.bin' }],
    ['not an encrypted upload', { url: '/uploads/abc.png' }], ['a capital letter', { url: '/uploads/ABC.bin' }], ['no key', { k: undefined }], ['a short key', { k: 'abc=' }],
    ['an SVG', { type: 'image/svg+xml' }], ['HTML', { type: 'text/html' }], ['no type', { type: undefined }], ['a URL in the type', { type: 'image/png;url(x)' }],
  ]) assert.equal(img(over), null, what);
  for (const x of [null, undefined, 7, 'x', [], {}, { bg: null }, { bg: [] }, { bg: { kind: 'gradient', colors: ['#000'] } }, { bg: { kind: 'preset' } },
    { bg: { kind: 'preset', preset: 'Aurora' } }, { bg: { kind: 'preset', preset: 'a);background:url(x' } }, { bg: { kind: 'preset', preset: 'x'.repeat(40) } }]) {
    assert.equal(C(x), null, JSON.stringify(x));
  }
});

// ------------------------------------------------------------------ secure.js: sealing and opening, trust
// One device as the app sets it up: its own keys, the people it knows, a group chat whose key it holds, a DM.
async function device(self, others, { raw, epochs = [1], current = epochs[epochs.length - 1], dms } = {}) {
  const users = Object.fromEntries([self, ...others].map((u) => [u.id, { id: u.id, username: u.id, publicKey: u.publicKey, signPublicKey: u.signPublicKey }]));
  const S = {
    me: users[self.id], users, privateKey: self.privateKey, signKey: self.signKey,
    servers: [{ id: 'g1', kind: 'group', memberIds: [self.id, ...others.map((u) => u.id)], channels: [{ id: 'c1', type: 'text' }] }],
    dms: dms || (others.length ? [{ id: 'd1', userId: others[0].id }] : []),
  };
  const sec = SEC.createSecure({ S });
  others.forEach((u) => sec.trust(S.users[u.id]));
  const keys = [];
  for (const epoch of epochs) {
    keys.push({ epoch, wrapperId: self.id, createdAt: Date.now(), check: await E.keyCheck(raw[epoch], 'g1', epoch),
      wrapped: await E.wrapGroupKey({ raw: raw[epoch], serverId: 'g1', epoch, recipientId: self.id, recipientPub: self.publicKey, wrapperId: self.id, signKey: self.signKey }) });
  }
  await sec.applyState({ serverId: 'g1', keyEpoch: current, needsRotation: false, keys, missing: [] });
  return { sec, S };
}
const recOf = (where, ciphertext, over = {}) => ({ ...where, ciphertext, version: 1, authorId: 'alice', updatedAt: Date.now() - 1000, ...over });

test('secure.js: a group chat’s background sealed with its current key opens for the others; moved, forged or signed only by a new key not verified yet, it doesn’t', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey(), 2: E.newGroupKey() };
  const A = await device(alice, [bob], { raw, epochs: [1, 2] });
  const B = await device(bob, [alice], { raw, epochs: [1, 2] });
  const where = { serverId: 'g1' };
  const { ciphertext, epoch } = await A.sec.encryptLook(where, { version: 1, payload: PICTURE });
  assert.equal(epoch, 2, 'the current key');
  assert.equal(E.lookEpoch(ciphertext), 2);
  assert.deepEqual(await B.sec.openLook(recOf(where, ciphertext)), PICTURE);
  assert.deepEqual(await A.sec.openLook(recOf(where, ciphertext)), PICTURE, 'its author’s own app');
  for (const over of [{ version: 2 }, { authorId: 'bob' }, { version: 0 }, { version: '1' }]) {
    assert.deepEqual(await B.sec.openLook(recOf(where, ciphertext, over)), { error: true }, JSON.stringify(over));
  }
  // Moved to another group chat: waits for that group's key, and even with the very same key bytes there, never opens.
  assert.deepEqual(await B.sec.openLook(recOf(where, ciphertext, { serverId: 'g2' })), { pending: true, before: false });
  await B.sec.applyState({ serverId: 'g2', keyEpoch: 2, needsRotation: false, missing: [], keys: [{ epoch: 2, wrapperId: 'bob', createdAt: Date.now(), check: await E.keyCheck(raw[2], 'g2', 2),
    wrapped: await E.wrapGroupKey({ raw: raw[2], serverId: 'g2', epoch: 2, recipientId: 'bob', recipientPub: bob.publicKey, wrapperId: 'bob', signKey: bob.signKey }) }] });
  assert.deepEqual(await B.sec.openLook(recOf(where, ciphertext, { serverId: 'g2' })), { error: true }, 'another group chat');
  assert.deepEqual(await B.sec.openLook(recOf(where, 'nonsense')), { error: true }, 'never throws');
  assert.deepEqual(await B.sec.openLook(recOf(where, undefined)), { error: true });
  // Only what cleanLook lets through is ever sealed.
  await assert.rejects(A.sec.encryptLook(where, { version: 1, payload: { bg: { kind: 'image', url: 'https://evil.example/x.png', k: KEY1, type: 'image/png' } } }), /can’t be saved/);
  // Signed by another member in Alice's name: it opens, but nothing vouches for it.
  const forged = await E.encryptGroupLook({ raw: raw[2], serverId: 'g1', epoch: 2, version: 1, authorId: 'alice', signKey: bob.signKey, payload: PRESET });
  const C = await device(await person('carol'), [alice, bob], { raw, epochs: [1, 2] });
  assert.deepEqual(await C.sec.openLook(recOf(where, forged)), { error: true });
  // Alice's keys change and Carol hasn't verified the new ones: one signed with the new key doesn't count; one signed
  // back then with the key Carol pinned still does; verifying her makes the new one count.
  const alice2 = await person('alice');
  const sealedNew = await E.encryptGroupLook({ raw: raw[2], serverId: 'g1', epoch: 2, version: 2, authorId: 'alice', signKey: alice2.signKey, payload: PRESET });
  C.S.users.alice = { ...C.S.users.alice, publicKey: alice2.publicKey, signPublicKey: alice2.signPublicKey };
  assert.deepEqual(await C.sec.openLook(recOf(where, sealedNew, { version: 2 })), { error: true }, 'a new key not verified yet');
  assert.deepEqual(await C.sec.openLook(recOf(where, ciphertext)), PICTURE, 'the key this device pinned for her back then');
  C.sec.acceptKeys(C.S.users.alice);
  assert.deepEqual(await C.sec.openLook(recOf(where, sealedNew, { version: 2 })), PRESET);
});

test('secure.js: a group chat’s background waits for a key that’s on its way, and says so when that key never comes', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey(), 2: E.newGroupKey(), 3: E.newGroupKey() };
  const A = await device(alice, [bob], { raw, epochs: [1, 2, 3] });
  const seal = (epoch) => E.encryptGroupLook({ raw: raw[epoch], serverId: 'g1', epoch, version: 1, authorId: 'alice', signKey: alice.signKey, payload: PRESET });
  const B = await device(bob, [alice], { raw, epochs: [2] });
  assert.deepEqual(await B.sec.openLook(recOf({ serverId: 'g1' }, await seal(3))), { pending: true, before: false }, 'a newer key: on its way');
  assert.deepEqual(await B.sec.openLook(recOf({ serverId: 'g1' }, await seal(1))), { pending: true, before: true }, 'older than any key held: never comes');
  assert.deepEqual(await A.sec.openLook(recOf({ serverId: 'g1' }, await seal(1))), PRESET);
});

test('secure.js: DM backgrounds open with the key both people share, are refused to write while their key changed, and don’t count from an unverified key', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const A = await device(alice, [bob], { raw });
  const B = await device(bob, [alice], { raw });
  const where = { dmId: 'd1' };
  const { ciphertext } = await A.sec.encryptLook(where, { version: 4, payload: PICTURE });
  assert.match(ciphertext, /^lkd1:/);
  const rec = recOf(where, ciphertext, { version: 4 });
  assert.deepEqual(await B.sec.openLook(rec), PICTURE);
  assert.deepEqual(await A.sec.openLook(rec), PICTURE);
  assert.deepEqual(await B.sec.openLook({ ...rec, version: 5 }), { error: true }, 'sealed for another version');
  assert.deepEqual(await B.sec.openLook({ ...rec, dmId: 'd2' }), { error: true }, 'not a conversation this device has');
  // Bob's keys change (a password reset): Alice's app won't seal for the new key until she verifies it, and a
  // background only the new key opens doesn't count meanwhile.
  const bob2 = await person('bob');
  A.S.users.bob = { ...A.S.users.bob, publicKey: bob2.publicKey, signPublicKey: bob2.signPublicKey };
  await assert.rejects(A.sec.encryptLook(where, { version: 5, payload: PRESET }), (e) => e.code === 'untrusted');
  const fromNew = await E.encryptDmLook({ myPriv: bob2.privateKey, theirPub: alice.publicKey, dmId: 'd1', version: 5, authorId: 'bob', payload: PRESET });
  assert.deepEqual(await A.sec.openLook({ ...rec, version: 5, authorId: 'bob', ciphertext: fromNew }), { error: true });
  A.sec.acceptKeys(A.S.users.bob);
  assert.deepEqual(await A.sec.openLook({ ...rec, version: 5, authorId: 'bob', ciphertext: fromNew }), PRESET);
  // Keys that couldn't be looked up (offline): worth trying again later, unlike one that doesn't check out.
  B.S.users.alice = { id: 'alice', username: 'alice' };
  assert.deepEqual(await B.sec.openLook(rec), { error: true, retry: true });
});

// ------------------------------------------------------------------ chat-look.js: pure helpers
test('the line in the conversation: who and what, "You" only for your own change, look-alike names never pass for it', () => {
  const names = { maya: 'maya', bob: 'Bobby', tricky: 'Yоu' }; // (a Cyrillic о)
  const nameOf = (id) => names[id];
  const handleOf = (id) => id;
  assert.equal(CL.lookLineText({ by: 'maya', look: 'set' }, 'me', nameOf, handleOf), 'maya changed the chat background');
  assert.equal(CL.lookLineText({ by: 'maya', look: 'clear' }, 'me', nameOf, handleOf), 'maya removed the chat background');
  assert.equal(CL.lookLineText({ userId: 'bob', action: 'clear' }, 'me', nameOf, handleOf), 'Bobby (@bob) removed the chat background', 'as the server lists it too');
  assert.equal(CL.lookLineText({ by: 'me', look: 'set' }, 'me', nameOf, handleOf), 'You changed the chat background');
  assert.equal(CL.lookLineText({ by: 'tricky', look: 'set' }, 'me', nameOf, handleOf), 'Yоu (@tricky) changed the chat background');
  assert.equal(CL.lookLineText({ by: null, look: 'set' }, 'me', nameOf, handleOf), 'Someone changed the chat background');
  const p = CL.lookLineParts({ by: 'me', look: 'clear' }, 'me', nameOf);
  assert.deepEqual([p.self, p.action], [true, 'removed the chat background']);
});

test('lookEvents from a history page: well-formed ones only, kept apart from the timer’s by their prefix', () => {
  const ok = { id: 'ev1', userId: 'maya', action: 'set', createdAt: 1000 };
  assert.deepEqual(CL.lookEvents([ok, { ...ok, id: 'ev2', action: 'clear', userId: 'a b' }, { ...ok, id: 'x y' }, { ...ok, id: 'ev3', action: 'wipe' }, { ...ok, id: 'ev4', createdAt: 'soon' }, null, 'x']),
    [{ id: 'lk:ev1', by: 'maya', look: 'set', at: 1000 }, { id: 'lk:ev2', by: null, look: 'clear', at: 1000 }]);
  assert.deepEqual(CL.lookEvents(undefined), []);
  assert.deepEqual(CL.lookEvents({ id: 'ev1' }), []);
});

test('records from the server: a version from 1, a ciphertext and its author, or a removal that keeps its version', () => {
  assert.deepEqual(CL.cleanRecord({ version: 2, ciphertext: 'lkd1:x', authorId: 'maya', updatedAt: 5, epoch: 9 }), { version: 2, ciphertext: 'lkd1:x', authorId: 'maya', updatedAt: 5 });
  assert.deepEqual(CL.cleanRecord({ version: 3, cleared: true }), { version: 3, cleared: true });
  assert.deepEqual(CL.cleanRecord({ version: 3, ciphertext: '', authorId: 'maya' }), { version: 3, cleared: true });
  for (const x of [null, 7, [], { version: 0, ciphertext: 'x', authorId: 'a' }, { version: '2', ciphertext: 'x', authorId: 'a' }, { version: 2, ciphertext: 'x' },
    { version: 2, ciphertext: 'x', authorId: 'a b' }, { version: 2, ciphertext: 'x'.repeat(2001), authorId: 'a' }, { version: 2, ciphertext: 5, authorId: 'a' }]) {
    assert.equal(CL.cleanRecord(x), null, JSON.stringify(x));
  }
  const server = (id) => ({ g1: { id: 'g1', kind: 'group' }, s1: { id: 's1' } })[id];
  assert.equal(CL.convOf({ type: 'dm', dmId: 'd1' }, server), 'd:d1');
  assert.equal(CL.convOf({ type: 'channel', serverId: 'g1', channelId: 'c1' }, server), 'g:g1');
  assert.equal(CL.convOf({ type: 'channel', serverId: 's1', channelId: 'c2' }, server), null, 'a server channel has its server’s theme instead');
  assert.equal(CL.convOf({ type: 'home' }, server), null);
});

// ------------------------------------------------------------------ chat-look.js: the module, with real keys
// Alice's and Bob's apps, each with chat-look.js on top of its own secure.js: a DM d1 between them, a group chat g1.
// The server is a fake: it keeps one record per conversation and the version rule, and stores uploads.
function fakeServer() {
  const looks = new Map();
  const uploads = new Map();
  let n = 0;
  return {
    looks, uploads,
    route(url, method, body) {
      const m = /^\/api\/(dms|groups)\/(\w+)\/look$/.exec(url);
      if (!m) return null;
      const key = (m[1] === 'dms' ? 'd:' : 'g:') + m[2];
      const cur = looks.get(key);
      const version = cur ? cur.version : 0;
      if (body.version !== version + 1) return { status: 409, json: { error: 'Someone changed this chat’s background just now.', code: 'stale_look', look: cur || null } };
      const look = method === 'DELETE' ? { version: body.version, cleared: true }
        : { ciphertext: body.ciphertext, epoch: null, authorId: this.me, version: body.version, updatedAt: Date.now() };
      looks.set(key, look);
      return { look };
    },
    upload(bytes) { const url = `/uploads/up${++n}.bin`; uploads.set(url, bytes); return url; },
  };
}
function app(dev, srv, over = {}) {
  const changed = [];
  const look = CL.createChatLook({
    me: () => dev.S.me, dms: () => dev.S.dms, server: (id) => dev.S.servers.find((s) => s.id === id), getUser: (id) => dev.S.users[id] || { id },
    blocked: () => false, title: () => 'your chat',
    encryptLook: (w, x) => dev.sec.encryptLook(w, x), openLook: (x) => dev.sec.openLook(x), withKeyRetry: (id, fn) => fn(),
    prepareImage: async (file) => ({ file, w: 40, h: 30 }),
    upload: async (bytes) => srv.upload(bytes),
    download: async (url) => { const b = srv.uploads.get(url); if (!b) throw Object.assign(new Error('gone'), { code: 'gone' }); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    enabled: () => true, changed: (key) => changed.push(key),
    ...over,
  });
  return { look, changed };
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const until = async (fn, what) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 10)); } assert.fail(`waited too long: ${what}`); };
const DM_VIEW = { type: 'dm', dmId: 'd1' };
const GROUP_VIEW = { type: 'channel', serverId: 'g1', channelId: 'c1' };

test('chat-look.js: a preset set in a DM shows for both; a change and a removal follow live; the version rule with one more try', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const srv = fakeServer();
  const A = app(await device(alice, [bob], { raw }), srv);
  const B = app(await device(bob, [alice], { raw }), srv);
  A.look.fromBootstrap([{ id: 'd1', userId: 'bob', look: null }], []);
  B.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: null }], []);
  assert.equal(A.look.themeFor(DM_VIEW), null);
  srv.me = 'alice';
  routes = (url, method, body) => srv.route(url, method, body);
  await A.look.save('d:d1', { preset: 'aurora' });
  const put = asked.find((x) => x.method === 'PUT');
  assert.equal(put.url, '/api/dms/d1/look');
  assert.deepEqual(Object.keys(put.body).sort(), ['ciphertext', 'files', 'version']);
  assert.equal(put.body.version, 1, 'the first one');
  assert.deepEqual(put.body.files, []);
  assert.match(put.body.ciphertext, /^lkd1:/);
  assert.deepEqual(A.look.themeFor(DM_VIEW), { chat: true, background: { kind: 'preset', preset: 'aurora' } }, 'at once on the setter’s own app');
  // Bob gets it live.
  B.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('d:d1'), event: { id: 'e1', userId: 'alice', action: 'set', createdAt: Date.now() } });
  await until(() => B.look.themeFor(DM_VIEW), 'Bob’s background');
  assert.deepEqual(B.look.themeFor(DM_VIEW), { chat: true, background: { kind: 'preset', preset: 'aurora' } });
  assert.ok(B.changed.includes('d:d1'), 'the app was told');
  assert.equal(B.look.themeFor({ type: 'dm', dmId: 'd2' }), null, 'another DM has none');
  // Bob changes it meanwhile; Alice's app hasn't heard yet: refused as stale, it takes in what's there and tries once
  // more, after it.
  srv.me = 'bob';
  await B.look.save('d:d1', { preset: 'nebula' });
  assert.equal(srv.looks.get('d:d1').version, 2);
  srv.me = 'alice';
  asked.length = 0;
  await A.look.save('d:d1', { preset: 'lagoon' });
  assert.deepEqual(asked.filter((x) => x.method === 'PUT').map((x) => x.body.version), [2, 3], 'refused at 2, then 3');
  assert.deepEqual(A.look.themeFor(DM_VIEW).background.preset, 'lagoon');
  // Only once more: refused again, it says so.
  srv.looks.set('d:d1', { ...srv.looks.get('d:d1'), version: 9 });
  const realRoute = srv.route.bind(srv);
  let refusals = 0;
  routes = (url, method, body) => { const r = realRoute(url, method, body); if (r && r.status === 409) { refusals++; srv.looks.set('d:d1', { ...srv.looks.get('d:d1'), version: srv.looks.get('d:d1').version + 1 }); } return r; };
  await assert.rejects(A.look.save('d:d1', { preset: 'candy' }), /changed this chat’s background/);
  assert.equal(refusals, 2);
  routes = (url, method, body) => srv.route(url, method, body);
  // Bob's app hears of the old versions late: they're left alone.
  B.look.onEvent('dm:look', { dmId: 'd1', look: { ...srv.looks.get('d:d1'), version: 1 } });
  await settle();
  assert.equal(B.look.themeFor(DM_VIEW).background.preset, 'nebula');
  // Alice removes it: a DELETE with the next version; gone for both.
  A.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('d:d1') });
  asked.length = 0;
  const v = srv.looks.get('d:d1').version;
  await A.look.remove('d:d1');
  assert.deepEqual(asked.map((x) => [x.method, x.url, x.body]), [['DELETE', '/api/dms/d1/look', { version: v + 1 }]]);
  assert.equal(A.look.themeFor(DM_VIEW), null);
  B.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('d:d1') });
  assert.equal(B.look.themeFor(DM_VIEW), null);
  // A removed one keeps its version: setting one again goes after it.
  asked.length = 0;
  await B.look.save('d:d1', { preset: 'forest' });
  assert.equal(asked.find((x) => x.method === 'PUT').body.version, v + 2);
});

test('chat-look.js: a picture is resized, sealed, uploaded and linked; shown only through a blob: URL made here, which is let go of when it changes', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const srv = fakeServer();
  routes = (url, method, body) => srv.route(url, method, body);
  const prepared = [];
  const A = app(await device(alice, [bob], { raw }), srv, { prepareImage: async (file) => { prepared.push(file); return { file, w: 40, h: 30 }; } });
  const B = app(await device(bob, [alice], { raw }), srv);
  A.look.fromBootstrap([{ id: 'd1', userId: 'bob', look: null }], []);
  B.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: null }], []);
  srv.me = 'alice';
  const pixels = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const file = new File([pixels], 'beach.png', { type: 'image/png' });
  const status = [];
  await A.look.save('d:d1', { file, dim: 0.5 }, (s) => status.push(s));
  assert.deepEqual(status, ['Getting your picture ready…', 'Uploading…', 'Saving…']);
  assert.equal(prepared[0], file, 'made ready like a photo');
  const [url] = [...srv.uploads.keys()];
  const put = asked.find((x) => x.method === 'PUT');
  assert.deepEqual(put.body.files, [url], 'the picture is linked to it');
  assert.notDeepEqual(new Uint8Array(srv.uploads.get(url)).slice(12, 20), pixels, 'what went up is encrypted');
  const mine = A.look.themeFor(DM_VIEW);
  assert.equal(mine.chat, true);
  assert.equal(mine.background.kind, 'image');
  assert.equal(mine.background.dim, 0.5);
  assert.ok(madeUrls.has(mine.background.image) && /^blob:/.test(mine.background.image), 'its own copy, no download');
  // Bob: nothing until it's needed, then downloaded, decrypted, and shown as a blob: URL.
  B.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('d:d1') });
  await settle();
  assert.equal(B.look.themeFor(DM_VIEW), null, 'still on its way');
  await until(() => B.look.themeFor(DM_VIEW), 'the picture');
  const first = B.look.themeFor(DM_VIEW).background.image;
  assert.ok(madeUrls.has(first) && /^blob:[^"'()\\\s]+$/.test(first));
  // Turned off on this device: nothing shows.
  const off = app(await device(bob, [alice], { raw }), srv, { enabled: () => false });
  off.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: srv.looks.get('d:d1') }], []);
  await settle();
  assert.equal(off.look.themeFor(DM_VIEW), null);
  // Dimmed differently: the picture goes up again (what a background links to is always a fresh upload of its setter's).
  srv.me = 'bob';
  await B.look.save('d:d1', { current: true, dim: 0.2 });
  assert.equal(srv.uploads.size, 2);
  const second = B.look.themeFor(DM_VIEW).background.image;
  assert.notEqual(second, first);
  assert.ok(revoked.has(first), 'the old copy was let go of');
  assert.equal(B.look.themeFor(DM_VIEW).background.dim, 0.2);
  // A preset instead: the picture's copy goes too; reset lets go of everything.
  await B.look.save('d:d1', { preset: 'embers' });
  assert.ok(revoked.has(second));
  A.look.reset();
  assert.ok(revoked.has(mine.background.image), 'reset lets go of every picture');
  assert.equal(A.look.themeFor(DM_VIEW), null);
  // Not a picture a browser shows as one: refused before anything goes up.
  await assert.rejects(B.look.save('d:d1', { file: new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }), dim: 0 }), /Pick a photo/);
  assert.equal(srv.uploads.size, 2);
});

test('chat-look.js: a group chat’s background waits for its key; one moved from another conversation, or by someone outside a DM, never shows', async () => {
  const alice = await person('alice'); const bob = await person('bob'); const carol = await person('carol');
  const raw = { 1: E.newGroupKey(), 2: E.newGroupKey() };
  const srv = fakeServer();
  routes = (url, method, body) => srv.route(url, method, body);
  const A = app(await device(alice, [bob], { raw, epochs: [1, 2] }), srv);
  A.look.fromBootstrap([{ id: 'd1', userId: 'bob', look: null }], [{ id: 'g1', kind: 'group', look: null }]);
  srv.me = 'alice';
  await A.look.save('g:g1', { preset: 'twilight' });
  const put = asked.find((x) => x.method === 'PUT');
  assert.equal(put.url, '/api/groups/g1/look');
  assert.match(put.body.ciphertext, /^lkc1:2:/, 'with the group’s current key');
  // Bob has only the older key so far: it waits, and opens once the key comes.
  const bobDev = await device(bob, [alice], { raw, epochs: [1], current: 1 });
  const B = app(bobDev, srv);
  B.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: null }], [{ id: 'g1', kind: 'group', look: srv.looks.get('g:g1') }]);
  await settle();
  assert.equal(B.look.themeFor(GROUP_VIEW), null, 'waiting for the key');
  const keys = [1, 2].map(async (epoch) => ({ epoch, wrapperId: 'bob', createdAt: Date.now(), check: await E.keyCheck(raw[epoch], 'g1', epoch),
    wrapped: await E.wrapGroupKey({ raw: raw[epoch], serverId: 'g1', epoch, recipientId: 'bob', recipientPub: bob.publicKey, wrapperId: 'bob', signKey: bob.signKey }) }));
  await bobDev.sec.applyState({ serverId: 'g1', keyEpoch: 2, needsRotation: false, keys: await Promise.all(keys), missing: [] });
  B.look.onKeys('g1');
  await until(() => B.look.themeFor(GROUP_VIEW), 'the group’s background');
  assert.equal(B.look.themeFor(GROUP_VIEW).background.preset, 'twilight');
  // The server hands the group chat's background to a DM, or a DM's to another DM: nothing shows.
  const C = app(await device(bob, [alice], { raw, epochs: [1, 2], dms: [{ id: 'd1', userId: 'alice' }, { id: 'd2', userId: 'alice' }] }), srv);
  C.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: null }, { id: 'd2', userId: 'alice', look: null }], [{ id: 'g1', kind: 'group', look: null }]);
  await A.look.save('d:d1', { preset: 'candy' });
  C.look.onEvent('dm:look', { dmId: 'd2', look: srv.looks.get('d:d1') });
  C.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('g:g1') });
  await settle();
  assert.equal(C.look.themeFor({ type: 'dm', dmId: 'd2' }), null, 'a DM’s in another DM');
  assert.equal(C.look.themeFor(DM_VIEW), null, 'a group chat’s in a DM');
  C.look.onEvent('dm:look', { dmId: 'd1', look: srv.looks.get('d:d1') });
  await until(() => C.look.themeFor(DM_VIEW), 'the real one');
  // Sealed by Carol in a DM between Alice and Bob (she'd need their key; here Alice seals it under Carol's name).
  const D = app(await device(bob, [alice, carol], { raw }), srv);
  D.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: null }], []);
  const asCarol = await E.encryptDmLook({ myPriv: alice.privateKey, theirPub: bob.publicKey, dmId: 'd1', version: 7, authorId: 'carol', payload: PRESET });
  D.look.onEvent('dm:look', { dmId: 'd1', look: { version: 7, ciphertext: asCarol, authorId: 'carol', updatedAt: Date.now() } });
  await settle();
  assert.equal(D.look.themeFor(DM_VIEW), null, 'only its two people');
  // Someone you blocked set it: not shown.
  const blockedBy = app(await device(bob, [alice], { raw }), srv, { blocked: (id) => id === 'alice' });
  blockedBy.look.fromBootstrap([{ id: 'd1', userId: 'alice', look: srv.looks.get('d:d1') }], []);
  await settle();
  assert.equal(blockedBy.look.themeFor(DM_VIEW), null);
  // A conversation that's gone from the bootstrap is forgotten.
  C.look.fromBootstrap([], []);
  assert.equal(C.look.themeFor(DM_VIEW), null);
});

test('chat-look.js: the menu item, only where you may set it', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const dev = await device(alice, [bob], { raw });
  const srv = fakeServer();
  let blocked = false;
  const A = app(dev, srv, { blocked: () => blocked });
  const item = A.look.menuItem('d:d1');
  assert.deepEqual([item.label, item.icon, typeof item.action], ['Chat background…', 'palette', 'function']);
  assert.equal(A.look.menuItem('g:g1').label, 'Chat background…');
  for (const key of ['d:nope', 'g:nope', 'c:c1', 'x', null, 'd:../x']) assert.equal(A.look.menuItem(key), null, String(key));
  blocked = true;
  assert.equal(A.look.menuItem('d:d1'), null, 'you blocked them');
  blocked = false;
  dev.S.users.bob = { ...dev.S.users.bob, deleted: true };
  assert.equal(A.look.menuItem('d:d1'), null, 'their account was deleted');
  dev.S.servers[0].kind = undefined;
  assert.equal(A.look.menuItem('g:g1'), null, 'a server, not a group chat');
});

// ------------------------------------------------------------------ the wiring
test('static: app.js shows a chat’s background in renderAll, has the menu items, the live events and the lines; Settings has the switch; appearance.js honours it', () => {
  const app = read('public', 'js', 'app.js');
  const fn = (name) => { const at = app.search(new RegExp(`^(async )?function ${name}\\(`, 'm')); assert.ok(at > 0, name); return app.slice(at, app.indexOf('\n}\n', at)); };
  assert.match(fn('renderAll'), /applyServerTheme\(\);/);
  assert.match(fn('applyServerTheme'), /setServerTheme\(server && !isGroup\(server\) \? server\.theme && \{ \.\.\.server\.theme, chat: false \} : LOOK\.themeFor\(S\.view\)\);/,
    'a server’s own theme never passes for a chat’s (each has its own switch)');
  assert.match(fn('dmMenuItems'), /LOOK\.menuItem\('d:' \+ d\.id\)/);
  assert.match(fn('groupMenuItems'), /LOOK\.menuItem\('g:' \+ g\.id\)/);
  assert.match(app, /socket\.on\('dm:look', \(p\) => onLookEvent\('dm:look', p\)\);/);
  assert.match(app, /socket\.on\('group:look', \(p\) => onLookEvent\('group:look', p\)\);/);
  assert.match(fn('loadMessages'), /mergeTimerEvents\(store, res\.timerEvents\) \+ mergeLookEvents\(store, res\.lookEvents\)/);
  assert.match(fn('sysLineEl'), /const p = e\.look \? LOOK\.lineParts\(e, S\.me\.id, nameOf, handleOf\) : sysLineParts\(e, S\.me\.id, nameOf, handleOf\);/);
  assert.match(fn('sysLineEl'), /icon\(e\.look \? 'palette' : 'timer'\)/);
  assert.match(fn('loadBootstrap'), /await sec\.applyState\(st\);\n\s*LOOK\.fromBootstrap\(b\.dms, b\.servers\);/, 'after the keys');
  assert.match(fn('onKeysChanged'), /LOOK\.onKeys\(serverId\)/);
  assert.match(fn('signOutHere'), /LOOK\.reset\(\)/);
  assert.match(app, /enabled: \(\) => loadAppearance\(\)\.chatLooks !== false,/);
  const settings = read('public', 'js', 'settings.js');
  assert.match(settings, /toggle\('Show backgrounds people set for chats', a\.chatLooks !== false, \(v\) => \{ a\.chatLooks = v; commit\(\);/);
  const appearance = read('public', 'js', 'appearance.js');
  assert.match(appearance, /chatLooks: true,/);
  assert.match(appearance, /serverTheme\.chat \? a\.chatLooks !== false : a\.serverThemes !== false/);
  // Only blob: URLs this module made reach url("…"), in the CSS and in the dialog's preview.
  const cl = read('public', 'js', 'chat-look.js');
  const urls = cl.match(/url\("\$\{[^}]+\}"\)/g) || [];
  assert.deepEqual(urls, ['url("${pic}")', 'url("${ownPic}")']);
  assert.match(cl, /const pictureUrl = \(\) => \(pick === 'file' \? fileUrl : pick === 'current' \? currentUrl\(\) : null\);/);
  assert.match(cl, /const currentUrl = \(\) => \{ const x = convs\.get\(key\); return x && x\.img && safeUrl\(x\.img\.blobUrl\) \? x\.img\.blobUrl : null; \};/);
  assert.match(cl, /fileUrl = URL\.createObjectURL\(f\);/);
  assert.match(cl, /if \(e\.img && safeUrl\(e\.img\.blobUrl\)\) \{/);
  assert.doesNotMatch(cl, /html:|innerHTML/, 'text nodes only');
});
