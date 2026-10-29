// A TikTok video or Instagram reel in a message, played in place (docs/design/SOCIAL-EMBEDS.md; the rules are in
// social.js). Until the reader taps it (or chose "Always" in Settings → Chat) it's a placeholder: the picture from
// the sender's link preview if the message has one (it came inside the encrypted message, so showing it contacts
// nobody), the site's name, and a line saying the player loads from TikTok or Instagram, which then see the
// reader's IP address. Nothing from those sites loads before that.
import { h, clear, icon, toast } from './util.js';
import { api } from './api.js';
import { parseSocialUrl, playerSrc, SOCIAL_SANDBOX, SOCIAL_ALLOW, KIND_NAME, itemLabel } from './social.js';

// Players opened in this tab, so one that was playing comes back as a player (not a placeholder) when its message
// is drawn again. Kept for this tab only.
const opened = new Set();
// Short TikTok links this tab already asked the server about: link -> { kind, id, link }.
const resolved = new Map();

// The video a short link leads to, asked of this server (POST /api/social/resolve), which checks every hop.
export async function resolveSocial(p) {
  if (p.id) return p;
  if (resolved.has(p.link)) return resolved.get(p.link);
  const r = await api('POST', '/social/resolve', { url: p.link });
  // The server's answer is checked again here: only an id that passes the same rules reaches a frame.
  const q = parseSocialUrl(r && r.link);
  if (!q || !q.id || q.kind !== 'tiktok' || q.id !== r.id) throw new Error('That short link doesn’t lead to a TikTok video.');
  resolved.set(p.link, q);
  return q;
}

export function socialFrame(p, { autoplay = false, lazy = false } = {}) {
  return h('iframe', {
    class: 'soc-frame', src: playerSrc(p, { autoplay }), sandbox: SOCIAL_SANDBOX, allow: SOCIAL_ALLOW, allowfullscreen: true,
    referrerpolicy: 'no-referrer', title: itemLabel(p), loading: lazy ? 'lazy' : 'eager',
  });
}

// p: from socialLinks(); key: what remembers it as opened (the message id and the video); card: the sender's link
// preview for the same link, if any (its picture and title); mode: 'ask' | 'always'; blurred: the message is blurred
// by the word filter, so it's a placeholder even if its player was opened before (nothing loads for a message you
// chose to hide).
export function socialEmbedEl(p, { key, card = null, mode = 'ask', blurred = false } = {}) {
  const site = p.kind === 'tiktok' ? 'tiktok.com' : 'instagram.com';
  const box = h('div', { class: `soc-embed kind-${p.kind}${p.type === 'p' ? ' post' : ''}`, dataset: { kind: p.kind } });
  const external = h('a', { class: 'soc-open', href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow', title: p.url }, icon('external'), `Open on ${KIND_NAME[p.kind]}`);
  const load = async (byTap) => {
    let item;
    try { item = await resolveSocial(p); } catch (e) { if (byTap) toast(e.message, 'error'); return; }
    if (byTap) opened.add(key); // (one loaded by "Always" goes back to a placeholder if that choice changes)
    clear(box).append(socialFrame(item, { autoplay: byTap && p.kind === 'tiktok', lazy: !byTap }),
      h('button', { class: 'soc-close', type: 'button', 'aria-label': 'Close the player', 'data-tip': 'Close the player', onclick: () => { opened.delete(key); draw(); } }, icon('close')));
    box.classList.add('loaded');
  };
  const draw = () => {
    box.classList.remove('loaded');
    const pic = card && card.img ? h('img', { class: 'soc-thumb', src: `data:${card.img.type};base64,${card.img.data}`, alt: '', decoding: 'async', loading: 'lazy' }) : null;
    const play = h('button', { class: 'soc-play', type: 'button', 'aria-label': `Play this ${itemLabel(p)} here (loads from ${site})`, onclick: (e) => { const b = e.currentTarget; b.disabled = true; load(true).finally(() => { b.disabled = false; }); } },
      h('span', { class: 'soc-play-ic' }, icon('play')), h('span', null, `Play ${itemLabel(p)}`));
    clear(box).append(pic || h('div', { class: 'soc-blank' }),
      h('div', { class: 'soc-over' },
        h('span', { class: 'soc-site' }, KIND_NAME[p.kind]),
        card && card.title ? h('span', { class: 'soc-title' }, card.title) : null,
        play,
        h('span', { class: 'soc-note' }, p.id ? `Loads from ${site}, which sees your IP address.` : `A short link: your Hearth server looks up where it goes, then it loads from ${site}, which sees your IP address.`),
        external));
  };
  // "Always" loads straight away, except a short link (opening one asks this server, so that waits for a tap).
  if (!blurred && (opened.has(key) || (mode === 'always' && p.id))) load(false); else draw();
  return box;
}
