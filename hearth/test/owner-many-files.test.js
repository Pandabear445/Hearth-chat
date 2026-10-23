// The server's owner can send up to 100 files in one message; everyone else, admins included, 10 (maxFilesOf in
// server/index.js, maxFilesFor in public/js/attachments.js). A picture goes up with a thumbnail, so the server links
// twice that many uploads to a message: in channels, DMs and scheduled messages. The owner's messages also get more
// room for their ciphertext, and their uploads for messages ten times the usual pace. Handing the server over moves
// all of it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, hex } = require('./helpers');

let srv; let owner; let member; let admin; let server; let ch;
const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const cipher = (n = 60) => 'v2:' + 'A'.repeat(n - 3);
const draft = (n = 60) => 'x1:' + 'B'.repeat(n - 3);
const own = () => ({ ref: crypto.randomBytes(12).toString('hex'), draft: draft() });
const linked = (id) => srv.sql('SELECT COUNT(*) n FROM blobs WHERE message_id = ?', id)[0].n;

async function upload(u) {
  const boundary = '----hearth' + hex(8);
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    crypto.randomBytes(200), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return srv.api('POST', '/upload/encrypted', { token: u.token, ip: u.ip, raw, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
}
async function uploads(u, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await upload(u);
    assert.equal(r.status, 200, `upload ${i + 1} of ${n}: ${r.text}`);
    out.push(r.json.url);
  }
  return out;
}

before(async () => {
  srv = await startServer();
  owner = srv.owner;
  member = await srv.register('member');
  admin = await srv.register('anadmin');
  assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: admin.id, role: 'admin', authKey: owner.authKey })).status, 200);
  server = (await as(owner, 'POST', '/servers', { name: 'many files' })).json;
  const { code } = (await as(owner, 'POST', `/servers/${server.id}/invites`, {})).json;
  for (const u of [member, admin]) assert.equal((await as(u, 'POST', `/invites/${code}/join`)).status, 200);
  srv.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', server.id);
  ch = server.channels.find((c) => c.type === 'text');
});
after(async () => { if (srv) await srv.stop(); });

test('the owner: 100 files (200 uploads) in a message, uploaded faster than anyone else may', async () => {
  // 201 uploads in well under a minute: over the usual 40 a minute per session, 60 per account and 120 blobs.
  const files = await uploads(owner, 201);
  const r = await as(owner, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, files });
  assert.equal(r.status, 200, r.text);
  assert.equal(linked(r.json.id), 200, 'up to 200 linked; the one over is left for the cleanup');
  // Those counted a tenth each against the limits pictures share: making a server (its icon) right after still works.
  const made = await as(owner, 'POST', '/servers', { name: 'right after' });
  assert.equal(made.status, 200, made.text);
  // Everyone else, admins too: 10 files (20 uploads), as before.
  for (const u of [member, admin]) {
    const mine = await uploads(u, 21);
    const m = await as(u, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, files: mine });
    assert.equal(m.status, 200, m.text);
    assert.equal(linked(m.json.id), 20);
  }
});

// Fresh accounts for each part: everyone but the owner may upload 40 files a minute from one device.
async function joined(name) {
  const u = await srv.register(name);
  const { code } = (await as(owner, 'POST', `/servers/${server.id}/invites`, {})).json;
  assert.equal((await as(u, 'POST', `/invites/${code}/join`)).status, 200);
  return u;
}

test('everyone else keeps the usual pace (40 uploads a minute from one device), and everyone the per-file size', async () => {
  for (const name of ['pacer', 'adminpacer']) {
    const u = await joined(name);
    if (name === 'adminpacer') assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: u.id, role: 'admin', authKey: owner.authKey })).status, 200);
    await uploads(u, 40);
    const r = await upload(u);
    assert.equal(r.status, 429, `${name}'s 41st upload in a minute: ${r.text}`);
  }
  // The size limit is the same for the owner as for everyone (it was never meant to go).
  for (const u of [owner, member]) {
    const r = await as(u, 'POST', '/uploads', { size: 27 * 1024 * 1024 });
    assert.equal(r.status, 413, r.text);
    assert.equal(r.json.code, 'too_big');
    assert.equal((await as(u, 'GET', '/me/storage')).json.fileMb, 25);
  }
});

test('DMs and scheduled messages: the same numbers', async () => {
  const peer = await joined('peer'); const planner = await joined('planner');
  const dm = (await as(owner, 'POST', '/dms', { userId: peer.id })).json;
  const a = await as(owner, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(), files: await uploads(owner, 30) });
  assert.equal(a.status, 200, a.text);
  assert.equal(linked(a.json.id), 30);
  const b = await as(peer, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(), files: await uploads(peer, 21) });
  assert.equal(linked(b.json.id), 20);
  const sendAt = Date.now() + 3600000;
  const s1 = await as(owner, 'POST', `/channels/${ch.id}/scheduled-messages`, { ...own(), ciphertext: cipher(), epoch: 1, sendAt, files: await uploads(owner, 30) });
  assert.equal(s1.status, 200, s1.text);
  assert.equal(s1.json.files, 30);
  const s2 = await as(planner, 'POST', `/channels/${ch.id}/scheduled-messages`, { ...own(), ciphertext: cipher(), epoch: 1, sendAt, files: await uploads(planner, 21) });
  assert.equal(s2.json.files, 20);
  const s3 = await as(owner, 'POST', `/dms/${dm.id}/scheduled-messages`, { ...own(), ciphertext: cipher(), sendAt, files: await uploads(owner, 30) });
  assert.equal(s3.json.files, 30);
  // At its time, all of them go with it.
  assert.equal((await as(owner, 'POST', `/scheduled-messages/${s1.json.id}/send`)).status, 200);
  const posted = srv.sql('SELECT id FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1', ch.id)[0].id;
  assert.equal(linked(posted), 30);
  for (const x of [s2, s3]) assert.equal((await as(x === s2 ? planner : owner, 'DELETE', `/scheduled-messages/${x.json.id}`)).status, 200);
});

test('the owner’s messages may be longer (262,144 characters); everyone else’s 64,000, edits and scheduled ones too', async () => {
  const post = (u, n) => as(u, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(n), epoch: 1 });
  const big = await post(owner, 262144);
  assert.equal(big.status, 200, big.text);
  assert.equal((await post(owner, 262145)).status, 400);
  assert.equal((await as(owner, 'PATCH', `/messages/${big.json.id}`, { ciphertext: cipher(262144), epoch: 1 })).status, 200, 'an edit of it too');
  assert.equal((await as(owner, 'PATCH', `/messages/${big.json.id}`, { ciphertext: cipher(262145), epoch: 1 })).status, 400);
  for (const u of [member, admin]) {
    assert.equal((await post(u, 64000)).status, 200);
    assert.equal((await post(u, 64001)).status, 400);
  }
  const dm = (await as(owner, 'POST', '/dms', { userId: member.id })).json;
  assert.equal((await as(owner, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(262144) })).status, 200);
  assert.equal((await as(member, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(64001) })).status, 400);
  // Edits of DMs too.
  const dmBig = (await as(owner, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher() })).json;
  assert.equal((await as(owner, 'PATCH', `/dm-messages/${dmBig.id}`, { ciphertext: cipher(262144) })).status, 200);
  assert.equal((await as(owner, 'PATCH', `/dm-messages/${dmBig.id}`, { ciphertext: cipher(262145) })).status, 400);
  const dmSmall = (await as(member, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher() })).json;
  assert.equal((await as(member, 'PATCH', `/dm-messages/${dmSmall.id}`, { ciphertext: cipher(64001) })).status, 400);
  // Scheduled: the ciphertext, and the sender's own copy of it (a little longer).
  const sched = (u, n, d) => as(u, 'POST', `/channels/${ch.id}/scheduled-messages`, { ref: hex(12), draft: draft(d), ciphertext: cipher(n), epoch: 1, sendAt: Date.now() + 3600000 });
  const s = await sched(owner, 262144, 262144 + 2000);
  assert.equal(s.status, 200, s.text);
  assert.equal((await sched(owner, 262144, 262144 + 2001)).json.code, 'draft');
  assert.equal((await sched(member, 64000, 66001)).json.code, 'draft');
  assert.equal((await sched(member, 64001, 100)).status, 400);
  // …in a DM, changed later, and sent now with a new ciphertext.
  const sd = await as(owner, 'POST', `/dms/${dm.id}/scheduled-messages`, { ref: hex(12), draft: draft(264144), ciphertext: cipher(262144), sendAt: Date.now() + 3600000 });
  assert.equal(sd.status, 200, sd.text);
  assert.equal((await as(member, 'POST', `/dms/${dm.id}/scheduled-messages`, { ref: hex(12), draft: draft(), ciphertext: cipher(64001), sendAt: Date.now() + 3600000 })).status, 400);
  const changed = await as(owner, 'PATCH', `/scheduled-messages/${s.json.id}`, { ciphertext: cipher(262144), epoch: 1, draft: draft(264144) });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await as(owner, 'PATCH', `/scheduled-messages/${s.json.id}`, { ciphertext: cipher(262145), epoch: 1, draft: draft() })).status, 400);
  const ms = (await sched(member, 64000, 100)).json;
  assert.equal((await as(member, 'PATCH', `/scheduled-messages/${ms.id}`, { ciphertext: cipher(64001), epoch: 1, draft: draft() })).status, 400);
  assert.equal((await as(member, 'POST', `/scheduled-messages/${ms.id}/send`, { ciphertext: cipher(64001), epoch: 1, draft: draft() })).status, 400);
  for (const [u, x] of [[owner, s.json], [owner, sd.json], [member, ms]]) assert.equal((await as(u, 'DELETE', `/scheduled-messages/${x.id}`)).status, 200);
});

test('big files: the owner may start more resumable uploads a minute than anyone else', async () => {
  const startAndCancel = async (u) => {
    const r = await as(u, 'POST', '/uploads', { size: 10 * 1024 * 1024 });
    if (r.status === 200) assert.equal((await as(u, 'DELETE', `/uploads/${r.json.id}`)).status, 200);
    return r.status;
  };
  for (let i = 0; i < 25; i++) assert.equal(await startAndCancel(owner), 200, `the owner's upload ${i + 1}`);
  const starter = await joined('starter');
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push(await startAndCancel(starter));
  assert.deepEqual([statuses.slice(0, 20).every((x) => x === 200), statuses[20]], [true, 429], 'the 21st in a minute waits');
});

test('handing the server over moves all of it', async () => {
  const next = await joined('nextowner');
  const before = await as(next, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, files: await uploads(next, 21) });
  assert.equal(linked(before.json.id), 20);
  srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", next.id);
  try {
    const after = await as(next, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, files: await uploads(next, 24) });
    assert.equal(linked(after.json.id), 24);
    assert.equal((await as(next, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(100000), epoch: 1 })).status, 200);
    assert.equal((await as(owner, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(100000), epoch: 1 })).status, 400, 'the old owner is back to 64,000');
  } finally {
    srv.sql("UPDATE instance_settings SET value = ? WHERE key = 'owner'", owner.id);
  }
});

test('the app has the same numbers as the server', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const server = read('server', 'index.js');
  const app = read('public', 'js', 'app.js');
  const att = read('public', 'js', 'attachments.js');
  for (const [name, src] of [['MAX_FILES = 10;', att], ['OWNER_MAX_FILES = 100;', att], ['CIPHER_MAX = 64000;', app], ['OWNER_CIPHER_MAX = 262144;', app]]) {
    assert.ok(src.includes(`const ${name}`), `app: ${name}`);
    assert.ok(server.includes(`const ${name}`), `server: ${name}`);
  }
});

test('a reply to a message longer than anyone else may send leaves its ciphertext out (each reply would carry it again)', async () => {
  const big = (await as(owner, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(100000), epoch: 1 })).json;
  const small = (await as(owner, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1 })).json;
  const a = (await as(member, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, replyTo: big.id })).json;
  const b = (await as(member, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1, replyTo: small.id })).json;
  assert.equal(a.reply.big, true);
  assert.equal(a.reply.ciphertext, undefined);
  assert.equal(a.reply.id, big.id);
  assert.equal(b.reply.ciphertext.length, 60, 'a usual one is quoted whole');
  const page = (await as(member, 'GET', `/channels/${ch.id}/messages`)).json;
  const list = Array.isArray(page) ? page : page.messages;
  assert.equal(list.find((x) => x.id === a.id).reply.big, true);
  // DMs the same.
  const dm = (await as(owner, 'POST', '/dms', { userId: member.id })).json;
  const dBig = (await as(owner, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(100000) })).json;
  const dr = (await as(member, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(), replyTo: dBig.id })).json;
  assert.deepEqual([dr.reply.big, dr.reply.ciphertext], [true, undefined]);
});

test('a report keeps as many file names as the reported message’s author may send', async () => {
  const names = Array.from({ length: 50 }, (_, i) => `photo-${i + 1}.jpg`);
  const fromOwner = (await as(owner, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1 })).json;
  const fromMember = (await as(member, 'POST', `/channels/${ch.id}/messages`, { ciphertext: cipher(), epoch: 1 })).json;
  const report = async (who, m) => {
    const r = await as(who, 'POST', '/reports', { category: 'spam', context: { kind: 'message', messageId: m.id }, evidence: [{ id: m.id, text: 'x', files: names }] });
    assert.equal(r.status, 200, r.text);
    return JSON.parse(srv.sql('SELECT evidence FROM reports ORDER BY created_at DESC LIMIT 1')[0].evidence)[0].files.length;
  };
  assert.equal(await report(member, fromOwner), 50);
  assert.equal(await report(owner, fromMember), 10, 'made-up names from anyone else stop at 10');
});
