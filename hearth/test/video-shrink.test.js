// Videos over the server's limit are made smaller on the device before they're sent (public/js/video-shrink.js): what
// size and bitrate a video gets, which format the browser records, and when a video is too long to fit. The recording
// itself needs a browser: test/e2e flows.mjs videoShrink sends one.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let V;
before(async () => { V = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'video-shrink.js')).href); });
const MB = 1024 * 1024;

test('a phone video fits the limit: up to 1280 px, its shape kept, bits to spare', () => {
  // Half a minute of 1080p portrait (a phone held upright), 25 MB limit.
  const p = V.plan({ duration: 30, width: 1080, height: 1920, maxBytes: 25 * MB });
  assert.deepEqual([p.width, p.height], [720, 1280]);
  assert.equal(p.videoBps, V.MAX_VIDEO_BPS, 'the best quality there is, since it fits easily');
  assert.ok(((p.videoBps + p.audioBps) * 30) / 8 < 25 * MB * 0.9, 'with room to spare');
  // Never bigger than it was.
  const small = V.plan({ duration: 10, width: 640, height: 360, maxBytes: 25 * MB });
  assert.deepEqual([small.width, small.height], [640, 360]);
});

test('a longer video gets fewer bits and fewer pixels, until it would be mush: then it doesn’t fit', () => {
  const sizes = [60, 180, 400].map((duration) => V.plan({ duration, width: 1920, height: 1080, maxBytes: 25 * MB }));
  assert.ok(sizes[0].videoBps > sizes[1].videoBps && sizes[1].videoBps > sizes[2].videoBps);
  assert.ok(sizes[0].width >= sizes[1].width && sizes[1].width >= sizes[2].width);
  assert.equal(sizes[2].width, 640);
  for (const [i, d] of [60, 180, 400].entries()) assert.ok(((sizes[i].videoBps + sizes[i].audioBps) * d) / 8 <= 25 * MB * 0.85 + 64, `${d} s fits`);
  assert.equal(V.plan({ duration: 20 * 60, width: 1920, height: 1080, maxBytes: 25 * MB }), null, '20 minutes don’t fit in 25 MB');
  // What the app says fits: right at that length it still does, a bit over it doesn't.
  const most = V.longestFitting(25 * MB);
  assert.ok(V.plan({ duration: most, width: 1920, height: 1080, maxBytes: 25 * MB }));
  assert.equal(V.plan({ duration: most * 1.2, width: 1920, height: 1080, maxBytes: 25 * MB }), null);
  // A length the browser couldn't read (a live recording) isn't guessed at.
  for (const duration of [0, NaN, Infinity]) assert.equal(V.plan({ duration, width: 1280, height: 720, maxBytes: 25 * MB }), null);
});

test('the recording format: MP4 where the browser can, otherwise WebM, otherwise none', () => {
  assert.equal(V.pickType((t) => t.startsWith('video/mp4;codecs=avc1')), 'video/mp4;codecs=avc1.42E01F,mp4a.40.2');
  assert.equal(V.pickType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
  assert.equal(V.pickType(() => false), null);
  assert.equal(V.pickType(() => { throw new Error('no'); }), null, 'a browser that throws counts as no');
  assert.equal(V.canShrink(), false, 'without a browser it can’t');
});
