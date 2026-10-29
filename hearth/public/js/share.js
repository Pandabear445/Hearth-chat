// "Share to Hearth" (docs/design/SCROLL-TOGETHER.md › Getting videos in): the parts with no page around them, shared
// by the share picker (app.js), the Reels tab and the tests (node --test loads this file as it is).
//
// A TikTok or Instagram link can reach the app four ways, all ending in the same picker (pick a conversation, or My
// Reels, then it's sent as an ordinary encrypted message):
//   - the Android app's share sheet (ACTION_SEND text/plain; mobile/native/ShareLinks.java picks the link out);
//   - an installed web app's share sheet (the manifest's share_target: GET /share?url=…&text=…&title=…);
//   - the "Send to Hearth" bookmarklet (GET /share?url=<the page you're on>);
//   - a #share=<link> address.
// Whatever arrives is untrusted (another app, another site): only a link that social.js accepts is kept, and nothing
// is ever sent without the person picking where.
import { parseSocialUrl } from './social.js';

const TEXT_MAX = 4096;
// Punctuation after a link isn't part of it ("…/video/123)." in a sentence). Trimmed from the end one character at a
// time: a regular expression for it took time growing with the square of a long run of dots.
const TAIL = new Set([...')].,;:!?\'"»”']);
export function trimTail(s) {
  let end = s.length;
  while (end > 0 && TAIL.has(s[end - 1])) end--;
  return s.slice(0, end);
}
const URLISH = /https?:\/\/[^\s<>"'`]{1,2048}/gi;

// The TikTok and Instagram links in shared text, in order, each once (at most `max`). Apps share "Look at this!
// https://vm.tiktok.com/…" or a link with tracking after it; a trailing ")" or "." isn't part of the link.
export function socialLinksIn(text, max = 50) {
  const out = []; const seen = new Set();
  const s = typeof text === 'string' ? text.slice(0, TEXT_MAX * 64) : '';
  for (const m of s.matchAll(URLISH)) {
    const raw = trimTail(m[0]);
    const p = parseSocialUrl(raw);
    if (!p) continue;
    const key = `${p.kind}:${p.id || p.short}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, url: p.link }); // (sent as social.js's own form of the link, never the text it came in)
    if (out.length >= max) break;
  }
  return out;
}

// The link something shared to Hearth carries: from url, then text, then title (share sheets put it in any of them).
export function sharedLink({ url, text, title } = {}) {
  for (const v of [url, text, title]) {
    if (typeof v !== 'string' || !v || v.length > TEXT_MAX) continue;
    const found = socialLinksIn(v, 1)[0];
    if (found) return found;
  }
  return null;
}

// From this page's address: /share?url=… (a web share target or the bookmarklet) or #share=… (the Android app).
export function shareFromLocation(loc) {
  try {
    if (loc.pathname === '/share') {
      const q = new URLSearchParams(loc.search);
      return { found: true, link: sharedLink({ url: q.get('url'), text: q.get('text'), title: q.get('title') }) };
    }
    const m = /^#share=(.{1,4096})$/.exec(loc.hash || '');
    if (m) return { found: true, link: sharedLink({ url: decodeURIComponent(m[1]) }) };
  } catch { return { found: true, link: null }; }
  return { found: false, link: null };
}
export const shareHash = (link) => `#share=${encodeURIComponent(link)}`;

// The bookmarklet: opens this server's /share with the address of the page you're on. It reads location.href and
// nothing else, adds nothing to the page, and sends nothing anywhere but a new Hearth tab.
export function bookmarklet(origin) {
  const o = String(origin || '');
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o)) throw new Error('not an origin');
  return `javascript:void(window.open(${JSON.stringify(`${o}/share?url=`)}+encodeURIComponent(location.href),'_blank','noopener'))`;
}

// The picker's list: conversations you used recently first (recent: keys, most recent first), then the rest in the
// order given; a search keeps those whose name or place contains every word typed.
//   list: [{ key, name, where }]
export function rankConversations(list, recent = [], query = '') {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (c) => words.every((w) => `${c.name} ${c.where || ''}`.toLowerCase().includes(w));
  const order = new Map(recent.map((k, i) => [k, i]));
  return list.filter(hit).map((c, i) => ({ c, i, r: order.has(c.key) ? order.get(c.key) : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}
// Recent conversations, newest first, kept to `max`.
export const pushRecent = (recent, key, max = 12) => [key, ...(Array.isArray(recent) ? recent : []).filter((k) => k !== key)].slice(0, max);

// Links sent in one message: the feed shows at most 4 from a message, so more go in several.
export function batches(links, size = 4) {
  const out = [];
  for (let i = 0; i < links.length; i += size) out.push(links.slice(i, i + size));
  return out;
}
