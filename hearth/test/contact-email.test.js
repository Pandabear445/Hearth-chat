// The owner's contact email (Admin > Owner): public in /api/config so people who can't get back in by themselves (an
// account with no email gets no reset link) know where to write. Changing it needs the password, like the donation
// link: a stolen session mustn't be able to send those people somewhere else. CONTACT_EMAIL in .env is the default.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, hex } = require('./helpers');

let srv; let owner; let admin;
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const config = async () => (await srv.api('GET', '/config')).json;

before(async () => {
  srv = await startServer({ CONTACT_EMAIL: 'hello@hearth.example.test' });
  owner = srv.owner;
  admin = await srv.register('admin');
  assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: admin.id, role: 'admin', authKey: owner.authKey })).status, 200);
});
after(async () => { await srv.stop(); });

test('CONTACT_EMAIL is the starting value, in /api/config for anyone (signed in or not) and in the owner settings', async () => {
  assert.equal((await config()).contactEmail, 'hello@hearth.example.test');
  assert.equal((await as(owner, 'GET', '/admin/owner')).json.contactEmail, 'hello@hearth.example.test');
});

test('changing it needs the owner and their password; a wrong one changes nothing', async () => {
  assert.ok([401, 403].includes((await as(admin, 'PUT', '/admin/owner', { contactEmail: 'evil@example.test', authKey: admin.authKey })).status), 'not an admin');
  assert.equal((await as(owner, 'PUT', '/admin/owner', { contactEmail: 'evil@example.test' })).status, 401, 'no password');
  assert.equal((await as(owner, 'PUT', '/admin/owner', { contactEmail: 'evil@example.test', authKey: hex(32) })).status, 401, 'wrong password');
  assert.equal((await config()).contactEmail, 'hello@hearth.example.test');
  const ok = await as(owner, 'PUT', '/admin/owner', { contactEmail: '  owner@hearth.example.test ', authKey: owner.authKey });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await config()).contactEmail, 'owner@hearth.example.test');
});

test('saving other owner settings, or the same address again, needs no password', async () => {
  assert.equal((await as(owner, 'PUT', '/admin/owner', { brand: { tagline: 'Pull up a chair' } })).status, 200);
  assert.equal((await as(owner, 'PUT', '/admin/owner', { contactEmail: 'owner@hearth.example.test' })).status, 200);
  assert.equal((await config()).contactEmail, 'owner@hearth.example.test');
});

test('only an email address is taken', async () => {
  for (const bad of ['not an email', 'a@b', '<x@y.test>', 'x@y.test\nBcc: z@w.test', 'javascript:alert(1)@x.test', `${'a'.repeat(65)}@x.test`]) {
    const r = await as(owner, 'PUT', '/admin/owner', { contactEmail: bad, authKey: owner.authKey });
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await config()).contactEmail, 'owner@hearth.example.test');
});

test('clearing it hides it, and CONTACT_EMAIL doesn’t come back', async () => {
  assert.equal((await as(owner, 'PUT', '/admin/owner', { contactEmail: '', authKey: owner.authKey })).status, 200);
  assert.equal((await config()).contactEmail, null);
  assert.equal((await as(owner, 'GET', '/admin/owner')).json.contactEmail, null);
});

test('the app shows it where people who can’t get in look: Forgot your password, and Settings > Security', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', ...p), 'utf8');
  const app = read('app.js');
  assert.match(app, /function noEmailHelp\(\) \{\n  const to = S\.config\.contactEmail;/);
  assert.match(app, /h\('a', \{ href: `mailto:\$\{to\}\?subject=\$\{encodeURIComponent\(/);
  assert.match(read('settings.js'), /Email the owner: ', contactLink\(S\.config\)/);
  // The owner's field saves through the password check.
  assert.match(read('admin.js'), /saveConfirmed\(\{ contactEmail: contact\.value\.trim\(\) \}/);
});
