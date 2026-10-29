// Importing the videos you liked or saved on TikTok and Instagram from their "Download your data" files
// (docs/design/SCROLL-TOGETHER.md › Importing). Everything happens on this device: the file is never uploaded.
//
// What it reads (as the sites shape them in 2026; nothing depends on the shape being exactly that):
//   TikTok     user_data_tiktok.json (JSON export): Activity → "Like List" → ItemFavoriteList[] { date, link } and
//              "Favorite Videos" → FavoriteVideoList[] { Date, Link }; the TXT export's "Like List.txt" and
//              "Favorite Videos.txt" ("Date: …" / "Link: …" lines). Links there are www.tiktokv.com/share/video/<id>/.
//   Instagram  your_instagram_activity/likes/liked_posts.json { likes_media_likes: [{ string_list_data: [{ href }] }] }
//              and saved/saved_posts.json { saved_saved_media: [{ string_map_data: { "Saved on": { href } } }] },
//              or the same as HTML pages.
//   Either as the .zip the site gives you, or the files inside it.
//
// The file is untrusted: its structure isn't relied on. JSON is parsed with JSON.parse (never run), then every
// string in it is looked at, iteratively, with caps on size, depth and how many things are looked at; text and HTML
// are only searched for links. Only links social.js accepts come out, in social.js's own form.
import { parseSocialUrl } from './social.js';

export const FILE_MAX = 200 * 1024 * 1024; // a whole export (.zip) at most
export const TEXT_MAX = 64 * 1024 * 1024; // one file inside it, unpacked, at most
export const ENTRIES_MAX = 5000; // files inside a .zip looked at
export const NODES_MAX = 3000000; // JSON values looked at, all files together
export const DEPTH_MAX = 64;
export const ITEMS_MAX = 10000;
const READABLE = /\.(json|txt|html?)$/i;
const URLISH = /https?:\/\/[^\s<>"'`\\]{1,2048}/gi;

// One link from an export, in the form social.js reads, or null. TikTok's exports use tiktokv.com/share/video/<id>.
export function exportLink(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const s = raw.trim().replace(/[)\].,;:!?'"»”]+$/, '');
  const tv = /^https?:\/\/(?:www\.)?(?:tiktokv|tiktok)\.com\/share\/video\/(\d{15,21})\/?(?:[?#].*)?$/i.exec(s);
  const p = parseSocialUrl(tv ? `https://m.tiktok.com/v/${tv[1]}.html` : s);
  // Short links can't be told apart (or checked) without asking TikTok, so imports keep full links only.
  return p && p.id ? p : null;
}

// Links in a piece of text, in order.
function linksInText(text, add) {
  for (const m of String(text).matchAll(URLISH)) if (!add(exportLink(m[0]))) return false;
  return true;
}

// Every string in a parsed JSON value, without recursion (a deeply nested file can't overflow the stack).
function linksInJson(value, add, budget) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (--budget.nodes < 0) return false;
    if (typeof v === 'string') { if (v.includes('http') && !linksInText(v, add)) return false; continue; }
    if (!v || typeof v !== 'object' || depth >= DEPTH_MAX) continue;
    const kids = Array.isArray(v) ? v : Object.values(v);
    // (Reversed onto the stack, so the file's own order is kept: TikTok lists newest first.)
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
  }
  return true;
}

// The ZIP's files that could hold links: [{ name, bytes() }] (bytes unpacks it, at most TEXT_MAX). Zip64, encrypted
// and other compression methods are skipped.
export function zipEntries(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That .zip file looks damaged.');
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count && n < ENTRIES_MAX; n++) {
    if (at + 46 > b.length || dv.getUint32(at, true) !== 0x02014b50) break;
    const flags = dv.getUint16(at + 8, true); const method = dv.getUint16(at + 10, true);
    const csize = dv.getUint32(at + 20, true); const usize = dv.getUint32(at + 24, true);
    const nlen = dv.getUint16(at + 28, true); const xlen = dv.getUint16(at + 30, true); const clen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nlen));
    at += 46 + nlen + xlen + clen;
    if (!READABLE.test(name) || flags & 1 || (method !== 0 && method !== 8) || usize > TEXT_MAX || csize === 0xffffffff || local + 30 > b.length) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + csize > b.length) continue;
    const data = b.subarray(start, start + csize);
    out.push({ name, bytes: () => (method === 0 ? Promise.resolve(data.slice(0, TEXT_MAX)) : inflate(data)) });
  }
  return out;
}
// Unpacks raw deflate data, stopping at TEXT_MAX (a small file can't unpack into gigabytes).
async function inflate(data) {
  const ds = new DecompressionStream('deflate-raw');
  const reader = new Blob([data]).stream().pipeThrough(ds).getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > TEXT_MAX) { await reader.cancel().catch(() => {}); throw new Error('A file in that export is too big.'); }
    parts.push(value);
  }
  const out = new Uint8Array(size); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// What a set of files holds: { items: [{ kind, id, type, link }], tiktok, instagram, duplicates, files, skipped, capped }.
//   files: [{ name, bytes: Uint8Array | ArrayBuffer }]  (a .zip among them is opened)
export async function readExport(files) {
  const seen = new Set(); const items = [];
  let duplicates = 0; let read = 0; let capped = false;
  const skipped = [];
  const budget = { nodes: NODES_MAX };
  const add = (p) => {
    if (!p) return true;
    const k = `${p.kind}:${p.id}`;
    if (seen.has(k)) { duplicates++; return true; }
    if (items.length >= ITEMS_MAX) { capped = true; return false; }
    seen.add(k); items.push({ kind: p.kind, id: p.id, type: p.type, link: p.link });
    return true;
  };
  const readOne = async (name, bytes) => {
    if (bytes.byteLength > TEXT_MAX) { skipped.push(name); return true; }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    read++;
    if (/\.json$/i.test(name) || /^\s*[[{]/.test(text)) {
      let v;
      try { v = JSON.parse(text); } catch { return linksInText(text, add); }
      if (!linksInJson(v, add, budget)) { if (budget.nodes < 0) capped = true; return false; }
      return true;
    }
    return linksInText(text, add);
  };
  let total = 0;
  for (const f of Array.isArray(files) ? files : []) {
    const name = String((f && f.name) || '').slice(0, 300);
    const raw = f && f.bytes;
    const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes) continue;
    total += bytes.byteLength;
    if (total > FILE_MAX) throw new Error('That’s too much to read at once (200 MB at most).');
    const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (zip) {
      for (const e of zipEntries(bytes)) {
        let data;
        try { data = await e.bytes(); } catch { skipped.push(e.name); continue; }
        if (!(await readOne(e.name, data))) break;
      }
    } else if (READABLE.test(name) || !/\.[a-z0-9]{1,5}$/i.test(name)) {
      if (!(await readOne(name, bytes))) break;
    } else skipped.push(name);
    if (capped) break;
  }
  return {
    items, duplicates, files: read, skipped, capped,
    tiktok: items.filter((x) => x.kind === 'tiktok').length, instagram: items.filter((x) => x.kind === 'instagram').length,
  };
}
