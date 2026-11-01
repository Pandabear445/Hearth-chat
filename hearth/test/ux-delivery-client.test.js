// 1.44 "no message is ever lost": what the app does when a send doesn't go (it stays in the chat, waits for the
// connection or says Not sent with Retry and Delete), read state on a phone's list page, the unread bar, toasts that
// count instead of stacking, and the server's side of a send that's tried again (the same nonce gets the first
// message back, never a second copy; a rate limit says when to try again).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, hex } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('public/js/app.js');
const apiJs = read('public/js/api.js');
const util = read('public/js/util.js');
const css = read('public/css/ux-conversation.css');
const html = read('public/index.html');
// The body of a function in app.js, by its name (up to the next line that starts a function at the top level).
function fn(src, name) {
  const at = src.search(new RegExp(`\\n(async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} should exist`);
  const rest = src.slice(at + 1);
  const end = rest.slice(1).search(/\n(async )?function |\n\/\/ =====/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
// The body of a function declared inside createComposer (indented two spaces).
function inner(name) {
  const at = app.search(new RegExp(`\\n  (async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} should exist in the composer`);
  const rest = app.slice(at + 1);
  const end = rest.search(/\n {2}}\n/);
  return rest.slice(0, end + 4);
}

// ------------------------------------------------------------------ the app (static)
test('api.js: a request with no answer is an Error people can read, marked network (and offline without a connection)', () => {
  assert.match(apiJs, /export function netError\(e\)/);
  assert.match(apiJs, /catch \(e\) \{ throw netError\(e\); \}/, 'fetch’s TypeError goes through netError');
  assert.match(apiJs, /out\.offline = offline/);
  assert.match(apiJs, /navigator\.onLine === false/);
  assert.match(apiJs, /You\\u2019re offline\. Check your connection\./);
  assert.match(apiJs, /Can\\u2019t reach the server\. Trying again\\u2026/);
  assert.match(apiJs, /e\.rateLimited = r\.status === 429 && data\.code === 'rate_limited'/);
  assert.match(apiJs, /e\.retryAfter = /);
  // Run it: a TypeError from fetch, online and offline.
  const body = apiJs.slice(apiJs.indexOf('export function netError'), apiJs.indexOf('export async function api'));
  const make = new Function('navigator', `${body.replace('export function', 'function')}; return netError;`);
  const online = make({ onLine: true })(new TypeError('Failed to fetch'));
  assert.equal(online.network, true); assert.equal(online.offline, false); assert.match(online.message, /reach the server/);
  const offline = make({ onLine: false })(new TypeError('Failed to fetch'));
  assert.equal(offline.offline, true); assert.match(offline.message, /offline/);
  const abort = Object.assign(new Error('x'), { name: 'AbortError' });
  assert.equal(make({ onLine: true })(abort), abort, 'a cancelled request stays cancelled');
});

test('deliver: a failed send keeps its copy in the chat (failed or waiting), never dropped on the error path', () => {
  const d = inner('deliver');
  const failing = d.slice(d.indexOf('} catch (e) {'), d.indexOf('} finally {'));
  const kept = failing.slice(0, failing.indexOf('dropPendingSend(nonce);'));
  assert.match(kept, /if \(pend && pendingSends\.has\(nonce\) && !e\.cancelled && e\.code !== 'disappear_weaker'\) \{/);
  assert.match(kept, /setSendState\(pend, 'waiting'\)/);
  assert.match(kept, /setSendState\(pend, 'failed'/);
  assert.match(kept, /return;\n {6}\}/, 'a kept one returns before anything drops it');
  assert.match(kept, /e\.offline \|\| \(!e\.status && \(navigator\.onLine === false \|\| !socketUp\(\)\)\)/, 'offline, or the live connection is down: it waits');
  assert.match(kept, /e\.rateLimited/);
  assert.match(kept, /holdSends\(/);
  // A toast only for a refusal, never for waiting or no answer: its copy says so.
  assert.equal((kept.match(/toast\(/g) || []).length, 1);
  assert.match(kept, /if \(pend\.state === 'failed' && !e\.network\) toast\(e\.message, 'error'\);/);
  // Only a cancelled upload or a weaker timer turned down gives it back to the box (and drops the copy).
  assert.match(failing.slice(failing.indexOf('dropPendingSend(nonce);')), /if \(e\.cancelled\) toast\('Upload cancelled/);
  // A retry with the same nonce, after it's done with, sends nothing; one behind a waiting one waits.
  assert.match(d, /if \(settledSends\.has\(nonce\)\) return;/);
  assert.match(d, /if \(pend && sendsWaitingBefore\(pend\)\) \{ setSendState\(pend, 'waiting'\); scheduleFlush\(\); return; \}/);
});

test('send: the copy keeps the job, so Retry sends the same message with the same nonce', () => {
  const s = inner('send');
  assert.match(s, /const job = \{ kk, tid, text, files, replyTo, nonce, poll, links, linkState, wrote, sendAt \};/);
  assert.match(s, /p\.go = \(\) => \{[\s\S]*?deliver\(job\)/);
  assert.match(s, /queue = queue\.then\(\(\) => underWay\(deliver\(job\)\)\);\n {4}return queue;/);
  assert.match(fn(app, 'retrySend'), /p\.go\(\)/);
  assert.match(fn(app, 'deleteSend'), /dropPendingSend\(p\.nonce\);\n {2}if \(p\.discard\) p\.discard\(\);/);
});

test('takeBack never writes over what was typed: the words that didn’t go come back above it', () => {
  const t = inner('takeBack');
  assert.doesNotMatch(t, /if \(!ta\.value\.trim\(\) && !\(drafts\.get\(convId\(\)\) \|\| ''\)\.trim\(\)\) \{\n {6}ta\.value = text;/);
  assert.match(t, /const both = now\.trim\(\) \? `\$\{text\}\\n\$\{now\}` : text;/);
  // Run it: the box has "and then B", what came back is "A".
  const box = { value: 'and then B' };
  const store = new Map();
  const run = new Function('ta', 'drafts', 'convId', 'autosize', 'toast', 'state', 'S', 'checkShrink',
    `let synced = ''; ${t.replace(/^ {2}function takeBack/, 'function takeBack')}; return takeBack;`);
  const toasts = [];
  const takeBack = run(box, { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) }, () => 'c:1', () => {}, (x) => toasts.push(x), { pending: [], link: null }, { config: {} }, () => {});
  takeBack({ files: [], text: 'IMPORTANT A', link: null });
  assert.equal(box.value, 'IMPORTANT A\nand then B');
  assert.equal(toasts.length, 1);
  takeBack({ files: [], text: 'IMPORTANT A', link: null });
  assert.equal(box.value, 'IMPORTANT A\nand then B', 'the same words twice come back once');
});

test('waiting sends go in order when the connection is back, and a reload keeps what didn’t go as a draft', () => {
  const flush = fn(app, 'flushWaiting');
  assert.match(flush, /navigator\.onLine === false \|\| Date\.now\(\) < sendHold/);
  assert.match(flush, /await next\.go\(\);/);
  assert.match(flush, /if \(pendingSends\.has\(next\.nonce\) && next\.state === 'waiting'\) break;/, 'the rest stay behind one that still can’t go');
  assert.match(app, /window\.addEventListener\('online', \(\) => \{[^\n]*flushWaiting\(\{ fresh: true \}\)/);
  assert.match(app, /connUi\(false\);\n {6}\/\/ Messages that waited for the connection go now, in order \(flushWaiting\)\.\n {6}flushWaiting\(\{ fresh: true \}\);/);
  assert.match(app, /window\.addEventListener\('pagehide', \(\) => \{[\s\S]{0,400}drafts\.set\(p\.key/);
  // The copy's own words: Waiting for connection, and Not sent with Retry and Delete as named buttons.
  const el = fn(app, 'pendingEl');
  assert.match(el, /'Waiting for connection'/);
  assert.match(el, /'aria-label': 'Retry sending this message'/);
  assert.match(el, /'aria-label': 'Delete this unsent message'/);
});

test('the offline line above the box, and the banner: "You’re offline" without a connection, else "Reconnecting…"', () => {
  assert.match(app, /class: 'offline-note', role: 'status'/);
  assert.match(app, /Offline \\u2014 messages will send when you\\u2019re back/);
  const ui = fn(app, 'connUi');
  assert.match(ui, /navigator\.onLine === false \? 'You\\u2019re offline' : 'Reconnecting\\u2026'/);
  assert.match(html, /<div id="conn-banner" hidden role="status"><span class="spinner"><\/span><span class="conn-text">Reconnecting…<\/span><\/div>/);
  assert.match(css, /body\.m-ui #conn-banner \{[^}]*left: 0; right: 0; transform: none;/, 'a strip across a phone, not a pill');
  assert.match(css, /body\.m-ui\.conn-down #toasts/);
});

test('read state: a phone’s list page isn’t viewing the conversation behind it (messages, and threads)', () => {
  assert.match(app, /const viewing = currentKey\(\) === key && !document\.hidden && S\.view\.tab !== 'reels' && !\(isPhoneUI\(\) && M\.level === 'list'\);/);
  assert.match(fn(app, 'readingThread'), /!\(isPhoneUI\(\) && M\.level === 'list'\)/);
  // A mention seen as it arrives (at the bottom, window in front) is read in the notifications too.
  assert.match(app, /markRead\(key\);\n {6}if \(document\.hasFocus\(\)\) readInbox\(m\.id\);/);
});

test('inbox snippets are plain text: no Markdown marks, [code] for a code block, [spoiler] for a spoiler', () => {
  const all = fn(app, 'plainSnippet');
  const body = all.slice(0, all.indexOf('\n}\n') + 2);
  const plainSnippet = new Function('readableText', `${body}; return plainSnippet;`)((x) => x);
  assert.equal(plainSnippet('look **here** and `x`'), 'look here and x');
  assert.equal(plainSnippet('run this:\n```js\nrm -rf /\n```\nok?'), 'run this: [code] ok?');
  assert.equal(plainSnippet('the end is ||he dies||'), 'the end is [spoiler]');
  assert.equal(plainSnippet('# Big news\n> quoted'), 'Big news quoted');
});

test('the unread bar shows only while the "New messages" line is above the screen, "3 new" on a phone, 44 px there', () => {
  const bar = fn(app, 'renderUnreadBar');
  assert.match(bar, /watchNewLine\(bar\)/);
  assert.match(bar, /class: 'unread-count'/);
  assert.match(bar, /placeUnreadBar\(bar\)/, 'below a call shown above the chat');
  const watch = fn(app, 'watchNewLine');
  assert.match(watch, /new IntersectionObserver/);
  assert.match(watch, /e\.isIntersecting \|\| e\.boundingClientRect\.top > e\.rootBounds\.top/);
  assert.match(css, /body\.m-ui \.unread-bar button \{ min-height: 44px; \}/);
  assert.match(css, /body\.m-ui \.unread-count \{ display: inline; \}/);
});

test('touch: no emoji-search focus (the keyboard would cover the emoji); editing has Cancel and Save buttons', () => {
  assert.match(app, /if \(!isTouchUI\(\)\) setTimeout\(\(\) => search\.focus\(\), 20\);/);
  assert.doesNotMatch(app, /\n {2}setTimeout\(\(\) => search\.focus\(\), 20\);/);
  const edit = fn(app, 'editBox');
  assert.match(edit, /isTouchUI\(\)\n\s+\? h\('div', \{ class: 'edit-btns' \}/);
  assert.match(edit, /'Esc to '/, 'a keyboard keeps the hint');
  assert.match(css, /\.edit-btns \.btn \{ min-height: 44px;/);
});

test('the phone composer is capped by what’s visible; --composer-h for what floats above it', () => {
  assert.match(app, /const seen = isPhoneUI\(\) \? Math\.round\(\(\(window\.visualViewport && window\.visualViewport\.height\) \|\| window\.innerHeight\) \* 0\.3\) : 260;/);
  assert.match(app, /Math\.min\(ta\.scrollHeight, 260, Math\.max\(seen, 44\)\)/);
  assert.match(app, /window\.visualViewport\.addEventListener\('resize', onView\)/);
  assert.match(app, /main\.style\.setProperty\('--composer-h', /);
});

test('toasts: the same words while one is up count (×N) instead of stacking', () => {
  const t = util.slice(util.indexOf('export function toast'), util.indexOf('// Sounds live in sounds.js'));
  assert.match(t, /t\._text === message && t\._kind === kind && !t\.classList\.contains\('out'\)/);
  assert.match(t, /badge\.textContent = `\\u00d7\$\{count\}`;/);
});

test('older history: a skeleton row while it loads, started a screen and a half early', () => {
  assert.match(fn(app, 'olderSkeleton'), /'aria-busy': 'true'/);
  assert.match(app, /sc\.scrollTop < Math\.max\(200, sc\.clientHeight \* 1\.5\) && store\.hasMore && !store\.loading/);
  assert.match(app, /const prevTop = sc\.scrollTop;\n {6}if \(skel\) skel\.remove\(\);/, 'measured with the rows, so nothing moves');
});

test('small things: the poll icon is a chart, and a feature notification’s click brings the window forward', () => {
  assert.match(app, /\{ label: 'Create a poll', icon: 'chart',/);
  assert.match(app, /n\.onclick = \(\) => \{\n\s+window\.focus\(\);\n\s+if \(window\.hearthDesktop\) window\.hearthDesktop\.focus\(\);/);
});

// ------------------------------------------------------------------ the server
let srv; let boss; let bob; let general; let dm;
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
const cipher = () => 'v2:' + crypto.randomBytes(48).toString('base64');

before(async () => {
  srv = await startServer();
  boss = srv.owner;
  bob = await srv.register(`bob${hex(3)}`);
  const space = (await as(boss, 'POST', '/servers', { name: 'Delivery' })).json;
  general = space.channels.find((c) => c.type === 'text');
  const { code } = (await as(boss, 'POST', `/servers/${space.id}/invites`, {})).json;
  assert.equal((await as(bob, 'POST', `/invites/${code}/join`)).status, 200);
  srv.sql('UPDATE servers SET key_epoch = 1, needs_rotation = 0 WHERE id = ?', space.id);
  dm = (await as(boss, 'POST', '/dms', { userId: bob.id })).json;
});
after(async () => { if (srv) await srv.stop(); });

test('server: the same nonce sent again gets the first message back, not a second copy (channel and DM)', async () => {
  const nonce = hex(12);
  const first = await as(bob, 'POST', `/channels/${general.id}/messages`, { ciphertext: cipher(), epoch: 1, nonce });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.nonce, nonce);
  // Encrypted again for the retry (new words inside): the server still answers with the one it has.
  const again = await as(bob, 'POST', `/channels/${general.id}/messages`, { ciphertext: cipher(), epoch: 1, nonce });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.id, first.json.id);
  assert.equal(again.json.ciphertext, first.json.ciphertext);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND author_id = ?', general.id, bob.id)[0].n, 1);
  // Someone else's nonce, or the same one somewhere else, is a message of its own.
  const other = await as(boss, 'POST', `/channels/${general.id}/messages`, { ciphertext: cipher(), epoch: 1, nonce });
  assert.notEqual(other.json.id, first.json.id);
  const inDm = await as(bob, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(), nonce });
  assert.equal(inDm.status, 200, inDm.text);
  assert.notEqual(inDm.json.id, first.json.id);
  const dmAgain = await as(bob, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher(), nonce });
  assert.equal(dmAgain.json.id, inDm.json.id);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM dm_messages WHERE dm_id = ? AND author_id = ?', dm.id, bob.id)[0].n, 1);
  // A message without a nonce is never matched.
  const a = await as(bob, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher() });
  const b = await as(bob, 'POST', `/dms/${dm.id}/messages`, { ciphertext: cipher() });
  assert.notEqual(a.json.id, b.json.id);
});

test('server: too many messages at once is 429 rate_limited with Retry-After (the app waits that long, then sends)', async () => {
  let refused = null;
  for (let i = 0; i < 40 && !refused; i++) {
    const r = await as(bob, 'POST', `/channels/${general.id}/messages`, { ciphertext: cipher(), epoch: 1, nonce: hex(12) });
    if (r.status === 429) refused = r;
    else assert.equal(r.status, 200, r.text);
  }
  assert.ok(refused, 'a burst is refused at some point');
  assert.equal(refused.json.code, 'rate_limited');
  const wait = Number(refused.headers.get('retry-after'));
  assert.ok(wait > 0 && wait <= 10, `Retry-After in seconds (${wait})`);
});
