// Phone navigation: the back gesture closes what's open, and swipes from the screen's edge work the drawer.
// Back runs in the phone layout and on touch screens, the swipes in the phone layout on a touch screen (device.js);
// app.js (phoneNav) says what the drawer, side panel, sheets and dialogs are. It is the one place Hearth adds history
// steps of its own for these.

// ------------------------------------------------------------------ Back closes what's open
// On a phone the drawer, the side panel, a picture, a message's actions or a dialog covers the screen, and the back
// gesture (or the Android app's back button, which goes back in the page's history) is how people close it. So while
// one is open, the page's history has one extra step of Hearth's own, at the same address: going back from it closes
// the one on top (and the step comes back while more are open). Closing one with its own button takes the step back
// out, so the history never fills up with them and the next Back still leaves the app. Nothing is added while
// enabled() is false (desktops).
//   layers: [{ open: () => bool, close: () => void }], the top-most first.
// Call sync() whenever one may have opened or closed.
export function backStack({ win = window, layers, enabled }) {
  const hist = win.history;
  const ours = () => !!(hist.state && hist.state.hearthBack);
  const top = () => layers.find((l) => l.open());
  // Browsers skip history steps a page added before anyone used it, so the first one waits for a tap or a key.
  const used = () => { const u = win.navigator && win.navigator.userActivation; return !u || u.hasBeenActive; };
  // A step left over from before a reload: going back from it would load the page again, so it becomes an ordinary one.
  if (ours()) { const { hearthBack, ...rest } = hist.state; hist.replaceState(Object.keys(rest).length ? rest : null, ''); }
  let leaving = false; // our own history.back() is on its way
  let onStep = false; // the page was on a step of ours (as of the last look)
  let url = win.location.href; // and at this address
  const look = () => { onStep = ours(); url = win.location.href; };
  function sync() {
    look();
    if (leaving || (!onStep && !enabled())) return;
    const open = !!top();
    if (open && !onStep) {
      // Not before the first tap (above), nor while a link (#c/…) waits for app.js to follow it: it replaces the
      // address of the entry it arrived in, which mustn't be our step.
      if (!used() || win.location.hash) return;
      const st = hist.state && typeof hist.state === 'object' ? hist.state : {};
      hist.pushState({ ...st, hearthBack: true }, '');
      look();
    } else if (!open && onStep) {
      leaving = true;
      hist.back();
    }
  }
  win.addEventListener('popstate', () => {
    // Back from our step lands at the same address. A different one is a link being followed (#c/…, a tapped
    // notification), which app.js handles; what it opens or closes calls sync() as usual.
    const fromStep = onStep && win.location.href === url;
    look();
    if (leaving) leaving = false;
    else if (fromStep) { const t = top(); if (t) t.close(); }
    sync();
  });
  // A dialog that opened before the first tap gets its step with the first tap.
  win.addEventListener('pointerup', () => sync(), true);
  win.addEventListener('keydown', () => sync(), true);
  return { sync };
}

// ------------------------------------------------------------------ swipes from the edge
// Swipe right from the left edge of the screen and the drawer (servers and channels) slides out under the finger;
// swipe left on the open drawer, or on the dimmed chat beside it, to put it away. While the side panel is open (it
// covers the screen on a phone), the same swipe from the left edge closes the panel instead, like Back. Taps, scrolling
// up and down, and swipes that start anywhere else are left alone, so nothing else in the app changes.
//   drawer: { isOpen(), parts() (the elements that slide), scrim(), setOpen(bool) }, or null when there's none (the
//           phone layout's list and conversation stack: the swipe from the edge only takes a panel, or the
//           conversation, away)
//   panel:  { isOpen(), el(), close() }
//   blocked(): true while something covers both (a dialog, a picture)
// Listens only while enabled() (call update() when that may have changed): a touch listener that can stop scrolling
// makes the browser wait for the page, which desktops with a touch screen shouldn't pay for.
export const EDGE = 28; // px from the left edge where an opening swipe may start
export function edgeSwipes({ win = window, enabled, blocked, drawer, panel }) {
  const doc = win.document;
  let g = null; // the touch under way: { kind: 'open' | 'close' | 'panel', x, y, t, id, on, dx, v, w }
  const reduced = () => doc.documentElement.classList.contains('reduce-motion') || (typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const inDrawer = (target) => !!drawer && [...drawer.parts(), drawer.scrim()].some((el) => el && el.contains(target));

  function start(e) {
    g = null;
    if (e.touches.length !== 1 || blocked()) return;
    const t = e.touches[0];
    let kind = null;
    if (drawer && drawer.isOpen()) kind = inDrawer(e.target) ? 'close' : null;
    else if (t.clientX <= EDGE) kind = panel.isOpen() ? 'panel' : drawer ? 'open' : null;
    if (kind) g = { kind, x: t.clientX, y: t.clientY, t: e.timeStamp, lx: t.clientX, lt: e.timeStamp, id: t.identifier, on: false, dx: 0, v: 0, w: 0 };
  }
  function move(e) {
    if (!g) return;
    if (e.touches.length !== 1) return finish(false);
    const t = [...e.changedTouches].find((x) => x.identifier === g.id);
    if (!t) return;
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      // Sideways, the right way, and soon after the finger went down (not a long press); otherwise it's a scroll or a
      // text selection, and this touch is left alone.
      const way = g.kind === 'close' ? -1 : 1;
      if (Math.abs(dy) >= Math.abs(dx) || dx * way <= 0 || !e.cancelable || e.timeStamp - g.t > 500) { g = null; return; }
      g.on = true;
      g.w = g.kind === 'panel' ? (panel.el().offsetWidth || win.innerWidth) : drawer.parts().reduce((n, el) => n + el.offsetWidth, 0) || 1;
      // (css/app.css: no slide animation while the finger moves it, and the dimmed backdrop behind the drawer.)
      doc.body.classList.add(g.kind === 'panel' ? 'panel-swiping' : 'nav-swiping');
    }
    e.preventDefault();
    const dt = e.timeStamp - g.lt;
    if (dt > 0) g.v = 0.6 * ((t.clientX - g.lx) / dt) + 0.4 * g.v; // px per ms, smoothed
    g.lx = t.clientX; g.lt = e.timeStamp; g.dx = dx;
    follow();
  }
  // How much of the drawer the finger has pulled out (0 to 1).
  const shown = (s) => clamp(s.kind === 'open' ? s.dx / s.w : 1 + s.dx / s.w);
  function follow() {
    if (g.kind === 'panel') { panel.el().style.transform = `translateX(${Math.max(0, g.dx)}px)`; return; }
    const p = shown(g);
    // Closed, the drawer sits a little further left than its own width (its rounded edge and shadow too).
    for (const el of drawer.parts()) el.style.transform = `translateX(${-(1 - p) * (g.w + 16)}px)`;
    const s = drawer.scrim();
    if (s) s.style.opacity = String(p);
  }
  // done: the finger lifted (false: the touch was cancelled, which leaves things as they were).
  function finish(done) {
    const was = g;
    g = null;
    if (!was || !was.on) return;
    doc.body.classList.remove('panel-swiping', 'nav-swiping');
    const fling = Math.abs(was.v) > 0.4; // a quick flick counts whatever the distance
    if (was.kind === 'panel') {
      const el = panel.el();
      const close = done && (fling ? was.v > 0 : was.dx > was.w * 0.35);
      if (!close || reduced()) { el.style.transform = ''; if (close) panel.close(); return; }
      el.style.transition = 'transform .16s ease';
      el.style.transform = 'translateX(100%)';
      setTimeout(() => { el.style.transition = ''; el.style.transform = ''; panel.close(); }, 160);
      return;
    }
    const open = !done ? was.kind === 'close' : fling ? was.v > 0 : shown(was) > 0.5;
    // Lets go of the inline position in the same frame as the class changes, so the drawer slides on from where the
    // finger left it.
    for (const el of drawer.parts()) el.style.transform = '';
    const s = drawer.scrim();
    if (s) s.style.opacity = '';
    drawer.setOpen(open);
  }
  const end = (e) => { if (g && [...e.changedTouches].some((t) => t.identifier === g.id)) finish(e.type === 'touchend'); };

  let on = false;
  const opts = { passive: false };
  function update() {
    const want = !!enabled();
    if (want === on) return;
    on = want;
    const fn = want ? 'addEventListener' : 'removeEventListener';
    doc[fn]('touchstart', start, { passive: true });
    doc[fn]('touchmove', move, opts);
    doc[fn]('touchend', end, { passive: true });
    doc[fn]('touchcancel', end, { passive: true });
    if (!want && g) finish(false);
  }
  update();
  return { update };
}
