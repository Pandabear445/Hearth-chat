// Comments on one photo of a message, and tags (labels) on photos. A comment is an ordinary encrypted reply that
// names the photo it is about; a tag is a short end-to-end encrypted label kept beside the message.
//
// (Scaffold: filled in by the photo comments and tags work. The app calls these from app.js; they do nothing yet.)

export function createPhotoNotes(deps) {
  return {
    side() { return null; }, // (item, ctx): the viewer's side panel for one photo, or null
    badges() { return null; }, // (m, fi): the comment and tag counts drawn on a tile, or null
    tagsOf() { return []; }, // (m, fi): the decrypted labels on one photo of a loaded message
    tagIndex() { return Promise.resolve(new Map()); }, // (key): every tag in a conversation: label -> [{ messageId, fileIdx }]
  };
}
