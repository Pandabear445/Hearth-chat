// Spelling in the message box (public/js/spelling.js; Settings → Chat → Spelling): common typos fixed as a word is
// finished, keeping its capitals, never inside code, @mentions, #channels, :emoji:, links, file names, numbers or a
// name; Backspace or Ctrl+Z right after a fix puts back what was typed and leaves that word alone from then on; the
// last word is fixed on send (not a /command; for an edit, only a last word that changed); on by default where the
// browser's language is English. The module runs here as it is; test/e2e flows.mjs "spelling" types in the real box.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let S;
before(async () => { S = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'spelling.js')).href); });
const typed = (text, kept = new Set()) => {
  const c = S.findCorrection(text, text.length, { kept });
  return c ? text.slice(0, c.start) + c.fix + text.slice(c.end) : text;
};

test('the list: lower-case typos that are not words themselves, each to something else', () => {
  const keys = Object.keys(S.CORRECTIONS);
  assert.ok(keys.length > 300, `${keys.length} typos`);
  for (const k of keys) {
    assert.match(k, /^[a-z']+$/, k);
    assert.ok(S.CORRECTIONS[k] !== k, `${k} changes`);
  }
  // Real words, names and spellings people mean are never changed.
  for (const w of ['ill', 'its', 'were', 'lets', 'wed', 'well', 'hell', 'shell', 'id', 'juts', 'heros', 'sargent', 'thanx', 'pls', 'wether', 'loosing', 'form', 'whit', 'nad', 'massage', 'lightening']) {
    assert.equal(S.correctionFor(w), null, w);
  }
  // Nor real words, typos of two different words, names, other languages' words or spellings people mean.
  for (const w of ['whys', 'underate', 'hwo', 'whos', 'wheather', 'wanst', 'grammer', 'posible', 'probly', 'reallly', 'thinkg', 'jewelery']) {
    assert.equal(S.correctionFor(w), null, w);
  }
});

test('a finished word is fixed, keeping its capitals; abbreviations in capitals are left', () => {
  assert.equal(typed('teh '), 'the ');
  assert.equal(typed('Teh '), 'The ');
  assert.equal(typed('I DONT '), "I DON'T ");
  assert.equal(typed('IM '), 'IM ', 'an abbreviation');
  assert.equal(typed('so i dont know.'), 'so i dont know.', 'only the word just finished');
  assert.equal(typed('so i dont '), "so i don't ");
  assert.equal(typed('i '), 'I ');
  assert.equal(typed("i'm "), "I'm ");
  assert.equal(typed('i.'), 'i.', '"i.e." stays');
  assert.equal(typed('i.e. '), 'i.e. ');
  assert.equal(typed('i. '), 'i. ', 'a list numbered i. ii. iii.');
  for (const sep of [',', '!', '?', ';', ':', ')', '\n']) assert.equal(typed(`recieve${sep}`), `receive${sep}`, JSON.stringify(sep));
  // A full stop waits for what comes after it: the end of a sentence, or a file name or address.
  assert.equal(typed('recieve.'), 'recieve.');
  assert.equal(typed('recieve. '), 'receive. ');
  assert.equal(typed('recieve...\n'), 'receive...\n');
  assert.equal(typed('open dont.js '), 'open dont.js ');
  assert.equal(typed('im.example.org '), 'im.example.org ');
  // Two or three capitals are an abbreviation; a capital in the middle of a sentence is a name.
  assert.equal(typed('TEH '), 'TEH ');
  assert.equal(typed('TEHY '), 'THEY ');
  assert.equal(typed('Jony Ive '), 'Jony Ive ');
  assert.equal(typed('Ive '), "I've ", 'at the start of a sentence');
  assert.equal(typed('ok. Dont '), "ok. Don't ");
  assert.equal(typed('ok!\n(Dont '), "ok!\n(Don't ");
  assert.equal(typed('Kelsey Noone '), 'Kelsey Noone ');
  assert.equal(typed("'teh' "), "'the' ");
  assert.equal(typed('(alot)'), '(a lot)');
  assert.equal(typed('teh'), 'teh', 'not finished yet');
});

test('never in code, @mentions, #channels, :emoji:, links, paths, numbers or joined words', () => {
  for (const text of ['`teh `', 'say `teh ', '```\nteh ', '@teh ', '#teh ', ':teh: ', 'https://x.example/teh ', 'a/teh ', 'teh2 ', '2teh ', 'self-teh ', 'x_teh ']) {
    assert.equal(typed(text), text, text);
  }
  assert.equal(typed('```\ncode\n```\nteh '), '```\ncode\n```\nthe ', 'after a code block, again');
  // An inline code span that's still open, after other words in it.
  assert.equal(typed('say `foo teh '), 'say `foo teh ');
  assert.equal(S.correctEnd('see `x dont', { kept: new Set() }), 'see `x dont');
  assert.equal(typed('`a` teh '), '`a` the ', 'after one that was closed, again');
  assert.equal(typed('`a` and `b teh '), '`a` and `b teh ');
});

test('a word put back after a fix is left alone; the last word is fixed on send', () => {
  assert.equal(typed('teh ', new Set(['teh'])), 'teh ');
  assert.equal(S.correctEnd('ok dont', { kept: new Set() }), "ok don't");
  assert.equal(S.correctEnd('ok dont', { kept: new Set(['dont']) }), 'ok dont');
  assert.equal(S.correctEnd('see `teh', { kept: new Set() }), 'see `teh');
  assert.equal(S.correctEnd('fine', { kept: new Set() }), 'fine');
});

test('what a box sends: the last word fixed, not a bot command, and for an edit only a last word that changed', () => {
  const kept = new Set();
  assert.equal(S.correctSending('ok dont', { kept }), "ok don't");
  assert.equal(S.correctSending('/roll dont', { kept }), '/roll dont');
  assert.equal(S.correctSending('  /remind me im', { kept }), '  /remind me im');
  assert.equal(S.correctSending('see you at the Haus im', { was: 'see you at teh Haus im', kept }), 'see you at the Haus im', 'its last word was already there');
  assert.equal(S.correctSending('ok so dont', { was: 'ok so', kept }), "ok so don't");
  assert.equal(S.correctSending('ok dont', { kept: new Set(['dont']) }), 'ok dont');
});

test('on by default only where the browser is in English (im, dont and i are words elsewhere)', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const as = (languages) => Object.defineProperty(globalThis, 'navigator', { value: { languages, language: languages[0] }, configurable: true, writable: true });
  try {
    as(['en-US', 'de']); assert.equal(S.englishHere(), true);
    as(['en']); assert.equal(S.englishHere(), true);
    as(['de-DE', 'en']); assert.equal(S.englishHere(), false);
    as(['fr']); assert.equal(S.englishHere(), false);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
  }
});

test('the app: the boxes use it and the settings; one spell checker switch in the desktop app', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const app = read('app.js');
  assert.match(app, /const correcting = \(\) => \(P\.chat\.autocorrect \?\? englishHere\(\)\) !== false && !isTouchUI\(\);/);
  assert.match(app, /const spelled = \(text, was = null\) => \(correcting\(\) \? correctSending\(text, \{ was \}\) : text\);/);
  assert.match(app, /class: 'composer-input'[^\n]*spellcheck: spellcheckAttr\(\) \}\);\n\s+autocorrect\(ta, \{ on: \(\) => correcting\(\) && !isCommand\(ta\.value\) \}\);/);
  assert.match(app, /class: 'edit-input'[^\n]*spellcheck: spellcheckAttr\(\) \}\);\n\s+ta\.value = textOf\(m\);\n\s+autocorrect\(ta, \{ on: correcting \}\);/);
  assert.match(app, /const content = ta\.value === textOf\(m\) \? ta\.value : spelled\(ta\.value, textOf\(m\)\);/);
  assert.match(app, /const text = overrideText != null \? overrideText : spelled\(ta\.value\);/);
  const settings = read('settings.js');
  assert.match(settings, /toggle\('Check spelling'/);
  assert.match(settings, /D\.setDesktopSetting\('spellcheck', v\)/);
  assert.match(settings, /toggle\('Correct spelling as I type', c\.autocorrect \?\? englishHere\(\)/);
  assert.doesNotMatch(read('desktop-settings.js'), /toggle\('Check spelling'/, 'not a second switch for it');
});
