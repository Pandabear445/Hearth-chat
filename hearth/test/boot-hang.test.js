// The start never ends on the loading screen for good (the 1.46 load hang: a reload stuck on "Loading Cindrly…" and
// never asked the server anything). Root cause: Chromium aborted some module files the service worker was streaming
// from its cache when the worker collected garbage (net::ERR_ABORTED), and a module that fails stays failed for the
// page, so app.js never ran. Here, without a browser: sw.js (run in a sandbox) answers app files with a copy read
// whole, and gives up on a cache that doesn't answer; js/boot-guard.js (run in a sandbox) reloads once and then says
// so; and every wait on app.js's way to its first screen has an end. test/e2e/ux-boot.mjs does the same in Chromium.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SW = read('public', 'sw.js');
const GUARD = read('public', 'js', 'boot-guard.js');
const app = read('public', 'js', 'app.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ sw.js
// sw.js in a sandbox: its fetch handler, a Cache Storage and a network of our own.
function loadSw({ cache = new Map(), network = async () => new Response('net', { status: 200 }), cacheWaitMs = 50 } = {}) {
  const listeners = {};
  const caches = {
    match: async (req) => { const r = cache.get(typeof req === 'string' ? req : new URL(req.url).pathname); return typeof r === 'function' ? r() : r; },
    open: async () => ({ put: async () => {} }),
    keys: async () => [],
    delete: async () => true,
  };
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} }, registration: {}, location: { origin: 'https://chat.test' } };
  const src = SW.replace('__VERSION__', 'v1').replace("'__ASSETS__'", JSON.stringify(['/', '/js/app.js', '/js/util.js'])).replace(/const CACHE_WAIT_MS = \d+;/, `const CACHE_WAIT_MS = ${cacheWaitMs};`);
  vm.runInNewContext(src, { self, caches, fetch: network, location: self.location, Response, Request, URL, setTimeout, clearTimeout, Promise });
  // A GET for this path, as the page makes it; resolves to what respondWith was given (or null: left to the browser).
  return (pathname, mode = 'cors') => new Promise((resolve, reject) => {
    let answered = false;
    listeners.fetch({ request: { method: 'GET', url: `https://chat.test${pathname}`, mode }, respondWith: (p) => { answered = true; Promise.resolve(p).then(resolve, reject); } });
    if (!answered) resolve(null);
  });
}

test('sw.js: a cached app file is answered with a copy read whole, not the Cache Storage response itself', async () => {
  const cached = new Response('export const x = 1;', { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', etag: '"abc"' } });
  let netCalls = 0;
  const get = loadSw({ cache: new Map([['/js/app.js', cached]]), network: async () => { netCalls++; return new Response('net'); } });
  const r = await get('/js/app.js');
  assert.notEqual(r, cached, 'not the Cache Storage response object (its body is what Chromium aborted)');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/javascript; charset=utf-8', 'the same headers (module scripts need their type)');
  assert.equal(r.headers.get('etag'), '"abc"');
  assert.equal(await r.text(), 'export const x = 1;', 'the same bytes');
  assert.equal(netCalls, 0, 'no network for a cached file');
  // In the source too: the cached file goes through fromCache, never caches.match straight to respondWith.
  assert.match(SW, /const hit = await Promise\.race\(\[fromCache\(req\)/);
  assert.equal((SW.match(/caches\.match\(/g) || []).length, 1, 'caches.match only inside fromCache');
  assert.match(SW, /new Response\(await hit\.blob\(\), \{ status: hit\.status, statusText: hit\.statusText, headers: hit\.headers \}\)/);
});

test('sw.js: not cached, or a cache that never answers: the network, never a wait for good', async () => {
  const get = loadSw({ cache: new Map([['/js/app.js', () => new Promise(() => {})]]), network: async (req) => new Response(`net ${new URL(req.url).pathname}`) });
  const t0 = Date.now();
  const stalled = await Promise.race([get('/js/app.js'), sleep(3000).then(() => { throw new Error('waited for the cache for good'); })]);
  assert.equal(await stalled.text(), 'net /js/app.js');
  assert.ok(Date.now() - t0 < 2000, 'gave up on the cache after CACHE_WAIT_MS');
  assert.equal(await (await get('/js/util.js')).text(), 'net /js/util.js');
  // A broken cache (match throws) is the network as well.
  const get2 = loadSw({ cache: new Map([['/js/app.js', () => Promise.reject(new Error('broken'))]]) });
  assert.equal(await (await get2('/js/app.js')).text(), 'net');
  // The real wait is a few seconds, well inside the start-up guard's.
  assert.match(SW, /const CACHE_WAIT_MS = 5000;/);
  // API and socket requests are still never answered by the worker.
  assert.equal(await get('/api/config'), null);
  assert.equal(await get('/socket.io/?EIO=4'), null);
});

test('sw.js: offline, a page gets a copy of the cached app shell', async () => {
  const shell = new Response('<!doctype html><title>Cindrly</title>', { headers: { 'content-type': 'text/html' } });
  const get = loadSw({ cache: new Map([['/', shell]]), network: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await get('/', 'navigate');
  assert.notEqual(r, shell);
  assert.equal(await r.text(), '<!doctype html><title>Cindrly</title>');
  assert.equal(r.headers.get('content-type'), 'text/html');
});

// ------------------------------------------------------------------ js/boot-guard.js
// The guard in a sandbox: a page whose splash, readiness and sessionStorage are ours.
function loadGuard({ readyState = 'loading', booted = false, retryAt = null, controller = false, storage = true } = {}) {
  const listeners = {};
  const store = new Map(retryAt == null ? [] : [['cindrly.bootRetry', String(retryAt)]]);
  const text = { textContent: 'Loading Cindrly…' };
  const classes = new Set();
  const splash = { classList: { add: (c) => classes.add(c) }, querySelector: (s) => (s === '.boot-text' ? text : null) };
  const page = { reloads: 0, warnings: [], timers: [], classes, text, store, splashGone: false };
  const win = {
    __cindrlyBooted: booted,
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    sessionStorage: storage
      ? { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
      : { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } },
    document: { get readyState() { return page.readyState; }, getElementById: (id) => (id === 'boot-splash' && !page.splashGone ? splash : null) },
    location: { reload: () => { page.reloads++; } },
    navigator: { serviceWorker: controller ? { controller: {} } : undefined },
    console: { warn: (m) => page.warnings.push(m) },
    setTimeout: (f, ms) => { page.timers.push({ f, ms }); return page.timers.length; },
    Date, Number, String, Error,
  };
  page.readyState = readyState;
  page.win = win;
  page.fire = (type, ev = {}) => { for (const f of listeners[type] || []) f(ev); };
  page.fireTimers = () => { for (const t of page.timers) t.f(); };
  vm.runInNewContext(GUARD, Object.assign(win, { window: win, self: win }));
  return page;
}
const appScriptError = { target: { tagName: 'SCRIPT', src: 'https://chat.test/js/app.js' } };

test('boot guard: app.js never ran: the page loads again, once, and notes it', () => {
  const p = loadGuard();
  p.fire('error', appScriptError);
  p.fire('DOMContentLoaded');
  p.fire('load'); // (decides once)
  assert.equal(p.reloads, 1);
  assert.ok(Number(p.store.get('cindrly.bootRetry')) > 0);
  assert.match(p.warnings[0], /the app’s files didn’t load; loading the page again/);
  // The same thing right after that reload: no second reload (never a loop), the splash says so.
  const again = loadGuard({ retryAt: Date.now() - 1000 });
  again.fire('DOMContentLoaded');
  assert.equal(again.reloads, 0);
  assert.ok(again.classes.has('failed'));
  assert.match(again.text.textContent, /couldn’t start\. Reload the page to try again\./);
  // Long after an earlier reload, a new failure may reload again.
  const later = loadGuard({ retryAt: Date.now() - 5 * 60000 });
  later.fire('DOMContentLoaded');
  assert.equal(later.reloads, 1);
});

test('boot guard: a start that worked does nothing but clear the note; storage turned off never reloads in a loop', () => {
  const ok = loadGuard({ booted: true, retryAt: Date.now() - 1000 });
  ok.fire('DOMContentLoaded');
  assert.equal(ok.reloads, 0);
  assert.equal(ok.store.has('cindrly.bootRetry'), false);
  assert.equal(ok.classes.size, 0);
  // Loaded late (async): the page already complete.
  const late = loadGuard({ readyState: 'complete', booted: true });
  assert.equal(late.reloads, 0);
  const lateFail = loadGuard({ readyState: 'complete' });
  assert.equal(lateFail.reloads, 1);
  // No sessionStorage: it can't remember reloading, so it doesn't; it says so instead.
  const nostore = loadGuard({ storage: false });
  nostore.fire('DOMContentLoaded');
  assert.equal(nostore.reloads, 0);
  assert.ok(nostore.classes.has('failed'));
  // The splash already gone (the app drew something): nothing to do.
  const gone = loadGuard();
  gone.splashGone = true;
  gone.fire('DOMContentLoaded');
  assert.equal(gone.reloads, 0);
});

test('boot guard: files that never arrive: one reload when the service worker serves them, the Reload button otherwise', () => {
  const sw = loadGuard({ controller: true });
  assert.equal(sw.timers.length, 1);
  assert.ok(sw.timers[0].ms >= 15000, 'longer than the splash\'s own "taking longer" (15 s)');
  sw.fireTimers();
  assert.equal(sw.reloads, 1);
  const net = loadGuard({ controller: false });
  net.fireTimers();
  assert.equal(net.reloads, 0, 'a first visit on a slow network may still arrive: no reload by itself');
  const done = loadGuard({ controller: true });
  done.fire('DOMContentLoaded'); // (failed and reloaded already)
  done.fireTimers();
  assert.equal(done.reloads, 1);
});

test('boot guard: the splash\'s Reload button reloads this address', () => {
  const p = loadGuard();
  let prevented = false;
  p.fire('click', { target: { closest: (s) => (s === '#boot-splash .boot-reload' ? {} : null) }, preventDefault: () => { prevented = true; } });
  assert.equal(p.reloads, 1);
  assert.ok(prevented);
  p.fire('click', { target: { closest: () => null }, preventDefault() { throw new Error('not ours'); } });
  assert.equal(p.reloads, 1);
});

test('boot guard: a plain script with nothing the page\'s CSP would refuse', () => {
  assert.doesNotMatch(GUARD, /^\s*(import|export)\s/m, 'no module syntax: it must run when modules can\'t');
  assert.doesNotMatch(GUARD, /\beval\(|new Function|innerHTML|fetch\(|indexedDB|localStorage/, 'nothing but the splash, sessionStorage and a reload');
});

// ------------------------------------------------------------------ the page, as the server sends it
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the page loads the guard async, before the app\'s files; the splash has a Reload link that needs no script', async () => {
  const r = await srv.call('GET', '/');
  assert.equal(r.status, 200);
  const head = r.text.slice(0, r.text.indexOf('</head>'));
  const tag = /<script src="\/js\/boot-guard\.js"[^>]*><\/script>/.exec(head);
  assert.ok(tag, 'boot-guard.js is in <head>');
  assert.match(tag[0], /\sasync[\s>]/, 'async: it can never hold the page up');
  assert.ok(tag.index < head.indexOf('rel="modulepreload"') && tag.index < head.indexOf('rel="stylesheet"'), 'before the stylesheets and module preloads');
  assert.ok(!/modulepreload" href="\/js\/boot-guard\.js"/.test(r.text), 'not a module');
  const splash = r.text.slice(r.text.indexOf('<div id="boot-splash"'), r.text.indexOf('<!-- ============================== sign in'));
  assert.match(splash, /<a class="boot-reload" href="\/">Reload<\/a>/);
  // The CSP is unchanged: scripts from this site only, no inline handlers.
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none'/);
  // Kept for offline use, like the app's other files.
  const sw = await srv.call('GET', '/sw.js');
  assert.ok(JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(sw.text)[1]).includes('/js/boot-guard.js'));
});

test('splash CSS: the Reload button shows with the "taking longer" line, and at once when the start failed', () => {
  const css = read('public', 'css', 'ux-onboarding.css');
  assert.match(css, /#boot-splash \.boot-reload \{[^}]*visibility: hidden;[^}]*animation: boot-late \.3s ease 15s forwards;/);
  assert.match(css, /#boot-splash\.failed \.boot-reload \{ animation: none; opacity: 1; visibility: visible; \}/);
});

// ------------------------------------------------------------------ app.js and its helpers
function fn(name) {
  const at = app.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(at >= 0, `app.js has no function ${name}`);
  const next = app.slice(at + 1).search(/^(async )?function \w+\(|^const \w+ = /m);
  return app.slice(at, next < 0 ? undefined : at + 1 + next);
}

test('app.js: tells the guard it started, and every wait before the first screen has an end', () => {
  assert.match(app, /^window\.__cindrlyBooted = true;.*\ninit\(\);$/m);
  const boot = fn('bootUp');
  assert.match(boot, /api\('GET', '\/config', undefined, \{ timeout: BOOT_WAIT_MS \}\)/);
  assert.match(boot, /await bootStep\(E2EE\.loadKey\(uid\), /);
  assert.match(boot, /await bootStep\(E2EE\.loadPqSeed\(uid\), /);
  // Every await in bootUp is one of those (anything new must be bounded too).
  const awaits = [...boot.matchAll(/await ([^;]+);/g)].map((m) => m[1]);
  for (const a of awaits) assert.match(a, /^(api\('GET', '\/config', undefined, \{ timeout: BOOT_WAIT_MS \}\)|bootStep\()/, `unbounded wait in bootUp: ${a}`);
  assert.match(app, /const BOOT_WAIT_MS = 10000;/);
  // Declared before the top-level init() call: bootUp reads it before its first await, so a later declaration is
  // still in its temporal dead zone (a ReferenceError, swallowed into the fallback config: sign-ups hidden).
  assert.ok(app.indexOf('const BOOT_WAIT_MS') < app.search(/^init\(\);$/m), 'BOOT_WAIT_MS before init()');
  assert.ok(app.indexOf('function bootStep(') < app.search(/^init\(\);$/m));
});

test('bootStep: ends a wait that never ends, passes a quick answer and its errors through', async () => {
  const src = /function bootStep\(promise, what\) \{[\s\S]*?\n\}/.exec(app)[0];
  const bootStep = vm.runInNewContext(`const BOOT_WAIT_MS = 30; (${src})`, { setTimeout, clearTimeout, Promise, Error });
  assert.equal(await bootStep(Promise.resolve('key'), 'x'), 'key');
  await assert.rejects(bootStep(Promise.reject(new Error('nope')), 'x'), /nope/);
  await assert.rejects(bootStep(new Promise(() => {}), 'This browser’s storage'), /This browser’s storage didn’t answer\./);
});

test('api(): a timeout ends a request that never answers, as a network error', async () => {
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = globalThis.window || { addEventListener() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => new Promise((_, reject) => { opts.signal && opts.signal.addEventListener('abort', () => reject(opts.signal.reason)); });
  try {
    const { api } = await import(path.join(ROOT, 'public', 'js', 'api.js'));
    const t0 = Date.now();
    await assert.rejects(api('GET', '/config', undefined, { timeout: 50 }), (e) => e.network === true);
    assert.ok(Date.now() - t0 < 2000);
    // Without one, nothing changes (no signal is added).
    let opts = null;
    globalThis.fetch = async (u, o) => { opts = o; return new Response('{"ok":1}', { status: 200 }); };
    assert.deepEqual(await api('GET', '/x'), { ok: 1 });
    assert.equal(opts.signal, undefined);
  } finally { globalThis.fetch = realFetch; }
  await sleep(0);
});

test('e2ee key storage: a transaction that aborts fails, and a blocked open says so (never a wait for good)', () => {
  const e2ee = read('public', 'js', 'e2ee.js');
  const store = e2ee.slice(e2ee.indexOf('function idb()'), e2ee.indexOf('export const storeKey'));
  assert.match(store, /r\.onblocked = /);
  assert.match(store, /t\.onabort = \(\) => \{ done\(\); reject\(/);
  assert.match(store, /db\.onversionchange = \(\) => db\.close\(\)/);
});
