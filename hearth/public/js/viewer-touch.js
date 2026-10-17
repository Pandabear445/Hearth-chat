// Finger gestures for the picture viewer. app.js openViewer turns them on for touch screens (device.js TOUCH_UI):
//  - pinching zooms between 1x and 6x around the fingers, and moving both fingers moves the picture along;
//  - a double tap zooms to 2x around the tapped point, and the next one goes back to the whole picture;
//  - one finger moves a zoomed picture, never so far that it can be lost off screen;
//  - not zoomed, a swipe left or right shows the next or previous picture and a swipe down closes the viewer, the
//    picture following the finger on the way (it stays put with reduced motion);
//  - a tap on the dark backdrop closes it, like a click, once it's clear the tap wasn't the start of a double tap.
// A mouse on the same screen keeps the desktop ways (wheel, double-click, drag), which openViewer handles.

export const ZOOM_MAX = 6;
export const DOUBLE_TAP_ZOOM = 2;
const TAP_SLOP = 10; // px a finger may wander and still make a tap
const TAP_MS = 500; // longer is a press, not a tap
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40; // px between the two taps of a double tap
const SLIDE_MS = 180;

// The geometry: `box` is where the picture sits in the stage before any zoom ({ left, top, width, height }), `room`
// the stage's size ({ width, height }), and a view is { scale, tx, ty }, drawn as translate(tx, ty) scale(scale)
// around the picture's centre. Points are in the stage's own coordinates.

// The view zoomed to `scale` so the point of the picture under `at` ends up under `to` (where it was, unless the
// fingers moved too).
export function zoomAround(v, scale, at, box, to = at) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const qx = (at.x - cx - v.tx) / v.scale;
  const qy = (at.y - cy - v.ty) / v.scale;
  return { scale, tx: to.x - cx - scale * qx, ty: to.y - cy - scale * qy };
}

// The view kept between 1x and 6x and moved back as far as needed so the picture can't be lost: along a side where
// it's bigger than the stage it keeps covering it (no empty edge), where it's smaller it stays wholly inside. At 1x
// it's centred.
export function clampView(v, box, room) {
  const scale = Math.min(ZOOM_MAX, Math.max(1, v.scale));
  if (scale === 1) return { scale, tx: 0, ty: 0 };
  const axis = (t, start, size, space) => {
    const centre = start + size / 2;
    const half = (size * scale) / 2;
    const a = half - centre; // its near edge on the stage's near edge
    const b = space - half - centre; // its far edge on the stage's far edge
    return Math.min(Math.max(t, Math.min(a, b)), Math.max(a, b));
  };
  return { scale, tx: axis(v.tx, box.left, box.width, room.width), ty: axis(v.ty, box.top, box.height, room.height) };
}

// o: { stage, img, bar, backdrop (the element whose dark background fades on a swipe down), view() and
// setView(v) (the viewer's zoom and position), step(±1) (next or previous picture), count() (how many there are),
// close(), busy() (true when a touch should only close a menu that was open) }.
// Returns touchedRecently(): browsers make clicks and double-clicks out of taps, which the viewer then ignores.
export function touchGestures(o) {
  const { stage, img } = o;
  const fingers = new Map(); // pointerId -> where it is now
  let g = null; // the gesture under way
  let lastTap = null; // a tap that may be the first of a double tap
  let tapTimer = 0;
  let easeTimer = 0;
  let sliding = false;
  let lastTouch = -Infinity;
  let fadeFrom = null; // the backdrop's colour before a swipe down started fading it

  const now = () => performance.now();
  const reduced = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const geometry = () => ({
    box: { left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight },
    room: { width: stage.clientWidth, height: stage.clientHeight },
  });
  const point = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const two = () => [...fingers.values()].slice(0, 2);
  const middle = () => { const [a, b] = two(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const spread = () => { const [a, b] = two(); return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  // Draws the picture moved by a swipe, without changing the view.
  const draw = (x, y) => { img.style.transform = `translate(${x}px, ${y}px) scale(1)`; };
  // Runs fn with a short transition on the picture (none with reduced motion: app.css turns transitions off).
  const ease = (fn) => {
    stage.classList.add('easing');
    fn();
    clearTimeout(easeTimer);
    easeTimer = setTimeout(() => stage.classList.remove('easing'), SLIDE_MS + 40);
  };
  // The backdrop fading as a swipe down goes (0: as it was, 1: gone).
  const fade = (p) => {
    if (!p) { o.backdrop.style.backgroundColor = ''; o.bar.style.opacity = ''; fadeFrom = null; return; }
    if (!fadeFrom) {
      const [r = 0, gr = 0, b = 0, a = 1] = (getComputedStyle(o.backdrop).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      fadeFrom = { r, gr, b, a };
    }
    o.backdrop.style.backgroundColor = `rgba(${fadeFrom.r}, ${fadeFrom.gr}, ${fadeFrom.b}, ${fadeFrom.a * (1 - p)})`;
    o.bar.style.opacity = String(Math.max(0, 1 - 2 * p));
  };
  // How fast the finger was going at the end (px per ms), from the last tenth of a second.
  const speed = (track) => {
    const end = track[track.length - 1];
    const start = track.find((s) => end.t - s.t <= 100) || end;
    const dt = end.t - start.t;
    return dt > 0 ? { x: (end.x - start.x) / dt, y: (end.y - start.y) / dt } : { x: 0, y: 0 };
  };

  const toggleZoom = (p) => {
    const v = o.view();
    const { box, room } = geometry();
    ease(() => o.setView(v.scale > 1.01 ? { scale: 1, tx: 0, ty: 0 } : clampView(zoomAround(v, DOUBLE_TAP_ZOOM, p, box), box, room)));
  };
  const tapped = (p, onBackdrop) => {
    if (lastTap && now() - lastTap.at < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_SLOP) {
      clearTimeout(tapTimer);
      lastTap = null;
      toggleZoom(p);
      return;
    }
    lastTap = { at: now(), x: p.x, y: p.y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { lastTap = null; if (onBackdrop && stage.isConnected && o.view().scale <= 1) o.close(); }, DOUBLE_TAP_MS);
  };
  const swiped = (dx, vx) => {
    const { room } = geometry();
    const far = Math.abs(dx) > Math.min(90, room.width * 0.22) || (Math.abs(vx) > 0.5 && Math.abs(dx) > 30);
    if (o.count() < 2 || !far) { ease(() => o.setView(o.view())); return; }
    const dir = dx < 0 ? 1 : -1; // to the left: the next one
    if (reduced()) { o.step(dir); return; }
    // The picture carries on off the side, and the next one slides in from the other.
    sliding = true;
    ease(() => draw(-dir * room.width, 0));
    setTimeout(() => {
      stage.classList.remove('easing');
      o.step(dir);
      draw(dir * room.width * 0.4, 0);
      void img.offsetWidth; // (start the slide from there)
      ease(() => o.setView(o.view()));
      sliding = false;
    }, SLIDE_MS);
  };
  const swipedDown = (dy, vy) => {
    const { room } = geometry();
    if (dy > Math.min(140, room.height * 0.18) || (vy > 0.5 && dy > 40)) {
      if (!reduced()) ease(() => draw(0, room.height * 0.6));
      o.close();
      return;
    }
    fade(0);
    ease(() => o.setView(o.view()));
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    lastTouch = now();
    try { stage.setPointerCapture(e.pointerId); } catch { /* the finger is already gone */ }
    fingers.set(e.pointerId, point(e));
    stage.classList.add('touching');
    if (fingers.size === 1) {
      // The touch that closes an open menu, or one during a slide, does nothing else.
      if (sliding || (o.busy && o.busy())) { g = { kind: 'none' }; return; }
      g = { kind: 'tap', start: point(e), at: now(), view: o.view(), onBackdrop: e.target === stage, track: [] };
    } else if (fingers.size === 2 && g && g.kind !== 'none') {
      if (g.kind === 'swipe-x' || g.kind === 'swipe-down') { fade(0); o.setView(o.view()); }
      g = { kind: 'pinch', view: o.view(), mid: middle(), spread: spread() };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    lastTouch = now();
    const p = point(e);
    fingers.set(e.pointerId, p);
    if (!g || g.kind === 'none') return;
    if (g.kind === 'pinch') {
      if (fingers.size < 2) return;
      const { box, room } = geometry();
      const scale = Math.min(ZOOM_MAX, Math.max(1, (g.view.scale * spread()) / g.spread));
      o.setView(clampView(zoomAround(g.view, scale, g.mid, box, middle()), box, room));
      return;
    }
    if (fingers.size !== 1) return;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (g.kind === 'tap') {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      if (g.view.scale > 1) g.kind = 'pan';
      else if (Math.abs(dx) > Math.abs(dy)) g.kind = 'swipe-x';
      else g.kind = dy > 0 ? 'swipe-down' : 'none';
    }
    g.track.push({ t: now(), x: p.x, y: p.y });
    if (g.track.length > 20) g.track.shift();
    if (g.kind === 'pan') {
      const { box, room } = geometry();
      o.setView(clampView({ scale: g.view.scale, tx: g.view.tx + dx, ty: g.view.ty + dy }, box, room));
    } else if (g.kind === 'swipe-x') {
      // With nothing to go to, it gives a little and comes back.
      if (!reduced()) draw(o.count() > 1 ? dx : dx / 4, 0);
    } else if (g.kind === 'swipe-down' && !reduced()) {
      const down = Math.max(0, dy);
      draw(0, down);
      fade(Math.min(0.85, down / Math.max(1, stage.clientHeight * 0.6)));
    }
  });
  const lift = (e) => {
    if (!fingers.has(e.pointerId)) return;
    lastTouch = now();
    const p = point(e);
    fingers.delete(e.pointerId);
    if (fingers.size) {
      // One finger of a pinch lifted: the other carries on moving the picture (if it's zoomed).
      if (g && g.kind === 'pinch') { const [rest] = fingers.values(); g = { kind: o.view().scale > 1 ? 'pan' : 'none', start: { ...rest }, view: o.view(), track: [] }; }
      return;
    }
    stage.classList.remove('touching');
    const done = g;
    g = null;
    if (!done || done.kind === 'none') return;
    const cancelled = e.type === 'pointercancel';
    if (done.kind === 'tap') { if (!cancelled && now() - done.at < TAP_MS) tapped(p, done.onBackdrop); return; }
    if (done.kind === 'pinch' || done.kind === 'pan') {
      // Let go at barely more than 1x: back to the whole picture.
      if (o.view().scale < 1.05) ease(() => o.setView({ scale: 1, tx: 0, ty: 0 }));
      return;
    }
    const v = done.track.length ? speed(done.track) : { x: 0, y: 0 };
    if (done.kind === 'swipe-x') { if (cancelled) ease(() => o.setView(o.view())); else swiped(p.x - done.start.x, v.x); }
    else if (done.kind === 'swipe-down') { if (cancelled) { fade(0); ease(() => o.setView(o.view())); } else swipedDown(p.y - done.start.y, v.y); }
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  // Safari's own pinch events would zoom the page.
  stage.addEventListener('gesturestart', (e) => e.preventDefault());

  return { touchedRecently: () => now() - lastTouch < 800 };
}
