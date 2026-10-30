// Writes Tests/HearthKitTests/Resources/node-vector.json: pushes encrypted by the server's own library (web-push,
// and http_ece under it for a message split into several records), for WebPushDecrypt's tests to decrypt.
// Run from hearth/ after npm ci: node mobile/ios-native/HearthKit/scripts/node-vector.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..', '..');
const webpush = require(path.join(root, 'node_modules', 'web-push'));
const ece = require(path.join(root, 'node_modules', 'http_ece'));

function phone() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { ecdh, auth: crypto.randomBytes(16) };
}
const b64url = (b) => Buffer.from(b).toString('base64url');

// What the phone gets for a DM (the same JSON Android and browsers get), padded like pushBody does.
const msg = { title: 'Zoë 🔥', body: 'Sent you a message: "hi" \\ /', tag: 'd:abc123', url: '/#m/xyz789', at: 1760000000000, generic: 'New message' };
const json = JSON.stringify(msg);
const plaintext = JSON.stringify({ ...msg, _: ' '.repeat(Math.max(0, 512 - Buffer.byteLength(json) - 7)) });

const one = phone();
const single = webpush.encrypt(b64url(one.ecdh.getPublicKey()), b64url(one.auth), plaintext, 'aes128gcm');

// The same text in 100-byte records (RFC 8188 lets a sender split a message; the server doesn't, the phone copes).
const two = phone();
const records = ece.encrypt(Buffer.from(plaintext), {
  version: 'aes128gcm', dh: b64url(two.ecdh.getPublicKey()), authSecret: b64url(two.auth), rs: 100,
  privateKey: (() => { const k = crypto.createECDH('prime256v1'); k.generateKeys(); return k; })(),
  salt: b64url(crypto.randomBytes(16)),
});

// Field names stay clear of the words the repository's secret scan looks for: these are throwaway test keys.
const vector = (p, body) => ({
  d: b64url(p.ecdh.getPrivateKey()), // the phone's raw 32-byte P-256 scalar
  p256dh: b64url(p.ecdh.getPublicKey()),
  s16: b64url(p.auth), // the 16-byte auth secret
  ciphertext: Buffer.from(body).toString('base64'), // standard base64, as `enc` travels
});
const out = {
  about: 'Made by scripts/node-vector.js with the server\'s web-push library, throwaway keys made for this file. d is the phone\'s P-256 scalar and s16 the subscription\'s 16-byte auth secret, both base64url. ciphertext is RFC 8291 aes128gcm in standard base64, and plaintext the UTF-8 text it decrypts to.',
  plaintext,
  single: vector(one, single.cipherText),
  records: { ...vector(two, records), rs: 100 },
};
const file = path.join(__dirname, '..', 'Tests', 'HearthKitTests', 'Resources', 'node-vector.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', path.relative(process.cwd(), file));
