// Chat backgrounds (schema v22, server/looks.js): a DM's or group chat's background, sealed on the device. The version
// rule (409 stale_look with the look as it is now), the exact lkd1 / lkc1 shapes, a group look's epoch taken from
// inside it, the same look sealed again with a group's new key (once, quietly), who may change it (blocks and deleted accounts in DMs, anyone in a group chat, nobody outside), its
// picture's uploads (linked, replaced, kept, removed, and kept by every sweep), the live events and their lines, the
// bootstrap, lookEvents on history pages (paged exactly like timerEvents), clean-up, the rate limit, and the upgrade
// from a version 21 database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, hex, sleep } = require('./helpers');

let srv;
let space; let inviteCode; let eve;
const socks = [];
const as = (u, method, p, body, s = srv) => s.api(method, p, { token: u.token, ip: u.ip, body });
const b64 = (n) => crypto.randomBytes(n).toString('base64');
// Looks exactly as the apps seal them (public/js/e2ee.js): one 512-byte padded payload, so 528 bytes with the GCM tag.
const lookD = (ct = 528) => `lkd1:${b64(32)}:${b64(12)}:${b64(ct)}`;
const lookC = (epoch = 1, sig = 64, ct = 528) => `lkc1:${epoch}:${b64(32)}:${b64(12)}:${b64(ct)}:${b64(sig)}`;
const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');
const freshEpoch = (sid, s = srv) => s.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', sid);
const sock = async (u, s = srv) => { const x = await s.socket(u.token); socks.push(x); return x; };
const collect = (x, ev) => { const got = []; x.on(ev, (p) => got.push(p)); return got; };
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(30); } return false; }
const lookRow = (conv, s = srv) => s.sql('SELECT * FROM chat_looks WHERE conv = ?', conv)[0];
const logRows = (conv, s = srv) => s.sql('SELECT * FROM look_log WHERE conv = ? ORDER BY created_at, id', conv);
const blob = (url, s = srv) => s.sql('SELECT * FROM blobs WHERE name = ?', path.basename(url))[0];
const fileOf = (url, s = srv) => path.join(s.dir, 'uploads', path.basename(url));
const onDisk = (url, s = srv) => fs.existsSync(fileOf(url, s));
const quotaRow = (url, s = srv) => s.sql('SELECT * FROM user_files WHERE name = ?', path.basename(url))[0];
// Time-sorted ids like newId(), for rows written straight into the database.
const idAt = (t) => t.toString(36).padStart(9, '0') + hex(5);
async function upload(u, s = srv) {
  const boundary = '----hearth' + hex(8);
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    crypto.randomBytes(300), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = await s.api('POST', '/upload/encrypted', { token: u.token, ip: u.ip, raw, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(r.status, 200, r.text);
  return r.json.url;
}
const uploads = async (u, n, s = srv) => { const out = []; for (let i = 0; i < n; i++) out.push(await upload(u, s)); return out; };
// Someone new in the shared server (so they may DM and make group chats with everyone else in it).
async function member(name, s = srv, code = inviteCode) {
  const u = await s.register(`${name}${hex(3)}`);
  assert.equal((await as(u, 'POST', `/invites/${code}/join`, undefined, s)).status, 200);
  return u;
}
async function newDm(a, b, s = srv) {
  const r = await as(a, 'POST', '/dms', { userId: b.id }, s);
  assert.equal(r.status, 200, r.text);
  return r.json;
}
async function newGroup(owner, others, s = srv) {
  const r = await as(owner, 'POST', '/groups', { userIds: others.map((u) => u.id) }, s);
  assert.equal(r.status, 200, r.text);
  freshEpoch(r.json.id, s);
  return { ...r.json, chat: r.json.channels.find((c) => c.type === 'text'), call: r.json.channels.find((c) => c.type === 'voice') };
}
const setD = (u, dmId, body, s) => as(u, 'PUT', `/dms/${dmId}/look`, body, s);
const clearD = (u, dmId, body, s) => as(u, 'DELETE', `/dms/${dmId}/look`, body, s);
const setG = (u, gid, body, s) => as(u, 'PUT', `/groups/${gid}/look`, body, s);
const clearG = (u, gid, body, s) => as(u, 'DELETE', `/groups/${gid}/look`, body, s);
const ok = (r) => { assert.equal(r.status, 200, r.text); return r.json; };
const refused = (r, status, code) => { assert.equal(r.status, status, r.text); if (code) assert.equal(r.json.code, code, r.text); };

before(async () => {
  srv = await startServer();
  const host = await srv.register(`host${hex(3)}`);
  space = (await as(host, 'POST', '/servers', { name: 'Backdrop HQ' })).json;
  inviteCode = (await as(host, 'POST', `/servers/${space.id}/invites`, {})).json.code;
  freshEpoch(space.id);
  eve = await srv.register(`eve${hex(3)}`); // outside everything
});
after(async () => { socks.forEach((x) => x.close()); await srv.stop(); });

// ------------------------------------------------------------------ versions and shapes
test('the version rule: 1 first, then one more than the one stored; anything else is 409 stale_look with the look as it is now', async () => {
  const a = await member('va'); const b = await member('vb');
  const d = await newDm(a, b);
  const conv = 'd:' + d.id;
  // Nothing yet: only 1 will do.
  let r = await setD(a, d.id, { version: 2, ciphertext: lookD() });
  refused(r, 409, 'stale_look');
  assert.equal(r.json.look, null);
  assert.equal(lookRow(conv), undefined);
  // Not a version at all.
  for (const v of [0, -1, '1', 1.5, null, undefined, 2 ** 53, true]) refused(await setD(b, d.id, { version: v, ciphertext: lookD() }), 400, 'bad_look');
  const ct1 = lookD();
  const first = ok(await setD(a, d.id, { version: 1, ciphertext: ct1 }));
  assert.equal(typeof first.look.updatedAt, 'number');
  assert.deepEqual(first.look, { ciphertext: ct1, epoch: null, authorId: a.id, version: 1, updatedAt: first.look.updatedAt });
  // The same version again, or one too far ahead: someone changed it meanwhile, here it is.
  for (const v of [1, 3]) {
    r = await setD(b, d.id, { version: v, ciphertext: lookD() });
    refused(r, 409, 'stale_look');
    assert.deepEqual(r.json.look, first.look);
  }
  const second = ok(await setD(b, d.id, { version: 2, ciphertext: lookD() }));
  assert.equal(second.look.version, 2);
  assert.equal(second.look.authorId, b.id);
  const row = lookRow(conv);
  assert.equal(row.version, 2); assert.equal(row.author_id, b.id); assert.equal(row.epoch, null); assert.equal(row.files, '[]');
  // Removing it: the same rule.
  r = await clearD(a, d.id, { version: 2 });
  refused(r, 409, 'stale_look');
  assert.deepEqual(r.json.look, second.look);
  refused(await clearD(a, d.id, {}), 400, 'bad_look');
  const cleared = ok(await clearD(a, d.id, { version: 3 }));
  assert.deepEqual(cleared.look, { version: 3, cleared: true });
  assert.equal(lookRow(conv).ciphertext, '');
  assert.equal(lookRow(conv).files, '[]');
  assert.equal(lookRow(conv).version, 3, 'the row stays and the version counts on');
  // Nothing left to remove: nothing changes, and there's no new line.
  const lines = logRows(conv).length;
  assert.deepEqual(ok(await clearD(b, d.id, { version: 4 })).look, { version: 3, cleared: true });
  assert.equal(logRows(conv).length, lines);
  assert.equal(lookRow(conv).version, 3);
  // A look sealed for an older version can't come back: the next one is 4.
  r = await setD(b, d.id, { version: 3, ciphertext: ct1 });
  refused(r, 409, 'stale_look');
  assert.deepEqual(r.json.look, { version: 3, cleared: true });
  assert.equal(ok(await setD(b, d.id, { version: 4, ciphertext: lookD() })).look.version, 4);
  assert.deepEqual(logRows(conv).map((l) => [l.user_id, l.action]), [[a.id, 'set'], [b.id, 'set'], [a.id, 'clear'], [b.id, 'set']]);
});

test('shapes: exactly lkd1 in DMs and lkc1 in group chats, a 528-byte ciphertext, a 64-72 byte signature, nothing else', async () => {
  const [a, b, c] = [await member('sa'), await member('sb'), await member('sc')];
  const d = await newDm(a, b);
  const salt = b64(32); const iv = b64(12); const ct = b64(528);
  const dmBad = [
    lookC(1), `td1:${salt}:${iv}:${b64(272)}`, `d2:${salt}:${iv}:${ct}`, `LKD1:${salt}:${iv}:${ct}`,
    lookD(527), lookD(529), lookD(512), `lkd1:${b64(31)}:${iv}:${ct}`, `lkd1:${salt}:${b64(11)}:${ct}`, `lkd1:${salt}:${iv}:${ct}:${b64(4)}`,
    `lkd1:${salt}:${iv}:${ct}A`, `lkd1:${salt}:${iv}:${ct.slice(0, -4)}!!!!`, `lkd1:${salt}:${iv}:${ct}`.padEnd(1001, 'A'), 12345, null, { lkd1: ct }, ['lkd1', salt, iv, ct],
  ];
  for (const [i, ciphertext] of dmBad.entries()) refused(await setD(i % 2 ? a : b, d.id, { version: 1, ciphertext }), 400, 'bad_look');
  assert.equal(lookRow('d:' + d.id), undefined);
  assert.equal(ok(await setD(a, d.id, { version: 1, ciphertext: `lkd1:${salt}:${iv}:${ct}` })).look.version, 1);
  const g = await newGroup(a, [b, c]);
  const groupBad = [
    lookD(), lookC(0), lookC('01'), lookC('1e3'), lookC('1234567890'), lookC(-1), lookC(1, 63), lookC(1, 73), lookC(1, 64, 527), lookC(1, 64, 529),
    `c2:1:${salt}:${iv}:${ct}:${b64(64)}`, `tc1:1:${salt}:${iv}:${b64(272)}:${b64(64)}`, `lkc1:1:${salt}:${iv}:${ct}`, `${lookC(1)}:${b64(4)}`,
  ];
  for (const [i, ciphertext] of groupBad.entries()) refused(await setG([a, b, c][i % 3], g.id, { version: 1, ciphertext }), 400, 'bad_look');
  assert.equal(lookRow('g:' + g.id), undefined);
  assert.equal(ok(await setG(c, g.id, { version: 1, ciphertext: lookC(1, 72) })).look.version, 1, 'a DER signature');
  assert.equal(ok(await setG(c, g.id, { version: 2, ciphertext: lookC(1, 64) })).look.version, 2, 'a raw one');
});

test('group chats: the epoch inside the ciphertext must be the current one (one beside it is ignored)', async () => {
  const [a, b] = [await member('ea'), await member('eb')];
  const g = await newGroup(a, [b]);
  srv.sql('UPDATE servers SET key_epoch = 2 WHERE id = ?', g.id);
  refused(await setG(b, g.id, { version: 1, ciphertext: lookC(1), epoch: 2 }), 409, 'stale-key');
  const now2 = ok(await setG(b, g.id, { version: 1, ciphertext: lookC(2), epoch: 1 }));
  assert.equal(now2.look.epoch, 2);
  assert.equal(lookRow('g:' + g.id).epoch, 2);
  // A group that needs a fresh key first (someone left): nothing until there is one.
  srv.sql('UPDATE servers SET needs_rotation = 1 WHERE id = ?', g.id);
  refused(await setG(a, g.id, { version: 2, ciphertext: lookC(2) }), 409, 'rotate');
  freshEpoch(g.id);
  refused(await setG(a, g.id, { version: 2, ciphertext: lookC(2) }), 409, 'stale-key');
  // An out-of-date version is told first: the app seals again for the next one anyway.
  refused(await setG(a, g.id, { version: 1, ciphertext: lookC(2) }), 409, 'stale_look');
  assert.equal(ok(await setG(a, g.id, { version: 2, ciphertext: lookC(1) })).look.epoch, 1);
  // Removing needs no key: it seals nothing.
  srv.sql('UPDATE servers SET needs_rotation = 1 WHERE id = ?', g.id);
  assert.deepEqual(ok(await clearG(b, g.id, { version: 3 })).look, { version: 3, cleared: true });
  assert.equal(lookRow('g:' + g.id).epoch, null);
  freshEpoch(g.id);
});

test('group chats: after a key change the same look is sealed again with the new key, once and quietly, so someone who joins later can open it', async () => {
  const [a, b, c, dave] = [await member('ra1'), await member('rb1'), await member('rc1'), await member('rd1')];
  const g = await newGroup(a, [b, c]);
  const conv = 'g:' + g.id;
  const pic = await upload(a);
  const set = ok(await setG(a, g.id, { version: 1, ciphertext: lookC(1), files: [pic] }));
  assert.equal(set.look.epoch, 1);
  // Nothing to seal again while the key it was sealed with is still the group's.
  refused(await setG(b, g.id, { version: 2, ciphertext: lookC(1), files: [pic], reseal: true }), 409, 'not_stale');
  // Carol leaves, so the group needs a new key; until someone makes it, nothing is sealed with any key.
  ok(await as(c, 'POST', `/servers/${g.id}/leave`));
  refused(await setG(b, g.id, { version: 2, ciphertext: lookC(1), files: [pic], reseal: true }), 409, 'rotate');
  // a's app makes the new key (well-formed, not a real one), wrapped for everyone left.
  const wrap = () => ['w1', b64(65), b64(12), b64(48), b64(64)].join(':');
  const wraps = Object.fromEntries(srv.sql('SELECT user_id FROM members WHERE server_id = ?', g.id).map((r) => [r.user_id, wrap()]));
  ok(await as(a, 'POST', `/servers/${g.id}/keys/rotate`, { epoch: 2, check: b64(24), wraps }));
  // Dave is added now: he's only ever handed key 2, and the look he gets is still sealed with key 1.
  const sd = await sock(dave);
  const added = collect(sd, 'server:add');
  ok(await as(b, 'POST', `/groups/${g.id}/members`, { userId: dave.id }));
  assert.ok(await until(() => added.length === 1));
  assert.equal(added[0].server.look.epoch, 1);
  assert.deepEqual(added[0].keyState.keys.map((k) => k.epoch), [], 'no copy of key 1 for him');
  // Refused: not sealed with the current key, a different picture (or none, or one more), the wrong version, a DM, or
  // reseal anything but true. None of it changes anything.
  const [other] = await uploads(b, 1);
  const lines = logRows(conv).length;
  refused(await setG(b, g.id, { version: 2, ciphertext: lookC(1), files: [pic], reseal: true }), 409, 'stale-key');
  for (const files of [[], [other], [pic, other], undefined]) refused(await setG(b, g.id, { version: 2, ciphertext: lookC(2), files, reseal: true }), 400, 'bad_look');
  for (const reseal of [1, 'yes', null, {}]) refused(await setG(b, g.id, { version: 2, ciphertext: lookC(2), files: [pic], reseal }), 400, 'bad_look');
  for (const v of [1, 3]) refused(await setG(b, g.id, { version: v, ciphertext: lookC(2), files: [pic], reseal: true }), 409, 'stale_look');
  const d = await newDm(a, b);
  refused(await setD(a, d.id, { version: 1, ciphertext: lookD(), reseal: true }), 400, 'bad_look');
  assert.equal(lookRow('d:' + d.id), undefined);
  assert.equal(lookRow(conv).version, 1);
  assert.equal(blob(other).look_conv, null);
  // b's app seals it again: the next version, key 2, the same picture, and no line in the history.
  const [sa, sb] = [await sock(a), await sock(b)];
  const gA = collect(sa, 'group:look'); const gB = collect(sb, 'group:look'); const gD = collect(sd, 'group:look');
  const ct2 = lookC(2);
  const again = ok(await setG(b, g.id, { version: 2, ciphertext: ct2, files: [pic], reseal: true }));
  assert.deepEqual(again.look, { ciphertext: ct2, epoch: 2, authorId: b.id, version: 2, updatedAt: again.look.updatedAt });
  assert.equal(logRows(conv).length, lines, 'no "changed the chat background" line');
  assert.equal(lookRow(conv).epoch, 2);
  assert.deepEqual(JSON.parse(lookRow(conv).files), [pic]);
  assert.equal(blob(pic).look_conv, conv, 'its picture stays');
  assert.ok(onDisk(pic));
  assert.ok(await until(() => gA.length === 1 && gB.length === 1 && gD.length === 1));
  assert.deepEqual(gD[0], { serverId: g.id, look: again.look, event: null });
  // Another member's app racing to do the same: told someone just did (with the look as it is now); and it's done
  // once per key change.
  const late = await setG(a, g.id, { version: 2, ciphertext: lookC(2), files: [pic], reseal: true });
  refused(late, 409, 'stale_look');
  assert.deepEqual(late.json.look, again.look);
  refused(await setG(a, g.id, { version: 3, ciphertext: lookC(2), files: [pic], reseal: true }), 409, 'not_stale');
  // Dave's copy is sealed with the key he has.
  const boot = ok(await as(dave, 'GET', '/bootstrap'));
  assert.deepEqual(boot.servers.find((x) => x.id === g.id).look, again.look);
  // A change after it is an ordinary change, with its line.
  ok(await setG(dave, g.id, { version: 3, ciphertext: lookC(2) }));
  assert.equal(logRows(conv).length, lines + 1);
  assert.equal(blob(pic), undefined, 'the picture it dropped is removed');
  // A removed look has nothing to seal again, nor has a group chat that never had one.
  ok(await clearG(a, g.id, { version: 4 }));
  srv.sql('UPDATE servers SET key_epoch = 3 WHERE id = ?', g.id);
  refused(await setG(a, g.id, { version: 5, ciphertext: lookC(3), reseal: true }), 409, 'not_stale');
  const g2 = await newGroup(a, [b]);
  srv.sql('UPDATE servers SET key_epoch = 2 WHERE id = ?', g2.id);
  refused(await setG(a, g2.id, { version: 1, ciphertext: lookC(2), reseal: true }), 409, 'not_stale');
  assert.equal(lookRow('g:' + g2.id), undefined);
});

// ------------------------------------------------------------------ who may
test('DMs: either person; not after a block either way, nor once the other account is deleted; outsiders get 404 and nothing', async () => {
  const [a, b] = [await member('pa'), await member('pb')];
  const d = await newDm(a, b);
  const conv = 'd:' + d.id;
  ok(await setD(a, d.id, { version: 1, ciphertext: lookD() }));
  const set = ok(await setD(b, d.id, { version: 2, ciphertext: lookD() }));
  for (const [blocker, blocked] of [[a, b], [b, a]]) {
    ok(await as(blocker, 'POST', `/blocks/${blocked.id}`));
    for (const u of [a, b]) {
      refused(await setD(u, d.id, { version: 3, ciphertext: lookD() }), 403);
      refused(await clearD(u, d.id, { version: 3 }), 403);
    }
    // Reading isn't stopped: both still have it.
    for (const u of [a, b]) assert.deepEqual(ok(await as(u, 'GET', '/bootstrap')).dms.find((x) => x.id === d.id).look, set.look);
    ok(await as(blocker, 'DELETE', `/blocks/${blocked.id}`));
  }
  assert.equal(lookRow(conv).version, 2);
  const third = ok(await setD(a, d.id, { version: 3, ciphertext: lookD() }));
  // Outsiders: as if it weren't there, whatever they send, and nothing about it in the answer.
  for (const [m, body] of [['PUT', { version: 4, ciphertext: lookD() }], ['PUT', { version: 1, ciphertext: lookD() }], ['DELETE', { version: 4 }], ['DELETE', {}]]) {
    const r = await as(eve, m, `/dms/${d.id}/look`, body);
    refused(r, 404);
    for (const secret of [third.look.ciphertext, a.id, b.id, '"version"']) assert.ok(!r.text.includes(secret), `${m} leaks ${secret}`);
  }
  refused(await setD(a, 'nope' + hex(4), { version: 1, ciphertext: lookD() }), 404);
  assert.equal(lookRow(conv).version, 3);
  // A deleted account: nothing new goes to it, and the look it set stays (like its messages).
  const c = await member('pc');
  const dc = await newDm(a, c);
  const cs = ok(await setD(c, dc.id, { version: 1, ciphertext: lookD() }));
  ok(await as(c, 'DELETE', '/me', { authKey: c.authKey, confirm: c.username }));
  refused(await setD(a, dc.id, { version: 2, ciphertext: lookD() }), 403, 'deleted');
  refused(await clearD(a, dc.id, { version: 2 }), 403, 'deleted');
  assert.equal(lookRow('d:' + dc.id).author_id, c.id);
  assert.deepEqual(ok(await as(a, 'GET', '/bootstrap')).dms.find((x) => x.id === dc.id).look, cs.look);
});

test('group chats: anyone in it, as for renaming it; not a server, not outsiders, not someone who left', async () => {
  const [a, b, c] = [await member('ga'), await member('gb'), await member('gc')];
  const g = await newGroup(a, [b, c]);
  // Not just the owner: renaming a group chat is for anyone in it, and so is its background.
  ok(await as(c, 'PATCH', `/servers/${g.id}`, { name: 'Renamed' }));
  ok(await setG(c, g.id, { version: 1, ciphertext: lookC(1) }));
  ok(await setG(b, g.id, { version: 2, ciphertext: lookC(1) }));
  for (const [m, body] of [['PUT', { version: 3, ciphertext: lookC(1) }], ['DELETE', { version: 3 }]]) {
    const r = await as(eve, m, `/groups/${g.id}/look`, body);
    refused(r, 404);
    assert.ok(!r.text.includes(lookRow('g:' + g.id).ciphertext));
    refused(await as(eve, m, `/groups/nope${hex(4)}/look`, body), 404);
  }
  // A server isn't a group chat (whoever asks), and outsiders don't learn that it's there.
  refused(await setG(a, space.id, { version: 1, ciphertext: lookC(1) }), 400);
  refused(await clearG(a, space.id, { version: 1 }), 400);
  refused(await setG(eve, space.id, { version: 1, ciphertext: lookC(1) }), 404);
  assert.equal(lookRow('g:' + space.id), undefined);
  // Someone who left is an outsider.
  ok(await as(c, 'POST', `/servers/${g.id}/leave`));
  freshEpoch(g.id);
  refused(await setG(c, g.id, { version: 3, ciphertext: lookC(1) }), 404);
  refused(await clearG(c, g.id, { version: 3 }), 404);
  assert.equal(ok(await clearG(a, g.id, { version: 3 })).look.cleared, true);
});

// ------------------------------------------------------------------ files
test('files: 0-2 of your own unattached uploads, linked to the look; replaced ones removed (quota too), kept ones kept; a message can’t take one', async () => {
  const [a, b, c] = [await member('fa'), await member('fb'), await member('fc')];
  const d = await newDm(a, b);
  const conv = 'd:' + d.id;
  const [f1, f2, f3] = await uploads(b, 3);
  const mine = await upload(a);
  // Not a list of 0-2 distinct upload addresses.
  for (const [i, files] of [[f1, f2, f3], [f1, f1], ['/uploads/../x.bin'], ['/uploads/ABC.bin'], 'nope', [7], [{ url: f1 }], ['uploads/x.bin'], { 0: f1 }].entries()) {
    refused(await setD(i % 2 ? a : b, d.id, { version: 1, ciphertext: lookD(), files }), 400, 'bad_look');
  }
  // Someone else's upload, one that's a message's, one that isn't there: nothing changes, nothing is linked.
  refused(await setD(b, d.id, { version: 1, ciphertext: lookD(), files: [f1, mine] }), 400, 'look_file');
  assert.equal(blob(f1).look_conv, null, 'rolled back');
  const sentFile = await upload(b);
  ok(await as(b, 'POST', `/dms/${d.id}/messages`, { ciphertext: cipher(), files: [sentFile] }));
  refused(await setD(b, d.id, { version: 1, ciphertext: lookD(), files: [sentFile] }), 400, 'look_file');
  refused(await setD(b, d.id, { version: 1, ciphertext: lookD(), files: [`/uploads/${hex(8)}.bin`] }), 400, 'look_file');
  assert.equal(lookRow(conv), undefined);
  // Linked: the look's, not a message's; the row lists them.
  ok(await setD(b, d.id, { version: 1, ciphertext: lookD(), files: [f1, f2] }));
  for (const f of [f1, f2]) { assert.equal(blob(f).look_conv, conv); assert.equal(blob(f).message_id, null); }
  assert.deepEqual(JSON.parse(lookRow(conv).files), [f1, f2]);
  // A message can't take a background's picture, and neither can another conversation's background.
  const sent = ok(await as(b, 'POST', `/dms/${d.id}/messages`, { ciphertext: cipher(), files: [f1] }));
  assert.equal(blob(f1).message_id, null);
  assert.equal(blob(f1).look_conv, conv);
  assert.equal(sent.files, 1, 'it still says what it listed');
  const other = await newDm(b, c);
  refused(await setD(b, other.id, { version: 1, ciphertext: lookD(), files: [f2] }), 400, 'look_file');
  // The same picture again (a new dim, say), by either person: kept.
  ok(await setD(a, d.id, { version: 2, ciphertext: lookD(), files: [f1, f2] }));
  for (const f of [f1, f2]) { assert.equal(blob(f).look_conv, conv); assert.ok(onDisk(f)); }
  // A new picture: someone else's upload is still refused; your own replaces the one that isn't used any more.
  refused(await setD(a, d.id, { version: 3, ciphertext: lookD(), files: [f1, f3] }), 400, 'look_file');
  assert.equal(blob(f2).look_conv, conv, 'nothing changed');
  ok(await setD(b, d.id, { version: 3, ciphertext: lookD(), files: [f3, f1] }));
  assert.equal(blob(f2), undefined);
  assert.equal(quotaRow(f2), undefined, 'it no longer counts towards its uploader’s storage');
  assert.ok(await until(() => !onDisk(f2)), 'removed from disk');
  assert.equal(blob(f3).look_conv, conv); assert.ok(onDisk(f1)); assert.ok(quotaRow(f1));
  // A preset: no picture, so its uploads go.
  ok(await setD(a, d.id, { version: 4, ciphertext: lookD() }));
  for (const f of [f1, f3]) { assert.equal(blob(f), undefined); assert.equal(quotaRow(f), undefined); }
  assert.ok(await until(() => !onDisk(f1) && !onDisk(f3)));
  assert.equal(lookRow(conv).files, '[]');
  // Removing the background takes its picture too.
  const f4 = await upload(a);
  ok(await setD(a, d.id, { version: 5, ciphertext: lookD(), files: [f4] }));
  ok(await clearD(b, d.id, { version: 6 }));
  assert.equal(blob(f4), undefined);
  assert.ok(await until(() => !onDisk(f4)));
  assert.equal(lookRow(conv).files, '[]');
  // Group chats the same.
  const g = await newGroup(a, [b]);
  const gf = await upload(a);
  ok(await setG(a, g.id, { version: 1, ciphertext: lookC(1), files: [gf] }));
  assert.equal(blob(gf).look_conv, 'g:' + g.id);
  refused(await setG(b, g.id, { version: 2, ciphertext: lookC(1), files: [await upload(a)] }), 400, 'look_file');
  ok(await setG(b, g.id, { version: 2, ciphertext: lookC(1), files: [gf] }));
  ok(await clearG(b, g.id, { version: 3 }));
  assert.equal(blob(gf), undefined);
});

test('the sweeps keep a background’s picture however old; Settings → Storage and the admin report say where it is; looks of conversations that are gone are swept', async () => {
  const s = await startServer();
  try {
    const host = await s.register(`sh${hex(3)}`);
    const sp = (await as(host, 'POST', '/servers', { name: 'Sweep' }, s)).json;
    const { code } = (await as(host, 'POST', `/servers/${sp.id}/invites`, {}, s)).json;
    const [a, b, c] = [await member('swa', s, code), await member('swb', s, code), await member('swc', s, code)];
    const d = await newDm(a, b, s);
    const g = await newGroup(a, [b], s);
    const doomed = await newDm(a, c, s);
    const [fd, leftover, leftover2] = await uploads(a, 3, s);
    const fg = await upload(b, s); const fx = await upload(c, s);
    ok(await setD(a, d.id, { version: 1, ciphertext: lookD(), files: [fd] }, s));
    ok(await setG(b, g.id, { version: 1, ciphertext: lookC(1), files: [fg] }, s));
    ok(await setD(c, doomed.id, { version: 1, ciphertext: lookD(), files: [fx] }, s));
    // Old enough for every sweep to take them, if they weren't backgrounds (and two leftovers that aren't).
    const old = Date.now() - 3 * 86400000;
    for (const f of [fd, fg, fx, leftover, leftover2]) { s.sql('UPDATE blobs SET created_at = ? WHERE name = ?', old, path.basename(f)); fs.utimesSync(fileOf(f, s), old / 1000, old / 1000); }
    // Settings → Storage: in that DM or group chat, as its background (no message to show).
    const where = async (u, f) => ok(await as(u, 'GET', '/me/storage/files', undefined, s)).files.find((x) => x.url === f).where;
    assert.deepEqual(await where(a, fd), { type: 'dm', dmId: d.id, look: true });
    assert.deepEqual(await where(b, fg), { type: 'channel', serverId: g.id, channelId: null, look: true });
    assert.deepEqual(await where(a, leftover), { type: 'unsent' });
    // The admin report counts them apart from uploads waiting to be sent.
    const rep = ok(await as(s.owner, 'GET', '/admin/storage/report', undefined, s));
    assert.equal(rep.looks.files, 3);
    assert.ok(rep.looks.bytes > 0);
    assert.equal(rep.pending.files, 2);
    // The admin's "Clean up orphans now" leaves them alone (the leftover goes).
    const clean = ok(await as(s.owner, 'POST', '/admin/storage/cleanup', { authKey: s.owner.authKey }, s));
    assert.ok(clean.files >= 2, JSON.stringify(clean));
    for (const f of [fd, fg, fx]) { assert.ok(blob(f, s).look_conv, f); assert.ok(onDisk(f, s), f); }
    assert.equal(blob(leftover, s), undefined);
    // A conversation that's gone some other way than its clean-up (here, its row deleted by hand).
    const leftover3 = await upload(a, s);
    s.sql('UPDATE blobs SET created_at = ? WHERE name = ?', old, path.basename(leftover3));
    s.sql('DELETE FROM dm_channels WHERE id = ?', doomed.id);
    // The hourly sweep of uploads never attached to anything, and the daily one of leftovers, right after a restart.
    await s.restart({ ORPHAN_SWEEP_DELAY_MS: '200', UNLINKED_SWEEP_DELAY_MS: '200' });
    assert.ok(await until(() => !blob(leftover3, s) && !lookRow('d:' + doomed.id, s), 8000), 'both sweeps ran');
    for (const f of [fd, fg]) { assert.ok(blob(f, s).look_conv, f); assert.ok(onDisk(f, s), f); assert.ok(quotaRow(f, s), f); }
    assert.equal(logRows('d:' + doomed.id, s).length, 0);
    assert.equal(blob(fx, s), undefined);
    assert.ok(await until(() => !onDisk(fx, s)));
    assert.equal(ok(await as(a, 'GET', '/bootstrap', undefined, s)).dms.find((x) => x.id === d.id).look.version, 1, 'the others are still there');
  } finally { await s.stop(); }
});

// ------------------------------------------------------------------ delivery
test('live: dm:look to both people and group:look to the group’s members, each with its line; nobody else', async () => {
  const [a, b, c, o] = [await member('la'), await member('lb'), await member('lc'), await member('lo')];
  const d = await newDm(a, b);
  const g = await newGroup(a, [b, c]);
  const [sa, sb, sc, so] = [await sock(a), await sock(b), await sock(c), await sock(o)];
  const dmA = collect(sa, 'dm:look'); const dmB = collect(sb, 'dm:look'); const dmO = collect(so, 'dm:look'); const dmC = collect(sc, 'dm:look');
  const set = ok(await setD(a, d.id, { version: 1, ciphertext: lookD() }));
  assert.ok(await until(() => dmA.length === 1 && dmB.length === 1));
  const line = logRows('d:' + d.id)[0];
  assert.deepEqual(dmB[0], { dmId: d.id, look: set.look, event: { id: line.id, userId: a.id, action: 'set', createdAt: set.look.updatedAt } });
  assert.deepEqual(dmA[0], dmB[0]);
  const cleared = ok(await clearD(b, d.id, { version: 2 }));
  assert.ok(await until(() => dmA.length === 2 && dmB.length === 2));
  assert.deepEqual(dmA[1].look, cleared.look);
  assert.equal(dmA[1].event.action, 'clear');
  assert.equal(dmA[1].event.userId, b.id);
  assert.equal(dmA[1].event.id, logRows('d:' + d.id)[1].id);
  // Nothing for a stale or refused change.
  refused(await setD(a, d.id, { version: 2, ciphertext: lookD() }), 409, 'stale_look');
  // Group chats: its members, not someone who left, nor anyone else.
  ok(await as(c, 'POST', `/servers/${g.id}/leave`));
  freshEpoch(g.id);
  const gA = collect(sa, 'group:look'); const gB = collect(sb, 'group:look'); const gC = collect(sc, 'group:look'); const gO = collect(so, 'group:look');
  const gs = ok(await setG(b, g.id, { version: 1, ciphertext: lookC(1) }));
  assert.ok(await until(() => gA.length === 1 && gB.length === 1));
  assert.deepEqual(gA[0], { serverId: g.id, look: gs.look, event: { id: logRows('g:' + g.id)[0].id, userId: b.id, action: 'set', createdAt: gs.look.updatedAt } });
  await sleep(250);
  assert.equal(dmO.length + dmC.length + gC.length + gO.length, 0, 'nobody else hears about it');
});

test('bootstrap: every DM and group chat carries its look (null without one, { version, cleared } once removed), and so does what a new member gets', async () => {
  const [a, b, c] = [await member('ba'), await member('bb'), await member('bc')];
  const d1 = await newDm(a, b); const d2 = await newDm(a, c); const d3 = await newDm(a, await member('bd'));
  const g1 = await newGroup(a, [b]); const g2 = await newGroup(a, [c]);
  const s1 = ok(await setD(b, d1.id, { version: 1, ciphertext: lookD() }));
  ok(await setD(a, d3.id, { version: 1, ciphertext: lookD() })); ok(await clearD(a, d3.id, { version: 2 }));
  const sg = ok(await setG(b, g1.id, { version: 1, ciphertext: lookC(1) }));
  ok(await setG(c, g2.id, { version: 1, ciphertext: lookC(1) })); ok(await clearG(c, g2.id, { version: 2 }));
  const boot = ok(await as(a, 'GET', '/bootstrap'));
  const dm = (id) => boot.dms.find((x) => x.id === id);
  const server = (id) => boot.servers.find((x) => x.id === id);
  assert.deepEqual(dm(d1.id).look, s1.look);
  assert.equal(dm(d2.id).look, null);
  assert.deepEqual(dm(d3.id).look, { version: 2, cleared: true });
  assert.deepEqual(server(g1.id).look, sg.look);
  assert.deepEqual(server(g2.id).look, { version: 2, cleared: true });
  assert.equal(server(space.id).look, undefined, 'servers have none');
  // Opening the DM again, and a new message's copy of the DM, say it too.
  assert.deepEqual(ok(await as(a, 'POST', '/dms', { userId: b.id })).look, s1.look);
  const sb = await sock(b);
  const msgs = collect(sb, 'dm:message');
  ok(await as(a, 'POST', `/dms/${d1.id}/messages`, { ciphertext: cipher() }));
  assert.ok(await until(() => msgs.length === 1));
  assert.deepEqual(msgs[0].dm.look, s1.look);
  // Someone added to the group gets it with the group; a rename's update carries it too.
  const newbie = await member('bn');
  const sn = await sock(newbie);
  const added = collect(sn, 'server:add');
  const updates = collect(sb, 'server:update');
  ok(await as(b, 'POST', `/groups/${g1.id}/members`, { userId: newbie.id }));
  assert.ok(await until(() => added.length === 1));
  assert.deepEqual(added[0].server.look, sg.look);
  freshEpoch(g1.id);
  ok(await as(newbie, 'PATCH', `/servers/${g1.id}`, { name: 'Renamed' }));
  assert.ok(await until(() => updates.some((u) => u.id === g1.id && u.name === 'Renamed')));
  assert.deepEqual(updates.find((u) => u.id === g1.id && u.name === 'Renamed').look, sg.look);
  // Nobody else's bootstrap mentions it.
  const theirs = ok(await as(eve, 'GET', '/bootstrap'));
  assert.ok(!JSON.stringify(theirs).includes(sg.look.ciphertext));
  assert.ok(!JSON.stringify(theirs).includes(s1.look.ciphertext));
});

test('lookEvents: a history page carries the changes in its time range, paged exactly like timerEvents', async () => {
  const [a, c] = [await member('ha'), await member('hc')];
  const d = await newDm(a, c);
  const conv = 'd:' + d.id;
  const T0 = Date.now() - 600000;
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const t = T0 + i * 1000;
    const id = idAt(t);
    ids.push(id);
    srv.sql('INSERT INTO dm_messages (id, dm_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)', id, d.id, a.id, cipher(), t);
  }
  // One change before the first message, and one after each; the same moments in the timer's log, to compare.
  const times = [T0 - 500, ...ids.map((_, i) => T0 + i * 1000 + 500)];
  const lines = {};
  for (const [i, t] of times.entries()) {
    const id = idAt(t);
    lines[t] = id;
    srv.sql('INSERT INTO look_log (id, conv, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)', id, conv, i % 2 ? a.id : c.id, i % 3 ? 'set' : 'clear', t);
    srv.sql('INSERT INTO disappear_log (id, conv, user_id, secs, prev_secs, created_at) VALUES (?, ?, ?, ?, ?, ?)', idAt(t), conv, a.id, 3600, 0, t);
  }
  const page = async (q) => {
    const r = ok(await as(a, 'GET', `/dms/${d.id}/messages${q}`));
    const at = r.lookEvents.map((e) => e.createdAt);
    assert.deepEqual(at, r.timerEvents.map((e) => e.at), `the same range as the timer's: ${q}`);
    return { ids: r.messages.map((m) => m.id), at, r };
  };
  const after = (i) => T0 + i * 1000 + 500;
  let p = await page('?limit=4');
  assert.deepEqual(p.ids, ids.slice(6));
  assert.deepEqual(p.at, [after(6), after(7), after(8), after(9)]);
  p = await page(`?limit=4&before=${ids[6]}`);
  assert.deepEqual(p.ids, ids.slice(2, 6));
  assert.deepEqual(p.at, [after(2), after(3), after(4), after(5)], 'ends where the page after it began');
  p = await page(`?limit=4&before=${ids[2]}`);
  assert.deepEqual(p.ids, ids.slice(0, 2));
  assert.deepEqual(p.at, [T0 - 500, after(0), after(1)], 'the first page has everything before it');
  p = await page(`?limit=2&after=${ids[5]}`);
  assert.deepEqual(p.ids, ids.slice(6, 8));
  assert.deepEqual(p.at, [after(5), after(6)], 'starts where the page before it ended');
  p = await page(`?limit=3&after=${ids[7]}`);
  assert.deepEqual(p.ids, ids.slice(8));
  assert.deepEqual(p.at, [after(7), after(8), after(9)], 'the newest page runs to now');
  p = await page(`?around=${ids[5]}`);
  assert.deepEqual(p.at, times);
  // Each entry: who, what and when, and the id its live event had.
  assert.deepEqual(p.r.lookEvents[0], { id: lines[T0 - 500], userId: c.id, action: 'clear', createdAt: T0 - 500 });
  assert.deepEqual(p.r.lookEvents[1], { id: lines[after(0)], userId: a.id, action: 'set', createdAt: after(0) });
  // A change made now is on the newest page with the id its event had.
  const set = ok(await setD(c, d.id, { version: 1, ciphertext: lookD() }));
  const newest = ok(await as(a, 'GET', `/dms/${d.id}/messages?limit=4`)).lookEvents;
  assert.deepEqual(newest.map((e) => e.createdAt), [after(6), after(7), after(8), after(9), set.look.updatedAt]);
  assert.deepEqual(newest.at(-1), { id: logRows(conv).at(-1).id, userId: c.id, action: 'set', createdAt: set.look.updatedAt });
  // A group chat's chat has its group's changes; a server's channels and a group's call have no lookEvents at all.
  const g = await newGroup(a, [c]);
  const gs = ok(await setG(c, g.id, { version: 1, ciphertext: lookC(1) }));
  const gp = ok(await as(a, 'GET', `/channels/${g.chat.id}/messages`));
  assert.deepEqual(gp.lookEvents, [{ id: logRows('g:' + g.id)[0].id, userId: c.id, action: 'set', createdAt: gs.look.updatedAt }]);
  assert.ok(!('lookEvents' in ok(await as(a, 'GET', `/channels/${g.call.id}/messages`))));
  assert.ok(!('lookEvents' in ok(await as(a, 'GET', `/channels/${space.channels.find((x) => x.type === 'text').id}/messages`))));
  // Outsiders get no page at all.
  refused(await as(eve, 'GET', `/dms/${d.id}/messages`), 404);
  refused(await as(eve, 'GET', `/channels/${g.chat.id}/messages`), 404);
});

test('the log keeps the newest 50 changes per conversation', async () => {
  const [a, b] = [await member('ka'), await member('kb')];
  const d = await newDm(a, b); const d2 = await newDm(a, await member('kc'));
  const conv = 'd:' + d.id;
  const T0 = Date.now() - 3600000;
  for (let i = 0; i < 60; i++) srv.sql('INSERT INTO look_log (id, conv, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)', idAt(T0 + i), conv, a.id, 'set', T0 + i);
  for (let i = 0; i < 5; i++) srv.sql('INSERT INTO look_log (id, conv, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)', idAt(T0 + i), 'd:' + d2.id, a.id, 'set', T0 + i);
  const set = ok(await setD(b, d.id, { version: 1, ciphertext: lookD() }));
  const rows = logRows(conv);
  assert.equal(rows.length, 50);
  assert.equal(rows.at(-1).created_at, set.look.updatedAt);
  assert.equal(rows[0].created_at, T0 + 11, 'the oldest went');
  assert.equal(logRows('d:' + d2.id).length, 5, 'other conversations keep theirs');
  // A page hands out at most 50.
  assert.equal(ok(await as(a, 'GET', `/dms/${d.id}/messages`)).lookEvents.length, 50);
});

// ------------------------------------------------------------------ clean-up
test('clean-up: deleting a group chat, or its last member leaving, takes its look, picture and log; deleting an account leaves the looks it set', async () => {
  const [a, b] = [await member('ca'), await member('cb')];
  const gone = async (g, f) => {
    assert.equal(lookRow('g:' + g.id), undefined);
    assert.equal(logRows('g:' + g.id).length, 0);
    assert.equal(blob(f), undefined);
    assert.equal(quotaRow(f), undefined);
    assert.ok(await until(() => !onDisk(f)), 'its picture is removed from disk');
  };
  // Deleted by its owner.
  const g1 = await newGroup(a, [b]);
  const f1 = await upload(b);
  ok(await setG(b, g1.id, { version: 1, ciphertext: lookC(1), files: [f1] }));
  ok(await setG(a, g1.id, { version: 2, ciphertext: lookC(1), files: [f1] }));
  ok(await as(a, 'DELETE', `/servers/${g1.id}`, { authKey: a.authKey }));
  await gone(g1, f1);
  // The last member leaving.
  const g2 = await newGroup(a, [b]);
  const f2 = await upload(a);
  ok(await setG(a, g2.id, { version: 1, ciphertext: lookC(1), files: [f2] }));
  ok(await as(b, 'POST', `/servers/${g2.id}/leave`));
  assert.ok(lookRow('g:' + g2.id), 'still someone in it');
  ok(await as(a, 'POST', `/servers/${g2.id}/leave`));
  await gone(g2, f2);
  // The last member's account being deleted.
  const [x, y] = [await member('cx'), await member('cy')];
  const g3 = await newGroup(x, [y]);
  const f3 = await upload(y);
  ok(await setG(y, g3.id, { version: 1, ciphertext: lookC(1), files: [f3] }));
  ok(await as(x, 'POST', `/servers/${g3.id}/leave`));
  ok(await as(y, 'DELETE', '/me', { authKey: y.authKey, confirm: y.username }));
  await gone(g3, f3);
  // An account deleted: the DM background it set stays, picture and all, like the messages it sent.
  const [p, q] = [await member('cp'), await member('cq')];
  const d = await newDm(p, q);
  const fp = await upload(p);
  const set = ok(await setD(p, d.id, { version: 1, ciphertext: lookD(), files: [fp] }));
  ok(await as(p, 'DELETE', '/me', { authKey: p.authKey, confirm: p.username }));
  assert.equal(lookRow('d:' + d.id).ciphertext, set.look.ciphertext);
  assert.equal(blob(fp).look_conv, 'd:' + d.id);
  assert.ok(onDisk(fp));
  assert.equal(logRows('d:' + d.id).length, 1);
});

// ------------------------------------------------------------------ limits, queries, upgrade
test('rate limit: look:<uid>, 20 a minute, shared by the four routes', async () => {
  const [u, v] = [await member('ra'), await member('rb')];
  const d = await newDm(u, v);
  const g = await newGroup(u, [v]);
  const calls = [() => setD(u, d.id, {}), () => clearD(u, d.id, {}), () => setG(u, g.id, {}), () => clearG(u, g.id, {})];
  for (let i = 0; i < 20; i++) refused(await calls[i % 4](), 400, 'bad_look');
  for (const call of calls) refused(await call(), 429, 'rate_limited');
  assert.equal((await setD(v, d.id, {})).status, 400, 'the other person has a budget of their own');
  assert.equal((await as(u, 'GET', `/dms/${d.id}/messages`)).status, 200, 'and reading isn’t part of it');
});

test('the log and the look files are read through their indexes', () => {
  const dbh = srv.db();
  const plan = (q, ...a) => dbh.prepare('EXPLAIN QUERY PLAN ' + q).all(...a).map((r) => r.detail).join(' | ');
  try {
    assert.match(plan('SELECT * FROM look_log WHERE conv = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?', 'd:x', 0, 1, 50),
      /SEARCH look_log USING INDEX idx_look_log_conv \(conv=\? AND created_at>\? AND created_at<\?\)/);
    assert.match(plan('SELECT name FROM blobs WHERE look_conv = ?', 'd:x'), /SEARCH blobs USING (COVERING )?INDEX idx_blobs_look \(look_conv=\?\)/);
    const idx = (name) => dbh.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(name).sql;
    assert.match(idx('idx_blobs_look'), /ON blobs\(look_conv\) WHERE look_conv IS NOT NULL/);
  } finally { dbh.close(); }
});

test('upgrading a version 21 database adds the tables, the column and the index, after a backup copy', async () => {
  const CURRENT = Number(/const SCHEMA_VERSION = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8'))[1]);
  assert.equal(CURRENT, 22);
  const s = await startServer();
  try {
    const host = await s.register(`uh${hex(3)}`);
    const sp = (await as(host, 'POST', '/servers', { name: 'Old' }, s)).json;
    const { code } = (await as(host, 'POST', `/servers/${sp.id}/invites`, {}, s)).json;
    const [a, b] = [await member('ua', s, code), await member('ub', s, code)];
    const d = await newDm(a, b, s);
    const g = await newGroup(a, [b], s);
    const file = await upload(a, s);
    const sent = ok(await as(a, 'POST', `/dms/${d.id}/messages`, { ciphertext: cipher(), files: [file] }, s));
    // As a version 21 database: none of it.
    s.sql('DROP TABLE chat_looks'); s.sql('DROP TABLE look_log'); s.sql('DROP INDEX idx_blobs_look'); s.sql('ALTER TABLE blobs DROP COLUMN look_conv');
    s.sql('PRAGMA user_version = 21');
    await s.restart();
    const names = s.sql("SELECT name FROM sqlite_master WHERE name IN ('chat_looks', 'look_log', 'idx_look_log_conv', 'idx_blobs_look')").map((r) => r.name).sort();
    assert.deepEqual(names, ['chat_looks', 'idx_blobs_look', 'idx_look_log_conv', 'look_log']);
    assert.equal(blob(file, s).look_conv, null);
    assert.equal(blob(file, s).message_id, sent.id, 'attachments are as they were');
    assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).filter((f) => /^hearth-before-v22-.*\.db$/.test(f)).length, 1, 'after a backup copy');
    const d2 = s.db();
    try { assert.equal(d2.pragma('user_version', { simple: true }), 22); } finally { d2.close(); }
    const boot = ok(await as(a, 'GET', '/bootstrap', undefined, s));
    assert.equal(boot.dms.find((x) => x.id === d.id).look, null);
    assert.equal(boot.servers.find((x) => x.id === g.id).look, null);
    const pic = await upload(b, s);
    ok(await setD(b, d.id, { version: 1, ciphertext: lookD(), files: [pic] }, s));
    ok(await setG(b, g.id, { version: 1, ciphertext: lookC(1) }, s));
    assert.equal(blob(pic, s).look_conv, 'd:' + d.id);
    assert.equal(ok(await as(a, 'GET', `/dms/${d.id}/messages`, undefined, s)).lookEvents.length, 1);
  } finally { await s.stop(); }
});
