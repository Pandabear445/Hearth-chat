// Updates put themselves in place (public/js/auto-update.js): when an open Hearth reloads into a new version, with a
// fake clock. test/e2e flows.mjs updateBar drives the real thing in a browser, against a server that was updated.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let U;
before(async () => { U = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'auto-update.js')).href); });

// An updater on a fake clock. state: what the page is like (hidden, what's under way, when it last updated).
function rig(state = {}) {
  let t = 1_000_000;
  let timers = [];
  const applied = [];
  const s = { hidden: false, blocked: null, lastApplied: 0, ...state };
  const u = U.createUpdater({
    now: () => t,
    hidden: () => s.hidden,
    blockedBy: () => s.blocked,
    lastApplied: () => s.lastApplied,
    apply: (v) => applied.push({ v, at: t }),
    setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; },
    clearTimer: (x) => { timers = timers.filter((y) => y !== x); },
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((x) => x !== next);
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { u, s, applied, advance, now: () => t, timers: () => timers.length };
}

test('nobody has touched Hearth since it opened: the new version goes in right away', () => {
  const r = rig();
  r.u.due('1.31.0');
  assert.deepEqual(r.applied.map((a) => a.v), ['1.31.0']);
  assert.equal(r.u.pending(), false);
  assert.equal(r.timers(), 0);
});

test('someone using it: it waits until they have left it alone for a while, then reloads once', () => {
  const r = rig();
  r.u.input();
  r.u.due('1.31.0');
  assert.equal(r.applied.length, 0);
  r.advance(U.IDLE_MS - 1000);
  r.u.input(); // still using it: the wait starts over
  r.advance(U.IDLE_MS - 1000);
  assert.equal(r.applied.length, 0, 'not while they keep using it');
  r.advance(1000);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].at - r.now(), 0);
  r.advance(10 * U.IDLE_MS);
  assert.equal(r.applied.length, 1, 'only once');
});

test('out of sight: right away, also when it goes out of sight while waiting', () => {
  const hiddenNow = rig({ hidden: true });
  hiddenNow.u.input();
  hiddenNow.u.due('1.31.0');
  assert.equal(hiddenNow.applied.length, 1);

  const r = rig();
  r.u.input();
  r.u.due('1.31.0');
  r.advance(3000);
  assert.equal(r.applied.length, 0);
  r.s.hidden = true;
  r.u.poke();
  assert.equal(r.applied.length, 1);
});

test('never while something is under way (a call, a dialog…), out of sight or not; right after it ends', () => {
  const r = rig({ blocked: 'call', hidden: true });
  r.u.due('1.31.0', { soon: true });
  r.advance(60 * 60 * 1000);
  assert.equal(r.applied.length, 0, 'an hour-long call is never cut off');
  assert.equal(r.u.pending(), true);
  r.s.blocked = null;
  r.advance(U.RETRY_MS);
  assert.equal(r.applied.length, 1, 'it notices within a few seconds that the call ended');
});

test('the server just came back from its update: right away, even while someone is typing', () => {
  const r = rig();
  r.u.input();
  r.u.due('1.31.0', { soon: true });
  assert.equal(r.applied.length, 1);
});

test('at most one reload every couple of minutes from a new version found in the background', () => {
  const r = rig();
  r.s.lastApplied = r.now() - 1000;
  r.u.due();
  assert.equal(r.applied.length, 0);
  r.advance(U.MIN_GAP_MS - 2000);
  assert.equal(r.applied.length, 0);
  r.advance(1000);
  assert.equal(r.applied.length, 1);
  // …but the server's own "I was updated" isn't held back (after a reload the page has the server's version).
  const s = rig();
  s.s.lastApplied = s.now() - 1000;
  s.u.due('1.31.0', { soon: true });
  assert.equal(s.applied.length, 1);
});

test('told twice: one reload, keeping the version number and the hurry', () => {
  const r = rig({ blocked: 'dialog' });
  r.u.due('1.31.0', { soon: true });
  r.u.due();
  r.s.blocked = null;
  r.u.input();
  r.advance(U.RETRY_MS);
  assert.deepEqual(r.applied.map((a) => a.v), ['1.31.0']);
});

test('the web app has no reload bar left to click; the desktop app still asks before installing a program', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  for (const gone of ['A new version of Hearth is ready', 'Hearth was updated.', 'Reload after your call']) assert.ok(!app.includes(gone), gone);
  const bars = [...app.matchAll(/class: '(update-bar[^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(bars, ['update-bar app-update']);
  // Reloading never cuts off a call, a recording, an upload, a message being sent or an open dialog.
  const blocked = app.slice(app.indexOf('function updateBlockedBy()'), app.indexOf('const autoUpdate = createUpdater'));
  for (const what of ['voice.channelId', 'voice.joinPromise', 'ringing.size', 'pendingSends.size', 'jobsUnderWay()', '.rec-bar', '.pending-files', '.reply-bar',
    '.upload-status', '.att-meter', 'voicePlaying()', "'video, audio'", 'choosingFile', "'study'", "'admin'", '.viewer', '.settings', 'modal-backdrop', '.save-bar', '#auth']) assert.ok(blocked.includes(what), what);
});

test('jobs that say they are under way hold updates back until they finish, also when they fail', async () => {
  assert.equal(U.jobsUnderWay(), false);
  let finish;
  const p = U.underWay(new Promise((resolve) => { finish = resolve; }));
  const q = U.underWay(Promise.reject(new Error('nope')));
  assert.equal(U.jobsUnderWay(), true);
  await assert.rejects(q, /nope/);
  assert.equal(U.jobsUnderWay(), true, 'the other one is still going');
  finish(42);
  assert.equal(await p, 42, 'the result passes through');
  assert.equal(U.jobsUnderWay(), false);
});
