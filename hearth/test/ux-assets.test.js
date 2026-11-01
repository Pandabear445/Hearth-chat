// Every stylesheet the app's page links is kept for offline use. The 1.44 UX work splits its styles into one file
// per area (public/css/ux-*.css, loaded after app.css), and a file missing from the service worker's list would
// leave an installed app unstyled in that area when it opens offline. The list is built by the server from
// public/ (server/index.js APP_ASSETS), so this checks what it actually serves, not a copy of the rule.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const UX_SHEETS = ['menus', 'layout', 'conversation', 'onboarding', 'settings'].map((n) => `/css/ux-${n}.css`);
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const linked = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

test('the page links the per-area UX stylesheets after app.css and brainrot.css, in order', async () => {
  const sheets = linked((await srv.call('GET', '/')).text);
  const at = sheets.indexOf('/css/brainrot.css');
  assert.ok(at > sheets.indexOf('/css/app.css'), sheets.join(' '));
  assert.deepEqual(sheets.slice(at + 1, at + 1 + UX_SHEETS.length), UX_SHEETS);
  for (const s of UX_SHEETS) assert.ok(fs.existsSync(path.join(PUBLIC, s)), `${s} is linked but missing`);
});

test('every stylesheet the page links is in the service worker\'s offline list', async () => {
  const sheets = linked((await srv.call('GET', '/')).text);
  const sw = await srv.call('GET', '/sw.js');
  const assets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(sw.text)[1]);
  for (const s of sheets) assert.ok(assets.includes(s), `${s} isn't kept for offline use`);
});
