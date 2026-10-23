// "What's new": the update notes the server's owner publishes (Admin → Owner; server/updatenotes.js). Hearth comes
// with none of its own: nothing about an update is shown unless the owner publishes it. Each note shows on each device
// until its window is closed (app.js showUpdateNotes): right away if the app is open and the person isn't in the middle
// of something, otherwise as soon as they aren't, or the next time the app opens. A device that has never been here
// sees none of the ones from before, as before.
const KEY = 'hearth.seenNoteIds'; // the notes this device has shown and had closed (their ids, the latest last)
const OLD_KEY = 'hearth.seenVersion'; // kept by older versions: a device with it has been here before
const KEEP = 200; // ids remembered (the server keeps at most 50 notes)
export const MAX_SHOWN = 5; // the newest ones, if several are waiting

const readSeen = () => {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const writeSeen = (ids) => localStorage.setItem(KEY, JSON.stringify(ids.slice(-KEEP)));

// The notes this device hasn't shown yet, newest first (at most MAX_SHOWN), and the ids to remember once they've been
// seen (all the waiting ones: older ones past MAX_SHOWN aren't saved up for later). android: the Android app, which
// leaves out the notes the owner marked as not for it (about paying: Google Play doesn't allow that there); those stay
// unseen there, so a note switched on for the app later still shows. Notes are plain text: a title and lines.
export function unseenNotes(notes, { android = false } = {}) {
  const list = (Array.isArray(notes) ? notes : []).filter((n) => n && typeof n.id === 'string' && Array.isArray(n.items));
  let seen;
  try {
    seen = readSeen();
    if (seen === null) {
      // The first time this version runs here: on a device that ran an older one, every note is new; on a first visit,
      // none from before is.
      const before = localStorage.getItem(OLD_KEY) !== null;
      localStorage.removeItem(OLD_KEY);
      seen = before ? [] : list.map((n) => n.id);
      writeSeen(seen);
    }
  } catch { return { notes: [], ids: [] }; }
  const had = new Set(seen);
  const waiting = list.filter((n) => !had.has(n.id) && (!android || n.android !== false));
  return {
    notes: waiting.slice(0, MAX_SHOWN).map((n) => ({ id: n.id, title: String(n.title || ''), items: n.items.map((t) => String(t)) })),
    ids: waiting.map((n) => n.id),
  };
}
// Remembers notes as seen: when their window is closed, and the owner's own (they wrote them).
export function markNotesSeen(ids) {
  try {
    const seen = readSeen() || [];
    const add = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && !seen.includes(id));
    if (add.length) writeSeen([...seen, ...add]);
  } catch { /* not kept */ }
}
