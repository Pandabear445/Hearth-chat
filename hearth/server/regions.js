// Regions: small, cheap servers in other parts of the world that relay calls for people near them.
//
// Chat itself stays on this one server (one database = no syncing, no split-brain; a message crossing the
// world takes ~0.2 s, which nobody notices). What distance hurts is calls that can't connect directly and
// need a relay, so those relays go near people.
//
// How the linking works:
//   1. Admin → Regions → "Add a region" gives a one-line install command for a fresh VPS.
//   2. That command installs the relay (coturn) with this server's shared secret, plus a tiny agent that
//      checks in here every minute with its address, load and traffic.
//   3. Calls automatically include every region that checked in recently; each person's app measures which
//      relays answer fastest from where they are and uses those.
//   4. A region that stops checking in is dropped from calls after 3 minutes and comes back by itself.
//
// Member relays (Settings → Help host): any member can offer a Linux machine of their own the same way. It's
// someone else's machine, so it's treated as an untrusted party: it gets a TURN secret of its own (never the main
// one, which mints logins for the main relay and every region), nothing uses it until the owner approves it, it
// gets backup copies only if both the member and the owner agree, and a member only ever sees their own relays.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { execFile, execFileSync } = require('child_process');

module.exports = function setupRegions(ctx) {
  const { api, app, auth, db, fail, wrap, rateLimit, getSetting, setSetting, requireInstanceAdmin, newId, DATA_DIR, ROOT, stepUp, auditLog, sealSecret, openSecret, getIo } = ctx;
  const now = () => Date.now();
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const ALIVE_MS = 3 * 60000;
  const INSTALL_MS = 24 * 3600000; // how long an install command works

  // The owner's own regions. Member relays are listed, counted and used apart from them.
  const rows = () => db.prepare("SELECT * FROM regions WHERE kind = 'region' ORDER BY created_at").all();
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const isAlive = (r) => r.last_seen && now() - r.last_seen < ALIVE_MS;
  // TURN addresses of the regions that are up right now: [{ id, name, urls }]
  const liveRelays = () => rows().filter((r) => isAlive(r)).map((r) => ({ id: r.id, name: r.name, urls: parse(r.turn_urls, []) })).filter((r) => r.urls.length);

  const ensureSecret = () => {
    let s = getSetting('turnSecret') || process.env.TURN_SECRET || '';
    if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('turnSecret', s); }
    return s;
  };

  // ------------------------------------------------------------------ member relays: the rules
  const MEMBER_MAX = 2; // each member
  const MEMBER_TOTAL = 40; // on this server
  const MEMBER_KEEP = 3; // backup copies a member relay keeps (it's someone's own disk)
  const CAPS = [10, 25, 50, 100, 0]; // the bandwidth limits a member can pick, in Mbit/s (0 = no limit)
  const membersOn = () => getSetting('memberRelays') !== 'off';
  const isMemberRow = (r) => !!r && r.kind === 'member';
  // What the member chose when offering it. Fixed from then on: the installer is made from it.
  const offerOf = (r) => { const o = parse(r.offer, {}) || {}; return { capMbit: CAPS.includes(o.capMbit) ? o.capMbit : 25, backups: o.backups === true }; };
  // A member's relay is used only while the member can use this server: not deleted (their relays go with the
  // account anyway) and not suspended. Read like index.js reads a suspension: a timed one that has run out is over.
  // (Suspending doesn't delete anything, so lifting it brings their relays back.)
  const ACTIVE_MEMBER = 'u.id IS NOT NULL AND u.deleted_at IS NULL AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until <= ?))';
  const memberActive = (r) => !!db.prepare(`SELECT 1 FROM users u WHERE u.id = ? AND ${ACTIVE_MEMBER}`).get(r.owner_id, now());
  // Whether a relay may hold copies of the encrypted backups: the owner's regions as always; a member relay only
  // while it's approved, the member offered the space, the owner said yes to it, and the member is active.
  const mayGetCopies = (r) => (isMemberRow(r) ? r.status === 'approved' && r.backups === 1 && offerOf(r).backups && memberActive(r) : r.backups !== 0);
  // The approved member relays that are up, for everyone's calls: [{ id, name, urls, secret }] (secret = its own TURN
  // secret, for index.js to make each person's logins with).
  const memberRelays = () => db.prepare(`SELECT r.* FROM regions r LEFT JOIN users u ON u.id = r.owner_id
    WHERE r.kind = 'member' AND r.status = 'approved' AND r.last_seen > ? AND ${ACTIVE_MEMBER} ORDER BY r.created_at`).all(now() - ALIVE_MS, now())
    .map((r) => ({ id: r.id, name: r.name, urls: parse(r.turn_urls, []), secret: openSecret(r.secret) })).filter((r) => r.urls.length && r.secret);
  // An offer whose machine never checked in and whose install link has run out was never installed: it goes, so it
  // doesn't hold one of the member's (or the server's) places.
  const sweepMembers = () => db.prepare("DELETE FROM regions WHERE kind = 'member' AND last_seen IS NULL AND COALESCE(setup_until, 0) < ?").run(now());
  // The member's Settings → Help host page refreshes on this (it fetches GET /me/relays again).
  const tell = (ownerId) => { const io = getIo && getIo(); if (io && ownerId) io.to(`user:${ownerId}`).emit('relays:mine'); };
  const byId = (id) => db.prepare('SELECT * FROM regions WHERE id = ?').get(String(id));
  // A member names their relay, and the name reaches the owner and everyone whose calls use it (call diagnostics), so
  // like a nickname: line breaks and control characters become spaces, and invisible and direction-changing ones go
  // (they could make it pass for another name, or break the line it's on), except the joiners and variation
  // selectors emoji need.
  const cleanName = (v) => String(v || '').slice(0, 400).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, (c) => (/^[\u200c\u200d\ufe00-\ufe0f]$/.test(c) ? c : '')).replace(/\s+/g, ' ').trim().slice(0, 40).trim();

  // The public key of this server's own self-signed certificate, so the install command can pin it
  // (curl then talks only to this exact server, even without a trusted certificate).
  function pinnedKey() {
    try {
      const pem = fs.readFileSync(path.join(DATA_DIR, 'cert.pem'), 'utf8');
      const der = new crypto.X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
      return 'sha256//' + crypto.createHash('sha256').update(der).digest('base64');
    } catch { return ''; }
  }
  // Pin only when this server answers with its own self-signed certificate (no domain / Caddy in front).
  const pinFor = (origin) => (origin.startsWith('https:') && process.env.HTTPS !== 'false' ? pinnedKey() : '');
  // Where a new region downloads its installer (which runs as root and carries the relay secret) and checks in:
  // https only. Plain http only for this machine itself (localhost, 127.x.x.x, [::1]): a browser treats that as
  // secure, and a command made from it can't reach anything from another machine.
  const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
  const cleanOrigin = (o) => {
    try {
      const u = new URL(String(o));
      return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname)) ? u.origin : '';
    } catch { return ''; }
  };
  const originFrom = (o, word = 'region') => {
    const origin = cleanOrigin(o);
    if (!origin) fail(400, o ? `Open Hearth over https to make an install command: the new ${word} downloads its installer, which runs as root and carries the relay secret, from this address.` : 'Missing this server\u2019s address.');
    return origin;
  };

  function regionOut(r) {
    const st = parse(r.stats, {});
    return {
      id: r.id, name: r.name, ip: r.ip || null, urls: parse(r.turn_urls, []), alive: !!isAlive(r), lastSeen: r.last_seen || null, createdAt: r.created_at,
      waitingForInstall: !r.last_seen, installOpen: (r.setup_until || 0) > now(),
      load: st.load ?? null, cpus: st.cpus ?? null, mem: st.mem ?? null, mbps: st.mbps ?? null, monthGb: st.monthGb ?? null, month: st.month || null, relayUp: st.relay !== false, version: st.version || null,
      backup: st.backup ? { ready: !!st.backup.ready, files: st.backup.files, usedMb: st.backup.usedMb, freeMb: st.backup.freeMb, last: st.backup.last || null } : null,
    };
  }
  // A member relay as Admin → Regions shows it (r has owner_name from a join with users).
  function memberOut(r) {
    const o = offerOf(r);
    return { ...regionOut(r), owner: { id: r.owner_id, username: r.owner_name || null }, status: r.status, capMbit: o.capMbit, offersBackups: o.backups, backups: r.backups === 1, approvedAt: r.approved_at || null };
  }
  // A member relay as its own member sees it: how it's doing, never anyone else's address and no secrets.
  function mineOut(r) {
    const st = parse(r.stats, {});
    const o = offerOf(r);
    return {
      id: r.id, name: r.name, status: r.status, alive: !!isAlive(r), waitingForInstall: !r.last_seen, installOpen: (r.setup_until || 0) > now(), lastSeen: r.last_seen || null, createdAt: r.created_at,
      capMbit: o.capMbit, offersBackups: o.backups, backups: r.backups === 1, monthGb: st.monthGb ?? null, mbps: st.mbps ?? null, relayUp: st.relay !== false,
      backup: st.backup ? { ready: !!st.backup.ready, files: st.backup.files ?? 0, usedMb: st.backup.usedMb ?? 0, freeMb: st.backup.freeMb ?? 0 } : null,
    };
  }

  // ------------------------------------------------------------------ admin
  api.get('/admin/regions', auth, (req, res) => {
    requireInstanceAdmin(req.userId);
    sweepMembers();
    const members = db.prepare(`SELECT r.*, u.username AS owner_name FROM regions r LEFT JOIN users u ON u.id = r.owner_id WHERE r.kind = 'member'
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at`).all().map(memberOut);
    res.json({ regions: rows().map(regionOut), members, memberRelays: membersOn() ? 'on' : 'off', mainTurn: String(getSetting('turnUrls') || process.env.TURN_URL || '').split(',').filter(Boolean), secretSet: !!(getSetting('turnSecret') || process.env.TURN_SECRET) });
  });
  // The install command downloads the installer to a private file, checks it against the SHA-256 it carries (of
  // exactly what /regions/install/:id will send for this token) and only then runs it: nothing runs that changed on
  // the way, or that arrived only in part. (Plain `curl | bash` would start running a cut-off download.)
  const installCommand = (origin, r, token) => {
    const pin = pinFor(origin);
    const sum = sha(installScript(origin, r, token));
    const fetchOpts = `${origin.startsWith('https:') ? " --proto '=https'" : ''}${pin ? ` -k --pinnedpubkey '${pin}'` : ''}`;
    return `f="$(mktemp)" && curl -fsSL${fetchOpts} -o "$f" '${origin}/regions/install/${r.id}?k=${token}' && echo '${sum}  '"$f" | sha256sum -c - && sudo bash "$f"; rm -f "$f"`;
  };
  // An install command hands the machine it runs on this server's relay secret, and a linked region becomes a
  // relay for everyone's calls and a place every backup is copied to. So making one needs the password again
  // (like seeing the backup key), and adding, reinstalling, renaming or removing a region is always logged.
  api.post('/admin/regions', auth, wrap(async (req, res) => {
    requireInstanceAdmin(req.userId);
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) fail(400, 'Give the region a name, like "Frankfurt" or "US West".');
    if (rows().length >= 12) fail(400, 'Up to 12 regions.');
    const origin = originFrom(b.origin);
    // (After the checks above, so a request that can't go through doesn't use up a two-factor code.)
    await stepUp(req, req.body);
    if (rows().length >= 12) fail(400, 'Up to 12 regions.'); // (again: the password check took a moment)
    ensureSecret();
    const id = newId(); const token = crypto.randomBytes(24).toString('hex');
    // Remember the address the admin uses: that's the one the region must check in at (behind a proxy, this
    // server can't always tell its own public https:// address).
    db.prepare('INSERT INTO regions (id, name, token_hash, setup_until, stats, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, sha(token), now() + INSTALL_MS, JSON.stringify({ origin }), now());
    auditLog(req, 'region_added', id, `${name} (${origin})`);
    const r = byId(id);
    res.json({ region: regionOut(r), command: installCommand(origin, r, token) });
  }));
  // A new install command for an existing region (new token; the old one stops working). Only the owner's own: a
  // member relay's command carries that member's relay, and only its member makes one (POST /me/relays/:id/reinstall).
  api.post('/admin/regions/:id/reinstall', auth, wrap(async (req, res) => {
    requireInstanceAdmin(req.userId);
    if (!db.prepare("SELECT 1 FROM regions WHERE id = ? AND kind = 'region'").get(req.params.id)) fail(404, 'No such region.');
    const origin = originFrom((req.body || {}).origin);
    await stepUp(req, req.body); // (after the checks above, so they don't use up a two-factor code)
    const r = db.prepare("SELECT * FROM regions WHERE id = ? AND kind = 'region'").get(req.params.id);
    if (!r) fail(404, 'No such region.');
    ensureSecret();
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE regions SET token_hash = ?, setup_until = ?, stats = ? WHERE id = ?').run(sha(token), now() + INSTALL_MS, JSON.stringify({ ...parse(r.stats, {}), origin }), r.id);
    auditLog(req, 'region_reinstalled', r.id, `${r.name} (${origin})`);
    res.json({ command: installCommand(origin, byId(r.id), token) });
  }));
  // Renaming and removing work on both kinds. Removing a member relay drops it from calls and backups at once; its
  // machine is told no at its next check-in, and switches itself off after a day of that (see the agent below).
  api.patch('/admin/regions/:id', auth, (req, res) => {
    requireInstanceAdmin(req.userId);
    const name = cleanName((req.body || {}).name);
    if (!name) fail(400, 'Name required.');
    const r = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
    if (!r) fail(404, 'No such region.');
    db.prepare('UPDATE regions SET name = ? WHERE id = ?').run(name, r.id);
    auditLog(req, isMemberRow(r) ? 'member_relay_renamed' : 'region_renamed', r.id, `${r.name} \u2192 ${name}`);
    if (isMemberRow(r)) tell(r.owner_id);
    res.json({ ok: true });
  });
  api.delete('/admin/regions/:id', auth, (req, res) => {
    requireInstanceAdmin(req.userId);
    const r = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
    if (!r) fail(404, 'No such region.');
    db.prepare('DELETE FROM regions WHERE id = ?').run(r.id);
    auditLog(req, isMemberRow(r) ? 'member_relay_removed' : 'region_deleted', r.id, `${r.name}${r.ip ? ` (${r.ip})` : ''}`);
    if (isMemberRow(r)) tell(r.owner_id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ admin: member relays
  const memberRow = (id) => {
    const r = db.prepare("SELECT r.*, u.username AS owner_name FROM regions r LEFT JOIN users u ON u.id = r.owner_id WHERE r.id = ? AND r.kind = 'member'").get(String(id));
    if (!r) fail(404, 'No such member relay.');
    return r;
  };
  const memberLabel = (r) => `${r.name} by ${r.owner_name || r.owner_id}${r.ip ? ` (${r.ip})` : ''}`;
  // Approving puts a member's machine in everyone's calls (and, if chosen, among the places every backup goes), so it
  // needs the password again, like adding a region. Backup copies only if the member offered the space and the owner
  // says yes here: they're locked with the backup key, but whoever someday got that key could open one.
  api.post('/admin/regions/:id/approve', auth, wrap(async (req, res) => {
    requireInstanceAdmin(req.userId);
    memberRow(req.params.id);
    await stepUp(req, req.body); // (after the check above, so it doesn't use up a two-factor code)
    const r = memberRow(req.params.id);
    const backups = offerOf(r).backups && (req.body || {}).backups === true ? 1 : 0;
    db.prepare("UPDATE regions SET status = 'approved', backups = ?, approved_at = ?, approved_by = ? WHERE id = ?").run(backups, now(), req.userId, r.id);
    auditLog(req, 'member_relay_approved', r.id, `${memberLabel(r)}${backups ? ', with backup copies' : ''}`);
    tell(r.owner_id);
    res.json({ ok: true });
  }));
  // Pausing only takes something away, so it needs no password; resuming puts the machine back in everyone's calls.
  api.post('/admin/regions/:id/pause', auth, (req, res) => {
    requireInstanceAdmin(req.userId);
    const r = memberRow(req.params.id);
    if (r.status === 'pending') fail(400, 'It isn\u2019t approved yet, so there\u2019s nothing to pause.');
    db.prepare("UPDATE regions SET status = 'paused' WHERE id = ?").run(r.id);
    auditLog(req, 'member_relay_paused', r.id, memberLabel(r));
    tell(r.owner_id);
    res.json({ ok: true });
  });
  api.post('/admin/regions/:id/resume', auth, wrap(async (req, res) => {
    requireInstanceAdmin(req.userId);
    if (memberRow(req.params.id).status === 'pending') fail(400, 'Approve it first.');
    await stepUp(req, req.body);
    const r = memberRow(req.params.id);
    if (r.status === 'pending') fail(400, 'Approve it first.');
    db.prepare("UPDATE regions SET status = 'approved' WHERE id = ?").run(r.id);
    auditLog(req, 'member_relay_resumed', r.id, memberLabel(r));
    tell(r.owner_id);
    res.json({ ok: true });
  }));
  api.post('/admin/regions/:id/backups', auth, wrap(async (req, res) => {
    requireInstanceAdmin(req.userId);
    const on = (req.body || {}).on === true;
    if (!offerOf(memberRow(req.params.id)).backups) fail(400, 'Its member didn\u2019t offer backup space on this relay.');
    if (on) await stepUp(req, req.body);
    const r = memberRow(req.params.id);
    db.prepare('UPDATE regions SET backups = ? WHERE id = ?').run(on ? 1 : 0, r.id);
    auditLog(req, on ? 'member_relay_backups_on' : 'member_relay_backups_off', r.id, memberLabel(r));
    tell(r.owner_id);
    res.json({ ok: true });
  }));
  // Turning member relays off stops new offers. The ones already approved keep their status (pause or remove those).
  api.patch('/admin/member-relays', auth, (req, res) => {
    requireInstanceAdmin(req.userId);
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') fail(400, 'Say whether members may offer relays (enabled: true or false).');
    setSetting('memberRelays', enabled ? 'on' : 'off');
    auditLog(req, enabled ? 'member_relays_on' : 'member_relays_off', null, '');
    res.json({ ok: true, memberRelays: enabled ? 'on' : 'off' });
  });

  // ------------------------------------------------------------------ members: Settings → Help host
  // Signed in and not suspended (auth turns a suspended account away). A member only ever sees and changes their
  // own relays: anyone else's id is "not found".
  const own = (req) => {
    const r = db.prepare("SELECT * FROM regions WHERE id = ? AND kind = 'member' AND owner_id = ?").get(String(req.params.id), req.userId);
    if (!r) fail(404, 'No such relay.');
    return r;
  };
  api.get('/me/relays', auth, (req, res) => {
    rateLimit('myrelays:' + req.userId, 120, 60000);
    sweepMembers();
    res.json({ enabled: membersOn(), max: MEMBER_MAX, relays: db.prepare("SELECT * FROM regions WHERE kind = 'member' AND owner_id = ? ORDER BY created_at").all(req.userId).map(mineOut) });
  });
  // An offer: the member's choices are fixed into the row (the installer is made from them), with a TURN secret of its
  // own. Nothing uses it until the owner approves it.
  api.post('/me/relays', auth, (req, res) => {
    rateLimit('relayoffer:' + req.userId, 10, 3600000);
    if (!membersOn()) fail(403, 'The owner has turned off member relays.');
    const b = req.body || {};
    const name = cleanName(b.name);
    if (!name) fail(400, 'Give your relay a name, like "Maya\u2019s Pi, Chicago".');
    const capMbit = typeof b.capMbit === 'number' || (typeof b.capMbit === 'string' && /^\d{1,3}$/.test(b.capMbit)) ? Number(b.capMbit) : NaN;
    if (!CAPS.includes(capMbit)) fail(400, 'Pick a bandwidth limit: 10, 25, 50 or 100 Mbit/s, or no limit.');
    const backups = b.backups === true;
    const origin = originFrom(b.origin, 'relay');
    sweepMembers();
    if (db.prepare("SELECT COUNT(*) AS n FROM regions WHERE kind = 'member' AND owner_id = ?").get(req.userId).n >= MEMBER_MAX) fail(400, `You can offer up to ${MEMBER_MAX} relays. Remove one first.`);
    if (db.prepare("SELECT COUNT(*) AS n FROM regions WHERE kind = 'member'").get().n >= MEMBER_TOTAL) fail(400, `This server already has ${MEMBER_TOTAL} member relays, as many as it takes.`);
    const id = newId(); const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO regions (id, name, token_hash, setup_until, stats, created_at, kind, owner_id, status, secret, offer, backups)
      VALUES (?, ?, ?, ?, ?, ?, 'member', ?, 'pending', ?, ?, 0)`)
      .run(id, name, sha(token), now() + INSTALL_MS, JSON.stringify({ origin }), now(), req.userId, sealSecret(crypto.randomBytes(32).toString('hex')), JSON.stringify({ capMbit, backups }));
    auditLog(req, 'member_relay_offered', id, `${name} (${origin})`);
    const r = byId(id);
    tell(req.userId);
    res.json({ relay: mineOut(r), command: installCommand(origin, r, token) });
  });
  // A new install command (new token, for 24 hours; the old one stops working), e.g. for a rebuilt machine.
  api.post('/me/relays/:id/reinstall', auth, (req, res) => {
    rateLimit('relayreinstall:' + req.userId, 20, 3600000);
    const r = own(req);
    const origin = originFrom((req.body || {}).origin, 'relay');
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE regions SET token_hash = ?, setup_until = ?, stats = ? WHERE id = ?').run(sha(token), now() + INSTALL_MS, JSON.stringify({ ...parse(r.stats, {}), origin }), r.id);
    auditLog(req, 'member_relay_reinstalled', r.id, `${r.name} (${origin})`);
    tell(req.userId);
    res.json({ command: installCommand(origin, byId(r.id), token) });
  });
  api.delete('/me/relays/:id', auth, (req, res) => {
    rateLimit('relayremove:' + req.userId, 30, 3600000);
    const r = own(req);
    db.prepare('DELETE FROM regions WHERE id = ?').run(r.id);
    auditLog(req, 'member_relay_removed', r.id, `${r.name}${r.ip ? ` (${r.ip})` : ''}`);
    tell(req.userId);
    res.json({ ok: true, uninstall: 'sudo hearth-relay-uninstall' });
  });

  // ------------------------------------------------------------------ the install script a new region downloads
  const checkToken = (r, token) => r && token && r.token_hash.length === 64 && crypto.timingSafeEqual(Buffer.from(sha(token)), Buffer.from(r.token_hash));
  app.get('/regions/install/:id', (req, res) => {
    rateLimit('regioninstall:' + req.ip, 20, 3600000);
    const r = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
    const token = String(req.query.k || '');
    const where = isMemberRow(r) ? 'Settings → Help host' : 'Admin → Regions';
    res.type('text/plain');
    if (!checkToken(r, token) || (r.setup_until || 0) < now()) return res.status(403).send(`echo "This install link has expired or was replaced. Make a new one in Hearth: ${where}." >&2; exit 1\n`);
    const origin = cleanOrigin(parse(r.stats, {}).origin) || cleanOrigin(`${req.protocol}://${req.get('host')}`);
    if (!origin) return res.status(403).send(`echo "This install link isn't on an https:// address. Make a new one in Hearth, opened over https: ${where}." >&2; exit 1\n`);
    res.send(installScript(origin, r, token));
  });
  // The installer itself. Everything in it is settled when the install command is made (the command carries its
  // SHA-256), so it must come out byte for byte the same when it's downloaded: nothing in it may change in between
  // (the region's name, which can, isn't in it). A member relay's comes from its row too: its own secret, and the
  // bandwidth limit and backup choice fixed when it was offered.
  function installScript(origin, r, token) {
    const turnScript = fs.readFileSync(path.join(ROOT, 'scripts', 'setup-turn.sh'), 'utf8');
    const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    const member = isMemberRow(r);
    const offer = member ? offerOf(r) : null;
    const backups = !member || offer.backups;
    const word = member ? 'relay' : 'region';
    return `#!/usr/bin/env bash
${member ? `# Hearth member relay: installs a call relay on this machine and offers it to ${origin}` : `# Hearth region: installs a call relay and links it to ${origin}`}
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this as root (or with sudo)." >&2; exit 1; }
MAIN=${q(origin)}
REGION=${q(r.id)}
TOKEN=${q(token)}
PIN=${q(pinFor(origin))}
KIND=${q(member ? 'member' : 'region')}

# Whether coturn was already here: hearth-relay-uninstall removes it again only if this install added it.
install -d -m 700 /etc/hearth-region
[ "$(dpkg-query -W -f='\${Status}' coturn 2>/dev/null || true)" = "install ok installed" ] || touch /etc/hearth-region/coturn-by-hearth

# A private folder (mktemp: only root can read or write it), not a fixed name in /tmp that another account
# could create first and swap the script in before root runs it.
SETUP_DIR="$(mktemp -d)"
trap 'rm -rf "$SETUP_DIR"' EXIT
cat > "$SETUP_DIR/setup-turn.sh" <<'HEARTH_TURN_EOF'
${turnScript}
HEARTH_TURN_EOF
# The relay secret reaches setup-turn.sh in a file only root can read, never on a command line (ps shows those to
# every account). printf is the shell's own, so the secret isn't another program's argument either.${member ? `
# It's this relay's own secret, not the main server's: logins made with it work on this relay only.` : ''}
( umask 077 && printf '%s\\n' ${q(member ? openSecret(r.secret) : ensureSecret())} > "$SETUP_DIR/turn-secret" )
${member ? `# The bandwidth limit chosen when this relay was offered, for all calls together (0 = no limit).
export TURN_CAPACITY_MBIT=${offer.capMbit}
` : ''}bash "$SETUP_DIR/setup-turn.sh" --relay-only --managed --secret-file "$SETUP_DIR/turn-secret"
rm -rf "$SETUP_DIR"
${backups ? `
# Off-site backups: an upload-only SFTP account that can write into one folder and nothing else. The main
# server copies its encrypted backups here (useless without the backup key, which never leaves it).
echo "▸ Making a safe place for your main server's encrypted backups…"
if command -v sshd >/dev/null 2>&1 && [ -f /etc/ssh/sshd_config ] && [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
  id hearth-backup >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hearth-backup --no-create-home --shell /usr/sbin/nologin hearth-backup
  install -d -m 755 -o root -g root /var/lib/hearth-backup
  install -d -m 700 -o hearth-backup -g hearth-backup /var/lib/hearth-backup/backups
  install -d -m 700 /etc/hearth-region
  touch /etc/ssh/hearth-backup.keys && chmod 644 /etc/ssh/hearth-backup.keys
  cp /etc/ssh/sshd_config /etc/ssh/sshd_config.hearth-bak
  sed -i '/^# BEGIN hearth-backup/,/^# END hearth-backup/d' /etc/ssh/sshd_config
  cat >> /etc/ssh/sshd_config <<'SSHD_EOF'
# BEGIN hearth-backup (added by Hearth: an upload-only account for your main server's encrypted backups)
Match User hearth-backup
  AuthorizedKeysFile /etc/ssh/hearth-backup.keys
  ForceCommand internal-sftp -d /backups
  ChrootDirectory /var/lib/hearth-backup
  PasswordAuthentication no
  AllowTcpForwarding no
  AllowAgentForwarding no
  X11Forwarding no
  PermitTTY no
# END hearth-backup
SSHD_EOF
  install -d -m 755 /run/sshd 2>/dev/null || true # sshd's own folder; its config check fails without it
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    touch /etc/hearth-region/backup-ready
  else
    cp /etc/ssh/sshd_config.hearth-bak /etc/ssh/sshd_config
    rm -f /etc/hearth-region/backup-ready
    echo "  Skipped: the SSH settings didn't pass their check, so they were left exactly as they were."
  fi
else
  echo "  Skipped: no SSH server here."
fi
` : ''}
echo "▸ Linking this ${word} to Hearth…"
install -d -m 700 /etc/hearth-region
printf 'MAIN=%s\\nREGION=%s\\nTOKEN=%s\\nPIN=%s\\nKIND=%s\\n' "$MAIN" "$REGION" "$TOKEN" "$PIN" "$KIND" > /etc/hearth-region/env
chmod 600 /etc/hearth-region/env
rm -f /etc/hearth-region/state /etc/hearth-region/last-error /etc/hearth-region/refused-since # (a reinstall starts afresh)
cat > /usr/local/bin/hearth-region-agent <<'AGENT_EOF'
#!/usr/bin/env bash
# Checks in with the main Hearth server: this relay's address, load and traffic. Runs every minute.
set -u
. /etc/hearth-region/env
KIND="\${KIND:-region}"
STATE=/etc/hearth-region/state
IP="$(cat /etc/hearth-region/ip 2>/dev/null || true)"
if [ -z "$IP" ] || [ "$(( $(date +%s) - $(stat -c %Y /etc/hearth-region/ip 2>/dev/null || echo 0) ))" -gt 21600 ]; then
  NEW="$(curl -fsS --max-time 8 https://api.ipify.org || curl -fsS --max-time 8 https://ifconfig.me || true)"
  [ -n "$NEW" ] && { IP="$NEW"; echo "$IP" > /etc/hearth-region/ip; }
fi
IFACE="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") print $(i + 1)}' | head -1)"
TX=0; RX=0
if [ -n "$IFACE" ] && [ -r "/sys/class/net/$IFACE/statistics/tx_bytes" ]; then
  TX="$(cat /sys/class/net/$IFACE/statistics/tx_bytes)"; RX="$(cat /sys/class/net/$IFACE/statistics/rx_bytes)"
fi
LOAD="$(cut -d' ' -f1 /proc/loadavg)"
CPUS="$(nproc 2>/dev/null || echo 1)"
MEM="$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {if (t) printf "%d", (t-a)*100/t; else print 0}' /proc/meminfo)"
RELAY=true; systemctl is-active --quiet coturn || RELAY=false
UP="$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)"
# Backup space: where the main server can reach SSH, this server's own SSH key (so the main server only ever
# talks to this exact machine), and how full it is.
[ -d /run/sshd ] || install -d -m 755 /run/sshd 2>/dev/null || true
SSH_PORT="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')"; [ -n "$SSH_PORT" ] || SSH_PORT=22
HOSTKEY="$(awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true)"
BREADY=false; [ -f /etc/hearth-region/backup-ready ] && BREADY=true
BDIR=/var/lib/hearth-backup/backups
BUSED="$(du -sm $BDIR 2>/dev/null | cut -f1)"; BFREE="$(df -Pm /var/lib 2>/dev/null | awk 'NR == 2 {print $4}')"; BFILES="$(ls $BDIR/*.hbk 2>/dev/null | wc -l)"
# The answer's status code tells a refusal (403: this relay was removed in Hearth, or a new install command replaced
# its link) from trouble on the way (000: no connection), which changes nothing here.
CODE="$(curl -sS \${PIN:+-k --pinnedpubkey "$PIN"} --max-time 15 -X POST -H 'Content-Type: application/json' -H "X-Region-Token: $TOKEN" \\
  -d "{\\"ip\\":\\"$IP\\",\\"tx\\":$TX,\\"rx\\":$RX,\\"load\\":$LOAD,\\"cpus\\":$CPUS,\\"mem\\":$MEM,\\"relay\\":$RELAY,\\"uptime\\":$UP,\\"ssh\\":{\\"port\\":$SSH_PORT,\\"hostKey\\":\\"$HOSTKEY\\",\\"ready\\":$BREADY,\\"usedMb\\":\${BUSED:-0},\\"freeMb\\":\${BFREE:-0},\\"files\\":\${BFILES:-0}},\\"version\\":3}" \\
  -w '%{http_code}' -o "$STATE.new" "$MAIN/api/regions/$REGION/heartbeat")" || true
if [ "$CODE" = 200 ]; then
  mv -f "$STATE.new" "$STATE"; rm -f /etc/hearth-region/last-error /etc/hearth-region/refused-since
else
  [ -s "$STATE.new" ] && mv -f "$STATE.new" /etc/hearth-region/last-error; rm -f "$STATE.new"
fi
# The main server's key may upload backups (and nothing else: the account is upload-only, see sshd_config). An answer
# without it (paused, backups turned off, removed) takes the key away, so uploads stop within a minute.
if [ "$CODE" = 200 ] || [ "$CODE" = 403 ]; then
  KEY=""; [ "$CODE" = 200 ] && KEY="$(sed -n 's/.*"backupKey":"\\(ssh-ed25519 [A-Za-z0-9+/=]*\\).*/\\1/p' "$STATE" 2>/dev/null | head -1)"
  if [ "$BREADY" = true ] && [ -n "$KEY" ]; then
    LINE="restrict $KEY hearth-main"
    [ "$(cat /etc/ssh/hearth-backup.keys 2>/dev/null)" = "$LINE" ] || printf '%s\\n' "$LINE" > /etc/ssh/hearth-backup.keys
  elif [ -s /etc/ssh/hearth-backup.keys ]; then
    : > /etc/ssh/hearth-backup.keys
  fi
fi
# A member relay that Hearth has refused for a whole day (it was removed there, or replaced by a new install command)
# switches itself off instead of relaying for nobody. An owner's region never does: it waits to be reinstalled.
if [ "$CODE" = 403 ] && [ "$KIND" = member ]; then
  NOW="$(date +%s)"; SINCE="$(cat /etc/hearth-region/refused-since 2>/dev/null || true)"
  case "$SINCE" in ''|*[!0-9]*) SINCE="$NOW"; echo "$NOW" > /etc/hearth-region/refused-since ;; esac
  if [ $((NOW - SINCE)) -ge 86400 ]; then
    logger -t hearth-relay "Hearth at $MAIN has refused this relay's check-ins for 24 hours (it was removed there, or a new install command replaced it), so the relay is switching itself off. Remove it with: sudo hearth-relay-uninstall"
    systemctl disable --now coturn >/dev/null 2>&1 || true
    systemctl disable --now hearth-region.timer >/dev/null 2>&1 || true
  fi
fi
# Keep the newest copies (the main server says how many); unfinished uploads go after a day.
KEEP="$(sed -n 's/.*"keep":\\([0-9][0-9]*\\).*/\\1/p' "$STATE" 2>/dev/null | head -1)"; [ -n "$KEEP" ] || KEEP=14
ls -1t $BDIR/*.hbk 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
find $BDIR -name '*.part' -mmin +1440 -delete 2>/dev/null || true
AGENT_EOF
chmod 755 /usr/local/bin/hearth-region-agent
cat > /usr/local/bin/hearth-relay-uninstall <<'UNINSTALL_EOF'
#!/usr/bin/env bash
# Takes the Hearth relay off this machine: everything its installer set up. Safe to run again.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root (or with sudo)." >&2; exit 1; }
gone() { printf '  removed: %s\\n' "$*"; }
echo "▸ Removing the Hearth relay from this machine…"
# The check-in every minute.
if [ -e /etc/systemd/system/hearth-region.timer ] || [ -e /etc/systemd/system/hearth-region.service ]; then
  systemctl disable --now hearth-region.timer >/dev/null 2>&1 || true
  systemctl stop hearth-region.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/hearth-region.timer /etc/systemd/system/hearth-region.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  gone "the check-in with Hearth every minute (hearth-region.timer)"
fi
[ -e /usr/local/bin/hearth-region-agent ] && { rm -f /usr/local/bin/hearth-region-agent; gone "the check-in agent (/usr/local/bin/hearth-region-agent)"; }
# The upload-only account for backup copies, and its block in the SSH settings. sshd is reloaded only with settings
# that pass its check (a reload with broken ones could lock everyone out of SSH).
if grep -q '^# BEGIN hearth-backup' /etc/ssh/sshd_config 2>/dev/null; then
  cp /etc/ssh/sshd_config /etc/ssh/sshd_config.hearth-uninstall
  sed -i '/^# BEGIN hearth-backup/,/^# END hearth-backup/d' /etc/ssh/sshd_config
  install -d -m 755 /run/sshd 2>/dev/null || true
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    rm -f /etc/ssh/sshd_config.hearth-bak
    gone "the hearth-backup block in /etc/ssh/sshd_config"
  elif [ -f /etc/ssh/sshd_config.hearth-bak ]; then
    cp /etc/ssh/sshd_config.hearth-bak /etc/ssh/sshd_config
    if sshd -t 2>/dev/null; then systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true; fi
    gone "the hearth-backup block: without it the SSH settings didn't pass their check, so they're back as they were before Hearth (/etc/ssh/sshd_config.hearth-bak)"
  else
    cp /etc/ssh/sshd_config.hearth-uninstall /etc/ssh/sshd_config
    echo "  Kept /etc/ssh/sshd_config as it was: without Hearth's block it didn't pass its check (sshd -t). Remove the lines from # BEGIN hearth-backup to # END hearth-backup yourself."
  fi
  rm -f /etc/ssh/sshd_config.hearth-uninstall
fi
[ -e /etc/ssh/hearth-backup.keys ] && { rm -f /etc/ssh/hearth-backup.keys; gone "the main server's upload key (/etc/ssh/hearth-backup.keys)"; }
if id hearth-backup >/dev/null 2>&1; then
  pkill -u hearth-backup >/dev/null 2>&1 || true
  userdel hearth-backup >/dev/null 2>&1 || true
  gone "the hearth-backup account"
fi
[ -d /var/lib/hearth-backup ] && { rm -rf /var/lib/hearth-backup; gone "the backup copies kept here (/var/lib/hearth-backup)"; }
# The firewall openings setup-turn.sh made.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  OPENED=""
  for RULE in 3478/udp 3478/tcp 49160:49400/udp; do
    ufw status 2>/dev/null | grep -q "^$RULE " && ufw delete allow "$RULE" >/dev/null 2>&1 && OPENED=yes
  done
  [ -n "$OPENED" ] && gone "the firewall openings for the relay (UDP and TCP 3478, UDP 49160-49400)"
fi
# The relay (coturn): stopped and switched off. Its settings go back to the newest copy setup-turn.sh kept of what
# was there before Hearth (copies of Hearth's own hold the relay secret, so they go), and coturn itself goes if this
# install added it.
if systemctl is-enabled --quiet coturn 2>/dev/null || systemctl is-active --quiet coturn 2>/dev/null; then
  systemctl disable --now coturn >/dev/null 2>&1 || true
  gone "the call relay (coturn): stopped and switched off"
fi
OLD=""
while IFS= read -r f; do
  if head -1 "$f" | grep -q 'written by scripts/setup-turn.sh'; then rm -f "$f"; elif [ -z "$OLD" ]; then OLD="$f"; fi
done < <(ls -1t /etc/turnserver.conf.bak-* 2>/dev/null) # newest first
if head -1 /etc/turnserver.conf 2>/dev/null | grep -q 'written by scripts/setup-turn.sh'; then
  if [ -n "$OLD" ]; then mv -f "$OLD" /etc/turnserver.conf; gone "Hearth's relay settings (/etc/turnserver.conf is back as it was before)"
  else rm -f /etc/turnserver.conf; gone "Hearth's relay settings (/etc/turnserver.conf)"; fi
fi
if [ -f /etc/hearth-region/coturn-by-hearth ] && [ "$(dpkg-query -W -f='\${Status}' coturn 2>/dev/null || true)" = "install ok installed" ]; then
  DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq coturn >/dev/null 2>&1 && gone "coturn (this install had added it)"
fi
[ -d /etc/hearth-region ] && { rm -rf /etc/hearth-region; gone "this relay's link to Hearth and its check-in token (/etc/hearth-region)"; }
rm -f /usr/local/bin/hearth-relay-uninstall
echo "✓ Done. Nothing of the Hearth relay is left running here."
UNINSTALL_EOF
chmod 755 /usr/local/bin/hearth-relay-uninstall
cat > /etc/systemd/system/hearth-region.service <<'UNIT_EOF'
[Unit]
Description=Hearth region check-in
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hearth-region-agent
UNIT_EOF
cat > /etc/systemd/system/hearth-region.timer <<'UNIT_EOF'
[Unit]
Description=Hearth region check-in every minute
[Timer]
OnBootSec=20
OnUnitActiveSec=60
AccuracySec=5
[Install]
WantedBy=timers.target
UNIT_EOF
systemctl daemon-reload
systemctl enable --now hearth-region.timer >/dev/null
/usr/local/bin/hearth-region-agent
${member ? `if grep -q '"ok":true' /etc/hearth-region/state 2>/dev/null; then
  if grep -q '"status":"approved"' /etc/hearth-region/state; then
    printf '\\033[1;32m✓ Installed.\\033[0m The owner already approved it: calls start using it within a minute.\\n'
  elif grep -q '"status":"paused"' /etc/hearth-region/state; then
    printf '\\033[1;32m✓ Installed.\\033[0m The owner has paused it for now: see Hearth → Settings → Help host.\\n'
  else
    printf '\\033[1;32m✓ Installed.\\033[0m It waits for the owner'"'"'s approval: see Hearth → Settings → Help host.\\n'
  fi
else
  printf '\\033[1;31m✗ The relay is installed but couldn'"'"'t reach Hearth at %s yet.\\033[0m It keeps trying every minute.\\n' "$MAIN"
  cat /etc/hearth-region/last-error 2>/dev/null || true; echo
fi
echo "At home: forward UDP and TCP 3478 and UDP 49160–49400 to this machine in your router. On a VPS: open them in the provider's firewall."` : `if grep -q '"ok":true' /etc/hearth-region/state 2>/dev/null; then
  printf '\\033[1;32m✓ This region is linked.\\033[0m It shows as online in Hearth → Admin → Regions, and calls start using it within a minute.\\n'
else
  printf '\\033[1;31m✗ The relay is installed but couldn'"'"'t reach Hearth at %s yet.\\033[0m It keeps trying every minute.\\n' "$MAIN"
  cat /etc/hearth-region/last-error 2>/dev/null || true; echo
fi
echo "If this VPS provider has its own firewall (in their control panel), open UDP+TCP 3478 and UDP 49160-49400 there."`}
echo "To remove it from this machine later: sudo hearth-relay-uninstall"
`;
  }

  // ------------------------------------------------------------------ check-ins from the regions
  // A region's address becomes a relay address everyone's app is given, and the place this server copies backups
  // to over SSH, so it has to be a real public address. Addresses are parsed (not matched as text), so every way
  // of writing an internal one is refused: "0:0:0:0:0:0:0:1" is loopback, and "::ffff:a00:1" is 10.0.0.1.
  // (Two lists: one BlockList would also match every IPv4 address against the IPv6 rules for mapped addresses.)
  const NOT_PUBLIC_V4 = new net.BlockList();
  const NOT_PUBLIC_V6 = new net.BlockList();
  for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]]) NOT_PUBLIC_V4.addSubnet(a, bits, 'ipv4');
  // IPv6: unspecified, loopback and the old IPv4-compatible form (::/96), IPv4-mapped (::ffff:0:0/96), the NAT64,
  // 6to4 and Teredo forms that carry an IPv4 address inside, unique-local, link-local, old site-local, multicast.
  for (const [a, bits] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) NOT_PUBLIC_V6.addSubnet(a, bits, 'ipv6');
  const publicIp = (ip) => {
    const s = String(ip || '');
    let ok;
    if (net.isIPv4(s)) ok = !NOT_PUBLIC_V4.check(s, 'ipv4');
    else if (net.isIPv6(s) && /^[0-9a-f:]{2,39}$/i.test(s)) ok = !NOT_PUBLIC_V6.check(s, 'ipv6'); // no zone ids or dotted tails
    else return false;
    return ok || process.env.REGIONS_ALLOW_PRIVATE === '1';
  };
  // Member relays check in the same way, whatever their status: the owner sees the address and load before approving.
  api.post('/regions/:id/heartbeat', wrap(async (req, res) => {
    rateLimit('regionbeat:' + req.ip, 30, 60000);
    const r = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
    if (!checkToken(r, String(req.get('x-region-token') || ''))) fail(403, 'Unknown region or token.');
    const b = req.body || {};
    const ip = String(b.ip || '').trim();
    if (!publicIp(ip)) fail(400, 'No public IP address.');
    const host = ip.includes(':') ? `[${ip}]` : ip;
    const urls = [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`];
    const st = parse(r.stats, {});
    const t = now();
    const tx = Math.max(0, +b.tx || 0); const rx = Math.max(0, +b.rx || 0);
    const month = new Date().toISOString().slice(0, 7);
    if (st.month !== month) { st.month = month; st.monthBytes = 0; }
    if (st.lastTx !== undefined && st.lastAt && tx >= st.lastTx && rx >= st.lastRx) {
      const sent = (tx - st.lastTx) + (rx - st.lastRx);
      st.monthBytes = (st.monthBytes || 0) + sent;
      st.mbps = Math.round((sent * 8) / Math.max(1, (t - st.lastAt) / 1000) / 1e4) / 100;
    }
    Object.assign(st, { lastTx: tx, lastRx: rx, lastAt: t, load: Math.round((+b.load || 0) * 100) / 100, cpus: Math.max(1, +b.cpus || 1), mem: Math.min(100, Math.max(0, +b.mem || 0)), relay: b.relay !== false, uptime: +b.uptime || 0, version: +b.version || 1 });
    st.monthGb = Math.round(((st.monthBytes || 0) / 1e9) * 100) / 100;
    // Backup space (agent version 2+): the SSH port and this region's own host key, so copies only ever go to
    // this exact machine.
    const sh = b.ssh && typeof b.ssh === 'object' ? b.ssh : null;
    if (sh) {
      const port = Math.floor(+sh.port);
      const hostKey = String(sh.hostKey || '').trim();
      st.backup = {
        ...(st.backup || {}), ready: sh.ready === true && /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}$/.test(hostKey) && port > 0 && port < 65536,
        port, hostKey, files: Math.max(0, Math.floor(+sh.files || 0)), usedMb: Math.max(0, Math.floor(+sh.usedMb || 0)), freeMb: Math.max(0, Math.floor(+sh.freeMb || 0)),
      };
    }
    db.prepare('UPDATE regions SET ip = ?, turn_urls = ?, last_seen = ?, stats = ?, setup_until = NULL WHERE id = ?').run(ip, JSON.stringify(st.relay ? urls : []), t, JSON.stringify(st), r.id);
    // This server's backup key goes only to a relay that may get copies: an answer without it makes the agent (version
    // 3+) take the key away, so a paused member relay, or one whose copies were turned off, stops taking uploads.
    const key = mayGetCopies(r) ? backupPublicKey() : null;
    const member = isMemberRow(r);
    if (member && !isAlive(r)) tell(r.owner_id); // installed, or back after being offline: the member's page moves on
    res.json({ ok: true, name: r.name, ...(member ? { status: r.status } : {}), ...(key ? { backupKey: key, keep: member ? MEMBER_KEEP : KEEP_COPIES } : {}) });
  }));

  // ------------------------------------------------------------------ off-site backups on the regions
  // Each region that has backup space (installed or reinstalled with Hearth 1.25+) keeps copies of this server's
  // encrypted backups, so losing this machine doesn't lose everything. Copies go over SFTP with this server's
  // own key, to an account that can only upload into one folder, and only to the host key the region reported
  // (checked strictly, so nobody can pretend to be the region). The region keeps the newest KEEP_COPIES.
  // Member relays get them too, only while mayGetCopies (both the member and the owner said yes), and keep 3.
  const KEEP_COPIES = Math.max(2, Math.min(60, +process.env.REGION_BACKUP_KEEP || 14));
  const KEY_DIR = path.join(DATA_DIR, 'region-backup');
  const KEY_FILE = path.join(KEY_DIR, 'id_ed25519');
  let pubCache = null;
  function backupPublicKey() {
    if (process.env.REGION_BACKUPS === 'off') return null;
    if (pubCache) return pubCache;
    try {
      if (!fs.existsSync(KEY_FILE)) {
        fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'hearth-main', '-f', KEY_FILE], { stdio: 'ignore', timeout: 20000 });
      }
      const pub = fs.readFileSync(KEY_FILE + '.pub', 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
      if (/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}$/.test(pub)) pubCache = pub;
    } catch { /* no ssh-keygen here (install openssh-client): region backups stay off */ }
    return pubCache;
  }
  const allRows = () => db.prepare('SELECT * FROM regions ORDER BY created_at').all();
  const copyName = (r) => (isMemberRow(r) ? `${r.name} (member)` : r.name);
  const backupTargets = () => allRows().filter((r) => isAlive(r) && r.ip && mayGetCopies(r)).map((r) => ({ r, b: parse(r.stats, {}).backup })).filter(({ b }) => b && b.ready);
  // Where copies go, for Admin → Backups: every relay with backup space that may get them, up or not right now.
  const copyNames = () => allRows().filter((r) => { const b = parse(r.stats, {}).backup; return b && b.ready && mayGetCopies(r); }).map(copyName);
  function sftpPut(r, b, file) {
    return new Promise((resolve) => {
      const name = path.basename(file);
      const host = r.ip.includes(':') ? `[${r.ip}]` : r.ip;
      const known = path.join(KEY_DIR, `known_hosts_${r.id}`);
      const batch = path.join(KEY_DIR, `batch_${r.id}`);
      fs.writeFileSync(known, `${b.port === 22 && !r.ip.includes(':') ? r.ip : `[${r.ip}]:${b.port}`} ${b.hostKey}\n`, { mode: 0o600 });
      fs.writeFileSync(batch, `put "${file.replace(/"/g, '')}" "${name}.part"\nrename "${name}.part" "${name}"\n`, { mode: 0o600 });
      execFile('sftp', ['-b', batch, '-o', 'LogLevel=ERROR', '-i', KEY_FILE, '-P', String(b.port), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${known}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', `hearth-backup@${host}`],
      { timeout: 4 * 3600000, env: { ...process.env, HOME: KEY_DIR } }, (err, stdout, stderr) => {
        const ok = !err;
        const lines = String(stderr || (err && err.message) || '').trim().split('\n').filter((l) => !/^(Warning|Connection closed)/.test(l));
        const why = lines.find((l) => /verification failed|REMOTE HOST IDENTIFICATION/.test(l)) ? 'The region\u2019s identity changed (host key mismatch), so nothing was sent. Reinstall the region if you rebuilt it.'
          : lines.find((l) => /Permission denied/.test(l)) ? 'The region refused this server\u2019s key (it updates within a minute of the region checking in).'
            : lines.pop() || (err && err.killed ? 'Took too long.' : 'The copy failed.');
        resolve({ id: r.id, name: copyName(r), ok, error: ok ? undefined : why.slice(0, 200) });
      });
    });
  }
  // Copies one encrypted backup (.hbk) to every region with backup space. Returns { <region id>: { name, ok, error, at } }.
  // A relay whose disk (as it last reported) can't take the copy with 1 GB to spare is skipped: filling up someone's
  // machine, a member's above all, would stop more than the backups there.
  async function copyBackup(file) {
    if (!/\.hbk$/.test(file) || !backupPublicKey()) return {};
    let sizeMb = 0;
    try { sizeMb = Math.ceil(fs.statSync(file).size / 1048576); } catch { /* gone: sftp says so below */ }
    const out = {};
    for (const { r, b } of backupTargets()) {
      const res = b.freeMb < sizeMb + 1024 ? { name: copyName(r), ok: false, error: `Not enough free space there: ${b.freeMb} MB free, and a copy needs ${sizeMb} MB with 1 GB to spare.` } : await sftpPut(r, b, file);
      out[r.id] = { name: res.name, ok: res.ok, error: res.error, at: now() };
      const st = parse(db.prepare('SELECT stats FROM regions WHERE id = ?').get(r.id)?.stats, {});
      if (st.backup) { st.backup.last = { ok: res.ok, error: res.error, at: now(), file: path.basename(file) }; db.prepare('UPDATE regions SET stats = ? WHERE id = ?').run(JSON.stringify(st), r.id); }
    }
    return out;
  }

  return { liveRelays, memberRelays, copyBackup, copyNames, backupPublicKey, isAlive };
};
