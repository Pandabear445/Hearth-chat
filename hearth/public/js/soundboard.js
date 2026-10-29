// Everyone's own soundboard: short sounds they upload, name, decorate and lay out (grid or list, button size,
// order, pages), and play into the voice call they're in. The board lives in Settings → Soundboard; a button in the
// call controls opens it during a call.
//
// Privacy: like an attachment, each sound is end-to-end encrypted before it leaves this device. The audio gets a
// random key of its own (E2EE.encryptFile); that key and the sound's name, emoji, color and volume are sealed with
// the personal vault key (E2EE.vaultKey), which only this person's devices can derive, and so is the layout. The
// server only ever holds ciphertext (server/soundboard.js).
//
// Playing: the app asks the server first (voice:board: Use Soundboard and Speak here, unmuted, not too often), then
// plays the sound into its own track, which goes to the others on the call's soundboard lane (voice.js LANE.board).
// The listeners' apps let that lane through only while the server says a sound is playing, at their own soundboard
// volume, and anyone can turn other people's soundboards off (Settings → Soundboard, or per person in a call).
import { h, clear, icon, toast } from './util.js';
import { api } from './api.js';
import * as E2EE from './e2ee.js';
import { popover, closePopover, modal, confirmDialog, field } from './ui.js';
import { LIMITS, MAX_PAGES, DEFAULT_COLOR, DEFAULT_VOLUME, checkSoundFile, checkLength, cleanSoundMeta, cleanLayout, moveSound, showcaseOf, newSoundId, sniffAudio, glyphs } from './soundboard-core.js';

const LAYOUT_ID = 'layout';

// ctx: { S, vaultKey(), voice(), canPlay(room) -> '' or why not, emojiPicker(anchor, onPick), openSettings(), onMe(u), socket() }
export function createSoundboard(ctx) {
  const sounds = new Map(); // id -> cleaned meta
  let layout = cleanLayout(null, []);
  let loaded = null;
  let gen = 0;
  const buffers = new Map(); // id -> Promise<AudioBuffer>
  let ac = null; let dest = null; let current = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* a closed page */ } });

  // ------------------------------------------------------------------ storage
  function load(force = false) {
    if (loaded && !force) return loaded;
    const my = ++gen;
    loaded = (async () => {
      const key = await ctx.vaultKey();
      const r = await api('GET', '/me/soundboard');
      if (my !== gen) return;
      const next = new Map(); let rawLayout = null;
      for (const it of r.items || []) {
        try {
          if (it.kind === 'layout' && it.id === LAYOUT_ID) rawLayout = await E2EE.openVault(key, 'sound-layout', LAYOUT_ID, it.meta);
          else if (it.kind === 'sound') { const m = cleanSoundMeta(await E2EE.openVault(key, 'sound', it.id, it.meta)); if (m) next.set(it.id, m); }
        } catch { /* sealed with keys from before a reset: can't be read any more */ }
      }
      // A sound whose details changed keeps its decoded audio only if its key is the same.
      for (const [id, m] of next) if (!sounds.has(id) || sounds.get(id).k !== m.k) buffers.delete(id);
      for (const id of buffers.keys()) if (!next.has(id)) buffers.delete(id);
      sounds.clear(); next.forEach((m, id) => sounds.set(id, m));
      layout = cleanLayout(rawLayout, [...sounds.keys()]);
      changed();
    })().catch((e) => { loaded = null; throw e; });
    return loaded;
  }
  async function sealMeta(id, meta) { return E2EE.sealVault(await ctx.vaultKey(), 'sound', id, meta); }
  async function saveLayout(next) {
    layout = cleanLayout(next, [...sounds.keys()]);
    changed();
    await api('PUT', `/me/soundboard/${LAYOUT_ID}`, { kind: 'layout', meta: await E2EE.sealVault(await ctx.vaultKey(), 'sound-layout', LAYOUT_ID, layout) });
    syncShowcase();
  }
  // The profile shows the board only when its owner turned that on; it's kept in step with the board.
  async function syncShowcase() {
    const p = (ctx.S.me && ctx.S.me.profile) || {};
    if (!p.showSoundboard) return;
    const next = showcaseOf(layout, sounds);
    if (JSON.stringify(next) === JSON.stringify(p.soundShowcase || [])) return;
    try { ctx.onMe(await api('PATCH', '/me/profile', { soundShowcase: next })); } catch { /* next change tries again */ }
  }
  async function setShowcase(on) {
    ctx.onMe(await api('PATCH', '/me/profile', { showSoundboard: !!on, soundShowcase: on ? showcaseOf(layout, sounds) : [] }));
  }

  // Reads, checks and decodes a chosen file: { bytes, mime, ms } or throws with what's wrong.
  async function readFile(file) {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const why = checkSoundFile({ size: file.size, type: file.type, head });
    if (why) throw new Error(why);
    const bytes = await file.arrayBuffer();
    let decoded;
    try { decoded = await audioCtx().decodeAudioData(bytes.slice(0)); } catch { throw new Error('That sound couldn’t be read. Try another file, or save it again as an MP3.'); }
    const long = checkLength(decoded.duration);
    if (long) throw new Error(long);
    return { bytes, mime: sniffAudio(head), ms: Math.min(LIMITS.ms, Math.ceil(decoded.duration * 1000)), decoded };
  }
  // read: what readFile gave for this file already (it's decoded once, when chosen).
  async function add(file, details, read = null) {
    if (sounds.size >= LIMITS.sounds) throw new Error(`Your soundboard is full (${LIMITS.sounds} sounds). Delete one to add another.`);
    const f = read || await readFile(file);
    const id = newSoundId();
    const { blob, k } = await E2EE.encryptFile(f.bytes);
    const meta = cleanSoundMeta({ ...details, k, mime: f.mime, ms: f.ms });
    await api('PUT', `/me/soundboard/${id}`, { kind: 'sound', meta: await sealMeta(id, meta), audio: E2EE.b64(blob) });
    sounds.set(id, meta);
    buffers.set(id, Promise.resolve(f.decoded));
    await saveLayout(moveSound(layout, id, 0, Infinity));
    return id;
  }
  async function update(id, details) {
    const cur = sounds.get(id);
    if (!cur) return;
    const meta = cleanSoundMeta({ ...cur, ...details, k: cur.k, mime: cur.mime, ms: cur.ms });
    await api('PUT', `/me/soundboard/${id}`, { kind: 'sound', meta: await sealMeta(id, meta) });
    sounds.set(id, meta);
    changed();
    syncShowcase();
  }
  async function remove(id) {
    await api('DELETE', `/me/soundboard/${id}`);
    sounds.delete(id); buffers.delete(id);
    await saveLayout(layout);
  }

  // ------------------------------------------------------------------ audio
  function audioCtx() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  // What our sounds play into: the call's soundboard lane (voice.js). Silence until a sound plays.
  function track() {
    try {
      if (!dest) dest = audioCtx().createMediaStreamDestination();
      return dest.stream.getAudioTracks()[0] || null;
    } catch { return null; }
  }
  function buffer(id) {
    if (!buffers.has(id)) {
      const p = (async () => {
        const m = sounds.get(id);
        if (!m) throw new Error('That sound was deleted.');
        const r = await api('GET', `/me/soundboard/${id}/audio`);
        const plain = await E2EE.decryptFile(m.k, E2EE.unb64(r.audio));
        if (!sniffAudio(new Uint8Array(plain, 0, Math.min(64, plain.byteLength)))) throw new Error('That sound couldn’t be read.');
        return audioCtx().decodeAudioData(plain);
      })();
      p.catch(() => buffers.delete(id));
      buffers.set(id, p);
    }
    return buffers.get(id);
  }
  function stop() {
    if (!current) return;
    try { current.src.stop(); } catch { /* already over */ }
    current = null;
  }
  // Plays a sound: to the call (`call`, once the server allows it) and to ourselves, at most LIMITS.ms long.
  // toSelf: our own soundboard volume (what others' sounds play at too).
  async function start(id, { call }) {
    const m = sounds.get(id);
    if (!m) return;
    const buf = await buffer(id);
    const ms = Math.min(LIMITS.ms, Math.ceil(buf.duration * 1000));
    const allowed = call ? await ctx.voice().requestBoardPlay(ms) : ms;
    const a = audioCtx();
    stop();
    const src = a.createBufferSource();
    src.buffer = buf;
    const gain = a.createGain();
    gain.gain.value = m.volume;
    src.connect(gain);
    if (call && dest) gain.connect(dest);
    const self = a.createGain();
    self.gain.value = boardPrefs().volume;
    gain.connect(self); self.connect(a.destination);
    src.start(0, 0, Math.min(allowed, LIMITS.ms) / 1000);
    const me = { src, id };
    current = me;
    src.onended = () => { if (current === me) current = null; changed(); };
    changed();
  }
  async function play(id) {
    const v = ctx.voice();
    const why = v && v.channelId ? ctx.canPlay(v.channelId) : 'Join a voice call to play sounds.';
    if (why) { toast(why, 'error'); return; }
    try { await start(id, { call: true }); } catch (e) { toast(e.message, 'error'); }
  }
  const preview = (id) => start(id, { call: false }).catch((e) => toast(e.message, 'error'));
  const playing = (id) => !!current && current.id === id;

  // Other people's soundboards: volume, everyone's off, and per person (voice.js reads the same setting).
  function boardPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('hearth.board') || '{}');
      return { volume: Math.min(1, Math.max(0, Number.isFinite(+p.volume) ? +p.volume : 0.8)), off: !!p.off, muted: p.muted && typeof p.muted === 'object' ? p.muted : {} };
    } catch { return { volume: 0.8, off: false, muted: {} }; }
  }
  function setBoardPrefs(patch) {
    const next = { ...boardPrefs(), ...patch };
    try { localStorage.setItem('hearth.board', JSON.stringify(next)); } catch { /* storage off */ }
    const v = ctx.voice();
    if (v) v.applyPeerAudio();
    changed();
  }
  const mutedFor = (userId) => !!boardPrefs().muted[userId];
  function setMutedFor(userId, on) {
    const muted = { ...boardPrefs().muted };
    if (on) muted[userId] = true; else delete muted[userId];
    setBoardPrefs({ muted });
  }

  // ------------------------------------------------------------------ the board itself
  // One sound's button. onPress: what pressing it does (play, or preview in the editor).
  function soundButton(id, m, onPress, extra = {}) {
    return h('button', {
      type: 'button', class: `sb-btn${playing(id) ? ' playing' : ''}`, style: { '--sb-color': m.color },
      'aria-label': `${extra.label || 'Play'} ${m.name}`, title: m.name, dataset: { sound: id }, onclick: () => onPress(id), ...extra.attrs,
    }, h('span', { class: 'sb-emoji', 'aria-hidden': 'true' }, m.emoji || '🔊'), h('span', { class: 'sb-name' }, m.name));
  }
  function boardEl({ page = 0, onPress = play, empty } = {}) {
    const p = layout.pages[Math.min(page, layout.pages.length - 1)];
    const grid = h('div', { class: `sb-board sb-${layout.view} sb-size-${layout.size}`, role: 'group', 'aria-label': p.name });
    for (const id of p.ids) { const m = sounds.get(id); if (m) grid.append(soundButton(id, m, onPress)); }
    if (!p.ids.length) grid.append(h('p', { class: 'sb-empty' }, empty || 'No sounds on this page yet.'));
    return grid;
  }

  // The board as a popup from the call controls.
  function openPicker(anchor) {
    let page = 0;
    const body = h('div', { class: 'sb-pop' });
    const draw = () => {
      clear(body);
      const v = ctx.voice();
      const why = v && v.channelId ? ctx.canPlay(v.channelId) : 'Join a voice call to play sounds.';
      body.append(h('div', { class: 'sb-pop-head' }, h('strong', null, 'Soundboard'),
        h('button', { class: 'link-btn', onclick: () => { closePopover(); ctx.openSettings(); } }, sounds.size ? 'Edit' : 'Add sounds')));
      if (layout.pages.length > 1) {
        body.append(h('div', { class: 'sb-tabs', role: 'tablist' }, layout.pages.map((p, i) => h('button', {
          class: `sb-tab${i === page ? ' active' : ''}`, role: 'tab', 'aria-selected': String(i === page), onclick: () => { page = i; draw(); },
        }, p.name))));
      }
      if (why) body.append(h('p', { class: 'field-hint sb-why' }, why));
      body.append(boardEl({ page, empty: sounds.size ? 'No sounds on this page.' : 'Your soundboard is empty. Add sounds in Settings → Soundboard.' }));
      if (why) body.querySelectorAll('.sb-btn').forEach((b) => { b.disabled = true; });
    };
    load().then(draw).catch((e) => { clear(body).append(h('p', { class: 'field-hint' }, e.message)); });
    draw();
    const off = onChange(() => { if (body.isConnected) draw(); else off(); });
    popover(anchor, body, { side: 'top', align: 'center', label: 'Soundboard', className: 'sb-popover' });
  }

  // ------------------------------------------------------------------ editor (Settings → Soundboard)
  function soundDialog({ id = null, file = null, read = null } = {}) {
    const cur = id ? sounds.get(id) : null;
    const d = { name: cur ? cur.name : (file ? file.name.replace(/\.[^.]+$/, '') : '').slice(0, 32), emoji: cur ? cur.emoji : '', color: cur ? cur.color : DEFAULT_COLOR, volume: cur ? cur.volume : DEFAULT_VOLUME };
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const name = h('input', { class: 'input', maxlength: '32', value: d.name, required: true, oninput: (e) => { d.name = e.target.value; } });
    const emoji = h('input', { class: 'input emoji-input', maxlength: '16', value: d.emoji, placeholder: '🔊', 'aria-label': 'Emoji', oninput: (e) => { d.emoji = glyphs(e.target.value, 2); } });
    const pick = ctx.emojiPicker ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Pick emoji', 'data-pop-anchor': '', onclick: (e) => ctx.emojiPicker(e.currentTarget, (em) => { d.emoji = glyphs(em, 2); emoji.value = d.emoji; }) }, icon('smile')) : null;
    const color = h('input', { type: 'color', class: 'color-in', value: d.color, 'aria-label': 'Button color', oninput: (e) => { d.color = e.target.value; } });
    const vol = h('input', { type: 'range', class: 'range', min: '0', max: '1', step: '0.05', value: String(d.volume), 'aria-label': 'Volume', oninput: (e) => { d.volume = +e.target.value; } });
    const tryIt = h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
      try {
        if (id) return preview(id);
        const a = audioCtx(); const src = a.createBufferSource(); src.buffer = read.decoded;
        const g = a.createGain(); g.gain.value = d.volume * boardPrefs().volume; src.connect(g); g.connect(a.destination); src.start(0, 0, LIMITS.ms / 1000);
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    } }, icon('play'), 'Preview');
    modal({
      title: id ? 'Edit sound' : 'Add a sound', size: 'sm',
      body: h('div', { class: 'stack' }, err,
        field('Name', name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Emoji'), h('div', { class: 'row gap' }, emoji, pick)),
        field('Button color', color),
        field('Volume', vol, 'How loud it plays for everyone (each listener can still turn soundboards down).'),
        tryIt),
      actions: [
        { label: 'Cancel' },
        { label: id ? 'Save' : 'Add', kind: 'primary', action: async () => {
          if (!d.name.trim()) throw new Error('Give it a name.');
          if (id) await update(id, d); else await add(file, d, read);
          toast(id ? 'Sound saved.' : 'Sound added.');
        } },
      ],
    });
  }

  function editor() {
    const root = h('div', { class: 'set-form sb-editor' });
    const fileIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, 'aria-label': 'Choose a sound file', onchange: () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      readFile(f).then((read) => soundDialog({ file: f, read })).catch((e) => toast(e.message, 'error'));
    } });
    let page = 0;
    let dragId = null;
    const draw = () => {
      if (!root.isConnected && root.dataset.drawn) { off(); return; }
      root.dataset.drawn = '1';
      page = Math.min(page, layout.pages.length - 1);
      clear(root);
      const full = sounds.size >= LIMITS.sounds;
      const P = boardPrefs();
      const p = layout.pages[page];
      const editBtn = (id) => h('button', { class: 'icon-btn sm', 'aria-label': `Edit ${sounds.get(id).name}`, onclick: () => soundDialog({ id }) }, icon('edit'));
      const delBtn = (id) => h('button', { class: 'icon-btn sm', 'aria-label': `Delete ${sounds.get(id).name}`, onclick: async () => {
        if (!(await confirmDialog({ title: 'Delete this sound?', text: `“${sounds.get(id).name}” goes from your soundboard on every device.`, confirm: 'Delete', danger: true }))) return;
        try { await remove(id); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash'));
      const shift = (id, by) => {
        const i = p.ids.indexOf(id);
        saveLayout(moveSound(layout, id, page, i + by)).catch((e) => toast(e.message, 'error'));
      };
      const tiles = h('ol', { class: `sb-edit-list sb-${layout.view} sb-size-${layout.size}`, 'aria-label': `Sounds on ${p.name}` });
      p.ids.forEach((id, i) => {
        const m = sounds.get(id);
        if (!m) return;
        const li = h('li', {
          class: 'sb-edit-item', draggable: 'true', dataset: { sound: id },
          ondragstart: (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id); } catch { /* ok */ } li.classList.add('dragging'); },
          ondragend: () => { dragId = null; li.classList.remove('dragging'); },
          ondragover: (e) => { if (dragId && dragId !== id) { e.preventDefault(); li.classList.add('drop'); } },
          ondragleave: () => li.classList.remove('drop'),
          ondrop: (e) => { e.preventDefault(); li.classList.remove('drop'); if (dragId && dragId !== id) saveLayout(moveSound(layout, dragId, page, p.ids.filter((x) => x !== dragId).indexOf(id))).catch((er) => toast(er.message, 'error')); },
        },
        soundButton(id, m, preview, { label: 'Preview' }),
        h('span', { class: 'sb-edit-tools' },
          h('button', { class: 'icon-btn sm', 'aria-label': `Move ${m.name} earlier`, disabled: i === 0, onclick: () => shift(id, -1) }, icon('arrowUp')),
          h('button', { class: 'icon-btn sm', 'aria-label': `Move ${m.name} later`, disabled: i === p.ids.length - 1, onclick: () => shift(id, 1) }, icon('arrowDown')),
          layout.pages.length > 1 ? h('select', { class: 'input sm', 'aria-label': `Page for ${m.name}`, onchange: (e) => saveLayout(moveSound(layout, id, +e.target.value, Infinity)).catch((er) => toast(er.message, 'error')) },
            layout.pages.map((pg, j) => h('option', { value: String(j), selected: j === page ? true : null }, pg.name))) : null,
          editBtn(id), delBtn(id)));
        tiles.append(li);
      });
      if (!p.ids.length) tiles.append(h('li', { class: 'sb-empty' }, sounds.size ? 'No sounds on this page. Move some here from another page.' : 'No sounds yet. Add one: up to 5 seconds and 1 MB.'));

      const pages = h('div', { class: 'sb-pages' },
        h('div', { class: 'sb-tabs', role: 'tablist' }, layout.pages.map((pg, i) => h('button', {
          class: `sb-tab${i === page ? ' active' : ''}`, role: 'tab', 'aria-selected': String(i === page), onclick: () => { page = i; draw(); },
          ondragover: (e) => { if (dragId && i !== page) e.preventDefault(); },
          ondrop: (e) => { e.preventDefault(); if (dragId) saveLayout(moveSound(layout, dragId, i, Infinity)).catch((er) => toast(er.message, 'error')); },
        }, pg.name, ` (${pg.ids.length})`))),
        h('div', { class: 'row gap' },
          h('input', { class: 'input sm', maxlength: '24', value: p.name, 'aria-label': 'Page name', onchange: (e) => { const next = { ...layout, pages: layout.pages.map((x, j) => (j === page ? { ...x, name: e.target.value } : x)) }; saveLayout(next).catch((er) => toast(er.message, 'error')); } }),
          layout.pages.length < MAX_PAGES ? h('button', { class: 'btn ghost sm', onclick: () => { page = layout.pages.length; saveLayout({ ...layout, pages: [...layout.pages, { name: `Page ${layout.pages.length + 1}`, ids: [] }] }).catch((er) => toast(er.message, 'error')); } }, '+ Page') : null,
          layout.pages.length > 1 ? h('button', { class: 'btn ghost sm', onclick: () => {
            // A page's sounds move to the first page; none are deleted.
            const rest = layout.pages.filter((x, j) => j !== page);
            rest[0] = { ...rest[0], ids: [...rest[0].ids, ...p.ids] };
            page = 0;
            saveLayout({ ...layout, pages: rest }).catch((er) => toast(er.message, 'error'));
          } }, 'Remove page') : null));

      const chipRow = (options, value, onPick, label) => h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label }, options.map(([v, l]) => h('button', {
        type: 'button', class: `chip${v === value ? ' active' : ''}`, role: 'radio', 'aria-checked': String(v === value), onclick: () => onPick(v),
      }, l)));
      const showOn = !!((ctx.S.me && ctx.S.me.profile) || {}).showSoundboard;
      const muted = Object.keys(P.muted);
      root.append(
        h('h2', { class: 'set-title' }, 'Soundboard'),
        h('p', { class: 'field-hint' }, 'Your own sounds, to play into any voice call you’re in. They’re end-to-end encrypted: only your devices can read them; the people in a call just hear them.'),
        h('section', { class: 'set-section' }, h('h3', { class: 'set-h' }, `Your sounds (${sounds.size}/${LIMITS.sounds})`),
          h('div', { class: 'row gap' }, h('button', { class: 'btn primary sm', disabled: full ? true : null, onclick: () => fileIn.click() }, icon('plus'), 'Add a sound'),
            h('span', { class: 'field-hint' }, full ? 'Your soundboard is full. Delete a sound to add another.' : 'MP3, OGG, WAV, M4A, WebM or FLAC, up to 5 seconds and 1 MB.')),
          fileIn, pages, tiles,
          h('p', { class: 'field-hint' }, 'Drag sounds to reorder them, or onto a page’s tab to move them there.')),
        h('section', { class: 'set-section' }, h('h3', { class: 'set-h' }, 'Layout'),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Show as'), chipRow([['grid', 'Grid'], ['list', 'List']], layout.view, (v) => saveLayout({ ...layout, view: v }).catch((e) => toast(e.message, 'error')), 'Show as')),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Button size'), chipRow([['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], layout.size, (v) => saveLayout({ ...layout, size: v }).catch((e) => toast(e.message, 'error')), 'Button size'))),
        h('section', { class: 'set-section' }, h('h3', { class: 'set-h' }, 'Other people’s soundboards'),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Volume ', h('span', { class: 'counter' }, `${Math.round(P.volume * 100)}%`)),
            h('input', { type: 'range', class: 'range', min: '0', max: '1', step: '0.05', value: String(P.volume), 'aria-label': 'Soundboard volume', onchange: (e) => setBoardPrefs({ volume: +e.target.value }) })),
          h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Mute everyone’s soundboard'), h('span', { class: 'field-hint' }, 'You still hear their voices. Your own sounds still play for others.')),
            h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: P.off, 'aria-label': 'Mute everyone’s soundboard', onchange: (e) => setBoardPrefs({ off: e.target.checked }) }), h('span', { class: 'switch-track' }))),
          muted.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Muted soundboards'),
            h('ul', { class: 'sb-muted' }, muted.map((uid) => h('li', null, h('span', null, ctx.userName ? ctx.userName(uid) : uid),
              h('button', { class: 'link-btn', onclick: () => setMutedFor(uid, false) }, 'Unmute'))))) : h('p', { class: 'field-hint' }, 'To mute one person’s soundboard, right-click them in a call.')),
        h('section', { class: 'set-section' }, h('h3', { class: 'set-h' }, 'On your profile'),
          h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Show my soundboard on my profile'),
            h('span', { class: 'field-hint' }, 'Shows the names, emoji and colors of your first 12 sounds to anyone who opens your profile. The sounds themselves stay private.')),
          h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: showOn, 'aria-label': 'Show my soundboard on my profile', onchange: (e) => setShowcase(e.target.checked).catch((er) => { e.target.checked = !e.target.checked; toast(er.message, 'error'); }) }), h('span', { class: 'switch-track' })))),
      );
    };
    const off = onChange(draw);
    root.append(h('p', { class: 'field-hint' }, 'Loading your soundboard…'));
    load().then(draw).catch((e) => { clear(root).append(h('p', { class: 'form-error' }, e.message)); });
    return root;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return {
    load, reset: () => { gen++; loaded = null; sounds.clear(); buffers.clear(); layout = cleanLayout(null, []); stop(); },
    track, play, preview, stop, openPicker, editor, onChange,
    boardPrefs, setBoardPrefs, mutedFor, setMutedFor,
    get sounds() { return sounds; }, get layout() { return layout; },
  };
}
