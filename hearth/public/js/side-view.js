// The side view: messages and pictures pinned to a panel at the side, which stays open while you chat elsewhere,
// so you can look at them and keep talking. Personal: kept on this device only.
//
// (Scaffold: filled in by the side view work. The app calls these from app.js; they do nothing yet.)

export function createSideView(deps) {
  return {
    draw() {}, // (el): the panel's content
    pin() {}, // ({ key, messageId, fileIdx }): pin a message (or one of its pictures) to the side
    unpin() {}, // (id)
    count() { return 0; },
    menuItemFor() { return null; }, // (m, fileIdx): the "Pin to side" menu item, or null
    onUpdate() {}, // (key, m)
    onDelete() {}, // (key, ids)
    reset() {},
  };
}
