// A new version of Hearth puts itself in place: the page reloads into it by itself (app.js updateAndReload keeps
// where you were and anything half-typed), with no bar to click. It picks a moment that interrupts nothing:
//  - right away while Hearth is out of sight, or when nobody has touched it since it opened;
//  - right away when the server has just come back from its update (people saw "Updating Hearth…" already);
//  - otherwise once it has been left alone for IDLE_MS;
//  - never while something is under way (blockedBy: a call, a recording, an upload, a message still sending, an
//    open dialog, unsaved changes…): it looks again every RETRY_MS until that's done;
//  - at most once every MIN_GAP_MS, so a version that somehow keeps looking new can't reload over and over (the
//    server's own "I was updated" can't do that: after the reload the page has the server's version).
// Everything it depends on is passed in, so test/auto-update.test.js runs it with a fake clock.
export const IDLE_MS = 20000;
export const RETRY_MS = 5000;
export const MIN_GAP_MS = 120000;

export function createUpdater({ now = () => Date.now(), hidden, blockedBy, apply, lastApplied = () => 0,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let due = null; // { version, soon } once a newer version is waiting
  let timer = null;
  let lastInput = 0; // never touched since it opened
  const check = () => {
    timer = null;
    if (!due) return;
    const t = now();
    let wait;
    if (blockedBy()) wait = RETRY_MS;
    else if (due.soon || hidden()) wait = 0;
    else wait = Math.max(0, lastInput + IDLE_MS - t);
    if (wait === 0 && !due.soon) wait = Math.max(0, lastApplied() + MIN_GAP_MS - t);
    if (wait > 0) { timer = setTimer(check, wait); return; }
    const { version } = due;
    due = null;
    apply(version);
  };
  const recheck = () => { if (timer) clearTimer(timer); timer = null; check(); };
  return {
    // A newer version is ready (version: its number, when known). soon: switch as soon as nothing is under way.
    due(version, { soon = false } = {}) {
      due = { version: version || (due && due.version) || '', soon: soon || !!(due && due.soon) };
      recheck();
    },
    // The person did something (a key, a tap, the wheel…): wait for them to leave it alone again.
    input() { lastInput = now(); },
    // Something changed that may make now a good moment (Hearth went out of sight, say).
    poke() { if (due) recheck(); },
    pending: () => !!due,
  };
}

// Jobs elsewhere in the app that a reload would cut off say they're under way here, so an update waits for them (a
// message being delivered, a backup or an export downloading, the Android app saving a file). underWay(promise)
// passes the promise through.
let jobs = 0;
export function underWay(p) { jobs++; return Promise.resolve(p).finally(() => { jobs--; }); }
export const jobsUnderWay = () => jobs > 0;
