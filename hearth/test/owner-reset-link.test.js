// The owner's password reset links (Admin → Users, server/accounts.js): for someone who can't get back in by email.
// Only the owner can make one, with their password; the person chooses their own new password with it (the same
// reset as the emailed link: new keys without the recovery key, two-factor still asked for), and the keys it makes
// can't be verified by the owner who made the link, since they could have opened it themselves.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');

let srv;
before(async () => { srv = await H.startServer(); });
after(async () => { await srv.stop(); });

const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const newPub = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
// What the app sends to finish a reset without the recovery key: a new password's key and brand-new keys.
const resetBody = (token, extra = {}) => ({ token, authKey: H.hex(32), encPrivateKey: H.b64(120), kdfSalt: H.b64(16), publicKey: newPub(), ...extra });
const audit = (action, targetId) => srv.sql('SELECT * FROM admin_log WHERE action = ? AND target = ? ORDER BY id', action, targetId);
async function staffMember(role) {
  const u = await srv.register(`${role}${H.hex(3)}`);
  assert.equal((await as(srv.owner, 'PUT', '/admin/staff', { userId: u.id, role, authKey: srv.owner.authKey })).status, 200);
  return u;
}
async function serverWith(owner, others) {
  const s = (await as(owner, 'POST', '/servers', { name: `s${H.hex(2)}` })).json;
  const code = (await as(owner, 'POST', `/servers/${s.id}/invites`, {})).json.code;
  for (const u of others) assert.equal((await as(u, 'POST', `/invites/${code}/join`, {})).status, 200);
  return s;
}
const makeLink = (u) => as(srv.owner, 'POST', `/admin/users/${u.id}/reset-link`, { authKey: srv.owner.authKey });

test('only the owner makes reset links, with their password, never for themselves', async () => {
  const admin = await staffMember('admin'); const mod = await staffMember('moderator');
  const u = await srv.register(); const plain = await srv.register();
  for (const who of [admin, mod, plain]) {
    const r = await as(who, 'POST', `/admin/users/${u.id}/reset-link`, { authKey: who.authKey });
    assert.equal(r.status, 403, `${who.username}: ${r.text}`);
  }
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${u.id}/reset-link`, {})).status, 401, 'needs the password');
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${u.id}/reset-link`, { authKey: H.hex(32) })).status, 401, 'the right password');
  assert.equal((await makeLink(srv.owner)).status, 400, 'not for their own account');
  assert.equal(srv.sql("SELECT COUNT(*) n FROM auth_tokens WHERE user_id = ? AND kind = 'reset'", u.id)[0].n, 0, 'nothing was made');
  // The details only show an open link to the owner.
  const r = await makeLink(u);
  assert.equal(r.status, 200, r.text);
  assert.ok(Math.abs(r.json.expiresAt - (Date.now() + 24 * 3600000)) < 60000, 'for 24 hours');
  assert.equal((await as(srv.owner, 'GET', `/admin/users/${u.id}`)).json.resetLinkUntil, r.json.expiresAt);
  assert.equal((await as(admin, 'GET', `/admin/users/${u.id}`)).json.resetLinkUntil, null);
  assert.equal(audit('password_reset_link_made', u.id).length, 1, 'in the audit log');
});

test('the person chooses a new password with it: signed out everywhere, new keys held back, and the owner who made the link can’t verify them', async () => {
  const bob = await srv.register(); const v = await srv.register();
  await serverWith(srv.owner, [bob, v]);
  const oldPub = srv.sql('SELECT public_key FROM users WHERE id = ?', v.id)[0].public_key;
  const { token } = (await makeLink(v)).json;
  // Nothing changes until it's used: their password and devices keep working.
  assert.equal((await as(v, 'GET', '/bootstrap')).status, 200);
  const info = await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token } });
  assert.equal(info.status, 200, info.text);
  assert.equal(info.json.username, v.username);
  const body = resetBody(token);
  const done = await srv.api('POST', '/auth/reset', { ip: H.newIp(), body });
  assert.equal(done.status, 200, done.text);
  assert.equal((await as(v, 'GET', '/bootstrap')).status, 401, 'their old sessions are signed out');
  assert.equal((await srv.api('POST', '/auth/reset', { ip: H.newIp(), body: resetBody(token) })).status, 400, 'it works once');
  const row = srv.sql('SELECT public_key, keys_reset_at, keys_reset_by, auth_hash FROM users WHERE id = ?', v.id)[0];
  assert.equal(row.public_key, body.publicKey);
  assert.notEqual(row.public_key, oldPub);
  assert.ok(row.keys_reset_at, 'held back until someone verifies them');
  assert.equal(row.keys_reset_by, srv.owner.id);
  assert.match(audit('password_reset_new_keys', v.id).pop().detail, /reset link from the owner/);
  // The owner can't vouch for them, as a member or as an admin.
  const asMember = await as(srv.owner, 'POST', `/users/${v.id}/keys/verify`, { publicKey: body.publicKey });
  assert.equal(asMember.status, 403, asMember.text);
  assert.equal(asMember.json.code, 'made_the_link');
  const asAdmin = await as(srv.owner, 'POST', `/admin/users/${v.id}/keys/verify`, { authKey: srv.owner.authKey });
  assert.equal(asAdmin.status, 403, asAdmin.text);
  assert.equal(asAdmin.json.code, 'made_the_link');
  assert.ok(srv.sql('SELECT keys_reset_at FROM users WHERE id = ?', v.id)[0].keys_reset_at, 'still held back');
  assert.equal((await as(srv.owner, 'GET', `/admin/users/${v.id}`)).json.keysResetByMe, true);
  // Bob, who was in a server with them before, can.
  const byBob = await as(bob, 'POST', `/users/${v.id}/keys/verify`, { publicKey: body.publicKey });
  assert.equal(byBob.status, 200, byBob.text);
  const after = srv.sql('SELECT keys_reset_at, keys_reset_by, keys_vouched_by FROM users WHERE id = ?', v.id)[0];
  assert.equal(after.keys_reset_at, null);
  assert.equal(after.keys_reset_by, null);
  assert.equal(after.keys_vouched_by, bob.id);
});

test('another admin can verify keys from the owner’s link', async () => {
  const admin = await staffMember('admin'); const v = await srv.register();
  await serverWith(srv.owner, [admin, v]);
  const { token } = (await makeLink(v)).json;
  assert.equal((await srv.api('POST', '/auth/reset', { ip: H.newIp(), body: resetBody(token) })).status, 200);
  const r = await as(admin, 'POST', `/admin/users/${v.id}/keys/verify`, { authKey: admin.authKey });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.verified, true);
});

test('two-factor sign-in is still asked for', async () => {
  const v = await srv.register();
  await H.enable2fa(srv, v);
  const { token } = (await makeLink(v)).json;
  const r = await srv.api('POST', '/auth/reset', { ip: H.newIp(), body: resetBody(token) });
  assert.notEqual(r.status, 200, 'not without their code');
  assert.equal(srv.sql('SELECT public_key FROM users WHERE id = ?', v.id)[0].public_key, v.publicKey, 'nothing changed');
});

test('one link at a time; it can be cancelled; it stops working when its maker is no longer the owner', async () => {
  const v = await srv.register();
  const first = (await makeLink(v)).json.token;
  const second = (await makeLink(v)).json.token;
  assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: first } })).status, 400, 'a new link replaces the old one');
  assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: second } })).status, 200);
  const c = await as(srv.owner, 'DELETE', `/admin/users/${v.id}/reset-link`);
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.cancelled, true);
  assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: second } })).status, 400, 'cancelled');
  assert.equal(audit('password_reset_link_cancelled', v.id).length, 1);
  assert.equal((await as(srv.owner, 'GET', `/admin/users/${v.id}`)).json.resetLinkUntil, null);
  // Handed over (node server/cli.js set-owner): the old owner's link no longer works, and the old owner can't make one.
  const third = (await makeLink(v)).json.token;
  const next = await srv.register();
  const was = srv.sql("SELECT value FROM instance_settings WHERE key = 'owner'")[0].value;
  srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", next.id);
  try {
    assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: third } })).status, 400);
    assert.equal((await makeLink(v)).status, 403);
  } finally { srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", was); }
  assert.equal((await srv.api('POST', '/auth/reset/info', { ip: H.newIp(), body: { token: third } })).status, 200, 'theirs again once they own it again');
});

test('the person is told by email when they have an address; bots and deleted accounts get none', async () => {
  const v = await srv.register();
  const email = `${v.username}@example.test`;
  await H.confirmEmail(srv, v, email);
  assert.equal((await makeLink(v)).status, 200);
  const mail = (await srv.mails()).filter((m) => m.to === email && /password reset link was made/.test(m.subject)).pop();
  assert.ok(mail, 'an email');
  assert.match(mail.text, /owner/);
  assert.doesNotMatch(mail.text, /#reset=/, 'without the link itself');
  const gone = await srv.register();
  assert.equal((await as(gone, 'DELETE', '/me', { authKey: gone.authKey, confirm: gone.username })).status, 200);
  assert.notEqual((await makeLink(gone)).status, 200);
});
