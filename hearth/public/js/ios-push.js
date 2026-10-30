// Notifications while the Hearth iPhone app is closed. The app gets a device token from Apple's push service (APNs)
// and makes this server's own encryption keys (a P-256 key and an auth secret, kept in the phone's Keychain); this
// page subscribes them with the server like a browser's push address (POST /api/push/subscribe, type 'apns'). The
// server sends Apple a notice that says only "New message" plus the real notification encrypted to those keys, and
// the app's notification extension decrypts it on the phone. The sign-in token never leaves the page. No DOM here,
// so it's tested in Node (test/ios-web.test.js).
//
// The app's push state, in its answers to pushState / pushRegister / pushUnregister and in hearth-push events:
// { state: 'none' | 'pending' | 'registered' | 'blocked' | 'failed', reason?, token?, environment?,
//   keys?: { p256dh, auth }, previous? } (token: hex; environment: 'production' or 'sandbox'; previous: the token
// this one replaced).

// Where a tapped notification may take you, and invite links: the same rules as the Android app's.
export { OPEN_RE, safeOpenHash, safeInviteHash } from './android-push.js';

// What the person is told when it doesn't work, by reason code.
export const reasonText = {
  blocked: 'Notifications are off for Hearth in iPhone Settings. Turn them on in Settings → Notifications → Hearth, then try again.',
  noApns: 'This server can’t send iPhone notifications (apnsEnabled is false). Its owner has to set up Apple push first.',
  NETWORK: 'Couldn’t reach Apple’s push service. Check your connection and try again.',
  INTERNAL_ERROR: 'Something went wrong setting up notifications. Try again.',
  NO_KEYS: 'Something went wrong setting up notifications. Try again.',
  UNREGISTERED: 'Apple stopped delivering Hearth’s notifications to this iPhone. Turn them on again.',
  CANCELLED: '',
  timeout: 'Couldn’t reach Apple’s push service. Check your connection and try again.',
};

// The address the server keeps for this phone (server/apns.js): there is no URL, so it's made from the token.
export const apnsEndpoint = (st) => (st && st.token && st.environment ? `apns:${st.environment}:${String(st.token).toLowerCase()}` : '');

// A complete registration: a token Apple gave, which environment it's for, and this server's keys.
const TOKEN = /^[0-9a-f]{64,200}$/i;
const B64URL = /^[A-Za-z0-9_-]+=*$/;
export function registration(st) {
  if (!st || st.state !== 'registered' || !TOKEN.test(String(st.token || ''))) return null;
  if (st.environment !== 'production' && st.environment !== 'sandbox') return null;
  const keys = st.keys || {};
  if (!B64URL.test(String(keys.p256dh || '')) || !B64URL.test(String(keys.auth || ''))) return null;
  return { token: String(st.token).toLowerCase(), environment: st.environment, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// The error a registration ends with, from the app's state ({ state, reason }); null while it's still going.
export function failureOf(st) {
  if (!st || st.state === 'pending' || st.state === 'registered') return null;
  if (st.state === 'blocked') return 'blocked';
  if (st.state === 'failed') return st.reason || 'INTERNAL_ERROR';
  return st.reason === 'CANCELLED' ? 'CANCELLED' : st.reason || 'UNREGISTERED';
}
const fail = (code) => Object.assign(new Error(reasonText[code] || reasonText.INTERNAL_ERROR), { code });

// send(msg): posts to the app. initial: the push state the app gave in its first answer.
export function createIosPush({ send, initial = null, timeoutMs = 30000, stateMs = 3000, unregisterMs = 2000 }) {
  let last = initial || { state: 'none' };
  const listeners = new Set();
  let stateWaiters = [];
  let reg = null; // the registration being waited for: { resolve, reject, timer }

  const finishReg = (st) => {
    if (!reg) return;
    const ok = registration(st);
    if (ok) { const r = reg; reg = null; clearTimeout(r.timer); r.resolve({ ...st, ...ok }); return; }
    // Registered but missing its token or keys: that's the app's fault, not a reason to wait.
    const code = st.state === 'registered' ? 'NO_KEYS' : failureOf(st);
    if (code) { const r = reg; reg = null; clearTimeout(r.timer); r.reject(fail(code)); }
  };
  const take = (st) => {
    if (!st || typeof st !== 'object') return;
    last = st;
    const w = stateWaiters; stateWaiters = [];
    w.forEach((x) => { clearTimeout(x.timer); x.resolve(st); });
    finishReg(st);
  };

  return {
    get last() { return last; },
    // The app's current state (or the last one known, if it doesn't answer in time).
    state() {
      return new Promise((resolve) => {
        const x = { resolve, timer: setTimeout(() => { stateWaiters = stateWaiters.filter((y) => y !== x); resolve(last); }, stateMs) };
        stateWaiters.push(x);
        send({ type: 'pushState' });
      });
    },
    // Asks the app for a device token and this server's keys (iOS asks the person first if it never has).
    // Resolves with { token, environment, keys: { p256dh, auth }, previous?, ... }.
    register() {
      if (reg) { clearTimeout(reg.timer); reg.reject(fail('CANCELLED')); reg = null; }
      return new Promise((resolve, reject) => {
        reg = { resolve, reject, timer: setTimeout(() => { if (reg) { reg = null; reject(fail('timeout')); } }, timeoutMs) };
        send({ type: 'pushRegister' });
      });
    },
    // Removes this phone's registration for this server, keys too (resolves when done, or after a moment regardless).
    unregister() {
      return new Promise((resolve) => {
        const x = { resolve: () => resolve(), timer: setTimeout(() => { stateWaiters = stateWaiters.filter((y) => y !== x); resolve(); }, unregisterMs) };
        stateWaiters.push(x);
        send({ type: 'pushUnregister' });
      });
    },
    // Called for every change the app reports by itself (a new token from Apple, notifications turned off).
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    _reply(msg) { take(msg); },
    _event(detail) { take(detail); if (detail && typeof detail === 'object') listeners.forEach((cb) => { try { cb(detail); } catch { /* one listener */ } }); },
  };
}
