// Photos & videos: a side panel listing every picture and video sent in a conversation (a DM, a group chat or a
// server channel), newest first, so nobody has to scroll up through the chat to find one.
//
// (Scaffold: filled in by the Photos & videos work. The app calls these from app.js; they do nothing yet.)

export function createMediaPanel(deps) {
  return {
    draw() {}, // (el): the panel's content, into #members
    onNew() {}, // (key, m): a new message, already decrypted
    onUpdate() {}, // (key, m): an edited message
    onDelete() {}, // (key, ids): messages deleted or gone
    onMeta() {}, // (key, messageId): a message's tags or photo comment counts changed
    reset() {}, // signed out, or the conversation is no longer there
  };
}
