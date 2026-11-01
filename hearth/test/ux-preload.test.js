// The app's page names its modules up front (<link rel="modulepreload">, server/index.js MODULE_PRELOADS), so a first
// visit fetches them all at once instead of one import at a time. Checked on what the server actually answers: every
// module app.js imports (and theirs) is named, only files kept for offline use are, the invite page gets them too, and
// the page's Content-Security-Policy is the same as before.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const JS = path.join(__dirname, '..', 'public', 'js');
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const preloads = (html) => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
// app.js's static imports, followed through each module's own.
function graph() {
  const seen = new Set();
  const next = ['app.js'];
  while (next.length) {
    const f = next.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"]\.\/([\w.-]+\.js)['"]/gm)) next.push(m[1]);
  }
  return seen;
}

test('the app\'s page preloads every module app.js imports, and nothing that isn\'t kept offline', async () => {
  const r = await srv.call('GET', '/');
  assert.equal(r.status, 200);
  const list = preloads(r.text);
  for (const f of graph()) assert.ok(list.includes(`/js/${f}`), `/js/${f} isn't preloaded`);
  const sw = await srv.call('GET', '/sw.js');
  const offline = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(sw.text)[1]);
  for (const p of list) assert.ok(offline.includes(p), `${p} is preloaded but not in the offline list`);
  // Loaded later on demand (Settings' self-test), so not fetched up front.
  assert.ok(!list.includes('/js/selftest.js'));
  // In <head>, after the stylesheets.
  const head = r.text.slice(0, r.text.indexOf('</head>'));
  assert.equal(preloads(head).length, list.length);
  assert.ok(head.lastIndexOf('rel="stylesheet"') < head.indexOf('rel="modulepreload"'));
});

test('an invite link\'s page preloads them too', async () => {
  const r = await srv.call('GET', '/invite/abcdefgh');
  assert.ok(preloads(r.text).includes('/js/app.js'));
});

test('the page\'s Content-Security-Policy is unchanged', async () => {
  const csp = (await srv.call('GET', '/')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none';/);
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline|strict-dynamic|nonce-/);
  assert.equal(csp.split('; ')[0], "default-src 'self'");
});
