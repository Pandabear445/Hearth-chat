// Drives the real desktop app in Electron for desktop-titlebar.test.js: `electron -r test/titlebar-harness.js <copy of
// desktop/>`. This file runs first, then main.js. Checks the window's own title bar: no system frame, the strip
// drawn above the server's page (never over it), the system's buttons on the strip, the server's page getting
// nothing new, full screen, zoom and closing to the tray. With a window manager and xdotool (HEARTH_WM=1) it also
// clicks the real minimize / maximize / close buttons and drags the window by the strip. HEARTH_SHOTS=<folder>
// saves screenshots of the whole screen there. Prints one line: RESULT {...}.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { app, shell, dialog, BaseWindow, ipcMain, Menu, clipboard } = require('electron');

app.setPath('userData', process.env.HEARTH_UD);
shell.openExternal = async () => {};
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const done = (code) => { console.log(`RESULT ${JSON.stringify(out)}`); app.exit(code); };
setTimeout(() => { out.error = out.error || 'timed out'; done(1); }, 110000);
async function until(fn, ms = 15000) {
  const t = Date.now();
  for (;;) {
    try { const v = await Promise.race([fn(), sleep(1000).then(() => null)]); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t > ms) return null;
    await sleep(100);
  }
}
const WM = process.env.HEARTH_WM === '1';
const SHOTS = process.env.HEARTH_SHOTS || '';
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString();
const xdo = (...args) => sh('xdotool', args.map(String));
function shot(name) {
  if (!SHOTS) return;
  try { fs.mkdirSync(SHOTS, { recursive: true }); sh('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); (out.shots = out.shots || []).push(`${name}.png`); } catch (e) { out.shotError = String(e.message || e); }
}

// A server page with its own header across the top and a button in its top-right corner (where the system's
// buttons would sit if the strip were drawn over the page).
const PAGE = `<!doctype html><html><head><title>general · Fake Cindrly</title><style>
body{margin:0;background:#0d0c13;color:#ede9f5;font:14px system-ui,sans-serif;display:grid;grid-template-columns:72px 240px 1fr;height:100vh}
.rail{background:#0b0a10;display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:12px}
.rail i{width:48px;height:48px;border-radius:16px;background:#221e2e;display:block}.rail i:first-child{background:#f2a541}
.side{background:#14121b;padding:12px}.side b{display:block;height:36px;border-bottom:1px solid #222;margin:-12px -12px 12px;padding:10px 12px;font-size:15px}
.side span{display:block;padding:6px 8px;border-radius:6px;color:#b6afc6}.side span.on{background:#221e2e;color:#fff}
main{display:flex;flex-direction:column}header{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #222;font-weight:600}
header button{margin-left:auto;width:32px;height:32px;border:0;border-radius:8px;background:#221e2e;color:#fff}
.msgs{flex:1;padding:16px;color:#b6afc6}
</style></head><body><nav class="rail"><i></i><i></i><i></i><i></i></nav>
<div class="side"><b>Fake Cindrly</b><span># welcome</span><span class="on"># general</span><span># games</span><span>🔊 Lounge</span></div>
<main><header># general <button id="corner" aria-label="Members">≡</button></header><div class="msgs">Messages go here.</div></main>
<script>document.getElementById('corner').addEventListener('click', () => navigator.sendBeacon('/corner', '1'));</script></body></html>`;
let cornerClicks = 0;
let loads = 0;
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/config') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"name":"Fake Cindrly"}'); }
  if (url === '/corner') { cornerClicks++; res.writeHead(204); return res.end(); }
  loads++;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

(async () => {
  await app.whenReady();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = process.env.HEARTH_SERVER_URL || `http://127.0.0.1:${server.address().port}`;
  const main = () => BaseWindow.getAllWindows().find((x) => !x.getParentWindow());
  await until(() => main() && main().contentView.children.length === 2 && main().isVisible(), 20000);
  const w = main();
  const [pageView, barView] = w.contentView.children;
  const page = pageView.webContents;
  const bar = barView.webContents;
  const js = (wc, code) => wc.executeJavaScript(code, true);
  out.isBrowserWindow = typeof w.webContents !== 'undefined';
  out.views = w.contentView.children.length;
  out.barUrl = path.basename(new URL(bar.getURL()).pathname);
  out.menuBarVisible = w.isMenuBarVisible();
  await until(() => js(page, "document.readyState === 'complete'"), 10000);
  await sleep(400);
  shot('03-connect-screen');

  // On the server
  out.connect = !!(await js(page, `window.hearthDesktop.connect(${JSON.stringify(origin)})`)).ok;
  out.onServer = !!(await until(() => page.getURL().startsWith(origin) && js(page, "document.readyState === 'complete'"), 20000));
  await sleep(600);
  out.title = w.getTitle();

  // Layout: the strip on top, the page right below it, nothing on top of each other
  const geometry = async () => {
    const cb = w.getContentBounds();
    const inner = await js(page, '[innerWidth, innerHeight]');
    return { content: [cb.width, cb.height], bar: barView.getBounds(), barVisible: barView.getVisible(), page: pageView.getBounds(), inner };
  };
  out.normal = await geometry();
  out.barText = (await js(bar, 'document.body.innerText')).trim();
  out.barButton = await js(bar, "(() => { const b = document.getElementById('brand'); return { label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), drag: getComputedStyle(document.body).webkitAppRegion, btnDrag: getComputedStyle(b).webkitAppRegion }; })()");
  out.wcoBar = await js(bar, 'navigator.windowControlsOverlay ? { visible: navigator.windowControlsOverlay.visible, rect: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON() } : null');
  out.wcoPage = await js(page, 'navigator.windowControlsOverlay ? { visible: navigator.windowControlsOverlay.visible, rect: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON() } : null');
  out.pageBridge = await js(page, 'Object.keys(window.hearthDesktop)');
  out.pageHasTitlebarBridge = await js(page, 'typeof window.hearthTitlebar !== "undefined"');
  out.pageAppRegion = await js(page, "getComputedStyle(document.querySelector('header')).webkitAppRegion");
  const img = await bar.capturePage();
  const sz = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  const px = (x, y) => { const i = (Math.round(y) * sz.width + Math.round(x)) * 4; return `#${[bmp[i + 2], bmp[i + 1], bmp[i]].map((v) => v.toString(16).padStart(2, '0')).join('')}`; };
  out.barPixel = px(sz.width * 0.45, sz.height / 2);

  // Only the strip's own page can open the menu: a message from the server's page is ignored
  const menu = Menu.getApplicationMenu();
  const realPopup = menu.popup.bind(menu);
  const pops = [];
  menu.popup = (o = {}) => { pops.push({ x: o.x, y: o.y }); if (o.callback) setTimeout(o.callback, 10); };
  ipcMain.emit('titlebar:menu', { sender: page, senderFrame: page.mainFrame });
  out.menuFromPage = pops.length;
  await js(bar, "document.getElementById('brand').click(); 1");
  await until(() => pops.length > 0, 3000);
  out.menuFromBar = pops.slice();
  out.ariaExpandedAfter = await until(() => js(bar, "document.getElementById('brand').getAttribute('aria-expanded') === 'false' ? 'false' : null"), 3000);
  // a lone Alt press opens it too; Alt+Shift doesn't
  page.focus();
  const before = pops.length;
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' }); page.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' });
  await sleep(300);
  out.altMenu = pops.length - before;
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' }); page.sendInputEvent({ type: 'keyDown', keyCode: 'Shift', modifiers: ['alt', 'shift'] });
  page.sendInputEvent({ type: 'keyUp', keyCode: 'Shift', modifiers: ['alt'] }); page.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' });
  await sleep(300);
  out.altShiftMenu = pops.length - before - out.altMenu;
  menu.popup = realPopup;

  // Zooming the app (Settings → Apps & devices) zooms the page, never the strip
  await js(page, "window.hearthDesktop.setDesktopSetting('zoom', 1.5)");
  await sleep(300);
  out.zoom = { page: page.getZoomFactor(), bar: bar.getZoomFactor(), barInnerHeight: await js(bar, 'innerHeight') };
  await js(page, "window.hearthDesktop.setDesktopSetting('zoom', 1)");
  await sleep(200);

  // Full screen: no strip, the page fills the screen; back to normal after
  w.setFullScreen(true);
  await until(() => w.isFullScreen(), 5000);
  await sleep(700);
  out.fullscreen = await geometry();
  out.fullscreenState = await js(bar, "document.body.className");
  w.setFullScreen(false);
  await until(() => !w.isFullScreen(), 5000);
  await sleep(700);
  out.afterFullscreen = await geometry();

  // A click at the page's top-right corner reaches the page (the system's buttons are on the strip, not there)
  const screenPoint = (x, y) => { const cb = w.getContentBounds(); return [cb.x + x, cb.y + y]; };
  try {
    const [cx, cy] = screenPoint(out.normal.content[0] - 30, 32 + 24);
    xdo('mousemove', cx, cy, 'click', 1);
    out.cornerClick = !!(await until(async () => cornerClicks > 0, 3000));
  } catch (e) { out.cornerClick = `no xdotool: ${e.message}`; }
  await sleep(300);
  shot('01-window');

  // The real menu, opened from the Cindrly button
  try {
    const [bx, by] = screenPoint(40, 16);
    xdo('mousemove', bx, by, 'click', 1);
    await sleep(700);
    shot('04-menu-open');
    xdo('key', 'Escape');
    await sleep(300);
  } catch { /* no xdotool */ }

  if (WM) {
    // The system's own buttons, at the right end of the strip (the space the overlay rect leaves free)
    const area = out.wcoBar && out.wcoBar.rect;
    const span = out.normal.content[0] - (area.x + area.width); // how wide the buttons are together
    const buttons = (i) => {
      const cb = w.getContentBounds();
      const left = cb.width - span;
      const each = span / 3;
      return screenPoint(left + each * (i + 0.5), 16);
    };
    const press = (i) => { const [x, y] = buttons(i); xdo('mousemove', x, y, 'click', 1); };
    out.wm = {};
    // The menu's keys reach the page in its view: Ctrl+C copies from it, Ctrl+R reloads it
    w.focus(); page.focus();
    await sleep(300);
    await js(page, "getSelection().selectAllChildren(document.querySelector('.msgs')); 1");
    xdo('key', 'ctrl+c');
    out.wm.copied = await until(async () => (String(await clipboard.readText()).trim() === 'Messages go here.' ? true : null), 3000);
    const loadsBefore = loads;
    xdo('key', 'ctrl+r');
    out.wm.reloaded = !!(await until(async () => loads > loadsBefore, 4000));
    await until(() => js(page, "document.readyState === 'complete'"), 5000);
    // drag by the strip
    const b0 = w.getBounds();
    const [dx, dy] = screenPoint(400, 16);
    xdo('mousemove', dx, dy, 'mousedown', 1);
    await sleep(150);
    for (let i = 1; i <= 8; i++) { xdo('mousemove', dx + i * 10, dy + i * 5); await sleep(40); }
    xdo('mouseup', 1);
    await sleep(500);
    const b1 = w.getBounds();
    out.wm.dragged = [b1.x - b0.x, b1.y - b0.y];
    // maximize, restore (the same button), minimize
    press(1);
    out.wm.maximized = !!(await until(async () => w.isMaximized(), 4000));
    await sleep(600);
    out.wm.maxGeometry = await geometry();
    out.wm.maxState = await js(bar, 'document.body.className');
    shot('02-maximized');
    press(1);
    out.wm.restored = !!(await until(async () => !w.isMaximized(), 4000));
    await sleep(500);
    if (w.isMaximized()) { w.unmaximize(); await sleep(500); }
    // double-click on the strip
    const [qx, qy] = screenPoint(400, 16);
    xdo('mousemove', qx, qy, 'click', '--repeat', 2, '--delay', 80, 1);
    out.wm.doubleClickMaximized = !!(await until(async () => w.isMaximized(), 2500));
    if (w.isMaximized()) { w.unmaximize(); await sleep(500); }
    // (the 'minimize' event: under Xvfb the window manager never reports the window as minimized)
    let minimized = false;
    w.once('minimize', () => { minimized = true; });
    press(0);
    out.wm.minimized = !!(await until(async () => minimized || w.isMinimized(), 4000));
    w.restore(); w.focus();
    await sleep(600);
    // the close button with "keep running in the tray" on: hidden, not closed
    await js(page, "window.hearthDesktop.setDesktopSetting('closeToTray', true)");
    press(2);
    out.wm.closedToTray = !!(await until(async () => !w.isVisible(), 4000)) && !w.isDestroyed();
    w.show(); w.focus();
    await sleep(500);
  }

  // Closing (the system button, Alt+F4 and win.close() all come here) with "keep running in the tray" on
  await js(page, "window.hearthDesktop.setDesktopSetting('closeToTray', true)");
  w.close();
  await sleep(500);
  out.closeToTray = { visible: w.isVisible(), destroyed: w.isDestroyed() };
  w.show();
  await sleep(300);

  // ...and off (Linux's default): the window really closes and the app quits
  await js(page, "window.hearthDesktop.setDesktopSetting('closeToTray', false)");
  app.removeAllListeners('will-quit');
  app.once('will-quit', (e) => { e.preventDefault(); out.quitOnClose = true; setTimeout(() => { out.pagesClosed = page.isDestroyed() && bar.isDestroyed(); done(0); }, 300); });
  if (WM) { const cb = w.getContentBounds(); const span = out.normal.content[0] - (out.wcoBar.rect.x + out.wcoBar.rect.width); xdo('mousemove', cb.x + cb.width - span / 6, cb.y + 16, 'click', 1); } else w.close();
  await sleep(4000);
  out.quitOnClose = false;
  done(0);
})().catch((e) => { out.error = String((e && e.stack) || e); done(1); });
