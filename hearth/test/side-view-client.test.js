// The side view ("Pinned to side"), the app's side (public/js/side-view.js): the list kept on this device and what's
// allowed in it, where a pinned message's page is asked for, what a card shows of its files and where it's from; then
// the panel itself (createSideView) in a page small enough for Node: pinning, loading through locate and ?around=,
// redraws that change nothing, edits, deletes, disappearing messages, conversations you've left and sharing your
// screen. The module runs here as it is (no browser); test/e2e flows.mjs sideView drives the real panel and viewer.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---- a page small enough for Node: elements with what the panel does with them.
class FakeNode {
  constructor() { this.parentNode = null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === globalThis.document.body) return true; return false; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const k = p.children; return k[k.indexOf(this) + 1] || null; }
  get previousElementSibling() { const p = this.parentNode; if (!p) return null; const k = p.children; return k[k.indexOf(this) - 1] || null; }
  remove() { if (this.parentNode) this.parentNode._take(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); this.remove(); }
}
class FakeText extends FakeNode {
  constructor(s) { super(); this.data = String(s); }
  get textContent() { return this.data; }
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function compound(s) {
  const c = { tag: null, classes: [], attrs: [] };
  for (const [, tag, cls, attr, val] of s.matchAll(/^([a-z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/gi)) {
    if (tag) c.tag = tag.toUpperCase(); else if (cls) c.classes.push(cls); else c.attrs.push([attr, val]);
  }
  return c;
}
const fits = (el, c) => el instanceof FakeEl && (!c.tag || el.tagName === c.tag) && c.classes.every((x) => el.cls.has(x))
  && c.attrs.every(([a, v]) => (v === undefined ? el.hasAttribute(a) : el.getAttribute(a) === v));
function matches(el, sel) {
  return sel.split(',').some((part) => {
    const steps = part.trim().split(/\s+/).map(compound);
    if (!fits(el, steps[steps.length - 1])) return false;
    let i = steps.length - 2;
    for (let x = el.parentNode; i >= 0 && x; x = x.parentNode) if (fits(x, steps[i])) i--;
    return i < 0;
  });
}
class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), childNodes: [], attrs: new Map(), cls: new Set(), dataset: {}, style: { setProperty() {} }, listeners: {}, scrollTop: 0, tabIndex: 0, disabled: false });
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const c = this.cls;
    return { add: (...k) => k.forEach((x) => c.add(x)), remove: (...k) => k.forEach((x) => c.delete(x)), contains: (k) => c.has(k),
      toggle: (k, on) => { const v = on === undefined ? !c.has(k) : !!on; if (v) c.add(k); else c.delete(k); return v; } };
  }
  setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) {
    if (k.startsWith('data-') && this.dataset[camel(k.slice(5))] !== undefined) return String(this.dataset[camel(k.slice(5))]);
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { this.attrs.delete(k); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  set innerHTML(v) { this.html = v; this.childNodes = []; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn); }
  dispatch(t) { for (const fn of this.listeners[t] || []) fn({ type: t, target: this, preventDefault() {}, stopPropagation() {} }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { globalThis.document.activeElement = this; }
  scrollIntoView() { this.scrolledTo = (this.scrolledTo || 0) + 1; }
  _take(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; n.moved = (n.moved || 0) + 1; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode._take(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  append(...ns) { for (const x of ns) this.insertBefore(x instanceof FakeNode ? x : new FakeText(x), null); }
  prepend(...ns) { for (const x of ns.reverse()) this.insertBefore(x instanceof FakeNode ? x : new FakeText(x), this.childNodes[0] || null); }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...ns) { for (const c of [...this.childNodes]) this._take(c); this.append(...ns); }
  get children() { return this.childNodes.filter((n) => n instanceof FakeEl); }
  get firstChild() { return this.childNodes[0] || null; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let x = this; x instanceof FakeEl; x = x.parentNode) if (x.matches(sel)) return x; return null; }
}
function fakePage() {
  globalThis.Node = FakeNode;
  const body = new FakeEl('body');
  globalThis.document = { body, activeElement: body, createElement: (t) => new FakeEl(t), createTextNode: (s) => new FakeText(s) };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

let M;
before(async () => {
  // (files.js asks api.js for the sign-in, which reads this browser's storage when it loads.)
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  fakePage();
  M = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'side-view.js')).href);
});

// ---- the list (pure)
test('the list is kept per account, each item once: a message, or one of its pictures', () => {
  assert.equal(M.storageKey('u1'), 'hearth.sideview.u1');
  assert.equal(M.itemId('m1'), 'm1');
  assert.equal(M.itemId('m1', null), 'm1');
  assert.equal(M.itemId('m1', 0), 'm1:0');
  assert.equal(M.itemId('m1', 3), 'm1:3');
  assert.equal(M.MAX_ITEMS, 25);
});

test('what may be in it: a conversation key, a message id, a picture’s place (or null), when it was pinned', () => {
  assert.deepEqual(M.cleanItem({ key: 'd:dm1', messageId: 'm1', fileIdx: null, at: 5 }), { key: 'd:dm1', messageId: 'm1', fileIdx: null, at: 5 });
  assert.deepEqual(M.cleanItem({ key: 'c:ch1', messageId: 'm1', fileIdx: 2, at: 5.7 }), { key: 'c:ch1', messageId: 'm1', fileIdx: 2, at: 5 });
  assert.deepEqual(M.cleanItem({ key: 'c:ch1', messageId: 'm1' }), { key: 'c:ch1', messageId: 'm1', fileIdx: null, at: 0 });
  for (const bad of [null, 'x', 5, {},
    { key: 'x:ch1', messageId: 'm1' }, { key: 'c:', messageId: 'm1' }, { key: 'c:a/b', messageId: 'm1' }, { key: 'c:ch1', messageId: '../m1' },
    { key: 'c:ch1', messageId: 'x'.repeat(65) }, { key: 'c:ch1', messageId: 7 }, { key: 'c:ch1', messageId: 'pending-1' },
    { key: 'c:ch1', messageId: 'm1', fileIdx: -1 }, { key: 'c:ch1', messageId: 'm1', fileIdx: 1.5 }, { key: 'c:ch1', messageId: 'm1', fileIdx: '1' },
    { key: 'c:ch1', messageId: 'm1', fileIdx: 100 }]) {
    assert.equal(M.cleanItem(bad), null, JSON.stringify(bad));
  }
});

test('read back: well-formed items only, each once, the newest first, at most 25; anything else is nothing', () => {
  const list = [
    { key: 'd:dm1', messageId: 'a', at: 1 },
    { key: 'd:dm1', messageId: 'b', fileIdx: 0, at: 3 },
    { key: 'd:dm1', messageId: 'a', at: 9 }, // a second copy of a: the first one counts
    { key: 'bad', messageId: 'c', at: 4 },
    null,
    { key: 'c:ch1', messageId: 'b', at: 2 }, // the message b itself, not its picture
  ];
  assert.deepEqual(M.readItems(JSON.stringify(list)).map((x) => [x.messageId, x.fileIdx]), [['b', 0], ['b', null], ['a', null]]);
  assert.deepEqual(M.readItems(list).length, 3, 'or what it parsed to');
  for (const bad of [null, '', 'not json', '{"a":1}', '5', 'null']) assert.deepEqual(M.readItems(bad), [], String(bad));
  const many = Array.from({ length: 40 }, (_, i) => ({ key: 'd:dm1', messageId: `m${i}`, at: i + 1 }));
  const got = M.readItems(JSON.stringify(many));
  assert.equal(got.length, 25);
  assert.equal(got[0].messageId, 'm39');
  assert.equal(got[24].messageId, 'm15');
});

test('pinning: on top; again, nothing changes; the 26th takes the oldest off', () => {
  let list = [];
  let r = M.addItem(list, { key: 'd:dm1', messageId: 'a' }, 100);
  assert.deepEqual(r.added, { key: 'd:dm1', messageId: 'a', fileIdx: null, at: 100 });
  list = r.list;
  r = M.addItem(list, { key: 'd:dm1', messageId: 'a', fileIdx: 1 }, 200);
  assert.ok(r.added);
  list = r.list;
  assert.deepEqual(list.map((x) => M.itemId(x.messageId, x.fileIdx)), ['a:1', 'a']);
  r = M.addItem(list, { key: 'd:dm1', messageId: 'a' }, 300);
  assert.equal(r.added, null);
  assert.equal(r.already, true);
  assert.equal(r.list, list);
  r = M.addItem(list, { key: 'nope', messageId: 'a' }, 300);
  assert.equal(r.added, null);
  assert.equal(r.already, false);
  for (let i = 0; i < 23; i++) list = M.addItem(list, { key: 'c:ch1', messageId: `m${i}` }, 1000 + i).list;
  assert.equal(list.length, 25);
  r = M.addItem(list, { key: 'c:ch1', messageId: 'new' }, 5000);
  assert.equal(r.list.length, 25);
  assert.equal(r.list[0].messageId, 'new');
  assert.deepEqual(r.dropped.map((x) => M.itemId(x.messageId, x.fileIdx)), ['a'], 'the oldest one');
  assert.deepEqual(M.removeItem(r.list, 'new').map((x) => x.messageId), r.list.slice(1).map((x) => x.messageId));
  assert.equal(M.removeItem(r.list, 'nothing').length, 25);
});

test('loading one: where the server says it is, then the page around it (its thread’s, for a reply in one)', () => {
  assert.equal(M.keyOfLocation({ kind: 'dm', dmId: 'dm1' }), 'd:dm1');
  assert.equal(M.keyOfLocation({ kind: 'channel', channelId: 'ch1', serverId: 's1', threadId: null }), 'c:ch1');
  for (const bad of [null, {}, { kind: 'dm' }, { kind: 'channel', channelId: '../x' }, { kind: 'other', channelId: 'ch1' }]) assert.equal(M.keyOfLocation(bad), null);
  assert.equal(M.aroundPath('d:dm1', 'm1'), '/dms/dm1/messages?around=m1');
  assert.equal(M.aroundPath('c:ch1', 'm1'), '/channels/ch1/messages?around=m1');
  assert.equal(M.aroundPath('c:ch1', 'm2', 'root1'), '/messages/root1/thread?around=m2');
  assert.equal(M.aroundPath('d:a/b', 'm1'), '/dms/a%2Fb/messages?around=m1');
});

const file = (name, type, extra = {}) => ({ url: `/uploads/${name.replace(/\W/g, '')}.bin`, k: 'key', name, type, size: 1000, ...extra });

test('what a card shows of the files: a picture pinned alone is that one; a message, its pictures and videos, and the rest by name', () => {
  const files = [file('a.png', 'image/png'), file('notes.pdf', 'application/pdf'), file('clip.webm', 'video/webm'), file('v.webm', 'audio/webm', { voice: true }), file('song.mp3', 'audio/mpeg')];
  const all = M.shownFiles(files);
  assert.deepEqual(all.media.map((e) => [e.fi, e.kind]), [[0, 'img'], [2, 'video']]);
  assert.deepEqual(all.other.map((o) => [o.fi, o.f.name, o.voice]), [[1, 'notes.pdf', false], [3, 'v.webm', true], [4, 'song.mp3', false]]);
  assert.deepEqual(M.shownFiles(files, 2).media.map((e) => e.fi), [2]);
  assert.deepEqual(M.shownFiles(files, 2).other, []);
  assert.deepEqual(M.shownFiles(files, 1).media, [], 'a PDF is no picture');
  assert.deepEqual(M.shownFiles(files, 9).media, [], 'not there any more (an edit took it out)');
  assert.deepEqual(M.shownFiles(undefined), { media: [], other: [] });
});

test('where it’s from, in words', () => {
  assert.equal(M.placeLabel({ channel: '#general', server: 'Indie Game Club' }), '#general · Indie Game Club');
  assert.equal(M.placeLabel({ dm: 'maya' }), 'DM with maya');
  assert.equal(M.placeLabel({ group: 'Fruit Club' }), 'Fruit Club');
  assert.equal(M.placeLabel(null), '');
  const m = { dec: { f: [file('a.png', 'image/png', { th: { url: '/uploads/th.bin', k: 'k' } }), file('b.pdf', 'application/pdf')] } };
  assert.deepEqual(M.fileUrlsOf([m], (x) => x.dec.f), ['/uploads/apng.bin', '/uploads/th.bin', '/uploads/bpdf.bin']);
});

// ---- the panel itself, against a fake server
const memStore = () => { const map = new Map(); return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }; };
// Messages as the server keeps them, with what's inside them (plain). A page is a new copy of each, as from the
// network, that deps.decrypt opens.
const sent = (id, where, plain, extra = {}) => ({ id, ...where, authorId: 'u2', createdAt: Date.UTC(2026, 9, 1), plain, ...extra });
function panel({ msgs = [], places = { 'd:dm1': { kind: 'dm', private: true, label: 'DM with maya' }, 'c:ch1': { kind: 'channel', private: false, label: '#general · Club' } } } = {}) {
  const server = new Map(msgs.map((m) => [m.id, m]));
  const storage = memStore();
  const log = { requests: [], decrypted: [], loads: [], opened: [], dropped: [], forgot: [], toasts: [], shown: 0, changed: 0, jumps: [] };
  const state = { me: 'me', sharing: false, blocked: new Set(), now: Date.UTC(2026, 9, 2), places: { ...places } };
  const chat = new Map();
  const net = (m) => { const { plain, ...rest } = m; return { ...rest, ciphertext: JSON.stringify(plain) }; };
  const keyOf = (m) => (m.dmId ? 'd:' + m.dmId : 'c:' + m.channelId);
  const deps = {
    userId: () => state.me,
    storage,
    get: async (p) => {
      log.requests.push(p);
      const loc = /^\/messages\/([^/]+)\/locate$/.exec(p);
      if (loc) {
        const m = server.get(decodeURIComponent(loc[1]));
        if (!m || (m.expiresAt && m.expiresAt <= state.now)) { const e = new Error('That message was deleted or you can’t see it.'); e.status = 404; throw e; }
        return m.dmId ? { kind: 'dm', dmId: m.dmId } : { kind: 'channel', channelId: m.channelId, serverId: 's1', threadId: m.threadId || null };
      }
      const u = new URL(p, 'http://hearth.test');
      const around = u.searchParams.get('around');
      const thread = /^\/messages\/([^/]+)\/thread$/.exec(u.pathname);
      const list = [...server.values()].filter((m) => (thread ? m.threadId === thread[1] : !m.threadId && (u.pathname.startsWith('/dms/') ? `/dms/${m.dmId}/messages` : `/channels/${m.channelId}/messages`) === u.pathname));
      assert.ok(around);
      return { messages: list.map(net) };
    },
    decrypt: async (m) => { log.decrypted.push(m.id); if (!m.dec) m.dec = JSON.parse(m.ciphertext); },
    known: (id) => chat.get(id) || null,
    keyOf,
    files: (m) => (m.dec && m.dec.f) || [],
    readable: (m) => !!m.dec && !m.dec.error && !m.dec.pending,
    expired: (m) => !!m.expiresAt && m.expiresAt <= state.now,
    disappears: (m) => !!m.expiresAt,
    blocked: (id) => state.blocked.has(id),
    veiled: (m) => (m.dec && /secret/.test(m.dec.t) ? { action: 'hide' } : null),
    filterLabel: () => 'Hidden by your word filter',
    reveal() {},
    place: (key) => state.places[key] || null,
    hidden: (key) => { const p = state.places[key]; return !!p && p.private && state.sharing; },
    author: (m) => { const el = document.createElement('span'); el.className = 'author'; el.append(m.authorId); return el; },
    stamp: (ts) => `at ${ts}`,
    textEl: (m) => { if (!m.dec.t) return null; const el = document.createElement('div'); el.className = 'sv-text'; el.append(m.dec.t); return el; },
    thumb: (m, f) => { log.loads.push(`${m.id}:${f.name}:thumb`); return Promise.resolve(`blob:${f.name}:thumb`); },
    full: (m, f) => { log.loads.push(`${m.id}:${f.name}`); return Promise.resolve(`blob:${f.name}`); },
    queue: (fn) => Promise.resolve().then(fn),
    autoloadMax: 20 * 1024 * 1024,
    thumbMax: 2 * 1024 * 1024,
    open: (from, opts) => log.opened.push(opts),
    download() {},
    jump: (it, m) => log.jumps.push([it.key, it.messageId, !!m]),
    panelHead: (title, sub) => { const el = document.createElement('div'); el.className = 'panel-head'; el.append(title, sub || ''); const b = document.createElement('button'); el.append(b); return el; },
    show: () => { log.shown++; },
    changed: () => { log.changed++; },
    toast: (t) => log.toasts.push(t),
    forget: (msgs2, ids) => log.forgot.push([...ids]),
    drop: (urls) => log.dropped.push(...urls),
    armExpiry() {},
  };
  const S = M.createSideView(deps);
  const el = document.createElement('div');
  document.body.replaceChildren(el);
  const cards = () => el.querySelectorAll('.sv-card');
  const card = (id) => cards().find((c) => c.dataset.sid === id) || null;
  return { S, el, deps, log, state, chat, server, storage, cards, card, net };
}

test('the panel does nothing until it’s drawn: pinning only writes the list (this account’s), and the count follows', async () => {
  const p = panel();
  const m = { id: 'm1', dmId: 'dm1', authorId: 'u2', dec: { t: 'hello', f: [] } };
  const item = p.S.menuItemFor(m);
  assert.deepEqual([item.label, item.icon, item.key], ['Pin to side', 'sidebar', 'side']);
  item.action();
  assert.equal(p.S.count(), 1);
  assert.equal(p.log.shown, 1, 'pinning opens the panel');
  assert.equal(p.log.changed, 1, 'the header’s count');
  assert.deepEqual(JSON.parse(p.storage.map.get('hearth.sideview.me')).map((x) => [x.key, x.messageId, x.fileIdx]), [['d:dm1', 'm1', null]]);
  assert.equal(p.S.menuItemFor(m).label, 'Unpin from side');
  assert.equal(p.S.isPinned('m1'), true);
  assert.equal(p.S.isPinned('m1', 0), false);
  assert.deepEqual(p.log.requests, [], 'nothing asked of the server');
  // Someone else signed in here: their own list (empty).
  p.state.me = 'other';
  assert.equal(p.S.count(), 0);
  p.state.me = 'me';
  assert.equal(p.S.count(), 1);
  p.S.menuItemFor(m).action();
  assert.equal(p.S.count(), 0);
  assert.equal(p.storage.map.has('hearth.sideview.me'), false, 'an empty list leaves nothing behind');
  // A picture: only one that's a picture or a video there; and never a copy still being sent, or with nobody signed in.
  const pics = { id: 'm2', dmId: 'dm1', authorId: 'u2', dec: { t: '', f: [file('a.png', 'image/png'), file('n.pdf', 'application/pdf')] } };
  assert.ok(p.S.menuItemFor(pics, 0));
  assert.equal(p.S.menuItemFor(pics, 1), null);
  assert.equal(p.S.menuItemFor(pics, 5), null);
  assert.equal(p.S.menuItemFor({ ...pics, id: 'pending-3' }), null);
  assert.equal(p.S.menuItemFor({ ...pics, pending: true }), null);
  assert.equal(p.S.menuItemFor(null), null);
  p.state.me = null;
  assert.equal(p.S.menuItemFor(pics), null);
});

test('a pinned message the chat doesn’t have: located, the page around it asked for, decrypted; a redraw asks nothing again', async () => {
  const p = panel({ msgs: [
    sent('m1', { dmId: 'dm1' }, { t: 'first words', f: [] }),
    sent('m2', { dmId: 'dm1' }, { t: 'with a photo', f: [file('p.png', 'image/png', { th: { url: '/uploads/th.bin', k: 'k' } })] }),
    sent('r1', { channelId: 'ch1', threadId: 'root' }, { t: 'a reply in a thread', f: [] }),
  ] });
  p.S.pin({ key: 'd:dm1', messageId: 'm1' });
  p.S.pin({ key: 'd:dm1', messageId: 'm2', fileIdx: 0 });
  p.S.pin({ key: 'c:ch1', messageId: 'r1' });
  p.S.draw(p.el);
  assert.equal(p.cards().length, 3);
  assert.ok(p.cards().every((c) => c.classList.contains('loading')));
  assert.equal(p.el.querySelector('.panel-head').textContent, 'Pinned to sideOnly on this device');
  await settle();
  // The newest pinned first. m2's page brought m1 too: asked for once.
  assert.deepEqual(p.cards().map((c) => c.dataset.sid), ['r1', 'm2:0', 'm1']);
  assert.ok(p.cards().every((c) => c.classList.contains('ok')));
  assert.deepEqual(p.log.requests.sort(), ['/dms/dm1/messages?around=m2', '/messages/m2/locate', '/messages/r1/locate', '/messages/root/thread?around=r1'].sort());
  assert.match(p.card('m1').textContent, /first words/);
  assert.match(p.card('m1').textContent, /DM with maya/);
  assert.match(p.card('r1').textContent, /#general · Club/);
  // A picture pinned alone: big, its thumbnail first, then the whole picture.
  const img = p.card('m2:0').querySelector('.sv-pic img');
  assert.equal(img.getAttribute('src') || img.src, 'blob:p.png');
  assert.deepEqual(p.log.loads, ['m2:p.png:thumb', 'm2:p.png']);
  // Nothing in a card names a chat row (data-mid): the app redraws those by it.
  assert.ok(p.el.querySelectorAll('[data-mid]').length === 0);
  // Redrawn (people coming online, another conversation): the same cards, nothing asked for again.
  const before = p.cards();
  const asked = p.log.requests.length;
  for (let i = 0; i < 5; i++) p.S.draw(p.el);
  await settle();
  assert.deepEqual(p.cards(), before);
  assert.ok(before.every((c) => !c.moved), 'not even moved');
  assert.equal(p.log.requests.length, asked);
  // Jump goes to it; × unpins it, and its card goes.
  p.card('m1').querySelector('.sv-actions .btn').click();
  assert.deepEqual(p.log.jumps, [['d:dm1', 'm1', true]]);
  p.card('m1').querySelector('.sv-x').click();
  assert.equal(p.card('m1'), null);
  assert.equal(p.S.count(), 2);
  // The picture opens the viewer, on it.
  p.card('m2:0').querySelector('.sv-open').click();
  assert.equal(p.log.opened.length, 1);
  assert.deepEqual(p.log.opened[0].items.map((x) => [x.m.id, x.fi, x.key, x.kind, x.name]), [['m2', 0, 'd:dm1', 'img', 'p.png']]);
});

test('the chat’s own copy is used when it has one; the one just pinned too', async () => {
  const p = panel();
  const mine = { id: 'm5', dmId: 'dm1', authorId: 'u2', createdAt: 1, dec: { t: 'from the chat', f: [] } };
  p.chat.set('m5', mine);
  p.S.pin({ key: 'd:dm1', messageId: 'm5' });
  const fromViewer = { id: 'm6', channelId: 'ch1', authorId: 'u2', createdAt: 1, dec: { t: 'from Photos & videos', f: [] } };
  p.S.menuItemFor(fromViewer).action();
  p.S.draw(p.el);
  await settle();
  assert.deepEqual(p.log.requests, []);
  assert.match(p.card('m5').textContent, /from the chat/);
  assert.match(p.card('m6').textContent, /from Photos & videos/);
});

test('gone: deleted (here or before), past its time, somewhere else than pinned, or in a conversation you left', async () => {
  const p = panel({ msgs: [
    sent('a', { dmId: 'dm1' }, { t: 'will be deleted', f: [file('x.png', 'image/png', { th: { url: '/uploads/xth.bin', k: 'k' } })] }),
    sent('b', { channelId: 'ch1' }, { t: 'disappears', f: [] }, { expiresAt: Date.UTC(2026, 9, 3) }),
    sent('c', { channelId: 'ch2' }, { t: 'moved', f: [] }),
    sent('d', { channelId: 'ch1' }, { t: 'left', f: [] }),
  ] });
  for (const [key, id] of [['d:dm1', 'a'], ['c:ch1', 'b'], ['c:ch1', 'c'], ['c:ch1', 'gone-already'], ['c:ch1', 'd']]) p.S.pin({ key, messageId: id });
  p.S.draw(p.el);
  await settle();
  const gone = (id) => p.card(id).classList.contains('gone') && /This message is no longer available/.test(p.card(id).textContent);
  assert.ok(gone('gone-already'), 'the server says it isn’t there');
  assert.ok(gone('c'), 'not where it was pinned');
  assert.ok(!gone('a') && !gone('b') && !gone('d'));
  // Deleted now: the card says so, and its decrypted files go.
  p.S.onDelete('d:dm1', ['a']);
  assert.ok(gone('a'));
  assert.deepEqual(p.log.dropped, ['/uploads/xpng.bin', '/uploads/xth.bin']);
  assert.equal(p.card('a').querySelector('.sv-x').getAttribute('aria-label'), 'Unpin from side', 'with × to take it off');
  // Its time came: the timer's pass lets go of everything kept of it.
  assert.deepEqual(p.S.messages().map((m) => m.id).sort(), ['b', 'd']);
  p.state.now = Date.UTC(2026, 9, 4);
  p.S.expire();
  assert.ok(gone('b'));
  assert.deepEqual(p.log.forgot, [['b']]);
  assert.deepEqual(p.S.messages().map((m) => m.id), ['d']);
  // You left the server: nothing of it shows, whatever was loaded.
  delete p.state.places['c:ch1'];
  p.S.draw(p.el);
  assert.ok(gone('d'));
  assert.doesNotMatch(p.el.textContent, /left/);
  // A thread's first message deleted takes the replies pinned from it with it.
  const q = panel({ msgs: [sent('r2', { channelId: 'ch1', threadId: 'root2' }, { t: 'reply', f: [] })] });
  q.S.pin({ key: 'c:ch1', messageId: 'r2' });
  q.S.draw(q.el);
  await settle();
  q.S.onDelete('c:ch1', ['root2']);
  assert.ok(q.card('r2').classList.contains('gone'));
});

test('an edit shows; the word filter, blocks and sharing your screen cover what they should', async () => {
  const p = panel({ msgs: [
    sent('a', { dmId: 'dm1' }, { t: 'before the edit', f: [] }),
    sent('b', { channelId: 'ch1' }, { t: 'a secret here', f: [] }),
    sent('c', { channelId: 'ch1' }, { t: 'from someone blocked', f: [] }, { authorId: 'troll' }),
  ] });
  for (const [key, id] of [['d:dm1', 'a'], ['c:ch1', 'b'], ['c:ch1', 'c']]) p.S.pin({ key, messageId: id });
  p.S.draw(p.el);
  await settle();
  const edited = { ...p.net(sent('a', { dmId: 'dm1' }, { t: 'after the edit', f: [] })), editedAt: 5 };
  await p.S.onUpdate('d:dm1', edited);
  assert.match(p.card('a').textContent, /after the edit/);
  assert.doesNotMatch(p.card('a').textContent, /before the edit/);
  // (One in another conversation with the same id is no edit of it.)
  await p.S.onUpdate('c:ch1', edited);
  assert.match(p.card('a').textContent, /after the edit/);
  assert.match(p.card('b').textContent, /Hidden by your word filter/);
  assert.doesNotMatch(p.card('b').textContent, /a secret here/);
  assert.match(p.card('c').textContent, /from someone blocked/);
  p.state.blocked.add('troll');
  p.S.draw(p.el);
  assert.match(p.card('c').textContent, /Message from someone you blocked/);
  assert.doesNotMatch(p.card('c').textContent, /from someone blocked|troll/);
  p.card('c').querySelector('.link-btn').click();
  assert.match(p.card('c').textContent, /from someone blocked/, 'Show shows it');
  // Sharing your screen: the DM's card says it's hidden, and has nothing of the message in it; the channel's stays.
  p.state.sharing = true;
  p.S.draw(p.el);
  assert.match(p.card('a').textContent, /Hidden while you share your screen/);
  assert.doesNotMatch(p.card('a').textContent, /after the edit|maya/);
  assert.ok(!p.card('a').querySelector('img'));
  assert.match(p.card('c').textContent, /from someone blocked/);
  p.state.sharing = false;
  p.S.draw(p.el);
  assert.match(p.card('a').textContent, /after the edit/);
});

test('the 26th pinned takes the oldest off, with a toast; closing lets go of what was loaded, signing out of the list', async () => {
  const p = panel();
  for (let i = 0; i < 25; i++) p.S.pin({ key: 'd:dm1', messageId: `m${i}` });
  assert.equal(p.S.count(), 25);
  assert.deepEqual(p.log.toasts, []);
  p.S.pin({ key: 'd:dm1', messageId: 'm25' });
  assert.equal(p.S.count(), 25);
  assert.equal(p.S.isPinned('m0'), false);
  assert.deepEqual(p.log.toasts, ['Only 25 things fit on the side, so the oldest one came off.']);
  // Again: already there, nothing changes (the panel opens on it).
  p.S.pin({ key: 'd:dm1', messageId: 'm25' });
  assert.equal(p.log.toasts.length, 1);
  p.S.draw(p.el);
  assert.equal(p.S.drawn(p.el), true);
  p.S.reset();
  assert.equal(p.S.drawn(p.el), false);
  assert.equal(p.el.children.length, 0, 'its elements go');
  assert.deepEqual(p.S.messages(), []);
  assert.equal(p.S.count(), 25, 'the list stays');
  p.storage.map.delete('hearth.sideview.me'); // (signing out clears it: usability.js clearLocalCopies)
  p.S.reset({ all: true });
  assert.equal(p.S.count(), 0);
});

test('the module never names a chat row (data-mid), and keeps its list on this device only', () => {
  const src = read('public', 'js', 'side-view.js');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /data-mid|dataset:\s*\{\s*mid\b/, 'cards must not look like message rows (replaceMessageEl swaps every [data-mid])');
  // Nothing is sent to the server: the only thing it asks of it is to read (deps.get).
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|sendBeacon|deps\.(?!get\b)\w+\(['"`]\//);
  assert.deepEqual([...new Set(code.match(/deps\.(get|api|post|put|patch|request|send)\b/g))], ['deps.get']);
  assert.doesNotMatch(code, /createObjectURL/, 'decrypted copies are the app’s (fileUrls), not its own');
  assert.match(src, /deps\.panelHead\('Pinned to side', 'Only on this device'\)/);
  // Signing out clears it with the other local copies.
  assert.match(read('public', 'js', 'usability.js'), /const COPIES = \[[^\]]*'hearth\.sideview\.'/);
});

test('app.js: the side panel stays open across conversations, is as wide as a thread, and has its ways in', () => {
  const app = read('public', 'js', 'app.js');
  const fn = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a)); };
  // setView leaves it open (unlike pins and Photos & videos), except on a phone, where it covers the chat.
  assert.deepEqual(fn('setView').match(/.*S\.panel === 'side'.*/g), ["  if (S.panel === 'side' && isPhoneLayout() && currentKey() !== from) S.panel = null;"]);
  const rp = fn('renderPanel');
  assert.match(rp, /if \(S\.panel !== 'side'\) SIDE\.reset\(\);/);
  assert.match(rp, /if \(mode === 'side' && el\.dataset\.mode === 'side' && SIDE\.drawn\(el\)\) \{\n {4}SIDE\.draw\(el\);\n {4}return;\n {2}\}/);
  assert.ok(rp.indexOf('SIDE.drawn(el)') < rp.indexOf('clear(el);'), 'before the panel is emptied');
  assert.ok(rp.indexOf("if (mode === 'side') return SIDE.draw(el);") < rp.indexOf("if (S.view.type === 'dm') return dmProfilePanel(el);"));
  assert.match(fn('resizeHandle'), /panelMode\(\) === 'side'/);
  // The header: a button with the count in every chat, once something is pinned; the ⋯ menus have it.
  const head = fn('drawHeader');
  assert.equal((head.match(/sideButton\(\),/g) || []).length, 3, 'channels, group chats, DMs');
  assert.equal((head.match(/SCHED_ITEM\(\), SIDE_ITEM, /g) || []).length, 3);
  assert.match(fn('sideButton'), /cls: 'with-badge head-side'/);
  // Pin to side: the hover toolbar's menu and the phone's sheet (both messageMenuItems), and the viewer.
  assert.match(fn('messageMenuItems'), /SIDE\.menuItemFor\(m\),/);
  const v = app.slice(app.indexOf('function openViewer('), app.indexOf('\nasync function toPng('));
  assert.match(v, /SIDE\.menuItemFor\(it\.m, it\.fi\)/);
  assert.match(v, /jumpBtn, sidePin, /);
  assert.match(v, /jumpable\(it\) \? \{ label: 'Jump to message'[^\n]*\n {6}sideItem\(\),/);
  assert.match(v, /more, ibtn\('close', 'Close \(Esc\)', close\)\);/, 'Close stays last');
  // Live: edits, deletes, disappearing messages, keys; the word filter; signing out and coming back online.
  assert.match(fn('onUpdateMessage'), /SIDE\.onUpdate\(key, m\);/);
  assert.match(fn('onThreadUpdate'), /SIDE\.onUpdate\('c:' \+ m\.channelId, m\);/);
  assert.match(fn('onDeleteMessage'), /SIDE\.onDelete\(key, gone\);/);
  assert.match(fn('onDeleteChannelMessages'), /SIDE\.onDelete\('c:' \+ channelId, replies\)/);
  assert.match(fn('armClientExpiry'), /for \(const m of SIDE\.messages\(\)\) items\.push\(m\);/);
  assert.match(fn('purgeExpired'), /SIDE\.expire\(\);/);
  assert.match(app, /expiryListeners\.add\(\(ids\) => SIDE\.onDelete\(null, ids\)\);/);
  assert.match(fn('redrawFiltered'), /mode === 'side' \|\|/);
  assert.match(fn('onKeysChanged'), /SIDE\.onKeys\(serverId\);/);
  assert.match(fn('signOutHere'), /SIDE\.reset\(\{ all: true \}\);/);
  assert.match(fn('loadBootstrap'), /SIDE\.reset\(\);/);
  // DMs and group chats are covered while you share your screen; a phone's panel closes before a jump.
  const deps = app.slice(app.indexOf('const SIDE = createSideView({'), app.indexOf('\n});\n', app.indexOf('const SIDE = createSideView({')));
  assert.match(deps, /hidden: \(key\) => \{ const p = sidePlace\(key\); return !!p && p\.private && hiddenWhileSharing\(key\); \}/);
  assert.match(deps, /if \(isPhoneLayout\(\) && panelMode\(\)\) closePanel\(\);/);
});

test('app.css: its rules are in its own section, as wide as a thread, and the header button is hidden on phones', () => {
  const css = read('public', 'css', 'app.css');
  const start = css.indexOf('/* ======================================================================= The side view (side-view.js) */');
  const end = css.indexOf('/* (end of the side view) */');
  assert.ok(start > 0 && end > start);
  const mine = css.slice(start, end);
  assert.match(mine, /#members\[data-mode='side'\] \{ width: var\(--thread-w\); \}/);
  assert.match(mine, /@media \(max-width: 760px\), \(pointer: coarse\) and \(max-height: 500px\) \{\n {2}#main-head \.head-side \{ display: none; \}/);
  assert.doesNotMatch(css.slice(0, start) + css.slice(end), /\.sv-|head-side/);
});
