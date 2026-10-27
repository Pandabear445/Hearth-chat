// Uploads wait and try again when the server says "too many at once" (a message with many files sends many uploads in
// a row; the server's owner can send 100), as long as it asks, but not for an hour: then they stop and say so. A
// connection that keeps failing gives up after a few tries. Downloads stop as soon as a file turns out bigger than
// its message says. public/js/files.js runs here as it is, against a stand-in for the network.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let F;
let answers = []; // what the "server" answers next: { status, body, retryAfter } or 'network'
let asked = 0;
class FakeXHR {
  constructor() { this.upload = {}; this.status = 0; this.responseText = ''; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader() {}
  getResponseHeader(name) { return name === 'Retry-After' && this.retryAfter ? String(this.retryAfter) : null; }
  abort() { this.aborted = true; if (this.onabort) this.onabort(); }
  send() {
    asked++;
    const a = answers.shift();
    setTimeout(() => {
      if (this.aborted) return;
      if (!a || a === 'network') { this.onerror(); return; }
      this.status = a.status; this.responseText = JSON.stringify(a.body || {}); this.retryAfter = a.retryAfter || 0;
      this.onload();
    }, 1);
  }
}

before(async () => {
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.XMLHttpRequest = FakeXHR;
  F = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'files.js')).href);
});
beforeEach(() => { answers = []; asked = 0; });
const bytes = new Uint8Array(1000);

test('"too many at once": waits as long as the server asks, says so, then carries on', async () => {
  answers = [{ status: 429, body: { error: 'Too many attempts.' }, retryAfter: 1 }, { status: 200, body: { url: '/uploads/abc.bin' } }];
  const seen = [];
  const t = Date.now();
  const url = await F.uploadSimple(bytes, { onStatus: (s) => seen.push(s) });
  assert.equal(url, '/uploads/abc.bin');
  assert.ok(Date.now() - t >= 950, 'it waited the second the server asked for');
  assert.deepEqual(seen, [{ retrying: true, wait: 1000, rate: true }, { retrying: false }]);
});

test('asked to wait for an hour: it stops at once with the server’s words, big files too', async () => {
  answers = [{ status: 429, body: { error: 'Too many attempts. Try again in 60 minutes.' }, retryAfter: 3600 }];
  const t = Date.now();
  await assert.rejects(F.uploadSimple(bytes), /Try again in 60 minutes/);
  answers = [{ status: 429, body: { error: 'Too many attempts. Try again in 60 minutes.' }, retryAfter: 3600 }];
  await assert.rejects(F.uploadResumable(bytes), /Try again in 60 minutes/);
  assert.ok(Date.now() - t < 1000);
});

test('a connection that keeps failing gives up after a few tries; a refusal at once', async () => {
  answers = ['network', 'network', 'network', 'network', { status: 200, body: { url: '/uploads/late.bin' } }];
  await assert.rejects(F.uploadSimple(bytes), /Check your connection/);
  assert.equal(asked, 4, 'three waits (1, 2 and 4 seconds), then it stops');
  answers = [{ status: 413, body: { error: 'That file is too big.' } }];
  await assert.rejects(F.uploadSimple(bytes), /too big/);
  assert.equal(asked, 5, 'a refusal isn’t tried again');
});

test('a download stops as soon as the file is bigger than its message says', async () => {
  const body = (n, chunk = 64 * 1024) => new ReadableStream({
    start(c) { for (let i = 0; i < n; i += chunk) c.enqueue(new Uint8Array(Math.min(chunk, n - i))); c.close(); },
  });
  global.fetch = async () => new Response(body(5000000), { headers: { 'Content-Length': '5000000' } });
  await assert.rejects(F.download('/uploads/x.bin', { max: 1000000 }), (e) => e.code === 'too_big');
  // Without a length up front, while it comes in.
  let read = 0;
  global.fetch = async () => new Response(new ReadableStream({
    pull(c) { read += 65536; if (read > 8000000) c.close(); else c.enqueue(new Uint8Array(65536)); },
  }));
  await assert.rejects(F.download('/uploads/y.bin', { max: 1000000 }), (e) => e.code === 'too_big');
  assert.ok(read < 2000000, `it stopped early (read ${read} bytes)`);
  // As big as it says: fine.
  global.fetch = async () => new Response(body(300000), { headers: { 'Content-Length': '300000' } });
  assert.equal((await F.download('/uploads/z.bin', { max: 300000 })).byteLength, 300000);
});
