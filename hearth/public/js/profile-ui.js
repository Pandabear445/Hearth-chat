// Rendering for avatars, styled names and full profile cards.
import { h, hashColor, initials, fmtDay } from './util.js';
import { render as md, renderDoc } from './markdown.js';
import { activityCards, favoriteGamesEl, recentGamesEl } from './activity.js';

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', invisible: 'Invisible', offline: 'Offline' };

export const FONT_STACKS = {
  default: 'inherit',
  Pacifico: "'Pacifico', cursive",
  Orbitron: "'Orbitron', sans-serif",
  'Press Start 2P': "'Press Start 2P', monospace",
  Caveat: "'Caveat', cursive",
  Righteous: "'Righteous', sans-serif",
  Bungee: "'Bungee', sans-serif",
  'Space Mono': "'Space Mono', monospace",
  'Playfair Display': "'Playfair Display', serif",
  Creepster: "'Creepster', cursive",
  Comfortaa: "'Comfortaa', sans-serif",
  Monoton: "'Monoton', cursive",
};

export function displayName(u) {
  if (!u) return 'Unknown';
  return (u.profile && u.profile.displayName) || u.username;
}
// Someone's nickname in one server (server/nicknames.js), or ''. Group chats have none, and without a server (DMs,
// friends, profiles) there's never one.
export function nicknameIn(server, userId) {
  if (!server || server.kind === 'group' || !userId) return '';
  return (server.nicknames || {})[userId] || '';
}
// The name someone goes by in this server: their nickname there, else their display name. Pass the server only
// where the name is shown inside it (its member list, messages, calls); everywhere else use displayName.
export function displayNameIn(server, u) {
  return (u && nicknameIn(server, u.id)) || displayName(u);
}

export function presenceOf(u, meId) {
  if (!u) return 'offline';
  // Your own dot shows the status you picked, or Away while the server shows you as away for being inactive.
  if (u.id === meId && u.status) return u.status === 'online' && u.autoAway ? 'idle' : u.status;
  return u.presence || 'offline';
}

// <span data-user-av="id"> wrappers get swapped when the user updates.
// Non-destructive crop: offset in % of the frame + zoom, applied with a CSS transform (GIFs keep animating).
export function cropStyle(c) {
  if (!c || (!c.x && !c.y && (!c.z || c.z === 1))) return {};
  return { '--tx': (c.x || 0) + '%', '--ty': (c.y || 0) + '%', '--z': String(c.z || 1) };
}

// Avatar decorations (profile.js DECORATIONS) that are emoji; the rest are drawn by the stylesheet alone.
export const DECORATION_GLYPHS = { crown: '\uD83D\uDC51', flowers: '\uD83C\uDF38\uD83C\uDF3C\uD83C\uDF38', stars: '\u2726\u2605\u2726', headphones: '\uD83C\uDFA7', hearts: '\uD83D\uDC95', flames: '\uD83D\uDD25', leaves: '\uD83C\uDF43\uD83C\uDF3F' };
export const DECORATION_LABELS = [['none', 'None'], ['cat-ears', 'Cat ears'], ['halo', 'Halo'], ['crown', '\uD83D\uDC51 Crown'], ['horns', 'Horns'], ['flowers', '\uD83C\uDF38 Flowers'],
  ['stars', '\u2605 Orbiting stars'], ['headphones', '\uD83C\uDFA7 Headphones'], ['hearts', '\uD83D\uDC95 Hearts'], ['flames', '\uD83D\uDD25 Flames'], ['leaves', '\uD83C\uDF43 Leaves'], ['sparkle-frame', 'Sparkle frame']];

export function avatarEl(u, size = 40, { status = false, meId = '', speaking = false } = {}) {
  const p = (u && u.profile) || {};
  const shape = p.avatarShape || 'circle';
  const ring = p.avatarRing || 'none';
  const wrap = h('span', {
    class: `av shape-${shape} ring-${ring}${speaking ? ' speaking' : ''}`,
    style: {
      '--size': size + 'px', '--ring': p.ringColor || '#f2a541', '--ring2': p.ringColor2 || p.accentColor || '#f2a541',
      '--ring3': p.ringColor3 || p.ringColor2 || p.accentColor || p.ringColor || '#f2a541', '--ring-dur': `${11 - (+p.ringSpeed || 4)}s`,
    },
    dataset: { userAv: u ? u.id : '', size: String(size), status: status ? '1' : '' },
  });
  const inner = h('span', { class: 'av-inner', style: { background: u && u.avatar ? 'transparent' : hashColor(u ? u.id : '?') } });
  if (u && u.avatar) inner.append(h('img', { class: 'cropped', src: u.avatar, alt: '', loading: 'lazy', draggable: 'false', style: cropStyle(p.avatarCrop) }));
  else inner.append(h('span', { class: 'av-initials', style: { fontSize: Math.max(10, size * 0.38) + 'px' } }, initials(displayName(u))));
  wrap.append(inner);
  // Something worn on the avatar (a crown, cat ears…), drawn with CSS and emoji. Too small to see under 40 px.
  const deco = p.avatarDecoration && p.avatarDecoration !== 'none' && size >= 40 ? p.avatarDecoration : '';
  if (deco) { wrap.classList.add('has-deco'); wrap.append(h('span', { class: `av-deco deco-${deco}`, 'aria-hidden': 'true' }, DECORATION_GLYPHS[deco] || '')); }
  // The dot's shape differs per status too (ring, moon, bar), and it carries the words for screen readers.
  if (status) wrap.append(h('span', { class: `status-dot st-${presenceOf(u, meId)}`, title: STATUS_LABEL[presenceOf(u, meId)], role: 'img', 'aria-label': STATUS_LABEL[presenceOf(u, meId)] }));
  return wrap;
}

// server: the server it's shown in, so the name is their nickname there. The element remembers it (data-name-in),
// and its role color, so it's drawn the same way again when the person or their nickname changes.
export function nameEl(u, { tag = 'span', cls = '', roleColor = '', server = null } = {}) {
  const p = (u && u.profile) || {};
  const shown = displayNameIn(server, u);
  const inServer = server && server.kind !== 'group' ? server.id : '';
  const effect = p.nameEffect || 'none';
  const gradient = !!p.nameColor2 || effect === 'flow';
  // The default white name follows the theme's text color so it stays readable in light mode.
  // Server role colors show for people who haven't picked their own name color.
  const plain = !p.nameColor || p.nameColor.toLowerCase() === '#ffffff';
  const n1 = plain ? (roleColor && !p.nameColor2 ? roleColor : 'var(--text)') : p.nameColor;
  const el = h(tag, {
    class: `uname fx-${effect}${gradient ? ' grad' : ''} ${cls}`.trim(),
    style: {
      '--n1': n1,
      '--n2': p.nameColor2 || n1,
      '--n3': p.nameColor3 || p.nameColor2 || n1,
      '--n4': p.nameColor4 || p.nameColor3 || p.nameColor2 || n1,
      '--nglow': p.nameGlow || 'var(--n1x)',
      fontFamily: FONT_STACKS[p.nameFont] || 'inherit',
    },
    dataset: { userName: u ? u.id : '', ...(inServer ? { nameIn: inServer } : {}), ...(roleColor ? { roleColor } : {}) },
  }, shown);
  if (effect === 'glitch') el.dataset.text = shown;
  if (p.nameColor3) el.classList.add('grad-multi');
  if (p.nameFont === 'Press Start 2P') el.classList.add('font-tiny');
  if (p.nameFont === 'Monoton' || p.nameFont === 'Bungee') el.classList.add('font-wide');
  return el;
}

const EFFECT_GLYPHS = { sparkles: '✦', snow: '❄', hearts: '♥', stars: '★', bubbles: '', embers: '', sakura: '✿', confetti: '■', rain: '│', fireflies: '' };
// Split into characters/emoji the way people see them (a flag or 👍🏽 is one).
export function splitGlyphs(t) {
  t = String(t || '');
  return typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(t)].map((x) => x.segment).filter((g) => g.trim()) : Array.from(t).filter((g) => g.trim());
}
// A build-your-own effect: the person's own characters, count, motion, speed, size and color.
export function customFxLayer(fx) {
  const f = fx || {};
  const glyphs = splitGlyphs(f.glyphs || '✦');
  if (!glyphs.length) return null;
  const count = Math.min(40, Math.max(4, +f.count || 16));
  const speed = Math.min(10, Math.max(1, +f.speed || 5));
  const layer = h('div', {
    class: `pfx pfx-custom m-${f.motion || 'fall'}${f.glow ? ' glow' : ''}`, 'aria-hidden': 'true',
    style: { '--fx-size': `${Math.min(48, Math.max(8, +f.size || 16))}px`, '--fx-dur': `${(22 - speed * 2)}s`, '--fx-color': f.color || 'currentColor' },
  });
  for (let i = 0; i < count; i++) {
    const x = (i * 37 + 11) % 100;
    const y = (i * 61 + 7) % 100;
    const d = ((i * 53) % 100) / 10;
    const sc = 0.6 + ((i * 29) % 10) / 12;
    const still = ['twinkle', 'spin', 'zoom', 'bounce'].includes(f.motion); // these stay in place, scattered over the card
    layer.append(h('span', { style: { left: x + '%', top: still ? y + '%' : null, animationDelay: `-${d}s`, '--s': sc } }, glyphs[i % glyphs.length]));
  }
  return layer;
}
export function effectLayer(effect, customFx) {
  if (!effect || effect === 'none') return null;
  if (effect === 'custom') return customFxLayer(customFx);
  const layer = h('div', { class: `pfx pfx-${effect}`, 'aria-hidden': 'true' });
  // deterministic positions so re-renders don't jump
  for (let i = 0; i < 16; i++) {
    const x = (i * 37 + 11) % 100;
    const d = ((i * 53) % 40) / 10;
    const s = 0.6 + ((i * 29) % 10) / 10;
    layer.append(h('span', { style: { left: x + '%', animationDelay: `-${d}s`, '--s': s } }, EFFECT_GLYPHS[effect]));
  }
  return layer;
}

export function bannerEl(u, height = 110) {
  const p = u.profile || {};
  // Without a picture: one color, or (v25) a gradient of two, still or moving.
  const fx = ['gradient', 'flow', 'aurora', 'stripes'].includes(p.bannerFx) ? p.bannerFx : '';
  const el = h('div', {
    class: `pc-banner${fx ? ` bfx bfx-${fx}` : ''}`,
    style: { height: height + 'px', background: fx ? null : p.bannerColor || '#f2a541', '--b1': p.bannerColor || '#f2a541', '--b2': p.bannerColor2 || '#7c4dff' },
  });
  if (u.banner) el.append(h('img', { class: 'cropped', src: u.banner, alt: '', draggable: 'false', style: cropStyle(p.bannerCrop) }));
  return el;
}

// The card's sections that can be moved or hidden, in their default order (the same list as server/profile.js).
export const PROFILE_SECTIONS = [['activity', 'What I\u2019m doing'], ['bio', 'About me'], ['favorites', 'Favorite things'], ['links', 'Links'], ['song', 'Song'],
  ['soundboard', 'Soundboard'], ['interests', 'Interests'], ['games', 'Favorite games'], ['recent', 'Recently played'], ['about', 'More about me'], ['friends', 'Top friends'], ['since', 'Member since']];
export function sectionOrder(list) {
  const keys = PROFILE_SECTIONS.map(([k]) => k);
  const got = (Array.isArray(list) ? list : []).filter((k, i, a) => keys.includes(k) && a.indexOf(k) === i);
  return [...got, ...keys.filter((k) => !got.includes(k))];
}
// Favorite things: a few "label: value" cards with an emoji ("🍕 Food: Pizza").
export function favoritesEl(list) {
  const items = (Array.isArray(list) ? list : []).filter((f) => f && f.label && f.value).slice(0, 6);
  if (!items.length) return null;
  return h('div', { class: 'pc-section' }, h('div', { class: 'pc-label' }, 'Favorite things'),
    h('ul', { class: 'pc-favs' }, items.map((f) => h('li', { class: 'pc-fav' }, f.emoji ? h('span', { class: 'pc-fav-emoji', 'aria-hidden': 'true' }, f.emoji) : null,
      h('span', { class: 'pc-fav-text' }, h('span', { class: 'pc-fav-label' }, f.label), h('span', { class: 'pc-fav-value' }, f.value))))));
}
// A link to a song on a music service (profile.js SONG_HOSTS), as a card with the service's name. Only https links
// to those services are shown, whatever arrives.
const SONG_SERVICES = [[/(^|\.)spotify\.com$/, 'Spotify'], [/^music\.apple\.com$/, 'Apple Music'], [/^music\.youtube\.com$/, 'YouTube Music'], [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'], [/(^|\.)bandcamp\.com$/, 'Bandcamp'], [/(^|\.)tidal\.com$/, 'TIDAL'], [/(^|\.)deezer\.com$/, 'Deezer'], [/^music\.amazon\.com$/, 'Amazon Music']];
export function songService(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  const hit = SONG_SERVICES.find(([re]) => re.test(u.hostname.toLowerCase()));
  return hit ? hit[1] : '';
}
export function songLinkEl(link) {
  const service = link && link.url ? songService(link.url) : '';
  if (!service) return null;
  return h('a', { class: 'pc-songlink', href: link.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
    h('span', { class: 'pc-songlink-ic', 'aria-hidden': 'true' }, '\u266B'),
    h('span', { class: 'pc-songlink-text' }, h('span', { class: 'pc-songlink-title' }, link.label || 'Listen'), h('span', { class: 'pc-songlink-service' }, `on ${service}`)));
}
// What someone chose to show of their soundboard: names, emoji and colors only (the sounds stay private).
const HEXCOLOR = /^#[0-9a-f]{6}$/i;
export function soundShowcaseEl(list) {
  return h('div', { class: 'pc-sounds' }, (list || []).slice(0, 12).map((x) => h('span', { class: 'pc-sound', style: { '--sb-color': HEXCOLOR.test(x.color) ? x.color : '#f2a541' } },
    x.emoji ? h('span', { 'aria-hidden': 'true' }, x.emoji) : null, h('span', null, x.name))));
}

// Full profile card. `actions` is an optional node (buttons).
// One shared player, so only one profile song plays at a time.
let songAudio = null;
let songOwner = null;
export function stopSong() { if (songAudio) songAudio.pause(); }
// A profile song is playing (its Audio isn't on the page either).
export const songPlaying = () => !!songAudio && !songAudio.paused && !songAudio.ended && !songAudio.error;
export function songPlayer(u, p) {
  const btn = h('button', { class: 'pc-song', 'aria-label': `Play ${p.songTitle || 'profile song'}` },
    h('span', { class: 'pc-song-ic' }, '\u25B6'), h('span', { class: 'pc-song-title' }, p.songTitle || 'Profile song'), h('span', { class: 'pc-song-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const sync = () => { const on = songOwner === u.id && songAudio && !songAudio.paused; btn.classList.toggle('playing', on); btn.firstChild.textContent = on ? '\u275A\u275A' : '\u25B6'; };
  btn.addEventListener('click', () => {
    if (songOwner === u.id && songAudio && !songAudio.paused) { songAudio.pause(); sync(); return; }
    if (songAudio) songAudio.pause();
    songAudio = new Audio(u.song); songOwner = u.id;
    songAudio.volume = 0.6;
    songAudio.addEventListener('ended', sync); songAudio.addEventListener('pause', sync);
    songAudio.play().then(sync).catch(() => {});
  });
  sync();
  return btn;
}
// nickname: { name, place, edit } when the card is opened inside a server where they have one: the nickname, the
// server's name, and (when the viewer may change it) what Change does. The big name stays their display name.
export function profileCard(u, { meId = '', actions = null, compact = false, mutual = null, topFriends = null, nickname = null } = {}) {
  const p = u.profile || {};
  const style = p.cardStyle || 'gradient';
  const noBanner = p.showBanner === false;
  const size = ['sm', 'lg', 'xl'].includes(p.textSize) ? ` pc-text-${p.textSize}` : '';
  const card = h('div', {
    class: `pcard pc-${style}${compact ? ' pc-compact' : ''}${noBanner ? ' pc-no-banner' : ''}${size}`,
    style: { '--c1': p.themePrimary, '--c2': p.themeSecondary, '--acc': p.accentColor },
  });
  if (u.background) card.append(h('div', { class: 'pc-bg' }, h('img', { class: 'cropped pc-bg-img', src: u.background, alt: '', draggable: 'false', style: cropStyle(p.backgroundCrop) })));
  const fx = effectLayer(p.profileEffect, p.customFx);
  // With the banner turned off, the profile background shows through the whole card.
  card.append(noBanner ? h('div', { class: 'pc-banner-space' }) : bannerEl(u, compact ? 96 : 120));
  const body = h('div', { class: 'pc-body' });
  const avWrap = h('div', { class: 'pc-av' }, avatarEl(u, 84, { status: true, meId }));
  body.append(avWrap);
  if (p.customStatus && (p.customStatus.text || p.customStatus.emoji)) {
    body.append(h('div', { class: 'pc-bubble' }, p.customStatus.emoji ? h('span', { class: 'pc-bubble-emoji' }, p.customStatus.emoji) : null, p.customStatus.text || ''));
  }
  const inner = h('div', { class: 'pc-inner' });
  inner.append(nameEl(u, { tag: 'div', cls: 'pc-name' }));
  inner.append(h('div', { class: 'pc-handle' }, u.username, p.pronouns ? h('span', { class: 'pc-pronouns' }, p.pronouns) : null,
    u.supporter ? h('span', { class: 'supporter-tag', title: 'Helps pay for this server' }, '\uD83D\uDC9C Supporter') : null));
  if (nickname && nickname.name) {
    inner.append(h('div', { class: 'pc-section pc-nick' }, h('div', { class: 'pc-label' }, `Nickname in ${nickname.place}`),
      h('div', { class: 'pc-nick-row' }, h('span', { class: 'pc-nick-name' }, nickname.name),
        nickname.edit ? h('button', { class: 'link-btn', 'aria-label': `Change nickname in ${nickname.place}`, onclick: nickname.edit }, 'Change') : null)));
  }
  // Each section that has something to show, in the order the person picked (profile.js SECTIONS), minus the ones they
  // hid. Mutual friends and servers aren't theirs to move: they go just before "Member since".
  const sec = (label, ...kids) => h('div', { class: 'pc-section' }, label ? h('div', { class: 'pc-label' }, label) : null, ...kids);
  const build = {
    activity: () => { const act = activityCards(u, { compact: true }); return act ? sec(null, act) : null; },
    bio: () => (p.bio ? sec('About me', h('div', { class: 'pc-bio', html: md(p.bio) })) : null),
    favorites: () => favoritesEl(p.favorites),
    links: () => (p.links && p.links.length ? sec('Links', h('div', { class: 'pc-links' }, p.links.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'pc-link' }, l.label || new URL(l.url).hostname)))) : null),
    song: () => {
      const link = songLinkEl(p.songLink);
      return u.song || link ? sec(null, u.song ? songPlayer(u, p) : null, link) : null;
    },
    soundboard: () => (p.showSoundboard && (p.soundShowcase || []).length ? sec('Soundboard', soundShowcaseEl(p.soundShowcase)) : null),
    interests: () => ((p.interests || []).length ? sec('Interests', h('div', { class: 'pc-tags' }, p.interests.map((t) => h('span', { class: 'pc-tag' }, t)))) : null),
    games: () => { const fav = favoriteGamesEl(p.games, { limit: compact ? 6 : 12 }); return fav ? sec('Favorite games', fav) : null; },
    recent: () => { const recent = !compact && recentGamesEl((u.recentGames || []).slice(0, 4)); return recent ? sec('Recently played', recent) : null; },
    about: () => (!compact && p.aboutMe ? sec('More about me', h('div', { class: 'pc-about md', html: renderDoc(p.aboutMe) })) : null),
    friends: () => (!compact && topFriends ? topFriends : null),
    since: () => [mutual || null, sec('Member since', h('div', { class: 'pc-since' }, fmtDay(u.createdAt)))],
  };
  const hidden = new Set(Array.isArray(p.hiddenSections) ? p.hiddenSections : []);
  const order = sectionOrder(p.sectionOrder);
  for (const k of order) {
    if (hidden.has(k)) { if (k === 'since' && mutual) inner.append(mutual); continue; }
    const out = build[k]();
    [].concat(out).forEach((x) => { if (x) inner.append(x); });
  }
  if (actions) inner.append(h('div', { class: 'pc-actions' }, actions));
  body.append(inner);
  card.append(body);
  if (fx) card.append(fx);
  return card;
}
