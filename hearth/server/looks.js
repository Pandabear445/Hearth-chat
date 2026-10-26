// Chat backgrounds (schema v22): a background for a DM or a group chat, one of the app's presets or a picture of
// someone's own, shown to everyone in the conversation behind it.
//
// What the server knows. The look is sealed on the device with the conversation's key, like a message: lkd1: in a DM,
// lkc1: in a group chat (signed by its author, like a group message), padded so every look is the same size whatever
// it holds, and bound to the conversation, its version and its author, so the server can't read one, move it to
// another conversation or pass an old one off as new. A picture is an ordinary encrypted upload whose key is inside the
// look. So the server sees that a conversation has a background, how big its picture is (if it has one), who changed
// it and when; never which background it is.
//
// Versions. Every change names the version it makes: 1 for the first, then one more than the one stored (stored + 1),
// otherwise 409 stale_look with the look as it is now, so two people changing it at once can't silently undo each
// other, and the version is inside the ciphertext, so a look sealed for an older version can never come back. Removing
// a background keeps the row (ciphertext '', files '[]') and its version, so the count carries on.
//
// Files. A picture's upload (and at most one more, say a smaller copy) is linked to the conversation's look
// (blobs.look_conv): the sweeps that remove uploads never attached to a message leave it alone, and a message can't
// take it (attachBlobs). A new look may list uploads its author made that aren't attached to anything yet, or the
// ones the current look already uses (changing only the dim keeps the picture); the uploads the old look used and the
// new one doesn't are removed, and so are all of them when the background is removed. Deleting a group chat (or its
// last member leaving) removes its look, files and log (forget, from purgeServerContent in index.js); a daily sweep
// (from sweepOrphans) removes any whose conversation is gone.
//
// Who may change it: in a DM, either person, but not after a block either way nor once the other account is deleted
// (as for sending a message); in a group chat, anyone in it (as for renaming it).
//
// Sealing it again after a key change (group chats). A group look is sealed with the key the group had when it was set,
// and someone who joins after the key changed (someone left, say) is only ever handed the new one, so on its own the
// look would stay shut for them for good. So the first app in the group that opens it, and holds the current key, seals
// the same look again with that key: { reseal: true }, the next version as usual, the epoch inside it the current one,
// and exactly the uploads the look already uses. That's taken only while the look stored is still sealed with an older
// key than the group's, so it happens once per key change, and it gets no line in the history (nothing changed; the
// live group:look has event: null). The server can't see inside, so a member could pass a different background off as
// one sealed again, but only right after a key change, and anyone in a group chat may change it anyway: all it saves
// them is the line. As with saving it again by hand, the look then counts as the re-sealer's (authorId), whose
// signature it carries.
//
// Routes (all signed in; look:<uid> 20 a minute between them)
//   PUT    /dms/:id/look, /groups/:id/look     { version, ciphertext, files, reseal? } -> { look }
//   DELETE /dms/:id/look, /groups/:id/look     { version } -> { look }
// look: { ciphertext, epoch, authorId, version, updatedAt }, { version, cleared: true } once removed, or null when the
// conversation never had one. Every DM (serializeDm) and every group chat (serializeServer) carries its look.
// Live: dm:look { dmId, look, event } to both people, group:look { serverId, look, event } to the group's members, with
// event: { id, userId, action: 'set' | 'clear', createdAt }, the line the apps show in the conversation (null for a look
// sealed again after a key change, which has none). History pages
// (GET /dms/:id/messages, and GET /channels/:id/messages for a group chat's chat) carry lookEvents: the same entries in
// the page's time range (eventsBetween, as the disappearing timer's).
const { idTime } = require('./disappear');

const LOG_KEEP = 50; // changes kept per conversation
const PAGE_EVENTS = 50; // changes handed out with one history page
const FILES_MAX = 2;
const UPLOADS = '/uploads/';
const UPLOAD = /^\/uploads\/[a-z0-9]+\.bin$/;
const EPOCH = /^[1-9][0-9]{0,8}$/;
// The sealed look: 512 padded bytes (public/js/e2ee.js) and AES-GCM's 16-byte tag.
const CT_BYTES = 528;
const CIPHER_MAX = 1000; // characters: a group look is about 880
const BAD = 'Bad encrypted background. Reload the page.';

module.exports = function setupLooks(ctx) {
  const { api, auth, db, fail, rateLimit, newId, now, requireDm, requireServer, isBlocked, getUserRow, requireCurrentEpoch, removeUpload, getIo, b64Len } = ctx;

  // ---------------------------------------------------------------- input
  // A look's ciphertext, exactly as the apps make it. DM: lkd1:<salt 32 bytes>:<iv 12>:<ciphertext 528>. Group:
  // lkc1:<epoch>:<salt>:<iv>:<ciphertext>:<the author's signature, 64-72 bytes>. Returns the epoch inside a group look
  // (null for a DM); anything else is a 400.
  function lookCipher(c, dm) {
    const p = typeof c === 'string' && c.length <= CIPHER_MAX ? c.split(':') : [];
    const ok = dm
      ? p.length === 4 && p[0] === 'lkd1' && b64Len(p[1]) === 32 && b64Len(p[2]) === 12 && b64Len(p[3]) === CT_BYTES
      : p.length === 6 && p[0] === 'lkc1' && EPOCH.test(p[1]) && b64Len(p[2]) === 32 && b64Len(p[3]) === 12
        && b64Len(p[4]) === CT_BYTES && b64Len(p[5]) >= 64 && b64Len(p[5]) <= 72;
    if (!ok) fail(400, BAD, 'bad_look');
    return dm ? null : Number(p[1]);
  }
  function versionIn(v) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) fail(400, BAD, 'bad_look');
    return v;
  }
  // 0-2 distinct upload addresses (none, or missing, for a preset).
  function filesIn(v) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > FILES_MAX || new Set(v).size !== v.length || !v.every((u) => typeof u === 'string' && UPLOAD.test(u))) fail(400, BAD, 'bad_look');
    return v;
  }
  // reseal: true for the same look sealed again with a group's new key; absent (or false) for a change. Only group
  // chats have keys that change.
  function resealIn(v, dm) {
    if (v === undefined || v === false) return false;
    if (v !== true || dm) fail(400, BAD, 'bad_look');
    return true;
  }

  // ---------------------------------------------------------------- reading
  const rowOf = (conv) => db.prepare('SELECT * FROM chat_looks WHERE conv = ?').get(conv);
  function lookOut(r) {
    if (!r) return null;
    if (!r.ciphertext) return { version: r.version, cleared: true };
    return { ciphertext: r.ciphertext, epoch: r.epoch == null ? null : r.epoch, authorId: r.author_id, version: r.version, updatedAt: r.updated_at };
  }
  const lookOf = (conv) => lookOut(rowOf(conv));
  const logOut = (r) => ({ id: r.id, userId: r.user_id, action: r.action, createdAt: r.created_at });
  // The changes that fall inside one page of history, worked out exactly as the disappearing timer's
  // (server/disappear.js eventsBetween): from the page's first message (or the start, when there's nothing older) up to
  // its last (or now, when there's nothing newer). before: the ?before= id the page was asked with (it ends there).
  // afterAt: for an ?after= page, when its anchor message was sent (it starts there). from: none before then.
  function eventsBetween(conv, rows, { hasMore, hasNewer, before = null, afterAt = null, from = null } = {}) {
    const lo = Math.max(afterAt != null ? afterAt : hasMore && rows.length ? rows[0].created_at : 0, from || 0);
    let hi = hasNewer && rows.length ? rows[rows.length - 1].created_at + 1 : Number.MAX_SAFE_INTEGER;
    const b = before ? idTime(before) : null;
    if (b != null) hi = Math.min(hi, b);
    return db.prepare('SELECT * FROM look_log WHERE conv = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(conv, lo, hi, PAGE_EVENTS).reverse().map(logOut);
  }

  // ---------------------------------------------------------------- the conversations
  // A DM: either person, not after a block (either way), nor once the other account is deleted.
  function dmFor(req) {
    const d = requireDm(req.params.id, req.userId);
    if (isBlocked(d.user_a, d.user_b)) fail(403, 'You can’t message this person.');
    if ((getUserRow(d.user_a === req.userId ? d.user_b : d.user_a) || {}).deleted_at) fail(403, 'This account was deleted.', 'deleted');
    return { conv: 'd:' + d.id, dm: true,
      emit: (look, event) => { const io = getIo(); if (io) io.to([`user:${d.user_a}`, `user:${d.user_b}`]).emit('dm:look', { dmId: d.id, look, event }); } };
  }
  // A group chat: anyone in it, as for renaming it (PATCH /servers/:id). Not a server's.
  function groupFor(req) {
    const s = requireServer(req.params.id, req.userId);
    if (s.kind !== 'group') fail(400, 'This isn’t a group chat.');
    return { conv: 'g:' + s.id, dm: false, serverId: s.id,
      emit: (look, event) => { const io = getIo(); if (io) io.to(`server:${s.id}`).emit('group:look', { serverId: s.id, look, event }); } };
  }

  // ---------------------------------------------------------------- changing it
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  // Not the next version: someone changed it meanwhile. The app gets the look as it is now, to show it and to seal its
  // own change again for the version after it.
  const nextVersion = (cur) => (cur ? cur.version : 0) + 1;
  const stale = (res, cur) => res.status(409).json({ error: 'Someone just changed the chat background. Have a look and try again.', code: 'stale_look', look: lookOut(cur) });
  // The look (or its removal), its files and its line in the history, in one transaction; the uploads it no longer
  // uses are removed once that has committed. Every file listed must be one its author uploaded that isn't attached to
  // anything, or one the conversation's look already uses; otherwise nothing changes. action null: the same look sealed
  // again (set), which gets no line.
  function write(where, uid, version, next, action) {
    const t = now();
    const event = action ? { id: newId(), userId: uid, action, createdAt: t } : null;
    const names = next.files.map((u) => u.slice(UPLOADS.length));
    let gone = [];
    db.transaction(() => {
      const link = db.prepare(`UPDATE blobs SET look_conv = ? WHERE name = ? AND message_id IS NULL
        AND (look_conv = ? OR (look_conv IS NULL AND uploader_id = ?))`);
      for (const n of names) if (link.run(where.conv, n, where.conv, uid).changes !== 1) fail(400, 'That picture can’t be used for the background. Upload it again.', 'look_file');
      gone = db.prepare('SELECT name FROM blobs WHERE look_conv = ?').all(where.conv).map((r) => r.name).filter((n) => !names.includes(n));
      for (const n of gone) db.prepare('DELETE FROM blobs WHERE name = ?').run(n);
      db.prepare(`INSERT INTO chat_looks (conv, ciphertext, epoch, author_id, version, files, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conv) DO UPDATE SET ciphertext = excluded.ciphertext, epoch = excluded.epoch, author_id = excluded.author_id,
        version = excluded.version, files = excluded.files, updated_at = excluded.updated_at`)
        .run(where.conv, next.ciphertext, next.epoch, uid, version, JSON.stringify(next.files), t);
      if (event) {
        db.prepare('INSERT INTO look_log (id, conv, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)').run(event.id, where.conv, uid, action, t);
        db.prepare(`DELETE FROM look_log WHERE conv = ? AND id NOT IN (SELECT id FROM look_log WHERE conv = ? ORDER BY created_at DESC, id DESC LIMIT ${LOG_KEEP})`).run(where.conv, where.conv);
      }
    })();
    // removeUpload also drops the uploader's user_files row, so their storage use goes down.
    gone.forEach((n) => removeUpload(UPLOADS + n));
    const look = lookOut(rowOf(where.conv));
    where.emit(look, event);
    return look;
  }
  function set(req, res, where) {
    const b = body(req);
    const version = versionIn(b.version);
    const epoch = lookCipher(b.ciphertext, where.dm);
    const files = filesIn(b.files);
    const reseal = resealIn(b.reseal, where.dm);
    const cur = rowOf(where.conv);
    // (A re-seal that lost the race to another member's is told here too: someone else did it.)
    if (version !== nextVersion(cur)) return stale(res, cur);
    // Sealed with the group's current key, like a message sent now. The epoch is the one inside the ciphertext (bound
    // into it and signed), never one beside it.
    if (!where.dm) requireCurrentEpoch(where.serverId, epoch);
    if (reseal) {
      // Only a look that's there and sealed with an older key than the group's (the epoch is the current one now), and
      // exactly the uploads it already uses: the same look, not a new one.
      if (!cur || !cur.ciphertext || !Number.isInteger(cur.epoch) || cur.epoch >= epoch) fail(409, 'This background doesn’t need sealing again.', 'not_stale');
      const had = JSON.parse(cur.files || '[]');
      if (files.length !== had.length || !files.every((u) => had.includes(u))) fail(400, BAD, 'bad_look');
    }
    res.json({ look: write(where, req.userId, version, { ciphertext: b.ciphertext, epoch, files }, reseal ? null : 'set') });
  }
  function clear(req, res, where) {
    const version = versionIn(body(req).version);
    const cur = rowOf(where.conv);
    if (version !== nextVersion(cur)) return stale(res, cur);
    // Nothing to remove (never set, or removed already): nothing changes, and nobody gets a line about it.
    if (!cur || !cur.ciphertext) return res.json({ look: lookOut(cur) });
    res.json({ look: write(where, req.userId, version, { ciphertext: '', epoch: null, files: [] }, 'clear') });
  }
  const limit = (req) => rateLimit('look:' + req.userId, 20, 60000);
  api.put('/dms/:id/look', auth, (req, res) => { limit(req); set(req, res, dmFor(req)); });
  api.put('/groups/:id/look', auth, (req, res) => { limit(req); set(req, res, groupFor(req)); });
  api.delete('/dms/:id/look', auth, (req, res) => { limit(req); clear(req, res, dmFor(req)); });
  api.delete('/groups/:id/look', auth, (req, res) => { limit(req); clear(req, res, groupFor(req)); });

  // ---------------------------------------------------------------- clean-up
  // A conversation that's going (a group chat being deleted): its look, its picture and its log.
  function forget(conv) {
    const names = db.prepare('SELECT name FROM blobs WHERE look_conv = ?').all(conv).map((r) => r.name);
    db.transaction(() => {
      db.prepare('DELETE FROM blobs WHERE look_conv = ?').run(conv);
      db.prepare('DELETE FROM chat_looks WHERE conv = ?').run(conv);
      db.prepare('DELETE FROM look_log WHERE conv = ?').run(conv);
    })();
    names.forEach((n) => removeUpload(UPLOADS + n));
  }
  // Looks, pictures and logs whose conversation is gone some other way (a DM row removed with an account, or anything
  // left from a crash between a group's deletion and its clean-up). Daily, from sweepOrphans in index.js. A log line is
  // only ever written with its look (write) and goes with it (forget), so the looks and the pictures are all it reads:
  // one row per conversation that has had one, and the partial index of pictures.
  const orphaned = (col) => `((${col} LIKE 'd:%' AND NOT EXISTS (SELECT 1 FROM dm_channels WHERE id = substr(${col}, 3)))
    OR (${col} LIKE 'g:%' AND NOT EXISTS (SELECT 1 FROM servers WHERE id = substr(${col}, 3))))`;
  function sweep() {
    const convs = db.prepare(`SELECT conv FROM chat_looks WHERE ${orphaned('conv')}
      UNION SELECT look_conv FROM blobs WHERE look_conv IS NOT NULL AND ${orphaned('look_conv')}`).all().map((r) => r.conv);
    convs.forEach(forget);
    return convs.length;
  }

  return { lookOf, eventsBetween, forget, sweep, lookCipher };
};
module.exports.LOG_KEEP = LOG_KEEP;
module.exports.CT_BYTES = CT_BYTES;
