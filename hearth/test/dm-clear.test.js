// Clear a DM for both people (POST /api/dms/:id/clear): either person deletes every message in the conversation, from
// both of them, for both of them. The other person is told live and sees who cleared it and when (the DM's `cleared`),
// reports keep their own copies, and after a block neither of them can do it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sleep } = require('./helpers');

const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');
let srv; let alice; let bob; let eve;
const socks = [];
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; }
async function friends(a, b) {
  assert.equal((await as(a, 'POST', '/friends', { username: b.username })).status, 200);
  assert.equal((await as(b, 'POST', '/friends', { username: a.username })).status, 200);
}
async function dmOf(a, b) { const r = await as(a, 'POST', '/dms', { userId: b.id }); assert.equal(r.status, 200, r.text); return r.json; }
async function send(u, dmId) { const r = await as(u, 'POST', `/dms/${dmId}/messages`, { ciphertext: cipher() }); assert.equal(r.status, 200, r.text); return r.json; }
const messages = async (u, dmId) => (await as(u, 'GET', `/dms/${dmId}/messages`)).json.messages;

before(async () => {
  srv = await startServer();
  alice = await srv.register('alice'); bob = await srv.register('bob'); eve = await srv.register('eve');
  await friends(alice, bob);
  await friends(alice, eve);
});
after(async () => { for (const s of socks) s.close(); await srv.stop(); });

test('either person clears the whole chat, both sides’ messages, for both, and the other one is told', async () => {
  const dm = await dmOf(alice, bob);
  const sent = [await send(alice, dm.id), await send(bob, dm.id), await send(alice, dm.id), await send(bob, dm.id)];
  assert.equal((await as(bob, 'POST', `/messages/${sent[0].id}/reactions`, { emoji: '👍' })).status, 200);
  assert.equal((await as(alice, 'POST', `/messages/${sent[1].id}/pin`)).status, 200);
  const bobSock = await srv.socket(bob.token); socks.push(bobSock);
  const got = []; bobSock.on('dm:cleared', (p) => got.push(p));

  const r = await as(alice, 'POST', `/dms/${dm.id}/clear`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, 4);
  assert.deepEqual(await messages(alice, dm.id), []);
  assert.deepEqual(await messages(bob, dm.id), []);
  assert.equal(srv.sql('SELECT COUNT(*) n FROM dm_messages WHERE dm_id = ?', dm.id)[0].n, 0);
  assert.equal(srv.sql(`SELECT COUNT(*) n FROM reactions WHERE message_id IN (${sent.map(() => '?').join(',')})`, ...sent.map((m) => m.id))[0].n, 0);
  assert.deepEqual((await as(bob, 'GET', `/dms/${dm.id}/pins`)).json, []);

  assert.ok(await until(() => got.length === 1), 'bob is told live');
  assert.equal(got[0].dmId, dm.id);
  assert.equal(got[0].by, alice.id);
  assert.equal(got[0].upTo, sent[3].id);
  assert.deepEqual([...got[0].ids].sort(), sent.map((m) => m.id).sort());
  assert.equal(got[0].last, null);
  // Both see who cleared it and when, with the DM (the line at the top of the conversation).
  for (const u of [alice, bob]) {
    const d = (await as(u, 'GET', '/bootstrap')).json.dms.find((x) => x.id === dm.id);
    assert.equal(d.cleared.by, alice.id);
    assert.ok(d.cleared.at > 0);
  }
  // The conversation goes on as normal afterwards.
  const next = await send(bob, dm.id);
  assert.deepEqual((await messages(alice, dm.id)).map((m) => m.id), [next.id]);
});

test('the files go too', async () => {
  const dm = await dmOf(alice, bob);
  const name = 'cleartest' + crypto.randomBytes(6).toString('hex') + '.bin';
  fs.writeFileSync(path.join(srv.dir, 'uploads', name), crypto.randomBytes(100));
  const m = await send(alice, dm.id);
  srv.sql('INSERT INTO blobs (name, uploader_id, message_id, created_at) VALUES (?, ?, ?, ?)', name, alice.id, m.id, Date.now());
  assert.equal((await as(bob, 'POST', `/dms/${dm.id}/clear`)).status, 200);
  assert.equal(srv.sql('SELECT COUNT(*) n FROM blobs WHERE name = ?', name)[0].n, 0);
  assert.ok(await until(() => !fs.existsSync(path.join(srv.dir, 'uploads', name))), 'the file is removed from disk');
});

test('only the two people in the DM, and not after a block either way', async () => {
  const dm = await dmOf(alice, eve);
  await send(eve, dm.id);
  assert.ok([403, 404].includes((await as(bob, 'POST', `/dms/${dm.id}/clear`)).status), 'an outsider can’t');
  assert.equal((await messages(alice, dm.id)).length, 1);
  assert.equal((await as(alice, 'POST', `/blocks/${eve.id}`)).status, 200);
  assert.equal((await as(eve, 'POST', `/dms/${dm.id}/clear`)).status, 403, 'whoever was blocked can’t erase it');
  assert.equal((await as(alice, 'POST', `/dms/${dm.id}/clear`)).status, 403, 'nor can whoever blocked');
  assert.equal(srv.sql('SELECT COUNT(*) n FROM dm_messages WHERE dm_id = ?', dm.id)[0].n, 1);
});

test('a report keeps its own copy of what was reported', async () => {
  const carol = await srv.register('carol');
  await friends(carol, bob);
  const dm = await dmOf(carol, bob);
  const m = await send(bob, dm.id);
  const rep = await as(carol, 'POST', '/reports', { category: 'harassment', context: { kind: 'message', messageId: m.id }, evidence: [{ id: m.id, text: 'mean words' }] });
  assert.equal(rep.status, 200, rep.text);
  assert.equal((await as(bob, 'POST', `/dms/${dm.id}/clear`)).status, 200);
  const reports = (await as(srv.owner, 'GET', '/admin/reports')).json;
  const list = Array.isArray(reports) ? reports : reports.reports || [];
  assert.ok(JSON.stringify(list).includes('mean words'), 'the report still has the words');
});

test('the app: the DM menu offers it (not after a block), asks first, and handles the live update', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /S\.blocked\.has\(u\.id\) \? \[\] : \['-', \{ label: 'Clear chat for both', icon: 'trash', danger: true, action: \(\) => clearDmForBoth\(d\) \}\]/);
  assert.match(app, /async function clearDmForBoth\(d\) \{\n {2}const u = getUser\(d\.userId\);\n {2}if \(!\(await confirmDialog\(/);
  assert.match(app, /socket\.on\('dm:cleared', \(p\) => onDmCleared\(p\)\);/);
  assert.match(app, /d\.cleared \? h\('p', \{ class: 'welcome-note dm-cleared', role: 'note' \}/);
});
