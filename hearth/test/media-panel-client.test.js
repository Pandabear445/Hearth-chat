// Photos & videos, the app's side (public/js/media-panel.js): which files of a message are its pictures and videos,
// the order and the month headings, the Photos / Videos filter and the tag filter, and the pages it asks the server
// for; then the panel itself (createMediaPanel) in a page small enough for Node: paging, live updates, the tag filter,
// keys arriving, disappearing messages and what it downloads when. The module runs here as it is (no browser);
// test/e2e flows.mjs mediaPanel drives the real panel and viewer.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---- a page small enough for Node: elements with what the panel does with them, an IntersectionObserver the tests
// move (near: an element comes near the screen), and animation frames that settle() runs.
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class FakeNode {
  constructor() { this.parentNode = null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === globalThis.document.body) return true; return false; }
  remove() { if (this.parentNode) this.parentNode._take(this); }
}
class FakeText extends FakeNode {
  constructor(s) { super(); this.data = String(s); }
  get textContent() { return this.data; }
}
// One part of a selector ("button.mp-tag[data-label]"), and a list of them ("a b, .c"; ":scope > .x" for children).
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
    Object.assign(this, { tagName: tag.toUpperCase(), childNodes: [], attrs: new Map(), cls: new Set(), dataset: {}, style: { setProperty() {} }, listeners: {}, scrollTop: 0, clientHeight: 0, tabIndex: 0, detached: 0 });
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
  click() { this.dispatch('click'); }
  focus() { globalThis.document.activeElement = this; }
  _take(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; n.detached = (n.detached || 0) + 1; }
  append(...ns) {
    for (const x of ns) {
      const n = x instanceof FakeNode ? x : new FakeText(x);
      if (n.parentNode) n.parentNode._take(n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...ns) { for (const c of [...this.childNodes]) this._take(c); this.append(...ns); }
  get children() { return this.childNodes.filter((n) => n instanceof FakeEl); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  // The scrolled list's height: what the test lays out (layout), else nothing to scroll.
  get scrollHeight() { return this.layout ? this.layout(this) : 0; }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) {
    const scope = /^:scope\s*>\s*/.exec(sel);
    if (scope) return this.children.filter((c) => c.matches(sel.slice(scope[0].length)));
    const out = [];
    const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let x = this; x instanceof FakeEl; x = x.parentNode) if (x.matches(sel)) return x; return null; }
}
const observers = [];
const frames = new Map();
let frameId = 0;
function fakePage() {
  globalThis.Node = FakeNode;
  const body = new FakeEl('body');
  globalThis.document = { body, activeElement: body, createElement: (t) => new FakeEl(t), createTextNode: (s) => new FakeText(s) };
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.els = new Set(); observers.push(this); }
    observe(el) { this.els.add(el); }
    unobserve(el) { this.els.delete(el); }
    disconnect() { this.els.clear(); }
  };
  globalThis.requestAnimationFrame = (fn) => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
}
// The element comes near the screen (whenVisible's margin): what waits for it runs.
const near = (el) => { for (const io of observers) if (io.els.has(el)) io.cb([{ isIntersecting: true, target: el }]); };
// Everything under way finishes: answers, decrypting, drawing, and the frames that ask for the next page.
async function settle() {
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setImmediate(r));
    if (!frames.size) return;
    const run = [...frames.values()];
    frames.clear();
    run.forEach((fn) => fn());
  }
  throw new Error('still paging after 500 frames');
}

let M;
before(async () => {
  // (files.js asks api.js for the sign-in, which reads this browser's storage when it loads.)
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  // (media.js makes its IntersectionObservers as it loads.)
  fakePage();
  M = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'media-panel.js')).href);
});

const file = (name, type, extra = {}) => ({ url: `/uploads/${name.replace(/\W/g, '')}.bin`, k: 'key', name, type, size: 1000, ...extra });
const msg = (id, createdAt, files, extra = {}) => ({ id, createdAt, authorId: 'u1', dec: { t: '', f: files }, ...extra });
const files = (m) => m.dec.f;
const show = () => 'show';

test('a message’s pictures and videos, with their place among its files; voice messages, songs and other files aren’t shown', () => {
  const list = [
    file('cat.png', 'image/png'),
    file('notes.pdf', 'application/pdf'),
    file('clip.webm', 'video/webm'),
    file('voice.webm', 'audio/webm', { voice: true, dur: 3 }),
    file('song.mp3', 'audio/mpeg'),
    file('party.gif', 'image/gif'),
    file('old.mov', ''), // no type recorded: a video by its name
    file('fake-voice.png', 'image/png', { voice: true }),
    null,
    'nonsense',
  ];
  const got = M.mediaEntries(list);
  assert.deepEqual(got.map((e) => [e.fi, e.kind, e.f.name, e.gif]), [
    [0, 'img', 'cat.png', false],
    [2, 'video', 'clip.webm', false],
    [5, 'img', 'party.gif', true],
    [6, 'video', 'old.mov', false],
  ]);
  assert.equal(M.mediaEntries(undefined).length, 0);
  // A GIF by its name, whatever type it says.
  assert.equal(M.mediaEntries([file('x.GIF', 'image/png')])[0].gif, true);
});

test('newest first: by when it was sent, then by id; under month headings', () => {
  const a = msg('01a', Date.UTC(2026, 9, 20, 12));
  const b = msg('01b', Date.UTC(2026, 9, 20, 12)); // the same moment: the later id first
  const c = msg('01c', Date.UTC(2026, 8, 30, 12));
  const d = msg('01d', Date.UTC(2026, 9, 25, 12));
  assert.deepEqual([a, b, c, d].sort(M.newestFirst).map((m) => m.id), ['01d', '01b', '01a', '01c']);
  assert.equal(M.monthLabel(Date.UTC(2026, 9, 20, 12), 'en-US'), 'October 2026');
  const at = new Date(2026, 9, 3).getTime();
  assert.equal(M.monthOf(at), '2026-10');
  const groups = M.byMonth([d, b, a, c].map((m) => ({ m })), 'en-US');
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((t) => t.m.id)]), [['October 2026', ['01d', '01b', '01a']], ['September 2026', ['01c']]]);
});

test('the tiles: newest message first, its files in the order sent; All, Photos and Videos', () => {
  const older = msg('01a', 1000, [file('a1.png', 'image/png'), file('a2.mp4', 'video/mp4'), file('a.pdf', 'application/pdf')]);
  const newer = msg('01b', 2000, [file('b1.webm', 'video/webm'), file('b2.jpg', 'image/jpeg')]);
  const names = (r) => r.tiles.map((t) => t.f.name);
  assert.deepEqual(names(M.pickTiles([older, newer], { files, view: show })), ['b1.webm', 'b2.jpg', 'a1.png', 'a2.mp4']);
  assert.deepEqual(names(M.pickTiles([older, newer], { files, view: show, kind: 'img' })), ['b2.jpg', 'a1.png']);
  assert.deepEqual(names(M.pickTiles([older, newer], { files, view: show, kind: 'video' })), ['b1.webm', 'a2.mp4']);
  // Each tile knows its message and its place there (what photo comments and tags name).
  const [t] = M.pickTiles([older], { files, view: show }).tiles;
  assert.equal(t.m, older); assert.equal(t.fi, 0); assert.equal(t.kind, 'img'); assert.equal(t.blur, false);
  // Takes any list of messages (the panel keeps them in a Map).
  assert.equal(M.pickTiles(new Map([['x', older]]).values(), { files, view: show }).tiles.length, 2);
});

test('left out: what can’t be shown; set apart: what the word filter hides; blurred: what it blurs', () => {
  const ok = msg('01a', 1000, [file('ok.png', 'image/png')]);
  const blocked = msg('01b', 2000, [file('blocked.png', 'image/png')], { authorId: 'blocked' });
  const unreadable = { id: '01c', createdAt: 3000, authorId: 'u1', dec: { error: 'x' } };
  const hidden = msg('01d', 4000, [file('hidden.png', 'image/png')]);
  const blurred = msg('01e', 5000, [file('blurred.png', 'image/png')]);
  const view = (m) => (m.authorId === 'blocked' || m.dec.error ? null : m === hidden ? 'hide' : m === blurred ? 'blur' : 'show');
  const files2 = (m) => m.dec.f || [];
  const r = M.pickTiles([ok, blocked, unreadable, hidden, blurred], { files: files2, view });
  assert.deepEqual(r.tiles.map((t) => [t.f.name, t.blur]), [['blurred.png', true], ['ok.png', false]]);
  assert.deepEqual(r.hidden.map((t) => t.f.name), ['hidden.png']);
  // Each hidden one knows its place: just before the tile after it (here ok.png, the second), or after the last.
  assert.equal(r.hidden[0].after, 1);
  const oldest = msg('01z', 1, [file('last.png', 'image/png')]);
  const r2 = M.pickTiles([ok, oldest], { files: files2, view: (m) => (m === oldest ? 'hide' : 'show') });
  assert.deepEqual(r2.hidden.map((t) => [t.f.name, t.after]), [['last.png', 1]], 'after the last tile: tiles.length');
});

test('the tag filter: only the photos carrying the tag, by message and place', () => {
  const a = msg('01a', 1000, [file('a0.png', 'image/png'), file('a1.png', 'image/png'), file('a2.mp4', 'video/mp4')]);
  const b = msg('01b', 2000, [file('b0.png', 'image/png')]);
  const index = new Map([
    ['beach', [{ messageId: '01a', fileIdx: 1 }, { messageId: '01b', fileIdx: 0 }, { messageId: '01a', fileIdx: 1 }]],
    ['Cats', [{ messageId: '01a', fileIdx: 2 }]],
    ['cats-too', []],
    ['zebra', [{ messageId: '01b', fileIdx: 0 }]],
  ]);
  const tagged = M.taggedSet(index.get('beach'));
  assert.deepEqual([...tagged].sort(), ['01a:1', '01b:0']);
  assert.deepEqual(M.pickTiles([a, b], { files, view: show, tagged }).tiles.map((t) => t.f.name), ['b0.png', 'a1.png']);
  // With Videos picked as well, both apply.
  assert.deepEqual(M.pickTiles([a, b], { files, view: show, kind: 'video', tagged: M.taggedSet(index.get('Cats')) }).tiles.map((t) => t.f.name), ['a2.mp4']);
  // The chips: each label with how many photos carry it (each photo once), the most used first, then A to Z; a label
  // nobody uses any more isn't one.
  assert.deepEqual(M.tagChips(index), [{ label: 'beach', count: 2 }, { label: 'Cats', count: 1 }, { label: 'zebra', count: 1 }]);
  assert.deepEqual(M.tagChips(null), []);
  assert.deepEqual(M.tagChips({ beach: [] }), []);
  assert.deepEqual([...M.taggedSet([null, { messageId: 5, fileIdx: 0 }, { messageId: '01a', fileIdx: 0 }])], ['01a:0']);
});

test('photos with a tag that aren’t here yet are asked for by id, at most 100 at a time, only ids the server takes', () => {
  const list = [];
  for (let i = 0; i < 230; i++) list.push({ messageId: `m${String(i).padStart(3, '0')}`, fileIdx: i % 3 });
  list.push({ messageId: 'm001', fileIdx: 2 }, { messageId: '../etc', fileIdx: 0 }, { messageId: 'x'.repeat(65), fileIdx: 0 }, { messageId: 7, fileIdx: 0 }, null);
  const have = new Set(['m000', 'm005']);
  const batches = M.idBatches(list, (id) => have.has(id));
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 28]);
  const all = batches.flat();
  assert.equal(new Set(all).size, all.length, 'each id once');
  assert.ok(!all.includes('m000') && !all.includes('m005'), 'not the ones here already');
  assert.ok(all.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)));
  assert.deepEqual(M.idBatches([], () => false), []);
  assert.equal(M.IDS_MAX, 100);
});

test('the pages: GET /dms/:id/media or /channels/:id/media, 30 at a time, older ones before the oldest so far', () => {
  assert.equal(M.PAGE, 30);
  assert.equal(M.mediaPath('d:dm1', { limit: '30' }), '/dms/dm1/media?limit=30');
  assert.equal(M.mediaPath('c:ch1', { limit: '30', before: '01abc' }), '/channels/ch1/media?limit=30&before=01abc');
  assert.equal(M.mediaPath('c:ch1', { ids: ['a', 'b', 'c'].join(',') }), '/channels/ch1/media?ids=a%2Cb%2Cc');
  assert.equal(M.mediaPath('d:a/b'), '/dms/a%2Fb/media');
  // What a deleted message's files were (their decrypted copies are let go of), thumbnails too.
  const m = msg('01a', 1, [file('a.png', 'image/png', { th: { url: '/uploads/th.bin', k: 'k' } }), file('b.pdf', 'application/pdf')]);
  assert.deepEqual(M.fileUrls([m], files), ['/uploads/apng.bin', '/uploads/th.bin', '/uploads/bpdf.bin']);
});

test('the panel does nothing until it’s drawn, and lets go of everything when it closes', () => {
  const calls = [];
  const P = M.createMediaPanel(new Proxy({}, { get: (_, k) => (k === 'autoloadMax' ? 0 : (...a) => { calls.push(k); return null; }) }));
  for (const k of ['draw', 'onNew', 'onUpdate', 'onDelete', 'onMeta', 'reset', 'messages', 'expire']) assert.equal(typeof P[k], 'function', k);
  P.onNew('d:1', msg('01a', 1, [file('a.png', 'image/png')]));
  P.onDelete('d:1', ['01a']);
  P.onDelete(null, new Set(['01a']));
  P.onMeta('d:1', '01a');
  P.expire();
  P.reset();
  assert.deepEqual(P.messages(), []);
  assert.deepEqual(calls, [], 'no server requests, no decrypting, no copies dropped');
});

// ---- the panel itself, against a fake server
// Messages as the server keeps them, newest first by id ("m0042" is newer than "m0041"), each with what's inside it
// (plain). A page or a ?ids= answer is a new copy of each, as from the network, that deps.decrypt opens: a channel's
// only once the app has its server's key (keys).
const png = (name, extra = {}) => ({ url: `/uploads/${name}.bin`, k: 'k', name: `${name}.png`, type: 'image/png', size: 1000, th: { url: `/uploads/${name}th.bin`, k: 'k' }, ...extra });
const pdf = (name) => ({ url: `/uploads/${name}.bin`, k: 'k', name: `${name}.pdf`, type: 'application/pdf', size: 1000 });
const mp4 = (name) => ({ url: `/uploads/${name}.bin`, k: 'k', name: `${name}.mp4`, type: 'video/mp4', size: 1000 });
const idOf = (n) => `m${String(n).padStart(4, '0')}`;
const sent = (n, f, extra = {}) => ({ id: idOf(n), channelId: 'ch1', serverId: 's1', authorId: 'u1', createdAt: Date.UTC(2026, 9, 1) + n * 60000, plain: { t: extra.t || '', f }, ...extra });

function panel({ key = 'c:ch1', msgs = [], keys = ['s1'], tags = new Map(), tall = false } = {}) {
  const server = { msgs: [...msgs], fail: 0 };
  const has = new Set(keys);
  const chat = new Map(); // the chat's own (decrypted) copies, by id (deps.known)
  const counts = new Map(); // "id:fi" -> comment count (deps.badges)
  const log = { requests: [], decrypted: [], loads: [], opened: [], dropped: [], forgot: [], armed: 0 };
  const clock = { now: Date.UTC(2026, 9, 2) };
  const net = (m) => { const { plain, ...rest } = m; return { ...rest, ciphertext: JSON.stringify(plain) }; };
  const deps = {
    key: () => key,
    get: async (p) => {
      log.requests.push(p);
      if (server.fail) { server.fail--; throw new Error('Too many requests. Try again in a minute.'); }
      const u = new URL(p, 'http://hearth.test');
      const all = server.msgs.filter((m) => !(m.expiresAt && m.expiresAt <= clock.now)).sort((a, b) => (a.id < b.id ? 1 : -1));
      if (u.searchParams.has('ids')) {
        const ids = new Set(u.searchParams.get('ids').split(','));
        return { messages: all.filter((m) => ids.has(m.id)).map(net), next: null };
      }
      const limit = Number(u.searchParams.get('limit'));
      const before = u.searchParams.get('before');
      const page = all.filter((m) => !before || m.id < before).slice(0, limit);
      return { messages: page.map(net), next: page.length === limit ? page[page.length - 1].id : null };
    },
    decrypt: async (m) => {
      log.decrypted.push(m.id);
      if (m.dec && !m.dec.pending) return;
      m.dec = !m.serverId || has.has(m.serverId) ? JSON.parse(m.ciphertext) : { pending: true, t: '', f: [] };
    },
    known: (id) => chat.get(id) || null,
    files: (m) => (m.dec && m.dec.f) || [],
    readable: (m) => !!m.dec && !m.dec.error && !m.dec.pending,
    expired: (m) => !!m.expiresAt && m.expiresAt <= clock.now,
    disappears: (m) => !!m.expiresAt,
    blocked: () => false,
    veiled: (m) => (m.dec && /secret/.test(m.dec.t) ? { action: 'hide' } : null),
    filterLabel: () => 'Blurred',
    reveal() {},
    thumb: (m, f) => { log.loads.push(`${m.id}:${f.name}`); return Promise.resolve(`blob:${f.name}`); },
    full: (m, f) => { log.loads.push(`${m.id}:${f.name} (whole)`); return Promise.resolve(`blob:${f.name}`); },
    queue: (fn) => Promise.resolve().then(fn),
    autoloadMax: 2 * 1024 * 1024,
    open: (from, opts) => log.opened.push({ from, ...opts }),
    download() {},
    badges: (m, fi) => {
      const n = counts.get(`${m.id}:${fi}`);
      if (!n) return null;
      const b = globalThis.document.createElement('span');
      b.className = 'pn-badges';
      b.textContent = `${n} comments`;
      return b;
    },
    tagIndex: async () => tags,
    panelHead: (title) => { const d = globalThis.document.createElement('div'); d.textContent = title; return d; },
    forget: (gone, ids, k) => log.forgot.push({ ids: [...ids], key: k }),
    drop: (urls) => log.dropped.push(...urls),
    armExpiry: () => { log.armed++; },
  };
  const P = M.createMediaPanel(deps);
  const el = globalThis.document.createElement('aside');
  globalThis.document.body.append(el);
  const parts = () => ({ scroll: el.querySelector('.mp-scroll'), foot: el.querySelector('.mp-foot') });
  const draw = () => {
    P.draw(el);
    // Each tile is 80px of list in a list 600px high (tall), or the list never scrolls (it's all in view).
    const sc = parts().scroll;
    sc.clientHeight = 600;
    sc.layout = tall ? (x) => x.querySelectorAll('.mp-tile').length * 80 : () => 0;
  };
  const shown = () => el.querySelectorAll('.mp-tile').map((t) => t.dataset.gid);
  const tile = (gid) => el.querySelectorAll('.mp-tile').find((t) => t.dataset.gid === gid) || null;
  const footText = () => parts().foot.textContent;
  const button = (text) => el.querySelectorAll('button').find((b) => b.textContent === text) || null;
  const pages = () => log.requests.filter((r) => /[?&]limit=/.test(r));
  const scrollTo = (top) => { const sc = parts().scroll; sc.scrollTop = top; sc.dispatch('scroll'); };
  return { P, el, deps, server, has, chat, counts, log, clock, net, draw, shown, tile, footText, button, pages, scrollTo, parts, close: () => { P.reset(); el.remove(); } };
}

test('the panel pages back 30 at a time, before the oldest so far, until the server says there are no more', async () => {
  const msgs = [];
  for (let n = 1; n <= 75; n++) msgs.push(sent(n, [png(`p${n}`)]));
  const t = panel({ msgs });
  t.draw();
  await settle();
  // The list never fills the screen here, so each page asks for the next, until a page that wasn't full.
  assert.deepEqual(t.log.requests, ['/channels/ch1/media?limit=30', `/channels/ch1/media?limit=30&before=${idOf(46)}`, `/channels/ch1/media?limit=30&before=${idOf(16)}`]);
  assert.equal(t.shown().length, 75);
  assert.equal(t.shown()[0], `${idOf(75)}:0`, 'newest first');
  assert.equal(t.footText(), '', 'nothing more to load, and something to show');
  // Drawn again, or scrolled: nothing more is asked for.
  t.draw();
  t.scrollTo(10);
  await settle();
  assert.equal(t.log.requests.length, 3);
  t.close();
});

test('a page comes as the end of the list scrolls into view', async () => {
  const msgs = [];
  for (let n = 1; n <= 75; n++) msgs.push(sent(n, [png(`p${n}`)]));
  const t = panel({ msgs, tall: true });
  t.draw();
  await settle();
  // 30 tiles: 2400px of list in 600px, the end far away: not yet.
  assert.equal(t.pages().length, 1);
  t.scrollTo(100);
  await settle();
  assert.equal(t.pages().length, 1, 'still far from the end');
  t.scrollTo(1300);
  await settle();
  assert.deepEqual(t.pages().slice(1), [`/channels/ch1/media?limit=30&before=${idOf(46)}`]);
  assert.equal(t.shown().length, 60);
  t.close();
});

test('pages with nothing to show: after three in a row it waits for Show older or a scroll, and doesn’t page through everything', async () => {
  // 600 messages with files (20 pages): the two newest have a photo, the rest only PDFs.
  const msgs = [];
  for (let n = 1; n <= 600; n++) msgs.push(sent(n, n > 598 ? [png(`p${n}`)] : [pdf(`d${n}`)]));
  const t = panel({ msgs });
  t.draw();
  await settle();
  assert.equal(t.pages().length, 1 + M.IDLE_PAGES, 'the first page, then three that brought nothing');
  assert.deepEqual(t.shown(), [`${idOf(600)}:0`, `${idOf(599)}:0`]);
  assert.ok(t.button('Show older'), 'Show older instead');
  // Asked for: three more at most.
  t.button('Show older').click();
  await settle();
  assert.equal(t.pages().length, 1 + 2 * M.IDLE_PAGES);
  // Scrolling down goes on too (three more).
  t.scrollTo(5);
  await settle();
  assert.equal(t.pages().length, 1 + 3 * M.IDLE_PAGES);
  // Drawn again (people going Away), or scrolled back up: nothing more.
  t.draw();
  t.scrollTo(0);
  await settle();
  assert.equal(t.pages().length, 1 + 3 * M.IDLE_PAGES);
  // Another filter starts counting again.
  t.el.querySelectorAll('.seg-btn').find((b) => b.dataset.kind === 'video').click();
  await settle();
  assert.equal(t.pages().length, 1 + 4 * M.IDLE_PAGES, 'Videos: three pages more, then it waits again');
  assert.match(t.footText(), /Show older/);
  t.close();
});

test('with Videos picked, a page with a video in it keeps paging going', async () => {
  // A video every fourth page (120 messages), the rest photos.
  const msgs = [];
  for (let n = 1; n <= 360; n++) msgs.push(sent(n, n % 120 === 0 ? [mp4(`v${n}`)] : [png(`p${n}`)]));
  const t = panel({ msgs, tall: true });
  t.draw();
  await settle();
  assert.equal(t.pages().length, 1, '30 photos fill the list');
  t.el.querySelectorAll('.seg-btn').find((b) => b.dataset.kind === 'video').click();
  await settle();
  // The first page had a video (m0360); pages 2-4 none: it stops there, at the third.
  assert.equal(t.pages().length, 1 + M.IDLE_PAGES);
  assert.deepEqual(t.shown(), [`${idOf(360)}:0`]);
  t.button('Show older').click();
  await settle();
  // Page 5 brings m0240's video (counting starts again), then three more without.
  assert.deepEqual(t.shown(), [`${idOf(360)}:0`, `${idOf(240)}:0`]);
  assert.equal(t.pages().length, 1 + M.IDLE_PAGES + 1 + M.IDLE_PAGES);
  t.close();
});

test('an error says so with Try again, which asks again', async () => {
  const t = panel({ msgs: [sent(1, [png('a')]), sent(2, [png('b')])] });
  t.server.fail = 1;
  t.draw();
  await settle();
  assert.match(t.footText(), /Too many requests/);
  assert.deepEqual(t.shown(), []);
  assert.equal(t.log.requests.length, 1, 'no more pages after an error');
  t.button('Try again').click();
  await settle();
  assert.deepEqual(t.log.requests, ['/channels/ch1/media?limit=30', '/channels/ch1/media?limit=30']);
  assert.deepEqual(t.shown(), [`${idOf(2)}:0`, `${idOf(1)}:0`]);
  t.close();
});

test('a tag picked: no paging meanwhile, and only the photos not here in any copy are asked for (by id, once)', async () => {
  const msgs = [];
  for (let n = 1; n <= 40; n++) msgs.push(sent(n, [png(`p${n}`), png(`q${n}`)]));
  const tags = new Map([['beach', [
    { messageId: idOf(40), fileIdx: 1 }, // in the first page
    { messageId: idOf(5), fileIdx: 0 }, // older: not here yet
    { messageId: idOf(3), fileIdx: 0 }, // fetched by photo-notes.js for its tag index
    { messageId: idOf(2), fileIdx: 1 }, // loaded in the chat
  ]]]);
  const t = panel({ msgs, tags, tall: true });
  // The chat's copy, and photo-notes.js's (handed over as it decrypted it).
  const copy = async (n) => { const m = t.net(msgs[n - 1]); await t.deps.decrypt(m); return m; };
  t.chat.set(idOf(2), await copy(2));
  t.P.offer(await copy(3));
  t.draw();
  await settle();
  assert.equal(t.pages().length, 1);
  const chip = t.el.querySelector('button.mp-tag');
  assert.equal(chip.dataset.label, 'beach');
  chip.click();
  await settle();
  assert.deepEqual(t.log.requests.slice(1), [`/channels/ch1/media?ids=${idOf(5)}`], 'only the one no copy of is here');
  assert.deepEqual(t.shown(), [`${idOf(40)}:1`, `${idOf(5)}:0`, `${idOf(3)}:0`, `${idOf(2)}:1`]);
  // Four tiles: the end of the list is in view, but a tag is picked: no paging.
  t.scrollTo(50);
  await settle();
  assert.equal(t.pages().length, 1);
  // Cleared: the pages again (the older ones fetched for the tag show when paging gets there).
  t.el.querySelector('.chip-x').click();
  await settle();
  assert.equal(t.shown().length, 60);
  assert.ok(!t.shown().includes(`${idOf(5)}:0`));
  t.close();
});

test('live: new messages on top, edits drawn again, a thread’s first message deleted takes its replies’ tiles with it', async () => {
  const root = sent(10, [png('root')]);
  const reply = sent(11, [png('reply')], { threadId: idOf(10) });
  const other = sent(12, [png('other')]);
  const t = panel({ msgs: [root, reply, other] });
  t.draw();
  await settle();
  assert.deepEqual(t.shown(), [`${idOf(12)}:0`, `${idOf(11)}:0`, `${idOf(10)}:0`]);
  // New: one with a photo goes on top; one with only a PDF doesn't show.
  const fresh = t.net(sent(13, [png('fresh')]));
  await t.deps.decrypt(fresh);
  t.P.onNew('c:ch1', fresh);
  const doc = t.net(sent(14, [pdf('doc')]));
  await t.deps.decrypt(doc);
  t.P.onNew('c:ch1', doc);
  t.P.onNew('c:other', t.net(sent(15, [png('elsewhere')])));
  assert.deepEqual(t.shown(), [`${idOf(13)}:0`, `${idOf(12)}:0`, `${idOf(11)}:0`, `${idOf(10)}:0`]);
  // Edited: decrypted again and drawn anew.
  const before = t.tile(`${idOf(12)}:0`);
  const edited = t.net({ ...other, plain: { t: 'now with words', f: [png('other')] } });
  await t.P.onUpdate('c:ch1', edited);
  assert.ok(t.log.decrypted.filter((id) => id === idOf(12)).length >= 2);
  assert.notEqual(t.tile(`${idOf(12)}:0`), before);
  // The thread's first message deleted (the server names only it): its reply goes too, with its decrypted copies.
  t.P.onDelete('c:ch1', new Set([idOf(10)]));
  assert.deepEqual(t.shown(), [`${idOf(13)}:0`, `${idOf(12)}:0`]);
  assert.deepEqual(t.log.dropped.sort(), ['/uploads/reply.bin', '/uploads/replyth.bin', '/uploads/root.bin', '/uploads/rootth.bin']);
  assert.ok(!t.P.messages().some((m) => [idOf(10), idOf(11)].includes(m.id)));
  t.close();
});

test('a thread’s first message deleted: no copy of its replies comes back, from a page on its way, the chat or a tag picked, and the chips are asked for again', async () => {
  const msgs = [];
  for (let n = 100; n <= 140; n++) msgs.push(sent(n, [png(`p${n}`)]));
  const root = sent(10, [png('root')]);
  const paged = sent(141, [png('paged')], { threadId: idOf(10) }); // in the first page, which is on its way
  const old = sent(11, [png('old')], { threadId: idOf(10) }); // older than the pages: only the chat has a copy
  const kept = sent(12, [png('kept')], { threadId: idOf(10) }); // photo-notes.js's copy, handed over (offer)
  const named = sent(13, [png('named')], { threadId: idOf(10) }); // no copy here: the app names it (its thread)
  const tags = new Map([['beach', [paged, old, kept, named, msgs[0]].map((m) => ({ messageId: m.id, fileIdx: 0 }))]]);
  const t = panel({ msgs: [...msgs, root, paged, old, kept, named], tags, tall: true });
  const copy = async (m) => { const c = t.net(m); await t.deps.decrypt(c); return c; };
  // The thread as the chat loaded it (deps.known), and photo-notes.js's copy.
  t.chat.set(old.id, await copy(old));
  t.P.offer(await copy(kept));
  let asked = 0;
  const index = t.deps.tagIndex;
  t.deps.tagIndex = (key) => { asked++; return index(key); };
  // The first page waits on the network while the delete comes.
  let arrive;
  const held = new Promise((r) => { arrive = r; });
  const get = t.deps.get;
  t.deps.get = async (p) => { const res = await get(p); if (/[?&]limit=/.test(p)) await held; return res; };
  t.draw();
  await settle();
  assert.deepEqual(t.P.repliesTo(new Set([root.id])), [kept.id], 'the replies it holds, for the app to tell photo-notes.js');
  // The server deletes the whole thread, and names only its first message (the app adds the reply it knows of).
  t.server.msgs = msgs;
  const before = asked;
  t.P.onDelete('c:ch1', new Set([root.id, named.id]));
  arrive();
  await settle();
  assert.ok(!t.shown().includes(`${paged.id}:0`), 'the page answered before the delete doesn’t bring it back');
  assert.equal(t.shown().length, 29, 'the rest of that page');
  await new Promise((r) => setTimeout(r, 450));
  assert.ok(asked > before, 'the tag chips are worked out again: their tags went too');
  // #beach picked (the chip as it was): only the photo still there shows, and only it is asked for.
  t.log.requests.length = 0;
  t.el.querySelector('button.mp-tag').click();
  await settle();
  assert.deepEqual(t.shown(), [`${msgs[0].id}:0`]);
  assert.deepEqual(t.log.requests, [`/channels/ch1/media?ids=${msgs[0].id}`], 'none of the replies is asked for');
  assert.ok(!t.P.messages().some((m) => m.threadId === root.id));
  t.close();
});

test('a page takes a copy the app has only when it’s the same version, with the page’s tags and counts; a resync lets go of photo-notes.js’s', async () => {
  const same = sent(3, [png('same')], { fileReplies: { 0: 0 } });
  const edited = sent(2, [png('edited')]);
  const later = sent(1, [png('later')]);
  const t = panel({ msgs: [same, edited, later] });
  const copy = async (m) => { const c = t.net(m); await t.deps.decrypt(c); return c; };
  const kept = { same: await copy(same), edited: await copy(edited), later: await copy(later) };
  for (const m of Object.values(kept)) t.P.offer(m);
  // Meanwhile, as photo-notes.js's copies don't hear: two comments and a tag on the first one's photo, the second edited.
  const tag = { id: 'T'.repeat(22), fileIdx: 0, authorId: 'u2', ciphertext: 'td1:x', createdAt: 9 };
  t.server.msgs = [{ ...same, fileReplies: { 0: 2 }, tags: [tag] }, { ...edited, plain: { t: 'edited', f: [png('edited')] }, editedAt: 5 }, later];
  t.draw();
  await settle();
  const held = (m) => t.P.messages().find((x) => x.id === m.id);
  assert.equal(held(same), kept.same, 'the same version: not decrypted again');
  assert.deepEqual(held(same).fileReplies, { 0: 2 }, 'with the page’s counts');
  assert.deepEqual(held(same).tags, [tag], 'and tags');
  assert.notEqual(held(edited), kept.edited, 'edited since: the page’s copy');
  assert.equal(held(edited).dec.t, 'edited');
  // Closed and opened again, photo-notes.js's copies are still used; after a resync (app.js loadBootstrap) they aren't.
  t.P.reset();
  t.draw();
  await settle();
  assert.equal(held(later), kept.later);
  t.P.reset({ all: true });
  t.draw();
  await settle();
  assert.notEqual(held(later), kept.later);
  assert.deepEqual(held(later).dec, kept.later.dec);
  t.close();
});

test('a comment or tag on a photo changes its badges in place: the tile, its picture and the focus stay', async () => {
  const m = sent(1, [png('a'), png('b')]);
  const t = panel({ msgs: [m] });
  t.draw();
  await settle();
  const tile = t.tile(`${idOf(1)}:1`);
  near(tile);
  await settle();
  const img = tile.querySelector('img');
  assert.equal(img.src, 'blob:b.png');
  const open = tile.querySelector('.mp-open');
  open.focus();
  // The badges' place is there before there's anything in it.
  const slot = tile.querySelector(':scope > .mp-badges');
  assert.ok(slot && !slot.firstChild);
  // The chat has this message: what changed is taken from its copy.
  const chatCopy = t.net(m);
  await t.deps.decrypt(chatCopy);
  chatCopy.fileReplies = { 1: 2 };
  t.chat.set(m.id, chatCopy);
  t.counts.set(`${idOf(1)}:1`, 2);
  t.P.onMeta('c:ch1', m.id);
  assert.equal(t.tile(`${idOf(1)}:1`), tile, 'the same tile');
  assert.equal(tile.querySelector('img'), img);
  assert.equal(globalThis.document.activeElement, open, 'the focus stays');
  assert.equal(slot.textContent, '2 comments');
  assert.deepEqual(t.P.messages()[0].fileReplies, { 1: 2 });
  // Drawn again for anything else: still the same tile.
  t.draw();
  assert.equal(t.tile(`${idOf(1)}:1`), tile);
  t.close();
});

test('thumbnails of photos the word filter hides load as their place comes near the screen, not all at once', async () => {
  // Newest first: A, (hidden 1), B, C, (hidden 2), D, (hidden 3).
  const msgs = [
    sent(7, [png('A')]), sent(6, [png('H1')], { t: 'secret' }), sent(5, [png('B')]), sent(4, [png('C')]),
    sent(3, [png('H2')], { t: 'secret' }), sent(2, [png('D')]), sent(1, [png('H3')], { t: 'secret' }),
  ];
  const t = panel({ msgs });
  t.draw();
  await settle();
  assert.deepEqual(t.shown(), [7, 5, 4, 2].map((n) => `${idOf(n)}:0`));
  assert.deepEqual(t.log.loads, [], 'nothing before anything comes near');
  const loaded = async (el) => { const was = t.log.loads.length; near(el); await settle(); return t.log.loads.slice(was).sort(); };
  assert.deepEqual(await loaded(t.tile(`${idOf(7)}:0`)), [`${idOf(7)}:A.png`]);
  assert.deepEqual(await loaded(t.tile(`${idOf(5)}:0`)), [`${idOf(5)}:B.png`, `${idOf(6)}:H1.png`]);
  assert.deepEqual(await loaded(t.tile(`${idOf(4)}:0`)), [`${idOf(4)}:C.png`]);
  // Drawn again meanwhile (a new message on top): each still waits where it was, once.
  const top = t.net(sent(8, [png('top')]));
  await t.deps.decrypt(top);
  t.P.onNew('c:ch1', top);
  assert.deepEqual(await loaded(t.tile(`${idOf(2)}:0`)), [`${idOf(2)}:D.png`, `${idOf(3)}:H2.png`]);
  assert.deepEqual(await loaded(t.parts().foot), [`${idOf(1)}:H3.png`], 'after the last tile: with the end of the list');
  assert.deepEqual(await loaded(t.tile(`${idOf(5)}:0`)), [], 'nothing twice');
  t.close();
});

test('disappearing messages go on time, with what the app kept of them', async () => {
  const t = panel({ msgs: [sent(1, [png('stays')]), sent(2, [png('goes')], { expiresAt: Date.UTC(2026, 9, 2) + 5000 })] });
  t.draw();
  await settle();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(t.shown().length, 2);
  assert.ok(t.log.armed > 0, 'the disappearing timer looks at it');
  assert.ok(t.P.messages().some((m) => m.id === idOf(2)), 'the timer counts it in');
  t.P.expire();
  assert.equal(t.shown().length, 2, 'not yet');
  t.clock.now += 6000;
  t.P.expire();
  assert.deepEqual(t.shown(), [`${idOf(1)}:0`]);
  assert.deepEqual(t.log.forgot, [{ ids: [idOf(2)], key: 'c:ch1' }]);
  assert.deepEqual(t.P.messages().map((m) => m.id), [idOf(1)]);
  // Gone from wherever else it was loaded (the app's expiry listeners): from here too.
  t.P.onDelete(null, new Set([idOf(1)]));
  assert.deepEqual(t.shown(), []);
  t.close();
});

test('messages waiting for their channel’s key show once it comes', async () => {
  const t = panel({ msgs: [sent(1, [png('a')]), sent(2, [png('b')])], keys: [] });
  t.draw();
  await settle();
  assert.deepEqual(t.shown(), []);
  assert.match(t.footText(), /No photos or videos here yet/);
  // Live ones while it waits: kept until it's known what they have.
  const live = t.net(sent(3, [png('c')]));
  await t.deps.decrypt(live);
  t.P.onNew('c:ch1', live);
  const words = t.net(sent(4, []));
  await t.deps.decrypt(words);
  t.P.onNew('c:ch1', words);
  t.has.add('s1');
  t.P.onKeys('s2'); // another server's
  await settle();
  assert.deepEqual(t.shown(), []);
  t.P.onKeys('s1');
  await settle();
  assert.deepEqual(t.shown(), [3, 2, 1].map((n) => `${idOf(n)}:0`));
  assert.ok(!t.P.messages().some((m) => m.id === idOf(4)), 'one with no pictures isn’t kept any more');
  t.close();
});

test('drawn again in the same place (people going Away), the panel stays put: nothing is taken out', async () => {
  const t = panel({ msgs: [sent(1, [png('a')])] });
  t.draw();
  await settle();
  const { scroll } = t.parts();
  assert.equal(t.P.drawn(t.el), true);
  const was = scroll.detached;
  t.draw();
  t.draw();
  assert.equal(scroll.detached, was, 'never taken out');
  assert.equal(scroll.parentNode, t.el);
  // Emptied by the app (another panel, then this one again): put back, where it was scrolled to.
  scroll.scrollTop = 120;
  scroll.dispatch('scroll');
  t.el.replaceChildren();
  assert.equal(t.P.drawn(t.el), false);
  scroll.scrollTop = 0;
  t.draw();
  assert.equal(scroll.parentNode, t.el);
  assert.equal(scroll.scrollTop, 120);
  t.close();
  assert.equal(t.P.drawn(t.el), false);
});

test('the module never names a chat row (data-mid), and the interface says “Photos & videos”', () => {
  const src = read('public', 'js', 'media-panel.js');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /data-mid|dataset:\s*\{\s*mid\b/, 'tiles must not look like message rows (replaceMessageEl swaps every [data-mid])');
  assert.doesNotMatch(code, /gallery/i, '“Gallery” already means the picture viewer');
  assert.match(src, /panelHead\('Photos & videos'\)/);
  assert.match(src, /No photos or videos here yet\. Pictures and videos sent in this conversation show up here\./);
  assert.match(read('public', 'js', 'util.js'), /^ {2}images: '<svg /m);
});

test('app.js: the panel is a side panel of DMs, group chats and channels, and keeps up with what happens there', () => {
  const app = read('public', 'js', 'app.js');
  const fn = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a)); };
  // The panel: drawn by media-panel.js, hidden while sharing your screen (DMs and groups), as wide as a thread.
  const rp = fn('renderPanel');
  assert.match(rp, /mode === 'media'\) && hiddenWhileSharing\(privateKey\(\)\)/);
  assert.ok(rp.indexOf("if (mode === 'media') {") > 0 && rp.indexOf("if (mode === 'media') {") < rp.indexOf("if (S.view.type === 'dm') return dmProfilePanel(el);"), 'before the profile panel of a DM');
  assert.match(rp, /if \(mode !== 'media'\) MEDIA\.reset\(\);/);
  assert.match(fn('resizeHandle'), /panelMode\(\) === 'media'/);
  // Another conversation closes it.
  assert.match(fn('setView'), /S\.panel === 'media' && \(!\['channel', 'dm'\]\.includes\(v\.type\) \|\| currentKey\(\) !== from\)\) S\.panel = null;/);
  // Its ways in: the ⋯ menu everywhere, and a header button in DMs and group chats.
  const head = fn('drawHeader');
  assert.equal((head.match(/\[PIN_ITEM, MEDIA_ITEM, SCHED_ITEM\(\)/g) || []).length, 3, 'channels, group chats, DMs');
  assert.equal((head.match(/mediaButton\(\),/g) || []).length, 2, 'group chats and DMs');
  assert.match(head, /label: S\.panel === 'media' \? 'Hide photos & videos' : 'Photos & videos', icon: 'images'/);
  // Live: new, edited, deleted and disappearing messages, and the word filter.
  // (An expired one returns first, once the conversation's line has its newest message back.)
  assert.match(fn('onNewMessage'), /if \(isExpired\(m, nowServer\(\)\)\) \{ [^\n]*return; \}\n {2}MEDIA\.onNew\(key, m\);/);
  assert.match(fn('onThreadMessage'), /MEDIA\.onNew\('c:' \+ m\.channelId, m\)/);
  assert.match(fn('onUpdateMessage'), /if \(i < 0\) return MEDIA\.onUpdate\(key, m\);/);
  assert.match(fn('onDeleteMessage'), /MEDIA\.onDelete\(key, gone\);/);
  // A thread's first message deleted: its replies the app holds go too (the thread's, Photos & videos', photo tags'),
  // and so does the thread as it was loaded, whose copies the panel would take (known).
  assert.match(fn('onDeleteMessage'), /\.\.\.MEDIA\.repliesTo\(named\), \.\.\.NOTES\.repliesTo\(named, key\)/);
  assert.match(fn('onDeleteMessage'), /for \(const x of named\) delete S\.threads\[x\];/);
  assert.doesNotMatch(fn('onDeleteMessage'), /if \(expired\) delete S\.threads/);
  // After a resync, photo-notes.js's copies it was handed (which may be out of date) go too.
  assert.match(fn('loadBootstrap'), /MEDIA\.reset\(\{ all: true \}\);/);
  assert.match(fn('onDeleteChannelMessages'), /MEDIA\.onDelete\('c:' \+ channelId, replies\)/);
  assert.match(fn('armClientExpiry'), /for \(const m of MEDIA\.messages\(\)\) items\.push\(m\);/);
  assert.match(fn('purgeExpired'), /MEDIA\.expire\(\);/);
  assert.match(app, /expiryListeners\.add\(\(ids\) => MEDIA\.onDelete\(null, ids\)\);/);
  assert.match(fn('redrawFiltered'), /mode === 'media'\) renderPanel\(\);/);
  // A channel key arriving: after the chat has opened its own copies, the panel opens those it has.
  const keys = fn('onKeysChanged');
  assert.ok(keys.indexOf('MEDIA.onKeys(serverId);') > keys.indexOf('await decryptAll('), 'after the chat’s copies are opened');
  // Redraws of the side panel (presence) leave it where it is, unless it's to be hidden now (sharing your screen).
  assert.match(rp, /if \(mode === 'media' && el\.dataset\.mode === 'media' && !hiddenWhileSharing\(privateKey\(\)\) && MEDIA\.drawn\(el\)\) \{\n {4}MEDIA\.draw\(el\);\n {4}return;\n {2}\}/);
  assert.ok(rp.indexOf('MEDIA.drawn(el)') < rp.indexOf('clear(el);'), 'before the panel is emptied');
  // What photo-notes.js decrypts for its tag index is handed over, so a tag picked doesn't fetch it again.
  const notes = app.slice(app.indexOf('const NOTES = createPhotoNotes({'), app.indexOf('\n});\n', app.indexOf('const NOTES = createPhotoNotes({')));
  assert.match(notes, /decrypt: \(m\) => decryptMessage\(m\)\.then\(\(\) => MEDIA\.offer\(m\)\),/);
});

test('app.js: the viewer takes a list (videos too), knows its messages from it, and has Jump to message', () => {
  const app = read('public', 'js', 'app.js');
  const a = app.indexOf('function openViewer(');
  const v = app.slice(a, app.indexOf('\nasync function toPng(', a));
  assert.match(v, /function openViewer\(fromImg, \{ name, download, items: given = null, index = 0, side = false \} = \{\}\)/);
  // Without a list, the chat's pictures as before (unopened spoilers left out), each with its photo (img._item).
  assert.match(app, /function chatViewerItem\(img, [^)]*\) \{[\s\S]*?const it = img\._item;/);
  // The messages shown come from the items, never from rows around them (the panel's tiles have none).
  assert.match(v, /overlay\._mids = new Set\(items\.map\(\(it\) => \(it\.m \? it\.m\.id : it\.mid\)\)\.filter\(Boolean\)\);/);
  assert.doesNotMatch(v, /closest\('\[data-mid\]'\)/);
  // A video plays in the stage, without zooming.
  assert.match(v, /h\('video', \{ class: 'viewer-video', controls: true, playsinline: true/);
  assert.match(v, /const zoom = \(f\) => \{ if \(isVideo\(\)\) return;/);
  // Jump to message: in the bar and the phone's More menu; on a phone the side panel closes too.
  assert.match(v, /'Jump to message'/g);
  assert.equal((v.match(/Jump to message/g) || []).length >= 2, true);
  assert.match(v, /if \(isPhoneLayout\(\) && panelMode\(\)\) closePanel\(\);/);
  // The photo's comments and tags (photo-notes.js) on every show, with a Comments button only when there's a panel.
  assert.match(v, /NOTES\.side\(it, \{ close: \(\) => setSide\(false\), focus: sideFocus \}\)/);
  assert.match(v, /sideBtn\.hidden = !el;/);
  // Typing in it doesn't move to the next picture or zoom; what opens from it goes over the viewer.
  assert.match(v, /e\.target\.closest\('input, textarea, select, \[contenteditable\]'\)\) return;/);
  // Nor do the arrow keys on a video with the focus: they seek it.
  const keys = v.slice(v.indexOf('const keys = (e) => {'), v.indexOf('\n  };\n', v.indexOf('const keys = (e) => {')));
  assert.match(keys, /if \(e\.target === video \|\| \(e\.target && e\.target\.closest && e\.target\.closest\('video'\)\)\) return;/);
  assert.ok(keys.indexOf("closest('video')") < keys.indexOf("e.key === 'ArrowRight'") && keys.indexOf("e.key === 'Escape'") < keys.indexOf("closest('video')"), 'Esc still closes it');
  // Closed, it gives the focus back to what opened it, or to the same photo's tile in the panel if that was drawn anew.
  assert.match(v, /const openerGid = openerTile \? openerTile\.dataset\.gid : null;/);
  assert.match(v, /\$\$\('#members \.mp-tile'\)\.find\(\(x\) => x\.dataset\.gid === openerGid\)/);
  assert.match(read('public', 'css', 'app.css'), /#layer > \.over-viewer \{ z-index: 85; \}/);
  // Close stays the bar's last button (focus goes there when it opens).
  assert.match(v, /more, ibtn\('close', 'Close \(Esc\)', close\)\);/);
});

test('app.css: the panel’s rules are in its own section, as wide as a thread, and hide the header button on phones', () => {
  const css = read('public', 'css', 'app.css');
  const start = css.indexOf('/* ======================================================================= Photos & videos panel (media-panel.js) */');
  const end = css.indexOf('/* (end of the Photos & videos panel) */');
  assert.ok(start > 0 && end > start);
  const mine = css.slice(start, end);
  assert.match(mine, /#members\[data-mode='media'\] \{ width: var\(--thread-w\); \}/);
  assert.match(mine, /@media \(max-width: 760px\), \(pointer: coarse\) and \(max-height: 500px\) \{\n {2}#main-head \.head-media \{ display: none; \}/);
  // A tile's badges let a click or a tap through to the tile (only a real button in them takes its own).
  assert.match(mine, /\.mp-badges \{[^}]*pointer-events: none;[^}]*\}/);
  assert.match(mine, /\.mp-badges :is\(button, a\) \{ pointer-events: auto; \}/);
  assert.match(mine, /\.mp-badges:empty \{ display: none; \}/);
  // On a phone the sheet keeps clear of the home bar itself: the picture above it doesn't pad for it too.
  assert.match(mine, /\.viewer\.side-open \.viewer-stage \{ padding-bottom: 0; \}/);
  assert.match(mine, /\.viewer\.side-open \.viewer-stage\.loading-full::after \{ bottom: 14px; \}/);
  // Nothing about the panel outside it.
  assert.doesNotMatch(css.slice(0, start) + css.slice(end), /\.mp-|head-media|viewer-side|viewer-video|viewer-jump|over-viewer/);
});
