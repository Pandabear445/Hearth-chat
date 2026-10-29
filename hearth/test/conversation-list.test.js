// The conversation list's line for each DM and group chat ("You: see you at 6"): the conversation's newest message,
// which the apps decrypt and show. The server sends it with the DM or group, and again with every delete that can
// change it, to everyone in the conversation on every device they have open; an edit carries the message's new
// ciphertext, which the apps put in its place. The apps' side (public/js/app.js, run here from its own source) keeps
// the line right whichever order decryption finishes in, whether or not the conversation is loaded, and while
// someone is typing there the line keeps saying so until they stop.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex, sleep } = require('./helpers');

const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');
let srv; let alice; let bob; let carol; let outsider; let space;
const socks = [];
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
// A live connection like an open app window: two for one person are two of their devices.
const sock = async (u) => { const x = await srv.socket(u.token); socks.push(x); return x; };
const collect = (x, ev) => { const got = []; x.on(ev, (p) => got.push(p)); return got; };
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; }
async function sendD(u, dmId) {
  const r = await as(u, 'POST', `/dms/${dmId}/messages`, { ciphertext: cipher() });
  assert.equal(r.status, 200, r.text);
  return r.json;
}
async function sendC(u, channelId) {
  const c = srv.sql('SELECT server_id FROM channels WHERE id = ?', channelId)[0];
  srv.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', c.server_id);
  const r = await as(u, 'POST', `/channels/${channelId}/messages`, { ciphertext: cipher(), epoch: 1 });
  assert.equal(r.status, 200, r.text);
  return r.json;
}
// What a conversation's line is worked out from.
const lastOf = (m) => ({ id: m.id, authorId: m.authorId, ciphertext: m.ciphertext });
const brief = (last) => (last ? { id: last.id, authorId: last.authorId, ciphertext: last.ciphertext } : last);
const report = async (by, id) => {
  const r = await as(by, 'POST', '/reports', { category: 'harassment', context: { kind: 'message', messageId: id }, evidence: [{ id, text: 'mean' }] });
  assert.equal(r.status, 200, r.text);
};

let TY; // public/js/typing.js
before(async () => {
  TY = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'typing.js')).href);
  srv = await startServer();
  alice = await srv.register(`alice${hex(3)}`); bob = await srv.register(`bob${hex(3)}`); carol = await srv.register(`carol${hex(3)}`);
  outsider = await srv.register(`out${hex(3)}`);
  // DMs and group chats are between people who share a server.
  space = (await as(alice, 'POST', '/servers', { name: 'List HQ' })).json;
  const { code } = (await as(alice, 'POST', `/servers/${space.id}/invites`, {})).json;
  for (const u of [bob, carol]) assert.equal((await as(u, 'POST', `/invites/${code}/join`)).status, 200);
});
after(async () => { socks.forEach((s) => s.close()); await srv.stop(); });

// ------------------------------------------------------------------ the server's side
test('DM delete: both people, on every device, hear which message is the newest now (or that none is left)', async () => {
  const d = (await as(alice, 'POST', '/dms', { userId: bob.id })).json;
  const devices = [await sock(alice), await sock(alice), await sock(bob)];
  const heard = devices.map((x) => collect(x, 'dm:delete'));
  const m1 = await sendD(alice, d.id); const m2 = await sendD(bob, d.id); const m3 = await sendD(alice, d.id);
  const deleted = async (u, m, n) => {
    assert.equal((await as(u, 'DELETE', `/dm-messages/${m.id}`)).status, 200);
    assert.ok(await until(() => heard.every((h) => h.length === n)), 'every device hears it');
    return heard.map((h) => h[n - 1]);
  };
  // Alice deletes her newest: the line goes back to bob's message before it.
  for (const ev of await deleted(alice, m3, 1)) {
    assert.equal(ev.id, m3.id); assert.equal(ev.dmId, d.id);
    assert.deepEqual(brief(ev.last), lastOf(m2));
    assert.equal(ev.last.createdAt, m2.createdAt);
  }
  // An older one: the newest stays (and says so).
  for (const ev of await deleted(alice, m1, 2)) assert.deepEqual(brief(ev.last), lastOf(m2));
  // The last one left: nothing.
  for (const ev of await deleted(bob, m2, 3)) assert.equal(ev.last, null);
  const dms = (await as(alice, 'GET', '/bootstrap')).json.dms;
  assert.equal(dms.find((x) => x.id === d.id).last, null, 'the same as the DM itself says now');
});

test('DM delete by staff (a reported message) sends the newest message too', async () => {
  const d = (await as(carol, 'POST', '/dms', { userId: bob.id })).json;
  const b = await sock(bob);
  const heard = collect(b, 'dm:delete');
  const keep = await sendD(carol, d.id); const bad = await sendD(carol, d.id);
  await report(bob, bad.id);
  assert.equal((await as(srv.owner, 'DELETE', `/admin/messages/${bad.id}`)).status, 200);
  assert.ok(await until(() => heard.length === 1));
  assert.equal(heard[0].id, bad.id);
  assert.deepEqual(brief(heard[0].last), lastOf(keep));
});

test('DM edit: the update carries the newest message’s new ciphertext to both people, and the DM says the same afterwards', async () => {
  const d = (await as(alice, 'POST', '/dms', { userId: carol.id })).json;
  const devices = [await sock(alice), await sock(carol)];
  const heard = devices.map((x) => collect(x, 'dm:update'));
  const m = await sendD(alice, d.id);
  const words = cipher();
  assert.equal((await as(alice, 'PATCH', `/dm-messages/${m.id}`, { ciphertext: words })).status, 200);
  assert.ok(await until(() => heard.every((h) => h.length === 1)));
  for (const [ev] of heard) {
    assert.equal(ev.id, m.id); assert.equal(ev.dmId, d.id); assert.equal(ev.authorId, alice.id);
    assert.equal(ev.ciphertext, words);
    assert.ok(ev.editedAt >= m.createdAt);
  }
  const dms = (await as(carol, 'GET', '/bootstrap')).json.dms;
  assert.equal(dms.find((x) => x.id === d.id).last.ciphertext, words);
});

test('group chat: every kind of delete carries the group’s newest message to its members only; a server channel’s deletes carry nothing', async () => {
  const g = (await as(alice, 'POST', '/groups', { userIds: [bob.id, carol.id] })).json;
  const ch = g.channels.find((x) => x.type === 'text');
  const b = await sock(bob); const c = await sock(carol); const out = await sock(outsider);
  const single = collect(b, 'message:delete'); const bulk = collect(b, 'message:delete-bulk');
  const carolSingle = collect(c, 'message:delete');
  const leaked = [...collect(out, 'message:delete'), ...collect(out, 'message:delete-bulk')];
  const g1 = await sendC(alice, ch.id); const g2 = await sendC(bob, ch.id); const g3 = await sendC(carol, ch.id);
  // Your own.
  assert.equal((await as(carol, 'DELETE', `/messages/${g3.id}`)).status, 200);
  assert.ok(await until(() => single.length === 1 && carolSingle.length === 1));
  assert.equal(single[0].id, g3.id); assert.equal(single[0].channelId, ch.id);
  assert.deepEqual(brief(single[0].last), lastOf(g2));
  assert.equal(single[0].last.channelId, ch.id, 'with where it is, to decrypt it');
  assert.equal(single[0].lastMessageAt, g2.createdAt, 'and the time the list places and dates the group by');
  assert.deepEqual(carolSingle[0], single[0], 'the one who deleted it hears the same');
  // Someone else's, by the group's owner.
  assert.equal((await as(alice, 'DELETE', `/messages/${g2.id}`)).status, 200);
  assert.ok(await until(() => single.length === 2));
  assert.deepEqual(brief(single[1].last), lastOf(g1));
  assert.equal(single[1].lastMessageAt, g1.createdAt);
  // Several at once.
  const g4 = await sendC(bob, ch.id); const g5 = await sendC(carol, ch.id);
  const r = await as(alice, 'POST', `/channels/${ch.id}/messages/bulk-delete`, { ids: [g4.id, g5.id] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, 2);
  assert.ok(await until(() => bulk.length === 1));
  assert.deepEqual(bulk[0].messages.map((x) => x.id).sort(), [g4.id, g5.id].sort());
  assert.deepEqual(brief(bulk[0].last), lastOf(g1));
  assert.equal(bulk[0].lastMessageAt, g1.createdAt);
  // Staff removing a reported one.
  const g6 = await sendC(bob, ch.id);
  await report(carol, g6.id);
  assert.equal((await as(srv.owner, 'DELETE', `/admin/messages/${g6.id}`)).status, 200);
  assert.ok(await until(() => single.length === 3));
  assert.equal(single[2].id, g6.id);
  assert.deepEqual(brief(single[2].last), lastOf(g1));
  assert.equal(single[2].lastMessageAt, g1.createdAt);
  // The first one, the last left: nothing.
  assert.equal((await as(alice, 'DELETE', `/messages/${g1.id}`)).status, 200);
  assert.ok(await until(() => single.length === 4));
  assert.equal(single[3].last, null);
  const now = (await as(bob, 'GET', '/bootstrap')).json.servers.find((x) => x.id === g.id);
  assert.equal(now.last, null, 'the same as the group itself says now');
  assert.equal(single[3].lastMessageAt, now.lastMessageAt, 'its time with none left too (when the group was made)');
  assert.ok(now.lastMessageAt <= g1.createdAt);
  await sleep(200);
  assert.deepEqual(leaked, [], 'nothing reaches someone outside the group');
  // A server's channel has no line in the conversation list: its deletes don't carry one.
  const general = space.channels.find((x) => x.type === 'text');
  const s = await sock(bob);
  const sSingle = collect(s, 'message:delete'); const sBulk = collect(s, 'message:delete-bulk');
  const x1 = await sendC(bob, general.id); await sendC(bob, general.id); const x3 = await sendC(bob, general.id);
  assert.equal((await as(bob, 'DELETE', `/messages/${x3.id}`)).status, 200);
  assert.equal((await as(alice, 'POST', `/channels/${general.id}/messages/bulk-delete`, { ids: [x1.id] })).status, 200);
  assert.ok(await until(() => sSingle.length === 1 && sBulk.length === 1));
  for (const ev of [sSingle[0], sBulk[0]]) { assert.equal('last' in ev, false); assert.equal('lastMessageAt' in ev, false); }
});

test('group chat edit: the update carries the new ciphertext of the newest message', async () => {
  const g = (await as(bob, 'POST', '/groups', { userIds: [carol.id] })).json;
  const ch = g.channels.find((x) => x.type === 'text');
  const c = await sock(carol);
  const heard = collect(c, 'message:update');
  const m = await sendC(bob, ch.id);
  const words = cipher();
  assert.equal((await as(bob, 'PATCH', `/messages/${m.id}`, { ciphertext: words, epoch: 1 })).status, 200);
  assert.ok(await until(() => heard.length === 1));
  assert.equal(heard[0].id, m.id); assert.equal(heard[0].channelId, ch.id);
  assert.equal(heard[0].ciphertext, words);
  assert.equal((await as(carol, 'GET', '/bootstrap')).json.servers.find((x) => x.id === g.id).last.ciphertext, words);
});

// ------------------------------------------------------------------ the apps' side
// The conversation-list section of app.js (previewDm, previewGroup, setLast, lastEdited…) with onNewMessage,
// onUpdateMessage and onDeleteMessage, run with a stand-in for decryption whose timing each test controls. With
// lists: true the sidebar and Home draw each conversation's line as app.js does (convLine, drawConvLine), and
// typing.js's tracker says who's typing (typingChanged redraws those lines in place).
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const section = (() => {
  const i = appSrc.indexOf('// ======================================================================= conversation previews');
  assert.ok(i > 0, 'the conversation previews section is in app.js');
  return appSrc.slice(i, appSrc.indexOf('\n// =====', i + 10));
})();
const fnSrc = (name) => { const i = appSrc.search(new RegExp(`\\n(async )?function ${name}\\(`)); assert.ok(i > 0, name); return appSrc.slice(i, appSrc.indexOf('\n}\n', i) + 2); };

// The few DOM bits a line uses (h, clear): an element is its classes, its data and what's in it.
function node(tag, attrs, ...kids) {
  const el = {
    tag, className: (attrs && attrs.class) || '', dataset: { ...((attrs && attrs.dataset) || {}) }, kids: [],
    classList: { toggle: (c, on) => { el.className = [...el.className.split(' ').filter((x) => x && x !== c), ...(on ? [c] : [])].join(' '); } },
    append: (...xs) => { el.kids.push(...xs.flat().filter((x) => x != null)); },
    get textContent() { return el.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); },
  };
  el.append(...kids);
  return el;
}

function app({ me = 'me', dms = [], servers = [], view = { type: 'home' }, lists = false } = {}) {
  const S = { me: { id: me }, dms, servers, view, previews: {}, msgs: {}, typing: {}, lastIds: {}, lastRead: {}, unread: new Set(), mentions: new Map(), editing: null,
    thread: null, threads: {}, select: null };
  // Decryption by hand: "words" decrypts to words, once its gate (if any) opens.
  const gates = new Map();
  const hold = (ciphertext) => { let open; gates.set(ciphertext, new Promise((r) => { open = r; })); return () => open(); };
  const decrypt = async (m) => { if (m.dec && !m.dec.pending) return; const g = gates.get(m.ciphertext); if (g) await g; m.dec = { t: m.ciphertext }; };
  const drawn = { sidebar: 0, main: 0 };
  // What a delete lets go of: notifications closed, unread counts asked for again, a disappearing message's copies.
  const letGo = { closed: [], refresh: 0, copies: [] };
  // The lines the sidebar and Home show now (drawn afresh with them, as renderSidebar and renderMain do).
  const shown = { sidebar: [], home: [] };
  const convs = () => [...S.dms.map((d) => ({ key: 'd:' + d.id, unreadKey: 'd:' + d.id })),
    ...S.servers.filter((s) => s.kind === 'group').map((g) => ({ key: 'g:' + g.id, unreadKey: 'c:' + g.channels[0].id }))];
  let fns = null;
  const env = {
    S, sec: { decryptDmMessage: decrypt, decryptChannelMessage: decrypt }, decryptMessage: decrypt,
    isExpired: () => false, nowServer: () => Date.now(), disappears: () => false, armClientExpiry() {}, dropPendingSend() {},
    isGroup: (s) => !!s && s.kind === 'group', serverById: (id) => S.servers.find((s) => s.id === id) || null,
    serverOfChannel: (cid) => S.servers.find((s) => s.channels.some((c) => c.id === cid)),
    currentServer: () => S.servers.find((s) => s.id === S.view.serverId),
    later: (fn) => fn(), renderRail() {},
    renderSidebar: () => { drawn.sidebar++; if (lists) shown.sidebar = convs().map((c) => fns.convLine(c, 'dm-row-status', '\u00a0')); },
    renderMain: () => { drawn.main++; if (lists && S.view.type === 'home') shown.home = convs().map((c) => fns.convLine(c, 'conv-card-sub', 'No messages yet')); },
    WF: { check: () => null }, previewLabel: (x) => x, readableText: (t) => t, displayName: (u) => u.name, getUser: (id) => ({ name: id }),
    replaceMessageEl() {},
    // Photos & videos, photo tags, the side view and who's typing: not what's tested here.
    MEDIA: { onNew() {}, onUpdate() {}, onDelete() {}, repliesTo: () => [] }, REELS: { onNew() {}, onUpdate() {}, onDelete() {}, onReactions() {} }, NOTES: { onDelete() {}, repliesTo: () => [] },
    SIDE: { onUpdate() {}, onDelete() {} },
    // Who's typing: typing.js's own tracker, whose typing lapses only when a test says (stop).
    TYPING: TY.createTyping({ onChange: (key) => fns.typingChanged(key), timers: { set: () => 0, clear() {} } }), typingPreview: TY.typingPreview,
    h: node, clear: (el) => { el.kids = []; return el; }, isSharing: () => false, shareAllowed: new Set(), nameInServer: (sv, u) => u.name,
    renderTyping() {}, $$: (sel) => (sel === '.conv-line[data-typing-key]' ? [...shown.sidebar, ...shown.home] : []),
    forgetBindings() {}, forgetThreads() {}, closeThread() {}, renderSelectBar() {}, renderMessages() {}, currentKey: () => null, $: () => null,
    closeNotificationFor: (ids) => { letGo.closed.push([...ids]); }, refreshUnreadSoon: () => { letGo.refresh++; },
    forgetCopies: (msgs, ids, key) => { letGo.copies.push([[...ids], key]); },
  };
  const names = Object.keys(env);
  const body = `${section}\n${['onNewMessage', 'onUpdateMessage', 'onDeleteMessage', 'forgetUnread',
    'convPreview', 'convLine', 'drawConvLine', 'typingNames', 'typingDots', 'typingChanged'].map(fnSrc).join('\n')}
return { previewDm, previewGroup, setLast, groupLastIs, lastEdited, onNewMessage, onUpdateMessage, onDeleteMessage, convLine, typingChanged };`;
  // eslint-disable-next-line no-new-func
  fns = new Function(...names, body)(...names.map((n) => env[n]));
  // What a conversation's lines say now: its row in the sidebar and (on Home) its card.
  const says = (key) => [...shown.sidebar, ...shown.home].filter((el) => el.dataset.typingKey === key).map((el) => el.textContent);
  const draw = () => { env.renderSidebar(); env.renderMain(); };
  return { S, hold, drawn, letGo, shown, says, draw, TYPING: env.TYPING, ...fns };
}
const tick = () => new Promise((r) => setImmediate(r));
const dmMsg = (id, words, authorId = 'me') => ({ id, dmId: 'd1', authorId, ciphertext: words, createdAt: Date.now() });
const groupMsg = (id, words, authorId = 'bob') => ({ id, channelId: 'gc', serverId: 'g1', authorId, ciphertext: words, createdAt: Date.now() });

test('app: an edit to the newest message changes the line, whether or not the conversation is loaded; an older one doesn’t', async () => {
  const a = app({ dms: [{ id: 'd1', last: { id: 'm2', authorId: 'me', ciphertext: 'I’m the wrost', createdAt: 1 } }] });
  await a.previewDm(a.S.dms[0]);
  assert.equal(a.S.previews['d:d1'], 'You: I’m the wrost');
  await a.onUpdateMessage('d:d1', { ...dmMsg('m2', 'I’m the worst'), editedAt: 2 }); // not loaded here
  await tick();
  assert.equal(a.S.previews['d:d1'], 'You: I’m the worst');
  assert.equal(a.S.dms[0].last.ciphertext, 'I’m the worst');
  assert.ok(a.drawn.sidebar && a.drawn.main, 'the sidebar and Home are drawn again');
  await a.onUpdateMessage('d:d1', { ...dmMsg('m1', 'an older one, edited'), editedAt: 3 });
  await tick();
  assert.equal(a.S.previews['d:d1'], 'You: I’m the worst');
  // Loaded: the same, and the message in the conversation too.
  a.S.msgs['d:d1'] = { list: [{ ...dmMsg('m2', 'I’m the worst'), dec: { t: 'I’m the worst' } }], loaded: true };
  await a.onUpdateMessage('d:d1', { ...dmMsg('m2', 'I’m the best'), editedAt: 4 });
  await tick();
  assert.equal(a.S.previews['d:d1'], 'You: I’m the best');
  assert.equal(a.S.msgs['d:d1'].list[0].dec.t, 'I’m the best');
  // A group chat's, with who wrote it.
  const g = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: { id: 'x1', authorId: 'bob', channelId: 'gc', ciphertext: 'hi all', createdAt: 1 } }] });
  await g.onUpdateMessage('c:gc', { ...groupMsg('x1', 'hi everyone'), editedAt: 2 });
  await tick();
  assert.equal(g.S.previews['g:g1'], 'bob: hi everyone');
});

test('app: a delete’s new newest message replaces the line; nothing left clears it; a server channel’s delete leaves the list alone', async () => {
  const a = app({ dms: [{ id: 'd1', last: { id: 'm3', authorId: 'me', ciphertext: 'gone soon' } }], view: { type: 'dm', dmId: 'd1' } });
  await a.previewDm(a.S.dms[0]);
  await a.setLast(a.S.dms[0], { id: 'm2', authorId: 'bob', ciphertext: 'the one before' });
  assert.equal(a.S.previews['d:d1'], 'the one before');
  assert.ok(a.drawn.sidebar, 'the sidebar is drawn again in a DM too');
  await a.setLast(a.S.dms[0], null);
  assert.equal(a.S.previews['d:d1'], '');
  const g = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: groupMsg('x2', 'second') }, { id: 's1', channels: [{ id: 'sc' }] }],
    view: { type: 'channel', serverId: 'g1' } });
  g.groupLastIs('gc', groupMsg('x1', 'first', 'me'));
  await tick(); await tick();
  assert.equal(g.S.previews['g:g1'], 'You: first');
  assert.ok(g.drawn.sidebar, 'a group chat on screen shows the conversation list');
  g.groupLastIs('gc', undefined); // a thread reply's delete, or an older server
  g.groupLastIs('sc', groupMsg('y1', 'a server channel'));
  await tick(); await tick();
  assert.equal(g.S.previews['g:g1'], 'You: first');
  assert.equal(g.S.servers[1].last, undefined);
});

test('app: a slower decryption never puts back an older line (a delete, then a new message, in either order of finishing)', async () => {
  // A delete's new newest message is still decrypting when a new message comes and is done first.
  const a = app({ dms: [{ id: 'd1', last: dmMsg('m3', 'deleted one') }] });
  const openDelete = a.hold('the one before');
  const del = a.setLast(a.S.dms[0], dmMsg('m2', 'the one before', 'bob'));
  await a.onNewMessage('d:d1', dmMsg('m4', 'brand new'));
  assert.equal(a.S.previews['d:d1'], 'You: brand new');
  openDelete(); await del;
  assert.equal(a.S.previews['d:d1'], 'You: brand new', 'the delete’s slower answer is dropped');
  // A new message is still decrypting when it's deleted again (from another device), and the delete is done first.
  const b = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: groupMsg('x1', 'first') }] });
  await b.previewGroup(b.S.servers[0]);
  const openNew = b.hold('typo');
  const arriving = b.onNewMessage('c:gc', groupMsg('x2', 'typo', 'me'));
  await b.setLast(b.S.servers[0], groupMsg('x1', 'first'));
  openNew(); await arriving;
  assert.equal(b.S.previews['g:g1'], 'bob: first', 'the deleted message doesn’t come back');
  assert.equal(b.S.servers[0].last.id, 'x1');
  // Two new messages whose decryption finishes the other way round: the newer one stays.
  const c = app({ dms: [{ id: 'd1', last: null }] });
  const openFirst = c.hold('first');
  const first = c.onNewMessage('d:d1', dmMsg('m1', 'first'));
  await c.onNewMessage('d:d1', dmMsg('m2', 'second'));
  openFirst(); await first;
  assert.equal(c.S.previews['d:d1'], 'You: second');
  assert.equal(c.S.dms[0].last.id, 'm2');
  // A slow edit, then a delete of that message: the delete wins.
  const e = app({ dms: [{ id: 'd1', last: dmMsg('m2', 'old words') }] });
  const openEdit = e.hold('new words');
  e.lastEdited('d:d1', dmMsg('m2', 'new words'));
  await e.setLast(e.S.dms[0], dmMsg('m1', 'before it', 'bob'));
  openEdit(); await tick(); await tick();
  assert.equal(e.S.previews['d:d1'], 'before it');
});

test('app: a delete places a group chat by its newest message’s time, as the server does; a DM keeps its time', async () => {
  // 'A' at 9:00 and 'B' at 10:05; a DM's newest at 10:00. B is deleted: the group goes back to 9:00, below the DM.
  const at = (h, m) => new Date(2026, 9, 26, h, m).getTime();
  const g = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: { ...groupMsg('x2', 'B'), createdAt: at(10, 5) }, lastMessageAt: at(10, 5) }],
    dms: [{ id: 'd1', last: { ...dmMsg('m1', 'hi', 'bob'), createdAt: at(10, 0) }, lastMessageAt: at(10, 0) }] });
  g.groupLastIs('gc', { ...groupMsg('x1', 'A', 'me'), createdAt: at(9, 0) }, at(9, 0));
  await tick(); await tick();
  assert.equal(g.S.previews['g:g1'], 'You: A');
  assert.equal(g.S.servers[0].lastMessageAt, at(9, 0), 'the deleted message’s time goes with it');
  assert.ok(g.S.servers[0].lastMessageAt < g.S.dms[0].lastMessageAt, 'so it sorts below the DM, as after a reload');
  // One that disappeared here first (purgeExpired): the one before it, from what's loaded.
  await g.setLast(g.S.servers[0], { ...groupMsg('x0', 'earlier'), createdAt: at(8, 0) });
  assert.equal(g.S.servers[0].lastMessageAt, at(8, 0));
  // None left: the server's time for it (when the group was made).
  g.groupLastIs('gc', null, at(7, 0));
  await tick(); await tick();
  assert.equal(g.S.servers[0].lastMessageAt, at(7, 0));
  // Nothing about it (a thread reply's delete), or none left with no time given (this app's own timer): kept.
  g.groupLastIs('gc', undefined);
  await g.setLast(g.S.servers[0], null);
  assert.equal(g.S.servers[0].lastMessageAt, at(7, 0));
  // A DM's time stays where it was, like the server's.
  await g.setLast(g.S.dms[0], { ...dmMsg('m0', 'older'), createdAt: at(6, 0) });
  assert.equal(g.S.dms[0].lastMessageAt, at(10, 0));
});

test('app: a new message in a group chat moves it up even when a delete’s copy of it lands while it decrypts', async () => {
  // x2 is posted (here from another device of ours) and right away an older message or a thread reply is deleted:
  // that delete says x2 is the newest, and it gets here before x2 is decrypted.
  const g = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: { ...groupMsg('x1', 'old'), createdAt: 1 }, lastMessageAt: 1 }] });
  const open = g.hold('new');
  const x2 = { ...groupMsg('x2', 'new', 'me'), createdAt: 100 };
  const arriving = g.onNewMessage('c:gc', x2);
  g.groupLastIs('gc', { id: x2.id, authorId: x2.authorId, channelId: 'gc', ciphertext: x2.ciphertext, createdAt: 100, expiresAt: null }, 100);
  open(); await arriving; await tick(); await tick();
  assert.equal(g.S.previews['g:g1'], 'You: new');
  assert.equal(g.S.servers[0].lastMessageAt, 100);
  // The same with an edit of x2 that lands while x2 decrypts: its new words, at x2's time.
  const h = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: { ...groupMsg('x1', 'old'), createdAt: 1 }, lastMessageAt: 1 }] });
  const openTypo = h.hold('tpyo');
  const sent = h.onNewMessage('c:gc', { ...groupMsg('x2', 'tpyo', 'me'), createdAt: 100 });
  await h.onUpdateMessage('c:gc', { ...groupMsg('x2', 'typo', 'me'), createdAt: 100, editedAt: 101 });
  openTypo(); await sent; await tick(); await tick();
  assert.equal(h.S.previews['g:g1'], 'You: typo');
  assert.equal(h.S.servers[0].lastMessageAt, 100);
});

test('app: a message deleted before it was read takes its notification with it and has the unread counts asked for again', () => {
  const a = app();
  // Unread, newer than the read marker: both.
  a.S.unread.add('d:d1'); a.S.mentions.set('d:d1', 1); a.S.lastRead['d:d1'] = 'm1';
  a.onDeleteMessage('d:d1', 'm2');
  assert.deepEqual(a.letGo.closed, [['m2']]);
  assert.equal(a.letGo.refresh, 1);
  // Older than the read marker: it never counted. A conversation with nothing unread: nothing to ask.
  a.onDeleteMessage('d:d1', 'm0');
  a.onDeleteMessage('d:d2', 'm9');
  assert.equal(a.letGo.refresh, 1);
  assert.equal(a.letGo.closed.length, 3, 'a notification of it closes either way');
  // No read marker here yet: it may count.
  a.S.unread.add('c:gc');
  a.onDeleteMessage('c:gc', ['x1', 'x2']);
  assert.equal(a.letGo.refresh, 2);
  assert.deepEqual(a.letGo.closed.at(-1), ['x1', 'x2']);
  // A disappearing one's time came: forgetCopies does all of it (and more), as before.
  a.onDeleteMessage('d:d1', 'm3', { expired: true });
  assert.deepEqual(a.letGo.copies, [[['m3'], 'd:d1']]);
  assert.equal(a.letGo.refresh, 2);
});

test('app: while someone types, an edit or a delete of the newest message leaves “typing…” on the line; the new words show once they stop', async () => {
  // A DM, on Home: bob's row in the sidebar and his card.
  const a = app({ dms: [{ id: 'd1', last: dmMsg('m2', 'old words', 'bob') }], lists: true });
  await a.previewDm(a.S.dms[0]);
  a.draw();
  assert.deepEqual(a.says('d:d1'), ['old words', 'old words']);
  a.TYPING.start('d:d1', 'bob');
  const row = a.shown.sidebar[0];
  assert.deepEqual(a.says('d:d1'), ['typing…', 'typing…']);
  // His newest message is edited (from his other device) while he types: the line is worked out again and the lists
  // drawn again, still saying he's typing.
  await a.onUpdateMessage('d:d1', { ...dmMsg('m2', 'new words', 'bob'), editedAt: 2 });
  await tick();
  assert.equal(a.S.previews['d:d1'], 'new words');
  assert.notEqual(a.shown.sidebar[0], row, 'the sidebar was drawn again');
  assert.deepEqual(a.says('d:d1'), ['typing…', 'typing…']);
  // He stops: the edited words, in place.
  const now = a.shown.sidebar[0];
  a.TYPING.stop('d:d1', 'bob');
  assert.equal(a.shown.sidebar[0], now);
  assert.deepEqual(a.says('d:d1'), ['new words', 'new words']);
  // Deleted while he types again: the same, with the message before it.
  a.TYPING.start('d:d1', 'bob');
  await a.setLast(a.S.dms[0], dmMsg('m1', 'the one before', 'bob'));
  assert.deepEqual(a.says('d:d1'), ['typing…', 'typing…']);
  a.TYPING.stop('d:d1', 'bob');
  assert.deepEqual(a.says('d:d1'), ['the one before', 'the one before']);
  // A group chat open on screen (its row in the sidebar), with two people typing through a delete that moves it down.
  const g = app({ servers: [{ id: 'g1', kind: 'group', channels: [{ id: 'gc' }], last: { ...groupMsg('x2', 'second'), createdAt: 20 }, lastMessageAt: 20 }],
    view: { type: 'channel', serverId: 'g1' }, lists: true });
  await g.previewGroup(g.S.servers[0]);
  g.draw();
  assert.deepEqual(g.says('c:gc'), ['bob: second']);
  g.TYPING.start('c:gc', 'bob'); g.TYPING.start('c:gc', 'carol');
  assert.deepEqual(g.says('c:gc'), ['2 people are typing…']);
  g.groupLastIs('gc', { ...groupMsg('x1', 'first', 'me'), createdAt: 10 }, 10);
  await tick(); await tick();
  assert.equal(g.S.previews['g:g1'], 'You: first');
  assert.equal(g.S.servers[0].lastMessageAt, 10);
  assert.deepEqual(g.says('c:gc'), ['2 people are typing…']);
  g.TYPING.stop('c:gc', 'bob');
  assert.deepEqual(g.says('c:gc'), ['carol is typing…']);
  g.TYPING.stop('c:gc', 'carol');
  assert.deepEqual(g.says('c:gc'), ['You: first']);
});
