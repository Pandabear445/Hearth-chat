// The iPhone app's notifications through Apple's push service (server/apns.js), against a fake APNs: an HTTP/2
// server with its own certificate that records every request and answers the way Apple does. Nothing here needs an
// Apple account. The provider token, the request Apple gets, what Apple can read (only the hidden-preview alert; the
// rest is `enc`, decrypted here with the phone's keys by an independent RFC 8291 implementation), what each answer
// means for the device, the breaker for a bad key, reconnecting, and never logging the key.
// test/ios-push.test.js covers the same through a running server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http2 = require('node:http2');
const path = require('node:path');
const { createApns, classify, HOSTS, TIMEOUT_MS } = require('../server/apns');

const FIXTURE = path.join(__dirname, 'fixtures', 'apns-enc-vector.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ RFC 8291 (aes128gcm), written out on its own
// The phone's side, as the app's notification extension does it with CryptoKit: header (salt, record size, the
// server's one-time public key), ECDH with the phone's key, two HKDF steps, AES-128-GCM, then the padding stripped
// back to the 0x02 delimiter.
function rfc8291Decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const serverPub = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  assert.equal(idlen, 65, 'keyid is the server’s uncompressed P-256 key');
  assert.ok(record.length <= rs, 'one record');
  const shared = ecdh.computeSecret(serverPub);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  assert.equal(padded[end], 2, 'the last record ends with the 0x02 delimiter');
  return padded.subarray(0, end);
}
function phoneKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

// ------------------------------------------------------------------ a fake APNs
// answer(req) → { status, reason, headers, timestamp } | 'hang' (never answers) | 'reset' (drops the connection) |
// 'goaway'. Every request is recorded with its headers and body.
let pems; let fake; let fakePort; let answer = () => ({ status: 200 });
const reqs = []; let conns = 0; let inFlight = 0; let maxInFlight = 0; let delayMs = 0; let maxStreams = 100;
const sessions = new Set();
function startFake() {
  const s = http2.createSecureServer({ key: pems.private, cert: pems.cert, settings: { maxConcurrentStreams: maxStreams } });
  s.on('session', (sess) => { conns++; sessions.add(sess); sess.on('close', () => sessions.delete(sess)); sess.on('error', () => {}); });
  s.on('stream', (stream, headers) => {
    const parts = [];
    stream.on('error', () => {});
    stream.on('data', (d) => parts.push(d));
    stream.on('end', async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const body = Buffer.concat(parts).toString('utf8');
      const r = { headers, body, json: null, at: Date.now() };
      try { r.json = JSON.parse(body); } catch { /* not JSON */ }
      reqs.push(r);
      const a = answer(r);
      if (delayMs) await sleep(delayMs);
      inFlight--;
      if (a === 'hang') return;
      if (a === 'reset') { stream.session.destroy(); return; }
      // Apple going away (a restart): GOAWAY, and the request in flight refused, to be sent again elsewhere.
      if (a === 'goaway') { stream.session.goaway(http2.constants.NGHTTP2_NO_ERROR); stream.close(http2.constants.NGHTTP2_REFUSED_STREAM); return; }
      if (stream.destroyed) return;
      stream.respond({ ':status': a.status, 'apns-id': crypto.randomUUID(), ...(a.headers || {}) });
      stream.end(a.reason ? JSON.stringify({ reason: a.reason, ...(a.timestamp ? { timestamp: a.timestamp } : {}) }) : undefined);
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}
async function restartFake(settings = {}) {
  for (const sess of sessions) sess.destroy();
  if (fake) await new Promise((r) => fake.close(() => r()));
  maxStreams = settings.maxConcurrentStreams || 100;
  fake = await startFake();
  fakePort = fake.address().port;
}

before(async () => {
  pems = await require('selfsigned').generate([{ name: 'commonName', value: 'api.push.apple.test' }], {
    keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
  });
  await restartFake();
});
after(async () => {
  for (const sess of sessions) sess.destroy();
  if (fake) await new Promise((r) => fake.close(() => r()));
});

// One provider key (like an AuthKey_XXXXXXXXXX.p8), a clock the tests move, and a logger that keeps every line.
const apnsKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const KEY_PEM = apnsKey.privateKey.export({ type: 'pkcs8', format: 'pem' });
let clock = Date.UTC(2026, 9, 1, 12);
const logs = [];
const logger = { warn: (component, op, fields) => logs.push({ component, op, fields }), info() {}, error() {} };
const opened = [];
function make(extra = {}) {
  const a = createApns({ keyPem: KEY_PEM, keyId: 'KEYID12345', teamId: 'TEAM123456', topic: 'app.hearth.mobile', hostOverride: `127.0.0.1:${fakePort}`, ca: pems.cert,
    brandName: () => 'Kappa', now: () => clock, log: logger, ...extra });
  assert.ok(a, 'it starts');
  opened.push(a);
  return a;
}
after(() => { for (const a of opened) a.close(); });
const token = () => crypto.randomBytes(32).toString('hex');
const subFor = (k, env = 'production', t = token(), created = clock - 1000) => ({ endpoint: `apns:${env}:${t}`, keys: JSON.stringify(k.keys), created_at: created, token: t });
const payload = (extra = {}) => ({ title: 'Kappa', body: 'New message', tag: 'd:abc', url: '/#m/42', at: clock, ...extra });
const decodeJwt = (jwt) => { const [h, c, s] = jwt.split('.'); return { h: JSON.parse(Buffer.from(h, 'base64url')), c: JSON.parse(Buffer.from(c, 'base64url')), data: `${h}.${c}`, sig: Buffer.from(s, 'base64url') }; };

// ================================================================== tests
test('apns-1: the provider token is an ES256 JWT for the key and team, reused for 40 minutes and then made again', async () => {
  answer = () => ({ status: 200 });
  const a = make();
  const k = phoneKeys();
  reqs.length = 0;
  assert.equal((await a.send(subFor(k), payload())).status, 'ok');
  const first = reqs[0].headers.authorization;
  assert.match(first, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const j = decodeJwt(first.slice(7));
  assert.deepEqual(j.h, { alg: 'ES256', kid: 'KEYID12345' });
  assert.deepEqual(j.c, { iss: 'TEAM123456', iat: Math.floor(clock / 1000) });
  assert.equal(j.sig.length, 64, 'r‖s, not DER');
  assert.ok(crypto.verify('sha256', Buffer.from(j.data), { key: apnsKey.publicKey, dsaEncoding: 'ieee-p1363' }, j.sig), 'signed with the provider key');
  clock += 39 * 60000;
  await a.send(subFor(k), payload());
  assert.equal(reqs[1].headers.authorization, first, 'the same token for 39 minutes');
  clock += 2 * 60000;
  await a.send(subFor(k), payload());
  assert.notEqual(reqs[2].headers.authorization, first, 'a new one after 40');
  assert.equal(decodeJwt(reqs[2].headers.authorization.slice(7)).c.iat, Math.floor(clock / 1000));
});

test('apns-2: POST /3/device/<token> with the topic, an alert push type, priority 10, six hours to live and the tag as the collapse id', async () => {
  answer = () => ({ status: 200 });
  const a = make();
  const k = phoneKeys();
  reqs.length = 0;
  const sub = subFor(k);
  await a.send(sub, payload({ tag: 'call:room1' }), { kind: 'call' });
  const h = reqs[0].headers;
  assert.equal(h[':method'], 'POST');
  assert.equal(h[':path'], `/3/device/${sub.token}`);
  assert.equal(h['apns-topic'], 'app.hearth.mobile');
  assert.equal(h['apns-push-type'], 'alert');
  assert.equal(h['apns-priority'], '10');
  assert.ok(Math.abs(Number(h['apns-expiration']) - (Math.floor(clock / 1000) + 6 * 3600)) <= 1, `expires in 6 h, got ${h['apns-expiration']}`);
  assert.equal(h['apns-collapse-id'], 'call:room1');
  assert.equal(h['content-type'], 'application/json');
  // Longer than Apple's 64 bytes: its SHA-256, the same for the same tag.
  const long = 'updates-' + 'x'.repeat(80);
  await a.send(sub, payload({ tag: long }));
  assert.equal(reqs[1].headers['apns-collapse-id'], crypto.createHash('sha256').update(long).digest('hex'));
  assert.equal(reqs[1].headers['apns-collapse-id'].length, 64);
  const e64 = 'é'.repeat(32); // 64 bytes exactly
  await a.send(sub, payload({ tag: e64 }));
  assert.equal(reqs[2].headers['apns-collapse-id'], e64);
  await a.send(sub, payload({ tag: 'é'.repeat(33) }));
  assert.equal(reqs[3].headers['apns-collapse-id'].length, 64, '66 bytes: hashed');
  await a.send(sub, payload({ tag: undefined }));
  assert.equal(reqs[4].headers['apns-collapse-id'], undefined, 'no tag, no collapse id');
  // Production and sandbox are Apple's two hosts.
  assert.deepEqual(HOSTS, { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' });
});

test('apns-3: Apple only ever sees the hidden-preview alert; rings are time-sensitive with the ring sound; it fits in 4096 bytes', async () => {
  answer = () => ({ status: 200 });
  const a = make();
  const k = phoneKeys();
  reqs.length = 0;
  // previews: 'names' — the payload says who; the alert mustn't.
  await a.send(subFor(k), payload({ title: 'Alex Secretname', body: 'Sent you a message', generic: 'New message' }), { kind: 'dm', generic: 'New message' });
  let r = reqs[0];
  assert.deepEqual(r.json.aps.alert, { title: 'Kappa', body: 'New message' });
  assert.doesNotMatch(r.body, /Secretname|Sent you/, 'no name or wording in the clear');
  assert.equal(r.json.aps['mutable-content'], 1, 'the notification extension runs');
  assert.equal(r.json.aps['interruption-level'], 'active');
  assert.equal(r.json.aps.sound, 'default');
  assert.equal(r.json.aps['thread-id'], 'd:abc');
  assert.equal(r.json.v, 1);
  assert.equal(r.json.tag, 'd:abc');
  assert.equal(r.json.url, '/#m/42');
  assert.equal(r.json.at, clock);
  assert.match(r.json.enc, /^[A-Za-z0-9+/]+={0,2}$/, 'standard base64');
  assert.deepEqual(Object.keys(r.json).sort(), ['aps', 'at', 'enc', 'tag', 'url', 'v']);
  assert.ok(Buffer.byteLength(r.body) < 4096);
  // A ring.
  await a.send(subFor(k), payload({ title: 'Kappa', body: 'Incoming call', tag: 'call:r1', url: '/#call/r1' }), { kind: 'call', generic: 'Incoming call' });
  r = reqs[1];
  assert.equal(r.json.aps['interruption-level'], 'time-sensitive');
  assert.equal(r.json.aps.sound, 'ring.wav');
  assert.deepEqual(r.json.aps.alert, { title: 'Kappa', body: 'Incoming call' });
  // Without a generic text it says only "New activity", never the payload's body.
  await a.send(subFor(k), payload({ title: 'Alex', body: 'Alex did a thing' }));
  assert.deepEqual(reqs[2].json.aps.alert, { title: 'Kappa', body: 'New activity' });
  // The longest names there can be (cut by pushBody to 200 and 300 characters, 4 bytes each; generic to 100)
  // and a long instance name: still under Apple's limit, with the hidden-preview text inside `enc` when they
  // wouldn't fit.
  const pad = (p) => { const s = Buffer.byteLength(JSON.stringify({ ...p, _: '' })); return JSON.stringify({ ...p, _: ' '.repeat(Math.max(0, Math.min(Math.ceil(s / 256) * 256, 2048) - s)) }); };
  const b = make({ pad, brandName: () => '😀'.repeat(40) });
  reqs.length = 0;
  const longGeneric = '😀'.repeat(100);
  await b.send(subFor(k), payload({ title: '😀'.repeat(200), body: '😀'.repeat(300), generic: longGeneric, tag: 'updates-' + 'x'.repeat(92) }), { generic: longGeneric });
  assert.ok(Buffer.byteLength(reqs[0].body) <= 4096, `${Buffer.byteLength(reqs[0].body)} bytes`);
  const inner = JSON.parse(rfc8291Decrypt(Buffer.from(reqs[0].json.enc, 'base64'), k.ecdh, k.auth).toString());
  assert.equal(inner.title, '😀'.repeat(40), 'the hidden-preview text');
  assert.equal(inner.body, longGeneric);
  assert.equal(inner.tag, 'updates-' + 'x'.repeat(92));
  // Something that fits keeps its names.
  await b.send(subFor(k), payload({ title: 'Alex', body: 'Sent you a message', generic: 'New message' }), { generic: 'New message' });
  assert.equal(JSON.parse(rfc8291Decrypt(Buffer.from(reqs[1].json.enc, 'base64'), k.ecdh, k.auth).toString()).title, 'Alex');
});

test('apns-4: enc decrypts with the phone’s own keys to exactly what was padded, and the Swift cross-check vector still decrypts', async () => {
  answer = () => ({ status: 200 });
  const padded = [];
  const pad = (p) => { const s = JSON.stringify({ ...p, _: ' '.repeat(256 - (JSON.stringify({ ...p, _: '' }).length % 256)) }); padded.push(s); return s; };
  const a = make({ pad });
  const k = phoneKeys();
  reqs.length = 0;
  const p = payload({ title: 'Alex', body: 'Sent you a message', generic: 'New message' });
  await a.send(subFor(k), p, { generic: 'New message' });
  const enc = Buffer.from(reqs[0].json.enc, 'base64');
  const plain = rfc8291Decrypt(enc, k.ecdh, k.auth);
  assert.equal(plain.toString(), padded[0], 'what was padded, byte for byte');
  assert.equal(plain.length % 256, 0, 'padded to a multiple of 256');
  const inner = JSON.parse(plain);
  for (const f of ['title', 'body', 'tag', 'url', 'at']) assert.equal(inner[f], p[f], f);
  // Another phone's keys can't read it.
  assert.throws(() => rfc8291Decrypt(enc, phoneKeys().ecdh, k.auth));
  // A tampered byte fails.
  const bad = Buffer.from(enc); bad[bad.length - 20] ^= 1;
  assert.throws(() => rfc8291Decrypt(bad, k.ecdh, k.auth));
  // The vector HearthKit's Swift tests decrypt with CryptoKit (WebPushDecrypt). Made once by this code (set
  // WRITE_APNS_VECTOR=1 to make a new one); checked here so the two sides can't drift apart.
  if (process.env.WRITE_APNS_VECTOR === '1') {
    const v = phoneKeys();
    reqs.length = 0;
    await make({ pad }).send(subFor(v), payload({ title: 'Alex', body: 'Sent you a message', generic: 'New message', at: 1790000000000 }), { generic: 'New message' });
    fs.writeFileSync(FIXTURE, JSON.stringify({
      about: 'An APNs push from server/apns.js. enc (standard base64) is RFC 8291 aes128gcm, encrypted to publicKey/auth; '
        + 'privateKey is the phone key (raw 32-byte P-256 scalar, base64url). plaintext is what it decrypts to (padding included). apnsBody is the whole JSON Apple delivered.',
      privateKey: v.ecdh.getPrivateKey().toString('base64url'), publicKey: v.keys.p256dh, auth: v.keys.auth,
      enc: reqs[0].json.enc, plaintext: padded[padded.length - 1], apnsBody: reqs[0].body,
    }, null, 2) + '\n');
  }
  const v = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(v.privateKey, 'base64url'));
  assert.equal(ecdh.getPublicKey().toString('base64url'), v.publicKey);
  assert.equal(Buffer.from(v.auth, 'base64url').length, 16);
  assert.equal(rfc8291Decrypt(Buffer.from(v.enc, 'base64'), ecdh, Buffer.from(v.auth, 'base64url')).toString(), v.plaintext);
  assert.equal(JSON.parse(v.apnsBody).enc, v.enc);
  assert.equal(JSON.parse(v.plaintext).title, 'Alex');
});

test('apns-5: each answer from Apple means one thing for the device', async () => {
  const k = phoneKeys();
  const rows = [
    [{ status: 200 }, 'ok'],
    [{ status: 410, reason: 'Unregistered' }, 'drop'],
    [{ status: 410, reason: 'Unregistered', timestamp: clock - 60000 }, 'keep'], // before the phone registered again
    [{ status: 410, reason: 'Unregistered', timestamp: clock + 60000 }, 'drop'],
    // Another app's token, but nothing accepted yet (a new instance each row): maybe it's APNS_TOPIC, so kept (apns-9).
    [{ status: 400, reason: 'BadDeviceToken' }, 'keep'],
    [{ status: 400, reason: 'DeviceTokenNotForTopic' }, 'keep'],
    [{ status: 429, reason: 'TooManyRequests', headers: { 'retry-after': '120' } }, 'retryAfter', 120000],
    [{ status: 429, reason: 'TooManyRequests' }, 'retryAfter', undefined],
    [{ status: 500, reason: 'InternalServerError' }, 'transient'],
    [{ status: 503, reason: 'ServiceUnavailable' }, 'transient'],
    [{ status: 413, reason: 'PayloadTooLarge' }, 'bug'],
    [{ status: 400, reason: 'BadCollapseId' }, 'bug'],
    [{ status: 400, reason: 'BadExpirationDate' }, 'bug'],
    [{ status: 404, reason: 'BadPath' }, 'bug'],
    [{ status: 405, reason: 'MethodNotAllowed' }, 'bug'],
    [{ status: 400, reason: 'BadTopic' }, 'configError'],
    [{ status: 403, reason: 'ExpiredProviderToken' }, 'configError'],
  ];
  for (const [ans, want, ms] of rows) {
    answer = () => ans;
    reqs.length = 0;
    const r = await make().send(subFor(k, 'production', token(), clock - 1000), payload());
    assert.equal(r.status, want, JSON.stringify(ans));
    if (want === 'retryAfter') assert.equal(r.ms, ms);
    // Trouble on Apple's side or the server's is tried once more; the device's own answers aren't.
    assert.equal(reqs.length, want === 'transient' || want === 'configError' ? 2 : 1, `${JSON.stringify(ans)}: ${reqs.length} requests`);
  }
  assert.deepEqual(classify(410, '', NaN, NaN), { status: 'drop', reason: '' });
  assert.equal(classify(400, 'SomethingNew').status, 'bug');
  // After a second 5xx, everything waits a while (no request at all), then tries again.
  answer = () => ({ status: 503, reason: 'ServiceUnavailable' });
  const a = make();
  reqs.length = 0;
  assert.equal((await a.send(subFor(k), payload())).status, 'transient');
  assert.equal(reqs.length, 2);
  answer = () => ({ status: 200 });
  assert.deepEqual(await a.send(subFor(k), payload()), { status: 'transient', reason: 'Backoff' });
  assert.equal(reqs.length, 2, 'nothing sent while backing off');
  clock += 31000;
  assert.equal((await a.send(subFor(k), payload())).status, 'ok');
  // Rows that can never work: a sandbox token on a server that doesn't take them, keys that aren't keys.
  assert.equal((await a.send(subFor(k, 'sandbox'), payload())).status, 'drop');
  assert.equal((await make({ allowSandbox: true }).send(subFor(k, 'sandbox'), payload())).status, 'ok');
  assert.equal((await a.send({ ...subFor(k), keys: '{"p256dh":"x","auth":"y"}' }, payload())).status, 'drop');
  assert.equal((await a.send({ ...subFor(k), endpoint: 'https://fcm.googleapis.com/x' }, payload())).status, 'drop');
});

test('apns-9: a token "not for this app" drops only once Apple accepted something; a wrong APNS_TOPIC keeps every device and trips the breaker', async () => {
  const k = phoneKeys();
  // A wrong topic: every device answers DeviceTokenNotForTopic. None is dropped; the third trips the breaker.
  answer = () => ({ status: 400, reason: 'DeviceTokenNotForTopic' });
  const a = make({ topic: 'app.hearth.mobile.dev' });
  reqs.length = 0; logs.length = 0;
  const got = [];
  for (let i = 0; i < 5; i++) got.push((await a.send(subFor(k), payload())).status);
  assert.deepEqual(got, ['keep', 'keep', 'configError', 'configError', 'configError']);
  assert.equal(reqs.length, 3, 'nothing reaches Apple once the breaker is open');
  assert.equal(logs.filter((l) => l.op === 'apns_unconfirmed').length, 1, 'once an hour');
  const cfg = logs.filter((l) => l.op === 'apns_config');
  assert.equal(cfg.length, 1);
  assert.match(cfg[0].fields.msg, /APNS_TOPIC/);
  // The same device asked again doesn't count twice.
  const b = make({ topic: 'app.hearth.mobile.dev' });
  const one = subFor(k);
  for (let i = 0; i < 4; i++) assert.equal((await b.send(one, payload())).status, 'keep');
  // Once Apple accepted a push for that environment, the topic is right: the token really is another app's.
  const c = make();
  answer = () => ({ status: 200 });
  assert.equal((await c.send(subFor(k), payload())).status, 'ok');
  for (const reason of ['DeviceTokenNotForTopic', 'BadDeviceToken']) {
    answer = () => ({ status: 400, reason });
    assert.equal((await c.send(subFor(k), payload())).status, 'drop', reason);
  }
  // …only for that environment: a sandbox token is still kept until a sandbox push gets through.
  const d = make({ allowSandbox: true });
  answer = () => ({ status: 200 });
  await d.send(subFor(k), payload());
  answer = () => ({ status: 400, reason: 'BadDeviceToken' });
  assert.equal((await d.send(subFor(k, 'sandbox'), payload())).status, 'keep');
  assert.equal((await d.send(subFor(k), payload())).status, 'drop');
});

test('apns-6: a refused provider token is made again once and tried again, then the breaker stops every send for 15 minutes, logged once an hour', async () => {
  answer = () => ({ status: 200 });
  const a = make();
  const k = phoneKeys();
  await a.send(subFor(k), payload()); // a token in use
  clock += 25 * 60000; // old enough to be replaced
  answer = () => ({ status: 403, reason: 'InvalidProviderToken' });
  reqs.length = 0; logs.length = 0;
  const r = await a.send(subFor(k), payload());
  assert.equal(r.status, 'configError');
  assert.equal(reqs.length, 2, 'tried again once');
  assert.notEqual(reqs[0].headers.authorization, reqs[1].headers.authorization, 'with a new token');
  assert.equal(logs.filter((l) => l.op === 'apns_config').length, 1);
  assert.equal(logs[0].fields.reason, 'InvalidProviderToken');
  // The breaker: nothing reaches Apple, for any device.
  for (let i = 0; i < 5; i++) assert.deepEqual(await a.send(subFor(phoneKeys()), payload()), { status: 'configError', reason: 'Breaker' });
  assert.equal(reqs.length, 2);
  // 16 minutes on: tried again (a still-fresh token isn't replaced: Apple refuses replacing it that often), still
  // refused, the breaker shuts again, and nothing more is logged within the hour.
  clock += 16 * 60000;
  assert.equal((await a.send(subFor(k), payload())).status, 'configError');
  assert.equal(reqs.length, 4);
  assert.equal(reqs[2].headers.authorization, reqs[1].headers.authorization, 'the 16-minute-old token is kept');
  assert.equal(logs.filter((l) => l.op === 'apns_config').length, 1, 'once an hour');
  clock += 61 * 60000;
  await a.send(subFor(k), payload());
  assert.equal(logs.filter((l) => l.op === 'apns_config').length, 2, 'an hour later, again');
  // ExpiredProviderToken always gets a new token, however new the current one is.
  const b = make();
  answer = () => ({ status: 200 });
  await b.send(subFor(k), payload());
  let n = 0;
  answer = () => (n++ ? { status: 200 } : { status: 403, reason: 'ExpiredProviderToken' });
  reqs.length = 0;
  assert.equal((await b.send(subFor(k), payload())).status, 'ok');
  assert.notEqual(reqs[0].headers.authorization, reqs[1].headers.authorization);
  // The operator is told; the device never is.
  assert.ok(logs.every((l) => !JSON.stringify(l).includes(KEY_PEM.split('\n')[1])));
});

test('apns-7: a dropped connection or GOAWAY is reconnected and tried once more; one request at a time when Apple says so; 10 s deadline', async () => {
  const k = phoneKeys();
  // The connection is dropped mid-request.
  let n = 0;
  answer = () => (n++ ? { status: 200 } : 'reset');
  let c0 = conns;
  reqs.length = 0;
  let a = make();
  assert.equal((await a.send(subFor(k), payload())).status, 'ok');
  assert.equal(reqs.length, 2);
  assert.equal(conns - c0, 2, 'on a new connection');
  // GOAWAY.
  n = 0;
  answer = () => (n++ ? { status: 200 } : 'goaway');
  c0 = conns;
  a = make();
  assert.equal((await a.send(subFor(k), payload())).status, 'ok');
  assert.equal(conns - c0, 2, 'GOAWAY: a new connection');
  // The next send uses the connection that's open.
  c0 = conns;
  assert.equal((await a.send(subFor(k), payload())).status, 'ok');
  assert.equal(conns, c0, 'kept open between sends');
  // maxConcurrentStreams = 1.
  await restartFake({ maxConcurrentStreams: 1 });
  answer = () => ({ status: 200 });
  delayMs = 80; maxInFlight = 0;
  a = make();
  const results = await Promise.all(Array.from({ length: 5 }, () => a.send(subFor(k), payload())));
  delayMs = 0;
  assert.deepEqual(results.map((r) => r.status), Array(5).fill('ok'));
  assert.equal(maxInFlight, 1, 'one at a time');
  await restartFake();
  // A request that's never answered gives up at the deadline (10 s; shortened here), once more, then backs off.
  assert.equal(TIMEOUT_MS, 10000);
  answer = () => 'hang';
  a = make({ timeoutMs: 300 });
  reqs.length = 0;
  const t0 = Date.now();
  const r = await a.send(subFor(k), payload());
  assert.deepEqual(r, { status: 'transient', reason: 'Timeout' });
  assert.equal(reqs.length, 2);
  assert.ok(Date.now() - t0 >= 550 && Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
  assert.equal((await a.send(subFor(k), payload())).reason, 'Backoff');
  answer = () => ({ status: 200 });
});

test('apns-8: a missing or bad key leaves APNs off (null, apns_disabled logged) and the key never reaches the log', async () => {
  const secretLine = KEY_PEM.split('\n')[1];
  const base = { keyPem: KEY_PEM, keyId: 'KEYID12345', teamId: 'TEAM123456', topic: 'app.hearth.mobile', log: logger };
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const broken = KEY_PEM.replace(secretLine, secretLine.split('').reverse().join(''));
  const cases = [
    [{ keyPem: null }, 'no_key'],
    [{ keyPem: '' }, 'no_key'],
    [{ keyPem: null, keyFile: path.join(__dirname, 'no-such-AuthKey.p8') }, 'key_file_unreadable'],
    [{ keyPem: broken }, 'key_unreadable'],
    [{ keyPem: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n' }, 'key_unreadable'],
    [{ keyPem: rsa }, 'key_not_p256'],
    [{ keyPem: p384 }, 'key_not_p256'],
    [{ keyId: 'short' }, 'bad_key_id'],
    [{ teamId: undefined }, 'bad_team_id'],
    [{ topic: 'nodots' }, 'bad_topic'],
  ];
  for (const [over, why] of cases) {
    logs.length = 0;
    assert.equal(createApns({ ...base, ...over }), null, why);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].op, 'apns_disabled');
    assert.equal(logs[0].fields.why, why);
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(secretLine) && !text.includes(broken.split('\n')[1]) && !text.includes(rsa.split('\n')[1]), 'no key material in the log');
  }
  assert.equal(createApns({ ...base, log: null, keyPem: null }), null, 'no logger: still just off');
  // A key file that is readable works like APNS_KEY.
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hearth-apns-'));
  try {
    fs.writeFileSync(path.join(dir, 'AuthKey_KEYID12345.p8'), KEY_PEM, { mode: 0o600 });
    const a = createApns({ ...base, keyPem: null, keyFile: path.join(dir, 'AuthKey_KEYID12345.p8') });
    assert.ok(a);
    a.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
