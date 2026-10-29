// Scroll together (docs/design/SCROLL-TOGETHER.md): people looking at a conversation's Reels tab move through its
// TikToks and reels as one. The feed itself is made on each device from the decrypted messages (public/js/reels.js),
// so this server never sees a link here: the shared place is a message id (and which link in it, 0 to 3), checked to
// be a message of that conversation. Play, pause and the time go along for TikTok (the watch-together sync), and a
// "start together" countdown and a ready check for Instagram, whose player can't be controlled.
//
// Who: only people who can read the conversation (a channel they can view, a DM they're in), checked when they come
// and again for every update sent (someone who loses access stops hearing). A session is for the people viewing the
// tab ("viewers"); those following it move with it. People in the conversation's call who aren't viewing are told
// it started (reels:invite), nothing more.
//
// Limits: one tab per connection; every connection's events count against the realtime flood limits (index.js), and
// updates to a conversation go out at most 4 times a second (bursts merged, like watch together). State is small and
// fixed in shape: ids, numbers and user ids, never text.
const MID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[cd]:[A-Za-z0-9_-]{1,64}$/;
const COUNTDOWN_MS = 3000;
const MAX_VIEWERS = 200; // per conversation

module.exports = function setupReels(ctx) {
  const { io, db, fail, requireChannel, requireDm, isStaff, isBlocked, voiceChannels, jobs, hiddenFor } = ctx;
  const rooms = new Map(); // key -> { viewers: Map(socketId -> uid), following: Set(uid), session, ready, emit: { last, timer } }
  const where = new Map(); // socketId -> key (one tab per connection)

  // Throws (404/403) unless uid may read this conversation. Returns what the checks need later.
  function access(key, uid) {
    if (typeof key !== 'string' || !KEY.test(key)) fail(400, 'Not a conversation.');
    const id = key.slice(2);
    if (key[0] === 'c') {
      const c = requireChannel(id, uid);
      return { c, call: c.type === 'voice' ? id : null };
    }
    const d = requireDm(id, uid);
    if (isBlocked(d.user_a, d.user_b)) fail(403, 'You can’t do this with someone you blocked, or who blocked you.');
    return { d, call: `dm:${id}` };
  }
  const allowed = (key, uid) => { try { access(key, uid); return true; } catch { return false; } };
  // A message of this conversation (not a thread reply: the feed is the conversation's own messages).
  // (One from before a member's history starts, server/joinhistory.js, isn't theirs to name.)
  function isMessageOf(key, mid, uid) {
    if (typeof mid !== 'string' || !MID.test(mid)) return false;
    const id = key.slice(2);
    if (key[0] === 'c') {
      const m = db.prepare('SELECT * FROM messages WHERE id = ? AND channel_id = ? AND thread_id IS NULL').get(mid, id);
      return !!m && !hiddenFor(m, uid);
    }
    return !!db.prepare('SELECT 1 FROM dm_messages WHERE id = ? AND dm_id = ?').get(mid, id);
  }
  const mayControl = (room, uid) => {
    const s = room.session;
    if (!s || !room.following.has(uid)) return false;
    if (!s.hostOnly || s.by === uid || isStaff(uid)) return true;
    return false;
  };

  const out = (key, room) => {
    const s = room.session;
    const viewers = [...new Set(room.viewers.values())];
    return {
      key, viewers,
      session: s ? {
        by: s.by, hostOnly: s.hostOnly, mid: s.mid, i: s.i, playing: s.playing, position: s.position, updatedAt: s.updatedAt, startAt: s.startAt,
        seq: s.seq, lastBy: s.lastBy, lastAction: s.lastAction, dir: s.dir,
        following: viewers.filter((u) => room.following.has(u)),
        ready: room.ready && room.ready.mid === s.mid && room.ready.i === s.i ? [...room.ready.users].filter((u) => viewers.includes(u)) : [],
      } : null,
      serverNow: Date.now(),
    };
  };
  // To each viewer whose access still holds; anyone else is let go.
  function send(key) {
    const room = rooms.get(key);
    if (!room) return;
    room.emit.timer = null; room.emit.last = Date.now();
    for (const [sid, uid] of [...room.viewers]) {
      if (!allowed(key, uid)) { drop(sid); continue; }
    }
    const state = out(key, room);
    for (const sid of room.viewers.keys()) io.to(sid).emit('reels:state', state);
  }
  function emit(key) {
    const room = rooms.get(key);
    if (!room || room.emit.timer) return;
    const wait = room.emit.last + 250 - Date.now();
    if (wait <= 0) send(key); else room.emit.timer = setTimeout(jobs.job('reels.emit', () => send(key)), wait);
  }
  // A connection stops viewing (left the tab, closed, lost access). The last one out ends the conversation's room.
  function drop(sid) {
    const key = where.get(sid);
    where.delete(sid);
    const room = key && rooms.get(key);
    if (!room) return;
    const uid = room.viewers.get(sid);
    room.viewers.delete(sid);
    if (uid && ![...room.viewers.values()].includes(uid)) room.following.delete(uid);
    if (!room.viewers.size) { clearTimeout(room.emit.timer); rooms.delete(key); return; }
    if (room.session && !room.following.size) room.session = null;
    emit(key);
  }

  const posOf = (s) => s.position + (s.playing ? Math.max(0, Date.now() - s.updatedAt) / 1000 : 0);
  const touch = (s, uid, action) => { s.seq += 1; s.lastBy = uid; s.lastAction = action; };

  function attach(socket, uid, guard) {
    const mine = (p) => {
      const key = p && p.key;
      if (where.get(socket.id) !== key || !rooms.has(key)) fail(400, 'Open the Reels tab first.');
      access(key, uid);
      return { key, room: rooms.get(key) };
    };
    const session = (p) => {
      const r = mine(p);
      if (!r.room.session) fail(404, 'Nobody is scrolling together here.');
      return r;
    };
    const control = (p) => {
      const r = session(p);
      if (!mayControl(r.room, uid)) fail(403, r.room.following.has(uid) ? `Only the person who started it controls it right now.` : 'Rejoin to move everyone.');
      return r;
    };

    socket.on('reels:join', guard((p = {}) => {
      const key = p.key;
      const a = access(key, uid);
      if (where.has(socket.id) && where.get(socket.id) !== key) drop(socket.id);
      let room = rooms.get(key);
      if (!room) { room = { viewers: new Map(), following: new Set(), session: null, ready: null, emit: { last: 0, timer: null } }; rooms.set(key, room); }
      if (!room.viewers.has(socket.id) && room.viewers.size >= MAX_VIEWERS) fail(429, 'Too many people are viewing this tab.');
      room.viewers.set(socket.id, uid);
      where.set(socket.id, key);
      // Opening the tab while people scroll together joins them (Leave scrolls on your own).
      if (room.session) room.following.add(uid);
      emit(key);
      return { ok: true, call: !!a.call, state: out(key, room) };
    }));
    socket.on('reels:leave', guard(() => { drop(socket.id); }));

    socket.on('reels:start', guard((p = {}) => {
      const { key, room } = mine(p);
      if (room.session) fail(409, 'People are already scrolling together here.');
      if (!isMessageOf(key, p.mid, uid)) fail(400, 'That isn’t a message here.');
      room.following = new Set(room.viewers.values());
      room.session = { by: uid, hostOnly: !!p.hostOnly, mid: p.mid, i: idx(p.i), playing: true, position: 0, updatedAt: Date.now(), startAt: 0, seq: 1, lastBy: uid, lastAction: 'start', dir: 0 };
      room.ready = null;
      emit(key);
      // People in this conversation's call who aren't on the tab: told it started, so they can come.
      const a = access(key, uid);
      const callRoom = a.call;
      if (callRoom && (callRoom.startsWith('dm:') || (voiceChannels.get(callRoom) && voiceChannels.get(callRoom).has(uid)))) {
        io.to(`voice:${callRoom}`).except([...room.viewers.keys()]).emit('reels:invite', { key, by: uid });
      }
      return { ok: true };
    }));
    socket.on('reels:follow', guard((p = {}) => {
      const { key, room } = session(p);
      if (p.on === false) room.following.delete(uid); else room.following.add(uid);
      if (!room.following.size) room.session = null;
      emit(key);
      return { ok: true };
    }));
    socket.on('reels:go', guard((p = {}) => {
      const { key, room } = control(p);
      if (!isMessageOf(key, p.mid, uid)) fail(400, 'That isn’t a message here.');
      const s = room.session;
      const i = idx(p.i);
      if (s.mid === p.mid && s.i === i) return { ok: true };
      Object.assign(s, { mid: p.mid, i, playing: true, position: 0, updatedAt: Date.now(), startAt: 0, dir: p.dir === -1 ? -1 : 1 });
      touch(s, uid, 'go');
      room.ready = null;
      emit(key);
      return { ok: true };
    }));
    // TikTok in step (play, pause, seek), and "start together" (play with a countdown) for an Instagram reel.
    socket.on('reels:control', guard((p = {}) => {
      const { key, room } = control(p);
      const s = room.session;
      if (p.mid !== s.mid || idx(p.i) !== s.i) return { ok: true }; // about a video they've moved on from
      const pos = Number.isFinite(+p.position) ? Math.min(24 * 3600, Math.max(0, +p.position)) : posOf(s);
      if (p.action === 'play') { s.playing = true; s.position = pos; s.startAt = p.together ? Date.now() + COUNTDOWN_MS : 0; }
      else if (p.action === 'pause') { s.playing = false; s.position = pos; s.startAt = 0; }
      else if (p.action === 'seek') { s.position = pos; if (!(s.startAt > Date.now())) s.startAt = 0; }
      else return { ok: true };
      s.updatedAt = s.startAt || Date.now();
      touch(s, uid, p.action);
      emit(key);
      return { ok: true };
    }));
    socket.on('reels:ready', guard((p = {}) => {
      const { key, room } = session(p);
      const s = room.session;
      if (p.mid !== s.mid || idx(p.i) !== s.i) return { ok: true };
      if (!room.ready || room.ready.mid !== s.mid || room.ready.i !== s.i) room.ready = { mid: s.mid, i: s.i, users: new Set() };
      if (p.ready === false) room.ready.users.delete(uid); else room.ready.users.add(uid);
      emit(key);
      return { ok: true };
    }));
    socket.on('reels:mode', guard((p = {}) => {
      const { key, room } = session(p);
      if (room.session.by !== uid && !isStaff(uid)) fail(403, 'Only the person who started it can change that.');
      room.session.hostOnly = !!p.hostOnly;
      touch(room.session, uid, 'mode');
      emit(key);
      return { ok: true };
    }));
    socket.on('reels:stop', guard((p = {}) => {
      const { key, room } = session(p);
      if (room.session.by !== uid && !isStaff(uid) && room.session.hostOnly) fail(403, 'Only the person who started it can stop it.');
      room.session = null; room.ready = null; room.following.clear();
      emit(key);
      return { ok: true };
    }));
    socket.on('disconnect', () => drop(socket.id));
  }
  const idx = (i) => (Number.isInteger(+i) && +i >= 0 && +i <= 3 ? +i : 0);

  // Tests: what's open.
  const stats = () => ({ rooms: rooms.size, sockets: where.size });
  return { attach, stats };
};
