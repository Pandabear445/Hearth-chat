// The page's start-up guard (index.html loads it async, beside the app). A plain script with no imports, so it runs
// even when the app's own modules can't: if one of app.js's files fails to arrive, the browser keeps that failure for
// as long as the page is open, app.js never runs, and nothing it does (bootFailed included) can help. Only loading
// the page again does. So this does it, once: a second failure in a row says so in the splash, with its Reload button.
// (app.js sets window.__cindrlyBooted as it starts.) It never touches the app's data, keys or the server.
(() => {
  const KEY = 'cindrly.bootRetry';
  const AGAIN_MS = 60000; // one automatic reload per this long: never a loop
  const STUCK_MS = 20000; // app files served by the service worker (from this device) and still nothing: stuck
  const splash = () => document.getElementById('boot-splash');
  const booted = () => window.__cindrlyBooted === true;
  const lastRetry = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } };
  const markRetry = () => { try { sessionStorage.setItem(KEY, String(Date.now())); return true; } catch { return false; } };
  const clearRetry = () => { try { sessionStorage.removeItem(KEY); } catch { /* storage off */ } };
  let appFailed = false;
  let decided = false;

  function showFailed() {
    const el = splash();
    if (!el) return;
    el.classList.add('failed');
    const t = el.querySelector('.boot-text');
    if (t) t.textContent = 'Cindrly couldn’t start. Reload the page to try again.';
  }
  function recover(why) {
    if (booted() || !splash()) return;
    const last = lastRetry();
    if (!(last && Date.now() - last < AGAIN_MS) && markRetry()) {
      console.warn(`Cindrly: ${why}; loading the page again.`);
      location.reload();
      return;
    }
    showFailed();
  }
  // The page has finished with its scripts (app.js has run, or failed to load): did the app start?
  function settled() {
    if (decided) return;
    decided = true;
    if (booted()) { clearRetry(); return; }
    recover(appFailed ? 'the app’s files didn’t load' : 'the app didn’t start');
  }

  // A module script that couldn't be fetched fires only this (no window error, nothing in the console).
  addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'SCRIPT' && /\/js\/app\.js$/.test(t.src || '')) appFailed = true;
  }, true);
  // Module scripts run before DOMContentLoaded; an async script can come in after it, so 'load' and the state too.
  // ('interactive' alone isn't enough: the page is that before its deferred scripts have run.)
  if (document.readyState === 'complete') settled();
  else { addEventListener('DOMContentLoaded', settled, { once: true }); addEventListener('load', settled, { once: true }); }
  // A file that never arrives at all (DOMContentLoaded never comes): with the app's files on this device (a service
  // worker answers them), this long means stuck, so try once more. Otherwise the slow network may still deliver, and
  // the splash's Reload button (shown after 15 s, ux-onboarding.css) is there.
  setTimeout(() => {
    if (decided || booted() || !splash()) return;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) recover('the app’s files didn’t arrive');
  }, STUCK_MS);

  // The splash's Reload button: a link to / that works with no script at all; here it reloads this address instead
  // (an invite or shared link stays).
  addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('#boot-splash .boot-reload') : null;
    if (!a) return;
    e.preventDefault();
    location.reload();
  });
})();
