// Chat backgrounds: a background for a DM or a group chat, set by someone in it and seen by everyone in it,
// end-to-end encrypted like the messages.
//
// A background is one of the app's presets (appearance.js BACKGROUNDS) or a picture of someone's own, plus how much a
// picture is dimmed so the text stays readable. It's sealed on the device with the conversation's key (e2ee.js lkc1 /
// lkd1, secure.js encryptLook / openLook): in a group chat with the group's current key and the setter's signature, in a
// DM with the key the two people share. The server keeps it beside the conversation with a version it counts up on each
// change (and keeps counting after a removal); the version is sealed in with it, so an older background can't be brought
// back as a newer one. A picture is resized like a photo (media.js prepareImage), encrypted with a key of its own
// (e2ee.js encryptFile) and uploaded like an attachment; its address and key travel inside the sealed background. The
// server learns that a conversation has a background, a picture's size, who changed it and when; never which one.
//
// The app shows it as its backdrop while that conversation is open, the way a server's theme background shows
// (appearance.js setServerTheme, from app.js renderAll), unless this device turned chat backgrounds off (Settings ->
// Appearance, appearance.js chatLooks). A picture is downloaded only then, decrypted, and kept as a blob: URL this
// module made itself (only such URLs ever reach the CSS); a few are kept, and each is revoked once its background
// changes or goes.
//
// What app.js gets (createChatLook): menuItem(key) for the More and right-click menus, themeFor(view) for setServerTheme,
// onEvent(kind, data) for the live dm:look / group:look, fromBootstrap(dms, servers), lineFor / lineParts and events for
// the "changed the chat background" lines in the conversation, onKeys(serverId) and onTrust(userId) to open again what
// was waiting for a key, coverChanged() when a screen share starts or stops, reset(), and save / remove (what the dialog
// does). Conversations are keyed as the server keys them: 'd:<dmId>' or 'g:<groupServerId>'.
//
// A group chat's background is sealed with the key the group had when it was set. Someone who joins after the key
// changed is only ever handed the new one, so the first app here that opens a background sealed with an older key, and
// holds the current one, seals the same background again with it (reseal, below); the server takes that quietly, with
// no line in the conversation, and the background still counts as whoever set it (the record's setBy).
import { h, icon, toast } from './util.js';
import { modal, showError } from './ui.js';
import { api } from './api.js';
import { BACKGROUNDS } from './appearance.js';
import { encryptFile, decryptFile, lookEpoch } from './e2ee.js';
import { cleanLook, LOOK_TYPES, LOOK_DIM_MAX } from './secure.js';
import { sysLineParts } from './disappear.js';

export const IMAGE_MAX = 10 * 1024 * 1024; // a background picture, after resizing (the server's upload limit may be lower)
const PICK_MAX = 40 * 1024 * 1024; // what can be picked before it's resized
const IMAGES_KEPT = 4; // decrypted pictures kept in memory (besides the one on screen)
export const DIM_DEFAULT = 0.35; // a picture's dim to start with
const RETRY_FIRST = 15000; // a background whose author's keys couldn't be looked up: opened again after 15 s, 30 s, 60 s
const RETRY_TIMES = 3;
const PICTURE_RETRY = 30000; // a picture that couldn't be downloaded (not gone): tried again after this, when it's needed
const RESEAL_SPREAD = 8000; // a group chat's background sealed with an older key: sealed again after a random wait up to this
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UPLOAD = /^\/uploads\/[a-z0-9]{1,80}\.bin$/;
// The presets a conversation can have: all but the plain one (no background does that).
const PRESETS = BACKGROUNDS.filter((b) => !b.solid);
// What may go inside url("…") in the CSS: a blob: URL with nothing that could end the string or the url().
const SAFE_BLOB = /^blob:[^"'()\\\s]+$/;

// ------------------------------------------------------------------ pure helpers (test/chat-look-client.test.js)
// A background as the server lists it (bootstrap, a live event, a write's answer): { version, ciphertext, authorId,
// updatedAt }, or { version, cleared: true } for one that was removed. null for anything malformed. (The epoch beside
// a group chat's is left out: the one that counts is inside the ciphertext.)
export function cleanRecord(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const { version } = x;
  if (!Number.isInteger(version) || version < 1 || version > 1e9) return null;
  if (x.cleared === true || x.ciphertext === '' || x.ciphertext == null) return { version, cleared: true };
  if (typeof x.ciphertext !== 'string' || x.ciphertext.length > 2000 || typeof x.authorId !== 'string' || !ID.test(x.authorId)) return null;
  const at = Number(x.updatedAt);
  // setBy: one sealed again after a key change (by its author) is still whoever set it before.
  const setBy = typeof x.setBy === 'string' && ID.test(x.setBy) && x.setBy !== x.authorId ? x.setBy : null;
  return { version, ciphertext: x.ciphertext, authorId: x.authorId, updatedAt: Number.isFinite(at) && at > 0 ? at : 0, ...(setBy ? { setBy } : {}) };
}
// The history page's lookEvents (and a live event's event): { id, userId, action: 'set' | 'clear', createdAt } as the
// entries app.js keeps beside the timer lines, { id: 'lk:<id>', by, look, at } (the prefix keeps them apart from the
// timer's). Only well-formed ones.
export function lookEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list.slice(0, 500)) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !ID.test(x.id) || (x.action !== 'set' && x.action !== 'clear')) continue;
    const at = Number(x.createdAt);
    if (!Number.isFinite(at) || at <= 0) continue;
    out.push({ id: 'lk:' + x.id, by: typeof x.userId === 'string' && ID.test(x.userId) ? x.userId : null, look: x.action, at });
  }
  return out;
}
// The line in the conversation, in parts, as the timer's (disappear.js sysLineParts): "You" only for your own change,
// anyone else's name drawn apart from it with their @username where it could pass for "You". entry: { by, look } (or
// the server's { userId, action }).
export function lookLineParts(entry, meId, nameOf, handleOf = () => null) {
  const by = (entry && (entry.by || entry.userId)) || null;
  const p = sysLineParts({ by }, meId, nameOf, handleOf);
  const cleared = !!entry && (entry.look || entry.action) === 'clear';
  return { self: p.self, who: p.who, handle: p.handle, action: cleared ? 'removed the chat background' : 'changed the chat background' };
}
export function lookLineText(entry, meId, nameOf, handleOf) {
  const p = lookLineParts(entry, meId, nameOf, handleOf);
  return `${p.who}${p.handle ? ` (@${p.handle})` : ''} ${p.action}`;
}
// Which conversation a view is, as a background's key: a DM, or a group chat (server(id) finds the server), else null.
export function convOf(view, server) {
  if (!view || typeof view !== 'object') return null;
  if (view.type === 'dm' && typeof view.dmId === 'string' && ID.test(view.dmId)) return 'd:' + view.dmId;
  if (view.type === 'channel' && typeof view.serverId === 'string') {
    const s = server(view.serverId);
    return s && s.kind === 'group' ? 'g:' + s.id : null;
  }
  return null;
}
const whereOf = (key) => (key.startsWith('g:') ? { serverId: key.slice(2) } : { dmId: key.slice(2) });
const pathOf = (key) => `${key.startsWith('g:') ? '/groups/' : '/dms/'}${encodeURIComponent(key.slice(2))}/look`;
const pct = (d) => `${Math.round(d * 100)}%`;
// The same background (both as cleanLook makes them, so their keys come in the same order).
const sameLook = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

export function createChatLook(deps) {
  // key -> { key, version, record, state ('none' | 'opening' | 'ok' | 'pending' | 'error'), look ({ bg, dim } or null),
  //          setBy (who chose the look shown: see chooser), img ({ url, k, blob?, blobUrl?, loading?, failed?, gone?,
  //          used } or null), token, tries, timer, resealed ('<version>|<epoch>' tried already), resealTimer }
  const convs = new Map();
  const made = new Set(); // blob: URLs made here and not revoked yet
  let gen = 0; // bumped by reset(): whatever was under way before is dropped
  let shown = null; // the conversation whose background the app shows (themeFor): its picture is never let go of
  let dialog = null; // { key, close, repaint } while the dialog is open
  // What this device just sealed, so its own write (the answer, or the live echo) isn't opened or downloaded again.
  let local = null; // { key, ciphertext, look, blob }

  const me = () => deps.me() || {};
  const dmOf = (id) => (deps.dms() || []).find((d) => d.id === id) || null;
  function exists(key) {
    if (key.startsWith('d:')) return !!dmOf(key.slice(2));
    const s = key.startsWith('g:') ? deps.server(key.slice(2)) : null;
    return !!s && s.kind === 'group';
  }
  // Who a background may come from: in a DM, one of its two people (the key is theirs alone, but the name sealed in it
  // is whatever the sealer wrote); in a group chat, anyone whose signature this device trusts (secure.js openLook).
  function fromInside(key, authorId) {
    if (!key.startsWith('d:')) return true;
    const d = dmOf(key.slice(2));
    return !!d && (authorId === me().id || authorId === d.userId);
  }

  // ---------------------------------------------------------------- pictures (blob: URLs)
  function makeUrl(blob) {
    const u = URL.createObjectURL(blob);
    made.add(u);
    return u;
  }
  const safeUrl = (u) => typeof u === 'string' && made.has(u) && SAFE_BLOB.test(u);
  function letGo(img) {
    if (!img) return;
    img.dead = true;
    if (img.blobUrl) { made.delete(img.blobUrl); URL.revokeObjectURL(img.blobUrl); img.blobUrl = null; }
    img.blob = null;
  }
  // At most IMAGES_KEPT pictures stay decrypted, the least recently shown going first; never the one on screen or in
  // the open dialog.
  function trimImages() {
    const held = [...convs.values()].filter((e) => e.img && e.img.blobUrl && e.key !== shown && (!dialog || e.key !== dialog.key))
      .sort((a, b) => a.img.used - b.img.used);
    while (held.length > IMAGES_KEPT) { const e = held.shift(); letGo(e.img); e.img = null; }
  }
  function loadImage(e) {
    const look = e.look;
    if (!look || look.bg.kind !== 'image') return;
    const was = e.img;
    if (was && (was.blobUrl || was.loading || was.gone || (was.failed && Date.now() - was.failed < PICTURE_RETRY))) return;
    const img = { url: look.bg.url, k: look.bg.k, loading: true, used: Date.now() };
    e.img = img;
    const g = gen;
    (async () => {
      const buf = await deps.download(look.bg.url, { max: IMAGE_MAX + 28 });
      return new Blob([await decryptFile(look.bg.k, buf)], { type: look.bg.type });
    })().then((blob) => {
      if (g !== gen || e.img !== img || img.dead) return;
      img.loading = false;
      img.blob = blob;
      img.blobUrl = makeUrl(blob);
      trimImages();
      changed(e.key);
    }, (err) => {
      if (g !== gen || e.img !== img) return;
      img.loading = false;
      if (err && err.code === 'gone') img.gone = true; else img.failed = Date.now();
      if (dialog && dialog.key === e.key) dialog.repaint();
    });
  }

  // ---------------------------------------------------------------- what's set where
  function changed(key) {
    try { deps.changed(key); } catch { /* the app's own problem */ }
    if (dialog && dialog.key === key) dialog.repaint();
  }
  function entryOf(key) {
    let e = convs.get(key);
    if (!e) { e = { key, version: 0, record: null, state: 'none', look: null, img: null, token: 0, tries: 0, timer: null }; convs.set(key, e); }
    return e;
  }
  // The background shown for e from now on (null: none), with the picture's copy when this device has it already.
  function setLook(e, look, blob = null) {
    const before = e.img;
    e.look = look;
    e.img = null;
    if (look && look.bg.kind === 'image') {
      if (before && !before.dead && before.url === look.bg.url && before.k === look.bg.k) e.img = before;
      else if (blob) e.img = { url: look.bg.url, k: look.bg.k, blob, blobUrl: makeUrl(blob), used: Date.now() };
    }
    // The app shows the new one first; the picture shown before is let go of after.
    changed(e.key);
    if (before && before !== e.img) letGo(before);
    trimImages();
  }
  function forget(key) {
    const e = convs.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    clearTimeout(e.resealTimer);
    convs.delete(key);
    e.token++;
    if (e.look) changed(key);
    letGo(e.img);
  }
  // A background record for a conversation (null: none). A version older than the one this device has is left alone
  // (force: what the server answered a refused write with, which counts whatever it is), and so is another one for the
  // same version once the first one seen opened (or is opening): that one stays.
  function adopt(key, raw, { force = false } = {}) {
    if (!exists(key)) { forget(key); return; }
    const rec = raw === null ? null : cleanRecord(raw);
    if (raw !== null && !rec) return;
    const e = entryOf(key);
    // What this device had open, to tell the same background sealed again from another one (chooser).
    const had = e.state === 'ok' && e.look && e.record && !e.record.cleared ? { version: e.record.version, look: e.look, setBy: e.setBy } : null;
    if (!rec) {
      e.record = null;
      e.state = 'none';
      e.token++;
      clearTimeout(e.timer);
      if (e.look) setLook(e, null);
      return;
    }
    if (!force && e.record) {
      if (rec.version < e.record.version) return;
      if (rec.version === e.record.version) {
        const same = rec.cleared ? !!e.record.cleared : rec.ciphertext === e.record.ciphertext;
        // The same one again (after a reconnect, say) is opened again only if that's what it was waiting for.
        if (same && !(e.state === 'pending' || (e.state === 'error' && e.retry))) return;
        if (!same && (e.state === 'ok' || e.state === 'opening' || e.state === 'none')) return;
      }
    }
    e.version = rec.version;
    e.record = rec;
    e.tries = 0;
    clearTimeout(e.timer);
    if (rec.cleared) { e.state = 'none'; e.token++; if (e.look) setLook(e, null); return; }
    open(e, had);
  }
  async function open(e, had = null) {
    const token = ++e.token;
    const g = gen;
    const rec = e.record;
    e.state = 'opening';
    e.retry = false;
    if (local && local.key === e.key && local.ciphertext === rec.ciphertext && rec.authorId === me().id) {
      e.state = 'ok';
      e.setBy = rec.authorId;
      setLook(e, local.look, local.blob);
      return;
    }
    let r;
    try { r = await deps.openLook({ ...rec, ...whereOf(e.key) }); } catch { r = { error: true }; }
    if (g !== gen || token !== e.token || convs.get(e.key) !== e) return;
    if (r && r.bg && fromInside(e.key, rec.authorId)) {
      e.state = 'ok';
      e.setBy = chooser(e, rec, r, had);
      setLook(e, r);
      maybeReseal(e);
      return;
    }
    e.state = r && r.pending ? 'pending' : 'error';
    e.retry = !!(r && r.error && r.retry);
    if (e.look) setLook(e, null);
    if (e.retry && e.tries < RETRY_TIMES) {
      const wait = RETRY_FIRST * 2 ** e.tries++;
      e.timer = setTimeout(() => { if (g === gen && convs.get(e.key) === e && e.record === rec) open(e); }, wait);
      if (e.timer && e.timer.unref) e.timer.unref();
    }
  }

  // Who chose a background that just opened: its author, or, for one sealed again after a key change, whoever set it
  // (setBy, as the server says; the person on the newest line). That's who a background set by someone you blocked
  // goes by (themeFor). The server can't see inside, so where this device had the version before it open, it checks:
  // the same background still counts as whoever that one did; another one passed off as sealed again is its author's
  // change, and gets the line in the conversation it would have had (changedQuietly).
  function chooser(e, rec, look, had) {
    if (!rec.setBy) return rec.authorId;
    if (!had || had.version !== rec.version - 1) return rec.setBy;
    if (sameLook(had.look, look)) return had.setBy || rec.setBy;
    if (e.key.startsWith('g:') && deps.changedQuietly) {
      try { deps.changedQuietly(e.key.slice(2), { id: `reseal-${rec.version}`, userId: rec.authorId, action: 'set', createdAt: rec.updatedAt || Date.now() }); } catch { /* the app's own problem */ }
    }
    return rec.authorId;
  }

  // ---------------------------------------------------------------- sealing again after a key change
  // A group chat's background this device opened, sealed with an older key than the one the group uses now (which this
  // device holds): sealed again with the current one, so whoever joined since can open it too. Every app here that can
  // will try, each after a random wait so they don't all go at once; the first one's goes through and the others hear
  // of it (group:look) before their turn, or are refused as stale (409 stale_look), which only means someone else did
  // it. Tried once per background and key on this device. Sealed again, it's signed by whoever did it but still counts
  // as whoever set it (setBy); not one set by someone you blocked, though: it doesn't show here, so it isn't this
  // device's to sign.
  function maybeReseal(e) {
    if (!e.key.startsWith('g:') || e.state !== 'ok' || !e.look || !e.record || e.record.cleared || !deps.currentEpoch || deps.blocked(e.setBy || e.record.authorId)) return;
    const serverId = e.key.slice(2);
    const rec = e.record;
    const was = lookEpoch(rec.ciphertext);
    const epoch = deps.currentEpoch(serverId);
    if (!Number.isInteger(was) || !Number.isInteger(epoch) || was >= epoch || e.resealed === `${rec.version}|${epoch}`) return;
    e.resealed = `${rec.version}|${epoch}`;
    clearTimeout(e.resealTimer);
    const g = gen;
    e.resealTimer = setTimeout(() => {
      if (g === gen && convs.get(e.key) === e) reseal(e, rec, epoch).catch(() => { /* someone else's app can do it */ });
    }, RESEAL_SPREAD * (deps.random || Math.random)());
    if (e.resealTimer && e.resealTimer.unref) e.resealTimer.unref();
  }
  async function reseal(e, rec, epoch) {
    const g = gen;
    const serverId = e.key.slice(2);
    // Not if it changed meanwhile (someone else sealed it again first, or set another), or the key moved on again.
    const still = () => g === gen && convs.get(e.key) === e && e.record === rec && e.state === 'ok' && deps.currentEpoch(serverId) === epoch;
    if (!still()) return;
    const look = e.look;
    const version = rec.version + 1;
    const { ciphertext } = await deps.encryptLook({ serverId }, { version, payload: look });
    if (!still() || lookEpoch(ciphertext) !== epoch) return;
    let res;
    // The same background: the same picture (the server checks the uploads are exactly the ones it already uses).
    try { res = await api('PUT', pathOf(e.key), { version, ciphertext, files: look.bg.kind === 'image' ? [look.bg.url] : [], reseal: true }); } catch (err) {
      const now = err && err.status === 409 && err.code === 'stale_look' && err.body && typeof err.body === 'object' ? err.body.look : undefined;
      if (now !== undefined && g === gen) adopt(e.key, now);
      return;
    }
    if (g === gen && res && res.look !== undefined) adopt(e.key, res.look);
  }

  // ---------------------------------------------------------------- writing
  // Seals and stores (seal: (version) => { ciphertext, files }) or removes (seal null) the conversation's background as
  // the version after the one known here. Refused because someone changed it meanwhile (409 stale_look, with what's
  // there now): that's taken in, and it's tried once more after it. In a group chat the server may also want the
  // group's newest key (withKeyRetry seals it again).
  async function write(key, method, seal) {
    const where = whereOf(key);
    const attempt = async () => {
      const version = (convs.has(key) ? convs.get(key).version : 0) + 1;
      const body = { version, ...(seal ? await seal(version) : {}) };
      return { res: await api(method, pathOf(key), body), body };
    };
    const keyed = () => (seal && where.serverId ? deps.withKeyRetry(where.serverId, attempt) : attempt());
    try {
      return await keyed();
    } catch (err) {
      if (!err || err.status !== 409 || err.code !== 'stale_look') throw err;
      const now = err.body && typeof err.body === 'object' ? err.body.look : undefined;
      if (now !== undefined) adopt(key, now, { force: true });
      return keyed();
    }
  }
  // choice: { preset } | { file, dim } (a picture just picked) | { current: true, dim } (the picture there now, dimmed
  // differently: the server keeps a file the background already uses, so it doesn't go up again).
  // onStatus(text) says how it's going.
  async function save(key, choice, onStatus = () => {}) {
    if (!exists(key)) throw new Error('This conversation isn’t available.');
    let look;
    let blob = null;
    let files = [];
    if (choice.preset) {
      look = cleanLook({ bg: { kind: 'preset', preset: choice.preset }, dim: 0 });
      if (!look || !PRESETS.some((b) => b.id === choice.preset)) throw new Error('That background isn’t one of the app’s.');
    } else if (choice.current) {
      const e = convs.get(key);
      const cur = e && e.look && e.look.bg.kind === 'image' ? e.look.bg : null;
      if (!cur) throw new Error('The picture there now isn’t there any more. Pick one again.');
      look = cleanLook({ bg: cur, dim: choice.dim });
      if (!look) throw new Error('That picture can’t be a background.');
      files = [cur.url];
    } else {
      onStatus('Getting your picture ready…');
      const r = await deps.prepareImage(choice.file);
      const file = r.file;
      if (!LOOK_TYPES.includes(file.type)) throw new Error('Pick a photo: a JPEG, PNG, WebP, GIF or AVIF picture.');
      if (file.size > IMAGE_MAX) throw new Error('That picture is too big for a background, even made smaller (10 MB at most).');
      onStatus('Uploading…');
      const sealed = await encryptFile(await file.arrayBuffer());
      const url = await deps.upload(sealed.blob);
      if (!UPLOAD.test(url)) throw new Error('The upload didn’t work. Try again.');
      look = cleanLook({ bg: { kind: 'image', url, k: sealed.k, w: r.w || 0, h: r.h || 0, type: file.type }, dim: choice.dim });
      if (!look) throw new Error('That picture can’t be a background.');
      blob = file instanceof Blob && file.type === look.bg.type ? file : new Blob([file], { type: look.bg.type });
      files = [url];
    }
    onStatus('Saving…');
    try {
      const { res, body } = await write(key, 'PUT', async (version) => {
        const { ciphertext } = await deps.encryptLook(whereOf(key), { version, payload: look });
        local = { key, ciphertext, look, blob };
        return { ciphertext, files };
      });
      adopt(key, res && res.look !== undefined ? res.look : { version: body.version, ciphertext: body.ciphertext, authorId: me().id, updatedAt: Date.now() });
    } finally { local = null; }
  }
  async function remove(key) {
    if (!exists(key)) throw new Error('This conversation isn’t available.');
    const { res, body } = await write(key, 'DELETE', null);
    adopt(key, res && res.look !== undefined ? res.look : { version: body.version, cleared: true });
  }

  // ---------------------------------------------------------------- the dialog
  // Who may change it, as far as this device knows (the server decides): in a DM, either person, unless you blocked
  // them or their account was deleted; in a group chat, anyone in it (as for renaming it).
  function mayChange(key) {
    if (typeof key !== 'string' || !/^[dg]:/.test(key) || !ID.test(key.slice(2)) || !exists(key)) return false;
    if (key.startsWith('g:')) return true;
    const d = dmOf(key.slice(2));
    const peer = d && deps.getUser(d.userId);
    return !!peer && !peer.deleted && !deps.blocked(d.userId);
  }
  function openDialog(key) {
    if (dialog) dialog.close();
    const e = convs.get(key);
    const cur = e && e.look ? e.look : null;
    // What's picked: a preset's id, 'file' (a picture just chosen here), 'current' (the picture there now) or null.
    let pick = cur ? (cur.bg.kind === 'preset' ? cur.bg.preset : 'current') : null;
    let file = null;
    let fileUrl = null;
    let dim = cur && cur.bg.kind === 'image' ? cur.dim : DIM_DEFAULT;
    // (The picture there now is downloaded for the preview, even with chat backgrounds turned off on this device.)
    if (cur && cur.bg.kind === 'image') loadImage(e);
    const currentUrl = () => { const x = convs.get(key); return x && x.img && safeUrl(x.img.blobUrl) ? x.img.blobUrl : null; };
    const pictureUrl = () => (pick === 'file' ? fileUrl : pick === 'current' ? currentUrl() : null);

    const sw = h('div', { class: 'cl-sw' });
    const shade = h('div', { class: 'cl-shade' });
    const none = h('span', { class: 'cl-none' });
    const preview = h('div', { class: 'cl-preview', role: 'img', 'aria-label': 'Preview' }, sw, shade, none,
      h('div', { class: 'cl-bubbles', 'aria-hidden': 'true' }, h('span', { class: 'cl-bubble' }, 'How does this look?'), h('span', { class: 'cl-bubble mine' }, 'Easy to read!')));
    const tiles = [];
    const tile = (id, name, css) => {
      const b = h('button', { type: 'button', class: 'bg-tile', 'aria-pressed': 'false', dataset: { pick: id }, onclick: () => { pick = id; paint(); } },
        h('span', { class: 'bg-sw', style: { background: css } }), h('span', { class: 'bg-tile-name' }, name));
      tiles.push(b);
      return b;
    };
    const groups = [...new Set(PRESETS.map((b) => b.group))];
    const fileIn = h('input', { type: 'file', accept: LOOK_TYPES.join(','), hidden: true, 'aria-label': 'Your own picture' });
    const ownSw = h('span', { class: 'bg-sw' });
    const own = h('button', { type: 'button', class: 'bg-tile', 'aria-pressed': 'false', onclick: () => {
      // Back to the picture there now, or the one picked, before picking another.
      if (pick !== 'file' && pick !== 'current' && (fileUrl || (cur && cur.bg.kind === 'image'))) { pick = fileUrl ? 'file' : 'current'; paint(); } else fileIn.click();
    } }, ownSw, h('span', { class: 'bg-tile-name' }, 'Your own picture'));
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      if (!LOOK_TYPES.includes(f.type)) { showError(box, 'Pick a photo: a JPEG, PNG, WebP, GIF or AVIF picture.'); return; }
      if (f.size > PICK_MAX) { showError(box, 'That picture is too big (40 MB at most).'); return; }
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      file = f;
      fileUrl = URL.createObjectURL(f);
      if (pick !== 'current') dim = cur && cur.bg.kind === 'image' ? cur.dim : DIM_DEFAULT;
      pick = 'file';
      paint();
    });
    const dimOut = h('span', { class: 'counter' }, pct(dim));
    const dimIn = h('input', { type: 'range', class: 'range', min: '0', max: String(Math.round(LOOK_DIM_MAX * 100)), step: '1', value: String(Math.round(dim * 100)), 'aria-label': 'Dim',
      oninput: (ev) => { dim = Math.min(LOOK_DIM_MAX, Math.max(0, +ev.target.value / 100)); dimOut.textContent = pct(dim); paint(); } });
    const dimRow = h('label', { class: 'slider-row cl-dim' }, h('span', null, 'Dim'), dimIn, dimOut);
    const status = h('p', { class: 'cl-status', role: 'status', 'aria-live': 'polite' });
    const say = (t) => { status.textContent = t; };

    // (Both kinds are blob: URLs made on this device: the picked file's, or one of this module's own.)
    const blobOk = (u) => (typeof u === 'string' && SAFE_BLOB.test(u) ? u : null);
    function paint() {
      const p = PRESETS.find((b) => b.id === pick);
      const pic = blobOk(pictureUrl());
      sw.style.background = p ? p.css : pic ? `center / cover no-repeat url("${pic}")` : '';
      shade.style.opacity = String(p ? 0.25 : pic ? dim : 0);
      preview.classList.toggle('empty', !p && !pic);
      none.hidden = !!p || !!pic;
      const x = convs.get(key);
      const lost = !!x && !!x.img && (!!x.img.gone || !!x.img.failed);
      none.textContent = pick !== 'current' ? 'No background. Everyone sees their own.' : lost ? 'The picture there now couldn’t be loaded.' : 'Loading the picture…';
      for (const t of tiles) { const on = t.dataset.pick === pick; t.classList.toggle('active', on); t.setAttribute('aria-pressed', String(on)); }
      const mine = pick === 'file' || pick === 'current';
      const ownPic = blobOk(fileUrl || currentUrl());
      own.classList.toggle('active', mine);
      own.classList.toggle('add', !ownPic);
      own.setAttribute('aria-pressed', String(mine));
      ownSw.style.background = ownPic ? `center / cover no-repeat url("${ownPic}")` : '';
      ownSw.replaceChildren(...(ownPic ? [] : [icon('plus')]));
      dimRow.hidden = !mine;
    }
    // Nothing to save: what's picked is what's there.
    const unchanged = () => pick === null || (cur && cur.bg.kind === 'preset' && pick === cur.bg.preset) || (pick === 'current' && cur && Math.abs(dim - cur.dim) < 0.005);
    const lock = (on) => box.querySelectorAll('.modal-foot .btn, .bg-tile').forEach((b) => { b.disabled = on; });
    const busy = async (fn) => { lock(true); try { await fn(); } finally { say(''); lock(false); } };

    const body = h('div', { class: 'cl-dialog' },
      h('p', { class: 'muted-p' }, `For ${deps.title(key)}.`),
      preview,
      groups.map((g) => [h('div', { class: 'bg-group-label' }, g), h('div', { class: 'bg-grid' }, PRESETS.filter((b) => b.group === g).map((b) => tile(b.id, b.name, b.css)))]),
      h('div', { class: 'bg-group-label' }, 'Your own picture'),
      h('div', { class: 'bg-grid' }, own, fileIn),
      dimRow,
      status,
      h('p', { class: 'cl-note' }, icon('lock'), h('span', null, 'Everyone in this conversation sees it. It’s end-to-end encrypted, like your messages.')));
    const actions = [
      ...(cur ? [{ label: 'Remove background', action: () => busy(async () => { say('Removing…'); await remove(key); toast('Chat background removed.'); }) }] : []),
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', action: () => (unchanged() ? undefined : busy(async () => {
        if (pick === 'file') await save(key, { file, dim }, say);
        else if (pick === 'current') await save(key, { current: true, dim }, say);
        else await save(key, { preset: pick }, say);
        toast('Chat background saved.');
      })) },
    ];
    const m = modal({
      title: 'Chat background', body, actions, size: 'md', className: 'chat-look-modal',
      onClose: () => { if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = null; if (dialog && dialog.close === m.close) dialog = null; },
    });
    const { box } = m;
    dialog = { key, close: m.close, repaint: paint };
    paint();
    // The dialog's first field is the Dim slider, hidden unless a picture is picked: focus what's picked instead.
    setTimeout(() => { if (!box.contains(document.activeElement)) (box.querySelector('.bg-tile.active') || box.querySelector('.bg-tile') || box).focus({ preventScroll: true }); }, 40);
    return m;
  }

  // While you share your screen, a conversation that's covered keeps its background off the screen: the dialog shows it
  // in its preview, so there's no "Chat background…" for it then, and an open one closes (coverChanged).
  const covered = (key) => !!deps.covered && !!deps.covered(key);

  return {
    // The "Chat background…" item for a DM ('d:<dmId>') or a group chat ('g:<serverId>'), or null where you can't, or
    // while it's covered because you're sharing your screen.
    menuItem(key) {
      return mayChange(key) && !covered(key) ? { label: 'Chat background…', icon: 'palette', action: () => { if (!covered(key)) openDialog(key); } } : null;
    },
    // A screen share started or stopped: the dialog doesn't stay up over a conversation that's covered now.
    coverChanged() {
      if (dialog && covered(dialog.key)) dialog.close();
    },
    // What setServerTheme shows for the open view: the conversation's background, or null (none, not opened, someone
    // you blocked set it, or this device turned chat backgrounds off). chat: true lets appearance.js tell it from a
    // server's theme (each has its own switch). A picture is downloaded the first time it's needed here.
    themeFor(view) {
      const key = convOf(view, (id) => deps.server(id));
      const e = key && deps.enabled() ? convs.get(key) : null;
      if (!e || !e.look || !e.record || deps.blocked(e.setBy || e.record.authorId)) { shown = null; return null; }
      shown = key;
      if (e.look.bg.kind === 'preset') {
        const p = PRESETS.find((b) => b.id === e.look.bg.preset);
        return p ? { chat: true, background: { kind: 'preset', preset: p.id } } : null;
      }
      if (e.img && safeUrl(e.img.blobUrl)) {
        e.img.used = Date.now();
        return { chat: true, background: { kind: 'image', image: e.img.blobUrl, dim: e.look.dim } };
      }
      loadImage(e);
      return null;
    },
    onEvent(kind, data) {
      if (!data || typeof data !== 'object' || !('look' in data)) return;
      if (kind === 'dm:look' && typeof data.dmId === 'string' && ID.test(data.dmId)) adopt('d:' + data.dmId, data.look);
      else if (kind === 'group:look' && typeof data.serverId === 'string' && ID.test(data.serverId)) adopt('g:' + data.serverId, data.look);
    },
    // Every DM and group chat as the bootstrap lists them: what's not there any more is forgotten.
    fromBootstrap(dms, servers) {
      const seen = new Set();
      for (const d of Array.isArray(dms) ? dms : []) {
        if (!d || typeof d.id !== 'string' || !ID.test(d.id)) continue;
        seen.add('d:' + d.id);
        if (d.look !== undefined) adopt('d:' + d.id, d.look);
      }
      for (const s of Array.isArray(servers) ? servers : []) {
        if (!s || s.kind !== 'group' || typeof s.id !== 'string' || !ID.test(s.id)) continue;
        seen.add('g:' + s.id);
        if (s.look !== undefined) adopt('g:' + s.id, s.look);
      }
      for (const key of [...convs.keys()]) if (!seen.has(key)) forget(key);
    },
    // A group key arrived, or the group's key changed (also one this device made itself, which isn't "new" to it): its
    // chat's background may open now, or, if this device has it open already and the key is the group's new one, be
    // sealed again with it.
    onKeys(serverId) {
      const e = convs.get('g:' + serverId);
      if (e && e.record && !e.record.cleared && e.state === 'pending') open(e);
      else if (e && e.state === 'ok') maybeReseal(e);
    },
    // Someone's keys were verified (or changed): a background only their keys would open is tried again.
    onTrust(userId) {
      for (const e of convs.values()) {
        if (!e.record || e.record.cleared || e.state !== 'error') continue;
        const d = e.key.startsWith('d:') ? dmOf(e.key.slice(2)) : null;
        if (e.record.authorId === userId || (d && d.userId === userId)) open(e);
      }
    },
    lineFor: (entry, meId, nameOf, handleOf) => lookLineText(entry, meId, nameOf, handleOf),
    lineParts: (entry, meId, nameOf, handleOf) => lookLineParts(entry, meId, nameOf, handleOf),
    events: (list) => lookEvents(list),
    save,
    remove,
    reset() {
      gen++;
      if (dialog) dialog.close();
      for (const e of convs.values()) { clearTimeout(e.timer); clearTimeout(e.resealTimer); letGo(e.img); }
      convs.clear();
      for (const u of made) URL.revokeObjectURL(u);
      made.clear();
      shown = null;
      local = null;
    },
  };
}
