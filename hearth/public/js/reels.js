// The Reels tab (docs/design/SCROLL-TOGETHER.md): the parts with no page around them, shared by reels-ui.js and the
// tests (node --test loads this file as it is).
//
// A conversation's feed is every TikTok video and Instagram reel or post linked in its messages (social.js decides
// which links count), newest first, each video once (where it was first shared counts as its newest share being the
// one shown: the newest message that links it). It's made on this device from the decrypted messages: the server
// can't read them, and never learns which links they hold. TikTok's and Instagram's own feeds (For You, Reels)
// can't be shown at all: there's no way to embed them, and their terms forbid copying them.
import { socialLinks } from './social.js';

export const MID = /^[A-Za-z0-9_-]{1,64}$/;
export const WINDOW = 1; // players kept alive on each side of the one on screen (the rest are let go)
export const COUNTDOWN_MS = 3000;

// The feed from a conversation's messages (any order). Each item: { mid, i, p, m, key } where i is the link's place
// among the message's TikTok/Instagram links (0 to 3) and p is social.js's parse of it.
//   ok(m): whether the message counts at all (readable, not gone, not from someone blocked, not hidden by the filter)
//   text(m): its decrypted text
export function feedItems(messages, { ok = () => true, text = (m) => (m && m.dec && m.dec.t) || '' } = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.id === 'string' && MID.test(m.id) && !m.threadId && ok(m));
  list.sort(newestFirst);
  const seen = new Map(); // video -> its item
  const out = [];
  for (const m of list) {
    socialLinks(text(m)).forEach((p, i) => {
      const vid = `${p.kind}:${p.id || p.short}`;
      // An older share of the same video: the item answers to it too (also), so a session on it still finds it.
      if (seen.has(vid)) { seen.get(vid).also.push(itemKey(m.id, i)); return; }
      const it = { mid: m.id, i, p, m, key: itemKey(m.id, i), vid, also: [] };
      seen.set(vid, it);
      out.push(it);
    });
  }
  return out;
}
export const itemKey = (mid, i) => `${mid}:${i}`;
export function newestFirst(a, b) {
  const t = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  if (t) return t;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Where an item is in the feed (-1 if it isn't there yet).
// (Shared again later, a video is shown at its newest share: an older share's id still finds it.)
export const indexOf = (items, mid, i = 0) => { const k = itemKey(mid, i); return items.findIndex((x) => x.key === k || x.also.includes(k)); };
// Whether the item is the one the session names.
export const isItem = (it, mid, i = 0) => !!it && indexOf([it], mid, i) === 0;
// The next place when moving by dir (+1 down to older, -1 up to newer), kept inside the feed.
export const step = (index, dir, length) => Math.max(0, Math.min(length - 1, index + (dir < 0 ? -1 : 1)));
// Which items get a live player: the one on screen and WINDOW on each side.
export function liveRange(index, length, r = WINDOW) {
  if (!length || index < 0) return [];
  const out = [];
  for (let k = Math.max(0, index - r); k <= Math.min(length - 1, index + r); k++) out.push(k);
  return out;
}

// What the tab may load:
//   mode 'off' (Just show the link): link cards, never a player;
//   'always': players straight away;
//   'ask' (Load when I tap): players once this person tapped the tab once ("consented"), for as long as the app is
//   open; until then, a cover saying what tapping does.
export const playersAllowed = (mode, consented) => mode === 'always' || (mode === 'ask' && !!consented);

// The shared session as the server sent it, checked (the server is trusted for who may do what, not for shapes).
export function cleanSession(s) {
  if (!s || typeof s !== 'object' || typeof s.mid !== 'string' || !MID.test(s.mid)) return null;
  const num = (x) => (Number.isFinite(+x) ? +x : 0);
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && MID.test(x)) : []);
  return {
    by: typeof s.by === 'string' ? s.by : '', hostOnly: !!s.hostOnly, mid: s.mid, i: Number.isInteger(s.i) && s.i >= 0 && s.i <= 3 ? s.i : 0,
    playing: !!s.playing, position: Math.max(0, num(s.position)), updatedAt: num(s.updatedAt), startAt: num(s.startAt),
    seq: num(s.seq), lastBy: typeof s.lastBy === 'string' ? s.lastBy : '', lastAction: typeof s.lastAction === 'string' ? s.lastAction : '', dir: s.dir === -1 ? -1 : 1,
    brainrot: s.brainrot === true, // Brainrot mode on for everyone (brainrot.js): a yes or no only
    following: ids(s.following), ready: ids(s.ready),
  };
}

// "Scrolling with alice, bob and 2 others" (you left out).
export function withLine(names) {
  const n = names.filter(Boolean);
  if (!n.length) return 'Scrolling together';
  if (n.length <= 2) return `Scrolling with ${n.join(' and ')}`;
  return `Scrolling with ${n.slice(0, 2).join(', ')} and ${n.length - 2} other${n.length - 2 === 1 ? '' : 's'}`;
}
// The note when someone else moves everyone.
export const swipedText = (name, dir) => `${name} swiped ${dir === -1 ? 'back ↑' : 'to the next ↓'}`;

// The shared position now, on this device's clock (offset: the server's clock minus ours). During a countdown it stays put.
export function sharedPosition(s, offset) {
  if (!s) return 0;
  const now = Date.now() + offset;
  return s.position + (s.playing ? Math.max(0, now - s.updatedAt) / 1000 : 0);
}
