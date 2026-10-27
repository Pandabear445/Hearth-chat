// Update notes ("What's new"): Hearth comes with none, and only the server's owner publishes them (Admin → Owner;
// server/updatenotes.js, public/js/whatsnew.js). Everyone signed in reads them; nobody else, admins included, can
// publish, change or delete one; they're plain text, capped, in the audit log, and open apps hear of a new one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./helpers');

let srv; let owner; let admin; let member;
const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const ROOT = path.join(__dirname, '..');

before(async () => {
  srv = await startServer();
  owner = srv.owner;
  admin = await srv.register('notesadmin');
  member = await srv.register('notesmember');
  assert.equal((await as(owner, 'PUT', '/admin/staff', { userId: admin.id, role: 'admin', authKey: owner.authKey })).status, 200);
});
after(async () => { if (srv) await srv.stop(); });

test('Hearth comes with no update notes of its own: not in the app, the Android stores or GitHub releases', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'whatsnew.js'), 'utf8');
  assert.doesNotMatch(src, /CHANGES|version:\s*'\d|items:\s*\[\s*'/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8'), /unseenChanges|`Version \$\{/);
  // The Android stores' "what's new" (F-Droid's tools, IzzyOnDroid) is the owner's to write when they publish the app.
  const logs = path.join(ROOT, 'mobile', 'fastlane', 'metadata', 'android', 'en-US', 'changelogs');
  for (const f of fs.readdirSync(logs)) assert.equal(fs.readFileSync(path.join(logs, f), 'utf8').trim(), '', `${f} is empty`);
  // GitHub releases made by the workflows carry no notes made up from commits.
  for (const wf of [path.join(ROOT, '..', '.github', 'workflows', 'hearth-apps.yml'), path.join(ROOT, '.github', 'workflows', 'desktop.yml')]) {
    if (fs.existsSync(wf)) assert.doesNotMatch(fs.readFileSync(wf, 'utf8'), /generate_release_notes:\s*true/, wf);
  }
});

test('only the owner publishes; everyone signed in reads them, newest first; open apps hear of a new one', async () => {
  assert.deepEqual((await as(member, 'GET', '/update-notes')).json.notes, [], 'none to begin with');
  assert.equal((await srv.api('GET', '/update-notes')).status, 401, 'not without signing in');
  for (const u of [admin, member]) assert.equal((await as(u, 'POST', '/admin/update-notes', { title: 'Mine', text: 'Something' })).status, 403);
  const sock = await srv.socket(member.token);
  const heard = new Promise((resolve) => sock.once('update-notes', resolve));
  const a = await as(owner, 'POST', '/admin/update-notes', { title: 'New this week', text: 'Calls reconnect by themselves.\n\n  Pictures load faster.  ' });
  assert.equal(a.status, 200, a.text);
  assert.deepEqual([a.json.title, a.json.items, a.json.android], ['New this week', ['Calls reconnect by themselves.', 'Pictures load faster.'], true]);
  assert.match(a.json.id, /^[A-Za-z0-9_-]{1,64}$/, 'an id the app remembers it by');
  await heard;
  sock.close();
  const b = (await as(owner, 'POST', '/admin/update-notes', { items: ['Become a supporter from Home.'], android: false })).json;
  const list = (await as(member, 'GET', '/update-notes')).json.notes;
  assert.deepEqual(list.map((n) => n.id), [b.id, a.json.id]);
  assert.equal(list[0].android, false);
  assert.equal(list[0].title, '');
  const log = srv.sql("SELECT action, admin_id FROM admin_log WHERE action LIKE 'update_note%' ORDER BY rowid");
  assert.deepEqual(log.map((r) => r.action), ['update_note', 'update_note']);
  assert.equal(log[0].admin_id, owner.id);
});

test('plain text with limits; changing one keeps when it was published; deleting one takes it down', async () => {
  const post = (body) => as(owner, 'POST', '/admin/update-notes', body);
  assert.equal((await post({ title: 'Empty', text: '  \n ' })).json.code, 'empty');
  assert.equal((await post({ items: Array.from({ length: 21 }, (_, i) => `line ${i}`) })).json.code, 'too_many_lines');
  const n = (await post({ title: 'x'.repeat(500) + '\u0007', items: ['<b>bold</b>\u0000 and y'.padEnd(900, 'y')] })).json;
  assert.equal(n.title.length, 100);
  assert.equal(n.items[0].length, 500);
  assert.ok(n.items[0].startsWith('<b>bold</b>  and'), 'kept as text (the app never renders it as HTML); control characters gone');
  for (const u of [admin, member]) {
    assert.equal((await as(u, 'PUT', `/admin/update-notes/${n.id}`, { text: 'hijacked' })).status, 403);
    assert.equal((await as(u, 'DELETE', `/admin/update-notes/${n.id}`)).status, 403);
  }
  const changed = (await as(owner, 'PUT', `/admin/update-notes/${n.id}`, { title: 'Fixed', text: 'Better words', android: false })).json;
  assert.deepEqual([changed.title, changed.items, changed.android, changed.at], ['Fixed', ['Better words'], false, n.at]);
  assert.ok(changed.editedAt >= n.at);
  assert.equal((await as(owner, 'DELETE', `/admin/update-notes/${n.id}`)).status, 200);
  assert.ok(!(await as(member, 'GET', '/update-notes')).json.notes.some((x) => x.id === n.id));
  assert.equal((await as(owner, 'DELETE', `/admin/update-notes/${n.id}`)).status, 404);
  assert.equal((await as(owner, 'PUT', '/admin/update-notes/nothere', { text: 'x' })).status, 404);
});

test('at most 50 are kept: the oldest go', async () => {
  srv.sql("DELETE FROM instance_settings WHERE key = 'updateNotes'");
  const list = Array.from({ length: 50 }, (_, i) => ({ id: `old${i}`, title: `Old ${i}`, items: ['x'], android: true, at: 1000 + i }));
  srv.sql("INSERT INTO instance_settings (key, value) VALUES ('updateNotes', ?)", JSON.stringify(list.reverse()));
  const n = (await as(owner, 'POST', '/admin/update-notes', { text: 'The newest' })).json;
  const now = (await as(member, 'GET', '/update-notes')).json.notes;
  assert.equal(now.length, 50);
  assert.equal(now[0].id, n.id);
  assert.ok(!now.some((x) => x.id === 'old0'), 'the oldest went');
});

test('each device shows a note until its window is closed; a new device none from before; older versions’ devices the ones since', async () => {
  const store = new Map();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, configurable: true, writable: true });
  try {
    const W = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'whatsnew.js')).href);
    const note = (id, extra = {}) => ({ id, title: id.toUpperCase(), items: ['x'], android: true, at: 1, ...extra });
    const titles = (r) => r.notes.map((n) => n.title);
    assert.deepEqual(titles(W.unseenNotes([note('b'), note('a')])), [], 'a first visit: none from before');
    const now = [note('c'), note('b'), note('a')]; // newest first, as the server sends them
    assert.deepEqual(titles(W.unseenNotes(now)), ['C'], 'one published since');
    assert.deepEqual(titles(W.unseenNotes(now)), ['C'], 'still there until its window is closed (a reload for an update doesn’t lose it)');
    W.markNotesSeen(W.unseenNotes(now).ids);
    assert.deepEqual(titles(W.unseenNotes(now)), [], 'closed: gone');
    // The server's clock doesn't matter: a note is new by its id, whatever its time says.
    assert.deepEqual(titles(W.unseenNotes([note('d', { at: -5 }), ...now])), ['D']);
    store.clear(); store.set('hearth.seenVersion', '1.34.0');
    assert.deepEqual(titles(W.unseenNotes(now)), ['C', 'B', 'A'], 'a device from before this version sees what was published since');
    assert.equal(store.has('hearth.seenVersion'), false);
    store.clear(); store.set('hearth.seenNoteIds', '[]');
    const many = Array.from({ length: 9 }, (_, i) => note(`m${8 - i}`));
    const r = W.unseenNotes(many);
    assert.deepEqual(titles(r), ['M8', 'M7', 'M6', 'M5', 'M4'], 'the newest few');
    W.markNotesSeen(r.ids);
    assert.deepEqual(titles(W.unseenNotes(many)), [], 'the older ones aren’t saved up for another window');
    // The Android app leaves out a note not for it, and shows it if the owner switches it on later.
    const paying = note('p', { android: false });
    const shown = W.unseenNotes([paying], { android: true });
    assert.deepEqual(titles(shown), []);
    W.markNotesSeen(shown.ids);
    assert.deepEqual(titles(W.unseenNotes([{ ...paying, android: true }], { android: true })), ['P']);
    assert.deepEqual(titles(W.unseenNotes([{ id: 'bad', items: 'not a list' }, null, { items: ['no id'] }])), [], 'malformed ones are skipped');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});
