// Photos & videos: a side panel listing every picture and video sent in a conversation (a DM, a group chat or a
// server channel), newest first, so nobody has to scroll up through the chat to find one.
//
// The server can't tell a picture from a PDF: the list of files is inside the encrypted message. So it hands over the
// messages that have files, a page at a time and newest first (GET /api/dms/:id/media, /api/channels/:id/media), and
// this app keeps the pictures and videos among them once it has decrypted them. A tag picked in the filter (tags are
// photo-notes.js's) shows every photo carrying it: the ones not paged in yet are asked for by id (?ids=).
//
// Everything the panel knows lives in one state object while it's open, outside the drawing. The app redraws its side
// panel often (people coming online or going Away, server updates); each of those puts the same elements back, where
// they were scrolled to, without asking the server again, and only what changed is drawn anew. Closing the panel lets
// go of it all (reset): opened again, it starts from the newest page.
//
// What it leaves out: voice messages, songs and other files; messages it can't read; people you blocked; messages the
// word filter hides (one it blurs is blurred here too); messages that disappeared. The app keeps it up to date (onNew,
// onUpdate, onDelete, onMeta for tags and photo comments) and hands it the disappearing timer's work (messages, expire).
import { h, icon, fmtSize } from './util.js';
import { mediaKind } from './files.js';
import { whenVisible } from './media.js';

export const PAGE = 30; // messages per page (the server's default)
export const IDS_MAX = 100; // ids per ?ids= request (the server's limit)
const MORE_WITHIN = 600; // px from the end of the grid at which the next page is asked for

// ---- what's shown, worked out without a page (test/media-panel-client.test.js)

// The pictures and videos among a message's files, with their place in its list (fi: what photo comments and tags
// name). Voice messages, songs and other files aren't shown.
export function mediaEntries(files) {
  const out = [];
  (Array.isArray(files) ? files : []).forEach((f, fi) => {
    if (!f || typeof f !== 'object' || f.voice) return;
    const kind = mediaKind(f.type, f.name);
    if (kind !== 'img' && kind !== 'video') return;
    out.push({ f, fi, kind, gif: kind === 'img' && (/^image\/gif$/i.test(f.type || '') || /\.gif$/i.test(f.name || '')) });
  });
  return out;
}

// Newest first: by when it was sent, then by id (two sent in the same millisecond keep one order everywhere).
export function newestFirst(a, b) {
  const t = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  if (t) return t;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// The month a message was sent in ("2026-10"), and its heading ("October 2026", in this browser's language).
export function monthOf(ts) {
  const d = new Date(Number(ts) || 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export const monthLabel = (ts, locale) => new Date(Number(ts) || 0).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

// Tiles in the order given (newest first), under their months: [{ month, label, items }].
export function byMonth(tiles, locale) {
  const out = [];
  for (const t of tiles) {
    const month = monthOf(t.m.createdAt);
    let g = out[out.length - 1];
    if (!g || g.month !== month) out.push(g = { month, label: monthLabel(t.m.createdAt, locale), items: [] });
    g.items.push(t);
  }
  return out;
}

// What the panel shows of these messages: their pictures and videos as tiles, newest first, each message's in the
// order they were sent.
//   files(m): the message's decrypted files;
//   view(m): 'show', 'blur' (the word filter blurs it), 'hide' (the word filter hides it) or null (not shown at all:
//   unreadable, gone, from someone you blocked);
//   kind: 'all', 'img' (Photos) or 'video' (Videos);
//   tagged: null, or the photos carrying the tag picked (a Set of "messageId:fileIdx", taggedSet).
// The ones the word filter hides come back apart (hidden): their thumbnails still load as if they were shown, so the
// server sees the same downloads either way.
export function pickTiles(messages, { files, view, kind = 'all', tagged = null }) {
  const tiles = [];
  const hidden = [];
  for (const m of [...messages].sort(newestFirst)) {
    const v = view(m);
    if (!v) continue;
    for (const e of mediaEntries(files(m))) {
      if (kind !== 'all' && e.kind !== kind) continue;
      if (tagged && !tagged.has(`${m.id}:${e.fi}`)) continue;
      (v === 'hide' ? hidden : tiles).push({ m, ...e, blur: v === 'blur' });
    }
  }
  return { tiles, hidden };
}

// The tag chips: every label used in the conversation (photo-notes.js tagIndex: label -> [{ messageId, fileIdx }])
// with how many photos carry it, the most used first, then A to Z.
export function tagChips(index) {
  const out = [];
  for (const [label, list] of index instanceof Map ? index : []) {
    const count = taggedSet(list).size;
    if (typeof label === 'string' && label && count) out.push({ label, count });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
export const taggedSet = (list) => new Set((Array.isArray(list) ? list : []).filter((x) => x && typeof x.messageId === 'string').map((x) => `${x.messageId}:${x.fileIdx}`));

// The messages a tag's photos are in that aren't here yet, in requests of at most 100 ids (and only ids the server
// takes: anything else would make the whole request fail).
export function idBatches(list, have = () => false) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map((x) => x && x.messageId))]
    .filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !have(id));
  const out = [];
  for (let i = 0; i < ids.length; i += IDS_MAX) out.push(ids.slice(i, i + IDS_MAX));
  return out;
}

// Where a conversation's pages come from: 'd:<dmId>' or 'c:<channelId>' (a group chat's is its text channel's).
export function mediaPath(key, params = {}) {
  const id = encodeURIComponent(String(key).slice(2));
  const base = String(key).startsWith('d:') ? `/dms/${id}/media` : `/channels/${id}/media`;
  const q = new URLSearchParams(params).toString();
  return q ? `${base}?${q}` : base;
}

// Every file address of these messages, thumbnails too (their decrypted copies are let go of when they're deleted).
export function fileUrls(msgs, files) {
  const out = [];
  for (const m of msgs) for (const f of files(m)) { if (f && f.url) out.push(f.url); if (f && f.th && f.th.url) out.push(f.th.url); }
  return out;
}

// ---- the panel
// deps (app.js fills them in):
//   key(): the conversation on screen; get(path): GET from the API; decrypt(m); known(id): a decrypted copy of that
//   message the app has loaded already, or null; files(m), readable(m), expired(m), disappears(m); blocked(userId);
//   veiled(m): what the word filter does to it (null, or { action: 'hide'|'blur', by }); filterLabel(wf); reveal(m)
//   ("Show" on a blurred one); thumb(m, f) and full(m, f): Promises of something to show; queue(fn): the app's shared
//   download queue; autoloadMax: pictures without a thumbnail load by themselves up to this size; open(tile,
//   { items, index }): the viewer; download(m, f); badges(m, fi) and tagIndex(key) (photo-notes.js); panelHead(title);
//   forget(msgs, ids, key): everything the app keeps of messages that disappeared; drop(urls): decrypted copies to let
//   go of; armExpiry(): look at the disappearing timer again.
export function createMediaPanel(deps) {
  let st = null; // the open panel's state, or null

  const fresh = (key) => ({
    key,
    msgs: new Map(), // id -> message (decrypted), from the pages, live, or fetched for a tag
    paged: new Set(), // ids that came in with the pages (or live): only those show without a tag picked
    next: null, done: false, loading: false, error: null,
    kind: 'all', tag: null, tagged: null, tags: null, tagJobs: 0, tagError: null,
    revealed: new Set(), // spoilers uncovered ("messageId:fileIdx")
    tiles: new Map(), // "messageId:fileIdx" -> { el, m, blur }: drawn tiles, put back as they are
    shadowed: new Set(), // thumbnails of hidden messages already loaded
    shown: [], sig: null, chipSig: null, scrollTop: 0,
    stale: new Set(), staleTimer: 0, tagTimer: 0, moreFrame: 0,
    parts: null,
  });

  // Is this message shown here, and how ('show', 'blur', 'hide' or null)? Asked at every drawing, so blocking someone,
  // a word filter change or a key arriving shows at once.
  const viewOf = (s, m) => {
    if (!deps.readable(m) || deps.expired(m) || deps.blocked(m.authorId)) return null;
    // One fetched only for a tag, older than the pages loaded so far: it shows once paging gets there.
    if (!s.tag && !s.paged.has(m.id)) return null;
    const wf = deps.veiled(m);
    return wf ? (wf.action === 'hide' ? 'hide' : 'blur') : 'show';
  };

  // Decrypts a page (reusing the app's own copy of a message it has loaded) and leaves out what has disappeared.
  async function take(messages) {
    const list = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.id === 'string');
    const out = await Promise.all(list.map(async (m) => {
      const known = deps.known(m.id);
      if (known) return known;
      try { await deps.decrypt(m); } catch { /* it can't be read here: left out (readable) */ }
      return m;
    }));
    const live = out.filter((m) => !deps.expired(m));
    if (live.some((m) => deps.disappears(m))) setTimeout(() => deps.armExpiry(), 0);
    return live;
  }

  async function load(s, older = false) {
    if (s.loading || (older && s.done)) return;
    s.loading = true;
    s.error = null;
    render(s);
    try {
      const res = await deps.get(mediaPath(s.key, { limit: String(PAGE), ...(older && s.next ? { before: s.next } : {}) }));
      const list = await take(res && res.messages);
      if (s !== st) return;
      for (const m of list) { s.msgs.set(m.id, m); s.paged.add(m.id); }
      s.next = (res && typeof res.next === 'string' && res.next) || null;
      s.done = !s.next;
    } catch (e) {
      if (s === st) s.error = (e && e.message) || 'Something went wrong.';
    } finally {
      if (s === st) {
        s.loading = false;
        render(s);
      }
    }
  }
  // The end of the grid is in sight (or there's too little to scroll): the next page. Looked at as the list is
  // scrolled, and once the grid has been drawn (a page that brought only PDFs, the Videos filter or a tag cleared can
  // leave too little to scroll).
  function more(s) {
    if (s !== st || s.tag || s.loading || s.done || s.error || !s.parts || !s.parts.scroll.isConnected) return;
    const sc = s.parts.scroll;
    if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < MORE_WITHIN) load(s, true);
  }
  const moreSoon = (s) => {
    if (s.moreFrame) return;
    s.moreFrame = requestAnimationFrame(() => { s.moreFrame = 0; more(s); });
  };

  // ---- tags (photo-notes.js): the chips, and the photos carrying the one picked
  async function loadTags(s) {
    if (!deps.tagIndex) return;
    let index = null;
    try { index = await deps.tagIndex(s.key); } catch { index = null; }
    if (s !== st) return;
    s.tags = index instanceof Map ? index : null;
    if (s.tag) {
      const list = s.tags && s.tags.get(s.tag);
      // Its last tag was taken off: nothing to filter by any more.
      if (!list || !taggedSet(list).size) { s.tag = null; s.tagged = null; s.tagError = null; } else { s.tagged = taggedSet(list); fetchTagged(s, list); }
    }
    render(s);
  }
  // Tags changed (onMeta): the chips again, a moment later (a few changes at once ask once).
  function tagsSoon(s) {
    clearTimeout(s.tagTimer);
    s.tagTimer = setTimeout(() => { if (s === st) loadTags(s); }, 400);
  }
  function pickTag(s, label) {
    s.tagError = null;
    if (s.tag === label) { s.tag = null; s.tagged = null; } else {
      const list = s.tags && s.tags.get(label);
      if (!list) return;
      s.tag = label;
      s.tagged = taggedSet(list);
      fetchTagged(s, list);
    }
    toTop(s);
    render(s);
  }
  async function fetchTagged(s, list) {
    const batches = idBatches(list, (id) => s.msgs.has(id));
    if (!batches.length) return;
    s.tagJobs++;
    s.tagError = null;
    render(s);
    try {
      for (const ids of batches) {
        const res = await deps.get(mediaPath(s.key, { ids: ids.join(',') }));
        const got = await take(res && res.messages);
        if (s !== st) return;
        for (const m of got) if (!s.msgs.has(m.id)) s.msgs.set(m.id, m);
      }
    } catch (e) {
      if (s === st) s.tagError = (e && e.message) || 'Something went wrong.';
    } finally {
      if (s === st) { s.tagJobs--; render(s); }
    }
  }

  // ---- drawing
  function build(s) {
    const seg = h('div', { class: 'seg mp-kinds', role: 'group', 'aria-label': 'Show' },
      [['all', 'All'], ['img', 'Photos'], ['video', 'Videos']].map(([k, label]) => h('button', {
        class: 'seg-btn', type: 'button', dataset: { kind: k },
        onclick: () => { if (s.kind === k) return; s.kind = k; toTop(s); render(s); },
      }, label)));
    const chips = h('div', { class: 'mp-tags', role: 'group', 'aria-label': 'Tags', hidden: true });
    const filters = h('div', { class: 'mp-filters' }, seg, chips);
    const grid = h('div', { class: 'mp-months' });
    const foot = h('div', { class: 'mp-foot' });
    const scroll = h('div', { class: 'mp-scroll', role: 'region', 'aria-label': 'Photos and videos' }, grid, foot);
    scroll.addEventListener('scroll', () => { if (s !== st) return; s.scrollTop = scroll.scrollTop; more(s); }, { passive: true });
    s.parts = { head: deps.panelHead('Photos & videos'), filters, seg, chips, scroll, grid, foot };
  }
  const toTop = (s) => { s.scrollTop = 0; if (s.parts) s.parts.scroll.scrollTop = 0; };

  function render(s) {
    if (s !== st || !s.parts) return;
    drawFilters(s);
    const { tiles, hidden } = pickTiles(s.msgs.values(), { files: deps.files, view: (m) => viewOf(s, m), kind: s.kind, tagged: s.tag ? s.tagged : null });
    s.shown = tiles;
    const sig = [s.kind, s.tag || '', s.loading, s.error || '', s.done, s.tagJobs > 0, s.tagError || '',
      tiles.map((t) => `${t.m.id}:${t.fi}:${t.blur ? 1 : 0}`).join(',')].join('|');
    if (sig === s.sig) return;
    s.sig = sig;
    const { scroll, grid } = s.parts;
    const top = s.scrollTop;
    const focused = grid.contains(document.activeElement) ? document.activeElement : null;
    grid.replaceChildren();
    // Thumbnails of the photos the word filter hides load as the tile after them comes near the screen.
    let shadows = [];
    for (const t of hidden) {
      const id = `${t.m.id}:${t.fi}`;
      if (t.kind !== 'img' || s.shadowed.has(id)) continue;
      const want = wanted(t);
      if (want) shadows.push(() => { if (s.shadowed.has(id)) return; s.shadowed.add(id); deps.queue(want).catch(() => {}); });
    }
    const keep = new Map();
    for (const g of byMonth(tiles)) {
      const box = h('div', { class: 'mp-grid' });
      for (const t of g.items) {
        const id = `${t.m.id}:${t.fi}`;
        const had = s.tiles.get(id);
        const el = had && had.m === t.m && had.blur === t.blur ? had.el : tileEl(s, t);
        keep.set(id, { el, m: t.m, blur: t.blur });
        box.append(el);
        if (shadows.length) { const run = shadows; shadows = []; whenVisible(el, () => run.forEach((fn) => fn())); }
      }
      grid.append(h('section', { class: 'mp-month', 'aria-label': g.label }, h('h3', { class: 'mp-month-name' }, g.label), box));
    }
    // (Tiles filtered out for now are kept for when they're back: Photos, then All again.)
    for (const [id, v] of s.tiles) if (!keep.has(id) && s.msgs.get(v.m.id) === v.m) keep.set(id, v);
    s.tiles = keep;
    drawFoot(s, tiles.length);
    if (shadows.length) { const run = shadows; whenVisible(s.parts.foot, () => run.forEach((fn) => fn())); }
    scroll.scrollTop = top;
    if (focused && focused.isConnected) focused.focus({ preventScroll: true });
    moreSoon(s);
  }

  function drawFilters(s) {
    const { seg, chips } = s.parts;
    for (const b of seg.children) { const on = b.dataset.kind === s.kind; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
    const list = tagChips(s.tags);
    const sig = `${s.tag || ''}\u0000${list.map((c) => `${c.label}\u0001${c.count}`).join('\u0000')}`;
    if (sig === s.chipSig) return;
    s.chipSig = sig;
    const had = chips.contains(document.activeElement) ? document.activeElement.closest('[data-label]') : null;
    const again = had ? had.dataset.label : null;
    chips.replaceChildren();
    chips.hidden = !list.length;
    for (const c of list) {
      const on = s.tag === c.label;
      const name = h('button', {
        class: on ? 'mp-tag-name' : 'chip mp-tag', type: 'button', 'aria-pressed': String(on), dataset: { label: c.label },
        'aria-label': `#${c.label}, ${c.count} ${c.count === 1 ? 'photo' : 'photos'}`, onclick: () => pickTag(s, c.label),
      }, h('span', { class: 'mp-tag-label' }, `#${c.label}`), h('span', { class: 'mp-tag-n', 'aria-hidden': 'true' }, String(c.count)));
      chips.append(on ? h('span', { class: 'chip active mp-tag' }, name,
        h('button', { class: 'chip-x', type: 'button', 'aria-label': `Show all, not only #${c.label}`, onclick: () => pickTag(s, c.label) }, icon('close'))) : name);
    }
    if (again) { const b = [...chips.querySelectorAll('[data-label]')].find((x) => x.dataset.label === again); if (b) b.focus({ preventScroll: true }); }
  }

  function drawFoot(s, count) {
    const { foot } = s.parts;
    foot.replaceChildren();
    const busy = () => h('div', { class: 'panel-loading mp-loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Loading…'));
    const failed = (text, retry) => [h('p', { class: 'sidebar-empty' }, text), h('button', { class: 'btn ghost sm', type: 'button', onclick: retry }, 'Try again')];
    const empty = (text) => h('div', { class: 'panel-empty' }, icon('images'), h('p', null, text));
    if (s.tag) {
      if (s.tagJobs > 0) foot.append(busy());
      else if (s.tagError) foot.append(...failed(s.tagError, () => fetchTagged(s, s.tags && s.tags.get(s.tag))));
      else if (!count) foot.append(empty(`No photos tagged #${s.tag} to show here.`));
      return;
    }
    if (s.loading) foot.append(busy());
    else if (s.error) foot.append(...failed(s.error, () => load(s, s.msgs.size > 0)));
    // (Normally the next page comes as the end of the grid scrolls into view; this is for when it doesn't.)
    else if (!s.done) foot.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => load(s, true) }, 'Show older'));
    else if (!count) {
      foot.append(empty(s.kind === 'video' ? 'No videos here yet.' : s.kind === 'img' ? 'No photos here yet.'
        : 'No photos or videos here yet. Pictures and videos sent in this conversation show up here.'));
    }
  }

  // What a picture's tile loads by itself: its thumbnail, or a small picture without one (a GIF, say), whole. A big one
  // without a thumbnail waits to be opened.
  const wanted = (t) => (t.f.th ? () => deps.thumb(t.m, t.f) : (Number(t.f.size) || 0) > 0 && t.f.size <= deps.autoloadMax ? () => deps.full(t.m, t.f) : null);

  // A tile: a button that opens the viewer, with the picture (or a video's sign) in it, and around it the GIF label, the
  // photo's badges (photo-notes.js) and, over a spoiler or a blurred photo, the cover that uncovers it.
  function tileEl(s, t) {
    const { m, f, fi, kind } = t;
    const gid = `${m.id}:${fi}`;
    const label = f.alt || f.name || (kind === 'video' ? 'video' : 'picture');
    const open = h('button', { class: 'mp-open', type: 'button', 'aria-label': kind === 'video' ? `Open ${label} (video)` : `Open ${label}` });
    // (Not data-mid: that's for message rows only, which the app redraws by it.)
    const tile = h('div', { class: `mp-tile ${kind}`, dataset: { gid } }, open);
    if (kind === 'img') {
      const img = h('img', { class: 'mp-img', alt: '', draggable: 'false' });
      open.append(img);
      const want = wanted(t);
      if (want) {
        whenVisible(tile, () => {
          tile.classList.add('loading');
          deps.queue(want).then((u) => { img.src = u; tile.classList.remove('loading'); })
            .catch((e) => {
              tile.classList.remove('loading');
              const gone = !!e && e.code === 'gone';
              tile.classList.add(gone ? 'gone' : 'failed');
              img.remove();
              open.append(h('span', { class: 'mp-ph' }, icon(gone ? 'file' : 'image'), h('span', { class: 'mp-size' }, gone ? 'No longer available' : 'Couldn’t load')));
            });
        });
      } else open.append(h('span', { class: 'mp-ph' }, icon('image'), h('span', { class: 'mp-size' }, fmtSize(Number(f.size) || 0))));
      if (t.gif) tile.append(h('span', { class: 'mp-gif', 'aria-hidden': 'true' }, 'GIF'));
    } else {
      // No poster: a video's tile shows what it is and how big, and nothing downloads until it's opened.
      open.append(h('span', { class: 'mp-ph' }, icon('play', 'ic mp-play'), Number(f.size) > 0 ? h('span', { class: 'mp-size' }, fmtSize(Number(f.size))) : null));
    }
    const badges = deps.badges ? deps.badges(m, fi) : null;
    if (badges) tile.append(h('span', { class: 'mp-badges' }, badges));
    const cover = (cls, aria, text, onclick) => {
      tile.classList.add(cls);
      open.tabIndex = -1; // (the cover is what the keyboard reaches, as in the chat)
      const b = h('button', { class: 'mp-cover', type: 'button', 'aria-label': aria, onclick }, icon('eyeOff'), h('span', null, text));
      tile.append(b);
      return b;
    };
    if (f.sp && !s.revealed.has(gid)) {
      // A spoiler: blurred under a cover until it's clicked (its thumbnail still loads behind it, as in the chat).
      const b = cover('spoiler', `Spoiler ${kind === 'video' ? 'video' : 'picture'}, select to show`, 'Spoiler', () => {
        s.revealed.add(gid);
        tile.classList.add('revealed');
        b.remove();
        open.tabIndex = 0;
        open.focus({ preventScroll: true });
      });
    } else if (t.blur) {
      // Blurred by the word filter: Show shows the message, here and in the chat (as its Show does there).
      const wf = deps.veiled(m);
      cover('veiled', `${wf ? deps.filterLabel(wf) : 'Blurred'}. Show`, 'Show', () => { deps.reveal(m); render(s); });
    }
    open.addEventListener('click', () => openAt(s, gid, open));
    return tile;
  }

  // The viewer, on this tile: left and right go through what the panel shows now (the filter's list), videos too, but
  // not past spoilers or blurred photos nobody has uncovered.
  function openAt(s, gid, from) {
    const covered = (t) => (t.f.sp && !s.revealed.has(`${t.m.id}:${t.fi}`)) || t.blur;
    const list = s.shown.filter((t) => `${t.m.id}:${t.fi}` === gid || !covered(t));
    const index = list.findIndex((t) => `${t.m.id}:${t.fi}` === gid);
    if (index < 0) return;
    deps.open(from, { items: list.map((t) => itemOf(s, t)), index });
  }
  const itemOf = (s, t) => ({
    m: t.m, f: t.f, fi: t.fi, key: s.key, kind: t.kind,
    thumb: t.kind === 'img' && t.f.th ? () => deps.thumb(t.m, t.f) : null,
    full: () => deps.full(t.m, t.f),
    name: t.f.name || (t.kind === 'video' ? 'Video' : 'Image'),
    alt: t.f.alt || '',
    download: () => deps.download(t.m, t.f),
  });

  // A message's tiles are drawn again at the next drawing.
  function dropTiles(s, id) {
    for (const k of [...s.tiles.keys()]) if (k.startsWith(`${id}:`)) s.tiles.delete(k);
    s.sig = null;
  }
  function remove(s, gone) {
    for (const m of gone) { s.msgs.delete(m.id); s.paged.delete(m.id); dropTiles(s, m.id); }
  }

  // A message's tags or photo comment counts changed, and the app has no copy of it to take them from: asked for again
  // (a few at once), keeping what it was decrypted to.
  function refetch(s, id) {
    s.stale.add(id);
    clearTimeout(s.staleTimer);
    s.staleTimer = setTimeout(async () => {
      const ids = [...s.stale].filter((x) => s.msgs.has(x));
      s.stale.clear();
      for (const batch of idBatches(ids.map((messageId) => ({ messageId })))) {
        try {
          const res = await deps.get(mediaPath(s.key, { ids: batch.join(',') }));
          if (s !== st) return;
          for (const x of (res && res.messages) || []) {
            const had = x && s.msgs.get(x.id);
            if (!had) continue;
            had.tags = x.tags; had.fileReplies = x.fileReplies;
            dropTiles(s, x.id);
          }
          render(s);
        } catch { /* the counts stay as they were until the next change */ }
      }
    }, 300);
  }

  // Closed, signed out, or the conversation is no longer there.
  function reset() {
    const s = st;
    if (!s) return;
    st = null;
    clearTimeout(s.staleTimer);
    clearTimeout(s.tagTimer);
    if (s.moreFrame) cancelAnimationFrame(s.moreFrame);
    if (s.parts) for (const p of [s.parts.head, s.parts.filters, s.parts.scroll]) p.remove();
  }

  return {
    // The panel's content, into #members (app.js renderPanel, which has emptied it). The same conversation as before:
    // the same elements, scrolled where they were.
    draw(el) {
      const key = deps.key();
      if (!key) return;
      if (!st || st.key !== key) {
        reset();
        st = fresh(key);
        build(st);
        load(st);
        loadTags(st);
      }
      const s = st;
      const { head, filters, scroll } = s.parts;
      el.append(head, filters, scroll);
      render(s);
      scroll.scrollTop = s.scrollTop;
      moreSoon(s);
    },
    // A new message (decrypted): its pictures and videos go on top.
    onNew(key, m) {
      const s = st;
      if (!s || s.key !== key || !m || typeof m.id !== 'string' || s.msgs.has(m.id)) return;
      if (!mediaEntries(deps.files(m)).length || deps.expired(m)) return;
      s.msgs.set(m.id, m);
      s.paged.add(m.id);
      render(s);
    },
    // An edited message: decrypted again (its words may change what the word filter does to it).
    async onUpdate(key, m) {
      const s = st;
      if (!s || s.key !== key || !m || !s.msgs.has(m.id)) return;
      try { await deps.decrypt(m); } catch { /* left out as unreadable */ }
      if (s !== st || !s.msgs.has(m.id)) return;
      s.msgs.set(m.id, m);
      dropTiles(s, m.id);
      render(s);
    },
    // Messages deleted or disappeared (key null: wherever they were). Their tiles go, and so do their decrypted copies.
    onDelete(key, ids) {
      const s = st;
      if (!s || (key && s.key !== key)) return;
      const gone = [...new Set(typeof ids === 'string' ? [ids] : ids || [])].map((id) => s.msgs.get(id)).filter(Boolean);
      if (!gone.length) return;
      remove(s, gone);
      deps.drop(fileUrls(gone, deps.files));
      render(s);
    },
    // A message's tags or photo comment counts changed (photo-notes.js): its badges, and the tag chips.
    onMeta(key, messageId) {
      const s = st;
      if (!s || s.key !== key) return;
      tagsSoon(s);
      const had = s.msgs.get(messageId);
      if (!had) return;
      const known = deps.known(messageId);
      if (known && known !== had) s.msgs.set(messageId, known);
      else if (!known) refetch(s, messageId);
      dropTiles(s, messageId);
      render(s);
    },
    // The messages it holds (the app's disappearing timer counts them in).
    messages() { return st ? [...st.msgs.values()] : []; },
    // The disappearing timer went off: those whose time has come go, with everything the app kept of them.
    expire() {
      const s = st;
      if (!s) return;
      const gone = [...s.msgs.values()].filter((m) => deps.expired(m));
      if (!gone.length) return;
      remove(s, gone);
      deps.forget(gone, new Set(gone.map((m) => m.id)), s.key);
      render(s);
    },
    reset,
  };
}
