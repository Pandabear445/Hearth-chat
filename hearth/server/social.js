// TikTok and Instagram links (docs/design/SOCIAL-EMBEDS.md): which links name one video, and the id in them.
//
// The ids are the only part of a link that ever reaches a player: the player's address is built here (and in the
// app, public/js/social.js, which follows the same rules; test/social-embeds.test.js checks the two agree) from
// an id that matched a strict pattern, never from the link itself. So no link someone sends can put an address of
// its own choosing in a frame.
//
//   TikTok     www.tiktok.com/@name/video/<id>, /embed/v2/<id>, /embed/<id>, /player/v1/<id>, /v/<id>.html
//              ids: 15 to 21 digits (TikTok's are 19 today)
//              short links: vm.tiktok.com/<code>, vt.tiktok.com/<code>, www.tiktok.com/t/<code>. They only say
//              where they go when asked, so this server asks (resolveTikTokShort, with netguard), on request.
//   Instagram  www.instagram.com/reel/<code>, /reels/<code>, /p/<code>, /tv/<code>, and /<name>/reel/<code>,
//              /<name>/p/<code>. codes: 5 to 48 letters, digits, "_" and "-".
const TIKTOK_ID = /^\d{15,21}$/;
const TIKTOK_SHORT = /^[A-Za-z0-9]{5,20}$/;
const TIKTOK_USER = /^[A-Za-z0-9._]{1,32}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,48}$/;
const IG_USER = /^[A-Za-z0-9._]{1,30}$/;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const URL_MAX = 2048;

// { kind: 'tiktok', id, link } | { kind: 'tiktok', short: code, link } | { kind: 'instagram', id, type: 'reel'|'p', link }
// or null. `u`: a URL or a string. anyPort: tests only (stand-in sites on other ports).
function parseSocial(input, { anyPort = false } = {}) {
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

// The player's address, from a checked id only. Throws on anything else.
function playerSrc(kind, id, type = 'reel') {
  if (kind === 'tiktok' && typeof id === 'string' && TIKTOK_ID.test(id)) return `https://www.tiktok.com/player/v1/${id}`;
  if (kind === 'instagram' && typeof id === 'string' && IG_CODE.test(id) && (type === 'reel' || type === 'p')) return `https://www.instagram.com/${type}/${id}/embed/`;
  throw new Error('not a TikTok or Instagram video');
}

// The frames the app may show for these (index.js CSP frame-src): exactly these two origins.
const FRAME_ORIGINS = ['https://www.tiktok.com', 'https://www.instagram.com'];

module.exports = { parseSocial, playerSrc, FRAME_ORIGINS, TIKTOK_ID, TIKTOK_SHORT, IG_CODE, TIKTOK_HOSTS, TIKTOK_SHORT_HOSTS, IG_HOSTS };
