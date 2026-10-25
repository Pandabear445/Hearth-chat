// Photos & videos (schema v21, server/photos.js): how many uploads each message listed (messages.files), the panel's
// pages and its ?ids= lookups, comments on one photo (replyFile and the per-photo counts), and end-to-end encrypted
// tags on photos: who may add and remove them, their caps and shapes, the live events, and that every way of deleting
// a message takes its tags with it. Checked in DMs, group chats and server channels, with join history and blocks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, hex, sleep } = require('./helpers');

const DENIED = [403, 404];
const P = { VIEW: 1, SEND: 1 << 1, MANAGE_MESSAGES: 1 << 5 };
let srv;
let alice; let bob; let carol; let dave; let eve; let mod;
let space; let general; let dm; let group; let groupChat; let inviteCode;
const socks = [];
const as = (u, method, p, body, s = srv) => s.api(method, p, { token: u.token, ip: u.ip, body });
const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');
const b64 = (n) => crypto.randomBytes(n).toString('base64');
// Tags exactly as the apps seal them (public/js/e2ee.js): one 256-byte padded payload, so 272 bytes with the GCM tag.
const tagD = () => `td1:${b64(32)}:${b64(12)}:${b64(272)}`;
const tagC = (epoch = 1, sig = 64) => `tc1:${epoch}:${b64(32)}:${b64(12)}:${b64(272)}:${b64(sig)}`;
const tagId = () => crypto.randomBytes(16).toString('base64url');
const freshEpoch = (sid, s = srv) => s.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', sid);
const sock = async (u, s = srv) => { const x = await s.socket(u.token); socks.push(x); return x; };
const collect = (x, ev) => { const got = []; x.on(ev, (p) => got.push(p)); return got; };
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(30); } return false; }
const row = (table, id, s = srv) => s.sql(`SELECT * FROM ${table} WHERE id = ?`, id)[0];
const tagRows = (messageId, s = srv) => s.sql('SELECT * FROM media_tags WHERE message_id = ?', messageId);
// Time-sorted ids like newId(), for rows written straight into the database.
let seq = 0;
const idAt = (t) => t.toString(36).padStart(9, '0') + hex(5);
const nextId = () => idAt(Date.now() - 3600000 + (seq++) * 10);
// Rows written directly (tests that need many: posting goes through the per-person message limits).
function insertDm(dmId, author, { id = nextId(), files = 0, replyTo = null, replyFile = null, expiresAt = null } = {}, s = srv) {
  s.sql('INSERT INTO dm_messages (id, dm_id, author_id, ciphertext, reply_to, created_at, expires_at, files, reply_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, dmId, author.id, cipher(), replyTo, Date.now(), expiresAt, files, replyFile);
  return id;
}
function insertC(channelId, author, { id = nextId(), files = 0, replyTo = null, replyFile = null, threadId = null, epoch = 1, at = Date.now(), expiresAt = null } = {}, s = srv) {
  s.sql('INSERT INTO messages (id, channel_id, author_id, body, ciphertext, epoch, reply_to, created_at, thread_id, expires_at, files, reply_file) VALUES (?, ?, ?, \'\', ?, ?, ?, ?, ?, ?, ?, ?)',
    id, channelId, author.id, cipher(), epoch, replyTo, at, threadId, expiresAt, files, replyFile);
  return id;
}
function insertTag(messageId, conv, author, { fileIdx = 0, epoch = null, at = Date.now() } = {}, s = srv) {
  const id = tagId();
  s.sql('INSERT INTO media_tags (id, message_id, conv, file_idx, author_id, ciphertext, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, messageId, conv, fileIdx, author.id, epoch == null ? tagD() : tagC(epoch), epoch, at);
  return id;
}
async function upload(u, s = srv) {
  const boundary = '----hearth' + hex(8);
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    crypto.randomBytes(200), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = await s.api('POST', '/upload/encrypted', { token: u.token, ip: u.ip, raw, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(r.status, 200, r.text);
  return r.json.url;
}
const uploads = async (u, n, s = srv) => { const out = []; for (let i = 0; i < n; i++) out.push(await upload(u, s)); return out; };
async function sendD(u, dmId, extra = {}, s = srv) {
  const r = await as(u, 'POST', `/dms/${dmId}/messages`, { ciphertext: cipher(), ...extra }, s);
  assert.equal(r.status, 200, r.text);
  return r.json;
}
async function sendC(u, channelId, extra = {}, s = srv) {
  const r = await as(u, 'POST', `/channels/${channelId}/messages`, { ciphertext: cipher(), epoch: 1, ...extra }, s);
  assert.equal(r.status, 200, r.text);
  return r.json;
}
// A channel's permission overrides (the route takes the whole list).
async function overrides(channelId, list) {
  const r = await as(alice, 'PUT', `/channels/${channelId}/overrides`, { overrides: list });
  assert.equal(r.status, 200, r.text);
}
const linked = (id, s = srv) => s.sql('SELECT COUNT(*) n FROM blobs WHERE message_id = ?', id)[0].n;
async function member(name) {
  const u = await srv.register(`${name}${hex(3)}`);
  assert.equal((await as(u, 'POST', `/invites/${inviteCode}/join`)).status, 200);
  return u;
}
async function newDm(a, b) {
  const r = await as(a, 'POST', '/dms', { userId: b.id });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

before(async () => {
  srv = await startServer({ DISAPPEAR_SWEEP_MS: '3600000' }); // the sweep never runs here: a separate server tests it
  alice = await srv.register(`alice${hex(3)}`); bob = await srv.register(`bob${hex(3)}`); carol = await srv.register(`carol${hex(3)}`);
  dave = await srv.register(`dave${hex(3)}`); eve = await srv.register(`eve${hex(3)}`); mod = await srv.register(`mod${hex(3)}`);
  space = (await as(alice, 'POST', '/servers', { name: 'Photo HQ' })).json;
  general = space.channels.find((c) => c.type === 'text');
  inviteCode = (await as(alice, 'POST', `/servers/${space.id}/invites`, {})).json.code;
  for (const u of [bob, carol, dave, mod]) assert.equal((await as(u, 'POST', `/invites/${inviteCode}/join`)).status, 200);
  const role = (await as(alice, 'POST', `/servers/${space.id}/roles`, { name: 'mods', permissions: P.VIEW | P.SEND | P.MANAGE_MESSAGES })).json;
  assert.equal((await as(alice, 'PUT', `/servers/${space.id}/members/${mod.id}/roles`, { roleIds: [role.id] })).status, 200);
  freshEpoch(space.id);
  dm = await newDm(alice, bob);
  group = (await as(alice, 'POST', '/groups', { userIds: [bob.id] })).json;
  groupChat = group.channels.find((c) => c.type === 'text');
  freshEpoch(group.id);
});
after(async () => { socks.forEach((x) => x.close()); await srv.stop(); });

// ------------------------------------------------------------------ files
test('files counts the uploads a message listed: distinct, well-formed, thumbnails and forwards included, capped like attachBlobs', async () => {
  const [u1, u2, u3] = await uploads(alice, 3);
  const a = await sendD(alice, dm.id, { files: [u1, u2, u1, '/uploads/../../etc/passwd', 7, null, { url: u3 }, 'uploads/x.bin', '/uploads/ABC.bin'] });
  assert.equal(row('dm_messages', a.id).files, 2, 'u1 and u2, once each');
  assert.equal(linked(a.id), 2);
  // A forward lists the original's uploads again: they stay the original's blobs, but the forward has files too.
  const fwd = await sendD(bob, dm.id, { files: [u1, u2] });
  assert.equal(linked(fwd.id), 0, 'not linked to the forward');
  assert.equal(row('dm_messages', fwd.id).files, 2, 'but counted');
  // No files, or not a list: 0.
  assert.equal(row('dm_messages', (await sendD(alice, dm.id)).id).files, 0);
  assert.equal(row('dm_messages', (await sendD(alice, dm.id, { files: 'nope' })).id).files, 0);
  // Up to what one message may carry: 10 files with a thumbnail each for anyone but the instance's owner.
  const many = Array.from({ length: 30 }, () => `/uploads/${hex(8)}.bin`);
  assert.equal(row('dm_messages', (await sendD(alice, dm.id, { files: many })).id).files, 20);
  // Channels the same, thread replies included; an edit changes nothing.
  const c1 = await sendC(alice, general.id, { files: [u3, u3, u1] });
  assert.equal(row('messages', c1.id).files, 2);
  const reply = await sendC(bob, general.id, { threadId: c1.id, files: [u1] });
  assert.equal(row('messages', reply.id).files, 1);
  assert.equal((await as(alice, 'PATCH', `/messages/${c1.id}`, { ciphertext: cipher(), epoch: 1 })).status, 200);
  assert.equal(row('messages', c1.id).files, 2);
});

test('scheduled messages keep the count of what they listed (a forward’s included) and post with it', async () => {
  const [u1] = await uploads(carol, 1);
  const [mine] = await uploads(alice, 1);
  const d = await newDm(carol, dave);
  const parent = await sendD(dave, d.id, { files: [await upload(dave), await upload(dave)] });
  const ref = () => crypto.randomBytes(12).toString('base64url');
  const base = () => ({ ciphertext: cipher(), ref: ref(), draft: 'x1:' + b64(40), sendAt: Date.now() + 3600000 });
  // A bad photo number is refused, as for a message sent now.
  for (const replyFile of ['1', -1, 100, 1.5, true, [0]]) {
    const r = await as(carol, 'POST', `/dms/${d.id}/scheduled-messages`, { ...base(), replyTo: parent.id, replyFile });
    assert.equal(r.status, 400, `replyFile ${JSON.stringify(replyFile)}: ${r.text}`);
    assert.equal(r.json.code, 'bad_reply_file');
  }
  // Carol's own upload, and Alice's (not hers to link: like a forward of Alice's message).
  const s = await as(carol, 'POST', `/dms/${d.id}/scheduled-messages`, { ...base(), files: [u1, mine], replyTo: parent.id, replyFile: 1 });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.json.files, 1, 'it holds one blob');
  assert.equal(s.json.replyFile, 1);
  assert.equal(row('scheduled_messages', s.json.id).file_count, 2, 'and listed two');
  // New ciphertext may say which photo again; left out, it stays.
  const p = await as(carol, 'PATCH', `/scheduled-messages/${s.json.id}`, { ciphertext: cipher(), draft: 'x1:' + b64(40), replyFile: 0 });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.replyFile, 0);
  assert.equal((await as(carol, 'PATCH', `/scheduled-messages/${s.json.id}`, { ciphertext: cipher(), draft: 'x1:' + b64(40) })).json.replyFile, 0);
  const sent = await as(carol, 'POST', `/scheduled-messages/${s.json.id}/send`, {});
  assert.equal(sent.status, 200, sent.text);
  const m = row('dm_messages', sent.json.message.id);
  assert.equal(m.files, 2, 'posted with both');
  assert.equal(m.reply_file, 0);
  assert.equal(sent.json.message.replyFile, 0);
  assert.equal(linked(m.id), 1, 'its own blob was handed over');
  // In a channel too.
  const c = await as(carol, 'POST', `/channels/${general.id}/scheduled-messages`, { ...base(), epoch: 1, files: [await upload(carol), mine] });
  assert.equal(c.status, 200, c.text);
  const posted = await as(carol, 'POST', `/scheduled-messages/${c.json.id}/send`, {});
  assert.equal(posted.status, 200, posted.text);
  assert.equal(row('messages', posted.json.message.id).files, 2);
  assert.equal(posted.json.message.replyFile, null);
});

// ------------------------------------------------------------------ the panel's pages
test('Photos & videos pages: messages with files only, newest first, paged by before with next, limits kept', async () => {
  const p = await srv.register(`pager${hex(3)}`); const q = await srv.register(`pagee${hex(3)}`);
  // Written straight in: they share no server, and 100 messages would take a while through the message limits.
  const d = { id: 'dmpage' + hex(4) };
  srv.sql('INSERT INTO dm_channels (id, user_a, user_b, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)', d.id, ...[p.id, q.id].sort(), Date.now(), Date.now());
  const withFiles = [];
  for (let i = 0; i < 100; i++) {
    const id = insertDm(d.id, i % 2 ? p : q, { files: i % 3 === 0 ? 0 : 1 + (i % 4) });
    if (i % 3 !== 0) withFiles.push(id);
  }
  insertDm(d.id, p, { files: 2, expiresAt: Date.now() - 1000 }); // its time has passed: never listed, even before the sweep
  const want = [...withFiles].reverse();
  // Default page: 30, newest first.
  const first = await as(p, 'GET', `/dms/${d.id}/media`);
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.json.messages.map((m) => m.id), want.slice(0, 30));
  assert.equal(first.json.next, want[29]);
  // Every page in turn: no repeats, nothing left out, next is null on the last one.
  const seen = [];
  let next = null; let pages = 0;
  do {
    const r = await as(q, 'GET', `/dms/${d.id}/media?limit=7${next ? `&before=${next}` : ''}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.messages.length <= 7);
    seen.push(...r.json.messages.map((m) => m.id));
    next = r.json.next;
    if (next) assert.equal(next, r.json.messages[r.json.messages.length - 1].id);
    pages++;
  } while (next && pages < 30);
  assert.deepEqual(seen, want);
  assert.equal(pages, Math.ceil(want.length / 7) + (want.length % 7 === 0 ? 1 : 0));
  // limit is kept between 1 and 60.
  assert.ok(want.length > 60);
  assert.deepEqual((await as(p, 'GET', `/dms/${d.id}/media?limit=1000`)).json.messages.map((m) => m.id), want.slice(0, 60));
  assert.equal((await as(p, 'GET', `/dms/${d.id}/media?limit=0`)).json.messages.length, 30);
  assert.equal((await as(p, 'GET', `/dms/${d.id}/media?limit=-5`)).json.messages.length, 1);
  assert.equal((await as(p, 'GET', `/dms/${d.id}/media?limit=abc`)).json.messages.length, 30);
  // A short page says there's nothing older.
  const last = await as(p, 'GET', `/dms/${d.id}/media?before=${want[want.length - 3]}`);
  assert.deepEqual(last.json.messages.map((m) => m.id), want.slice(-2));
  assert.equal(last.json.next, null);
  // A bad cursor is a 400, never a server error.
  for (const bad of ['a b', 'x'.repeat(65), "1' OR '1'='1"]) assert.equal((await as(p, 'GET', `/dms/${d.id}/media?before=${encodeURIComponent(bad)}`)).status, 400, bad);
  assert.equal((await as(p, 'GET', `/dms/${d.id}/media?before=a&before=b`)).status, 400);
  // Serialized like history: the extras are there.
  const m = first.json.messages[0];
  assert.equal(m.dmId, d.id);
  assert.equal(m.replyFile, null);
  assert.ok(Array.isArray(m.reactions));
});

test('Photos & videos pages in channels: thread replies included, other channels and expired messages left out', async () => {
  const room = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'pics', type: 'text' })).json;
  const top = insertC(room.id, alice, { files: 2 });
  const plain = insertC(room.id, bob);
  const reply = insertC(room.id, bob, { files: 1, threadId: top });
  const elsewhere = insertC(general.id, alice, { files: 4 });
  const gone = insertC(room.id, bob, { files: 1, expiresAt: Date.now() - 1000 });
  const r = await as(carol, 'GET', `/channels/${room.id}/media`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.messages.map((m) => m.id), [reply, top]);
  assert.equal(r.json.messages[0].threadId, top);
  assert.equal(r.json.next, null);
  for (const id of [plain, elsewhere, gone]) assert.ok(!r.text.includes(id));
  // A group chat is a channel too.
  const g = insertC(groupChat.id, bob, { files: 1 });
  const gr = await as(alice, 'GET', `/channels/${groupChat.id}/media`);
  assert.equal(gr.status, 200, gr.text);
  assert.ok(gr.json.messages.some((m) => m.id === g));
});

test('?ids= gives just those messages (the tag filter): with files, in this conversation, alive; at most 100', async () => {
  const a = insertDm(dm.id, alice, { files: 2 });
  const b = insertDm(dm.id, bob, { files: 1 });
  const none = insertDm(dm.id, bob);
  const expired = insertDm(dm.id, bob, { files: 1, expiresAt: Date.now() - 1000 });
  const other = insertDm((await newDm(alice, carol)).id, carol, { files: 1 });
  const chan = insertC(general.id, alice, { files: 1 });
  const r = await as(bob, 'GET', `/dms/${dm.id}/media?ids=${[a, none, b, expired, other, chan, 'nothere', a].join(',')}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.messages.map((m) => m.id), [b, a], 'newest first, each once');
  assert.equal(r.json.next, null);
  const c = await as(bob, 'GET', `/channels/${general.id}/media?ids=${[chan, a].join(',')}`);
  assert.deepEqual(c.json.messages.map((m) => m.id), [chan]);
  // ids wins over before; bad lists are refused.
  assert.deepEqual((await as(bob, 'GET', `/dms/${dm.id}/media?ids=${a}&before=${a}`)).json.messages.map((m) => m.id), [a]);
  const many = Array.from({ length: 101 }, () => 'x' + hex(4)).join(',');
  for (const q of [`ids=${many}`, 'ids=', 'ids=a,,b', 'ids=a%20b', 'ids[]=a', `ids=${'x'.repeat(65)}`]) {
    const bad = await as(bob, 'GET', `/dms/${dm.id}/media?${q}`);
    assert.equal(bad.status, 400, `${q.slice(0, 40)} → ${bad.status}`);
    assert.equal(bad.json.code, 'bad_ids');
  }
  assert.equal((await as(bob, 'GET', `/dms/${dm.id}/media?ids=${Array.from({ length: 100 }, () => 'x' + hex(4)).join(',')}`)).status, 200, '100 is fine');
});

// ------------------------------------------------------------------ comments on one photo
test('replyFile: a whole number from 0 to 99, kept only on a reply to a message with that many files', async () => {
  const eve = await member('rf');
  const d = await newDm(carol, eve);
  const photo = await sendD(carol, d.id, { files: [await upload(carol), await upload(carol), await upload(carol), await upload(carol)] });
  const text = await sendD(carol, d.id);
  for (const replyFile of ['1', -1, 100, 2.5, true, [1], { i: 1 }]) {
    const r = await as(eve, 'POST', `/dms/${d.id}/messages`, { ciphertext: cipher(), replyTo: photo.id, replyFile });
    assert.equal(r.status, 400, `${JSON.stringify(replyFile)}: ${r.text}`);
    assert.equal(r.json.code, 'bad_reply_file');
    const c = await as(bob, 'POST', `/channels/${general.id}/messages`, { ciphertext: cipher(), epoch: 1, replyTo: photo.id, replyFile });
    assert.equal(c.status, 400, `channel ${JSON.stringify(replyFile)}`);
  }
  assert.equal((await sendD(eve, d.id, { replyFile: 1 })).replyFile, null, 'no reply: not a comment');
  assert.equal((await sendD(eve, d.id, { replyTo: text.id, replyFile: 0 })).replyFile, null, 'a message without files');
  assert.equal((await sendD(eve, d.id, { replyTo: photo.id, replyFile: 4 })).replyFile, null, 'past its uploads');
  assert.equal((await sendD(eve, d.id, { replyTo: 'nothere', replyFile: 0 })).replyFile, null, 'a reply to nothing');
  const ok = await sendD(eve, d.id, { replyTo: photo.id, replyFile: 3, replyFileExtra: 'ignored' });
  assert.equal(ok.replyFile, 3);
  assert.equal(row('dm_messages', ok.id).reply_file, 3);
  assert.equal((await sendD(eve, d.id, { replyTo: photo.id, replyFile: null })).replyFile, null);
  // A reply into another conversation isn't one (replyTo is dropped, and the photo with it).
  const elsewhere = await sendC(bob, general.id, { replyTo: photo.id, replyFile: 0 });
  assert.equal(elsewhere.replyTo, null);
  assert.equal(elsewhere.replyFile, null);
});

test('comment counts per photo: on every page, live on posting and deleting, leaving out comments whose time has passed', async () => {
  const eve = await member('cc');
  const d = await newDm(dave, eve);
  const photo = await sendD(dave, d.id, { files: await uploads(dave, 3) });
  const ds = await sock(dave); const es = await sock(eve); const outsider = await sock(carol);
  const got = { dave: collect(ds, 'dm:file-replies'), eve: collect(es, 'dm:file-replies'), carol: collect(outsider, 'dm:file-replies') };
  const c1 = await sendD(eve, d.id, { replyTo: photo.id, replyFile: 0 });
  const c2 = await sendD(dave, d.id, { replyTo: photo.id, replyFile: 0 });
  const c3 = await sendD(eve, d.id, { replyTo: photo.id, replyFile: 2 });
  await sendD(eve, d.id, { replyTo: photo.id }); // a plain reply isn't a comment
  assert.ok(await until(() => got.dave.length === 3 && got.eve.length === 3));
  assert.deepEqual(got.eve[2], { id: photo.id, dmId: d.id, fileReplies: { 0: 2, 2: 1 } });
  const counts = async () => (await as(eve, 'GET', `/dms/${d.id}/messages`)).json.messages.find((m) => m.id === photo.id).fileReplies;
  assert.deepEqual(await counts(), { 0: 2, 2: 1 });
  assert.deepEqual((await as(dave, 'GET', `/dms/${d.id}/media`)).json.messages.find((m) => m.id === photo.id).fileReplies, { 0: 2, 2: 1 });
  assert.deepEqual((await as(dave, 'GET', `/dms/${d.id}/messages?around=${photo.id}`)).json.messages.find((m) => m.id === photo.id).fileReplies, { 0: 2, 2: 1 });
  // Pins and search pages carry them too.
  assert.equal((await as(dave, 'POST', `/messages/${photo.id}/pin`)).status, 200);
  assert.deepEqual((await as(dave, 'GET', `/dms/${d.id}/pins`)).json.find((m) => m.id === photo.id).fileReplies, { 0: 2, 2: 1 });
  const found = await as(dave, 'GET', `/search/messages?scope=d:${d.id}`);
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(found.json.messages.find((m) => m.id === photo.id).fileReplies, { 0: 2, 2: 1 });
  // A message without comments has none.
  assert.equal(found.json.messages.find((m) => m.id === c1.id).fileReplies, undefined);
  // Deleting one: the photo's new count goes out.
  assert.equal((await as(eve, 'DELETE', `/dm-messages/${c3.id}`)).status, 200);
  assert.ok(await until(() => got.dave.length === 4));
  assert.deepEqual(got.dave[3].fileReplies, { 0: 2 });
  // One whose time has passed doesn't count, even before the sweep.
  srv.sql('UPDATE dm_messages SET expires_at = ? WHERE id = ?', Date.now() - 1000, c2.id);
  assert.deepEqual(await counts(), { 0: 1 });
  await sleep(200);
  assert.equal(got.carol.length, 0, 'nobody outside the DM hears about it');
});

test('comment counts in channels go to whoever can see the message', async () => {
  const hidden = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'closed', type: 'text' })).json;
  await overrides(hidden.id, [{ type: 'role', id: space.id, allow: 0, deny: P.VIEW }, { type: 'member', id: bob.id, allow: P.VIEW | P.SEND, deny: 0 }]);
  const photo = await sendC(alice, hidden.id, { files: await uploads(alice, 2) });
  const bs = await sock(bob); const cs = await sock(carol);
  const onBob = collect(bs, 'message:file-replies'); const onCarol = collect(cs, 'message:file-replies');
  const comment = await sendC(bob, hidden.id, { replyTo: photo.id, replyFile: 1 });
  assert.equal(comment.replyFile, 1);
  assert.ok(await until(() => onBob.length === 1));
  assert.deepEqual(onBob[0], { id: photo.id, channelId: hidden.id, threadId: null, fileReplies: { 1: 1 } });
  // A comment as a thread reply counts too; deleting the thread takes its comments' counts away.
  const root = await sendC(alice, hidden.id);
  await sendC(bob, hidden.id, { threadId: root.id, replyTo: photo.id, replyFile: 0 });
  assert.ok(await until(() => onBob.length === 2));
  assert.deepEqual(onBob[1].fileReplies, { 0: 1, 1: 1 });
  assert.equal((await as(alice, 'DELETE', `/messages/${root.id}`)).status, 200);
  assert.ok(await until(() => onBob.length === 3));
  assert.deepEqual(onBob[2].fileReplies, { 1: 1 });
  await sleep(200);
  assert.equal(onCarol.length, 0, 'not to members who can’t see the channel');
});

test('GET comments: the replies on that photo (or any photo), oldest first, paged with after and next', async () => {
  const d = await newDm(alice, dave);
  const photo = insertDm(d.id, alice, { files: 6 });
  const other = insertDm(d.id, alice, { files: 6 });
  const on = { 0: [], 1: [] };
  for (let i = 0; i < 9; i++) on[i % 2].push(insertDm(d.id, i % 3 ? dave : alice, { replyTo: photo, replyFile: i % 2 }));
  insertDm(d.id, dave, { replyTo: photo }); // a plain reply
  insertDm(d.id, dave, { replyTo: other, replyFile: 0 }); // on another message
  insertDm(d.id, dave, { replyTo: photo, replyFile: 0, expiresAt: Date.now() - 1000 }); // gone
  const all = (await as(dave, 'GET', `/dm-messages/${photo}/comments`)).json;
  assert.deepEqual(all.messages.map((m) => m.id), [...on[0], ...on[1]].sort());
  assert.equal(all.next, null);
  const just = (await as(dave, 'GET', `/dm-messages/${photo}/comments?file=1`)).json;
  assert.deepEqual(just.messages.map((m) => m.id), on[1]);
  assert.ok(just.messages.every((m) => m.replyTo === photo && m.replyFile === 1));
  // Paging.
  const p1 = (await as(alice, 'GET', `/dm-messages/${photo}/comments?file=0&limit=2`)).json;
  assert.deepEqual(p1.messages.map((m) => m.id), on[0].slice(0, 2));
  assert.equal(p1.next, on[0][1]);
  const p2 = (await as(alice, 'GET', `/dm-messages/${photo}/comments?file=0&limit=2&after=${p1.next}`)).json;
  assert.deepEqual(p2.messages.map((m) => m.id), on[0].slice(2, 4));
  const p3 = (await as(alice, 'GET', `/dm-messages/${photo}/comments?file=0&limit=2&after=${p2.next}`)).json;
  assert.deepEqual(p3.messages.map((m) => m.id), on[0].slice(4));
  assert.equal(p3.next, null);
  for (const q of ['file=100', 'file=-1', 'file=a', 'file=1.5', 'after=a%20b', 'file=1&file=2']) assert.equal((await as(dave, 'GET', `/dm-messages/${photo}/comments?${q}`)).status, 400, q);
  // Channels, thread replies included.
  const cp = insertC(general.id, alice, { files: 2 });
  const root = insertC(general.id, bob);
  const inThread = insertC(general.id, carol, { threadId: root, replyTo: cp, replyFile: 1 });
  const top = insertC(general.id, bob, { replyTo: cp, replyFile: 0 });
  const r = await as(mod, 'GET', `/messages/${cp}/comments`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.messages.map((m) => m.id), [inThread, top]);
  assert.equal(r.json.messages[0].threadId, root);
  // Only for people who can see the photo's message, and only while it's there.
  for (const [u, p] of [[eve, `/dm-messages/${photo}/comments`], [bob, `/dm-messages/${photo}/comments`], [eve, `/messages/${cp}/comments`], [dave, '/messages/nothere/comments']]) {
    const x = await as(u, 'GET', p);
    assert.equal(x.status, 404, p);
    assert.equal(x.json.error || x.json.message, 'Message not found.');
  }
  srv.sql('UPDATE dm_messages SET expires_at = ? WHERE id = ?', Date.now() - 1000, photo);
  assert.equal((await as(dave, 'GET', `/dm-messages/${photo}/comments`)).status, 404, 'a photo whose time has passed is gone');
});

// ------------------------------------------------------------------ tags in DMs
test('tags in DMs: shape, photo, caps and duplicates; on every message they’re on and in the conversation’s list', async () => {
  const d = await newDm(carol, mod);
  const photo = await sendD(carol, d.id, { files: await uploads(carol, 4) });
  const cs = await sock(carol); const ms = await sock(mod); const os = await sock(alice);
  const ev = { carol: collect(cs, 'dm:tags'), mod: collect(ms, 'dm:tags'), alice: collect(os, 'dm:tags') };
  const add = (u, body) => as(u, 'POST', `/dm-messages/${photo.id}/tags`, body);
  // Shapes the apps never make.
  const bads = [
    [{ id: 'short', fileIdx: 0, ciphertext: tagD() }, 'bad_tag'],
    [{ id: tagId() + '=', fileIdx: 0, ciphertext: tagD() }, 'bad_tag'],
    [{ fileIdx: 0, ciphertext: tagD() }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 4, ciphertext: tagD() }, 'bad_file'],
    [{ id: tagId(), fileIdx: -1, ciphertext: tagD() }, 'bad_file'],
    [{ id: tagId(), fileIdx: '0', ciphertext: tagD() }, 'bad_file'],
    [{ id: tagId(), fileIdx: 0.5, ciphertext: tagD() }, 'bad_file'],
    [{ id: tagId(), fileIdx: 0, ciphertext: tagC() }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: `d2:${b64(32)}:${b64(12)}:${b64(272)}` }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: `td1:${b64(32)}:${b64(12)}:${b64(288)}` }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: `td1:${b64(31)}:${b64(12)}:${b64(272)}` }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: `td1:${b64(32)}:${b64(12)}:${b64(272).replace(/=+$/, '')}` }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: tagD() + ':x' }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: ['td1'] }, 'bad_tag'],
    [{ id: tagId(), fileIdx: 0, ciphertext: 'x'.repeat(5000) }, 'bad_tag'],
  ];
  for (const [body, code] of bads) {
    const r = await add(mod, body);
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)}: ${r.text}`);
    assert.equal(r.json.code, code);
  }
  assert.equal(tagRows(photo.id).length, 0);
  // Either of them can tag either's photos.
  const id = tagId(); const ct = tagD();
  const r = await add(mod, { id, fileIdx: 3, ciphertext: ct, epoch: 7 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json.tag).sort(), ['authorId', 'ciphertext', 'createdAt', 'epoch', 'fileIdx', 'id', 'messageId']);
  assert.equal(r.json.tag.epoch, null, 'no epoch in a DM');
  assert.equal(r.json.tag.authorId, mod.id);
  const second = await add(carol, { id: tagId(), fileIdx: 0, ciphertext: tagD() });
  assert.equal(second.status, 200);
  assert.equal((await add(carol, { id, fileIdx: 0, ciphertext: tagD() })).json.code, 'tag_exists', 'an id already taken');
  assert.ok(await until(() => ev.carol.length === 2 && ev.mod.length === 2));
  // Each event has the message's whole list, oldest first.
  const { messageId, ...asSent } = second.json.tag;
  assert.equal(messageId, photo.id);
  assert.deepEqual(ev.carol[1], { id: photo.id, dmId: d.id, tags: [{ id, fileIdx: 3, authorId: mod.id, ciphertext: ct, epoch: null, createdAt: r.json.tag.createdAt }, asSent] });
  assert.deepEqual(ev.mod[1], ev.carol[1]);
  // On the message, oldest first, wherever it's served.
  const served = (await as(carol, 'GET', `/dms/${d.id}/messages`)).json.messages.find((m) => m.id === photo.id);
  assert.deepEqual(served.tags.map((t) => t.id), [id, second.json.tag.id]);
  assert.deepEqual((await as(mod, 'GET', `/dms/${d.id}/media`)).json.messages[0].tags.map((t) => t.id), [id, second.json.tag.id]);
  // The conversation's list: newest first, with the message.
  const list = await as(mod, 'GET', `/dms/${d.id}/tags`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.tags.map((t) => t.id), [second.json.tag.id, id]);
  assert.equal(list.json.tags[1].messageId, photo.id);
  assert.equal(list.json.tags[1].fileIdx, 3);
  // Twenty per photo, three hundred per message.
  for (let i = 0; i < 19; i++) insertTag(photo.id, 'd:' + d.id, carol, { fileIdx: 1 });
  assert.equal((await add(mod, { id: tagId(), fileIdx: 1, ciphertext: tagD() })).status, 200, 'the twentieth');
  const full = await add(mod, { id: tagId(), fileIdx: 1, ciphertext: tagD() });
  assert.equal(full.status, 409);
  assert.equal(full.json.code, 'too_many_tags');
  assert.equal(full.json.error || full.json.message, 'This photo has as many tags as it can take.');
  assert.equal((await add(mod, { id: tagId(), fileIdx: 2, ciphertext: tagD() })).status, 200, 'another photo still has room');
  const big = insertDm(d.id, carol, { files: 40 });
  for (let i = 0; i < 300; i++) insertTag(big, 'd:' + d.id, carol, { fileIdx: Math.floor(i / 15) });
  assert.equal((await as(mod, 'POST', `/dm-messages/${big}/tags`, { id: tagId(), fileIdx: 39, ciphertext: tagD() })).json.code, 'too_many_tags');
  await sleep(200);
  assert.equal(ev.alice.length, 0, 'nobody outside the DM hears about them');
});

test('tags in DMs: who may remove one, blocks, deleted accounts and outsiders', async () => {
  const x = await member('tx'); const y = await member('ty');
  const d = await newDm(x, y);
  const photo = await sendD(x, d.id, { files: await uploads(x, 2) });
  const theirs = await sendD(y, d.id, { files: await uploads(y, 2) });
  const add = (u, m, fileIdx = 0) => as(u, 'POST', `/dm-messages/${m}/tags`, { id: tagId(), fileIdx, ciphertext: tagD() });
  const byY = (await add(y, photo.id)).json.tag;
  const byX = (await add(x, photo.id)).json.tag;
  const onTheirs = (await add(x, theirs.id)).json.tag;
  // The tag's author and the photo's sender may take it away; nobody else.
  assert.equal((await as(y, 'DELETE', `/dm-messages/${photo.id}/tags/${byX.id}`)).status, 403, 'someone else’s tag on someone else’s photo');
  assert.equal((await as(x, 'DELETE', `/dm-messages/${photo.id}/tags/${byY.id}`)).status, 200, 'the photo’s sender');
  assert.equal((await as(x, 'DELETE', `/dm-messages/${photo.id}/tags/${byY.id}`)).status, 404, 'already gone');
  assert.equal((await as(x, 'DELETE', `/dm-messages/${photo.id}/tags/${onTheirs.id}`)).status, 404, 'not on that message');
  assert.equal((await as(x, 'DELETE', `/dm-messages/${photo.id}/tags/nope`)).status, 404);
  assert.equal((await as(eve, 'DELETE', `/dm-messages/${photo.id}/tags/${byX.id}`)).status, 404, 'an outsider');
  // After a block (either way) nobody adds any; taking away and reading still work.
  assert.equal((await as(y, 'POST', `/blocks/${x.id}`)).status, 200);
  for (const [u, m] of [[x, photo.id], [y, photo.id], [x, theirs.id]]) assert.equal((await add(u, m)).status, 403);
  assert.equal((await as(x, 'GET', `/dms/${d.id}/tags`)).status, 200);
  assert.equal((await as(y, 'GET', `/dms/${d.id}/media`)).status, 200);
  assert.equal((await as(y, 'GET', `/dm-messages/${photo.id}/comments`)).status, 200);
  assert.equal((await as(x, 'DELETE', `/dm-messages/${theirs.id}/tags/${onTheirs.id}`)).status, 200, 'its author still can');
  assert.equal((await as(y, 'DELETE', `/blocks/${x.id}`)).status, 200);
  assert.equal((await add(y, photo.id)).status, 200, 'unblocked: back to normal');
  // Nothing new to a deleted account.
  srv.sql('UPDATE users SET deleted_at = ? WHERE id = ?', Date.now(), y.id);
  const r = await add(x, photo.id);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'deleted');
  srv.sql('UPDATE users SET deleted_at = NULL WHERE id = ?', y.id);
  // An outsider can't add one, or tell the message exists.
  const o = await add(eve, photo.id);
  assert.equal(o.status, 404);
  assert.equal(o.json.error || o.json.message, 'Message not found.');
  // Nor on a message whose time has passed, whose tags aren't listed either.
  insertTag(theirs.id, 'd:' + d.id, x);
  assert.ok((await as(x, 'GET', `/dms/${d.id}/tags`)).text.includes(theirs.id));
  srv.sql('UPDATE dm_messages SET expires_at = ? WHERE id = ?', Date.now() - 1000, theirs.id);
  assert.equal((await add(x, theirs.id)).status, 404);
  assert.ok(!(await as(x, 'GET', `/dms/${d.id}/tags`)).text.includes(theirs.id), 'its tags aren’t listed');
});

// ------------------------------------------------------------------ tags in channels
test('tags in channels: Send Messages, no timeout, the current key from inside the ciphertext; events to those who can see it', async () => {
  const room = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'gallery', type: 'text' })).json;
  const photo = await sendC(alice, room.id, { files: await uploads(alice, 3) });
  const add = (u, extra = {}) => as(u, 'POST', `/messages/${photo.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1), ...extra });
  const bs = await sock(bob); const ds = await sock(dave);
  const onBob = collect(bs, 'message:tags'); const onDave = collect(ds, 'message:tags');
  const r = await add(bob, { fileIdx: 2 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.tag.epoch, 1);
  assert.ok(await until(() => onBob.length === 1 && onDave.length === 1));
  assert.deepEqual(onBob[0].id, photo.id);
  assert.equal(onBob[0].channelId, room.id);
  assert.equal(onBob[0].threadId, null);
  assert.deepEqual(onBob[0].tags.map((t) => [t.id, t.fileIdx, t.epoch]), [[r.json.tag.id, 2, 1]]);
  // The channel's shape only, signature 64 to 72 bytes.
  for (const ct of [tagD(), tagC(0), tagC('01'), tagC(1, 63), tagC(1, 73), `c2:1:${b64(32)}:${b64(12)}:${b64(272)}:${b64(64)}`]) {
    const x = await add(bob, { ciphertext: ct });
    assert.equal(x.status, 400, ct.slice(0, 12));
    assert.equal(x.json.code, 'bad_tag');
  }
  assert.equal((await add(bob, { ciphertext: tagC(1, 72) })).status, 200, 'a DER signature');
  // The epoch is the one inside the ciphertext, which must be the current one; one beside it is ignored.
  srv.sql('UPDATE servers SET key_epoch = 2 WHERE id = ?', space.id);
  const stale = await add(bob, { epoch: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'stale-key');
  const now2 = await add(bob, { ciphertext: tagC(2), epoch: 1 });
  assert.equal(now2.status, 200, now2.text);
  assert.equal(row('media_tags', now2.json.tag.id).epoch, 2);
  srv.sql('UPDATE servers SET needs_rotation = 1 WHERE id = ?', space.id);
  assert.equal((await add(bob, { ciphertext: tagC(2) })).json.code, 'rotate');
  freshEpoch(space.id);
  // No Send Messages there: no tags (reading still works).
  await overrides(room.id, [{ type: 'member', id: carol.id, allow: 0, deny: P.SEND }]);
  assert.equal((await add(carol)).status, 403);
  assert.equal((await as(carol, 'GET', `/channels/${room.id}/tags`)).status, 200);
  // Timed out: no tags, and it says why.
  assert.equal((await as(alice, 'POST', `/servers/${space.id}/members/${dave.id}/timeout`, { minutes: 10 })).status, 200);
  const t = await add(dave);
  assert.equal(t.status, 403);
  assert.equal(t.json.code, 'timed_out');
  srv.sql('DELETE FROM member_timeouts WHERE server_id = ? AND user_id = ?', space.id, dave.id);
  assert.equal((await add(dave)).status, 200);
  // A private channel: members who can't see it get a 404 and no events.
  const hidden = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'staff', type: 'text' })).json;
  await overrides(hidden.id, [{ type: 'role', id: space.id, allow: 0, deny: P.VIEW }, { type: 'member', id: bob.id, allow: P.VIEW, deny: 0 }]);
  const secret = await sendC(alice, hidden.id, { files: await uploads(alice, 1) });
  const before = onDave.length;
  const s1 = await as(bob, 'POST', `/messages/${secret.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) });
  assert.equal(s1.status, 200, s1.text);
  assert.ok(await until(() => onBob.some((e) => e.id === secret.id)));
  await sleep(200);
  assert.equal(onDave.length, before, 'Dave can’t see that channel');
  for (const [m, p] of [['POST', `/messages/${secret.id}/tags`], ['GET', `/messages/${secret.id}/comments`], ['GET', `/channels/${hidden.id}/media`], ['GET', `/channels/${hidden.id}/tags`],
    ['DELETE', `/messages/${secret.id}/tags/${s1.json.tag.id}`]]) {
    const x = await as(dave, m, p, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) });
    assert.equal(x.status, 404, `${m} ${p}`);
    assert.ok(!x.text.includes(s1.json.tag.id));
  }
  // A thread reply's tags say which thread.
  const reply = await sendC(bob, room.id, { threadId: photo.id, files: await uploads(bob, 1) });
  assert.equal((await as(dave, 'POST', `/messages/${reply.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) })).status, 200);
  assert.ok(await until(() => onBob.some((e) => e.id === reply.id && e.threadId === photo.id)));
});

test('tags in channels: removing is for the tag’s author, the photo’s sender and Manage Messages; group chats work the same', async () => {
  const photo = await sendC(bob, general.id, { files: await uploads(bob, 2) });
  const add = (u) => as(u, 'POST', `/messages/${photo.id}/tags`, { id: tagId(), fileIdx: 1, ciphertext: tagC(1) });
  const byCarol = (await add(carol)).json.tag; const byDave = (await add(dave)).json.tag; const byDave2 = (await add(dave)).json.tag;
  const del = (u, t) => as(u, 'DELETE', `/messages/${photo.id}/tags/${t.id}`);
  assert.equal((await del(dave, byCarol)).status, 403, 'a member, someone else’s tag on someone else’s photo');
  assert.equal((await del(carol, byCarol)).status, 200, 'its author');
  assert.equal((await del(bob, byDave)).status, 200, 'the photo’s sender');
  assert.equal((await del(mod, byDave2)).status, 200, 'Manage Messages');
  assert.equal(tagRows(photo.id).length, 0);
  // Group chats: everyone may tag; only the owner manages messages.
  const gp = await sendC(alice, groupChat.id, { files: await uploads(alice, 1) });
  const g1 = await as(bob, 'POST', `/messages/${gp.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) });
  assert.equal(g1.status, 200, g1.text);
  assert.deepEqual((await as(alice, 'GET', `/channels/${groupChat.id}/tags`)).json.tags.map((t) => t.id), [g1.json.tag.id]);
  assert.equal((await as(alice, 'DELETE', `/messages/${gp.id}/tags/${g1.json.tag.id}`)).status, 200, 'the photo’s sender (and the group’s owner)');
  assert.equal((await as(carol, 'POST', `/messages/${gp.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) })).status, 404, 'not in the group');
});

// ------------------------------------------------------------------ join history
test('join history: nothing from before a member’s history starts (pages, ids, comments, tags, tag events), nor tags under an older key', async () => {
  const room = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'history', type: 'text' })).json;
  const late = await member('late');
  const joinedAt = Date.now();
  const t0 = joinedAt - 60000;
  // Before they joined: a photo, a thread with a photo reply written after, and a comment on an old photo.
  const old = insertC(room.id, alice, { files: 2, at: t0, id: idAt(t0) });
  const oldRoot = insertC(room.id, alice, { at: t0 + 1, id: idAt(t0 + 1) });
  const t1 = joinedAt + 1000;
  const inOldThread = insertC(room.id, bob, { files: 1, threadId: oldRoot, at: t1, id: idAt(t1), epoch: 2 });
  // After: a photo under their key (epoch 2), one sent while theirs was on its way (epoch 1).
  const fresh = insertC(room.id, bob, { files: 3, at: t1 + 1, id: idAt(t1 + 1), epoch: 2 });
  const locked = insertC(room.id, bob, { files: 1, at: t1 + 2, id: idAt(t1 + 2), epoch: 1 });
  const freshComment = insertC(room.id, alice, { replyTo: fresh, replyFile: 0, at: t1 + 3, id: idAt(t1 + 3), epoch: 2 });
  const oldTag = insertTag(old, 'c:' + room.id, alice, { epoch: 1 });
  const freshTag = insertTag(fresh, 'c:' + room.id, alice, { epoch: 2 });
  const freshOldKey = insertTag(fresh, 'c:' + room.id, alice, { epoch: 1 }); // can't happen through the route; still not handed out
  srv.sql('UPDATE members SET key_from = 2, joined_at = ? WHERE server_id = ? AND user_id = ?', joinedAt, space.id, late.id);
  srv.sql('UPDATE servers SET key_epoch = 2, needs_rotation = 0 WHERE id = ?', space.id);
  try {
    const page = await as(late, 'GET', `/channels/${room.id}/media`);
    assert.equal(page.status, 200, page.text);
    assert.deepEqual(page.json.messages.map((m) => m.id), [fresh]);
    assert.deepEqual(page.json.messages[0].tags.map((t) => t.id), [freshTag], 'not the tag under the older key');
    assert.deepEqual((await as(late, 'GET', `/channels/${room.id}/media?ids=${[old, inOldThread, fresh, locked].join(',')}`)).json.messages.map((m) => m.id), [fresh]);
    // Everyone else sees all of it.
    assert.deepEqual((await as(carol, 'GET', `/channels/${room.id}/media`)).json.messages.map((m) => m.id), [locked, fresh, inOldThread, old]);
    // Comments and tags.
    assert.equal((await as(late, 'GET', `/messages/${old}/comments`)).status, 404);
    assert.deepEqual((await as(late, 'GET', `/messages/${fresh}/comments`)).json.messages.map((m) => m.id), [freshComment]);
    assert.deepEqual((await as(late, 'GET', `/channels/${room.id}/tags`)).json.tags.map((t) => t.id), [freshTag]);
    assert.deepEqual((await as(carol, 'GET', `/channels/${room.id}/tags`)).json.tags.map((t) => t.id).sort(), [oldTag, freshTag, freshOldKey].sort());
    assert.equal((await as(late, 'POST', `/messages/${old}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(2) })).status, 404);
    assert.equal((await as(late, 'DELETE', `/messages/${old}/tags/${oldTag}`)).status, 404);
    // Tag events about a message from before them don't reach them.
    const ls = await sock(late); const cs = await sock(carol);
    const onLate = collect(ls, 'message:tags'); const onCarol = collect(cs, 'message:tags');
    assert.equal((await as(carol, 'POST', `/messages/${old}/tags`, { id: tagId(), fileIdx: 1, ciphertext: tagC(2) })).status, 200);
    assert.equal((await as(carol, 'POST', `/messages/${fresh}/tags`, { id: tagId(), fileIdx: 1, ciphertext: tagC(2) })).status, 200);
    assert.ok(await until(() => onCarol.length === 2 && onLate.length === 1));
    await sleep(200);
    assert.deepEqual(onLate.map((e) => e.id), [fresh]);
  } finally {
    srv.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', space.id);
  }
});

// ------------------------------------------------------------------ clean-up
test('deleting messages deletes their tags, every way: a DM, a channel message with its thread, bulk delete, a ban’s cleanup, a channel, a server', async () => {
  const conv = (c) => 'c:' + c;
  // A DM.
  const d1 = insertDm(dm.id, alice, { files: 2 });
  insertTag(d1, 'd:' + dm.id, bob);
  const r1 = await as(alice, 'DELETE', `/dm-messages/${d1}`);
  assert.equal(r1.status, 200, r1.text);
  assert.equal(tagRows(d1).length, 0);
  // A channel message, and the photo replies in its thread.
  const root = insertC(general.id, alice, { files: 1 });
  const threadPhoto = insertC(general.id, bob, { files: 1, threadId: root });
  insertTag(root, conv(general.id), bob, { epoch: 1 }); insertTag(threadPhoto, conv(general.id), carol, { epoch: 1 });
  assert.equal((await as(alice, 'DELETE', `/messages/${root}`)).status, 200);
  assert.equal(tagRows(root).length + tagRows(threadPhoto).length, 0);
  // Bulk delete, with a comment on a photo that stays: its count goes out.
  const keep = await sendC(alice, general.id, { files: await uploads(alice, 2) });
  const bulk = [];
  for (let i = 0; i < 3; i++) { const id = insertC(general.id, carol, { files: 1 }); insertTag(id, conv(general.id), alice, { epoch: 1 }); bulk.push(id); }
  bulk.push(insertC(general.id, carol, { replyTo: keep.id, replyFile: 1 }));
  insertC(general.id, carol, { replyTo: keep.id, replyFile: 1 });
  const as1 = await sock(alice);
  const counts = collect(as1, 'message:file-replies');
  const b = await as(alice, 'POST', `/channels/${general.id}/messages/bulk-delete`, { ids: bulk });
  assert.equal(b.status, 200, b.text);
  assert.equal(b.json.deleted, 4);
  for (const id of bulk) assert.equal(tagRows(id).length, 0);
  assert.ok(await until(() => counts.some((e) => e.id === keep.id)));
  assert.deepEqual(counts.find((e) => e.id === keep.id).fileReplies, { 1: 1 });
  // A ban's cleanup.
  const spammer = await member('spam');
  const spam = await sendC(spammer, general.id, { files: await uploads(spammer, 1) });
  insertTag(spam.id, conv(general.id), carol, { epoch: 1 });
  const ban = await as(alice, 'POST', `/servers/${space.id}/bans`, { userId: spammer.id, deleteHours: 1 });
  assert.equal(ban.status, 200, ban.text);
  assert.ok(await until(() => !row('messages', spam.id)));
  assert.equal(tagRows(spam.id).length, 0);
  freshEpoch(space.id); // the ban asked for a new key (someone left); the tests stand in for the apps
  // A channel.
  const doomed = (await as(alice, 'POST', `/servers/${space.id}/channels`, { name: 'doomed', type: 'text' })).json;
  const inDoomed = insertC(doomed.id, alice, { files: 1 });
  insertTag(inDoomed, conv(doomed.id), bob, { epoch: 1 });
  assert.equal((await as(alice, 'DELETE', `/channels/${doomed.id}`)).status, 200);
  assert.equal(tagRows(inDoomed).length, 0);
  // A whole server.
  const other = (await as(carol, 'POST', '/servers', { name: 'Short-lived' })).json;
  const ch = other.channels.find((c) => c.type === 'text');
  const inOther = insertC(ch.id, carol, { files: 1 });
  insertTag(inOther, conv(ch.id), carol, { epoch: 1 });
  const del = await as(carol, 'DELETE', `/servers/${other.id}`, { authKey: carol.authKey });
  assert.equal(del.status, 200, del.text);
  assert.equal(tagRows(inOther).length, 0);
});

test('the disappearing sweep deletes tags with their message, and sends the counts of photos that lost a comment', async () => {
  const s = await startServer({ DISAPPEAR_SWEEP_MS: '200' });
  try {
    const a = await s.register(`swa${hex(3)}`); const b = await s.register(`swb${hex(3)}`);
    const sp = (await as(a, 'POST', '/servers', { name: 'Sweep' }, s)).json;
    const ch = sp.channels.find((c) => c.type === 'text');
    const { code } = (await as(a, 'POST', `/servers/${sp.id}/invites`, {}, s)).json;
    assert.equal((await as(b, 'POST', `/invites/${code}/join`, undefined, s)).status, 200);
    freshEpoch(sp.id, s);
    const d = (await as(a, 'POST', '/dms', { userId: b.id }, s)).json;
    const later = Date.now() + 3600000;
    // DM: a photo that stays, a comment on it that goes, and a photo that goes with its tags.
    const photo = insertDm(d.id, a, { files: 2 }, s);
    const comment = insertDm(d.id, b, { replyTo: photo, replyFile: 1, expiresAt: later }, s);
    insertDm(d.id, b, { replyTo: photo, replyFile: 0 }, s);
    const goes = insertDm(d.id, a, { files: 1, expiresAt: later }, s);
    insertTag(goes, 'd:' + d.id, b, {}, s);
    insertTag(photo, 'd:' + d.id, b, {}, s);
    // Channel: the same.
    const cPhoto = insertC(ch.id, a, { files: 2 }, s);
    const cComment = insertC(ch.id, b, { replyTo: cPhoto, replyFile: 0, expiresAt: later }, s);
    const cGoes = insertC(ch.id, a, { files: 1, expiresAt: later }, s);
    insertTag(cGoes, 'c:' + ch.id, b, { epoch: 1 }, s);
    const sa = await s.socket(a.token); socks.push(sa);
    const dmCounts = collect(sa, 'dm:file-replies'); const chCounts = collect(sa, 'message:file-replies');
    for (const t of ['dm_messages', 'messages']) s.sql(`UPDATE ${t} SET expires_at = ? WHERE expires_at = ?`, Date.now() - 1000, later);
    assert.ok(await until(() => dmCounts.length && chCounts.length, 8000), 'the sweep ran');
    assert.deepEqual(dmCounts[0], { id: photo, dmId: d.id, fileReplies: { 0: 1 } });
    assert.deepEqual(chCounts[0], { id: cPhoto, channelId: ch.id, threadId: null, fileReplies: {} });
    for (const id of [comment, goes]) assert.equal(s.sql('SELECT COUNT(*) n FROM dm_messages WHERE id = ?', id)[0].n, 0);
    assert.equal(s.sql('SELECT COUNT(*) n FROM messages WHERE id IN (?, ?)', cComment, cGoes)[0].n, 0);
    assert.equal(tagRows(goes, s).length, 0);
    assert.equal(tagRows(cGoes, s).length, 0);
    assert.equal(tagRows(photo, s).length, 1, 'tags on a message that stays, stay');
  } finally { await s.stop(); }
});

// ------------------------------------------------------------------ outsiders
test('outsiders get nothing from any of the new routes', async () => {
  const photo = await sendD(alice, dm.id, { files: await uploads(alice, 1) });
  const tag = (await as(bob, 'POST', `/dm-messages/${photo.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagD() })).json.tag;
  const cp = await sendC(alice, general.id, { files: await uploads(alice, 1) });
  const ctag = (await as(bob, 'POST', `/messages/${cp.id}/tags`, { id: tagId(), fileIdx: 0, ciphertext: tagC(1) })).json.tag;
  for (const [m, p] of [
    ['GET', `/dms/${dm.id}/media`], ['GET', `/dms/${dm.id}/media?ids=${photo.id}`], ['GET', `/dms/${dm.id}/tags`], ['GET', `/dm-messages/${photo.id}/comments`],
    ['POST', `/dm-messages/${photo.id}/tags`], ['DELETE', `/dm-messages/${photo.id}/tags/${tag.id}`],
    ['GET', `/channels/${general.id}/media`], ['GET', `/channels/${general.id}/tags`], ['GET', `/messages/${cp.id}/comments`],
    ['POST', `/messages/${cp.id}/tags`], ['DELETE', `/messages/${cp.id}/tags/${ctag.id}`],
    // The wrong kind of message for the route is "not found" too.
    ['GET', `/messages/${photo.id}/comments`], ['GET', `/dm-messages/${cp.id}/comments`],
  ]) {
    const r = await as(eve, m, p, { id: tagId(), fileIdx: 0, ciphertext: p.startsWith('/dm') ? tagD() : tagC(1) });
    assert.ok(DENIED.includes(r.status), `${m} ${p} → ${r.status}`);
    for (const secret of [photo.id, cp.id, tag.id, ctag.id]) assert.ok(!r.text.includes(secret), `${m} ${p} leaks ${secret}`);
  }
  assert.equal((await as(bob, 'GET', `/messages/${photo.id}/comments`)).status, 404, 'a DM message on the channel route');
  assert.equal(tagRows(photo.id).length, 1);
  assert.equal(tagRows(cp.id).length, 1);
});

test('rate limits: each route has its own', async () => {
  const u = await member('busy');
  const room = general.id;
  let last;
  for (let i = 0; i < 61; i++) last = await as(u, 'GET', `/channels/${room}/tags`);
  assert.equal(last.status, 429);
  assert.equal((await as(u, 'GET', `/channels/${room}/media`)).status, 200, 'a different budget');
  for (let i = 0; i < 61; i++) last = await as(u, 'POST', `/messages/nothere/tags`, {});
  assert.equal(last.status, 429);
});

// ------------------------------------------------------------------ schema and query plans
test('the panel’s, comments’ and tags’ queries use their partial indexes, never a scan of the message tables', () => {
  const { LIVE } = require('../server/disappear');
  const SQL = require('../server/photos').sql(LIVE);
  const d = srv.db();
  const plan = (q, ...a) => d.prepare('EXPLAIN QUERY PLAN ' + q).all(...a).map((r) => r.detail).join(' | ');
  const hist = ' AND messages.id >= ? AND messages.created_at >= ? AND (messages.ciphertext IS NULL OR messages.epoch >= ?) AND (messages.thread_id IS NULL OR EXISTS (SELECT 1 FROM messages hr WHERE hr.id = messages.thread_id AND hr.created_at >= ? AND (hr.ciphertext IS NULL OR hr.epoch >= ?)))';
  const mHist = hist.replace(/messages\./g, 'm.');
  const t = Date.now();
  try {
    const plans = {
      dmFirst: [plan(SQL.dmMedia(false), 'd', t, 30), /idx_dm_messages_files/],
      dmBefore: [plan(SQL.dmMedia(true), 'd', 'z', t, 30), /idx_dm_messages_files \(dm_id=\? AND id<\?\)/],
      chFirst: [plan(SQL.channelMedia(false), 'c', t, 30), /idx_messages_files/],
      chBefore: [plan(SQL.channelMedia(true, hist), 'c', 'z', 'a', 1, 1, 1, 1, t, 30), /idx_messages_files \(channel_id=\? AND id>\? AND id<\?\)/],
      // By id: one lookup each (through the partial index or the primary key, as SQLite picks).
      dmIds: [plan(SQL.dmMediaIds, '["a"]', 'd', t), /SCAN j VIRTUAL TABLE.*SEARCH m USING INDEX \S+ \((dm_id=\? AND )?id=\?\)/],
      chIds: [plan(SQL.channelMediaIds(mHist), '["a"]', 'c', 'a', 1, 1, 1, 1, t), /SCAN j VIRTUAL TABLE.*SEARCH m USING INDEX \S+ \((channel_id=\? AND )?id=\?\)/],
      dmComments: [plan(SQL.comments('dm_messages', 'dm_id', true, true), 'm', 0, 'd', 'a', t, 50), /idx_dm_messages_reply_file \(reply_to=\? AND reply_file=\?\)/],
      chComments: [plan(SQL.comments('messages', 'channel_id', false, false, hist), 'm', 'c', 'a', 1, 1, 1, 1, t, 50), /idx_messages_reply_file \(reply_to=\?/],
      dmTags: [plan(SQL.dmTags, 'd:x', 'x', t), /SEARCH t USING INDEX idx_media_tags_conv \(conv=\?\)/],
      chTags: [plan(SQL.channelTags(mHist, true), 'c:x', 'x', t, 'a', 1, 1, 1, 1, 1), /SEARCH t USING INDEX idx_media_tags_conv \(conv=\?\)/],
      // index.js: the comment counts and tags of a page of messages.
      counts: [plan(`SELECT reply_to, reply_file, COUNT(*) AS n FROM messages INDEXED BY idx_messages_reply_file WHERE reply_to IN (?, ?) AND reply_file IS NOT NULL AND ${LIVE} GROUP BY reply_to, reply_file`, 'a', 'b', t), /idx_messages_reply_file \(reply_to=\?/],
      dmCounts: [plan(`SELECT reply_to, reply_file, COUNT(*) AS n FROM dm_messages INDEXED BY idx_dm_messages_reply_file WHERE reply_to IN (?) AND reply_file IS NOT NULL AND ${LIVE} GROUP BY reply_to, reply_file`, 'a', t), /idx_dm_messages_reply_file \(reply_to=\?/],
      tags: [plan('SELECT id, message_id, file_idx, author_id, ciphertext, epoch, created_at FROM media_tags WHERE message_id IN (?, ?) ORDER BY created_at, id', 'a', 'b'), /idx_media_tags_message \(message_id=\?\)/],
    };
    for (const [name, [p, want]] of Object.entries(plans)) {
      assert.doesNotMatch(p, /\bSCAN (messages|dm_messages|media_tags|m|t)\b/, `${name}: ${p}`);
      assert.match(p, want, `${name}: ${p}`);
    }
    // The tags of a conversation are read in the index's order (newest first), each joined to its one message.
    assert.match(plans.dmTags[0], /SEARCH t USING INDEX idx_media_tags_conv \(conv=\?\) \| SEARCH m USING INDEX \S+ \((dm_id=\? AND )?id=\?\)/);
    assert.match(plans.chTags[0], /SEARCH t USING INDEX idx_media_tags_conv \(conv=\?\) \| SEARCH m USING INDEX \S+ \((channel_id=\? AND )?id=\?\)/);
    // Without a partial index's own condition, SQLite couldn't use it: the queries say it.
    assert.match(SQL.dmMedia(false), /files > 0/);
    assert.match(SQL.comments('messages', 'channel_id', false, false), /reply_file IS NOT NULL/);
    // The indexes are partial.
    const idx = (name) => d.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(name).sql;
    assert.match(idx('idx_messages_files'), /ON messages\(channel_id, id\) WHERE files > 0/);
    assert.match(idx('idx_dm_messages_files'), /ON dm_messages\(dm_id, id\) WHERE files > 0/);
    assert.match(idx('idx_messages_reply_file'), /ON messages\(reply_to, reply_file\) WHERE reply_file IS NOT NULL/);
    assert.match(idx('idx_dm_messages_reply_file'), /ON dm_messages\(reply_to, reply_file\) WHERE reply_file IS NOT NULL/);
  } finally { d.close(); }
});

test('upgrading a version 20 database counts the files messages already have and builds the new indexes and table', async () => {
  const CURRENT = Number(/const SCHEMA_VERSION = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8'))[1]);
  assert.equal(CURRENT, 21);
  const s = await startServer();
  try {
    const a = await s.register(`upa${hex(3)}`); const b = await s.register(`upb${hex(3)}`);
    const sp = (await as(a, 'POST', '/servers', { name: 'Old' }, s)).json;
    const { code } = (await as(a, 'POST', `/servers/${sp.id}/invites`, {}, s)).json;
    assert.equal((await as(b, 'POST', `/invites/${code}/join`, undefined, s)).status, 200);
    freshEpoch(sp.id, s);
    const ch = sp.channels.find((c) => c.type === 'text');
    const d = (await as(a, 'POST', '/dms', { userId: b.id }, s)).json;
    const dmPhoto = await sendD(a, d.id, { files: await uploads(a, 3, s) }, s);
    const chPhoto = await sendC(a, ch.id, { files: await uploads(a, 2, s) }, s);
    const plain = await sendD(a, d.id, {}, s);
    const sched = await as(a, 'POST', `/dms/${d.id}/scheduled-messages`, { ciphertext: cipher(), ref: crypto.randomBytes(12).toString('base64url'), draft: 'x1:' + b64(40),
      sendAt: Date.now() + 3600000, files: await uploads(a, 2, s) }, s);
    assert.equal(sched.status, 200, sched.text);
    // As a version 20 database: no counts, no new indexes, no tags table.
    s.sql('UPDATE dm_messages SET files = 0'); s.sql('UPDATE messages SET files = 0'); s.sql('UPDATE scheduled_messages SET file_count = 0');
    for (const i of ['idx_messages_files', 'idx_dm_messages_files', 'idx_messages_reply_file', 'idx_dm_messages_reply_file']) s.sql(`DROP INDEX ${i}`);
    s.sql('DROP TABLE media_tags');
    s.sql('PRAGMA user_version = 20');
    await s.restart();
    assert.equal(row('dm_messages', dmPhoto.id, s).files, 3);
    assert.equal(row('messages', chPhoto.id, s).files, 2);
    assert.equal(row('dm_messages', plain.id, s).files, 0);
    assert.equal(row('scheduled_messages', sched.json.id, s).file_count, 2);
    assert.equal(s.sql("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('idx_messages_files', 'idx_dm_messages_files', 'idx_messages_reply_file', 'idx_dm_messages_reply_file', 'media_tags', 'idx_media_tags_message', 'idx_media_tags_conv')")[0].n, 7);
    assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).filter((f) => /^hearth-before-v21-.*\.db$/.test(f)).length, 1, 'after a backup copy');
    assert.deepEqual((await as(b, 'GET', `/dms/${d.id}/media`, undefined, s)).json.messages.map((m) => m.id), [dmPhoto.id]);
    const d2 = s.db();
    try { assert.equal(d2.pragma('user_version', { simple: true }), 21); } finally { d2.close(); }
  } finally { await s.stop(); }
});
