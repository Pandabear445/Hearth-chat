// The instance's main server: one server the owner picks (Admin → Registration & Terms → Main server) that every new
// account joins at sign-up, so nobody starts out alone and there's one place everyone shares.
//
// Routes (the instance's owner only)
//   GET  /api/admin/main-server               which server it is, whether it's working, how many accounts aren't in it
//   PUT  /api/admin/main-server               { invite } (a link or code to one of its invites) or { serverId } (a
//                                             server the owner manages there); null for either turns it off
//   POST /api/admin/main-server/add-everyone  { confirm: true }: also add the accounts that aren't in it yet, once per server
//
// Joining at sign-up is exactly an invite join (index.js addMember): the members' apps are told someone needs the
// server key and wrap it for them, the newcomer's history starts at sign-up when the server hides older messages, and
// a ban holds. People can leave it like any server; adding everyone later skips them (and anyone banned, bots, and
// deleted or suspended accounts). Picked by an invite, it works while that invite does: once the server's moderators
// revoke it, or it expires, sign-ups stop joining (it isn't used up, though: auto-joins don't count as its uses).
// Nothing here ever stops a sign-up: a main server that's gone, or any error, just means no auto-join.
//
// Encryption: everyone it adds is handed the server key by the members' apps, like anyone joining with an invite. So
// the owner can't use this to get into a server nobody let them in to: picking it takes one of its invites (someone
// with Create Invite there made it, and its moderators can revoke it), or being in it with Manage Server. A list of
// every server on the instance isn't enough.
const CODE = /(?:invite\/)?([A-Za-z0-9]{6,16})\/?$/;

module.exports = function setupMainServer(ctx) {
  const { api, auth, ownerOnly, db, fail, wrap, rateLimit, now, getSetting, setSetting, auditLog, bannedFrom, addMember, insertMember, announceMember, joinedPayload,
    emitKeyState, stillSuspended, connected, log, canManageServer } = ctx;

  const read = (k) => { try { return JSON.parse(getSetting(k) || 'null'); } catch { return null; } };
  const serverRow = (id) => db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  // Where things stand. status: 'off' (none picked), 'on', 'server_gone' (deleted, or a group chat), or 'invite_gone'.
  function current() {
    const set = read('mainServer');
    if (!set || typeof set.serverId !== 'string') return { status: 'off' };
    const s = serverRow(set.serverId);
    if (!s || s.kind === 'group') return { status: 'server_gone', set };
    if (set.code) {
      const inv = db.prepare('SELECT * FROM invites WHERE code = ? AND server_id = ?').get(set.code, s.id);
      if (!inv || (inv.expires_at && inv.expires_at < now())) return { status: 'invite_gone', set, server: s };
      return { status: 'on', set, server: s, invite: inv };
    }
    return { status: 'on', set, server: s };
  }
  // Who adding everyone would add: real accounts that aren't in it, weren't in it before (they left, or were kicked),
  // and aren't banned from it. Suspended ones are left out when it runs.
  const waitingSql = `FROM users u WHERE u.is_bot = 0 AND u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM members m WHERE m.server_id = ? AND m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM former_members f WHERE f.server_id = ? AND f.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.server_id = ? AND b.user_id = u.id)`;
  function state() {
    const c = current();
    const out = { status: c.status, server: null, invite: null, waiting: 0, addedEveryone: null };
    if (c.server) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM members WHERE server_id = ?').get(c.server.id).n;
      out.server = { id: c.server.id, name: c.server.name, icon: c.server.icon, memberCount: n };
      if (c.status === 'on') out.waiting = db.prepare(`SELECT COUNT(*) AS n ${waitingSql}`).get(c.server.id, c.server.id, c.server.id).n;
      const done = backfilled()[c.server.id];
      if (done) out.addedEveryone = { at: done.at, added: done.added };
    }
    if (c.set && c.set.code) out.invite = { code: c.set.code, expiresAt: c.invite ? c.invite.expires_at : null };
    return out;
  }

  // Servers everyone was already added to, by id: { at, added } (each only once, whatever was picked in between).
  const backfilled = () => { const v = read('mainServerBackfill'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  const tick = () => new Promise((r) => setImmediate(r));

  // Called once an account exists (POST /auth/register). Never throws.
  function onSignUp(userId) {
    try {
      const c = current();
      if (c.status !== 'on' || bannedFrom(c.server.id, userId)) return;
      // The new account has no app open yet: it gets the server when it starts. The members' apps hear now.
      if (addMember(c.server.id, userId)) emitKeyState(c.server.id);
    } catch (e) {
      log.warn('main_server', 'join_failed', { msg: `Couldn't add a new account to the main server: ${e.message}` });
    }
  }

  api.get('/admin/main-server', auth, ownerOnly, (req, res) => res.json(state()));

  api.put('/admin/main-server', auth, ownerOnly, (req, res) => {
    rateLimit('mainserver:' + req.userId, 30, 600000);
    const b = req.body || {};
    if (b.invite === null || b.invite === '' || b.serverId === null) {
      setSetting('mainServer', null);
      auditLog(req, 'main_server', null, 'off');
      return res.json(state());
    }
    let s;
    let code = null;
    if (typeof b.invite === 'string') {
      const m = CODE.exec(b.invite.trim());
      const inv = m && db.prepare('SELECT * FROM invites WHERE code = ?').get(m[1]);
      if (!inv) fail(404, 'That invite does not exist on this Hearth.', 'bad_invite');
      if (inv.expires_at && inv.expires_at < now()) fail(410, 'That invite has expired. Make one that never expires.', 'bad_invite');
      s = serverRow(inv.server_id);
      code = inv.code;
    } else if (typeof b.serverId === 'string') {
      s = serverRow(b.serverId.slice(0, 64));
      if (!s) fail(404, 'That server does not exist.');
      if (s.kind !== 'group' && !canManageServer(s, req.userId)) fail(403, 'To pick a server from the list you need to be in it with Manage Server. Otherwise paste one of its invite links.', 'not_yours');
    } else fail(400, 'Paste an invite link to the server, or pick one.');
    if (!s || s.kind === 'group') fail(400, 'Pick a server, not a group chat.');
    setSetting('mainServer', JSON.stringify({ serverId: s.id, code, at: now(), by: req.userId }));
    auditLog(req, 'main_server', s.id, `${s.name}${code ? ` (invite ${code})` : ''}`);
    res.json(state());
  });

  api.post('/admin/main-server/add-everyone', auth, ownerOnly, wrap(async (req, res) => {
    rateLimit('mainserverall:' + req.userId, 5, 3600000);
    if ((req.body || {}).confirm !== true) fail(400, 'Confirm that everyone should be added.', 'confirm');
    const c = current();
    if (c.status !== 'on') fail(409, 'Pick a main server that works first.', 'not_on');
    const sid = c.server.id;
    const done = backfilled();
    if (done[sid]) fail(409, 'Everyone was already added to this server once.', 'already_done');
    // Marked before anything is added, so two requests at once can't both run it.
    done[sid] = { at: now(), added: 0, by: req.userId };
    setSetting('mainServerBackfill', JSON.stringify(done));
    const rows = db.prepare(`SELECT u.* ${waitingSql}`).all(sid, sid, sid).filter((u) => !stillSuspended(u));
    const added = [];
    // Written in batches (a big instance doesn't hold the database for one long write), and only told to anyone once
    // each batch is committed. Between batches the server gets on with everything else.
    for (let i = 0; i < rows.length; i += 200) {
      const batch = [];
      db.transaction(() => { for (const u of rows.slice(i, i + 200)) if (!bannedFrom(sid, u.id) && insertMember(sid, u.id)) batch.push(u.id); })();
      for (const uid of batch) announceMember(sid, uid);
      added.push(...batch);
      await tick();
    }
    const all = backfilled();
    all[sid] = { at: now(), added: added.length, by: req.userId };
    setSetting('mainServerBackfill', JSON.stringify(all));
    // Apps that are open get the server now (the rest get it when they start); then the members' apps hear who
    // needs the key, once for all of them.
    let n = 0;
    for (const uid of added) {
      if (!connected(uid)) continue;
      joinedPayload(sid, uid, false);
      if (++n % 50 === 0) await tick();
    }
    if (added.length) emitKeyState(sid);
    auditLog(req, 'main_server_add_everyone', sid, `${c.server.name}: ${added.length} added`);
    res.json({ ...state(), added: added.length });
  }));

  return { onSignUp, current };
};
