// Comments on one photo of a message, and tags (labels) on photos, in DMs, group chats and server channels: "if photos
// are sent in 1 clump you can individually comment on them and tag them".
//
// A comment is an ordinary encrypted reply, sent through the app's own send path (the same encryption, binding,
// disappearing timer and errors as any reply), so people are notified and see it in the chat. Inside it, beside what it
// replies to, it says which photo it is about: ph { i, u }, the index into the replied-to message's files and that file's
// address (binding.js photoOf). The server is told the index too (replyFile), but only to count each photo's comments:
// which photo a comment is about always comes from what's inside it.
//
// A tag is a short label someone put on one photo or video. It's sealed on the device with the conversation's key
// (e2ee.js tc1 / td1, secure.js encryptTag / openTag), bound to the conversation, the message, which of its files, its
// own id and who added it, and kept by the server beside the message. The server learns that file i of a message has a
// tag by someone, and when; never the words. Inside, beside the label, is the address of the file it was put on, which
// must still be that file's when it's read: a message whose files changed since (only its sender can do that) doesn't
// carry its tags over to another picture. Labels are compared without regard to case.
//
// Labels and comments are what people wrote: on screen they're text nodes only, never HTML. (A comment's words go
// through the app's markdown renderer, like any message, in textEl from app.js.)
//
// What app.js gets (createPhotoNotes): side(item, ctx) for the picture viewer's side panel, badges(m, fi) for the counts on
// a picture, tagsOf(m, fi), tagIndex(key) for the Photos & videos panel's tag filter, counts(m, fi) ({ comments, tags },
// for the viewer's Comments button), and for the chat:
// tileExtras (a picture's counts and its "Comment on this photo" button), and the live updates onTags, onFileReplies,
// onKeys and reconnected.
import { h, icon, fmtStamp } from './util.js';
import { ibtn } from './ui.js';
import { api } from './api.js';
import { mediaKind } from './files.js';
import { whenOnScreen } from './media.js';
import { newUid, trustedBinding, PHOTO_MAX } from './binding.js';

export const LABEL_MAX = 40; // characters (whole ones: an emoji counts once)
export const TAGS_PER_PHOTO = 20; // the server's limit too (server/index.js)
const COMMENTS_PAGE = 100; // the most GET …/comments answers at once
const IDS_PAGE = 100; // the most GET …/media?ids= takes at once
const SUGGESTIONS = 8;
// Bounded memories, so a long session doesn't keep growing.
const OPENED_MAX = 8000;
const META_MAX = 2000;
const FETCHED_MAX = 1000;
const COMMENTS_MAX = 200;
const MSG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TAG_ID = /^[A-Za-z0-9_-]{22}$/;

// ------------------------------------------------------------------ pure helpers (test/photo-notes-client.test.js)
// Control characters, C1 controls, and the invisible marks that could reorder or hide the text around them (bidi
// overrides and isolates, zero-width space, byte-order mark). Joiners stay: emoji and some scripts need them.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g;
const loneHalf = (c) => c.length === 1 && c >= '\ud800' && c <= '\udfff';
// A label as it's sealed and shown: composed (NFC), one line, no control or invisible characters, spaces collapsed, at
// most LABEL_MAX characters. '' when nothing is left. The same is done again to every label that's opened, so a label
// some other app sealed can't be longer or stranger than one this app makes.
export function normLabel(s) {
  if (typeof s !== 'string') return '';
  const t = s.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return [...t].filter((c) => !loneHalf(c)).slice(0, LABEL_MAX).join('').trim();
}
// What two labels are compared by: the same words in any case are one label.
export const labelKey = (s) => normLabel(s).toLowerCase();

// The tag records of a message as the server lists them (m.tags, a live update, GET …/tags): only well-formed ones,
// each once, oldest first.
export function cleanTagRecords(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const t of list.slice(0, 2500)) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TAG_ID.test(t.id) || seen.has(t.id)) continue;
    if (!Number.isInteger(t.fileIdx) || t.fileIdx < 0 || t.fileIdx > PHOTO_MAX) continue;
    if (typeof t.authorId !== 'string' || !MSG_ID.test(t.authorId) || typeof t.ciphertext !== 'string' || !t.ciphertext || t.ciphertext.length > 1000) continue;
    seen.add(t.id);
    out.push({
      id: t.id, fileIdx: t.fileIdx, authorId: t.authorId, ciphertext: t.ciphertext, createdAt: Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : 0,
      ...(typeof t.messageId === 'string' && MSG_ID.test(t.messageId) ? { messageId: t.messageId } : {}),
    });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}
// A message's comment counts per photo as the server keeps them ({ "<index>": n }): whole numbers above 0 only.
export function cleanCounts(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x)) if (/^(0|[1-9][0-9]?)$/.test(k) && Number.isInteger(v) && v > 0) out[k] = Math.min(v, 1000000);
  return out;
}
// How many comments photo fi has (fi: its index, a whole number).
export const commentCount = (counts, fi) => {
  if (!counts || typeof counts !== 'object' || !Number.isInteger(fi) || fi < 0) return 0;
  const n = Object.prototype.hasOwnProperty.call(counts, String(fi)) ? counts[String(fi)] : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
};
// Photos and videos (not voice messages, songs or other files): what can be commented on one by one, and tagged.
export const isPhotoOrVideo = (f) => !!f && typeof f === 'object' && !f.voice && ['img', 'video'].includes(mediaKind(f.type || '', f.name || ''));
export const photoCount = (files) => (Array.isArray(files) ? files.filter(isPhotoOrVideo).length : 0);
const kindWord = (f) => (f && mediaKind(f.type || '', f.name || '') === 'video' ? 'video' : 'photo');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The labels on one photo, from [{ label, rec }] (tags that opened, oldest first): one per label whatever its case, the
// oldest spelling of each.
export function distinctLabels(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const k = labelKey(e.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
// Every tag in a conversation, as the Photos & videos panel filters by them: from [{ label, messageId, fileIdx,
// createdAt }] a Map of label -> [{ messageId, fileIdx }]. One label for spellings that differ only in case (the first
// one made), each photo once under it, the newest message first; the labels on most photos first, then A to Z.
export function groupIndex(entries) {
  const groups = new Map(); // key -> { label, at, photos: Map(`${messageId}|${fileIdx}` -> { messageId, fileIdx }) }
  for (const e of [...entries].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const k = labelKey(e.label);
    if (!k || !MSG_ID.test(String(e.messageId || '')) || !Number.isInteger(e.fileIdx)) continue;
    let g = groups.get(k);
    if (!g) { g = { label: normLabel(e.label), photos: new Map() }; groups.set(k, g); }
    g.photos.set(`${e.messageId}|${e.fileIdx}`, { messageId: e.messageId, fileIdx: e.fileIdx });
  }
  const byNewest = (a, b) => (a.messageId === b.messageId ? a.fileIdx - b.fileIdx : a.messageId < b.messageId ? 1 : -1);
  const sorted = [...groups.values()].sort((a, b) => b.photos.size - a.photos.size || a.label.localeCompare(b.label));
  return new Map(sorted.map((g) => [g.label, [...g.photos.values()].sort(byNewest)]));
}
// What the "Add a tag" box suggests: labels used in this conversation ([{ label, count }], most used first), those that
// start with what's typed before those that only contain it, never one this photo already has; at most n.
export function suggestLabels(used, typed, have = [], n = SUGGESTIONS) {
  const want = labelKey(typed || '');
  const skip = new Set(have.map(labelKey));
  const ok = used.filter((u) => !skip.has(labelKey(u.label)) && (!want || labelKey(u.label).includes(want)));
  const starts = ok.filter((u) => !want || labelKey(u.label).startsWith(want));
  return [...starts, ...ok.filter((u) => !starts.includes(u))].slice(0, n).map((u) => u.label);
}

// A Map that forgets its oldest entries past max.
function put(map, k, v, max) {
  map.delete(k);
  map.set(k, v);
  while (map.size > max) map.delete(map.keys().next().value);
}
const keyOf = (m) => (m.dmId ? 'd:' + m.dmId : 'c:' + m.channelId);
// Where a conversation's routes are: /dms/<id> or /channels/<id> (a server channel or a group chat).
const convBase = (key) => (key.startsWith('d:') ? `/dms/${encodeURIComponent(key.slice(2))}` : `/channels/${encodeURIComponent(key.slice(2))}`);
// Where one message's are: /dm-messages/<id> or /messages/<id>.
const msgBase = (m) => `${m.dmId ? '/dm-messages/' : '/messages/'}${encodeURIComponent(m.id)}`;

// deps (from app.js):
//   me()                          the signed-in user
//   where(key)                    { serverId, channelId } or { dmId } for a conversation this app has, else null
//   encryptTag(where, tag), openTag(t)        secure.js
//   withKeyRetry(serverId, fn)    runs fn again once if the server says the key is out of date
//   decrypt(m), readable(m), filesOf(m), expired(m)   as for any message
//   blocked(userId)               you blocked them
//   getUser(id), nameOf(m, u), avatar(u, size)
//   textEl(m)                     a comment's words as the chat shows them (or the word filter's note), an element
//   canPost(key, threadId)        null when you can post there, else why not (a sentence)
//   canManage(key)                Manage Messages there (a server channel or a group chat's owner)
//   sendComment(item, text)       sends a comment on item's photo like any reply; resolves to the message sent
//   spellBox(ta), spelled(ta), spellcheck()   the message box's spelling, for the comment box
//   copies(id)                    every loaded copy of a message (the conversation, threads)
//   loaded(id)                    one loaded copy, or null
//   onMeta(key, id)               a message's tags or comment counts changed (the Photos & videos panel redraws it)
//   openMessage(m)                shows a message in the chat (a comment, from the side panel)
export function createPhotoNotes(deps) {
  const opened = new Map(); // tag (bound fields + ciphertext) -> { conv, label, fu } | { pending, serverId, messageId } | { error }
  const opening = new Map(); // the same -> Promise of that
  const waiting = new Set(); // ids of messages whose tags are being opened
  const meta = new Map(); // `${conversation}|${message id}` -> { tags?, fileReplies? } from live updates (newer than copies drawn earlier)
  const convs = new Map(); // conversation -> { recs: Map(message id -> records), live: Set(ids), loaded: Promise }
  const fetched = new Map(); // message id -> a message fetched (and decrypted) for the tag index
  const threads = new Map(); // `${messageId}|${fi}` -> { list, next, loaded, error }: comments on one photo
  const panels = new Set(); // side panels handed out: { el, m, fi, drawTags, reload, born }
  const cleaned = new WeakMap(); // m.tags (as the server sent it) -> its clean records

  const me = () => deps.me() || {};
  const recKey = (conv, messageId, t) => `${conv}|${messageId}|${t.fileIdx}|${t.id}|${t.authorId}|${t.createdAt}|${t.ciphertext}`;
  const peek = (conv, messageId, t) => opened.get(recKey(conv, messageId, t)) || null;
  // The latest live update about a message where this copy of it is (by conversation and id: one about the same id
  // somewhere else is no word about this one).
  const liveOf = (m) => meta.get(`${keyOf(m)}|${m.id}`) || null;
  const putLive = (key, id, what) => put(meta, `${key}|${id}`, { ...(meta.get(`${key}|${id}`) || {}), ...what }, META_MAX);
  // A message's tag records: from the latest live update about it, else as it was loaded.
  function recsOf(m) {
    const live = liveOf(m);
    if (live && live.tags) return live.tags;
    if (!Array.isArray(m.tags)) return [];
    if (!cleaned.has(m.tags)) cleaned.set(m.tags, cleanTagRecords(m.tags));
    return cleaned.get(m.tags);
  }
  function countsOf(m) {
    const live = liveOf(m);
    return live && live.fileReplies ? live.fileReplies : cleanCounts(m.fileReplies);
  }
  // Whether a message can carry comments on its photos and tags at all: one that opened, end-to-end encrypted, still
  // there, in a conversation this app has.
  const usable = (m) => !!m && MSG_ID.test(String(m.id || '')) && deps.readable(m) && !m.dec.legacy && !m.dec.bot && !deps.expired(m) && !!deps.where(keyOf(m));
  const several = (m) => photoCount(deps.filesOf(m)) >= 2;

  // ---------------------------------------------------------------- opening tags
  function open(conv, messageId, t) {
    const k = recKey(conv, messageId, t);
    if (opened.has(k)) return Promise.resolve(opened.get(k));
    if (opening.has(k)) return opening.get(k);
    const w = deps.where(conv);
    const job = (async () => {
      if (!w) return { error: true };
      const r = await deps.openTag({ ...w, id: t.id, messageId, fileIndex: t.fileIdx, authorId: t.authorId, ciphertext: t.ciphertext, createdAt: t.createdAt });
      // Waiting for a server key that's still on its way: opened again when it comes (onKeys). One older than a key
      // this app already holds never comes, as for messages.
      if (r && r.pending && !r.before) return { pending: true, serverId: w.serverId, messageId };
      const label = r && !r.error && !r.pending ? normLabel(r.n) : '';
      return label ? { conv, label, fu: r.fu } : { error: true };
    })().catch(() => ({ error: true })).then((res) => { opening.delete(k); put(opened, k, res, OPENED_MAX); return res; });
    opening.set(k, job);
    return job;
  }
  // Opens a message's tags that aren't yet; once they are, whatever shows them is drawn again.
  function ensureOpen(m) {
    if (!usable(m) || waiting.has(m.id)) return;
    const conv = keyOf(m);
    const todo = recsOf(m).filter((t) => !opened.has(recKey(conv, m.id, t)));
    if (!todo.length) return;
    waiting.add(m.id);
    Promise.all(todo.map((t) => open(conv, m.id, t))).then((rs) => {
      waiting.delete(m.id);
      if (rs.some((r) => r.label)) changed(conv, m.id);
      ensureOpen(m); // any that arrived meanwhile
    });
  }
  // The tags on one photo that count: opened, put on this very file, not by someone you blocked; one per label.
  function entriesOn(m, fi) {
    if (!usable(m)) return [];
    const f = deps.filesOf(m)[fi];
    if (!f) return [];
    const conv = keyOf(m);
    const out = [];
    for (const t of recsOf(m)) {
      if (t.fileIdx !== fi || deps.blocked(t.authorId)) continue;
      const r = peek(conv, m.id, t);
      if (r && r.label && r.fu === f.url) out.push({ label: r.label, rec: t });
    }
    return distinctLabels(out);
  }
  function tagsOf(m, fi) {
    ensureOpen(m);
    return entriesOn(m, fi).map((e) => e.label);
  }
  function counts(m, fi) {
    if (!usable(m)) return { comments: 0, tags: 0 };
    ensureOpen(m);
    return { comments: commentCount(countsOf(m), fi), tags: entriesOn(m, fi).length };
  }

  // ---------------------------------------------------------------- counts on a picture
  function countLabel({ comments, tags }) {
    return [comments ? plural(comments, 'comment') : null, tags ? plural(tags, 'tag') : null].filter(Boolean).join(', ');
  }
  function badges(m, fi) {
    const c = counts(m, fi);
    if (!c.comments && !c.tags) return null;
    const label = countLabel(c);
    return h('span', { class: 'pn-badges', role: 'img', 'aria-label': label, title: label },
      c.comments ? h('span', { class: 'pn-badge' }, icon('message'), String(c.comments)) : null,
      c.tags ? h('span', { class: 'pn-badge' }, icon('tag'), String(c.tags)) : null);
  }
  // In the chat, each photo or video of a message with two or more of them: its counts (kept up to date in place, see
  // refreshSlots) and, on hover or focus, "Comment on this photo", which opens it in the viewer at the comment box.
  // Nothing for a message with one picture: replying to it is the same thing.
  function tileExtras(m, fi, openComment) {
    if (!usable(m) || !several(m)) return [];
    const f = deps.filesOf(m)[fi];
    if (!isPhotoOrVideo(f)) return [];
    const what = kindWord(f);
    const btn = h('button', { class: 'pn-comment-btn', type: 'button', 'data-tip': `Comment on this ${what}`,
      onclick: (e) => { e.stopPropagation(); openComment(); } }, icon('message'));
    const slot = h('span', { class: 'pn-slot', dataset: { pnMid: m.id, pnFi: String(fi) } });
    slot._pn = { m, fi, btn, what };
    fillSlot(slot);
    return [slot, btn];
  }
  function fillSlot(slot) {
    const { m, fi, btn, what } = slot._pn;
    const b = badges(m, fi);
    slot.replaceChildren(...(b ? [b] : []));
    const c = b ? b.getAttribute('aria-label') : '';
    btn.setAttribute('aria-label', `Comment on this ${what}${c ? ` (${c})` : ''}`);
  }
  // A message's counts changed: its pictures in the chat show the new ones, without redrawing the message (that
  // would load its pictures again).
  function refreshSlots(id) {
    if (typeof document === 'undefined' || !MSG_ID.test(String(id || ''))) return;
    for (const slot of document.querySelectorAll(`.pn-slot[data-pn-mid="${id}"]`)) if (slot._pn) fillSlot(slot);
  }
  function prune() {
    for (const p of panels) if (!p.el.isConnected && Date.now() - p.born > 5000) panels.delete(p);
  }
  function refreshPanels(id, { comments = false } = {}) {
    prune();
    for (const p of panels) if (p.m.id === id) { p.drawTags(); if (comments) p.reload(); }
  }
  function changed(conv, id) {
    refreshSlots(id);
    refreshPanels(id);
    deps.onMeta(conv, id);
  }

  // ---------------------------------------------------------------- live updates (app.js socket handlers)
  function setTags(key, id, list) {
    putLive(key, id, { tags: list });
    const here = deps.copies(id).filter((c) => keyOf(c) === key);
    for (const c of here) c.tags = list;
    const st = convs.get(key);
    if (st) { if (list.length) st.recs.set(id, list); else st.recs.delete(id); st.live.add(id); }
    changed(key, id);
    const one = here[0] || ([...panels].find((p) => p.m.id === id) || {}).m;
    if (one) ensureOpen(one);
  }
  function onTags(key, id, tags) {
    if (typeof key !== 'string' || !MSG_ID.test(String(id || ''))) return;
    setTags(key, id, cleanTagRecords(tags));
  }
  function onFileReplies(key, id, fileReplies) {
    if (typeof key !== 'string' || !MSG_ID.test(String(id || ''))) return;
    const c = cleanCounts(fileReplies);
    putLive(key, id, { fileReplies: c });
    for (const x of deps.copies(id)) if (keyOf(x) === key) x.fileReplies = c;
    refreshSlots(id);
    refreshPanels(id, { comments: true });
    deps.onMeta(key, id);
  }
  // A server's keys arrived: its tags that were waiting for them open now.
  function onKeys(serverId) {
    const ids = new Set();
    for (const [k, r] of [...opened]) if (r.pending && r.serverId === serverId) { opened.delete(k); ids.add(r.messageId); }
    for (const id of ids) {
      const m = deps.loaded(id) || fetched.get(id) || ([...panels].find((p) => p.m.id === id) || {}).m;
      if (m) ensureOpen(m);
    }
  }
  // Back online after missing whatever happened meanwhile: what came live is forgotten (the copies loaded again say
  // it), and an open side panel loads its comments again.
  function reconnected() {
    meta.clear();
    convs.clear();
    prune();
    for (const p of panels) p.reload();
  }

  // ---------------------------------------------------------------- every tag in a conversation
  // GET …/tags once per conversation (live updates keep it current), every tag opened.
  function convTags(key) {
    const had = convs.get(key);
    if (had) return had.loaded;
    const st = { recs: new Map(), live: new Set(), loaded: null };
    convs.set(key, st);
    st.loaded = api('GET', `${convBase(key)}/tags`).then(async (r) => {
      const byMsg = new Map();
      for (const t of cleanTagRecords(r && r.tags)) {
        if (!t.messageId) continue;
        if (!byMsg.has(t.messageId)) byMsg.set(t.messageId, []);
        byMsg.get(t.messageId).push(t);
      }
      for (const [id, recs] of byMsg) if (!st.live.has(id)) st.recs.set(id, recs);
      await Promise.all([...st.recs].flatMap(([id, recs]) => recs.map((t) => open(key, id, t))));
      return st;
    }).catch((e) => { if (convs.get(key) === st) convs.delete(key); throw e; });
    return st.loaded;
  }
  // Those messages, decrypted: loaded here already, or fetched (GET …/media?ids=, in pages). One the server doesn't
  // give (deleted, disappeared, not yours to see) is simply left out.
  async function messagesFor(key, ids) {
    const out = new Map();
    const need = [];
    for (const id of ids) {
      const m = deps.loaded(id) || fetched.get(id);
      if (m && keyOf(m) === key && deps.readable(m)) out.set(id, m); else need.push(id);
    }
    for (let i = 0; i < need.length; i += IDS_PAGE) {
      const part = need.slice(i, i + IDS_PAGE);
      let list = [];
      try { const r = await api('GET', `${convBase(key)}/media?${new URLSearchParams({ ids: part.join(',') })}`); list = Array.isArray(r && r.messages) ? r.messages : []; } catch { continue; }
      list = list.filter((m) => m && typeof m === 'object' && part.includes(m.id) && keyOf(m) === key);
      await Promise.all(list.map((m) => Promise.resolve(deps.decrypt(m)).catch(() => {})));
      for (const m of list) { put(fetched, m.id, m, FETCHED_MAX); out.set(m.id, m); }
    }
    return out;
  }
  // label -> [{ messageId, fileIdx }] for the Photos & videos panel (groupIndex), each tag checked as on a picture: it
  // opened, its author isn't blocked, and it's on the very file it was put on.
  async function tagIndex(key) {
    if (!deps.where(key)) return new Map();
    const st = await convTags(key);
    const all = [...st.recs].flatMap(([messageId, recs]) => recs.map((t) => ({ messageId, t })));
    await Promise.all(all.map(({ messageId, t }) => open(key, messageId, t)));
    const ids = [...new Set(all.filter(({ messageId, t }) => (peek(key, messageId, t) || {}).label).map((x) => x.messageId))];
    const msgs = await messagesFor(key, ids);
    const entries = [];
    for (const { messageId, t } of all) {
      const r = peek(key, messageId, t);
      const m = msgs.get(messageId);
      if (!r || !r.label || !m || !usable(m) || deps.blocked(t.authorId)) continue;
      const f = deps.filesOf(m)[t.fileIdx];
      if (f && f.url === r.fu) entries.push({ label: r.label, messageId, fileIdx: t.fileIdx, createdAt: t.createdAt });
    }
    return groupIndex(entries);
  }
  // The labels used in a conversation so far, for the "Add a tag" box: [{ label, count }].
  function usedLabels(key) {
    const st = convs.get(key);
    const entries = [];
    const add = (messageId, t) => {
      const r = !deps.blocked(t.authorId) && peek(key, messageId, t);
      if (r && r.label) entries.push({ label: r.label, messageId, fileIdx: t.fileIdx, createdAt: t.createdAt });
    };
    if (st) for (const [id, recs] of st.recs) recs.forEach((t) => add(id, t));
    for (const p of panels) if (keyOf(p.m) === key && !(st && st.recs.has(p.m.id))) recsOf(p.m).forEach((t) => add(p.m.id, t));
    return [...groupIndex(entries)].map(([label, list]) => ({ label, count: list.length }));
  }

  // ---------------------------------------------------------------- comments on one photo
  // A reply that counts as a comment on this photo: it opened, says (inside) it's about this very file, was written
  // as a reply to this message by an app this device trusts for its author (binding.js), and isn't gone or blocked.
  function isCommentOn(c, m, f, fi) {
    if (!c || !deps.readable(c) || !c.dec.ph || c.dec.ph.i !== fi || c.dec.ph.u !== f.url) return false;
    if (keyOf(c) !== keyOf(m) || deps.expired(c) || deps.blocked(c.authorId)) return false;
    const b = trustedBinding(c);
    return !!b && b.r === m.id;
  }
  function threadOf(m, fi) {
    const k = `${m.id}|${fi}`;
    let t = threads.get(k);
    if (!t) { t = { list: [], next: null, loaded: false, error: null, job: null }; put(threads, k, t, COMMENTS_MAX); }
    return t;
  }
  // GET …/comments?file=fi into t (threadOf): from the start, or (more) the page after what's loaded.
  function loadComments(t, m, f, fi, { more = false } = {}) {
    if (t.job) return t.job;
    t.job = (async () => {
      try {
        const q = { file: String(fi), limit: String(COMMENTS_PAGE), ...(more && t.next ? { after: t.next } : {}) };
        const r = await api('GET', `${msgBase(m)}/comments?${new URLSearchParams(q)}`);
        const list = (Array.isArray(r && r.messages) ? r.messages : []).filter((c) => c && typeof c === 'object' && MSG_ID.test(String(c.id || '')));
        await Promise.all(list.map((c) => Promise.resolve(deps.decrypt(c)).catch(() => {})));
        const mine = list.filter((c) => isCommentOn(c, m, f, fi));
        const keep = more ? t.list : [];
        t.list = [...keep, ...mine.filter((c) => !keep.some((x) => x.id === c.id))].sort((a, b) => (a.id < b.id ? -1 : 1));
        t.next = r && typeof r.next === 'string' && MSG_ID.test(r.next) ? r.next : null;
        t.loaded = true;
        t.error = null;
      } catch (e) {
        t.error = e.message || 'Couldn’t load the comments.';
      } finally { t.job = null; }
    })();
    return t.job;
  }

  // ---------------------------------------------------------------- the viewer's side panel
  // item: { m, f, fi, key } (the viewer's item, viewer: openViewer). ctx: { close, focus } (focus 'comment': into the
  // comment box once it's on screen). null when the photo can't have comments or tags here.
  function side(item, ctx = {}) {
    const m = item && item.m;
    const fi = item && item.fi;
    if (!usable(m) || !Number.isInteger(fi)) return null;
    const f = deps.filesOf(m)[fi];
    if (!isPhotoOrVideo(f) || (item.f && item.f.url && item.f.url !== f.url)) return null;
    const key = keyOf(m);
    const what = kindWord(f);
    ensureOpen(m);

    // Tags: chips, the box, suggestions.
    const chips = h('div', { class: 'pn-chips', role: 'list', 'aria-label': `Tags on this ${what}` });
    const tagNote = h('p', { class: 'pn-note', role: 'status', hidden: true });
    const note = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
    const tagIn = h('input', { class: 'input pn-tag-in', type: 'text', maxlength: String(LABEL_MAX), placeholder: 'Add a tag', 'aria-label': `Add a tag to this ${what}`,
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const tagAdd = h('button', { class: 'btn sm pn-tag-add', type: 'button', disabled: true }, 'Add');
    const suggest = h('div', { class: 'pn-suggest', role: 'group', 'aria-label': 'Tags used in this conversation', hidden: true });
    const noTag = deps.canPost(key, null);
    let tagBusy = false;
    const mayRemove = (t) => t.authorId === me().id || m.authorId === me().id || deps.canManage(key);
    function chip({ label, rec }) {
      const by = deps.nameOf(m, deps.getUser(rec.authorId));
      return h('span', { class: 'chip pn-chip', role: 'listitem', title: `#${label} · added by ${by}` },
        h('span', { class: 'pn-chip-text' }, `#${label}`),
        mayRemove(rec) ? h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove the tag ${label}`, onclick: () => removeTag(label) }, icon('close')) : null);
    }
    function drawTags() {
      const list = entriesOn(m, fi);
      chips.replaceChildren(...(list.length ? list.map(chip) : [h('span', { class: 'pn-empty' }, `No tags on this ${what} yet.`)]));
      drawSuggest();
    }
    function drawSuggest() {
      if (noTag) return;
      const labels = suggestLabels(usedLabels(key), tagIn.value, entriesOn(m, fi).map((e) => e.label));
      suggest.replaceChildren(...labels.map((label) => h('button', { class: 'chip pn-suggestion', type: 'button', 'aria-label': `Add the tag ${label}`,
        onmousedown: (e) => e.preventDefault(), onclick: () => addTag(label) }, `#${label}`)));
      suggest.hidden = !labels.length;
      tagAdd.disabled = tagBusy || !normLabel(tagIn.value);
    }
    async function addTag(raw) {
      const label = normLabel(raw);
      if (!label || tagBusy) return;
      note(tagNote, '');
      if (entriesOn(m, fi).some((e) => labelKey(e.label) === labelKey(label))) { tagIn.value = ''; drawSuggest(); return; } // it has that one
      if (recsOf(m).filter((t) => t.fileIdx === fi).length >= TAGS_PER_PHOTO) { note(tagNote, `This ${what} has as many tags as it can take.`); return; }
      tagBusy = true;
      drawSuggest();
      try {
        const w = deps.where(key);
        if (!w) throw new Error('This conversation isn’t available.');
        // The id goes inside the tag too (its additional data), so it's chosen here, once: a try again after a key
        // change seals the same tag anew.
        const tagId = newUid();
        const post = async () => {
          const { ciphertext } = await deps.encryptTag(w, { messageId: m.id, fileIndex: fi, tagId, payload: { n: label, fu: f.url } });
          return api('POST', `${msgBase(m)}/tags`, { id: tagId, fileIdx: fi, ciphertext });
        };
        const res = w.serverId ? await deps.withKeyRetry(w.serverId, post) : await post();
        const rec = cleanTagRecords([res && res.tag])[0];
        if (rec) {
          // What it says is known here: no need to open it again.
          put(opened, recKey(key, m.id, rec), { conv: key, label, fu: f.url }, OPENED_MAX);
          setTags(key, m.id, [...recsOf(m).filter((t) => t.id !== rec.id), rec]);
        }
        tagIn.value = '';
      } catch (e) {
        note(tagNote, e.message || 'Couldn’t add the tag.');
      } finally {
        tagBusy = false;
        drawSuggest();
      }
    }
    async function removeTag(label) {
      const k = labelKey(label);
      const gone = recsOf(m).filter((t) => t.fileIdx === fi && mayRemove(t) && labelKey((peek(key, m.id, t) || {}).label || '') === k);
      if (!gone.length) return;
      note(tagNote, '');
      const done = new Set();
      try {
        for (const t of gone) {
          try { await api('DELETE', `${msgBase(m)}/tags/${encodeURIComponent(t.id)}`); } catch (e) { if (e.status !== 404) throw e; }
          done.add(t.id);
        }
      } catch (e) {
        note(tagNote, e.message || 'Couldn’t remove the tag.');
      } finally {
        if (done.size) setTags(key, m.id, recsOf(m).filter((t) => !done.has(t.id)));
      }
    }
    tagIn.addEventListener('input', drawSuggest);
    tagIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTag(tagIn.value); } });
    tagAdd.addEventListener('click', () => addTag(tagIn.value));

    // Comments: the list, Show more, the box.
    const thread = threadOf(m, fi);
    const heading = h('span', { class: 'pn-count' });
    const list = h('ol', { class: 'pn-list', 'aria-label': `Comments on this ${what}` });
    const more = h('button', { class: 'link-btn pn-more', type: 'button', hidden: true, onclick: () => loadComments(thread, m, f, fi, { more: true }).then(drawComments) }, 'Show more comments');
    const boxNote = h('p', { class: 'pn-note', role: 'status', hidden: true });
    const noComment = deps.canPost(key, m.threadId || null);
    const ta = h('textarea', { class: 'input pn-box', rows: '1', maxlength: '4000', placeholder: 'Add a comment…', 'aria-label': `Comment on this ${what}`, spellcheck: deps.spellcheck() });
    const send = h('button', { class: 'send-btn pn-send', type: 'button', 'aria-label': 'Send comment', 'data-tip': 'Send (Enter)', disabled: true }, icon('send'));
    let sending = false;
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; };
    const update = () => { send.disabled = sending || !ta.value.trim(); };
    function commentEl(c) {
      const u = deps.getUser(c.authorId);
      return h('li', { class: 'pn-c' }, deps.avatar(u, 28),
        h('div', { class: 'pn-c-body' },
          h('div', { class: 'pn-c-head' }, h('strong', { class: 'pn-c-name' }, deps.nameOf(c, u)),
            Number.isFinite(Number(c.createdAt)) ? h('time', { class: 'pn-c-time', datetime: new Date(Number(c.createdAt)).toISOString() }, fmtStamp(Number(c.createdAt))) : null),
          deps.textEl(c)),
        ibtn('arrowUp', 'Show in chat', () => { if (ctx.close) ctx.close(); deps.openMessage(c); }, { cls: 'sm pn-c-jump' }));
    }
    function drawComments() {
      const shown = thread.list.filter((c) => isCommentOn(c, m, f, fi));
      const n = thread.loaded ? shown.length : Math.max(shown.length, commentCount(countsOf(m), fi));
      heading.textContent = n ? String(n) : '';
      // (One just sent shows even when the list couldn't be loaded.)
      const failed = thread.error ? h('li', { class: 'pn-empty' }, thread.error, ' ', h('button', { class: 'link-btn', type: 'button', onclick: reload }, 'Try again')) : null;
      if (shown.length) list.replaceChildren(...shown.map(commentEl), ...(failed ? [failed] : []));
      else if (failed) list.replaceChildren(failed);
      else if (!thread.loaded) list.replaceChildren(h('li', { class: 'pn-empty' }, 'Loading…'));
      else list.replaceChildren(h('li', { class: 'pn-empty' }, `No comments on this ${what} yet.`));
      more.hidden = !thread.loaded || !thread.next;
    }
    // Loaded again (a comment came or went): at most once at a time, and once more if asked meanwhile.
    let again = false;
    function reload() {
      if (thread.job) { again = true; return thread.job; }
      return loadComments(thread, m, f, fi).then(() => { drawComments(); if (again) { again = false; reload(); } });
    }
    async function submit() {
      if (sending || noComment) return;
      const text = deps.spelled(ta);
      if (!text.trim()) return;
      sending = true;
      update();
      note(boxNote, '');
      try {
        const msg = await deps.sendComment({ m, f, fi, key }, text);
        ta.value = '';
        autosize();
        if (msg && msg.id) {
          await Promise.resolve(deps.decrypt(msg)).catch(() => {});
          if (isCommentOn(msg, m, f, fi) && !thread.list.some((x) => x.id === msg.id)) thread.list = [...thread.list, msg].sort((a, b) => (a.id < b.id ? -1 : 1));
          drawComments();
          const last = list.lastElementChild;
          if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
        }
      } catch (e) {
        note(boxNote, e.message || 'Couldn’t send the comment.');
      } finally {
        sending = false;
        update();
      }
    }
    if (!noComment) {
      deps.spellBox(ta);
      ta.addEventListener('input', () => { autosize(); update(); });
      // Enter sends, Shift+Enter makes a new line (and nothing while an input method is still composing a word).
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
      send.addEventListener('click', submit);
    }

    const el = h('div', { class: 'pn-side' },
      h('section', { class: 'pn-sec pn-tags', 'aria-label': 'Tags' },
        h('h3', { class: 'pn-h' }, icon('tag'), 'Tags'), chips,
        noTag ? h('p', { class: 'pn-note' }, noTag) : h('div', { class: 'pn-add' }, tagIn, tagAdd),
        suggest, tagNote),
      h('section', { class: 'pn-sec pn-comments', 'aria-label': 'Comments' },
        h('h3', { class: 'pn-h' }, icon('message'), 'Comments', heading), list, more,
        noComment ? h('p', { class: 'pn-note' }, noComment) : h('div', { class: 'pn-compose' }, ta, send), boxNote));
    const panel = { el, m, fi, drawTags, reload, born: Date.now() };
    prune();
    panels.add(panel);
    drawTags();
    drawComments();
    // What it needs from the server (its comments, and the labels used here for the suggestions), once it's really on
    // screen: the viewer may draw it before showing it, and flipping through photos shouldn't load every one passed.
    whenOnScreen(el, () => { reload(); convTags(key).then(drawSuggest, () => {}); });
    if (!noComment && (ctx.focus === 'comment' || ctx.focus === true)) {
      // Once it's on screen (the viewer puts it there after this returns).
      let tries = 0;
      const focus = () => { if (ta.isConnected) ta.focus({ preventScroll: true }); else if (tries++ < 30) requestAnimationFrame(focus); };
      requestAnimationFrame(focus);
    }
    return el;
  }

  return { side, badges, tagsOf, tagIndex, counts, tileExtras, onTags, onFileReplies, onKeys, reconnected };
}
