// TikTok and Instagram videos played in place (docs/design/SOCIAL-EMBEDS.md): the parts with no page around them,
// shared by the message list, watch together (watch.js) and the tests (node --test loads this file as it is).
//
// The rules are the server's (server/social.js; a test checks the two agree). A player's address is only ever
// built from an id that matched a strict pattern here, never from the link, so no link can put an address of its
// own choosing in a frame. Players load from www.tiktok.com or www.instagram.com only (the page's CSP frame-src
// allows exactly those two), sandboxed, with no referrer, and only once the reader taps (or chose "Always").
//
// What each one allows (2026):
//   TikTok     the embed player, www.tiktok.com/player/v1/<id>, with a postMessage API: play, pause, seekTo,
//              mute and unMute in; onPlayerReady, onStateChange (-1 not started, 0 ended, 1 playing, 2 paused,
//              3 buffering), onCurrentTime ({ currentTime, duration }), onMute and onError out. Messages are
//              objects marked 'x-tiktok-player': true. No playback rate.
//   Instagram  www.instagram.com/reel/<code>/embed/ (or /p/<code>/embed/): a page that plays the video, with no
//              player API at all: nothing can play, pause, seek or even ask the time from outside. Its oEmbed
//              needs a Meta app token, so there's no title or picture from Instagram either.
import { linkedUrls } from './markdown.js';

export const TIKTOK_ID = /^\d{15,21}$/;
export const TIKTOK_SHORT = /^[A-Za-z0-9]{5,20}$/;
export const IG_CODE = /^[A-Za-z0-9_-]{5,48}$/;
const TIKTOK_USER = /^[A-Za-z0-9._]{1,32}$/;
const IG_USER = /^[A-Za-z0-9._]{1,30}$/;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const URL_MAX = 2048;
export const TIKTOK_ORIGIN = 'https://www.tiktok.com';
export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
export const FRAME_ORIGINS = [TIKTOK_ORIGIN, INSTAGRAM_ORIGIN];
// Scripts and their own storage (both players need them), fullscreen and "open on TikTok/Instagram" popups
// (which open in the browser), but never navigating the Hearth tab, forms, downloads or modals.
export const SOCIAL_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';
export const SOCIAL_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

// { kind: 'tiktok', id, link } | { kind: 'tiktok', short, link } | { kind: 'instagram', id, type, link } | null
export function parseSocialUrl(input, { anyPort = false } = {}) {
  let u = input;
  if (typeof u === 'string') {
    if (!u || u.length > URL_MAX) return null;
    try { u = new URL(u); } catch { return null; }
  }
  if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port !== '' && !anyPort) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const at = (name) => (anyPort && u.port ? `${host}:${u.port}` : name); // (tests: a stand-in's port stays)
  if (TIKTOK_SHORT_HOSTS.has(host)) {
    return parts.length === 1 && TIKTOK_SHORT.test(parts[0]) ? { kind: 'tiktok', short: parts[0], link: `https://${at(host)}/${parts[0]}/` } : null;
  }
  if (TIKTOK_HOSTS.has(host)) {
    if (parts[0] === 't' && parts.length === 2 && TIKTOK_SHORT.test(parts[1])) return { kind: 'tiktok', short: parts[1], link: `https://${at('www.tiktok.com')}/t/${parts[1]}/` };
    let id = null; let user = null;
    if (parts.length >= 3 && parts[0].startsWith('@') && parts[1] === 'video') { id = parts[2]; user = parts[0].slice(1); }
    else if (parts[0] === 'embed' && parts[1] === 'v2' && parts.length === 3) id = parts[2];
    else if (parts[0] === 'embed' && parts.length === 2) id = parts[1];
    else if (parts[0] === 'player' && parts[1] === 'v1' && parts.length === 3) id = parts[2];
    else if (parts[0] === 'v' && parts.length === 2) id = parts[1].replace(/\.html$/, '');
    if (!id || !TIKTOK_ID.test(id)) return null;
    const link = user && TIKTOK_USER.test(user) ? `https://www.tiktok.com/@${user}/video/${id}` : `https://www.tiktok.com/embed/v2/${id}`;
    return { kind: 'tiktok', id, link };
  }
  if (IG_HOSTS.has(host)) {
    const i = ['reel', 'reels', 'p', 'tv'].includes(parts[0]) ? 0 : parts.length >= 3 && IG_USER.test(parts[0]) && ['reel', 'p'].includes(parts[1]) ? 1 : -1;
    if (i < 0) return null;
    const code = parts[i + 1];
    if (!code || !IG_CODE.test(code) || parts.length > i + 3 || (parts.length === i + 3 && parts[i + 2] !== 'embed')) return null;
    const type = parts[i] === 'p' ? 'p' : 'reel';
    return { kind: 'instagram', id: code, type, link: `https://www.instagram.com/${type}/${code}/` };
  }
  return null;
}

// The player's address, from a checked id only (throws otherwise). TikTok: its own controls, no "more videos"
// panel, no music or description overlay, no right-click menu; autoplay only after a tap (or in watch together).
export function playerSrc(item, { autoplay = false } = {}) {
  if (item && item.kind === 'tiktok' && typeof item.id === 'string' && TIKTOK_ID.test(item.id)) {
    const q = new URLSearchParams({ controls: '1', progress_bar: '1', play_button: '1', volume_control: '1', fullscreen_button: '1', timestamp: '1', loop: '0', autoplay: autoplay ? '1' : '0', music_info: '0', description: '0', rel: '0', native_context_menu: '0', closed_caption: '1' });
    return `${TIKTOK_ORIGIN}/player/v1/${item.id}?${q}`;
  }
  if (item && item.kind === 'instagram' && typeof item.id === 'string' && IG_CODE.test(item.id) && (item.type === 'reel' || item.type === 'p')) return `${INSTAGRAM_ORIGIN}/${item.type}/${item.id}/embed/`;
  throw new Error('not a TikTok or Instagram video');
}

// The TikTok and Instagram videos linked in a message (outside code and spoilers), one each, at most 4.
export function socialLinks(text) {
  let urls;
  try { urls = linkedUrls(text, { skipSpoilers: true }); } catch { return []; }
  const out = []; const seen = new Set();
  for (const url of urls) {
    const p = parseSocialUrl(url);
    if (!p) continue;
    const key = `${p.kind}:${p.id || p.short}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ ...p, url });
    if (out.length >= 4) break;
  }
  return out;
}

// TikTok's player messages: a command to send, and what an incoming message says (null when it isn't one).
export const tiktokCommand = (type, value) => ({ type, value, 'x-tiktok-player': true });
export function readTiktokMessage(data) {
  let d = data;
  if (typeof d === 'string') { if (d.length > 4096) return null; try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object' || d['x-tiktok-player'] !== true || typeof d.type !== 'string') return null;
  return { type: d.type, value: d.value };
}

// "ask" (default): a placeholder until tapped; "always": players load as messages show (short links still wait
// for a tap, since opening one asks this server); "off": just the link.
export const PLAYER_MODES = ['ask', 'always', 'off'];
export const playerMode = (chat) => (PLAYER_MODES.includes(chat && chat.socialPlayers) ? chat.socialPlayers : 'ask');
export const KIND_NAME = { tiktok: 'TikTok', instagram: 'Instagram' };
export const itemLabel = (p) => (p.kind === 'tiktok' ? 'TikTok video' : p.type === 'p' ? 'Instagram post' : 'Instagram reel');
