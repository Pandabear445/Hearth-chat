// The keyboard shortcuts sheet (Ctrl+/): public/js/keybinds.js SHORTCUTS lists every key app.js globalKeys
// handles, fills the calls keys in from this person's own keybinds, and README.md says the same.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.window = globalThis.window || {};
let K;
before(async () => { K = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'keybinds.js')).href); });
const ROOT = path.join(__dirname, '..');
const combos = (groups) => groups.flatMap(([, rows]) => rows.flatMap(([keys]) => keys));

// The keys globalKeys reacts to, as the sheet writes them (Mod = Ctrl or ⌘).
function handledCombos() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const start = src.indexOf('function globalKeys(e) {');
  assert.ok(start > 0, 'globalKeys is in app.js');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const NAME = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  const out = [];
  for (const line of body.split('\n').filter((l) => /^ {2}if \(/.test(l))) {
    const mods = [/\(e\.ctrlKey \|\| e\.metaKey\)/.test(line) && 'Mod', /(?<!!)e\.altKey/.test(line) && 'Alt', /(?<!!)e\.shiftKey/.test(line) && 'Shift'].filter(Boolean);
    for (const [, key] of line.matchAll(/(?:e\.key|\bk) === '([^']+)'/g)) out.push([...mods, NAME[key] || (key.length === 1 ? key.toUpperCase() : key)].join('+'));
  }
  return out;
}

test('every key globalKeys handles is in the shortcuts sheet', () => {
  const handled = handledCombos();
  for (const c of ['Mod+K', 'Mod+/', 'Alt+↑', 'Alt+↓', 'Shift+Esc', 'Esc']) assert.ok(handled.includes(c), `globalKeys should handle ${c} (found ${handled.join(', ')})`);
  const listed = combos(K.SHORTCUTS);
  for (const c of handled) assert.ok(listed.includes(c), `${c} is handled but not in SHORTCUTS`);
});

test('the sheet has the four groups, and each row says what it does', () => {
  assert.deepEqual(K.SHORTCUTS.map(([g]) => g), ['Navigation', 'Messages', 'Calls', 'Picture viewer']);
  for (const [, rows] of K.SHORTCUTS) for (const [keys, what] of rows) { assert.ok(Array.isArray(keys) && keys.length); assert.ok(typeof what === 'string' && what.length > 3); }
  // The viewer's keys (openViewer) are listed too.
  for (const c of ['←', '→', '+', '−']) assert.ok(combos(K.SHORTCUTS).includes(c), c);
});

test('the calls keys are this person’s own, and an unset one says where to set it', () => {
  store['hearth.keybinds'] = JSON.stringify({ ptt: { code: 'KeyV' }, mute: { code: 'KeyM', ctrl: true, shift: true }, deafen: null });
  const calls = K.shortcutGroups().find(([g]) => g === 'Calls')[1];
  assert.deepEqual(calls[0][0], ['Ctrl+Shift+M']);
  assert.match(calls[1][1], /no key set/);
  assert.deepEqual(calls[1][0], []);
  assert.deepEqual(calls[2], [['V'], 'Push to talk (hold)']);
  delete store['hearth.keybinds'];
});

test('with Ctrl+Enter to send, the sheet says so', () => {
  const msgs = (o) => K.shortcutGroups(o).find(([g]) => g === 'Messages')[1];
  assert.ok(msgs().some(([k, w]) => k[0] === 'Enter' && w === 'Send'));
  assert.ok(msgs({ enterSends: false }).some(([k, w]) => k[0] === 'Mod+Enter' && w === 'Send'));
  assert.ok(msgs({ enterSends: false }).some(([k, w]) => k[0] === 'Enter' && w === 'New line'));
});

test('combos split into keys, and Mod is Ctrl or ⌘', () => {
  assert.deepEqual(K.comboParts('Mod+K'), ['Mod', 'K']);
  assert.deepEqual(K.comboParts('Mod+/'), ['Mod', '/']);
  assert.deepEqual(K.comboParts('+'), ['+']);
  assert.deepEqual(K.comboParts('Ctrl+Shift+M'), ['Ctrl', 'Shift', 'M']);
  assert.equal(K.keyName('Mod', false), 'Ctrl');
  assert.equal(K.keyName('Mod', true), '⌘');
  assert.equal(K.keyName('K', true), 'K');
});

test('README lists the new keys', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const part = readme.slice(readme.indexOf('## Keyboard shortcuts'), readme.indexOf('## Not included'));
  assert.match(part, /Ctrl\/⌘ \+ \/\*\*/);
  assert.match(part, /Shift \+ Esc/);
});

// Alt+↑/↓ (app.js stepChannel), run on a stand-in sidebar: in a server the current channel is marked on its row
// (.ch-row.active) and on its button (aria-current="page"), and voice channels are stepped over (landing on one would
// join its call). With nothing current, ↓ goes to the first row and ↑ to the last.
test('Alt+↑/↓ finds the channel you are in by aria-current, and skips voice channels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const start = src.indexOf('function stepChannel(dir) {');
  const body = src.slice(start, src.indexOf('\n}\n', start) + 2);
  const make = (rows) => {
    const clicked = [];
    const els = rows.map(({ id, type, current }) => {
      const row = { classList: { contains: (c) => c === 'active' && !!current }, dataset: { cid: id } };
      return {
        id, classList: { contains: () => false },
        getAttribute: (a) => (a === 'aria-current' && current ? 'page' : null),
        closest: (sel) => (sel === '.ch-row' ? row : sel === '.ch-row.active' ? (current ? row : null) : null),
        getClientRects: () => [1],
        click() { clicked.push(id); },
        type,
      };
    });
    const step = new Function('$$', 'channelById', `${body}; return stepChannel;`)(() => els, (id) => els.find((e) => e.id === id));
    return { step, clicked };
  };
  const list = (cur) => [{ id: 'general', type: 'text' }, { id: 'lounge', type: 'voice' }, { id: 'books', type: 'text' }].map((r) => ({ ...r, current: r.id === cur }));
  let s = make(list('general'));
  s.step(1);
  assert.deepEqual(s.clicked, ['books'], 'down from #general skips the voice channel');
  s = make(list('books'));
  s.step(-1);
  assert.deepEqual(s.clicked, ['general'], 'up from #books skips it too');
  s = make(list('books'));
  s.step(1);
  assert.deepEqual(s.clicked, [], 'the last row stays put (nothing is clicked again)');
  s = make(list(null));
  s.step(1);
  assert.deepEqual(s.clicked, ['general'], 'nothing current: down goes to the first');
  s = make(list('lounge'));
  s.step(-1);
  assert.deepEqual(s.clicked, ['books'], 'in a voice room: up goes to the last text row');
});
