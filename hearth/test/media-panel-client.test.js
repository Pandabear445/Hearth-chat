// Photos & videos, the app's side (public/js/media-panel.js): which files of a message are its pictures and videos,
// the order and the month headings, the Photos / Videos filter and the tag filter, and the pages it asks the server
// for. The module runs here as it is (no browser); test/e2e flows.mjs mediaPanel drives the real panel and viewer.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let M;
before(async () => {
  // (files.js asks api.js for the sign-in, which reads this browser's storage when it loads.)
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
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
  assert.match(fn('onNewMessage'), /if \(isExpired\(m, nowServer\(\)\)\) return;\n {2}MEDIA\.onNew\(key, m\);/);
  assert.match(fn('onThreadMessage'), /MEDIA\.onNew\('c:' \+ m\.channelId, m\)/);
  assert.match(fn('onUpdateMessage'), /if \(i < 0\) return MEDIA\.onUpdate\(key, m\);/);
  assert.match(fn('onDeleteMessage'), /MEDIA\.onDelete\(key, gone\);/);
  assert.match(fn('onDeleteChannelMessages'), /MEDIA\.onDelete\('c:' \+ channelId, replies\)/);
  assert.match(fn('armClientExpiry'), /for \(const m of MEDIA\.messages\(\)\) items\.push\(m\);/);
  assert.match(fn('purgeExpired'), /MEDIA\.expire\(\);/);
  assert.match(app, /expiryListeners\.add\(\(ids\) => MEDIA\.onDelete\(null, ids\)\);/);
  assert.match(fn('redrawFiltered'), /mode === 'media'\) renderPanel\(\);/);
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
  // Nothing about the panel outside it.
  assert.doesNotMatch(css.slice(0, start) + css.slice(end), /\.mp-|head-media|viewer-side|viewer-video|viewer-jump|over-viewer/);
});
