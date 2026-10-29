// Brainrot mode (docs/design/BRAINROT.md): the parts with no page around them, shared by brainrot.js and the tests
// (node --test loads this file as it is).
//
// Two original "satisfying gameplay" loops that play themselves: Block Parkour (a blocky runner jumping across
// floating platforms) and Rail Runner (three lanes, trains, barriers and coins). Everything is drawn in code on a
// canvas 2D context with a little perspective: no images, sprites, fonts, music or anything else loaded. Each game
// is a fixed-step simulation (60 steps a second, whatever the screen's frame rate) driven by a seeded random number
// generator, so the same seed always plays the same run, and drawing never changes the simulation.
//
// Also here: the flash limiter (never more than 3 flashes in any second, WCAG 2.3.1), the stimulation level (capped
// at 1 with reduced motion), the caption words, the YouTube link check for "your own background", and the checks
// on what's stored and what the server says.

export const HZ = 60;
export const STEP_US = Math.round(1e6 / HZ); // one simulation step, in microseconds (whole numbers: any split of the same time gives the same steps)
const MAX_CATCHUP_US = 250000; // after a pause (a hidden tab), at most a quarter of a second is caught up

// mulberry32: small, fast, and the same on every device.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = (u) => u * u * (3 - 2 * u);

// ---- colours: themes cross-fade (over about 2 seconds), never switch at once
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const css = (c, k = 1) => `rgb(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))})`;
const theme = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? hex(v) : v]));
export const PARKOUR_THEMES = [
  theme({ name: 'Meadow', skyTop: '#5aa7ff', skyLow: '#bfe3ff', fog: '#cfe8ff', top: '#62c25a', top2: '#56b04f', side: '#8a5a35', void: '#2a3b7a', accent: '#ffe066' }),
  theme({ name: 'Dusk', skyTop: '#2b1b4f', skyLow: '#ff8a5c', fog: '#ffb08a', top: '#e8d27a', top2: '#d9c26a', side: '#7a4b2e', void: '#1b1033', accent: '#ff4fa3' }),
  theme({ name: 'Neon', skyTop: '#070b1f', skyLow: '#1d2a6b', fog: '#1a2260', top: '#29f0c8', top2: '#1fd3ae', side: '#3b2a8c', void: '#05061a', accent: '#ff3df2' }),
  theme({ name: 'Candy', skyTop: '#ff9ad5', skyLow: '#ffe3f3', fog: '#ffe9f6', top: '#ffffff', top2: '#f4ecff', side: '#b77cff', void: '#7b4fd1', accent: '#40d9ff' }),
  theme({ name: 'Snow', skyTop: '#7fa4c8', skyLow: '#e8f1fa', fog: '#eef5fb', top: '#f6fbff', top2: '#e4eef8', side: '#6d7f99', void: '#43546e', accent: '#ff6b6b' }),
];
export const RUNNER_THEMES = [
  theme({ name: 'Noon', skyTop: '#3d8bff', skyLow: '#b7dcff', fog: '#cfe6ff', ground: '#6b6f7a', rail: '#d8dde6', sleeper: '#5a4a3c', wall: '#f2a65a', wall2: '#e07a5f', train: '#2bb3a3', train2: '#f25f5c', barrier: '#ffd23f', accent: '#ffcc00' }),
  theme({ name: 'Sunset', skyTop: '#3b1f5e', skyLow: '#ff9e6b', fog: '#ffb38a', ground: '#5b4b5e', rail: '#ffd6b8', sleeper: '#3e2c33', wall: '#8e6cff', wall2: '#5c4ccf', train: '#ff6f91', train2: '#ffc75f', barrier: '#f9f871', accent: '#ffe66d' }),
  theme({ name: 'Night', skyTop: '#05081a', skyLow: '#1b2350', fog: '#1d2a5c', ground: '#2a2e45', rail: '#8fa3ff', sleeper: '#1a1c2b', wall: '#3a2f7a', wall2: '#5d3fd3', train: '#00e0b8', train2: '#ff4f9a', barrier: '#ffe14d', accent: '#7cf8ff' }),
];
function themeAt(list, idx, u) {
  const a = list[idx % list.length]; const b = list[(idx + 1) % list.length];
  if (u <= 0) return a;
  const out = {};
  for (const k of Object.keys(a)) out[k] = Array.isArray(a[k]) ? mix(a[k], b[k], u) : a[k];
  return out;
}

// ---- a fixed-step clock: advance(seconds) runs the steps that fit, keeps the rest for next time
function clockOf(sim) {
  let acc = 0;
  return (seconds) => {
    acc += Math.min(MAX_CATCHUP_US, Math.max(0, Math.round(seconds * 1e6)));
    const events = [];
    while (acc >= STEP_US) { acc -= STEP_US; sim.tick(events); }
    return events;
  };
}

// The camera: points in the world to the screen (x right, y up, z forward, the camera looking along +z).
function projector(w, h, cam, horizon, focal) {
  const f = h * focal; const cx = w / 2; const cy = h * horizon;
  return (x, y, z) => {
    const dz = Math.max(0.05, z - cam.z);
    return [cx + ((x - cam.x) * f) / dz, cy - ((y - cam.y) * f) / dz];
  };
}
function quad(ctx, a, b, c, d) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill(); }
// A box seen from the camera: the faces turned towards it (front, the side it's on, the top or bottom), far to near.
function box(ctx, P, cam, x0, x1, y0, y1, z0, z1, col, fog, fogU) {
  if (z1 <= cam.z + 0.05) return;
  z0 = Math.max(z0, cam.z + 0.05);
  const c = (k) => css(mix(col, fog, fogU), k);
  if (cam.x < x0) { ctx.fillStyle = c(0.78); quad(ctx, P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)); }
  if (cam.x > x1) { ctx.fillStyle = c(0.78); quad(ctx, P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)); }
  if (cam.y > y1) { ctx.fillStyle = c(1.08); quad(ctx, P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)); }
  if (cam.y < y0) { ctx.fillStyle = c(0.6); quad(ctx, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)); }
  ctx.fillStyle = c(0.9); quad(ctx, P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0));
}
const FAR = 60;
const fogOf = (z, cam) => clamp((z - cam.z) / FAR, 0, 1) ** 1.4;
function sky(ctx, w, h, th, horizon) {
  const g = ctx.createLinearGradient(0, 0, 0, h * horizon + 2);
  g.addColorStop(0, css(th.skyTop)); g.addColorStop(1, css(th.skyLow));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
// A blocky person (the runner) seen from behind: legs and arms swing with the stride.
function person(ctx, P, cam, x, y, z, stride, squash, colors, fog) {
  const s = 1 - squash * 0.45;
  const legH = 0.42 * s; const bodyH = 0.5 * s; const headH = 0.3 * s;
  const sw = Math.sin(stride) * 0.22 * (1 - squash);
  const parts = [
    [x - 0.16, x - 0.02, y, y + legH, z + sw - 0.08, z + sw + 0.08, colors.legs],
    [x + 0.02, x + 0.16, y, y + legH, z - sw - 0.08, z - sw + 0.08, colors.legs],
    [x - 0.22, x + 0.22, y + legH, y + legH + bodyH, z - 0.11, z + 0.11, colors.body],
    [x - 0.32, x - 0.22, y + legH + bodyH * 0.25, y + legH + bodyH, z - sw - 0.06, z - sw + 0.06, colors.body],
    [x + 0.22, x + 0.32, y + legH + bodyH * 0.25, y + legH + bodyH, z + sw - 0.06, z + sw + 0.06, colors.body],
    [x - 0.15, x + 0.15, y + legH + bodyH, y + legH + bodyH + headH, z - 0.14, z + 0.14, colors.head],
  ];
  // Farthest first (the camera's behind: the parts with the biggest z first).
  parts.sort((a, b) => b[5] - a[5]);
  for (const p of parts) box(ctx, P, cam, p[0], p[1], p[2], p[3], p[4], p[5], p[6], fog, 0);
}

// ============================================================ Block Parkour
// A run across floating blocks: each platform is a few blocks long, the runner jumps every gap in an arc. Where the
// runner is comes from how far it has run (z), so it always lands; short platforms and long gaps are near-misses.
const PK_SPEED = 6.5; // blocks a second
const PK_THEME_EVERY = 14; // platforms per colour theme
export function createParkour({ seed = 1, slow = false } = {}) {
  const R = rng(seed);
  const st = {
    t: 0, z: 0, x: 0, y: 1, speed: PK_SPEED * (slow ? 0.5 : 1), plats: [], made: 0, on: 0, air: false,
    score: 0, combo: 0, best: 0, jumps: 0, near: 0, theme: 0, themeU: 0, cam: { x: 0, y: 3.5, z: -6 }, stride: 0,
  };
  // The first platform is long and flat; then each one follows the last.
  function add() {
    const last = st.plats[st.plats.length - 1];
    if (!last) { st.plats.push({ id: st.made++, x: 0, y: 0, z0: -8, z1: 6, w: 2, tall: 3 }); return; }
    const hard = R() < 0.18;
    const gap = hard ? 3.6 + R() * 0.9 : 1.6 + R() * 1.9;
    const len = hard ? 1 : 1 + Math.floor(R() * 4);
    const dy = [-1, -0.5, 0, 0, 0.5, 1][Math.floor(R() * 6)];
    const y = clamp(last.y + dy, -2, 3);
    const x = clamp(last.x + (R() - 0.5) * 4, -3.5, 3.5);
    const z0 = last.z1 + gap;
    st.plats.push({ id: st.made++, x: Math.round(x * 2) / 2, y, z0, z1: z0 + len, w: hard ? 1 : 1 + Math.floor(R() * 2), tall: 1 + Math.floor(R() * 3), hard });
  }
  while (st.plats.length < 30) add();
  // Where the runner is when it has run to z: on a platform, or in the arc between two.
  function pose(z) {
    for (let i = 0; i < st.plats.length - 1; i++) {
      const a = st.plats[i]; const b = st.plats[i + 1];
      if (z < a.z0) break;
      if (z <= a.z1 - 0.15) return { i, air: false, x: a.x, y: a.y };
      const from = a.z1 - 0.15; const to = b.z0 + (b.hard ? 0.5 : 0.35);
      if (z < to) {
        const u = (z - from) / (to - from);
        const H = 0.9 + (to - from) * 0.28 + Math.max(0, b.y - a.y);
        return { i, air: true, x: lerp(a.x, b.x, smooth(u)), y: lerp(a.y, b.y, u) + H * 4 * u * (1 - u), next: i + 1 };
      }
    }
    const last = st.plats[st.plats.length - 1];
    return { i: st.plats.length - 1, air: false, x: last.x, y: last.y };
  }
  function tick(events) {
    st.t += 1 / HZ;
    st.z += st.speed / HZ;
    st.stride += (st.speed / HZ) * 3.2;
    const p = pose(st.z);
    const id = st.plats[p.i].id;
    if (p.air && !st.air) { st.jumps++; events.push({ type: 'jump' }); }
    if (!p.air && st.air) {
      const plat = st.plats[p.i];
      st.score += plat.hard ? 3 : 1;
      st.combo += 1; st.best = Math.max(st.best, st.combo);
      events.push({ type: 'land', combo: st.combo });
      if (plat.hard) { st.near++; events.push({ type: 'near' }); }
      if (st.combo % 10 === 0) events.push({ type: 'milestone', combo: st.combo });
      // A new colour theme every few platforms.
      if (plat.id && plat.id % PK_THEME_EVERY === 0) { st.theme++; st.themeU = 1; }
    }
    st.air = p.air; st.on = id;
    st.x = p.x; st.y = p.y;
    // The camera follows behind and above, gently.
    st.cam.x = lerp(st.cam.x, st.x * 0.8, 0.08);
    st.cam.y = lerp(st.cam.y, st.y + 2.5, 0.08);
    st.cam.z = st.z - 6;
    if (st.themeU > 0) st.themeU = Math.max(0, st.themeU - 1 / (HZ * 2));
    // Platforms far behind go; new ones come in ahead.
    while (st.plats.length > 3 && st.plats[1].z1 < st.z - 6) st.plats.shift();
    while (st.plats[st.plats.length - 1].z0 < st.z + FAR + 10) add();
  }
  const sim = { tick };
  const advance = clockOf(sim);
  // How far into this colour theme (for the progress bar when there's nothing else to show).
  const progress = () => { const p = st.plats.find((x) => x.id === st.on); return p ? (p.id % PK_THEME_EVERY) / PK_THEME_EVERY : 0; };
  function draw(ctx, w, h) {
    const th = st.themeU > 0 ? themeAt(PARKOUR_THEMES, st.theme - 1, 1 - st.themeU) : PARKOUR_THEMES[st.theme % PARKOUR_THEMES.length];
    const cam = st.cam; const horizon = 0.36;
    const P = projector(w, h, cam, horizon, 0.95);
    sky(ctx, w, h, th, horizon);
    // Below the horizon, the void fades into the fog.
    const g = ctx.createLinearGradient(0, h * horizon, 0, h);
    g.addColorStop(0, css(th.fog)); g.addColorStop(1, css(th.void));
    ctx.fillStyle = g; ctx.fillRect(0, h * horizon, w, h * (1 - horizon));
    // Far, slow blocky clouds.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let k = 0; k < 6; k++) {
      const cx = ((k * 0.37 + 0.13 - st.t * 0.006 * (1 + (k % 3))) % 1 + 1) % 1;
      const cy = 0.06 + ((k * 0.29) % 1) * 0.22;
      const cw = w * (0.12 + (k % 3) * 0.05);
      ctx.fillRect(cx * (w + cw) - cw, cy * h, cw, h * 0.035);
      ctx.fillRect(cx * (w + cw) - cw + cw * 0.2, cy * h - h * 0.025, cw * 0.5, h * 0.03);
    }
    // Platforms, far to near: their sides, front and top (with a voxel grid on top).
    for (let i = st.plats.length - 1; i >= 0; i--) {
      const p = st.plats[i];
      if (p.z1 < cam.z + 0.1 || p.z0 > cam.z + FAR) continue;
      const fu = fogOf((p.z0 + p.z1) / 2, cam);
      const x0 = p.x - p.w / 2; const x1 = p.x + p.w / 2;
      box(ctx, P, cam, x0, x1, p.y - p.tall, p.y - 0.25, p.z0, p.z1, th.side, th.fog, fu);
      box(ctx, P, cam, x0, x1, p.y - 0.25, p.y, p.z0, p.z1, th.top, th.fog, fu);
      // The grass-like top: a checker of blocks, then the grid lines between them.
      if (cam.y > p.y) {
        ctx.fillStyle = css(mix(th.top2, th.fog, fu));
        for (let bz = Math.floor(p.z0); bz < p.z1; bz++) for (let bx = 0; bx < p.w; bx++) {
          if ((bz + bx) % 2) continue;
          const za = Math.max(bz, p.z0, cam.z + 0.1); const zb = Math.min(bz + 1, p.z1);
          if (zb <= za) continue;
          quad(ctx, P(x0 + bx, p.y, za), P(x0 + bx + 1, p.y, za), P(x0 + bx + 1, p.y, zb), P(x0 + bx, p.y, zb));
        }
      }
      if (p.hard && p.z0 > st.z) { // the near-miss block glows at its edge
        ctx.fillStyle = css(mix(th.accent, th.fog, fu));
        quad(ctx, P(x0, p.y, Math.max(p.z0, cam.z + 0.1)), P(x1, p.y, Math.max(p.z0, cam.z + 0.1)), P(x1, p.y - 0.12, Math.max(p.z0, cam.z + 0.1)), P(x0, p.y - 0.12, Math.max(p.z0, cam.z + 0.1)));
      }
      // The runner, drawn with the platform it's above (so nearer platforms cover it).
      if (p.id === st.on) person(ctx, P, cam, st.x, st.y, st.z, st.stride, st.air ? 0.15 : 0, { legs: [44, 62, 140], body: [32, 180, 200], head: [236, 196, 160] }, th.fog);
    }
  }
  const snapshot = () => JSON.stringify({ t: +st.t.toFixed(6), z: +st.z.toFixed(6), x: +st.x.toFixed(6), y: +st.y.toFixed(6), score: st.score, combo: st.combo, jumps: st.jumps, near: st.near, theme: st.theme, plats: st.plats.slice(0, 5).map((p) => [p.id, p.x, p.y, +p.z0.toFixed(4)]) });
  return { kind: 'parkour', name: 'Block Parkour', state: st, tick: (ev = []) => { tick(ev); return ev; }, advance, draw, progress, snapshot, pose };
}

// ============================================================ Rail Runner
// Three lanes seen from behind the runner. Obstacles come in waves: in each wave one lane is clear (with coins), the
// others have a train, a low barrier (jumped) or a high one (rolled under). The runner looks ahead and picks a lane,
// a jump or a roll in time; a wave is far enough from the next that a lane change never cuts through a train.
const LANE = 1.7;
export const LANES = [-LANE, 0, LANE];
const RR_SPEED = 11;
const WAVE_GAP = 36;
const TRAIN_MAX = 14;
const JUMP_S = 0.62; const ROLL_S = 0.6;
export function createRunner({ seed = 1, slow = false } = {}) {
  const R = rng(seed);
  const st = {
    t: 0, z: 0, lane: 1, x: 0, y: 0, vy: 0, act: null, actT: 0, target: 1, speed: RR_SPEED * (slow ? 0.5 : 1), waves: [], coins: [], made: 0,
    score: 0, coins_: 0, combo: 0, dodges: 0, crashes: 0, near: 0, theme: 0, themeU: 0, stride: 0, planned: -1, cam: { x: 0, y: 2.7, z: -5.6 },
  };
  function addWave() {
    const last = st.waves[st.waves.length - 1];
    const z = last ? last.z + WAVE_GAP + Math.floor(R() * 8) : 34;
    const safe = Math.floor(R() * 3);
    const lanes = [0, 1, 2].map((l) => {
      if (l === safe) return { type: 'none' };
      const r = R();
      if (r < 0.45) return { type: 'train', len: 6 + Math.floor(R() * (TRAIN_MAX - 5)), color: R() < 0.5 ? 0 : 1 };
      if (r < 0.72) return { type: 'low' };
      if (r < 0.95) return { type: 'high' };
      return { type: 'none' };
    });
    const w = { id: st.made++, z, safe, lanes, done: false };
    st.waves.push(w);
    // Coins: a line in the clear lane, and an arc over a low barrier.
    for (let k = -3; k <= 3; k++) st.coins.push({ x: LANES[safe], y: 0.5, z: z + k * 2.2, got: false });
    lanes.forEach((L, l) => { if (L.type === 'low') for (let k = -1; k <= 1; k++) st.coins.push({ x: LANES[l], y: 1.4 - Math.abs(k) * 0.3, z: z + k * 1.6, got: false }); });
  }
  while (st.waves.length < 4) addWave();
  // What's in a lane at distance z (for the collision check): a train covers [z, z+len], a barrier [z-0.3, z+0.3].
  function hit(w, l, x, y) {
    const L = w.lanes[l];
    if (L.type === 'none' || Math.abs(x - LANES[l]) > LANE * 0.55) return false;
    if (L.type === 'train') return st.z > w.z - 0.4 && st.z < w.z + L.len;
    if (st.z < w.z - 0.3 || st.z > w.z + 0.3) return false;
    if (L.type === 'low') return y < 0.85;
    return st.act !== 'roll'; // high: only rolling goes under
  }
  function tick(events) {
    const dt = 1 / HZ;
    st.t += dt;
    st.z += st.speed * dt;
    st.stride += st.speed * dt * 1.4;
    // Look ahead at the next wave not yet passed, and decide once, somewhere between 9 and 17 m before it (late
    // decisions are near-misses).
    const w = st.waves.find((x) => !x.done); // (in order: the next one is planned once this one is behind)
    if (w) {
      const d = w.z - st.z;
      if (st.planned !== w.id) {
        if (w.at === undefined) w.at = 9 + R() * 8;
        if (d < w.at) {
          st.planned = w.id;
          const here = w.lanes[st.lane].type;
          // A barrier in this lane is jumped or rolled under some of the time; a train is always avoided.
          if ((here === 'low' || here === 'high') && R() < 0.6) { w.plan = here === 'low' ? 'jump' : 'roll'; st.target = st.lane; }
          else if (here === 'none') { w.plan = 'stay'; st.target = st.lane; }
          else { w.plan = 'switch'; st.target = w.safe; }
          if (w.plan === 'switch' && d < 11.5) { st.near++; events.push({ type: 'near' }); }
          if (w.plan === 'switch') events.push({ type: 'switch' });
        }
      }
      if (st.planned === w.id && !st.act) {
        const lead = w.plan === 'jump' ? (st.speed * JUMP_S) / 2 : w.plan === 'roll' ? (st.speed * ROLL_S) / 2 + 0.3 : -1;
        if (lead > 0 && d <= lead && w.lanes[st.lane].type === (w.plan === 'jump' ? 'low' : 'high')) { st.act = w.plan; st.actT = 0; events.push({ type: w.plan }); }
      }
      if (st.z > w.z + 0.5 && !w.passed) { w.passed = true; st.dodges++; st.combo++; st.score += 5; events.push({ type: 'dodge', combo: st.combo }); if (st.combo % 10 === 0) events.push({ type: 'milestone', combo: st.combo }); }
      if (w.passed && st.z > w.z + (w.lanes.reduce((m, L) => Math.max(m, L.len || 0), 0)) + 0.5) { w.done = true; if (w.id && w.id % 6 === 0) { st.theme++; st.themeU = 1; } }
    }
    // Lane changes glide; the lane counts as changed half way.
    const tx = LANES[st.target];
    const dx = tx - st.x;
    const v = 9 * dt;
    st.x = Math.abs(dx) <= v ? tx : st.x + Math.sign(dx) * v;
    st.lane = st.x < -LANE / 2 ? 0 : st.x > LANE / 2 ? 2 : 1;
    // Jumps and rolls.
    if (st.act) {
      st.actT += dt;
      const dur = st.act === 'jump' ? JUMP_S : ROLL_S;
      const u = Math.min(1, st.actT / dur);
      st.y = st.act === 'jump' ? 1.5 * 4 * u * (1 - u) : 0;
      if (u >= 1) { st.act = null; st.y = 0; }
    }
    // Coins in reach.
    for (const c of st.coins) {
      if (c.got || Math.abs(c.z - st.z) > 0.55) continue;
      if (Math.abs(c.x - st.x) < 0.6 && Math.abs(c.y - (st.y + 0.5)) < 0.75) { c.got = true; st.coins_++; st.score++; events.push({ type: 'coin' }); }
    }
    // (The runner never crashes: this counts it if the planning ever got it wrong. The tests check it stays 0.)
    for (const x of st.waves) for (let l = 0; l < 3; l++) if (hit(x, l, st.x, st.y)) { if (!x.crashed) { x.crashed = true; st.crashes++; st.combo = 0; events.push({ type: 'crash' }); } }
    st.cam.x = lerp(st.cam.x, st.x * 0.7, 0.08);
    st.cam.z = st.z - 5.6;
    if (st.themeU > 0) st.themeU = Math.max(0, st.themeU - 1 / (HZ * 2));
    while (st.waves.length && st.waves[0].done && st.waves[0].z < st.z - 30) st.waves.shift();
    while (st.coins.length && st.coins[0].z < st.z - 8) st.coins.shift();
    while (st.waves[st.waves.length - 1].z < st.z + FAR + 20) addWave();
  }
  const sim = { tick };
  const advance = clockOf(sim);
  const progress = () => { const w = st.waves.find((x) => !x.done); return w ? clamp(1 - (w.z - st.z) / WAVE_GAP, 0, 1) : 0; };
  function draw(ctx, w, h) {
    const th = st.themeU > 0 ? themeAt(RUNNER_THEMES, st.theme - 1, 1 - st.themeU) : RUNNER_THEMES[st.theme % RUNNER_THEMES.length];
    const cam = st.cam; const horizon = 0.34;
    const P = projector(w, h, cam, horizon, 0.9);
    sky(ctx, w, h, th, horizon);
    // A low sun.
    ctx.fillStyle = css(mix(th.accent, th.skyLow, 0.35));
    ctx.beginPath(); ctx.arc(w * 0.72, h * horizon * 0.62, Math.min(w, h) * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(th.fog); ctx.fillRect(0, h * horizon, w, h);
    // The ground, then each lane's sleepers and rails.
    const near = cam.z + 0.3; const far = cam.z + FAR;
    ctx.fillStyle = css(th.ground);
    quad(ctx, P(-LANE * 2.6, 0, near), P(LANE * 2.6, 0, near), P(LANE * 2.6, 0, far), P(-LANE * 2.6, 0, far));
    for (let s = Math.ceil(near / 1.25) * 1.25; s < far; s += 1.25) {
      ctx.fillStyle = css(mix(th.sleeper, th.fog, fogOf(s, cam)));
      for (const lx of LANES) quad(ctx, P(lx - 0.62, 0, s), P(lx + 0.62, 0, s), P(lx + 0.62, 0, s + 0.3), P(lx - 0.62, 0, s + 0.3));
    }
    ctx.strokeStyle = css(th.rail); ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.beginPath();
    for (const lx of LANES) for (const o of [-0.42, 0.42]) { const a = P(lx + o, 0.02, near); const b = P(lx + o, 0.02, far); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    // Walls of blocky buildings on both sides (heights from a hash of their place: no state needed).
    for (let k = Math.floor(far / 6); k >= Math.floor(near / 6); k--) {
      const z0 = k * 6; const hgt = 3 + (((k * 2654435761) >>> 0) % 5); const fu = fogOf(z0, cam);
      const c = (k & 1) ? th.wall : th.wall2;
      box(ctx, P, cam, -LANE * 2.6 - 3, -LANE * 2.6, 0, hgt, z0, z0 + 5.6, c, th.fog, fu);
      box(ctx, P, cam, LANE * 2.6, LANE * 2.6 + 3, 0, hgt + ((k >>> 1) % 3), z0, z0 + 5.6, c, th.fog, fu);
    }
    // Obstacles and coins, far to near.
    const things = [];
    for (const wv of st.waves) wv.lanes.forEach((L, l) => { if (L.type !== 'none') things.push({ z: wv.z, l, L }); });
    for (const c of st.coins) if (!c.got) things.push({ z: c.z, coin: c });
    things.sort((a, b) => b.z - a.z);
    for (const o of things) {
      if (o.z > far || (o.coin ? o.z : o.z + (o.L.len || 0.3)) < near) continue;
      const fu = fogOf(o.z, cam);
      if (o.coin) {
        const c = o.coin; const r = 0.28; const k = Math.abs(Math.cos(st.t * 5 + c.z));
        const a = P(c.x, c.y, c.z); const b = P(c.x + r, c.y + r, c.z);
        const rx = Math.max(0.5, Math.abs(b[0] - a[0]) * k); const ry = Math.abs(b[1] - a[1]);
        ctx.fillStyle = css(mix(th.accent, th.fog, fu));
        ctx.beginPath(); ctx.ellipse(a[0], a[1], rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const x = LANES[o.l]; const L = o.L;
      if (L.type === 'train') {
        const col = L.color ? th.train2 : th.train;
        box(ctx, P, cam, x - 0.72, x + 0.72, 0, 2.3, o.z, o.z + L.len, col, th.fog, fu);
        if (o.z > cam.z + 0.3) { // the front: windows and two lights
          ctx.fillStyle = css(mix([20, 28, 44], th.fog, fu));
          quad(ctx, P(x - 0.55, 1.45, o.z), P(x + 0.55, 1.45, o.z), P(x + 0.55, 2.0, o.z), P(x - 0.55, 2.0, o.z));
          ctx.fillStyle = css(mix([255, 246, 200], th.fog, fu));
          for (const lx of [-0.45, 0.35]) quad(ctx, P(x + lx, 0.35, o.z), P(x + lx + 0.12, 0.35, o.z), P(x + lx + 0.12, 0.5, o.z), P(x + lx, 0.5, o.z));
        }
      } else {
        const y0 = L.type === 'low' ? 0.25 : 1.15; const y1 = L.type === 'low' ? 0.8 : 1.75;
        box(ctx, P, cam, x - 0.7, x - 0.6, 0, y1, o.z - 0.05, o.z + 0.05, [90, 90, 100], th.fog, fu);
        box(ctx, P, cam, x + 0.6, x + 0.7, 0, y1, o.z - 0.05, o.z + 0.05, [90, 90, 100], th.fog, fu);
        box(ctx, P, cam, x - 0.7, x + 0.7, y0, y1, o.z - 0.08, o.z + 0.08, th.barrier, th.fog, fu);
        // Stripes on the board.
        ctx.fillStyle = css(mix([40, 40, 48], th.fog, fu));
        for (let s = 0; s < 4; s++) { const sx = x - 0.7 + s * 0.38; quad(ctx, P(sx, y0, o.z - 0.081), P(sx + 0.18, y0, o.z - 0.081), P(sx + 0.3, y1, o.z - 0.081), P(sx + 0.12, y1, o.z - 0.081)); }
      }
    }
    person(ctx, P, cam, st.x, st.y, st.z, st.stride, st.act === 'roll' ? 1 : 0, { legs: [36, 40, 70], body: [255, 112, 67], head: [120, 80, 60] }, th.fog);
  }
  const snapshot = () => JSON.stringify({ t: +st.t.toFixed(6), z: +st.z.toFixed(6), x: +st.x.toFixed(6), y: +st.y.toFixed(6), lane: st.lane, score: st.score, coins: st.coins_, dodges: st.dodges, crashes: st.crashes, near: st.near, theme: st.theme, waves: st.waves.slice(0, 3).map((x) => [x.id, x.safe, x.lanes.map((L) => L.type).join()]) });
  return { kind: 'runner', name: 'Rail Runner', state: st, tick: (ev = []) => { tick(ev); return ev; }, advance, draw, progress, snapshot };
}

export const GAMES = { parkour: createParkour, runner: createRunner };
export const GAME_NAMES = { parkour: 'Block Parkour', runner: 'Rail Runner', youtube: 'Your own background' };

// ============================================================ the flash limiter (WCAG 2.3.1)
// Every effect that changes a big part of the screen's brightness at once (the flash on a milestone, a shake)
// asks first. At most `max` in any `windowMs` (both ends counted), so never more than 3 flashes in a second.
export function flashLimiter(max = 3, windowMs = 1000) {
  const times = [];
  return {
    allow(now = Date.now()) {
      while (times.length && now - times[0] > windowMs) times.shift();
      if (times.length >= max) return false;
      times.push(now);
      return true;
    },
    count: () => times.length,
  };
}

// ============================================================ settings and what the server says
export const MAX_LEVEL = 3;
// The stimulation level used: 0 to 3, and at most 1 with reduced motion.
export const effectiveLevel = (level, reduced) => { const l = clamp(Math.round(Number(level) || 0), 0, MAX_LEVEL); return reduced ? Math.min(1, l) : l; };
// What each level adds (stacking).
export const LEVELS = [
  'Just the gameplay',
  '+ captions and a progress bar',
  '+ a score counter and emoji rain',
  '+ a screen shake on reactions',
];
// The settings as stored on this device (one set per account), checked.
export function cleanPrefs(x) {
  const p = x && typeof x === 'object' ? x : {};
  const on = p.on && typeof p.on === 'object' ? p.on : {};
  return {
    on: { reels: on.reels === true, watch: on.watch === true, call: on.call === true },
    game: ['parkour', 'runner', 'youtube'].includes(p.game) ? p.game : 'parkour',
    yt: typeof p.yt === 'string' && /^[\w-]{11}$/.test(p.yt) ? p.yt : '',
    level: clamp(Math.round(Number(p.level) || 0), 0, MAX_LEVEL),
    warned: p.warned === true,
  };
}
// "Your own background": a YouTube video's id from a link (the same rules as server/linkpreview.js), or null.
export function youtubeVideoId(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?#]|$)/) || [])[1];
  return typeof id === 'string' && /^[\w-]{11}$/.test(id) ? id : null;
}

// Big TikTok-style captions: the reel's preview title as a few words at a time. Text only (shown with textContent,
// never as HTML), control and invisible characters taken out, at most 160 characters.
export function captionChunks(text, perChunk = 2) {
  const clean = String(text == null ? '' : text).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!clean) return [];
  const words = clean.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i += perChunk) out.push(words.slice(i, i + perChunk).join(' ').slice(0, 28));
  return out;
}

// Emoji rain: where each falling emoji is at time t (seconds). Pure, so the rain costs nothing to keep.
export function rainDrop(i, t, slow = false) {
  const R = rng(i * 7919 + 13);
  const speed = (0.08 + R() * 0.12) * (slow ? 0.5 : 1); // screen heights a second
  const x = R(); const phase = R(); const wob = R() * 0.03; const size = 0.7 + R() * 0.6;
  const y = ((phase + t * speed) % 1.15) - 0.1;
  return { x: x + Math.sin((t + phase * 10) * 1.3) * wob, y, size, emoji: i % RAIN.length };
}
// Original, generic emoji only (shown with the device's own emoji font).
export const RAIN = ['💀', '😭', '🔥', '💯', '🗿', '✨', '😂', '🤯', '⚡', '🧠'];
