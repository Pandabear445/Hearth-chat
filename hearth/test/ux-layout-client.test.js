// The 1.44 responsive-layout work (public/css/ux-layout.css, js/viewport.js, the side panel in app.js): nothing
// covers anything and nothing is out of reach at any size. The behaviour itself is checked in a browser
// (test/e2e/ux-layout.mjs, test/a11y/checks-ux-layout.mjs); these are the rules it rests on, so a later edit that
// quietly undoes one fails here first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const css = read('css/ux-layout.css');
const app = read('js/app.js');
// A rule's declarations, by its exact selector, wherever it is in the sheet (inside a media query or not).
const rule = (sheet, sel) => {
  const at = sheet.indexOf(`${sel} {`);
  assert.ok(at >= 0, `no rule for ${sel}`);
  return sheet.slice(at, sheet.indexOf('}', at));
};
// The media query a rule sits in ('' at the top level).
const mediaOf = (sheet, sel) => {
  const at = sheet.indexOf(`${sel} {`);
  const open = sheet.lastIndexOf('@media', at);
  if (open < 0) return '';
  // Still inside it when its braces haven't closed before the rule.
  let depth = 0;
  for (let i = sheet.indexOf('{', open); i < at; i++) { if (sheet[i] === '{') depth++; else if (sheet[i] === '}') depth--; }
  return depth > 0 ? sheet.slice(open, sheet.indexOf('{', open)).trim() : '';
};

// A stand-in for the browser's window and visual viewport: what trackViewport reads and listens to.
function fakeWindow({ innerHeight = 800, vvHeight = 800 } = {}) {
  const listeners = { win: {}, vv: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const off = (bag) => (type, fn) => { bag[type] = (bag[type] || []).filter((f) => f !== fn); };
  const props = {};
  const classes = new Set();
  const win = {
    innerHeight, scrollY: 0,
    visualViewport: { height: vvHeight, scale: 1, offsetTop: 0, addEventListener: on(listeners.vv), removeEventListener: off(listeners.vv) },
    addEventListener: on(listeners.win), removeEventListener: off(listeners.win),
    // (Run at once; returning 0 leaves trackViewport free to queue the next one, as a real frame having run would.)
    requestAnimationFrame: (fn) => { fn(); return 0; },
    scrollTo() {},
    document: { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } },
  };
  return { win, props, classes, listeners, fire: (where, type) => (listeners[where][type] || []).forEach((f) => f()) };
}

test('viewport.js always writes --app-h in px, never 100% (a percentage there is no limit at all)', async () => {
  const src = read('js/viewport.js');
  assert.ok(!/'100%'/.test(src), 'viewport.js still writes 100%');
  const { trackViewport } = await import(pathToFileURL(path.join(PUBLIC, 'js/viewport.js')).href);
  const f = fakeWindow({ innerHeight: 390, vvHeight: 390 });
  const stop = trackViewport(f.win);
  assert.equal(f.props['--app-h'], '390px');
  assert.ok(!f.classes.has('kb-open'));
  // The keyboard comes up: the visible part.
  f.win.visualViewport.height = 200; f.fire('vv', 'resize');
  assert.equal(f.props['--app-h'], '200px');
  assert.ok(f.classes.has('kb-open'));
  // Turned sideways with no keyboard: the window's own resize is enough.
  f.win.visualViewport.height = 844; f.win.innerHeight = 844; f.fire('win', 'orientationchange');
  assert.equal(f.props['--app-h'], '844px');
  f.win.visualViewport.height = 700; f.win.innerHeight = 700; f.fire('win', 'resize');
  assert.equal(f.props['--app-h'], '700px');
  stop();
  assert.ok(!(f.listeners.win.resize || []).length && !(f.listeners.win.orientationchange || []).length, 'stop() lets go of the window too');
});

test('phone dialogs fit a short screen: the backdrop scrolls and the dialog is capped by the visible height', () => {
  assert.match(rule(css, 'body.m-ui .modal-backdrop'), /overflow-y:\s*auto/);
  assert.match(rule(css, 'body.m-ui .modal:not(.modal-full):not(.modal-search):not(.modal-lightbox)'), /max-height:\s*calc\(min\(var\(--app-h, 100dvh\), 100dvh\)/);
  // The body scrolls between a pinned head and foot.
  assert.match(rule(css, '.modal-body'), /min-height:\s*0/);
  assert.match(rule(css, '.modal-head, .modal-foot'), /flex:\s*none/);
});

test('the ringing card sits at the top right under the header on a computer or tablet', () => {
  const r = rule(css, 'body:not(.m-ui) .ring-card');
  assert.match(r, /top:\s*calc\(var\(--head-h\)/);
  assert.match(r, /bottom:\s*auto/);
  assert.match(mediaOf(css, 'body:not(.m-ui) .ring-card'), /min-width:\s*761px/);
});

test('a file card\'s size line wraps between its pieces, never inside one', () => {
  assert.match(rule(css, '.att-size'), /flex-wrap:\s*wrap/);
  assert.match(rule(css, '.att-sz, .att-kind, .att-enc'), /white-space:\s*nowrap/);
  assert.match(app, /h\('span', \{ class: 'att-sz' \}, fmtSize\(/);
  // On a phone its Download button is an icon named for the file.
  assert.match(app, /'aria-label': `Download \$\{f\.name \|\| 'file'\}`/);
  assert.match(rule(css, 'body.m-ui .att-file > .btn'), /width:\s*44px/);
});

test('phones: the Chat | Reels row hides while typing, and the message box stays under a third of the screen', () => {
  assert.match(rule(css, 'html.kb-open body.m-ui .conv-tabs'), /display:\s*none/);
  assert.match(rule(css, 'body.m-ui .composer textarea'), /max-height:\s*min\(260px, 30dvh\)/);
});

test('short conversations sit at the bottom, and .messages is still what scrolls', () => {
  assert.match(rule(css, '.messages'), /flex-direction:\s*column/);
  assert.match(rule(css, '.messages::before'), /flex:\s*1 0 0/);
  // Children never shrink (a long conversation scrolls rather than squeezing them).
  assert.match(rule(css, '.messages > *'), /flex:\s*none/);
  const base = read('css/app.css');
  assert.match(rule(base, '.messages'), /overflow-y:\s*auto/);
  assert.match(rule(base, '.messages'), /overflow-anchor:\s*none/);
});

test('the side panel on laptops and tablets docks between header and composer, and closes from outside', () => {
  assert.match(rule(css, 'body:not(.m-ui) #members.docked'), /top:\s*calc\(var\(--dock-t/);
  assert.match(mediaOf(css, 'body:not(.m-ui) #members.docked'), /max-width:\s*1240px/);
  assert.match(app, /function dockPanel\(\)/);
  assert.match(app, /class: 'panel-scrim'/);
  // Esc, after everything globalKeys does first.
  assert.match(app, /e\.key !== 'Escape' \|\| e\.defaultPrevented/);
  // A Back arrow where it takes the conversation's whole place.
  assert.match(app, /'Back to the conversation'/);
});

test('touch targets: small sidebar and header buttons answer a 40px touch; phones get 44px', () => {
  assert.match(mediaOf(css, '#sidebar .icon-btn.sm::before, .invite-nudge-x::before, .head-badge::before'), /pointer:\s*coarse/);
  assert.match(rule(css, '#sidebar .icon-btn.sm::before, .invite-nudge-x::before, .head-badge::before'), /max\(100%, 40px\)/);
  assert.match(rule(css, 'body.m-ui .conv-tab'), /min-height:\s*44px/);
});

test('phones: white initials on every avatar colour read at 4.5:1 on the darkened tile', () => {
  // The tile colours (util.js hashColor) and the shade over them (ux-layout.css), worked out as the browser paints them.
  const hues = JSON.parse(/const hues = (\[[^\]]+\]);/.exec(read('js/util.js'))[1]);
  const [, s, l] = /`hsl\(\$\{hues\[h % hues\.length\]\} (\d+)% (\d+)%\)`/.exec(read('js/util.js')).map(Number);
  const shade = Number(/body\.m-ui \.av-inner:has\(> \.av-initials\) \{ box-shadow: inset 0 0 0 999px rgb\(0 0 0 \/ ([\d.]+)\); \}/.exec(css)[1]);
  const rgb = (h) => { const a = (s / 100) * Math.min(l / 100, 1 - l / 100); const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
  const lum = (c) => c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const h of hues) {
    const ratio = 1.05 / (lum(rgb(h).map((v) => v * (1 - shade))) + 0.05);
    assert.ok(ratio >= 4.5, `hue ${h}: ${ratio.toFixed(2)}:1`);
  }
});
