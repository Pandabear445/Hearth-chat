// Soundboard rules that don't need a page: what a sound file may be, and what a sound's details and a board's
// layout look like once they've been decrypted (soundboard.js). Everything that comes out of the vault is checked
// again here, so a damaged or hand-made item can't put anything odd on screen or into a call.

// The same limits as the server (server/soundboard.js LIMITS).
export const LIMITS = Object.freeze({ sounds: 24, bytes: 1024 * 1024, ms: 5000 });
// A little over 5 s is still fine (encoders pad the end); the call cuts every play at LIMITS.ms anyway.
export const MS_GRACE = 150;
export const MAX_PAGES = 8;
export const VIEWS = ['grid', 'list'];
export const SIZES = ['sm', 'md', 'lg'];
export const DEFAULT_COLOR = '#f2a541';
export const DEFAULT_VOLUME = 0.8;
// Formats every browser in use can decode, told apart by their first bytes (never by the file's name or the type
// the browser guesses from it).
export const MIMES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/flac'];

const HEX = /^#[0-9a-f]{6}$/i;
const KEY = /^[A-Za-z0-9+/]{43}=$/; // a 32-byte file key, base64 (e2ee.js encryptFile)
const ID = /^[a-z0-9]{8,32}$/;

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
// The audio format of a file from its first bytes, or '' when it isn't one we take.
export function sniffAudio(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 12) return '';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return 'audio/mpeg';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(b, 4, 4) === 'ftyp') return 'audio/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac';
  return '';
}

// Why a chosen file can't be a sound ('' when it can): its size, the type the browser says it is, and its first
// bytes. How long it is is checked once it's decoded (checkLength).
export function checkSoundFile({ size, type, head }) {
  if (!size) return 'That file is empty.';
  if (size > LIMITS.bytes) return `Sounds can be up to ${LIMITS.bytes / 1024 / 1024} MB. This one is ${(size / 1024 / 1024).toFixed(1)} MB.`;
  if (type && !/^audio\//i.test(type)) return 'That isn’t an audio file. Use an MP3, OGG, WAV, M4A, WebM or FLAC file.';
  if (!sniffAudio(head)) return 'That file isn’t a sound Hearth can play. Use an MP3, OGG, WAV, M4A, WebM or FLAC file.';
  return '';
}
export function checkLength(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'That sound is silent or couldn’t be read.';
  if (seconds * 1000 > LIMITS.ms + MS_GRACE) return `Sounds can be up to ${LIMITS.ms / 1000} seconds long. This one is ${seconds.toFixed(1)} seconds.`;
  return '';
}

const SEG = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
// At most `n` characters or emoji (a flag or 👍🏽 is one), without control characters or angle brackets.
export function glyphs(v, n) {
  const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '') : '';
  const parts = SEG ? [...SEG.segment(t)].map((x) => x.segment) : Array.from(t);
  return parts.filter((g) => g.trim()).slice(0, n).join('');
}
const text = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);

// A sound's details as decrypted: { name, emoji, color, volume, k, mime, ms }. null when it can't be used (no key).
export function cleanSoundMeta(m) {
  if (!m || typeof m !== 'object' || typeof m.k !== 'string' || !KEY.test(m.k)) return null;
  return {
    name: text(m.name, 32) || 'Sound',
    emoji: glyphs(m.emoji, 2),
    color: typeof m.color === 'string' && HEX.test(m.color) ? m.color.toLowerCase() : DEFAULT_COLOR,
    volume: num(m.volume, 0, 1, DEFAULT_VOLUME),
    k: m.k,
    mime: MIMES.includes(m.mime) ? m.mime : 'audio/mpeg',
    ms: Math.round(num(m.ms, 1, LIMITS.ms, LIMITS.ms)),
  };
}

// A board's layout: grid or list, button size, and pages, each with the ids of its sounds in order. Every sound the
// person has is on exactly one page (new ones go at the end of the first); ids of sounds that are gone are dropped.
export function cleanLayout(raw, soundIds) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const have = new Set((soundIds || []).filter((id) => ID.test(id)));
  const placed = new Set();
  let pages = (Array.isArray(l.pages) ? l.pages : []).slice(0, MAX_PAGES).map((p) => ({
    name: text(p && p.name, 24) || 'Sounds',
    ids: (Array.isArray(p && p.ids) ? p.ids : []).filter((id) => typeof id === 'string' && have.has(id) && !placed.has(id) && placed.add(id)),
  }));
  if (!pages.length) pages = [{ name: 'Sounds', ids: [] }];
  for (const id of soundIds || []) if (have.has(id) && !placed.has(id)) { placed.add(id); pages[0].ids.push(id); }
  return { view: VIEWS.includes(l.view) ? l.view : 'grid', size: SIZES.includes(l.size) ? l.size : 'md', pages };
}

// Moves one sound to `index` on page `to` (from wherever it is). Returns a new layout.
export function moveSound(layout, id, to, index) {
  const pages = layout.pages.map((p) => ({ ...p, ids: p.ids.filter((x) => x !== id) }));
  const page = pages[Math.max(0, Math.min(pages.length - 1, to))];
  const at = Math.max(0, Math.min(page.ids.length, Number.isFinite(index) ? index : page.ids.length));
  page.ids.splice(at, 0, id);
  return { ...layout, pages };
}

// What a profile shows of a board (only when its owner turns it on): name, emoji and color of the first 12 sounds,
// in board order. Never the audio or its key. Cleaned exactly as the server keeps it (profile.js soundShowcase: no
// angle brackets in a name, and one left empty is dropped), so the copy the server sends back compares equal and the
// board doesn't save the profile again on every change.
export function showcaseOf(layout, sounds) {
  const out = [];
  for (const p of layout.pages) for (const id of p.ids) {
    const s = sounds.get(id);
    if (s && out.length < 12) out.push({ name: s.name, emoji: s.emoji, color: s.color });
  }
  return out.map((x) => ({ emoji: glyphs(x.emoji, 6), name: text(x.name, 64).replace(/[<>]/g, '').trim().slice(0, 32), color: HEX.test(x.color || '') ? x.color.toLowerCase() : DEFAULT_COLOR }))
    .filter((x) => x.name);
}

export function newSoundId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-6);
}
