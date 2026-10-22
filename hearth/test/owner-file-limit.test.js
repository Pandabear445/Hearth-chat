// The server's owner has no size limit on files in messages (quotaOf in server/index.js: fileMb 0); everyone else,
// admins included, keeps the limit set in Admin → Storage. The owner is still held to the disk's free space, and to
// the limits on pictures and profile songs (those are processed by the server).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, hex } = require('./helpers');

const MB = 1024 * 1024;
const CHUNK = MB;
let srv; let owner;

before(async () => {
  srv = await startServer({ UPLOAD_CHUNK_BYTES: String(CHUNK) });
  owner = srv.owner;
});
after(async () => { if (srv) await srv.stop(); });

const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const start = (u, size) => as(u, 'POST', '/uploads', { size });
async function chunked(u, bytes) {
  const s = await start(u, bytes.length);
  if (s.status !== 200) return s;
  for (let off = 0; off < bytes.length; off += s.json.chunkSize) {
    const r = await srv.api('PUT', `/uploads/${s.json.id}?offset=${off}`, { token: u.token, ip: u.ip, raw: bytes.subarray(off, off + s.json.chunkSize), headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(r.status, 200, r.text);
  }
  return as(u, 'POST', `/uploads/${s.json.id}/complete`, { sha256: sha(bytes) });
}
async function single(u, bytes) {
  const boundary = '----hearth' + hex(8);
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return srv.api('POST', '/upload/encrypted', { token: u.token, ip: u.ip, raw, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, timeout: 30000 });
}

test('the owner sends files of any size; members and admins keep the limit', async () => {
  const member = await srv.register('member');
  const admin = await srv.register('anadmin');
  assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: admin.id, role: 'admin', authKey: owner.authKey })).status, 200);
  assert.equal((await as(owner, 'PUT', '/admin/limits', { fileMb: 1 })).status, 200);
  try {
    const big = crypto.randomBytes(3 * MB); // three times the limit (1 MB, plus 1 MB for the encryption overhead)
    // Everyone else is turned down, both ways of uploading.
    for (const u of [member, admin]) {
      const r = await start(u, big.length);
      assert.equal(r.status, 413, r.text);
      assert.equal(r.json.code, 'too_big');
      assert.equal((await single(u, big)).status, 413);
      assert.equal((await as(u, 'GET', '/me/storage')).json.fileMb, 1);
    }
    // The owner isn't, either way.
    const done = await chunked(owner, big);
    assert.equal(done.status, 200, done.text);
    assert.match(done.json.url, /^\/uploads\/\w+\.bin$/);
    const one = await single(owner, big);
    assert.equal(one.status, 200, one.text);
    assert.equal((await as(owner, 'GET', '/me/storage')).json.fileMb, 0, 'Settings → Storage says: no limit');
    // Way over any limit there ever was: started fine (and cancelled again).
    const huge = await start(owner, 5000 * MB);
    assert.equal(huge.status, 200, huge.text);
    assert.equal((await as(owner, 'DELETE', `/uploads/${huge.json.id}`)).status, 200);
    // But never more than the disk has room for.
    const r = await start(owner, 2 ** 50);
    assert.equal(r.status, 507, r.text);
    assert.equal(r.json.code, 'disk_full');
    // Everyone sees the server's limit in its settings; the app works out the owner's from their role.
    assert.equal((await srv.api('GET', '/config')).json.maxUploadMb, 1);
  } finally {
    assert.equal((await as(owner, 'PUT', '/admin/limits', { fileMb: 25 })).status, 200);
  }
});

test('handing the server over moves the exemption with it', async () => {
  const next = await srv.register('nextowner');
  const old = owner;
  assert.equal((await as(old, 'GET', '/me/storage')).json.fileMb, 0);
  assert.equal((await as(next, 'GET', '/me/storage')).json.fileMb, 25);
  srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", next.id);
  assert.equal((await as(next, 'GET', '/me/storage')).json.fileMb, 0);
  assert.equal((await as(old, 'GET', '/me/storage')).json.fileMb, 25);
  assert.equal((await start(old, 30 * MB)).json.code, 'too_big');
  srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", old.id);
});
