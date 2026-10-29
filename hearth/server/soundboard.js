// Soundboards (v25): everyone has their own, with short sounds they upload and lay out themselves, and plays them
// into the voice call they're in.
//
// Privacy: a sound is end-to-end encrypted by the app before it's sent here, like an attachment. Its audio is
// encrypted with a random key of its own (e2ee.js encryptFile), and that key, with the sound's name, emoji, color
// and volume, is sealed with the owner's personal vault key (e2ee.js vaultKey/sealVault), which only their devices
// can derive. The layout (grid or list, button size, order and pages) is sealed the same way. So this server stores
// ciphertext and sizes only: it can't tell what a sound is, what it's called, or whether it's audio at all. The app
// checks each file (type, size, length) before it's encrypted, and the call enforces the limits that matter to the
// people listening: a play is at most PLAY_MAX_MS long, only allowed with Use Soundboard and Speak, and rate limited
// (index.js, voice:board), and the listeners' apps only let a soundboard play through while the server says one is
// playing (voice.js).
//
// Nothing here is ever shown to anyone but the owner. A profile can show some of the board (name, emoji and color
// of up to 12 sounds), but only what the owner copies into their profile on purpose (profile.js soundShowcase).
const LIMITS = Object.freeze({
  sounds: 24, // per person
  bytes: 1024 * 1024, // one sound's audio, before encryption
  ms: 5000, // one sound's length (checked by the app; plays are cut off there too)
});
// 12 bytes of IV and a 16-byte tag around the audio, then base64.
const AUDIO_B64_MAX = Math.ceil((LIMITS.bytes + 28) / 3) * 4;
const META_MAX = 4096; // a sealed name, emoji, color, volume and key: a few hundred characters
const LAYOUT_MAX = 16 * 1024; // a sealed layout: pages and the order of up to 24 sounds
const ID = /^[a-z0-9]{8,32}$/;
const LAYOUT_ID = 'layout';
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PLAY_MAX_MS = LIMITS.ms;
// Plays per person: one at a time (a new one replaces it), at most one every 800 ms and 12 in 30 seconds.
const PLAY_RATE = Object.freeze({ gapMs: 800, burst: 12, windowMs: 30000 });

function setupSoundboard({ api, auth, db, fail, rateLimit, requireUnlocked, emitToUser }) {
  const now = () => Date.now();
  const changed = (req) => emitToUser(req.userId, 'soundboard:changed', { from: req.session && req.session.id });

  api.get('/me/soundboard', auth, (req, res) => {
    rateLimit('board-list:' + req.userId, 120, 60000);
    const items = db.prepare('SELECT id, kind, meta, size, updated_at FROM soundboard_items WHERE user_id = ? ORDER BY updated_at').all(req.userId)
      .map((r) => ({ id: r.id, kind: r.kind, meta: r.meta, size: r.size, updatedAt: r.updated_at }));
    res.json({ items, limits: LIMITS });
  });

  // One sound's encrypted audio (only the owner's own; the listeners in a call hear it through the call).
  api.get('/me/soundboard/:id/audio', auth, (req, res) => {
    rateLimit('board-audio:' + req.userId, 600, 60000);
    const id = String(req.params.id);
    if (!ID.test(id)) fail(400, 'Bad id.');
    const r = db.prepare("SELECT audio FROM soundboard_items WHERE user_id = ? AND id = ? AND kind = 'sound'").get(req.userId, id);
    if (!r) fail(404, 'No such sound.');
    res.set('Cache-Control', 'no-store');
    res.json({ audio: r.audio });
  });

  api.put('/me/soundboard/:id', auth, (req, res) => {
    rateLimit('board-save:' + req.userId, 60, 60000);
    requireUnlocked(req.userId);
    const id = String(req.params.id);
    const b = req.body || {};
    const meta = b.meta;
    const sealed = (v, max) => typeof v === 'string' && v.startsWith('x1:') && v.length <= max;
    if (id === LAYOUT_ID) {
      if (b.kind !== 'layout' || !sealed(meta, LAYOUT_MAX)) fail(400, 'Bad layout.');
      db.prepare(`INSERT INTO soundboard_items (id, user_id, kind, meta, audio, size, updated_at) VALUES (?, ?, 'layout', ?, '', ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET meta = excluded.meta, size = excluded.size, updated_at = excluded.updated_at`).run(id, req.userId, meta, meta.length, now());
      changed(req);
      return res.json({ ok: true });
    }
    if (!ID.test(id)) fail(400, 'Bad id.');
    if (b.kind !== 'sound') fail(400, 'Unknown kind.');
    if (!sealed(meta, META_MAX)) fail(400, 'Bad sound details.');
    const cur = db.prepare('SELECT kind, size FROM soundboard_items WHERE user_id = ? AND id = ?').get(req.userId, id);
    if (cur && cur.kind !== 'sound') fail(409, 'That id is used by something else.');
    let audio = null;
    if (b.audio !== undefined) {
      if (typeof b.audio !== 'string' || !b.audio.length || !B64.test(b.audio) || b.audio.length % 4) fail(400, 'Bad audio.');
      if (b.audio.length > AUDIO_B64_MAX) fail(413, `Sounds can be up to ${LIMITS.bytes / 1024 / 1024} MB.`);
      // Smallest possible: the IV, the tag and a few bytes of audio.
      if (b.audio.length < 64) fail(400, 'That sound is empty.');
      audio = b.audio;
    } else if (!cur) fail(400, 'Choose a sound file.');
    if (!cur) {
      const n = db.prepare("SELECT COUNT(*) n FROM soundboard_items WHERE user_id = ? AND kind = 'sound'").get(req.userId).n;
      if (n >= LIMITS.sounds) fail(413, `Your soundboard is full (${LIMITS.sounds} sounds). Delete one to add another.`);
    }
    if (audio === null) {
      db.prepare('UPDATE soundboard_items SET meta = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(meta, now(), req.userId, id);
    } else {
      db.prepare(`INSERT INTO soundboard_items (id, user_id, kind, meta, audio, size, updated_at) VALUES (?, ?, 'sound', ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET meta = excluded.meta, audio = excluded.audio, size = excluded.size, updated_at = excluded.updated_at`)
        .run(id, req.userId, meta, audio, audio.length, now());
    }
    changed(req);
    res.json({ ok: true });
  });

  api.delete('/me/soundboard/:id', auth, (req, res) => {
    rateLimit('board-save:' + req.userId, 60, 60000);
    const id = String(req.params.id);
    if (!ID.test(id)) fail(400, 'Bad id.');
    db.prepare("DELETE FROM soundboard_items WHERE user_id = ? AND id = ? AND kind = 'sound'").run(req.userId, id);
    changed(req);
    res.json({ ok: true });
  });
}

module.exports = { setupSoundboard, LIMITS, PLAY_MAX_MS, PLAY_RATE, AUDIO_B64_MAX };
