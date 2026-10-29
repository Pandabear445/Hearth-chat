// Hearth end-to-end encryption.
//
// Primitives (the browser's WebCrypto, plus Argon2id via WebAssembly and ML-KEM-768 from public/vendor/ml-kem.js):
//   Password hardening  Argon2id (64 MiB, 3 passes) with a random per-account salt.
//                        Older accounts used PBKDF2-SHA256 and are upgraded at their next login.
//   Identity key        ECDH P-256. Private half is AES-256-GCM encrypted with a key derived from your
//                        password before it is stored on the server.
//   Signing key         ECDSA P-256. Signs channel messages, group-key handoffs and voice handshakes.
//   Message encryption  AES-256-GCM with a fresh key per message (HKDF-SHA256 from the conversation key
//                        and a random 256-bit salt), plus a random 96-bit nonce. Channel, author and key
//                        epoch are bound in as additional authenticated data. Padded to size steps so
//                        lengths don't give messages away.
//   Attachments         Each file gets its own random AES-256-GCM key, carried inside the encrypted message.
//   Post-quantum key    ML-KEM-768 (FIPS 203), from a 64-byte seed kept inside the password-locked envelope with
//                        the identity key; its public half is published signed by the signing key. Always used
//                        hybrid with P-256 (hybridKey: HKDF over the ML-KEM secret and the ECDH outputs, salted
//                        with the whole transcript), so reading anything takes breaking both. Accounts from before
//                        get theirs at the next sign-in with the password; a device already signed in asks for the
//                        password once (the seed only ever comes from the envelope: never handed over between
//                        devices, which only P-256 keys could authenticate). Signatures stay ECDSA P-256 (classical).
//   Direct messages     With published post-quantum keys on both sides: a random 256-bit key per message, wrapped
//                        inside it for each of the two with ML-KEM + ECDH(ephemeral, them) + ECDH(author, them) (d3,
//                        deniable: no signature), so every device reads the history from the messages alone.
//                        Otherwise, and for older messages: key = HKDF(ECDH(you, them)) (d2). Not signed, so DMs stay
//                        deniable. Not forward secret: see docs/ENCRYPTION-RESEARCH.md.
//   Server channels     A random 256-bit group key per server "epoch", sent to each member wrapped with
//                        ECIES (ephemeral ECDH P-256 + HKDF + AES-GCM, w1), or with the hybrid for members with a
//                        post-quantum key (w2), and signed by whoever shared it.
//                        A new epoch starts whenever someone leaves (or a former member comes back), so
//                        former members can't read on.
//   Still P-256 only    The personal vault (x1: study tools, saved notes, drafts, word filter, soundboards), DM photo
//                        tags (td1) and DM chat backgrounds (lkd1): see the
//                        research note's open items.

import { ml_kem768 } from '../vendor/ml-kem.js';

const subtle = () => {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Encryption needs a secure connection. Open this site over https:// (or on localhost).');
  }
  return window.crypto.subtle;
};
const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };

// ---------------------------------------------------------------- encoding helpers
export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// A P-256 public key in the one spelling this app takes: SPKI as WebCrypto exports it (an uncompressed point, 91
// bytes), in standard base64 with its padding. atob reads other strings as the same bytes too (the padding left out,
// spaces, a last letter that differs only in bits it drops), and WebCrypto also imports a compressed point (other
// bytes, the same key). So a server could spell one key many ways, and whatever this device looks up by a key's text
// (which account your key is, a pin) would miss it. Identity and signing keys alike (the same SPKI header).
const SPKI_P256 = '3059301306072a8648ce3d020106082a8648ce3d03010703420004';
export function canonicalKey(k) {
  if (typeof k !== 'string' || !/^[A-Za-z0-9+/]{122}==$/.test(k)) return false;
  try {
    const bytes = unb64(k);
    return bytes.length === 91 && toHex(bytes.subarray(0, 27)) === SPKI_P256 && b64(bytes) === k;
  } catch { return false; }
}

async function hkdfKey(ikm) { return subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']); }
function hkdfAes(base, salt, info, usages = ['encrypt', 'decrypt']) {
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, usages);
}
const gcm = (iv, aad) => (aad ? { name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 } : { name: 'AES-GCM', iv, tagLength: 128 });
async function aesEncrypt(key, iv, data, aad) { return new Uint8Array(await subtle().encrypt(gcm(iv, aad), key, data)); }
async function aesDecrypt(key, iv, data, aad) { return new Uint8Array(await subtle().decrypt(gcm(iv, aad), key, data)); }

// Message lengths: before encryption every message is padded with spaces up to a size step (256 bytes,
// then 1 KiB steps above 4 KiB), so the server can't tell "ok" from a paragraph by the ciphertext's length.
// JSON ignores trailing spaces, so padded messages read fine everywhere (including older versions).
export function padded(payload) {
  const bytes = enc.encode(JSON.stringify(payload));
  const n = bytes.length;
  const step = n < 4096 ? 256 : 1024;
  const out = new Uint8Array(Math.ceil((n + 1) / step) * step).fill(0x20);
  out.set(bytes);
  return out;
}

// ---------------------------------------------------------------- password → keys
let argon2Promise = null;
function loadArgon2() {
  if (window.hashwasm && window.hashwasm.argon2id) return Promise.resolve(window.hashwasm.argon2id);
  if (!argon2Promise) {
    argon2Promise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/argon2.js';
      s.onload = () => (window.hashwasm && window.hashwasm.argon2id ? resolve(window.hashwasm.argon2id) : reject(new Error('Password hashing failed to load.')));
      s.onerror = () => { argon2Promise = null; reject(new Error('Password hashing failed to load. Check your connection.')); };
      document.head.append(s);
    });
  }
  return argon2Promise;
}
export const ARGON2 = { iterations: 3, memorySize: 64 * 1024, parallelism: 1 };
export const newKdfSalt = () => b64(rand(16));

// params: { kdf: 'argon2id', salt } or { kdf: 'pbkdf2' } (older accounts)
// Returns authKey (hex, sent to the server to log in) and wrapKey (never leaves the browser).
export async function deriveKeys(username, password, params) {
  if (params && params.kdf === 'pbkdf2') return derivePbkdf2(username, password);
  const argon2id = await loadArgon2();
  const master = await argon2id({
    password: password.normalize('NFKC'),
    salt: unb64(params.salt),
    ...ARGON2,
    hashLength: 32,
    outputType: 'binary',
  });
  const base = await hkdfKey(master);
  const authBits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('hearth-auth-v2') }, base, 256);
  const wrapKey = await hkdfAes(base, new Uint8Array(32), 'hearth-wrap-v2');
  master.fill(0);
  return { authKey: toHex(authBits), wrapKey };
}

async function derivePbkdf2(username, password) {
  const u = username.toLowerCase();
  const pbkdf2 = async (salt) => {
    const k = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    return subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 310000 }, k, 256);
  };
  const [authBits, wrapBits] = await Promise.all([pbkdf2('hearth-auth:' + u), pbkdf2('hearth-wrap:' + u)]);
  const wrapKey = await subtle().importKey('raw', wrapBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { authKey: toHex(authBits), wrapKey };
}

async function sealBytes(key, bytes, aad) {
  const iv = rand(12);
  return b64(iv) + ':' + b64(await aesEncrypt(key, iv, bytes, aad));
}
async function openBytes(key, sealed, aad) {
  const [iv, ct] = sealed.split(':');
  return aesDecrypt(key, unb64(iv), unb64(ct), aad);
}

// ---------------------------------------------------------------- recovery key
// 32 random letters/numbers (160 bits). It encrypts a second copy of your private key, so a password reset
// by email can keep all your messages. High entropy, so a fast key derivation (HKDF) is enough.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newRecoveryCode() {
  const bytes = rand(20);
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  return out.match(/.{4}/g).join('-');
}
const normRecovery = (c) => String(c || '').toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z2-7]/g, '');
export async function recoveryWrapKey(code, saltB64) {
  const n = normRecovery(code);
  if (n.length !== 32) throw new Error('A recovery key has 32 letters and numbers (dashes optional).');
  return hkdfAes(await hkdfKey(enc.encode(`hearth-recovery|${n}`)), unb64(saltB64), 'hearth-recovery-v1');
}

// ---------------------------------------------------------------- identity (ECDH) key
const importEcdhPrivate = (pkcs8) => subtle().importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']);
const pubCache = new Map();
function importEcdhPublic(b64key) {
  if (!pubCache.has(b64key)) pubCache.set(b64key, subtle().importKey('spki', unb64(b64key), ECDH, false, []));
  return pubCache.get(b64key);
}

// What the password locks (encPrivateKey). Until 1.40 it was the identity key's PKCS#8 bytes alone. Since then it's
//   'H' 'Q' 0x01 | PKCS#8 length (2 bytes, big-endian) | PKCS#8 | the 64-byte ML-KEM-768 seed (pqKeyPair)
// so the post-quantum key goes everywhere the identity key goes: every path that locks it again (a new password, the
// recovery key, the PBKDF2 upgrade) copies these bytes without looking inside. PKCS#8 always starts with 0x30, so the
// two forms can't be mistaken for each other. The seed is never locked with anything derived from the identity key
// (as the signing key is): a quantum computer could work that out from the public key, and then the post-quantum key
// would protect nothing.
const ENVELOPE = [0x48, 0x51, 0x01];
function packIdentity(pkcs8, pqSeed) {
  if (pkcs8.length > 0xffff || pqSeed.length !== PQ_SEED_BYTES) throw new Error('Bad key material');
  return concat(Uint8Array.from(ENVELOPE), Uint8Array.of(pkcs8.length >> 8, pkcs8.length & 0xff), pkcs8, pqSeed);
}
// { pkcs8, pqSeed (null in an envelope from before) }: copies, so the caller can wipe `bytes`.
function unpackIdentity(bytes) {
  if (bytes[0] !== ENVELOPE[0]) return { pkcs8: bytes.slice(), pqSeed: null };
  if (bytes[1] !== ENVELOPE[1] || bytes[2] !== ENVELOPE[2] || bytes.length < 5) throw new Error('Unknown key format');
  const n = (bytes[3] << 8) | bytes[4];
  if (bytes.length !== 5 + n + PQ_SEED_BYTES) throw new Error('Unknown key format');
  return { pkcs8: bytes.slice(5, 5 + n), pqSeed: bytes.slice(5 + n) };
}

export async function createIdentity(wrapKey) {
  const kp = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const publicKey = b64(await subtle().exportKey('spki', kp.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey));
  const pqSeed = newPqSeed();
  const packed = packIdentity(pkcs8, pqSeed);
  const encPrivateKey = await sealBytes(wrapKey, packed);
  const privateKey = await importEcdhPrivate(pkcs8);
  pkcs8.fill(0); packed.fill(0);
  return { publicKey, encPrivateKey, privateKey, pqSeed };
}
// The identity key and (when the account has one in its envelope) the post-quantum seed.
export async function unwrapIdentity(wrapKey, encPrivateKey) {
  const bytes = await openBytes(wrapKey, encPrivateKey);
  const { pkcs8, pqSeed } = unpackIdentity(bytes);
  bytes.fill(0);
  try { return { privateKey: await importEcdhPrivate(pkcs8), pqSeed }; } finally { pkcs8.fill(0); }
}
export async function unwrapPrivateKey(wrapKey, encPrivateKey) {
  return (await unwrapIdentity(wrapKey, encPrivateKey)).privateKey;
}
// An envelope from before post-quantum keys, locked again with a seed inside (the same identity key): `seed`, or a new
// one. One that already has a seed comes back as it was, unless `replace` (its seed isn't the one the account
// publishes: after a reset with a recovery key made before the upgrade, or put back by a password change that raced
// the upgrade on another device).
export async function addPqToEnvelope(wrapKey, encPrivateKey, { replace = false, seed: given = null } = {}) {
  const bytes = await openBytes(wrapKey, encPrivateKey);
  const { pkcs8, pqSeed } = unpackIdentity(bytes);
  bytes.fill(0);
  try {
    if (pqSeed && !replace) return { encPrivateKey, pqSeed, changed: false };
    const seed = given || newPqSeed();
    const packed = packIdentity(pkcs8, seed);
    try { return { encPrivateKey: await sealBytes(wrapKey, packed), pqSeed: seed, changed: true }; } finally { packed.fill(0); }
  } finally { pkcs8.fill(0); }
}
// Proves to the server that this device holds the private key for the account's published public key, without
// revealing it: ECDH with a one-off server key, then an HMAC over a fresh nonce. Used when a password reset
// keeps the old keys (the server checks it so an email-only attacker can't).
export async function resetKeyProof(myPriv, serverPublicKeyB64, nonce, userId) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(serverPublicKeyB64) }, myPriv, 256);
  const mac = await subtle().importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await subtle().sign('HMAC', mac, enc.encode(`hearth-reset-proof|${userId}|${nonce}`)));
}
// Whether a public key (as the server tells it) really is the public half of this private key: ECDH from both
// sides with a throwaway key pair gives the same bits only then. A server that hands an app some other key as
// its own could otherwise read whatever the app locks "for itself" with it.
export async function ownsPublicKey(myPriv, pubB64) {
  try {
    const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
    const ephPub = b64(await subtle().exportKey('spki', eph.publicKey));
    const a = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(pubB64) }, eph.privateKey, 256));
    const b = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(ephPub) }, myPriv, 256));
    return a.length === b.length && a.every((x, i) => x === b[i]);
  } catch { return false; }
}
// The same kind of proof when uploading a new signing key, bound to that key: a stolen session alone (without
// the identity key) can't plant a signing key that contacts would then trust.
export async function signKeyProof(myPriv, serverPublicKeyB64, nonce, userId, signPublicKey) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(serverPublicKeyB64) }, myPriv, 256);
  const mac = await subtle().importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await subtle().sign('HMAC', mac, enc.encode(`hearth-sign-key-proof|${userId}|${nonce}|${signPublicKey}`)));
}
// ---------------------------------------------------------------- post-quantum (ML-KEM-768) key
// Each account has one ML-KEM-768 key pair (FIPS 203), made from a 64-byte seed that lives inside the password-locked
// envelope (see packIdentity). Its public half is published next to the identity key, signed with the account's
// signing key over the account id and identity key (signPqKey), so the server can neither swap it nor move it to
// someone else. It's always used together with P-256 ECDH, never instead of it (hybridKey): to read anything, an
// attacker has to break both.
export const PQ_SEED_BYTES = 64;
export const PQ_PUBLIC_BYTES = 1184;
const PQ_CT_BYTES = 1088;
export const newPqSeed = () => rand(PQ_SEED_BYTES);
const pqPairs = new WeakMap(); // seed (Uint8Array) -> { publicKey (base64), secretKey }
// { publicKey (base64), secretKey } for a seed. Key generation from a seed is deterministic (FIPS 203 ML-KEM.KeyGen_internal).
export function pqKeyPair(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== PQ_SEED_BYTES) throw new Error('Bad post-quantum key');
  let k = pqPairs.get(seed);
  if (!k) {
    const { publicKey, secretKey } = ml_kem768.keygen(seed);
    k = { publicKey: b64(publicKey), secretKey };
    pqPairs.set(seed, k);
  }
  return k;
}
// A published ML-KEM-768 public key: the right size and accepted by the encapsulation-key check (FIPS 203 7.2), or null.
const pqPubCache = new Map();
function pqPublicBytes(pqPubB64) {
  if (typeof pqPubB64 !== 'string' || pqPubB64.length !== 1580) return null;
  if (!pqPubCache.has(pqPubB64)) {
    let bytes = null;
    try { bytes = unb64(pqPubB64); if (bytes.length !== PQ_PUBLIC_BYTES) bytes = null; else ml_kem768.encapsulate(bytes); } catch { bytes = null; }
    if (pqPubCache.size > 2000) pqPubCache.clear();
    pqPubCache.set(pqPubB64, bytes);
  }
  return pqPubCache.get(pqPubB64);
}
export const isPqPublicKey = (k) => !!pqPublicBytes(k);
// Which password envelope a re-lock was made from (hex SHA-256 of its text), so the server can refuse to save one made
// from an older envelope than it has now (a password change racing the post-quantum upgrade on another device).
export const envelopeHash = async (encPrivateKey) => toHex(await sha256(enc.encode(String(encPrivateKey))));
// The short fingerprint the server lists for someone's post-quantum key (server/index.js pqFp).
export async function pqFingerprint(pqPubB64) {
  const bytes = pqPublicBytes(pqPubB64);
  return bytes ? b64((await sha256(bytes)).slice(0, 16)) : null;
}
const pqKeyText = (userId, publicKey, pqPublicKey) => `hearth-pq-key-v1|${userId}|${publicKey}|${pqPublicKey}`;
export const signPqKey = (signKey, userId, publicKey, pqPublicKey) => sign(signKey, pqKeyText(userId, publicKey, pqPublicKey));
// The signing key (of one or a list, best first) that signed this post-quantum key for this account and identity key,
// or null. Only a key that passes is ever encrypted to.
export async function verifyPqKey(signPubs, userId, publicKey, pqPublicKey, sigB64) {
  if (!isPqPublicKey(pqPublicKey) || typeof publicKey !== 'string' || !publicKey) return null;
  return verifyAny(signPubs, pqKeyText(userId, publicKey, pqPublicKey), sigB64);
}

// The hybrid combiner, after Signal's PQXDH and X-Wing (draft-connolly-cfrg-xwing-kem): one AES-256-GCM key from
// HKDF-SHA256 over the ML-KEM shared secret and every ECDH output, salted with a hash of the whole transcript (the
// ephemeral key, the ML-KEM ciphertext and both sides' public keys, each with its length in front) and labelled with
// the format and its context. Whoever reads it needs both the ML-KEM secret key and the P-256 one. ML-KEM is
// IND-CCA2 and binds its own ciphertext, so the transcript is belt and braces, as X-Wing keeps the ECDH half's.
const sha256 = async (bytes) => new Uint8Array(await subtle().digest('SHA-256', bytes));
const framed = (parts) => concat(...parts.flatMap((p) => [Uint8Array.of(p.length >>> 24, (p.length >>> 16) & 0xff, (p.length >>> 8) & 0xff, p.length & 0xff), p]));
async function hybridKey({ label, ctx, kemSs, dhs, transcript, usage }) {
  const salt = await sha256(concat(enc.encode(`${label}|${ctx}|`), framed(transcript)));
  const ikm = concat(kemSs, ...dhs);
  try { return await hkdfAes(await hkdfKey(ikm), salt, `${label}|${ctx}`, [usage]); } finally { ikm.fill(0); }
}
const dhBits = async (priv, pubB64) => new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(pubB64) }, priv, 256));
async function ephemeral() {
  const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
  return { priv: eph.privateKey, pub: b64(await subtle().exportKey('spki', eph.publicKey)) };
}
function needPq(myPq) {
  if (!myPq || !(myPq.secretKey instanceof Uint8Array) || typeof myPq.publicKey !== 'string') {
    const err = new Error('This device doesn’t have the account’s post-quantum key yet');
    err.code = 'no_pq';
    throw err;
  }
}
const isB64 = (x, bytes) => typeof x === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(x) && (bytes == null || (x.length === 4 * Math.ceil(bytes / 3) && unb64(x).length === bytes));

// ---------------------------------------------------------------- personal vault (study tools)
// A key only you can derive: ECDH between your identity key and its own public half, through HKDF. Your study
// decks, assignments and stats are encrypted with it before they're saved, so the server stores only ciphertext.
// Each item is bound to its kind and id (as additional data), so the server can't swap or relabel items.
export async function vaultKey(myPriv, myPubB64) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(myPubB64) }, myPriv, 256);
  return hkdfAes(await hkdfKey(bits), enc.encode('hearth-vault-salt'), 'hearth-vault-v1');
}
export async function sealVault(key, kind, id, obj) {
  return 'x1:' + await sealBytes(key, padded(obj), `hearth-vault|${kind}|${id}`);
}
export async function openVault(key, kind, id, text) {
  if (!String(text).startsWith('x1:')) throw new Error('Unknown format');
  return JSON.parse(dec.decode(await openBytes(key, text.slice(3), `hearth-vault|${kind}|${id}`)));
}
export async function rewrapPrivateKey(oldWrapKey, newWrapKey, encPrivateKey) {
  const pkcs8 = await openBytes(oldWrapKey, encPrivateKey);
  try { return await sealBytes(newWrapKey, pkcs8); } finally { pkcs8.fill(0); }
}

// ---------------------------------------------------------------- signing (ECDSA) key
// The signing key's private half is encrypted with a key derived from ECDH(your private, your public):
// only someone holding your identity key can compute it, so every device you log in on can unlock it.
async function selfKey(myPriv, myPubB64) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(myPubB64) }, myPriv, 256);
  return hkdfAes(await hkdfKey(bits), new Uint8Array(32), 'hearth-self-wrap-v1');
}
export async function createSigningKey(myPriv, myPubB64) {
  const kp = await subtle().generateKey(ECDSA, true, ['sign', 'verify']);
  const signPublicKey = b64(await subtle().exportKey('spki', kp.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey));
  const encSignPrivateKey = await sealBytes(await selfKey(myPriv, myPubB64), pkcs8, 'hearth-sign-key');
  const signKey = await subtle().importKey('pkcs8', pkcs8, ECDSA, false, ['sign']);
  pkcs8.fill(0);
  return { signPublicKey, encSignPrivateKey, signKey };
}
export async function unwrapSigningKey(myPriv, myPubB64, encSignPrivateKey) {
  const pkcs8 = await openBytes(await selfKey(myPriv, myPubB64), encSignPrivateKey, 'hearth-sign-key');
  try { return await subtle().importKey('pkcs8', pkcs8, ECDSA, false, ['sign']); } finally { pkcs8.fill(0); }
}

const verifyCache = new Map();
function importVerifyKey(b64key) {
  if (!verifyCache.has(b64key)) verifyCache.set(b64key, subtle().importKey('spki', unb64(b64key), ECDSA, false, ['verify']));
  return verifyCache.get(b64key);
}
export async function sign(signKey, text) {
  return b64(await subtle().sign(SIGN_ALG, signKey, enc.encode(text)));
}
export async function verify(signPubB64, text, sigB64) {
  if (!signPubB64 || !sigB64) return false;
  try { return await subtle().verify(SIGN_ALG, await importVerifyKey(signPubB64), unb64(sigB64), enc.encode(text)); } catch { return false; }
}
// Checks against one key or a list of keys someone has had (best first): the key that made the signature, or
// null if none of them did.
async function verifyAny(signPubs, text, sigB64) {
  for (const k of [].concat(signPubs || [])) if (await verify(k, text, sigB64)) return k;
  return null;
}

// ---------------------------------------------------------------- direct messages
// Derived keys are cached per (your private key, their public key), so a cache can never hand one person's
// key to another, even with two accounts or a key change in the same tab.
let dmBases = new WeakMap(); // myPriv -> Map(theirPub -> Promise<HKDF base>)
let dmLegacyKeys = new WeakMap();
const cacheFor = (wm, k) => { let m = wm.get(k); if (!m) { m = new Map(); wm.set(k, m); } return m; };
function dmBase(myPriv, theirPubB64) {
  const m = cacheFor(dmBases, myPriv);
  if (!m.has(theirPubB64)) {
    m.set(theirPubB64, (async () => {
      const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(theirPubB64) }, myPriv, 256);
      return hkdfKey(bits);
    })());
  }
  return m.get(theirPubB64);
}
function dmLegacyKey(myPriv, theirPubB64) {
  const m = cacheFor(dmLegacyKeys, myPriv);
  if (!m.has(theirPubB64)) m.set(theirPubB64, dmBase(myPriv, theirPubB64).then((base) => hkdfAes(base, enc.encode('hearth-dm-salt'), 'hearth-dm-v1')));
  return m.get(theirPubB64);
}

// Format: d2:<salt>:<iv>:<ciphertext>   (fresh HKDF key per message; DM id + author bound as AAD)
export async function encryptDm({ myPriv, theirPub, dmId, authorId, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const key = await hkdfAes(await dmBase(myPriv, theirPub), salt, `hearth-dm-v2|${dmId}`, ['encrypt']);
  const ct = await aesEncrypt(key, iv, padded(payload), `hearth-d2|${dmId}|${authorId}`);
  return `d2:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
}
export async function decryptDm({ myPriv, theirPub, dmId, authorId, text }) {
  if (text.startsWith('v1:')) {
    const key = await dmLegacyKey(myPriv, theirPub);
    return { payload: JSON.parse(dec.decode(await openBytes(key, text.slice(3)))), legacy: true };
  }
  const [v, salt, iv, ct] = text.split(':');
  if (v !== 'd2') throw new Error('Unknown format');
  const key = await hkdfAes(await dmBase(myPriv, theirPub), unb64(salt), `hearth-dm-v2|${dmId}`, ['decrypt']);
  return { payload: JSON.parse(dec.decode(await aesDecrypt(key, unb64(iv), unb64(ct), `hearth-d2|${dmId}|${authorId}`))) };
}
// Files from the first DM version were encrypted with the conversation key itself.
export async function decryptLegacyDmFile(myPriv, theirPub, buf) {
  const bytes = new Uint8Array(buf);
  return aesDecrypt(await dmLegacyKey(myPriv, theirPub), bytes.slice(0, 12), bytes.slice(12));
}

// ---------------------------------------------------------------- direct messages, post-quantum (d3)
// Once both people have a post-quantum key, each DM gets its own random 256-bit key, wrapped inside the message itself
// for each of the two (so every device either of you signs in on reads the whole history from the messages alone):
//   d3:<ephemeral public>:<ML-KEM ct, to the other>:<wrap, to the other>:<ML-KEM ct, to the author>:<wrap, to the author>:<iv>:<ciphertext>
// Each wrap's AES key comes from hybridKey over ML-KEM-768 to that person's post-quantum key, ECDH(ephemeral, them) and
// ECDH(author, them) between identity keys. That last one says the message came from one of you two (only you two can
// work it out), as the d2 key always did, with no signatures, so DMs stay deniable. Both wraps commit to the format
// (the hearth-d3 label), the DM, the author, the recipient and a hash of the ciphertext, which holds the message's own
// id and time (binding.js): a message's key opens that message only, and can't be put under other words, moved to
// another message or DM, or credited to the other person. Nothing about it is kept anywhere else.
const d3Ctx = (dmId, authorId, recipientId, ctHash) => `hearth-d3|${dmId}|${authorId}|${recipientId}|${ctHash}`;
const d3Aad = (dmId, authorId) => `hearth-d3|${dmId}|${authorId}`;
const d3Key = async (raw, dmId, authorId, usage) => hkdfAes(await hkdfKey(raw), enc.encode('hearth-d3-msg'), `hearth-d3-msg|${dmId}|${authorId}`, [usage]);
const D3_WRAP_BYTES = 12 + 32 + 16;
async function d3Wrap({ raw, eph, ctx, recipientPub, recipientPq, authorPriv, authorPub }) {
  const pk = pqPublicBytes(recipientPq);
  if (!pk) throw new Error('Bad post-quantum key');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pk);
  const dhs = [await dhBits(eph.priv, recipientPub), await dhBits(authorPriv, recipientPub)];
  const key = await hybridKey({ label: 'hearth-d3', ctx, kemSs: sharedSecret, dhs, transcript: [unb64(eph.pub), cipherText, unb64(recipientPub), unb64(authorPub), pk], usage: 'encrypt' });
  sharedSecret.fill(0); dhs.forEach((d) => d.fill(0));
  const iv = rand(12);
  return [b64(cipherText), b64(concat(iv, await aesEncrypt(key, iv, raw, ctx)))];
}
// myPq / peerPq: the two post-quantum public keys (checked by the caller: verifyPqKey).
export async function encryptDm3({ dmId, authorId, myPriv, myPub, myPq, peerId, peerPub, peerPq, payload }) {
  const raw = rand(32);
  const iv = rand(12);
  const ct = await aesEncrypt(await d3Key(raw, dmId, authorId, 'encrypt'), iv, padded(payload), d3Aad(dmId, authorId));
  const h = b64(await sha256(concat(iv, ct)));
  const eph = await ephemeral();
  const toPeer = await d3Wrap({ raw, eph, ctx: d3Ctx(dmId, authorId, peerId, h), recipientPub: peerPub, recipientPq: peerPq, authorPriv: myPriv, authorPub: myPub });
  const toMe = await d3Wrap({ raw, eph, ctx: d3Ctx(dmId, authorId, authorId, h), recipientPub: myPub, recipientPq: myPq, authorPriv: myPriv, authorPub: myPub });
  raw.fill(0);
  return ['d3', eph.pub, ...toPeer, ...toMe, b64(iv), b64(ct)].join(':');
}
export const isDm3 = (text) => typeof text === 'string' && text.startsWith('d3:');
// myPq: your key pair ({ publicKey, secretKey }); authorPub: the identity key the author had then (yours, for your own),
// or authorPubs, the ones they may have had, best first: { payload, index } says which (one decapsulation for all).
export async function decryptDm3({ text, dmId, authorId, myId, myPriv, myPub, myPq, authorPub, authorPubs = [authorPub] }) {
  const p = String(text).split(':');
  if (p.length !== 8 || p[0] !== 'd3' || !isB64(p[2], PQ_CT_BYTES) || !isB64(p[4], PQ_CT_BYTES) || !isB64(p[3], D3_WRAP_BYTES) || !isB64(p[5], D3_WRAP_BYTES) || !isB64(p[6], 12) || !isB64(p[7])) throw new Error('Unknown format');
  needPq(myPq);
  const [, ephPub, kemPeer, wrapPeer, kemAuthor, wrapAuthor, iv, ct] = p;
  const mine = authorId === myId;
  const kct = unb64(mine ? kemAuthor : kemPeer);
  const w = unb64(mine ? wrapAuthor : wrapPeer);
  const ivB = unb64(iv);
  const ctB = unb64(ct);
  const ctx = d3Ctx(dmId, authorId, myId, b64(await sha256(concat(ivB, ctB))));
  const ss = ml_kem768.decapsulate(kct, myPq.secretKey);
  const dhEph = await dhBits(myPriv, ephPub);
  try {
    for (let index = 0; index < authorPubs.length; index++) {
      const pub = authorPubs[index];
      let raw;
      try {
        const dhs = [dhEph.slice(), await dhBits(myPriv, pub)];
        const key = await hybridKey({ label: 'hearth-d3', ctx, kemSs: ss.slice(), dhs, transcript: [unb64(ephPub), kct, unb64(myPub), unb64(pub), unb64(myPq.publicKey)], usage: 'decrypt' });
        dhs.forEach((d) => d.fill(0));
        raw = await aesDecrypt(key, w.slice(0, 12), w.slice(12), ctx);
      } catch { continue; /* not this key */ }
      try {
        return { payload: JSON.parse(dec.decode(await aesDecrypt(await d3Key(raw, dmId, authorId, 'decrypt'), ivB, ctB, d3Aad(dmId, authorId)))), index };
      } finally { raw.fill(0); }
    }
    throw new Error('Missing key');
  } finally { ss.fill(0); dhEph.fill(0); }
}

// ---------------------------------------------------------------- server channel group keys
export const newGroupKey = () => rand(32);

export async function keyCheck(raw, serverId, epoch) {
  const d = await subtle().digest('SHA-256', concat(enc.encode(`hearth-key-check|${serverId}|${epoch}|`), raw));
  return b64(new Uint8Array(d).slice(0, 18));
}

// ECIES: ephemeral ECDH with the recipient's identity key → HKDF → AES-GCM, then signed by the sender.
// Format: w1:<ephemeral public>:<iv>:<ciphertext>:<signature>
// With the recipient's post-quantum key (recipientPq, checked by the caller: verifyPqKey) it's the hybrid instead:
//   w2:<ephemeral public>:<ML-KEM ciphertext>:<iv>:<ciphertext>:<signature>
// the AES key from hybridKey over ML-KEM-768 to their post-quantum key and the same ephemeral ECDH, and the signature
// over everything, under its own label (hearth-gk2), so neither form's signature ever checks out for the other.
export async function wrapGroupKey({ raw, serverId, epoch, recipientId, recipientPub, recipientPq, wrapperId, signKey }) {
  if (recipientPq) return wrapGroupKey2({ raw, serverId, epoch, recipientId, recipientPub, recipientPq, wrapperId, signKey });
  const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const ephPub = b64(await subtle().exportKey('spki', eph.publicKey));
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(recipientPub) }, eph.privateKey, 256);
  const ctx = `hearth-gk|${serverId}|${epoch}|${recipientId}|${wrapperId}`;
  const key = await hkdfAes(await hkdfKey(bits), unb64(ephPub).slice(-32), ctx, ['encrypt']);
  const iv = rand(12);
  const ct = b64(await aesEncrypt(key, iv, raw, ctx));
  const body = `${ephPub}:${b64(iv)}:${ct}`;
  const sig = await sign(signKey, `${ctx}|${body}`);
  return `w1:${body}:${sig}`;
}
async function wrapGroupKey2({ raw, serverId, epoch, recipientId, recipientPub, recipientPq, wrapperId, signKey }) {
  const pk = pqPublicBytes(recipientPq);
  if (!pk) throw new Error('Bad post-quantum key');
  const eph = await ephemeral();
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pk);
  const ctx = `hearth-gk2|${serverId}|${epoch}|${recipientId}|${wrapperId}`;
  const key = await hybridKey({ label: 'hearth-gk2', ctx, kemSs: sharedSecret, dhs: [await dhBits(eph.priv, recipientPub)], transcript: [unb64(eph.pub), cipherText, unb64(recipientPub), pk], usage: 'encrypt' });
  sharedSecret.fill(0);
  const iv = rand(12);
  const body = `${eph.pub}:${b64(cipherText)}:${b64(iv)}:${b64(await aesEncrypt(key, iv, raw, ctx))}`;
  return `w2:${body}:${await sign(signKey, `${ctx}|${body}`)}`;
}
// Which form a wrapped key is in: 'w1' (P-256 only), 'w2' (hybrid post-quantum) or null.
export const wrapFormat = (w) => { const v = String(w || '').split(':', 1)[0]; return v === 'w1' || v === 'w2' ? v : null; };
// wrapperSignPub: the sharer's signing key, or a list of the keys they've had (any one must have signed it).
// A w2 key also needs myPub (the identity key it was wrapped for) and myPq ({ publicKey, secretKey }: pqKeyPair);
// without myPq it throws with code 'no_pq' (this device is still waiting for the key from another one).
export async function unwrapGroupKey({ wrapped, serverId, epoch, myId, myPriv, myPub, myPq, wrapperId, wrapperSignPub }) {
  if (String(wrapped).startsWith('w2:')) return unwrapGroupKey2({ wrapped, serverId, epoch, myId, myPriv, myPub, myPq, wrapperId, wrapperSignPub });
  const [v, ephPub, iv, ct, sig] = wrapped.split(':');
  if (v !== 'w1') throw new Error('Unknown key format');
  const ctx = `hearth-gk|${serverId}|${epoch}|${myId}|${wrapperId}`;
  if (!(await verifyAny(wrapperSignPub, `${ctx}|${ephPub}:${iv}:${ct}`, sig))) throw new Error('Key signature did not verify');
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importEcdhPublic(ephPub) }, myPriv, 256);
  const key = await hkdfAes(await hkdfKey(bits), unb64(ephPub).slice(-32), ctx, ['decrypt']);
  return aesDecrypt(key, unb64(iv), unb64(ct), ctx);
}
async function unwrapGroupKey2({ wrapped, serverId, epoch, myId, myPriv, myPub, myPq, wrapperId, wrapperSignPub }) {
  const parts = wrapped.split(':');
  const [, ephPub, kemCt, iv, ct, sig] = parts;
  if (parts.length !== 6 || !isB64(kemCt, PQ_CT_BYTES)) throw new Error('Unknown key format');
  const ctx = `hearth-gk2|${serverId}|${epoch}|${myId}|${wrapperId}`;
  if (!(await verifyAny(wrapperSignPub, `${ctx}|${ephPub}:${kemCt}:${iv}:${ct}`, sig))) throw new Error('Key signature did not verify');
  needPq(myPq);
  const kct = unb64(kemCt);
  const ss = ml_kem768.decapsulate(kct, myPq.secretKey);
  const key = await hybridKey({ label: 'hearth-gk2', ctx, kemSs: ss, dhs: [await dhBits(myPriv, ephPub)], transcript: [unb64(ephPub), kct, unb64(myPub), unb64(myPq.publicKey)], usage: 'decrypt' });
  ss.fill(0);
  const raw = await aesDecrypt(key, unb64(iv), unb64(ct), ctx);
  if (raw.length !== 32) throw new Error('Unknown key format');
  return raw;
}

// Cached per key (the raw bytes object) as well as server+epoch, so a different key for the same epoch
// is never answered from the cache.
let groupBases = new WeakMap(); // raw -> Map(id -> Promise<HKDF base>)
function groupBase(raw, id) {
  const m = cacheFor(groupBases, raw);
  if (!m.has(id)) m.set(id, hkdfKey(raw));
  return m.get(id);
}

// Format: c2:<epoch>:<salt>:<iv>:<ciphertext>:<signature>
export async function encryptGroup({ raw, serverId, channelId, epoch, authorId, signKey, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const aad = `hearth-c2|${channelId}|${epoch}|${authorId}`;
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), salt, `hearth-msg-v2|${channelId}`, ['encrypt']);
  const ct = await aesEncrypt(key, iv, padded(payload), aad);
  const body = `${epoch}:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
  const sig = await sign(signKey, `${aad}|${body}`);
  return `c2:${body}:${sig}`;
}
export function groupEpoch(text) {
  const parts = String(text || '').split(':');
  return parts[0] === 'c2' ? parseInt(parts[1], 10) : null;
}
// authorSignPub: the author's signing key, or a list of the keys they've had (see unwrapGroupKey). signedBy is
// the one that made the signature (null if none did), so the caller can tell how far that key is trusted.
export async function decryptGroup({ raw, serverId, channelId, authorId, authorSignPub, text }) {
  const [v, epoch, salt, iv, ct, sig] = text.split(':');
  if (v !== 'c2') throw new Error('Unknown format');
  const aad = `hearth-c2|${channelId}|${epoch}|${authorId}`;
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), unb64(salt), `hearth-msg-v2|${channelId}`, ['decrypt']);
  const payload = JSON.parse(dec.decode(await aesDecrypt(key, unb64(iv), unb64(ct), aad)));
  const signedBy = await verifyAny(authorSignPub, `${aad}|${epoch}:${salt}:${iv}:${ct}`, sig);
  return { payload, verified: !!signedBy, signedBy };
}

// ---------------------------------------------------------------- photo tags (photo-notes.js)
// A tag is a short label someone put on one photo of a message, kept beside the message rather than inside it. Its
// formats, key derivation (HKDF info) and additional data are its own, so a tag never opens as a message, a key wrap
// or a voice handshake, nor any of those as a tag. The additional data binds the conversation, the key epoch (channels),
// the message, which of its files, the tag's own id (the app picks it and the server stores it as the key) and who
// wrote it: the server can't move a tag to another photo, message, conversation or author, or copy it under another id.
// The payload ({ n: label, fu: that file's address }) is padded to exactly one 256-byte step, so every tag is the same
// size and its length says nothing about the label (photo-notes.js keeps labels short enough for that).
//   Channel and group chat: tc1:<epoch>:<salt>:<iv>:<ciphertext>:<signature>   (signed like channel messages)
//   DM:                     td1:<salt>:<iv>:<ciphertext>                       (not signed, like DMs)
const tagBytes = (payload) => {
  const b = padded(payload);
  if (b.length !== 256) throw new Error('That tag is too long.');
  return b;
};
const groupTagAad = (channelId, epoch, messageId, fileIndex, tagId, authorId) => `hearth-tc1|${channelId}|${epoch}|${messageId}|${fileIndex}|${tagId}|${authorId}`;
const dmTagAad = (dmId, messageId, fileIndex, tagId, authorId) => `hearth-td1|${dmId}|${messageId}|${fileIndex}|${tagId}|${authorId}`;
export async function encryptGroupTag({ raw, serverId, channelId, epoch, messageId, fileIndex, tagId, authorId, signKey, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const aad = groupTagAad(channelId, epoch, messageId, fileIndex, tagId, authorId);
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), salt, `hearth-tag-v1|${channelId}`, ['encrypt']);
  const body = `${epoch}:${b64(salt)}:${b64(iv)}:${b64(await aesEncrypt(key, iv, tagBytes(payload), aad))}`;
  return `tc1:${body}:${await sign(signKey, `${aad}|${body}`)}`;
}
// The key epoch a channel tag says it was sealed with (null for anything else).
export function tagEpoch(text) {
  const p = String(text || '').split(':');
  return p[0] === 'tc1' && /^[1-9][0-9]{0,8}$/.test(p[1] || '') ? parseInt(p[1], 10) : null;
}
// authorSignPub: the author's signing key or a list of them, as for decryptGroup; signedBy says which one signed it.
export async function decryptGroupTag({ raw, serverId, channelId, messageId, fileIndex, tagId, authorId, authorSignPub, text }) {
  const parts = String(text).split(':');
  const [v, epoch, salt, iv, ct, sig] = parts;
  if (parts.length !== 6 || v !== 'tc1' || tagEpoch(text) === null) throw new Error('Unknown format');
  const aad = groupTagAad(channelId, epoch, messageId, fileIndex, tagId, authorId);
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), unb64(salt), `hearth-tag-v1|${channelId}`, ['decrypt']);
  const payload = JSON.parse(dec.decode(await aesDecrypt(key, unb64(iv), unb64(ct), aad)));
  const signedBy = await verifyAny(authorSignPub, `${aad}|${epoch}:${salt}:${iv}:${ct}`, sig);
  return { payload, verified: !!signedBy, signedBy };
}
export async function encryptDmTag({ myPriv, theirPub, dmId, messageId, fileIndex, tagId, authorId, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const key = await hkdfAes(await dmBase(myPriv, theirPub), salt, `hearth-dm-tag-v1|${dmId}`, ['encrypt']);
  const ct = await aesEncrypt(key, iv, tagBytes(payload), dmTagAad(dmId, messageId, fileIndex, tagId, authorId));
  return `td1:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
}
export async function decryptDmTag({ myPriv, theirPub, dmId, messageId, fileIndex, tagId, authorId, text }) {
  const parts = String(text).split(':');
  const [v, salt, iv, ct] = parts;
  if (parts.length !== 4 || v !== 'td1') throw new Error('Unknown format');
  const key = await hkdfAes(await dmBase(myPriv, theirPub), unb64(salt), `hearth-dm-tag-v1|${dmId}`, ['decrypt']);
  return { payload: JSON.parse(dec.decode(await aesDecrypt(key, unb64(iv), unb64(ct), dmTagAad(dmId, messageId, fileIndex, tagId, authorId)))) };
}

// ---------------------------------------------------------------- chat backgrounds (chat-look.js)
// A DM's or group chat's background, set by someone in it: which preset, or which picture (its upload address and file
// key) and how much to dim it. Its formats, key derivation (HKDF info) and additional data are its own, so a background
// never opens as a message, a tag, a key wrap or a voice handshake, nor any of those as a background. The additional
// data binds the conversation, the key epoch (group chats), the version (the server counts each change up and keeps the
// count after a removal, so a background sealed for an earlier version can't be brought back as a later one) and who set
// it: the server can't move one to another conversation or author.
// The payload is padded with spaces to exactly LOOK_BYTES (padded() steps by 256, so it isn't used here): every
// background is the same size, a preset or a picture, and its length says nothing about which.
//   Group chat: lkc1:<epoch>:<salt>:<iv>:<ciphertext>:<signature>   (signed like channel messages)
//   DM:         lkd1:<salt>:<iv>:<ciphertext>                       (not signed, like DMs)
export const LOOK_BYTES = 512;
function lookBytes(payload) {
  const b = enc.encode(JSON.stringify(payload));
  if (b.length > LOOK_BYTES) throw new Error('That background doesn’t fit.');
  const out = new Uint8Array(LOOK_BYTES).fill(0x20);
  out.set(b);
  return out;
}
// The version goes into the additional data as written here: a whole number from 1, one way to write it.
function lookVersion(version) {
  if (!Number.isInteger(version) || version < 1 || version > 1e9) throw new Error('Bad background version');
  return version;
}
const openLookBytes = (bytes) => {
  if (bytes.length !== LOOK_BYTES) throw new Error('Unknown format');
  return JSON.parse(dec.decode(bytes));
};
const groupLookAad = (serverId, epoch, version, authorId) => `hearth-lkc1|${serverId}|${epoch}|${lookVersion(version)}|${authorId}`;
const dmLookAad = (dmId, version, authorId) => `hearth-lkd1|${dmId}|${lookVersion(version)}|${authorId}`;
export async function encryptGroupLook({ raw, serverId, epoch, version, authorId, signKey, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const aad = groupLookAad(serverId, epoch, version, authorId);
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), salt, `hearth-look-v1|${serverId}`, ['encrypt']);
  const body = `${epoch}:${b64(salt)}:${b64(iv)}:${b64(await aesEncrypt(key, iv, lookBytes(payload), aad))}`;
  return `lkc1:${body}:${await sign(signKey, `${aad}|${body}`)}`;
}
// The key epoch a group chat's background says it was sealed with (null for anything else).
export function lookEpoch(text) {
  const p = String(text || '').split(':');
  return p[0] === 'lkc1' && /^[1-9][0-9]{0,8}$/.test(p[1] || '') ? parseInt(p[1], 10) : null;
}
// authorSignPub: the author's signing key or a list of them, as for decryptGroup; signedBy says which one signed it.
export async function decryptGroupLook({ raw, serverId, version, authorId, authorSignPub, text }) {
  const parts = String(text).split(':');
  const [v, epoch, salt, iv, ct, sig] = parts;
  if (parts.length !== 6 || v !== 'lkc1' || lookEpoch(text) === null) throw new Error('Unknown format');
  const aad = groupLookAad(serverId, epoch, version, authorId);
  const key = await hkdfAes(await groupBase(raw, `${serverId}|${epoch}`), unb64(salt), `hearth-look-v1|${serverId}`, ['decrypt']);
  const payload = openLookBytes(await aesDecrypt(key, unb64(iv), unb64(ct), aad));
  const signedBy = await verifyAny(authorSignPub, `${aad}|${epoch}:${salt}:${iv}:${ct}`, sig);
  return { payload, verified: !!signedBy, signedBy };
}
export async function encryptDmLook({ myPriv, theirPub, dmId, version, authorId, payload }) {
  const salt = rand(32);
  const iv = rand(12);
  const aad = dmLookAad(dmId, version, authorId);
  const key = await hkdfAes(await dmBase(myPriv, theirPub), salt, `hearth-dm-look-v1|${dmId}`, ['encrypt']);
  const ct = await aesEncrypt(key, iv, lookBytes(payload), aad);
  return `lkd1:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
}
export async function decryptDmLook({ myPriv, theirPub, dmId, version, authorId, text }) {
  const parts = String(text).split(':');
  const [v, salt, iv, ct] = parts;
  if (parts.length !== 4 || v !== 'lkd1') throw new Error('Unknown format');
  const aad = dmLookAad(dmId, version, authorId);
  const key = await hkdfAes(await dmBase(myPriv, theirPub), unb64(salt), `hearth-dm-look-v1|${dmId}`, ['decrypt']);
  return { payload: openLookBytes(await aesDecrypt(key, unb64(iv), unb64(ct), aad)) };
}

// ---------------------------------------------------------------- attachments (one random key per file)
export async function encryptFile(arrayBuffer) {
  const raw = rand(32);
  const key = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = rand(12);
  const ct = await aesEncrypt(key, iv, arrayBuffer);
  return { blob: concat(iv, ct), k: b64(raw) };
}
export async function decryptFile(kB64, arrayBuffer) {
  const key = await subtle().importKey('raw', unb64(kB64), 'AES-GCM', false, ['decrypt']);
  const bytes = new Uint8Array(arrayBuffer);
  return aesDecrypt(key, bytes.slice(0, 12), bytes.slice(12));
}

// ---------------------------------------------------------------- verification
// Safety numbers cover both people's identity and signing keys.
export async function safetyNumber(a, b) {
  const ka = `${a.publicKey}|${a.signPublicKey || ''}`;
  const kb = `${b.publicKey}|${b.signPublicKey || ''}`;
  const [x, y] = [ka, kb].sort();
  const digest = new Uint8Array(await subtle().digest('SHA-512', enc.encode(`hearth-safety-v2|${x}||${y}`)));
  const groups = [];
  for (let i = 0; i < 12; i++) {
    const n = ((digest[i * 3] << 16) | (digest[i * 3 + 1] << 8) | digest[i * 3 + 2]) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups;
}
export async function keyFingerprint(user) {
  const digest = await subtle().digest('SHA-256', enc.encode(`${user.publicKey}|${user.signPublicKey || ''}`));
  return toHex(digest).slice(0, 40).match(/.{4}/g).join(' ');
}

// Trust on first use: remember each person's keys and warn if the server ever hands out different ones.
// A pin is { e, s, verified?, old? }: the identity and signing keys this device saw as theirs, and `old`, keys it
// pinned for them before they changed keys and you accepted the new ones ([{ e, s, until }], oldest first; until:
// when that key stopped being theirs). Only keys this device itself saw as someone's current keys are ever
// pinned. Keys the server merely lists as someone's past keys (user.pastKeys) never are: nothing vouches for them
// (safety numbers cover current keys only), so the server could list a key of its own there.
const pinKey = (myId) => `hearth.pins.${myId}`;
// The parsed store is kept while its stored text stays exactly the same. The member list asks about every member,
// and parsing the whole store each time made a 1,000-member list take half a second. The text is still read on
// every call, so a change made anywhere else (another tab, another account on this device) is picked up at once.
let pinCache = { key: '', raw: null, pins: null };
function loadPins(myId) {
  const key = pinKey(myId);
  let raw;
  try { raw = localStorage.getItem(key); } catch { return {}; }
  if (pinCache.pins && pinCache.key === key && pinCache.raw === raw) return pinCache.pins;
  let pins;
  try { pins = JSON.parse(raw || '{}'); } catch { pins = {}; }
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) pins = {};
  pinCache = { key, raw, pins };
  return pins;
}
function savePins(myId, pins) {
  const raw = JSON.stringify(pins);
  // Forget the cache first: if saving fails, the next read goes back to what's really stored.
  pinCache = { key: '', raw: null, pins: null };
  localStorage.setItem(pinKey(myId), raw);
  pinCache = { key: pinKey(myId), raw, pins };
}
// A usable "stopped being theirs" time: a real moment, and not in the future (that would let a key count for
// things written after it was replaced).
const validUntil = (t) => typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= Date.now();
// The keys someone had before a password reset, as the server lists them (user.pastKeys): [{ e, s, until }],
// only those with a usable date.
function listedOf(user) {
  return (Array.isArray(user && user.pastKeys) ? user.pastKeys : []).slice(0, 10)
    .filter((k) => k && canonicalKey(k.publicKey))
    .map((k) => ({ e: k.publicKey, s: canonicalKey(k.signPublicKey) ? k.signPublicKey : null, until: Number(k.retiredAt) }))
    .filter((k) => validUntil(k.until));
}
// Server-listed past keys that could have made something written at `at` (ms): none for something undated. Use
// them only to open history, and show whatever only they open or check out as "older key, not verified".
export function listedPastKeys(user, at = 0) {
  return at > 0 ? listedOf(user).filter((k) => at <= k.until) : [];
}
// A key as the server lists it, or null for none (missing, null or empty) and for one not spelled the one way a key
// is (canonicalKey): never pinned, nor taken as the key pinned.
const keyIn = (k) => (canonicalKey(k) ? k : null);
// How someone's keys, as the server tells them now, compare with what this device pinned for them (p, or none):
//   'pin'      first sight: pin these keys
//   'fill'     pinned before they had a signing key, and they have one now: add it to the pin (trust on first use)
//   'ok'       nothing to change
//   'changed'  not the keys this device holds as theirs
// The server's whole answer about someone always carries both key fields (publicKey, signPublicKey). A record that
// says nothing about keys (neither field: a placeholder while it loads, a presence update) leaves the pin alone. But
// once this device has pinned someone, a record with no identity key (null, empty, or the field left out) that says
// anything about keys, or one with no signing key or another one, is a change: otherwise a server could blank or
// leave out the key it can't fake and slip in a signing key of its own. A real account never loses its identity key,
// and never loses its signing key without a new identity key (a password reset gives both).
// The exception is an account deleted by an older version of Hearth, which cleared both keys: deleted, with neither,
// there is nothing the server could use, so it's left as it was pinned (calls with a deleted account are refused
// anyway, secure.js checkSdp). Someone pinned before they had a signing key gets the first one listed for them,
// unless this device verified them by safety number: those numbers covered "no signing key", so a new one is a
// change to verify again.
function judgePin(p, user) {
  const e = keyIn(user.publicKey);
  const s = keyIn(user.signPublicKey);
  if (!p) return e ? 'pin' : 'ok';
  if (!e) {
    if (user.deleted && !s) return 'ok';
    return 'publicKey' in user || 'signPublicKey' in user ? 'changed' : 'ok';
  }
  if (p.e !== e) return 'changed';
  if (p.s) return (s ? s !== p.s : 'signPublicKey' in user) ? 'changed' : 'ok';
  if (s) return p.verified ? 'changed' : 'fill';
  return 'ok';
}
// Returns 'ok' | 'changed'. New people are pinned automatically (their current keys only).
export function checkPin(myId, user) {
  if (!user || user.id === myId) return 'ok';
  const pins = loadPins(myId);
  const r = judgePin(pins[user.id], user);
  if (r === 'pin') { pins[user.id] = { e: user.publicKey, s: keyIn(user.signPublicKey) }; savePins(myId, pins); return 'ok'; }
  if (r === 'fill') { pins[user.id].s = user.signPublicKey; savePins(myId, pins); return 'ok'; }
  if (r === 'changed') noteChangeSeen(myId, pins[user.id], user.id);
  return r;
}
// When this device first saw someone's keys listed as changed (by its own clock), kept beside the pin (for the keys it
// holds, e) until the change is accepted: the pinned keys count as theirs only for what was written before then.
const seenKey = (myId) => `hearth.pinseen.${myId}`;
function loadSeen(myId) {
  try { const x = JSON.parse(localStorage.getItem(seenKey(myId)) || '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
}
function saveSeen(myId, all) { try { localStorage.setItem(seenKey(myId), JSON.stringify(all)); } catch { /* storage blocked */ } }
function noteChangeSeen(myId, pin, id) {
  if (!pin) return;
  const all = loadSeen(myId);
  if (all[id] && all[id].e === pin.e && validUntil(all[id].t)) return;
  all[id] = { e: pin.e, t: Date.now() };
  saveSeen(myId, all);
}
function seenFor(myId, pin, id) {
  const x = pin && loadSeen(myId)[id];
  return x && x.e === pin.e && validUntil(x.t) ? x.t : 0;
}
// (Kept until the change is accepted, even if the server lists their old keys again meanwhile: it could otherwise
// move it later at will. Compared with the server's dates give or take PIN_SKEW, for this device's clock.)
export const PIN_SKEW = 10 * 60 * 1000;
export const changeSeenAt = (myId, user) => (user ? seenFor(myId, loadPins(myId)[user.id], user.id) : 0);
// checkPin for many people at once (a member list): the same pinning and the same answer for each person, with
// the store read and saved once instead of once per person. Returns the ids whose keys changed.
export function checkPins(myId, users) {
  const pins = loadPins(myId);
  const changed = new Set();
  let save = false;
  for (const user of users) {
    if (!user || user.id === myId) continue;
    const r = judgePin(pins[user.id], user);
    if (r === 'changed') { changed.add(user.id); noteChangeSeen(myId, pins[user.id], user.id); }
    else if (r === 'pin') { pins[user.id] = { e: user.publicKey, s: keyIn(user.signPublicKey) }; save = true; }
    else if (r === 'fill') { pins[user.id].s = user.signPublicKey; save = true; }
  }
  if (save) savePins(myId, pins);
  return changed;
}
// Downgrade protection: once this device has checked a post-quantum key for someone (next to the identity key it pinned
// for them), it notes so in the pin (q: its fingerprint). A server that later leaves their post-quantum key out, to get
// apps to fall back on P-256 alone, is then refused (secure.js pqKeyOf). Accepting a new identity key for them
// (acceptPin) starts the pin over, so a reset that really gave them no post-quantum key yet doesn't block anything after
// that; accepting the same one again keeps it.
export function pinPq(myId, user, fp) {
  if (!user || user.id === myId || typeof fp !== 'string' || !fp) return;
  const pins = loadPins(myId);
  const p = pins[user.id];
  if (!p || p.e !== user.publicKey || p.q === fp) return;
  p.q = fp;
  savePins(myId, pins);
}
// The same for your own account, per device: once this device has seen your post-quantum key published (signed by you),
// it never writes P-256 alone for you again because the server stops listing it (secure.js myPqForWriting).
const ownPqKey = (myId) => `hearth.pqself.${myId}`;
export function pinOwnPq(myId, fp) {
  try { if (typeof fp === 'string' && fp && localStorage.getItem(ownPqKey(myId)) !== fp) localStorage.setItem(ownPqKey(myId), fp); } catch { /* storage blocked */ }
}
export function ownPqPinned(myId) {
  try { return !!localStorage.getItem(ownPqKey(myId)); } catch { return false; }
}
// Per DM, what this device has seen of it going post-quantum: pq (a d3 message was there, or this device wrote one),
// first (the earliest time, as the d3 messages themselves say it: their authenticated ts, never the server's date).
const dmPqKey = (myId) => `hearth.dmpq.${myId}`;
function loadDmPq(myId) {
  try { const x = JSON.parse(localStorage.getItem(dmPqKey(myId)) || '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
}
function saveDmPq(myId, all) { try { localStorage.setItem(dmPqKey(myId), JSON.stringify(all)); } catch { /* storage blocked */ } }
export const dmPqSeen = (myId, dmId) => !!(loadDmPq(myId)[dmId] || {}).pq;
export function noteDmPq(myId, dmId) {
  const all = loadDmPq(myId);
  if ((all[dmId] || {}).pq) return;
  all[dmId] = { ...(all[dmId] || {}), pq: 1 };
  saveDmPq(myId, all);
}
export const dmFirstAt = (myId, dmId) => { const t = Number((loadDmPq(myId)[dmId] || {}).first); return Number.isSafeInteger(t) && t > 0 ? t : 0; };
export function noteDmFirst(myId, dmId, t) {
  if (!Number.isSafeInteger(t) || t <= 0) return;
  const all = loadDmPq(myId);
  const cur = Number((all[dmId] || {}).first) || 0;
  if (cur && cur <= t) return;
  all[dmId] = { ...(all[dmId] || {}), pq: 1, first: t };
  saveDmPq(myId, all);
}
// Whether any DM of this account has gone post-quantum on this device (then the account has a post-quantum key).
export const anyDmPq = (myId) => Object.values(loadDmPq(myId)).some((x) => x && x.pq);
// Forgets that this account had a post-quantum key (a reset that legitimately dropped it).
export function forgetOwnPq(myId) { try { localStorage.removeItem(ownPqKey(myId)); } catch { /* storage blocked */ } }
export function pinnedPq(myId, user) {
  const p = user && loadPins(myId)[user.id];
  return !!p && typeof p.q === 'string' && !!p.q && p.e === user.publicKey;
}
// Trusting someone's new keys (after comparing safety numbers). Only the keys this device trusted until now go on
// record, for what was written before they were replaced: before this device first saw the change (by its own clock),
// or before the server says it happened if that's earlier (a key that leaked shouldn't count for longer than it was
// theirs; the server can't make it count longer). A record with no identity key has nothing to trust: false, and the
// pin stays as it was.
// When the server says a key of someone's was replaced (0 if it doesn't list it with a usable date).
function listedRetiredAt(user, e) {
  const k = listedOf(user).find((x) => x.e === e);
  return k ? k.until : 0;
}
// The time a key this device pinned for someone counts until, now that their keys changed and that isn't accepted yet:
// when this device first saw that, or when the server says it happened if that's earlier.
// (local: false for something undated, which only the server's date can say anything about, as before.)
export function pinnedUntil(myId, user, { local: byClock = true } = {}) {
  const p = user && loadPins(myId)[user.id];
  if (!p) return 0;
  const seen = byClock ? seenFor(myId, p, user.id) : 0;
  const local = seen ? seen + PIN_SKEW : 0;
  const listed = listedRetiredAt(user, p.e);
  return local && listed ? Math.min(local, listed) : local || listed;
}
export function acceptPin(myId, user) {
  if (!user || !keyIn(user.publicKey)) return false;
  const pins = loadPins(myId);
  const prev = pins[user.id];
  const cur = { e: user.publicKey, s: keyIn(user.signPublicKey) };
  // When this device first saw the change, or accepted it, by its own clock; or when the server says it happened, if
  // that's earlier (it can only make the old key count for less, never longer).
  const local = seenFor(myId, prev, user.id) || Date.now();
  const listed = prev ? listedRetiredAt(user, prev.e) : 0;
  const until = listed && listed < local ? listed : local;
  // (By this device's clock: the margin for it is added when it's compared, pinnedKeys; an `until` is never in the future.)
  const byClock = until === local;
  const old = (prev ? [...(Array.isArray(prev.old) ? prev.old : []), { e: prev.e, s: prev.s || null, until, ...(byClock ? { clock: 1 } : {}) }] : [])
    .filter((k, i, all) => k && typeof k.e === 'string' && k.e && validUntil(k.until) && !(k.e === cur.e && k.s === cur.s)
      && all.findIndex((x) => x && x.e === k.e && x.s === k.s) === i);
  // The post-quantum pin (q, pinPq) stays while the identity key is the same one: comparing numbers for someone whose
  // keys didn't change mustn't let a server that hides their post-quantum key slip back to P-256 alone.
  const q = prev && prev.e === cur.e && typeof prev.q === 'string' && prev.q ? { q: prev.q } : {};
  pins[user.id] = { ...cur, verified: true, ...q, ...(old.length ? { old: old.slice(-10) } : {}) };
  savePins(myId, pins);
  return true;
}
// The keys this device pinned for someone: { e, s } (the ones it holds as theirs now) and `old` ([{ e, s }],
// newest first): keys it pinned for them before, only with `at` (when something was written) and only those
// still theirs then. Without a date, none: an old key that leaked can't vouch for anything undated or newer.
// This device's local record of whom its own rotations left out (server, epoch -> ids): only those does it ever share an
// older key with later (secure.js maintain), whatever the server says is owed.
const deferKey = (myId) => `hearth.deferred.${myId}`;
function loadDeferred(myId) {
  try { const x = JSON.parse(localStorage.getItem(deferKey(myId)) || '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
}
export function noteDeferred(myId, serverId, epoch, ids) {
  if (!ids || !ids.length) return;
  const all = loadDeferred(myId);
  all[`${serverId}|${epoch}`] = [...new Set([...(all[`${serverId}|${epoch}`] || []), ...ids])];
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - 200)).forEach((k) => delete all[k]);
  try { localStorage.setItem(deferKey(myId), JSON.stringify(all)); } catch { /* storage blocked */ }
}
export const deferredHere = (myId, serverId, epoch, id) => (loadDeferred(myId)[`${serverId}|${epoch}`] || []).includes(id);
// Every key this device once pinned for them and has since replaced, whatever the date ([{ e, s }]).
export function retiredPins(myId, user) {
  const p = user && loadPins(myId)[user.id];
  return p && Array.isArray(p.old) ? p.old.filter((k) => k && typeof k.e === 'string').map((k) => ({ e: k.e, s: k.s || null })) : [];
}
export function pinnedKeys(myId, user, at = 0) {
  const p = user && loadPins(myId)[user.id];
  if (!p) return { e: null, s: null, old: [] };
  const old = at > 0 && Array.isArray(p.old)
    ? p.old.slice().reverse().filter((k) => k && typeof k === 'object' && typeof k.e === 'string' && validUntil(k.until) && at <= k.until + (k.clock ? PIN_SKEW : 0))
    : [];
  return { e: p.e || null, s: p.s || null, old: old.map((k) => ({ e: k.e, s: k.s || null })) };
}

// ---------------------------------------------------------------- local key storage (IndexedDB)
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('hearth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('keys', mode);
    const req = fn(t.objectStore('keys'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}
export const storeKey = (userId, key) => tx('readwrite', (s) => s.put(key, userId));
export const loadKey = (userId) => tx('readonly', (s) => s.get(userId)).catch(() => null);
// The post-quantum seed this device holds for the account (from the password envelope: unwrapIdentity), kept beside
// the identity key.
export const storePqSeed = (userId, seed) => tx('readwrite', (s) => (seed ? s.put(seed, `${userId}|pq`) : s.delete(`${userId}|pq`)));
export const loadPqSeed = (userId) => tx('readonly', (s) => s.get(`${userId}|pq`)).then((x) => (x instanceof Uint8Array && x.length === PQ_SEED_BYTES ? x : null)).catch(() => null);
export const clearKeys = () => tx('readwrite', (s) => s.clear()).catch(() => {});
export function clearCaches() { dmBases = new WeakMap(); dmLegacyKeys = new WeakMap(); groupBases = new WeakMap(); }
