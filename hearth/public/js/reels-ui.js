// The Reels tab (docs/design/SCROLL-TOGETHER.md): a conversation's TikToks and Instagram reels as one upright,
// full-height feed you swipe through, alone or together.
//
// It lives in one fixed layer that's never moved (moving a player reloads it), laid over the tab's place in the
// page (app.js draws a .reels-host there) or, on a phone, over the whole screen. The feed is made here from the
// decrypted messages (reels.js feedItems): the ones the chat has, then older pages, asked for as you get near the
// end. Only the video on screen and one on each side have a player; the rest are placeholders, and a player that
// leaves that window is let go (its frame removed), so a long feed doesn't fill the memory.
//
// Privacy: "Load when I tap" (Settings → Chat) shows a cover until this person taps once; that tap counts for the
// whole tab, and every other Reels tab, until Hearth is closed or reloaded, and the cover says so. "Just show the
// link" shows cards with the link, never a player. Players are social.js's: built from a checked id, sandboxed, no
// referrer. The current TikTok plays without sound until a tap on its sound button.
//
// Scroll together: reels:* events (server/reels.js) carry only the message id and the link's place in it.
import { h, clear, icon, toast } from './util.js';
import { tiktokAdapter, instagramAdapter } from './watch.js';
import { resolveSocial } from './social-embed.js';
import { parseSocialUrl, KIND_NAME, itemLabel } from './social.js';
import { feedItems, indexOf, isItem, step, liveRange, playersAllowed, cleanSession, withLine, swipedText, sharedPosition, COUNTDOWN_MS } from './reels.js';
import { createBrainrot } from './brainrot.js';

const MORE_WITHIN = 4; // items from the end at which an older page is asked for
const PAGES_PER_ASK = 4; // pages read in a row looking for more videos before waiting to be asked again
const FIND_PAGES = 12; // pages read looking for the video everyone moved to
const DRIFT = 1.6;
// append(), leaving out what isn't there (DOM append would write "null").
const add = (el, ...kids) => { el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };

// The tap that lets players load ("Load when I tap"), for as long as the app is open.
let consented = false;

export function createReels(deps) {
  let st = null;
  let layer = null; let resize = null;

  // ---- the layer and where it sits
  function layerEl() {
    if (layer) return layer;
    layer = h('div', { class: 'reels-layer', hidden: true, role: 'region', 'aria-label': 'Reels' });
    layer.addEventListener('keydown', onKey);
    document.body.append(layer);
    return layer;
  }
  function place() {
    if (!st) return;
    const full = deps.isPhone();
    layer.classList.toggle('full', full);
    const host = st.host && st.host.isConnected ? st.host : null;
    if (full) { Object.assign(layer.style, { left: '', top: '', width: '', height: '' }); layer.hidden = false; }
    else if (host && host.getClientRects().length) {
      const r = host.getBoundingClientRect();
      Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      layer.hidden = false;
    } else layer.hidden = true;
  }
  // Placed again when something could move its place: the window, a scroll, or the place's own size (panels opening).
  const onMove = () => place();
  function watchPlace() {
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    if (window.ResizeObserver) { resize = new ResizeObserver(onMove); resize.observe(document.body); if (st.host) resize.observe(st.host); }
  }
  function unwatchPlace() {
    window.removeEventListener('resize', onMove);
    document.removeEventListener('scroll', onMove, true);
    if (resize) { resize.disconnect(); resize = null; }
  }

  // ---- open and close
  // Called by app.js whenever it draws the tab's place (host): the same conversation keeps everything as it was.
  function show(key, host) {
    if (st && st.key === key) {
      if (st.host !== host) { st.host = host; if (resize) resize.observe(host); }
      place();
      return;
    }
    if (st) hide();
    st = {
      key, host, msgs: new Map(), items: [], index: 0, cards: new Map(), players: new Map(), oldest: null, hasMore: true, loading: false, idle: 0,
      session: null, viewers: [], offset: 0, following: false, lastSeq: 0, unmuted: false, quietUntil: 0,
      timer: null, countTimer: null, startTimer: null, observer: null, addOpen: false, followTo: null, followUntil: 0,
      gen: 0, searched: null, myGo: null, left: false, swipeToastAt: 0,
    };
    for (const m of deps.loaded(key)) st.msgs.set(m.id, m);
    st.oldest = oldestId();
    build();
    rebuild();
    if (st.items.length < 3) more();
    deps.socket().emit('reels:join', { key }, (r) => { if (st && st.key === key && r && r.state) onState(r.state); });
    watchPlace();
    place();
  }
  function hide() {
    if (!st) return;
    const key = st.key;
    deps.socket().emit('reels:leave', { key }, () => {});
    for (const pl of st.players.values()) pl.destroy();
    if (st.br) st.br.destroy();
    if (st.observer) st.observer.disconnect();
    clearInterval(st.timer); clearInterval(st.countTimer); clearTimeout(st.startTimer);
    st = null;
    unwatchPlace();
    if (layer) { clear(layer); layer.hidden = true; }
  }

  // ---- the feed
  const oldestId = () => { let o = null; for (const id of st.msgs.keys()) if (!o || id < o) o = id; return o; };
  const ok = (m) => deps.ok(m);
  function rebuild() {
    const was = st.items[st.index];
    st.items = feedItems([...st.msgs.values()], { ok, text: deps.text });
    const at = was ? st.items.findIndex((x) => x.vid === was.vid) : -1;
    st.index = at >= 0 ? at : Math.min(st.index, Math.max(0, st.items.length - 1));
    reconcile();
    drawSide();
    drawBar();
  }
  // The cards in feed order: existing ones stay where they are (a moved frame would reload), new ones go in place.
  function reconcile() {
    const feed = st.feed;
    const want = st.items.map((it, i) => {
      let c = st.cards.get(it.vid);
      if (!c) { c = cardEl(it); st.cards.set(it.vid, c); st.observer.observe(c); }
      // The same video shared again: the same card (and player), now saying who shared it last.
      else if (c._it.key !== it.key || c._it.m !== it.m) { c._it = it; drawInfo(c); drawActions(c); }
      c.dataset.i = String(i);
      return c;
    });
    const keep = new Set(want);
    for (const [k, c] of [...st.cards]) if (!keep.has(c)) { st.observer.unobserve(c); c.remove(); st.cards.delete(k); dropPlayer(k); }
    let at = feed.firstElementChild;
    for (const c of want) {
      if (at === c) { at = at.nextElementSibling; continue; }
      feed.insertBefore(c, at);
    }
    while (at) { const n = at.nextElementSibling; if (at.classList.contains('reel-card')) at.remove(); at = n; }
    clear(st.empty);
    st.empty.hidden = !!st.items.length;
    if (!st.items.length) add(st.empty, emptyEl());
    // Keep the video you were on in view (new ones may have gone in above it).
    const cur = st.items[st.index] && st.cards.get(st.items[st.index].vid);
    if (cur && Math.abs(feed.scrollTop - cur.offsetTop) > 2) { st.followTo = st.index; st.followUntil = Date.now() + 600; feed.scrollTop = cur.offsetTop; }
    players();
  }
  async function more(pages = PAGES_PER_ASK, until = null) {
    if (!st || st.loading || !st.hasMore) return false;
    const key = st.key;
    st.loading = true; drawSide();
    let found = false;
    try {
      for (let n = 0; n < pages && st && st.key === key && st.hasMore; n++) {
        const before = st.items.length;
        const res = await deps.page(key, st.oldest);
        if (!st || st.key !== key) return false;
        for (const m of res.messages || []) { await deps.decrypt(m).catch(() => {}); if (!st.msgs.has(m.id)) st.msgs.set(m.id, m); }
        st.hasMore = !!res.hasMore && (res.messages || []).length > 0;
        st.oldest = oldestId();
        rebuild();
        if (until && until()) { found = true; break; }
        if (!until && st.items.length > before + 2) break;
      }
    } catch (e) { toast(e.message, 'error'); } finally { if (st && st.key === key) { st.loading = false; drawSide(); } }
    return found;
  }

  // ---- the page
  function build() {
    const L = layerEl();
    clear(L);
    st.feed = h('div', { class: 'reels-feed', tabindex: '0', 'aria-label': 'Videos: up and down arrows move between them' });
    st.empty = h('div', { class: 'reels-empty', hidden: true });
    st.bar = h('div', { class: 'reels-bar' });
    st.side = h('aside', { class: 'reels-side' });
    st.cover = h('div', { class: 'reels-cover', hidden: true });
    st.count = h('div', { class: 'reels-count', hidden: true, 'aria-live': 'assertive' });
    const top = h('div', { class: 'reels-top' },
      h('button', { class: 'icon-btn reels-back', 'aria-label': 'Back to the chat', 'data-tip': 'Back to the chat', onclick: () => deps.setTab('chat') }, icon('chevronLeft')),
      h('div', { class: 'reels-title' }, h('strong', null, 'Reels'), h('span', null, deps.title(st.key))),
      h('button', { class: 'icon-btn reels-add-btn', 'aria-label': 'Add a link', 'data-tip': 'Add a link', onclick: () => { st.addOpen = !st.addOpen; drawSide(); } }, icon('plus')));
    const main = h('div', { class: 'reels-main' }, st.feed, st.empty, st.cover, st.count);
    L.append(top, st.bar, h('div', { class: 'reels-body' }, main, st.side));
    brainrot(main);
    st.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) onSettle(+e.target.dataset.i);
    }, { root: st.feed, threshold: [0.6] });
    drawCover();
  }
  // Brainrot mode (brainrot.js): gameplay under (or beside) the feed. The captions are the preview title of the video
  // on screen, from the message here (decrypted on this device); nothing about it goes to the server.
  function brainrot(main) {
    const me0 = st;
    st.br = createBrainrot({
      kind: 'reels', frame: main, me: deps.me, nameOf: deps.nameOf,
      // Beside the feed once half the width still fits an upright video (and never on a phone's full screen).
      row: (w, hgt) => !deps.isPhone() && w >= 640 && w >= hgt * 0.95,
      caption: () => { const it = current(); const prev = it && deps.card(it.m, it.p.url); return (prev && prev.title) || ''; },
      progress: () => {
        const it = current(); const pl = it && st.players.get(it.vid);
        const d = pl && !pl.pending && pl.duration ? pl.duration() : 0;
        return d ? pl.time() / d : null;
      },
      share: { can: () => inSession() && mayControl(), set: (on) => deps.socket().emit('reels:brainrot', { key: st.key, on }, (r) => { if (r && r.error) toast(r.error, 'error'); }) },
      // The feed got shorter or narrower: back to the start of the video on screen.
      onLayout: () => requestAnimationFrame(() => {
        if (st !== me0) return;
        const c = current() && st.cards.get(current().vid);
        if (c) { st.followTo = st.index; st.followUntil = Date.now() + 600; st.feed.scrollTop = c.offsetTop; }
      }),
      onChange: () => { if (st === me0 && st.br) drawBar(); },
    });
    main.append(st.br.el);
  }
  function emptyEl() {
    return h('div', { class: 'reels-empty-in' },
      h('h3', null, st.loading || st.hasMore ? 'Looking for videos…' : 'No TikToks or reels here yet'),
      h('p', null, 'This feed is every TikTok video and Instagram reel or post shared in this conversation. Add one with +, or paste a link in the chat.'),
      h('p', { class: 'muted-p' }, 'TikTok’s For You and Instagram’s Reels feeds can’t be shown in other apps: there’s no way to embed them, and their terms don’t allow copying them.'),
      st.hasMore && !st.loading ? h('button', { class: 'btn ghost sm', onclick: () => more() }, 'Look further back') : null);
  }
  function drawCover() {
    if (!st) return;
    const show = deps.mode() === 'ask' && !consented;
    st.cover.hidden = !show;
    clear(st.cover);
    // Only a tap on the cover itself counts as the go-ahead ("Load when I tap"): not Back, +, or a swipe.
    st.cover.onclick = show ? () => { consented = true; drawCover(); players(); } : null;
    if (show) {
      add(st.cover, h('div', { class: 'reels-cover-in' },
        h('strong', null, 'Tap to start watching'),
        h('p', null, 'These videos load from TikTok and Instagram, which see your IP address (and may set cookies in their players). Tapping here lets every video in this tab, and other Reels tabs, load until you close Hearth.'),
        h('p', { class: 'muted-p' }, 'Short TikTok links are looked up by your Hearth server. Settings → Chat → TikTok and Instagram changes this.'),
        h('button', { class: 'btn primary', type: 'button' }, icon('play'), 'Start watching')));
    }
  }

  // One video's card: its place (a placeholder until it has a player), who shared it and when, its reactions, and
  // a way to the message.
  function cardEl(it) {
    const m = it.m;
    const u = deps.user(m.authorId);
    const prev = deps.card(m, it.p.url);
    const stage = h('div', { class: `reel-stage kind-${it.p.kind}` });
    const actions = h('div', { class: 'reel-actions' });
    const info = h('div', { class: 'reel-info' });
    const card = h('section', { class: 'reel-card', 'aria-label': `${itemLabel(it.p)} shared by ${deps.name(m, u)}` },
      h('div', { class: 'reel-frame' }, stage, info, actions));
    card._it = it;
    card._info = info;
    drawInfo(card);
    card._stage = stage;
    card._actions = actions;
    drawPlaceholder(card);
    drawActions(card);
    return card;
  }
  function drawInfo(card) {
    const m = card._it.m;
    const u = deps.user(m.authorId);
    const prev = deps.card(m, card._it.p.url);
    add(clear(card._info),
      h('div', { class: 'reel-who' }, deps.avatar(u, 28), h('strong', null, deps.name(m, u)), h('time', { datetime: new Date(m.createdAt).toISOString() }, deps.when(m.createdAt))),
      prev && prev.title ? h('div', { class: 'reel-caption' }, prev.title) : null);
  }
  function drawPlaceholder(card) {
    const it = card._it;
    const prev = deps.card(it.m, it.p.url);
    const site = it.p.kind === 'tiktok' ? 'tiktok.com' : 'instagram.com';
    clear(card._stage).append(
      prev && prev.img ? h('img', { class: 'soc-thumb', src: `data:${prev.img.type};base64,${prev.img.data}`, alt: '', decoding: 'async', loading: 'lazy' }) : h('div', { class: 'soc-blank' }),
      h('div', { class: 'soc-over' }, h('span', { class: 'soc-site' }, KIND_NAME[it.p.kind]),
        deps.mode() === 'off' ? h('span', { class: 'soc-note' }, 'Players are off (Settings → Chat).') : null,
        h('a', { class: 'soc-open', href: it.p.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external'), `Open on ${site}`)));
  }
  function drawActions(card) {
    const it = card._it; const m = it.m;
    const me = deps.me();
    add(clear(card._actions), 
      ...(m.reactions || []).slice(0, 6).map((r) => {
        const mine = r.userIds.includes(me);
        return h('button', { class: `reel-act reaction${mine ? ' mine' : ''}`, 'aria-pressed': String(mine), 'aria-label': `${r.emoji} ${r.userIds.length}`, onclick: () => deps.react(m, r.emoji) },
          deps.emoji(r.emoji), h('span', null, String(r.userIds.length)));
      }),
      h('button', { class: 'reel-act', 'aria-label': 'React', 'data-tip': 'React', 'data-pop-anchor': '', onclick: (e) => deps.picker(e.currentTarget, (em) => deps.react(m, em)) }, icon('smile')),
      h('button', { class: 'reel-act', 'aria-label': 'Jump to message', 'data-tip': 'Jump to message', onclick: () => deps.jump(m) }, icon('message')),
      h('a', { class: 'reel-act', href: it.p.url, target: '_blank', rel: 'noopener noreferrer nofollow', 'aria-label': `Open on ${KIND_NAME[it.p.kind]}`, 'data-tip': `Open on ${KIND_NAME[it.p.kind]}` }, icon('external')));
  }

  // ---- players: the one on screen and its neighbours
  function players() {
    if (!st) return;
    const allowed = deps.mode() !== 'off' && playersAllowed(deps.mode(), consented);
    const live = new Set(allowed ? liveRange(st.index, st.items.length).map((k) => st.items[k].vid) : []);
    for (const k of [...st.players.keys()]) if (!live.has(k)) dropPlayer(k);
    for (const k of live) if (!st.players.has(k)) makePlayer(st.items.find((x) => x.vid === k));
    // Only the one on screen plays (and it starts without sound until a tap on its sound button).
    const cur = current();
    for (const [k, pl] of st.players) {
      if (cur && k === cur.vid) continue;
      if (pl.playing && pl.playing()) pl.pause();
    }
    if (cur && st.players.get(cur.vid) && !inSession()) { const pl = st.players.get(cur.vid); if (pl.ready) pl.play(); }
    drawBar();
  }
  async function makePlayer(it) {
    if (!it || !st) return;
    const card = st.cards.get(it.vid);
    const key = st.key;
    const holder = { pending: true, destroy() { this.gone = true; }, playing: () => false, pause() {} };
    st.players.set(it.vid, holder);
    let p = it.p;
    if (!p.id) {
      // A short link: looked up (by this server) only for the video on screen.
      if (!isCurrent(it)) { st.players.delete(it.vid); return; }
      try { p = await resolveSocial(p); } catch (e) {
        if (st && st.key === key && st.players.get(it.vid) === holder) { st.players.delete(it.vid); toast(e.message, 'error'); }
        return;
      }
    }
    if (!st || st.key !== key || holder.gone || st.players.get(it.vid) !== holder) return;
    const onEvent = (ev, value) => onPlayerEvent(it, ev, value);
    const a = p.kind === 'tiktok' ? tiktokAdapter({ src: p.id, title: itemLabel(p) }, onEvent, { muted: () => !st || !st.unmuted })
      : instagramAdapter({ src: p.id, postType: p.type, title: itemLabel(p) }, onEvent);
    a.it = it;
    a.el.classList.add('soc-frame');
    clear(card._stage).append(a.el);
    if (p.kind === 'tiktok' && !st.unmuted) card._stage.append(h('button', { class: 'reel-sound', type: 'button', 'aria-label': 'Sound on', onclick: () => unmute() }, icon('speaker'), 'Tap for sound'));
    if (a.manual) card._stage.append(h('div', { class: 'reel-note' }, 'Instagram’s player can’t be started from here: press ▶ in the video.'));
    st.players.set(it.vid, a);
  }
  function dropPlayer(k) {
    const pl = st && st.players.get(k);
    if (!pl) return;
    pl.destroy();
    st.players.delete(k);
    const card = st.cards.get(k);
    if (card) drawPlaceholder(card);
  }
  function unmute() {
    if (!st) return;
    st.unmuted = true;
    const cur = current();
    const pl = cur && st.players.get(cur.vid);
    if (pl && pl.mute) pl.mute(false);
    for (const c of st.cards.values()) c.querySelector('.reel-sound')?.remove();
  }
  const current = () => (st ? st.items[st.index] : null);
  const isCurrent = (it) => { const c = current(); return !!c && !!it && c.vid === it.vid; };
  function onPlayerEvent(it, ev, value) {
    if (!st) return;
    const pl = st.players.get(it.vid);
    if (ev === 'ready') {
      if (pl) pl.ready = true;
      if (isCurrent(it)) { if (inSession()) follow(true); else if (pl && pl.play) pl.play(); }
      return;
    }
    if (!isCurrent(it) || !inSession() || Date.now() < st.quietUntil || !mayControl()) return;
    const s = st.session;
    if (ev === 'play' && !s.playing) control('play', value);
    else if (ev === 'pause' && s.playing) control('pause', value);
    else if (ev === 'seek' && Math.abs(value - sharedPosition(s, st.offset)) > DRIFT) control('seek', value);
  }

  // ---- moving
  // following: moved there to follow everyone (not by this person), so landing there tells nobody anything.
  function scrollToIndex(i, smooth = true, following = false) {
    const it = st.items[i];
    const c = it && st.cards.get(it.vid);
    if (!c) return;
    if (following) { st.followTo = i; st.followUntil = Date.now() + 1500; }
    c.scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }
  function go(dir) {
    if (!st || !st.items.length) return;
    const i = step(st.index, dir, st.items.length);
    if (i !== st.index) scrollToIndex(i);
    else if (dir > 0 && st.hasMore) more();
  }
  // A card settled on screen (swipe, wheel, keys, or following someone).
  function onSettle(i) {
    if (!st || !st.items[i]) return;
    // On the way to where everyone is: the cards passed on the way don't count, and arriving isn't a move.
    if (st.followTo != null && Date.now() < st.followUntil) {
      if (i !== st.followTo) return;
      st.followTo = null;
      if (i !== st.index) { st.index = i; players(); }
      return;
    }
    st.followTo = null;
    if (i === st.index) return;
    const dir = i > st.index ? 1 : -1;
    st.index = i;
    players();
    if (st.items.length - i <= MORE_WITHIN) more();
    if (!inSession()) return;
    const s = st.session;
    const it = st.items[i];
    if (isItem(it, s.mid, s.i)) return;
    if (mayControl()) {
      // Until the server says where everyone is, an older update doesn't pull this person back (quick swipes).
      st.myGo = { mid: it.mid, i: it.i, at: Date.now() };
      deps.socket().emit('reels:go', { key: st.key, mid: it.mid, i: it.i, dir }, (r) => {
        if (r && r.error) { toast(r.error, 'error'); if (st) { st.myGo = null; if (st.session) moveTo(st.session.mid, st.session.i); } }
      });
    }
    else {
      // Only the starter moves everyone: scrolling away is scrolling on your own.
      follow_(false);
      toast('You’re scrolling on your own now. Rejoin to go back to everyone.');
    }
  }
  function onKey(e) {
    if (!st || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (['ArrowDown', 'PageDown', 'j'].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowUp', 'PageUp', 'k'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'm') unmute();
  }

  // ---- scroll together
  const inSession = () => !!(st && st.session && st.following);
  const mayControl = () => { const s = st && st.session; return !!s && st.following && (!s.hostOnly || s.by === deps.me()); };
  const quiet = (ms = 1200) => { st.quietUntil = Date.now() + ms; };
  function control(action, position, extra = {}) {
    const s = st.session;
    deps.socket().emit('reels:control', { key: st.key, mid: s.mid, i: s.i, action, position, ...extra }, (r) => { if (r && r.error) toast(r.error, 'error'); });
  }
  function follow_(on) {
    if (st) st.left = !on;
    deps.socket().emit('reels:follow', { key: st.key, on }, (r) => { if (r && r.error) toast(r.error, 'error'); });
  }
  function start(hostOnly = false) {
    const it = current();
    if (!it) return toast('There’s nothing to scroll through here yet.');
    st.left = false;
    deps.socket().emit('reels:start', { key: st.key, mid: it.mid, i: it.i, hostOnly }, (r) => { if (r && r.error) toast(r.error, 'error'); });
  }
  async function onState(x) {
    if (!st || !x || x.key !== st.key) return;
    st.offset = (Number(x.serverNow) || Date.now()) - Date.now();
    st.viewers = Array.isArray(x.viewers) ? x.viewers.filter((v) => typeof v === 'string') : [];
    const s = cleanSession(x.session);
    const me = deps.me();
    const was = st.session;
    st.session = s;
    st.following = !!s && s.following.includes(me);
    // Brainrot mode for everyone: only for the people following (and each can still turn it off).
    if (s && s.brainrot && s.lastAction === 'brainrot') st.brBy = s.lastBy;
    if (st.br) st.br.setSession({ on: !!(s && s.brainrot && st.following), by: st.brBy || (s && s.by) || '' });
    if (s && s.seq !== st.lastSeq) {
      if (st.lastSeq && s.lastBy && s.lastBy !== me && st.following) {
        const name = deps.nameOf(s.lastBy);
        // (Swipes come quickly: one note every couple of seconds at most.)
        if (s.lastAction === 'go') { if (Date.now() - st.swipeToastAt > 2000) { st.swipeToastAt = Date.now(); toast(swipedText(name, s.dir)); } }
        else if (s.lastAction === 'pause') toast(`${name} paused`);
        else if (s.lastAction === 'play' && s.startAt) toast(`${name} started the countdown`);
      } else if (!was && s.lastAction === 'start' && s.by !== me) toast(`${deps.nameOf(s.by)} started scrolling together`);
      st.lastSeq = s.seq;
    }
    if (!s) st.lastSeq = 0;
    const gen = ++st.gen;
    const me0 = st;
    clearInterval(st.timer); st.timer = null;
    if (inSession()) {
      // My own swipe on its way: an update from before it doesn't pull me back.
      const mine = st.myGo && Date.now() - st.myGo.at < 2000;
      if (mine && isItem(current(), st.myGo.mid, st.myGo.i) && !(s.mid === st.myGo.mid && s.i === st.myGo.i)) { drawBar(); drawSide(); return; }
      st.myGo = null;
      await moveTo(s.mid, s.i);
      if (st !== me0 || gen !== st.gen || !inSession()) return;
      follow(true);
      countdown();
      clearInterval(st.timer);
      st.timer = setInterval(() => follow(false), 1000);
    } else { clearInterval(st.countTimer); clearTimeout(st.startTimer); st.count.hidden = true; }
    drawBar();
    drawSide();
  }
  // Go where everyone is, looking further back for it if it isn't loaded yet.
  // A video that isn't in this person's feed is looked for, and said, once.
  async function moveTo(mid, i) {
    const me0 = st;
    let k = indexOf(st.items, mid, i);
    const want = `${mid}:${i}`;
    if (k < 0) {
      if (st.searched === want) return;
      st.searched = want;
      if (st.hasMore) { await more(FIND_PAGES, () => indexOf(st.items, mid, i) >= 0); if (st !== me0) return; k = indexOf(st.items, mid, i); }
      if (k < 0) { toast('Everyone moved to a video that isn’t here for you (hidden or gone).'); return; }
    }
    st.searched = null;
    if (k !== st.index) {
      st.index = k;
      scrollToIndex(k, true, true);
      players();
    }
  }
  // The video on screen, kept where everyone's is (TikTok; Instagram can't be moved).
  function follow(force) {
    const s = st && st.session;
    const it = current();
    if (!inSession() || !isItem(it, s.mid, s.i)) return;
    const pl = st.players.get(it.vid);
    if (!pl || !pl.ready || pl.manual || pl.pending) return;
    const counting = s.playing && s.startAt && Date.now() + st.offset < s.startAt;
    if (counting) { if (pl.playing()) { quiet(); pl.pause(); } return; }
    const want = sharedPosition(s, st.offset);
    if (force || Math.abs(pl.time() - want) > DRIFT) { quiet(); pl.seek(want); }
    if (s.playing && !pl.playing()) { quiet(); pl.play(); }
    if (!s.playing && pl.playing()) { quiet(); pl.pause(); }
  }
  function countdown() {
    clearInterval(st.countTimer); clearTimeout(st.startTimer);
    const s = st.session;
    const at = s && s.playing && s.startAt ? s.startAt - st.offset : 0;
    if (!at || at < Date.now() - 4000) { st.count.hidden = true; return; }
    const cur = current();
    const manual = cur && cur.p.kind === 'instagram';
    const tick = () => {
      if (!st) return;
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left > 0) { st.count.hidden = false; st.count.textContent = String(left); return; }
      st.count.textContent = manual ? '▶ Press play now' : '▶';
      if (Date.now() - at > (manual ? 4000 : 800)) { st.count.hidden = true; clearInterval(st.countTimer); }
    };
    tick();
    st.countTimer = setInterval(tick, 200);
    st.startTimer = setTimeout(() => follow(true), Math.max(0, at - Date.now()));
  }

  // ---- the together bar and the side
  function drawBar() {
    if (!st) return;
    const s = st.session;
    const me = deps.me();
    clear(st.bar);
    if (!s) {
      const others = st.viewers.filter((u) => u !== me);
      add(st.bar, 
        h('button', { class: 'btn primary sm reels-start', disabled: !st.items.length, onclick: () => start(false) }, icon('people'), 'Scroll together'),
        h('span', { class: 'reels-sub' }, others.length ? `${others.length === 1 ? deps.nameOf(others[0]) : `${others.length} others`} here now` : deps.inCall(st.key) ? 'Everyone in the call can join' : 'Starts for everyone viewing this tab'),
        st.br ? st.br.barItems() : null);
      return;
    }
    const people = s.following.filter((u) => u !== me);
    const host = s.by === me;
    add(st.bar, 
      h('div', { class: 'reels-avatars' }, s.following.slice(0, 5).map((u) => deps.avatar(deps.user(u), 22))),
      h('span', { class: 'reels-with' }, st.following ? withLine(people.map((u) => deps.nameOf(u))) : `${withLine(s.following.map((u) => deps.nameOf(u)))} (not you)`),
      s.hostOnly ? h('span', { class: 'reels-sub' }, `${host ? 'You' : deps.nameOf(s.by)} control${host ? '' : 's'}`) : null,
      host ? (() => {
        const sel = h('select', { class: 'input sm', 'aria-label': 'Who controls', onchange: (e) => deps.socket().emit('reels:mode', { key: st.key, hostOnly: e.target.value === 'me' }, () => {}) },
          h('option', { value: 'all' }, 'Everyone controls'), h('option', { value: 'me' }, 'Only I control'));
        sel.value = s.hostOnly ? 'me' : 'all';
        return sel;
      })() : null,
      st.following ? h('button', { class: 'btn ghost sm', onclick: () => follow_(false) }, 'Leave')
        : h('button', { class: 'btn primary sm', onclick: () => follow_(true) }, 'Rejoin'),
      host || !s.hostOnly ? h('button', { class: 'btn ghost sm danger-text', onclick: () => deps.socket().emit('reels:stop', { key: st.key }, (r) => r && r.error && toast(r.error, 'error')) }, 'Stop') : null,
      st.br ? st.br.barItems() : null);
    // Instagram on screen: no player to move, so a ready check and "start together".
    const cur = current();
    if (inSession() && cur && cur.p.kind === 'instagram' && isItem(cur, s.mid, s.i)) {
      const ready = s.ready.includes(me);
      add(st.bar, h('div', { class: 'reels-manual' },
        mayControl() ? h('button', { class: 'btn primary sm', onclick: () => control('play', 0, { together: true }) }, icon('play'), 'Start together') : null,
        h('button', { class: `btn ghost sm${ready ? ' active' : ''}`, 'aria-pressed': String(ready), onclick: () => deps.socket().emit('reels:ready', { key: st.key, mid: s.mid, i: s.i, ready: !ready }, () => {}) }, ready ? '✓ Ready' : 'I’m ready'),
        h('span', { class: 'reels-sub' }, `${s.ready.length} ready · Instagram can’t be controlled from here: press ▶ when the countdown ends`)));
    }
  }
  function drawSide() {
    if (!st) return;
    clear(st.side);
    st.side.classList.toggle('open', st.addOpen);
    const why = deps.canSend(st.key);
    const input = h('input', { class: 'input', placeholder: 'Paste a TikTok or Instagram link', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'TikTok or Instagram link' });
    const pv = deps.previewChoice();
    const box = h('input', { type: 'checkbox', checked: pv === 'always', disabled: pv === 'off' });
    const submit = async (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!parseSocialUrl(url)) return toast('That isn’t a link to one TikTok video or Instagram reel or post.', 'error');
      try { await deps.send(st.key, url, { preview: box.checked }); input.value = ''; st.addOpen = false; drawSide(); toast('Shared in the chat.'); } catch (x) { if (x && x.message) toast(x.message, 'error'); }
    };
    add(st.side, 
      h('div', { class: 'reels-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Newer video', 'data-tip': 'Newer (↑)', onclick: () => go(-1) }, icon('arrowUp')),
        h('span', { class: 'reels-pos' }, st.items.length ? `${st.index + 1} / ${st.items.length}${st.hasMore ? '+' : ''}` : '0'),
        h('button', { class: 'icon-btn', 'aria-label': 'Older video', 'data-tip': 'Older (↓)', onclick: () => go(1) }, icon('arrowDown'))),
      why ? h('p', { class: 'field-hint' }, why) : h('form', { class: 'reels-add', onsubmit: submit },
        h('span', { class: 'field-label' }, 'Add a link'),
        input,
        pv === 'off' ? null : h('label', { class: 'row gap tight field-hint' }, box, 'With a preview card (your Hearth server fetches the link)'),
        h('button', { class: 'btn primary sm', type: 'submit' }, 'Share'),
        h('span', { class: 'field-hint' }, 'It’s sent as a message here, encrypted like any other, so it shows in the chat too.')),
      st.loading ? h('p', { class: 'field-hint' }, 'Looking further back…') : null,
      h('p', { class: 'field-hint reels-limits' }, 'This feed is the videos shared in this conversation. TikTok’s For You and Instagram’s Reels feeds can’t be shown in other apps.'));
  }

  // ---- the app tells it what changed
  function onNew(key, m) {
    if (!st || st.key !== key || !m || m.threadId) return;
    st.msgs.set(m.id, m);
    const mine = m.authorId === deps.me();
    rebuild();
    // Your own new link: shown straight away (unless everyone's scrolling together, which decides where you are).
    if (mine && !inSession()) { const k = st.items.findIndex((x) => x.mid === m.id); if (k >= 0) scrollToIndex(k, false); }
  }
  // An edit: the feed changes only if its videos did (a fixed typo doesn't reload the one playing).
  function onUpdate(key, m) {
    if (!st || st.key !== key || !st.msgs.has(m.id)) return;
    const old = st.msgs.get(m.id);
    st.msgs.set(m.id, m);
    const vids = (x) => feedItems([x], { ok, text: deps.text }).map((it) => it.vid).join(' ');
    if (vids(old) === vids(m)) { for (const c of st.cards.values()) if (c._it.mid === m.id) { c._it = { ...c._it, m }; drawInfo(c); drawActions(c); } return; }
    rebuild();
  }
  function onDelete(key, ids) {
    if (!st || (key && st.key !== key)) return;
    let changed = false;
    for (const id of ids) if (st.msgs.delete(id)) changed = true;
    if (changed) rebuild();
  }
  function onReactions(mid, reactions) {
    if (!st) return;
    const m = st.msgs.get(mid);
    if (!m) return;
    m.reactions = reactions;
    for (const c of st.cards.values()) if (c._it.mid === mid) drawActions(c);
    if (st.br && current() && current().mid === mid) st.br.react(); // Brainrot mode: a little shake
  }
  // After a reconnect: back in the room, still following or not as this person chose.
  function rejoin() { if (st) deps.socket().emit('reels:join', { key: st.key, follow: !st.left }, (r) => { if (st && r && r.state) onState(r.state); }); }
  function setMode() { if (!st) return; drawCover(); for (const k of [...st.players.keys()]) dropPlayer(k); for (const c of st.cards.values()) drawPlaceholder(c); players(); }

  return {
    show, hide, onState, onNew, onUpdate, onDelete, onReactions, rejoin, setMode,
    key: () => (st ? st.key : null),
    // Tests and the app's checks: how many players are alive.
    stats: () => ({ players: st ? [...st.players.values()].filter((p) => !p.pending).length : 0, items: st ? st.items.length : 0, index: st ? st.index : -1 }),
  };
}
