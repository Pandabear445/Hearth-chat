// Custom emoji upload (Server settings → Emoji): every picture is made to fit before it goes up. Emoji are stored at
// most 128×128 (server/emojiimage.js) and shown 22 px tall in a line of text, 48 px on their own.
//   - A still picture bigger than that is shrunk here, on a canvas: its shape kept, transparency kept, saved as PNG
//     (or WebP when that's smaller, for photos). One that already fits goes up as it is.
//   - An animated GIF goes up as it is, and the server shrinks it (still animated); a browser can't write GIFs.
//   - An animated WebP or PNG bigger than 128×128 can't be shrunk by either without losing the animation, so it's
//     refused here with a message saying what to do.
// The server checks all of it again, so nothing bigger is ever stored however it's uploaded.

export const EMOJI_PX = 128;
export const STORED_MAX = 512 * 1024;
export const UPLOAD_MAX = 2 * 1024 * 1024;

// A name for a picked file: its name without the extension, in letters, numbers and _ (what the server keeps), at
// most 32 characters, and not one already taken (here or in the same batch): "party blob.png" → party_blob, then
// party_blob_2.
export function suggestName(filename, taken = new Set()) {
  let base = String(filename || '').replace(/\.[^.]*$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // partyBlob → party_Blob
    .toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
  if (base.length < 2) base = 'emoji';
  const has = (n) => taken.has(n);
  if (!has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const tail = `_${i}`;
    const n = base.slice(0, 32 - tail.length) + tail;
    if (!has(n)) return n;
  }
  return base;
}

// The size that fits max×max with the same shape (never bigger than it was).
export function fitSize(w, h, max = EMOJI_PX) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  if (w <= max && h <= max) return { width: w, height: h };
  const s = Math.min(max / w, max / h);
  return { width: Math.max(1, Math.min(max, Math.round(w * s))), height: Math.max(1, Math.min(max, Math.round(h * s))) };
}

// What a file is, from its first bytes (not its name or type): { type, width, height, animated } or null. The same
// reading as the server's (server/emojiimage.js imageInfo).
export function sniff(b) {
  if (!b || b.length < 12) return null;
  const ascii = (a, z) => String.fromCharCode(...b.subarray(a, z));
  const u16le = (o) => b[o] | (b[o + 1] << 8);
  const u16be = (o) => (b[o] << 8) | b[o + 1];
  const u32be = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const find = (s, from) => { outer: for (let i = from; i <= b.length - s.length; i++) { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) continue outer; return i; } return -1; };
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') {
    if (b.length < 24) return null;
    const idat = find('IDAT', 8);
    const actl = find('acTL', 8);
    return { type: 'png', width: u32be(16), height: u32be(20), animated: actl !== -1 && (idat === -1 || actl < idat) };
  }
  if (ascii(0, 3) === 'GIF') return { type: 'gif', width: u16le(6), height: u16le(8), animated: gifFrames(b) > 1 };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    for (let n = 0; i + 9 < b.length && n < 4096; n++) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', width: u16be(i + 7), height: u16be(i + 5), animated: false };
      if (m === 0xda) return null;
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && b.length >= 30) {
    const kind = ascii(12, 16);
    const u24 = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
    if (kind === 'VP8X') return { type: 'webp', width: 1 + u24(24), height: 1 + u24(27), animated: !!(b[20] & 2) };
    if (kind === 'VP8 ') return { type: 'webp', width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, animated: false };
    if (kind === 'VP8L') { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { type: 'webp', width: 1 + (v & 0x3fff), height: 1 + ((v >>> 14) & 0x3fff), animated: false }; }
  }
  return null;
}
// How many frames a GIF has, counted up to 2.
function gifFrames(b) {
  const n = b.length;
  const table = (p) => (p & 0x80 ? 3 * (1 << ((p & 7) + 1)) : 0);
  const subEnd = (k) => { while (k < n) { const len = b[k]; k += 1 + len; if (len === 0) return k; } return -1; };
  let i = 13 + table(b[10]);
  let frames = 0;
  for (let guard = 0; i < n && guard < 100000; guard++) {
    if (b[i] === 0x3b) break;
    if (b[i] === 0x2c && i + 10 <= n) {
      if (++frames > 1) return frames;
      const e = subEnd(i + 10 + table(b[i + 9]) + 1);
      if (e < 0) break;
      i = e;
    } else if (b[i] === 0x21) {
      const e = subEnd(i + 2);
      if (e < 0) break;
      i = e;
    } else break;
  }
  return frames;
}

export const sizeLabel = (n) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

// The browser part: what to upload for this file. Resolves to { blob, filename, width, height, was, animated, note }
// or { error } with a message for the person. was: the picture's own size when it was shrunk.
export async function prepareEmoji(file) {
  if (!file) return { error: 'Choose a picture.' };
  if (file.size > UPLOAD_MAX) return { error: `It’s ${sizeLabel(file.size)}. Emoji pictures can be up to 2 MB.` };
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, UPLOAD_MAX)).arrayBuffer());
  const info = sniff(bytes);
  if (!info || !info.width || !info.height) return { error: 'That isn’t a PNG, JPG, GIF or WebP picture.' };
  const fits = info.width <= EMOJI_PX && info.height <= EMOJI_PX;
  const target = fitSize(info.width, info.height);
  const ext = { png: 'png', gif: 'gif', jpeg: 'jpg', webp: 'webp' }[info.type];
  if (info.animated) {
    if (fits) return file.size > STORED_MAX ? { error: `It’s ${sizeLabel(file.size)}. Animated emoji can be up to ${sizeLabel(STORED_MAX)}: try a shorter one.` } : { blob: file, filename: `emoji.${ext}`, width: info.width, height: info.height, animated: true, note: 'Animated' };
    if (info.type !== 'gif') return { error: `This animated ${info.type === 'png' ? 'PNG' : 'WebP'} is ${info.width}×${info.height}. Animated emoji are up to ${EMOJI_PX}×${EMOJI_PX}: shrink it first, or use a GIF (Hearth shrinks GIFs for you).` };
    return { blob: file, filename: 'emoji.gif', width: target.width, height: target.height, was: { width: info.width, height: info.height }, animated: true, note: `Animated: shrunk to ${target.width}×${target.height} when it’s uploaded` };
  }
  if (fits && file.size <= STORED_MAX) return { blob: file, filename: `emoji.${ext}`, width: info.width, height: info.height, animated: false };
  // Shrink on a canvas, halving at most each step so the result stays smooth (one big step skips most pixels).
  let src;
  try { src = await createImageBitmap(file); } catch { return { error: 'That picture couldn’t be opened.' }; }
  try {
    let cur = src;
    let w = src.width;
    let hgt = src.height;
    const final = fitSize(w, hgt);
    while (w / 2 >= final.width && hgt / 2 >= final.height) {
      const c = canvasOf(Math.round(w / 2), Math.round(hgt / 2));
      draw(c, cur);
      cur = c; w = c.width; hgt = c.height;
    }
    const out = canvasOf(final.width, final.height);
    draw(out, cur);
    let blob = await toBlob(out, 'image/png');
    let type = 'png';
    // Photos compress far better as WebP; keep whichever is smaller.
    if (!blob || blob.size > 64 * 1024) {
      const webp = await toBlob(out, 'image/webp', 0.92);
      if (webp && webp.type === 'image/webp' && (!blob || webp.size < blob.size)) { blob = webp; type = 'webp'; }
    }
    if (!blob) return { error: 'That picture couldn’t be shrunk in this browser.' };
    if (blob.size > STORED_MAX) return { error: `Even at ${final.width}×${final.height} it’s ${sizeLabel(blob.size)}. Emoji are up to ${sizeLabel(STORED_MAX)}.` };
    const shrunk = final.width !== info.width || final.height !== info.height;
    return { blob, filename: `emoji.${type}`, width: final.width, height: final.height, was: shrunk ? { width: info.width, height: info.height } : null, animated: false };
  } finally { if (src.close) src.close(); }
}
function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function draw(canvas, img) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height); // transparent, so transparency stays
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
