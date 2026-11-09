// The desktop app's own title bar: no system frame or menu bar, a thin dark strip of the app's own (titlebar.html)
// above the server's page, with the system's minimize / maximize / close buttons drawn on it. Works with any
// server version (the strip is the app's, not the server's), never covers the page, and gives the server's page
// no way to move, minimize or close the window. The source checks always run; the real app runs in Electron when
// it's installed (desktop/node_modules, or HEARTH_ELECTRON=<binary>; Linux without a display needs xvfb-run).
// With openbox and xdotool installed it also clicks the real buttons and drags the window. HEARTH_SHOTS=<folder>
// keeps screenshots of the screen there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('desktop titlebar: the window is a BaseWindow with the system buttons on the app\'s own strip', () => {
  const main = read('desktop', 'main.js');
  assert.doesNotMatch(main, /win\.webContents/, 'the page is reached through `page`, never the window');
  assert.doesNotMatch(main, /win\.load(URL|File)\(/);
  assert.match(main, /win = new BaseWindow\(\{/);
  assert.doesNotMatch(main, /autoHideMenuBar: true,\s*\n\s*icon/, 'no menu bar on the main window');
  const create = main.slice(main.indexOf('function createWindow()'), main.indexOf("page.on('will-prevent-unload'"));
  assert.match(create, /titleBarStyle: 'hidden', titleBarOverlay: \{ color: BAR_BG, symbolColor: BAR_FG, height: BAR_H \}/, 'Windows/Linux: the system draws its own buttons on the strip');
  assert.match(create, /IS_MAC \? \{ titleBarStyle: 'hidden', trafficLightPosition:/, 'macOS keeps its traffic lights');
  assert.match(main, /const BAR_BG = '#100e16';/);
  assert.match(main, /const BAR_H = CUSTOM_BAR \? 32 : 0;/);
  // the strip: its own page, preload and in-memory session, locked down
  assert.match(create, /preload: path\.join\(__dirname, 'titlebar-preload\.js'\), contextIsolation: true, sandbox: true,[\s\S]*devTools: !app\.isPackaged, partition: 'hearth-titlebar'/);
  assert.match(create, /bwc\.on\('will-navigate', \(e\) => e\.preventDefault\(\)\)/);
  assert.match(create, /bwc\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(create, /bwc\.session\.setPermissionRequestHandler\(\(wc, perm, cb\) => cb\(false\)\)/);
  // the page keeps its own preload, and sits below the strip; full screen hides the strip
  assert.match(create, /preload: path\.join\(__dirname, 'preload\.js'\), contextIsolation: true, sandbox: true,/);
  const layout = main.slice(main.indexOf('function layout()'), main.indexOf('function barState('));
  assert.match(layout, /const top = full \? 0 : BAR_H;/);
  assert.match(layout, /bar\.setVisible\(!full\)/);
  assert.match(layout, /setBounds\(\{ x: 0, y: top, width, height: Math\.max\(0, height - top\) \}\)/);
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) assert.match(create, new RegExp(`'${ev}'`), ev);
  // the close button is the system's: the same close handler (and close-to-tray) as before
  assert.match(create, /win\.on\('close', \(e\) => \{\s*remember\(\);\s*if \(!quitting && \(closeToTray\(\) \|\| IS_MAC\)\) \{\s*e\.preventDefault\(\);\s*win\.hide\(\);/);
  assert.match(create, /win\.on\('closed', \(\) => \{[\s\S]*wc\.close\(\)/, 'the pages in the window are closed with it');
  assert.match(create, /page\.on\('page-title-updated', \(e, title\) => \{[^\n]*win\.setTitle\(/, 'taskbar and Alt+Tab keep the page title');
  // the server's page can't make its own content drag the window
  assert.match(main, /insertCSS\('\*\{-webkit-app-region:no-drag!important\}', \{ cssOrigin: 'user' \}\)/);
});

test('desktop titlebar: the server\'s page gets no window controls; only the strip opens the menu', () => {
  const main = read('desktop', 'main.js');
  assert.match(main, /const fromMainWindow = \(e\) => !!\(win && !win\.isDestroyed\(\) && e\.sender === page && /);
  assert.match(main, /const fromTitleBar = \(e\) => [^\n]*e\.sender === bar\.webContents[^\n]*isAppFile\(e\.senderFrame\.url, TITLEBAR_FILE\)/);
  assert.match(main, /ipcMain\.on\('titlebar:menu', \(e\) => \{ if \(fromTitleBar\(e\)\) popAppMenu\(\); \}\);/);
  assert.doesNotMatch(main, /ipcMain\.(on|handle)\('(window|titlebar):(minimi[sz]e|maximi[sz]e|close|toggle)/, 'no window-control messages at all');
  assert.match(main, /wc && wc\.id === page\.id\)/, 'permissions: only the page');
  const preload = read('desktop', 'preload.js');
  assert.doesNotMatch(preload, /minimi[sz]e|maximi[sz]e|titlebar|close\(/i);
  const tpre = read('desktop', 'titlebar-preload.js');
  assert.match(tpre, /exposeInMainWorld\('hearthTitlebar', \{/);
  assert.deepEqual([...tpre.matchAll(/ipcRenderer\.(on|send|invoke|sendSync)\('([^']+)'/g)].map((m) => m[2]).sort(), ['titlebar:menu', 'titlebar:state']);
  // a lone Alt opens the menu (Help → Reset permissions lives there), unless Alt is a call keybind
  assert.match(main, /if \(CUSTOM_BAR && !IS_MAC\) altMenuKey\(input\);/);
  assert.match(main, /if \(!keybindCodes\.some\(\(c\) => \/\^Alt\(Left\|Right\)\$\/\.test\(c\)\)\) popAppMenu\(\);/);
  // developer tools only in a development copy
  assert.match(main, /app\.isPackaged \? null : \{ role: 'toggleDevTools' \}/);
  // Linux: the system's own bar instead, for window managers that need it
  assert.match(main, /const CUSTOM_BAR = !\(IS_LINUX && settings\.systemTitleBar === true\);/);
  assert.match(main, /IS_LINUX \? \{ label: 'Use the system title bar \(after a restart\)', type: 'checkbox'/);
});

test('desktop titlebar: the strip is plain, safe, accessible and packaged', () => {
  const html = read('desktop', 'titlebar.html');
  const js = read('desktop', 'titlebar.js');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'"/);
  assert.match(html, /<script src="titlebar\.js"><\/script>/);
  assert.doesNotMatch(html + js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(js, /getElementById\('name'\)\.textContent = name/, 'the name is text');
  assert.match(html, /aria-label="Cindrly menu" aria-haspopup="menu"/);
  assert.match(html, /background: #100e16/);
  assert.match(html, /-webkit-app-region: drag/);
  assert.match(html, /\.brand \{[^}]*-webkit-app-region: no-drag/);
  assert.match(html, /env\(titlebar-area-width, 100vw\)/, 'nothing under the system buttons');
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /forced-colors: active/);
  assert.match(html, /:focus-visible/);
  const pkg = JSON.parse(read('desktop', 'package.json'));
  for (const f of ['titlebar.html', 'titlebar.js', 'titlebar-preload.js', 'build/icon.png']) assert.ok(pkg.build.files.includes(f), `${f} is packaged`);
  assert.equal(pkg.build.productName, 'Hearth', 'internal names stay');
});

// ------------------------------------------------------------------ the real app
function findElectron() {
  const env = process.env.HEARTH_ELECTRON;
  if (env) return fs.existsSync(env) ? env : null;
  try { const bin = require(require.resolve('electron', { paths: [DESKTOP] })); return typeof bin === 'string' && fs.existsSync(bin) ? bin : null; } catch { return null; }
}
const ELECTRON = findElectron();
const NEEDS_XVFB = process.platform === 'linux' && !process.env.DISPLAY;
const has = (cmd) => !spawnSync(cmd, ['--help'], { stdio: 'ignore' }).error;
const electronSkip = !ELECTRON ? 'Electron is not installed (npm install in desktop/, or set HEARTH_ELECTRON)'
  : NEEDS_XVFB && !has('xvfb-run') ? 'no display and no xvfb-run' : false;
// A window manager to click the real buttons with (only on a display of our own).
const WITH_WM = NEEDS_XVFB && has('openbox') && has('xdotool');

async function runApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-bar-'));
  try {
    const appDir = path.join(tmp, 'app');
    fs.cpSync(DESKTOP, appDir, { recursive: true, filter: (src) => !/[\\/](node_modules|dist)$/.test(src) });
    const cfg = JSON.parse(fs.readFileSync(path.join(appDir, 'hearth.config.json'), 'utf8'));
    fs.writeFileSync(path.join(appDir, 'hearth.config.json'), JSON.stringify({ ...cfg, defaultServer: '', lockServer: false, autoUpdate: false }));
    const ud = path.join(tmp, 'userdata');
    fs.mkdirSync(ud);
    // a normal-sized window (not filling the screen), so dragging and maximizing show
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ bounds: { x: 90, y: 50, width: 1100, height: 700 }, trayHintShown: true }));
    const args = [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), '-r', path.join(__dirname, 'titlebar-harness.js'), appDir];
    const [cmd, argv] = !NEEDS_XVFB ? [ELECTRON, args]
      : WITH_WM ? ['xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', 'sh', '-c', 'openbox >/dev/null 2>&1 & sleep 1; exec "$@"', 'sh', ELECTRON, ...args]]
        : ['xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', ELECTRON, ...args]];
    const env = { ...process.env, HEARTH_UD: ud, HEARTH_WM: WITH_WM ? '1' : '' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS; // Electron refuses some Node options (--use-openssl-ca)
    const output = await new Promise((resolve) => {
      const child = spawn(cmd, argv, { detached: true, env });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
      const kill = setTimeout(() => { stop(); resolve(text); }, 150000);
      child.on('exit', () => { clearTimeout(kill); setTimeout(() => { stop(); resolve(text); }, 500); });
    });
    const line = output.split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, `no result from Electron:\n${output.slice(-3000)}`);
    return JSON.parse(line.slice(7));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('desktop titlebar: in Electron, the strip sits above the page, the system buttons work, and the page gets nothing new', { skip: electronSkip, timeout: 180000 }, async () => {
  const r = await runApp();
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.connect && r.onServer, true, 'connected to the fake server');
  // no system frame or menu bar: a BaseWindow with two views, the strip on top
  assert.equal(r.isBrowserWindow, false);
  assert.equal(r.views, 2);
  assert.equal(r.barUrl, 'titlebar.html');
  assert.equal(r.menuBarVisible, false);
  assert.equal(r.title, 'general · Fake Cindrly', 'the window keeps the page title (taskbar, Alt+Tab)');
  // the page starts right below the strip and is never covered
  const n = r.normal;
  assert.deepEqual(n.bar, { x: 0, y: 0, width: n.content[0], height: 32 });
  assert.deepEqual(n.page, { x: 0, y: 32, width: n.content[0], height: n.content[1] - 32 });
  assert.deepEqual(n.inner, [n.content[0], n.content[1] - 32]);
  assert.equal(r.cornerClick === true || /^no xdotool/.test(r.cornerClick), true, 'a click in the page\'s top-right corner reaches the page');
  // the strip: dark, named, a labelled menu button, drags the window
  assert.equal(r.barPixel, '#100e16');
  assert.equal(r.barText, 'Cindrly');
  assert.deepEqual(r.barButton, { label: 'Cindrly menu', popup: 'menu', drag: 'drag', btnDrag: 'no-drag' });
  // the system's buttons are on the strip (it has the overlay); the page doesn't even see them
  assert.equal(r.wcoBar.visible, true);
  assert.ok(r.wcoBar.rect.width > 0 && r.wcoBar.rect.width < n.content[0], 'room left for the system buttons');
  assert.equal(r.wcoPage.visible, false);
  assert.equal(r.wcoPage.rect.width, 0);
  // the server's page: the same bridge as before, nothing to move / minimize / close the window with
  assert.equal(r.pageHasTitlebarBridge, false);
  for (const k of r.pageBridge) assert.doesNotMatch(k, /minimi[sz]e|maximi[sz]e|close|titlebar|window/i, k);
  assert.equal(r.pageAppRegion, 'no-drag', 'the page can\'t make itself a drag handle');
  // the menu: from the strip's button (and a lone Alt), never from the page
  assert.equal(r.menuFromPage, 0, 'a menu request from the server\'s page is ignored');
  assert.deepEqual(r.menuFromBar, [{ x: 8, y: 32 }]);
  assert.equal(r.ariaExpandedAfter, 'false');
  assert.equal(r.altMenu, 1, 'Alt on its own opens the menu');
  assert.equal(r.altShiftMenu, 0, 'Alt+Shift doesn\'t');
  // zooming the app zooms the page only
  assert.equal(r.zoom.page, 1.5);
  assert.equal(r.zoom.bar, 1);
  assert.equal(r.zoom.barInnerHeight, 32);
  // full screen: no strip, the page fills the screen; then back
  assert.equal(r.fullscreen.barVisible, false);
  assert.equal(r.fullscreen.page.y, 0);
  assert.equal(r.fullscreen.inner[1], r.fullscreen.page.height);
  assert.deepEqual(r.afterFullscreen.page, n.page);
  assert.equal(r.afterFullscreen.barVisible, true);
  // closing with "keep running in the tray" on hides; with it off the app quits and the pages close
  assert.deepEqual(r.closeToTray, { visible: false, destroyed: false });
  assert.equal(r.quitOnClose, true);
  assert.equal(r.pagesClosed, true);
  if (r.wm) {
    // the real buttons and the strip, with a window manager
    assert.equal(r.wm.copied, true, 'Ctrl+C copies from the page');
    assert.equal(r.wm.reloaded, true, 'Ctrl+R reloads the page');
    assert.ok(r.wm.dragged[0] > 20 && r.wm.dragged[1] > 10, `dragging the strip moves the window (${r.wm.dragged})`);
    assert.equal(r.wm.maximized, true, 'the maximize button');
    assert.deepEqual(r.wm.maxGeometry.page, { x: 0, y: 32, width: r.wm.maxGeometry.content[0], height: r.wm.maxGeometry.content[1] - 32 });
    assert.match(r.wm.maxState, /maximized/);
    assert.equal(r.wm.restored, true, 'the same button restores');
    assert.equal(r.wm.doubleClickMaximized, true, 'double-clicking the strip maximizes');
    assert.equal(r.wm.minimized, true, 'the minimize button');
    assert.equal(r.wm.closedToTray, true, 'the close button keeps it in the tray');
  }
});
