// Custom emoji at the size they're shown: at most 128×128 pixels (Discord's size; the app shows them 22 px tall in a
// line of text, 48 px on their own, and these leave room for screens with two or three pixels per point), and at most
// EMOJI_STORED_MAX bytes once stored. Bigger ones cost everyone who reads a channel bandwidth for nothing.
//
//   - The app shrinks still pictures itself before it uploads them (public/js/emoji-upload.js: a canvas, keeping the
//     shape and transparency, saved as PNG or WebP), so what reaches the server already fits.
//   - Animated GIFs are shrunk here, in pure JavaScript, so they keep moving: every frame is decoded (LZW), scaled
//     with nearest neighbour (a GIF has a palette: every pixel stays one of its colours, transparency included), and
//     encoded again. A frame is a rectangle somewhere on the GIF's screen, so each one's position and size are scaled
//     by the same factor and frames that met still meet. Timing, looping, disposal and palettes are kept as they are.
//   - Anything else that's too big (a still picture sent straight to the API, an animated WebP or PNG, which a
//     browser can't re-encode either) is refused with a message saying what fits. Nothing is ever stored bigger.
//
// Hostile files: the sizes in a GIF's headers are checked before anything is decoded, decoding stops at the size
// the frame says (extra data is ignored, missing data is transparent), and a file whose frames would add up to more
// than MAX_PIXELS decoded pixels, or that has more than MAX_FRAMES frames, is refused without being decoded. Shrinking
// runs in the picture worker (server/imagemeta.js, fitEmojiFile) with its time limit, never on the main thread.
'use strict';

const EMOJI_PX = 128;
const EMOJI_STORED_MAX = 512 * 1024;
// A 2 MB GIF can claim any size in its headers; these keep the work bounded whatever it claims.
const MAX_SIDE = 4096; // a GIF screen wider or taller than this isn't an emoji
const MAX_PIXELS = 48 * 1024 * 1024; // decoded pixels over all frames
const MAX_FRAMES = 1500;

class EmojiRejected extends Error {}
const no = (msg) => new EmojiRejected(msg);

// ---------------------------------------------------------------- what kind of picture, and how big
// { type: 'png' | 'gif' | 'jpeg' | 'webp', width, height, animated } or null when it isn't one of those.
function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const ascii = (a, b) => buf.toString('latin1', a, b);
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') {
    if (buf.length < 24 || ascii(12, 16) !== 'IHDR') return null;
    const idat = buf.indexOf('IDAT', 8, 'latin1');
    const actl = buf.indexOf('acTL', 8, 'latin1');
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), animated: actl !== -1 && (idat === -1 || actl < idat) };
  }
  if (ascii(0, 3) === 'GIF') {
    return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), animated: gifFrameCount(buf, 2) > 1 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const d = jpegSize(buf);
    return d ? { type: 'jpeg', ...d, animated: false } : null;
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const d = webpSize(buf);
    return d ? { type: 'webp', ...d } : null;
  }
  return null;
}
function jpegSize(buf) {
  let i = 2;
  for (let n = 0; i + 9 < buf.length && n < 4096; n++) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // Start of frame (any kind but the DHT/JPG/DAC markers that share the range).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    if (m === 0xda || len < 2) return null; // image data before any size: not a picture we can measure
    i += 2 + len;
  }
  return null;
}
function webpSize(buf) {
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), animated: !!(buf[20] & 0x02) };
  }
  if (kind === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, animated: false };
  }
  if (kind === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff), animated: false };
  }
  return null;
}

// ---------------------------------------------------------------- GIF structure
const tableSize = (packed) => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
// Walks the blocks of a GIF: calls onFrame(start, descriptorEnd...) for frames and onExt for extensions. Returns the
// offset of the trailer (or the end of the readable part).
function walkGif(buf, { onFrame = () => {}, onExt = () => {} } = {}) {
  const n = buf.length;
  if (n < 13 || buf.toString('latin1', 0, 3) !== 'GIF') throw no('That isn’t a GIF.');
  const subEnd = (k) => { while (k < n) { const len = buf[k]; k += 1 + len; if (len === 0) return k; } return -1; };
  let i = 13 + tableSize(buf[10]);
  if (i > n) throw no('That GIF is damaged.');
  let blocks = 0;
  while (i < n) {
    if (++blocks > MAX_FRAMES * 4 + 64) throw no(`That GIF has too many frames for an emoji (up to ${MAX_FRAMES}).`);
    const b = buf[i];
    if (b === 0x3b) return i;
    if (b === 0x2c) {
      if (i + 10 > n) break;
      const lct = tableSize(buf[i + 9]);
      const data = i + 10 + lct;
      if (data + 1 > n) break;
      const end = subEnd(data + 1);
      if (end < 0) { onFrame(i, n); return n; } // cut off: what's there still plays
      if (onFrame(i, end) === false) return end;
      i = end;
    } else if (b === 0x21 && i + 2 <= n) {
      const end = subEnd(i + 2);
      if (end < 0) break;
      onExt(i, end);
      i = end;
    } else break;
  }
  return i;
}
function gifFrameCount(buf, stopAt = Infinity) {
  let frames = 0;
  try { walkGif(buf, { onFrame: () => (++frames < stopAt) }); } catch { /* counted what could be read */ }
  return frames;
}

// The image data of a frame, its sub-blocks joined.
function joinSubBlocks(buf, k, end) {
  const parts = [];
  while (k < end) {
    const len = buf[k];
    if (len === 0) break;
    parts.push(buf.subarray(k + 1, Math.min(end, k + 1 + len)));
    k += 1 + len;
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- LZW
// Decodes GIF LZW data into exactly `count` palette indices (missing ones are `fill`). Never writes past count.
function lzwDecode(data, minCode, count, fill) {
  const out = new Uint8Array(count).fill(fill);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let c = 0; c < clear; c++) { prefix[c] = -1; suffix[c] = c; first[c] = c; }
  let size = minCode + 1;
  let next = eoi + 1;
  let prev = -1;
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let p = 0; p < data.length && o < count;) {
    while (bits < size && p < data.length) { acc |= data[p++] << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let c = code;
    let sp = 0;
    if (prev === -1) {
      if (code >= clear) break; // a damaged stream: stop here
      out[o++] = code;
      prev = code;
      continue;
    }
    if (code > next) break; // a code that isn't in the table yet: damaged
    if (code === next) { stack[sp++] = first[prev]; c = prev; }
    while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; if (sp > 4096) return out; }
    stack[sp++] = c;
    if (next < 4096) { prefix[next] = prev; suffix[next] = c; first[next] = first[prev]; next++; }
    while (sp && o < count) out[o++] = stack[--sp];
    prev = code;
    if (next === (1 << size) && size < 12) size++;
  }
  return out;
}
// Encodes palette indices (each below 1 << minCode) as GIF LZW data.
function lzwEncode(pixels, minCode) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes = [];
  let size = minCode + 1;
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { bytes.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  };
  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  if (!pixels.length) { emit(eoi); if (bits) bytes.push(acc & 0xff); return Buffer.from(bytes); }
  let cur = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = cur * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits) bytes.push(acc & 0xff);
  return Buffer.from(bytes);
}
function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const part = data.subarray(i, i + 255);
    parts.push(Buffer.from([part.length]), part);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- shrinking a GIF
// The new screen size: fits max×max, keeps the shape, never grows.
function fitSize(w, h, max = EMOJI_PX) {
  if (w <= max && h <= max) return { width: w, height: h, scale: 1 };
  const scale = Math.min(max / w, max / h);
  return { width: Math.max(1, Math.min(max, Math.round(w * scale))), height: Math.max(1, Math.min(max, Math.round(h * scale))), scale };
}
const INTERLACE = [[0, 8], [4, 8], [2, 4], [1, 2]];

// A GIF that fits max×max. Returns the buffer unchanged when it already fits. Throws EmojiRejected.
function shrinkGif(buf, max = EMOJI_PX) {
  const W = buf.readUInt16LE(6);
  const H = buf.readUInt16LE(8);
  if (!W || !H) throw no('That GIF has no size.');
  // A frame can claim to be bigger than the screen, or to sit outside it (browsers then draw a bigger picture than
  // the screen says): such a GIF goes through the shrinking below even when its screen fits, which clips every frame
  // to the screen.
  let inside = true;
  walkGif(buf, { onFrame: (i) => {
    if (i + 10 > buf.length) return true;
    if (buf.readUInt16LE(i + 1) + buf.readUInt16LE(i + 5) > W || buf.readUInt16LE(i + 3) + buf.readUInt16LE(i + 7) > H) inside = false;
    return inside;
  } });
  if (W <= max && H <= max && inside) return buf;
  if (W > MAX_SIDE || H > MAX_SIDE) throw no(`That GIF is ${W}×${H}: too big to make into an emoji. Use one up to ${MAX_SIDE}×${MAX_SIDE}.`);
  // Count the work first: nothing is decoded for a file that claims too much.
  let pixels = 0;
  let frames = 0;
  walkGif(buf, { onFrame: (i) => {
    if (i + 10 > buf.length) return true;
    frames++;
    pixels += buf.readUInt16LE(i + 5) * buf.readUInt16LE(i + 7);
    if (frames > MAX_FRAMES) throw no(`That GIF has too many frames for an emoji (up to ${MAX_FRAMES}).`);
    if (pixels > MAX_PIXELS) throw no('That GIF is too big to make into an emoji. Try a shorter or smaller one.');
    return true;
  } });
  if (!frames) throw no('That GIF has no pictures in it.');
  const fit = fitSize(W, H, max);
  const sx = fit.width / W;
  const sy = fit.height / H;
  const out = [];
  const head = Buffer.from(buf.subarray(0, 13 + tableSize(buf[10])));
  head.writeUInt16LE(fit.width, 6);
  head.writeUInt16LE(fit.height, 8);
  out.push(head);
  let transparent = -1; // from the graphic control block just before a frame
  walkGif(buf, {
    onExt: (i, e) => {
      if (buf[i + 1] === 0xf9 && buf[i + 2] === 4 && i + 7 <= e) transparent = buf[i + 3] & 1 ? buf[i + 6] : -1;
      out.push(buf.subarray(i, e));
    },
    onFrame: (i, e) => {
      const left = buf.readUInt16LE(i + 1);
      const top = buf.readUInt16LE(i + 3);
      const fw = buf.readUInt16LE(i + 5);
      const fh = buf.readUInt16LE(i + 7);
      const packed = buf[i + 9];
      const lct = tableSize(packed);
      const data = i + 10 + lct;
      const minCode = buf[data];
      if (minCode < 2 || minCode > 8) throw no('That GIF is damaged.');
      // The part of the frame on the screen, in the GIF's own pixels, then on the new screen.
      const x0 = Math.min(left, W);
      const y0 = Math.min(top, H);
      const x1 = Math.min(left + fw, W);
      const y1 = Math.min(top + fh, H);
      let nx0 = Math.floor(x0 * sx);
      let ny0 = Math.floor(y0 * sy);
      let nx1 = Math.floor(x1 * sx);
      let ny1 = Math.floor(y1 * sy);
      if (x0 >= x1 || y0 >= y1) { nx1 = nx0 + 1; ny1 = ny0 + 1; } // nothing of it shows: one pixel
      if (nx1 <= nx0) nx1 = nx0 + 1;
      if (ny1 <= ny0) ny1 = ny0 + 1;
      if (nx1 > fit.width) { nx1 = fit.width; nx0 = Math.min(nx0, nx1 - 1); }
      if (ny1 > fit.height) { ny1 = fit.height; ny0 = Math.min(ny0, ny1 - 1); }
      const nw = nx1 - nx0;
      const nh = ny1 - ny0;
      // (A transparent index the code size can't write would break the codes after it.)
      const fill = transparent >= 0 && transparent < (1 << minCode) ? transparent : 0;
      const offScreen = x0 >= x1 || y0 >= y1; // nothing of it shows: kept (for its timing) as one unseen pixel
      transparent = -1;
      const src = fw && fh && !offScreen ? lzwDecode(joinSubBlocks(buf, data + 1, e), minCode, fw * fh, fill) : new Uint8Array(0);
      // Rows in the order they're stored (interlaced frames store every 8th row first, and so on).
      let rowOf = null;
      if (packed & 0x40) {
        rowOf = new Uint32Array(fh);
        let r = 0;
        for (const [start, step] of INTERLACE) for (let y = start; y < fh; y += step) rowOf[y] = r++;
      }
      const dst = new Uint8Array(nw * nh);
      for (let y = 0; y < nh; y++) {
        // The middle of the new pixel, back in the old frame.
        let syy = Math.floor((ny0 + y + 0.5) / sy) - top;
        syy = Math.max(0, Math.min(fh - 1, syy));
        const row = (rowOf ? rowOf[syy] : syy) * fw;
        for (let x = 0; x < nw; x++) {
          let sxx = Math.floor((nx0 + x + 0.5) / sx) - left;
          sxx = Math.max(0, Math.min(fw - 1, sxx));
          dst[y * nw + x] = fw && fh && !offScreen ? src[row + sxx] : fill;
        }
      }
      const desc = Buffer.alloc(10);
      desc[0] = 0x2c;
      desc.writeUInt16LE(nx0, 1);
      desc.writeUInt16LE(ny0, 3);
      desc.writeUInt16LE(nw, 5);
      desc.writeUInt16LE(nh, 7);
      desc[9] = packed & ~0x40; // not interlaced any more
      out.push(desc, buf.subarray(i + 10, data), Buffer.from([minCode]), subBlocks(lzwEncode(dst, minCode)));
      return true;
    },
  });
  out.push(Buffer.from([0x3b]));
  return Buffer.concat(out);
}

// ---------------------------------------------------------------- the check every emoji goes through
// What an emoji file becomes: { buf, changed, info } with buf at most 128×128 and EMOJI_STORED_MAX bytes. Throws
// EmojiRejected with a message for the person uploading it.
function fitEmoji(buf, max = EMOJI_PX) {
  const info = imageInfo(buf);
  if (!info || !info.width || !info.height) throw no('That isn’t a picture Hearth can use as an emoji. Use a PNG, JPG, GIF or WebP image.');
  let out = buf;
  if (info.type === 'gif') out = shrinkGif(buf, max); // (also clips frames that reach past a screen that fits)
  else if (info.width > max || info.height > max) {
    {
      throw no(info.animated
        ? `That animated picture is ${info.width}×${info.height}. Emoji are up to ${max}×${max}: shrink it first, or upload it as a GIF and Hearth shrinks it for you.`
        : `That picture is ${info.width}×${info.height}. Emoji are up to ${max}×${max}: the Hearth app shrinks pictures for you, or shrink it first.`);
    }
  }
  if (out.length > EMOJI_STORED_MAX) throw no(`That emoji is ${Math.ceil(out.length / 1024)} KB once it fits ${max}×${max}. Emoji are up to ${EMOJI_STORED_MAX / 1024} KB: try a shorter animation or fewer colours.`);
  const now = out === buf ? info : imageInfo(out);
  return { buf: out, changed: out !== buf, info: { type: now.type, width: now.width, height: now.height, animated: !!info.animated } };
}

module.exports = { fitEmoji, shrinkGif, imageInfo, fitSize, lzwDecode, lzwEncode, EmojiRejected, EMOJI_PX, EMOJI_STORED_MAX, MAX_PIXELS, MAX_FRAMES, MAX_SIDE };
