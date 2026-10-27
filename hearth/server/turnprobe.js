// Asks a call relay (TURN, RFC 5766) whether it's the one that holds a given relay secret, the way coturn's shared-secret
// logins work (use-auth-secret): it asks the relay at that address for a relayed address under a login made from the
// secret. Every answer to a request signed with the login's key carries a MESSAGE-INTEGRITY made with that same key,
// which only a relay that knows the secret can make, so a signed answer proves the relay at that address is this one.
// The relayed address it hands out is given back at once.
//
// server/regions.js uses it when a member relay checks in from somewhere other than the address it says it's at (a
// proxy in front of this server, such as Cloudflare's, or a check-in over IPv6): that address goes to everyone's app
// and into every avoider's list of addresses to leave out, so it has to be the relay's own.
const dgram = require('dgram');
const crypto = require('crypto');
const net = require('net');

const COOKIE = 0x2112a442;
const ALLOCATE = 0x0003;
const REFRESH = 0x0004;
const SUCCESS = 0x0100; // added to a method: its success response
const ERROR = 0x0110; // and its error response
const A = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, LIFETIME: 0x000d, REALM: 0x0014, NONCE: 0x0015, REQUESTED_TRANSPORT: 0x0019 };

// A STUN message: [[type, Buffer], …] as its attributes, and with a key, a MESSAGE-INTEGRITY over all of it.
function encode(type, tid, attrs, key = null) {
  const parts = [];
  for (const [t, v] of attrs) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(t, 0); h.writeUInt16BE(v.length, 2);
    parts.push(h, v, Buffer.alloc((4 - (v.length % 4)) % 4));
  }
  const body = Buffer.concat(parts);
  const header = (len) => { const b = Buffer.alloc(20); b.writeUInt16BE(type, 0); b.writeUInt16BE(len, 2); b.writeUInt32BE(COOKIE, 4); tid.copy(b, 8); return b; };
  if (!key) return Buffer.concat([header(body.length), body]);
  // (The length in the header counts the MESSAGE-INTEGRITY itself while it's worked out.)
  const head = header(body.length + 24);
  const mac = crypto.createHmac('sha256', key).update(Buffer.concat([head, body])).digest();
  const mi = Buffer.alloc(4);
  mi.writeUInt16BE(A.MESSAGE_INTEGRITY, 0); mi.writeUInt16BE(20, 2);
  return Buffer.concat([head, body, mi, mac]);
}
// { type, tid, attrs: Map(type → value), mi: where its MESSAGE-INTEGRITY starts (-1: none), buf }, or null.
function decode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.readUInt32BE(4) !== COOKIE) return null;
  const len = buf.readUInt16BE(2);
  if (len % 4 || 20 + len > buf.length) return null;
  const attrs = new Map();
  let mi = -1;
  for (let i = 20; i < 20 + len;) {
    if (i + 4 > 20 + len) return null;
    const t = buf.readUInt16BE(i); const l = buf.readUInt16BE(i + 2);
    if (i + 4 + l > 20 + len) return null;
    if (mi < 0) { // (attributes after MESSAGE-INTEGRITY aren't covered by it: only FINGERPRINT may come there)
      if (!attrs.has(t)) attrs.set(t, buf.subarray(i + 4, i + 4 + l));
      if (t === A.MESSAGE_INTEGRITY) mi = i;
    }
    i += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type: buf.readUInt16BE(0), tid: buf.subarray(8, 20), attrs, mi, buf };
}
// Whether a message carries a MESSAGE-INTEGRITY made with this key.
function signedWith(m, key) {
  if (!m || m.mi < 0 || m.attrs.get(A.MESSAGE_INTEGRITY).length !== 20) return false;
  const head = Buffer.from(m.buf.subarray(0, m.mi));
  head.writeUInt16BE(m.mi - 20 + 24, 2);
  return crypto.timingSafeEqual(crypto.createHmac('sha1', key).update(head).digest(), m.attrs.get(A.MESSAGE_INTEGRITY));
}
const errorCode = (m) => { const v = m.attrs.get(A.ERROR_CODE); return v && v.length >= 4 ? (v[2] & 7) * 100 + v[3] : 0; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
// One way of writing an address, to compare where an answer came from with where the question went.
const oneWay = (ip) => { const s = String(ip || '').replace(/^::ffff:(?=\d+\.)/i, ''); try { return net.isIPv6(s) ? new URL(`http://[${s}]`).hostname : s; } catch { return s; } };

// Resolves true when the relay at host:port answers a request under a login made from `secret` with an answer signed
// with that login's key, and false on anything else: no answer within `timeout` ms, a refusal of the login, or an
// answer that isn't signed with the key. Never rejects.
function probeTurn({ host, port = 3478, secret, timeout = 3000 }) {
  return new Promise((resolve) => {
    if (!net.isIP(host) || !secret) { resolve(false); return; }
    const sock = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    // A login as coturn takes them with use-auth-secret: "<expiry>:<name>", and its password the secret's HMAC of it.
    // coturn refuses one whose expiry has passed by its own clock, so it runs out 12 hours from now, like the logins apps
    // get: a relay whose clock is a few minutes (or hours) ahead still answers. (The relayed address goes back at once.)
    const username = Buffer.from(`${Math.floor(Date.now() / 1000) + 12 * 3600}:hearth-check`);
    const password = crypto.createHmac('sha256', String(secret)).update(username).digest('base64');
    let key = null; let realm = null; let nonce = null; let tid = null; let msg = null; let staleTries = 0;
    let resend = null; let done = false;
    const auth = () => [[A.USERNAME, username], [A.REALM, realm], [A.NONCE, nonce]];
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(resend);
      // The relayed address it handed out goes back at once (a refresh with lifetime 0), rather than in 10 minutes.
      if (ok) sock.send(encode(REFRESH, crypto.randomBytes(12), [[A.LIFETIME, u32(0)], ...auth()], key), port, host, () => { try { sock.close(); } catch { /* closed */ } });
      else { try { sock.close(); } catch { /* closed */ } }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeout);
    // Sent again after 0.4, 1.2 and 2.8 s while nothing answers (UDP: a packet may be lost on the way).
    const transmit = (n = 0) => {
      if (done) return;
      sock.send(msg, port, host, (e) => { if (e) finish(false); });
      resend = setTimeout(() => transmit(n + 1), 400 * 2 ** n);
    };
    const ask = (signed) => {
      clearTimeout(resend);
      tid = crypto.randomBytes(12);
      msg = encode(ALLOCATE, tid, [[A.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])], ...(signed ? auth() : [])], signed ? key : null);
      transmit();
    };
    sock.on('error', () => finish(false));
    sock.on('message', (buf, from) => {
      // Only an answer from the address and port asked, to the request asked.
      if (from.port !== port || oneWay(from.address) !== oneWay(host)) return;
      const m = decode(buf);
      if (!m || !m.tid.equals(tid)) return;
      if (!key) {
        // The first answer: "unauthorized", with the relay's realm and a nonce to sign the real request with.
        if (m.type !== (ALLOCATE | ERROR) || errorCode(m) !== 401 || !m.attrs.get(A.REALM) || !m.attrs.get(A.NONCE)) { finish(false); return; }
        realm = Buffer.from(m.attrs.get(A.REALM)); nonce = Buffer.from(m.attrs.get(A.NONCE));
        key = crypto.createHash('md5').update(Buffer.concat([username, Buffer.from(':'), realm, Buffer.from(':' + password)])).digest();
        ask(true);
        return;
      }
      // A nonce that went stale in between: once more with the new one.
      if (m.type === (ALLOCATE | ERROR) && errorCode(m) === 438 && m.attrs.get(A.NONCE) && staleTries++ < 1) { nonce = Buffer.from(m.attrs.get(A.NONCE)); ask(true); return; }
      // Signed with the key: the relay knows the secret. (A busy one says so in a signed error, which proves it as well.)
      finish((m.type === (ALLOCATE | SUCCESS) || m.type === (ALLOCATE | ERROR)) && signedWith(m, key));
    });
    ask(false);
  });
}

module.exports = { probeTurn, encode, decode, signedWith, A, ALLOCATE, REFRESH, SUCCESS, ERROR, COOKIE };
