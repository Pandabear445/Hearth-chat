// Personal nicknames: a name you give someone that only you see, like a friend nickname on Discord. It replaces their
// name everywhere your apps show it (messages, member lists, DMs, calls, notifications, search…), ahead of their
// nickname in a server and their display name; their profile still shows who they really are (public/js/personal-
// names.js). Nobody else sees it, and they're never told.
//
// The list never reaches this server readable: your app seals it with your personal vault key (the one your word
// filter, saved-message notes and scheduled messages use; only your identity key can make it), bound to your
// account, numbered and padded, so the server only stores ciphertext whose size says little about how many names it
// holds. It doesn't learn whom you renamed, or to what. That's how the list follows you to your other devices; each
// device also keeps the newest sealed copy it has opened, so a server that hands back an older one (or none) can't
// quietly undo a change.
//
// Routes
//   GET /me/personal-nicknames                 -> { data: 'x1:…' | null, updatedAt }
//   PUT /me/personal-nicknames { data, base? }  data: your sealed list ('x1:…', or null to delete it); base: the
//                                              updatedAt your app last saw (a newer one is refused with 409 stale, so
//                                              one device can't silently undo another's change) -> { updatedAt }
// Socket
//   personalnicks:changed { updatedAt, from }  to your own apps (from: the session that saved it)

// A sealed list at its biggest: 1,000 entries, each a 64-character id and a 32-character name of 4-byte emoji (or
// quotes JSON escapes), is about 198 KB of JSON. Padded to 4 KB, sealed and base64'd that is about 270 KB, so this
// leaves room for every list the app allows (public/js/personal-names.js SEALED_MAX, the same number).
const SEALED_MAX = 320 * 1024;
const SEALED = /^x1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

function setupPersonalNames(ctx) {
  const { api, auth, db, fail, rateLimit, limitNet, emitTo } = ctx;
  const mineOf = (uid) => db.prepare('SELECT data, updated_at FROM personal_nicknames WHERE user_id = ?').get(uid);

  api.get('/me/personal-nicknames', auth, (req, res) => {
    rateLimit('pnget:' + req.userId, 120, 60000);
    const r = mineOf(req.userId);
    res.json({ data: r ? r.data : null, updatedAt: r ? r.updated_at : 0 });
  });
  api.put('/me/personal-nicknames', auth, (req, res) => {
    rateLimit('pn:' + req.userId, 30, 60000);
    rateLimit('pnh:' + req.userId, 600, 3600000);
    limitNet(req, 'pn', 120, 60000);
    const b = req.body || {};
    const data = b.data === null ? null : b.data;
    if (data !== null && typeof data !== 'string') fail(400, 'Bad data.');
    if (data && data.length > SEALED_MAX) fail(413, 'That list of nicknames is too big to save.');
    if (data !== null && !SEALED.test(data)) fail(400, 'Bad data.');
    if (b.base !== undefined && b.base !== null && !Number.isSafeInteger(b.base)) fail(400, 'Bad base.');
    const cur = mineOf(req.userId);
    const was = cur ? cur.updated_at : 0;
    if (Number.isSafeInteger(b.base) && b.base !== was) fail(409, 'Your nicknames were changed on another device. They have been reloaded: make your change again.', 'stale');
    const t = Math.max(Date.now(), was + 1); // strictly increasing, so two quick saves still order
    db.prepare(`INSERT INTO personal_nicknames (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(req.userId, data, t);
    emitTo(req.userId, 'personalnicks:changed', { updatedAt: t, from: req.session.id });
    res.json({ updatedAt: t });
  });
}

module.exports = setupPersonalNames;
module.exports.SEALED_MAX = SEALED_MAX;
