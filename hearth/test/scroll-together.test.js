// The Reels tab and scroll together (docs/design/SCROLL-TOGETHER.md): the feed made on the device from decrypted
// messages (public/js/reels.js), and the reels:* events (server/reels.js): who may join, what may be named (a message
// of that conversation, by id), who moves everyone, and that nothing but ids and numbers ever goes through.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex, sleep } = require('./helpers');

const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
const TT = (n) => `https://www.tiktok.com/@hearth/video/72345678901234567${String(n).padStart(2, '0')}`;
const IG = (code) => `https://www.instagram.com/reel/${code}/`;

// ================================================================== the feed, on the device
test('reels: the feed is every TikTok and reel in the messages, newest first, each video once', async () => {
  const R = await clientModule('reels.js');
  const msg = (id, at, t, extra = {}) => ({ id, createdAt: at, dec: { t }, ...extra });
  const list = [
    msg('m1', 100, `old one ${TT(1)} and ${IG('C9abc_DEF-1')}`),
    msg('m2', 200, `again ${TT(1)} plus ${TT(2)}`), // the same TikTok again: shown once, from its newest share
    msg('m3', 300, 'no videos here https://example.org/x'),
    msg('m4', 400, `in a thread ${TT(3)}`, { threadId: 'm1' }), // thread replies aren't the conversation's own messages
    msg('m5', 500, `hidden ${TT(4)}`, { hide: true }),
    msg('m6', 600, `\`${TT(5)}\` in code, ||${TT(6)}|| in a spoiler`),
    msg('m7', 700, `${TT(7)} ${TT(8)} ${TT(9)} ${TT(10)} ${TT(11)}`), // at most four from one message
    msg('bad id!', 800, TT(12)),
  ];
  const items = R.feedItems(list, { ok: (m) => !m.hide });
  assert.deepEqual(items.map((x) => [x.mid, x.i, x.p.id || x.p.short]), [
    ['m7', 0, TT(7).split('/').pop()], ['m7', 1, TT(8).split('/').pop()], ['m7', 2, TT(9).split('/').pop()], ['m7', 3, TT(10).split('/').pop()],
    ['m2', 0, TT(1).split('/').pop()], ['m2', 1, TT(2).split('/').pop()], ['m1', 1, 'C9abc_DEF-1'],
  ]);
  assert.equal(R.indexOf(items, 'm2', 1), 5);
  assert.equal(R.indexOf(items, 'nope', 0), -1);
  assert.deepEqual(R.feedItems(null), []);
  // Moving and the players' window.
  assert.equal(R.step(0, -1, 7), 0); assert.equal(R.step(0, 1, 7), 1); assert.equal(R.step(6, 1, 7), 6);
  assert.deepEqual(R.liveRange(0, 7), [0, 1]); assert.deepEqual(R.liveRange(3, 7), [2, 3, 4]); assert.deepEqual(R.liveRange(6, 7), [5, 6]); assert.deepEqual(R.liveRange(0, 0), []);
  // What loads: "Just show the link" never; "Load when I tap" once tapped; "Always" always.
  assert.equal(R.playersAllowed('off', true), false);
  assert.equal(R.playersAllowed('ask', false), false);
  assert.equal(R.playersAllowed('ask', true), true);
  assert.equal(R.playersAllowed('always', false), true);
  assert.equal(R.withLine([]), 'Scrolling together');
  assert.equal(R.withLine(['alice']), 'Scrolling with alice');
  assert.equal(R.withLine(['alice', 'bob']), 'Scrolling with alice and bob');
  assert.equal(R.withLine(['alice', 'bob', 'carl', 'dana']), 'Scrolling with alice, bob and 2 others');
  assert.equal(R.swipedText('alice', 1), 'alice swiped to the next ↓');
  assert.equal(R.swipedText('alice', -1), 'alice swiped back ↑');
  // The session from the server, checked for shape.
  assert.equal(R.cleanSession(null), null);
  assert.equal(R.cleanSession({ mid: 'javascript:alert(1)' }), null);
  const s = R.cleanSession({ mid: 'm2', i: 9, playing: 1, position: '12', updatedAt: 5, following: ['u1', 7, '<b>'], ready: 'x', dir: -1 });
  assert.deepEqual([s.i, s.playing, s.position, s.following, s.ready, s.dir], [0, true, 12, ['u1'], [], -1]);
  const t0 = Date.now();
  assert.ok(Math.abs(R.sharedPosition({ position: 10, playing: true, updatedAt: t0 - 2000 }, 0) - 12) < 0.2);
  assert.equal(R.sharedPosition({ position: 10, playing: true, updatedAt: t0 + 3000 }, 0), 10, 'a countdown keeps it put');
});

// ================================================================== the server
let srv; let boss; let guest; let outsider; let server; let general; let secret; let code; let dm;
const socks = [];
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');
const sock = async (u) => { const s = await srv.socket(u.token); socks.push(s); return s; };
const ack = (s, ev, p, ms = 5000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.emit(ev, p, (x) => { clearTimeout(t); r(x); }); });
const insert = (channelId, authorId, extra = {}) => {
  const id = 'm' + hex(8);
  srv.sql('INSERT INTO messages (id, channel_id, author_id, body, ciphertext, epoch, created_at, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, channelId, authorId, '', cipher(), 1, Date.now(), extra.threadId || null);
  return id;
};
const latest = (s) => { const box = { state: null, all: [] }; s.on('reels:state', (x) => { box.state = x; box.all.push(x); }); return box; };
const settle = () => sleep(350);

before(async () => {
  srv = await startServer();
  boss = await srv.register(); guest = await srv.register(); outsider = await srv.register();
  server = (await as(boss, 'POST', '/servers', { name: 'Reels ' + hex(3) })).json;
  general = server.channels.find((c) => c.type === 'text');
  code = (await as(boss, 'POST', `/servers/${server.id}/invites`, {})).json.code;
  assert.equal((await as(guest, 'POST', `/invites/${code}/join`)).status, 200);
  secret = (await as(boss, 'POST', `/servers/${server.id}/channels`, { name: 'secret', type: 'text' })).json;
  // A private channel: the guest can't see it.
  // (The @everyone role has the server's id; 1 is View Channel.)
  assert.equal((await as(boss, 'PUT', `/channels/${secret.id}/overrides`, { overrides: [{ type: 'role', id: server.id, allow: 0, deny: 1 }] })).status, 200);
  dm = (await as(boss, 'POST', '/dms', { userId: guest.id })).json;
});
after(async () => { socks.forEach((s) => s.close()); await srv.stop(); });

test('scroll together: only people who can read the conversation join; it names messages of that conversation only', async () => {
  const key = `c:${general.id}`;
  const m1 = insert(general.id, boss.id);
  const other = insert(secret.id, boss.id);
  const reply = insert(general.id, boss.id, { threadId: m1 });
  const so = await sock(outsider); const sg = await sock(guest); const sb = await sock(boss);
  for (const k of [key, `c:${secret.id}`, `d:${dm.id}`]) assert.ok((await ack(so, 'reels:join', { key: k })).error, `an outsider can't join ${k}`);
  assert.ok((await ack(sg, 'reels:join', { key: `c:${secret.id}` })).error, 'nor a channel they can\'t view');
  for (const bad of [null, 42, 'x:abc', 'c:', `c:${general.id}/../x`, 'c:' + 'a'.repeat(65), { key }]) assert.ok((await ack(sg, 'reels:join', { key: bad })).error, String(bad));
  assert.ok((await ack(sg, 'reels:start', { key, mid: m1 })).error, 'start needs the tab open first');
  const gb = latest(sb);
  const j = await ack(sb, 'reels:join', { key });
  assert.equal(j.ok, true);
  assert.equal(j.state.session, null);
  assert.equal((await ack(sg, 'reels:join', { key })).ok, true);
  await settle();
  assert.deepEqual(gb.state.viewers.sort(), [boss.id, guest.id].sort(), 'who is viewing the tab');
  for (const mid of [other, reply, 'nope', '../x', 'https://www.tiktok.com/@a/video/7234567890123456789']) assert.ok((await ack(sb, 'reels:start', { key, mid })).error, `refused: ${mid}`);
  assert.equal((await ack(sb, 'reels:start', { key, mid: m1 })).ok, true);
  await settle();
  const s = gb.state.session;
  assert.deepEqual([s.by, s.mid, s.i, s.hostOnly, s.following.sort()], [boss.id, m1, 0, false, [boss.id, guest.id].sort()]);
  assert.ok((await ack(sb, 'reels:start', { key, mid: m1 })).error, 'one session at a time');
  // Nothing but ids, numbers and user ids goes out: never a link or any text.
  const sent = JSON.stringify(gb.all);
  assert.doesNotMatch(sent, /https?:|tiktok|instagram/i);
  assert.deepEqual(Object.keys(s).sort(), ['by', 'dir', 'following', 'hostOnly', 'i', 'lastAction', 'lastBy', 'mid', 'playing', 'position', 'ready', 'seq', 'startAt', 'updatedAt'].sort());
  // Cleaning up for the next test.
  assert.equal((await ack(sb, 'reels:stop', { key })).ok, true);
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:leave', {})).ok, true);
});

test('scroll together: anyone following moves everyone; Only I control; leave and rejoin; ready and the countdown', async () => {
  const key = `c:${general.id}`;
  const [a, b, c] = [insert(general.id, boss.id), insert(general.id, guest.id), insert(general.id, boss.id)];
  const sb = await sock(boss); const sg = await sock(guest);
  const gb = latest(sb); const gg = latest(sg);
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:join', { key })).ok, true);
  assert.ok((await ack(sg, 'reels:go', { key, mid: b })).error, 'nothing to move before a session');
  assert.equal((await ack(sb, 'reels:start', { key, mid: a })).ok, true);
  assert.equal((await ack(sg, 'reels:go', { key, mid: b, i: 1, dir: 1 })).ok, true, 'the guest moves everyone');
  await settle();
  assert.deepEqual([gb.state.session.mid, gb.state.session.i, gb.state.session.lastBy, gb.state.session.lastAction, gb.state.session.dir], [b, 1, guest.id, 'go', 1]);
  // Moves come at most every 0.7 s per conversation: a flood of swipes would reload everyone's players.
  assert.match((await ack(sb, 'reels:go', { key, mid: c })).error, /Not so fast/);
  await sleep(750);
  for (const i of [-1, 4, 'x', 99]) { assert.equal((await ack(sg, 'reels:go', { key, mid: c, i })).ok, true); await settle(); assert.equal(gb.state.session.i, 0, `i ${i} becomes 0`); }
  // TikTok: play, pause, seek; a stale one (about another video) changes nothing.
  assert.equal((await ack(sb, 'reels:control', { key, mid: c, i: 0, action: 'pause', position: 7.5 })).ok, true);
  await settle();
  assert.deepEqual([gg.state.session.playing, gg.state.session.position], [false, 7.5]);
  assert.equal((await ack(sb, 'reels:control', { key, mid: a, i: 0, action: 'seek', position: 99 })).ok, true);
  await settle();
  assert.equal(gg.state.session.position, 7.5, 'about a video they moved on from');
  assert.equal((await ack(sb, 'reels:control', { key, mid: c, i: 0, action: 'seek', position: 1e12 })).ok, true);
  await settle();
  assert.equal(gg.state.session.position, 24 * 3600, 'capped');
  // Instagram: "I'm ready", and play with a countdown.
  assert.equal((await ack(sg, 'reels:ready', { key, mid: c, i: 0 })).ok, true);
  await settle();
  assert.deepEqual(gb.state.session.ready, [guest.id]);
  const t0 = Date.now();
  assert.equal((await ack(sg, 'reels:control', { key, mid: c, i: 0, action: 'play', position: 0, together: true })).ok, true);
  await settle();
  const s = gb.state.session;
  assert.ok(s.playing && s.startAt >= t0 + 2500 && s.updatedAt === s.startAt, 'a 3-second countdown');
  // Only I control: only the starter moves everyone now; the guest can still leave and rejoin.
  assert.ok((await ack(sg, 'reels:mode', { key, hostOnly: true })).error, 'only the starter changes who controls');
  assert.equal((await ack(sb, 'reels:mode', { key, hostOnly: true })).ok, true);
  assert.match((await ack(sg, 'reels:go', { key, mid: a })).error, /started it/);
  assert.match((await ack(sg, 'reels:stop', { key })).error, /started it/);
  assert.equal((await ack(sg, 'reels:follow', { key, on: false })).ok, true);
  await settle();
  assert.deepEqual(gb.state.session.following, [boss.id]);
  assert.match((await ack(sg, 'reels:go', { key, mid: a })).error, /Rejoin/);
  assert.match((await ack(sg, 'reels:ready', { key, mid: c, i: 0 })).error, /Rejoin/, 'someone who left can\'t say ready');
  // Coming back after a dropped connection keeps their choice to scroll on their own.
  assert.equal((await ack(sg, 'reels:join', { key, follow: false })).ok, true);
  await settle();
  assert.deepEqual(gb.state.session.following, [boss.id]);
  assert.equal((await ack(sg, 'reels:follow', { key, on: true })).ok, true);
  await settle();
  assert.deepEqual(gb.state.session.following.sort(), [boss.id, guest.id].sort());
  // Leaving the tab ends following; the starter of an "Only I control" session leaving hands control to everyone.
  assert.equal((await ack(sb, 'reels:leave', {})).ok, true);
  await settle();
  assert.equal(gg.state.session.following.includes(boss.id), false);
  assert.equal(gg.state.session.hostOnly, false, 'not stuck with nobody in control');
  assert.equal((await ack(sg, 'reels:leave', {})).ok, true);
  assert.equal((await ack(sg, 'reels:join', { key })).state.session, null, 'a room nobody views is gone');
  assert.equal((await ack(sg, 'reels:leave', {})).ok, true);
});

test('scroll together: in a DM, and someone who loses access stops hearing', async () => {
  const dkey = `d:${dm.id}`;
  const dmMsg = (await as(boss, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher() })).json.id;
  const sb = await sock(boss); const sg = await sock(guest); const so = await sock(outsider);
  assert.ok((await ack(so, 'reels:join', { key: dkey })).error, 'not in the DM');
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:join', { key: dkey })).ok, true);
  const chMsg = insert(general.id, boss.id);
  assert.ok((await ack(sb, 'reels:start', { key: dkey, mid: chMsg })).error, 'a channel message isn\'t a message of the DM');
  assert.equal((await ack(sb, 'reels:start', { key: dkey, mid: dmMsg })).ok, true);
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:leave', {})).ok, true);

  // A channel: the guest is removed from the server while viewing; the next update isn't sent to them.
  const key = `c:${general.id}`;
  const m = insert(general.id, boss.id);
  const gg = latest(sg); const gb = latest(sb);
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:join', { key })).ok, true);
  assert.equal((await ack(sb, 'reels:start', { key, mid: m })).ok, true);
  await settle();
  assert.ok(gg.state && gg.state.session);
  assert.equal((await as(boss, 'DELETE', `/servers/${server.id}/members/${guest.id}`)).status, 200);
  const heard = gg.all.length;
  assert.equal((await ack(sb, 'reels:control', { key, mid: m, i: 0, action: 'pause', position: 3 })).ok, true);
  await settle();
  assert.equal(gg.all.length, heard, 'nothing more reaches someone who can no longer read the channel');
  assert.deepEqual(gb.state.viewers, [boss.id]);
  assert.ok((await ack(sg, 'reels:follow', { key, on: true })).error);
  assert.equal((await ack(sb, 'reels:leave', {})).ok, true);
  assert.equal((await as(guest, 'POST', `/invites/${code}/join`)).status, 200);
});
