// "Is typing…" (public/js/typing.js, app.js, app.css): who's typing where, kept for every conversation whether it's
// open or not, and shown like Discord's: the line under the open conversation's box, and "typing…" with three dots
// in place of the last message on the conversation's row in the sidebar and its card on Home (a group chat says
// who, or how many). It goes when their message arrives or a while after their last typing event, and only the
// conversation's own line is drawn again. The dots hold still with Reduce motion. The server passes typing on in
// DMs and group chats, both ways (test/e2e/flows.mjs has the same in the real app).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let T;
let srv;
before(async () => {
  T = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'typing.js')).href);
  srv = await startServer();
});
after(async () => { await srv.stop(); });

// A clock the tests move by hand, for the tracker's timers.
function fakeTimers() {
  let now = 0; let seq = 0;
  const due = new Map(); // id -> { at, fn }
  return {
    set: (fn, ms) => { due.set(++seq, { at: now + ms, fn }); return seq; },
    clear: (id) => { due.delete(id); },
    pending: () => due.size,
    advance(ms) {
      now += ms;
      for (const [id, x] of [...due].sort((a, b) => a[1].at - b[1].at)) if (x.at <= now && due.has(id)) { due.delete(id); x.fn(); }
    },
  };
}
function tracker(ms = 6000) {
  const timers = fakeTimers();
  const changes = [];
  const t = T.createTyping({ ms, timers, onChange: (key) => changes.push(key) });
  return { t, timers, changes };
}

test('the tracker: a change only when the people typing change, not at every event', () => {
  const { t, timers, changes } = tracker();
  t.start('d:1', 'bob');
  assert.deepEqual(changes, ['d:1'], 'bob starts: the conversation changes');
  assert.deepEqual(t.who('d:1'), ['bob']);
  timers.advance(3000);
  t.start('d:1', 'bob'); // his app says so again 3 seconds later
  assert.deepEqual(changes, ['d:1'], 'the same person again: nothing to draw');
  assert.equal(timers.pending(), 1, 'one timer per person, started again');
  timers.advance(5000);
  assert.deepEqual(t.who('d:1'), ['bob'], 'still typing: his last event was 5 seconds ago');
  timers.advance(1000);
  assert.deepEqual(t.who('d:1'), [], 'gone 6 seconds after his last event');
  assert.deepEqual(changes, ['d:1', 'd:1']);
  assert.equal(timers.pending(), 0);
});

test('the tracker: their message stops it at once; conversations are separate; first to start first', () => {
  const { t, timers, changes } = tracker();
  t.start('c:g', 'maya'); t.start('c:g', 'sam'); t.start('d:2', 'maya');
  assert.deepEqual(t.who('c:g'), ['maya', 'sam']);
  assert.deepEqual(t.who('d:2'), ['maya']);
  t.start('c:g', 'maya');
  assert.deepEqual(t.who('c:g'), ['maya', 'sam'], 'typing again keeps your place');
  changes.length = 0;
  t.stop('c:g', 'maya'); // her message arrived
  assert.deepEqual(changes, ['c:g']);
  assert.deepEqual(t.who('c:g'), ['sam']);
  assert.deepEqual(t.who('d:2'), ['maya'], 'still typing in the other conversation');
  t.stop('c:g', 'maya'); t.stop('c:x', 'nobody');
  assert.deepEqual(changes, ['c:g'], 'a message from someone who wasn’t typing changes nothing');
  timers.advance(6000);
  assert.deepEqual(changes.sort(), ['c:g', 'c:g', 'd:2'].sort(), 'the rest lapse, each once');
  assert.equal(timers.pending(), 0, 'no timer left behind');
  t.start('c:g', 'maya');
  assert.deepEqual(t.who('c:g'), ['maya'], 'and can start again');
});

test('the tracker: you on another device don’t count; nonsense is ignored', () => {
  const { t, changes } = tracker();
  t.start('d:1', 'me'); t.start('d:1', 'bob');
  assert.deepEqual(t.who('d:1', 'me'), ['bob']);
  t.start('', 'bob'); t.start('d:1', ''); t.start(null, null);
  assert.deepEqual(changes, ['d:1', 'd:1']);
  assert.deepEqual(t.who(null), []);
  assert.deepEqual(t.who('d:nope'), []);
});

test('the words: under the box, and in the lists (a DM just says "typing…", a group chat who or how many)', () => {
  assert.equal(T.typingLine([]), '');
  assert.equal(T.typingLine(['maya']), 'maya is typing…');
  assert.equal(T.typingLine(['maya', 'sam']), 'maya and sam are typing…');
  assert.equal(T.typingLine(['maya', 'sam', 'lee']), 'maya, sam and lee are typing…');
  assert.equal(T.typingLine(['maya', 'sam', 'lee', 'kim']), 'Several people are typing…');
  assert.equal(T.typingPreview([]), '');
  assert.equal(T.typingPreview([], { group: true }), '');
  assert.equal(T.typingPreview(['bob']), 'typing…');
  assert.equal(T.typingPreview(['maya'], { group: true }), 'maya is typing…');
  assert.equal(T.typingPreview(['maya', 'sam'], { group: true }), '2 people are typing…');
  assert.equal(T.typingPreview(['maya', 'sam', 'lee', 'kim', 'jo'], { group: true }), '5 people are typing…');
  assert.equal(T.TYPING_MS, 6000);
});

test('app.js: kept for every conversation, shown in the lists and under the box, drawn in place', () => {
  const app = read('public', 'js', 'app.js');
  // Every typing event is kept, open conversation or not (the lists show it, and it's there when you open one).
  const handler = app.slice(app.indexOf("socket.on('typing'"), app.indexOf("socket.on('poll:update'"));
  assert.match(handler, /TYPING\.start\(p\.channelId \? 'c:' \+ p\.channelId : 'd:' \+ p\.dmId, p\.userId\)/);
  assert.doesNotMatch(handler, /currentKey\(\)/, 'not only for the open conversation');
  assert.doesNotMatch(app, /S\.typing\b/, 'one place keeps who’s typing');
  // A message from them ends it, wherever it arrives.
  const onNew = app.slice(app.indexOf('async function onNewMessage('), app.indexOf('function notify('));
  assert.match(onNew, /TYPING\.stop\(key, m\.authorId\)/);
  // The rows and Home's cards draw their line with convLine, keyed by the conversation's typing key.
  const row = app.slice(app.indexOf('function convRow('), app.indexOf('function shortTime('));
  assert.match(row, /convLine\(c, 'dm-row-status', /);
  const card = app.slice(app.indexOf('function convCard('), app.indexOf('function friendsView('));
  assert.match(card, /convLine\(c, 'conv-card-sub', /);
  assert.match(app, /dataset: c\.unreadKey \? \{ typingKey: c\.unreadKey \} : null/);
  // A change draws only that conversation's lines again: no sidebar or Home redraw.
  const changed = app.slice(app.indexOf('function typingChanged('), app.indexOf('function renderTyping('));
  assert.match(changed, /renderTyping\(key\)/);
  assert.match(changed, /\.conv-line\[data-typing-key\]/);
  assert.doesNotMatch(changed, /renderSidebar|renderMain|renderAll/);
  // The lines skip drawing when nothing changed, so the dots keep moving and the live region speaks once.
  assert.match(app, /if \(el\._said === text\) return;/);
  assert.match(app, /if \(el\._shown === text && el\._typing === !!said\) return el;/);
  assert.match(app, /'aria-hidden': 'true' \}, h\('i'\), h\('i'\), h\('i'\)\)/, 'the dots are hidden from screen readers; the words aren’t');
  // Your app says so per conversation, and again at once after sending (never within a second of the last time).
  assert.match(app, /const typingSent = new Map\(\);/);
  assert.match(app, /now - \(typingSent\.get\(kk\) \|\| 0\) > 3000 && now - typingSentAny > 1000/);
  assert.match(app, /if \(!tid && !sendAt\) typingSent\.delete\(kk\);/);
});

test('app.css: "typing…" in the lists, and dots that hold still with Reduce motion', () => {
  const css = read('public', 'css', 'app.css');
  assert.match(css, /\.conv-line\.is-typing \{ display: flex;/);
  assert.match(css, /\.conv-line\.is-typing \.dots \{ flex: none; overflow: visible; \}/, 'the card’s overflow rule doesn’t clip the bounce');
  assert.match(css, /\.dots i \{[^}]*animation: bounce 1\.2s infinite;/, 'they move');
  const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
  assert.match(media.slice(0, media.indexOf('\n}')), /\.dots i \{ animation: none;/, 'the system’s reduced motion');
  assert.match(css, /html\.reduce-motion \.dots i \{ animation: none;/, 'the app’s Reduce motion');
  assert.ok(css.indexOf('html.reduce-motion .dots i') > css.indexOf('.dots i { width'), 'after the rule it overrides');
});

// ------------------------------------------------------------------ the server passes it on
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const next = (s, ev, match, ms = 3000) => new Promise((r) => {
  const on = (x) => { if (!match(x)) return; clearTimeout(t); s.off(ev, on); r(x); };
  const t = setTimeout(() => { s.off(ev, on); r(null); }, ms);
  s.on(ev, on);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('server: typing reaches the other person in a DM and in a group chat, both ways', async () => {
  const a = await srv.register(`ty${hex(3)}`); const b = await srv.register(`ty${hex(3)}`);
  const server = (await as(a, 'POST', '/servers', { name: 'Typing ' + hex(2) })).json;
  const invite = (await as(a, 'POST', `/servers/${server.id}/invites`, {})).json;
  assert.equal((await as(b, 'POST', `/invites/${invite.code}/join`)).status, 200);
  const sa = await srv.socket(a.token); const sb = await srv.socket(b.token);
  try {
    const dm = (await as(a, 'POST', '/dms', { userId: b.id })).json;
    const group = (await as(a, 'POST', '/groups', { userIds: [b.id] })).json;
    const chat = group.channels.find((c) => c.type === 'text');
    for (const [from, sFrom, sTo] of [[a, sa, sb], [b, sb, sa]]) {
      let got = next(sTo, 'typing', (p) => p.dmId === dm.id);
      assert.equal((await ack(sFrom, 'typing', { dmId: dm.id })).ok, true);
      assert.deepEqual(await got, { dmId: dm.id, userId: from.id }, `DM: ${from === a ? 'a to b' : 'b to a'}`);
      await sleep(1100); // (one person's typing is passed on at most once a second)
      got = next(sTo, 'typing', (p) => p.channelId === chat.id);
      assert.equal((await ack(sFrom, 'typing', { channelId: chat.id })).ok, true);
      assert.deepEqual(await got, { channelId: chat.id, userId: from.id }, `group chat: ${from === a ? 'a to b' : 'b to a'}`);
    }
  } finally { sa.close(); sb.close(); }
});
