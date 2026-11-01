// Settings, appearance and accessibility (1.44): text size up to 150%, the System theme, accents that stay readable
// on dark themes, the panel-opacity floor, named accent swatches, and Settings as a list of pages on a phone. The
// parts that are plain logic run here (appearance.js loads in Node); the rest is checked in the source, and in a real
// browser by test/a11y/checks-ux-settings.mjs and test/e2e/ux-settings.mjs.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
function fnSource(text, name) {
  const start = text.search(new RegExp(`^(export )?(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `function ${name}`);
  return text.slice(start, text.indexOf('\n}\n', start) + 2);
}
let A;
before(async () => { A = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'appearance.js')).href); });

// The WCAG ratio, worked out separately from appearance.js's own.
function ratio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Each dark theme's --s1, --s2 and --elev, read from app.css: the accent's text and ring must read on all of them.
function panels(theme) {
  const css = read('public', 'css', 'app.css');
  const at = css.indexOf(theme === 'dark' ? "\n:root, [data-theme='dark'] {" : `\n[data-theme='${theme}'] {`);
  const block = css.slice(at, css.indexOf('\n}', at));
  return ['s1', 's2', 'elev'].map((k) => {
    const m = new RegExp(`--${k}: (\\d+) (\\d+) (\\d+);`).exec(block);
    assert.ok(m, `${theme} --${k}`);
    return `#${m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  });
}

test('text size: the slider and the page both go from 85% to 150%', () => {
  assert.equal(A.SCALE_MIN, 85);
  assert.equal(A.SCALE_MAX, 150);
  const ap = read('public', 'js', 'appearance.js');
  assert.match(ap, /root\.style\.fontSize = `\$\{Math\.min\(SCALE_MAX, Math\.max\(SCALE_MIN, \+a\.scale \|\| 100\)\)\}%`/);
  assert.match(read('public', 'js', 'settings.js'), /sliderRow\('Text size', SCALE_MIN, SCALE_MAX, 5, a\.scale/);
  // (Every text size in app.css is in rem since 1.44, so the root size reaches all of it; the iPhone no-zoom rule stays.)
  const css = read('public', 'css', 'app.css');
  assert.doesNotMatch(css.replace(/@media[^{]*\{/g, ''), /font-size:\s*\d+(\.\d+)?px/);
  assert.match(css, /max\(16px, 1em\)/);
});

test('the System theme: there, the default, Light or Dark like the device, and the page says it can be either', () => {
  assert.equal(A.THEMES[0].id, 'system');
  assert.equal(A.DEFAULTS.theme, 'system');
  // In Node there's no device preference: dark, as before.
  assert.equal(A.resolveTheme('system'), 'dark');
  assert.equal(A.resolveTheme('light'), 'light');
  assert.equal(A.resolveTheme('nonsense'), 'dark');
  const ap = read('public', 'js', 'appearance.js');
  assert.match(ap, /matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(ap, /darkQuery\.addEventListener\('change', \(\) => \{ if \(loadAppearance\(\)\.theme === 'system'\) applyAppearance\(\); \}\)/);
  assert.match(fnSource(ap, 'applyAppearance'), /const theme = resolveTheme\(a\.theme\);\n {2}root\.dataset\.theme = theme;/);
  assert.match(read('public', 'index.html'), /<meta name="color-scheme" content="dark light">/);
});

test('panel opacity: never below 60%, and an older look saved lower comes up to it', () => {
  assert.equal(A.GLASS_MIN, 0.6);
  const ap = read('public', 'js', 'appearance.js');
  assert.doesNotMatch(ap, /0\.35/, 'the old 35% floor is gone');
  assert.match(fnSource(ap, 'loadAppearance'), /if \(typeof a\.glass !== 'number' \|\| a\.glass < GLASS_MIN\) a\.glass = /);
  const s = read('public', 'js', 'settings.js');
  assert.match(s, /sliderRow\('Panel opacity', Math\.round\(GLASS_MIN \* 100\), 100,/);
  assert.match(s, /Lower opacity can make text hard to read on this background\./);
  // In the browser the floor holds for what was stored (loadAppearance reads localStorage).
  const store = new Map([['hearth.appearance', JSON.stringify({ glass: 0.35 })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try { assert.equal(A.loadAppearance().glass, 0.6); } finally { delete globalThis.localStorage; }
});

test('a dark accent gets a lighter shade for links (4.5:1) and the focus ring (3:1) on every dark theme, and only then', () => {
  for (const theme of ['dark', 'midnight', 'dim', 'ember']) {
    const bg = panels(theme);
    for (const accent of ['#2a3f9e', '#000000', '#5a1010', '#123456', '#7f00ff']) {
      const r = A.readableAccent(accent, theme);
      const ink = r.ink || accent;
      const focus = r.focus || accent;
      for (const b of bg) {
        assert.ok(ratio(ink, b) >= 4.5, `${theme} ${accent}: link ${ink} on ${b} is ${ratio(ink, b).toFixed(2)}:1`);
        assert.ok(ratio(focus, b) >= 3, `${theme} ${accent}: ring ${focus} on ${b} is ${ratio(focus, b).toFixed(2)}:1`);
      }
    }
    // The default and the bright swatches are left as they are.
    for (const accent of ['#f2a541', '#ff7ab6', '#3fcf83', '#c4e05a']) assert.deepEqual(A.readableAccent(accent, theme), { ink: null, focus: null, adjusted: false }, `${theme} ${accent}`);
  }
  // The light theme darkens its own ink in app.css.
  assert.deepEqual(A.readableAccent('#2a3f9e', 'light'), { ink: null, focus: null, adjusted: false });
  assert.equal(A.readableAccent('#2a3f9e', 'dark').adjusted, true);
  // Applied through ux-settings.css, for the user's accent and a server's alike (applyAppearance picks the accent first).
  const css = read('public', 'css', 'ux-settings.css');
  assert.match(css, /:root:not\(\[data-theme='light'\]\) \{\n {2}--accent-ink: var\(--accent-read, var\(--accent\)\);\n {2}--focus: var\(--focus-read, var\(--accent\)\);/);
  const apply = fnSource(read('public', 'js', 'appearance.js'), 'applyAppearance');
  assert.ok(apply.indexOf('const accent = st && HEX.test') < apply.indexOf('readableAccent(accent, theme)'));
  assert.match(read('public', 'js', 'settings.js'), /Adjusted for readability/);
});

test('links in messages are underlined, mentions are not', () => {
  assert.match(read('public', 'css', 'ux-settings.css'), /\.msg-body a:not\(\.mention\):not\(\.channel-mention\), \.embed a \{ text-decoration: underline;/);
});

test('accent swatches are a named radio group with arrow keys', () => {
  const s = read('public', 'js', 'settings.js');
  for (const name of ['Amber', 'Rose', 'Pink', 'Violet', 'Blue', 'Teal', 'Green', 'Lime']) assert.match(s, new RegExp(`'${name}'\\]`));
  assert.match(s, /h\('div', \{ class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' \}\)/);
  assert.match(s, /role: 'radio',\n {8}'aria-checked': String\(a\.accent === c\),\n {8}'aria-label': name,/);
  assert.match(s, /radioKeys\(swatches\);/);
  assert.match(s, /radioKeys\(h\('div', \{ class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Theme' \}/);
  assert.match(fnSource(s, 'radioKeys'), /ArrowRight: i \+ 1, ArrowDown: i \+ 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all\.length - 1/);
});

test('Reduce motion shows on (and can\'t be switched off) when the device asks for less motion', () => {
  const s = read('public', 'js', 'settings.js');
  assert.match(s, /const os = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/);
  assert.match(s, /On because your device asks for less motion\./);
  assert.match(s, /if \(os\) \{ const input = row\.querySelector\('input'\); input\.disabled = true;/);
});

test('phone settings: a list page, then a section page with Back; Keybinds hidden on touch; Security deep links', () => {
  const s = read('public', 'js', 'settings.js');
  const open = s.slice(s.indexOf('export function openSettings('), s.indexOf('\nfunction pointOut('));
  assert.match(open, /let page = tab \? 'page' : 'list';/);
  // Esc and the system Back go back a page first (_back, which ui.js's Esc and app.js's back stack try before
  // _close); _close stays a real close, for a server's Manage and a profile card's mutual servers.
  assert.match(open, /m\.box\.parentElement\._back = \(\) => back\(\);/);
  assert.doesNotMatch(open, /parentElement\._close = /);
  assert.match(read('public/js/ui.js'), /if \(top && top\._back\) top\._back\(\);\n\s+else if \(top && top\._close\) top\._close\(\);/);
  assert.match(read('public/js/app.js'), /close: \(\) => \(dialog\(\)\._back \? dialog\(\)\._back\(\) : dialog\(\)\._close\(\)\)/);
  assert.match(open, /if \(!phoneUI\(\) \|\| page === 'list' \|\| deep\) return tryClose\(\);/);
  assert.match(open, /\(who !== 'keys' \|\| !isTouchUI\(\)\)/);
  assert.match(s, /\['keybinds', 'Keybinds', 'monitor', 'keys'\]/);
  assert.match(s, /const PHONE_GROUPS = \[TAB_GROUPS\[0\], \['App', [^\n]*\['Devices', /);
  assert.match(s, /const TAB_ALIAS = \{ security: 'account' \};/);
  assert.match(open, /if \(focus\) pointOut\(content, focus\);/);
  assert.match(s, /tagged\(section\('Recovery key', recBox\), 'recovery'\)/);
  // The Security row's dot follows app.securityTodo() (the "Secure your account" card's own answer).
  assert.match(s, /const t = app\.securityTodo \? app\.securityTodo\(\) : null;/);
  // The old sideways strip of tabs is gone; the stack is laid out in ux-settings.css.
  const css = read('public', 'css', 'app.css');
  assert.doesNotMatch(css, /\.set-nav \{ flex-direction: row;[^}]*overflow-x: auto/);
  const ux = read('public', 'css', 'ux-settings.css');
  assert.match(ux, /body\.m-ui \.set-stack\[data-page='list'\] \.set-main, body\.m-ui \.set-stack\[data-page='page'\] \.set-nav \{ display: none; \}/);
  assert.doesNotMatch(ux, /overflow-x: auto/);
});

test('Settings > Profile goes to one column when its page is narrower than 820px', () => {
  const ux = read('public', 'css', 'ux-settings.css');
  assert.match(ux, /\.set-content \{ container-type: inline-size; \}/);
  assert.match(ux, /@container \(max-width: 820px\) \{\n {2}\.set-profile \{ grid-template-columns: minmax\(0, 1fr\);[^}]*\}\n {2}\.set-preview \{ position: static; order: -1;/);
  assert.match(ux, /@media \(max-width: 900px\) \{\n {2}\.settings:not\(\.set-stack\) \{ grid-template-columns: minmax\(190px, 220px\) minmax\(0, 1fr\); \}/);
});

test('notifications say "this device" on a phone and in the apps', () => {
  const s = fnSource(read('public', 'js', 'settings.js'), 'notificationsTab');
  assert.match(s, /const device = phoneUI\(\) \|\| androidApp\.on \|\| iosApp\.on;/);
  assert.match(s, /toggle\(device \? 'Notifications on this device' : 'Desktop notifications'/);
});
