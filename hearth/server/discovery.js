// Server search ("discoverable servers"): a server's owner, or anyone with Manage Server, can list it in the app's
// search (Search → Servers) with a short description and a few tags, and anyone signed in can find it there and join.
// Off for every server until someone turns it on (Server settings → Overview → "Show in server search").
//
// Routes
//   GET  /api/discover/servers?q=&page=   signed in: listed servers whose name, description or tags have every word
//                                         of q (none: all of them), most members first, 20 a page
//   POST /api/discover/servers/:id/join   signed in: join a listed server, like an invite
//   PATCH /api/servers/:id                { discoverable, discoverAbout, discoverTags } (Manage Server; index.js)
//
// What search shows of a server: its name, icon, member count, the description and tags written for search, and
// whether you're in it. Never its owner, members, channels, roles or messages, and nothing at all about a server
// that isn't listed: turning it off takes it out of the next search, and joining checks it's still listed. Servers
// you're banned from aren't shown, and joining from here goes through the same bans and limits as an invite. The
// newcomer gets the server key the way any newcomer does: the members' apps wrap it for them (index.js
// joinedPayload), so nothing about encryption changes.
const PAGE = 20;
const MAX_PAGE = 50; // 1,000 results; past that, type more
const ABOUT_MAX = 200;
const TAGS_MAX = 5;
const TAG_MAX = 24;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} &+'-]*$/u;
const CONTROL = /[\u0000-\u001f\u007f]+/g;

module.exports = function setupDiscovery(ctx) {
  const { api, auth, db, fail, rateLimit, limitNet, isMember, bannedFrom, addMember, joinedPayload, limitJoins, checkWords } = ctx;

  const tagsOf = (row) => { try { const v = JSON.parse(row.discover_tags || '[]'); return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []; } catch { return []; } };
  function cleanAbout(v) {
    if (typeof v !== 'string') fail(400, 'The description is text.', 'bad_request');
    return v.replace(CONTROL, ' ').trim().slice(0, ABOUT_MAX);
  }
  function cleanTags(v) {
    if (!Array.isArray(v) || v.length > TAGS_MAX * 2) fail(400, `Up to ${TAGS_MAX} tags.`, 'bad_tags');
    const out = [];
    for (const t of v) {
      if (typeof t !== 'string') fail(400, 'Tags are words.', 'bad_tags');
      const tag = t.replace(CONTROL, ' ').trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase();
      if (!tag) continue;
      if (tag.length > TAG_MAX || !TAG.test(tag)) fail(400, `Tags are up to ${TAG_MAX} letters, numbers and spaces.`, 'bad_tags');
      if (!out.includes(tag)) out.push(tag);
    }
    if (out.length > TAGS_MAX) fail(400, `Up to ${TAGS_MAX} tags.`, 'bad_tags');
    return out;
  }

  // The listing part of PATCH /servers/:id, checked before anything is written. Returns null when the request doesn't
  // touch it, else { changes, apply } (apply writes it; changes names what changed, for the server's audit log).
  // name: the server's name once this request is done (search shows it, so the word filter checks it too).
  function plan(srv, body, name) {
    if (body.discoverable === undefined && body.discoverAbout === undefined && body.discoverTags === undefined) return null;
    if (srv.kind === 'group') fail(400, 'Group chats can’t be listed in server search.');
    if (body.discoverable !== undefined && typeof body.discoverable !== 'boolean') fail(400, 'discoverable is true or false.');
    const was = { on: !!srv.discoverable, about: srv.discover_about || '', tags: tagsOf(srv) };
    const on = body.discoverable !== undefined ? body.discoverable : was.on;
    const about = body.discoverAbout !== undefined ? cleanAbout(body.discoverAbout) : was.about;
    const tags = body.discoverTags !== undefined ? cleanTags(body.discoverTags) : was.tags;
    if (on && !about) fail(400, 'Add a short description so people know what this server is about.', 'about_required');
    // Everyone on this Hearth can read a listing, so the instance's word filter applies to all of it.
    if (on) checkWords(name, about, tags);
    const changes = [];
    if (on !== was.on) changes.push('discoverable');
    if (about !== was.about) changes.push('discoverAbout');
    if (JSON.stringify(tags) !== JSON.stringify(was.tags)) changes.push('discoverTags');
    // Each change to a listing is an audit log entry, and turning it on and off over and over would only churn search.
    if (changes.length) rateLimit(`discoverset:${srv.id}`, 30, 3600000);
    return {
      changes, on,
      apply: () => db.prepare('UPDATE servers SET discoverable = ?, discover_about = ?, discover_tags = ?, discover_at = ? WHERE id = ?')
        .run(on ? 1 : 0, about, JSON.stringify(tags), on && !was.on ? Date.now() : srv.discover_at, srv.id),
    };
  }
  // What members' apps get with the server (all of it is public once it's on, and the same for every member).
  const forMembers = (row) => ({ discoverable: !!row.discoverable, discoverAbout: row.discover_about || '', discoverTags: tagsOf(row) });

  const esc = (w) => '%' + w.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  api.get('/discover/servers', auth, (req, res) => {
    rateLimit('discover:' + req.userId, 60, 60000);
    limitNet(req, 'discover', 240, 60000);
    const q = typeof req.query.q === 'string' ? req.query.q.replace(CONTROL, ' ').trim().slice(0, 64).toLowerCase() : '';
    const page = Math.max(0, Math.min(MAX_PAGE - 1, parseInt(req.query.page, 10) || 0));
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
    // Every word somewhere in the name, the description or the tags.
    const match = words.map(() => "AND (s.name LIKE ? ESCAPE '\\' OR s.discover_about LIKE ? ESCAPE '\\' OR s.discover_tags LIKE ? ESCAPE '\\')").join(' ');
    const rows = db.prepare(`SELECT s.id, s.name, s.icon, s.discover_about, s.discover_tags, (SELECT COUNT(*) FROM members m WHERE m.server_id = s.id) AS n
        FROM servers s WHERE s.discoverable = 1 AND s.kind = 'server'
        AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.server_id = s.id AND b.user_id = ?) ${match}
        ORDER BY n DESC, s.discover_at DESC, s.id LIMIT ? OFFSET ?`)
      .all(req.userId, ...words.flatMap((w) => [esc(w), esc(w), esc(w)]), PAGE + 1, page * PAGE);
    res.json({
      servers: rows.slice(0, PAGE).map((r) => ({ id: r.id, name: r.name, icon: r.icon, about: r.discover_about, tags: tagsOf(r), memberCount: r.n, joined: isMember(r.id, req.userId) })),
      page, hasMore: rows.length > PAGE && page < MAX_PAGE - 1,
    });
  });

  api.post('/discover/servers/:id/join', auth, (req, res) => {
    limitJoins(req);
    const s = db.prepare("SELECT id FROM servers WHERE id = ? AND discoverable = 1 AND kind = 'server'").get(String(req.params.id).slice(0, 64));
    // Not listed (any more): the same answer as one that doesn't exist, so this can't be used to find private servers.
    if (!s) fail(404, 'That server isn’t open to join from search any more.', 'not_listed');
    if (bannedFrom(s.id, req.userId)) fail(403, 'You are banned from this server.');
    const joined = addMember(s.id, req.userId);
    res.json(joinedPayload(s.id, req.userId, joined));
  });

  return { plan, forMembers };
};
