// My Reels: your own private feed of TikToks and reels (public/js/my-reels.js, docs/design/SCROLL-TOGETHER.md), for
// videos you import from TikTok's or Instagram's data download, or share to yourself.
//
// The list never reaches this server readable: your app seals it with your personal vault key (like your personal
// nicknames, server/personalnames.js), numbered and padded, so this server stores ciphertext only. It doesn't learn
// which videos you keep, or how many (beyond the padded size). That's how it follows you to your other devices.
//
// Routes
//   GET /me/reels                 -> { data: 'x1:…' | null, updatedAt }
//   PUT /me/reels { data, base? }  data: your sealed list ('x1:…', or null to delete it); base: the updatedAt your
//                                  app last saw (a newer one is refused with 409 stale) -> { updatedAt }
// Socket
//   myreels:changed { updatedAt, from }  to your own apps

// A sealed list at its biggest: 5,000 videos of about 60 bytes of JSON each, padded to 16 KB, sealed and base64'd,
// is about 420 KB.
const SEALED_MAX = 512 * 1024;
const SEALED = /^x1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

function setupMyReels(ctx) {
  const { api, auth, db, fail, rateLimit, limitNet, emitTo } = ctx;
  const mineOf = (uid) => db.prepare('SELECT data, updated_at FROM my_reels WHERE user_id = ?').get(uid);

  api.get('/me/reels', auth, (req, res) => {
    rateLimit('mrget:' + req.userId, 120, 60000);
    const r = mineOf(req.userId);
    res.json({ data: r ? r.data : null, updatedAt: r ? r.updated_at : 0 });
  });
  api.put('/me/reels', auth, (req, res) => {
    rateLimit('mr:' + req.userId, 30, 60000);
    rateLimit('mrh:' + req.userId, 600, 3600000);
    limitNet(req, 'mr', 120, 60000);
    const b = req.body || {};
    const data = b.data === null ? null : b.data;
    if (data !== null && typeof data !== 'string') fail(400, 'Bad data.');
    if (data && data.length > SEALED_MAX) fail(413, 'My Reels is full. Remove some videos first.');
    if (data !== null && !SEALED.test(data)) fail(400, 'Bad data.');
    if (b.base !== undefined && b.base !== null && !Number.isSafeInteger(b.base)) fail(400, 'Bad base.');
    const cur = mineOf(req.userId);
    const was = cur ? cur.updated_at : 0;
    if (Number.isSafeInteger(b.base) && b.base !== was) fail(409, 'My Reels was changed on another device. It has been reloaded: try again.', 'stale');
    const t = Math.max(Date.now(), was + 1);
    db.prepare(`INSERT INTO my_reels (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(req.userId, data, t);
    emitTo(req.userId, 'myreels:changed', { updatedAt: t, from: req.session.id });
    res.json({ updatedAt: t });
  });
}

module.exports = setupMyReels;
module.exports.SEALED_MAX = SEALED_MAX;
