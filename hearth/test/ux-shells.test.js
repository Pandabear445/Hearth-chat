// The apps' connection screens (1.44 "user experience on all devices", WP-F): the phone apps' connect page
// (mobile/www/index.html) with its "Can't reach" card, the native code that sends people there with a code instead
// of prose, Android's address check and "Switch and join?", the iPhone app's "Open in Safari", and the desktop app's
// connect screen, cold start and Linux tray default.
//
// Static checks, plus the pages themselves in Chromium when Playwright is installed (no Hearth server needed: the
// pages are served from the checkout and every other address answers 204, which leaves the page where it is, as a
// server that never answers would).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const WWW = read('mobile', 'www', 'index.html');
const script = (html) => /<script>([\s\S]*)<\/script>/.exec(html)[1];
// A function declared in a page's script, as a function to call here.
function pageFn(html, name) {
  const src = script(html);
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} found`);
  const end = src.indexOf('\n    }\n', at);
  return new Function(`${src.slice(at, end + 6)}; return ${name};`)();
}

// ================================================================== the phone apps' connect page
test('ux-shells-1: norm() keeps a plain address as its origin and turns down anything else', () => {
  const norm = pageFn(WWW, 'norm');
  assert.equal(norm('chat.example.com'), 'https://chat.example.com');
  assert.equal(norm('  Chat.Example.com/some/page '), 'https://chat.example.com');
  assert.equal(norm('https://1.2.3.4:3000'), 'https://1.2.3.4:3000');
  assert.equal(norm('http://192.168.1.10:3000'), 'http://192.168.1.10:3000');
  assert.equal(norm('localhost:3000'), 'https://localhost:3000');
  for (const bad of ['not a url!!', 'chat example.com', 'chat_example.com', 'exa$mple.com', 'ftp://chat.example.com', 'javascript:alert(1)', 'https://me:pw@chat.example.com', '', '   ', '!!']) {
    assert.equal(norm(bad), '', bad);
  }
});

test('ux-shells-2: the "Can’t reach" card retries by itself with growing waits, on online and on coming back to the front', () => {
  const js = script(WWW);
  assert.match(js, /window\.addEventListener\('online', now\)/, 'back online: try now');
  assert.match(js, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) now\(\); \}\)/, 'app in front again: try now');
  assert.match(js, /store\('hearth\.delay', Math\.min\(60, delay \* 2\)\)/, 'waits double up to a minute');
  assert.match(js, /timer = setTimeout\(attempt, delay \* 1000\)/);
  assert.match(js, /`Retrying in \$\{left\}s`/);
  // Words for codes, never the code itself or the web view's text
  assert.doesNotMatch(js, /err\.textContent = params\.get\('error'\)/, 'no raw error text from the address');
  assert.match(js, /reasons\[r\] \|\| 'Check your internet connection if this takes a while\.'/);
  // A certificate problem waits for the person (trying by itself would only bring the question back)
  assert.match(js, /if \(isCert\(reason\)\) \{[\s\S]*'Review certificate'[\s\S]*return;\s*\}/);
  // Locked builds: Change server never shows, the address form never opens
  assert.match(js, /\$\('change'\)\.hidden = locked;/);
  assert.match(js, /else if \(locked\) go\(fixed\);/);
  assert.match(js, /if \(!locked\) changeTimer = setTimeout\(\(\) => \{ \$\('loading-change'\)\.hidden = false; \}, 6000\)/, '"Change server" after 6s while connecting, unlocked only');
  // ?change=1 has a way back; the first run doesn't connect by itself
  assert.match(js, /else if \(params\.get\('change'\)\) showForm\('', \{ cancel: true \}\);/);
  assert.match(js, /\$\('cancel'\)\.addEventListener\('click', \(\) => go\(saved\)\)/);
  assert.match(js, /First run: the suggested server is filled in, but the person presses Connect/);
  // 48px controls stay
  assert.match(WWW, /input \{ width: 100%; height: 48px;/);
  assert.match(WWW, /button \{ margin-top: 14px; width: 100%; height: 48px;/);
});

test('ux-shells-3: Android checks an address before saving it, natively, and only for the connect screen', () => {
  const js = script(WWW);
  assert.match(js, /ask\(\{ type: 'probe', origin \}, 'probe', 10000\)/);
  assert.match(js, /if \(!r\.ok\) \{[\s\S]*explain\('NOT_HEARTH'\)/);
  const main = read('mobile', 'native', 'MainActivity.java');
  const probeCase = main.slice(main.indexOf('case "probe"'), main.indexOf('case "probe"') + 400);
  assert.match(probeCase, /if \(!from\.equals\(localOrigin\(\)\)\) break;/, 'the server’s page can’t use the app to fetch other sites');
  const probe = main.slice(main.indexOf('private void probe('), main.indexOf('// Opens one of the app\'s own addresses'));
  assert.match(probe, /new URL\(origin \+ "\/api\/config"\)/);
  assert.match(probe, /setConnectTimeout\(8000\)/);
  assert.match(probe, /setInstanceFollowRedirects\(false\)/, 'a redirect elsewhere isn’t taken for the server');
  assert.match(probe, /if \(v instanceof String\) name = \(String\) v;/, 'a Hearth server answers with a name');
  assert.match(probe, /"NOT_HEARTH"/);
  assert.match(probe, /runOnUiThread\(\(\) -> then\.done\(r\)\)/);
});

test('ux-shells-4: the apps send a code and the host to the connect page, never prose', () => {
  const main = read('mobile', 'native', 'MainActivity.java');
  const err = main.slice(main.indexOf('public void onReceivedError('), main.indexOf('public void onReceivedSslError('));
  assert.match(err, /showOffline\(reasonCode\(error\.getErrorCode\(\), error\.getDescription\(\)\), request\.getUrl\(\)\.toString\(\)\)/);
  assert.match(err, /showOffline\("HTTP_" \+ status, url\)/, 'a proxy’s 502 while the server restarts');
  assert.doesNotMatch(main, /\?error=/, 'no ?error= prose left');
  assert.match(main, /showOffline\("CERT_UNTRUSTED", url\)/);
  assert.match(main, /"\?offline=1&reason=" \+ URLEncoder\.encode\(reason, "UTF-8"\) \+ "&host=" \+ URLEncoder\.encode\(host, "UTF-8"\)/);
  const nav = read('mobile', 'ios-native', 'App', 'HearthNavigation.swift');
  assert.doesNotMatch(nav, /showConnectError\(/, 'iPhone: no prose either');
  assert.match(nav, /showOffline\(vc, reason: HearthNavigation\.reasonName\(e\), url: failing\)/);
  assert.match(nav, /vc\.showConnect\("\?offline=1&reason=" \+ enc\(reason\) \+ "&host=" \+ enc\(host\)\)/);
  assert.match(nav, /case NSURLErrorNotConnectedToInternet: return "NSURLErrorNotConnectedToInternet"/);
  // Every name the iPhone app sends has words on the page
  const names = [...nav.matchAll(/return "(NSURLError[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 10);
  const isCert = /const isCert = \(r\) => (\/.*\/)\.test\(r\);/.exec(script(WWW))[1];
  const certRe = new Function(`return ${isCert}`)();
  for (const n of names) assert.ok(new RegExp(`\\b${n}:`).test(WWW) || certRe.test(n), `${n} is explained`);
});

test('ux-shells-5: reasonCode turns a web view error into Chromium’s code name (javac)', { skip: spawnSync('javac', ['-version'], { stdio: 'ignore' }).status !== 0 && 'no JDK' }, () => {
  const main = read('mobile', 'native', 'MainActivity.java');
  const at = main.indexOf('static String reasonCode(');
  const end = main.indexOf('\n    }\n', at);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-reason-'));
  try {
    fs.writeFileSync(path.join(tmp, 'ReasonCheck.java'), `public class ReasonCheck {
  ${main.slice(at, end + 6)}
  public static void main(String[] a) {
    System.out.println(String.join(",", reasonCode(-2, "net::ERR_INTERNET_DISCONNECTED"), reasonCode(-2, "Something else"), reasonCode(-8, null),
      reasonCode(-6, "net::ERR_CONNECTION_REFUSED"), reasonCode(-1, "<b>hi</b>"), reasonCode(-11, "")));
  }
}`);
    execFileSync('javac', ['-d', tmp, path.join(tmp, 'ReasonCheck.java')], { stdio: 'pipe' });
    assert.equal(execFileSync('java', ['-cp', tmp, 'ReasonCheck'], { encoding: 'utf8' }).trim(),
      'ERR_INTERNET_DISCONNECTED,ERR_NAME_NOT_RESOLVED,ERR_TIMED_OUT,ERR_CONNECTION_REFUSED,ERR_FAILED,ERR_SSL_PROTOCOL_ERROR');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ux-shells-6: an invite for another server: Android offers "Switch and join?" (checked first); the iPhone app offers Safari', () => {
  const main = read('mobile', 'native', 'MainActivity.java');
  const intent = main.slice(main.indexOf('private void handleIntent('), main.indexOf('private void askToSwitch('));
  assert.match(intent, /if \(!serverOrigin\(\)\.isEmpty\(\) && !InviteLinks\.forServer\(invite, serverOrigin\(\)\)\) \{\s*askToSwitch\(invite\);/);
  const ask = main.slice(main.indexOf('private void askToSwitch('), main.indexOf('interface ProbeDone'));
  assert.match(ask, /\.setTitle\("Switch to " \+ host \+ " and join\?"\)/);
  assert.match(ask, /\.setNegativeButton\("Cancel", null\)/);
  // the check first, then the server changes (the one place it does), then the invite opens there
  assert.ok(ask.indexOf('probe(newOrigin') < ask.indexOf('setServerOrigin(newOrigin)'));
  assert.ok(ask.indexOf('if (!r.optBoolean("ok"))') < ask.indexOf('setServerOrigin(newOrigin)'));
  assert.match(ask, /loadUrl\(InviteLinks\.target\(newOrigin, invite\[1\]\)\)/);
  // the connect page takes the app's record of the server, so a later start doesn't switch back
  assert.match(script(WWW), /ask\(\{ type: 'hello', v: 1 \}, 'info', 1500\)/);
  assert.match(script(WWW), /saved = fixed \|\| fromApp \|\| /);

  const router = read('mobile', 'ios-native', 'App', 'LinkRouter.swift');
  assert.match(router, /if !server\.isEmpty && !InviteLinks\.forServer\(invite, serverOrigin: server\) \{\s*otherServer\(invite\)/);
  const other = router.slice(router.indexOf('private func otherServer('));
  assert.match(other, /UIAlertController\(title: "This invite is for \\\(host\)"/);
  assert.match(other, /UIAlertAction\(title: "Open in Safari", style: \.default\) \{ \[weak page\] _ in page\?\.openOutside\(url\) \}/);
  assert.match(other, /UIAlertAction\(title: "Cancel", style: \.cancel\)/);
  assert.doesNotMatch(other.slice(0, other.indexOf('top.present')), /[Ss]witch/, 'an app built for one server never suggests switching');
});

// ================================================================== the desktop app
test('ux-shells-7: desktop: Linux doesn’t close to the tray unless asked; the connect answer is a code; certificates get the trust words', () => {
  const main = read('desktop', 'main.js');
  assert.match(main, /const IS_LINUX = process\.platform === 'linux';/);
  assert.match(main, /const closeToTray = \(\) => !IS_MAC && \(settings\.closeToTray \?\? \(IS_LINUX \? false : CONFIG\.closeToTray \?\? true\)\);/);
  assert.match(main, /IS_LINUX\s*\? `[^`]*from your app launcher/, 'the tray hint says how to get back');
  const connect = main.slice(main.indexOf("ipcMain.handle('connect'"), main.indexOf("ipcMain.handle('retry-server'"));
  for (const code of ['NOT_ALLOWED', 'LOCKED', 'BAD_ADDRESS']) assert.match(connect, new RegExp(`error: '${code}'`));
  assert.match(connect, /if \(!r\.ok\) return \{ ok: false, error: r\.error \|\| 'ERR_FAILED', host: /);
  assert.doesNotMatch(connect, /error: `/, 'no sentences from the main process');
  const fail = main.slice(main.indexOf("on('did-fail-load'"), main.indexOf('// Right-click menu'));
  assert.match(fail, /if \(code <= -200 && code > -300\) loadConnect\(String\(desc \|\| 'ERR_CERT_INVALID'\)\.replace\(\/\^net::\/, ''\)\)/);
  // Cold start: the connecting screen first, then the server from there; --hidden still never shows the window
  assert.match(main, /load\(\{ coldStart: true \}\);/);
  const load = main.slice(main.indexOf('function load('), main.indexOf('function connectQuery('));
  assert.match(load, /if \(!coldStart\) return win\.loadURL\(origin \+ '\/'\);/);
  assert.match(load, /win\.loadFile\(CONNECT_FILE, \{ query: connectQuery\(\{ connecting: '1' \}\) \}\);[\s\S]*win\.loadURL\(origin \+ '\/'\)/);
  assert.match(main, /win\.once\('ready-to-show', \(\) => \{ if \(!process\.argv\.includes\('--hidden'\) && !openedAtLogin\) win\.show\(\); \}\);/);

  const html = read('desktop', 'connect.html');
  const explainSrc = script(html);
  assert.match(explainSrc, /if \(isCert\(r\)\) return 'The server\\u2019s security certificate isn\\u2019t trusted\.';/);
  assert.match(explainSrc, /\$\('cert'\)\.hidden = !\(isCert\(error\) && server\);/);
  assert.doesNotMatch(explainSrc, /`Details: \$\{r\}`/, 'no raw codes');
  assert.match(explainSrc, /`Couldn’t connect to \$\{to\}\. \$\{explain\(r\.error\)\}`/);
});

// ================================================================== in Chromium
function findPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch { /* next */ }
  }
  return null;
}
const PW = findPlaywright();
const EXE = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find((p) => fs.existsSync(p));

test('ux-shells-8: in Chromium, the phone card fits portrait and landscape, locked builds show no address field, and desktop never shows a raw code', { skip: !PW && 'Playwright is not installed', timeout: 120000 }, async () => {
  const browser = await PW.chromium.launch({ executablePath: EXE, args: ['--proxy-server=direct://'] });
  const types = { '.html': 'text/html', '.png': 'image/png' };
  const errors = [];
  const open = async ({ w, h, touch = true, root = path.join(ROOT, 'mobile', 'www'), cfg = {}, init = '' }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
    await ctx.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.host !== 'app.local') return r.fulfill({ status: 204, body: '' });
      if (u.pathname === '/config.json') return r.fulfill({ body: JSON.stringify(cfg), contentType: 'application/json' });
      const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
      return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'text/plain' }) : r.fulfill({ status: 404, body: '' });
    });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return page;
  };
  const inView = (page, sel) => page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return false;
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 48;
  }, sel);
  try {
    const saved = "localStorage.setItem('hearth.server', 'https://chat.example.com');";
    for (const [w, h] of [[390, 844], [844, 390], [320, 568]]) {
      const page = await open({ w, h, init: saved });
      await page.goto('https://app.local/?offline=1&reason=ERR_INTERNET_DISCONNECTED&host=chat.example.com');
      await page.waitForSelector('#offline:not([hidden])');
      const text = await page.locator('#offline').innerText();
      assert.match(text, /Can’t reach chat\.example\.com/);
      assert.match(text, /You’re offline/);
      assert.doesNotMatch(text, /ERR_/, 'no raw code');
      assert.match(await page.locator('#status-text').innerText(), /Retrying in \ds/);
      if (h >= 390 && w >= 390) assert.equal(await inView(page, '#retry'), true, `Retry now on screen at ${w}x${h}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no sideways scroll at ${w}x${h}`);
      await page.context().close();
    }
    // A build locked to one server: no address field, no "Enter the address", no self-signed hint, no Change server
    const locked = await open({ w: 390, h: 844, cfg: { defaultServer: 'https://chat.example.com', lockServer: true } });
    await locked.goto('https://app.local/?offline=1&reason=NSURLErrorTimedOut&host=chat.example.com');
    await locked.waitForSelector('#offline:not([hidden])');
    assert.equal(await locked.locator('#url').isVisible(), false);
    assert.equal(await locked.locator('#change').isVisible(), false);
    const shown = await locked.evaluate(() => document.body.innerText);
    assert.doesNotMatch(shown, /Enter the address|self-signed|Change server/);
    assert.match(shown, /took too long/);
    // A locked build given the old ?error= still lands on the card, not the form
    await locked.goto('https://app.local/?error=anything');
    await locked.waitForSelector('#offline:not([hidden])');
    assert.equal(await locked.locator('#url').isVisible(), false);
    // Change server from the card has Cancel; a bad address is turned down in words
    const phone = await open({ w: 390, h: 844, init: saved });
    await phone.goto('https://app.local/?offline=1&reason=ERR_NAME_NOT_RESOLVED&host=chat.example.com');
    await phone.click('#change');
    assert.equal(await phone.locator('#cancel').isVisible(), true);
    await phone.fill('#url', 'not a url!!');
    await phone.click('#go');
    assert.match(await phone.locator('#err').innerText(), /doesn’t look like a web address/);
    // First run with a suggested server: filled in, waiting for Connect
    const first = await open({ w: 390, h: 844, cfg: { defaultServer: 'https://chat.example.com' } });
    await first.goto('https://app.local/');
    await first.waitForSelector('#f:not([hidden])');
    assert.equal(await first.inputValue('#url'), 'chat.example.com');

    // Desktop: a certificate error shows the trust words and "Review certificate", never the code
    const D = "window.hearthDesktop = { onResume() {}, changeServer() {}, async retryServer() { return { ok: false, error: 'ERR_NAME_NOT_RESOLVED' }; }, async connect(u) { return { ok: false, error: 'ERR_NAME_NOT_RESOLVED', host: u }; } };";
    const desk = await open({ w: 1024, h: 768, touch: false, root: path.join(ROOT, 'desktop'), init: D });
    await desk.goto(`https://app.local/connect.html?name=Hearth&server=${encodeURIComponent('https://1.2.3.4:3000')}&error=ERR_CERT_AUTHORITY_INVALID`);
    await desk.waitForSelector('#f:not([hidden])');
    const certText = await desk.locator('#f').innerText();
    assert.match(certText, /security certificate isn’t trusted/);
    assert.doesNotMatch(certText, /ERR_|-20\d/);
    assert.equal(await desk.locator('#cert').isVisible(), true);
    await desk.fill('#url', 'typo.example');
    await desk.click('#go');
    await desk.waitForFunction(() => /Couldn’t connect to/.test(document.getElementById('err').textContent));
    assert.match(await desk.locator('#err').innerText(), /^Couldn’t connect to typo\.example\. The address couldn’t be found \(DNS\)\.$/);
    // Starting up: "Connecting to <host>…"
    await desk.goto(`https://app.local/connect.html?name=Hearth&server=${encodeURIComponent('https://chat.example.com')}&connecting=1`);
    await desk.waitForSelector('#connecting:not([hidden])');
    assert.match(await desk.locator('#connecting').innerText(), /Connecting to chat\.example\.com…/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
