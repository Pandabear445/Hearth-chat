// Starting up never ends on the loading screen for good (the 1.46 load hang). A page reload sometimes stuck on "Loading
// Cindrly…" and never asked the server anything: Chromium aborted some of the app's module files (net::ERR_ABORTED)
// that the service worker was answering from its cache while the worker collected garbage. A module that fails to
// load stays failed for the whole page, so app.js never ran, and all its own recovery (bootFailed) is inside app.js.
// Here: that exact condition, made on purpose (the worker's garbage collected while it answers a reload), must no
// longer abort anything (sw.js answers with a copy read whole); and a file that fails anyway, or never arrives, or a
// first request that never answers, must still end in a working page or a splash that says so with a Reload button.
// Each case is a fresh browser context of its own (signed out unless it says otherwise); nothing here changes the
// shared accounts.
import { Person } from './harness.mjs';
import { check } from './flows.mjs';

const READY = '#auth:not([hidden]), #app:not([hidden])';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

// A context of our own. serviceWorkers 'block' lets page.route see the module requests (with a worker, it answers
// them); the worker case allows it. Its log goes into the failure report like everyone's.
async function open(t, { worker = false } = {}) {
  const context = await t.browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: worker ? 'allow' : 'block', extraHTTPHeaders: { 'x-forwarded-for': `198.18.93.${++n}` } });
  await context.route((url) => !url.href.startsWith(t.server.base), (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const p = new Person(`boot${n}`, context, page, t.server.base);
  p.tag = `boot${n}`;
  t.opened.push(p);
  // Every time the page itself is loaded (the guard reloading it counts).
  p.loads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) p.loads++; });
  p.warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') p.warnings.push(m.text()); });
  return p;
}
const shown = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5; }, sel);

// ------------------------------------------------------------------ the root cause, recreated: worker GC during reloads
async function workerGc(t) {
  const p = await open(t, { worker: true });
  const { page, context } = p;
  try {
    await page.goto(t.server.base);
    await page.waitForSelector(READY);
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForSelector(READY); }
    check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'The page should be controlled by the service worker.');
    // The worker that answers the page's files, driven over the browser's own DevTools connection.
    const cdp = await context.newCDPSession(page);
    const b = await t.browser.newBrowserCDPSession();
    let sess = null; let sessTarget = null; let id = 1;
    const swGc = async () => {
      const { targetInfo } = await cdp.send('Target.getTargetInfo');
      const { targetInfos } = await b.send('Target.getTargets');
      const sw = targetInfos.find((x) => x.type === 'service_worker' && x.browserContextId === targetInfo.browserContextId);
      if (!sw) return false;
      if (!sess || sessTarget !== sw.targetId) { sess = (await b.send('Target.attachToTarget', { targetId: sw.targetId, flatten: false })).sessionId; sessTarget = sw.targetId; }
      await b.send('Target.sendMessageToTarget', { sessionId: sess, message: JSON.stringify({ id: id++, method: 'HeapProfiler.collectGarbage' }) }).catch(() => { sess = null; });
      return true;
    };
    check(await swGc(), 'The service worker should be reachable to collect its garbage.');
    const failed = [];
    page.on('requestfailed', (r) => { if (/\/js\//.test(r.url())) failed.push(`${r.url().replace(t.server.base, '')} ${r.failure() ? r.failure().errorText : ''}`); });
    // Before the fix about 4 reloads in 5 like this stuck (32/40); 12 in a row would all but never pass.
    const ROUNDS = 12;
    for (let i = 0; i < ROUNDS; i++) {
      const loads = p.loads;
      const nav = page.reload({ waitUntil: 'commit' });
      const until = Date.now() + 700;
      while (Date.now() < until) { await swGc(); await sleep(2); }
      await nav;
      const ok = await page.waitForSelector(READY, { timeout: 15000 }).then(() => true, () => false);
      check(ok, `Reload ${i + 1} with the worker collecting garbage should start the app (failed: ${failed.join(', ') || 'none'}).`);
      check(!failed.length, `No app file should fail while the worker collects garbage (reload ${i + 1}): ${failed.join(', ')}`);
      check(p.loads - loads === 1, `Reload ${i + 1} should start without the guard loading the page again (${p.loads - loads} loads).`);
    }
    await b.detach().catch(() => {});
  } finally { await context.close().catch(() => {}); }
}

// ------------------------------------------------------------------ an app file aborted once: one reload, then it starts
async function abortedOnce(t) {
  const p = await open(t);
  const { page, context } = p;
  try {
    let aborted = 0;
    // android.js: app.js's first import, the file the e2e failure lost.
    await page.route('**/js/android.js', (r) => (aborted++ ? r.continue() : r.abort('aborted')));
    const config = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/config')) config.push(p.loads); });
    await page.goto(t.server.base);
    await page.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
    check(aborted >= 2, `The aborted file should have been asked for again (${aborted}).`);
    check(p.loads === 2, `The page should have been loaded again exactly once (${p.loads}).`);
    check(p.warnings.some((w) => /didn.t load; loading the page again/.test(w)), `The guard should say why it reloaded: ${p.warnings.join(' | ')}`);
    check(config.length === 1 && config[0] === 2, `The server should be asked for /config once, by the second load (${config}).`);
    check(await page.evaluate(() => !document.getElementById('boot-splash')), 'The splash should be gone.');
    check(await page.evaluate(() => sessionStorage.getItem('cindrly.bootRetry') === null), 'A start that worked should clear the guard’s note.');
  } finally { await context.close().catch(() => {}); }
}

// ------------------------------------------------------------------ an app file that never loads: no reload loop, a way out
async function abortedAlways(t) {
  const p = await open(t);
  const { page, context } = p;
  try {
    await page.route('**/js/android.js', (r) => r.abort('aborted'));
    await page.goto(t.server.base);
    await page.waitForSelector('#boot-splash.failed', { timeout: 15000 });
    check(/couldn.t start\. Reload the page/.test(await page.textContent('#boot-splash .boot-text')), 'The splash should say the start failed.');
    check(await shown(page, '#boot-splash .boot-reload'), 'The splash’s Reload button should show at once when the start failed.');
    await sleep(2500);
    check(p.loads === 2, `One automatic reload only, never a loop (${p.loads} loads).`);
    // The Reload button, once the file can arrive again.
    await page.unroute('**/js/android.js');
    await page.click('#boot-splash .boot-reload');
    await page.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
    check(p.loads === 3, `Reload should load the page once more (${p.loads} loads).`);
  } finally { await context.close().catch(() => {}); }
}

// ------------------------------------------------------------------ app.js never arrives: after 15 s, the Reload button
async function neverArrives(t) {
  const p = await open(t);
  const { page, context } = p;
  const held = [];
  try {
    let hold = true;
    await page.route('**/js/app.js', (r) => (hold ? held.push(r) : r.continue()));
    await page.goto(t.server.base, { waitUntil: 'commit' });
    await page.waitForSelector('#boot-splash');
    check(!(await shown(page, '#boot-splash .boot-reload')), 'No Reload button at first: most starts are quick.');
    await page.waitForFunction(() => { const el = document.querySelector('#boot-splash .boot-reload'); return el && getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) > 0.5; }, null, { timeout: 25000 });
    check(await shown(page, '#boot-splash .boot-slow'), 'The "taking longer than usual" line should show with it.');
    check(p.loads === 1, `Without a service worker (a first visit, maybe on a slow network) nothing reloads by itself (${p.loads}).`);
    hold = false;
    await page.click('#boot-splash .boot-reload');
    await page.waitForSelector('#auth:not([hidden])', { timeout: 15000 });
  } finally {
    for (const r of held) await r.abort().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ the first request never answers: bounded
async function configNeverAnswers(t) {
  const p = await open(t);
  const { page, context } = p;
  const held = [];
  try {
    await page.route('**/api/config', (r) => { held.push(r); });
    const t0 = Date.now();
    await page.goto(t.server.base);
    await page.waitForSelector('#auth:not([hidden])', { timeout: 20000 });
    const ms = Date.now() - t0;
    check(held.length === 1 && ms >= 9000, `The sign-in screen should come after /config gave up (${held.length} asked, ${ms} ms).`);
    check(p.loads === 1, `The page should not have reloaded (${p.loads}).`);
  } finally {
    for (const r of held) await r.abort().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ this browser's storage never answers (signed in)
async function storageNeverAnswers(t) {
  // Someone's sign-in from the flows before (their token is only read here: the start stops before it is used).
  let who = null;
  for (const q of Object.values(t.people)) {
    who = await q.page.evaluate(() => ({ token: localStorage.getItem('hearth.token'), uid: localStorage.getItem('hearth.userId') })).catch(() => null);
    if (who && who.token && who.uid) break;
    who = null;
  }
  check(who, 'Someone should be signed in after the main flows.');
  const p = await open(t);
  const { page, context } = p;
  try {
    await context.addInitScript(([token, uid]) => {
      localStorage.setItem('hearth.token', token);
      localStorage.setItem('hearth.userId', uid);
      // The keys' IndexedDB never answers (another tab holding it, a stuck browser): a request with no events, ever.
      const real = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ...rest) { return name === 'hearth' ? {} : real.call(this, name, ...rest); };
    }, [who.token, who.uid]);
    await page.goto(t.server.base);
    await page.waitForSelector('#boot-splash.failed', { timeout: 25000 });
    check(/storage didn.t answer/.test(await page.textContent('#boot-splash .boot-text')), 'The splash should say the browser’s storage didn’t answer.');
    check(await shown(page, '#boot-splash .boot-reload'), 'With its Reload button.');
    check(await page.locator('#auth:not([hidden])').count() === 0, 'Not the sign-in screen: the key may well be there, so no password is asked for.');
  } finally { await context.close().catch(() => {}); }
}

export const FLOWS = [
  ['boot: reloads while the service worker collects garbage all start (no app file aborted)', workerGc],
  ['boot: an app file aborted once: the page loads again by itself, once, and starts', abortedOnce],
  ['boot: an app file that never loads: one reload only, then the splash says so with a working Reload button', abortedAlways],
  ['boot: app.js that never arrives: the Reload button shows after 15 s and works', neverArrives],
  ['boot: /api/config that never answers: the sign-in screen still comes', configNeverAnswers],
  ['boot: this browser’s storage that never answers: the splash says so, no sign-in asked for', storageNeverAnswers],
];
