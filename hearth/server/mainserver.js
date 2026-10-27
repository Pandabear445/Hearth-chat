// The instance's main server: one server the owner picks (Admin → Registration & Terms → Main server) that every new
// account joins at sign-up, so nobody starts out alone and there's one place everyone shares.
//
// Routes (the instance's owner only)
//   GET  /api/admin/main-server               which server it is, whether it's working, how many accounts aren't in it,
//                                             and the servers the owner could pick from the list (choices)
//   PUT  /api/admin/main-server               { invite } (a link or code to one of its invites) or { serverId } (a
//                                             server the owner manages there); null for either turns it off
//   POST /api/admin/main-server/add-everyone  { confirm: true }: also add the accounts that aren't in it yet, once per server
//
// Joining at sign-up is exactly an invite join (index.js addMember): the members' apps are told someone needs the
// server key and wrap it for them, the newcomer's history starts at sign-up when the server hides older messages, and
// a ban holds. People can leave it like any server; adding everyone later skips them (and anyone banned, bots, and
// deleted or suspended accounts). Picked by an invite, it works while that invite does: once the server's moderators
// revoke it, or it expires, sign-ups stop joining. Auto-joins don't count as its uses, so only an invite with no use
// limit can be picked (a limit the moderators set would mean nothing otherwise); one that has a limit stops working.
// Picked from the list, it works while the owner is still in it with Manage Server and isn't banned from it.
// Either way the server's own audit log says the instance's owner made it the main server (and when that stopped),
// so its moderators can see why new people arrive, and revoke the invite or take the permission away.
// Nothing here ever stops a sign-up: a main server that's gone, or any error, just means no auto-join.
//
// Encryption: everyone it adds is handed the server key by the members' apps, like anyone joining with an invite. So
// the owner can't use this to get into a server nobody let them in to: picking it takes one of its invites (someone
// with Create Invite there made it, and its moderators can revoke it), or being in it with Manage Server. A list of
// every server on the instance isn't enough.
const CODE = /(?:invite\/)?([A-Za-z0-9]{6,16})\/?$/;

module.exports = function setupMainServer(ctx) {
  const { api, auth, ownerOnly, db, fail, wrap, rateLimit, now, getSetting, setSetting, auditLog, bannedFrom, addMember, insertMember, announceMember, joinedPayload,
    emitKeyState, stillSuspended, connected, log, canManageServer, serverAudit = () => {} } = ctx;

  const read = (k) => { try { return JSON.parse(getSetting(k) || 'null'); } catch { return null; } };
  const serverRow = (id) => db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  // An invite that can be the main server's: one that still works (like validInvite in index.js) and has no use limit.
  // Returns why not, or null.
  const inviteProblem = (inv) => {
    if (!inv) return 'gone';
    if (inv.expires_at && inv.expires_at < now()) return 'expired';
    if (inv.max_uses && inv.uses >= inv.max_uses) return 'used_up';
    if (inv.max_uses) return 'limited';
    return null;
  };
  // Where things stand. status: 'off' (none picked), 'on', 'server_gone' (deleted, or a group chat), 'invite_gone'
  // (revoked, expired, used up or limited), or 'not_allowed' (picked from the list, and whoever picked it isn't in it
  // with Manage Server any more, or is banned from it). Checked again every time, so it stops when that changes.
  function current() {
    const set = read('mainServer');
    if (!set || typeof set.serverId !== 'string') return { status: 'off' };
    const s = serverRow(set.serverId);
    if (!s || s.kind === 'group') return { status: 'server_gone', set };
    if (set.code) {
      const inv = db.prepare('SELECT * FROM invites WHERE code = ? AND server_id = ?').get(set.code, s.id);
      if (inviteProblem(inv)) return { status: 'invite_gone', set, server: s, invite: inv || null };
      return { status: 'on', set, server: s, invite: inv };
    }
    if (typeof set.by !== 'string' || bannedFrom(s.id, set.by) || !canManageServer(s, set.by)) return { status: 'not_allowed', set, server: s };
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

  // The servers the owner could pick from the list: ones they're in with Manage Server (not group chats).
  const choices = (uid) => db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM members m2 WHERE m2.server_id = s.id) AS n FROM servers s
      JOIN members m ON m.server_id = s.id AND m.user_id = ? WHERE s.kind != 'group' ORDER BY s.name COLLATE NOCASE LIMIT 500`).all(uid)
    .filter((s) => canManageServer(s, uid)).map((s) => ({ id: s.id, name: s.name, members: s.n }));

  // The entry in the chosen server's own audit log (server/serveraudit.js), so its moderators can see that the
  // instance's owner made it (or stopped it being) the main server, and with which invite. The code is shown whole
  // only to readers with Manage Server there, like every invite entry.
  const noteServer = (sid, actorId, on, code) => serverAudit(sid, actorId, 'main_server', code || null, { on, instanceOwner: true, invite: !!code || undefined });

  api.get('/admin/main-server', auth, ownerOnly, (req, res) => res.json({ ...state(), choices: choices(req.userId) }));

  api.put('/admin/main-server', auth, ownerOnly, (req, res) => {
    rateLimit('mainserver:' + req.userId, 30, 600000);
    const b = req.body || {};
    const was = read('mainServer');
    if (b.invite === null || b.invite === '' || b.serverId === null) {
      setSetting('mainServer', null);
      auditLog(req, 'main_server', null, 'off');
      if (was && typeof was.serverId === 'string') noteServer(was.serverId, req.userId, false, null);
      return res.json(state());
    }
    let s;
    let code = null;
    if (typeof b.invite === 'string') {
      const m = CODE.exec(b.invite.trim());
      const inv = m && db.prepare('SELECT * FROM invites WHERE code = ?').get(m[1]);
      const why = inviteProblem(inv);
      if (why === 'gone') fail(404, 'That invite does not exist on this Hearth.', 'bad_invite');
      if (why === 'expired') fail(410, 'That invite has expired. Make one that never expires.', 'bad_invite');
      if (why === 'used_up') fail(410, 'That invite has been used up. Use an invite with no use limit.', 'bad_invite');
      if (why === 'limited') fail(400, 'That invite can only be used a few times. Use an invite with no use limit.', 'bad_invite');
      s = serverRow(inv.server_id);
      code = inv.code;
    } else if (typeof b.serverId === 'string') {
      s = serverRow(b.serverId.slice(0, 64));
      if (!s) fail(404, 'That server does not exist.');
      if (s.kind !== 'group' && !canManageServer(s, req.userId)) fail(403, 'To pick a server from the list you need to be in it with Manage Server. Otherwise paste one of its invite links.', 'not_yours');
    } else fail(400, 'Paste an invite link to the server, or pick one.');
    if (!s || s.kind === 'group') fail(400, 'Pick a server, not a group chat.');
    setSetting('mainServer', JSON.stringify({ serverId: s.id, code, at: now(), by: req.userId }));
    // Not the invite code: every staff moderator reads this log, and the code would let them in.
    auditLog(req, 'main_server', s.id, `${s.name}${code ? ' (by invite)' : ''}`);
    if (was && typeof was.serverId === 'string' && was.serverId !== s.id) noteServer(was.serverId, req.userId, false, null);
    noteServer(s.id, req.userId, true, code);
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
    const ids = db.prepare(`SELECT u.id ${waitingSql}`).all(sid, sid, sid).map((u) => u.id);
    // Each one is looked at again as its batch is written: between batches someone may have deleted their account,
    // been suspended, been banned from the server or left it.
    const stillWaiting = db.prepare(`SELECT u.* ${waitingSql} AND u.id = ?`);
    const added = [];
    // Written in batches (a big instance doesn't hold the database for one long write), and only told to anyone once
    // each batch is committed. Between batches the server gets on with everything else.
    for (let i = 0; i < ids.length; i += 200) {
      // Stopped part-way (turned off, server deleted, or no longer allowed): what was added stays, the rest isn't.
      const live = i ? current() : c;
      if (live.status !== 'on' || live.server.id !== sid) break;
      const batch = [];
      db.transaction(() => {
        for (const id of ids.slice(i, i + 200)) {
          const u = stillWaiting.get(sid, sid, sid, id);
          if (u && !stillSuspended(u) && insertMember(sid, u.id)) batch.push(u.id);
        }
      })();
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
    serverAudit(sid, req.userId, 'main_server_add_everyone', null, { count: added.length, instanceOwner: true });
    res.json({ ...state(), added: added.length });
  }));

  return { onSignUp, current };
};
