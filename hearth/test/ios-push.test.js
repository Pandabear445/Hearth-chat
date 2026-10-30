// The iPhone app's notifications, through a running server: subscribing with an APNs device token, what the server
// sends Apple when someone is messaged, what Apple's answers do to the device's row, and the server's settings
// (apnsEnabled, sandbox builds, a bad key, Universal Links). Apple is a fake HTTP/2 server here
// (APNS_HOST_OVERRIDE, honoured only with NODE_ENV=test), trusted through NODE_EXTRA_CA_CERTS. server/apns.js on its
// own is test/apns.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http2 = require('node:http2');
const os = require('node:os');
const path = require('node:path');
const { startServer, hex, b64, sleep } = require('./helpers');

const waitFor = async (fn, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { if (await fn()) return true; await sleep(50); } return false; };

// The phone's side of RFC 8291, as the notification extension does it.
function decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16); const idlen = body[20];
  const serverPub = body.subarray(21, 21 + idlen); const record = body.subarray(21 + idlen);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(serverPub), auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  return padded.subarray(0, padded.lastIndexOf(2));
}
// What the app hands the page: a device token and keys it made itself.
const devices = new Map(); // token → { ecdh, auth }
function phone(env = 'production') {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const token = crypto.randomBytes(32).toString('hex');
  devices.set(token, { ecdh, auth });
  return { token, environment: env, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, endpoint: `apns:${env}:${token}` };
}

// ------------------------------------------------------------------ the fake APNs
const hits = []; // { token, headers, json, payload, plain }
const answers = new Map(); // token → { status, reason } (default 200)
let fallback = null; // when set, the answer for every token
let work; let fake; let srv; let bare;
const fakeSessions = new Set();
const apnsKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });

before(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-iospush-'));
  const pems = await require('selfsigned').generate([{ name: 'commonName', value: 'api.push.apple.test' }], {
    keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
  });
  fs.writeFileSync(path.join(work, 'ca.pem'), pems.cert);
  fake = http2.createSecureServer({ key: pems.private, cert: pems.cert });
  fake.on('session', (s) => { fakeSessions.add(s); s.on('close', () => fakeSessions.delete(s)); s.on('error', () => {}); });
  fake.on('stream', (stream, headers) => {
    const parts = [];
    stream.on('error', () => {});
    stream.on('data', (d) => parts.push(d));
    stream.on('end', () => {
      const token = String(headers[':path']).split('/').pop();
      const hit = { token, headers, json: null, payload: null, plain: null };
      try {
        hit.json = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const k = devices.get(token);
        hit.plain = decrypt(Buffer.from(hit.json.enc, 'base64'), k.ecdh, k.auth);
        hit.payload = JSON.parse(hit.plain.toString('utf8'));
      } catch { /* undecryptable */ }
      hits.push(hit);
      const a = fallback || answers.get(token) || { status: 200 };
      stream.respond({ ':status': a.status });
      stream.end(a.reason ? JSON.stringify({ reason: a.reason }) : undefined);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const apnsEnv = {
    NODE_EXTRA_CA_CERTS: path.join(work, 'ca.pem'), APNS_KEY: apnsKey, APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'app.hearth.mobile',
    APNS_HOST_OVERRIDE: `127.0.0.1:${fake.address().port}`, LOG_FORMAT: 'json',
  };
  srv = await startServer({ ...apnsEnv, APPLE_APP_IDS: 'TEAM123456.app.hearth.mobile, not an id' });
  // Web Push off (a VAPID key that can't load), APNs on: only iPhones get notifications.
  bare = await startServer({ ...apnsEnv, VAPID_PUBLIC_KEY: 'bad', VAPID_PRIVATE_KEY: 'bad' });
});
after(async () => {
  if (srv) await srv.stop();
  if (bare) await bare.stop();
  if (fake) { for (const s of fakeSessions) s.destroy(); await new Promise((r) => fake.close(() => r())); }
  fs.rmSync(work, { recursive: true, force: true });
});

const as = (s, u, method, p, body, token = u.token) => s.api(method, p, { token, ip: u.ip, body });
const subscribe = (s, u, dev, extra = {}, token = u.token) => as(s, u, 'POST', '/push/subscribe', { subscription: { type: 'apns', token: dev.token, environment: dev.environment, keys: dev.keys }, ...extra }, token);
const rows = (s, uid) => s.sql('SELECT * FROM push_subs WHERE user_id = ? ORDER BY created_at', uid);
const hitsFor = (dev) => hits.filter((h) => h.token === dev.token);
async function dmLine(s, from, to) {
  assert.equal((await as(s, from, 'POST', '/friends', { username: to.username })).status, 200);
  assert.equal((await as(s, to, 'POST', `/friends/${from.id}/accept`)).status, 200);
  const dm = (await as(s, from, 'POST', '/dms', { userId: to.id })).json;
  const send = async () => { const r = await as(s, from, 'POST', `/dms/${dm.id}/messages`, { ciphertext: 'v2:' + b64(60) }); assert.equal(r.status, 200, r.text); return r.json; };
  send.dm = dm;
  return send;
}

// ================================================================== tests
test('ios-push-1: /api/config says whether this server can notify iPhones; apple-app-site-association lists the app for /invite/ links', async () => {
  assert.equal(srv.config.apnsEnabled, true);
  assert.equal(srv.config.pushEnabled, true, 'Web Push is still on next to it');
  assert.equal(bare.config.apnsEnabled, true);
  assert.equal(bare.config.pushEnabled, false);
  const r = await srv.call('GET', '/.well-known/apple-app-site-association');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(r.json, { applinks: { details: [{ appIDs: ['TEAM123456.app.hearth.mobile'], components: [{ '/': '/invite/*' }] }] } }, 'the bad entry is left out');
  assert.match(srv.log, /bad_app_id/);
  const none = await bare.call('GET', '/.well-known/apple-app-site-association');
  assert.equal(none.status, 404, 'APPLE_APP_IDS unset');
});

test('ios-push-2: subscribing checks the token, the environment and the keys, and saves an apns:<env>:<token> row', async () => {
  const u = await srv.register();
  const good = phone();
  const bad = [
    { ...good, token: good.token.slice(0, 62) }, // too short
    { ...good, token: 'z'.repeat(64) },
    { ...good, token: 'a'.repeat(201) },
    { ...good, token: 123 },
    { ...good, environment: 'sandbox' }, // not without APNS_ALLOW_SANDBOX
    { ...good, environment: 'development' },
    { ...good, environment: undefined },
    { ...good, keys: { ...good.keys, auth: crypto.randomBytes(15).toString('base64url') } },
    { ...good, keys: { ...good.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url') } },
    { ...good, keys: null },
  ];
  for (const dev of bad) assert.equal((await subscribe(srv, u, dev)).status, 400, JSON.stringify(dev).slice(0, 120));
  assert.equal(rows(srv, u.id).length, 0, 'nothing stored');
  // An endpoint isn't how an iPhone subscribes, and type 'apns' never falls back to one.
  assert.equal((await as(srv, u, 'POST', '/push/subscribe', { subscription: { type: 'apns', endpoint: 'https://api.push.apple.com/3/device/x', keys: good.keys } })).status, 400);
  // Upper-case hex is the same token.
  const r = await subscribe(srv, u, { ...good, token: good.token.toUpperCase() });
  assert.equal(r.status, 200, r.text);
  const [row] = rows(srv, u.id);
  assert.equal(row.endpoint, `apns:production:${good.token}`);
  assert.equal(row.kind, 'apns');
  assert.equal(row.apns_env, 'production');
  assert.deepEqual(JSON.parse(row.keys), good.keys);
  assert.ok(row.session_id && row.token_hash, 'tied to the session and token, like any subscription');
  // Subscribing again is the same row.
  assert.equal((await subscribe(srv, u, good)).status, 200);
  assert.equal(rows(srv, u.id).length, 1);
  // Not signed in: refused.
  assert.equal((await srv.api('POST', '/push/subscribe', { body: { subscription: { type: 'apns', token: good.token, environment: 'production', keys: good.keys } } })).status, 401);
  // Web Push rows are still kind 'webpush' (every row from before this version is too).
  assert.equal(srv.sql("SELECT COUNT(*) n FROM push_subs WHERE kind = 'apns' AND apns_env IS NULL")[0].n, 0);
});

test('ios-push-3: "replaces" swaps a phone’s old token for its new one, and the ten-device limit counts iPhones like the rest', async () => {
  const u = await srv.register(); const other = await srv.register();
  const a = phone(); const b = phone();
  assert.equal((await subscribe(srv, u, a)).status, 200);
  assert.equal((await subscribe(srv, u, b, { replaces: a.endpoint.toUpperCase().replace('APNS:PRODUCTION', 'apns:production') })).status, 200);
  assert.deepEqual(rows(srv, u.id).map((x) => x.endpoint), [b.endpoint]);
  // Someone else can't remove it by naming it.
  assert.equal((await subscribe(srv, other, phone(), { replaces: b.endpoint })).status, 200);
  assert.deepEqual(rows(srv, u.id).map((x) => x.endpoint), [b.endpoint]);
  // Ten devices already: the new iPhone pushes out the oldest.
  const sid = rows(srv, u.id)[0].session_id;
  srv.sql('UPDATE push_subs SET created_at = ? WHERE endpoint = ?', Date.now() - 100000, b.endpoint);
  for (let i = 1; i < 10; i++) {
    srv.sql('INSERT INTO push_subs (endpoint, user_id, keys, ua, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?)', `https://push.example.test/dev${i}${hex(4)}`, u.id, JSON.stringify(phone().keys), 'test', Date.now() - 50000 + i, sid);
  }
  assert.equal(rows(srv, u.id).length, 10);
  const c = phone();
  assert.equal((await subscribe(srv, u, c)).status, 200);
  const left = rows(srv, u.id).map((x) => x.endpoint);
  assert.equal(left.length, 10);
  assert.ok(left.includes(c.endpoint) && !left.includes(b.endpoint), 'the oldest (the first iPhone) went');
});

test('ios-push-4: unsubscribing with apns:<env>:<token>, signing out and revoking the session all remove the row', async () => {
  const u = await srv.register();
  const a = phone();
  assert.equal((await subscribe(srv, u, a)).status, 200);
  assert.equal((await as(srv, u, 'POST', '/push/unsubscribe', { endpoint: `apns:production:${a.token.toUpperCase()}` })).status, 200);
  assert.equal(rows(srv, u.id).length, 0);
  // Sign-out.
  const login = await srv.login(u);
  assert.equal(login.status, 200, login.text);
  const second = login.json.token;
  const b = phone();
  assert.equal((await subscribe(srv, u, b, {}, second)).status, 200);
  assert.equal((await as(srv, u, 'POST', '/auth/logout', undefined, second)).status, 200);
  assert.equal(rows(srv, u.id).length, 0, 'gone with the session that made it');
  // Revoked from another device.
  const third = (await srv.login(u)).json.token;
  const c = phone();
  assert.equal((await subscribe(srv, u, c, {}, third)).status, 200);
  const sessions = (await as(srv, u, 'GET', '/me/sessions')).json.active;
  const sid = rows(srv, u.id)[0].session_id;
  assert.ok(sessions.some((s) => s.id === sid));
  assert.equal((await as(srv, u, 'DELETE', `/me/sessions/${sid}`)).status, 200);
  assert.equal(rows(srv, u.id).length, 0);
});

test('ios-push-5: a message reaches the iPhone through Apple: the hidden-preview alert in the clear, the rest encrypted to the phone and padded; nothing while the app is open', async () => {
  const u = await srv.register(); const friend = await srv.register();
  const send = await dmLine(srv, friend, u);
  const dev = phone();
  assert.equal((await subscribe(srv, u, dev)).status, 200);
  const before = Date.now();
  const msg = await send();
  assert.ok(await waitFor(() => hitsFor(dev).length === 1), 'Apple got one');
  const h = hitsFor(dev)[0];
  assert.equal(h.headers[':path'], `/3/device/${dev.token}`);
  assert.equal(h.headers['apns-topic'], 'app.hearth.mobile');
  assert.match(h.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(h.headers['apns-collapse-id'], 'd:' + send.dm.id);
  assert.deepEqual(h.json.aps.alert, { title: srv.config.name, body: 'New message' });
  assert.equal(h.json.aps['interruption-level'], 'active');
  assert.equal(h.json.aps['mutable-content'], 1);
  assert.equal(h.json.v, 1);
  assert.equal(h.json.tag, 'd:' + send.dm.id);
  assert.equal(h.json.url, '/#m/' + msg.id);
  assert.ok(h.json.at >= before - 1000);
  assert.doesNotMatch(JSON.stringify(h.json), new RegExp(friend.username), 'not who wrote');
  // Inside: exactly what Web Push would carry, padded the same way (to 256 bytes, at most 2048 for Apple).
  assert.ok(h.payload, 'enc decrypts with the phone’s keys');
  for (const k of Object.keys(h.payload)) assert.ok(['title', 'body', 'tag', 'url', 'at', 'generic', '_'].includes(k), `unexpected field ${k}`);
  assert.equal(h.payload.title, srv.config.name);
  assert.equal(h.payload.url, '/#m/' + msg.id);
  assert.equal(h.plain.length % 256, 0, `${h.plain.length} bytes`);
  assert.ok(h.plain.length <= 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(h.json)) < 4096);
  // With Hearth open (a live connection), the page shows it itself: nothing goes to Apple.
  const sock = await srv.socket(u.token);
  try {
    await send();
    await sleep(800);
    assert.equal(hitsFor(dev).length, 1, 'skipped while online');
  } finally { sock.disconnect(); }
  assert.equal(rows(srv, u.id)[0].fails, 0);
});

test('ios-push-6: with Web Push off, iPhones still get notifications and Web Push rows are left alone', async () => {
  const u = await bare.register(); const friend = await bare.register();
  const send = await dmLine(bare, friend, u);
  const dev = phone();
  assert.equal((await subscribe(bare, u, dev)).status, 200);
  // A browser's subscription from before VAPID broke: not sent to (there's no key to sign with), not dropped.
  const web = 'https://127.0.0.1:9/web-push-endpoint';
  bare.sql('INSERT INTO push_subs (endpoint, user_id, keys, ua, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?)', web, u.id, JSON.stringify(phone().keys), 'test', Date.now() - 1000, rows(bare, u.id)[0].session_id);
  // And a browser can't subscribe now.
  assert.equal((await as(bare, u, 'POST', '/push/subscribe', { subscription: { endpoint: 'https://push.example.test/x', keys: phone().keys } })).status, 400);
  await send();
  assert.ok(await waitFor(() => hitsFor(dev).length === 1), 'the iPhone got it');
  await sleep(300);
  const w = bare.sql('SELECT * FROM push_subs WHERE endpoint = ?', web)[0];
  assert.ok(w, 'kept');
  assert.equal(w.kind, 'webpush');
  assert.equal(w.fails, 0);
  assert.equal(w.retry_at, null);
});

test('ios-push-7: Apple’s answers: a dead token is dropped, 429 sits out, and a refused server key never costs a device anything', async () => {
  const u = await srv.register(); const friend = await srv.register();
  const send = await dmLine(srv, friend, u);
  const gone = phone(); const busy = phone(); const fine = phone();
  answers.set(gone.token, { status: 410, reason: 'Unregistered' });
  answers.set(busy.token, { status: 429, reason: 'TooManyRequests' });
  for (const d of [gone, busy, fine]) assert.equal((await subscribe(srv, u, d)).status, 200);
  await send();
  assert.ok(await waitFor(() => !rows(srv, u.id).some((r) => r.endpoint === gone.endpoint)), 'Unregistered: dropped');
  assert.ok(await waitFor(() => (rows(srv, u.id).find((r) => r.endpoint === busy.endpoint) || {}).retry_at > 0), '429: sits out');
  const b = rows(srv, u.id).find((r) => r.endpoint === busy.endpoint);
  assert.equal(b.fails, 0);
  assert.ok(Math.abs(b.retry_at - (Date.now() + 5 * 60000)) < 30000, 'five minutes without Retry-After');
  assert.equal(hitsFor(fine).length, 1);
  // The server's key is refused: tried twice, then nothing more goes to Apple for 15 minutes, and every device stays.
  fallback = { status: 403, reason: 'InvalidProviderToken' };
  const n = hits.length;
  await send();
  assert.ok(await waitFor(() => /apns_config/.test(srv.log)), 'the operator is told');
  await send();
  await sleep(500);
  assert.equal(hits.length - n, 2, 'one send and one retry, then the breaker');
  for (const r of rows(srv, u.id)) { assert.equal(r.fails, 0, r.endpoint); }
  assert.ok(rows(srv, u.id).some((r) => r.endpoint === fine.endpoint), 'kept');
  assert.equal((srv.log.match(/apns_config/g) || []).length, 1, 'logged once');
  assert.ok(!srv.log.includes(apnsKey.split('\n')[1]), 'the key is never logged');
  fallback = null;
});

test('ios-push-8: sandbox tokens only with APNS_ALLOW_SANDBOX=1; a bad key turns iPhone notifications off without losing devices', async () => {
  await bare.restart({ APNS_ALLOW_SANDBOX: '1' });
  const u = await bare.register(); const friend = await bare.register();
  const send = await dmLine(bare, friend, u);
  const dev = phone('sandbox');
  assert.equal((await subscribe(bare, u, dev)).status, 200);
  assert.equal(rows(bare, u.id)[0].apns_env, 'sandbox');
  await send();
  assert.ok(await waitFor(() => hitsFor(dev).length === 1), 'a development build gets it');
  // Now with a key that can't be read.
  const broken = apnsKey.replace(apnsKey.split('\n')[1], 'A'.repeat(64));
  await bare.restart({ APNS_KEY: broken });
  const config = (await bare.api('GET', '/config')).json;
  assert.equal(config.apnsEnabled, false);
  assert.match(bare.log, /apns_disabled/);
  assert.ok(!bare.log.includes(apnsKey.split('\n')[1]) && !bare.log.includes('A'.repeat(64)), 'no key text in the log');
  const r = await subscribe(bare, u, phone());
  assert.equal(r.status, 400);
  assert.match(r.json.error, /iPhone notifications/);
  await send();
  await sleep(500);
  assert.equal(hitsFor(dev).length, 1, 'nothing sent');
  assert.ok(rows(bare, u.id).some((x) => x.endpoint === dev.endpoint), 'the iPhone is still registered for when the key is fixed');
});

test('ios-push-9: a wrong APNS_TOPIC (every token "not for this app") unsubscribes no iPhone', async () => {
  // Apple answers DeviceTokenNotForTopic for every device when the topic isn't the app's bundle ID.
  await bare.restart({ APNS_KEY: apnsKey, APNS_TOPIC: 'app.hearth.mobile.dev' });
  const u = await bare.register(); const friend = await bare.register();
  const send = await dmLine(bare, friend, u);
  const devs = [phone(), phone(), phone(), phone()];
  for (const d of devs) assert.equal((await subscribe(bare, u, d)).status, 200);
  fallback = { status: 400, reason: 'DeviceTokenNotForTopic' };
  try {
    await send();
    assert.ok(await waitFor(() => /apns_config/.test(bare.log)), 'the operator is told');
    assert.match(bare.log, /APNS_TOPIC/);
    await send();
    await sleep(500);
    const left = rows(bare, u.id).map((r) => r.endpoint);
    for (const d of devs) assert.ok(left.includes(d.endpoint), 'kept');
  } finally { fallback = null; }
});
