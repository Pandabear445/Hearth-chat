// The page's side of the iPhone app: the bridge (public/js/ios.js, over window.HearthIOS), its push registration
// (public/js/ios-push.js, Apple's push service instead of a UnifiedPush push app), no way to pay inside the app
// (noPayments), and the connect screen talking to the iPhone app as well as the Android one.
//
// Static checks on the sources, the push module run in Node, and ios.js run in a child Node with a stand-in for
// the app's native half. No server is started. What only a phone can show is in mobile/README.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const mod = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);
const between = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, to); return src.slice(a, b); };
const TOKEN = 'ab'.repeat(32);
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

test('ios-web-1: noPayments covers the iPhone app (its bridge or its HearthiOS user agent), and the web is unchanged', () => {
  const android = read('public', 'js', 'android.js');
  const line = /^export const noPayments = (.+);$/m.exec(android);
  assert.ok(line, 'noPayments');
  assert.match(line[1], /^androidApp\.on \|\| \/\\bHearthAndroid\\b\/\.test\(ua\) \|\| iosApp\.on \|\| \/\\bHearthiOS\\b\/\.test\(ua\)$/);
  assert.match(android, /^import \{ iosApp, connectIos \} from '\.\/ios\.js';$/m);
  // The user agent rule as written, on real user agents.
  const iosRe = new RegExp(/\/(\\bHearthiOS\\b)\//.exec(line[1])[1]);
  const andRe = new RegExp(/\/(\\bHearthAndroid\\b)\//.exec(line[1])[1]);
  const inApp = (ua) => andRe.test(ua) || iosRe.test(ua);
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.equal(inApp(`${IPHONE} HearthiOS`), true);
  assert.equal(inApp(`${IPHONE} HearthAndroid`), true);
  for (const ua of [IPHONE, `${IPHONE} Safari/604.1`, `${IPHONE} HearthiOSX`, `${IPHONE} NotHearthiOS`, 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Hearth/1.0']) assert.equal(inApp(ua), false, ua);
  // The user agent the app really adds (mobile/capacitor.config.json).
  const cfg = JSON.parse(read('mobile', 'capacitor.config.json'));
  if (cfg.ios) assert.equal(cfg.ios.appendUserAgent, 'HearthiOS');
  // Inside the iPhone app Settings leaves out the download page and its share link, as in the Android app.
  const settings = read('public', 'js', 'settings.js');
  assert.match(settings, /iosApp\.on \|\| window\.hearthDesktop \|\| androidApp\.on \? null : section\('Desktop app',/);
  assert.match(settings, /iosApp\.on \|\| androidApp\.on \? null : section\('Share', /);
  // Deleting the account, reporting, blocking and the terms never depend on noPayments.
  const app = read('public', 'js', 'app.js');
  for (const fn of ['function askToAcceptTerms(', 'async function toggleBlock(']) {
    assert.ok(app.includes(fn), fn);
    const body = app.slice(app.indexOf(fn), app.indexOf('\n}\n', app.indexOf(fn)));
    assert.doesNotMatch(body, /noPayments|iosApp/, fn);
  }
  const account = settings.slice(settings.indexOf('function accountTab('), settings.indexOf('\n}\n', settings.indexOf('function accountTab(')));
  assert.match(account, /section\('Delete account'/);
  assert.doesNotMatch(account, /noPayments|iosApp/);
});

test('ios-web-2: ios.js has no imports (android.js imports it), and gets what it needs through connectIos', () => {
  const ios = read('public', 'js', 'ios.js');
  assert.doesNotMatch(ios, /^\s*import[\s{*'"]/m, 'no static import');
  assert.doesNotMatch(ios, /\bimport\s*\(/, 'no dynamic import');
  assert.doesNotMatch(ios, /\brequire\s*\(/);
  assert.match(ios, /^const I = window\.HearthIOS;$/m);
  assert.match(ios, /^export const iosApp = \{ on: !!I,/m);
  assert.match(ios, /send\(\{ type: 'hello', v: 3 \}\)/);
  const android = read('public', 'js', 'android.js');
  assert.match(android, /^if \(iosApp\.on\) connectIos\(\{ createPush: createIosPush, openHash: safeOpenHash, inviteHash: safeInviteHash, shareHash: safeShareHash, underWay \}\);$/m);
  // Nothing ios.js loads leads back to android.js.
  for (const f of ['ios-push.js', 'android-push.js', 'auto-update.js']) assert.doesNotMatch(read('public', 'js', f), /from '\.\/(android|ios|app)\.js'/, f);
});

test('ios-web-3: ios-push.js uses the same open-link and invite rules as android-push.js', async () => {
  const AP = await mod('public', 'js', 'android-push.js');
  const IP = await mod('public', 'js', 'ios-push.js');
  assert.equal(IP.OPEN_RE.source, AP.OPEN_RE.source);
  assert.equal(IP.OPEN_RE.flags, AP.OPEN_RE.flags);
  // If the iPhone module ever gets its own copy of the rule, it must still say the same thing.
  const src = read('public', 'js', 'ios-push.js');
  const own = /export const OPEN_RE = (\/.+\/[a-z]*);/.exec(src);
  if (own) assert.equal(own[1], /export const OPEN_RE = (\/.+\/[a-z]*);/.exec(read('public', 'js', 'android-push.js'))[1]);
  else assert.match(src, /^export \{ OPEN_RE, safeOpenHash, safeInviteHash \} from '\.\/android-push\.js';$/m);
  const paths = ['/', '/#m/abc123', '/#c/abc', '/#d/abc', '/#call/dm:abc', '/#call/abc', '/#updates', '/#study', '/#scheduled',
    'https://evil.example/', '//evil.example', 'javascript:alert(1)', '/#m/ABC', '/#invite/abcd', '', null, undefined];
  for (const p of paths) assert.equal(IP.safeOpenHash(p), AP.safeOpenHash(p), String(p));
  for (const c of ['abcd2345', 'a', 'ab/cd', '<script>', 'x'.repeat(65), null]) assert.equal(IP.safeInviteHash(c), AP.safeInviteHash(c), String(c));
});

test('ios-web-4: the push bridge resolves with a token and keys, and says why it failed in iPhone terms', async () => {
  const IP = await mod('public', 'js', 'ios-push.js');
  assert.match(IP.reasonText.blocked, /^Notifications are off for Hearth in iPhone Settings/);
  assert.match(IP.reasonText.noApns, /^This server can’t send iPhone notifications \(apnsEnabled is false\)/);
  assert.match(IP.reasonText.NETWORK, /^Couldn’t reach Apple’s push service/);
  assert.doesNotMatch(Object.values(IP.reasonText).join(' '), /ntfy|Android|push app/);
  assert.equal(IP.apnsEndpoint({ token: TOKEN.toUpperCase(), environment: 'production' }), `apns:production:${TOKEN}`);
  assert.equal(IP.apnsEndpoint({ token: TOKEN }), '');
  const ok = { state: 'registered', token: TOKEN, environment: 'sandbox', keys: KEYS };
  assert.deepEqual(IP.registration(ok), { token: TOKEN, environment: 'sandbox', keys: KEYS });
  for (const bad of [{ ...ok, token: 'xyz' }, { ...ok, token: 'ab' }, { ...ok, environment: 'dev' }, { ...ok, keys: { p256dh: KEYS.p256dh } }, { ...ok, keys: { ...KEYS, auth: 'a b' } }, { ...ok, state: 'pending' }, null]) {
    assert.equal(IP.registration(bad), null, JSON.stringify(bad));
  }

  const sent = [];
  let p;
  // Registered: resolves with the token, environment, keys and the token it replaced.
  p = IP.createIosPush({ send: (m) => { sent.push(m); if (m.type === 'pushRegister') { setTimeout(() => p._reply({ type: 'pushState', state: 'pending' }), 5); setTimeout(() => p._event({ ...ok, previous: 'cd'.repeat(32) }), 15); } } });
  const r = await p.register();
  assert.equal(r.token, TOKEN);
  assert.deepEqual(r.keys, KEYS);
  assert.equal(r.previous, 'cd'.repeat(32));
  assert.deepEqual(sent.map((m) => m.type), ['pushRegister'], 'no VAPID key and no push app list on iOS');
  // Notifications turned off: the iPhone Settings text.
  p = IP.createIosPush({ send: (m) => { if (m.type === 'pushRegister') setTimeout(() => p._reply({ type: 'pushState', state: 'blocked' }), 5); } });
  await assert.rejects(p.register(), (e) => e.code === 'blocked' && e.message === IP.reasonText.blocked);
  // Apple unreachable.
  p = IP.createIosPush({ send: (m) => { if (m.type === 'pushRegister') setTimeout(() => p._reply({ type: 'pushState', state: 'failed', reason: 'NETWORK' }), 5); } });
  await assert.rejects(p.register(), (e) => e.code === 'NETWORK' && e.message === IP.reasonText.NETWORK);
  // "Registered" without keys is the app's fault: fails at once instead of waiting.
  p = IP.createIosPush({ send: (m) => { if (m.type === 'pushRegister') setTimeout(() => p._reply({ type: 'pushState', state: 'registered', token: TOKEN, environment: 'production' }), 5); }, timeoutMs: 5000 });
  await assert.rejects(p.register(), (e) => e.code === 'NO_KEYS');
  // No answer at all.
  p = IP.createIosPush({ send: () => {}, timeoutMs: 30 });
  await assert.rejects(p.register(), (e) => e.code === 'timeout');
  // state(): the answer, or the last known one; unregister() never hangs.
  p = IP.createIosPush({ send: (m) => { if (m.type === 'pushState') setTimeout(() => p._reply({ type: 'pushState', ...ok }), 5); } });
  assert.equal((await p.state()).token, TOKEN);
  p = IP.createIosPush({ send: () => {}, initial: { state: 'registered' }, stateMs: 20, unregisterMs: 20 });
  assert.equal((await p.state()).state, 'registered');
  await p.unregister();
  // Changes the app reports by itself reach onChange.
  const seen = [];
  p.onChange((st) => seen.push(st.state));
  p._event({ state: 'blocked' });
  assert.deepEqual(seen, ['blocked']);
});

test('ios-web-5: ios.js in a page with the app’s bridge: hello, the app’s answers, links, notifications, calls', () => {
  const script = `
    const sent = [];
    const w = new EventTarget();
    w.HearthIOS = { postMessage: (m) => { sent.push(JSON.parse(m)); return Promise.resolve(null); }, onmessage: null };
    globalThis.window = w;
    globalThis.document = new EventTarget();
    globalThis.location = { hash: '', origin: 'https://chat.example.com' };
    const store = new Map([['hearth.token', 't']]);
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    globalThis.HTMLAnchorElement = class { click() {} };
    const { iosApp, connectIos } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'public', 'js', 'ios.js')).href)});
    const out = { on: iosApp.on, first: sent.map((m) => m.type + ':' + m.v) };
    // The app's answer can come before android.js hands over its helpers: it waits for them.
    w.HearthIOS.onmessage({ data: JSON.stringify({ type: 'info', version: '1.0.0', notify: 'granted', call: true, open: '/#m/abc', push: { state: 'none' } }) });
    out.beforeConnect = location.hash;
    const made = [];
    const AP = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'public', 'js', 'android-push.js')).href)});
    connectIos({ createPush: (o) => { made.push(o.initial); return { _reply() {}, _event() {}, unregister() {} }; }, openHash: AP.safeOpenHash, inviteHash: AP.safeInviteHash, shareHash: () => '', underWay: (p) => p });
    out.afterConnect = location.hash;
    out.version = iosApp.version; out.calls = iosApp.calls; out.notify = window.Notification.permission; out.made = made;
    // Events from the app go through the same checks.
    w.dispatchEvent(new CustomEvent('hearth-open', { detail: 'https://evil.example/' }));
    out.afterBadOpen = location.hash;
    w.dispatchEvent(new CustomEvent('hearth-invite', { detail: 'abcd2345' }));
    out.afterInvite = location.hash;
    // An answer as an object (not JSON text) counts too.
    w.HearthIOS.onmessage({ data: { type: 'info', open: '/#updates' } });
    out.objectAnswer = location.hash;
    let hung = 0; iosApp.onHangUp = () => hung++;
    w.dispatchEvent(new Event('hearth-hangup'));
    out.hung = hung;
    sent.length = 0;
    new window.Notification('Alex', { body: 'hi', tag: 'd:abc' });
    iosApp.callState({ inCall: true, title: 'In a call' });
    iosApp.callState({ inCall: false });
    iosApp.cancel('c:x');
    out.later = sent.map((m) => m.type + (m.tag ? ':' + m.tag : ''));
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.on, true);
  assert.deepEqual(out.first, ['hello:3']);
  assert.equal(out.beforeConnect, '');
  assert.equal(out.afterConnect, '#m/abc');
  assert.equal(out.version, '1.0.0');
  assert.equal(out.calls, true);
  assert.equal(out.notify, 'granted');
  assert.deepEqual(out.made, [{ state: 'none' }]);
  assert.equal(out.afterBadOpen, '#m/abc', 'a foreign link goes nowhere');
  assert.equal(out.afterInvite, '#invite/abcd2345');
  assert.equal(out.objectAnswer, '#updates');
  assert.equal(out.hung, 1);
  assert.deepEqual(out.later, ['notify:d:abc', 'callStart', 'callEnd', 'cancel:c:x']);
});

test('ios-web-6: app.js subscribes the iPhone app with type apns, unsubscribes apns:<env>:<token>, and stops when the server can’t send to iPhones', () => {
  const js = read('public', 'js', 'app.js');
  assert.match(js, /^import \{ androidApp, noPayments \} from '\.\/android\.js';$/m, 'unchanged');
  assert.match(js, /^import \{ iosApp \} from '\.\/ios\.js';$/m);
  assert.match(js, /supported: \(\) => \(iosApp\.on \? !!\(iosApp\.push && S\.config && S\.config\.apnsEnabled\)/);
  const enable = between(js, 'async function enablePush(', '\n}\n');
  assert.match(enable, /if \(iosApp\.on\) \{[\s\S]*if \(!\(S\.config && S\.config\.apnsEnabled\)\) \{ if \(quiet\) return; throw new Error\(iosReasonText\.noApns\); \}[\s\S]*return enableIosPush\(\{ quiet \}\);/);
  // Before the browser's own push (WKWebView has none).
  assert.ok(enable.indexOf('if (iosApp.on)') < enable.indexOf('navigator.serviceWorker'));
  const sub = between(js, 'async function subscribeIosPush(', '\n}\n');
  assert.match(sub, /api\('POST', '\/push\/subscribe', \{ subscription: \{ type: 'apns', token: st\.token, environment: st\.environment, keys: st\.keys \}, replaces: prev && prev !== endpoint \? prev : undefined \}\)/);
  assert.match(sub, /if \(quiet\) return;/, 'a quiet start asks nothing');
  const disable = between(js, 'async function disablePush(', '\n}\n');
  assert.match(disable, /if \(iosApp\.push\) \{\n\s*const endpoint = localStorage\.getItem\('hearth\.push\.endpoint'\);\n\s*if \(endpoint\) await api\('POST', '\/push\/unsubscribe', \{ endpoint \}\)[\s\S]*?await iosApp\.push\.unregister\(\);/);
  assert.ok(disable.indexOf('if (iosApp.on) return;') < disable.indexOf('navigator.serviceWorker'), 'never waits for a service worker the app has none of');
  assert.match(between(js, 'async function signOutHere(', '\n}\n'), / \|\| iosApp\.push\) await Promise\.race\(\[disablePush\(\{ signOut: true \}\)/);
  assert.match(js, /if \(androidApp\.on\) androidPushAtStart\(\); else if \(iosApp\.on\) iosPushAtStart\(\); else applePushAtStart\(\);/);
  assert.match(js, /iosApp\.callState\(\{ inCall: !!voice\.channelId/);
  assert.match(js, /iosApp\.onHangUp = androidApp\.onHangUp;/);
  assert.match(js, /const isStandalone = \(\) => [^\n]*\|\| iosApp\.on;/, 'no "Add to Home Screen" tip inside the app');
  // The page's endpoint matches the server's (apns:<env>:<lowercase token>).
  assert.match(read('public', 'js', 'ios-push.js'), /`apns:\$\{st\.environment\}:\$\{String\(st\.token\)\.toLowerCase\(\)\}`/);
});

test('ios-web-7: the connect screen tells the iPhone app its server through hearthIOS, and the Android app as before', () => {
  const html = read('mobile', 'www', 'index.html');
  const tell = between(html, 'const tellApp = ', '\n    });\n');
  assert.match(tell, /const ios = window\.webkit && window\.webkit\.messageHandlers && window\.webkit\.messageHandlers\.hearthIOS;/);
  assert.match(tell, /const A = ios \? window\.HearthIOS : window\.HearthAndroid;/);
  assert.match(tell, /A\.postMessage\(JSON\.stringify\(\{ type: 'setServer', origin \}\)\)/);
  assert.match(tell, /\.type === 'serverSet'/);
  // Run it: an iPhone app answering through onmessage, one answering the reply, and no app at all.
  const fn = (win) => new Function('window', 'setTimeout', 'clearTimeout', `return ${tell.slice('const tellApp = '.length)}\n    });`)(win, setTimeout, clearTimeout);
  const run = async (win) => { const t0 = Date.now(); await fn(win)('https://chat.example.com'); return Date.now() - t0; };
  return (async () => {
    const posted = [];
    const viaOnmessage = { webkit: { messageHandlers: { hearthIOS: {} } }, HearthIOS: { postMessage(m) { posted.push(JSON.parse(m)); setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'serverSet' }) }), 5); } } };
    assert.ok((await run(viaOnmessage)) < 1000);
    assert.deepEqual(posted, [{ type: 'setServer', origin: 'https://chat.example.com' }]);
    const viaReply = { webkit: { messageHandlers: { hearthIOS: {} } }, HearthIOS: { postMessage: () => Promise.resolve({ type: 'serverSet' }) } };
    assert.ok((await run(viaReply)) < 1000);
    const android = { HearthAndroid: { postMessage(m) { posted.push(JSON.parse(m)); setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'serverSet' }) }), 5); } } };
    assert.ok((await run(android)) < 1000);
    assert.ok((await run({})) < 100, 'a browser goes straight on');
  })();
});
