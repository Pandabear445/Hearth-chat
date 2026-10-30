// Inside the Hearth iPhone app, gives the page what WKWebView lacks on its own: notifications (window.Notification)
// and saving files (<a download> links, handed to the share sheet), notifications while it's closed (iosApp.push, see
// ios-push.js), calls that keep their audio with the screen locked (iosApp.callState) and invite links and shared
// links that open in the app. The same messages as the Android app (android.js), over window.HearthIOS, which the app
// adds to its pages (mobile/ios-native/App/HearthViewController.swift) and answers only for the connect screen and
// the server it was given. Does nothing in browsers, the Android app or the desktop app.
//
// No imports: android.js imports this file (noPayments), so nothing here may import it back. What it needs from
// other modules (the push bridge, the link checks, keeping an update from reloading mid-download) android.js hands
// over with connectIos() as it loads, before any answer from the app can arrive.
const I = window.HearthIOS;
// push: null until the app says it can. ready: settles once the app answered (or didn't in time). onHangUp: set by
// app.js; the system ending the call's audio (a phone call, say) calls it. info: the app's last answer to hello.
export const iosApp = { on: !!I, version: '', notify: 'default', push: null, calls: false, info: null, ready: Promise.resolve(), onHangUp: null, send: () => {} };

let deps = null;
let waiting = [];
const later = (fn) => { if (deps) fn(); else waiting.push(fn); };
// deps: { createPush, openHash, inviteHash, shareHash, underWay } (android.js).
export function connectIos(d) {
  if (deps || !d) return;
  deps = d;
  const w = waiting; waiting = [];
  w.forEach((fn) => fn());
}

if (I) {
  // Native answers come to I.onmessage as { data: JSON }, and, from an app that answers postMessageWithReply, as
  // the reply too (handled the same: every answer can be taken twice).
  const receive = (data) => {
    let m;
    if (typeof data === 'string') { try { m = JSON.parse(data); } catch { return; } } else m = data;
    if (m && typeof m === 'object') later(() => handle(m));
  };
  const send = (msg) => {
    try {
      const r = I.postMessage(JSON.stringify(msg));
      if (r && typeof r.then === 'function') r.then(receive, () => { /* refused: not this page's to send */ });
    } catch { /* app closing */ }
  };
  iosApp.send = send;
  // Opens a place in the app (a tapped notification, an invite link) through the address's #part, which app.js
  // follows (now, or once signed in).
  const go = (hash) => { if (hash && location.hash !== hash) location.hash = hash; };
  let ready;
  iosApp.ready = new Promise((r) => { ready = r; setTimeout(r, 1500); });
  const handle = (m) => {
    if (m.type === 'info') {
      iosApp.info = m;
      iosApp.version = m.version || '';
      iosApp.notify = m.notify || 'default';
      iosApp.calls = m.call === true;
      if (m.push && typeof m.push === 'object' && !iosApp.push) {
        iosApp.push = deps.createPush({ send, initial: m.push });
        // Signed out while the app was closed: this phone mustn't keep a push token for the old account.
        if (m.push.state === 'registered' && !localStorage.getItem('hearth.token')) iosApp.push.unregister();
      }
      go(deps.openHash(m.open));
      go(deps.inviteHash(m.invite));
      go(deps.shareHash(m.share));
      ready();
    } else if (m.type === 'pushState' && iosApp.push) iosApp.push._reply(m);
  };
  I.onmessage = (e) => receive(e && e.data);
  // v: 3, as in the Android app: notification taps, invites and shared links are taken in place.
  send({ type: 'hello', v: 3 });
  iosApp.switchServer = () => send({ type: 'changeServer' });
  iosApp.cancel = (tag) => send({ type: 'cancel', tag: String(tag) });
  window.addEventListener('hearth-push', (e) => later(() => { if (iosApp.push) iosApp.push._event(e.detail); }));
  window.addEventListener('hearth-open', (e) => later(() => go(deps.openHash(e.detail))));
  window.addEventListener('hearth-invite', (e) => later(() => go(deps.inviteHash(e.detail))));
  window.addEventListener('hearth-share', (e) => later(() => go(deps.shareHash(e.detail))));
  window.addEventListener('hearth-hangup', () => { if (typeof iosApp.onHangUp === 'function') iosApp.onHangUp(); });

  // ---- calls: while one is on, the app keeps an audio session for it, so the call keeps going with the screen
  // locked or Hearth in the background (as long as iOS lets the web view keep its microphone).
  let inCall = false; let callTitle = '';
  iosApp.callState = ({ inCall: on, title = '' } = {}) => {
    const t = String(title || '').slice(0, 120);
    if (on && (!inCall || t !== callTitle)) send({ type: 'callStart', title: t });
    else if (!on && inCall) send({ type: 'callEnd' });
    inCall = !!on; callTitle = t;
  };
  // Leaving the page (a reload, switching server) ends the call in it. (The app also ends it when the next page
  // starts loading, in case this message doesn't get out in time.)
  window.addEventListener('pagehide', () => { if (inCall) { inCall = false; send({ type: 'callEnd' }); } });

  // ---- notifications
  const open = new Map();
  let asking = [];
  window.addEventListener('hearth-notify-permission', (e) => {
    iosApp.notify = e.detail || 'default';
    const w = asking; asking = [];
    for (const r of w) r(iosApp.notify);
  });
  window.addEventListener('hearth-notification-click', (e) => {
    const n = open.get(e.detail);
    if (n && typeof n.onclick === 'function') n.onclick({ target: n });
  });
  class AppNotification {
    static get permission() { return iosApp.notify; }
    static requestPermission() {
      return new Promise((resolve) => {
        if (iosApp.notify === 'granted') return resolve('granted');
        asking.push(resolve);
        send({ type: 'askNotify' });
      });
    }
    constructor(title, opts = {}) {
      this.title = String(title || 'Hearth');
      this.body = String(opts.body || '');
      this.tag = String(opts.tag || `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
      this.onclick = null;
      open.set(this.tag, this);
      if (open.size > 200) open.delete(open.keys().next().value);
      send({ type: 'notify', title: this.title, body: this.body, tag: this.tag });
    }
    close() { open.delete(this.tag); send({ type: 'cancel', tag: this.tag }); }
  }
  window.Notification = AppNotification;

  // ---- downloads: the web view ignores <a download>, so hand the bytes to the app in chunks (it then offers the
  // share sheet: Save to Files, Photos, AirDrop)
  const CHUNK = 384 * 1024;
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  // The page's security policy doesn't let fetch() read blob: URLs, so remember the blob behind each one.
  const blobs = new Map();
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = (obj) => { const u = createURL.call(URL, obj); if (obj instanceof Blob) blobs.set(u, obj); return u; };
  URL.revokeObjectURL = (u) => { setTimeout(() => blobs.delete(u), 60000); return revokeURL.call(URL, u); };
  const fromData = (href) => {
    const [head, body = ''] = href.split(',');
    const type = (head.match(/^data:([^;,]*)/) || [])[1] || '';
    const bin = /;base64/.test(head) ? atob(body) : decodeURIComponent(body);
    return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0) & 255)], { type });
  };
  async function save(href, name) {
    const blob = href.startsWith('blob:') ? blobs.get(href) : href.startsWith('data:') ? fromData(href) : await (await fetch(href)).blob();
    if (!blob) throw new Error('file gone');
    const id = `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    send({ type: 'saveStart', id, name: name || 'file', mime: blob.type || 'application/octet-stream' });
    for (let at = 0; at < blob.size; at += CHUNK) {
      send({ type: 'saveChunk', id, data: b64(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer())) });
    }
    send({ type: 'saveEnd', id });
  }
  // A download in progress holds off an automatic update's reload (auto-update.js, through android.js).
  const track = (p) => (deps && deps.underWay ? deps.underWay(p) : p);
  const savable = (a) => a && a.hasAttribute('download') && (/^(blob|data):/.test(a.href) || a.origin === location.origin);
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (savable(this)) { track(save(this.href, this.getAttribute('download'))).catch(() => {}); return; }
    return click.call(this);
  };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[download]');
    if (!savable(a)) return;
    e.preventDefault();
    track(save(a.href, a.getAttribute('download'))).catch(() => {});
  }, true);
}
