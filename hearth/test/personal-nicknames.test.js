// Nicknames only you see (server/personalnames.js, public/js/personal-names.js): a name you give someone replaces
// theirs everywhere your apps show it, ahead of their nickname in a server and their display name. The list is sealed
// by your app with your personal vault key, padded, and synced through the server, which never learns a name or
// whom it's for; a device keeps the newest copy it has opened, so a server can't roll it back unnoticed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ================================================================== the server's side
let srv; let alice; let bob;
before(async () => {
  srv = await startServer();
  alice = await srv.register('pn_alice');
  bob = await srv.register('pn_bob');
});
after(async () => { if (srv) await srv.stop(); });
const as = (u, m, p, body) => srv.api(m, p, { token: u.token, ip: u.ip, body });
const SEALED = (n = 1) => `x1:${Buffer.alloc(12, n).toString('base64')}:${Buffer.alloc(4096, n).toString('base64')}`;

test('server: stores only the sealed list, yours alone, and refuses anything else', async () => {
  assert.deepEqual((await as(alice, 'GET', '/me/personal-nicknames')).json, { data: null, updatedAt: 0 });
  const put = await as(alice, 'PUT', '/me/personal-nicknames', { data: SEALED(1), base: 0 });
  assert.equal(put.status, 200, put.text);
  const got = (await as(alice, 'GET', '/me/personal-nicknames')).json;
  assert.deepEqual(got, { data: SEALED(1), updatedAt: put.json.updatedAt });
  // Bob has his own (none).
  assert.deepEqual((await as(bob, 'GET', '/me/personal-nicknames')).json, { data: null, updatedAt: 0 });
  // Plain text, JSON, markup or anything that isn't the sealed format is refused; so is a list far too big.
  for (const data of ['{"u1":"Bestie"}', 'Bestie', '<script>alert(1)</script>', 'x1:abc', 'x1:a:b:c', 42, { names: {} }]) {
    const r = await as(alice, 'PUT', '/me/personal-nicknames', { data });
    assert.equal(r.status, 400, `${JSON.stringify(data)}: ${r.text}`);
  }
  const huge = `x1:${'A'.repeat(16)}:${'A'.repeat(330 * 1024)}`;
  assert.equal((await as(alice, 'PUT', '/me/personal-nicknames', { data: huge })).status, 413);
  assert.equal((await as(alice, 'PUT', '/me/personal-nicknames', { data: SEALED(2), base: 'x' })).status, 400);
  assert.equal((await as(alice, 'GET', '/me/personal-nicknames')).json.data, SEALED(1), 'nothing refused was kept');
  assert.equal((await srv.api('GET', '/me/personal-nicknames', {})).status, 401);
});

test('server: a save made against an older version is refused (stale), so one device can’t undo another’s change', async () => {
  const cur = (await as(alice, 'GET', '/me/personal-nicknames')).json.updatedAt;
  const a = await as(alice, 'PUT', '/me/personal-nicknames', { data: SEALED(3), base: cur });
  assert.equal(a.status, 200);
  assert.ok(a.json.updatedAt > cur);
  const b = await as(alice, 'PUT', '/me/personal-nicknames', { data: SEALED(4), base: cur });
  assert.equal(b.status, 409);
  assert.equal(b.json.code, 'stale');
  // No base: saved over whatever is there (deleting it, for one).
  const d = await as(alice, 'PUT', '/me/personal-nicknames', { data: null });
  assert.equal(d.status, 200);
  assert.equal((await as(alice, 'GET', '/me/personal-nicknames')).json.data, null);
});

test('server: deleting the account deletes the list', async () => {
  const carol = await srv.register('pn_carol');
  await as(carol, 'PUT', '/me/personal-nicknames', { data: SEALED(5) });
  assert.equal(srv.sql('SELECT COUNT(*) n FROM personal_nicknames WHERE user_id = ?', carol.id)[0].n, 1);
  const del = await as(carol, 'DELETE', '/me', { authKey: carol.authKey, confirm: carol.username });
  assert.equal(del.status, 200, del.text);
  assert.equal(srv.sql('SELECT COUNT(*) n FROM personal_nicknames WHERE user_id = ?', carol.id)[0].n, 0);
});

test('server: the only routes are your own list; nothing else carries a nickname', () => {
  const routes = read('server', 'personalnames.js').match(/api\.(get|put|post|patch|delete)\('[^']+'/g);
  assert.deepEqual(routes, ["api.get('/me/personal-nicknames'", "api.put('/me/personal-nicknames'"]);
  const app = read('public', 'js', 'personal-names.js');
  assert.deepEqual([...new Set(app.match(/request\('(GET|PUT|POST|PATCH|DELETE)', [^,)]+/g))].sort(), ["request('GET', '/me/personal-nicknames'", "request('PUT', '/me/personal-nicknames'"]);
  assert.match(read('server', 'index.js'), /'word_filters', 'personal_nicknames',/, 'removed with the account');
});

// ================================================================== the app's side
let P; let E; let UI;
async function load() {
  if (P) return;
  const { register } = require('node:module');
  const fakes = {
    './util.js': 'export const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat(9) }); export const clear = (x) => x; export const icon = () => null; export const toast = () => {}; export const hashColor = () => "#000"; export const initials = (s) => String(s).slice(0, 1); export const fmtDay = () => "";',
    './api.js': 'export const api = () => { throw new Error("use request"); };',
    './ui.js': 'export const modal = () => {}; export const field = () => ({}); export const confirmDialog = async () => true;',
    './markdown.js': 'export const render = (s) => s; export const renderDoc = (s) => s;',
    './activity.js': 'export const activityCards = () => null; export const favoriteGamesEl = () => null; export const recentGamesEl = () => null;',
  };
  const urls = Object.fromEntries(Object.entries(fakes).map(([k, src]) => [k, 'data:text/javascript,' + encodeURIComponent(src)]));
  register('data:text/javascript,' + encodeURIComponent(`const urls = ${JSON.stringify(urls)};
    export async function resolve(spec, ctx, next) {
      if (ctx.parentURL && /\\/(personal-names|profile-ui)\\.js$/.test(ctx.parentURL) && urls[spec]) return { url: urls[spec], shortCircuit: true };
      return next(spec, ctx);
    }`));
  globalThis.window = globalThis.window || { crypto: globalThis.crypto };
  E = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'e2ee.js')).href);
  P = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'personal-names.js')).href);
  UI = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'profile-ui.js')).href);
}
// One account's devices: the same identity key, a fake server (stored), each device with its own storage.
async function account() {
  await load();
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  const S = { me: { id: 'me1', publicKey: pub } };
  const stored = { data: null, updatedAt: 0, puts: [] };
  const server = { serve: null };
  const request = async (method, p, body) => {
    assert.equal(p, '/me/personal-nicknames');
    if (method === 'GET') return server.serve ? server.serve() : { data: stored.data, updatedAt: stored.updatedAt };
    if (Number.isSafeInteger(body.base) && body.base !== stored.updatedAt) throw Object.assign(new Error('changed elsewhere'), { code: 'stale' });
    stored.puts.push(body.data);
    stored.data = body.data; stored.updatedAt += 1;
    return { updatedAt: stored.updatedAt };
  };
  const vk = E.vaultKey(kp.privateKey, pub);
  const memory = () => { let v = null; return { get: () => v, set: (x) => { v = x; } }; };
  const device = (opts = {}) => P.createPersonalNames({ S, vaultKey: () => vk, request, store: memory(), ...opts });
  return { S, stored, server, vk, device };
}

test('app: a nickname is sealed with your vault key and padded; your other devices open it, nobody else can', async () => {
  const { stored, vk, device } = await account();
  let changes = 0;
  const one = device({ onChange: () => { changes++; } });
  await one.load();
  assert.equal(await one.setName('u_bob', '  Bobby‮ Tables  '), 'Bobby Tables', 'direction changes dropped, spaces tidied');
  assert.equal(one.get('u_bob'), 'Bobby Tables');
  assert.ok(changes > 0, 'what’s on screen is told to redraw');
  const sealed = stored.data;
  assert.match(sealed, /^x1:/);
  const parts = sealed.split(':');
  assert.ok(parts.every((part, i) => !/Bobby|u_bob/.test(i === 2 ? Buffer.from(part, 'base64').toString('latin1') : part)), 'nothing readable in what the server stores');
  const body = await E.openVault(await vk, 'nicknames', 'me1', sealed);
  assert.deepEqual(body.names, { u_bob: 'Bobby Tables' });
  await assert.rejects(E.openVault(await vk, 'nicknames', 'someone-else', sealed), 'bound to this account');
  await assert.rejects(E.openVault(await vk, 'wordfilter', 'me1', sealed), 'and to this kind of item');
  // Padded: one name and fifty look the same size.
  const small = stored.data.length;
  for (let i = 0; i < 50; i++) await one.setName(`u_${i}`, `Someone number ${i}`);
  assert.equal(stored.data.length, small, 'how many names doesn’t show in the size');
  // Another device of the same account.
  const two = device();
  await two.load();
  assert.equal(two.get('u_bob'), 'Bobby Tables');
  assert.equal(two.get('u_7'), 'Someone number 7');
  // An account with another key can't open it, and shows nobody renamed rather than failing.
  const { device: strangerDevice, stored: theirs } = await account();
  theirs.data = stored.data; theirs.updatedAt = 1;
  const stranger = strangerDevice();
  await stranger.load();
  assert.equal(stranger.get('u_bob'), '');
  assert.equal(stranger.state().unreadable, true);
  // …and never replaces the list it couldn't open by accident, only when asked to start over.
  await assert.rejects(stranger.setName('u_z', 'Zed'), (e) => e.code === 'unreadable');
  await assert.rejects(stranger.clearAll(), (e) => e.code === 'unreadable');
  assert.equal(theirs.data, stored.data, 'untouched');
  await stranger.startOver();
  await stranger.setName('u_z', 'Zed');
  assert.equal(stranger.get('u_z'), 'Zed');
});

test('app: the rules for a nickname, and only for other people', async () => {
  await load();
  assert.equal(P.cleanName(''), '');
  assert.equal(P.cleanName('   '), '');
  assert.equal(P.cleanName('a\nb\tc'), 'a b c');
  assert.equal(P.cleanName('Zoë 🏴󠁧󠁢󠁳󠁣󠁴󠁿'), 'Zoë 🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'a flag keeps its tags');
  assert.equal(P.cleanName('<b>hi</b>'), '<b>hi</b>', 'kept as text (it is only ever drawn as text)');
  assert.throws(() => P.cleanName('x'.repeat(33)), /up to 32/);
  assert.throws(() => P.cleanName('​⠀'), /character you can see/);
  assert.throws(() => P.cleanName({}), /text/);
  const { device, S } = await account();
  const d = device();
  await d.load();
  await assert.rejects(d.setName(S.me.id, 'Me'), /other people/);
  await assert.rejects(d.setName('../../etc', 'x'), /other people/);
  // A list from the server is cleaned the same way: bad ids and names are dropped, not shown.
  assert.deepEqual(P.cleanList({ ok_1: 'Fine', 'bad id!': 'x', ok_2: 'y'.repeat(40), ok_3: 7, ok_4: '‮' }), { ok_1: 'Fine' });
  assert.deepEqual(P.cleanList(['a']), {});
  // Removing one, then everyone.
  await d.setName('u1', 'One');
  await d.setName('u2', 'Two');
  assert.equal(await d.setName('u1', ''), '');
  assert.deepEqual(d.exportable(), [{ userId: 'u2', nickname: 'Two' }]);
  await d.clearAll();
  assert.deepEqual(d.all(), {});
});

test('app: a change made while another device saved is made again on top of the newer list, not lost', async () => {
  const { device } = await account();
  const one = device();
  const two = device();
  await one.load();
  await two.load();
  await one.setName('u_a', 'Ace');
  await two.setName('u_b', 'Bee'); // two still had the version from before: refused as stale, reloaded, done again
  assert.deepEqual(two.all(), { u_a: 'Ace', u_b: 'Bee' });
  await one.load();
  assert.deepEqual(one.all(), { u_a: 'Ace', u_b: 'Bee' });
});

test('app: another device’s save that lands while this one is sealing is kept, not overwritten', async () => {
  const { device, stored, vk } = await account();
  // This device's first seal waits until the test lets it go; everything after is immediate.
  let release; const gate = new Promise((r) => { release = r; });
  let first = true;
  const handlers = {};
  const one = device({ vaultKey: () => (first ? (first = false, gate.then(() => vk)) : vk) });
  const two = device();
  one.listen({ on: (ev, fn) => { handlers[ev] = fn; } });
  await one.load(); // the gated seal is the first vault key asked for after this
  first = true;
  await two.load();
  const pending = one.setName('u_a', 'Ace'); // stuck sealing
  await two.setName('u_b', 'Bee');
  // The server tells this device about two's save while it's still sealing.
  handlers['personalnicks:changed']({ updatedAt: stored.updatedAt });
  await new Promise((r) => setTimeout(r, 30));
  release();
  await pending;
  const body = await E.openVault(await vk, 'nicknames', 'me1', stored.data);
  assert.deepEqual(body.names, { u_b: 'Bee', u_a: 'Ace' }, 'both changes are in the saved list');
  assert.deepEqual(one.all(), { u_b: 'Bee', u_a: 'Ace' });
});

test('app: a full list of the longest names fits what the server keeps, and a lone half of a pair is dropped', async () => {
  const { vk } = await account();
  const { SEALED_MAX } = require('../server/personalnames');
  assert.equal(P.SEALED_MAX, SEALED_MAX, 'the app and the server agree');
  assert.equal(P.cleanName('a\uD83Db'), 'ab');
  assert.equal(P.cleanName('\uDE00x\uD83D'), 'x');
  // 1,000 entries with 64-character ids and 32 four-byte emoji (or 32 escaped quotes) each: the biggest list allowed.
  const ids = Array.from({ length: P.LIST_MAX }, (_, i) => String(i).padStart(64, 'u'));
  const worst = Object.fromEntries(ids.map((id, i) => [id, i % 2 ? '😀'.repeat(32) : '"'.repeat(32)]));
  assert.equal(Object.keys(P.cleanList(worst)).length, P.LIST_MAX);
  // Padded as the app pads it, to the next 4 KB (here the most padding there can be).
  const sealed = await E.sealVault(await vk, 'nicknames', 'me1', { v: 1, n: 99, names: worst, pad: ' '.repeat(4095) });
  assert.ok(sealed.length <= SEALED_MAX, `${sealed.length} > ${SEALED_MAX}`);
});

test('app: a server that hands back an older copy, or none, can’t quietly undo a nickname on a device that saw a newer one', async () => {
  const { device, stored, server, vk } = await account();
  const d = device();
  await d.load();
  await d.setName('u_x', 'First');
  const first = stored.data;
  await d.setName('u_x', 'Second');
  for (const served of [{ data: first, updatedAt: 99 }, { data: null, updatedAt: 0 }]) {
    server.serve = () => served;
    await d.load();
    assert.equal(d.get('u_x'), 'Second', JSON.stringify(served).slice(0, 20));
    assert.equal(d.state().behind, true);
  }
  server.serve = null;
  await d.load();
  await d.setName('u_y', 'Why');
  const body = await E.openVault(await vk, 'nicknames', 'me1', stored.data);
  assert.equal(body.n, 3, 'numbered past anything seen');
});

test('names: your nickname comes first, then their nickname in the server, then their display name, then their username', async () => {
  await load();
  const u = { id: 'u1', username: 'zed', profile: { displayName: 'Zedediah' } };
  const plain = { id: 'u2', username: 'plainuser', profile: {} };
  const server = { id: 's1', kind: 'server', nicknames: { u1: 'Zee in here' } };
  const group = { id: 'g1', kind: 'group', nicknames: { u1: 'ignored' } };
  const mine = {};
  UI.setPersonalNames((id) => mine[id] || '');
  assert.equal(UI.displayName(u), 'Zedediah');
  assert.equal(UI.displayNameIn(server, u), 'Zee in here');
  assert.equal(UI.displayNameIn(group, u), 'Zedediah');
  assert.equal(UI.displayName(plain), 'plainuser');
  mine.u1 = 'Bestie';
  assert.equal(UI.displayName(u), 'Bestie');
  assert.equal(UI.displayNameIn(server, u), 'Bestie');
  assert.equal(UI.realName(u), 'Zedediah', 'their own name is still at hand');
  // Search finds them by any name you know them by.
  for (const q of ['best', 'zedediah', 'zed', 'zee in']) assert.ok(UI.nameMatches(u, q, server), q);
  assert.ok(!UI.nameMatches(u, 'zee in'), 'their nickname in a server only counts in that server');
  assert.ok(!UI.nameMatches(u, 'nobody'));
  // Their profile says it's your name for them, with who they really are.
  const note = UI.personalNameNote(u);
  assert.match(JSON.stringify(note), /Your nickname/);
  assert.match(JSON.stringify(note), /Really Zedediah \(@zed\)/);
  assert.equal(UI.personalNameNote(plain), null);
  UI.setPersonalNames(null);
  assert.equal(UI.displayName(u), 'Zedediah');
});

test('forwarding: the text that is sent names the author by their own name, never your nickname for them', async () => {
  await load();
  const alice = { id: 'u_alice', username: 'alice', profile: { displayName: 'Alice A.' } };
  const plain = { id: 'u_plain', username: 'plainuser', profile: {} };
  UI.setPersonalNames((id) => ({ u_alice: 'Dumbo', u_plain: 'Secret name' })[id] || '');
  try {
    assert.equal(UI.displayName(alice), 'Dumbo', 'on your screen it is your nickname');
    const fwd = UI.forwardText({ note: '  look at this ', author: alice, text: 'line one\nline two' });
    assert.equal(fwd, 'look at this\n> Forwarded from Alice A.\n> line one\n> line two');
    assert.doesNotMatch(fwd, /Dumbo/);
    assert.equal(UI.forwardText({ author: plain, text: 'hi' }), '> Forwarded from plainuser\n> hi');
    assert.equal(UI.forwardText({ note: '   ', author: null, text: '' }), '> Forwarded from Unknown\n> ');
  } finally { UI.setPersonalNames(null); }
  // The app builds what it sends with it, and nothing it sends or saves for others is built from displayName.
  const app = read('public', 'js', 'app.js');
  assert.match(app, /const fwd = forwardText\(\{ note: note\.value, author: getUser\(m\.authorId\), text: textOf\(m\) \}\)/);
  assert.doesNotMatch(app, /Forwarded from \$\{displayName/);
  assert.doesNotMatch(app, /value: `\$\{displayName\(S\.me\)\}'s place`/, 'a new server’s suggested name');
  // Mentions put the @username in the text, not a name you see.
  assert.match(app, /: '@' \+ \(c\.special \|\| c\.username\);/);
});

test('app.js: every place someone is right-clicked or opened offers it, and lists search by it', () => {
  const app = read('public', 'js', 'app.js');
  // Members (list, voice, calls), DMs, friends, and the profile's More menu.
  assert.equal((app.match(/personalNameItem\(u\),/g) || []).length, 4);
  assert.match(app, /function memberMenuItems[\s\S]{0,600}personalNameItem\(u\)/);
  assert.match(app, /function dmMenuItems[\s\S]{0,700}personalNameItem\(u\)/);
  assert.match(app, /function relationshipActions[\s\S]{0,2000}personalNameItem\(u\)/);
  assert.match(app, /editPersonal: u\.id === S\.me\.id \? null/);
  assert.match(app, /PN\.listen\(socket\)/);
  assert.match(app, /setPersonalNames\(\(id\) => PN\.get\(id\)\)/);
  assert.ok((app.match(/nameMatches\(/g) || []).length >= 7, 'searches and suggestions');
  assert.doesNotMatch(app, /displayName\(u\)\.toLowerCase\(\)\.includes/);
  // The settings list and the data export.
  assert.match(read('public', 'js', 'settings.js'), /app\.personalNames\.settingsSection/);
  assert.match(read('public', 'js', 'usability.js'), /personal-nicknames\.json/);
});
