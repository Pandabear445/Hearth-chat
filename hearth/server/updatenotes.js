// Update notes ("What's new"), written and published by the server's owner in Admin → Owner. Hearth's updates come
// with none: nothing about an update is shown to anyone unless the owner publishes it here. A published note shows
// once to everyone (public/js/whatsnew.js): right away in apps that are open, otherwise the next time theirs opens.
//
//   GET    /api/update-notes             signed in: the published notes, newest first
//   POST   /api/admin/update-notes       owner: publish one { title, items: [line…], android }
//   PUT    /api/admin/update-notes/:id   owner: change one (people who saw it don't get it again)
//   DELETE /api/admin/update-notes/:id   owner: take one down
//
// A note is plain text: a title and up to 20 lines, each shown as a list item (never as HTML or Markdown). android:
// false keeps it out of the Android app (about paying, which Google Play doesn't allow there). Kept in
// instance_settings ('updateNotes'), so backups have them, at most MAX of them (the oldest go).
const MAX = 50;
const TITLE_MAX = 100;
const ITEMS_MAX = 20;
const ITEM_MAX = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

module.exports = function setupUpdateNotes({ api, auth, ownerOnly, fail, rateLimit, newId, now, getSetting, setSetting, auditLog, getIo }) {
  const load = () => {
    try { const v = JSON.parse(getSetting('updateNotes') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const store = (list) => setSetting('updateNotes', list.length ? JSON.stringify(list.slice(0, MAX)) : null);
  const out = (n) => ({ id: n.id, title: n.title, items: n.items, android: n.android !== false, at: n.at, editedAt: n.editedAt || null });
  // What a note is made of: the title and the lines, trimmed and capped. Lines come as a list, or as text (one per line).
  function clean(b) {
    const raw = Array.isArray(b.items) ? b.items : String(b.text || '').split('\n');
    const items = raw.map((t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, ITEM_MAX)).filter(Boolean);
    if (items.length > ITEMS_MAX) fail(400, `A note can have up to ${ITEMS_MAX} lines.`, 'too_many_lines');
    const title = String(b.title || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, TITLE_MAX);
    if (!items.length) fail(400, 'Write at least one line.', 'empty');
    return { title, items, android: b.android !== false };
  }
  const tell = () => { const io = getIo(); if (io) io.emit('update-notes', { at: now() }); };

  api.get('/update-notes', auth, (req, res) => {
    rateLimit('notes:' + req.userId, 60, 60000);
    res.json({ notes: load().map(out) });
  });
  api.post('/admin/update-notes', auth, ownerOnly, (req, res) => {
    rateLimit('notespub:' + req.userId, 20, 60 * 60000);
    const n = { id: newId(), ...clean(req.body || {}), at: now() };
    store([n, ...load()]);
    auditLog(req, 'update_note', null, n.title || n.items[0]);
    tell();
    res.json(out(n));
  });
  api.put('/admin/update-notes/:id', auth, ownerOnly, (req, res) => {
    rateLimit('notespub:' + req.userId, 20, 60 * 60000);
    const id = String(req.params.id || '');
    const list = load();
    const i = ID.test(id) ? list.findIndex((n) => n.id === id) : -1;
    if (i < 0) fail(404, 'That note isn’t there any more.');
    list[i] = { ...list[i], ...clean(req.body || {}), editedAt: now() };
    store(list);
    auditLog(req, 'update_note_edited', null, list[i].title || list[i].items[0]);
    res.json(out(list[i]));
  });
  api.delete('/admin/update-notes/:id', auth, ownerOnly, (req, res) => {
    const id = String(req.params.id || '');
    const list = load();
    const gone = list.find((n) => n.id === id);
    if (!gone) fail(404, 'That note isn’t there any more.');
    store(list.filter((n) => n !== gone));
    auditLog(req, 'update_note_deleted', null, gone.title || gone.items[0]);
    res.json({ ok: true });
  });
  return { MAX, TITLE_MAX, ITEMS_MAX, ITEM_MAX };
};
