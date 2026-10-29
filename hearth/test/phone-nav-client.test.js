// Phone navigation (public/js/phone-nav.js): Back closes what's open instead of leaving Hearth, without leaving steps
// behind in the history and never on a desktop; swipes from the left edge work the drawer and close the side panel.
// Run against small stand-ins for the browser's history and touch events (test/e2e has the real thing on a phone).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let N;
before(async () => { N = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'phone-nav.js')).href); });
const tick = () => new Promise((r) => setImmediate(r));

// A window with a session history like a browser's: pushState drops the entries ahead, back() lands a moment later
// with a popstate, and following a #link adds an entry at a new address.
function browser({ active = true, state = null } = {}) {
  const listeners = {};
  const entries = [{ state, url: 'https://chat.example.test/' }];
  let at = 0;
  const fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }));
  const go = (d) => { if (at + d < 0 || at + d >= entries.length) return; at += d; fire('popstate'); };
  const win = {
    navigator: { userActivation: { hasBeenActive: active } },
    location: { get href() { return entries[at].url; }, get hash() { return new URL(entries[at].url).hash; } },
    history: {
      get state() { return entries[at].state; },
      get length() { return entries.length; },
      pushState(st, _t, url) { entries.splice(at + 1); entries.push({ state: structuredClone(st), url: url ? new URL(url, entries[at].url).href : entries[at].url }); at++; },
      replaceState(st, _t, url) { entries[at] = { state: structuredClone(st), url: url ? new URL(url, entries[at].url).href : entries[at].url }; },
      back() { setImmediate(() => go(-1)); },
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  return {
    win, entries, fire,
    at: () => at,
    // The person pressing Back or Forward (the gesture, or Android's back button).
    back: async () => { go(-1); await tick(); },
    forward: async () => { go(1); await tick(); },
    // A link opened in place (a tapped notification): a new entry at the #address, then a popstate.
    link: async (hash) => { entries.splice(at + 1); entries.push({ state: null, url: entries[at].url.split('#')[0] + hash }); at++; fire('popstate'); await tick(); },
  };
}
// Things that can be open, top-most first, like app.js's drawer, panel and dialogs.
function layers(...names) {
  const open = new Set();
  const list = names.map((name) => ({ name, open: () => open.has(name), close: () => open.delete(name) }));
  return { list, open, show: (n) => open.add(n), hide: (n) => open.delete(n) };
}
const ours = (b) => !!(b.win.history.state && b.win.history.state.hearthBack);

test('a desktop adds nothing to the history, and Back there closes nothing', async () => {
  const b = browser();
  const L = layers('dialog', 'panel', 'drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => false });
  L.show('panel'); s.sync();
  L.show('dialog'); s.sync();
  b.fire('pointerup'); b.fire('keydown');
  assert.equal(b.entries.length, 1);
  assert.equal(ours(b), false);
  await b.link('#c/123');
  await b.back();
  assert.deepEqual([...L.open].sort(), ['dialog', 'panel'], 'popstate on a desktop leaves the panel and dialog alone');
});

test('on a phone, Back closes the open drawer and stays at the same address', async () => {
  const b = browser();
  const L = layers('dialog', 'panel', 'drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('drawer'); s.sync();
  assert.equal(b.entries.length, 2, 'opening adds one step');
  assert.equal(ours(b), true);
  assert.equal(b.win.location.href, 'https://chat.example.test/', 'at the same address');
  s.sync(); s.sync();
  assert.equal(b.entries.length, 2, 'only one step while it stays open');
  await b.back();
  assert.equal(L.open.size, 0, 'Back closed the drawer');
  assert.equal(b.at(), 0);
  assert.equal(b.entries.length, 2, 'nothing new added after closing');
});

test('Back closes the top one first, and the step comes back while others stay open', async () => {
  const b = browser();
  const L = layers('dialog', 'panel', 'drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('drawer'); s.sync();
  L.show('dialog'); s.sync();
  assert.equal(b.entries.length, 2, 'one step for everything open');
  await b.back();
  assert.deepEqual([...L.open], ['drawer'], 'the dialog on top closed, the drawer under it stayed');
  assert.equal(ours(b), true, 'a step again for the drawer');
  await b.back();
  assert.equal(L.open.size, 0);
  assert.equal(ours(b), false);
  assert.equal(b.at(), 0, 'and the page is back where it started: the next Back leaves Hearth as before');
});

test('closing with its own button takes the step back out, so the history never grows', async () => {
  const b = browser();
  const L = layers('viewer', 'panel', 'drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  for (let i = 0; i < 5; i++) {
    for (const name of ['drawer', 'panel', 'viewer']) {
      L.show(name); s.sync();
      assert.equal(ours(b), true);
      L.hide(name); s.sync();
      await tick();
      assert.equal(ours(b), false, `closing the ${name} by its button went back off the step`);
      assert.equal(b.at(), 0);
    }
  }
  assert.ok(b.entries.length <= 2, `the history stays at its size (${b.entries.length} entries)`);
});

test('one closing as another opens (Back or Next between dialogs) keeps the step', async () => {
  const b = browser();
  const L = layers('second', 'first');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('first'); s.sync();
  L.hide('first'); L.show('second'); s.sync();
  await tick();
  assert.equal(ours(b), true);
  assert.equal(b.entries.length, 2);
  // Closed by its button while our own Back is on its way, then opened again: a step once it has landed.
  L.hide('second'); s.sync();
  L.show('first'); s.sync();
  await tick();
  assert.equal(ours(b), true, 'the step is back once the earlier Back landed');
  await b.back();
  assert.equal(L.open.size, 0);
});

test('a dialog that cannot be dismissed keeps its step: Back stays in Hearth', async () => {
  const b = browser();
  const s = N.backStack({ win: b.win, layers: [{ open: () => true, close: () => {} }], enabled: () => true });
  s.sync();
  await b.back();
  assert.equal(ours(b), true, 'the step is put back');
  assert.equal(b.entries.length, 2);
});

test('no step before the page has been used; the first tap or key adds it', () => {
  const b = browser({ active: false });
  const L = layers('dialog');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('dialog'); s.sync();
  assert.equal(b.entries.length, 1, 'browsers skip steps added before anyone used the page');
  b.win.navigator.userActivation.hasBeenActive = true;
  b.fire('pointerup');
  assert.equal(ours(b), true);
});

test('a link followed while something is open is not taken for Back, and gets no step at its #address', async () => {
  const b = browser();
  const L = layers('dialog', 'drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('dialog'); s.sync();
  await b.link('#c/42');
  assert.deepEqual([...L.open], ['dialog'], 'the dialog stays open');
  s.sync();
  assert.equal(ours(b), false, 'no step on top of the #address while the link waits to be followed');
  assert.equal(b.entries.length, 3);
  // app.js follows it: the address loses its #part (replaceState), and then a step can go on top again.
  b.win.history.replaceState(null, '', '/');
  s.sync();
  assert.equal(ours(b), true);
});

test('Forward onto an old step, or a step left from before a reload, is not left in place', async () => {
  const b = browser();
  const L = layers('drawer');
  const s = N.backStack({ win: b.win, layers: L.list, enabled: () => true });
  L.show('drawer'); s.sync();
  await b.back();
  assert.equal(L.open.size, 0);
  await b.forward();
  await tick();
  assert.equal(ours(b), false, 'landing on our old step with nothing open goes back off it');

  const r = browser({ state: { hearthBack: true, other: 1 } });
  N.backStack({ win: r.win, layers: [], enabled: () => true });
  assert.deepEqual(r.win.history.state, { other: 1 }, 'a reloaded page keeps the rest of its state, without our mark');
});

// ------------------------------------------------------------------ swipes
// A document, a two-part drawer (rail + channels, 72 + 256 wide), a scrim and a full-screen side panel.
function screen({ enabled = true, noDrawer = false } = {}) {
  const listeners = {};
  const el = (w) => ({ style: {}, offsetWidth: w, contains(t) { return t === this; } });
  const rail = el(72); const side = el(256); const scrim = el(390); const panelEl = el(390); const chat = el(390);
  const classes = new Set();
  const doc = {
    body: { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) } },
    documentElement: { classList: { contains: () => true } }, // reduced motion: the panel closes without its slide
    addEventListener(type, fn) { (listeners[type] = listeners[type] || new Set()).add(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type].delete(fn); },
  };
  const state = { drawer: false, panel: false, enabled, blocked: false };
  const sw = N.edgeSwipes({
    win: { document: doc, innerWidth: 390 },
    enabled: () => state.enabled,
    blocked: () => state.blocked,
    drawer: noDrawer ? null : { isOpen: () => state.drawer, parts: () => [rail, side], scrim: () => scrim, setOpen: (on) => { state.drawer = on; } },
    panel: { isOpen: () => state.panel, el: () => panelEl, close: () => { state.panel = false; } },
  });
  let ts = 0; let x = 0; let y = 0; let target = chat;
  const send = (type, gap = 16) => {
    const touch = { identifier: 1, clientX: x, clientY: y };
    const e = { type, target, timeStamp: (ts += gap), cancelable: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch], prevented: false, preventDefault() { this.prevented = true; } };
    (listeners[type] || []).forEach((fn) => fn(e));
    return e;
  };
  const finger = {
    down(x0, y0, on = chat) { x = x0; y = y0; target = on; send('touchstart'); return finger; },
    // To (x1, y1) in 8 moves, 16 ms apart; wait: ms before the first one (a long press).
    move(x1, y1, { wait = 16 } = {}) {
      const x0 = x; const y0 = y; const out = [];
      for (let i = 1; i <= 8; i++) { x = x0 + ((x1 - x0) * i) / 8; y = y0 + ((y1 - y0) * i) / 8; out.push(send('touchmove', i === 1 ? wait : 16)); }
      finger.moves = out;
      return finger;
    },
    up() { send('touchend'); return finger; },
  };
  const swipe = (x0, y0, x1, y1, opts = {}) => finger.down(x0, y0, opts.on).move(x1, y1, opts).up();
  return { sw, state, finger, swipe, rail, side, scrim, panelEl, classes, listeners };
}

test('a swipe from the left edge opens the drawer, following the finger', () => {
  const s = screen();
  const f = s.finger.down(10, 300).move(150, 304);
  assert.ok(f.moves.every((m) => m.prevented), 'the page takes the swipe (no scrolling, no browser Back)');
  assert.ok(s.classes.has('nav-swiping'));
  const shift = (el) => Number(/^translateX\((-?[\d.]+)px\)$/.exec(el.style.transform)[1]);
  assert.ok(shift(s.rail) < -150 && shift(s.rail) > -250, `the drawer is part of the way out (${s.rail.style.transform})`);
  assert.equal(s.rail.style.transform, s.side.style.transform, 'both parts move together');
  assert.ok(Number(s.scrim.style.opacity) > 0.3 && Number(s.scrim.style.opacity) < 0.6, 'the chat dims as it comes out');
  f.move(300, 306).up();
  assert.equal(s.state.drawer, true);
  assert.equal(s.rail.style.transform, '', 'the stylesheet takes over again once the finger lifts');
  assert.equal(s.scrim.style.opacity, '');
  assert.ok(!s.classes.has('nav-swiping'));
});

test('swipes the drawer leaves alone: away from the edge, up and down, leftwards, after a long press, with a dialog open', () => {
  const s = screen();
  s.swipe(120, 300, 380, 300);
  assert.equal(s.state.drawer, false, 'one starting in the middle of the chat');
  s.swipe(10, 300, 20, 600);
  assert.equal(s.state.drawer, false, 'scrolling up and down from the edge');
  assert.ok(s.finger.moves.every((m) => !m.prevented), 'the scroll goes ahead');
  s.swipe(20, 300, 0, 300);
  assert.equal(s.state.drawer, false, 'leftwards');
  s.swipe(10, 300, 300, 300, { wait: 700 });
  assert.equal(s.state.drawer, false, 'a long press, then a drag (selecting text)');
  s.state.blocked = true;
  s.swipe(10, 300, 300, 300);
  assert.equal(s.state.drawer, false, 'a dialog or picture covers the screen');
  assert.ok(s.finger.moves.every((m) => !m.prevented));
});

test('let go early it springs back, unless it was a quick flick', () => {
  const s = screen();
  s.finger.down(10, 300).move(60, 300).move(50, 300).up();
  assert.equal(s.state.drawer, false, 'a short, slow pull');
  s.swipe(10, 300, 130, 300);
  assert.equal(s.state.drawer, true, 'the same distance, quickly');
});

test('swiping left on the open drawer, or on the dimmed chat beside it, closes it', () => {
  const s = screen();
  s.state.drawer = true;
  s.swipe(300, 300, 270, 300, { on: s.side });
  assert.equal(s.state.drawer, true, 'a small slow nudge leaves it open');
  s.swipe(300, 300, 40, 300, { on: s.side });
  assert.equal(s.state.drawer, false);
  s.state.drawer = true;
  s.swipe(370, 300, 100, 300, { on: s.scrim });
  assert.equal(s.state.drawer, false, 'from the dimmed chat');
  s.state.drawer = true;
  s.swipe(300, 300, 380, 300, { on: s.side });
  assert.equal(s.state.drawer, true, 'rightwards on an open drawer does nothing');
});

test('with the side panel open, the edge swipe closes the panel instead', () => {
  const s = screen();
  s.state.panel = true;
  const f = s.finger.down(8, 300).move(140, 300);
  assert.equal(s.panelEl.style.transform, 'translateX(132px)', 'the panel follows the finger');
  assert.ok(f.moves.every((m) => m.prevented));
  f.move(330, 300).up();
  assert.equal(s.state.panel, false);
  assert.equal(s.state.drawer, false, 'and the drawer stays shut');
  assert.equal(s.panelEl.style.transform, '');
  s.state.panel = true;
  s.finger.down(8, 300).move(40, 300).move(30, 300).up();
  assert.equal(s.state.panel, true, 'a short pull leaves it open');
});

test('the swipes only listen in the phone layout on a touch screen', () => {
  const s = screen({ enabled: false });
  assert.equal((s.listeners.touchmove || new Set()).size, 0, 'no touch listeners at all otherwise');
  s.swipe(10, 300, 300, 300);
  assert.equal(s.state.drawer, false);
  s.state.enabled = true; s.sw.update();
  assert.equal(s.listeners.touchmove.size, 1);
  s.swipe(10, 300, 300, 300);
  assert.equal(s.state.drawer, true);
  s.state.enabled = false; s.sw.update();
  assert.equal(s.listeners.touchmove.size, 0, 'and they go again (a window made wider)');
});

test('no drawer: an edge swipe with nothing open does nothing; with the panel open it closes', () => {
  const s = screen({ noDrawer: true });
  const f = s.finger.down(10, 300).move(300, 304);
  assert.ok(f.moves.every((m) => !m.prevented), 'nothing to pull out: the browser keeps the swipe');
  assert.ok(!s.classes.has('nav-swiping') && !s.classes.has('panel-swiping'));
  f.up();
  assert.equal(s.state.drawer, false);
  s.swipe(300, 300, 40, 300, { on: s.side });
  assert.ok(!s.classes.has('nav-swiping'), 'a left swipe anywhere is left alone too');
  s.state.panel = true;
  const g = s.finger.down(8, 300).move(140, 300);
  assert.equal(s.panelEl.style.transform, 'translateX(132px)', 'the panel (or the conversation) follows the finger');
  assert.ok(g.moves.every((m) => m.prevented));
  g.move(330, 300).up();
  assert.equal(s.state.panel, false, 'and goes');
  assert.equal(s.panelEl.style.transform, '');
});
