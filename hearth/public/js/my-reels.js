// My Reels: your private feed of TikToks and reels (server/myreels.js, docs/design/SCROLL-TOGETHER.md). Kept in your
// personal vault: sealed on this device with your vault key (only your identity key makes it), numbered and padded,
// so the server stores ciphertext whose size says little. This device keeps the newest sealed copy it opened, so a
// server that hands back an older one can't quietly bring back what you removed.
//
// Each video: { k: 't' | 'i', id, ty?: 'reel' | 'p', at } (TikTok or Instagram, its checked id, when it was added).
import * as E2EE from './e2ee.js';
import { IG_CODE, TIKTOK_ID } from './social.js';

export const MAX = 5000;
const PAD = 16384;
export const SEALED_MAX = 512 * 1024; // as the server's (server/myreels.js)
const enc = new TextEncoder();

// The videos in a list as given, checked: only ids social.js would accept, each once, at most MAX, newest first.
export function cleanList(list) {
  const out = []; const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== 'object') continue;
    const k = x.k === 't' || x.k === 'i' ? x.k : null;
    const id = typeof x.id === 'string' ? x.id : '';
    if (!k || !(k === 't' ? TIKTOK_ID : IG_CODE).test(id)) continue;
    const key = `${k}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ k, id, ...(k === 'i' ? { ty: x.ty === 'p' ? 'p' : 'reel' } : {}), at: Number.isFinite(+x.at) ? +x.at : 0 });
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => b.at - a.at);
}
// A video as My Reels keeps it, from social.js's parse.
export const entryOf = (p, at = Date.now()) => (p && p.id ? { k: p.kind === 'tiktok' ? 't' : 'i', id: p.id, ...(p.kind === 'instagram' ? { ty: p.type === 'p' ? 'p' : 'reel' } : {}), at } : null);
// Its link (social.js's form), for the feed.
export const linkOf = (e) => (e.k === 't' ? `https://www.tiktok.com/embed/v2/${e.id}` : `https://www.instagram.com/${e.ty === 'p' ? 'p' : 'reel'}/${e.id}/`);

// deps: { api(method, path, body), vaultKey(), me(), store: { get(), set(v) } (this device's newest copy) }
export function createMyReels(deps) {
  let list = []; let at = 0; let seq = 0; let loaded = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => { try { f(list); } catch { /* a listener's problem */ } });
  async function open(data) {
    const v = await E2EE.openVault(await deps.vaultKey(), 'myreels', deps.me(), data);
    if (!v || v.v !== 1 || !Number.isSafeInteger(v.n)) throw new Error('Unknown format');
    return v;
  }
  async function load() {
    const r = await deps.api('GET', '/me/reels');
    const local = deps.store.get();
    let body = null;
    if (r && r.data) body = await open(r.data);
    // A copy older than the one this device already opened is the server going back in time: ours wins.
    if (local && local.data && (!body || body.n < local.n)) body = await open(local.data).catch(() => body);
    list = body ? cleanList(body.list) : [];
    seq = body ? body.n : 0;
    at = r ? r.updatedAt || 0 : 0;
    changed();
    return list;
  }
  const ready = () => (loaded = loaded || load().catch((e) => { loaded = null; throw e; }));
  // change(list) -> the new list. Refused as stale (another device saved first): their list is loaded and the same
  // change made to it, so neither device's change is lost or undone.
  async function save(change, retry = true) {
    const n = seq + 1;
    const body = { v: 1, n, list: cleanList(change(list)), pad: '' };
    const size = enc.encode(JSON.stringify(body)).length;
    body.pad = ' '.repeat((PAD - (size % PAD)) % PAD);
    const data = await E2EE.sealVault(await deps.vaultKey(), 'myreels', deps.me(), body);
    if (data.length > SEALED_MAX) throw new Error('My Reels is full. Remove some videos first.');
    try {
      const r = await deps.api('PUT', '/me/reels', { data, base: at });
      at = r.updatedAt; seq = n; list = body.list;
      deps.store.set({ n, data });
      changed();
      return list;
    } catch (e) {
      if (e && e.code === 'stale' && retry) { await load(); return save(change, false); }
      throw e;
    }
  }
  return {
    ready, load, list: () => list,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    // Adds videos (social.js parses or entries); returns how many were new.
    async add(items) {
      await ready();
      const now = Date.now();
      const entries = items.map((p, i) => (p && p.k ? p : entryOf(p, now - i))).filter(Boolean);
      let added = 0;
      await save((cur) => {
        const have = new Set(cur.map((e) => `${e.k}:${e.id}`));
        const fresh = entries.filter((e) => !have.has(`${e.k}:${e.id}`));
        if (cur.length + fresh.length > MAX) throw new Error(`My Reels holds ${MAX} videos at most. Remove some first.`);
        added = fresh.length;
        return [...fresh, ...cur];
      });
      return added;
    },
    async remove(keys) {
      await ready();
      const gone = new Set(keys);
      await save((cur) => cur.filter((e) => !gone.has(`${e.k}:${e.id}`)));
    },
    // Another device saved (myreels:changed).
    onRemote(updatedAt) { if (loaded && updatedAt !== at) load().catch(() => {}); },
  };
}
