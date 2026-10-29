// Profile customization: validation + defaults. Every option here is free.
const HEX = /^#[0-9a-fA-F]{6}$/;

const FONTS = ['default', 'Pacifico', 'Orbitron', 'Press Start 2P', 'Caveat', 'Righteous',
  'Bungee', 'Space Mono', 'Playfair Display', 'Creepster', 'Comfortaa', 'Monoton'];
const RINGS = ['none', 'solid', 'gradient', 'rainbow', 'glow', 'pulse', 'spin', 'double', 'dashed'];
const CARD_STYLES = ['solid', 'gradient', 'glass'];
const EFFECTS = ['none', 'sparkles', 'snow', 'hearts', 'stars', 'bubbles', 'embers', 'sakura', 'confetti', 'rain', 'fireflies', 'custom'];
// Build-your-own effect: any characters or emoji, moving the way you pick.
const FX_MOTIONS = ['fall', 'rise', 'float', 'drift', 'twinkle', 'spin', 'zoom', 'bounce'];
const SHAPES = ['circle', 'rounded', 'square', 'hexagon'];
const NAME_EFFECTS = ['none', 'glow', 'shimmer', 'rainbow', 'flow', 'pulse', 'wave', 'neon', 'glitch', 'outline', 'shadow'];
// v25 extras. A banner without a picture: one color, a gradient, or a moving one (bannerColor + bannerColor2).
const BANNER_FX = ['none', 'gradient', 'flow', 'aurora', 'stripes'];
// Something worn on the avatar on the profile card and in calls (drawn by the app: CSS and emoji, no pictures).
const DECORATIONS = ['none', 'cat-ears', 'halo', 'crown', 'horns', 'flowers', 'stars', 'headphones', 'hearts', 'flames', 'leaves', 'sparkle-frame'];
// How big the words on the card are.
const TEXT_SIZES = ['sm', 'md', 'lg', 'xl'];
// The card's sections that can be moved or hidden, in their default order.
const SECTIONS = ['activity', 'bio', 'favorites', 'links', 'song', 'soundboard', 'interests', 'games', 'recent', 'about', 'friends', 'since'];
// Where a profile's song link may go: music services only (it's shown as a card with the service's name).
const SONG_HOSTS = ['open.spotify.com', 'music.apple.com', 'youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be', 'soundcloud.com',
  'on.soundcloud.com', 'bandcamp.com', 'tidal.com', 'listen.tidal.com', 'www.deezer.com', 'deezer.com', 'music.amazon.com'];

const DEFAULTS = {
  displayName: '',
  pronouns: '',
  bio: '',
  customStatus: { emoji: '', text: '' },
  bannerColor: '#f2a541',
  themePrimary: '#2a2438',
  themeSecondary: '#1b1824',
  accentColor: '#f2a541',
  nameColor: '#ffffff',
  nameColor2: '',
  nameColor3: '',
  nameColor4: '',
  nameGlow: '',
  ringColor2: '',
  ringColor3: '',
  ringSpeed: 4,
  customFx: { glyphs: '✦★', motion: 'fall', count: 16, speed: 5, size: 16, color: '', glow: false },
  mood: { emoji: '', text: '' },
  headline: '',
  nameFont: 'default',
  nameEffect: 'none',
  avatarRing: 'none',
  ringColor: '#f2a541',
  avatarShape: 'circle',
  cardStyle: 'gradient',
  showBanner: true,
  profileEffect: 'none',
  links: [],
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

const num = (v, min, max, d) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : d);
// Up to 6 characters/emoji ("graphemes"), so flags and skin-tone emoji count as one.
// One segmenter for the whole process: making one is slow, and this runs for every profile sent out (each person
// in a big server's member list), not only when one is saved.
const SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
const graphemes = (v) => {
  const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '') : '';
  const seg = SEGMENTER ? [...SEGMENTER.segment(t)].map((x) => x.segment) : Array.from(t);
  return seg.filter((g) => g.trim()).slice(0, 6).join('');
};
// No control characters or angle brackets in short texts shown on the card (they're always set as text, never HTML:
// this keeps them one tidy line).
const line = (v, max) => str(v, max * 2).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
function songLink(v) {
  const url = str(v && v.url, 300).trim();
  if (!url) return { url: '', label: '' };
  let u;
  try { u = new URL(url); } catch { return { url: '', label: '' }; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !(SONG_HOSTS.includes(host) || host.endsWith('.bandcamp.com'))) return { url: '', label: '' };
  return { url: u.href.slice(0, 300), label: line(v.label, 80) };
}
function sectionOrder(v) {
  const list = (Array.isArray(v) ? v : []).filter((k, i, a) => SECTIONS.includes(k) && a.indexOf(k) === i);
  return [...list, ...SECTIONS.filter((k) => !list.includes(k))];
}
const crop = (c) => ({ x: num(c && c.x, -200, 200, 0), y: num(c && c.y, -200, 200, 0), z: num(c && c.z, 1, 5, 1) });

function sanitizeProfile(input, current = {}) {
  const merged = { ...DEFAULTS, ...current, ...(input || {}) };
  const links = Array.isArray(merged.links) ? merged.links : [];
  return {
    displayName: str(merged.displayName, 32).trim(),
    pronouns: str(merged.pronouns, 40),
    bio: str(merged.bio, 1200),
    customStatus: {
      emoji: str(merged.customStatus && merged.customStatus.emoji, 16),
      text: str(merged.customStatus && merged.customStatus.text, 128),
    },
    bannerColor: hex(merged.bannerColor, DEFAULTS.bannerColor),
    themePrimary: hex(merged.themePrimary, DEFAULTS.themePrimary),
    themeSecondary: hex(merged.themeSecondary, DEFAULTS.themeSecondary),
    accentColor: hex(merged.accentColor, DEFAULTS.accentColor),
    nameColor: hex(merged.nameColor, DEFAULTS.nameColor),
    nameColor2: merged.nameColor2 ? hex(merged.nameColor2, '') : '',
    nameColor3: merged.nameColor2 && merged.nameColor3 ? hex(merged.nameColor3, '') : '',
    nameColor4: merged.nameColor2 && merged.nameColor3 && merged.nameColor4 ? hex(merged.nameColor4, '') : '',
    nameGlow: merged.nameGlow ? hex(merged.nameGlow, '') : '',
    ringColor2: merged.ringColor2 ? hex(merged.ringColor2, '') : '',
    ringColor3: merged.ringColor3 ? hex(merged.ringColor3, '') : '',
    ringSpeed: num(merged.ringSpeed, 1, 10, 4),
    customFx: (() => {
      const f = merged.customFx && typeof merged.customFx === 'object' ? merged.customFx : {};
      return {
        glyphs: graphemes(f.glyphs) || DEFAULTS.customFx.glyphs,
        motion: pick(f.motion, FX_MOTIONS, 'fall'),
        count: Math.round(num(f.count, 4, 40, 16)),
        speed: num(f.speed, 1, 10, 5),
        size: Math.round(num(f.size, 8, 48, 16)),
        color: f.color ? hex(f.color, '') : '',
        glow: !!f.glow,
      };
    })(),
    mood: { emoji: str(merged.mood && merged.mood.emoji, 16), text: str(merged.mood && merged.mood.text, 40) },
    headline: str(merged.headline, 80),
    nameFont: pick(merged.nameFont, FONTS, 'default'),
    nameEffect: pick(merged.nameEffect, NAME_EFFECTS, 'none'),
    avatarRing: pick(merged.avatarRing, RINGS, 'none'),
    ringColor: hex(merged.ringColor, DEFAULTS.ringColor),
    avatarShape: pick(merged.avatarShape, SHAPES, 'circle'),
    cardStyle: pick(merged.cardStyle, CARD_STYLES, 'gradient'),
    showBanner: merged.showBanner !== false,
    profileEffect: pick(merged.profileEffect, EFFECTS, 'none'),
    // Where each picture sits inside its frame: offset (% of the frame) and zoom. Non-destructive,
    // so animated GIFs keep animating and people can re-adjust any time.
    avatarCrop: crop(merged.avatarCrop),
    bannerCrop: crop(merged.bannerCrop),
    backgroundCrop: crop(merged.backgroundCrop),
    // MySpace-style extras: about me (Markdown), interests, top friends and the profile song's title.
    aboutMe: String(merged.aboutMe || '').slice(0, 2000),
    interests: (Array.isArray(merged.interests) ? merged.interests : []).map((x) => String(x).trim().slice(0, 24)).filter(Boolean).slice(0, 12),
    topFriends: (Array.isArray(merged.topFriends) ? merged.topFriends : []).map(String).filter((x) => /^[a-z0-9]{6,40}$/.test(x)).slice(0, 8),
    songTitle: String(merged.songTitle || '').slice(0, 80),
    // Favorite games (pictures come from /media/game/<id>).
    games: (Array.isArray(merged.games) ? merged.games : [])
      .map((g) => ({ id: str(g && g.id, 24), name: str(g && g.name, 80).trim() }))
      .filter((g) => /^(steam:\d{1,10}|wiki:\d{1,12}|rawg:\d{1,10})$/.test(g.id) && g.name)
      .filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i).slice(0, 12),
    // v25: banner style, avatar decoration, card text size, the sections' order (and which are hidden), favorite
    // things, a song link, and (only if they turn it on) some of their soundboard.
    bannerFx: pick(merged.bannerFx, BANNER_FX, 'none'),
    bannerColor2: hex(merged.bannerColor2, '#7c4dff'),
    avatarDecoration: pick(merged.avatarDecoration, DECORATIONS, 'none'),
    textSize: pick(merged.textSize, TEXT_SIZES, 'md'),
    sectionOrder: sectionOrder(merged.sectionOrder),
    hiddenSections: (Array.isArray(merged.hiddenSections) ? merged.hiddenSections : []).filter((k, i, a) => SECTIONS.includes(k) && a.indexOf(k) === i),
    favorites: (Array.isArray(merged.favorites) ? merged.favorites : []).slice(0, 6)
      .map((f) => ({ emoji: graphemes(f && f.emoji), label: line(f && f.label, 24), value: line(f && f.value, 60) }))
      .filter((f) => f.label && f.value),
    songLink: songLink(merged.songLink),
    showSoundboard: merged.showSoundboard === true,
    // Kept only while it's on, so an old draft saved from another device can't bring back names taken off.
    soundShowcase: (merged.showSoundboard === true && Array.isArray(merged.soundShowcase) ? merged.soundShowcase : []).slice(0, 12)
      .map((x) => ({ emoji: graphemes(x && x.emoji), name: line(x && x.name, 32), color: hex(x && x.color, '#f2a541') }))
      .filter((x) => x.name),
    links: links.slice(0, 6)
      .map((l) => ({ label: str(l && l.label, 32), url: str(l && l.url, 300) }))
      .filter((l) => /^https?:\/\/[^\s]+$/i.test(l.url)),
  };
}

function parseProfile(row) {
  try { return sanitizeProfile(JSON.parse(row.profile || '{}')); } catch { return sanitizeProfile({}); }
}

module.exports = { sanitizeProfile, parseProfile, FONTS, DEFAULTS, graphemes, BANNER_FX, DECORATIONS, TEXT_SIZES, SECTIONS, SONG_HOSTS };
