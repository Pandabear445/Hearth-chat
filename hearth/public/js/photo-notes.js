// Comments on one photo of a message, and tags (labels) on photos, in DMs, group chats and server channels: "if photos
// are sent in 1 clump you can individually comment on them and tag them".
//
// A comment is an ordinary encrypted reply, sent through the app's own send path (the same encryption, binding,
// disappearing timer and errors as any reply), so people are notified and see it in the chat. Inside it, beside what it
// replies to, it says which photo it is about: ph { i, u }, the index into the replied-to message's files and that file's
// address (binding.js photoOf). The server is told the index too (replyFile), but only to count each photo's comments:
// which photo a comment is about always comes from what's inside it (isCommentOn).
//
// A tag is a short label someone put on one photo or video. It's sealed on the device with the conversation's key
// (e2ee.js tc1 / td1, secure.js encryptTag / openTag), bound to the conversation, the message, which of its files, its
// own id and who added it, and kept by the server beside the message. The server learns that file i of a message has a
// tag by someone, and when; never the words. Inside, beside the label, is the address of the file it was put on, which
// must still be that file's when it's read: a message whose files changed since (only its sender can do that) doesn't
// carry its tags over to another picture. Labels are compared without regard to case. Only tags that count show
// anywhere: on a picture, in the Photos & videos panel's chips and in what the "Add a tag" box suggests (labelOn).
//
// Labels and comments are what people wrote: on screen they're text nodes only, never HTML. (A comment's words go
// through the app's markdown renderer, like any message, in textEl from app.js.)
//
// What app.js gets (createPhotoNotes): side(item, ctx) for the picture viewer's side panel, badges(m, fi) for the counts on
// a picture, tagsOf(m, fi), tagIndex(key) for the Photos & videos panel's tag filter, counts(m, fi) ({ comments, tags },
// for the viewer's Comments button), and for the chat:
// tileExtras (a picture's counts and its "Comment on this photo" button), and the live updates onTags, onFileReplies,
// onDelete (messages deleted or disappeared), onKeys, onTrust (someone's keys verified or changed), onBlock and
// reconnected; messages() and expire() for the app's disappearing timer.
import { h, icon, fmtStamp } from './util.js';
import { ibtn } from './ui.js';
import { api } from './api.js';
import { mediaKind } from './files.js';
import { whenOnScreen } from './media.js';
import { newUid, trustedBinding, PHOTO_MAX } from './binding.js';

export const LABEL_MAX = 40; // characters (whole ones: an emoji counts once)
export const TAGS_PER_PHOTO = 20; // the server's limit too (server/index.js)
const TAGS_LISTED = 2000; // the most GET …/tags lists (server/photos.js)
const COMMENTS_PAGE = 100; // the most GET …/comments answers at once
// A photo's comments loaded again (one came or went) go as far as they had been loaded (Show more included), in at
// most this many pages: what was loaded past those stays as it was.
const RELOAD_PAGES = 10;
const IDS_PAGE = 100; // the most GET …/media?ids= takes at once
const SUGGESTIONS = 8;
// Bounded memories, so a long session doesn't keep growing.
const OPENED_MAX = 8000;
const META_MAX = 2000;
// Every message a conversation's tags are on fits (the tags listed are on at most that many), so working its tag index
// out again after a change never fetches them again.
const FETCHED_MAX = TAGS_LISTED;
const COMMENTS_MAX = 200;
const BUILT_MAX = 50;
// A tag whose author's keys couldn't be looked up (offline, say) is opened again after 15 s, then 30 s and so on, five
// times at most (and again after reconnecting, or once their keys are verified).
const RETRY_FIRST = 15000;
const RETRY_TIMES = 5;
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
// What's typed in the "Add a tag" box, kept to LABEL_MAX whole characters (as normLabel counts them: an emoji once,
// where a browser's maxlength counts it twice). null when it fits as it is; else { value, caret } (caret: where the
// cursor was, in the shorter text).
export function fitLabel(value, caret = value.length) {
  if (typeof value !== 'string') return null;
  const chars = [...value.normalize('NFC')].filter((c) => !loneHalf(c));
  if (chars.length <= LABEL_MAX) return null;
  const before = [...value.slice(0, caret).normalize('NFC')].filter((c) => !loneHalf(c)).length;
  const kept = chars.slice(0, LABEL_MAX);
  return { value: kept.join(''), caret: kept.slice(0, Math.min(before, LABEL_MAX)).join('').length };
}

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
// Whether the server keeps comments and tags on file fi of message m. It counts the files each message brought with it
// (m.files) and refuses both on a file past that count: a message forwarded before it counted them (whose files are the
// original's) has none. A server that doesn't say (an older one) is taken as keeping them.
export const serverKeeps = (m, fi) => !!m && Number.isInteger(fi) && fi >= 0 && (typeof m.files !== 'number' || fi < m.files);
const keyOf = (m) => (m.dmId ? 'd:' + m.dmId : 'c:' + m.channelId);

// Whether reply c is a comment on photo fi (its file f) of message m: it opened, says inside that it's about this very
// file (the index and the address), is in the same conversation, was written as a reply to this message by an app this
// device trusts for its author (binding.js trustedBinding: a channel message that verified, a DM opened with a key this
// device trusts), and hasn't disappeared nor is it from someone you blocked. Nothing the server says can put a comment
// under another photo or message: neither replyFile nor which comments it lists for a photo.
// app: { readable(m), expired(m), blocked(userId) }, as the app has them.
export function isCommentOn(c, m, f, fi, app) {
  if (!c || !m || !f || !app.readable(c) || !c.dec.ph || c.dec.ph.i !== fi || c.dec.ph.u !== f.url) return false;
  if (keyOf(c) !== keyOf(m) || app.expired(c) || app.blocked(c.authorId)) return false;
  const b = trustedBinding(c);
  return !!b && b.r === m.id;
}

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
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Two lists of comments as one, each once, oldest first.
const mergeComments = (a, b) => [...a, ...b.filter((c) => !a.some((x) => x.id === c.id))].sort(byId);
// Where a conversation's routes are: /dms/<id> or /channels/<id> (a server channel or a group chat).
const convBase = (key) => (key.startsWith('d:') ? `/dms/${encodeURIComponent(key.slice(2))}` : `/channels/${encodeURIComponent(key.slice(2))}`);
// Where one message's are: /dm-messages/<id> or /messages/<id>.
const msgBase = (m) => `${m.dmId ? '/dm-messages/' : '/messages/'}${encodeURIComponent(m.id)}`;
// Draws a row of buttons again (draw) without losing keyboard focus in it: back on the button for the same label
// (data-label) if it's still there, else on the one now in its place, else on fallback.
function keepingFocus(box, draw, fallback) {
  const at = typeof document !== 'undefined' && box.contains(document.activeElement) ? document.activeElement : null;
  const buttons = () => [...box.querySelectorAll('button')];
  const was = at ? buttons().indexOf(at) : -1;
  const label = at && at.dataset ? at.dataset.label : null;
  draw();
  if (!at || at.isConnected) return;
  const now = buttons();
  const next = (label && now.find((b) => b.dataset.label === label)) || now[Math.min(Math.max(was, 0), now.length - 1)] || fallback;
  if (next && next.isConnected) next.focus({ preventScroll: true });
}

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
//   enterSends()                  Enter sends a message (Settings: "Enter sends the message"), else Ctrl or ⌘+Enter
//   spellBox(ta), spelled(ta), spellcheck()   the message box's spelling, for the comment box
//   copies(id)                    every loaded copy of a message (the conversation, threads)
//   loaded(id)                    one loaded copy, or null
//   onMeta(key, id)               a message's tags or comment counts changed (the Photos & videos panel redraws it)
//   onIndex(key)                  a conversation's tag index changed though no message's tags did (tags that opened
//                                 at last, or that went with their message): the Photos & videos panel's chips again
//   openMessage(m)                shows a message in the chat (a comment, from the side panel), closing the viewer
//   retryAfter                    (optional) ms before a tag whose author's keys couldn't be looked up is tried again
export function createPhotoNotes(deps) {
  // tag (bound fields + ciphertext) -> what it said, with its conversation and message (conv, messageId, authorId):
  // { label, fu } | { pending, serverId } | { error, retry? }
  const opened = new Map();
  const opening = new Map(); // the same -> Promise of that
  const waiting = new Set(); // ids of messages whose tags are being opened
  const meta = new Map(); // `${conversation}|${message id}` -> { tags?, fileReplies? } from live updates (newer than copies drawn earlier)
  const convs = new Map(); // conversation -> { recs: Map(message id -> records), live: Set(ids), absent: Set(ids), loaded: Promise }
  const indexes = new Map(); // conversation -> Promise of its tag index (tagIndex), until its tags change
  // conversation -> its tag index as last worked out: what the "Add a tag" box suggests from (still, while it's worked
  // out again after a change).
  const built = new Map();
  const fetched = new Map(); // message id -> a message fetched (and decrypted) for the tag index, the least used first
  const threads = new Map(); // `${messageId}|${fi}|${file address}` -> { list, next, loaded, error, job, again }: comments on one photo
  const panels = new Set(); // side panels handed out: { el, m, fi, thread, suggests, drawTags, drawSuggest, drawComments, reload, born }
  const cleaned = new WeakMap(); // m.tags (as the server sent it) -> its clean records
  const retryFirst = deps.retryAfter > 0 ? deps.retryAfter : RETRY_FIRST;
  let retryWait = retryFirst;
  let retryTimer = null;

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
  const commentOn = (c, m, f, fi) => isCommentOn(c, m, f, fi, deps);
  const enterSends = () => (typeof deps.enterSends === 'function' ? deps.enterSends() !== false : true);
  // A copy of a message in this conversation to open its tags on: the chat's, one fetched for the tag index, a side
  // panel's, or one a picture's counts were drawn for (the Photos & videos panel's). null when there's none here.
  function copyOf(conv, id) {
    const drawn = typeof document === 'undefined' || !MSG_ID.test(String(id || '')) ? []
      : [...document.querySelectorAll(`.pn-slot[data-pn-mid="${id}"], .pn-badges[data-pn-mid="${id}"]`)].map((el) => el._pn && el._pn.m);
    return [deps.loaded(id), fetched.get(id), ...[...panels].map((p) => p.m), ...drawn].find((m) => m && m.id === id && keyOf(m) === conv && usable(m)) || null;
  }

  // ---------------------------------------------------------------- opening tags
  function open(conv, messageId, t) {
    const k = recKey(conv, messageId, t);
    if (opened.has(k)) return Promise.resolve(opened.get(k));
    if (opening.has(k)) return opening.get(k);
    const w = deps.where(conv);
    const about = { conv, messageId, authorId: t.authorId };
    const job = (async () => {
      if (!w) return { ...about, error: true };
      const r = await deps.openTag({ ...w, id: t.id, messageId, fileIndex: t.fileIdx, authorId: t.authorId, ciphertext: t.ciphertext, createdAt: t.createdAt });
      // Waiting for a server key that's still on its way: opened again when it comes (onKeys). One older than a key
      // this app already holds never comes, as for messages.
      if (r && r.pending && !r.before) return { ...about, pending: true, serverId: w.serverId };
      // Its author's keys couldn't be looked up: tried again a little later (retrySoon).
      if (r && r.error && r.retry) return { ...about, error: true, retry: true };
      const label = r && !r.error && !r.pending ? normLabel(r.n) : '';
      return label ? { ...about, label, fu: r.fu } : { ...about, error: true };
    })().catch(() => ({ ...about, error: true, retry: true })).then((res) => {
      opening.delete(k);
      put(opened, k, res, OPENED_MAX);
      if (res.retry) retrySoon();
      return res;
    });
    opening.set(k, job);
    return job;
  }
  // Opens a message's tags that aren't yet; once they are, the counts and side panels showing it are drawn again, in
  // place. (Nothing about the message changed, so the Photos & videos panel isn't told: it would fetch it again.)
  function ensureOpen(m) {
    if (!usable(m) || waiting.has(m.id)) return;
    const conv = keyOf(m);
    const todo = recsOf(m).filter((t) => !opened.has(recKey(conv, m.id, t)));
    if (!todo.length) return;
    waiting.add(m.id);
    Promise.all(todo.map((t) => open(conv, m.id, t))).then((rs) => {
      waiting.delete(m.id);
      refreshSlots(m.id); // (also the ones drawn while they were opening: those may have nothing to show now)
      if (rs.some((r) => r.label)) refreshPanels(m.id);
      ensureOpen(m); // any that arrived meanwhile
    });
  }
  // Tags opened again, those pick chooses among what's been opened (ones that failed, or waited for a key): the pictures
  // and side panels showing their messages are drawn again once they open, and their conversations' tag index (the
  // Photos & videos panel's chips, the suggestions) is worked out again.
  function reopen(pick) {
    const again = new Map(); // message id -> its conversation
    for (const [k, r] of [...opened]) if (pick(r)) { opened.delete(k); again.set(r.messageId, r.conv); }
    const hit = new Set(again.values());
    for (const conv of hit) indexes.delete(conv);
    for (const [id, conv] of again) { const m = copyOf(conv, id); if (m) ensureOpen(m); }
    for (const conv of hit) { deps.onIndex(conv); suggestSoon(conv); }
  }
  // Tags that failed only because their author's keys couldn't be looked up, opened again a little later (less and
  // less often, RETRY_TIMES times at most).
  function retrySoon() {
    if (retryTimer || retryWait > retryFirst * 2 ** (RETRY_TIMES - 1)) return;
    retryTimer = setTimeout(() => { retryTimer = null; reopen((r) => r.retry); }, retryWait);
    retryWait *= 2;
  }
  function retryAfresh() {
    clearTimeout(retryTimer);
    retryTimer = null;
    retryWait = retryFirst;
  }
  // The label of one tag on a message (one that's usable), when the tag counts there: it opened, its author isn't
  // blocked, and it's on a photo or video of the message that is still the very file it was put on. Else null. The
  // same for a picture's counts and chips, the Photos & videos panel's chips and the suggestions.
  function labelOn(m, t) {
    if (deps.blocked(t.authorId)) return null;
    const r = peek(keyOf(m), m.id, t);
    const f = deps.filesOf(m)[t.fileIdx];
    return r && r.label && isPhotoOrVideo(f) && f.url === r.fu ? r.label : null;
  }
  // The tags on one photo that count (labelOn), one per label.
  function entriesOn(m, fi) {
    if (!usable(m)) return [];
    const out = [];
    for (const t of recsOf(m)) {
      const label = t.fileIdx === fi ? labelOn(m, t) : null;
      if (label) out.push({ label, rec: t });
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
  // A picture's counts: null when it has none, else an element that keeps itself up to date (refreshSlots), hidden
  // while there's nothing to show (yet: its tags are still being opened, or may open later, once a key comes or is
  // verified).
  function badges(m, fi) {
    const c = counts(m, fi);
    if (!c.comments && !c.tags && !(usable(m) && (waiting.has(m.id) || recsOf(m).some((t) => t.fileIdx === fi)))) return null;
    const el = h('span', { class: 'pn-badges', role: 'img', dataset: { pnMid: m.id, pnFi: String(fi) } });
    el._pn = { m, fi };
    fillBadges(el, c);
    return el;
  }
  function fillBadges(el, c = counts(el._pn.m, el._pn.fi)) {
    const label = countLabel(c);
    el.replaceChildren(
      c.comments ? h('span', { class: 'pn-badge' }, icon('message'), String(c.comments)) : '',
      c.tags ? h('span', { class: 'pn-badge' }, icon('tag'), String(c.tags)) : '');
    el.hidden = !label;
    for (const a of ['aria-label', 'title']) if (label) el.setAttribute(a, label); else el.removeAttribute(a);
  }
  // In the chat, each photo or video of a message with two or more of them: its counts (kept up to date in place, see
  // refreshSlots) and, on hover or focus, "Comment on this photo", which opens it in the viewer at the comment box.
  // Nothing for a message with one picture (replying to it is the same thing), nor for a picture the server keeps no
  // comments or tags for (serverKeeps). Under a spoiler nobody has opened yet, the button only shows once it's open
  // (app.css).
  function tileExtras(m, fi, openComment) {
    if (!usable(m) || !several(m) || !serverKeeps(m, fi)) return [];
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
  // A message's counts changed: its pictures in the chat and in the Photos & videos panel show the new ones, without
  // redrawing anything else (a message drawn again loads its pictures again).
  function refreshSlots(id) {
    if (typeof document === 'undefined' || !MSG_ID.test(String(id || ''))) return;
    for (const slot of document.querySelectorAll(`.pn-slot[data-pn-mid="${id}"]`)) if (slot._pn) fillSlot(slot);
    for (const el of document.querySelectorAll(`.pn-badges[data-pn-mid="${id}"]`)) if (el._pn && !el.closest('.pn-slot')) fillBadges(el);
  }
  function prune() {
    for (const p of panels) if (!p.el.isConnected && Date.now() - p.born > 5000) panels.delete(p);
  }
  // (Comments loaded again once per photo: the panels on one share them.)
  function reloadAll(list) {
    const seen = new Set();
    for (const p of list) if (!seen.has(p.thread)) { seen.add(p.thread); p.reload(); }
  }
  function refreshPanels(id, { comments = false } = {}) {
    prune();
    const here = [...panels].filter((p) => p.m.id === id);
    for (const p of here) p.drawTags();
    if (comments) reloadAll(here);
  }
  // Every side panel showing these comments draws them again.
  function drawThread(t) {
    for (const p of panels) if (p.thread === t) p.drawComments();
  }
  function changed(conv, id) {
    refreshSlots(id);
    refreshPanels(id);
    deps.onMeta(conv, id);
  }
  // The labels used in a conversation changed: the side panels open there that suggest some (you may add tags there)
  // suggest from them once they're worked out.
  function suggestSoon(key) {
    prune();
    if (![...panels].some((p) => p.suggests && keyOf(p.m) === key)) return;
    tagIndex(key).then(() => { for (const p of panels) if (keyOf(p.m) === key) p.drawSuggest(); }, () => {});
  }

  // ---------------------------------------------------------------- live updates (app.js socket handlers)
  function setTags(key, id, list) {
    putLive(key, id, { tags: list });
    const here = deps.copies(id).filter((c) => keyOf(c) === key);
    for (const c of here) c.tags = list;
    const st = convs.get(key);
    if (st) { if (list.length) st.recs.set(id, list); else st.recs.delete(id); st.live.add(id); st.absent.delete(id); }
    indexes.delete(key);
    changed(key, id);
    const one = here[0] || ([...panels].find((p) => p.m.id === id) || {}).m;
    if (one) ensureOpen(one);
    suggestSoon(key);
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
  // Messages deleted or disappeared (key: their conversation, or null when it isn't known): everything kept of them
  // goes. Their tags leave the conversation's list, its tag index (the Photos & videos panel's chips, drawn again) and
  // the labels suggested; the copies fetched for the index, what their tags said and the comments on their photos are
  // let go; and as comments, they leave the side panels listing them. (The server sends no tags event for them.)
  function onDelete(key, ids) {
    const gone = new Set(typeof ids === 'string' ? [ids] : [...(ids || [])]);
    if (!gone.size) return;
    const here = (conv) => !key || conv === key;
    const hit = new Set(); // conversations whose tags changed
    for (const [conv, st] of convs) {
      if (!here(conv)) continue;
      for (const id of gone) if (st.recs.delete(id)) { st.absent.add(id); st.live.delete(id); hit.add(conv); }
    }
    for (const id of gone) {
      const m = fetched.get(id);
      if (m && here(keyOf(m))) { fetched.delete(id); hit.add(keyOf(m)); }
    }
    for (const k of [...meta.keys()]) {
      const at = k.lastIndexOf('|');
      if (gone.has(k.slice(at + 1)) && here(k.slice(0, at))) meta.delete(k);
    }
    for (const [k, r] of [...opened]) if (gone.has(r.messageId) && here(r.conv)) opened.delete(k);
    for (const [k, t] of [...threads]) {
      if (gone.has(k.slice(0, k.indexOf('|')))) { threads.delete(k); continue; }
      const left = t.list.filter((c) => !gone.has(c.id));
      if (left.length !== t.list.length) { t.list = left; drawThread(t); }
    }
    for (const p of panels) if (gone.has(p.m.id) && here(keyOf(p.m))) panels.delete(p);
    // What's suggested meanwhile (until the index is worked out again) leaves them out already.
    for (const [conv, idx] of [...built]) {
      if (!here(conv)) continue;
      const left = new Map();
      for (const [label, list] of idx) { const keep = list.filter((x) => !gone.has(x.messageId)); if (keep.length) left.set(label, keep); }
      if ([...left.values()].reduce((n, l) => n + l.length, 0) === [...idx.values()].reduce((n, l) => n + l.length, 0)) continue;
      built.set(conv, left);
      hit.add(conv);
    }
    for (const conv of hit) {
      indexes.delete(conv);
      deps.onIndex(conv);
      for (const p of panels) if (keyOf(p.m) === conv) p.drawSuggest();
    }
  }
  // The copies kept here that the app's disappearing timer has to know about (the ones fetched for the tag index, and
  // comments loaded for a side panel), and those whose time has come going (onDelete).
  const messages = () => [...fetched.values(), ...[...threads.values()].flatMap((t) => t.list)];
  function expire() {
    const ids = messages().filter((m) => deps.expired(m)).map((m) => m.id);
    if (ids.length) onDelete(null, ids);
  }
  // A server's keys arrived: its tags that were waiting for them open now.
  function onKeys(serverId) {
    reopen((r) => r.pending && r.serverId === serverId);
  }
  // Someone's keys were verified on this device (safety numbers compared), or changed (userId: theirs, or null for
  // anyone): the tags that didn't open are tried again. Theirs, and in DMs anyone's: a DM's tags open with the key both
  // people share.
  function onTrust(userId = null) {
    retryAfresh();
    reopen((r) => r.error && (!userId || r.authorId === userId || String(r.conv).startsWith('d:')));
  }
  // Someone was blocked or unblocked: their tags no longer count, or count again, in the side panels, the chips and the
  // suggestions too. (The app draws the chat again itself.)
  function onBlock() {
    const keys = new Set([...indexes.keys(), ...built.keys()]);
    indexes.clear();
    built.clear();
    prune();
    for (const p of panels) p.drawTags();
    for (const key of keys) { deps.onIndex(key); suggestSoon(key); }
  }
  // Back online after missing whatever happened meanwhile: what came live is forgotten (the copies loaded again say
  // it), tags that didn't open are tried again, and an open side panel loads its comments and suggestions again.
  function reconnected() {
    meta.clear();
    convs.clear();
    indexes.clear();
    retryAfresh();
    reopen((r) => r.error);
    prune();
    reloadAll(panels);
    for (const key of new Set([...panels].map((p) => keyOf(p.m)))) suggestSoon(key);
  }

  // ---------------------------------------------------------------- every tag in a conversation
  // GET …/tags once per conversation (live updates keep it current), every tag opened.
  function convTags(key) {
    const had = convs.get(key);
    if (had) return had.loaded;
    const st = { recs: new Map(), live: new Set(), absent: new Set(), loaded: null };
    convs.set(key, st);
    st.loaded = api('GET', `${convBase(key)}/tags`).then(async (r) => {
      const byMsg = new Map();
      for (const t of cleanTagRecords(r && r.tags)) {
        if (!t.messageId) continue;
        if (!byMsg.has(t.messageId)) byMsg.set(t.messageId, []);
        byMsg.get(t.messageId).push(t);
      }
      for (const [id, recs] of byMsg) if (!st.live.has(id) && !st.absent.has(id)) st.recs.set(id, recs);
      await Promise.all([...st.recs].flatMap(([id, recs]) => recs.map((t) => open(key, id, t))));
      return st;
    }).catch((e) => { if (convs.get(key) === st) convs.delete(key); throw e; });
    return st.loaded;
  }
  // Those messages, decrypted: loaded here already, or fetched (GET …/media?ids=, in pages). One the server doesn't
  // give (deleted, disappeared, not yours to see) is left out, and not asked for again (st.absent).
  async function messagesFor(key, ids, st) {
    const out = new Map();
    const need = [];
    for (const id of ids) {
      const m = deps.loaded(id) || fetched.get(id);
      if (m && keyOf(m) === key && deps.readable(m)) {
        out.set(id, m);
        if (fetched.get(id) === m) put(fetched, id, m, FETCHED_MAX); // (the last to be forgotten now)
      } else if (!st.absent.has(id)) need.push(id);
    }
    for (let i = 0; i < need.length; i += IDS_PAGE) {
      const part = need.slice(i, i + IDS_PAGE);
      let list = [];
      try { const r = await api('GET', `${convBase(key)}/media?${new URLSearchParams({ ids: part.join(',') })}`); list = Array.isArray(r && r.messages) ? r.messages : []; } catch { continue; }
      list = list.filter((m) => m && typeof m === 'object' && part.includes(m.id) && keyOf(m) === key && !st.absent.has(m.id));
      await Promise.all(list.map((m) => Promise.resolve(deps.decrypt(m)).catch(() => {})));
      for (const m of list) if (!st.absent.has(m.id)) { put(fetched, m.id, m, FETCHED_MAX); out.set(m.id, m); }
      for (const id of part) if (!out.has(id)) st.absent.add(id);
    }
    return out;
  }
  // label -> [{ messageId, fileIdx }] for the Photos & videos panel (groupIndex), each tag checked as on a picture
  // (labelOn). Worked out once per conversation, and again only once its tags changed (the panel asks after every
  // change it hears of): with every message it needs kept (FETCHED_MAX), that fetches nothing again.
  function tagIndex(key) {
    if (!deps.where(key)) return Promise.resolve(new Map());
    if (!indexes.has(key)) {
      const job = buildIndex(key);
      indexes.set(key, job);
      job.then((idx) => { if (indexes.get(key) === job) put(built, key, idx, BUILT_MAX); }, () => { if (indexes.get(key) === job) indexes.delete(key); });
    }
    return indexes.get(key);
  }
  async function buildIndex(key) {
    const st = await convTags(key);
    const all = [...st.recs].flatMap(([messageId, recs]) => recs.map((t) => ({ messageId, t })));
    await Promise.all(all.map(({ messageId, t }) => open(key, messageId, t)));
    const ids = [...new Set(all.filter(({ messageId, t }) => (peek(key, messageId, t) || {}).label).map((x) => x.messageId))];
    const msgs = await messagesFor(key, ids, st);
    const entries = [];
    for (const { messageId, t } of all) {
      // (Not one taken off, nor on a message deleted, while this was being worked out.)
      if (!(st.recs.get(messageId) || []).includes(t)) continue;
      const m = msgs.get(messageId);
      const label = m && usable(m) ? labelOn(m, t) : null;
      if (label) entries.push({ label, messageId, fileIdx: t.fileIdx, createdAt: t.createdAt });
    }
    return groupIndex(entries);
  }
  // The labels used in a conversation, for the "Add a tag" box: [{ label, count }], from its tag index (only tags that
  // count, on photos still there), as last worked out.
  function usedLabels(key) {
    const idx = built.get(key);
    return idx ? [...idx].map(([label, list]) => ({ label, count: list.length })) : [];
  }

  // ---------------------------------------------------------------- comments on one photo
  // (By its address too: a message whose files changed is about other photos.)
  function threadOf(m, f, fi) {
    const k = `${m.id}|${fi}|${f.url}`;
    let t = threads.get(k);
    if (!t) { t = { list: [], next: null, loaded: false, error: null, job: null, again: false }; put(threads, k, t, COMMENTS_MAX); }
    return t;
  }
  // One page of GET …/comments?file=fi (oldest first, those after `after`), opened: the comments on this photo in it,
  // and where the next page starts (null after the last).
  async function commentPage(m, f, fi, after) {
    const q = { file: String(fi), limit: String(COMMENTS_PAGE), ...(after ? { after } : {}) };
    const r = await api('GET', `${msgBase(m)}/comments?${new URLSearchParams(q)}`);
    const list = (Array.isArray(r && r.messages) ? r.messages : []).filter((c) => c && typeof c === 'object' && MSG_ID.test(String(c.id || '')));
    await Promise.all(list.map((c) => Promise.resolve(deps.decrypt(c)).catch(() => {})));
    return { list: list.filter((c) => commentOn(c, m, f, fi)), next: r && typeof r.next === 'string' && MSG_ID.test(r.next) ? r.next : null };
  }
  // The comments on one photo into t (threadOf), one load at a time, and every side panel showing them drawn when it's
  // done. A load asked for meanwhile happens once after it (again).
  //   more: the page after what's loaded (Show more).
  //   else: from the start again, as far as was loaded before (what Show more loaded, and a comment you just sent,
  //   stay), or to the end when everything was loaded (so new ones show). RELOAD_PAGES pages at most: what was loaded
  //   past those stays as it was.
  function loadComments(t, m, f, fi, { more = false } = {}) {
    if (t.job) { if (!more) t.again = true; return t.job; }
    t.again = false;
    t.job = (async () => {
      try {
        if (more) {
          if (!t.next) return;
          const page = await commentPage(m, f, fi, t.next);
          t.list = mergeComments(t.list, page.list);
          t.next = page.next;
        } else {
          const upTo = t.list.length ? t.list[t.list.length - 1].id : null;
          const whole = t.loaded && !t.next;
          const got = [];
          let next = null;
          for (let n = 0; n < RELOAD_PAGES; n++) {
            const page = await commentPage(m, f, fi, next);
            got.push(...page.list);
            next = page.next;
            if (!next || (!whole && !(upTo && next < upTo))) break;
          }
          t.list = mergeComments(got, next ? t.list.filter((c) => c.id > next) : []);
          t.next = next;
        }
        t.loaded = true;
        t.error = null;
      } catch (e) {
        t.error = e.message || 'Couldn’t load the comments.';
      } finally {
        t.job = null;
        drawThread(t);
        if (t.again) loadComments(t, m, f, fi);
      }
    })();
    return t.job;
  }
  // Until no load of these comments is under way.
  async function settled(t) {
    while (t.job) await t.job;
  }

  // ---------------------------------------------------------------- the viewer's side panel
  // item: { m, f, fi, key } (the viewer's item, app.js openViewer). ctx: { close, focus } (close: hides this panel;
  // focus 'comment': into the comment box once it's on screen). null when the photo can't have comments or tags here
  // (serverKeeps too: there'd be nothing to show, and nothing could be added).
  function side(item, ctx = {}) {
    const m = item && item.m;
    const fi = item && item.fi;
    if (!usable(m) || !Number.isInteger(fi) || !serverKeeps(m, fi)) return null;
    const f = deps.filesOf(m)[fi];
    if (!isPhotoOrVideo(f) || (item.f && item.f.url && item.f.url !== f.url)) return null;
    const key = keyOf(m);
    const what = kindWord(f);
    ensureOpen(m);

    // Tags: chips, the box, suggestions.
    const chips = h('div', { class: 'pn-chips', role: 'list', tabindex: '-1', 'aria-label': `Tags on this ${what}` });
    const tagNote = h('p', { class: 'pn-note', role: 'status', hidden: true });
    const said = h('p', { class: 'pn-said', role: 'status' }); // what happened, for screen readers
    const note = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
    const say = (text) => { said.textContent = ''; said.textContent = text; };
    // (maxlength only stops a huge paste: fitLabel keeps it to LABEL_MAX whole characters, which maxlength can't count.)
    const tagIn = h('input', { class: 'input pn-tag-in', type: 'text', maxlength: String(LABEL_MAX * 4), placeholder: 'Add a tag', 'aria-label': `Add a tag to this ${what}`,
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const tagAdd = h('button', { class: 'btn sm ghost pn-tag-add', type: 'button', disabled: true }, 'Add');
    const suggest = h('div', { class: 'pn-suggest', role: 'group', 'aria-label': 'Tags used in this conversation', hidden: true });
    const noTag = deps.canPost(key, null);
    let tagBusy = false;
    const mayRemove = (t) => t.authorId === me().id || m.authorId === me().id || deps.canManage(key);
    const addedBy = (rec) => deps.nameOf(m, deps.getUser(rec.authorId));
    function chip({ label, rec }) {
      return h('span', { class: 'chip pn-chip', role: 'listitem', title: `#${label} · added by ${addedBy(rec)}` },
        h('span', { class: 'pn-chip-text' }, `#${label}`),
        mayRemove(rec) ? h('button', { class: 'chip-x', type: 'button', dataset: { label: labelKey(label) }, 'aria-label': `Remove the tag ${label}`, onclick: () => removeTag(label) }, icon('close')) : null);
    }
    // Drawn again only when what they show changed, keeping keyboard focus (on the next one when its tag went).
    let chipsSig = null;
    function drawTags() {
      const list = entriesOn(m, fi);
      const sig = list.map((e) => [e.label, addedBy(e.rec), mayRemove(e.rec)].join('\u0001')).join('\u0000');
      if (sig !== chipsSig) {
        chipsSig = sig;
        keepingFocus(chips, () => chips.replaceChildren(...(list.length ? list.map(chip) : [h('span', { class: 'pn-empty' }, `No tags on this ${what} yet.`)])),
          noTag ? chips : tagIn);
      }
      drawSuggest();
    }
    function drawSuggest() {
      if (noTag) return;
      const labels = suggestLabels(usedLabels(key), tagIn.value, entriesOn(m, fi).map((e) => e.label));
      keepingFocus(suggest, () => suggest.replaceChildren(...labels.map((label) => h('button', { class: 'chip pn-suggestion', type: 'button', dataset: { label: labelKey(label) },
        'aria-label': `Add the tag ${label}`, onmousedown: (e) => e.preventDefault(), onclick: () => addTag(label) }, `#${label}`))), tagIn);
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
          put(opened, recKey(key, m.id, rec), { conv: key, messageId: m.id, authorId: rec.authorId, label, fu: f.url }, OPENED_MAX);
          setTags(key, m.id, [...recsOf(m).filter((t) => t.id !== rec.id), rec]);
          say(`Added the tag ${label}.`);
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
        if (done.size) {
          setTags(key, m.id, recsOf(m).filter((t) => !done.has(t.id)));
          if (done.size === gone.length) say(`Removed the tag ${label}.`);
        }
      }
    }
    // Kept to LABEL_MAX whole characters as it's typed (not halfway through a word an input method is composing).
    function fit() {
      const cut = fitLabel(tagIn.value, tagIn.selectionEnd == null ? tagIn.value.length : tagIn.selectionEnd);
      if (!cut) return;
      tagIn.value = cut.value;
      tagIn.setSelectionRange(cut.caret, cut.caret);
      note(tagNote, `A tag can be at most ${LABEL_MAX} characters.`);
    }
    tagIn.addEventListener('input', (e) => { if (!e.isComposing) fit(); drawSuggest(); });
    tagIn.addEventListener('compositionend', () => { fit(); drawSuggest(); });
    tagIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTag(tagIn.value); } });
    tagAdd.addEventListener('click', () => addTag(tagIn.value));

    // Comments: the list, Show more, the box.
    const thread = threadOf(m, f, fi);
    const heading = h('span', { class: 'pn-count' });
    const list = h('ol', { class: 'pn-list', 'aria-label': `Comments on this ${what}` });
    // (After whatever load is under way: then the page after what that loaded.)
    const more = h('button', { class: 'link-btn pn-more', type: 'button', hidden: true,
      onclick: () => settled(thread).then(() => loadComments(thread, m, f, fi, { more: true })) }, 'Show more comments');
    const boxNote = h('p', { class: 'pn-note', role: 'status', hidden: true });
    const noComment = deps.canPost(key, m.threadId || null);
    const ta = h('textarea', { class: 'input pn-box', rows: '1', maxlength: '4000', placeholder: 'Add a comment…', 'aria-label': `Comment on this ${what}`, spellcheck: deps.spellcheck() });
    const send = h('button', { class: 'send-btn pn-send', type: 'button', 'aria-label': 'Send comment', 'data-tip': enterSends() ? 'Send (Enter)' : 'Send (Ctrl+Enter)', disabled: true }, icon('send'));
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
        ibtn('arrowUp', 'Show in chat', () => deps.openMessage(c), { cls: 'sm pn-c-jump' }));
    }
    function drawComments() {
      const shown = thread.list.filter((c) => commentOn(c, m, f, fi));
      // (With some not loaded yet, the server's count says how many there are.)
      const n = thread.loaded && !thread.next ? shown.length : Math.max(shown.length, commentCount(countsOf(m), fi));
      heading.textContent = n ? String(n) : '';
      // (One just sent shows even when the list couldn't be loaded.)
      const failed = thread.error ? h('li', { class: 'pn-empty' }, thread.error, ' ', h('button', { class: 'link-btn', type: 'button', onclick: reload }, 'Try again')) : null;
      if (shown.length) list.replaceChildren(...shown.map(commentEl), ...(failed ? [failed] : []));
      else if (failed) list.replaceChildren(failed);
      else if (!thread.loaded) list.replaceChildren(h('li', { class: 'pn-empty' }, 'Loading…'));
      else list.replaceChildren(h('li', { class: 'pn-empty' }, `No comments on this ${what} yet.`));
      more.hidden = !thread.loaded || !thread.next;
    }
    // Loaded again (a comment came or went): shared with every panel on this photo (loadComments draws them all).
    const reload = () => loadComments(thread, m, f, fi);
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
          await settled(thread); // (a load that began before it was sent wouldn't have it)
          if (commentOn(msg, m, f, fi)) thread.list = mergeComments(thread.list, [msg]);
          drawThread(thread);
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
      // As in the message box: Enter sends and Shift+Enter makes a new line, or (with "Enter sends the message" off in
      // Settings) Ctrl or ⌘+Enter sends and Enter makes a new line. Nothing while an input method is composing a word.
      ta.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const on = enterSends();
        if ((on && !e.shiftKey) || (!on && (e.ctrlKey || e.metaKey))) { e.preventDefault(); submit(); }
      });
      send.addEventListener('click', submit);
    }

    const el = h('div', { class: 'pn-side' },
      h('section', { class: 'pn-sec pn-tags', 'aria-label': 'Tags' },
        h('h3', { class: 'pn-h' }, icon('tag'), 'Tags'), chips,
        noTag ? h('p', { class: 'pn-note' }, noTag) : h('div', { class: 'pn-add' }, tagIn, tagAdd),
        suggest, tagNote, said),
      h('section', { class: 'pn-sec pn-comments', 'aria-label': 'Comments' },
        h('h3', { class: 'pn-h' }, icon('message'), 'Comments', heading), list, more,
        noComment ? h('p', { class: 'pn-note' }, noComment) : h('div', { class: 'pn-compose' }, ta, send), boxNote));
    const panel = { el, m, fi, thread, suggests: !noTag, drawTags, drawSuggest, drawComments, reload, born: Date.now() };
    prune();
    panels.add(panel);
    drawTags();
    drawComments();
    // What it needs from the server (its comments, and the conversation's tag index for the suggestions), once it's
    // really on screen: the viewer may draw it before showing it, and flipping through photos shouldn't load every one
    // passed.
    whenOnScreen(el, () => { reload(); if (!noTag) tagIndex(key).then(drawSuggest, () => {}); });
    if (!noComment && (ctx.focus === 'comment' || ctx.focus === true)) {
      // Once it's on screen (the viewer puts it there after this returns).
      let tries = 0;
      const focus = () => { if (ta.isConnected) ta.focus({ preventScroll: true }); else if (tries++ < 30) requestAnimationFrame(focus); };
      requestAnimationFrame(focus);
    }
    return el;
  }

  return {
    side, badges, tagsOf, tagIndex, counts, tileExtras,
    onTags, onFileReplies, onDelete, onKeys, onTrust, onBlock, reconnected, messages, expire,
  };
}
