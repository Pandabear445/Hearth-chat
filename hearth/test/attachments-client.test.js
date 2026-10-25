// Attachment options, the app's side: a description (alt text) and "Mark as spoiler" travel inside the encrypted
// message with each file (app.js uploadEncryptedFiles), so the sender chose them; public/js/attachments.js
// cleanFiles keeps only a capped string and a plain yes for them. The module runs here as it is (no browser).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let A;
before(async () => { A = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'attachments.js')).href); });
const file = (extra = {}) => ({ url: '/uploads/0abc123def.bin', k: 'key', name: 'cat.png', type: 'image/png', size: 10, ...extra });

test('a description is kept as words, trimmed and capped at 1000 characters', () => {
  assert.equal(A.ALT_MAX, 1000);
  assert.equal(A.cleanFiles([file({ alt: '  A cat asleep on a keyboard  ' })])[0].alt, 'A cat asleep on a keyboard');
  assert.equal(A.cleanFiles([file({ alt: 'x'.repeat(5000) })])[0].alt.length, 1000);
  assert.equal(A.cleanFiles([file({ alt: 'line one\nline\u0000two' })])[0].alt, 'line one line two', 'control characters become spaces');
});

test('a description that isn’t a string, or is empty, is dropped', () => {
  for (const alt of [{ toString: () => 'x' }, ['a'], 42, true, null, '', '   ']) {
    const [f] = A.cleanFiles([file({ alt })]);
    assert.ok(!('alt' in f), `alt ${JSON.stringify(alt)} should be dropped`);
  }
});

test('spoiler is a plain yes: 1 or true become 1, anything else is dropped', () => {
  assert.equal(A.cleanFiles([file({ sp: 1 })])[0].sp, 1);
  assert.equal(A.cleanFiles([file({ sp: true })])[0].sp, 1);
  for (const sp of [0, '1', 'yes', 2, {}, [], null, false]) {
    const [f] = A.cleanFiles([file({ sp })]);
    assert.ok(!('sp' in f), `sp ${JSON.stringify(sp)} should be dropped`);
  }
});

test('a file without options comes out as it went in, and a bad address still loses the whole entry', () => {
  assert.deepEqual(A.cleanFiles([file()]), [file()]);
  assert.deepEqual(A.cleanFiles([{ url: 'https://evil.example/x.png', alt: 'hi', sp: 1 }]), []);
  const both = A.cleanFiles([file({ alt: 'A map', sp: 1 })])[0];
  assert.equal(both.alt, 'A map');
  assert.equal(both.sp, 1);
});

test('the app sends both inside the message, reads alt for pictures and blurs spoilers until the first click', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /\.\.\.\(p\.spoiler \? \{ sp: 1 \} : \{\}\), \.\.\.\(p\.alt \? \{ alt: String\(p\.alt\)\.slice\(0, ALT_MAX\) \} : \{\}\)/);
  assert.match(app, /alt: f\.alt \|\| f\.name \|\| 'Image'/);
  assert.match(app, /if \(f\.sp\) spoilerCover\(holder, el, media\)/);
  // Unopened spoilers stay out of the picture viewer's left/right browsing.
  assert.match(app, /!i\.closest\('\.att-spoiler:not\(\.revealed\)'\)/);
  // A message that would be too big for the server with ten long descriptions goes with them cut short.
  const fit = app.slice(app.indexOf('async function encryptFitting('), app.indexOf('async function sendTo('));
  assert.match(fit, /alt: f\.alt\.slice\(0, 200\)/);
  // The server never sees either: no route or column for them.
  const server = fs.readdirSync(path.join(__dirname, '..', 'server')).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8')).join('\n');
  assert.doesNotMatch(server, /\balt_text\b|\bspoiler\b/i);
});

// The browser flow "redraws" (test/e2e/flows.mjs) watches this happen frame by frame; these are the pieces it rests on.
test('a message drawn again keeps the pictures it shows, and a picture is a plain box until it’s drawn', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  // A reaction, a pin or an edit (replaceMessageEl) and a whole redraw (renderMessages) hand the old row's media over,
  // and attachmentEl takes the same file (same key, description and spoiler) over instead of decrypting it again.
  assert.match(app, /keptMedia = shownMedia\(el\)\.get\(m\.id\) \|\| null;/);
  assert.match(app, /keptMedia = shown\.get\(m\.id\) \|\| null;/);
  assert.match(app, /const att = JSON\.stringify\(f\);\s+const kept = keptMedia && keptMedia\.get\(att\);\s+if \(kept\) \{ keptMedia\.delete\(att\); return kept; \}/);
  // Only what's drawn (or gone): one still waiting loads as usual, and one that failed tries again.
  const shown = app.slice(app.indexOf('function shownMedia('), app.indexOf('function attachmentEl('));
  assert.match(shown, /x\.classList\.contains\('failed'\)/);
  assert.match(shown, /img\[src\], video\[src\], audio\[src\]/);
  // The file's details (its key among them) stay in memory: never in the page's markup.
  assert.match(app, /holder\._att = att;/);
  assert.doesNotMatch(app, /dataset: \{[^}]*\batt\b|data-att/);
  // A picture starts as a placeholder and stops being one when it's drawn, not when it gets an address.
  assert.match(app, /class: `att-media\$\{enc \|\| media === 'img' \? ' locked' : ''\}`/);
  assert.match(app, /if \(media === 'img'\) for \(const ev of \['load', 'error'\]\) el\.addEventListener\(ev, \(\) => holder\.classList\.remove\('locked'\)\);/);
  assert.match(app, /el\.src = u; holder\.classList\.remove\('loading', 'failed'\); if \(media !== 'img'\) holder\.classList\.remove\('locked'\);/);
  // Until then the picture is see-through (no broken-image icon or file name) but still there for screen readers and
  // the keyboard, and a picture whose size is known keeps exactly that size.
  assert.match(css, /\.att-media\.locked \.att-img \{ opacity: 0; \}/);
  assert.doesNotMatch(css, /\.att-media\.locked \.att-img \{[^}]*(display: none|visibility: hidden)/);
  assert.match(css, /\.att-media\.locked:not\(\.sized\) \{ min-width: 220px; min-height: 150px; \}/);
  assert.match(css, /\.att-media\.locked:has\(> \.att-img:focus-visible\) \{ outline: 2px solid var\(--focus\)/);
});
