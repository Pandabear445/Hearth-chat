// The side view ("Pinned to side"): messages and pictures someone pinned to a panel at the side, which stays open while
// they chat elsewhere, so they can look at a message or a picture and keep talking. A message pins with its words and
// its pictures (small); a picture pins on its own, as wide as the panel.
//
// It's personal and stays on this device: the list (hearth.sideview.<userId>, at most MAX_ITEMS) says only which
// messages, in which conversation, and when they were pinned. It never goes to the server, and signing out clears it
// with the other local copies (usability.js clearLocalCopies). What a card shows is fetched and decrypted here like the
// chat's own messages: the chat's copy when it has one, else the message is located (GET /messages/:id/locate) and the
// page around it in its conversation asked for (?around=), then decrypted.
//
// Everything the open panel knows lives in one state object, outside the drawing. The app redraws its side panel often
// (people coming online or going Away, switching conversations); each of those puts the same cards back where they were,
// asking the server nothing, and only a card whose message changed (an edit, a block, the word filter, sharing your
// screen) is drawn anew. Closing the panel lets go of it all (reset); the list stays.
//
// It keeps up with what happens (the app calls onUpdate, onDelete, onKeys, expire, refresh): an edit shows, a deleted
// or disappeared message says it's no longer available (its decrypted files go), and so does one in a conversation
// you're no longer in, and a flag the chat's copies turn up shows on its card too. Items from DMs and group chats are
// covered while you share your screen.
import { h, icon, fmtSize } from './util.js';
import { whenVisible } from './media.js';
import { mediaEntries } from './media-panel.js';

export const MAX_ITEMS = 25; // the most kept: pinning one more takes the oldest off
const FILES_MAX = 100; // a message has at most this many files (attachments.js), so a picture's place is below it
const LOADS_AT_ONCE = 2; // messages located and fetched at the same time, so a full list doesn't come as a burst
const GONE_MAX = 2000; // ids of deleted messages remembered (onDelete), so that no copy of one shows again

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[cd]:[A-Za-z0-9_-]{1,64}$/;

// ---- the list, worked out without a page (test/side-view-client.test.js)

// Where this account's list is kept in this browser.
export const storageKey = (userId) => `hearth.sideview.${userId}`;
// One item's id: the message's, or "messageId:fileIdx" for one of its pictures (the same as Photos & videos' tiles).
export const itemId = (messageId, fileIdx = null) => (fileIdx == null ? String(messageId) : `${messageId}:${fileIdx}`);
const idOf = (it) => itemId(it.messageId, it.fileIdx);

// An item as it's kept, { key, messageId, fileIdx, at }, or null when it isn't one: key is the conversation
// ('d:<dmId>' or 'c:<channelId>'), fileIdx the picture's place among the message's files (null: the whole message), at
// when it was pinned. A copy still being sent ("pending-…") isn't a message yet.
export function cleanItem(x) {
  if (!x || typeof x !== 'object') return null;
  const { key, messageId } = x;
  if (typeof key !== 'string' || !KEY.test(key) || typeof messageId !== 'string' || !ID.test(messageId) || messageId.startsWith('pending-')) return null;
  const fileIdx = x.fileIdx == null ? null : x.fileIdx;
  if (fileIdx !== null && !(Number.isInteger(fileIdx) && fileIdx >= 0 && fileIdx < FILES_MAX)) return null;
  const at = Number(x.at);
  return { key, messageId, fileIdx, at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0 };
}

// The list as stored (its JSON, or what it parsed to), read back: well-formed items only, each once, the most recently
// pinned first, at most MAX_ITEMS. Anything else (another version's leftovers, a hand edit) is left out.
export function readItems(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const it = cleanItem(x);
    if (!it || seen.has(idOf(it))) continue;
    seen.add(idOf(it));
    out.push(it);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
}

// One more on top. Already there: nothing changes (already). Over MAX_ITEMS: the oldest come off (dropped).
export function addItem(list, item, now = Date.now()) {
  const it = cleanItem({ ...item, at: now });
  if (!it) return { list, added: null, dropped: [], already: false };
  if (list.some((x) => idOf(x) === idOf(it))) return { list, added: null, dropped: [], already: true };
  const next = [it, ...list];
  return { list: next.slice(0, MAX_ITEMS), added: it, dropped: next.slice(MAX_ITEMS), already: false };
}
export const removeItem = (list, id) => list.filter((x) => idOf(x) !== id);

// The conversation the server says a message is in (GET /messages/:id/locate), as a key, or null.
export function keyOfLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  if (loc.kind === 'dm' && typeof loc.dmId === 'string' && ID.test(loc.dmId)) return 'd:' + loc.dmId;
  if (loc.kind === 'channel' && typeof loc.channelId === 'string' && ID.test(loc.channelId)) return 'c:' + loc.channelId;
  return null;
}
// The page around a message: in its conversation, or in its thread for a reply in one (threadId).
export function aroundPath(key, messageId, threadId = null) {
  const around = `around=${encodeURIComponent(messageId)}`;
  if (threadId) return `/messages/${encodeURIComponent(threadId)}/thread?${around}`;
  const id = encodeURIComponent(String(key).slice(2));
  return String(key).startsWith('d:') ? `/dms/${id}/messages?${around}` : `/channels/${id}/messages?${around}`;
}

// What a card shows of a message's files. A picture pinned on its own: that one, while it's still a picture or a video
// there. A whole message: its pictures and videos (media), and the rest by name (other: files, voice messages).
export function shownFiles(files, fileIdx = null) {
  const list = Array.isArray(files) ? files : [];
  const media = mediaEntries(list);
  if (fileIdx != null) return { media: media.filter((e) => e.fi === fileIdx), other: [] };
  const taken = new Set(media.map((e) => e.fi));
  const other = [];
  list.forEach((f, fi) => { if (f && typeof f === 'object' && !taken.has(fi)) other.push({ f, fi, voice: !!f.voice }); });
  return { media, other };
}

// Where an item is from, in words: "#general · Indie Game Club", "DM with maya", or a group chat's name.
export function placeLabel(p) {
  if (!p || typeof p !== 'object') return '';
  if (p.dm != null) return `DM with ${p.dm}`;
  if (p.group != null) return String(p.group);
  return [p.channel, p.server].filter((x) => x != null && x !== '').join(' · ');
}

// Every file address of these messages, thumbnails too (their decrypted copies are let go of when they're deleted).
export function fileUrlsOf(msgs, files) {
  const out = [];
  for (const m of msgs) for (const f of files(m)) { if (f && f.url) out.push(f.url); if (f && f.th && f.th.url) out.push(f.th.url); }
  return out;
}

// ---- the panel
// deps (app.js fills them in):
//   userId(): who's signed in; storage: where the list is kept (localStorage);
//   get(path): GET from the API; decrypt(m); known(id): a decrypted copy of that message the app has already, or null;
//   keyOf(m): its conversation; files(m), readable(m), expired(m), disappears(m); blocked(userId); veiled(m): what the
//   word filter does to it (null, or { action }); filterLabel(wf); reveal(m) ("Show" on one the filter hides);
//   place(key): { label, kind: 'dm'|'group'|'channel', private } for a conversation you're in, else null;
//   hidden(key): is it covered now (sharing your screen); author(m): its author's avatar and name, as its row in the
//   chat shows them; trust(m): what that row says about who could have written it and where the server put it,
//   { sig, flags({ warnings }) } (app.js messageTrust: flags are elements, warnings the ones a hidden row keeps too,
//   sig all of it as a string); stamp(ts); textEl(m): its words as the chat draws them, or null;
//   thumb(m, f) and full(m, f): Promises of something to show; queue(fn, { front }): the app's download queue;
//   autoloadMax: a picture pinned on its own loads in full by itself up to this size; thumbMax: a message's pictures
//   without a thumbnail load by themselves up to this size; open(from, { items, index }): the viewer; download(m, f);
//   jump(item, m): go to it in the chat; panelHead(title, sub); show(): open the panel (pinning does); changed(): the
//   count changed (the header's button); toast(text); forget(msgs, ids, key): everything the app keeps of messages that
//   disappeared; drop(urls): decrypted copies to let go of; armExpiry(): look at the disappearing timer again.
export function createSideView(deps) {
  const store = () => deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  let items = null; // this account's list (read when first needed)
  let owner = null; // whose list that is
  let st = null; // the open panel's state, or null
  // The message just pinned, as the app had it: the panel's next drawing takes it rather than asking for it again. Only
  // that once (render lets go of it): kept any longer, it would come before fresher copies after a reconnect or the
  // panel closing, so an edit or a delete missed meanwhile would never show.
  let seed = null;
  // Messages deleted or disappeared (onDelete), with the thread replies that went with their thread's first message: a
  // copy of one still held somewhere is never shown again. Kept while the panel is closed too (an id is never reused).
  const deleted = new Set();
  const remember = (ids) => {
    for (const id of ids) { deleted.delete(id); deleted.add(id); }
    while (deleted.size > GONE_MAX) deleted.delete(deleted.values().next().value);
  };
  const isDeleted = (m) => deleted.has(m.id) || (!!m.threadId && deleted.has(m.threadId));

  function list() {
    const u = deps.userId();
    if (!u) return [];
    if (items === null || owner !== u) {
      owner = u;
      let raw = null;
      try { const s = store(); raw = s ? s.getItem(storageKey(u)) : null; } catch { raw = null; }
      items = readItems(raw);
    }
    return items;
  }
  function save(next) {
    items = next;
    try {
      const s = store();
      if (s) { if (next.length) s.setItem(storageKey(owner), JSON.stringify(next)); else s.removeItem(storageKey(owner)); }
    } catch { /* full or blocked: it lasts until this page closes */ }
  }
  const pinnedNow = (id) => list().some((x) => idOf(x) === id);

  // Another tab of this browser pinned or unpinned something: the list again, here too.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
      if (!owner || (e.key !== null && e.key !== storageKey(owner))) return;
      items = null;
      if (st) render(st);
      deps.changed();
    });
  }

  const fresh = () => ({
    parts: null,
    msgs: new Map(), // messageId -> { state: 'loading'|'ok'|'gone'|'error', m, error, update }
    cards: new Map(), // item id -> { el, sig, m }: drawn cards, put back as they are
    revealed: new Set(), // spoilers uncovered ("messageId:fileIdx")
    shown: new Set(), // messages from someone you blocked shown anyway (Show)
    queue: [], active: 0,
    scrollTop: 0,
  });

  // A decrypted copy of this message the app has (the chat's, or the one just pinned), in the item's conversation,
  // not deleted and not past its time. Else null.
  const copyOf = (it) => {
    const id = it.messageId;
    const m = (seed && seed.id === id ? seed : null) || deps.known(id) || null;
    return m && m.dec && deps.keyOf(m) === it.key && !deps.expired(m) && !isDeleted(m) ? m : null;
  };
  const armIf = (msgs) => { if (msgs.some((m) => deps.disappears(m))) setTimeout(() => deps.armExpiry(), 0); };

  // ---- loading
  function want(s, it) {
    const id = it.messageId;
    if (s.msgs.has(id)) return;
    if (deleted.has(id)) { s.msgs.set(id, { state: 'gone', m: null }); return; }
    const known = copyOf(it);
    if (known) { s.msgs.set(id, { state: 'ok', m: known }); armIf([known]); return; }
    const rec = { state: 'loading', m: null, key: it.key };
    s.msgs.set(id, rec);
    s.queue.push({ it, rec });
    pump(s);
  }
  function pump(s) {
    while (s === st && s.active < LOADS_AT_ONCE && s.queue.length) {
      const { it, rec } = s.queue.shift();
      if (s.msgs.get(it.messageId) !== rec || rec.state !== 'loading') continue; // (came with another one's page)
      s.active++;
      fetchOne(s, it, rec).finally(() => { s.active--; pump(s); });
    }
  }
  // Located, then the page around it (in its conversation or its thread), then decrypted. Other pinned messages on that
  // page are taken from it too, so nothing is asked for twice. Gone: deleted, past its time, from before your history
  // there starts, or in a conversation you're no longer in (the server answers 404 for all of them), or somewhere other
  // than where it was pinned.
  async function fetchOne(s, it, rec) {
    const live = () => s === st && s.msgs.get(it.messageId) === rec && rec.state === 'loading';
    const gone = () => { rec.state = 'gone'; rec.m = null; };
    try {
      let loc;
      try { loc = await deps.get(`/messages/${encodeURIComponent(it.messageId)}/locate`); } catch (e) {
        if (e && (e.status === 404 || e.status === 403)) { if (live()) gone(); return; }
        throw e;
      }
      if (!live()) return;
      if (keyOfLocation(loc) !== it.key) { gone(); return; }
      const res = await deps.get(aroundPath(it.key, it.messageId, typeof loc.threadId === 'string' && ID.test(loc.threadId) ? loc.threadId : null));
      if (!live()) return;
      const page = [...(res && Array.isArray(res.messages) ? res.messages : []), ...(res && res.root ? [res.root] : [])]
        .filter((m) => m && typeof m.id === 'string');
      const found = page.find((m) => m.id === it.messageId);
      if (!found || deps.keyOf(found) !== it.key) { gone(); return; }
      const others = page.filter((m) => m !== found && s.msgs.has(m.id) && s.msgs.get(m.id).state === 'loading' && deps.keyOf(m) === s.msgs.get(m.id).key);
      const opened = new Map(); // message id -> the copy decrypted for it
      await Promise.all([found, ...others].map(async (m) => {
        const r = s.msgs.get(m.id);
        // An edit that came while it was on its way (onUpdate): that version.
        const use = (r && r.update) || m;
        try { await deps.decrypt(use); } catch { /* unreadable here: said so on its card */ }
        opened.set(m.id, use);
      }));
      if (s !== st) return;
      const took = [];
      for (const [id, got] of opened) {
        // (Not one deleted meanwhile, nor one another page brought first.)
        const r = s.msgs.get(id);
        if (!r || r.state !== 'loading') continue;
        delete r.update;
        if (deps.expired(got) || isDeleted(got)) { r.state = 'gone'; r.m = null; continue; }
        r.state = 'ok'; r.m = got;
        took.push(got);
      }
      armIf(took);
    } catch (e) {
      if (live()) { rec.state = 'error'; rec.error = (e && e.message) || 'Something went wrong.'; }
    } finally {
      if (s === st) render(s);
    }
  }

  // ---- drawing
  function build(s) {
    const listEl = h('div', { class: 'sv-list', role: 'list', 'aria-label': 'Pinned to side' });
    const empty = h('div', { class: 'panel-empty sv-empty', hidden: true }, icon('sidebar'),
      h('p', null, 'Nothing pinned to the side yet. Pick “Pin to side” on a message or a picture to keep it here while you chat anywhere else.'));
    const scroll = h('div', { class: 'sv-scroll' }, listEl, empty);
    scroll.addEventListener('scroll', () => { if (s === st) s.scrollTop = scroll.scrollTop; }, { passive: true });
    s.parts = { head: deps.panelHead('Pinned to side', 'Only on this device'), scroll, listEl, empty };
  }

  // How a card shows now, and the signature of that: the card is drawn again only when it changes. It only looks:
  // whatever has to change first (a message whose time came, one in a conversation you left) render has done.
  // (Spoilers uncovered aren't in it: a cover goes from the card itself, and a card drawn anew asks s.revealed.)
  function viewOf(s, it) {
    if (deps.hidden(it.key)) return { kind: 'hidden', sig: 'hidden' };
    const place = deps.place(it.key);
    if (!place) return { kind: 'gone', sig: 'gone' };
    const rec = s.msgs.get(it.messageId);
    if (!rec || rec.state === 'loading') return { kind: 'loading', sig: 'loading' };
    if (rec.state === 'error') return { kind: 'error', sig: `error|${rec.error}`, error: rec.error };
    const m = rec.m;
    if (rec.state !== 'ok' || !m || deps.expired(m) || isDeleted(m)) return { kind: 'gone', sig: `gone|${place.label}`, place };
    const blocked = deps.blocked(m.authorId) && !s.shown.has(m.id);
    const wf = blocked ? null : deps.veiled(m);
    const ok = deps.readable(m);
    // What its row in the chat says about who could have written it, in the signature too: that can change while the
    // message doesn't (a copy loaded elsewhere turns up a binding issue, a key arrives; the app calls refresh or onKeys).
    // One from someone you blocked shows nothing of the message, as in the chat.
    const trust = blocked ? null : deps.trust(m);
    return { kind: 'ok', m, place, blocked, wf, ok, trust, sig: ['ok', place.label, place.kind, blocked ? 1 : 0, wf ? wf.action : '', ok ? 1 : 0, trust ? trust.sig : ''].join('|') };
  }

  // Messages held whose time has come: gone, with everything the app kept of them (deps.forget). Before any drawing as
  // well as on the timer's pass (expire), whichever comes first: a drawing that only said they're gone would leave
  // their decrypted files behind, the timer then finding nothing to forget (a background tab's timers run late).
  function expireDue(s) {
    const gone = [];
    for (const rec of s.msgs.values()) if (rec.state === 'ok' && rec.m && deps.expired(rec.m)) { gone.push(rec.m); rec.state = 'gone'; rec.m = null; }
    if (!gone.length) return false;
    remember(gone.map((m) => m.id));
    deps.forget(gone, new Set(gone.map((m) => m.id)), null);
    return true;
  }

  function render(s) {
    if (s !== st || !s.parts) return;
    const all = list();
    expireDue(s);
    for (const it of all) {
      // A conversation you're no longer in (you left the group or the server, or the DM went): nothing of it shows, and
      // the copy held goes (should you be back in it, it's asked for again).
      if (deps.place(it.key)) want(s, it); else s.msgs.delete(it.messageId);
    }
    seed = null; // (taken, or not wanted: either way its one drawing is done)
    const { listEl, empty } = s.parts;
    const keep = new Map();
    const els = [];
    for (const it of all) {
      const id = idOf(it);
      const v = viewOf(s, it);
      const had = s.cards.get(id);
      const el = had && had.sig === v.sig && had.m === (v.m || null) ? had.el : cardEl(s, it, v);
      keep.set(id, { el, sig: v.sig, m: v.m || null });
      els.push(el);
    }
    s.cards = keep;
    const focused = listEl.contains(document.activeElement) ? document.activeElement : null;
    const focusedCard = focused && focused.closest ? focused.closest('.sv-card') : null;
    // Only cards out of place move (a card moved would stop a video playing in it, and lose the hover).
    let ref = listEl.firstChild;
    for (const el of els) {
      if (el === ref) { ref = ref.nextSibling; continue; }
      listEl.insertBefore(el, ref);
    }
    while (ref) { const next = ref.nextSibling; ref.remove(); ref = next; }
    empty.hidden = all.length > 0;
    // The keyboard focus stays where it was, or goes to the same card drawn anew.
    if (focused && !focused.isConnected && focusedCard) {
      const again = els.find((el) => el.dataset.sid === focusedCard.dataset.sid);
      const b = again && again.querySelector('button');
      if (b) b.focus({ preventScroll: true });
    }
    // Unused copies of messages no longer pinned go (a message pinned again comes back from the app or the server).
    const wanted = new Set(all.map((it) => it.messageId));
    for (const id of [...s.msgs.keys()]) if (!wanted.has(id) && s.msgs.get(id).state !== 'loading') s.msgs.delete(id);
  }

  function cardEl(s, it, v) {
    const id = idOf(it);
    // (Not data-mid: that's for message rows only, which the app redraws by it.)
    const card = h('article', { class: `sv-card ${v.kind}${it.fileIdx != null ? ' picture' : ''}`, dataset: { sid: id }, role: 'listitem' });
    const x = ibtn('close', 'Unpin from side', () => unpinFrom(id), 'sv-x');
    if (v.kind === 'hidden') {
      card.append(h('div', { class: 'sv-note' }, icon('eyeOff'), h('span', null, 'Hidden while you share your screen.')), x);
      return card;
    }
    if (v.kind === 'loading') {
      card.append(h('div', { class: 'sv-note' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Loading…')), x);
      return card;
    }
    if (v.kind === 'error') {
      card.append(h('div', { class: 'sv-note' }, h('span', null, `Couldn’t load this message: ${v.error}`)),
        h('div', { class: 'sv-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { s.msgs.delete(it.messageId); render(s); } }, 'Try again'), x));
      return card;
    }
    if (v.kind === 'gone') {
      card.append(h('div', { class: 'sv-note' }, icon('file'), h('span', null, 'This message is no longer available')),
        v.place ? h('div', { class: 'sv-where' }, v.place.label) : null, x);
      return card;
    }
    const { m, place } = v;
    const head = h('div', { class: 'sv-meta' }, v.blocked ? null : deps.author(m), h('span', { class: 'sv-when' }, deps.stamp(m.createdAt)));
    const where = h('div', { class: 'sv-where' }, icon(place.kind === 'dm' ? 'user' : place.kind === 'group' ? 'people' : 'hash'), h('span', null, place.label));
    const body = h('div', { class: 'sv-body' });
    if (v.blocked) {
      body.append(h('p', { class: 'sv-veil' }, icon('ban'), 'Message from someone you blocked. ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => { s.shown.add(m.id); render(s); } }, 'Show')));
    } else if (v.wf) {
      body.append(h('p', { class: 'sv-veil' }, h('em', null, deps.filterLabel(v.wf)), ' ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => { deps.reveal(m); render(s); } }, 'Show')));
    } else if (!v.ok) {
      body.append(h('p', { class: 'sv-veil' }, h('em', null, m.dec && m.dec.pending ? 'Waiting for this message’s key…' : 'This message can’t be read here.')));
    } else {
      const words = it.fileIdx == null || (m.dec && m.dec.t) ? deps.textEl(m) : null;
      if (words) body.append(words);
      const { media, other } = shownFiles(deps.files(m), it.fileIdx);
      if (it.fileIdx != null) {
        if (media.length) body.append(bigPicture(s, it, m, media[0]));
        else body.append(h('p', { class: 'sv-veil' }, h('em', null, 'This picture is no longer in the message.')));
      } else if (media.length) {
        body.append(h('div', { class: `sv-thumbs${media.length === 1 ? ' one' : ''}` }, media.map((e, i) => thumbEl(s, it, m, media, i))));
      }
      if (other.length) {
        body.append(h('ul', { class: 'sv-files' }, other.map((o) => h('li', { class: 'sv-file' }, icon(o.voice ? 'mic' : 'file'),
          h('span', { class: 'sv-file-name' }, o.voice ? 'Voice message' : o.f.name || 'File'),
          !o.voice && Number(o.f.size) > 0 ? h('span', { class: 'sv-size' }, fmtSize(Number(o.f.size))) : null,
          !o.voice ? ibtn('download', `Download ${o.f.name || 'file'}`, () => deps.download(m, o.f), 'sm') : null))));
      }
      if (!body.firstChild) body.append(h('p', { class: 'sv-veil' }, h('em', null, 'No words or pictures in this message.')));
    }
    // Its flags, as on its row in the chat: all of them with the message; only the warnings when the word filter hides
    // it (as filteredEl does: else a server could keep its tampering out of sight with a word on its suggested list);
    // none when it can't be read here or is from someone you blocked (nothing of it shows).
    const flags = v.trust && v.ok ? v.trust.flags({ warnings: !!v.wf }) : [];
    if (flags.length) body.append(h('div', { class: 'sv-flags' }, flags));
    const jump = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => deps.jump(it, m) }, icon('arrowUp'), 'Jump');
    card.append(head, where, body, h('div', { class: 'sv-actions' }, jump, x));
    return card;
  }
  const ibtn = (name, label, onclick, cls = '') => h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, 'data-tip': label, onclick }, icon(name));

  // A picture pinned on its own: as wide as the panel, the thumbnail first, then the picture in full (up to autoloadMax;
  // a bigger one shows in full in the viewer). A video: Play plays it right here.
  function bigPicture(s, it, m, e) {
    const { f, fi, kind } = e;
    const label = f.alt || f.name || (kind === 'video' ? 'video' : 'picture');
    const wrap = h('div', { class: `sv-pic ${kind}` });
    if (Number(f.w) > 0 && Number(f.h) > 0) wrap.style.aspectRatio = `${Number(f.w)} / ${Number(f.h)}`;
    if (kind === 'img') {
      const img = h('img', { class: 'sv-img', alt: f.alt || '', draggable: 'false' });
      const open = h('button', { class: 'sv-open', type: 'button', 'aria-label': `Open ${label}` }, img);
      open.addEventListener('click', () => view(s, it, m, [e], 0, open));
      wrap.append(open);
      const small = (Number(f.size) || 0) > 0 && f.size <= deps.autoloadMax;
      if (!f.th && !small) {
        // Big, with no thumbnail (a long GIF, say): it waits to be opened.
        img.remove();
        open.append(h('span', { class: 'sv-ph' }, icon('image'), h('span', null, Number(f.size) > 0 ? fmtSize(Number(f.size)) : 'Open')));
      } else {
        whenVisible(wrap, () => {
          wrap.classList.add('loading');
          let sharp = false;
          const thumb = f.th ? deps.queue(() => deps.thumb(m, f)) : null;
          if (thumb && small) thumb.then((u) => { if (!sharp) img.src = u; }, () => {});
          const whole = small ? deps.queue(() => deps.full(m, f)) : thumb;
          whole.then((u) => { sharp = true; img.src = u; wrap.classList.remove('loading'); }, (err) => failed(wrap, open, err));
        });
      }
    } else {
      // No poster: nothing downloads until Play.
      const play = h('button', { class: 'sv-play', type: 'button', 'aria-label': `Play ${label}` }, icon('play'),
        h('span', null, Number(f.size) > 0 ? `Play video · ${fmtSize(Number(f.size))}` : 'Play video'));
      play.addEventListener('click', () => {
        play.disabled = true;
        for (const x of wrap.querySelectorAll('.sv-ph')) x.remove(); // (what a failed try said)
        wrap.classList.remove('failed', 'gone');
        wrap.classList.add('loading');
        deps.queue(() => deps.full(m, f), { front: true }).then((u) => {
          const video = h('video', { class: 'sv-video', controls: true, playsinline: true, preload: 'metadata', src: u, 'aria-label': label });
          play.replaceWith(video);
          wrap.classList.remove('loading');
          const go = video.play && video.play();
          if (go && go.catch) go.catch(() => {});
        }, (err) => { if (err && err.code === 'gone') play.remove(); else play.disabled = false; failed(wrap, null, err); });
      });
      wrap.append(play);
    }
    spoiler(s, wrap, m, fi, kind);
    return wrap;
  }
  // A message's pictures and videos, small: each opens the viewer, which goes through them all.
  function thumbEl(s, it, m, media, i) {
    const { f, fi, kind } = media[i];
    const label = f.alt || f.name || (kind === 'video' ? 'video' : 'picture');
    const open = h('button', { class: 'sv-open', type: 'button', 'aria-label': kind === 'video' ? `Open ${label} (video)` : `Open ${label}` });
    const tile = h('div', { class: `sv-tile ${kind}` }, open);
    open.addEventListener('click', () => {
      // Not past spoilers nobody has uncovered.
      const list = media.filter((x, j) => j === i || !(x.f.sp && !s.revealed.has(`${m.id}:${x.fi}`)));
      view(s, it, m, list, list.indexOf(media[i]), open);
    });
    if (kind === 'img') {
      const img = h('img', { class: 'sv-img', alt: '', draggable: 'false' });
      open.append(img);
      const want = f.th ? () => deps.thumb(m, f) : (Number(f.size) || 0) > 0 && f.size <= deps.thumbMax ? () => deps.full(m, f) : null;
      if (want) {
        whenVisible(tile, () => {
          tile.classList.add('loading');
          deps.queue(want).then((u) => { img.src = u; tile.classList.remove('loading'); }, (err) => failed(tile, open, err));
        });
      } else open.append(h('span', { class: 'sv-ph' }, icon('image'), h('span', null, fmtSize(Number(f.size) || 0))));
    } else {
      open.append(h('span', { class: 'sv-ph' }, icon('play'), Number(f.size) > 0 ? h('span', null, fmtSize(Number(f.size))) : null));
    }
    spoiler(s, tile, m, fi, kind);
    return tile;
  }
  function failed(box, open, err) {
    box.classList.remove('loading');
    const gone = !!err && err.code === 'gone';
    box.classList.add(gone ? 'gone' : 'failed');
    if (open) { const img = open.querySelector('img'); if (img) img.remove(); }
    (open || box).append(h('span', { class: 'sv-ph' }, icon(gone ? 'file' : 'image'), h('span', null, gone ? 'No longer available' : 'Couldn’t load')));
  }
  // A spoiler: blurred under a cover until it's clicked (its picture still loads behind it, as in the chat).
  function spoiler(s, box, m, fi, kind) {
    const f = deps.files(m)[fi];
    const gid = `${m.id}:${fi}`;
    if (!f || !f.sp || s.revealed.has(gid)) return;
    box.classList.add('spoiler');
    const open = box.querySelector('.sv-open, .sv-play');
    if (open) open.tabIndex = -1;
    const cover = h('button', { class: 'sv-cover', type: 'button', 'aria-label': `Spoiler ${kind === 'video' ? 'video' : 'picture'}, select to show` }, icon('eyeOff'), h('span', null, 'Spoiler'));
    cover.addEventListener('click', () => {
      s.revealed.add(gid);
      box.classList.remove('spoiler');
      cover.remove();
      if (open) { open.tabIndex = 0; open.focus({ preventScroll: true }); }
    });
    box.append(cover);
  }
  // The viewer, on these of a message's pictures and videos.
  function view(s, it, m, entries, index, from) {
    if (index < 0) return;
    deps.open(from, {
      index,
      items: entries.map((e) => ({
        m, f: e.f, fi: e.fi, key: it.key, kind: e.kind,
        thumb: e.kind === 'img' && e.f.th ? () => deps.thumb(m, e.f) : null,
        full: () => deps.full(m, e.f),
        name: e.f.name || (e.kind === 'video' ? 'Video' : 'Image'),
        alt: e.f.alt || '',
        download: () => deps.download(m, e.f),
      })),
    });
  }

  function unpinFrom(id) {
    const s = st;
    const card = s && s.cards.get(id);
    const hadFocus = !!card && card.el.contains(document.activeElement);
    // (Focus goes on to the next card's ×, or the one before, as the card goes.)
    const sib = card ? card.el.nextElementSibling || card.el.previousElementSibling : null;
    api.unpin(id);
    if (!hadFocus) return;
    const next = sib && sib.isConnected ? sib.querySelector('.sv-x') : null;
    if (next) next.focus({ preventScroll: true });
    else if (s && s.parts) { const b = s.parts.head.querySelector('button'); if (b) b.focus({ preventScroll: true }); }
  }

  // Closed, signed out (all: the list read from storage, and what was deleted, go too), or back online after missing
  // whatever happened meanwhile (app.js loadBootstrap): the open panel lets go of what it loaded, and of the message
  // just pinned (from before whatever was missed).
  function reset({ all = false } = {}) {
    seed = null;
    if (all === true) { items = null; owner = null; deleted.clear(); }
    const s = st;
    if (!s) return;
    st = null;
    if (s.parts) { s.parts.head.remove(); s.parts.scroll.remove(); }
  }

  const api = {
    // The panel's content, into #members (app.js renderPanel, which has emptied it, or left it there: drawn).
    draw(el) {
      if (!st) { st = fresh(); build(st); }
      const s = st;
      const back = s.parts.scroll.parentNode !== el;
      if (back) {
        el.append(s.parts.head, s.parts.scroll);
        // Out of the page for a while (another view): drawn anew, as pictures shown while it was out may have been let go.
        s.cards = new Map();
      }
      render(s);
      if (back) s.parts.scroll.scrollTop = s.scrollTop;
    },
    // Is it in el already? Then the app's redraws of its side panel put the same cards back, untouched.
    drawn(el) {
      const s = st;
      return !!s && !!s.parts && s.parts.head.parentNode === el && s.parts.scroll.parentNode === el;
    },
    // Pins a message (fileIdx null) or one of its pictures: on top, and the panel opens. m: the message as the app has it
    // (decrypted), so it isn't asked for again.
    pin(item) {
      const r = addItem(list(), item || {});
      if (!r.added && !r.already) return false;
      if (item && item.m && typeof item.m.id === 'string' && item.m.id === item.messageId) {
        seed = item.m;
        if (st && !st.msgs.has(seed.id) && copyOf(item)) st.msgs.set(seed.id, { state: 'ok', m: seed });
      }
      if (r.added) {
        save(r.list);
        if (r.dropped.length) deps.toast(`Only ${MAX_ITEMS} things fit on the side, so the oldest one came off.`);
        deps.changed();
      }
      deps.show();
      if (st) {
        render(st);
        const c = st.cards.get(itemId(item.messageId, item.fileIdx == null ? null : item.fileIdx));
        if (c && c.el.scrollIntoView) c.el.scrollIntoView({ block: 'nearest' });
      }
      return true;
    },
    unpin(id) {
      if (!pinnedNow(id)) return;
      save(removeItem(list(), id));
      if (st) render(st);
      deps.changed();
    },
    count() { return list().length; },
    isPinned(messageId, fileIdx = null) { return pinnedNow(itemId(messageId, fileIdx)); },
    // "Pin to side" (or "Unpin from side") for a message, or one of its pictures or videos (fileIdx), or null.
    menuItemFor(m, fileIdx = null) {
      if (!m || typeof m.id !== 'string' || m.pending || m.scheduled || !deps.userId()) return null;
      const fi = fileIdx == null ? null : fileIdx;
      if (fi !== null && !mediaEntries(deps.files(m)).some((e) => e.fi === fi)) return null;
      const it = cleanItem({ key: deps.keyOf(m), messageId: m.id, fileIdx: fi, at: 1 });
      if (!it) return null;
      const id = idOf(it);
      const on = pinnedNow(id);
      return { key: 'side', label: on ? 'Unpin from side' : 'Pin to side', icon: 'sidebar', action: () => (on ? api.unpin(id) : api.pin({ ...it, m })) };
    },
    // An edited message: decrypted again, and its cards drawn anew.
    async onUpdate(key, m) {
      if (seed && m && seed.id === m.id) seed = null;
      const s = st;
      const rec = s && m && typeof m.id === 'string' ? s.msgs.get(m.id) : null;
      if (!rec || deps.keyOf(m) !== key) return;
      if (rec.state === 'loading') { rec.update = m; return; } // (the page on its way may be from before it)
      if (rec.state !== 'ok') return;
      try { await deps.decrypt(m); } catch { /* unreadable: said so on its card */ }
      if (s !== st || s.msgs.get(m.id) !== rec || rec.state !== 'ok' || isDeleted(m)) return;
      rec.m = m;
      render(s);
    },
    // Messages deleted or disappeared (key null: wherever they were). Their cards say so and their decrypted copies go.
    // A thread's first message takes its replies with it.
    onDelete(key, ids) {
      const set = new Set(typeof ids === 'string' ? [ids] : ids || []);
      if (!set.size) return;
      remember(set);
      if (seed && (set.has(seed.id) || (seed.threadId && set.has(seed.threadId)))) seed = null;
      const s = st;
      if (!s) return;
      const gone = [];
      let changed = false;
      for (const [id, rec] of s.msgs) {
        const m = rec.m;
        if (!set.has(id) && !(m && m.threadId && set.has(m.threadId))) continue;
        if (m) { remember([m.id]); gone.push(m); }
        if (rec.state !== 'gone') changed = true;
        rec.state = 'gone'; rec.m = null;
      }
      if (gone.length) deps.drop(fileUrlsOf(gone, deps.files));
      if (changed) render(s);
    },
    // A server's keys arrived: the messages here that were waiting for one are opened (the chat's copies, which some of
    // these are, it has just opened itself), and their cards drawn anew.
    async onKeys(serverId) {
      const s = st;
      if (!s) return;
      const held = [...s.msgs.values()].filter((r) => r.state === 'ok' && r.m && r.m.serverId === serverId);
      if (!held.length) return;
      const waiting = held.filter((r) => r.m.dec && r.m.dec.pending);
      await Promise.all(waiting.map(async (r) => { try { await deps.decrypt(r.m); } catch { /* still unreadable */ } }));
      if (s !== st) return;
      armIf(held.map((r) => r.m).filter(Boolean));
      render(s); // (readable now: their cards' signatures changed)
    },
    // The messages it holds (the app's disappearing timer counts them in, and it asks whether a binding issue it found
    // touches one of them).
    messages() { return st ? [...st.msgs.values()].filter((r) => r.state === 'ok' && r.m).map((r) => r.m) : []; },
    // What's said about who could have written a message it holds changed outside it (app.js noteBinding,
    // redrawRepliesTo, forgetBindings: another copy of it loaded in the chat, or deleted; the original of a reply found
    // still there). Nothing tells the side view otherwise: its cards are often copies it fetched itself, which none of
    // the chat's lists have. Drawn again if it's open; only the cards whose signature changed are drawn anew.
    refresh() { if (st) render(st); },
    // The disappearing timer went off: those whose time has come go, with everything the app kept of them.
    expire() {
      const s = st;
      if (s && expireDue(s)) render(s);
    },
    reset,
  };
  return api;
}
