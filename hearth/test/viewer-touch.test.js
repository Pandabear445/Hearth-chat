// Pictures on phones and touch screens. The viewer's finger gestures (public/js/viewer-touch.js): where a zoom or a
// move leaves the picture. The two kinds of screen (public/js/device.js), which app.css uses word for word. The
// modules run here as they are (no browser); test/e2e flows.mjs phonePictures drives the real thing on a phone.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const js = (name) => pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href;
let V;
let D;
before(async () => { V = await import(js('viewer-touch.js')); D = await import(js('device.js')); });

// A 4:3 picture across a phone's stage (390×792), centred, and the screen point a point of it is drawn at.
const box = { left: 0, top: 249.75, width: 390, height: 292.5 };
const room = { width: 390, height: 792 };
const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
const drawnAt = (v, q) => ({ x: centre.x + v.tx + v.scale * q.x, y: centre.y + v.ty + v.scale * q.y });
const pictureAt = (v, p) => ({ x: (p.x - centre.x - v.tx) / v.scale, y: (p.y - centre.y - v.ty) / v.scale });
const close = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`); };
const FIT = { scale: 1, tx: 0, ty: 0 };

test('zooming keeps the point under the fingers where it was, or takes it where the fingers went', () => {
  const at = { x: 97.5, y: 337.5 };
  const q = pictureAt(FIT, at);
  const v = V.zoomAround(FIT, V.DOUBLE_TAP_ZOOM, at, box);
  assert.equal(v.scale, 2);
  const p = drawnAt(v, q);
  close(p.x, at.x, 'x'); close(p.y, at.y, 'y');
  // A pinch whose fingers also moved: the point follows them.
  const from = { scale: 1.5, tx: 20, ty: -10 };
  const r = pictureAt(from, { x: 200, y: 400 });
  const w = V.zoomAround(from, 3, { x: 200, y: 400 }, box, { x: 230, y: 380 });
  const s = drawnAt(w, r);
  close(s.x, 230, 'x'); close(s.y, 380, 'y');
});

test('zoom stays between 1x and 6x, and at 1x the picture is centred', () => {
  assert.equal(V.ZOOM_MAX, 6);
  assert.deepEqual(V.clampView({ scale: 9, tx: 0, ty: 0 }, box, room).scale, 6);
  assert.deepEqual(V.clampView({ scale: 0.4, tx: 50, ty: -80 }, box, room), FIT);
  assert.deepEqual(V.clampView({ scale: 1, tx: 120, ty: 30 }, box, room), FIT);
});

test('a zoomed picture can be moved, but never so far that it can be lost off screen', () => {
  for (const scale of [1.2, 2, 3.5, 6]) {
    for (const [tx, ty] of [[0, 0], [5000, 5000], [-5000, -5000], [5000, -5000], [37, -12]]) {
      const v = V.clampView({ scale, tx, ty }, box, room);
      const w = box.width * scale; const h = box.height * scale;
      const left = centre.x + v.tx - w / 2; const top = centre.y + v.ty - h / 2;
      // Wider than the stage: it covers it from side to side (no empty edge).
      if (w >= room.width) assert.ok(left <= 1e-6 && left + w >= room.width - 1e-6, `${scale}x ${tx},${ty}: ${left}…${left + w}`);
      // Shorter than the stage: it stays wholly inside; taller: it covers it.
      if (h <= room.height) assert.ok(top >= -1e-6 && top + h <= room.height + 1e-6, `${scale}x ${tx},${ty}: ${top}…${top + h}`);
      else assert.ok(top <= 1e-6 && top + h >= room.height - 1e-6, `${scale}x ${tx},${ty}: ${top}…${top + h}`);
    }
  }
  // A move well inside the limits is left as it is.
  assert.deepEqual(V.clampView({ scale: 2, tx: 37, ty: -12 }, box, room), { scale: 2, tx: 37, ty: -12 });
});

test('the two kinds of screen are the agreed media queries, asked of the browser as they are', () => {
  assert.equal(D.PHONE_LAYOUT, '(max-width: 760px), (pointer: coarse) and (max-height: 500px)');
  assert.equal(D.TOUCH_UI, '(pointer: coarse)');
  // Without a browser (no matchMedia) neither is true.
  assert.equal(D.isPhoneLayout(), false);
  assert.equal(D.isTouchUI(), false);
});

test('app.css asks the same questions: every rule for touch screens uses one of the two, or both', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  const allowed = new Set([D.TOUCH_UI, D.PHONE_LAYOUT, `${D.PHONE_LAYOUT}, ${D.TOUCH_UI}`]);
  const coarse = [...css.matchAll(/@media\s+([^{]+)\{/g)].map((m) => m[1].trim()).filter((q) => /pointer:\s*coarse/.test(q));
  assert.ok(coarse.length >= 3, 'the pictures and the viewer have rules for both');
  for (const q of coarse) assert.ok(allowed.has(q), `@media ${q}`);
});

test('what is sent and stored stays the same: 480 px thumbnails, pictures up to 2560 px', () => {
  const media = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media.js'), 'utf8');
  assert.match(media, /^const THUMB_SIDE = 480;$/m);
  assert.match(media, /^const MAX_SIDE = 2560;$/m);
});

// With a browser's matchMedia, the answers follow it (a phone turned sideways, say).
test('the answers follow the browser, and a change is passed on', (t) => {
  const listeners = new Map();
  const state = { [D.PHONE_LAYOUT]: true, [D.TOUCH_UI]: false };
  globalThis.matchMedia = (q) => ({
    get matches() { return !!state[q]; },
    addEventListener: (type, fn) => { listeners.set(q, fn); },
    removeEventListener: (type, fn) => { if (listeners.get(q) === fn) listeners.delete(q); },
  });
  t.after(() => { delete globalThis.matchMedia; });
  assert.equal(D.isPhoneLayout(), true);
  assert.equal(D.isTouchUI(), false);
  let calls = 0;
  const stop = D.onDeviceChange(() => { calls++; });
  assert.deepEqual([...listeners.keys()].sort(), [D.PHONE_LAYOUT, D.TOUCH_UI].sort());
  state[D.TOUCH_UI] = true;
  listeners.get(D.TOUCH_UI)();
  assert.equal(calls, 1);
  assert.equal(D.isTouchUI(), true);
  stop();
  assert.equal(listeners.size, 0);
});
