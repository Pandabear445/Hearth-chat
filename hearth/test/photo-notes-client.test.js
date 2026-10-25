// Photo comments and tags, the app's side (public/js/photo-notes.js, e2ee.js tc1 / td1, secure.js encryptTag / openTag,
// binding.js photoOf). The modules run here as they are, with the same WebCrypto the browser uses. Proves that a tag
// opens only where it was put (that photo of that message, by that person, in that conversation and key epoch), that a
// tag and a message can never pass for one another, that tampering is caught, that only tags vouched for by a key this
// device trusts count, that labels come out as short plain text, and that a comment keeps the photo it's about through
// opening, edits and scheduling.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Browser bits the client code needs: WebCrypto, pins in localStorage, and a document the UI helpers only touch when
// they draw (nothing is drawn here). fetch answers the routes a test sets.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { crypto: globalThis.crypto, hashwasm: require('hash-wasm') };
globalThis.document = { addEventListener() {}, querySelectorAll: () => [] };
let routes = () => null;
const asked = [];
globalThis.fetch = async (url, opts = {}) => {
  asked.push([opts.method || 'GET', String(url)]);
  const body = routes(String(url), opts);
  return { ok: body !== null, status: body === null ? 404 : 200, headers: { get: () => null }, json: async () => body || { error: 'Not found.' } };
};

const js = (f) => pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href;
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
let E; let BD; let PN; let createSecure;
before(async () => {
  E = await import(js('e2ee.js'));
  BD = await import(js('binding.js'));
  PN = await import(js('photo-notes.js'));
  ({ createSecure } = await import(js('secure.js')));
});
beforeEach(() => store.clear()); // no pins carried over from another test's people

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
const URL2 = '/uploads/mo2x1k9b7f3e1c2b4d5e6f708192a3b4d.bin';
const TAG = 'TTTTTTTTTTTTTTTTTTTTTT';

// ------------------------------------------------------------------ e2ee.js: the formats
test('channel tags: sealed and opened, signed by their author; every tag is the same size whatever its label', async () => {
  const a = await person('alice');
  const raw = E.newGroupKey();
  const at = { serverId: 's1', channelId: 'c1', messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: a.id };
  const seal = (n, extra = {}) => E.encryptGroupTag({ raw, epoch: 3, signKey: a.signKey, ...at, payload: { n, fu: URL2 }, ...extra });
  const text = await seal('beach');
  assert.match(text, /^tc1:3:/);
  assert.equal(E.tagEpoch(text), 3);
  const r = await E.decryptGroupTag({ raw, ...at, authorSignPub: [a.signPublicKey], text });
  assert.deepEqual(r.payload, { n: 'beach', fu: URL2 });
  assert.equal(r.verified, true);
  assert.equal(r.signedBy, a.signPublicKey);
  // The label's length never shows: one 256-byte step for a one-letter label and for the longest one.
  const sizes = new Set();
  for (const n of ['x', 'a much longer label of forty characters', '🏖️'.repeat(13), '"'.repeat(40), '\\'.repeat(40), '𝒜'.repeat(40)]) {
    const t = await seal(PN.normLabel(n));
    const p = t.split(':');
    assert.equal(unb64(p[4]).length, 272, n);
    sizes.add(p.slice(0, 5).join(':').length);
  }
  assert.equal(sizes.size, 1, 'the same length every time');
  assert.equal(E.tagEpoch('c2:3:x'), null);
  assert.equal(E.tagEpoch('tc1:03:x'), null, 'one way to write an epoch');
  // Too long to fit the one step (only a label far past the limit, or an address no upload has): refused, never cut.
  await assert.rejects(seal('x'.repeat(220)), /too long/);
});

test('channel tags: tampering, and moving one to another photo, message, author, epoch, id, channel or server key, all fail', async () => {
  const a = await person('alice'); const mallory = await person('mallory');
  const raw = E.newGroupKey();
  const at = { serverId: 's1', channelId: 'c1', messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: a.id };
  const text = await E.encryptGroupTag({ raw, epoch: 3, signKey: a.signKey, ...at, payload: { n: 'beach', fu: URL2 } });
  const open = (over = {}, t = text, key = raw, pubs = [a.signPublicKey]) => E.decryptGroupTag({ raw: key, ...at, authorSignPub: pubs, text: t, ...over });
  assert.ok(!(await fails(() => open())));
  for (const [what, over] of [['another photo', { fileIndex: 0 }], ['another message', { messageId: 'm2' }], ['another author', { authorId: mallory.id }],
    ['another tag id', { tagId: 'UUUUUUUUUUUUUUUUUUUUUU' }], ['another channel', { channelId: 'c2' }]]) {
    assert.ok(await fails(() => open(over)), what);
  }
  assert.ok(await fails(() => open({}, text.replace(/^tc1:3:/, 'tc1:4:'))), 'another epoch');
  assert.ok(await fails(() => open({}, text, E.newGroupKey())), 'another key');
  for (const field of [2, 3, 4]) assert.ok(await fails(() => open({}, tamper(text, field))), `field ${field}`);
  // A signature that isn't the author's: it opens (the key is the conversation's), but it isn't verified.
  const forged = await E.encryptGroupTag({ raw, epoch: 3, signKey: mallory.signKey, ...at, payload: { n: 'beach', fu: URL2 } });
  assert.equal((await open({}, forged)).verified, false);
  assert.equal((await open({}, tamper(text, 5))).verified, false, 'a damaged signature');
});

test('DM tags: sealed and opened by either person; tampering and moving fail', async () => {
  const a = await person('alice'); const b = await person('bob'); const eve = await person('eve');
  const at = { dmId: 'd1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: a.id };
  const text = await E.encryptDmTag({ myPriv: a.privateKey, theirPub: b.publicKey, ...at, payload: { n: 'cat', fu: URL1 } });
  assert.match(text, /^td1:/);
  assert.equal(text.split(':').length, 4);
  assert.equal(unb64(text.split(':')[3]).length, 272);
  const open = (over = {}, t = text, who = b, from = a) => E.decryptDmTag({ myPriv: who.privateKey, theirPub: from.publicKey, ...at, text: t, ...over });
  assert.deepEqual((await open()).payload, { n: 'cat', fu: URL1 });
  assert.deepEqual((await E.decryptDmTag({ myPriv: a.privateKey, theirPub: b.publicKey, ...at, text })).payload.n, 'cat', 'its author reads it too');
  for (const [what, over] of [['another photo', { fileIndex: 1 }], ['another message', { messageId: 'm2' }], ['another author', { authorId: b.id }],
    ['another tag id', { tagId: 'UUUUUUUUUUUUUUUUUUUUUU' }], ['another DM', { dmId: 'd2' }]]) {
    assert.ok(await fails(() => open(over)), what);
  }
  assert.ok(await fails(() => open({}, text, eve)), 'an outsider');
  for (const field of [1, 2, 3]) assert.ok(await fails(() => open({}, tamper(text, field))), `field ${field}`);
});

test('a tag and a message never pass for one another, in either kind of conversation', async () => {
  const a = await person('alice'); const b = await person('bob');
  const raw = E.newGroupKey();
  const msg = await E.encryptGroup({ raw, serverId: 's1', channelId: 'c1', epoch: 1, authorId: a.id, signKey: a.signKey, payload: { n: 'x', fu: URL1 } });
  const tag = await E.encryptGroupTag({ raw, serverId: 's1', channelId: 'c1', epoch: 1, messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: a.id, signKey: a.signKey, payload: { n: 'x', fu: URL1 } });
  const gt = { raw, serverId: 's1', channelId: 'c1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: a.id, authorSignPub: a.signPublicKey };
  assert.ok(await fails(() => E.decryptGroup({ raw, serverId: 's1', channelId: 'c1', authorId: a.id, authorSignPub: a.signPublicKey, text: tag })), 'a tag as a message');
  assert.ok(await fails(() => E.decryptGroupTag({ ...gt, text: msg })), 'a message as a tag');
  // Even relabelled: the key derivation and the additional data are their own.
  assert.ok(await fails(() => E.decryptGroup({ raw, serverId: 's1', channelId: 'c1', authorId: a.id, authorSignPub: a.signPublicKey, text: tag.replace(/^tc1:/, 'c2:') })));
  assert.ok(await fails(() => E.decryptGroupTag({ ...gt, text: msg.replace(/^c2:/, 'tc1:') })));
  const dmMsg = await E.encryptDm({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: 'd1', authorId: a.id, payload: { n: 'x', fu: URL1 } });
  const dmTag = await E.encryptDmTag({ myPriv: a.privateKey, theirPub: b.publicKey, dmId: 'd1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: a.id, payload: { n: 'x', fu: URL1 } });
  const dt = { myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'd1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: a.id };
  assert.ok(await fails(() => E.decryptDm({ myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'd1', authorId: a.id, text: dmTag })));
  assert.ok(await fails(() => E.decryptDm({ myPriv: b.privateKey, theirPub: a.publicKey, dmId: 'd1', authorId: a.id, text: dmTag.replace(/^td1:/, 'd2:') })));
  assert.ok(await fails(() => E.decryptDmTag({ ...dt, text: dmMsg })));
  assert.ok(await fails(() => E.decryptDmTag({ ...dt, text: dmMsg.replace(/^d2:/, 'td1:') })));
  // Nor a channel tag in a DM, or the other way round.
  assert.ok(await fails(() => E.decryptDmTag({ ...dt, text: tag })));
  assert.ok(await fails(() => E.decryptGroupTag({ ...gt, text: dmTag })));
});

// ------------------------------------------------------------------ labels and the other pure helpers
test('labels: composed, one line, no control or invisible characters, at most 40 whole characters, compared without case', () => {
  const N = (s) => PN.normLabel(s);
  assert.equal(PN.LABEL_MAX, 40);
  assert.equal(N('  Beach  day  '), 'Beach day');
  assert.equal(N('été'), 'été', 'NFC');
  assert.equal(N('two\nlines\tand\u0000a\u007fnull'), 'two lines and a null');
  assert.equal(N('‮evil‬ ⁦x⁩​﻿'), 'evil x', 'bidi overrides, isolates, zero-width space, byte-order mark');
  assert.equal(N('\u0085next\u009b'), 'next', 'C1 controls');
  assert.equal(N('x'.repeat(60)), 'x'.repeat(40));
  assert.equal(N('😀'.repeat(45)), '😀'.repeat(40), 'emoji count once and are never cut in half');
  assert.equal(N('a\ud800b\udc00c'), 'abc', 'stray halves of a pair go');
  assert.equal(N('👨‍👩‍👧'), '👨‍👩‍👧', 'joiners stay');
  assert.equal(N('x'.repeat(39) + ' y'), 'x'.repeat(39), 'cut, then trimmed');
  for (const x of ['', '   ', '\u0000​', null, undefined, 7, {}, ['a']]) assert.equal(N(x), '', JSON.stringify(x));
  assert.equal(PN.labelKey('Beach'), PN.labelKey('  bEACH '));
  assert.notEqual(PN.labelKey('beach'), PN.labelKey('beaches'));
});

test('tag records and comment counts from the server: only well-formed ones, each once, oldest first', () => {
  const ok = { id: TAG, fileIdx: 2, authorId: 'u1', ciphertext: 'tc1:1:x', createdAt: 20, epoch: 1 };
  const older = { ...ok, id: 'AAAAAAAAAAAAAAAAAAAAAA', createdAt: 10, messageId: 'm9' };
  const list = PN.cleanTagRecords([ok, ok, older, null, 'x', { ...ok, id: 'short' }, { ...ok, id: 'B'.repeat(22), fileIdx: 100 }, { ...ok, id: 'C'.repeat(22), fileIdx: '1' },
    { ...ok, id: 'D'.repeat(22), authorId: 'a b' }, { ...ok, id: 'E'.repeat(22), ciphertext: 'x'.repeat(1001) }, { ...ok, id: 'F'.repeat(22), messageId: '../x' }]);
  assert.deepEqual(list.map((t) => t.id), ['AAAAAAAAAAAAAAAAAAAAAA', 'F'.repeat(22), TAG], 'oldest first, then by id');
  assert.equal(list[0].messageId, 'm9');
  assert.equal('messageId' in list[1], false, 'a malformed message id is left out');
  assert.equal('epoch' in list[2], false, 'the epoch comes from the ciphertext, not from beside it');
  assert.deepEqual(PN.cleanTagRecords('x'), []);
  assert.deepEqual(PN.cleanCounts({ 0: 2, 1: 0, 2: -1, 3: 1.5, 99: 4, 100: 1, x: 1, '01': 3, 4: '2' }), { 0: 2, 99: 4 });
  assert.deepEqual(PN.cleanCounts([1, 2]), {});
  assert.equal(PN.commentCount({ 1: 3 }, 1), 3);
  assert.equal(PN.commentCount({ 1: 3 }, 0), 0);
  assert.equal(PN.commentCount({ toString: 5 }, 'toString'), 0);
  assert.equal(PN.commentCount(null, 0), 0);
});

test('photos and videos count; voice messages, songs and other files don’t', () => {
  const f = (type, name, extra = {}) => ({ url: URL1, type, name, ...extra });
  assert.equal(PN.photoCount([f('image/png', 'a.png'), f('video/mp4', 'b.mp4'), f('', 'c.webm'), f('audio/ogg', 'v.ogg', { voice: true }), f('audio/mpeg', 's.mp3'), f('application/pdf', 'd.pdf')]), 3);
  assert.equal(PN.photoCount(null), 0);
  assert.equal(PN.isPhotoOrVideo(f('image/gif', 'g.gif')), true);
  assert.equal(PN.isPhotoOrVideo(f('video/webm', 'v.webm', { voice: true })), false);
});

test('the tag index: one label for spellings that differ in case (the first made), each photo once, most used labels first', () => {
  const idx = PN.groupIndex([
    { label: 'Beach', messageId: 'm1', fileIdx: 0, createdAt: 1 },
    { label: 'beach', messageId: 'm1', fileIdx: 0, createdAt: 2 },
    { label: 'BEACH', messageId: 'm3', fileIdx: 2, createdAt: 3 },
    { label: 'cat', messageId: 'm2', fileIdx: 1, createdAt: 4 },
    { label: 'dog', messageId: 'm2', fileIdx: 0, createdAt: 5 },
    { label: '  ', messageId: 'm2', fileIdx: 0, createdAt: 6 },
    { label: 'x', messageId: 'bad id', fileIdx: 0, createdAt: 7 },
  ]);
  assert.deepEqual([...idx.keys()], ['Beach', 'cat', 'dog']);
  assert.deepEqual(idx.get('Beach'), [{ messageId: 'm3', fileIdx: 2 }, { messageId: 'm1', fileIdx: 0 }], 'the newest message first');
  // Suggestions: what's typed first as a start, then inside; never one the photo has.
  const used = [{ label: 'Beach', count: 3 }, { label: 'Sunset beach', count: 2 }, { label: 'cat', count: 1 }];
  assert.deepEqual(PN.suggestLabels(used, 'bea', []), ['Beach', 'Sunset beach']);
  assert.deepEqual(PN.suggestLabels(used, 'BEA', ['beach']), ['Sunset beach']);
  assert.deepEqual(PN.suggestLabels(used, '', ['cat']), ['Beach', 'Sunset beach']);
  assert.deepEqual(PN.suggestLabels(used, '', [], 1), ['Beach']);
});

test('which photo a comment is about: an index and an address on this server, or nothing; never an exception', () => {
  assert.deepEqual(BD.photoOf({ ph: { i: 2, u: URL1 } }), { i: 2, u: URL1 });
  assert.deepEqual(BD.photoOf({ ph: { i: 0, u: URL1, extra: 'dropped' } }), { i: 0, u: URL1 });
  for (const p of [undefined, null, 7, 'x', {}, { ph: null }, { ph: [] }, { ph: { i: -1, u: URL1 } }, { ph: { i: 100, u: URL1 } }, { ph: { i: 1.5, u: URL1 } },
    { ph: { i: '1', u: URL1 } }, { ph: { i: 1, u: 'https://evil.example/x.png' } }, { ph: { i: 1, u: '/uploads/../x' } }, { ph: { i: 1 } }]) {
    assert.equal(BD.photoOf(p), undefined, JSON.stringify(p));
  }
});

// ------------------------------------------------------------------ secure.js: sealing and opening, trust
// One device as the app sets it up: its own keys, the people it knows, a server whose key it holds (its own copy), a DM.
// Each test starts with no pins (devices in one test share the store; their pins are kept per account).
async function device(self, others, { raw, epochs = [1], current = epochs[epochs.length - 1] } = {}) {
  const users = Object.fromEntries([self, ...others].map((u) => [u.id, { id: u.id, username: u.id, publicKey: u.publicKey, signPublicKey: u.signPublicKey }]));
  const S = {
    me: users[self.id], users, privateKey: self.privateKey, signKey: self.signKey,
    servers: [{ id: 's1', memberIds: [self.id, ...others.map((u) => u.id)], channels: [{ id: 'c1', type: 'text' }] }],
    dms: others.length ? [{ id: 'd1', userId: others[0].id }] : [],
  };
  const sec = createSecure({ S });
  others.forEach((u) => sec.trust(S.users[u.id]));
  const keys = [];
  for (const epoch of epochs) {
    keys.push({ epoch, wrapperId: self.id, createdAt: Date.now(), check: await E.keyCheck(raw[epoch], 's1', epoch),
      wrapped: await E.wrapGroupKey({ raw: raw[epoch], serverId: 's1', epoch, recipientId: self.id, recipientPub: self.publicKey, wrapperId: self.id, signKey: self.signKey }) });
  }
  await sec.applyState({ serverId: 's1', keyEpoch: current, needsRotation: false, keys, missing: [] });
  return { sec, S };
}
const tagOf = (where, ciphertext, over = {}) => ({ ...where, id: TAG, messageId: 'm1', fileIndex: 1, authorId: 'alice', ciphertext, createdAt: Date.now() - 1000, ...over });

test('secure.js: a channel tag sealed with the current key and the author’s signature opens for the others; one only a new key not verified yet signed doesn’t', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey(), 2: E.newGroupKey() };
  const A = await device(alice, [bob], { raw, epochs: [1, 2] });
  const B = await device(bob, [alice], { raw, epochs: [1, 2] });
  const where = { serverId: 's1', channelId: 'c1' };
  const { ciphertext, epoch } = await A.sec.encryptTag(where, { messageId: 'm1', fileIndex: 1, tagId: TAG, payload: { n: 'beach', fu: URL2 } });
  assert.equal(epoch, 2, 'the current key');
  assert.equal(E.tagEpoch(ciphertext), 2);
  assert.deepEqual(await B.sec.openTag(tagOf(where, ciphertext)), { n: 'beach', fu: URL2 });
  assert.deepEqual(await A.sec.openTag(tagOf(where, ciphertext)), { n: 'beach', fu: URL2 }, 'its author’s own app');
  // Moved by the server: to another photo, message or author, or another conversation.
  for (const over of [{ fileIndex: 0 }, { messageId: 'm2' }, { authorId: 'bob' }, { id: 'UUUUUUUUUUUUUUUUUUUUUU' }, { channelId: 'c2' }]) {
    assert.deepEqual(await B.sec.openTag(tagOf(where, ciphertext, over)), { error: true }, JSON.stringify(over));
  }
  assert.deepEqual(await B.sec.openTag(tagOf(where, 'nonsense')), { error: true }, 'never throws');
  // Signed by someone else in Alice's name (any member holds the key): it opens, but nothing vouches for it.
  const forged = await E.encryptGroupTag({ raw: raw[2], serverId: 's1', channelId: 'c1', epoch: 2, messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: 'alice', signKey: bob.signKey, payload: { n: 'x', fu: URL2 } });
  const C = await device(await person('carol'), [alice, bob], { raw, epochs: [1, 2] });
  assert.deepEqual(await C.sec.openTag(tagOf(where, forged)), { error: true });
  // Alice's keys change and Carol hasn't verified the new ones: a tag signed with the new key doesn't count; one
  // signed back then with the key Carol pinned still does.
  const alice2 = await person('alice');
  const sealedNew = await E.encryptGroupTag({ raw: raw[2], serverId: 's1', channelId: 'c1', epoch: 2, messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: 'alice', signKey: alice2.signKey, payload: { n: 'new key', fu: URL2 } });
  C.S.users.alice = { ...C.S.users.alice, publicKey: alice2.publicKey, signPublicKey: alice2.signPublicKey };
  assert.equal(C.sec.keyChanged(C.S.users.alice), true);
  assert.deepEqual(await C.sec.openTag(tagOf(where, sealedNew)), { error: true }, 'a new key not verified yet');
  assert.deepEqual(await C.sec.openTag(tagOf(where, ciphertext)), { n: 'beach', fu: URL2 }, 'the key this device pinned for her back then');
  // Accepting her new keys (safety numbers compared) makes the new one count.
  C.sec.acceptKeys(C.S.users.alice);
  assert.deepEqual(await C.sec.openTag(tagOf(where, sealedNew)), { n: 'new key', fu: URL2 });
});

test('secure.js: a channel tag waits for a key that’s on its way, and says so when that key never comes', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey(), 2: E.newGroupKey(), 3: E.newGroupKey() };
  const A = await device(alice, [bob], { raw, epochs: [1, 2, 3] });
  const where = { serverId: 's1', channelId: 'c1' };
  const seal = (epoch) => E.encryptGroupTag({ raw: raw[epoch], serverId: 's1', channelId: 'c1', epoch, messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: 'alice', signKey: alice.signKey, payload: { n: 'later', fu: URL2 } });
  const B = await device(bob, [alice], { raw, epochs: [2] });
  assert.deepEqual(await B.sec.openTag(tagOf(where, await seal(3))), { pending: true, before: false }, 'a newer key: on its way');
  assert.deepEqual(await B.sec.openTag(tagOf(where, await seal(1))), { pending: true, before: true }, 'older than any key held: never comes');
  assert.deepEqual(await A.sec.openTag(tagOf(where, await seal(1))), { n: 'later', fu: URL2 });
});

test('secure.js: DM tags open with the key both people share, refused to write while their key changed, and not counted from an unverified key', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const A = await device(alice, [bob], { raw });
  const B = await device(bob, [alice], { raw });
  const where = { dmId: 'd1' };
  const { ciphertext } = await A.sec.encryptTag(where, { messageId: 'm1', fileIndex: 0, tagId: TAG, payload: { n: 'cat', fu: URL1 } });
  assert.match(ciphertext, /^td1:/);
  const t = { ...where, id: TAG, messageId: 'm1', fileIndex: 0, authorId: 'alice', ciphertext, createdAt: Date.now() - 1000 };
  assert.deepEqual(await B.sec.openTag(t), { n: 'cat', fu: URL1 });
  assert.deepEqual(await A.sec.openTag(t), { n: 'cat', fu: URL1 });
  assert.deepEqual(await B.sec.openTag({ ...t, fileIndex: 1 }), { error: true }, 'moved to another photo');
  assert.deepEqual(await B.sec.openTag({ ...t, dmId: 'd2' }), { error: true }, 'not a conversation this device has');
  // Bob's keys change (a password reset): Alice's app won't seal for the new key until she verifies it, and a tag
  // only the new key opens doesn't count meanwhile.
  const bob2 = await person('bob');
  A.S.users.bob = { ...A.S.users.bob, publicKey: bob2.publicKey, signPublicKey: bob2.signPublicKey };
  await assert.rejects(A.sec.encryptTag(where, { messageId: 'm1', fileIndex: 0, tagId: TAG, payload: { n: 'x', fu: URL1 } }), (e) => e.code === 'untrusted');
  const fromNew = await E.encryptDmTag({ myPriv: bob2.privateKey, theirPub: alice.publicKey, dmId: 'd1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: 'bob', payload: { n: 'new', fu: URL1 } });
  assert.deepEqual(await A.sec.openTag({ ...t, authorId: 'bob', ciphertext: fromNew }), { error: true });
  A.sec.acceptKeys(A.S.users.bob);
  assert.deepEqual(await A.sec.openTag({ ...t, authorId: 'bob', ciphertext: fromNew }), { n: 'new', fu: URL1 });
});

test('secure.js: both openers say which photo a comment is about (ph), and drop a malformed one', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const B = await device(bob, [alice], { raw });
  const base = { t: 'nice one', f: [], ...BD.bindNew({ replyTo: 'm1', at: Date.now() }) };
  const channel = async (payload) => {
    const m = { id: 'x', serverId: 's1', channelId: 'c1', authorId: 'alice', createdAt: Date.now(), replyTo: 'm1',
      ciphertext: await E.encryptGroup({ raw: raw[1], serverId: 's1', channelId: 'c1', epoch: 1, authorId: 'alice', signKey: alice.signKey, payload }) };
    await B.sec.decryptChannelMessage(m);
    return m.dec;
  };
  const dm = async (payload) => {
    const m = { id: 'y', dmId: 'd1', authorId: 'alice', createdAt: Date.now(), replyTo: 'm1',
      ciphertext: await E.encryptDm({ myPriv: alice.privateKey, theirPub: bob.publicKey, dmId: 'd1', authorId: 'alice', payload }) };
    await B.sec.decryptDmMessage(m);
    return m.dec;
  };
  for (const open of [channel, dm]) {
    const d = await open({ ...base, ph: { i: 1, u: URL2 } });
    assert.deepEqual(d.ph, { i: 1, u: URL2 });
    assert.equal(d.t, 'nice one');
    assert.equal(d.b.r, 'm1');
    for (const ph of [{ i: 200, u: URL2 }, { i: 1, u: 'https://evil.example/a.png' }, 'x', [1]]) {
      const bad = await open({ ...base, ph });
      assert.equal('ph' in bad, false, JSON.stringify(ph));
      assert.equal(bad.t, 'nice one', 'the message itself still reads');
    }
    assert.equal('ph' in (await open(base)), false, 'an ordinary reply');
  }
});

test('static: openers, edits, scheduling and sending keep the photo a comment is about; a forward doesn’t', () => {
  const secure = read('public', 'js', 'secure.js');
  assert.equal((secure.match(/\.\.\.photoIn\(payload\)/g) || []).length, 2, 'channel and DM messages');
  assert.equal((secure.match(/\.\.\.bindIn\(payload\)/g) || []).length, 2, 'still two (test/message-binding.test.js)');
  const app = read('public', 'js', 'app.js');
  const fn = (name) => app.slice(app.search(new RegExp(`^(async )?function ${name}\\(`, 'm')), app.indexOf('\n}\n', app.search(new RegExp(`^(async )?function ${name}\\(`, 'm'))));
  assert.match(fn('editBox'), /\.\.\.\(m\.dec && m\.dec\.ph \? \{ ph: m\.dec\.ph \} : \{\}\)/, 'an edit keeps it');
  const send = fn('sendOnce');
  assert.match(send, /const photo = replyTo && payload\.ph \? \{ replyFile: payload\.ph\.i \} : \{\};/);
  assert.equal((send.match(/replyTo, \.\.\.photo,/g) || []).length, 4, 'channel and DM, now and scheduled');
  assert.match(fn('sendComment'), /sendTo\(key, m\.threadId \|\| null, \{ t: text, f: \[\], ph: \{ i: fi, u: f\.url \} \}, m\.id, nonce\)/, 'through the one send path');
  assert.doesNotMatch(fn('openForward'), /\bph\b/, 'a forward is a new message, about no photo');
  const sched = read('public', 'js', 'scheduled.js');
  const body = (name) => sched.slice(sched.indexOf(`async function ${name}(`), sched.indexOf('\n  }\n', sched.indexOf(`async function ${name}(`)));
  assert.match(body('open'), /\.\.\.\(photoOf\(p\) \? \{ ph: photoOf\(p\) \} : \{\}\)/);
  assert.match(body('sealed'), /\.\.\.\(dec\.ph \? \{ ph: dec\.ph \} : \{\}\)/);
});

test('static: labels and comments go on screen as text, never as HTML', () => {
  const pn = read('public', 'js', 'photo-notes.js');
  assert.doesNotMatch(pn, /html:|innerHTML|insertAdjacentHTML|outerHTML/);
  const app = read('public', 'js', 'app.js');
  const quote = app.slice(app.indexOf('function photoQuote('), app.indexOf('\nfunction fillMessage('));
  assert.ok(quote.length > 200);
  assert.doesNotMatch(quote, /html:/);
  // The tile's counts and its button: one place in attachmentEl, only through NOTES.
  assert.equal((app.match(/NOTES\.tileExtras\(/g) || []).length, 1);
  for (const ev of ['dm:tags', 'message:tags', 'dm:file-replies', 'message:file-replies']) assert.match(app, new RegExp(`socket\\.on\\('${ev}'`), ev);
});

// ------------------------------------------------------------------ photo-notes.js against fake deps
const PHOTOS = [{ url: URL1, type: 'image/png', name: 'a.png' }, { url: URL2, type: 'image/png', name: 'b.png' }, { url: '/uploads/v3.bin', type: 'video/mp4', name: 'c.mp4' }];
const rec = (id, fileIdx, authorId, n, createdAt) => ({ id: id.padEnd(22, 'x'), fileIdx, authorId, ciphertext: `td1:${n}`, createdAt });
const tick = () => new Promise((r) => setTimeout(r, 0));
const fakeWhere = (key) => (key.startsWith('d:') ? { dmId: key.slice(2) } : key.startsWith('c:') ? { serverId: 's1', channelId: key.slice(2) } : null);
function notes({ blocked = [], where = fakeWhere } = {}) {
  const metaCalls = [];
  const opens = [];
  const loaded = new Map();
  // A fake openTag: the label is in the ciphertext (td1:<label>|<file address>), pending for 'tc1:wait', error for 'bad'.
  let keyHere = false;
  const deps = {
    me: () => ({ id: 'me' }),
    where,
    openTag: async (t) => {
      opens.push(t.id);
      if (t.ciphertext === 'tc1:wait') return keyHere ? { n: 'came later', fu: URL1 } : { pending: true, before: false };
      if (t.ciphertext.endsWith('bad')) return { error: true };
      const [n, fu] = t.ciphertext.slice(4).split('|');
      return { n, fu: fu || [URL1, URL2, '/uploads/v3.bin'][t.fileIndex] };
    },
    decrypt: async (m) => { if (!m.dec) m.dec = { t: '', f: PHOTOS }; },
    readable: (m) => !!m.dec && !m.dec.error && !m.dec.pending,
    filesOf: (m) => (m.dec && m.dec.f) || [],
    expired: () => false,
    blocked: (id) => blocked.includes(id),
    copies: (id) => (loaded.has(id) ? [loaded.get(id)] : []),
    loaded: (id) => loaded.get(id) || null,
    onMeta: (key, id) => metaCalls.push(`${key}|${id}`),
    canPost: () => null,
    canManage: () => false,
  };
  const N = PN.createPhotoNotes(deps);
  return { N, deps, metaCalls, opens, loaded, keyCame: () => { keyHere = true; } };
}

test('photo-notes: a photo’s tags open once, count only on the very file they were put on, one per label, none from someone you blocked', async () => {
  const { N, metaCalls, opens, loaded } = notes({ blocked: ['mallory'] });
  const m = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, fileReplies: { 1: 2, 7: 1 },
    tags: [rec('a', 1, 'alice', 'Beach', 1), rec('b', 1, 'bob', 'beach', 2), rec('c', 1, 'alice', 'sunset', 3), rec('d', 0, 'alice', 'cat', 4),
      rec('e', 1, 'alice', `moved|${URL1}`, 5), rec('f', 1, 'mallory', 'rude', 6), rec('g', 1, 'alice', 'bad', 7)] };
  loaded.set('m1', m);
  assert.deepEqual(N.tagsOf(m, 1), [], 'nothing until they’re opened');
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 1), ['Beach', 'sunset'], 'one per label (the oldest spelling); not one sealed for another file; not from someone blocked; not one that didn’t open');
  assert.deepEqual(N.tagsOf(m, 0), ['cat']);
  assert.deepEqual(N.counts(m, 1), { comments: 2, tags: 2 });
  assert.deepEqual(N.counts(m, 2), { comments: 0, tags: 0 });
  assert.deepEqual(metaCalls, [], 'nothing about the message changed: the Photos & videos panel isn’t told (it would fetch it again)');
  const n = opens.length;
  N.tagsOf(m, 1); N.counts(m, 0);
  await tick();
  assert.equal(opens.length, n, 'opened once each');
  // The same message fetched again (a new copy, as the Photos & videos panel would): nothing opened again.
  const copy = { ...m, tags: m.tags.map((t) => ({ ...t })) };
  assert.deepEqual(N.tagsOf(copy, 1), ['Beach', 'sunset']);
  assert.equal(opens.length, n);
  // A message that can't be read has no tags.
  assert.deepEqual(N.tagsOf({ ...m, dec: { error: true } }, 1), []);
  assert.deepEqual(N.counts({ ...m, dec: { pending: true } }, 1), { comments: 0, tags: 0 });
});

test('photo-notes: live updates replace a message’s tags and counts on every loaded copy and on copies drawn before', async () => {
  const { N, metaCalls, loaded } = notes();
  const m = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [rec('a', 1, 'alice', 'beach', 1)] };
  const panelCopy = { ...m }; // a copy the Photos & videos panel fetched itself
  loaded.set('m1', m);
  N.tagsOf(m, 1);
  await tick(); await tick();
  metaCalls.length = 0;
  N.onTags('d:d1', 'm1', [rec('a', 1, 'alice', 'beach', 1), rec('h', 1, 'carol', 'waves', 9), { junk: true }]);
  assert.equal(m.tags.length, 2, 'the loaded copy takes the new list (cleaned)');
  assert.ok(metaCalls.includes('d:d1|m1'));
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 1), ['beach', 'waves']);
  assert.deepEqual(N.tagsOf(panelCopy, 1), ['beach', 'waves'], 'a copy drawn before reads the latest');
  N.onTags('d:d1', 'm1', []);
  assert.deepEqual(N.tagsOf(panelCopy, 1), [], 'all removed');
  N.onFileReplies('d:d1', 'm1', { 1: 3, x: 9 });
  assert.deepEqual(m.fileReplies, { 1: 3 });
  assert.equal(N.counts(panelCopy, 1).comments, 3);
  // Events about that id in another conversation, or with a bad id, change nothing here.
  N.onFileReplies('d:other', 'm1', { 1: 5 });
  N.onTags('d:other', 'm1', [rec('z', 1, 'alice', 'x', 1)]);
  assert.deepEqual(m.fileReplies, { 1: 3 });
  assert.equal(N.counts(panelCopy, 1).comments, 3);
  assert.deepEqual(m.tags, []);
  N.onTags('d:d1', '../m1', [rec('z', 1, 'alice', 'x', 1)]);
  assert.deepEqual(m.tags, []);
  // Back online: what came live is forgotten, the copies loaded again say it.
  N.reconnected();
  assert.equal(N.counts({ ...panelCopy, fileReplies: { 1: 1 } }, 1).comments, 1);
});

test('photo-notes: a tag waiting for its key opens when the key comes', async () => {
  const { N, loaded, keyCame } = notes();
  const m = { id: 'm5', channelId: 'c1', serverId: 's1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [{ ...rec('w', 0, 'alice', '', 1), ciphertext: 'tc1:wait' }] };
  loaded.set('m5', m);
  N.tagsOf(m, 0);
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 0), []);
  keyCame();
  N.onKeys('s1');
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 0), ['came later']);
});

test('photo-notes: the tag index for the Photos & videos panel fetches the tags once, and the messages it lacks a hundred at a time', async () => {
  const { N, loaded } = notes();
  const m1 = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS } };
  loaded.set('m1', m1);
  const tags = [
    { ...rec('a', 1, 'alice', 'Beach', 1), messageId: 'm1' },
    { ...rec('b', 0, 'bob', 'beach', 2), messageId: 'm2' },
    { ...rec('c', 2, 'alice', 'video', 3), messageId: 'm2' },
    { ...rec('d', 1, 'alice', `elsewhere|${URL1}`, 4), messageId: 'm2' }, // sealed for another file
    { ...rec('e', 0, 'alice', 'gone', 5), messageId: 'm3' }, // a message the server no longer gives
  ];
  asked.length = 0;
  routes = (url) => {
    if (url === '/api/dms/d1/tags') return { tags };
    if (url.startsWith('/api/dms/d1/media?')) {
      const ids = new URL(url, 'http://x').searchParams.get('ids').split(',');
      return { messages: ids.filter((id) => id === 'm2').map((id) => ({ id, dmId: 'd1', authorId: 'alice', createdAt: 1 })), next: null };
    }
    return null;
  };
  const idx = await N.tagIndex('d:d1');
  assert.deepEqual([...idx.keys()], ['Beach', 'video']);
  assert.deepEqual(idx.get('Beach'), [{ messageId: 'm2', fileIdx: 0 }, { messageId: 'm1', fileIdx: 1 }]);
  assert.deepEqual(idx.get('video'), [{ messageId: 'm2', fileIdx: 2 }]);
  const media = asked.filter(([, u]) => u.includes('/media?'));
  assert.equal(media.length, 1);
  assert.deepEqual(new URL(media[0][1], 'http://x').searchParams.get('ids').split(',').sort(), ['m2', 'm3'], 'only the ones not loaded here');
  // Asked again (the panel asks after every change it hears of): the same answer, worked out once.
  asked.length = 0;
  assert.equal(await N.tagIndex('d:d1'), idx);
  assert.equal(asked.length, 0, 'nothing fetched');
  // A live update is folded in: worked out again, without fetching the list again nor asking for a message the server
  // didn't give last time.
  N.onTags('d:d1', 'm1', [rec('a', 1, 'alice', 'Beach', 1), rec('k', 0, 'carol', 'cat', 8)]);
  const again = await N.tagIndex('d:d1');
  assert.notEqual(again, idx);
  assert.deepEqual(again.get('cat'), [{ messageId: 'm1', fileIdx: 0 }]);
  assert.deepEqual(asked, [], 'no request at all');
  assert.deepEqual(await N.tagIndex('x:nowhere'), new Map(), 'a conversation this app doesn’t have');
});
