// Server templates: what a new server starts with when someone picks one in "Create a server" (or sends
// { template } to POST /servers). They live here in code: the app only names one, and the server builds it, so a
// request can't ask for channels, roles or permissions of its own this way.
//
//   GET /api/server-templates   signed in: the list the app shows ({ key, name, about, channels, roles })
//
// Each template is categories of text and voice channels, a few roles, and optionally channels only some roles can
// post in (readOnly: @everyone can read but not send; the roles in postRoles can). The owner has every permission
// anyway, so no role here is an Administrator: people can be given more later in Server settings → Roles.
const { PERMS: P, CHANNEL_SCOPED } = require('./perms');

// Permission sets the templates hand out. @everyone keeps the usual defaults (perms.js DEFAULT_EVERYONE).
const MOD = P.KICK_MEMBERS | P.MANAGE_MESSAGES | P.MUTE_MEMBERS | P.MOVE_MEMBERS | P.MANAGE_NICKNAMES | P.VIEW_AUDIT_LOG | P.MENTION_EVERYONE;
const ADMIN = MOD | P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_ROLES | P.MANAGE_SERVER | P.MANAGE_EMOJIS;
const HOST = P.MENTION_EVERYONE | P.MANAGE_MESSAGES | P.MUTE_MEMBERS | P.MOVE_MEMBERS;

const text = (name, extra = {}) => ({ name, type: 'text', ...extra });
const voice = (name) => ({ name, type: 'voice' });

// Roles are listed highest first. color: shown next to names; hoist: listed on their own in the member list.
const TEMPLATES = {
  blank: {
    name: 'Blank',
    about: 'Just #general and a voice channel. Build the rest yourself.',
    categories: [['Text', [text('general')]], ['Voice', [voice('Lounge')]]],
    roles: [],
  },
  friends: {
    name: 'Friends',
    about: 'A hangout for you and your friends: chat, plans, memes and voice.',
    categories: [
      ['Hangout', [text('general'), text('plans'), text('memes'), text('photos')]],
      ['Voice', [voice('Hangout'), voice('Gaming'), voice('Movie night')]],
    ],
    roles: [
      { name: 'Moderator', color: '#f2a541', permissions: MOD, hoist: true },
      { name: 'Close friends', color: '#e86ab0', permissions: P.MENTION_EVERYONE },
    ],
  },
  gaming: {
    name: 'Gaming',
    about: 'Find people to play with, share clips and jump into squad voice channels.',
    categories: [
      ['Info', [text('welcome', { readOnly: ['Moderator'] }), text('rules', { readOnly: ['Moderator'] }), text('announcements', { readOnly: ['Moderator'] })]],
      ['Text', [text('general'), text('looking-for-group'), text('clips'), text('off-topic')]],
      ['Voice', [voice('Squad 1'), voice('Squad 2'), voice('Chill'), voice('AFK')]],
    ],
    roles: [
      { name: 'Moderator', color: '#f2a541', permissions: MOD, hoist: true },
      { name: 'Event host', color: '#5fb8f2', permissions: HOST, hoist: true },
      { name: 'Gamer', color: '#7bd88f', permissions: 0 },
    ],
  },
  study: {
    name: 'Study group',
    about: 'Homework help, shared notes and quiet rooms to study together.',
    categories: [
      ['Info', [text('welcome', { readOnly: ['Tutor'] }), text('announcements', { readOnly: ['Tutor'] })]],
      ['Study', [text('general'), text('homework-help'), text('notes-and-resources'), text('exam-prep')]],
      ['Voice', [voice('Study room 1'), voice('Study room 2'), voice('Quiet focus')]],
    ],
    roles: [
      { name: 'Tutor', color: '#5fb8f2', permissions: MOD, hoist: true },
      { name: 'Student', color: '#7bd88f', permissions: 0 },
    ],
  },
  community: {
    name: 'Community/Club',
    about: 'For a club or a bigger group: rules, announcements, events and introductions.',
    categories: [
      ['Info', [text('welcome', { readOnly: ['Admin', 'Moderator'] }), text('rules', { readOnly: ['Admin', 'Moderator'] }), text('announcements', { readOnly: ['Admin', 'Moderator'] }),
        text('events', { readOnly: ['Admin', 'Moderator', 'Event host'] })]],
      ['Community', [text('general'), text('introductions'), text('off-topic'), text('suggestions')]],
      ['Voice', [voice('Lounge'), voice('Meeting room'), voice('Events')]],
    ],
    roles: [
      { name: 'Admin', color: '#e8574e', permissions: ADMIN, hoist: true },
      { name: 'Moderator', color: '#f2a541', permissions: MOD, hoist: true },
      { name: 'Event host', color: '#5fb8f2', permissions: HOST, hoist: true },
      { name: 'Member', color: '#7bd88f', permissions: 0 },
    ],
  },
  creators: {
    name: 'Creators',
    about: 'A home for a creator and their community: releases, feedback and collabs.',
    categories: [
      ['Info', [text('welcome', { readOnly: ['Creator', 'Moderator'] }), text('announcements', { readOnly: ['Creator', 'Moderator'] }), text('new-releases', { readOnly: ['Creator'] })]],
      ['Community', [text('general'), text('share-your-work'), text('feedback'), text('collabs')]],
      ['Voice', [voice('Studio'), voice('Hangout')]],
    ],
    roles: [
      { name: 'Creator', color: '#b07cf2', permissions: MOD | P.MANAGE_CHANNELS | P.MANAGE_EMOJIS, hoist: true },
      { name: 'Moderator', color: '#f2a541', permissions: MOD, hoist: true },
      { name: 'Supporter', color: '#e86ab0', permissions: 0, hoist: true },
    ],
  },
};
const KEYS = Object.keys(TEMPLATES);

// The template a request names, or null for "none" (the Blank one is used). Anything else is refused: templates come
// from this file, never from the request.
function templateKey(v, fail) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !Object.hasOwn(TEMPLATES, v)) fail(400, `Unknown server template. Pick one of: ${KEYS.join(', ')}.`, 'bad_template');
  return v;
}

// What the app shows in the picker: names and counts, nothing it could send back.
const list = () => KEYS.map((key) => {
  const t = TEMPLATES[key];
  const all = t.categories.flatMap(([, ch]) => ch);
  return { key, name: t.name, about: t.about, categories: t.categories.map(([c]) => c), text: all.filter((c) => c.type === 'text').length,
    voice: all.filter((c) => c.type === 'voice').length, roles: t.roles.map((r) => r.name) };
});

// Writes a template's channels and roles into a server that was just made (inside the caller's transaction). The
// @everyone role is the caller's. Returns the category order, for servers.category_order.
function build(db, { serverId, key, newId, now }) {
  const t = TEMPLATES[key || 'blank'];
  const roleIds = new Map();
  const addRole = db.prepare('INSERT INTO roles (id, server_id, name, color, position, permissions, hoist, mentionable, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)');
  t.roles.forEach((r, i) => {
    const id = newId();
    roleIds.set(r.name, id);
    addRole.run(id, serverId, r.name, r.color, t.roles.length - i, r.permissions, r.hoist ? 1 : 0, now);
  });
  const addChannel = db.prepare('INSERT INTO channels (id, server_id, name, type, position, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const addOverride = db.prepare("INSERT INTO channel_overrides (channel_id, target_type, target_id, allow, deny) VALUES (?, 'role', ?, ?, ?)");
  let pos = 0;
  for (const [category, channels] of t.categories) {
    for (const c of channels) {
      const id = newId();
      addChannel.run(id, serverId, c.name, c.type, pos++, now, category);
      if (!c.readOnly) continue;
      // Everyone reads it; only the roles named post (and start threads) there.
      const talk = (P.SEND_MESSAGES | P.CREATE_THREADS) & CHANNEL_SCOPED;
      addOverride.run(id, serverId, 0, talk);
      for (const r of c.readOnly) if (roleIds.has(r)) addOverride.run(id, roleIds.get(r), talk, 0);
    }
  }
  return t.categories.map(([c]) => c);
}

module.exports = { TEMPLATES, KEYS, templateKey, list, build };
