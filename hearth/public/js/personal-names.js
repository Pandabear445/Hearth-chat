// Personal nicknames (server/personalnames.js): a name you give someone that only you see, like a friend nickname on
// Discord. Right-click (or long-press) them, or open their profile, and pick "Set nickname". It's shown instead of
// their name everywhere this app shows one (profile-ui.js displayName and displayNameIn): messages, member lists,
// DMs, calls, notifications, search, suggestions. It comes first, then their nickname in that server, then their
// display name, then their username. Their profile keeps who they really are on show, marked "Your nickname".
//
// The list is end-to-end encrypted with your personal vault key (like your word filter) and synced to your devices:
// the server stores ciphertext, padded so its size says little, and never learns whom you renamed or to what. It
// carries a number that goes up with every save, sealed inside it; this device remembers the highest it has opened
// (and that sealed copy), so a server that hands back an older copy, or none, can't quietly undo a change.
import { h, clear, icon, toast } from './util.js';
import { api } from './api.js';
import * as E2EE from './e2ee.js';
import { modal, field, confirmDialog } from './ui.js';

export const NAME_MAX = 32;
export const LIST_MAX = 1000;
// The biggest sealed list the server keeps (server/personalnames.js SEALED_MAX): a full list fits under it, and a
// save past it is refused here with a clear message rather than by the server.
export const SEALED_MAX = 320 * 1024;
const PAD = 4096; // the sealed list is padded to a multiple of this
const enc = new TextEncoder();
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// The same rules as a server nickname (server/nicknames.js cleanNickname): line breaks and control characters become
// spaces, invisible and direction-changing characters go (they could make one name pass for another, even to you),
// except the joiners and variation selectors emoji need, and the tags inside a flag.
const BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const HIDDEN = /\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{2,7}\u{E007F}|[\p{Default_Ignorable_Code_Point}￹-￻]/gu;
const KEEP = /^(?:\u{1F3F4}.*|[‌‍︀-️\u{E0100}-\u{E01EF}])$/u;
const BLANK = /[\p{Default_Ignorable_Code_Point}\s⠀]/gu;
// Half of an emoji's pair on its own isn't a character anyone can see, and JSON would keep it as six bytes of \\u escape.
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// The name as it will be kept: '' for none. Throws (with a message to show) for one too long or with nothing visible.
export function cleanName(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') throw new Error('A nickname is text.');
  if (v.length > 512) throw new Error(`A nickname is up to ${NAME_MAX} characters.`);
  const t = v.replace(LONE, '').replace(BREAKS, ' ').replace(HIDDEN, (c) => (KEEP.test(c) ? c : '')).replace(/\s+/g, ' ').trim();
  if (!t) {
    if (v.trim()) throw new Error('A nickname needs at least one character you can see.');
    return '';
  }
  if (!t.replace(BLANK, '')) throw new Error('A nickname needs at least one character you can see.');
  if ([...t].length > NAME_MAX) throw new Error(`A nickname is up to ${NAME_MAX} characters.`);
  return t;
}
// What a sealed list may hold: ids and names that pass the rules above, at most LIST_MAX of them.
export function cleanList(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  let n = 0;
  for (const [id, name] of Object.entries(o)) {
    if (n >= LIST_MAX) break;
    if (!ID.test(id)) continue;
    let c = '';
    try { c = cleanName(name); } catch { continue; }
    if (c) { out[id] = c; n++; }
  }
  return out;
}

// This device's copy of your sealed list: { n, data } in its own storage, per account (the sealed text, nothing
// readable).
const localCopy = (key) => ({
  get() { try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); return v && Number.isSafeInteger(v.n) && typeof v.data === 'string' ? v : null; } catch { return null; } },
  set(v) { try { localStorage.setItem(key(), JSON.stringify(v)); } catch { /* storage full or off: only the check is lost */ } },
});

// S: the app's state; vaultKey(): your personal vault key; onChange(): names changed, so what's on screen should be
// drawn again; store: where this device keeps its copy of the sealed list (tests pass their own); request: the API
// (tests pass their own).
export function createPersonalNames({ S, vaultKey, onChange = () => {}, store = localCopy(() => `hearth.personalNames.${S.me && S.me.id}`), request = api }) {
  let names = {};
  let at = 0; // the saved list's version (the server's updatedAt)
  let seq = 0; // the number sealed inside the list in use
  let unreadable = false; // a saved list this device couldn't open
  let behind = false; // the server's copy is older than one this device has opened, so this device's is used
  let saving = 0;
  let saved = 0; // how many saves this device has made, so a load that started before one can tell
  let missed = null; // a change announced while a save was on its way (it may be this device's own)
  let section = null; // the settings list, while it's open: { root, refresh }

  const open = async (data) => {
    const body = await E2EE.openVault(await vaultKey(), 'nicknames', S.me.id, data);
    return { list: cleanList(body && body.names), n: Number.isSafeInteger(body && body.n) && body.n > 0 ? body.n : 0 };
  };
  const set = (next, quiet) => {
    names = next;
    if (!quiet) onChange();
    if (section && section.root.isConnected) section.refresh();
  };
  // The saved list: what GET /me/personal-nicknames answered. quiet: at start-up, before anything is drawn.
  // Nothing changes until the list is open, and a list fetched before one of this device's saves landed is dropped
  // (saved counts them), so a slow load can't put back the version a save just replaced.
  async function apply(r, { quiet = false, since = saved } = {}) {
    let bad = false;
    let ahead = false;
    let next = {};
    let n = 0;
    if (r && r.data) {
      try { ({ list: next, n } = await open(r.data)); } catch { bad = true; }
    }
    const local = store.get();
    let keep = null;
    if (local && local.n > n) {
      // Older than (or missing next to) a copy this device has opened: keep using this device's; saving puts it back.
      try {
        const kept = await open(local.data);
        if (kept.n === local.n) { next = kept.list; n = kept.n; ahead = true; bad = false; }
      } catch { /* sealed with a key this account no longer has */ }
    } else if (r && r.data && !bad && n) keep = { n, data: r.data };
    if (since !== saved) return;
    if (keep) store.set(keep);
    at = (r && r.updatedAt) || 0;
    unreadable = bad;
    behind = ahead;
    seq = n;
    set(next, quiet);
  }
  const load = async () => { const since = saved; return apply(await request('GET', '/me/personal-nicknames'), { since }); };

  // Sealed with your vault key, bound to your account, numbered, padded, then saved against the version this device
  // has. If another device saved since, the newer list is loaded and the same change made to it.
  async function saveWith(change, { retry = true } = {}) {
    // Counted as saving before anything waits, so a change announced meanwhile is held back (missed) instead of
    // loading another device's list under this save. The version the change is made to is taken at the same moment as
    // the list it's made from: if another device's list arrives while this one is sealed, the save goes out against
    // the older version, is refused as stale, and the change is made again on top of the newer list.
    saving++;
    try {
      const base = at;
      const next = cleanList(change({ ...names }));
      const local = store.get();
      const n = Math.max(seq, local ? local.n : 0) + 1;
      const body = { v: 1, n, names: next, pad: '' };
      const size = enc.encode(JSON.stringify(body)).length;
      body.pad = ' '.repeat((PAD - (size % PAD)) % PAD);
      const data = await E2EE.sealVault(await vaultKey(), 'nicknames', S.me.id, body);
      if (data.length > SEALED_MAX) throw new Error('That list of nicknames is too big to save. Remove some first.');
      const r = await request('PUT', '/me/personal-nicknames', { data, base });
      saved++;
      at = r.updatedAt;
      store.set({ n, data });
      seq = n;
      unreadable = false;
      behind = false;
      set(next, false);
    } catch (e) {
      if (e.code === 'stale' && retry) { await load(); return saveWith(change, { retry: false }); }
      throw e;
    } finally {
      if (--saving === 0 && missed) { const p = missed; missed = null; if (p.updatedAt !== at) load().catch(() => {}); }
    }
  }
  // Gives (or, with '', takes away) your nickname for someone. Returns the name kept.
  // A saved list this device can't open is never replaced by accident (a key not ready yet, a damaged copy): it's
  // tried again first, and only startOver() replaces it.
  async function readable() {
    if (!unreadable) return;
    await load().catch(() => {});
    if (unreadable) throw Object.assign(new Error('Your saved nicknames couldn\u2019t be opened on this device, so nothing was changed. Start a new list in Settings \u2192 Privacy & safety if they\u2019re lost for good.'), { code: 'unreadable' });
  }
  async function setName(userId, name) {
    if (!ID.test(String(userId || '')) || (S.me && userId === S.me.id)) throw new Error('You can only give other people a nickname.');
    await readable();
    const clean = cleanName(name);
    if (clean && !names[userId] && Object.keys(names).length >= LIST_MAX) throw new Error(`You can give up to ${LIST_MAX} people a nickname. Remove some first.`);
    await saveWith((list) => { if (clean) list[userId] = clean; else delete list[userId]; return list; });
    return clean;
  }
  const clearAll = async () => { await readable(); return saveWith(() => ({})); };
  const startOver = () => saveWith(() => ({}));

  function listen(socket) {
    socket.on('personalnicks:changed', (p = {}) => {
      if (saving) { missed = p; return; }
      if (p.updatedAt !== at) load().catch(() => {});
    });
  }

  // ------------------------------------------------------------------ the dialog
  // u: who; realName(u): their own name; done(): after a change.
  function openEditor(u, { realName, done = () => {} } = {}) {
    if (!u || !S.me || u.id === S.me.id) return;
    const cur = names[u.id] || '';
    const own = realName ? realName(u) : u.username;
    const inp = h('input', { class: 'input', maxlength: String(NAME_MAX * 2), value: cur, placeholder: own, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nickname' });
    const save = async (v) => {
      let kept;
      try { kept = await setName(u.id, v); } catch (e) { toast(e.message, 'error'); return false; }
      toast(kept ? `${own} shows as ${kept} for you.` : `Nickname removed: ${own} shows as ${own} again.`);
      done();
      return true;
    };
    modal({ title: cur ? `Change your nickname for ${own}` : `Set a nickname for ${own}`, size: 'sm',
      body: h('div', { class: 'stack' },
        field('Nickname', inp, `Only you see it, on all your devices: it replaces their name everywhere Hearth shows it to you. It’s end-to-end encrypted, so the server can’t read it, and ${own} isn’t told. Their profile still shows @${u.username}. Up to ${NAME_MAX} characters; leave it empty to remove it.`)),
      actions: [
        cur ? { label: 'Remove nickname', action: () => save('') } : null,
        { label: 'Cancel' },
        { label: 'Save', kind: 'primary', action: () => save(inp.value) },
      ].filter(Boolean) });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.closest('.modal')?.querySelector('.modal-foot .btn.primary')?.click(); } });
    setTimeout(() => inp.select(), 50);
  }

  // ------------------------------------------------------------------ settings
  // Privacy & safety → Nicknames only you see: everyone you renamed, with Change and Remove, and Remove all.
  // getUser(id), realName(u), avatarEl(u, size): the app's.
  function settingsSection({ getUser, realName, avatarEl }) {
    const root = h('section', { class: 'set-section pnick-set', id: 'personal-nicknames' });
    const draw = () => {
      clear(root);
      const ids = Object.keys(names).sort((a, b) => names[a].localeCompare(names[b]));
      root.append(
        h('h3', { class: 'set-h' }, 'Nicknames only you see'),
        h('p', { class: 'set-sub' }, 'Names you gave people show instead of theirs everywhere, on all your devices. They’re end-to-end encrypted: the server can’t read them, and nobody is told. Right-click someone (or long-press), or open their profile, to set one.'),
        unreadable ? h('p', { class: 'wf-note bad' }, icon('lock'), h('span', null, 'Your saved nicknames couldn’t be opened on this device (they may have been saved with a key this account no longer has), so they can’t be changed here. ',
          h('button', { class: 'link-btn', type: 'button', onclick: async () => {
            if (!(await confirmDialog({ title: 'Start a new list of nicknames?', text: 'The saved list that can’t be opened is replaced with an empty one, on all your devices.', confirm: 'Start a new list', danger: true }))) return;
            try { await startOver(); toast('New list started.'); } catch (err) { toast(err.message, 'error'); }
          } }, 'Start a new list'))) : null,
        behind ? h('p', { class: 'wf-note bad' }, icon('shield'),
          h('span', null, 'The server sent an older copy of your nicknames than this device has already seen (or none), so this device keeps using its own. ',
            h('button', { class: 'link-btn', type: 'button', onclick: async (e) => {
              e.currentTarget.disabled = true;
              try { await saveWith((l) => l); toast('Your nicknames are saved again.'); } catch (err) { toast(err.message, 'error'); draw(); }
            } }, 'Save this device’s copy again'))) : null,
        ids.length
          ? h('div', { class: 'stack tight pnick-list' }, ids.map((id) => {
            const u = getUser(id);
            const own = u && u.username ? realName(u) : 'Someone you no longer share a server with';
            return h('div', { class: 'ss-row pnick-row', dataset: { userId: id } },
              u ? avatarEl(u, 30) : null,
              h('span', { class: 'ss-row-name' }, h('bdi', { class: 'pnick-name' }, names[id]), h('span', null, u && u.username ? h('bdi', null, `${own} (@${u.username})`) : own)),
              u && u.username ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openEditor(u, { realName }) }, 'Change') : null,
              h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Remove your nickname for ${own}`, onclick: async (e) => {
                e.currentTarget.disabled = true;
                try { await setName(id, ''); toast('Nickname removed.'); } catch (err) { toast(err.message, 'error'); draw(); }
              } }, 'Remove'));
          }))
          : h('p', { class: 'field-hint' }, 'You haven’t given anyone a nickname.'),
        ids.length ? h('div', { class: 'row gap' }, h('button', { class: 'btn ghost danger sm', type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: 'Remove all your nicknames?', text: `Everyone shows by their own name again, on all your devices (${ids.length} ${ids.length === 1 ? 'person' : 'people'}).`, confirm: 'Remove all', danger: true }))) return;
          try { await clearAll(); toast('All your nicknames are removed.'); } catch (err) { toast(err.message, 'error'); }
        } }, 'Remove all')) : null);
    };
    section = { root, refresh: draw };
    draw();
    return root;
  }

  return {
    apply, load, listen, setName, clearAll, startOver, openEditor, settingsSection,
    get: (id) => names[id] || '',
    all: () => ({ ...names }),
    state: () => ({ at, seq, unreadable, behind }),
    // For "Download your data": what this device decrypted (the server only has it sealed).
    exportable: () => Object.entries(names).map(([userId, nickname]) => ({ userId, nickname })),
  };
}
