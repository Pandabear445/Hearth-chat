// Brainrot mode (docs/design/BRAINROT.md): the content on top (a reel, the watch-together video, the call), and
// gameplay that plays itself underneath, with extras stacked on by a "stimulation" slider. One surface per place
// it can be turned on: the Reels tab (reels-ui.js), the watch-together player (watch.js) and the call (app.js).
//
// - Off by default, per account and per place; the first time it's turned on, a warning says what it does.
// - The gameplay is drawn here, in code (brainrot-games.js): nothing is loaded. "Your own background" is a YouTube
//   video, muted and looping, loaded (from youtube-nocookie.com, sandboxed) only after a tap that says so.
// - Never more than 3 flashes in a second (WCAG 2.3.1: every flash and shake asks the limiter first). Reduced motion
//   (the device's or Hearth's own setting): slower, no shake or flash, the slider at most 1.
// - Esc or ✕ turns it off. Sounds are made here (WebAudio), only after this person turns them on, and never kept
//   on across a reload; nothing plays on its own.
// - Paused whenever it isn't on screen (another tab, scrolled away, a mini player) or the page is hidden; the
//   canvas resolution is capped, lower on low-power devices, and lowered again if frames come too slowly.
// - Scroll together: whoever controls can turn it on for everyone (reels:brainrot, a yes/no and nothing else);
//   anyone can turn it off for themselves, and someone who was never warned is asked first.
import { h, clear, icon, toast } from './util.js';
import { modal } from './ui.js';
import { youtubeAdapter } from './watch.js';
import { GAMES, GAME_NAMES, LEVELS, MAX_LEVEL, RAIN, flashLimiter, effectiveLevel, cleanPrefs, youtubeVideoId, captionChunks, rainDrop } from './brainrot-games.js';

// ---- settings: one set per account on this device (which game, the level, the YouTube video, warned, and
// whether it's on in each place). Sounds aren't kept: they're off again after a reload.
const KEY = (uid) => `hearth.brainrot.${uid || 'anon'}`;
let cache = null; let cacheUid;
export function prefs(uid) {
  if (!cache || cacheUid !== uid) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY(uid)) || 'null'); } catch { /* private mode, or broken */ }
    cache = cleanPrefs(raw); cacheUid = uid;
  }
  return cache;
}
function save(uid, patch) {
  const was = prefs(uid);
  cache = cleanPrefs({ ...was, ...patch, on: { ...was.on, ...(patch.on || {}) } });
  try { localStorage.setItem(KEY(uid), JSON.stringify(cache)); } catch { /* kept for this visit only */ }
  for (const s of surfaces) s.sync();
}
let sounds = false; // this visit only
let ytConsented = false; // "Load background": for as long as Hearth is open

const readMotion = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
// Read once and kept up to date by wire() (it's asked several times a frame).
let motionNow = null;
export const reducedMotion = () => (motionNow === null ? (motionNow = readMotion()) : motionNow);
const lowPower = () => (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || !!(navigator.connection && navigator.connection.saveData);

// ---- every surface, for Esc and for settings changed elsewhere
const surfaces = new Set();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  // Esc turns off the one on screen (its settings first, if they're open), but only when it's free: nothing else
  // was open for it to close (a dialog, menu, sheet, the phone's navigation drawer) and focus isn't in a text field
  // or elsewhere in the app. That's judged before anyone handles the key (capture), as those close straight away.
  let free = false;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const a = document.activeElement;
    free = !e.shiftKey && !document.querySelector('.modal-backdrop, .popover, .sheet-backdrop') && !document.body.classList.contains('nav-open')
      && !(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.closest('.br-panel')));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !free) return;
    free = false;
    const s = [...surfaces].reverse().find((x) => x.isActive() && x.onScreen() && x.owns(document.activeElement));
    if (s) { e.preventDefault(); s.escape(); }
  });
  // Reduced motion changed (the device's setting, or Hearth's own: a class on <html>).
  const again = () => { const now = readMotion(); if (now === motionNow) return; motionNow = now; for (const s of surfaces) s.sync(true); };
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', again); } catch { /* old browsers */ }
  motionNow = readMotion();
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // Sounds: the audio device is let go whenever nothing can play (hidden, off, nothing running).
  document.addEventListener('visibilitychange', audioIdle);
}

// The one-time warning. Resolves true if they turn it on.
function warn(uid) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title: 'Turn on Brainrot mode?', size: 'sm', className: 'br-warn',
      body: h('div', { class: 'stack' },
        h('p', null, 'Gameplay plays under the video. Turn the stimulation up and you also get falling emoji, a score counter, big bouncing captions and a little shake when people react.'),
        h('p', null, 'It moves a lot. It never flashes more than 3 times a second, and with reduced motion (your device’s or Hearth’s) it’s slower and calmer, with no shake.'),
        h('p', { class: 'muted-p' }, 'Esc or ✕ turns it off. Sounds stay off unless you turn them on.')),
      actions: [{ label: 'Not now' }, { label: 'Turn it on', kind: 'primary', action: () => { ok = true; save(uid, { warned: true }); } }],
      onClose: () => resolve(ok),
    });
  });
}

// ---- sounds, made here (no recordings): a deep boom, a coin ding, a three-note horn, a whoosh
let audio = null; let lastSound = 0; let lastHorn = 0;
function audioCtx() {
  if (!audio) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; audio = new A(); }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
function audioIdle() {
  if (audio && audio.state === 'running' && (!sounds || document.hidden || ![...surfaces].some((s) => s.isRunning()))) audio.suspend().catch(() => {});
}
function play(kind) {
  if (!sounds || !audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const now = performance.now();
  if (now - lastSound < 90) return;
  if (kind === 'horn') { if (now - lastHorn < 4000) return; lastHorn = now; }
  lastSound = now;
  const a = audio; const t = a.currentTime;
  const out = a.createGain(); out.gain.value = 0.22; out.connect(a.destination);
  const tone = (type, f0, f1, start, dur, vol = 1) => {
    const o = a.createOscillator(); const g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t + start); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + start + dur);
    g.gain.setValueAtTime(0.0001, t + start); g.gain.exponentialRampToValueAtTime(vol, t + start + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g); g.connect(out); o.start(t + start); o.stop(t + start + dur + 0.02);
  };
  const noise = (start, dur, from, to, vol = 0.5) => {
    const len = Math.ceil(a.sampleRate * dur); const buf = a.createBuffer(1, len, a.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(from, t + start); f.frequency.exponentialRampToValueAtTime(to, t + start + dur);
    const g = a.createGain(); g.gain.setValueAtTime(vol, t + start); g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    src.connect(f); f.connect(g); g.connect(out); src.start(t + start);
  };
  if (kind === 'boom') { tone('sine', 140, 38, 0, 0.7, 1); noise(0, 0.25, 900, 120, 0.4); }
  else if (kind === 'ding') { tone('triangle', 1320, 1320, 0, 0.12, 0.5); tone('triangle', 1760, 1760, 0.06, 0.18, 0.4); }
  else if (kind === 'horn') { for (const [k, at] of [[0, 0], [1, 0.16], [2, 0.32]]) for (const f of [440, 554, 659]) tone('sawtooth', f * (k === 2 ? 1.12 : 1), f * (k === 2 ? 1.12 : 1), at, k === 2 ? 0.45 : 0.12, 0.25); }
  else if (kind === 'whoosh') noise(0, 0.35, 300, 2400, 0.35);
}

// The emoji for the rain, drawn once each (the device's own emoji font) and reused every frame.
const sprites = new Map();
function sprite(i, px) {
  const k = `${i}:${px}`;
  if (sprites.has(k)) return sprites.get(k);
  const c = document.createElement('canvas'); c.width = c.height = px;
  const x = c.getContext('2d'); x.font = `${Math.floor(px * 0.82)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(RAIN[i], px / 2, px / 2 + px * 0.04);
  if (sprites.size > 40) sprites.clear();
  sprites.set(k, c);
  return c;
}

// ---- one surface
// opts:
//   kind: 'reels' | 'watch' | 'call' (each turned on separately)
//   frame: the element split in two (it gets br-on and br-row or br-col); el goes inside it, where the caller puts it
//   me(): this person's id;  available(): whether there's anything to split right now (default: always)
//   row(w, h): beside (true) or below (false) for a frame this size
//   caption(): the content's title, for the captions;  progress(): 0 to 1 through the content, or null
//   share: { can(): may this person turn it on for everyone, set(on) }  (scroll together only)
//   nameOf(id), onLayout(): after the split changes (the Reels tab snaps back to its video), onChange(): redraw the bar
//   focusToggle(): put focus on the place's own toggle (when the host doesn't draw barItems)
export function createBrainrot(opts) {
  wire();
  const o = { available: () => true, row: (w, hgt) => w >= 720 && w > hgt * 1.25, caption: () => '', progress: () => null, onLayout: () => {}, nameOf: () => 'Someone', ...opts };
  const uid = () => (o.me && o.me()) || 'anon';
  const P = () => prefs(uid());
  const limiter = flashLimiter(3, 1000);
  const self = { session: { on: false, by: '' }, choice: null, active: false, visible: false, raf: 0, last: 0, game: null, gameKey: '', yt: null, ytId: '', quality: 1, slowFrames: 0,
    w: 0, h: 0, score: 0, combo: 0, shown: { score: -1, combo: -1, prog: -1 }, cap: { text: null, chunks: [], at: 0, i: 0 }, ticks: 0, frames: 0, panel: false, dead: false };

  const canvas = h('canvas', { class: 'br-canvas', 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const stage = h('div', { class: 'br-stage' });
  const prog = h('i');
  const progEl = h('div', { class: 'br-prog', hidden: true }, prog);
  const scoreEl = h('div', { class: 'br-score', hidden: true });
  const capEl = h('div', { class: 'br-cap', hidden: true });
  const flashEl = h('div', { class: 'br-flash' });
  const panel = h('div', { class: 'br-panel', hidden: true, role: 'group', 'aria-label': 'Brainrot settings' });
  const gear = h('button', { class: 'icon-btn sm br-gear', type: 'button', 'aria-label': 'Brainrot settings', 'data-tip': 'Brainrot settings', 'aria-expanded': 'false', onclick: () => togglePanel() }, icon('gear'));
  const x = h('button', { class: 'icon-btn sm br-x', type: 'button', 'aria-label': 'Turn off Brainrot mode (Esc)', 'data-tip': 'Turn off (Esc)', onclick: () => turnOff() }, icon('close'));
  const el = h('div', { class: 'br-under', hidden: true, role: 'region', 'aria-label': 'Brainrot mode' },
    stage, h('div', { class: 'br-hud', 'aria-hidden': 'true' }, progEl, scoreEl, capEl), flashEl, h('div', { class: 'br-tools' }, gear, x), panel);
  stage.append(canvas);

  const io = new IntersectionObserver((es) => { for (const e of es) self.visible = e.isIntersecting; kick(); }, { threshold: 0 });
  io.observe(el);
  const ro = window.ResizeObserver ? new ResizeObserver(() => measure()) : null;
  if (ro) { ro.observe(el); ro.observe(o.frame); }
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);

  const isActive = () => {
    if (self.dead || !o.available()) return false;
    const p = P();
    if (p.on[o.kind]) return true;
    return self.session.on && self.choice !== 'out' && (self.choice === 'in' || p.warned);
  };
  const level = () => effectiveLevel(P().level, reducedMotion());
  const running = () => self.active && self.visible && !document.hidden && self.w > 0 && self.h > 0;

  // ---- on and off
  async function turnOn() {
    if (self.asking) return;
    self.asking = true;
    try { if (!P().warned && !(await warn(uid()))) { self.refocus = false; return; } } finally { self.asking = false; }
    // While everyone's in it, joining is for this session only (it's not left on for next time).
    if (self.session.on) { self.choice = 'in'; sync(); return; }
    save(uid(), { on: { [o.kind]: true } });
  }
  function turnOff() {
    if (self.session.on) self.choice = 'out';
    // Focus was on the gameplay's ✕ or its settings (about to be hidden): it goes to the toggle.
    if (el.contains(document.activeElement)) self.refocus = true;
    closePanel();
    save(uid(), { on: { [o.kind]: false } });
    sync();
    if (self.refocus && o.focusToggle) { self.refocus = false; o.focusToggle(); }
  }
  const toggle = () => { self.refocus = !o.focusToggle; return self.active ? turnOff() : turnOn(); };

  // Decide whether it's on, and lay out the split.
  function sync(motionChanged = false) {
    if (self.dead) return;
    const on = isActive();
    if (motionChanged) self.gameKey = '';
    if (on !== self.active) {
      self.active = on;
      el.hidden = !on;
      o.frame.classList.toggle('br-on', on);
      if (!on) { closePanel(); dropYt(); o.frame.classList.remove('br-row', 'br-col', 'br-shake'); }
      measure();
      o.onLayout();
    }
    if (on) setup();
    // The settings are drawn again only if something they show changed (not on every update: a half-typed link
    // or a slider being dragged would be lost).
    if (self.panel && panelKey() !== self.panelKey) drawPanel();
    kick();
    if (o.onChange) o.onChange();
  }
  function measure() {
    if (!self.active) return;
    const fr = o.frame.getBoundingClientRect();
    const row = !!o.row(fr.width, fr.height);
    if (o.frame.classList.contains('br-row') !== row || !o.frame.classList.contains(row ? 'br-row' : 'br-col')) {
      o.frame.classList.toggle('br-row', row); o.frame.classList.toggle('br-col', !row);
      o.onLayout();
    }
    const r = el.getBoundingClientRect();
    self.w = Math.round(r.width); self.h = Math.round(r.height);
    sizeCanvas();
    kick();
  }
  // The canvas: at most 1.5 device pixels per CSS pixel (1 on low-power devices), at most 1280 (720) wide, and lower
  // again while frames come too slowly.
  function sizeCanvas() {
    const cap = lowPower() ? 1 : 1.5;
    const maxW = lowPower() ? 720 : 1280;
    let s = Math.min(window.devicePixelRatio || 1, cap) * self.quality;
    if (self.w * s > maxW) s = maxW / self.w;
    const W = Math.max(1, Math.round(self.w * s)); const H = Math.max(1, Math.round(self.h * s));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    self.scale = s;
  }

  // The game (or the YouTube background) for the current settings.
  function setup() {
    const p = P();
    const slow = reducedMotion();
    const key = p.game === 'youtube' ? `youtube:${p.yt}:${ytConsented}` : `${p.game}:${slow}`; // (a video doesn't reload for a motion change)
    if (key === self.gameKey) return;
    self.gameKey = key;
    clear(stage).append(canvas);
    stage.classList.toggle('br-yt', p.game === 'youtube');
    dropYt();
    self.game = null;
    if (p.game === 'youtube') {
      if (!p.yt) stage.append(h('div', { class: 'br-note' }, h('p', null, 'Paste a YouTube link in Brainrot settings to play it here.'), h('button', { class: 'btn primary sm', type: 'button', onclick: () => togglePanel(true) }, icon('gear'), 'Settings')));
      else if (!ytConsented) stage.append(h('div', { class: 'br-note' }, h('p', null, 'Your background loads from YouTube (youtube-nocookie.com), which sees your IP address. It plays muted, on a loop.'),
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => { ytConsented = true; setup(); kick(); } }, icon('play'), 'Load background')));
      else loadYt(p.yt);
      return;
    }
    self.game = GAMES[p.game]({ seed: (Math.random() * 2 ** 31) >>> 0, slow });
  }
  function loadYt(id) {
    self.ytId = id;
    self.yt = youtubeAdapter({ src: id, title: 'Brainrot background video' }, (ev) => {
      if (!self.yt) return;
      if (ev === 'ready') { self.yt.mute(); self.ytRun = null; kick(); }
      else if (ev === 'ended') { self.yt.seek(0); self.yt.play(); }
    }, { background: true });
    self.yt.el.classList.add('br-frame');
    self.yt.el.inert = true; // never focusable, not even inside
    stage.prepend(self.yt.el);
  }
  function dropYt() { if (self.yt) { self.yt.destroy(); self.yt.el.remove(); self.yt = null; self.ytRun = null; } }

  // ---- the loop (only while on screen)
  function kick() {
    if (running()) { if (!self.raf) { self.last = 0; self.raf = requestAnimationFrame(frame); } }
    else if (self.raf) { cancelAnimationFrame(self.raf); self.raf = 0; }
    // The background video plays only while it's on screen too.
    if (self.yt) { const want = running(); if (self.ytRun !== want) { self.ytRun = want; if (want) self.yt.play(); else self.yt.pause(); } }
    audioIdle();
  }
  function frame(now) {
    self.raf = 0;
    if (!running()) return;
    const dt = self.last ? Math.min(0.25, (now - self.last) / 1000) : 0;
    self.last = now;
    // Frames coming too slowly for a couple of seconds: a lower resolution (down to half).
    if (dt > 1 / 28) self.slowFrames++; // (below 30 a second: a 30 Hz screen in power saving isn't "slow") else self.slowFrames = Math.max(0, self.slowFrames - 1);
    if (self.slowFrames > 120 && self.quality > 0.5) { self.quality = Math.max(0.5, self.quality * 0.8); self.slowFrames = 0; sizeCanvas(); }
    const s = self.scale || 1;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const lv = level();
    if (self.game) {
      for (const ev of self.game.advance(dt)) onGame(ev, lv);
      self.game.draw(ctx, self.w, self.h);
    } else {
      ctx.clearRect(0, 0, self.w, self.h);
      // A background video has no game: the counter ticks up with time instead.
      self.ticks += dt;
      if (self.ticks >= 0.5) { self.ticks = 0; self.score += 1; }
    }
    if (lv >= 2) rain(now / 1000, lv);
    hud(now, lv);
    self.frames++;
    self.raf = requestAnimationFrame(frame);
  }
  function onGame(ev, lv) {
    if (ev.type === 'land' || ev.type === 'dodge') { self.score += 1; self.combo = ev.combo || self.combo + 1; }
    if (ev.type === 'coin') { self.score += 1; play('ding'); }
    if (ev.type === 'near') { self.score += 3; play('boom'); }
    if (ev.type === 'jump' && Math.random() < 0.25) play('whoosh');
    if (ev.type === 'milestone') { play('horn'); if (lv >= 2) flash(); }
  }
  function rain(t, lv) {
    const n = lv >= 3 ? 18 : 10;
    const px = Math.max(16, Math.round(Math.min(self.w, self.h) * 0.075 * (self.scale || 1)));
    const slow = reducedMotion();
    for (let i = 0; i < n; i++) {
      const d = rainDrop(i, t, slow);
      const size = (px * d.size) / (self.scale || 1);
      ctx.drawImage(sprite(d.emoji, px), d.x * self.w - size / 2, d.y * self.h - size / 2, size, size);
    }
  }
  // The counter, the progress bar and the captions: written only when they change.
  function hud(now, lv) {
    if (lv !== self.shown.lv) { self.shown.lv = lv; scoreEl.hidden = lv < 2; progEl.hidden = lv < 1; capEl.hidden = lv < 1; }
    if (lv >= 2 && (self.score !== self.shown.score || self.combo !== self.shown.combo)) {
      self.shown.score = self.score; self.shown.combo = self.combo;
      scoreEl.textContent = `${self.score.toLocaleString()}${self.combo > 1 ? ` · ×${self.combo}` : ''}`;
    }
    if (lv >= 1) {
      let p = o.progress();
      if (p == null || !Number.isFinite(p)) p = self.game ? self.game.progress() : (now / 30000) % 1;
      p = Math.max(0, Math.min(1, p));
      if (Math.abs(p - self.shown.prog) > 0.002) { self.shown.prog = p; prog.style.transform = `scaleX(${p.toFixed(4)})`; }
      captions(now);
    }
  }
  function captions(now) {
    const c = self.cap;
    // The title is read again every second (the video on screen changes), the words move on every 0.45 s (0.9 s
    // with reduced motion): never fast enough to count as flashing.
    if (now - (c.read || 0) > 1000) {
      c.read = now;
      const text = String(o.caption() || '');
      if (text !== c.text) { c.text = text; c.chunks = captionChunks(text); c.i = 0; c.at = 0; if (!c.chunks.length) capEl.textContent = ''; }
    }
    if (!c.chunks.length || now - c.at < (reducedMotion() ? 900 : 450)) return;
    c.at = now;
    capEl.textContent = c.chunks[c.i % c.chunks.length];
    capEl.classList.toggle('br-pop-a', c.i % 2 === 0); capEl.classList.toggle('br-pop-b', c.i % 2 === 1);
    c.i++;
  }
  function flash() {
    if (reducedMotion() || !limiter.allow(Date.now())) return;
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
  }
  // A reaction: a little shake (level 3, never with reduced motion), and a boom if sounds are on.
  function react() {
    if (!self.active) return;
    self.score += 10;
    play('boom');
    if (level() < 3 || reducedMotion() || !limiter.allow(Date.now())) return;
    o.frame.classList.remove('br-shake'); void o.frame.offsetWidth; o.frame.classList.add('br-shake');
    clearTimeout(self.shakeTimer); self.shakeTimer = setTimeout(() => o.frame.classList.remove('br-shake'), 400);
  }

  // ---- settings
  function togglePanel(open = !self.panel) {
    self.panel = open; panel.hidden = !open; gear.setAttribute('aria-expanded', String(open));
    if (open) { drawPanel(); setTimeout(() => { const f = panel.querySelector('input:checked, input, button'); if (f) f.focus({ preventScroll: true }); }, 0); }
  }
  function closePanel() { if (self.panel) togglePanel(false); }
  // Drawn again whenever a setting changes: whatever had focus in it gets it back.
  const panelKey = () => JSON.stringify([P(), reducedMotion(), self.session.on, !!(o.share && o.share.can())]);
  function drawPanel() {
    self.panelKey = panelKey();
    const had = panel.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    drawPanelIn();
    const again = had && panel.querySelector(`[data-k="${had}"]`);
    if (again) again.focus({ preventScroll: true });
  }
  function drawPanelIn() {
    const p = P(); const red = reducedMotion(); const max = red ? 1 : MAX_LEVEL; const lv = Math.min(p.level, max);
    const name = `br-game-${o.kind}-${Math.random().toString(36).slice(2, 7)}`;
    const games = h('fieldset', { class: 'br-games' }, h('legend', null, 'Gameplay'),
      ...['parkour', 'runner', 'youtube'].map((g) => h('label', { class: `br-choice${p.game === g ? ' on' : ''}` },
        h('input', { type: 'radio', name, value: g, 'data-k': `game-${g}`, checked: p.game === g, onchange: () => save(uid(), { game: g }) }), GAME_NAMES[g])));
    const link = h('input', { class: 'input sm', 'data-k': 'yt', placeholder: 'Paste a YouTube link', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'YouTube link for the background', value: p.yt ? `https://youtu.be/${p.yt}` : '' });
    const yt = p.game === 'youtube' ? h('form', { class: 'br-yt-form', onsubmit: (e) => {
      e.preventDefault();
      const id = youtubeVideoId(link.value);
      if (!id) return toast('That isn’t a link to a YouTube video.', 'error');
      // The settings close, so what comes next (Load background) is in view, with focus on it.
      togglePanel(false);
      save(uid(), { yt: id });
      const go = stage.querySelector('.br-note button');
      if (go) go.focus({ preventScroll: true });
    } }, link, h('button', { class: 'btn primary sm', type: 'submit' }, 'Use'), h('span', { class: 'field-hint' }, 'Muted, on a loop. It loads from youtube-nocookie.com once you tap Load.')) : null;
    const slider = h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(lv), class: 'br-slider', 'data-k': 'level', 'aria-label': 'Stimulation', 'aria-valuetext': LEVELS[lv],
      oninput: (e) => { const v = +e.target.value; e.target.setAttribute('aria-valuetext', LEVELS[v]); out.textContent = `${v} · ${LEVELS[v]}`; },
      onchange: (e) => save(uid(), { level: +e.target.value }) });
    const out = h('output', { class: 'br-level' }, `${lv} · ${LEVELS[lv]}`);
    const snd = h('input', { type: 'checkbox', 'data-k': 'sounds', checked: sounds, onchange: (e) => { sounds = e.target.checked; if (sounds) { audioCtx(); play('ding'); } else audioIdle(); } });
    const sh = o.share && o.share.can() ? h('label', { class: 'row gap tight br-share' },
      h('input', { type: 'checkbox', 'data-k': 'share', checked: self.session.on, onchange: (e) => o.share.set(e.target.checked) }), 'On for everyone scrolling together') : null;
    clear(panel).append(
      h('div', { class: 'br-panel-head' }, h('strong', null, 'Brainrot mode'), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Close settings', onclick: () => togglePanel(false) }, icon('close'))),
      games, yt,
      h('label', { class: 'br-field' }, h('span', { class: 'field-label' }, 'Stimulation maxing'), slider, out),
      red ? h('p', { class: 'field-hint' }, 'Reduced motion is on, so it stays calm: at most 1, slower, no shake.') : null,
      h('label', { class: 'row gap tight' }, snd, 'Meme sounds (made in your browser)'),
      sh,
      h('p', { class: 'field-hint' }, 'Esc or ✕ turns Brainrot mode off.'));
  }

  // ---- scroll together
  const who = () => (self.session.by ? o.nameOf(self.session.by) : 'Someone');
  // s: { live: is there a session at all, on: Brainrot for everyone (and this person follows it), by: who turned it on }.
  // A choice to join in or stay out lasts until the session ends (not until it's next turned off and on).
  function setSession(s) {
    const on = !!(s && s.on);
    const was = self.session;
    self.session = { on, by: (s && s.by) || '' };
    if (!(s && s.live)) self.choice = null;
    else if (!was.on && self.session.by !== uid()) {
      const p = P();
      if (!p.on[o.kind] && p.warned && self.choice === null) toast(`${who()} turned on Brainrot mode for everyone. Esc turns it off for you.`);
    }
    sync();
  }

  // The toggle (and, during scroll together, the note for someone who hasn't joined in) for the host's bar.
  function barItems() {
    const btn = h('button', { class: `btn ghost sm br-toggle${self.active ? ' active' : ''}`, type: 'button', 'aria-pressed': String(self.active), 'data-tip': self.active ? 'Turn off Brainrot mode (Esc)' : 'Gameplay under the video', onclick: () => toggle() }, icon('gamepad'), 'Brainrot');
    // The bar is drawn again after a toggle: the new button gets the focus the old one had.
    if (self.refocus) { self.refocus = false; queueMicrotask(() => { if (btn.isConnected) btn.focus({ preventScroll: true }); }); }
    const out = [btn];
    const p = P();
    if (self.session.on && !self.active && self.choice === null && !p.warned) {
      out.push(h('span', { class: 'br-invite' }, `${who()} turned on Brainrot mode`,
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => turnOn() }, 'Join in'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { self.choice = 'out'; sync(); } }, 'No thanks')));
    }
    if (self.active && o.share && o.share.can()) {
      out.push(h('button', { class: `btn ghost sm br-everyone${self.session.on ? ' active' : ''}`, type: 'button', 'aria-pressed': String(self.session.on), onclick: () => o.share.set(!self.session.on) }, self.session.on ? 'Brainrot: everyone' : 'Brainrot for everyone'));
    }
    return out;
  }

  function destroy() {
    if (self.dead) return;
    self.dead = true;
    if (self.raf) cancelAnimationFrame(self.raf);
    self.raf = 0;
    surfaces.delete(api);
    audioIdle();
    io.disconnect(); if (ro) ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    clearTimeout(self.shakeTimer);
    dropYt();
    o.frame.classList.remove('br-on', 'br-row', 'br-col', 'br-shake');
    el.remove();
    surfaces.delete(api);
  }

  // The call's page was drawn again: the split moves to its new stage (the game keeps going).
  function setFrame(f) {
    if (self.dead || !f || f === o.frame) return;
    const keep = ['br-on', 'br-row', 'br-col'].filter((c) => o.frame.classList.contains(c));
    o.frame.classList.remove('br-on', 'br-row', 'br-col', 'br-shake');
    if (ro) { ro.unobserve(o.frame); ro.observe(f); }
    o.frame = f;
    f.classList.add(...keep);
  }

  const api = {
    el, sync, setSession, barItems, react, destroy, toggle, setFrame,
    isActive: () => self.active, onScreen: () => self.visible && !el.hidden, isRunning: () => !!self.raf,
    // Whether Esc with focus here is for this one: on the page itself, or inside its place.
    owns: (a) => !a || a === document.body || o.frame.contains(a),
    escape: () => { if (self.panel) { togglePanel(false); gear.focus({ preventScroll: true }); } else turnOff(); },
    // Tests: the game's state and how many frames were drawn.
    stats: () => ({ active: self.active, running: !!self.raf, frames: self.frames, game: self.game ? self.game.kind : P().game, score: self.score, level: level(), canvas: [canvas.width, canvas.height], session: self.session.on, yt: !!self.yt }),
  };
  surfaces.add(api);
  sync();
  return api;
}

// Tests: every surface's numbers.
export const brainrotStats = () => [...surfaces].map((s) => s.stats());
