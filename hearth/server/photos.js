// Photos & videos (schema v21): a conversation's pictures and videos in one panel, comments on one photo of a message,
// and tags on photos. In DMs, group chats and server channels alike.
//
// What the server knows. Every attachment, its type and its name are inside the encrypted message, so the server can't
// tell a photo from a PDF. It knows how many uploads each message listed when it was posted (messages.files, set in
// index.js postChannelMessage / postDmMessage), so the panel pages through the messages that have any, newest first,
// and the apps keep the photos and videos. A comment is an ordinary encrypted reply that also says, in the clear
// (replyFile), which photo of the message it replies to it's about, so the server can count comments per photo; which
// photo it really is about the apps read from inside the reply. A tag is a short label sealed on the device with the
// conversation's key, bound to its place (conversation, epoch, message, photo, tag id and author) so the server can't
// move it: the server learns that photo #i of message M has a tag by U, and when, never its words.
//
// Who may do what is what they may do with that message's reactions: reading is for anyone in the conversation who
// can see the message (a DM's two people; in a channel, members who can view it, leaving out what's from before their
// history there starts, server/joinhistory.js), whatever blocks there are. Tagging is posting something everyone
// there sees: in a DM, not after a block either way nor to a deleted account; in a channel, Send Messages there and
// not timed out. A tag can be taken away by its author, the photo's sender, or (in a server) anyone with Manage
// Messages there.
//
// Routes (all signed in)
//   GET    /dms/:id/media, /channels/:id/media            ?before=<message id>&limit=1-60 (30), or ?ids=<id,id,…> (up to
//          100): { messages: newest first, next }. Messages with files that haven't disappeared; a channel's thread
//          replies too. next: the oldest id on the page, to ask for the page before it (null on the last page).
//   GET    /dm-messages/:id/comments, /messages/:id/comments   ?file=0-99&after=<message id>&limit=1-100 (50):
//          { messages: the comments on that photo (any photo without file), oldest first, next }
//   GET    /dms/:id/tags, /channels/:id/tags              { tags: [{ id, messageId, fileIdx, authorId, ciphertext, epoch,
//          createdAt }] }, newest first, at most 2000 (the apps' tag list and filter)
//   POST   /dm-messages/:id/tags, /messages/:id/tags      { id, fileIdx, ciphertext } -> { tag }
//   DELETE /dm-messages/:id/tags/:tagId, /messages/:id/tags/:tagId
// Live (to whoever hears about that message's reactions): dm:tags { id, dmId, tags } and message:tags { id, channelId,
// threadId, tags }, with the message's whole list; dm:file-replies and message:file-replies (index.js emitFileReplies).
// Every serialized message carries files (how many uploads it listed: the apps offer comments and tags only below
// that) and replyFile, and fileReplies and tags when it has any (index.js extrasFor).

const MSG_ID = /^[A-Za-z0-9_-]{1,64}$/;
// The id the app picks for a tag (public/js/binding.js newUid: 16 random bytes, base64url).
const TAG_ID = /^[A-Za-z0-9_-]{22}$/;
const MEDIA_PAGE = 30;
const MEDIA_MAX = 60;
const IDS_MAX = 100;
const COMMENTS_PAGE = 50;
const COMMENTS_MAX = 100;
const TAGS_LISTED = 2000;
const TAGS_PER_PHOTO = 20;
const TAGS_PER_MESSAGE = 300;
const NOT_FOUND = 'Message not found.';

// The statements, with the conditions the partial indexes need written out (files > 0, reply_file IS NOT NULL) and the
// index named, as for pins: the planner then never walks a conversation's whole history for them. Exported for the
// query plan test (test/photos.test.js). LIVE: the disappearing-messages condition (server/disappear.js). hist: join
// history's conditions, from history.where(…) with the alias the query uses.
const sql = (LIVE) => ({
  dmMedia: (before) => `SELECT * FROM dm_messages INDEXED BY idx_dm_messages_files WHERE dm_id = ? AND files > 0${before ? ' AND id < ?' : ''} AND ${LIVE} ORDER BY id DESC LIMIT ?`,
  channelMedia: (before, hist = '') => `SELECT * FROM messages INDEXED BY idx_messages_files WHERE channel_id = ? AND files > 0${before ? ' AND id < ?' : ''}${hist} AND ${LIVE} ORDER BY id DESC LIMIT ?`,
  // By id (the tag filter's photos): one primary key lookup each. CROSS JOIN keeps the list as the outer loop: with join
  // history's conditions SQLite would otherwise rather walk the channel's messages since the reader joined.
  // hist: with the alias 'm.'.
  dmMediaIds: `SELECT m.* FROM json_each(?) j CROSS JOIN dm_messages m ON m.id = j.value
    WHERE m.dm_id = ? AND m.files > 0 AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY m.id DESC`,
  channelMediaIds: (hist = '') => `SELECT m.* FROM json_each(?) j CROSS JOIN messages m ON m.id = j.value
    WHERE m.channel_id = ? AND m.files > 0${hist} AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY m.id DESC`,
  comments: (table, conv, file, after, hist = '') => `SELECT * FROM ${table} INDEXED BY idx_${table}_reply_file WHERE reply_to = ? AND reply_file IS NOT NULL${file ? ' AND reply_file = ?' : ''}
    AND ${conv} = ?${after ? ' AND id > ?' : ''}${hist} AND ${LIVE} ORDER BY id LIMIT ?`,
  // A conversation's tags, newest first, from the (conv, created_at) index; CROSS JOIN keeps that order of the loops, so
  // each tag looks up its one message rather than the conversation's messages being walked for tags.
  dmTags: `SELECT t.* FROM media_tags t INDEXED BY idx_media_tags_conv CROSS JOIN dm_messages m ON m.id = t.message_id
    WHERE t.conv = ? AND m.dm_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY t.created_at DESC, t.id DESC LIMIT ${TAGS_LISTED}`,
  channelTags: (hist = '', floor = false) => `SELECT t.* FROM media_tags t INDEXED BY idx_media_tags_conv CROSS JOIN messages m ON m.id = t.message_id
    WHERE t.conv = ? AND m.channel_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)${hist}${floor ? ' AND t.epoch >= ?' : ''} ORDER BY t.created_at DESC, t.id DESC LIMIT ${TAGS_LISTED}`,
});

module.exports = function setupPhotos(ctx) {
  const { api, auth, db, fail, rateLimit, now, perms, PM, isMember, serverOf, requireChannel, requireDm, isBlocked, getUserRow, history, alive, LIVE,
    serializeMessage, serializeDmMessage, extrasFor, tagsFor, tagOut, toChannelAbout, getIo, requireCurrentEpoch, b64Len } = ctx;
  const SQL = sql(LIVE);

  // ---------------------------------------------------------------- input
  const limitOf = (v, max, dflt) => Math.max(1, Math.min(max, parseInt(v, 10) || dflt));
  // A message id from the query (before, after), or null when it isn't given.
  function idParam(v) {
    if (v === undefined) return null;
    if (typeof v !== 'string' || !MSG_ID.test(v)) fail(400, 'That page doesn’t exist. Reload the page.', 'bad_cursor');
    return v;
  }
  // ?ids=a,b,c: the messages the tag filter needs (at most 100).
  function idsParam(v) {
    const ids = typeof v === 'string' ? [...new Set(v.split(','))] : [];
    if (!ids.length || ids.length > IDS_MAX || !ids.every((x) => MSG_ID.test(x))) fail(400, `Pick from 1 to ${IDS_MAX} messages.`, 'bad_ids');
    return ids;
  }
  // A photo's place in its message's file list (0-99): ?file= in the query, fileIdx in a body.
  const fileParam = (v) => {
    if (v === undefined) return null;
    if (typeof v !== 'string' || !/^\d{1,2}$/.test(v)) fail(400, 'That photo isn’t in the message. Reload the page.', 'bad_file');
    return Number(v);
  };
  // A tag's ciphertext, exactly as the apps make it (public/js/e2ee.js: one 256-byte padded payload, so every tag is
  // the same size). DM: td1:<salt 32 bytes>:<iv 12>:<ciphertext 272>. Channel: tc1:<epoch>:<salt>:<iv>:<ciphertext>:<the
  // author's signature, 64-72 bytes>. Returns the epoch inside a channel tag (null for a DM); anything else is a 400.
  function tagCipher(c, dm) {
    const p = typeof c === 'string' && c.length <= 700 ? c.split(':') : [];
    const ok = dm
      ? p.length === 4 && p[0] === 'td1' && b64Len(p[1]) === 32 && b64Len(p[2]) === 12 && b64Len(p[3]) === 272
      : p.length === 6 && p[0] === 'tc1' && /^[1-9][0-9]{0,8}$/.test(p[1]) && b64Len(p[2]) === 32 && b64Len(p[3]) === 12
        && b64Len(p[4]) === 272 && b64Len(p[5]) >= 64 && b64Len(p[5]) <= 72;
    if (!ok) fail(400, 'Bad encrypted tag. Reload the page.', 'bad_tag');
    return dm ? null : Number(p[1]);
  }

  // ---------------------------------------------------------------- access
  // Just what the checks and live events need (toChannelAbout: created_at, ciphertext as 1 or 0, epoch, thread_id),
  // never the ciphertext itself: a message can be a quarter of a megabyte.
  const CHANNEL_ROW = 'SELECT id, channel_id, thread_id, author_id, created_at, ciphertext IS NOT NULL AS ciphertext, epoch, expires_at, files FROM messages WHERE id = ?';
  const DM_ROW = 'SELECT id, dm_id, author_id, expires_at, files FROM dm_messages WHERE id = ?';
  // A channel message this person can see: there and not disappeared, in a channel they can view, and not from before
  // their history in that server starts (server/joinhistory.js). Anything else is "not found", as if it didn't exist.
  function channelMessage(id, uid) {
    const m = MSG_ID.test(String(id)) ? db.prepare(CHANNEL_ROW).get(String(id)) : null;
    if (!alive(m)) fail(404, NOT_FOUND);
    const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (!c || !isMember(c.server_id, uid) || !(perms.channel(serverOf(c), c, uid) & PM.VIEW_CHANNEL) || history.hidden(c.server_id, uid, m)) fail(404, NOT_FOUND);
    return { m, c };
  }
  // A DM this person is in, there and not disappeared.
  function dmMessage(id, uid) {
    const m = MSG_ID.test(String(id)) ? db.prepare(DM_ROW).get(String(id)) : null;
    if (!alive(m)) fail(404, NOT_FOUND);
    const d = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
    if (!d || (d.user_a !== uid && d.user_b !== uid)) fail(404, NOT_FOUND);
    return { m, d };
  }
  const peerOf = (d, uid) => (d.user_a === uid ? d.user_b : d.user_a);
  // A message's tags changed: its whole list, to whoever hears about its reactions.
  const listOf = (messageId) => tagsFor([messageId])[messageId] || [];
  const emitChannelTags = (c, m) => toChannelAbout(c, m).emit('message:tags', { id: m.id, channelId: c.id, threadId: m.thread_id || null, tags: listOf(m.id) });
  const emitDmTags = (d, m) => { const io = getIo(); if (io) io.to([`user:${d.user_a}`, `user:${d.user_b}`]).emit('dm:tags', { id: m.id, dmId: d.id, tags: listOf(m.id) }); };

  // ---------------------------------------------------------------- Photos & videos pages
  // ?ids=…, or a page of ?limit before ?before. next: the oldest id on a full page (the next page is the one before
  // it), else null.
  function media(q, byIds, byPage) {
    if (q.ids !== undefined) return { rows: byIds(JSON.stringify(idsParam(q.ids))), next: null };
    const before = idParam(q.before);
    const limit = limitOf(q.limit, MEDIA_MAX, MEDIA_PAGE);
    const rows = byPage(before, limit);
    return { rows, next: rows.length === limit ? rows[rows.length - 1].id : null };
  }
  api.get('/dms/:id/media', auth, (req, res) => {
    rateLimit('media:' + req.userId, 120, 60000);
    const d = requireDm(req.params.id, req.userId);
    const t = now();
    const { rows, next } = media(req.query, (ids) => db.prepare(SQL.dmMediaIds).all(ids, d.id, t),
      (before, limit) => db.prepare(SQL.dmMedia(!!before)).all(d.id, ...(before ? [before] : []), t, limit));
    const extras = extrasFor(rows.map((r) => r.id), 'dm_messages');
    res.json({ messages: rows.map((r) => serializeDmMessage(r, extras)), next });
  });
  api.get('/channels/:id/media', auth, (req, res) => {
    rateLimit('media:' + req.userId, 120, 60000);
    const c = requireChannel(req.params.id, req.userId);
    // Thread replies are in it too, except in a thread from before this member's history here starts (they can't open
    // it), and nothing else from before then either.
    const since = history.startOf(c.server_id, req.userId);
    const hist = history.where(since, { alias: 'messages.', threads: true });
    const histIds = history.where(since, { alias: 'm.', threads: true });
    const t = now();
    const { rows, next } = media(req.query, (ids) => db.prepare(SQL.channelMediaIds(histIds.sql)).all(ids, c.id, ...histIds.args, t),
      (before, limit) => db.prepare(SQL.channelMedia(!!before, hist.sql)).all(c.id, ...(before ? [before] : []), ...hist.args, t, limit));
    const extras = extrasFor(rows.map((r) => r.id), 'messages');
    res.json({ messages: rows.map((r) => serializeMessage(r, c, extras, since)), next });
  });

  // ---------------------------------------------------------------- comments on a photo
  // The replies that comment on the photo (or on any photo of the message, without ?file), oldest first, from after
  // ?after. next: the newest id on a full page (ask again with after=next), else null.
  function commentsQuery(q) {
    return { file: fileParam(q.file), after: idParam(q.after), limit: limitOf(q.limit, COMMENTS_MAX, COMMENTS_PAGE) };
  }
  const nextOf = (rows, limit) => (rows.length === limit ? rows[rows.length - 1].id : null);
  api.get('/dm-messages/:id/comments', auth, (req, res) => {
    rateLimit('comments:' + req.userId, 120, 60000);
    const { m, d } = dmMessage(req.params.id, req.userId);
    const { file, after, limit } = commentsQuery(req.query);
    const rows = db.prepare(SQL.comments('dm_messages', 'dm_id', file !== null, !!after))
      .all(m.id, ...(file !== null ? [file] : []), d.id, ...(after ? [after] : []), now(), limit);
    const extras = extrasFor(rows.map((r) => r.id), 'dm_messages');
    res.json({ messages: rows.map((r) => serializeDmMessage(r, extras)), next: nextOf(rows, limit) });
  });
  api.get('/messages/:id/comments', auth, (req, res) => {
    rateLimit('comments:' + req.userId, 120, 60000);
    const { m, c } = channelMessage(req.params.id, req.userId);
    const { file, after, limit } = commentsQuery(req.query);
    // A comment can be a thread reply: not one in a thread from before this member's history here starts.
    const since = history.startOf(c.server_id, req.userId);
    const hist = history.where(since, { alias: 'messages.', threads: true });
    const rows = db.prepare(SQL.comments('messages', 'channel_id', file !== null, !!after, hist.sql))
      .all(m.id, ...(file !== null ? [file] : []), c.id, ...(after ? [after] : []), ...hist.args, now(), limit);
    const extras = extrasFor(rows.map((r) => r.id), 'messages');
    res.json({ messages: rows.map((r) => serializeMessage(r, c, extras, since)), next: nextOf(rows, limit) });
  });

  // ---------------------------------------------------------------- tags
  const tagListed = (r) => ({ messageId: r.message_id, ...tagOut(r) });
  api.get('/dms/:id/tags', auth, (req, res) => {
    rateLimit('tags:' + req.userId, 60, 60000);
    const d = requireDm(req.params.id, req.userId);
    res.json({ tags: db.prepare(SQL.dmTags).all('d:' + d.id, d.id, now()).map(tagListed) });
  });
  api.get('/channels/:id/tags', auth, (req, res) => {
    rateLimit('tags:' + req.userId, 60, 60000);
    const c = requireChannel(req.params.id, req.userId);
    // Only on messages this member can see (join history), and none locked with a key from before theirs (they
    // couldn't open it).
    const since = history.startOf(c.server_id, req.userId);
    const hist = history.where(since, { alias: 'm.', threads: true });
    const rows = db.prepare(SQL.channelTags(hist.sql, !!since)).all('c:' + c.id, c.id, now(), ...hist.args, ...(since ? [since.epoch] : []));
    res.json({ tags: rows.map(tagListed) });
  });

  // The checks every new tag goes through after its conversation's own: its id, which photo, the caps, and a duplicate.
  function checkNew(m, body) {
    const { id, fileIdx } = body;
    if (typeof id !== 'string' || !TAG_ID.test(id)) fail(400, 'Bad encrypted tag. Reload the page.', 'bad_tag');
    if (typeof fileIdx !== 'number' || !Number.isInteger(fileIdx) || fileIdx < 0 || fileIdx > 99 || fileIdx >= m.files) {
      fail(400, 'That photo isn’t in the message. Reload the page.', 'bad_file');
    }
    return { id, fileIdx };
  }
  function checkRoom(m, fileIdx, id) {
    const n = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(file_idx = ?), 0) AS here FROM media_tags WHERE message_id = ?').get(fileIdx, m.id);
    if (n.here >= TAGS_PER_PHOTO || n.n >= TAGS_PER_MESSAGE) fail(409, 'This photo has as many tags as it can take.', 'too_many_tags');
    // The app picks the id (it's bound into the ciphertext), so one already taken is a resend or a copy, never a new tag.
    if (db.prepare('SELECT 1 FROM media_tags WHERE id = ?').get(id)) fail(409, 'That tag is already there.', 'tag_exists');
  }
  function insertTag({ id, m, conv, fileIdx, uid, ciphertext, epoch }) {
    const t = now();
    db.prepare('INSERT INTO media_tags (id, message_id, conv, file_idx, author_id, ciphertext, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, m.id, conv, fileIdx, uid, ciphertext, epoch, t);
    return { messageId: m.id, id, fileIdx, authorId: uid, ciphertext, epoch, createdAt: t };
  }
  api.post('/dm-messages/:id/tags', auth, (req, res) => {
    rateLimit('tag-write:' + req.userId, 60, 60000);
    const { m, d } = dmMessage(req.params.id, req.userId);
    // As with reactions: after a block, nobody in the conversation adds any (taking one away still works), and nothing
    // new goes to a deleted account.
    if (isBlocked(d.user_a, d.user_b)) fail(403, 'You can’t interact with this person.');
    if ((getUserRow(peerOf(d, req.userId)) || {}).deleted_at) fail(403, 'This account was deleted.', 'deleted');
    const b = req.body || {};
    const { id, fileIdx } = checkNew(m, b);
    tagCipher(b.ciphertext, true);
    checkRoom(m, fileIdx, id);
    const tag = insertTag({ id, m, conv: 'd:' + d.id, fileIdx, uid: req.userId, ciphertext: b.ciphertext, epoch: null });
    emitDmTags(d, m);
    res.json({ tag });
  });
  api.post('/messages/:id/tags', auth, (req, res) => {
    rateLimit('tag-write:' + req.userId, 60, 60000);
    const { m, c } = channelMessage(req.params.id, req.userId);
    // Tagging is posting a word everyone there sees: Send Messages, and not while timed out (which takes that away too;
    // this says why).
    if (perms.timedOut(c.server_id, req.userId)) fail(403, 'You’re timed out in this server for now.', 'timed_out');
    if (!(perms.channel(serverOf(c), c, req.userId) & PM.SEND_MESSAGES)) fail(403, 'You don’t have permission to tag photos here.');
    const b = req.body || {};
    const { id, fileIdx } = checkNew(m, b);
    // Locked with the server's current key, like a message sent now. The epoch is the one inside the ciphertext (bound
    // into it and signed), not one beside it.
    const epoch = requireCurrentEpoch(c.server_id, tagCipher(b.ciphertext, false));
    checkRoom(m, fileIdx, id);
    const tag = insertTag({ id, m, conv: 'c:' + c.id, fileIdx, uid: req.userId, ciphertext: b.ciphertext, epoch });
    emitChannelTags(c, m);
    res.json({ tag });
  });

  // Taking a tag away: its author, the photo's sender, or (in a server) Manage Messages there. Not after the block or
  // timeout that stop adding one: it's a clean-up.
  function ownTag(m, tagId, uid, mayManage) {
    const tag = typeof tagId === 'string' && TAG_ID.test(tagId) ? db.prepare('SELECT * FROM media_tags WHERE id = ? AND message_id = ?').get(tagId, m.id) : null;
    if (!tag) fail(404, 'Tag not found.');
    if (tag.author_id !== uid && m.author_id !== uid && !mayManage()) fail(403, 'You can only remove tags you added, or tags on your own photos.');
    db.prepare('DELETE FROM media_tags WHERE id = ?').run(tag.id);
  }
  api.delete('/dm-messages/:id/tags/:tagId', auth, (req, res) => {
    rateLimit('tag-write:' + req.userId, 60, 60000);
    const { m, d } = dmMessage(req.params.id, req.userId);
    ownTag(m, req.params.tagId, req.userId, () => false);
    emitDmTags(d, m);
    res.json({ ok: true });
  });
  api.delete('/messages/:id/tags/:tagId', auth, (req, res) => {
    rateLimit('tag-write:' + req.userId, 60, 60000);
    const { m, c } = channelMessage(req.params.id, req.userId);
    ownTag(m, req.params.tagId, req.userId, () => (perms.channel(serverOf(c), c, req.userId) & PM.MANAGE_MESSAGES) === PM.MANAGE_MESSAGES);
    emitChannelTags(c, m);
    res.json({ ok: true });
  });

  return { SQL, tagCipher };
};
module.exports.sql = sql;
module.exports.TAGS_PER_PHOTO = TAGS_PER_PHOTO;
module.exports.TAGS_PER_MESSAGE = TAGS_PER_MESSAGE;
