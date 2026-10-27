// Community features: server templates (server/templates.js), the instance's main server that new accounts join
// (server/mainserver.js), and server search for servers that opt in (server/discovery.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { PERMS: P } = require('../server/perms');

let srv; let owner;
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const mk = async (u, name, template) => {
  const r = await as(u, 'POST', '/servers', template === undefined ? { name } : { name, template });
  assert.equal(r.status, 200, r.text);
  return r.json;
};
const memberOf = (sid, uid) => srv.sql('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', sid, uid).length > 0;
const invite = async (u, sid, body = {}) => (await as(u, 'POST', `/servers/${sid}/invites`, body)).json.code;
const search = (u, q = '', page) => as(u, 'GET', `/discover/servers?${new URLSearchParams({ q, ...(page !== undefined ? { page: String(page) } : {}) })}`);

before(async () => {
  srv = await startServer();
  owner = srv.owner;
});
after(() => srv.stop());

// ------------------------------------------------------------------ templates
test('templates: the list names the six templates, and no template still makes #general and a voice channel', async () => {
  const list = (await as(owner, 'GET', '/server-templates')).json;
  assert.deepEqual(list.map((t) => t.key), ['blank', 'friends', 'gaming', 'study', 'community', 'creators']);
  assert.deepEqual(list.map((t) => t.name), ['Blank', 'Friends', 'Gaming', 'Study group', 'Community/Club', 'Creators']);
  for (const t of list) assert.ok(t.text >= 1 && t.voice >= 1 && t.about, t.key);
  assert.equal((await srv.api('GET', '/server-templates')).status, 401, 'signed in only');
  const s = await mk(owner, 'Plain');
  assert.deepEqual(s.channels.map((c) => [c.name, c.type, c.category]), [['general', 'text', 'Text'], ['Lounge', 'voice', 'Voice']]);
  assert.deepEqual(s.roleDefs.map((r) => r.name), ['@everyone']);
  const b = await mk(owner, 'Blank one', 'blank');
  assert.deepEqual(b.channels.map((c) => c.name), ['general', 'Lounge']);
});

test('templates: each one sets up categories, text and voice channels and roles, none of them Administrator', async () => {
  for (const key of ['friends', 'gaming', 'study', 'community', 'creators']) {
    const s = await mk(owner, `T ${key}`, key);
    const cats = [...new Set(s.channels.map((c) => c.category))];
    assert.ok(cats.length >= 2, `${key}: categories`);
    assert.deepEqual(s.categoryOrder, cats, `${key}: category order follows the template`);
    assert.ok(s.channels.some((c) => c.type === 'text') && s.channels.some((c) => c.type === 'voice'), key);
    const roles = s.roleDefs.filter((r) => r.name !== '@everyone');
    assert.ok(roles.length >= 2, `${key}: roles`);
    for (const r of roles) assert.equal(r.permissions & P.ADMINISTRATOR, 0, `${key}: ${r.name} isn't an Administrator`);
    const every = s.roleDefs.find((r) => r.name === '@everyone');
    assert.equal(every.permissions & (P.MANAGE_SERVER | P.BAN_MEMBERS | P.KICK_MEMBERS | P.MANAGE_ROLES), 0, `${key}: @everyone keeps the defaults`);
  }
});

test('templates: announcement-style channels are read-only for everyone but the roles that post there', async () => {
  const s = await mk(owner, 'Raid night', 'gaming');
  const m = await srv.register('gamer_one');
  await as(m, 'POST', `/invites/${await invite(owner, s.id)}/join`);
  const mine = (await as(m, 'GET', '/bootstrap')).json.servers.find((x) => x.id === s.id);
  const rules = mine.channels.find((c) => c.name === 'rules');
  const general = mine.channels.find((c) => c.name === 'general');
  assert.ok(rules.perms & P.VIEW_CHANNEL, 'everyone reads #rules');
  assert.equal(rules.perms & P.SEND_MESSAGES, 0, 'but can’t post there');
  assert.ok(general.perms & P.SEND_MESSAGES, '#general is open');
  // Give them the Moderator role: now they can post in #rules.
  const mod = mine.roleDefs.find((r) => r.name === 'Moderator');
  assert.equal((await as(owner, 'PUT', `/servers/${s.id}/members/${m.id}/roles`, { roleIds: [mod.id] })).status, 200);
  const again = (await as(m, 'GET', '/bootstrap')).json.servers.find((x) => x.id === s.id);
  assert.ok(again.channels.find((c) => c.name === 'rules').perms & P.SEND_MESSAGES);
});

test('templates: the server refuses a template name it doesn’t know, whatever its type', async () => {
  for (const template of ['evil', '__proto__', 'constructor', 'toString', 'Gaming', 123, ['gaming'], { key: 'gaming' }, true]) {
    const r = await as(owner, 'POST', '/servers', { name: 'Nope', template });
    assert.equal(r.status, 400, JSON.stringify(template));
    assert.equal(r.json.code, 'bad_template');
  }
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM servers WHERE name = 'Nope'")[0].n, 0, 'nothing was made');
});

// ------------------------------------------------------------------ main server
let hub;
test('main server: off by default, and nobody but the instance’s owner can see or set it', async () => {
  const st = (await as(owner, 'GET', '/admin/main-server')).json;
  assert.equal(st.status, 'off');
  const u = await srv.register('lonely_one');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM members WHERE user_id = ?', u.id)[0].n, 0, 'nobody joins anything when it’s off');
  hub = await mk(owner, 'Kappa Hub', 'community');
  for (const [m, p, b] of [['GET', '/admin/main-server'], ['PUT', '/admin/main-server', { serverId: hub.id }], ['POST', '/admin/main-server/add-everyone', { confirm: true }]]) {
    assert.equal((await as(u, m, p, b)).status, 403, `${m} ${p}`);
  }
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'off');
});

test('main server: picked by an invite link, every new account joins it like an invite and is due the server key', async () => {
  const code = await invite(owner, hub.id, { expiresHours: 0 });
  const r = await as(owner, 'PUT', '/admin/main-server', { invite: `https://kappachat.example/invite/${code}` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 'on');
  assert.equal(r.json.server.id, hub.id);
  assert.equal(r.json.invite.code, code);
  // Pretend the server already has a key, as it would once an app opened it.
  srv.sql('UPDATE servers SET key_epoch = 1 WHERE id = ?', hub.id);
  const u = await srv.register('newbie_one');
  assert.ok(memberOf(hub.id, u.id), 'joined at sign-up');
  const boot = (await as(u, 'GET', '/bootstrap')).json;
  assert.ok(boot.servers.some((s) => s.id === hub.id), 'it’s in their server list');
  assert.ok(boot.keyStates[hub.id].missing.includes(u.id), 'listed as needing the key, so members’ apps wrap it for them');
  assert.equal(srv.sql('SELECT uses FROM invites WHERE code = ?', code)[0].uses, 0, 'auto-joins don’t use the invite up');
  // They can leave it like any server.
  assert.equal((await as(u, 'POST', `/servers/${hub.id}/leave`)).status, 200);
  assert.ok(!memberOf(hub.id, u.id));
});

test('main server: a revoked invite or a deleted server turns it off quietly, and sign-up works as before', async () => {
  const code = (await as(owner, 'GET', '/admin/main-server')).json.invite.code;
  assert.equal((await as(owner, 'DELETE', `/invites/${code}`)).status, 200);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'invite_gone');
  const u = await srv.register('after_revoke');
  assert.ok(!memberOf(hub.id, u.id));
  // An expired invite counts as gone too.
  const c2 = await invite(owner, hub.id);
  await as(owner, 'PUT', '/admin/main-server', { invite: c2 });
  srv.sql('UPDATE invites SET expires_at = 1 WHERE code = ?', c2);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'invite_gone');
  // A server that's gone.
  const tmp = await mk(owner, 'Temporary');
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: tmp.id })).json.status, 'on');
  srv.sql('DELETE FROM servers WHERE id = ?', tmp.id);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'server_gone');
  const v = await srv.register('after_delete');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM members WHERE user_id = ?', v.id)[0].n, 0);
  // Bad picks are refused; null turns it off.
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { invite: 'zzzzzzzz' })).status, 404);
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: 'nope' })).status, 404);
  srv.sql("INSERT INTO servers (id, name, owner_id, created_at, kind) VALUES ('grp_main', 'G', ?, 1, 'group')", owner.id);
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: 'grp_main' })).status, 400, 'not a group chat');
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: null })).json.status, 'off');
});

test('main server: only the owner picks it, and only a server they manage there or have an invite to', async () => {
  // An instance admin who isn't the owner can't touch it.
  const adm = await srv.register('admin_two');
  assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: adm.id, role: 'admin', authKey: owner.authKey })).status, 200);
  assert.equal((await as(adm, 'GET', '/admin/main-server')).status, 403);
  assert.equal((await as(adm, 'PUT', '/admin/main-server', { serverId: hub.id })).status, 403);
  // Someone else's private server, picked from the list: refused (its members' apps would hand over the key).
  const other = await srv.register('private_owner');
  const priv = await mk(other, 'Private Den');
  const r = await as(owner, 'PUT', '/admin/main-server', { serverId: priv.id });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'not_yours');
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'off');
  // With one of its invites (someone there let people in), it works.
  const code = await invite(other, priv.id, { expiresHours: 0 });
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { invite: code })).json.status, 'on');
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: null })).json.status, 'off');
});

test('main server: picked from the list; adding everyone runs once, after a confirm, and skips people who left or are banned', async () => {
  const town = await mk(owner, 'Town Square');
  const stay = await srv.register('existing_a');
  const left = await srv.register('existing_b');
  const banned = await srv.register('existing_c');
  await as(left, 'POST', `/invites/${await invite(owner, town.id)}/join`);
  await as(left, 'POST', `/servers/${town.id}/leave`);
  assert.equal((await as(owner, 'POST', `/servers/${town.id}/bans`, { userId: banned.id })).status, 200);
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: town.id })).json.status, 'on');
  const before = (await as(owner, 'GET', '/admin/main-server')).json;
  assert.ok(before.waiting >= 1);
  assert.equal((await as(owner, 'POST', '/admin/main-server/add-everyone', {})).status, 400, 'needs the confirm');
  assert.ok(!memberOf(town.id, stay.id));
  const r = await as(owner, 'POST', '/admin/main-server/add-everyone', { confirm: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.added, before.waiting);
  assert.ok(memberOf(town.id, stay.id), 'existing account added');
  assert.ok(!memberOf(town.id, left.id), 'someone who left stays out');
  assert.ok(!memberOf(town.id, banned.id), 'someone banned stays out');
  assert.equal(r.json.waiting, 0);
  assert.equal((await as(owner, 'POST', '/admin/main-server/add-everyone', { confirm: true })).status, 409, 'once per server');
  // Still once after switching to another server and back.
  await as(owner, 'PUT', '/admin/main-server', { serverId: hub.id });
  await as(owner, 'PUT', '/admin/main-server', { serverId: town.id });
  assert.equal((await as(owner, 'POST', '/admin/main-server/add-everyone', { confirm: true })).status, 409, 'once per server, whatever was picked in between');
  // Accounts made after it ran still join at sign-up.
  const fresh = await srv.register('existing_d');
  assert.ok(memberOf(town.id, fresh.id));
  await as(owner, 'PUT', '/admin/main-server', { serverId: null });
});

test('main server: only an invite with no use limit can be picked; one that gets a limit stops it', async () => {
  const den = await mk(owner, 'Limited Den');
  const once = await invite(owner, den.id, { maxUses: 1 });
  let r = await as(owner, 'PUT', '/admin/main-server', { invite: once });
  assert.equal(r.status, 400, 'a use limit the moderators set would mean nothing: auto-joins don’t count');
  assert.equal(r.json.code, 'bad_invite');
  // Used up already: refused like validInvite refuses it.
  srv.sql('UPDATE invites SET uses = 1 WHERE code = ?', once);
  r = await as(owner, 'PUT', '/admin/main-server', { invite: once });
  assert.equal(r.status, 410);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'off');
  // An unlimited one works; given a limit afterwards (or used up), it stops, and sign-ups don't join.
  const open2 = await invite(owner, den.id, { expiresHours: 0 });
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { invite: open2 })).json.status, 'on');
  srv.sql('UPDATE invites SET max_uses = 5, uses = 0 WHERE code = ?', open2);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'invite_gone');
  const u = await srv.register('limited_newbie');
  assert.ok(!memberOf(den.id, u.id));
  srv.sql('UPDATE invites SET max_uses = 0 WHERE code = ?', open2);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'on');
});

test('main server: the instance’s audit log never has the invite code; the server’s own audit log says what the owner did', async () => {
  const den = srv.sql("SELECT id FROM servers WHERE name = 'Limited Den'")[0].id;
  const code = (await as(owner, 'GET', '/admin/main-server')).json.invite.code;
  const instance = srv.sql("SELECT detail FROM admin_log WHERE action = 'main_server'");
  assert.ok(instance.length >= 1);
  for (const row of instance) assert.ok(!row.detail.includes(code), 'staff moderators read this log: no codes in it');
  // The server's moderators see who made it the main server, and with which invite (so they can revoke it).
  const on = srv.sql("SELECT * FROM server_audit WHERE server_id = ? AND action = 'main_server' ORDER BY seq DESC LIMIT 1", den)[0];
  assert.equal(on.actor_id, owner.id);
  assert.equal(on.target_id, code);
  assert.equal(JSON.parse(on.detail).on, true);
  const log = (await as(owner, 'GET', `/servers/${den}/audit?action=main_server`)).json;
  assert.ok(log.entries.some((e) => e.action === 'main_server' && e.targetId === code), 'shown whole to someone with Manage Server');
  // Turning it off is written there too.
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: null })).json.status, 'off');
  const off = srv.sql("SELECT * FROM server_audit WHERE server_id = ? AND action = 'main_server' ORDER BY seq DESC LIMIT 1", den)[0];
  assert.equal(JSON.parse(off.detail).on, false);
});

test('main server: picked from the list, it stops once the owner loses Manage Server there or is banned', async () => {
  const other = await srv.register('lent_owner');
  const lent = await mk(other, 'Lent Server');
  await as(owner, 'POST', `/invites/${await invite(other, lent.id)}/join`);
  const role = (await as(other, 'POST', `/servers/${lent.id}/roles`, { name: 'Helpers', permissions: P.MANAGE_SERVER })).json.id;
  assert.equal((await as(other, 'PUT', `/servers/${lent.id}/members/${owner.id}/roles`, { add: [role] })).status, 200);
  const st = (await as(owner, 'GET', '/admin/main-server')).json;
  assert.ok(st.choices.some((x) => x.id === lent.id), 'listed: they manage it');
  assert.ok(!st.choices.some((x) => x.id === srv.sql("SELECT id FROM servers WHERE name = 'Private Den'")[0].id), 'not listed: they don’t');
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: lent.id })).json.status, 'on');
  assert.ok(srv.sql("SELECT 1 FROM server_audit WHERE server_id = ? AND action = 'main_server' AND actor_id = ?", lent.id, owner.id).length);
  const a = await srv.register('lent_newbie_a');
  assert.ok(memberOf(lent.id, a.id));
  // The server's owner takes the role away: no more auto-joins, and adding everyone is refused.
  assert.equal((await as(other, 'PUT', `/servers/${lent.id}/members/${owner.id}/roles`, { remove: [role] })).status, 200);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'not_allowed');
  const b = await srv.register('lent_newbie_b');
  assert.ok(!memberOf(lent.id, b.id));
  assert.equal((await as(owner, 'POST', '/admin/main-server/add-everyone', { confirm: true })).status, 409);
  // Given back, it works again; banned, it stops for good.
  assert.equal((await as(other, 'PUT', `/servers/${lent.id}/members/${owner.id}/roles`, { add: [role] })).status, 200);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'on');
  assert.equal((await as(other, 'POST', `/servers/${lent.id}/bans`, { userId: owner.id })).status, 200);
  assert.equal((await as(owner, 'GET', '/admin/main-server')).json.status, 'not_allowed');
  const c = await srv.register('lent_newbie_c');
  assert.ok(!memberOf(lent.id, c.id));
  assert.equal((await as(owner, 'PUT', '/admin/main-server', { serverId: null })).json.status, 'off');
});

// Adding everyone looks at each account again as it's written: one deleted, suspended, banned or gone between
// batches isn't added. Run against the module itself, with an account changing while the first one is added.
test('main server: adding everyone skips accounts that were deleted, suspended, banned or left while it ran', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, is_bot INTEGER DEFAULT 0, deleted_at INTEGER, suspended_at INTEGER);
    CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, icon TEXT, kind TEXT DEFAULT 'server');
    CREATE TABLE members (server_id TEXT, user_id TEXT); CREATE TABLE former_members (server_id TEXT, user_id TEXT);
    CREATE TABLE bans (server_id TEXT, user_id TEXT); CREATE TABLE invites (code TEXT, server_id TEXT, max_uses INTEGER, uses INTEGER, expires_at INTEGER);
    INSERT INTO servers (id, name) VALUES ('s1', 'Main');
    INSERT INTO members VALUES ('s1', 'boss');`);
  for (const id of ['boss', 'a', 'deleted', 'suspended', 'banned', 'left', 'botty', 'b']) db.prepare('INSERT INTO users (id) VALUES (?)').run(id);
  const settings = new Map([['mainServer', JSON.stringify({ serverId: 's1', code: null, by: 'boss' })]]);
  const routes = {};
  const route = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const isMember = (sid, uid) => !!db.prepare('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?').get(sid, uid);
  const added = [];
  let first = true;
  require('../server/mainserver')({
    api: { get: route('GET'), put: route('PUT'), post: route('POST') }, auth: null, ownerOnly: null, db, now: Date.now,
    fail: (status, msg, code) => { throw Object.assign(new Error(msg), { status, code }); }, wrap: (f) => f, rateLimit: () => {},
    getSetting: (k) => settings.get(k), setSetting: (k, v) => settings.set(k, v), auditLog: () => {},
    bannedFrom: (sid, uid) => !!db.prepare('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?').get(sid, uid),
    insertMember: (sid, uid) => {
      if (isMember(sid, uid)) return false;
      db.prepare('INSERT INTO members VALUES (?, ?)').run(sid, uid);
      added.push(uid);
      if (first) {
        // While the first one is added, everything else changes under it.
        first = false;
        db.exec(`UPDATE users SET deleted_at = 1 WHERE id = 'deleted'; UPDATE users SET suspended_at = 1 WHERE id = 'suspended';
          UPDATE users SET is_bot = 1 WHERE id = 'botty'; INSERT INTO bans VALUES ('s1', 'banned'); INSERT INTO former_members VALUES ('s1', 'left');`);
      }
      return true;
    },
    announceMember: () => {}, addMember: () => false, joinedPayload: () => {}, emitKeyState: () => {}, connected: () => false,
    stillSuspended: (u) => !!u.suspended_at, log: { warn: () => {} }, canManageServer: (s, uid) => isMember(s.id, uid) && uid === 'boss',
  });
  let out;
  await routes['POST /admin/main-server/add-everyone']({ userId: 'boss', body: { confirm: true } }, { json: (x) => { out = x; } });
  assert.equal(added[0], 'a');
  assert.deepEqual(added.slice(1), ['b'], 'only the accounts still waiting');
  assert.equal(out.added, 2);
  db.close();
});

// ------------------------------------------------------------------ server search
let open; let mod; let stranger;
test('server search: off by default; turning it on needs Manage Server and a description', async () => {
  open = await mk(owner, 'Pixel Painters', 'creators');
  mod = await srv.register('mod_pixel');
  stranger = await srv.register('stranger_x');
  await as(mod, 'POST', `/invites/${await invite(owner, open.id)}/join`);
  assert.equal(srv.sql('SELECT discoverable FROM servers WHERE id = ?', open.id)[0].discoverable, 0);
  assert.equal(open.discoverable, false);
  assert.deepEqual((await search(stranger, 'pixel')).json.servers, [], 'not listed until someone opts in');
  assert.equal((await as(mod, 'PATCH', `/servers/${open.id}`, { discoverable: true, discoverAbout: 'Art' })).status, 403, 'members can’t list it');
  assert.equal((await as(stranger, 'PATCH', `/servers/${open.id}`, { discoverable: true, discoverAbout: 'Art' })).status, 404);
  const noAbout = await as(owner, 'PATCH', `/servers/${open.id}`, { discoverable: true });
  assert.equal(noAbout.status, 400);
  assert.equal(noAbout.json.code, 'about_required');
  for (const discoverTags of ['art', ['a', 'b', 'c', 'd', 'e', 'f'], ['<script>'], ['x'.repeat(25)], [1]]) {
    assert.equal((await as(owner, 'PATCH', `/servers/${open.id}`, { discoverable: true, discoverAbout: 'Art', discoverTags })).status, 400, JSON.stringify(discoverTags));
  }
  assert.equal((await as(owner, 'PATCH', `/servers/${open.id}`, { discoverable: 'yes', discoverAbout: 'Art' })).status, 400);
  assert.equal(srv.sql('SELECT discoverable FROM servers WHERE id = ?', open.id)[0].discoverable, 0, 'nothing was written');
  // Manage Server is enough (not only the owner).
  const roles = (await as(owner, 'POST', `/servers/${open.id}/roles`, { name: 'Managers', permissions: P.MANAGE_SERVER })).json;
  await as(owner, 'PUT', `/servers/${open.id}/members/${mod.id}/roles`, { roleIds: [roles.id] });
  const r = await as(mod, 'PATCH', `/servers/${open.id}`, { discoverable: true, discoverAbout: 'We paint pixels together, every Friday.', discoverTags: ['Pixel Art', '#retro', 'retro', ''] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.discoverable, true);
  assert.deepEqual(r.json.discoverTags, ['pixel art', 'retro']);
  const log = srv.sql("SELECT detail FROM server_audit WHERE server_id = ? AND action = 'server_update' ORDER BY created_at DESC LIMIT 1", open.id);
  assert.match(log[0].detail, /discoverable/);
});

test('server search: finds listed servers by name, description and tags, showing only what a listing shows', async () => {
  for (const q of ['pixel', 'PAINTERS', 'friday', 'retro', 'pixel art', '']) {
    const r = await search(stranger, q);
    assert.equal(r.status, 200);
    const hit = r.json.servers.find((s) => s.id === open.id);
    assert.ok(hit, `found by “${q}”`);
    assert.deepEqual(Object.keys(hit).sort(), ['about', 'icon', 'id', 'joined', 'memberCount', 'name', 'tags']);
    assert.equal(hit.memberCount, 2);
    assert.equal(hit.joined, false);
  }
  assert.deepEqual((await search(stranger, 'pixel nothingelse')).json.servers, [], 'every word must match');
  assert.ok(!(await search(stranger, 'hub')).json.servers.length, 'unlisted servers never show');
  // LIKE wildcards are just characters.
  assert.deepEqual((await search(stranger, '%')).json.servers, []);
  assert.deepEqual((await search(stranger, '_')).json.servers, []);
  assert.equal((await srv.api('GET', '/discover/servers?q=pixel')).status, 401, 'signed in only');
});

test('server search: joining works like an invite; banned people can’t see or join it; turning it off hides it at once', async () => {
  const j = await as(stranger, 'POST', `/discover/servers/${open.id}/join`);
  assert.equal(j.status, 200, j.text);
  assert.equal(j.json.id, open.id);
  assert.ok(memberOf(open.id, stranger.id));
  assert.equal((await search(stranger, 'pixel')).json.servers[0].joined, true);
  // Banned: gone from their results, and joining is refused.
  const bad = await srv.register('banned_pixel');
  assert.equal((await as(owner, 'POST', `/servers/${open.id}/bans`, { userId: bad.id })).status, 200);
  assert.ok(!(await search(bad, 'pixel')).json.servers.some((s) => s.id === open.id));
  const jb = await as(bad, 'POST', `/discover/servers/${open.id}/join`);
  assert.equal(jb.status, 403);
  assert.ok(!memberOf(open.id, bad.id));
  // A private server's id gets the same answer as one that doesn't exist.
  const priv = await mk(owner, 'Secret Base');
  const late = await srv.register('late_pixel');
  const a = await as(late, 'POST', `/discover/servers/${priv.id}/join`);
  const b = await as(late, 'POST', '/discover/servers/doesnotexist/join');
  assert.equal(a.status, 404);
  assert.deepEqual(a.json, b.json);
  assert.ok(!memberOf(priv.id, late.id));
  // Off: out of search and closed to joins straight away.
  assert.equal((await as(owner, 'PATCH', `/servers/${open.id}`, { discoverable: false })).status, 200);
  assert.ok(!(await search(late, 'pixel')).json.servers.some((s) => s.id === open.id));
  assert.equal((await as(late, 'POST', `/discover/servers/${open.id}/join`)).status, 404);
  assert.ok(!memberOf(open.id, late.id));
  // Group chats can't be listed.
  srv.sql("INSERT INTO members (server_id, user_id, joined_at) VALUES ('grp_main', ?, 1)", owner.id);
  assert.equal((await as(owner, 'PATCH', '/servers/grp_main', { discoverable: true, discoverAbout: 'x' })).status, 400);
});

test('server search: results come in pages of 20', async () => {
  const lister = await srv.register('lister_many');
  for (let i = 0; i < 21; i++) {
    const s = await mk(lister, `Chess club ${i}`);
    await as(lister, 'PATCH', `/servers/${s.id}`, { discoverable: true, discoverAbout: 'Chess for everyone' });
  }
  const p0 = (await search(stranger, 'chess')).json;
  assert.equal(p0.servers.length, 20);
  assert.equal(p0.hasMore, true);
  const p1 = (await search(stranger, 'chess', 1)).json;
  assert.equal(p1.servers.length, 1);
  assert.equal(p1.hasMore, false);
  assert.ok(!p0.servers.some((s) => s.id === p1.servers[0].id));
  assert.equal((await search(stranger, 'chess', 9999)).json.page, 49, 'pages are capped');
});

test('server search: searches are rate limited per account', async () => {
  const busy = await srv.register('busy_searcher');
  let last;
  for (let i = 0; i < 61; i++) last = await search(busy, 'chess');
  assert.equal(last.status, 429);
});
