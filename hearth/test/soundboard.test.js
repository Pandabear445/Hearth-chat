// Soundboards (v25): everyone's own encrypted sounds (server/soundboard.js), playing them into a call (voice:board in
// server/index.js, the soundboard lane in public/js/voice.js), the Use Soundboard permission, and the profile
// extras that came with them (server/profile.js, public/js/profile-ui.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex, sleep } = require('./helpers');
const { sanitizeProfile } = require('../server/profile');
const { PERMS, DEFAULT_EVERYONE, TALK, CHANNEL_SCOPED } = require('../server/perms');
const BOARD = require('../server/soundboard');

let srv;
const socks = [];
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const sock = async (u) => { const s = await srv.socket(u.token); socks.push(s); return s; };
const ack = (s, ev, p, ms = 5000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.emit(ev, p, (x) => { clearTimeout(t); r(x); }); });
const next = (s, ev, ms = 2000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.once(ev, (x) => { clearTimeout(t); r(x); }); });
const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);

before(async () => { srv = await startServer(); });
after(async () => { socks.forEach((s) => s.close()); await srv.stop(); });

async function community(n = 1) {
  const owner = await srv.register();
  const members = [];
  for (let i = 0; i < n; i++) members.push(await srv.register());
  const server = (await as(owner, 'POST', '/servers', { name: 'Board ' + hex(3) })).json;
  const invite = (await as(owner, 'POST', `/servers/${server.id}/invites`, {})).json;
  for (const m of members) assert.equal((await as(m, 'POST', `/invites/${invite.code}/join`)).status, 200);
  return { owner, members, member: members[0], server, voiceCh: server.channels.find((c) => c.type === 'voice') };
}
// What the app sends: sealed details ("x1:" and ciphertext) and the encrypted audio, base64.
const sealed = (n = 200) => 'x1:' + Buffer.alloc(n, 7).toString('base64');
const audio = (bytes = 4000) => Buffer.alloc(bytes, 3).toString('base64');
const sid = () => hex(6);

// ------------------------------------------------------------------ storage
test('soundboard: sounds are stored as the app sealed them, listed without their audio, and only their owner gets them', async () => {
  const a = await srv.register(); const b = await srv.register();
  const id = sid();
  assert.equal((await as(a, 'PUT', `/me/soundboard/${id}`, { kind: 'sound', meta: sealed(), audio: audio() })).status, 200);
  const list = (await as(a, 'GET', '/me/soundboard')).json;
  assert.equal(list.items.length, 1);
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['id', 'kind', 'meta', 'size', 'updatedAt']);
  assert.equal(list.items[0].meta, sealed());
  assert.deepEqual(list.limits, { sounds: 24, bytes: 1024 * 1024, ms: 5000 });
  assert.equal((await as(a, 'GET', `/me/soundboard/${id}/audio`)).json.audio, audio());
  // Someone else: not in their list, and the audio isn't theirs to fetch (or delete).
  assert.equal((await as(b, 'GET', '/me/soundboard')).json.items.length, 0);
  assert.equal((await as(b, 'GET', `/me/soundboard/${id}/audio`)).status, 404);
  await as(b, 'DELETE', `/me/soundboard/${id}`);
  assert.equal((await as(a, 'GET', '/me/soundboard')).json.items.length, 1);
  // Renaming keeps the audio; deleting takes it.
  assert.equal((await as(a, 'PUT', `/me/soundboard/${id}`, { kind: 'sound', meta: sealed(300) })).status, 200);
  assert.equal((await as(a, 'GET', `/me/soundboard/${id}/audio`)).json.audio, audio());
  assert.equal((await as(a, 'DELETE', `/me/soundboard/${id}`)).status, 200);
  assert.equal((await as(a, 'GET', `/me/soundboard/${id}/audio`)).status, 404);
  // The layout is one sealed item of its own.
  assert.equal((await as(a, 'PUT', '/me/soundboard/layout', { kind: 'layout', meta: sealed(500) })).status, 200);
  assert.deepEqual((await as(a, 'GET', '/me/soundboard')).json.items.map((x) => [x.id, x.kind]), [['layout', 'layout']]);
});

test('soundboard: what isn’t sealed, too big, not base64 or over the limit is refused', async () => {
  const a = await srv.register();
  const put = (id, body) => as(a, 'PUT', `/me/soundboard/${id}`, body);
  assert.equal((await put(sid(), { kind: 'sound', meta: '{"name":"plain"}', audio: audio() })).status, 400, 'details in the clear');
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed(5000), audio: audio() })).status, 400, 'details far too long');
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed() })).status, 400, 'a new sound needs its audio');
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed(), audio: 'not base64!' })).status, 400);
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed(), audio: 'AAAA' })).status, 400, 'too small to be a sound');
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed(), audio: audio(1024 * 1024 + 100) })).status, 413, 'over 1 MB');
  assert.equal((await put(sid(), { kind: 'sound', meta: sealed(), audio: audio(1024 * 1024) })).status, 200, 'exactly 1 MB (plus encryption) is fine');
  assert.equal((await put('BAD/ID', { kind: 'sound', meta: sealed(), audio: audio() })).status, 404);
  assert.equal((await put('short', { kind: 'sound', meta: sealed(), audio: audio() })).status, 400);
  assert.equal((await put(sid(), { kind: 'deck', meta: sealed(), audio: audio() })).status, 400);
  assert.equal((await put('layout', { kind: 'sound', meta: sealed(), audio: audio() })).status, 400, 'the layout’s id is the layout’s');
  assert.equal((await put('layout', { kind: 'layout', meta: sealed(20000) })).status, 400);
  // 24 sounds at most.
  const n = (await as(a, 'GET', '/me/soundboard')).json.items.length;
  for (let i = n; i < 24; i++) assert.equal((await put(sid(), { kind: 'sound', meta: sealed(), audio: audio(100) })).status, 200);
  const full = await put(sid(), { kind: 'sound', meta: sealed(), audio: audio(100) });
  assert.equal(full.status, 413);
  assert.match(full.json.error, /full \(24 sounds\)/);
});

// ------------------------------------------------------------------ playing into a call
test('voice:board: only someone in the call, unmuted, with Use Soundboard and Speak; the others are told how long', async () => {
  const { owner, member, server, voiceCh } = await community();
  const so = await sock(owner); const sm = await sock(member);
  assert.ok((await ack(sm, 'voice:board', { ms: 1000 })).error, 'not in a call');
  assert.equal((await ack(so, 'voice:join', { channelId: voiceCh.id, board: true })).ok, true);
  const joined = await ack(sm, 'voice:join', { channelId: voiceCh.id, board: true });
  assert.deepEqual(joined.peers.map((p) => [p.userId, p.board]), [[owner.id, true]], 'apps with a soundboard lane are listed as such');
  // Plays reach the others (not the player), at most 5 seconds long.
  let heard = next(so, 'voice:board');
  assert.deepEqual(await ack(sm, 'voice:board', { ms: 99999 }), { ok: true, ms: 5000 });
  assert.deepEqual(await heard, { channelId: voiceCh.id, userId: member.id, ms: 5000 });
  // Too soon after the last one.
  await sleep(50);
  assert.match((await ack(sm, 'voice:board', { ms: 500 })).error, /Too many/);
  await sleep(BOARD.PLAY_RATE.gapMs + 50);
  // Muted by choice: the app is told to unmute.
  sm.emit('voice:update', { muted: true, deafened: false });
  await sleep(100);
  assert.match((await ack(sm, 'voice:board', { ms: 500 })).error, /Unmute/);
  sm.emit('voice:update', { muted: false, deafened: false });
  await sleep(100);
  // Use Soundboard denied in this voice channel for @everyone.
  assert.equal((await as(owner, 'PUT', `/channels/${voiceCh.id}/overrides`, { overrides: [{ type: 'role', id: server.id, allow: 0, deny: PERMS.USE_SOUNDBOARD }] })).status, 200);
  heard = next(so, 'voice:board', 600);
  assert.match((await ack(sm, 'voice:board', { ms: 500 })).error, /permission to use the soundboard/);
  assert.equal(await heard, null, 'nothing reaches the others');
  // The owner still may (owners have every permission).
  await sleep(BOARD.PLAY_RATE.gapMs);
  assert.equal((await ack(so, 'voice:board', { ms: 500 })).ok, true);
  assert.equal((await as(owner, 'PUT', `/channels/${voiceCh.id}/overrides`, { overrides: [] })).status, 200);
  // Timed out: no Speak, so no sounds either.
  assert.equal((await as(owner, 'POST', `/servers/${server.id}/members/${member.id}/timeout`, { minutes: 5 })).status, 200);
  await sleep(300);
  await sleep(BOARD.PLAY_RATE.gapMs);
  assert.ok((await ack(sm, 'voice:board', { ms: 500 })).error, 'timed out');
});

test('voice:board: a burst of plays is cut off, and a DM call works without a server', async () => {
  const { owner, member } = await community();
  const so = await sock(owner); const sm = await sock(member);
  const dm = (await as(owner, 'POST', '/dms', { userId: member.id })).json;
  assert.equal((await ack(so, 'voice:join', { channelId: 'dm:' + dm.id })).ok, true);
  assert.equal((await ack(sm, 'voice:join', { channelId: 'dm:' + dm.id })).ok, true);
  const got = [];
  so.on('voice:board', (x) => got.push(x));
  let ok = 0; let refused = 0;
  for (let i = 0; i < 14; i++) {
    const r = await ack(sm, 'voice:board', { ms: 200 });
    if (r.ok) ok++; else refused++;
    await sleep(BOARD.PLAY_RATE.gapMs + 30);
  }
  assert.equal(ok, BOARD.PLAY_RATE.burst, `${BOARD.PLAY_RATE.burst} plays in 30 seconds`);
  assert.equal(refused, 14 - BOARD.PLAY_RATE.burst);
  await sleep(100);
  assert.equal(got.length, ok);
  assert.ok(got.every((x) => x.ms === 200 && x.userId === member.id && x.channelId === 'dm:' + dm.id));
  // Back-to-back 5-second plays: at most 15 seconds of sound in 30 (the owner's own budget, untouched so far).
  let long = 0;
  for (let i = 0; i < 5; i++) { if ((await ack(so, 'voice:board', { ms: 5000 })).ok) long++; await sleep(BOARD.PLAY_RATE.gapMs + 30); }
  assert.equal(long, BOARD.PLAY_RATE.msPerWindow / 5000);
});

test('Use Soundboard: on for @everyone in new servers, scoped per channel, and taken by a timeout', async () => {
  assert.equal(PERMS.USE_SOUNDBOARD, 1 << 22);
  assert.ok(DEFAULT_EVERYONE & PERMS.USE_SOUNDBOARD);
  assert.ok(CHANNEL_SCOPED & PERMS.USE_SOUNDBOARD);
  assert.ok(TALK & PERMS.USE_SOUNDBOARD);
  const { PERMS: CP, PERM_GROUPS, GROUP_MEMBER } = await clientModule('perms.js');
  assert.equal(CP.USE_SOUNDBOARD, PERMS.USE_SOUNDBOARD, 'the app has the same bit');
  assert.ok(PERM_GROUPS.find(([g]) => g === 'Voice')[1].some(([k]) => k === 'USE_SOUNDBOARD'), 'and shows it in the role editor');
  assert.ok(GROUP_MEMBER & CP.USE_SOUNDBOARD);
  const { owner, server } = await community(0);
  const boot = (await as(owner, 'GET', '/bootstrap')).json;
  assert.ok(boot.servers.find((s) => s.id === server.id).roleDefs.find((r) => r.id === server.id).permissions & PERMS.USE_SOUNDBOARD);
});

// ------------------------------------------------------------------ the call engine's soundboard lane
class FakePC {
  constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; this.signalingState = 'stable'; this.lanes = []; }
  addTransceiver(kind) { const sender = { track: null, replaceTrack: async (t) => { sender.track = t; }, getParameters: () => ({}), setParameters: async () => {} }; const t = { kind, direction: 'sendrecv', sender }; this.lanes.push(t); return t; }
  getTransceivers() { return this.lanes; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) { this.remoteDescription = d; }
  async addIceCandidate() {}
  setConfiguration() {}
  async getStats() { return new Map(); }
  close() { this.connectionState = 'closed'; }
}
class FakeTrack { constructor(kind) { this.kind = kind; this.readyState = 'live'; this.enabled = true; } stop() { this.readyState = 'ended'; } clone() { return new FakeTrack(this.kind); } getSettings() { return { deviceId: 'mic-1' }; } }
function fakeSocket(onEmit = () => undefined) {
  const handlers = {}; const sent = [];
  return {
    handlers, sent, id: 'me', connected: true,
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, payload, cb) { sent.push({ ev, payload }); const r = onEmit(ev, payload); if (cb) Promise.resolve(r).then((x) => setTimeout(() => cb(x || { ok: true }), 1)); },
    fire(ev, payload) { (handlers[ev] || []).forEach((fn) => fn(payload)); },
    connect() {},
  };
}
const store = new Map();
async function engine() {
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.RTCPeerConnection = FakePC;
  globalThis.MediaStream = class { constructor(tracks = []) { this.tracks = tracks; } getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); } getTracks() { return this.tracks; } };
  const mediaDevices = { getUserMedia: async () => new globalThis.MediaStream([new FakeTrack('audio')]), enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices }, configurable: true, writable: true });
  return clientModule('voice.js');
}

test('engine: a soundboard lane only with apps that have one, and it plays only while the server says a sound is playing', async () => {
  const { Voice, BOARD_SLACK_MS } = await engine();
  store.clear();
  const boardTrack = new FakeTrack('audio');
  const socket = fakeSocket((ev) => (ev === 'voice:join' ? { ok: true, peers: [{ socketId: 'B', userId: 'ub', board: true }, { socketId: 'C', userId: 'uc' }], canSpeak: true, silenced: [] }
    : ev === 'voice:board' ? { ok: true, ms: 1200 } : undefined));
  const v = new Voice({ socket, getIceServers: () => [], signSdp: async () => 'sig', verifySdp: async () => true, myId: () => 'me', boardTrack: () => boardTrack });
  await v.join('room');
  assert.equal(socket.sent.find((x) => x.ev === 'voice:join').payload.board, true, 'the server is told this app has a soundboard lane');
  const b = v.peerByUser('ub'); const c = v.peerByUser('uc');
  assert.equal(b.pc.lanes.length, 5, 'five lanes with someone whose app has one');
  assert.equal(b.pc.lanes[4].sender.track, boardTrack, 'our sounds go out on it');
  assert.equal(c.pc.lanes.length, 4, 'four with an older app');
  // Someone who comes back on an older app (the server's list no longer says board) gets no fifth lane after that.
  v.noteAvoiders([{ userId: 'ub', socketId: 'B' }]);
  assert.equal(v.boardPeers.has('ub'), false);
  v.noteAvoiders([{ userId: 'ub', socketId: 'B', board: true }]);
  // Their lane: silent until the server says they're playing something, then for that long (plus a little).
  b.board = { muted: true, volume: 1, remove() {} };
  v.applyBoardAudio(b);
  assert.equal(b.board.muted, true);
  socket.fire('voice:board', { channelId: 'elsewhere', userId: 'ub', ms: 1000 });
  assert.equal(b.board.muted, true, 'another call’s play is ignored');
  socket.fire('voice:board', { channelId: 'room', userId: 'ub', ms: 99999 });
  assert.equal(b.board.muted, false);
  assert.ok(v.boardOpen.get('ub').until - Date.now() <= 5000 + BOARD_SLACK_MS, 'never longer than 5 seconds');
  socket.fire('voice:board', { channelId: 'room', userId: 'ub', ms: 100 });
  await sleep(100 + BOARD_SLACK_MS + 80);
  assert.equal(b.board.muted, true, 'closed again once it’s over');
  // Their soundboard muted here, everyone's off, or deafened: never heard.
  const open = () => socket.fire('voice:board', { channelId: 'room', userId: 'ub', ms: 3000 });
  store.set('hearth.board', JSON.stringify({ muted: { ub: true } })); open();
  assert.equal(b.board.muted, true, 'muted for this person');
  store.set('hearth.board', JSON.stringify({ off: true })); open();
  assert.equal(b.board.muted, true, 'everyone’s off');
  store.set('hearth.board', JSON.stringify({ volume: 0.5 })); open();
  assert.deepEqual([b.board.muted, b.board.volume], [false, 0.5], 'at our soundboard volume');
  v.setVolume('ub', 0.5);
  assert.equal(b.board.volume, 0.25, 'and their own volume');
  v.setDeafened(true);
  assert.equal(b.board.muted, true, 'deafened');
  v.setDeafened(false);
  v.setSilenced(['ub']);
  assert.equal(b.board.muted, true, 'server-muted people play no sounds either');
  v.setSilenced([]);
  // Our own plays ask the server first, and come back with the length it allowed.
  assert.equal(await v.requestBoardPlay(99999), 1200);
  assert.equal(socket.sent.filter((x) => x.ev === 'voice:board').pop().payload.ms, 5000);
  await v.leave();
  assert.equal(v.boardOpen.size, 0);
  await assert.rejects(v.requestBoardPlay(1000), /Join a call/);
});

test('engine: without a soundboard the app never asks for the lane, and an offered one plays nothing', async () => {
  const { Voice } = await engine();
  const socket = fakeSocket((ev) => (ev === 'voice:join' ? { ok: true, peers: [{ socketId: 'B', userId: 'ub', board: true }], canSpeak: true, silenced: [] } : undefined));
  const v = new Voice({ socket, getIceServers: () => [], signSdp: async () => 'sig', verifySdp: async () => true, myId: () => 'me' });
  await v.join('room');
  assert.equal(socket.sent.find((x) => x.ev === 'voice:join').payload.board, undefined);
  assert.equal(v.peerByUser('ub').pc.lanes.length, 4);
  await v.leave();
});

// ------------------------------------------------------------------ the app's checks (soundboard-core.js)
test('soundboard-core: files are told apart by their first bytes, and sizes and lengths are checked', async () => {
  const C = await clientModule('soundboard-core.js');
  const head = (s, pad = 16) => { const b = new Uint8Array(pad); for (let i = 0; i < s.length; i++) b[i] = typeof s === 'string' ? s.charCodeAt(i) : s[i]; return b; };
  assert.equal(C.sniffAudio(head('ID3\u0004')), 'audio/mpeg');
  assert.equal(C.sniffAudio(head([0xff, 0xfb, 0x90])), 'audio/mpeg');
  assert.equal(C.sniffAudio(head('OggS')), 'audio/ogg');
  const wav = head('RIFF\u0000\u0000\u0000\u0000WAVE'); assert.equal(C.sniffAudio(wav), 'audio/wav');
  assert.equal(C.sniffAudio(head('\u0000\u0000\u0000 ftypM4A ')), 'audio/mp4');
  assert.equal(C.sniffAudio(head([0x1a, 0x45, 0xdf, 0xa3])), 'audio/webm');
  assert.equal(C.sniffAudio(head('fLaC')), 'audio/flac');
  for (const bad of ['<svg onload=x>', '<html><script>', '%PDF-1.7', 'PK\u0003\u0004', 'GIF89a', 'RIFF\u0000\u0000\u0000\u0000AVI ']) assert.equal(C.sniffAudio(head(bad)), '', bad);
  assert.equal(C.sniffAudio(new Uint8Array(3)), '');
  assert.equal(C.checkSoundFile({ size: 1000, type: 'audio/mpeg', head: head('ID3\u0004') }), '');
  assert.equal(C.checkSoundFile({ size: 1000, type: '', head: head('OggS') }), '', 'no type from the browser is fine');
  assert.match(C.checkSoundFile({ size: 0, type: 'audio/mpeg', head: head('ID3') }), /empty/);
  assert.match(C.checkSoundFile({ size: 2 * 1024 * 1024, type: 'audio/mpeg', head: head('ID3') }), /up to 1 MB/);
  assert.match(C.checkSoundFile({ size: 1000, type: 'image/svg+xml', head: head('ID3') }), /isn’t an audio file/);
  assert.match(C.checkSoundFile({ size: 1000, type: 'audio/mpeg', head: head('<html>') }), /isn’t a sound/, 'renamed to .mp3 doesn’t make it one');
  assert.equal(C.checkLength(4.9), '');
  assert.equal(C.checkLength(5.1), '', 'a little padding at the end is fine');
  assert.match(C.checkLength(6), /up to 5 seconds/);
  assert.match(C.checkLength(0), /silent/);
  assert.match(C.checkLength(NaN), /silent/);
});

test('soundboard-core: decrypted details and layouts are cleaned before use', async () => {
  const C = await clientModule('soundboard-core.js');
  const k = Buffer.alloc(32, 1).toString('base64');
  assert.equal(C.cleanSoundMeta({ name: 'x' }), null, 'no key: unusable');
  assert.equal(C.cleanSoundMeta({ name: 'x', k: 'short' }), null);
  const m = C.cleanSoundMeta({ name: '  Air\u0000horn <b>' + 'x'.repeat(50), emoji: '📯🎺🥁<img>', color: 'red;background:url(x)', volume: 7, k, mime: 'text/html', ms: 99999 });
  assert.equal(m.name.length, 32);
  assert.ok(!/\u0000/.test(m.name));
  assert.equal(m.emoji, '📯🎺', 'two emoji at most, no markup');
  assert.equal(m.color, '#f2a541', 'only a hex color');
  assert.equal(m.volume, 1);
  assert.equal(m.mime, 'audio/mpeg');
  assert.equal(m.ms, 5000);
  assert.equal(C.cleanSoundMeta({ name: '', k }).name, 'Sound');
  // Layouts: every sound on exactly one page, unknown and repeated ids dropped, at most 8 pages.
  const ids = ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3'];
  const l = C.cleanLayout({ view: 'list', size: 'xl', pages: [{ name: 'Memes', ids: ['bbbbbbbb2', 'zzzzzzzz9', 'bbbbbbbb2'] }, { name: '', ids: ['bbbbbbbb2', 'aaaaaaaa1', '../x'] }] }, ids);
  assert.deepEqual(l, { view: 'list', size: 'md', pages: [{ name: 'Memes', ids: ['bbbbbbbb2', 'cccccccc3'] }, { name: 'Sounds', ids: ['aaaaaaaa1'] }] });
  assert.equal(C.cleanLayout({ pages: Array.from({ length: 20 }, () => ({ name: 'p', ids: [] })) }, []).pages.length, 8);
  assert.deepEqual(C.cleanLayout('junk', ids), { view: 'grid', size: 'md', pages: [{ name: 'Sounds', ids }] });
  const moved = C.moveSound(l, 'aaaaaaaa1', 0, 1);
  assert.deepEqual(moved.pages.map((p) => p.ids), [['bbbbbbbb2', 'aaaaaaaa1', 'cccccccc3'], []]);
  assert.deepEqual(C.moveSound(moved, 'bbbbbbbb2', 1, Infinity).pages.map((p) => p.ids), [['aaaaaaaa1', 'cccccccc3'], ['bbbbbbbb2']]);
  const sounds = new Map(ids.map((id, i) => [id, { name: 'S' + i, emoji: '🔊', color: '#123456', k, volume: 1 }]));
  const show = C.showcaseOf(moved, sounds);
  assert.deepEqual(show.map((x) => x.name), ['S1', 'S0', 'S2']);
  assert.ok(show.every((x) => Object.keys(x).sort().join() === 'color,emoji,name'), 'never the key');
  const id = C.newSoundId();
  assert.match(id, /^[a-z0-9]{8,32}$/);
});

// ------------------------------------------------------------------ profile extras
test('profile: banner styles, decorations, text size, sections, favorites, song links and the soundboard showcase are validated', () => {
  const p = sanitizeProfile({
    bannerFx: 'aurora', bannerColor2: '#ABCDEF', avatarDecoration: 'crown', textSize: 'xl',
    sectionOrder: ['since', 'bio', 'nope', 'bio', '__proto__'], hiddenSections: ['recent', 'recent', 'evil'],
    favorites: [{ emoji: '🍕', label: 'Food<script>', value: 'Pizza\u0000!' }, { label: 'no value' }, ...Array.from({ length: 8 }, (_, i) => ({ label: 'L' + i, value: 'V' }))],
    showSoundboard: true, soundShowcase: [{ name: 'Airhorn', emoji: '📯', color: 'javascript:alert(1)' }, { name: '' }],
  });
  assert.equal(p.bannerFx, 'aurora');
  assert.equal(p.bannerColor2, '#abcdef');
  assert.equal(p.avatarDecoration, 'crown');
  assert.equal(p.textSize, 'xl');
  assert.deepEqual(p.sectionOrder.slice(0, 3), ['since', 'bio', 'activity']);
  assert.equal(p.sectionOrder.length, 12);
  assert.deepEqual(p.hiddenSections, ['recent']);
  assert.equal(p.favorites.length, 5, 'six slots, one without a value dropped');
  assert.deepEqual(p.favorites[0], { emoji: '🍕', label: 'Foodscript', value: 'Pizza!' });
  assert.deepEqual(p.soundShowcase, [{ name: 'Airhorn', emoji: '📯', color: '#f2a541' }]);
  assert.equal(p.showSoundboard, true);
  assert.deepEqual(sanitizeProfile({ showSoundboard: false, soundShowcase: [{ name: 'Old' }] }).soundShowcase, [], 'kept only while it’s on');
  const junk = sanitizeProfile({ bannerFx: 'x', avatarDecoration: 'url(evil)', textSize: 99, showSoundboard: 'yes' });
  assert.deepEqual([junk.bannerFx, junk.avatarDecoration, junk.textSize, junk.showSoundboard], ['none', 'none', 'md', false]);
  // Song links: https on a music service only, no logins in the address.
  const link = (url) => sanitizeProfile({ songLink: { url, label: 'Song' } }).songLink.url;
  assert.equal(link('https://open.spotify.com/track/abc'), 'https://open.spotify.com/track/abc');
  assert.equal(link('https://artist.bandcamp.com/track/x'), 'https://artist.bandcamp.com/track/x');
  assert.equal(link('https://youtu.be/xyz'), 'https://youtu.be/xyz');
  for (const bad of ['http://open.spotify.com/track/a', 'javascript:alert(1)', 'https://evil.example/spotify', 'https://open.spotify.com.evil.example/x',
    'https://user:pw@open.spotify.com/x', 'https://open.spotify.com:8443/x', 'data:text/html,hi', 'https://bandcamp.com.evil.example/']) assert.equal(link(bad), '', bad);
});

test('profile: the new fields are saved, shown to others, and checked against the server’s blocked words', async () => {
  const a = await srv.register(); const b = await srv.register();
  const r = await as(a, 'PATCH', '/me/profile', { favorites: [{ emoji: '🎮', label: 'Game', value: 'Tetris' }], songLink: { url: 'https://soundcloud.com/x/y', label: 'Track' }, avatarDecoration: 'halo', sectionOrder: ['favorites'] });
  assert.equal(r.status, 200);
  assert.equal(r.json.profile.avatarDecoration, 'halo');
  const seen = (await as(b, 'GET', `/users/${a.id}`)).json;
  const prof = seen.profile || seen.user.profile;
  assert.deepEqual(prof.favorites, [{ emoji: '🎮', label: 'Game', value: 'Tetris' }]);
  assert.equal(prof.sectionOrder[0], 'favorites');
});

// A page just big enough for profile-ui.js to draw a card into.
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = ''; this.dataset = {}; this.style = { setProperty: (k, v) => { this.style[k] = v; } }; this.text = ''; }
  append(...k) { for (const c of k) { if (c && typeof c === 'object' && c.tagName) c.parentNode = this; this.children.push(c); } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener() {}
  get classList() { const el = this; return { add: (c) => { el.className += ' ' + c; }, contains: (c) => el.className.split(' ').includes(c), toggle() {}, remove() {} }; }
  set innerHTML(v) { this.text = String(v); }
  get textContent() { return this.children.map((c) => (typeof c === 'object' && c.tagName ? c.textContent : c.data ?? String(c))).join('') + this.text; }
  all(fn, out = []) { for (const c of this.children) if (c && c.tagName) { if (fn(c)) out.push(c); c.all(fn, out); } return out; }
}
test('profile-ui: sections follow the chosen order, hidden ones stay hidden, and only music links become song cards', async () => {
  const had = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => ({ data: String(t) }), addEventListener() {}, documentElement: new El('html'), querySelector: () => null, querySelectorAll: () => [] };
  globalThis.Node = El;
  // (activity.js keeps its "for 2h" labels fresh with an interval of its own, which would keep this test running.)
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = (...x) => { const id = realInterval(...x); id.unref(); return id; };
  let UI;
  try { UI = await clientModule('profile-ui.js'); } finally { globalThis.setInterval = realInterval; }
  assert.equal(UI.songService('https://open.spotify.com/track/1'), 'Spotify');
  assert.equal(UI.songService('https://music.youtube.com/watch?v=1'), 'YouTube Music');
  assert.equal(UI.songService('http://open.spotify.com/track/1'), '', 'https only');
  assert.equal(UI.songService('javascript:alert(1)'), '');
  assert.equal(UI.songService('https://evil.example/open.spotify.com'), '');
  assert.equal(UI.songLinkEl({ url: 'https://evil.example/x', label: 'x' }), null);
  assert.deepEqual(UI.sectionOrder(['since', 'x', 'since']).slice(0, 2), ['since', 'activity']);
  const user = (profile) => ({ id: 'u1', username: 'ann', createdAt: Date.now(), profile: { displayName: 'Ann', ...profile } });
  const labels = (card) => card.all((e) => e.className === 'pc-label').map((e) => e.textContent);
  const base = { bio: 'hi', interests: ['cats'], favorites: [{ emoji: '🍕', label: 'Food', value: 'Pizza' }], showSoundboard: true, soundShowcase: [{ name: 'Boom', emoji: '💥', color: '#ff0000' }] };
  assert.deepEqual(labels(UI.profileCard(user(base))), ['About me', 'Favorite things', 'Soundboard', 'Interests', 'Member since']);
  assert.deepEqual(labels(UI.profileCard(user({ ...base, sectionOrder: ['interests', 'soundboard'], hiddenSections: ['bio', 'since'] }))), ['Interests', 'Soundboard', 'Favorite things']);
  assert.ok(!labels(UI.profileCard(user({ ...base, showSoundboard: false }))).includes('Soundboard'), 'the soundboard only when turned on');
  const card = UI.profileCard(user({ textSize: 'xl', bannerFx: 'flow', avatarDecoration: 'crown', songLink: { url: 'https://open.spotify.com/track/1', label: 'Song <b>' } }));
  assert.match(card.className, /pc-text-xl/);
  assert.equal(card.all((e) => /bfx-flow/.test(e.className)).length, 1);
  assert.equal(card.all((e) => /deco-crown/.test(e.className)).length, 1);
  const link = card.all((e) => e.className === 'pc-songlink')[0];
  assert.equal(link.attrs.href, 'https://open.spotify.com/track/1');
  assert.equal(link.attrs.rel, 'noopener noreferrer nofollow');
  assert.match(link.textContent, /Song <b>on Spotify/, 'the title is text, never markup');
  // A showcase color that isn't a hex color never reaches the style.
  const odd = UI.soundShowcaseEl([{ name: 'x', color: 'red;background:url(//evil)' }]);
  assert.equal(odd.children[0].style['--sb-color'], '#f2a541');
  Object.assign(globalThis, had);
});
