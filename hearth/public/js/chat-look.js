// Chat backgrounds: a background for a DM or a group chat, set by someone in it and seen by everyone in it,
// end-to-end encrypted like the messages.
//
// (Scaffold: filled in by the chat backgrounds work. The app calls these from app.js; they do nothing yet.)

export function createChatLook(deps) {
  return {
    menuItem() { return null; }, // (key): the "Chat background…" menu item for a DM or group chat, or null
    themeFor() { return null; }, // (view): what setServerTheme should show for the open conversation, or null
    onEvent() {}, // (kind, data): a live dm:look or group:look
    fromBootstrap() {}, // (dms, servers)
    lineFor() { return ''; }, // (entry, meId, nameOf): the words of a "changed the chat background" line
    reset() {},
  };
}
