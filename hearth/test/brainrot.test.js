// Brainrot mode (docs/design/BRAINROT.md): the two gameplay loops are deterministic (the same seed plays the same
// run, however the time is split into frames) and never crash; the flash limiter never lets more than 3 flashes
// into any second (WCAG 2.3.1); the level, settings, captions and YouTube links are checked; and the scroll-together
// switch (reels:brainrot) is a yes or no that only someone who controls the session can flip.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex, sleep } = require('./helpers');

const G = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'brainrot-games.js')).href);

// ================================================================== the games
test('brainrot: each game plays the same run from the same seed, however the time is cut into frames', async () => {
  const { createParkour, createRunner, STEP_US } = await G();
  for (const make of [createParkour, createRunner]) {
    for (const seed of [1, 42, 987654321]) {
      const a = make({ seed }); const b = make({ seed }); const c = make({ seed });
      for (let i = 0; i < Math.floor(90e6 / STEP_US); i++) a.tick();
      // 90 seconds in frames of 1/60, 1/30, 1/144 and uneven bits (all whole microseconds, as the clock counts them)
      let left = 90e6; const cuts = [16667, 33333, 6944, 21000, 11111, 50000];
      for (let k = 0; left > 0; k++) { const us = Math.min(left, cuts[k % cuts.length]); b.advance(us / 1e6); left -= us; }
      for (let s = 0; s < 90; s++) c.advance(1); // whole seconds: at most a quarter of a second is caught up at once…
      assert.equal(b.state.t.toFixed(3), a.state.t.toFixed(3), `${a.kind} ${seed}: the same number of steps`);
      assert.equal(b.snapshot(), a.snapshot(), `${a.kind} ${seed}: the same run`);
      assert.ok(c.state.t < a.state.t, '…so a long pause doesn\'t fast-forward the game');
    }
    const x = make({ seed: 7 }); const y = make({ seed: 8 });
    for (let i = 0; i < 60 * 30; i++) { x.tick(); y.tick(); }
    assert.notEqual(x.snapshot(), y.snapshot(), 'another seed, another run');
  }
});

test('brainrot: Rail Runner never hits anything, and both games keep going (jumps, coins, near-misses, themes)', async () => {
  const { createParkour, createRunner } = await G();
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    for (const slow of [false, true]) {
      const r = createRunner({ seed, slow });
      const ev = [];
      for (let i = 0; i < 60 * 300; i++) r.tick(ev);
      const kinds = new Set(ev.map((e) => e.type));
      assert.equal(r.state.crashes, 0, `seed ${seed}${slow ? ' (slow)' : ''}: no crashes`);
      assert.ok(!kinds.has('crash'));
      for (const k of ['coin', 'dodge', 'switch']) assert.ok(kinds.has(k), `seed ${seed}: ${k}`);
      assert.ok(r.state.theme >= 1, 'the colours move on');
      // Nothing piles up: waves and coins behind are let go.
      assert.ok(r.state.waves.length < 8 && r.state.coins.length < 80, `${r.state.waves.length} waves, ${r.state.coins.length} coins kept`);
      const p = createParkour({ seed, slow });
      const pe = [];
      let lowest = Infinity;
      for (let i = 0; i < 60 * 300; i++) { p.tick(pe); lowest = Math.min(lowest, p.state.y); }
      const pk = new Set(pe.map((e) => e.type));
      for (const k of ['jump', 'land', 'near', 'milestone']) assert.ok(pk.has(k), `parkour ${seed}: ${k}`);
      assert.equal(pe.filter((e) => e.type === 'jump').length, pe.filter((e) => e.type === 'land').length + (p.state.air ? 1 : 0), 'every jump lands');
      assert.ok(lowest >= -2.01, 'never falls below the lowest platform');
      assert.ok(p.state.plats.length < 60, 'platforms behind are let go');
    }
  }
  // Reduced motion: half the speed.
  const fast = createRunner({ seed: 1 }); const slow = createRunner({ seed: 1, slow: true });
  for (let i = 0; i < 600; i++) { fast.tick(); slow.tick(); }
  assert.ok(Math.abs(slow.state.z * 2 - fast.state.z) < 1e-6);
});

test('brainrot: drawing never changes the game, and draws only shapes (no images, no text)', async () => {
  const { createParkour, createRunner } = await G();
  // A pretend canvas that records what's asked of it.
  const calls = new Set();
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { calls.add(k); void a; })),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  for (const make of [createParkour, createRunner]) {
    const a = make({ seed: 3 }); const b = make({ seed: 3 });
    for (let i = 0; i < 600; i++) { a.tick(); b.tick(); if (i % 7 === 0) a.draw(ctx, 390, 420); }
    assert.equal(a.snapshot(), b.snapshot(), `${a.kind}: drawing changed nothing`);
  }
  for (const k of ['drawImage', 'fillText', 'strokeText', 'putImageData']) assert.ok(!calls.has(k), `the games don't use ${k}`);
});

// ================================================================== flashes, levels, settings
test('brainrot: never more than 3 flashes in any second (WCAG 2.3.1)', async () => {
  const { flashLimiter } = await G();
  const L = flashLimiter(3, 1000);
  assert.deepEqual([0, 10, 20, 30, 999, 1000, 1001, 1011, 1020, 1021].map((t) => L.allow(t)), [true, true, true, false, false, false, true, true, false, true]);
  // Any stream of requests: count the allowed ones in every window of a second (both ends included).
  for (let run = 0; run < 50; run++) {
    const lim = flashLimiter(3, 1000);
    const ok = [];
    let t = 0;
    for (let i = 0; i < 2000; i++) { t += Math.floor(Math.random() * (run % 2 ? 40 : 400)); if (lim.allow(t)) ok.push(t); }
    for (let i = 0; i + 3 < ok.length; i++) assert.ok(ok[i + 3] - ok[i] > 1000, `4 flashes within ${ok[i + 3] - ok[i]} ms`);
    assert.ok(ok.length > 0);
  }
});

test('brainrot: the level (at most 1 with reduced motion), the settings kept, YouTube links, captions, rain', async () => {
  const { effectiveLevel, cleanPrefs, youtubeVideoId, captionChunks, rainDrop, LEVELS, MAX_LEVEL } = await G();
  assert.equal(LEVELS.length, MAX_LEVEL + 1);
  assert.deepEqual([0, 1, 2, 3, 4, -1, 'x', 2.6].map((l) => effectiveLevel(l, false)), [0, 1, 2, 3, 3, 0, 0, 3]);
  assert.deepEqual([0, 1, 2, 3].map((l) => effectiveLevel(l, true)), [0, 1, 1, 1]);
  // Off by default, everywhere.
  const d = cleanPrefs(null);
  assert.deepEqual(d, { on: { reels: false, watch: false, call: false }, game: 'parkour', yt: '', level: 0, warned: false });
  const p = cleanPrefs({ on: { reels: 1, watch: true, evil: true }, game: '<img>', yt: 'javascript:alert(1)', level: 99, warned: 'yes', sounds: true });
  assert.deepEqual(p, { on: { reels: false, watch: true, call: false }, game: 'parkour', yt: '', level: 3, warned: false }, 'sounds are never kept');
  assert.equal(cleanPrefs({ game: 'youtube', yt: 'dQw4w9WgXcQ' }).yt, 'dQw4w9WgXcQ');
  // YouTube: the same rules as link previews.
  for (const [u, id] of [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'dQw4w9WgXcQ'], ['https://youtu.be/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'], [' https://youtube.com/live/dQw4w9WgXcQ ', 'dQw4w9WgXcQ'],
    ['https://evil.example/watch?v=dQw4w9WgXcQ', null], ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', null],
    ['javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ', null], ['https://www.youtube.com/watch?v=short', null],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>', null], ['https://youtu.be/dQw4w9WgXcQ/../x', null], ['', null], [null, null],
  ]) assert.equal(youtubeVideoId(u), id, String(u));
  // Captions: text only, in chunks of a couple of words, invisible and control characters out, at most 160 characters.
  assert.deepEqual(captionChunks('POV: you   opened the reels tab at 3am'), ['POV: you', 'opened the', 'reels tab', 'at 3am']);
  assert.deepEqual(captionChunks(''), []);
  assert.deepEqual(captionChunks(null), []);
  assert.deepEqual(captionChunks('a‮b\u0000c​d'), ['a b', 'c d']);
  const long = captionChunks('word '.repeat(200));
  assert.ok(long.join(' ').length <= 160);
  assert.deepEqual(captionChunks('<img src=x onerror=alert(1)>'), ['<img src=x', 'onerror=alert(1)>'], 'kept as text (shown with textContent)');
  assert.ok(captionChunks('x'.repeat(100)).every((c) => c.length <= 28));
  // The rain: the same drop at the same time, slower with reduced motion.
  assert.deepEqual(rainDrop(3, 12.5), rainDrop(3, 12.5));
  const a = rainDrop(5, 0); const b = rainDrop(5, 1); const c = rainDrop(5, 1, true);
  assert.ok(Math.abs((c.y - a.y) * 2 - (b.y - a.y)) < 0.05 || b.y < a.y, 'half the speed');
});

// ================================================================== the server: Brainrot mode for everyone
let srv; let boss; let guest; let server; let general;
const socks = [];
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const sock = async (u) => { const s = await srv.socket(u.token); socks.push(s); return s; };
const ack = (s, ev, p, ms = 5000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.emit(ev, p, (x) => { clearTimeout(t); r(x); }); });
const insert = (channelId, authorId) => {
  const id = 'm' + hex(8);
  srv.sql('INSERT INTO messages (id, channel_id, author_id, body, ciphertext, epoch, created_at, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, channelId, authorId, '', 'v2:' + crypto.randomBytes(48).toString('base64'), 1, Date.now(), null);
  return id;
};
const latest = (s) => { const box = { state: null }; s.on('reels:state', (x) => { box.state = x; }); return box; };
const settle = () => sleep(350);

before(async () => {
  srv = await startServer();
  boss = await srv.register(); guest = await srv.register();
  server = (await as(boss, 'POST', '/servers', { name: 'Brainrot ' + hex(3) })).json;
  general = server.channels.find((c) => c.type === 'text');
  const code = (await as(boss, 'POST', `/servers/${server.id}/invites`, {})).json.code;
  assert.equal((await as(guest, 'POST', `/invites/${code}/join`)).status, 200);
});
after(async () => { socks.forEach((s) => s.close()); await srv.stop(); });

test('brainrot: whoever controls scroll together turns it on for everyone; a yes or no, and nothing else', async () => {
  const key = `c:${general.id}`;
  const m = insert(general.id, boss.id);
  const sb = await sock(boss); const sg = await sock(guest);
  const gb = latest(sb); const gg = latest(sg);
  for (const x of [sb, sg]) assert.equal((await ack(x, 'reels:join', { key })).ok, true);
  assert.ok((await ack(sb, 'reels:brainrot', { key, on: true })).error, 'no session yet');
  assert.equal((await ack(sb, 'reels:start', { key, mid: m })).ok, true);
  await settle();
  assert.equal(gg.state.session.brainrot, false, 'off when a session starts');
  // Only true turns it on.
  for (const v of ['yes', 1, {}, null]) { assert.equal((await ack(sb, 'reels:brainrot', { key, on: v })).ok, true); await settle(); assert.equal(gg.state.session.brainrot, false, String(v)); }
  // Everyone controls (the default): the guest may turn it on.
  assert.equal((await ack(sg, 'reels:brainrot', { key, on: true, game: 'youtube', yt: 'dQw4w9WgXcQ', title: '<b>x</b>' })).ok, true);
  await settle();
  const s = gb.state.session;
  assert.deepEqual([s.brainrot, s.brainrotBy, s.lastBy, s.lastAction], [true, guest.id, guest.id, 'brainrot']);
  // Not flipped back and forth: one switch every 2 seconds per conversation.
  assert.match((await ack(sb, 'reels:brainrot', { key, on: false })).error, /Not so fast/);
  await sleep(2050);
  // The session carries nothing about it but the yes or no: no game, no link, no text.
  const text = JSON.stringify(gb.state);
  for (const leak of ['youtube', 'dQw4w9WgXcQ', '<b>', 'parkour']) assert.ok(!text.includes(leak), `nothing like ${leak}`);
  // Only I control: the guest can't flip it any more; the starter can.
  assert.equal((await ack(sb, 'reels:mode', { key, hostOnly: true })).ok, true);
  assert.match((await ack(sg, 'reels:brainrot', { key, on: false })).error, /started it/);
  assert.equal((await ack(sb, 'reels:brainrot', { key, on: false })).ok, true);
  await settle();
  assert.deepEqual([gg.state.session.brainrot, gg.state.session.brainrotBy], [false, '']);
  await sleep(2050);
  // Someone who left the session can't either.
  assert.equal((await ack(sb, 'reels:mode', { key, hostOnly: false })).ok, true);
  assert.equal((await ack(sg, 'reels:follow', { key, on: false })).ok, true);
  assert.match((await ack(sg, 'reels:brainrot', { key, on: true })).error, /Rejoin/);
  // A new session starts with it off.
  assert.equal((await ack(sb, 'reels:brainrot', { key, on: true })).ok, true);
  assert.equal((await ack(sb, 'reels:stop', { key })).ok, true);
  assert.equal((await ack(sb, 'reels:start', { key, mid: m })).ok, true);
  await settle();
  assert.equal(gb.state.session.brainrot, false);
  for (const x of [sb, sg]) await ack(x, 'reels:leave', {});
});

test('brainrot: the client takes the session\'s switch only as a yes or no', async () => {
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'reels.js')).href);
  assert.equal(R.cleanSession({ mid: 'm1', brainrot: true }).brainrot, true);
  for (const v of ['true', 1, { on: true }, undefined]) assert.equal(R.cleanSession({ mid: 'm1', brainrot: v }).brainrot, false, String(v));
  assert.equal(R.cleanSession({ mid: 'm1', brainrot: true, brainrotBy: 'u_1' }).brainrotBy, 'u_1');
  assert.equal(R.cleanSession({ mid: 'm1', brainrot: true, brainrotBy: '<b>' }).brainrotBy, '');
  assert.equal(R.cleanSession({ mid: 'm1', brainrot: false, brainrotBy: 'u_1' }).brainrotBy, '');
});
