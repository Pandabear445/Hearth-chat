// Notifications for the iPhone app, through Apple's own push service (APNs). An app in the App Store can't get Web
// Push, so its phone hands the server an APNs device token instead of a push endpoint, plus the same kind of keys a
// browser makes (a P-256 public key and a 16-byte secret, made on the phone and never leaving it).
//
// Apple sees what it delivers in the clear, unlike Web Push. So the visible alert is always the hidden-preview text
// (the instance's name and "New message"), and the real notification travels as `enc`: exactly what Web Push would
// have carried, encrypted to the phone's keys (RFC 8291 aes128gcm) and padded the same way. The app's notification
// extension decrypts it on the phone and shows names only when the person chose to (shapePush already decided that).
//
// createApns(options) → { send(sub, payload, { kind, generic }), close() }, or null (logged) when it can't work.
//   keyPem / keyFile   the AuthKey_XXXXXXXXXX.p8 from Apple (a P-256 key). Never logged.
//   keyId, teamId      its 10-character key ID and the Apple team's ID
//   topic              the app's bundle ID (app.hearth.mobile)
//   allowSandbox       also send to development builds run from Xcode (APNS_ALLOW_SANDBOX=1)
//   hostOverride, ca   tests only: a fake APNs ("127.0.0.1:port") and the certificate it uses
//   pad                payload → the text to encrypt (index.js's pushBody, so it's padded like Web Push)
//   brandName          () → the instance's name, for the visible alert
//   now, log, timeoutMs
//
// send answers with what to do about the device, never throwing:
//   ok          delivered
//   keep        Apple says the token is gone, but it was registered again after that: keep it
//   drop        the token is dead (uninstalled, a token from another app or environment): forget the device.
//               "From another app or environment" (DeviceTokenNotForTopic, BadDeviceToken) is also what every device
//               gets when APNS_TOPIC is wrong, so those drop only once Apple has accepted a push for that environment
//               since the server started. Before that the device is kept (logged); three different devices answered
//               that way and nothing accepted means the topic is wrong: configError and the breaker below
//   retryAfter  too many for now ({ ms } when Apple said how long): sit out, not a failure
//   configError the server's key, team or topic is wrong. Never the device's fault, so it's never counted against
//               one (a typo in .env mustn't unsubscribe every iPhone): the token is made again once and the send
//               tried again, then nothing goes to Apple for 15 minutes, logged at most once an hour
//   transient   Apple or the network is having trouble: tried again once on a new connection, then everything
//               waits a while (from 30 s, doubling, at most 15 minutes)
//   bug         a request Apple calls malformed: logged (once an hour per reason), the device is kept
//
// The connection to Apple is plain HTTP/2 to a fixed host name, so it doesn't go through netguard or HTTPS_PROXY;
// the firewall must let the server reach api.push.apple.com:443 (docs/OPERATIONS.md).
const crypto = require('node:crypto');
const fs = require('node:fs');
const http2 = require('node:http2');
const webpush = require('web-push');

const HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' };
const TIMEOUT_MS = 10000;
const MAX_ANSWER = 64 * 1024;
const MAX_BODY = 4096; // Apple's limit for an alert
const TTL_S = 6 * 3600; // like Web Push's TTL: a late ring still arrives, as "Missed call"
const JWT_REFRESH_MS = 40 * 60000; // Apple refuses tokens older than an hour…
const JWT_MIN_AGE_MS = 20 * 60000; // …and new ones more often than every 20 minutes (TooManyProviderTokenUpdates)
const BREAKER_MS = 15 * 60000;
const BACKOFF_MIN_MS = 30000;
const BACKOFF_MAX_MS = 15 * 60000;
const LOG_EVERY_MS = 3600000;
const IDLE_PING_MS = 5 * 60000;
const ENDPOINT = /^apns:(production|sandbox):([0-9a-f]{64,200})$/;
const APPLE_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const DROP = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic', 'ExpiredToken']);
const CONFIG = new Set(['BadTopic', 'TopicDisallowed', 'MissingTopic', 'InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken',
  'BadCertificate', 'BadCertificateEnvironment', 'Forbidden']);
const TOKEN_TROUBLE = new Set(['InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken']);
// The device's fault, or the server's topic: told apart by whether anything else got through (see send).
const NOT_THIS_APP = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic']);
const NOT_THIS_APP_DEVICES = 3;

// Apple's answer → what it means for the device.
function classify(status, reason, timestamp, createdAt) {
  if (status >= 200 && status < 300) return { status: 'ok' };
  if (DROP.has(reason) || (status === 410 && !reason)) {
    // A token Apple stopped accepting before the phone registered it again (an app reinstalled) is still good.
    if (Number.isFinite(timestamp) && Number.isFinite(createdAt) && timestamp < createdAt) return { status: 'keep', reason };
    return { status: 'drop', reason };
  }
  if (CONFIG.has(reason)) return { status: 'configError', reason };
  if (status === 429) return { status: 'retryAfter', reason };
  if (status >= 500) return { status: 'transient', reason };
  return { status: 'bug', reason: reason || String(status) };
}

const clip = (s, n) => [...String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\ud800-\udfff]/gu, '�')].slice(0, n).join('');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const netError = (msg, code = 'NETWORK') => Object.assign(new Error(msg), { code });

function createApns({ keyPem, keyFile, keyId, teamId, topic, allowSandbox = false, hostOverride = null, ca = null, pad = (p) => JSON.stringify(p),
  brandName = () => 'Hearth', now = Date.now, log = null, timeoutMs = TIMEOUT_MS } = {}) {
  // Only what was wrong is logged, never the key or the error that reading it gave.
  const disabled = (why) => { if (log) log.warn('push', 'apns_disabled', { why, msg: 'iPhone notifications are off. Check APNS_KEY_FILE (or APNS_KEY), APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC.' }); return null; };
  if (!keyPem && keyFile) { try { keyPem = fs.readFileSync(keyFile, 'utf8'); } catch { return disabled('key_file_unreadable'); } }
  if (!keyPem) return disabled('no_key');
  let key;
  try { key = crypto.createPrivateKey(keyPem); } catch { return disabled('key_unreadable'); }
  if (key.asymmetricKeyType !== 'ec' || (key.asymmetricKeyDetails || {}).namedCurve !== 'prime256v1') return disabled('key_not_p256');
  if (!APPLE_ID.test(String(keyId || ''))) return disabled('bad_key_id');
  if (!APPLE_ID.test(String(teamId || ''))) return disabled('bad_team_id');
  if (!BUNDLE_ID.test(String(topic || ''))) return disabled('bad_topic');

  // ---------------------------------------------------------------- the provider token (ES256 JWT)
  let jwt = null; // { token, at }
  function token() {
    const t = now();
    if (!jwt || t - jwt.at >= JWT_REFRESH_MS) {
      const data = `${b64url({ alg: 'ES256', kid: keyId })}.${b64url({ iss: teamId, iat: Math.floor(t / 1000) })}`;
      const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      jwt = { token: `${data}.${sig}`, at: t };
    }
    return jwt.token;
  }
  // Apple refused `used`: make a new one, unless that one was already replaced or is too new to replace.
  function renewToken(used, reason) {
    if (!jwt || jwt.token !== used) return;
    if (reason === 'ExpiredProviderToken' || now() - jwt.at >= JWT_MIN_AGE_MS) jwt = null;
  }

  // ---------------------------------------------------------------- connections: one per host, kept open
  const conns = new Map(); // host → { session, busy, waiting, settings, usedAt, pinger }
  let closed = false;
  function retire(host, c) {
    if (conns.get(host) === c) conns.delete(host);
    clearInterval(c.pinger);
    for (const w of c.waiting.splice(0)) w.reject(netError('connection closed'));
    try { c.session.close(); } catch { /* already gone */ }
  }
  function conn(host) {
    const have = conns.get(host);
    if (have && !have.session.closed && !have.session.destroyed) return have;
    const session = http2.connect(`https://${host}`, ca ? { ca } : {});
    const c = { session, busy: 0, waiting: [], settings: false, usedAt: Date.now(), pinger: null };
    // Apple allows one request at a time until the first one is accepted, then says how many.
    session.on('remoteSettings', () => { c.settings = true; pump(c); });
    session.on('goaway', () => retire(host, c));
    session.on('error', () => retire(host, c));
    session.on('close', () => retire(host, c));
    session.unref();
    c.pinger = setInterval(() => {
      if (c.busy || Date.now() - c.usedAt < IDLE_PING_MS) return;
      try { session.ping((err) => { if (err) retire(host, c); }); } catch { retire(host, c); }
    }, IDLE_PING_MS);
    c.pinger.unref();
    conns.set(host, c);
    return c;
  }
  const limit = (c) => (c.settings ? Math.max(1, Math.min(Number(c.session.remoteSettings.maxConcurrentStreams) || 1, 1000)) : 1);
  function pump(c) {
    while (c.waiting.length && c.busy < limit(c)) { c.busy++; c.waiting.shift().resolve(); }
  }
  const slot = (c) => new Promise((resolve, reject) => { c.waiting.push({ resolve, reject }); pump(c); });

  async function request(host, headers, body) {
    const c = conn(host);
    await slot(c);
    c.usedAt = Date.now();
    return new Promise((resolve, reject) => {
      let stream = null; let done = false; let status = 0; let answer = {}; let size = 0;
      const parts = [];
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        c.busy--; pump(c);
        if (err) reject(err);
        else resolve({ status, headers: answer, body: Buffer.concat(parts).subarray(0, MAX_ANSWER).toString('utf8') });
      };
      const timer = setTimeout(() => {
        finish(netError('Apple’s push service took too long to answer.', 'TIMEOUT'));
        try { stream.close(http2.constants.NGHTTP2_CANCEL); } catch { /* gone */ }
      }, timeoutMs);
      try { stream = c.session.request(headers); } catch (e) { finish(netError(e.message)); return; }
      stream.on('response', (h) => { status = Number(h[':status']) || 0; answer = h; });
      stream.on('data', (d) => { if (size < MAX_ANSWER) { parts.push(d); size += d.length; } });
      stream.on('end', () => finish(status ? null : netError('no answer')));
      stream.on('error', (e) => finish(netError(e.message)));
      stream.on('close', () => finish(status ? null : netError('stream closed')));
      stream.end(body);
    });
  }

  // ---------------------------------------------------------------- what's logged, at most once an hour each
  const loggedAt = new Map();
  function logOnce(op, fields) {
    const k = `${op} ${fields.reason || ''}`;
    if (loggedAt.get(k) > now() - LOG_EVERY_MS) return;
    if (loggedAt.size > 100) loggedAt.clear();
    loggedAt.set(k, now());
    if (log) log.warn('push', op, fields);
  }

  let breakerUntil = 0; // the server's key, team or topic was refused
  let backoffUntil = 0; // Apple or the network was in trouble
  let backoffFails = 0;
  const accepted = new Set(); // environments Apple took a push for, so the topic is right
  const notThisApp = new Map(); // environment → device tokens refused as another app's before anything was accepted

  // The JSON Apple gets. `enc` is the Web Push text, encrypted to the phone's own keys.
  function apnsBody(payload, keys, kind, generic) {
    const call = kind === 'call';
    const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : undefined;
    const aps = {
      alert: { title: clip(brandName() || 'Hearth', 100), body: clip(generic || 'New activity', 100) },
      sound: call ? 'ring.wav' : 'default', 'mutable-content': 1, 'interruption-level': call ? 'time-sensitive' : 'active',
    };
    if (tag) aps['thread-id'] = tag;
    const make = (p) => {
      const enc = Buffer.from(webpush.encrypt(keys.p256dh, keys.auth, pad(p), 'aes128gcm').cipherText).toString('base64');
      return JSON.stringify({ aps, v: 1, tag, url: payload.url, at: payload.at, enc });
    };
    let json = make(payload);
    // Names long enough to pass Apple's limit once encrypted: the phone gets the hidden-preview text instead.
    if (Buffer.byteLength(json) > MAX_BODY) json = make({ title: aps.alert.title, body: aps.alert.body, tag, url: payload.url, at: payload.at });
    return Buffer.byteLength(json) > MAX_BODY ? null : json;
  }

  async function attempt(host, deviceToken, tag, json, createdAt) {
    const auth = token();
    const headers = {
      ':method': 'POST', ':path': `/3/device/${deviceToken}`, authorization: `bearer ${auth}`, 'apns-topic': topic, 'apns-push-type': 'alert',
      'apns-priority': '10', 'apns-expiration': String(Math.floor(now() / 1000) + TTL_S), 'content-type': 'application/json',
    };
    // Apple allows 64 bytes; PushPolicy allows tags of 100 characters.
    if (tag) headers['apns-collapse-id'] = Buffer.byteLength(tag) <= 64 ? tag : crypto.createHash('sha256').update(tag).digest('hex');
    let r;
    try { r = await request(host, headers, json); } catch (e) { return { status: 'transient', reason: e.code === 'TIMEOUT' ? 'Timeout' : 'Network', used: auth }; }
    let reason = ''; let timestamp;
    try { const j = JSON.parse(r.body || '{}'); reason = typeof j.reason === 'string' ? j.reason.slice(0, 60) : ''; timestamp = Number(j.timestamp); } catch { /* no JSON */ }
    const out = classify(r.status, reason, timestamp, createdAt);
    if (out.status === 'retryAfter') {
      const s = Number(r.headers['retry-after']);
      if (Number.isFinite(s) && s >= 0) out.ms = s * 1000;
    }
    out.used = auth;
    return out;
  }

  async function send(sub, payload = {}, { kind = 'other', generic } = {}) {
    if (closed) return { status: 'transient', reason: 'Closed' };
    if (breakerUntil > now()) return { status: 'configError', reason: 'Breaker' };
    if (backoffUntil > now()) return { status: 'transient', reason: 'Backoff' };
    const m = ENDPOINT.exec(String(sub && sub.endpoint));
    if (!m) return { status: 'drop', reason: 'BadEndpoint' };
    const env = m[1];
    if (env === 'sandbox' && !allowSandbox) return { status: 'drop', reason: 'SandboxOff' };
    let json;
    try {
      const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
      json = apnsBody(payload, keys, kind, generic === undefined ? payload.generic : generic);
    } catch { return { status: 'drop', reason: 'BadKeys' }; } // keys that can never work
    if (!json) { logOnce('apns_bug', { reason: 'PayloadTooLarge' }); return { status: 'bug', reason: 'PayloadTooLarge' }; }
    const host = hostOverride || HOSTS[env];
    const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : null;
    let r = await attempt(host, m[2], tag, json, Number(sub.created_at));
    if (r.status === 'configError') {
      if (TOKEN_TROUBLE.has(r.reason)) renewToken(r.used, r.reason);
      r = await attempt(host, m[2], tag, json, Number(sub.created_at));
      if (r.status === 'configError') {
        breakerUntil = now() + BREAKER_MS;
        logOnce('apns_config', { reason: r.reason, msg: 'Apple refused this server’s push key, team or topic: iPhone notifications are paused for 15 minutes. Check APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC.' });
      }
    } else if (r.status === 'transient') {
      const c = conns.get(host);
      if (c) retire(host, c);
      r = await attempt(host, m[2], tag, json, Number(sub.created_at));
      if (r.status === 'transient') {
        backoffFails++;
        backoffUntil = now() + Math.min(BACKOFF_MIN_MS * 2 ** (backoffFails - 1), BACKOFF_MAX_MS);
        logOnce('apns_unreachable', { reason: r.reason, msg: 'Couldn’t reach Apple’s push service; trying again later. The server needs to reach api.push.apple.com:443.' });
      }
    }
    if (r.status === 'drop' && NOT_THIS_APP.has(r.reason) && !accepted.has(env)) r = notThisAppYet(env, m[2], r.reason);
    if (r.status === 'ok') { backoffFails = 0; accepted.add(env); notThisApp.delete(env); }
    if (r.status === 'bug') logOnce('apns_bug', { reason: r.reason });
    delete r.used;
    return r;
  }

  // Apple says the token isn't this app's (or environment's), but nothing has been accepted yet: maybe it's the
  // device, maybe APNS_TOPIC. Keep the device; several devices and no success means it's the topic.
  function notThisAppYet(env, deviceToken, reason) {
    let seen = notThisApp.get(env);
    if (!seen) notThisApp.set(env, (seen = new Set()));
    if (seen.size < 100) seen.add(deviceToken);
    if (seen.size < NOT_THIS_APP_DEVICES) {
      logOnce('apns_unconfirmed', { reason, msg: 'Apple says an iPhone’s token isn’t for this app. Kept for now; if every iPhone gets this, APNS_TOPIC doesn’t match the app’s bundle ID.' });
      return { status: 'keep', reason };
    }
    notThisApp.delete(env);
    breakerUntil = now() + BREAKER_MS;
    logOnce('apns_config', { reason, msg: 'Apple says no iPhone’s token is for this app: APNS_TOPIC doesn’t match the app’s bundle ID (or the build’s environment is wrong). iPhone notifications are paused for 15 minutes; no iPhone is unsubscribed.' });
    return { status: 'configError', reason };
  }

  function close() {
    closed = true;
    for (const [host, c] of [...conns]) retire(host, c);
  }
  return { send, close };
}

module.exports = { createApns, classify, HOSTS, TIMEOUT_MS };
