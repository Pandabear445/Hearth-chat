// "Is typing…", the app's side (the server only passes the events on, see 'typing' in server/index.js).
// Someone's app says so every few seconds while they type in a conversation ('c:<channel>' or 'd:<dm>'), and app.js
// shows it in two places, like Discord: the line under the open conversation's message box ("maya is typing…"), and
// in the lists of conversations (the sidebar's direct messages and group chats, Home's conversations), where it
// takes the last message's place: three dots and "typing…".
// Someone stops typing when their message arrives, or a while after the last word that they were (they stopped,
// or emptied the box, or their app went away): there's no "stopped typing" event.
export const TYPING_MS = 6000;

// Who's typing where. start(key, userId) for each event, stop(key, userId) when their message arrives.
// onChange(key) is called only when the people typing in a conversation change (someone starts, stops or lapses),
// not for every event: they come every few seconds per person, and what's drawn for them (the dots) keeps going.
// timers: setTimeout and clearTimeout (tests pass their own clock).
export function createTyping({ ms = TYPING_MS, onChange = () => {}, timers = { set: (fn, t) => setTimeout(fn, t), clear: (x) => clearTimeout(x) } } = {}) {
  const at = new Map(); // key -> Map(userId -> their timer), in the order they started typing
  const drop = (key, userId) => {
    const t = at.get(key);
    if (!t || !t.has(userId)) return false;
    timers.clear(t.get(userId));
    t.delete(userId);
    if (!t.size) at.delete(key);
    return true;
  };
  return {
    start(key, userId) {
      if (!key || !userId) return;
      let t = at.get(key);
      if (!t) at.set(key, (t = new Map()));
      const fresh = !t.has(userId);
      if (!fresh) timers.clear(t.get(userId));
      t.set(userId, timers.set(() => { if (drop(key, userId)) onChange(key); }, ms));
      if (fresh) onChange(key);
    },
    stop(key, userId) { if (drop(key, userId)) onChange(key); },
    // Who's typing there, first to start first (not counting `except`: you, on another of your devices).
    who(key, except = null) {
      const t = key && at.get(key);
      return t ? [...t.keys()].filter((id) => id !== except) : [];
    },
  };
}

// The line under the message box: "maya is typing…", "maya and sam are typing…", "maya, sam and lee are typing…",
// then "Several people are typing…". Empty when nobody is.
export function typingLine(names) {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length < 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing…`;
  return 'Several people are typing…';
}

// In a list, in place of the conversation's last message. A direct message has one other person, so it just says
// "typing…"; a group chat says who ("maya is typing…") or how many ("2 people are typing…"). Empty when nobody is.
export function typingPreview(names, { group = false } = {}) {
  if (!names.length) return '';
  if (!group) return 'typing…';
  return names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`;
}
