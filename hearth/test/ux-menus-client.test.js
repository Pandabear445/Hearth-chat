// Menus, touch input and keyboard (1.44): long menus scroll on every pointer and keep their settings behind submenus,
// a phone's message sheet has its big buttons and More…, rows open their menus on a long press, tooltips stay away
// from fingers, and search on a touch screen has a Search key. Read from the sources, like the other *-client tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const app = read('js/app.js');
const ui = read('js/ui.js');
const appCss = read('css/app.css');
const menusCss = read('css/ux-menus.css');

// The source of a top-level function in app.js (up to the next line that closes one).
function fnSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is in the source`);
  return src.slice(start, src.indexOf('\n}\n', start) + 2);
}
// The entries of the array a function returns (its last `return [`), split at the top level.
function returnedEntries(body) {
  const at = body.lastIndexOf('return [');
  assert.ok(at >= 0, 'returns an array');
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = at + 'return ['.length; i < body.length; i++) {
    const c = body[i];
    if (quote) { cur += c; if (c === '\\') { cur += body[++i]; } else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) {
      if (depth === 0) { if (cur.trim()) out.push(cur.trim()); break; }
      depth--;
    }
    if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return out;
}
// CSS rules that sit outside every @media block, as [selector, body].
function topLevelRules(css) {
  const rules = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let sel = '';
  let body = '';
  for (const c of src) {
    if (c === '{') { depth++; if (depth === 1) { body = ''; continue; } }
    if (c === '}') { depth--; if (depth === 0) { if (!sel.trim().startsWith('@')) rules.push([sel.trim(), body]); sel = ''; continue; } }
    if (depth === 0) sel += c; else body += c;
  }
  return rules;
}

test('a long menu scrolls on every pointer: the .menu max-height rule is outside any pointer media query', () => {
  const top = topLevelRules(menusCss).filter(([s, b]) => /(^|,)\s*\.menu\s*$/.test(s) && /max-height/.test(b) && /overflow-y:\s*auto/.test(b));
  assert.equal(top.length, 1, 'ux-menus.css has a plain .menu rule with max-height and overflow-y: auto');
  assert.match(top[0][1], /overscroll-behavior:\s*contain/);
  // The old one, inside @media (pointer: coarse) in app.css, is gone.
  assert.doesNotMatch(appCss, /\.menu \{ max-height: calc\(100vh - 16px\)/);
  // A menu in a sheet still scrolls with its sheet, not by itself.
  assert.match(menusCss, /\.sheet \.menu\.sheet-menu \{ max-height: none; overflow: visible; \}/);
});

test('the wheel over a popup scrolls the popup, never the chat behind it', () => {
  assert.match(fnSource(ui, 'popover'), /addEventListener\('wheel'[\s\S]{0,400}preventDefault\(\)[\s\S]{0,40}passive: false/);
});

test('ui.js menus have submenu rows: a flyout beside the menu, a page on a sheet, with the right roles and keys', () => {
  const menuEl = fnSource(ui, 'menuEl');
  assert.match(menuEl, /it\.submenu/);
  assert.match(menuEl, /'aria-haspopup': 'menu', 'aria-expanded': 'false'/);
  assert.match(menuEl, /chevronRight/);
  // → opens it from the keyboard; ← and Esc in the flyout close it and give focus back to its row.
  assert.match(fnSource(ui, 'menuSemantics'), /ArrowRight[\s\S]{0,80}_openSub\(\{ focus: true \}\)/);
  const fly = fnSource(ui, 'subFlyout');
  assert.match(fly, /ArrowLeft' \|\| e\.key === 'Escape'[\s\S]{0,120}closeFlyout\(parent, \{ refocus: true \}\)/);
  assert.match(fly, /setAttribute\('aria-expanded', 'true'\)/);
  // Flipped to the left of the menu where there's no room on the right.
  assert.match(fly, /x \+ w > innerWidth - 8/);
  // Hover opens it after a moment (a mouse only).
  assert.match(ui, /const SUB_HOVER_MS = 150;/);
  assert.match(fnSource(ui, 'hoverSubmenus'), /lastPointer !== 'mouse'/);
  // On a sheet: a second page with a Back row, and Back / Esc go back a page before closing.
  assert.match(fnSource(ui, 'sheetMenu'), /sh\.push\(page\(it\.submenu\(\) \|\| \[\]\), it\.label\)/);
  const sheet = fnSource(ui, 'sheet');
  assert.match(sheet, /class: 'sheet-back'/);
  assert.match(sheet, /backdrop\._close = \(o\) => \(pages\.length && !o \? pop\(\) : close\(o\)\)/);
});

test('the channel menu is short: at most 16 entries, its settings behind submenus, and what deletes last', () => {
  const body = fnSource(app, 'channelMenuItems');
  const entries = returnedEntries(body).filter((e) => e !== "'-'");
  assert.ok(entries.length <= 16, `channelMenuItems has ${entries.length} top-level entries`);
  assert.match(body, /label: c\.type === 'voice' \? 'Chat notifications' : 'Notifications', icon: 'bell', value: LEVEL_SHORT\[lvl\], submenu:/);
  assert.match(body, /disappearSub\(k\)/);
  assert.match(body, /regionSub\(c\.id\)/);
  assert.match(fnSource(app, 'notifyItems'), /label: 'Mute', icon: 'bellOff', submenu:/);
  // Deleting comes after a separator, at the end.
  assert.match(body, /'-',\s*hasChat\(c\) && canIn\(c, PERMS\.MANAGE_MESSAGES\) \? \{ label: 'Delete recent messages/);
});

test('the server and DM menus use the same submenus; Mark server as read is at the top', () => {
  const server = fnSource(app, 'serverMenuItems');
  assert.match(returnedEntries(server)[0], /Mark server as read/);
  assert.match(server, /label: 'Notifications', icon: 'bell', value: LEVEL_SHORT\[lvl\], submenu:/);
  assert.doesNotMatch(server, /\{ header: 'Notifications' \}/);
  const dm = fnSource(app, 'dmMenuItems');
  assert.match(dm, /disappearSub\('d:' \+ d\.id\)/);
  assert.doesNotMatch(dm, /disappearItems\(/);
});

test('the message menu: everyday actions first, Remind me as a submenu, what deletes last', () => {
  const body = fnSource(app, 'messageMenuItems');
  const keys = [...returnedEntries(body).join('\n').matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys.slice(0, 4), ['reply', 'edit', 'thread', 'copy']);
  assert.ok(keys.indexOf('remind') < keys.indexOf('delete') && keys.indexOf('unread') < keys.indexOf('delete'));
  assert.deepEqual(keys.slice(-3), ['delete', 'select', 'report']);
  assert.match(body, /key: 'remind', label: 'Remind me', icon: 'bell', submenu: \(\) => reminders/);
  // (14 entries in all, of which someone who can't moderate sees at most 11.)
  const entries = returnedEntries(body).filter((e) => e !== "'-'");
  assert.ok(entries.length <= 14, `${entries.length} entries`);
});

test('a phone’s message sheet: quick reactions, four big buttons, a short list, then More…, at most 70% high', () => {
  const body = fnSource(app, 'messageSheet');
  assert.match(body, /class: 'sheet-quicks'/);
  assert.match(body, /\[by\('reply'\), mine \? by\('edit'\) : by\('thread'\), by\('copy'\), mine \? by\('delete'\) : by\('report'\)\]/);
  assert.match(body, /label: 'More\\u2026'/);
  assert.match(app, /const SHEET_LIST_MAX = 5;/);
  assert.match(body, /QUICK_REACTIONS/);
  assert.match(body, /keepAboveSheet\(el, sh\.box\)/);
  assert.match(menusCss, /\.sheet\.msg-sheet \{ max-height: min\(70vh/);
  // Delete still asks first (deleteMessage's own confirm).
  assert.match(fnSource(app, 'deleteMessage'), /confirmDialog/);
});

test('a long press on a row opens its menu on a touch screen, and the lift never taps the row', () => {
  assert.match(ui, /const ROW_PRESS = '\.ch-row, \[data-nav\], \.member, \.rail-btn, \.dm-row/);
  assert.match(ui, /const ROW_PRESS_MS = 450;/);
  assert.match(ui, /!isTouchUI\(\)/);
  assert.match(ui, /e\.target\.closest\('\.msg, /);
  assert.match(ui, /new MouseEvent\('contextmenu', \{ bubbles: true, cancelable: true, clientX: p\.x, clientY: p\.y/);
  assert.match(ui, /navigator\.vibrate\(10\)/);
  // The click that follows is eaten, and Android's own right-click doesn't open a second menu.
  assert.match(ui, /eatClick = \{ el: p\.el, until: Date\.now\(\) \+ 700 \}/);
  assert.match(ui, /if \(rowPress\.done\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); return; \}/);
  assert.match(menusCss, /@media \(pointer: coarse\) \{\s*\.ch-gear \{ opacity: \.75; \}/);
});

test('tooltips never come from a finger or a pen, and hideTip is exported for view changes', () => {
  assert.match(ui, /export function hideTip\(\)/);
  assert.match(ui, /matchMedia\('\(hover: none\)'\)/);
  assert.match(ui, /lastPointer = e\.pointerType \|\| 'mouse'/);
  assert.match(ui, /lastPointer === 'touch' \|\| lastPointer === 'pen' \|\| noHover\(\)/);
  assert.match(ui, /addEventListener\('pointerup', hideTip, true\)/);
  // Keyboard focus still shows them.
  assert.match(ui, /t\.matches\(':focus-visible'\)\) showTip\(t\)/);
});

test('search on a touch screen: a Search key, Enter puts the keyboard away and keeps the results, no key hints', () => {
  const body = fnSource(app, 'openSearch');
  assert.match(body, /enterkeyhint: 'search'/);
  assert.match(body, /if \(isTouchUI\(\)\) \{ searchHistory\.add\(input\.value\); input\.blur\(\); return; \}/);
  assert.match(menusCss, /body\.m-ui \.search-keys/);
  assert.match(menusCss, /@media \(pointer: coarse\) \{\s*\.search-keys, \.search-bar kbd \{ display: none !important; \}/);
});

test('the shortcuts sheet lines its keys up in a column; Reels says Click with a mouse', () => {
  assert.match(appCss, /\.sc-list \{ margin: 0; display: grid; grid-template-columns: fit-content\(9\.5rem\) minmax\(0, 1fr\);/);
  assert.match(appCss, /\.sc-row \{ display: contents; \}/);
  const reels = read('js/reels-ui.js');
  assert.match(reels, /matchMedia\('\(pointer: fine\)'\)\.matches \? \['Click', 'Clicking'\] : \['Tap', 'Tapping'\]/);
  assert.match(reels, /`\$\{verb\[0\]\} to start watching`/);
});
