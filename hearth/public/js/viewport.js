// Keeps the app inside the part of the screen you can actually see. On phones the on-screen keyboard
// covers the bottom of the page without resizing it (iOS Safari, and Chrome unless the page opts in),
// which hid the message box while typing. visualViewport says how much is really visible; the app's
// height follows it (--app-h), and html.kb-open is set while the keyboard is up.
// --app-h is always a length in px, never a percentage: dialogs and sheets size themselves against it
// (max-height: calc(var(--app-h) - …)), and a percentage there means "of a box with no set height", which is
// no limit at all, so a tall dialog ran off a short screen (a phone held sideways, a desktop zoomed to 200%).

export function trackViewport(win = window) {
  const vv = win.visualViewport;
  const root = win.document.documentElement;
  if (!vv) return () => {};
  let frame = 0;
  let last = '';
  const apply = () => {
    frame = 0;
    // Pinch-zoom shrinks the visual viewport too; scaling back up leaves only the keyboard's share.
    const visible = Math.round(vv.height * (vv.scale || 1));
    const full = win.innerHeight;
    const keyboard = full - visible > 120;
    const h = `${keyboard ? visible : full}px`;
    // Only touch the page when something changed: every write restyles the whole app.
    if (h !== last) {
      last = h;
      root.style.setProperty('--app-h', h);
      root.classList.toggle('kb-open', keyboard);
    }
    // iOS scrolls the whole page up to show the focused box; with the app already resized, undo that
    // so the header doesn't slide off the top.
    if (keyboard && (vv.offsetTop || win.scrollY)) win.scrollTo(0, 0);
  };
  const queue = () => { if (!frame) frame = win.requestAnimationFrame(apply); };
  vv.addEventListener('resize', queue);
  vv.addEventListener('scroll', queue);
  // The window's own height changes too, with no keyboard involved (turning the phone, resizing the window, the
  // browser's toolbar showing or hiding), and the visual viewport doesn't always say so.
  win.addEventListener('resize', queue);
  win.addEventListener('orientationchange', queue);
  apply();
  return () => {
    vv.removeEventListener('resize', queue); vv.removeEventListener('scroll', queue);
    win.removeEventListener('resize', queue); win.removeEventListener('orientationchange', queue);
  };
}
