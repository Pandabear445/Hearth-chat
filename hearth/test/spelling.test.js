// Spelling in the message box (public/js/spelling.js; Settings → Chat → Spelling): common typos fixed as a word is
// finished, keeping its capitals, never inside code, @mentions, #channels, :emoji:, links, file names, numbers or a
// name; Backspace or Ctrl+Z right after a fix puts back what was typed and leaves that word alone from then on; the
// last word is fixed on send (not a /command; for an edit, only a last word that changed); on by default where the
// browser's language is English. The module runs here as it is; test/e2e flows.mjs "spelling" types in the real box.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  for (const t of ['I met Mr. Noone ', 'ask Dr. Ive ', 'J. Noone ', 'Peter J. Noone ', 'I met J. Noone ', 'thanks\nJ. Noone ', '- J. Noone ', 'by J.K. Noone ', 'a.k.a. Noone ', 'cc: Noone ']) {
    assert.equal(typed(t), t, 'a title, an initial or a label isn\u2019t a sentence\u2019s end');
  }
  for (const [t, want] of [['So do I. Dont ', "So do I. Don't "], ['so am I. Im ', "so am I. I'm "], ['a. Dont ', "a. Don't "], ['love u. Im ', "love u. I'm "], ['in the U.S. Im ', "in the U.S. I'm "], ['at 5 p.m. Dont ', "at 5 p.m. Don't "], ['P.S. Dont ', "P.S. Don't "], ['p.s. Dont ', "p.s. Don't "], ['back in the U.S.A. Thats ', "back in the U.S.A. That's "], ['moved to L.A. Thats ', "moved to L.A. That's "]]) {
    assert.equal(typed(t), want, 'a sentence\u2019s end');
  }
  assert.equal(typed('see you Wensday '), 'see you Wednesday ', 'a word that always has a capital');
  assert.equal(typed("OK I'LL "), "OK I'LL ", 'already right in capitals');
  assert.equal(typed("YES I'VE "), "YES I'VE ");
  assert.equal(S.correctionFor("I'LL"), null);
  // A word with a quote only before it is cut short ('im: him); one in quotes is fixed.
  assert.equal(typed("tell 'im "), "tell 'im ");
  assert.equal(typed("get 'im!"), "get 'im!");
  assert.equal(typed('tell \u2018im '), 'tell \u2018im ', 'a curly quote too');
  assert.equal(typed('he said "dont"'), 'he said "don\'t"');
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

test('what a box sends: the last word fixed, not a bot command, and for an edit only a new last word', () => {
  const kept = new Set();
  assert.equal(S.correctSending('ok dont', { kept }), "ok don't");
  assert.equal(S.correctSending('/roll dont', { kept }), '/roll dont');
  assert.equal(S.correctSending('  /remind me im', { kept }), '  /remind me im');
  assert.equal(S.correctSending('see you at the Haus im', { was: 'see you at teh Haus im', kept }), 'see you at the Haus im', 'its last word was already there');
  assert.equal(S.correctSending('ok so dont', { was: 'ok so', kept }), "ok so don't");
  // The words after it deleted: it was already there.
  assert.equal(S.correctSending('i dont', { was: 'i dont know', kept }), 'i dont');
  assert.equal(S.correctSending('i dont know', { was: 'i dont', kept }), 'i dont know');
  // A fix made on sending, put back by hand: left as typed.
  assert.equal(S.correctSending('as was his wont', { was: "as was his won't", kept }), 'as was his wont');
  assert.equal(S.correctSending('as was his wont.', { was: "as was his won't", kept }), 'as was his wont.');
  assert.equal(S.correctSending('thanks alot', { was: 'thanks a lot', kept }), 'thanks alot', 'a fix of two words too');
  assert.equal(S.correctSending('there was noone', { was: 'there was no one', kept }), 'there was noone');
  // A new last word whose fix happens to be the last word before is new: fixed.
  assert.equal(S.correctSending('love you, miss yuo', { was: 'love you', kept }), 'love you, miss you');
  assert.equal(S.correctSending('So do I. Or do i', { was: 'So do I', kept }), 'So do I. Or do I');
  assert.equal(S.correctSending("That's really wierd", { was: "That's so weird", kept }), "That's really weird");
  // Only the old message's last word can be a fix made on sending.
  assert.equal(S.correctSending('see you tomorow', { was: 'see you tomorrow at 5', kept }), 'see you tomorrow');
  assert.equal(S.correctSending('I have alot', { was: 'I have a lot of work', kept }), 'I have a lot');
  assert.equal(S.correctSending("they said 'dont'", { was: "they said 'don't'", kept }), "they said 'dont'", 'in quotes too');
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
  assert.match(app, /const spelled = \(ta, was = null\) => \(correcting\(\) && !lastWordPasted\(ta\) \? correctSending\(ta\.value, \{ was \}\) : ta\.value\);/);
  assert.match(app, /class: 'composer-input'[^\n]*spellcheck: spellcheckAttr\(\) \}\);\n\s+autocorrect\(ta, \{ on: \(\) => correcting\(\) && !isCommand\(ta\.value\), pasteKey: \(\) => k \+ \(threadId\(\) \|\| ''\) \}\);/);
  assert.match(app, /drafts\.get\(k \+ \(threadId\(\) \|\| ''\)\)/, 'pastes are kept by the same key as the draft');
  assert.match(app, /class: 'edit-input'[^\n]*spellcheck: spellcheckAttr\(\) \}\);\n\s+ta\.value = textOf\(m\);\n\s+autocorrect\(ta, \{ on: correcting \}\);/);
  assert.match(app, /const content = ta\.value === textOf\(m\) \? ta\.value : spelled\(ta, textOf\(m\)\);/);
  assert.match(app, /const text = overrideText != null \? overrideText : spelled\(ta\);/);
  // The scheduled message edit box too.
  assert.match(app, /createScheduled\(\{\n\s+me: \(\) => S\.me,\n\s+spellBox,\n\s+spelled: /);
  assert.match(read('scheduled.js'), /if \(deps\.spellBox\) deps\.spellBox\(ta\);[^\n]*\n[^\n]*\n[^\n]*\n\s+const text = deps\.spelled && ta\.value !== \(dec\.t \|\| ''\) \? deps\.spelled\(ta, dec\.t \|\| ''\) : ta\.value;/);
  const settings = read('settings.js');
  assert.match(settings, /toggle\('Check spelling'/);
  assert.match(settings, /D\.setDesktopSetting\('spellcheck', v\)/);
  assert.match(settings, /toggle\('Correct spelling as I type', c\.autocorrect \?\? englishHere\(\)/);
  assert.doesNotMatch(read('desktop-settings.js'), /toggle\('Check spelling'/, 'not a second switch for it');
});

// Typing in a real box (Chromium), when Playwright is installed (it isn't part of Hearth's dependencies): undo, redo,
// Backspace and pastes. A page with one box and the module, nothing else.
function findPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch { /* next */ }
  }
  try { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { return null; }
}
const PW = findPlaywright();
test('in the browser: Ctrl+Z, redo and Backspace after a fix; what was pasted is left, as typed and when sent', { skip: !PW && 'Playwright is not installed' }, async () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'spelling.js'));
  // (rebuild(): the box made again for the same conversation, as the app does when a call starts or on coming back.)
  const page = `<!doctype html><meta charset=utf-8><textarea id=t maxlength=40></textarea><script type=module>
    import { autocorrect, lastWordPasted, correctSending } from '/spelling.js';
    let t = document.getElementById('t'); autocorrect(t, { pasteKey: () => 'conversation' });
    window.rebuild = () => { const n = t.cloneNode(); n.value = t.value; t.replaceWith(n); t = n; autocorrect(t, { pasteKey: () => 'conversation' }); t.focus(); };
    window.sent = () => (lastWordPasted(t) ? t.value : correctSending(t.value)); window.ready = true;</script>`;
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': q.url === '/spelling.js' ? 'text/javascript' : 'text/html' }); r.end(q.url === '/spelling.js' ? js : page); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await PW.chromium.launch({ executablePath: exe, args: ['--proxy-server=direct://'] });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const box = async () => {
      const p = await context.newPage();
      await p.goto(origin + '/');
      await p.evaluate(() => localStorage.clear());
      await p.waitForFunction(() => window.ready);
      await p.click('#t');
      const state = () => p.evaluate(() => { const t = document.getElementById('t'); return { text: t.value, caret: t.selectionStart, end: t.selectionEnd, kept: JSON.parse(localStorage.getItem('hearth.spellKept') || '[]') }; });
      const paste = async (text) => { await p.evaluate((x) => navigator.clipboard.writeText(x), text); await p.keyboard.press('Control+v'); };
      return { p, k: p.keyboard, state, paste };
    };
    let b = await box();
    await b.k.type('so teh ');
    assert.equal((await b.state()).text, 'so the ');
    await b.k.press('Control+z');
    assert.deepEqual(await b.state(), { text: 'so teh ', caret: 7, end: 7, kept: [] }, 'Ctrl+Z right after: put back, the caret where it was');
    await b.k.press('Control+z');
    assert.deepEqual([(await b.state()).text, (await b.state()).kept], ['', []], 'a second Ctrl+Z goes on back, not to the fix again, and nothing is kept');

    b = await box();
    await b.k.type('so teh ');
    await b.k.press('Control+z');
    await b.k.type('ok');
    assert.deepEqual(await b.state(), { text: 'so teh ok', caret: 9, end: 9, kept: ['teh'] }, 'typing on after Ctrl+Z: the word is kept');

    // Ctrl+Z on a keyboard that isn't Latin (the key is "я", the browser goes by its code).
    b = await box();
    await b.k.type('so teh ');
    const cdp = await context.newCDPSession(b.p);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '\u044f', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '\u044f', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
    assert.deepEqual(await b.state(), { text: 'so teh ', caret: 7, end: 7, kept: [] }, 'Ctrl+Z on a Cyrillic keyboard too');

    b = await box();
    await b.k.type('i think teh plan');
    for (let i = 0; i < 6; i++) await b.k.press('Control+z');
    assert.deepEqual(await b.state(), { text: '', caret: 0, end: 0, kept: [] }, 'undoing all of it turns nothing down');

    b = await box();
    await b.k.type('so teh. ok');
    await b.k.press('Control+z');
    await b.k.press('Control+z');
    assert.deepEqual([(await b.state()).text, (await b.state()).kept], ['so teh. ', []], 'undone later: the browser\u2019s own undo, nothing kept');
    await b.k.press('Control+y');
    assert.deepEqual([(await b.state()).text, (await b.state()).kept], ['so the. ', []], 'and redo');

    b = await box();
    await b.k.type('so teh.');
    await b.k.type(' ');
    await b.k.press('Control+z');
    assert.deepEqual(await b.state(), { text: 'so teh. ', caret: 8, end: 8, kept: [] }, 'right after: after the full stop and space');

    b = await box();
    await b.k.type('a teh ');
    await b.k.press('Backspace');
    assert.deepEqual(await b.state(), { text: 'a teh ', caret: 6, end: 6, kept: ['teh'] }, 'Backspace right after');
    await b.k.press('Control+z');
    assert.deepEqual(await b.state(), { text: 'a the ', caret: 6, end: 6, kept: [] }, 'and undoing that takes the fix after all');

    b = await box();
    await b.k.type("OK I'LL ");
    await b.k.press('Backspace');
    assert.equal((await b.state()).text, "OK I'LL", 'nothing to fix in capitals: Backspace is Backspace');

    b = await box();
    await b.k.type('123456789012345678901234567890123456 im ');
    assert.equal((await b.state()).text, '123456789012345678901234567890123456 im ', 'a fix that wouldn\u2019t fit the box isn\u2019t made');

    b = await box();
    await b.k.type("say 'teh' ");
    await b.k.press('Control+z');
    await b.k.type('ok');
    assert.equal((await b.state()).text, "say 'teh' ok", 'in quotes: the caret after the closing quote and the space');

    b = await box();
    await b.k.type('so teh ');
    for (const key of ['Control+z', 'Control+z', 'Control+y', 'Control+y']) await b.k.press(key);
    assert.deepEqual([(await b.state()).text, (await b.state()).kept], ['so the ', []], 'all undone and redone: as it was, nothing kept');

    b = await box();
    await b.k.type('so the cat');
    await b.p.evaluate(() => document.getElementById('t').setSelectionRange(3, 6));
    await b.k.press('Delete');
    await b.k.press('Control+z');
    assert.deepEqual(await b.state(), { text: 'so the cat', caret: 3, end: 6, kept: [] }, 'an undo that isn\u2019t of a fix is left alone');

    b = await box();
    await b.paste('he said i dont');
    await b.p.click('#t');
    await b.k.press('End');
    await b.k.type(' ok');
    assert.equal((await b.state()).text, 'he said i dont ok', 'pasted: left after a click');

    b = await box();
    await b.paste('i dont');
    await b.k.press('Home');
    await b.k.type('> ');
    assert.equal(await b.p.evaluate(() => window.sent()), '> i dont', 'pasted: left when something is typed before it');
    await b.k.press('End');
    for (let i = 0; i < 4; i++) await b.k.press('Backspace');
    await b.k.type('teh ');
    assert.equal((await b.state()).text, '> i the ', 'what\u2019s typed in its place is fixed');

    b = await box();
    await b.paste('he said i dont');
    await b.k.press('Backspace');
    await b.k.press('Control+z');
    await b.k.press('Control+v');
    await b.k.press('Control+z');
    assert.equal(await b.p.evaluate(() => window.sent()), 'he said i dont', 'a paste back after an undo is still a paste');

    b = await box();
    await b.paste('dont');
    await b.p.evaluate(() => { const t = document.getElementById('t'); t.value = ''; }); // sent: the box emptied
    await b.k.type('ok dont');
    assert.equal(await b.p.evaluate(() => window.sent()), "ok don't", 'once it\u2019s been sent, the same word typed is fixed');

    b = await box();
    await b.paste('dont');
    await b.k.press('Home');
    await b.k.type('and ');
    assert.equal(await b.p.evaluate(() => window.sent()), 'and dont', 'typed before it, starting with the letter it starts with');

    b = await box();
    await b.paste('he said i dont');
    await b.k.press('Control+z');
    await b.k.press('Control+y');
    assert.equal(await b.p.evaluate(() => window.sent()), 'he said i dont', 'a paste undone and redone is still a paste');

    b = await box();
    await b.paste('dont');
    await b.k.press('Control+a');
    await b.k.press('Delete');
    await b.k.type('dont ');
    assert.equal((await b.state()).text, "don't ", 'gone: the same word typed afterwards is fixed');

    b = await box();
    await b.k.type("the word is '");
    await b.paste('teh');
    await b.k.type("'");
    assert.equal(await b.p.evaluate(() => window.sent()), "the word is 'teh'", 'pasted between quotes');

    b = await box();
    await b.k.type('the word is ');
    await b.paste('teh ');
    await b.k.press('Backspace');
    assert.equal(await b.p.evaluate(() => window.sent()), 'the word is teh', 'its space taken off');

    b = await box();
    await b.paste('Hey dont do that');
    for (let i = 0; i < 8; i++) await b.k.press('Backspace');
    await b.k.type('!');
    assert.equal((await b.state()).text, 'Hey dont!', 'its end taken off');

    b = await box();
    await b.p.evaluate(() => { const t = document.getElementById('t'); t.value = 'x'.repeat(35) + ' '; t.setSelectionRange(36, 36); });
    await b.paste('dont worry about it');
    assert.equal((await b.state()).text, 'x'.repeat(35) + ' dont', 'cut short by the box (40 characters)');
    assert.equal(await b.p.evaluate(() => window.sent()), 'x'.repeat(35) + ' dont', 'what went in is still a paste');

    b = await box();
    await b.paste("he said 'teh'");
    assert.equal(await b.p.evaluate(() => window.sent()), "he said 'teh'", 'pasted with its quotes');
    await b.k.type(' ');
    assert.equal((await b.state()).text, "he said 'teh' ");

    b = await box();
    await b.paste('he said i dont');
    await b.k.type('. she said i dont ');
    assert.equal((await b.state()).text, "he said i dont. she said I don't ", 'the same words typed after other ones are fixed');

    b = await box();
    await b.paste('i');
    await b.k.type(' ');
    assert.equal((await b.state()).text, 'i ', 'a pasted i');

    b = await box();
    await b.paste('I dont know');
    await b.p.evaluate(() => { document.getElementById('t').value = ''; }); // sent: the app empties the box
    await b.k.type('I dont think so ');
    assert.equal((await b.state()).text, "I don't think so ", 'the next message starts afresh');

    b = await box();
    await b.k.type('Yeah');
    await b.paste(', i dont');
    assert.equal(await b.p.evaluate(() => window.sent()), 'Yeah, i dont', 'a paste starting with punctuation, after a word');

    b = await box();
    await b.paste('dont !');
    await b.k.press('Backspace');
    await b.k.press('Backspace');
    assert.equal(await b.p.evaluate(() => window.sent()), 'dont', 'its " !" taken off');

    b = await box();
    await b.paste('he said i dont');
    await b.p.evaluate(() => window.rebuild());
    assert.equal(await b.p.evaluate(() => window.sent()), 'he said i dont', 'the box made again for the conversation remembers it');

    b = await box();
    await b.paste('he said i dont');
    assert.equal(await b.p.evaluate(() => window.sent()), 'he said i dont', 'sent straight after the paste: as pasted');
    await b.k.type('. ok');
    await b.p.click('#t');
    await b.k.press('End');
    await b.k.type(' teh dont');
    assert.equal((await b.state()).text, 'he said i dont. ok the dont', 'pasted words stay; typed ones are fixed');
    assert.equal(await b.p.evaluate(() => window.sent()), "he said i dont. ok the don't", 'and the last one on sending');
  } finally {
    await browser.close();
    srv.close();
  }
});
