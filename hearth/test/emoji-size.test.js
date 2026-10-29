// Custom emoji at the size they're shown (server/emojiimage.js, public/js/emoji-upload.js): stored at most 128×128 and
// 512 KB, whatever is uploaded. Animated GIFs are shrunk on the server and keep moving; anything else too big is
// refused with a message (the app shrinks still pictures itself first). Hostile GIFs (sizes that would take
// gigabytes to decode, endless frames, broken data) are refused or survive without the work they ask for.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { startServer, gifOf } = require('./helpers');
const E = require('../server/emojiimage');

// ------------------------------------------------------------------ fixtures
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h, 0x80);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const riff = (kind, data) => { const h = Buffer.alloc(8); h.write(kind, 0, 'latin1'); h.writeUInt32LE(data.length, 4); const body = Buffer.concat([Buffer.from('WEBP'), h, data]); const r = Buffer.alloc(8); r.write('RIFF', 0, 'latin1'); r.writeUInt32LE(body.length, 4); return Buffer.concat([r, body]); };
function webpX(w, h, animated) { const d = Buffer.alloc(10); d[0] = animated ? 0x02 : 0; d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3); return riff('VP8X', d); }
function webpLossless(w, h) { const d = Buffer.alloc(10); d[0] = 0x2f; d.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1); return riff('VP8L', d); }
function webpLossy(w, h) { const d = Buffer.alloc(10); d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(w, 6); d.writeUInt16LE(h, 8); return riff('VP8 ', d); }
function jpeg(w, h) {
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.alloc(14), sof, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}
const checker = (x, y) => ((x >> 3) + (y >> 3)) & 1 ? 9 : 40;

// Reads a GIF the plain way: its screen, and each frame with its timing block and pixels (deinterlaced).
function readGif(buf) {
  const W = buf.readUInt16LE(6); const H = buf.readUInt16LE(8);
  const table = (p) => (p & 0x80 ? 3 * (1 << ((p & 7) + 1)) : 0);
  let i = 13 + table(buf[10]);
  const frames = []; let gce = null; let loop = false;
  while (i < buf.length && buf[i] !== 0x3b) {
    if (buf[i] === 0x21) {
      const label = buf[i + 1];
      if (label === 0xf9) gce = { flags: buf[i + 3], delay: buf.readUInt16LE(i + 4), transparent: buf[i + 3] & 1 ? buf[i + 6] : undefined };
      if (label === 0xff && buf.toString('latin1', i + 3, i + 14) === 'NETSCAPE2.0') loop = true;
      i += 2; while (buf[i]) i += buf[i] + 1; i++;
    } else if (buf[i] === 0x2c) {
      const f = { x: buf.readUInt16LE(i + 1), y: buf.readUInt16LE(i + 3), w: buf.readUInt16LE(i + 5), h: buf.readUInt16LE(i + 7), interlaced: !!(buf[i + 9] & 0x40), gce };
      gce = null;
      let k = i + 10 + table(buf[i + 9]);
      const min = buf[k++]; const parts = [];
      while (buf[k]) { parts.push(buf.subarray(k + 1, k + 1 + buf[k])); k += buf[k] + 1; }
      i = k + 1;
      let px = E.lzwDecode(Buffer.concat(parts), min, f.w * f.h, 0);
      if (f.interlaced) {
        const out = new Uint8Array(px.length); let r = 0;
        for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < f.h; y += st) { out.set(px.subarray(r * f.w, (r + 1) * f.w), y * f.w); r++; }
        px = out;
      }
      f.px = px;
      frames.push(f);
    } else throw new Error('bad block at ' + i);
  }
  return { W, H, frames, loop };
}

// ------------------------------------------------------------------ sizes
test('imageInfo: the size and kind from the file itself (PNG, GIF, JPEG, the three WebPs), never from its name', () => {
  assert.deepEqual(E.imageInfo(png(300, 20)), { type: 'png', width: 300, height: 20, animated: false });
  assert.deepEqual(E.imageInfo(gifOf({ width: 50, height: 60, frames: [{ w: 50, h: 60, color: checker }] })), { type: 'gif', width: 50, height: 60, animated: false });
  assert.equal(E.imageInfo(gifOf({ width: 50, height: 60, frames: [{ w: 5, h: 5, color: checker }, { w: 5, h: 5, color: checker }] })).animated, true);
  assert.deepEqual(E.imageInfo(jpeg(640, 480)), { type: 'jpeg', width: 640, height: 480, animated: false });
  assert.deepEqual(E.imageInfo(webpX(200, 100, true)), { type: 'webp', width: 200, height: 100, animated: true });
  assert.deepEqual(E.imageInfo(webpLossless(77, 33)), { type: 'webp', width: 77, height: 33, animated: false });
  assert.deepEqual(E.imageInfo(webpLossy(120, 90)), { type: 'webp', width: 120, height: 90, animated: false });
  assert.equal(E.imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(E.imageInfo(Buffer.alloc(3)), null);
  assert.deepEqual(E.fitSize(300, 200), { width: 128, height: 85, scale: 128 / 300 });
  assert.deepEqual(E.fitSize(10, 1000), { width: 1, height: 128, scale: 0.128 });
  assert.deepEqual(E.fitSize(64, 64), { width: 64, height: 64, scale: 1 }, 'never bigger');
});

test('LZW: reads plain-coded GIF data exactly, and what it writes reads back the same at every code size', () => {
  const g = readGif(gifOf({ width: 37, height: 23, frames: [{ w: 37, h: 23, color: (x, y) => (x * 7 + y * 3) & 127 }] }));
  for (let y = 0; y < 23; y++) for (let x = 0; x < 37; x++) assert.equal(g.frames[0].px[y * 37 + x], (x * 7 + y * 3) & 127);
  for (const min of [2, 3, 5, 8]) {
    const n = 40000;
    const px = Uint8Array.from({ length: n }, (_, i) => (i % 97 < 60 ? (i >> 6) : crypto.randomInt(1 << min)) & ((1 << min) - 1));
    assert.deepEqual(E.lzwDecode(E.lzwEncode(px, min), min, n, 0), px, `code size ${min}`);
  }
  assert.deepEqual(E.lzwDecode(E.lzwEncode(new Uint8Array(0), 2), 2, 0, 0), new Uint8Array(0));
});

// ------------------------------------------------------------------ shrinking GIFs
test('a big animated GIF is shrunk to fit 128×128 and keeps its frames, timing, looping, transparency and shape', () => {
  const src = gifOf({ width: 300, height: 200, frames: [
    { w: 300, h: 200, color: checker, delay: 7, interlace: true },
    { x: 50, y: 40, w: 100, h: 60, color: () => 5, delay: 12, transparent: 0 },
    { x: 299, y: 199, w: 1, h: 1, color: () => 3, delay: 3 }, // one pixel in the corner still lands on the screen
  ] });
  const r = E.fitEmoji(src);
  assert.equal(r.changed, true);
  assert.deepEqual(r.info, { type: 'gif', width: 128, height: 85, animated: true });
  const g = readGif(r.buf);
  assert.deepEqual([g.W, g.H, g.loop, g.frames.length], [128, 85, true, 3]);
  assert.deepEqual(g.frames.map((f) => f.gce.delay), [7, 12, 3]);
  assert.deepEqual(g.frames.map((f) => f.gce.transparent), [undefined, 0, undefined]);
  assert.deepEqual(g.frames.map((f) => f.gce.flags >> 2 & 7), [2, 2, 2], 'disposal kept');
  assert.ok(g.frames.every((f) => !f.interlaced), 'written plainly');
  // Each frame where its source was, scaled the same way, and inside the screen.
  const [a, b, c] = g.frames;
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 128, 85]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [21, 17, 64 - 21, 42 - 17]);
  assert.ok(c.x + c.w <= 128 && c.y + c.h <= 85 && c.w >= 1 && c.h >= 1);
  // Nearest neighbour: every pixel is the source pixel under its middle (so it's one of the GIF's own colours).
  const sx = 128 / 300; const sy = 85 / 200;
  for (let y = 0; y < 85; y++) for (let x = 0; x < 128; x++) {
    const want = checker(Math.min(299, Math.floor((x + 0.5) / sx)), Math.min(199, Math.floor((y + 0.5) / sy)));
    assert.equal(a.px[y * 128 + x], want, `${x},${y}`);
  }
  assert.ok(b.px.every((v) => v === 5));
  // Already small enough: the very same bytes.
  const small = gifOf({ width: 128, height: 40, frames: [{ w: 128, h: 40, color: checker }, { w: 4, h: 4, color: checker }] });
  const kept = E.fitEmoji(small);
  assert.equal(kept.buf, small);
  assert.equal(kept.changed, false);
});

test('a GIF that would take too much work is refused before anything is decoded', () => {
  const claim = ({ W = 2000, H = 2000, frames = [] }) => {
    // Frames whose headers claim a size, with almost no data behind them.
    const u16 = (n) => [n & 255, (n >> 8) & 255];
    const out = [...Buffer.from('GIF89a'), ...u16(W), ...u16(H), 0, 0, 0];
    for (const [w, h] of frames) out.push(0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0, 2, 2, 0x4c, 0x01, 0);
    out.push(0x3b);
    return Buffer.from(out);
  };
  const t0 = Date.now();
  assert.throws(() => E.fitEmoji(claim({ frames: [[4096, 4096], [4096, 4096], [4096, 4096], [4096, 4096]] })), (e) => e instanceof E.EmojiRejected && /too big/.test(e.message));
  assert.throws(() => E.fitEmoji(claim({ W: 60000, H: 60000, frames: [[1, 1]] })), (e) => e instanceof E.EmojiRejected && /60000×60000/.test(e.message));
  assert.throws(() => E.fitEmoji(claim({ W: 400, H: 400, frames: Array.from({ length: E.MAX_FRAMES + 1 }, () => [1, 1]) })), (e) => e instanceof E.EmojiRejected && /too many frames/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, `refused quickly (${Date.now() - t0} ms)`);
  // A frame bigger than the screen, data that ends early or is nonsense: shrunk without throwing anything but a
  // refusal, and what comes out is a GIF that fits.
  const broken = [
    claim({ W: 300, H: 300, frames: [[600, 600]] }),
    Buffer.concat([gifOf({ width: 400, height: 400, frames: [{ w: 400, h: 400, color: checker }] }).subarray(0, 3000)]),
    (() => { const g = gifOf({ width: 300, height: 300, frames: [{ w: 300, h: 300, color: checker }] }); const b = Buffer.from(g); for (let i = 900; i < b.length - 2; i += 7) b[i] = (b[i] * 31 + 7) & 255; return b; })(),
  ];
  for (const b of broken) {
    let r;
    try { r = E.fitEmoji(b); } catch (e) { assert.ok(e instanceof E.EmojiRejected, e.stack); continue; }
    assert.ok(r.info.width <= 128 && r.info.height <= 128);
  }
  // A code size no GIF uses.
  const odd = Buffer.from(gifOf({ width: 300, height: 10, frames: [{ w: 300, h: 10, color: checker }] }));
  const desc = 13 + 384 + 19 + 8; // header, colour table, looping block, timing block
  assert.equal(odd[desc], 0x2c);
  odd[desc + 10] = 12; // (no local table: the code size follows the descriptor)
  assert.throws(() => E.fitEmoji(odd), E.EmojiRejected);
});

test('review: a frame bigger than a small screen is clipped to it; a transparent index the codes can’t hold, and frames off the screen, don’t break the GIF', () => {
  // A 16×16 screen whose frame claims 2000×2000 (browsers would draw it that big): stored clipped to 16×16.
  const sneaky = gifOf({ width: 16, height: 16, frames: [{ w: 300, h: 300, color: checker }] });
  sneaky.writeUInt16LE(16, 6); sneaky.writeUInt16LE(16, 8);
  const r = E.fitEmoji(sneaky);
  assert.equal(r.changed, true);
  const g = readGif(r.buf);
  assert.deepEqual([g.W, g.H, g.frames[0].w, g.frames[0].h], [16, 16, 16, 16]);
  // Transparent index 120, but the frame's codes are 2 bits: filled with 0 instead, and the output reads back whole.
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const odd = Buffer.from([...Buffer.from('GIF89a'), ...u16(200), ...u16(200), 0x81, 0, 0, ...Buffer.alloc(12, 9),
    0x21, 0xf9, 4, 1, 0, 0, 120, 0, 0x2c, 0, 0, 0, 0, ...u16(200), ...u16(200), 0, 2, 1, 0x04, 0, 0x3b]);
  const o = readGif(E.fitEmoji(odd).buf);
  assert.equal(o.frames[0].px.length, o.frames[0].w * o.frames[0].h);
  assert.ok(o.frames[0].px.every((v) => v === 0));
  // A frame wholly off the screen stays unseen: one pixel of its transparent colour.
  const off = gifOf({ width: 300, height: 300, frames: [{ w: 300, h: 300, color: checker }, { x: 400, y: 0, w: 50, h: 50, color: () => 3, transparent: 0 }] });
  const f2 = readGif(E.fitEmoji(off).buf).frames[1];
  assert.deepEqual([f2.w, f2.h, f2.px[0]], [1, 1, 0]);
});

test('review: a frame that fills the screen fills the new one exactly, at sizes where floating point falls just short', () => {
  // 161 * (128 / 161) is 127.99… in floating point: the last column and row must still be drawn.
  for (const [w, h] of [[161, 161], [138, 200], [161, 64], [129, 129], [4096, 4095]]) {
    const big = w * h > 600000;
    const src = gifOf({ width: w, height: h, frames: [{ w: big ? 1 : w, h: big ? 1 : h, color: checker }, ...(big ? [] : [{ x: 0, y: 0, w, h, color: () => 4 }])] });
    if (big) { src.writeUInt16LE(w, 6); src.writeUInt16LE(h, 8); }
    const fit = E.fitSize(w, h);
    const g = readGif(E.fitEmoji(src).buf);
    assert.deepEqual([g.W, g.H], [fit.width, fit.height], `${w}×${h}`);
    if (big) continue;
    for (const f of g.frames) assert.deepEqual([f.x, f.y, f.w, f.h], [0, 0, fit.width, fit.height], `${w}×${h}: a full-screen frame keeps the whole screen`);
    assert.ok(g.frames[1].px.every((v) => v === 4));
  }
  // A frame ending at the screen's right edge ends at the new screen's right edge too.
  const g = readGif(E.fitEmoji(gifOf({ width: 161, height: 161, frames: [{ x: 80, y: 100, w: 81, h: 61, color: () => 2 }] })).buf);
  const [f] = g.frames;
  assert.deepEqual([f.x + f.w, f.y + f.h], [128, 128]);
});

test('review: a frame wholly off the screen without a transparent colour adds nothing that shows', () => {
  // The second frame sits at (300, 300) on a 200×200 screen and its control block names no transparent colour.
  const off = gifOf({ width: 200, height: 200, frames: [{ w: 200, h: 200, color: () => 6 }, { x: 300, y: 300, w: 20, h: 20, color: () => 0, delay: 9 }] });
  const g = readGif(E.fitEmoji(off).buf);
  assert.equal(g.frames.length, 2, 'kept, for its timing');
  const f = g.frames[1];
  assert.deepEqual([f.w, f.h], [1, 1]);
  assert.equal(f.gce.delay, 9);
  assert.equal(f.gce.transparent, f.px[0], 'its one pixel is see-through');
  assert.equal(f.gce.flags >> 2 & 7, 2, 'disposal kept');
  // With no control block at all, one is added that makes the pixel see-through.
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const bare = Buffer.from([...Buffer.from('GIF89a'), ...u16(200), ...u16(200), 0x81, 0, 0, ...Buffer.alloc(12, 9),
    0x2c, 0, 0, 0, 0, ...u16(200), ...u16(200), 0, 2, 1, 0x04, 0,
    0x2c, ...u16(500), ...u16(500), 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b]);
  const b = readGif(E.fitEmoji(bare).buf);
  assert.equal(b.frames.length, 2);
  assert.ok(b.frames[1].gce && b.frames[1].gce.transparent === b.frames[1].px[0]);
});

test('anything else too big is refused with what to do; so is an emoji over 512 KB', () => {
  assert.throws(() => E.fitEmoji(png(256, 256)), (e) => e instanceof E.EmojiRejected && /256×256/.test(e.message) && /128×128/.test(e.message));
  assert.throws(() => E.fitEmoji(webpX(300, 300, true)), (e) => /animated/.test(e.message) && /GIF/.test(e.message));
  assert.throws(() => E.fitEmoji(jpeg(129, 20)), (e) => /129×20/.test(e.message));
  assert.throws(() => E.fitEmoji(Buffer.from('not a picture at all')), (e) => /PNG, JPG, GIF or WebP/.test(e.message));
  assert.equal(E.fitEmoji(png(128, 128)).changed, false);
  assert.deepEqual(E.fitEmoji(webpLossy(100, 50)).info, { type: 'webp', width: 100, height: 50, animated: false });
  // 40 frames of 128×128 noise is over 512 KB.
  const noise = gifOf({ width: 128, height: 128, frames: Array.from({ length: 40 }, () => ({ w: 128, h: 128, color: () => crypto.randomInt(128) })) });
  assert.ok(noise.length > E.EMOJI_STORED_MAX);
  assert.throws(() => E.fitEmoji(noise), (e) => /512 KB/.test(e.message));
});

// ------------------------------------------------------------------ the app's side
test('app: names suggested from file names, sizes read from the bytes like the server does', async () => {
  const U = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'emoji-upload.js')).href);
  assert.equal(U.suggestName('Party Blob.png'), 'party_blob');
  assert.equal(U.suggestName('partyBlob.GIF'), 'party_blob');
  assert.equal(U.suggestName('<img src=x onerror=alert(1)>.png'), 'img_src_x_onerror_alert_1');
  assert.equal(U.suggestName('🔥.png'), 'emoji');
  assert.equal(U.suggestName('party.png', new Set(['party', 'party_2'])), 'party_3');
  assert.equal(U.suggestName(`${'a'.repeat(40)}.png`, new Set(['a'.repeat(32)])), `${'a'.repeat(30)}_2`);
  assert.deepEqual(U.fitSize(1000, 500), { width: 128, height: 64 });
  assert.deepEqual(U.fitSize(20, 30), { width: 20, height: 30 });
  for (const b of [png(300, 20), gifOf({ width: 200, height: 10, frames: [{ w: 1, h: 1, color: checker }, { w: 1, h: 1, color: checker }] }), jpeg(640, 480), webpX(200, 100, true), webpLossless(77, 33), webpLossy(120, 90)]) {
    const server = E.imageInfo(b);
    assert.deepEqual(U.sniff(new Uint8Array(b)), { type: server.type, width: server.width, height: server.height, animated: server.animated });
  }
  assert.equal(U.sniff(new Uint8Array(Buffer.from('GIF8'))), null);
});

test('the sizes they’re drawn at: 22 px in a line, 48 px on their own, fixed boxes whatever the file', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.match(css, /img\.cemoji \{[^}]*width: 1\.375em; height: 1\.375em;[^}]*object-fit: contain/);
  assert.match(css, /\.msg-text\.jumbo img\.cemoji \{ width: 48px; height: 48px; \}/);
  assert.match(css, /\.reaction img\.cemoji \{ width: 1[67]px; height: 1[67]px;/);
  assert.match(css, /\.suggest-emoji img\.cemoji \{ width: 22px; height: 22px; \}/);
  // Every custom emoji the app draws is an img.cemoji (so the boxes above apply), never a bare picture.
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const imgs = app.match(/h\('img', \{ class: [^}]*src: (?:e|c\.custom|it|g)\.(?:url|preview)/g) || [];
  assert.ok(imgs.length >= 4 && imgs.every((s) => /cemoji/.test(s)), imgs.join('\n'));
});

// ------------------------------------------------------------------ the routes
let srv; let owner; let server;
before(async () => {
  srv = await startServer();
  owner = srv.owner;
  server = (await srv.api('POST', '/servers', { token: owner.token, ip: owner.ip, body: { name: 'Emoji sizes' } })).json;
});
after(async () => { if (srv) await srv.stop(); });
function form(bytes, filename, name) {
  const boundary = '----e' + crypto.randomBytes(6).toString('hex');
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/${filename.split('.').pop()}\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n--${boundary}--\r\n`)]);
  return { raw, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const upload = (bytes, filename, name) => srv.api('POST', `/servers/${server.id}/emojis`, { token: owner.token, ip: owner.ip, ...form(bytes, filename, name), timeout: 30000 });
const filesOf = () => srv.sql('SELECT name, size FROM user_files WHERE user_id = ?', owner.id);

test('routes: one that fits is kept as it is; a big GIF is stored shrunk (and counted at its new size); a big still picture is refused and nothing is kept', async () => {
  const ok = await upload(png(64, 64), 'fits.png', 'fits');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.animated, false);
  const big = gifOf({ width: 400, height: 300, frames: [{ w: 400, h: 300, color: checker }, { x: 10, y: 10, w: 50, h: 50, color: () => 1 }] });
  const g = await upload(big, 'dance.gif', 'dance');
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.animated, true);
  const stored = fs.readFileSync(path.join(srv.dir, 'uploads', path.basename(g.json.url)));
  assert.deepEqual(E.imageInfo(stored), { type: 'gif', width: 128, height: 96, animated: true });
  assert.equal(readGif(stored).frames.length, 2);
  assert.equal(filesOf().find((f) => f.name === path.basename(g.json.url)).size, stored.length, 'storage counts what is kept');
  const before = filesOf().length;
  const files = fs.readdirSync(path.join(srv.dir, 'uploads')).length;
  for (const [bytes, fn, why] of [[png(256, 256), 'huge.png', /256×256/], [webpX(300, 300, true), 'anim.webp', /GIF/],
    [Buffer.from(gifOf({ width: 200, height: 200, frames: [] })), 'empty.gif', /no pictures/]]) {
    const r = await upload(bytes, fn, 'nope');
    assert.equal(r.status, 400, `${fn}: ${r.text}`);
    assert.equal(r.json.code, 'bad_emoji');
    assert.match(r.json.error, why);
  }
  assert.equal(filesOf().length, before, 'no storage used');
  assert.equal(fs.readdirSync(path.join(srv.dir, 'uploads')).length, files, 'nothing left on disk');
  assert.equal(srv.sql('SELECT COUNT(*) n FROM emojis WHERE server_id = ?', server.id)[0].n, 2);
});

test('routes: a name is letters, numbers and _ only, and a taken name is refused before any shrinking', async () => {
  const r = await upload(png(32, 32), 'x.png', '<img src=x onerror=alert(1)>');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.name, 'img_src_x_onerror_alert_1');
  const t0 = Date.now();
  const dup = await upload(gifOf({ width: 1000, height: 1000, frames: [{ w: 1000, h: 1000, color: checker }] }), 'big.gif', 'dance');
  assert.equal(dup.status, 409);
  assert.ok(Date.now() - t0 < 5000);
  const s = (await srv.api('GET', `/servers/${server.id}`, { token: owner.token, ip: owner.ip })).json;
  assert.ok(!JSON.stringify(s.emojis || []).includes('<'), 'no markup in names');
});
