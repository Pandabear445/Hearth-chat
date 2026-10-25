// Photo comments and tags, the app's side (public/js/photo-notes.js, e2ee.js tc1 / td1, secure.js encryptTag / openTag,
// binding.js photoOf). The modules run here as they are, with the same WebCrypto the browser uses. Proves that a tag
// opens only where it was put (that photo of that message, by that person, in that conversation and key epoch), that a
// tag and a message can never pass for one another, that tampering is caught, that only tags vouched for by a key this
// device trusts count (and only those are suggested or filtered by), that labels come out as short plain text, that a
// comment keeps the photo it's about through opening, edits and scheduling and is only listed under that photo, and
// that the side panel (on a page small enough for Node) keeps what it loaded, its focus and the user's Enter setting.
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
  const body = await routes(String(url), opts); // (a route may answer later: a Promise)
  return { ok: body !== null, status: body === null ? 404 : 200, headers: { get: () => null }, json: async () => body || { error: 'Not found.' } };
};

// The elements the side panel is made of (util.js h), enough of them to draw it, type in it, click and focus. Only
// what's under page.body is on screen. (document.querySelectorAll still finds nothing: no picture is drawn here.)
class FakeNode {
  constructor() { this.parentNode = null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === page.body; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class FakeText extends FakeNode {
  constructor(s) { super(); this.data = String(s); }
  get textContent() { return this.data; }
}
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = { setProperty() {} }; this.on = {}; this.value = ''; this.className = ''; }
  get classList() {
    const set = (on) => (c) => { const l = this.className.split(/\s+/).filter((x) => x && x !== c); this.className = (on ? [...l, c] : l).join(' '); };
    return { contains: (c) => this.className.split(/\s+/).includes(c), add: set(true), remove: set(false), toggle: (c, on) => set(on === undefined ? !this.classList.contains(c) : on)(c) };
  }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? new FakeText(k) : k; if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); } }
  appendChild(k) { this.append(k); return k; }
  removeChild(k) { this.children = this.children.filter((x) => x !== k); k.parentNode = null; return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  get firstChild() { return this.children[0] || null; }
  get lastElementChild() { return [...this.children].reverse().find((c) => c instanceof FakeEl) || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return 'disabled' in this.attrs; }
  set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  set innerHTML(v) { this.html = v; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(v ? [String(v)] : [])); }
  addEventListener(type, fn) { (this.on[type] = this.on[type] || []).push(fn); }
  removeEventListener() {}
  fire(type, props = {}) {
    const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
    for (const fn of this.on[type] || []) fn(e);
    return e;
  }
  focus() { globalThis.document.activeElement = this; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  // 'tag', '.class' or 'tag.class'
  matches(sel) { const [, tag, cls] = /^([a-z]*)(?:\.([\w-]+))?$/.exec(sel) || []; return (!tag || this.tagName === tag.toUpperCase()) && (!cls || this.classList.contains(cls)); }
  closest(sel) { for (let x = this; x instanceof FakeEl; x = x.parentNode) if (x.matches(sel)) return x; return null; }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) if (c instanceof FakeEl) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  scrollIntoView() {}
}
globalThis.Node = FakeNode;
const page = { body: new FakeEl('body') };
Object.assign(globalThis.document, { createElement: (t) => new FakeEl(t), createTextNode: (s) => new FakeText(s), body: page.body, activeElement: null });
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => root.querySelectorAll(sel);

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

test('secure.js: a tag whose author’s keys couldn’t be looked up (offline, the server busy) says it’s worth trying again; one that doesn’t check out doesn’t', async () => {
  const alice = await person('alice'); const bob = await person('bob'); const carol = await person('carol');
  const raw = { 1: E.newGroupKey() };
  const B = await device(bob, [alice], { raw });
  const where = { serverId: 's1', channelId: 'c1' };
  const sealed = await E.encryptGroupTag({ raw: raw[1], serverId: 's1', channelId: 'c1', epoch: 1, messageId: 'm1', fileIndex: 1, tagId: TAG, authorId: 'carol', signKey: carol.signKey, payload: { n: 'x', fu: URL2 } });
  routes = () => null; // GET /users/carol fails
  assert.deepEqual(await B.sec.openTag(tagOf(where, sealed, { authorId: 'carol' })), { error: true, retry: true });
  assert.deepEqual(await B.sec.openTag(tagOf(where, tamper(sealed, 4), { authorId: 'alice' })), { error: true }, 'tampered with: final');
  // In a DM: the other person's keys not known here yet, and not to be had right now.
  const at = { dmId: 'd1', messageId: 'm1', fileIndex: 0, tagId: TAG, authorId: 'alice' };
  const dmTag = { ...at, id: TAG, fileIndex: 0, ciphertext: await E.encryptDmTag({ myPriv: alice.privateKey, theirPub: bob.publicKey, ...at, payload: { n: 'cat', fu: URL1 } }), createdAt: Date.now() - 1000 };
  assert.deepEqual(await B.sec.openTag(dmTag), { n: 'cat', fu: URL1 });
  B.S.users.alice = { id: 'alice', username: 'alice' };
  assert.deepEqual(await B.sec.openTag(dmTag), { error: true, retry: true });
  assert.deepEqual(await B.sec.openTag({ ...dmTag, dmId: 'd2' }), { error: true }, 'a conversation this device doesn’t have: final');
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
function notes({ blocked = [], where = fakeWhere, files = PHOTOS, enterSends = true, sendComment = null, retryAfter = 5 } = {}) {
  const metaCalls = [];
  const indexCalls = [];
  const opens = [];
  const loaded = new Map();
  const gone = new Set(); // ids of messages whose time has come
  const armed = { n: 0 }; // times the app's disappearing timer was asked to look again
  // A fake openTag: the label is in the ciphertext (td1:<label>|<file address>), pending for 'tc1:wait', error for
  // 'bad' (or 'untrusted' until their key is accepted), and for 'blip' its author's keys can't be looked up at first.
  let keyHere = false;
  let accepted = false;
  let blips = 0;
  const deps = {
    me: () => ({ id: 'me' }),
    where,
    openTag: async (t) => {
      opens.push(t.id);
      if (t.ciphertext === 'tc1:wait') return keyHere ? { n: 'came later', fu: URL1 } : { pending: true, before: false };
      if (t.ciphertext.endsWith('bad')) return { error: true };
      if (t.ciphertext.endsWith('untrusted') && !accepted) return { error: true };
      if (t.ciphertext.endsWith('blip') && blips > 0) { blips -= 1; return { error: true, retry: true }; }
      const [n, fu] = t.ciphertext.slice(4).split('|');
      return { n, fu: fu || [URL1, URL2, '/uploads/v3.bin'][t.fileIndex] };
    },
    encryptTag: async (w, tag) => ({ ciphertext: `td1:${tag.payload.n}|${tag.payload.fu}` }),
    decrypt: async (m) => { if (!m.dec) m.dec = { t: '', f: files }; },
    readable: (m) => !!m.dec && !m.dec.error && !m.dec.pending,
    filesOf: (m) => (m.dec && m.dec.f) || [],
    expired: (m) => gone.has(m.id),
    blocked: (id) => blocked.includes(id),
    getUser: (id) => ({ id, username: id }),
    nameOf: (m, u) => u.username,
    avatar: () => document.createElement('span'),
    textEl: (c) => { const el = document.createElement('div'); el.append(c.dec.t); return el; },
    canPost: () => null,
    canManage: () => false,
    sendComment: sendComment || (async () => null),
    enterSends: () => enterSends,
    spellBox() {},
    spelled: (ta) => ta.value,
    spellcheck: () => 'true',
    copies: (id) => (loaded.has(id) ? [loaded.get(id)] : []),
    loaded: (id) => loaded.get(id) || null,
    onMeta: (key, id) => metaCalls.push(`${key}|${id}`),
    onIndex: (key) => indexCalls.push(key),
    openMessage() {},
    armExpiry: () => { armed.n += 1; },
    retryAfter,
  };
  const N = PN.createPhotoNotes(deps);
  return { N, deps, metaCalls, indexCalls, opens, loaded, gone, armed, keyCame: () => { keyHere = true; }, accept: () => { accepted = true; }, blip: (n) => { blips = n; } };
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

test('photo-notes: a tag waiting for its key opens when the key comes, and the Photos & videos panel’s chips are worked out again', async () => {
  const { N, loaded, keyCame, indexCalls } = notes();
  const m = { id: 'm5', channelId: 'c1', serverId: 's1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [{ ...rec('w', 0, 'alice', '', 1), ciphertext: 'tc1:wait' }] };
  loaded.set('m5', m);
  N.tagsOf(m, 0);
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 0), []);
  keyCame();
  N.onKeys('s1');
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 0), ['came later']);
  assert.deepEqual(indexCalls, ['c:c1']);
  N.onKeys('s2');
  assert.deepEqual(indexCalls, ['c:c1'], 'another server’s keys: nothing to do here');
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

// ------------------------------------------------------------------ which comments a photo lists (isCommentOn)
const appLike = { readable: (m) => !!m.dec && !m.dec.error && !m.dec.pending, expired: (m) => !!m.gone, blocked: (id) => id === 'mallory' };
test('a comment counts only under the very photo and message it says it’s about, written by an app this device trusts, in the same conversation', () => {
  const m = { id: 'm1', dmId: 'd1', authorId: 'alice' };
  const f = { url: URL2, type: 'image/png', name: 'b.png' };
  const c = (over = {}, dec = {}) => ({ id: 'c1', dmId: 'd1', authorId: 'bob', createdAt: 1, ...over, dec: { t: 'nice', f: [], ph: { i: 1, u: URL2 }, b: { r: 'm1', u: 'x', v: 0 }, ...dec } });
  const on = (x, mm = m, ff = f, fi = 1) => PN.isCommentOn(x, mm, ff, fi, appLike);
  assert.equal(on(c()), true);
  assert.equal(on(c({}, { keyNote: 'pinned' })), true, 'opened with a key this device pinned for them back then');
  for (const [what, x] of [
    ['about another photo’s address', c({}, { ph: { i: 1, u: URL1 } })],
    ['about the photo before', c({}, { ph: { i: 0, u: URL2 } })],
    ['about the photo after', c({}, { ph: { i: 2, u: URL2 } })],
    ['about no photo: an ordinary reply', c({}, { ph: undefined })],
    ['written as a reply to another message (the server moved it)', c({}, { b: { r: 'm9', u: 'x', v: 0 } })],
    ['nothing inside says what it replies to', c({}, { b: undefined })],
    ['opened only with a new key not verified yet', c({}, { keyNote: 'new' })],
    ['opened only with a key the server merely lists', c({}, { keyNote: 'listed' })],
    ['in another DM', c({ dmId: 'd2' })],
    ['in a channel', c({ dmId: undefined, channelId: 'c1', serverId: 's1' }, { verified: true })],
    ['from someone you blocked', c({ authorId: 'mallory' })],
    ['disappeared', c({ gone: true })],
    ['didn’t open', { id: 'c1', dmId: 'd1', authorId: 'bob', dec: { error: true } }],
    ['still waiting for its key', { id: 'c1', dmId: 'd1', authorId: 'bob', dec: { pending: true } }],
    ['not opened at all', { id: 'c1', dmId: 'd1', authorId: 'bob' }],
  ]) assert.equal(on(x), false, what);
  assert.equal(on(c(), m, f, 0), false, 'listed under photo 1 of the same message');
  assert.equal(on(c(), { ...m, id: 'm2' }), false, 'listed under another message');
  assert.equal(on(null), false);
  // In a channel: only a message that verified as its author's.
  const cm = { id: 'm1', channelId: 'c1', serverId: 's1', authorId: 'alice' };
  const cc = (dec) => c({ dmId: undefined, channelId: 'c1', serverId: 's1' }, dec);
  assert.equal(on(cc({ verified: true }), cm), true);
  assert.equal(on(cc({ verified: false }), cm), false, 'its signature didn’t check out');
  assert.equal(on(cc({}), cm), false, 'not verified either');
  assert.equal(on(cc({ verified: true }), { ...cm, channelId: 'c2' }), false, 'in another channel');
});

test('a real comment, as both openers give it, is listed under its photo and nowhere else', async () => {
  const alice = await person('alice'); const bob = await person('bob');
  const raw = { 1: E.newGroupKey() };
  const B = await device(bob, [alice], { raw });
  const payload = { t: 'nice one', f: [], ...BD.bindNew({ replyTo: 'm1', at: Date.now() }), ph: { i: 1, u: URL2 } };
  const ch = { id: 'x', serverId: 's1', channelId: 'c1', authorId: 'alice', createdAt: Date.now(), replyTo: 'm1',
    ciphertext: await E.encryptGroup({ raw: raw[1], serverId: 's1', channelId: 'c1', epoch: 1, authorId: 'alice', signKey: alice.signKey, payload }) };
  await B.sec.decryptChannelMessage(ch);
  const dm = { id: 'y', dmId: 'd1', authorId: 'alice', createdAt: Date.now(), replyTo: 'm1',
    ciphertext: await E.encryptDm({ myPriv: alice.privateKey, theirPub: bob.publicKey, dmId: 'd1', authorId: 'alice', payload }) };
  await B.sec.decryptDmMessage(dm);
  const f = { url: URL2, type: 'image/png', name: 'b.png' };
  for (const [c, m] of [[ch, { id: 'm1', serverId: 's1', channelId: 'c1' }], [dm, { id: 'm1', dmId: 'd1' }]]) {
    assert.equal(PN.isCommentOn(c, m, f, 1, appLike), true, c.id);
    assert.equal(PN.isCommentOn(c, { ...m, id: 'm2' }, f, 1, appLike), false, 'the server says it replies to another message');
    assert.equal(PN.isCommentOn(c, m, f, 0, appLike), false, 'the server counts it under another photo');
    assert.equal(PN.isCommentOn(c, m, { ...f, url: URL1 }, 1, appLike), false, 'that message’s files changed since');
  }
});

// ------------------------------------------------------------------ what the server keeps; label length
test('photo-notes: no comment or tag controls on a photo the server keeps none for (a forward from before it counted files); an older server that doesn’t say keeps today’s', async () => {
  assert.equal(PN.serverKeeps({ files: 3 }, 2), true);
  assert.equal(PN.serverKeeps({ files: 3 }, 3), false);
  assert.equal(PN.serverKeeps({ files: 0 }, 0), false, 'a forward from before v21');
  assert.equal(PN.serverKeeps({}, 5), true, 'an older server: not known, so as before');
  assert.equal(PN.serverKeeps({ files: 3 }, -1), false);
  assert.equal(PN.serverKeeps({ files: 3 }, 1.5), false);
  const { N } = notes();
  routes = () => null;
  const m = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, files: 0 };
  for (const fi of [0, 1, 2]) {
    assert.deepEqual(N.tileExtras(m, fi, () => {}), [], `no counts or button on photo ${fi + 1}`);
    assert.equal(N.side({ m, f: PHOTOS[fi], fi }), null, 'no side panel: nothing to show, and nothing could be added');
  }
  const two = { ...m, files: 2 };
  assert.deepEqual(N.tileExtras(two, 2, () => {}), [], 'past the count');
  assert.equal(N.tileExtras(two, 1, () => {}).length, 2, 'within it: the counts and the button');
  assert.equal(N.tileExtras({ ...m, files: undefined }, 2, () => {}).length, 2, 'an older server');
  assert.ok(N.side({ m: two, f: PHOTOS[1], fi: 1 }));
});

test('labels: the tag box takes 40 whole characters, an emoji once (as normLabel counts them, not as a browser’s maxlength would)', async () => {
  assert.equal(PN.fitLabel('😀'.repeat(30)), null, '30 emoji fit');
  assert.deepEqual(PN.fitLabel('😀'.repeat(45)), { value: '😀'.repeat(40), caret: 80 });
  assert.equal(PN.fitLabel('x'.repeat(40)), null);
  assert.deepEqual(PN.fitLabel(`ab${'x'.repeat(50)}`, 1), { value: `ab${'x'.repeat(38)}`, caret: 1 }, 'the cursor stays where it was');
  assert.equal(PN.normLabel(PN.fitLabel('🇫🇷'.repeat(25)).value), '🇫🇷'.repeat(20), 'a flag is two characters, as normLabel counts');
  const { N, loaded } = notes();
  routes = () => null;
  const m = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS } };
  loaded.set('m1', m);
  const el = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(el);
  const box = $(el, 'input.pn-tag-in');
  assert.ok(Number(box.getAttribute('maxlength')) >= 2 * PN.LABEL_MAX, 'maxlength never cuts 40 emoji short');
  box.value = '😀'.repeat(45);
  box.selectionEnd = box.value.length;
  box.fire('input');
  assert.equal(box.value, '😀'.repeat(40));
  assert.equal($$(el, 'p.pn-note')[0].textContent, 'A tag can be at most 40 characters.');
  box.value = 'x'.repeat(41);
  box.selectionEnd = 41;
  box.fire('input', { isComposing: true });
  assert.equal(box.value.length, 41, 'not while an input method is composing');
  box.fire('compositionend');
  assert.equal(box.value, 'x'.repeat(40));
  el.remove();
});

// ------------------------------------------------------------------ the chips and suggestions, deletes and expiry
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
const suggestions = (el) => $$(el, '.pn-suggestion').map((b) => b.textContent);

test('photo-notes: the chips and the suggestions only have tags that count: not one sealed for another file, nor one on a file that isn’t a photo or video', async () => {
  const files = [PHOTOS[0], PHOTOS[1], { url: '/uploads/v3.bin', type: 'application/pdf', name: 'notes.pdf' }];
  const { N, loaded } = notes({ files });
  const m1 = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: files } };
  loaded.set('m1', m1);
  const tags = [
    { ...rec('a', 0, 'alice', 'real', 1), messageId: 'm1' },
    { ...rec('b', 2, 'mallory', 'planted on a pdf', 2), messageId: 'm1' }, // sealed for the PDF's address
    { ...rec('c', 1, 'mallory', `planted elsewhere|${URL1}`, 3), messageId: 'm1' },
    { ...rec('d', 0, 'mallory', `planted again|${URL2}`, 4), messageId: 'm1' },
  ];
  routes = (url) => (url === '/api/dms/d1/tags' ? { tags } : null);
  const idx = await N.tagIndex('d:d1');
  assert.deepEqual([...idx.keys()], ['real'], 'no chip that filters to nothing');
  assert.deepEqual(N.tagsOf(m1, 2), [], 'nothing counts on the PDF');
  const el = N.side({ m: m1, f: files[1], fi: 1 });
  page.body.append(el);
  await settle();
  assert.deepEqual(suggestions(el), ['#real'], 'only what counts is suggested');
  el.remove();
});

test('photo-notes: a deleted or disappeared message leaves the tag index, its chips and the suggestions, and its copy is let go; nothing is fetched again', async () => {
  const { N, loaded, indexCalls, gone } = notes();
  const m1 = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS } };
  loaded.set('m1', m1);
  const tags = [
    { ...rec('a', 0, 'alice', 'beach', 1), messageId: 'm1' },
    { ...rec('b', 1, 'alice', 'beach', 2), messageId: 'm2' },
    { ...rec('c', 0, 'alice', 'only on m2', 3), messageId: 'm2' },
    { ...rec('d', 0, 'alice', 'only on m3', 4), messageId: 'm3' },
  ];
  routes = (url) => {
    if (url === '/api/dms/d1/tags') return { tags };
    if (url.startsWith('/api/dms/d1/media?')) return { messages: ['m2', 'm3'].map((id) => ({ id, dmId: 'd1', authorId: 'alice', createdAt: 1 })), next: null };
    return null;
  };
  const el = N.side({ m: m1, f: PHOTOS[1], fi: 1 });
  page.body.append(el);
  let idx = await N.tagIndex('d:d1');
  assert.equal(idx.get('beach').length, 2);
  assert.deepEqual(N.messages().map((m) => m.id).sort(), ['m2', 'm3'], 'the copies it fetched, for the disappearing timer');
  await settle();
  assert.deepEqual(suggestions(el), ['#beach', '#only on m2', '#only on m3']);
  asked.length = 0;
  indexCalls.length = 0;
  N.onDelete('d:d1', new Set(['m2']));
  assert.deepEqual(indexCalls, ['d:d1'], 'the Photos & videos panel’s chips are worked out again');
  assert.deepEqual(suggestions(el), ['#beach', '#only on m3'], 'not suggested any more, at once');
  idx = await N.tagIndex('d:d1');
  assert.deepEqual([...idx.keys()], ['beach', 'only on m3']);
  assert.deepEqual(idx.get('beach'), [{ messageId: 'm1', fileIdx: 0 }], '“#beach 1”');
  assert.deepEqual(asked, [], 'nothing fetched again');
  assert.deepEqual(N.messages().map((m) => m.id), ['m3'], 'its copy let go');
  // m3's time comes while only this holds it: the app's disappearing timer says so (expire).
  gone.add('m3');
  N.expire();
  assert.deepEqual([...(await N.tagIndex('d:d1')).keys()], ['beach']);
  assert.deepEqual(N.messages(), []);
  assert.deepEqual(suggestions(el), ['#beach']);
  // Gone from somewhere the app had it (the conversation not known): the same.
  N.onDelete(null, ['m1']);
  assert.deepEqual([...(await N.tagIndex('d:d1')).keys()], []);
  assert.deepEqual(asked, []);
  el.remove();
});

test('photo-notes: a tag that didn’t open is opened again a little later when its author’s keys couldn’t be looked up, once their key is verified, and after reconnecting', async () => {
  const { N, loaded, opens, indexCalls, accept, blip } = notes({ retryAfter: 150 });
  blip(1);
  const m = { id: 'm1', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [rec('a', 0, 'alice', 'sea blip', 1), rec('b', 1, 'bob', 'new key untrusted', 2)] };
  loaded.set('m1', m);
  assert.deepEqual(N.tagsOf(m, 0), []);
  await tick(); await tick();
  assert.deepEqual(N.tagsOf(m, 0), [], 'its author’s keys couldn’t be looked up');
  await new Promise((r) => setTimeout(r, 200));
  await settle();
  assert.deepEqual(N.tagsOf(m, 0), ['sea blip'], 'tried again a little later');
  assert.deepEqual(N.tagsOf(m, 1), [], 'one that doesn’t check out isn’t tried again by itself…');
  const n = opens.length;
  await new Promise((r) => setTimeout(r, 200));
  N.tagsOf(m, 1);
  await settle();
  assert.equal(opens.length, n, '…nor every time it’s drawn');
  // Bob's new key verified (safety numbers compared): it counts now.
  accept();
  indexCalls.length = 0;
  N.onTrust('bob');
  await settle();
  assert.deepEqual(N.tagsOf(m, 1), ['new key untrusted']);
  assert.deepEqual(indexCalls, ['d:d1'], 'the Photos & videos panel’s chips are worked out again');
  // Offline for a while: back online, it's tried again at once.
  blip(1000);
  N.onTags('d:d1', 'm1', [...m.tags, rec('c', 2, 'alice', 'wave blip', 3)]);
  await settle();
  assert.deepEqual(N.tagsOf(m, 2), []);
  blip(0);
  N.reconnected();
  await settle();
  assert.deepEqual(N.tagsOf(m, 2), ['wave blip']);
});

test('photo-notes: in a conversation with more tagged messages than used to be kept, a tag change works the index out again without fetching them again', async () => {
  const { N } = notes();
  const ids = Array.from({ length: 1500 }, (_, i) => `n${String(i).padStart(4, '0')}`);
  const tags = ids.map((id, i) => ({ ...rec(`t${i}`, 0, 'alice', 'big', i), messageId: id }));
  routes = (url) => {
    if (url === '/api/dms/d1/tags') return { tags };
    if (url.startsWith('/api/dms/d1/media?')) return { messages: new URL(url, 'http://x').searchParams.get('ids').split(',').map((id) => ({ id, dmId: 'd1', authorId: 'bob', createdAt: 1 })), next: null };
    return null;
  };
  asked.length = 0;
  assert.equal((await N.tagIndex('d:d1')).get('big').length, 1500);
  assert.equal(asked.filter(([, u]) => u.includes('/media?')).length, 15, 'a hundred at a time');
  asked.length = 0;
  for (const [i, id] of ids.slice(0, 3).entries()) {
    N.onTags('d:d1', id, [rec(`new${i}`, 1, 'carol', 'more', 9999)]);
    await N.tagIndex('d:d1');
  }
  const idx = await N.tagIndex('d:d1');
  assert.equal(idx.get('big').length, 1497);
  assert.equal(idx.get('more').length, 3);
  assert.deepEqual(asked, [], 'every message it needs was kept');
});

// ------------------------------------------------------------------ the side panel's comments
const cid = (i) => `c${String(i).padStart(4, '0')}`; // ids that sort in the order they were made, as the server's
const comment = (i) => ({ id: cid(i), dmId: 'd1', authorId: 'bob', createdAt: i, dec: { t: `comment ${i}`, f: [], ph: { i: 1, u: URL2 }, b: { r: 'm1', u: `u${i}`, v: 0 } } });
// GET …/comments as the server answers it: oldest first, after ?after, ?limit at most, next when the page is full.
function commentsPage(all, url) {
  const q = new URL(url, 'http://x').searchParams;
  const list = all.filter((c) => !q.get('after') || c.id > q.get('after')).slice(0, Number(q.get('limit')));
  return { messages: list.map((c) => ({ ...c, dec: { ...c.dec } })), next: list.length === Number(q.get('limit')) ? list[list.length - 1].id : null };
}
const shown = (el) => $$(el, 'li.pn-c').length;
const heading = (el) => $(el, '.pn-count').textContent;
const photoMsg = (over = {}) => ({ id: 'm1', dmId: 'd1', authorId: 'alice', dec: { t: '', f: PHOTOS }, ...over });

test('photo-notes: on a photo with more than a page of comments, a reload keeps what Show more loaded and the comment you just sent; the heading counts them all', async () => {
  const all = Array.from({ length: 150 }, (_, i) => comment(i + 1));
  const send = async () => { const c = comment(all.length + 1); all.push(c); return { ...c, dec: { ...c.dec } }; };
  routes = (url) => (url.startsWith('/api/dm-messages/m1/comments?') ? commentsPage(all, url) : null);
  const { N, loaded } = notes({ sendComment: send });
  const m = photoMsg({ fileReplies: { 1: 150 } });
  loaded.set('m1', m);
  const el = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(el);
  await settle();
  assert.equal(shown(el), 100);
  assert.equal(heading(el), '150', 'the server’s count while some aren’t loaded');
  assert.equal($(el, '.pn-more').hidden, false);
  $(el, '.pn-more').fire('click');
  await settle();
  assert.equal(shown(el), 150);
  assert.equal($(el, '.pn-more').hidden, true);
  // Someone else comments: loaded again, all of them and the new one.
  all.push(comment(151));
  N.onFileReplies('d:d1', 'm1', { 1: 151 });
  await settle();
  assert.equal(shown(el), 151, 'what Show more loaded stays');
  assert.equal(heading(el), '151');
  // Your own: shown at once, and still there after the reload its count brings.
  const ta = $(el, 'textarea.pn-box');
  ta.value = 'mine';
  ta.fire('keydown', { key: 'Enter' });
  await settle();
  assert.equal(shown(el), 152);
  N.onFileReplies('d:d1', 'm1', { 1: 152 });
  await settle();
  assert.equal(shown(el), 152);
  assert.match($$(el, 'li.pn-c')[151].textContent, /comment 152/);
  el.remove();

  // Only the first page loaded: a reload stays at one page, until you comment; then it goes as far as yours.
  const two = notes({ sendComment: send });
  two.loaded.set('m1', m);
  const el2 = two.N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(el2);
  await settle();
  assert.equal(shown(el2), 100);
  two.N.onFileReplies('d:d1', 'm1', { 1: 152 });
  await settle();
  assert.equal(shown(el2), 100, 'one page, as before');
  const ta2 = $(el2, 'textarea.pn-box');
  ta2.value = 'mine again';
  ta2.fire('keydown', { key: 'Enter' });
  await settle();
  assert.equal(shown(el2), 101, 'yours shows at once');
  two.N.onFileReplies('d:d1', 'm1', { 1: 153 });
  await settle();
  assert.equal(shown(el2), 153, 'loaded as far as yours');
  assert.equal($(el2, '.pn-more').hidden, true);
  // A comment deleted (or gone on its timer) leaves the list.
  two.N.onDelete('d:d1', [cid(153)]);
  assert.equal(shown(el2), 152);
  el2.remove();
});

test('photo-notes: two side panels on one photo share one load and are both drawn when it ends; Show more during a reload asks for the next page after it', async () => {
  const all = Array.from({ length: 120 }, (_, i) => comment(i + 1));
  const held = [];
  routes = (url) => (url.startsWith('/api/dm-messages/m1/comments?') ? new Promise((resolve) => held.push(() => resolve(commentsPage(all, url)))) : null);
  const { N, loaded } = notes();
  const m = photoMsg({ fileReplies: { 1: 120 } });
  loaded.set('m1', m);
  const p1 = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(p1);
  await tick();
  assert.equal(held.length, 1, 'one request');
  // Flipped to another photo and back while it loads: a new panel on the same photo.
  p1.remove();
  const p2 = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(p2);
  await tick();
  assert.equal(held.length, 1, 'it waits for the one under way');
  assert.match(p2.textContent, /Loading…/);
  held.shift()();
  await settle();
  assert.equal(shown(p2), 100, 'the new panel is drawn too');
  assert.equal(held.length, 1, 'and the load it asked for comes once after');
  held.shift()();
  await settle();
  assert.equal(held.length, 0);
  // A comment comes (one reload for both panels), and Show more is pressed while that's under way.
  N.onFileReplies('d:d1', 'm1', { 1: 120 });
  await tick();
  assert.equal(held.length, 1);
  $(p2, '.pn-more').fire('click');
  await tick();
  assert.equal(held.length, 1, 'Show more waits for it');
  held.shift()();
  await settle();
  assert.equal(held.length, 1, 'then asks for the next page');
  assert.match(asked[asked.length - 1][1], /after=c0100/);
  held.shift()();
  await settle();
  assert.equal(shown(p2), 120);
  assert.equal($(p2, '.pn-more').hidden, true);
  p2.remove();
});

test('photo-notes: the comment box follows “Enter sends the message”', async () => {
  routes = () => null;
  for (const enterSends of [true, false]) {
    const sent = [];
    const { N, loaded } = notes({ enterSends, sendComment: async (item, text) => { sent.push(text); return null; } });
    loaded.set('m1', photoMsg());
    const el = N.side({ m: photoMsg(), f: PHOTOS[1], fi: 1 });
    page.body.append(el);
    const ta = $(el, 'textarea.pn-box');
    assert.equal($(el, '.pn-send').getAttribute('data-tip'), enterSends ? 'Send (Enter)' : 'Send (Ctrl+Enter)');
    const press = async (keys) => { ta.value = JSON.stringify(keys); const e = ta.fire('keydown', { key: 'Enter', ...keys }); await settle(); return e.defaultPrevented; };
    assert.equal(await press({}), enterSends, 'Enter');
    assert.equal(await press({ shiftKey: true }), false, 'Shift+Enter: a new line');
    assert.equal(await press({ ctrlKey: true }), true, 'Ctrl+Enter');
    assert.equal(await press({ metaKey: true }), true, '⌘+Enter');
    assert.equal(await press({ isComposing: true }), false, 'an input method composing a word');
    assert.deepEqual(sent.map((s) => JSON.parse(s)), [...(enterSends ? [{}] : []), { ctrlKey: true }, { metaKey: true }]);
    el.remove();
  }
});

test('photo-notes: removing a tag, or someone else’s tag change, keeps keyboard focus among the tags, and says what happened', async () => {
  routes = (url, opts) => (opts.method === 'DELETE' ? {} : null);
  const { N, loaded } = notes();
  const m = photoMsg({ tags: [rec('a', 1, 'me', 'first', 1), rec('b', 1, 'me', 'second', 2), rec('c', 1, 'me', 'third', 3)] });
  loaded.set('m1', m);
  N.tagsOf(m, 1);
  await settle();
  const el = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(el);
  const x = (label) => $$(el, '.chip-x').find((b) => b.dataset.label === label);
  x('second').focus();
  x('second').fire('click');
  await settle();
  assert.deepEqual($$(el, '.pn-chip-text').map((s) => s.textContent), ['#first', '#third']);
  assert.equal(document.activeElement, x('third'), 'on the one now in its place');
  assert.equal($(el, '.pn-said').textContent, 'Removed the tag second.');
  // Someone else adds one while focus is on a chip: it stays there.
  N.onTags('d:d1', 'm1', [...m.tags, rec('d', 1, 'carol', 'another', 4)]);
  await settle();
  assert.deepEqual($$(el, '.pn-chip-text').map((s) => s.textContent), ['#first', '#third', '#another']);
  assert.equal(document.activeElement, x('third'));
  // The last removable ones go: to the one before, then into the box.
  x('third').fire('click');
  await settle();
  assert.equal(document.activeElement, x('first'));
  x('first').fire('click');
  await settle();
  assert.equal(document.activeElement, $(el, 'input.pn-tag-in'));
  el.remove();
});

test('photo-notes: a thread’s first message deleted takes its replies with it: their tags leave the index and the suggestions, and their copies, side panels and comments go; nothing is fetched again', async () => {
  const { N, loaded, indexCalls } = notes();
  const ch = (id, over = {}) => ({ id, channelId: 'c1', serverId: 's1', authorId: 'alice', createdAt: 1, threadId: null, ...over });
  // p2: a reply loaded in the app (its thread was opened there), so not fetched for the index.
  loaded.set('p2', { ...ch('p2', { threadId: 'r1' }), dec: { t: '', f: PHOTOS } });
  const tags = [
    { ...rec('a', 0, 'alice', 'beach', 1), messageId: 'p1' }, // on a reply in r1's thread, fetched for the index
    { ...rec('b', 0, 'alice', 'beach', 2), messageId: 'm2' },
    { ...rec('c', 1, 'alice', 'only on p1', 3), messageId: 'p1' },
    { ...rec('d', 0, 'alice', 'only on p2', 4), messageId: 'p2' },
  ];
  // A comment on p1's second photo: a reply in the same thread.
  const k1 = ch('k1', { threadId: 'r1', authorId: 'bob', createdAt: 5, dec: { t: 'nice', f: [], ph: { i: 1, u: URL2 }, b: { r: 'p1', u: 'u1', v: 0 }, verified: true } });
  routes = (url) => {
    if (url === '/api/channels/c1/tags') return { tags };
    if (url.startsWith('/api/channels/c1/media?')) return { messages: [ch('p1', { threadId: 'r1' }), ch('m2')], next: null };
    if (url.startsWith('/api/messages/p1/comments?')) return { messages: [{ ...k1, dec: { ...k1.dec } }], next: null };
    return null;
  };
  let idx = await N.tagIndex('c:c1');
  assert.deepEqual([...idx.keys()], ['beach', 'only on p1', 'only on p2']);
  const held = (id) => N.messages().find((m) => m.id === id);
  const onP1 = N.side({ m: held('p1'), f: PHOTOS[1], fi: 1 });
  const onM2 = N.side({ m: held('m2'), f: PHOTOS[1], fi: 1 });
  page.body.append(onP1, onM2);
  await settle();
  assert.equal(shown(onP1), 1);
  assert.deepEqual(suggestions(onM2), ['#beach', '#only on p1', '#only on p2']);
  assert.deepEqual(N.messages().map((m) => m.id).sort(), ['k1', 'm2', 'p1']);
  assert.deepEqual([...N.repliesTo(['r1'], 'c:c1')].sort(), ['k1', 'p1', 'p2'], 'the copy it fetched, the comment it loaded, the loaded copy one of its tags is on');
  assert.deepEqual([...N.repliesTo(['r1'], 'd:d1')], [], 'no threads in a DM');
  asked.length = 0;
  indexCalls.length = 0;
  // The server deletes the whole thread, and names only its first message.
  N.onDelete('c:c1', new Set(['r1']));
  assert.deepEqual(indexCalls, ['c:c1'], 'the Photos & videos panel’s chips are worked out again');
  assert.deepEqual(suggestions(onM2), ['#beach'], 'not suggested any more, at once');
  idx = await N.tagIndex('c:c1');
  assert.deepEqual([...idx.keys()], ['beach']);
  assert.deepEqual(idx.get('beach'), [{ messageId: 'm2', fileIdx: 0 }], '“#beach 1”');
  assert.deepEqual(N.messages().map((m) => m.id), ['m2'], 'the reply’s copy and the comment on it let go');
  // Its side panel is let go of too: a late count for its photo loads nothing.
  N.onFileReplies('c:c1', 'p1', { 1: 2 });
  await settle();
  assert.deepEqual(asked, [], 'nothing fetched again');
  onP1.remove();
  onM2.remove();
});

test('photo-notes: a key verified doesn’t call off the retry on its way for someone else’s tags, and each run of retries starts afresh', async () => {
  const { N, loaded, blip } = notes({ retryAfter: 30 });
  const m = { id: 'm7', channelId: 'c1', serverId: 's1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [rec('a', 0, 'carol', 'sea blip', 1)] };
  loaded.set('m7', m);
  blip(1);
  assert.deepEqual(N.tagsOf(m, 0), []);
  await tick(); await tick();
  // Carol's keys couldn't be looked up; meanwhile Bob's changed (a channel's tags are each their author's).
  N.onTrust('bob');
  await new Promise((r) => setTimeout(r, 120));
  await settle();
  assert.deepEqual(N.tagsOf(m, 0), ['sea blip'], 'tried again all the same');
  // Lookups that fail now and then through one connection: each run is tried again, from the first wait.
  for (let i = 1; i <= 7; i++) {
    blip(1);
    N.onTags('c:c1', 'm7', [...m.tags, rec(`w${i}`, 1, 'carol', `wave ${i} blip`, 1 + i)]);
    await new Promise((r) => setTimeout(r, 120));
    await settle();
    assert.ok(N.tagsOf(m, 1).includes(`wave ${i} blip`), `run ${i}`);
  }
});

test('photo-notes: comments and tagged messages it loads or sends that disappear set the app’s disappearing timer again', async () => {
  const soon = Date.now() + 3600000;
  const all = [comment(1)];
  const mine = { ...comment(3), expiresAt: soon };
  routes = (url) => {
    if (url.startsWith('/api/dm-messages/m1/comments?')) return commentsPage(all, url);
    if (url === '/api/dms/d1/tags') return { tags: [{ ...rec('a', 0, 'alice', 'beach', 1), messageId: 'm9' }] };
    if (url.startsWith('/api/dms/d1/media?')) return { messages: [{ id: 'm9', dmId: 'd1', authorId: 'alice', createdAt: 1, expiresAt: soon }], next: null };
    return null;
  };
  const { N, loaded, armed } = notes({ sendComment: async () => ({ ...mine, dec: { ...mine.dec } }) });
  // A tagged message fetched for the tag index.
  await N.tagIndex('d:d1');
  await settle();
  assert.equal(armed.n, 1);
  // Comments that stay don't; one that disappears does.
  const m = photoMsg({ fileReplies: { 1: 1 } });
  loaded.set('m1', m);
  const el = N.side({ m, f: PHOTOS[1], fi: 1 });
  page.body.append(el);
  await settle();
  assert.equal(shown(el), 1);
  assert.equal(armed.n, 1);
  all.push({ ...comment(2), expiresAt: soon });
  N.onFileReplies('d:d1', 'm1', { 1: 2 });
  await settle();
  assert.equal(shown(el), 2);
  assert.equal(armed.n, 2);
  // And one you send.
  const ta = $(el, 'textarea.pn-box');
  ta.value = 'mine';
  ta.fire('keydown', { key: 'Enter' });
  await settle();
  assert.equal(shown(el), 3);
  assert.equal(armed.n, 3);
  el.remove();
});

test('photo-notes: blocking someone fills every picture’s counts again, in the chat and on the Photos & videos panel’s tiles', async () => {
  const blocked = [];
  const { N, loaded } = notes({ blocked });
  const m = { id: 'm8', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [rec('a', 0, 'mallory', 'rude', 1)] };
  loaded.set('m8', m);
  N.tagsOf(m, 0);
  await tick(); await tick();
  const [slot, btn] = N.tileExtras(m, 0, () => {}); // in the chat
  const tile = document.createElement('span'); // a Photos & videos tile's place for them (kept as it is when the chat is drawn again)
  tile.append(N.badges(m, 0));
  page.body.append(slot, tile);
  assert.equal($(slot, '.pn-badges').getAttribute('aria-label'), '1 tag');
  assert.equal(tile.firstChild.getAttribute('aria-label'), '1 tag');
  blocked.push('mallory');
  // (The document finds what's on the page: only plain selectors, as onBlock asks for all of them.)
  const find = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel.includes('[') ? [] : page.body.querySelectorAll(sel));
  try { N.onBlock(); } finally { document.querySelectorAll = find; }
  assert.equal(tile.firstChild.hidden, true);
  assert.equal(tile.firstChild.getAttribute('aria-label'), null);
  assert.equal($(slot, '.pn-badges').hidden, true);
  assert.equal(btn.getAttribute('aria-label'), 'Comment on this photo');
  slot.remove();
  tile.remove();
});

test('photo-notes: tags not opened yet are told apart (the viewer opens its side panel on them), leaving out those from someone you blocked', async () => {
  const { N, loaded } = notes({ blocked: ['mallory'] });
  const m = { id: 'm6', dmId: 'd1', authorId: 'bob', dec: { t: '', f: PHOTOS }, tags: [rec('a', 0, 'alice', 'beach', 1), rec('b', 1, 'mallory', 'rude', 2), rec('c', 1, 'alice', 'bad', 3)] };
  loaded.set('m6', m);
  assert.deepEqual([0, 1, 2].map((fi) => N.unopened(m, fi)), [1, 1, 0]);
  assert.equal(N.counts(m, 0).tags, 0, 'counted only once it’s opened');
  await tick(); await tick();
  assert.deepEqual([0, 1].map((fi) => N.unopened(m, fi)), [0, 0]);
  assert.deepEqual(N.counts(m, 0), { comments: 0, tags: 1 });
  assert.deepEqual(N.counts(m, 1), { comments: 0, tags: 0 }, 'one that didn’t open, and one from someone blocked');
  assert.equal(N.unopened({ ...m, dec: { error: true } }, 0), 0);
});

test('static: app.js tells photo-notes.js of deletes, disappearing, verified keys and blocks; the comment button never opens a hidden spoiler', () => {
  const app = read('public', 'js', 'app.js');
  const fn = (name) => { const at = app.search(new RegExp(`^(async )?function ${name}\\(`, 'm')); assert.ok(at > 0, name); return app.slice(at, app.indexOf('\n}\n', at)); };
  assert.match(fn('onDeleteMessage'), /MEDIA\.onDelete\(key, gone\);[^\n]*\n\s*NOTES\.onDelete\(key, gone\);/, 'after the Photos & videos panel let go of them');
  assert.match(fn('onDeleteChannelMessages'), /NOTES\.onDelete\('c:' \+ channelId, replies\)/);
  assert.match(app, /expiryListeners\.add\(\(ids\) => NOTES\.onDelete\(null, ids\)\);/);
  assert.match(fn('purgeExpired'), /NOTES\.expire\(\)/);
  assert.match(fn('armClientExpiry'), /NOTES\.messages\(\)/);
  assert.match(fn('openSafetyNumber'), /sec\.acceptKeys\(user\);[\s\S]{0,200}NOTES\.onTrust\(user\.id\)/);
  assert.match(fn('toggleBlock'), /NOTES\.onBlock\(\)/);
  assert.match(app, /enterSends: \(\) => P\.chat\.enterToSend !== false/);
  assert.match(app, /onIndex: \(key\) => MEDIA\.onMeta\(key, null\)/);
  assert.match(app, /armExpiry: \(\) => armClientExpiry\(\),\n\}\);\n\/\/ Disappearing messages that went from wherever else they were loaded: their tags and comments go too\./);
  // The viewer opens its side panel by itself on what counts (NOTES.counts), and on tags not opened yet.
  const viewer = app.slice(app.indexOf('function openViewer('), app.indexOf('\nasync function toPng('));
  const notesOn = viewer.slice(viewer.indexOf('const notesOn = '), viewer.indexOf('\n  };\n', viewer.indexOf('const notesOn = ')));
  assert.match(notesOn, /const c = NOTES\.counts\(it\.m, it\.fi\);\n {4}return c\.comments > 0 \|\| c\.tags > 0 \|\| NOTES\.unopened\(it\.m, it\.fi\) > 0;/);
  assert.doesNotMatch(notesOn, /it\.m\.(fileReplies|tags)/);
  assert.match(fn('attachmentEl'), /NOTES\.tileExtras\(m, fi, \(\) => \{ if \(!holder\.matches\('\.att-spoiler:not\(\.revealed\)'\)\) openPhotoViewer\(el, 'comment'\); \}\)/);
  const css = read('public', 'css', 'app.css');
  assert.match(css, /\.att-spoiler:not\(\.revealed\) \.pn-comment-btn \{ display: none; \}/, 'no key or screen reader reaches it');
});
