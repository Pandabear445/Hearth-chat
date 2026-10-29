// Per-session key management on top of e2ee.js:
// - unlocks/creates your signing key
// - keeps every server's group keys (epochs) you've been given, verifying who shared them
// - rotates a server's key when someone leaves, and shares the current key with new members
// - encrypts/decrypts channel messages and DMs, and signs/verifies voice handshakes
import * as E2EE from './e2ee.js';
import { api } from './api.js';
import { cleanFiles } from './attachments.js';
import { cleanLinks } from './linkpreview.js';
import { cleanX } from './disappear.js';
import { bindingOf, photoOf } from './binding.js';
// A quote the server sent without its ciphertext (server/index.js quoteOf): nothing to open here.
export const BIG_QUOTE = Object.freeze({ t: '', f: [], big: true });

// The news bot's account (server/newsbot.js): the only one that still posts plaintext channel messages.
const NEWS_BOT_ID = 'newsbot00000000000001';

// A poll inside a message: question, 2–10 options, single or multiple choice. Anything else is dropped.
function cleanPoll(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.o)) return undefined;
  const o = p.o.map((x) => String(x || '').slice(0, 100)).filter(Boolean).slice(0, 10);
  if (o.length < 2) return undefined;
  return { q: String(p.q || '').slice(0, 300), o, m: !!p.m };
}

// A chat background (chat-look.js, e2ee.js lkc1 / lkd1) as it's sealed and as it's opened: { bg, dim }, where bg is a
// preset by its id ({ kind: 'preset', preset }), or a picture: its upload address on this server, its file key, its
// size in pixels (0 when unknown) and its type, one of the picture types a browser shows as a background
// ({ kind: 'image', url, k, w, h, type }). dim is how much it's darkened, 0 to 0.8. null for anything else, so nothing
// else in a payload ever reaches the page, and whatever does fits the one 512-byte size (e2ee.js LOOK_BYTES).
export const LOOK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const LOOK_DIM_MAX = 0.8;
const LOOK_PRESET = /^[a-z][a-z0-9-]{0,31}$/;
const LOOK_FILE = /^\/uploads\/[a-z0-9]{1,80}\.bin$/; // what the server links to a background (an encrypted upload)
const LOOK_KEY = /^[A-Za-z0-9+/]{43}=$/; // a file key: 32 bytes (e2ee.js encryptFile)
export function cleanLook(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !p.bg || typeof p.bg !== 'object' || Array.isArray(p.bg)) return null;
  const d = typeof p.dim === 'number' && Number.isFinite(p.dim) ? p.dim : 0;
  const dim = Math.round(Math.min(LOOK_DIM_MAX, Math.max(0, d)) * 100) / 100;
  const b = p.bg;
  if (b.kind === 'preset') return typeof b.preset === 'string' && LOOK_PRESET.test(b.preset) ? { bg: { kind: 'preset', preset: b.preset }, dim } : null;
  if (b.kind !== 'image' || typeof b.url !== 'string' || !LOOK_FILE.test(b.url) || typeof b.k !== 'string' || !LOOK_KEY.test(b.k) || !LOOK_TYPES.includes(b.type)) return null;
  const px = (n) => (Number.isInteger(n) && n >= 0 && n <= 20000 ? n : 0);
  return { bg: { kind: 'image', url: b.url, k: b.k, w: px(b.w), h: px(b.h), type: b.type }, dim };
}

// A record's keys as this app takes them: a key not spelled the one way a key is (e2ee.js canonicalKey) counts as none
// listed at all, so it's never encrypted to, pinned or compared, and for someone pinned it's a key change. Every
// record of someone goes through this as it comes in (mergeUser, and the start-up's list in app.js loadBootstrap).
export function cleanKeys(x) {
  if (!x || typeof x !== 'object') return x;
  let out = x;
  for (const f of ['publicKey', 'signPublicKey']) if (x[f] && !E2EE.canonicalKey(x[f])) out = { ...out, [f]: null };
  return out;
}

// Marks the server sends only while they're set (server/index.js publicUser: keysReset, deleted, bot).
const ONLY_WHILE_SET = ['keysReset', 'deleted', 'bot'];
// A user object from the server on top of what the app had. A whole one (it always has publicKey) that leaves one of
// those marks out means it's off now (keysReset: they're verified; deleted: the account isn't), so it mustn't linger
// from before: a single record that said "deleted" would otherwise refuse that person's calls until a reload.
export function mergeUser(old, x) {
  // A record never turns into another account's: pins and trust are looked up by its id, so a server that relabelled
  // whoever is stored here would get its own keys checked against someone else's pin (or none).
  if (old && old.id && x && 'id' in x && x.id !== old.id) return old;
  const u = { ...(old || {}), ...cleanKeys(x) };
  if (x && 'publicKey' in x) for (const k of ONLY_WHILE_SET) if (!(k in x)) delete u[k];
  return u;
}

// What the app says when it refused a call connection (app.js callWarning; why from checkSdp, 'self' from voice.js
// handleSignal, or 'not-in-dm' from voice.js createPeer too).
export function callRefusedText(why, name) {
  if (why === 'key-changed') return `${name}’s security key changed, so their call connection was blocked. Compare safety numbers with them (their profile → Verify encryption) before you talk.`;
  if (why === 'deleted') return `Blocked a call connection in the name of ${name}: that account was deleted, so it can’t be in a call.`;
  if (why === 'no-key') return `Blocked a call connection from ${name}: the server lists no usable security key for them, so it can’t be checked.`;
  if (why === 'lookup-failed') return `Blocked a call connection from ${name}: their security key couldn’t be loaded to check it.`;
  if (why === 'self') return 'Blocked a call connection that claimed to come from your own account. Only the server could have sent it.';
  if (why === 'not-in-dm') return `Blocked a call connection with ${name}: this 1-to-1 call is with someone else, so only the server could have put them in it.`;
  return `Blocked a voice connection from ${name}: its security signature didn't check out.`;
}
// Why there are no safety numbers to compare with someone (app.js openSafetyNumber), or null when there are: the
// server lists no identity key for them (one that blanked or left it out, a bot, or an account deleted long ago).
export function noSafetyNumbersText(user, name) {
  if (!user || (typeof user.publicKey === 'string' && user.publicKey)) return null;
  return user.deleted ? 'This account was deleted, so there are no safety numbers to compare.'
    : `The server lists no security key for ${name}, so there are no safety numbers to compare. Calls with them stay blocked until it lists their key again.`;
}

// S.pqSeed: this device's copy of the account's post-quantum (ML-KEM-768) seed, or null (none yet: the password gives
// it, from the envelope). onDmKeys(null): the seed arrived, so DM messages waiting for it can be opened now.
// onNeedPassword(why): this device needs the password once to finish setting up the post-quantum key ('seed': it
// doesn't have it; 'publish': it isn't published; 'upgrade': the account has none yet), or null once it doesn't. onPqUpgraded(): this account just got its
// post-quantum key (a recovery key made before then doesn't hold it).
export function createSecure({ S, onKeysChanged = () => {}, onKeyWarning = () => {}, onDmKeys = () => {}, onNeedPassword = () => {}, onPqUpgraded = () => {} }) {
  // A link preview the sender put in the message (linkpreview.js cleanLinks), as { l } or nothing at all.
  // Never throws: a bad preview must not make the message itself unreadable.
  const linksIn = (payload) => {
    if (payload.l === undefined) return {};
    try {
      const origin = typeof location !== 'undefined' ? location.host : '';
      const l = cleanLinks(payload.l, String(payload.t || ''), { origin, anyPort: !!(S.config && S.config.linkPreviewAnyPort) });
      return l ? { l } : {};
    } catch { return {}; }
  };
  // Where the message says it belongs (binding.js, crypto-7), as { b } or nothing: the app checks it against what
  // the server says. Never throws either.
  const bindIn = (payload) => {
    try { const b = bindingOf(payload); return b ? { b } : {}; } catch { return {}; }
  };
  // Which photo of the replied-to message a comment is about (binding.js photoOf), as { ph } or nothing. Never throws.
  const photoIn = (payload) => {
    try { const ph = photoOf(payload); return ph ? { ph } : {}; } catch { return {}; }
  };
  const groupKeys = new Map(); // serverId -> Map(epoch -> Uint8Array)
  const states = new Map(); // serverId -> key state from the server
  const waiters = new Map(); // serverId -> [resolve]
  const busy = new Set();
  const warned = new Set();
  const fetching = new Map();
  const generation = new Map(); // serverId -> bumps whenever new keys arrive
  const reported = new Set(); // keys we couldn't unlock and asked to be re-shared
  const rewrapped = new Set(); // `${serverId}|${epoch}`: keys already re-wrapped to ourselves this session
  const unverified = new Set(); // `${serverId}|${epoch}`: keys only a server-listed past key vouched for (reading only)
  const waitingPq = new Set(); // serverIds with a key locked to the post-quantum seed this device doesn't have yet

  // ---------------------------------------------------------------- people + trust
  async function userWithKeys(id) {
    // You: with the keys this device proved are yours, whatever a record of you says (S.users holds the server's).
    if (S.me && id === S.me.id) return { ...(S.users[id] || {}), ...S.me, ...(proven ? { publicKey: proven.e, signPublicKey: proven.s } : {}) };
    let u = S.users[id];
    if (u && u.id !== id) throw wrongAccount();
    if (u && (u.publicKey || u.deleted)) return u;
    if (!fetching.has(id)) fetching.set(id, api('GET', '/users/' + id).then((x) => { S.users[id] = mergeUser(S.users[id], sameAccount(id, x)); return S.users[id]; }).finally(() => fetching.delete(id)));
    u = await fetching.get(id);
    return u;
  }
  // crypto-2: someone whose keys a password reset without their recovery key replaced, and who is still held back in
  // at least one server or group they were in before (nobody there who knew them has verified them yet).
  const awaitingVerify = (user) => !!user && !!user.keysReset;
  // Held back in this server or group: the server keeps its key from them (and won't store one handed to them) until
  // someone here verifies them, so the apps don't try either; their own app says to ask for it. A member's word only
  // counts where they're a member, so someone can be held in one server and not in another: the server's list says
  // which (a state without one falls back on the account-wide mark).
  function isHeld(serverId, id) {
    const st = states.get(serverId);
    if (st && Array.isArray(st.held)) return st.held.includes(id);
    return awaitingVerify(id === S.me.id ? S.me : S.users[id]);
  }
  const heldBack = (serverId, id) => id !== S.me.id && isHeld(serverId, id);
  function trust(user) {
    if (!user || user.id === S.me.id) return true;
    const ok = E2EE.checkPin(S.me.id, user) === 'ok';
    if (!ok && !warned.has(user.id)) { warned.add(user.id); onKeyWarning(user); }
    if (ok) E2EE.notePqListed(S.me.id, user); // (their post-quantum key, if listed: see e2ee.js listPq)
    return ok;
  }
  const keyChanged = (user) => !!user && user.id !== S.me.id && E2EE.checkPin(S.me.id, user) === 'changed';
  // keyChanged for a whole list at once (the member list): a Set of the ids whose keys changed.
  const keysChanged = (users) => E2EE.checkPins(S.me.id, users);
  // false (and nothing trusted) for a record with no identity key: there's nothing to verify.
  function acceptKeys(user) { const ok = E2EE.acceptPin(S.me.id, user); if (ok) { warned.delete(user.id); pqChecked.clear(); } return ok; }
  // Someone's keys to open (which: 'e', identity keys) or check (which: 's', signing keys) what they wrote at
  // `at` (ms; 0 if unknown), best first, each with how far it's trusted:
  //   'now'     their current key, or the one this device pinned for them (the same one unless it changed)
  //   'new'     their current key when it changed and you haven't verified it yet
  //   'pinned'  a key this device trusted for them before they changed keys; only for what was written before this
  //             device saw the change (by its own clock)
  //   'listed'  a key the server says they had before a password reset, that this device never saw as theirs.
  //             Nothing vouches for it (the server could list a key of its own), so whatever only it opens or
  //             checks out is shown as "older key, not verified", and it never vouches for the key to write with.
  function keysOf(user, which, at = 0) {
    const out = [];
    if (!user) return out;
    const add = (key, trust) => { if (key && !out.some((x) => x.key === key)) out.push({ key, trust }); };
    const field = which === 'e' ? 'publicKey' : 'signPublicKey';
    if (user.id === S.me.id) { if (proven) add(proven[which], 'now'); return out; }
    const changed = keyChanged(user);
    const p = E2EE.pinnedKeys(S.me.id, user, at);
    // A key the server lists counts as theirs only next to the identity key this device pinned for them (pinned on
    // first sight, so that's everyone with keys): never from a record that leaves the identity key out, whatever
    // the pin check made of it.
    if (!changed && p.e && user.publicKey === p.e) add(user[field], 'now');
    if (p[which]) {
      if (!changed) add(p[which], 'now');
      else {
        // Pinned here, but the server now lists other keys for them: theirs for what was written before this device
        // first saw that (its own clock), or before the server says it happened if that's earlier.
        const gone = E2EE.pinnedUntil(S.me.id, user, { local: at > 0 });
        if (!gone || (at > 0 && at <= gone)) add(p[which], 'pinned');
      }
    }
    // (A key this device already took as replaced is never "new" again, as a record from before the change still lists it.)
    if (changed && !E2EE.retiredPins(S.me.id, user).some((k) => k[which] === user[field])) add(user[field], 'new');
    p.old.forEach((k) => add(k[which], 'pinned'));
    E2EE.listedPastKeys(user, at).forEach((k) => add(k[which], 'listed'));
    return out;
  }
  // The signing keys that vouch for what someone signed: their current key (unless it changed and you haven't
  // verified it yet), and for the past (older server keys, messages; past: true) the keys this device trusted for
  // them before, e.g. before they reset their password without a recovery key, for what was written while they
  // had them (`at`: when it was written). Keys the server merely lists for them never vouch for anything.
  function signKeysFor(user, { past = true, at = 0 } = {}) {
    return keysOf(user, 's', at).filter((k) => k.trust === 'now' || (past && k.trust === 'pinned')).map((k) => k.key);
  }

  // ---------------------------------------------------------------- your own keys
  // Your public keys come from the server. Before anything is trusted or locked with them, this device checks
  // they really belong to the private keys it unlocked: your identity key (an ECDH round trip) and your signing
  // key (sign and verify a fresh text). A server that hands out keys of its own as yours could otherwise plant a
  // "current" server key that looks like your own copy, or read whatever you lock for yourself. Checked again
  // whenever the server lists different keys for you; until then, the ones proven last are the ones used.
  // Only proven keys are ever used as yours: for the copies of server keys you keep for yourself, your safety numbers
  // and fingerprint, and your personal vault (ownKeys). A start-up's record of you is proven before the app takes any
  // of it (proveOwnKeys), so S.me never holds keys of the server's.
  let ownCheck = null; // { e, s, signKey, ok }: the check for the keys S.me lists now
  let proven = null; // { e, s }: your public keys as last proven
  // Whether this signing key makes signatures that public signing key checks: a fresh text, signed and verified.
  async function signsFor(s, signKey, id) {
    const text = `hearth-own-key|${id}|${E2EE.b64(crypto.getRandomValues(new Uint8Array(16)))}`;
    return E2EE.verify(s, text, await E2EE.sign(signKey, text));
  }
  function ownKeysOk() {
    const e = S.me && S.me.publicKey;
    const s = S.me && S.me.signPublicKey;
    if (!ownCheck || ownCheck.e !== e || ownCheck.s !== s || ownCheck.signKey !== S.signKey) {
      const signKey = S.signKey;
      const ok = (async () => {
        if (!signKey || !e || !s) return false;
        if (!(await E2EE.ownsPublicKey(S.privateKey, e))) return false;
        return signsFor(s, signKey, S.me.id);
      })().catch(() => false).then((r) => { if (r) proven = { e, s }; return r; });
      ownCheck = { e, s, signKey, ok };
    }
    return ownCheck.ok;
  }
  // Your public keys as this device last proved them ({ publicKey, signPublicKey }), or null before that: never what a
  // record of you merely says.
  const ownKeys = () => (proven ? { publicKey: proven.e, signPublicKey: proven.s } : null);
  function ownKeysMismatch() {
    const err = new Error('The keys this server lists for your account aren’t the ones your password unlocks, so nothing was decrypted or sent. Reload the page; if it keeps happening, tell the server’s owner.');
    err.code = 'own_key_mismatch';
    return err;
  }
  function otherAccount(text = 'The server answered as a different account than the one signed in on this device') {
    const err = new Error(`${text}, so nothing was decrypted or sent. Sign out and in again; if it keeps happening, tell the server’s owner.`);
    err.code = 'own_key_mismatch';
    return err;
  }

  // Which account each identity key this device proved is: { [public key]: account id }, kept through sign-outs.
  // Every pin and DM record on this device is kept under an account id, and signing in takes whichever id the server
  // answers with. So a server that signed this device out and in again under a new id for the same keys would start
  // all of them from nothing: everyone pinned again on first sight with whatever keys it serves, verified contacts
  // too, and no "security key changed" warning for anyone. Your identity key is what the server can't fake (only your
  // password unlocks its private half), so a start-up whose key this device already proved for another id is refused.
  // (Keying the stores by that key instead would lose every pin at a password reset without the recovery key, which
  // gives you a new key under the same id while the keys you pinned for others stay right; this way that reset just
  // adds its key here.)
  const ACCOUNTS = 'hearth.accounts';
  function provenAccounts() {
    try {
      const all = JSON.parse(localStorage.getItem(ACCOUNTS) || '{}');
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch { return {}; }
  }
  function rememberAccount(e, id) {
    const all = provenAccounts();
    if (all[e] === id) return;
    delete all[e];
    all[e] = id;
    const keys = Object.keys(all);
    keys.slice(0, Math.max(0, keys.length - 50)).forEach((k) => delete all[k]); // the 50 most recent keys
    try { localStorage.setItem(ACCOUNTS, JSON.stringify(all)); } catch { /* storage off: nothing is kept here at all then (pins can't be saved either) */ }
  }

  // A start-up's record of you (bootstrap's `me`) proven before any of it is used: it's for the account this tab
  // started as (`account`), its identity key is the public half of the private key your password unlocked and not
  // one this device proved for another account, and its signing key is the one that key unlocks (made here, and
  // uploaded with proof, when the account has none yet). Returns that record with exactly those keys, for the app to
  // take as S.me. Nothing in S is touched until all of it checks out, so a start-up that's refused leaves no key of
  // the server's anywhere: the app keeps what it proved before (or, on its first start, doesn't start).
  async function proveOwnKeys(me, encSignPrivateKey, { account = null } = {}) {
    if (!me || typeof me.id !== 'string' || !me.id || (account && me.id !== account)) throw otherAccount();
    const e = me.publicKey;
    // (Only in the one spelling a key has: hearth.accounts is looked up by it, see e2ee.js canonicalKey.)
    if (!E2EE.canonicalKey(e) || !(await E2EE.ownsPublicKey(S.privateKey, e))) throw ownKeysMismatch();
    const knownAs = provenAccounts()[e];
    if (knownAs && knownAs !== me.id) throw otherAccount('The server named your account by another id than the one this device knows your keys by');
    let s;
    let signKey;
    if (me.signPublicKey && encSignPrivateKey) {
      // Locked with your identity key (proven yours just now): the signing key one of your own devices made.
      if (!E2EE.canonicalKey(me.signPublicKey)) throw ownKeysMismatch();
      s = me.signPublicKey;
      signKey = await E2EE.unwrapSigningKey(S.privateKey, e, encSignPrivateKey).catch(() => null);
    } else {
      const k = await E2EE.createSigningKey(S.privateKey, e);
      // The server wants proof that this device holds both your identity key and the new signing key.
      const ch = await api('POST', '/me/sign-key/challenge');
      const keyProof = await E2EE.signKeyProof(S.privateKey, ch.serverPublicKey, ch.nonce, me.id, k.signPublicKey);
      const signature = await E2EE.sign(k.signKey, `hearth-sign-key|${me.id}|${e}|${ch.nonce}`);
      try {
        await api('POST', '/me/sign-key', { signPublicKey: k.signPublicKey, encSignPrivateKey: k.encSignPrivateKey, nonce: ch.nonce, keyProof, signature });
      } catch (err) {
        if (err.status === 409) throw new Error('Your signing key changed on another device. Reload the page.');
        throw err;
      }
      // Nothing of the server's answer is taken: your keys are the ones made and checked here.
      s = k.signPublicKey;
      signKey = k.signKey;
    }
    if (!signKey || !s || !(await signsFor(s, signKey, me.id).catch(() => false))) throw ownKeysMismatch();
    S.signKey = signKey;
    proven = { e, s };
    ownCheck = { e, s, signKey, ok: Promise.resolve(true) };
    rememberAccount(e, me.id);
    return { ...me, publicKey: e, signPublicKey: s };
  }

  // ---------------------------------------------------------------- your post-quantum key
  // The account's ML-KEM-768 key (e2ee.js pqKeyPair). Its seed is inside the password envelope and comes from nowhere
  // else: at sign-up, at a sign-in with the password, or when this device asks for the password once (unlock: a device
  // that was signed in before the account had the key, or before another device of yours replaced it). It's never handed
  // from one device to another: that could only be authenticated with P-256 keys, which a quantum computer could
  // recompute, and the seed would then protect nothing. Accounts from before get theirs at their next sign-in with the
  // password. Its public half is published signed by your signing key.
  const myPq = () => (S.pqSeed instanceof Uint8Array ? E2EE.pqKeyPair(S.pqSeed) : null);
  // Whether the post-quantum key the server lists for you is signed by your own (proven) signing key: one of your
  // devices published it.
  let ownPq = null; // { pq, sig, s, ok }
  async function listedPqIsMine() {
    const pq = S.me && S.me.pqPublicKey;
    if (!pq || !(await ownKeysOk()) || !proven) return false;
    if (!ownPq || ownPq.pq !== pq || ownPq.sig !== S.me.pqSig || ownPq.s !== proven.s) {
      ownPq = { pq, sig: S.me.pqSig, s: proven.s, ok: E2EE.verifyPqKey(proven.s, S.me.id, proven.e, pq, S.me.pqSig).then(Boolean, () => false) };
    }
    return ownPq.ok;
  }
  // Signs on this device that the account has a post-quantum key, whatever the server lists in your own record right
  // now: the seed here, your own pin (seen published before), a fingerprint in your user record, or a copy of a server key
  // or a DM epoch made for your post-quantum key. A server that leaves your key out of one record doesn't make this
  // device take the account for P-256 only.
  let pqEvidence = false;
  const notePqEvidence = () => { pqEvidence = true; if (pqNeed === 'upgrade') needPassword('seed'); };
  const accountHasPq = () => pqEvidence || !!myPq() || E2EE.ownPqPinned(S.me.id) || !!S.me.pqPublicKey
    || !!(S.users[S.me.id] && typeof S.users[S.me.id].pq === 'string' && S.users[S.me.id].pq)
    || E2EE.anyDmPq(S.me.id); // (a DM of yours went post-quantum: both of you had a key)
  function needPasswordError() {
    const err = new Error('Your account’s post-quantum key isn’t on this device yet, so nothing was sent. Enter your password once on this device (the bar above the message box).');
    err.code = 'need_password';
    return err;
  }
  // The post-quantum key this device writes with for you (your own copies of server keys and DM epochs, and DM epochs
  // with others): your published key, signed by you, when this device holds its seed.
  //   null     the account has no post-quantum key (nothing on this device says it has one): P-256, as before
  //   throws   your own keys don't check out (own_key_mismatch); or the account has one that this device can't use yet
  //            (need_password): then it writes nothing that involves it until the password is entered (read-only)
  async function myPqForWriting() {
    if (!(await ownKeysOk())) throw ownKeysMismatch();
    const listed = (await listedPqIsMine()) ? S.me.pqPublicKey : null;
    const mine = myPq();
    if (listed && mine && mine.publicKey === listed) {
      E2EE.pinOwnPq(S.me.id, await E2EE.pqFingerprint(listed));
      return listed;
    }
    // (Another tab of this browser may have just got it.)
    if (listed && !mine) {
      const stored = await E2EE.loadPqSeed(S.me.id);
      if (stored && E2EE.pqKeyPair(stored).publicKey === listed) { adoptPq(stored, listed); return listed; }
    }
    if (!accountHasPq()) return null;
    throw needPasswordError();
  }
  // Whether this device may write copies for you at all (either the account is P-256 only, or it holds the seed).
  const canWriteForMyself = () => myPqForWriting().then(() => true, () => false);
  let pqNeed = null; // why this device needs the password once ('seed' | 'publish' | 'upgrade'), or null
  let pqError = null; // why the last attempt with the password didn't finish
  const neededPassword = () => pqNeed;
  const lastPqError = () => pqError;
  function needPassword(why) {
    if (pqNeed === why) return;
    pqNeed = why;
    onNeedPassword(why);
  }
  let adopted = null; // the public key of the seed last taken up here (holdSeed doesn't count)
  function adoptPq(seed, pub, { fresh = false } = {}) {
    const mine = E2EE.pqKeyPair(seed).publicKey;
    const changed = adopted !== mine;
    adopted = mine;
    S.pqSeed = seed;
    // (Stored, then the browser's other tabs are told, so they take it from there: app.js.)
    E2EE.storePqSeed(S.me.id, seed).then(() => { try { localStorage.setItem(`hearth.pqseed.${S.me.id}`, String(Date.now())); } catch { /* storage blocked */ } }, () => {});
    if (pub) E2EE.pqFingerprint(pub).then((fp) => E2EE.pinOwnPq(S.me.id, fp));
    if (pqNeed) { pqNeed = null; onNeedPassword(null); }
    pqError = null;
    if (fresh) onPqUpgraded();
    if (!changed) return;
    // What waited for the seed: server keys locked to it (looked at again), and DMs.
    for (const sid of [...waitingPq]) { waitingPq.delete(sid); refresh(sid); }
    onDmKeys(null);
  }
  // A seed from the envelope that isn't published yet: kept, so this device is read-only rather than P-256-only meanwhile.
  function holdSeed(seed) {
    S.pqSeed = seed;
    E2EE.storePqSeed(S.me.id, seed).catch(() => {});
  }
  function dropSeed() {
    if (!S.pqSeed) return;
    S.pqSeed = null;
    adopted = null;
    E2EE.storePqSeed(S.me.id, null).catch(() => {});
  }
  // (Only what was published, and whether the recovery key is out of date now, are taken from the answer.)
  const publishPq = async (body) => {
    const me = await api('POST', '/me/pq-key', body);
    const fp = await E2EE.pqFingerprint(body.pqPublicKey);
    S.me = { ...S.me, pqPublicKey: body.pqPublicKey, pqSig: body.pqSig, ...(me && typeof me.recoveryStale === 'boolean' ? { recoveryStale: me.recoveryStale } : {}) };
    S.users[S.me.id] = { ...S.users[S.me.id], pq: fp };
  };
  // Run after the signing key is ready: at start-up, whenever the server lists a new post-quantum key for you, and with
  // ctx when the password was just entered: { authKey, wrapKey, encPrivateKey, pqSeed (the envelope's, or null) }, from
  // a sign-in, a password change or this device's unlock.
  let pqBusy = null;
  function ensurePqKey(ctx = null) {
    const run = async () => {
      if (!S.signKey || !S.me || !(await ownKeysOk())) return;
      // A listed key you didn't sign is ignored (a server's own, or garbage): it never replaces the seed held here.
      const pub = (await listedPqIsMine()) ? S.me.pqPublicKey : null;
      if (S.me.pqPublicKey && !pub) console.warn('The server lists a post-quantum key for you that you didn’t sign: ignored');
      const fits = (x) => x instanceof Uint8Array && !!pub && E2EE.pqKeyPair(x).publicKey === pub;
      if (ctx) {
        const envSeed = ctx.pqSeed instanceof Uint8Array ? ctx.pqSeed : null;
        const sign = (pq) => E2EE.signPqKey(S.signKey, S.me.id, proven.e, pq); // (ownKeysOk above: proven is set)
        const fromEnvelope = await E2EE.envelopeHash(ctx.encPrivateKey);
        if (pub) {
          if (fits(envSeed)) return adoptPq(envSeed, pub);
          // The envelope lost the seed this device has (an old app re-locked an older envelope): put it back.
          if (fits(S.pqSeed)) {
            const { encPrivateKey } = await E2EE.addPqToEnvelope(ctx.wrapKey, ctx.encPrivateKey, { seed: S.pqSeed, replace: true });
            await publishPq({ pqPublicKey: pub, pqSig: await sign(pub), encPrivateKey, fromEnvelope, authKey: ctx.authKey });
            return adoptPq(S.pqSeed, pub);
          }
          // Neither the envelope nor this device has the published key's seed, so nobody can open what's locked to it:
          // replaced below with a new one, in the envelope.
        } else {
          // Nothing listed: the envelope's seed (a new account, new keys after a reset, an interrupted first start), else
          // the one this device holds (a server restored from before it was published: put back into the envelope, so
          // every device keeps the key it has). Held here before it's published: if that's refused, this device
          // stays read-only, never P-256 alone.
          const seed = envSeed || (S.pqSeed instanceof Uint8Array ? S.pqSeed : null);
          if (seed) {
            holdSeed(seed);
            const pq = E2EE.pqKeyPair(seed).publicKey;
            const env = envSeed ? {} : { encPrivateKey: (await E2EE.addPqToEnvelope(ctx.wrapKey, ctx.encPrivateKey, { seed, replace: true })).encPrivateKey, fromEnvelope };
            await publishPq({ pqPublicKey: pq, pqSig: await sign(pq), ...env, authKey: ctx.authKey });
            return adoptPq(seed, pq);
          }
        }
        // The one-time upgrade: a new seed, locked inside the envelope, and its public key published with it.
        const up = await E2EE.addPqToEnvelope(ctx.wrapKey, ctx.encPrivateKey, { replace: true });
        const pq = E2EE.pqKeyPair(up.pqSeed).publicKey;
        await publishPq({ pqPublicKey: pq, pqSig: await sign(pq), encPrivateKey: up.encPrivateKey, fromEnvelope, authKey: ctx.authKey, ...(S.me.pqPublicKey ? { replace: true } : {}) });
        return adoptPq(up.pqSeed, pq, { fresh: true });
      }
      // No password here.
      if (pub && fits(S.pqSeed)) return adoptPq(S.pqSeed, pub);
      if (pub) {
        // (Remembered: from now on this device knows the account has one, whatever the server lists later.)
        E2EE.pinOwnPq(S.me.id, await E2EE.pqFingerprint(pub));
        // Another tab of this browser may have just unlocked it.
        const stored = await E2EE.loadPqSeed(S.me.id);
        if (fits(stored)) return adoptPq(stored, pub);
        // This device doesn't have the published key's seed (it was signed in before the key existed, or another device
        // replaced it): the password unlocks it from the envelope.
        dropSeed();
        return needPassword('seed');
      }
      // A seed from the envelope that was never published (the first start after sign-up or a reset was interrupted):
      // the password publishes it.
      if (myPq()) return needPassword('publish');
      // Signs that the account has one which the server doesn't list for you now: the password sorts it out.
      if (accountHasPq()) return needPassword('seed');
      // No post-quantum key at all (an account from before, on a device that was signed in before; or a reset whose first
      // start was interrupted, in a new browser): the password makes one.
      return needPassword('upgrade');
    };
    pqBusy = (pqBusy || Promise.resolve()).then(run, run).catch(async (e) => {
      // Another device published one meanwhile: take it as listed now (if you signed it), and its seed from the envelope
      // that device just saved, with the password this one has right now.
      if (e.code === 'pq_exists') {
        try {
          const k = await api('GET', `/users/${S.me.id}/pq-key`);
          if (!proven || !(await E2EE.verifyPqKey(proven.s, S.me.id, proven.e, k.pqPublicKey, k.pqSig))) return;
          S.me = { ...S.me, pqPublicKey: k.pqPublicKey, pqSig: k.pqSig };
          if (ctx && ctx.authKey) {
            const r = await api('POST', '/me/keys/wrapped', { authKey: ctx.authKey }).catch(() => null);
            const got = r && await E2EE.unwrapIdentity(ctx.wrapKey, r.encPrivateKey).catch(() => null);
            if (got && got.pqSeed && E2EE.pqKeyPair(got.pqSeed).publicKey === k.pqPublicKey) return adoptPq(got.pqSeed, k.pqPublicKey);
          }
          needPassword('seed');
        } catch { /* next start */ }
        return;
      }
      console.warn('Post-quantum key', e.message);
      // With the password, but it didn't go through (the network, a limit): the bar stays, and says why when asked.
      if (ctx) { pqError = e; needPassword(S.me.pqPublicKey ? 'seed' : myPq() ? 'publish' : 'upgrade'); }
    });
    return pqBusy;
  }

  // The server says your post-quantum key changed (another device published one): fetched and checked here, as no
  // socket record ever sets your own keys (app.js setUser), then taken up as at start-up.
  async function ownPqChanged() {
    try {
      const k = await api('GET', `/users/${S.me.id}/pq-key`);
      if (!(await ownKeysOk()) || !proven) return;
      const ok = !!(k && k.pqPublicKey) && await E2EE.verifyPqKey(proven.s, S.me.id, proven.e, k.pqPublicKey, k.pqSig).catch(() => false);
      S.me = { ...S.me, pqPublicKey: ok ? k.pqPublicKey : null, pqSig: ok ? k.pqSig : null };
    } catch { return; }
    await ensurePqKey();
  }

  // ---------------------------------------------------------------- other people's post-quantum keys
  // Someone's post-quantum public key, checked: signed with their signing key (the one this device trusts for them now)
  // over their id and identity key, and the one whose fingerprint the server lists for them. null when they have none
  // yet. Throws (code 'untrusted') when the server lists one that doesn't check out, or lists none for someone this
  // device has seen one for (a downgrade to P-256 alone): nothing is then encrypted to them.
  const pqFetched = new Map(); // `${id}|${fp}` -> Promise<{ publicKey, pqPublicKey, pqSig }>
  const pqChecked = new Map(); // `${id}|${fp}|${publicKey}` -> Promise<pq public key | null>
  function pqRefused(user, missing) {
    const err = new Error(missing
      ? `${user.username}’s post-quantum key isn’t listed right now, so nothing was encrypted to them. If they just reset their password, their app adds it as soon as it starts; if it keeps happening, the server may be hiding it: tell its owner.`
      : `${user.username}’s post-quantum key didn’t check out, so nothing was encrypted to them. Reload the page; if it keeps happening, tell the server’s owner.`);
    err.code = 'untrusted';
    return err;
  }
  async function prefetchPq(users) {
    const todo = users.filter((u) => u && u.id !== S.me.id && typeof u.pq === 'string' && u.pq && !pqFetched.has(`${u.id}|${u.pq}`));
    for (let i = 0; i < todo.length; i += 500) {
      const part = todo.slice(i, i + 500);
      const all = api('POST', '/users/pq-keys', { ids: part.map((u) => u.id) }).then((r) => (r && r.keys) || {});
      part.forEach((u) => {
        const k = `${u.id}|${u.pq}`;
        pqFetched.set(k, all.then((keys) => keys[u.id] || null));
        pqFetched.get(k).catch(() => pqFetched.delete(k));
      });
    }
  }
  async function pqKeyOf(user) {
    if (!user) return null;
    if (user.id === S.me.id) return myPqForWriting();
    const fp = typeof user.pq === 'string' && user.pq ? user.pq : null;
    if (!fp) {
      if (E2EE.pinnedPq(S.me.id, user)) throw pqRefused(user, true);
      return null;
    }
    const k = `${user.id}|${fp}`;
    if (!pqFetched.has(k)) {
      pqFetched.set(k, api('GET', `/users/${user.id}/pq-key`));
      pqFetched.get(k).catch(() => pqFetched.delete(k));
    }
    const ck = `${k}|${user.publicKey}`;
    if (!pqChecked.has(ck)) {
      pqChecked.set(ck, (async () => {
        const r = await pqFetched.get(k);
        const signs = signKeysFor(user, { past: false });
        if (!r || r.publicKey !== user.publicKey || !signs.length || (await E2EE.pqFingerprint(r.pqPublicKey)) !== fp) return null;
        return (await E2EE.verifyPqKey(signs, user.id, user.publicKey, r.pqPublicKey, r.pqSig)) ? r.pqPublicKey : null;
      })());
      pqChecked.get(ck).catch(() => pqChecked.delete(ck));
    }
    const pq = await pqChecked.get(ck);
    if (!pq) { pqChecked.delete(ck); pqFetched.delete(k); throw pqRefused(user, false); }
    E2EE.pinPq(S.me.id, user, fp);
    return pq;
  }

  // A record the server hands over for one account but labelled as another: never used (see mergeUser).
  function wrongAccount() {
    const err = new Error('The server answered with a different account than the one asked for, so nothing was encrypted to it. Reload the page; if it keeps happening, tell the server’s owner.');
    err.code = 'untrusted';
    return err;
  }
  const sameAccount = (id, x) => { if (!x || x.id !== id) throw wrongAccount(); return x; };

  // ---------------------------------------------------------------- group keys
  function keysFor(serverId) {
    if (!groupKeys.has(serverId)) groupKeys.set(serverId, new Map());
    return groupKeys.get(serverId);
  }
  // The server says the current key is older than one this app already holds for that server. Only a server
  // that's been rolled back (or is up to something) does that, e.g. to bring back a key a removed member has.
  function rolledBack(serverId) {
    const st = states.get(serverId);
    const held = [...keysFor(serverId).keys()];
    return !!st && !!st.keyEpoch && held.length > 0 && st.keyEpoch < Math.max(...held);
  }
  function currentKey(serverId) {
    const st = states.get(serverId);
    if (!st || st.needsRotation || !st.keyEpoch || rolledBack(serverId) || unverified.has(`${serverId}|${st.keyEpoch}`)) return null;
    const raw = keysFor(serverId).get(st.keyEpoch);
    return raw ? { epoch: st.keyEpoch, raw } : null;
  }
  const stateOf = (serverId) => states.get(serverId) || null;

  async function applyState(st) {
    if (!st) return;
    const heldList = (x) => (Array.isArray(x && x.held) ? [...x.held].sort().join() : '');
    const heldChanged = heldList(states.get(st.serverId)) !== heldList(st); // the member list's shields
    states.set(st.serverId, st);
    const mine = keysFor(st.serverId);
    const server = S.servers.find((s) => s.id === st.serverId);
    let added = false;
    const fresh = []; // keys someone else handed us (re-wrapped to ourselves below)
    // Copies for ourselves only from a device that can write them (canWriteForMyself). While
    // the account's recovery key is older than its post-quantum key (it doesn't hold the seed), a copy that opens with
    // the identity key alone (w1) is never replaced by one that needs the seed: a reset with that recovery key would
    // otherwise lose it, history from before the upgrade included.
    const canKeep = await canWriteForMyself();
    const lockPq = canKeep ? await myPqForWriting().catch(() => null) : null;
    const staleRecovery = !!(S.me.hasRecovery && S.me.recoveryStale);
    for (const k of st.keys || []) {
      const current = k.epoch === st.keyEpoch;
      const tag = `${st.serverId}|${k.epoch}`;
      // Held already. A key held only for reading history (see `unverified`) is looked at again if the server
      // now says it's the one to write with.
      if (mine.has(k.epoch) && !(current && unverified.has(tag))) continue;
      try {
        // A key "newer" than the current one: nobody made it through the server's rotation (only the server
        // itself could have put it there).
        if (k.epoch > st.keyEpoch) throw new Error('untrusted sharer');
        // The key everyone encrypts with now must come from a member. One handed out by someone who isn't in
        // the server (only the server itself could arrange that) is never used.
        const self = k.wrapperId === S.me.id;
        if (current && !st.needsRotation && server && !self && !server.memberIds.includes(k.wrapperId)) throw new Error('untrusted sharer');
        // Our own copy: only if the keys the server lists as ours really are ours (see ownKeysOk).
        if (self && !(await ownKeysOk())) throw new Error('untrusted sharer');
        const wrapper = self ? S.me : await userWithKeys(k.wrapperId);
        if (!self) trust(wrapper); // warns (once) if their key changed
        // The key to encrypt with from now on: only from someone's current, trusted key. Older server keys (for
        // reading history) may also come from keys this device trusted for them before, or, failing that, from a
        // key the server lists as theirs before a reset. Such a key is only ever read with: every message in it
        // is still checked against its own author's keys, and it's never kept as our own copy nor written with.
        const at = Number(k.createdAt) || 0;
        const keys = keysOf(wrapper, 's', at);
        const trusted = keys.filter((x) => x.trust === 'now' || (!current && x.trust === 'pinned')).map((x) => x.key);
        const listed = current ? [] : keys.filter((x) => x.trust === 'listed').map((x) => x.key);
        if (!trusted.length && !listed.length) throw new Error('untrusted sharer');
        const unwrap = (pubs) => E2EE.unwrapGroupKey({
          wrapped: k.wrapped, serverId: st.serverId, epoch: k.epoch, myId: S.me.id, myPriv: S.privateKey, myPub: proven ? proven.e : S.me.publicKey, myPq: myPq(),
          wrapperId: k.wrapperId, wrapperSignPub: pubs,
        });
        let raw;
        let onlyListed = false;
        try {
          if (!trusted.length) throw new Error('Key signature did not verify');
          raw = await unwrap(trusted);
        } catch (e) {
          if (!/did not verify/.test(e.message)) throw e;
          if (listed.length) { raw = await unwrap(listed); onlyListed = true; }
          // Signed by a new key of theirs you haven't verified (and none you trusted before): wait for that.
          else if (keyChanged(wrapper)) throw new Error('untrusted sharer');
          else throw e;
        }
        if ((await E2EE.keyCheck(raw, st.serverId, k.epoch)) !== k.check) throw new Error('key check mismatch');
        mine.set(k.epoch, raw);
        if (onlyListed) unverified.add(tag); else unverified.delete(tag);
        added = true;
        generation.set(st.serverId, (generation.get(st.serverId) || 0) + 1);
        const w1 = E2EE.wrapFormat(k.wrapped) === 'w1';
        if (!w1) notePqEvidence(); // (a hybrid copy for you: the account has a post-quantum key)
        if (!self && !onlyListed && canKeep && !(staleRecovery && w1 && lockPq)) fresh.push({ epoch: k.epoch, raw, w1 });
        // Our own copy from before post-quantum keys: stored again with the hybrid, so what the server keeps from now on
        // is safe from a quantum computer too (a copy taken before can't be helped).
        else if (self && lockPq && w1 && !staleRecovery) fresh.push({ epoch: k.epoch, raw, w1 });
      } catch (e) {
        // Locked to the post-quantum key this device is still waiting for: looked at again once it's here.
        if (e.code === 'no_pq') { waitingPq.add(st.serverId); notePqEvidence(); continue; }
        console.warn('Could not unlock a server key', st.serverId, k.epoch, e.message);
        // Locked for keys this account no longer has (or damaged): ask for it to be shared again. Once per
        // key per session, and only the current key (nobody can share an older one again, so the server keeps
        // those). Not for "untrusted sharer": that one waits for you to verify them.
        if (current && e.message !== 'untrusted sharer' && !reported.has(tag)) { reported.add(tag); api('POST', `/servers/${st.serverId}/keys/bad`, { epoch: k.epoch }).catch(() => {}); }
      }
    }
    if (fresh.length) keepForMyself(st.serverId, fresh);
    (waiters.get(st.serverId) || []).forEach((r) => r());
    waiters.delete(st.serverId);
    onKeysChanged(st.serverId, added, heldChanged);
    maintain(st.serverId);
  }

  // Keys someone else handed us are wrapped again to ourselves (signed by us) and stored back in place of the
  // copy we got, once per key. Our history then no longer depends on the sharer keeping their keys: deleting
  // their account or resetting their password can't lock us out of what was said back then.
  const keeping = new Map(); // serverId -> promise of the last upload (so tests and callers can wait for it)
  function keepForMyself(serverId, list) {
    const todo = list.filter((k) => !rewrapped.has(`${serverId}|${k.epoch}`));
    if (!todo.length || !S.signKey || !S.me || !S.me.publicKey) return keeping.get(serverId);
    todo.forEach((k) => rewrapped.add(`${serverId}|${k.epoch}`));
    const job = (async () => {
      // Our public key as the server tells it must really be ours before we wrap every key we hold to it. Every copy
      // then goes to that proven key, read once (as the signing key), never to whatever S.me lists by the time a
      // later one is made; and a batch isn't sent at all if the key listed for us has changed by then.
      if (!(await ownKeysOk())) throw new Error('our public keys don’t match our private keys');
      const pub = proven.e;
      const signKey = S.signKey;
      const myId = S.me.id;
      const recipientPq = await myPqForWriting(); // (throws on a device that can't write for you yet)
      // Decided again now, with the key it's wrapped with: a copy that opens with the identity key alone isn't replaced
      // by a hybrid one while the recovery key is older than the post-quantum key (the upgrade may have just landed).
      const keep = todo.filter((k) => !(k.w1 && recipientPq && S.me.hasRecovery && S.me.recoveryStale));
      for (let i = 0; i < keep.length; i += 100) {
        const wraps = {};
        for (const k of keep.slice(i, i + 100)) {
          wraps[k.epoch] = await E2EE.wrapGroupKey({ raw: k.raw, serverId, epoch: k.epoch, recipientId: myId, recipientPub: pub, recipientPq, wrapperId: myId, signKey });
        }
        if (!S.me || S.me.publicKey !== pub) throw ownKeysMismatch();
        await api('POST', `/servers/${serverId}/keys/self`, { wraps });
      }
    })().catch((e) => {
      todo.forEach((k) => rewrapped.delete(`${serverId}|${k.epoch}`)); // tried again on the next start-up
      console.warn('Could not keep a copy of server keys', e.message);
    });
    keeping.set(serverId, job);
    return job;
  }

  function waitForState(serverId, ms) {
    return new Promise((resolve) => {
      const list = waiters.get(serverId) || [];
      list.push(resolve);
      waiters.set(serverId, list);
      setTimeout(resolve, ms);
    });
  }

  // Keep a server's keys healthy: rotate if needed, hand the current key to anyone missing it.
  function maintain(serverId) {
    const st = states.get(serverId);
    if (!st || busy.has(serverId)) return;
    const server = S.servers.find((s) => s.id === serverId);
    if (!server) return;
    const needsRotate = (st.needsRotation || !st.keyEpoch) && !held(serverId) && mayMakeKey(server);
    const shareWith = (st.missing || []).filter((id) => id !== S.me.id && !heldBack(serverId, id));
    // Held back here yourself: the server takes no key from you to pass on (it might be one you made alone).
    const needsShare = !needsRotate && !isHeld(serverId, S.me.id) && shareWith.length > 0 && currentKey(serverId);
    // Older keys owed to members who were left out of them (their post-quantum key wasn't listed then), that we hold.
    // Only to those this device's own rotation left out (its local record, never just the server's word: a server
    // could otherwise list a member of its own as owed every old key), and only keys it holds as its own.
    const owed = isHeld(serverId, S.me.id) ? [] : Object.entries(st.owed || {})
      .map(([e, ids]) => ({ epoch: Number(e), raw: keysFor(serverId).get(Number(e)), ids: (Array.isArray(ids) ? ids : []).filter((id) => id !== S.me.id && !heldBack(serverId, id) && E2EE.deferredHere(S.me.id, serverId, Number(e), id)) }))
      .filter((o) => o.raw && o.ids.length && !unverified.has(`${serverId}|${o.epoch}`));
    if (!needsRotate && !needsShare && !owed.length) return;
    busy.add(serverId);
    // Runs right away (no timers: background tabs throttle them). If several members do this at once,
    // the server keeps the first rotation and ignores duplicate shares.
    (async () => {
      try {
        if (needsRotate) await rotate(serverId);
        else if (needsShare) await share(serverId, shareWith);
        for (const o of owed) await share(serverId, o.ids, { epoch: o.epoch, raw: o.raw });
      } catch (e) {
        if (!['epoch', 'members', 'keys_unverified', ...LIMITED].includes(e.code)) console.warn('Key maintenance failed', e.message);
      } finally { busy.delete(serverId); }
    })();
  }
  // While you wait to be verified here yourself, you can only make the key of a server nobody else is in (the server
  // refuses otherwise: the others would be handed a key that your unverified keys chose).
  const mayMakeKey = (server) => !isHeld(server.id, S.me.id) || server.memberIds.every((id) => id === S.me.id);
  // The server said "not you, not now" to a new key from us (we came back after being away, or we reported the
  // last key broken, so someone else makes the next one): don't keep asking for a minute.
  const LIMITED = ['rotate_too_soon', 'rate_limited'];
  const holds = new Map(); // serverId -> time we may try to rotate again
  const held = (serverId) => (holds.get(serverId) || 0) > Date.now();

  // Each copy is the hybrid (w2) for anyone with a post-quantum key that checks out (pqKeyOf), else P-256 alone (w1).
  // Someone whose post-quantum key this device has seen but which doesn't check out now (left out, or not signed by
  // them) gets no copy at all, rather than a P-256 one: they're deferred (the server shares them the key later, once
  // it's back), so they don't hold the key up for everyone else.
  async function wrapFor(serverId, epoch, raw, userIds) {
    const wraps = {};
    const pubs = {}; // the public key each one is wrapped for, so the server can refuse stale ones
    const pqs = {}; // …and the post-quantum key's fingerprint (null: none), likewise (not for our own copy)
    const deferred = [];
    const users = [];
    for (const uid of userIds) users.push(uid === S.me.id ? S.me : await userWithKeys(uid));
    await prefetchPq(users);
    for (const u of users) {
      const uid = u && u.id;
      if (!u || !u.publicKey) throw new Error(`Missing encryption key for a member.`);
      if (!trust(u)) {
        const err = new Error(`${u.username}'s security key changed. Verify them before sharing keys.`);
        err.code = 'untrusted';
        throw err;
      }
      // Our own copy goes only to keys proven to be ours (see ownKeysOk), never to whatever the server lists for us just
      // now: a server that pushed its own public key as ours would otherwise get every new server key. And with our
      // post-quantum key whenever the account has one (myPqForWriting throws rather than fall back: a device that can't
      // use it yet makes no keys for anyone).
      const self = uid === S.me.id;
      if (self && !(await ownKeysOk())) throw ownKeysMismatch();
      const recipientPub = self ? proven.e : u.publicKey;
      let recipientPq;
      try { recipientPq = await pqKeyOf(u); } catch (e) {
        if (self || e.code !== 'untrusted') throw e;
        deferred.push(uid);
        continue;
      }
      wraps[uid] = await E2EE.wrapGroupKey({ raw, serverId, epoch, recipientId: uid, recipientPub, recipientPq, wrapperId: S.me.id, signKey: S.signKey });
      pubs[uid] = recipientPub;
      if (uid !== S.me.id) pqs[uid] = recipientPq ? u.pq : null;
    }
    // (As in keepForMyself: a batch with our own copy isn't sent once the server lists another key for us.)
    if (pubs[S.me.id] && S.me.publicKey !== pubs[S.me.id]) throw ownKeysMismatch();
    return { wraps, pubs, pqs, deferred };
  }
  // Someone's keys changed under us: fetch them fresh before trying again.
  async function refreshUsers(ids) {
    await Promise.all(ids.map((id) => api('GET', '/users/' + id).then((x) => { S.users[id] = mergeUser(S.users[id], sameAccount(id, x)); }).catch(() => {})));
  }

  async function rotate(serverId) {
    const server = S.servers.find((s) => s.id === serverId);
    const st = states.get(serverId);
    if (!server || !st) return;
    const epoch = st.keyEpoch + 1;
    const raw = E2EE.newGroupKey();
    // Everyone but whoever waits to be verified (the server wouldn't keep their copy).
    const { wraps, pubs, pqs, deferred } = await wrapFor(serverId, epoch, raw, server.memberIds.filter((id) => !heldBack(serverId, id)));
    const check = await E2EE.keyCheck(raw, serverId, epoch);
    const next = await api('POST', `/servers/${serverId}/keys/rotate`, { epoch, check, wraps, pubs, pqs, deferred }).catch(async (e) => {
      if (e.code === 'stale_keys') { await refreshUsers(server.memberIds.filter((id) => id !== S.me.id)); setTimeout(() => maintain(serverId), 500); }
      if (LIMITED.includes(e.code)) holds.set(serverId, Date.now() + 60000);
      throw e;
    });
    keysFor(serverId).set(epoch, raw);
    E2EE.noteDeferred(S.me.id, serverId, epoch, deferred);
    await applyState(next);
  }

  async function share(serverId, userIds, ck = currentKey(serverId)) {
    const server = S.servers.find((s) => s.id === serverId);
    if (!ck || !server || !userIds.length) return;
    const ids = userIds.filter((id) => server.memberIds.includes(id) && !heldBack(serverId, id));
    if (!ids.length) return;
    const { wraps, pubs, pqs } = await wrapFor(serverId, ck.epoch, ck.raw, ids);
    if (!Object.keys(wraps).length) return;
    const r = await api('POST', `/servers/${serverId}/keys/share`, { epoch: ck.epoch, wraps, pubs, pqs });
    if (r && r.stale && r.stale.length) { await refreshUsers(r.stale); setTimeout(() => maintain(serverId), 500); }
  }

  // Wait until we can send in this server (rotating ourselves if the key needs refreshing).
  async function ready(serverId) {
    const server = S.servers.find((s) => s.id === serverId);
    // Waiting to be verified: nobody shares the key with you, so there's nothing to wait for here.
    if (!currentKey(serverId) && server && !mayMakeKey(server)) {
      const err = new Error('Your password was reset without your recovery key, so someone here who knew you before has to verify you before you can read or send messages here. Ask one of them to compare safety numbers with you.');
      err.code = 'unverified';
      throw err;
    }
    for (let i = 0; i < 4; i++) {
      if (i && rolledBack(serverId)) break; // still older than a key we have, even after asking again
      const ck = currentKey(serverId);
      if (ck) return ck;
      const st = states.get(serverId);
      if (st && (st.needsRotation || !st.keyEpoch) && !busy.has(serverId) && !held(serverId) && (!server || mayMakeKey(server))) {
        busy.add(serverId);
        // Refused for us (see holds): another member's app makes the new key, so wait for it like for a share.
        try { await rotate(serverId); } catch (e) {
          if (!['epoch', 'members', ...LIMITED].includes(e.code)) throw e;
        } finally { busy.delete(serverId); }
        if (currentKey(serverId)) return currentKey(serverId);
      }
      await refresh(serverId);
      if (!currentKey(serverId) && !rolledBack(serverId)) await waitForState(serverId, 1500);
    }
    if (waitingPq.has(serverId)) {
      const err = new Error('This server’s key is locked to your account’s post-quantum key, which this device gets with your password: enter it once (the bar above the message box) to read and write here.');
      err.code = 'need_password';
      throw err;
    }
    if (rolledBack(serverId)) {
      const err = new Error('This server offered an older encryption key than the one you already use, so nothing was sent. Reload the page; if it keeps happening, tell the server\u2019s owner.');
      err.code = 'rollback';
      throw err;
    }
    // Joined a server that keeps what came before from new members: the key is the next one, made for you (since:
    // where your history starts, server/joinhistory.js), never the one in use when you joined.
    const st = states.get(serverId);
    const err = new Error(st && st.since && st.since.epoch > st.keyEpoch
      ? 'Your encryption key for this server is on its way: it gives new members a fresh key, which can take a few minutes.'
      : 'You don\u2019t have this server\u2019s encryption key yet. It arrives as soon as another member comes online.');
    err.code = 'no-key';
    throw err;
  }
  async function refresh(serverId) {
    try { await applyState(await api('GET', `/servers/${serverId}/keys`)); } catch { /* ignore */ }
  }
  async function forceRotate(serverId) {
    const st = states.get(serverId);
    if (st) states.set(serverId, { ...st });
    await rotate(serverId);
  }

  // ---------------------------------------------------------------- channel messages
  async function encryptChannel(serverId, channelId, payload) {
    const ck = await ready(serverId);
    const ciphertext = await E2EE.encryptGroup({ raw: ck.raw, serverId, channelId, epoch: ck.epoch, authorId: S.me.id, signKey: S.signKey, payload });
    return { ciphertext, epoch: ck.epoch };
  }

  async function openGroup(serverId, channelId, authorId, text, at = 0) {
    const epoch = E2EE.groupEpoch(text);
    const mine = keysFor(serverId);
    const raw = mine.get(epoch);
    if (!raw) {
      // Only the current key is ever handed out later (keys/share), so a missing key older than one we hold
      // never arrives: written before we joined, or while we were away (a rejoin always gets a new key).
      const held = [...mine.keys()];
      // (Locked to your post-quantum key, which this device gets with your password: says so instead.)
      if (waitingPq.has(serverId)) return { pending: true, pq: true, t: '', f: [] };
      return { pending: true, before: held.length > 0 && epoch < Math.max(...held), t: '', f: [] };
    }
    try {
      const author = await userWithKeys(authorId);
      if (authorId === S.me.id) await ownKeysOk();
      // Checked against every key we know for them (see keysOf); only 'now' and 'pinned' ones verify it. keyNote
      // says when it wasn't their current trusted key, so the message can say so.
      const keys = keysOf(author, 's', at);
      const { payload, signedBy } = await E2EE.decryptGroup({ raw, serverId, channelId, authorId, authorSignPub: keys.map((k) => k.key), text });
      const how = signedBy ? keys.find((k) => k.key === signedBy).trust : null;
      return {
        t: String(payload.t || ''), f: cleanFiles(payload.f), p: cleanPoll(payload.p), x: cleanX(payload.x), ...linksIn(payload), ...bindIn(payload), ...photoIn(payload),
        verified: how === 'now' || how === 'pinned', ...(how && how !== 'now' ? { keyNote: how } : {}),
      };
    } catch {
      return { error: true, t: '', f: [] };
    }
  }

  // A plaintext ("older") channel message. Nothing proves who wrote one, so it's never shown as verified.
  // Only this server's news bot still posts them; any other one dated after the server switched on end-to-end
  // encryption can't have come from a member's app at all (only the server could have written it), so it isn't
  // shown. S.e2eeSince is when that was, as this device first heard it (see app.js).
  function openLegacy(m) {
    const author = S.users[m.authorId];
    const bot = !!m.bot && (m.authorId === NEWS_BOT_ID || (!!author && !!author.bot));
    if (!bot && S.e2eeSince && Number(m.createdAt) > S.e2eeSince) return { forged: true, error: true, t: '', f: [] };
    return { t: m.content || '', f: cleanFiles(m.attachments), legacy: true, verified: false, embed: m.embed || null, bot, webhook: bot ? hookOf(m.webhook) : null };
  }
  // A channel webhook's post: the name and picture the program asked for (the picture is an https address the app
  // only loads through this server's avatar proxy, by the link the server signed for it: avatarSrc, sent only for
  // pictures on known avatar hosts), and whether it may ping.
  function hookOf(w) {
    if (!w || typeof w !== 'object') return null;
    return {
      id: String(w.id || ''), name: typeof w.name === 'string' && w.name ? w.name.slice(0, 64) : null,
      avatar: typeof w.avatar === 'string' && /^https:\/\//.test(w.avatar) ? w.avatar : null, pings: w.pings === true,
      avatarSrc: typeof w.avatarSrc === 'string' && /^\/media\/avatar\//.test(w.avatarSrc) ? w.avatarSrc : null,
    };
  }
  // A bot post from an account this device hasn't loaded (a channel webhook's, or a bot removed since): load it first,
  // so it's checked as a bot's instead of being hidden as a message only the server could have written.
  async function loadBotAuthor(x) {
    if (x && x.bot && x.authorId && !S.users[x.authorId]) { try { await userWithKeys(x.authorId); } catch { /* stays unknown */ } }
  }

  async function decryptChannelMessage(m) {
    if (m.dec && !m.dec.pending) return;
    if (m.legacy) await loadBotAuthor(m);
    if (m.reply && !m.reply.ciphertext && !m.reply.big) await loadBotAuthor(m.reply);
    if (m.legacy) m.dec = openLegacy(m);
    else {
      // If a key arrives while we're decrypting, try again so we never keep a stale "waiting" result.
      for (let i = 0; i < 3; i++) {
        const gen = generation.get(m.serverId) || 0;
        m.dec = await openGroup(m.serverId, m.channelId, m.authorId, m.ciphertext, Number(m.createdAt) || 0);
        if (!m.dec.pending || gen === (generation.get(m.serverId) || 0)) break;
      }
    }
    if (m.reply && (!m.reply.dec || m.reply.dec.pending)) {
      // big: the server left out a very long one (the owner's, with many files); the app quotes it from the original.
      m.reply.dec = m.reply.big ? BIG_QUOTE : m.reply.ciphertext ? await openGroup(m.serverId, m.channelId, m.reply.authorId, m.reply.ciphertext, Number(m.reply.createdAt) || 0) : openLegacy(m.reply);
    }
  }

  // ---------------------------------------------------------------- DMs
  // Who each DM is with, as this device first saw it: a server that later names someone else as the other person
  // (whose key the app would trust on first sight) gets nothing encrypted to them in that conversation, and no call.
  // A record never changes once made. Each one is kept in memory for the whole session as soon as it's made (so it
  // holds even while storage can't be written: full, or blocked), and stored for the account for next time. The store
  // is only read for a DM this session hasn't met yet, and parsed again only when its text changed (a start-up opens
  // the newest message of every DM: parsing the whole store for each one made a long list slow). A new record is
  // written into what's stored at that moment, so two tabs recording DMs at once keep each other's.
  const peersKey = () => `hearth.dmpeers.${S.me.id}`;
  let peers = { key: '', map: new Map() }; // this session's records (dmId -> userId) for the account peersKey() names
  let peerStore = { key: '', raw: null, all: {} }; // the stored records as last parsed, with the text they came from
  function storedPeers(key) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { /* storage off: this session's records are all there is */ }
    if (peerStore.key !== key || peerStore.raw !== raw) {
      let all;
      try { all = JSON.parse(raw || '{}'); } catch { all = {}; }
      peerStore = { key, raw, all: all && typeof all === 'object' && !Array.isArray(all) ? all : {} };
    }
    return peerStore.all;
  }
  // This session's records written into what's stored now. A DM stored already keeps the person stored for it (it was
  // recorded there first, by another tab). A record that can't be written stays in memory, and goes with the next one.
  function savePeers(key) {
    const all = { ...storedPeers(key) };
    let added = false;
    for (const [dmId, userId] of peers.map) if (!all[dmId]) { all[dmId] = userId; added = true; }
    if (added) {
      const raw = JSON.stringify(all);
      try { localStorage.setItem(key, raw); peerStore = { key, raw, all }; } catch { /* full or blocked: see above */ }
    }
    return all;
  }
  function peerChanged() {
    const err = new Error('The server now names someone else as the other person in this conversation, so nothing was sent. Reload the page; if it keeps happening, tell the server’s owner.');
    err.code = 'untrusted';
    return err;
  }
  function boundPeerId(d) {
    const key = peersKey();
    if (peers.key !== key) peers = { key, map: new Map() };
    let peer = peers.map.get(d.id);
    if (!peer) {
      const stored = storedPeers(key)[d.id];
      if (typeof stored === 'string' && stored) { peer = stored; peers.map.set(d.id, peer); }
    }
    if (peer) {
      if (peer !== d.userId) throw peerChanged();
      return peer;
    }
    // First sight. Never yourself: no conversation the server makes is with you.
    if (typeof d.userId !== 'string' || !d.userId || d.userId === S.me.id) {
      const err = new Error('The server doesn’t say who else is in this conversation, so nothing was sent. Reload the page; if it keeps happening, tell the server’s owner.');
      err.code = 'untrusted';
      throw err;
    }
    peers.map.set(d.id, d.userId);
    const stored = savePeers(key)[d.id];
    if (stored !== d.userId) { peers.map.set(d.id, stored); throw peerChanged(); } // another tab recorded someone else
    return d.userId;
  }
  // The conversation the server answered "Message <userId>" with (POST /dms): only one with exactly that person (never
  // yourself), and not one this device has as being with someone else. It's remembered as being with them right away,
  // before anything is drawn or sent in it: otherwise a fresh conversation with an account of the server's, made to look
  // like them, would be taken on first sight.
  function dmWith(d, userId) {
    const known = d && S.dms.find((x) => x.id === d.id);
    if (!d || typeof d.id !== 'string' || !d.id || !userId || userId === S.me.id || d.userId !== userId || (known && known.userId !== userId)) {
      const err = new Error('The server answered with a conversation with someone else than the person you chose, so it wasn’t opened. Reload the page; if it keeps happening, tell the server’s owner.');
      err.code = 'untrusted';
      throw err;
    }
    boundPeerId({ id: d.id, userId });
    return d;
  }
  async function dmPeer(dmId) {
    const d = S.dms.find((x) => x.id === dmId);
    if (!d) throw new Error('Conversation not found.');
    const u = await userWithKeys(boundPeerId(d));
    if (!u || !u.publicKey) throw new Error('Missing key');
    return u;
  }
  // The other person of a DM, when it's all right to write to them: not a deleted account, and not while their key
  // changed and you haven't verified the new one.
  async function writablePeer(dmId) {
    const peer = await dmPeer(dmId);
    if (peer.deleted) throw new Error('This account was deleted, so nobody can read new messages to it.');
    if (keyChanged(peer)) {
      const err = new Error(`${peer.username}'s security key changed. Verify it before sending.`);
      err.code = 'untrusted';
      throw err;
    }
    trust(peer);
    return peer;
  }
  // Once you both have post-quantum keys, each message is d3: its own key, wrapped inside it for both of you with the
  // hybrid (e2ee.js encryptDm3); until then with the key from your two identity keys (d2), as before. A DM is
  // post-quantum on this device once it has seen a d3 message there or written one (E2EE.noteDmPq): from then on
  // nothing is written in it with P-256 alone, not if the server leaves their key out, nor yours, nor after accepting
  // their new keys. A device without the account's seed writes nothing that needs it (myPqForWriting throws
  // need_password): read-only until the password is entered.
  const tsOf = (payload) => (payload && Number.isSafeInteger(payload.ts) && payload.ts > 0 ? payload.ts : 0);
  // When a d3 message dates this DM going post-quantum: a new message's own time. An edit keeps the time of the message
  // it edits (binding.js bindEdit), which can be days before the conversation went post-quantum: dating it from that
  // would flag the other person's honest P-256 messages in between (d2AfterPq). An edit only says the DM is post-quantum.
  const writtenAt = (payload) => (payload && Number(payload.v) > 0 ? 0 : tsOf(payload));
  async function encryptDm(dmId, payload) {
    const peer = await writablePeer(dmId);
    const peerPq = await pqKeyOf(peer);
    const pqDm = E2EE.dmPqSeen(S.me.id, dmId);
    const d2 = () => E2EE.encryptDm({ myPriv: S.privateKey, theirPub: peer.publicKey, dmId, authorId: S.me.id, payload });
    if (!peerPq && !pqDm) return d2();
    const minePq = await myPqForWriting();
    if (!minePq && !pqDm) return d2(); // (your account has none)
    if (!minePq) throw needPasswordError();
    if (!peerPq) {
      const err = new Error(`${peer.username}’s post-quantum key isn’t listed right now, so nothing was sent: this conversation is post-quantum encrypted. If they just reset their password, their app adds it as soon as it starts; if it keeps happening, tell the server’s owner.`);
      err.code = 'untrusted';
      throw err;
    }
    if (!(await ownKeysOk())) throw ownKeysMismatch();
    const text = await E2EE.encryptDm3({ dmId, authorId: S.me.id, myPriv: S.privateKey, myPub: proven.e, myPq: minePq, peerId: peer.id, peerPub: peer.publicKey, peerPq, payload });
    if (payload && Number(payload.v) > 0) E2EE.noteDmPq(S.me.id, dmId);
    else E2EE.noteDmFirst(S.me.id, dmId, writtenAt(payload) || Date.now());
    return text;
  }
  // A d3 message: opened with this device's post-quantum key and whichever identity key of theirs made it (yours, for
  // your own), judged by its date exactly as a d2 is (keysOf). { pending: true } while this device has no seed.
  async function openDm3(dmId, authorId, text, at) {
    E2EE.noteDmPq(S.me.id, dmId);
    const mine = myPq();
    if (!mine) return { pending: true };
    if (!(await ownKeysOk())) throw ownKeysMismatch();
    const keys = authorId === S.me.id ? [{ key: proven.e, trust: 'now' }] : await dmKeys(dmId, at);
    if (!keys.length) throw new Error('Missing key');
    const { payload, index } = await E2EE.decryptDm3({ text, dmId, authorId, myId: S.me.id, myPriv: S.privateKey, myPub: proven.e, myPq: mine, authorPubs: keys.map((k) => k.key) });
    const how = keys[index].trust;
    // Only a key this device trusts dates the DM going post-quantum (not one the server merely lists).
    if (how === 'now' || how === 'pinned') E2EE.noteDmFirst(S.me.id, dmId, writtenAt(payload));
    // Written by them with their current key: they have a post-quantum key, so it's checked and pinned now (in a batch,
    // a moment later: no request per message), and a server that hides it later gets nothing P-256 alone for them.
    if (how === 'now' && authorId !== S.me.id) pinSoon(S.dms.find((x) => x.id === dmId));
    return { payload, how };
  }
  const toPin = new Set();
  let pinTimer = null;
  function pinSoon(d) {
    let id;
    try { id = d && boundPeerId(d); } catch { return; }
    const u = id && S.users[id];
    if (!u || typeof u.pq !== 'string' || !u.pq || E2EE.pinnedPq(S.me.id, u)) return;
    toPin.add(u.id);
    pinTimer ||= setTimeout(async () => {
      pinTimer = null;
      const users = [...toPin].map((id) => S.users[id]).filter(Boolean);
      toPin.clear();
      await prefetchPq(users).catch(() => {});
      for (const u2 of users) await pqKeyOf(u2).catch(() => {});
    }, 50);
  }
  // A d2 message from them written after this DM went post-quantum, as both messages say it themselves (their
  // authenticated times, never the server's, give or take clocks): their app wouldn't write that, so it's flagged.
  const PQ_SKEW = 10 * 60 * 1000;
  function d2AfterPq(dmId, payload) {
    const first = E2EE.dmFirstAt(S.me.id, dmId);
    const ts = tsOf(payload);
    return !!first && !!ts && ts > first + PQ_SKEW;
  }

  // The other person's identity keys a DM written at `at` may be locked with, best first (see keysOf): it's
  // locked with whichever key they had then (before a password reset, or before they deleted their account).
  async function dmKeys(dmId, at) {
    const d = S.dms.find((x) => x.id === dmId);
    if (!d) throw new Error('Conversation not found.');
    const peer = await userWithKeys(boundPeerId(d));
    if (peer && peer.publicKey) trust(peer);
    return keysOf(peer, 'e', at);
  }
  // DMs aren't signed (so they stay deniable): the key that opens one is all that says who could have written it.
  // keyNote says when that wasn't their current trusted key, so the message can say so.
  async function openDm(dmId, authorId, text, at = 0) {
    try {
      // Which key opens it: the message's own (d3), else the one from your two identity keys (d2, v1).
      let opened = null;
      const d3 = E2EE.isDm3(text);
      if (d3) {
        const r = await openDm3(dmId, authorId, text, at);
        if (r.pending) return { pending: true, pq: true, t: '', f: [] };
        opened = r;
      } else {
        for (const { key, trust: how } of await dmKeys(dmId, at)) {
          try { opened = { ...(await E2EE.decryptDm({ myPriv: S.privateKey, theirPub: key, dmId, authorId, text })), how }; break; } catch { /* not this key */ }
        }
      }
      if (!opened) throw new Error('Missing key');
      const { payload, legacy, how } = opened;
      const noPq = !d3 && authorId !== S.me.id && d2AfterPq(dmId, payload);
      return { t: String(payload.t || ''), f: cleanFiles(payload.f), p: cleanPoll(payload.p), x: cleanX(payload.x), ...linksIn(payload), ...bindIn(payload), ...photoIn(payload), legacyFormat: !!legacy, ...(noPq ? { noPq } : {}), ...(how !== 'now' ? { keyNote: how } : {}) };
    } catch {
      return { error: true, t: '', f: [] };
    }
  }
  async function decryptDmMessage(m) {
    if (m.dec && !m.dec.pending) return;
    m.dec = await openDm(m.dmId, m.authorId, m.ciphertext, Number(m.createdAt) || 0);
    if (m.reply && m.reply.big && !m.reply.dec) m.reply.dec = BIG_QUOTE;
    if (m.reply && m.reply.ciphertext && (!m.reply.dec || m.reply.dec.pending)) m.reply.dec = await openDm(m.dmId, m.reply.authorId, m.reply.ciphertext, Number(m.reply.createdAt) || 0);
  }

  // ---------------------------------------------------------------- attachments
  async function decryptAttachment(m, f, buf) {
    if (f.k) return E2EE.decryptFile(f.k, buf);
    if (m.dmId) {
      // Files from the oldest DM format are locked with the conversation key itself: the same keys as the text.
      for (const { key } of await dmKeys(m.dmId, Number(m.createdAt) || 0)) {
        try { return await E2EE.decryptLegacyDmFile(S.privateKey, key, buf); } catch { /* not this key */ }
      }
      throw new Error('Missing key');
    }
    throw new Error('Missing file key');
  }

  // ---------------------------------------------------------------- photo tags (photo-notes.js, e2ee.js tc1 / td1)
  // where: { serverId, channelId } (a server channel or a group chat) or { dmId }. payload: { n, fu }, the label
  // (already normalised) and the address of the file it's on. Sealed as a message there would be: with the server's
  // current key and your signature (ready() rotates or waits for it, and refuses as a send does), or in a DM with the
  // key you share with them, refused the same way while their key changed and you haven't verified it.
  async function encryptTag(where, { messageId, fileIndex, tagId, payload }) {
    const tag = { messageId, fileIndex, tagId, authorId: S.me.id, payload };
    if (where && where.serverId) {
      const ck = await ready(where.serverId);
      const ciphertext = await E2EE.encryptGroupTag({ raw: ck.raw, serverId: where.serverId, channelId: where.channelId, epoch: ck.epoch, signKey: S.signKey, ...tag });
      return { ciphertext, epoch: ck.epoch };
    }
    const peer = await writablePeer(where.dmId);
    return { ciphertext: await E2EE.encryptDmTag({ myPriv: S.privateKey, theirPub: peer.publicKey, dmId: where.dmId, ...tag }) };
  }
  // A tag as the server lists it ({ id, messageId, fileIndex, authorId, ciphertext, createdAt }, with serverId and
  // channelId, or dmId): { n, fu } as its author sealed them, { pending: true } while the server key it was sealed
  // with isn't here yet (before: it never will be, as for messages), or { error: true }, with retry: true when it
  // couldn't be checked because someone's keys couldn't be looked up (offline, the server busy): worth trying again
  // later, unlike a tag that doesn't check out. Never throws.
  // A tag has no room for the warnings a message carries, so it only counts when it checks out with a key this device
  // trusts for its author: in a channel signed with their current key or one this device pinned for them back then
  // ('now' or 'pinned', as for a verified message), in a DM opened with such a key. Anything only a new key not
  // verified yet, or a key the server merely lists, would vouch for is left out.
  const LOOKUP = new Error('Keys not looked up');
  const lookedUp = (p) => p.catch(() => { throw LOOKUP; });
  async function openTag(t) {
    try {
      const at = Number(t.createdAt) || 0;
      const bound = { messageId: t.messageId, fileIndex: t.fileIndex, tagId: t.id, authorId: t.authorId };
      let payload = null;
      if (t.serverId) {
        const epoch = E2EE.tagEpoch(t.ciphertext);
        const mine = keysFor(t.serverId);
        const raw = epoch === null ? null : mine.get(epoch);
        if (!raw) {
          if (epoch === null) return { error: true };
          const held = [...mine.keys()];
          return { pending: true, before: held.length > 0 && epoch < Math.max(...held) };
        }
        const author = await lookedUp(userWithKeys(t.authorId));
        if (t.authorId === S.me.id) await ownKeysOk();
        const keys = keysOf(author, 's', at);
        const r = await E2EE.decryptGroupTag({ raw, serverId: t.serverId, channelId: t.channelId, ...bound, authorSignPub: keys.map((k) => k.key), text: t.ciphertext });
        const how = r.signedBy ? keys.find((k) => k.key === r.signedBy).trust : null;
        if (how !== 'now' && how !== 'pinned') return { error: true };
        payload = r.payload;
      } else {
        if (!S.dms.some((d) => d.id === t.dmId)) return { error: true };
        for (const { key, trust: how } of await lookedUp(dmKeys(t.dmId, at))) {
          if (how !== 'now' && how !== 'pinned') continue;
          try { payload = (await E2EE.decryptDmTag({ myPriv: S.privateKey, theirPub: key, dmId: t.dmId, ...bound, text: t.ciphertext })).payload; break; } catch { /* not this key */ }
        }
      }
      if (!payload || typeof payload !== 'object' || typeof payload.n !== 'string' || typeof payload.fu !== 'string') return { error: true };
      return { n: payload.n, fu: payload.fu };
    } catch (e) {
      return e === LOOKUP ? { error: true, retry: true } : { error: true };
    }
  }

  // ---------------------------------------------------------------- chat backgrounds (chat-look.js, e2ee.js lkc1 / lkd1)
  // where: { serverId } (a group chat) or { dmId }. version: the one the server is to store it as (its version + 1).
  // payload: { bg, dim } (cleanLook). Sealed as a message there would be: in a group chat with its current key and your
  // signature (ready() rotates or waits for it, and refuses as a send does), in a DM with the key you share with them,
  // refused the same way while their key changed and you haven't verified it.
  async function encryptLook(where, { version, payload }) {
    const clean = cleanLook(payload);
    if (!clean) throw new Error('That background can’t be saved.');
    const look = { version, authorId: S.me.id, payload: clean };
    if (where && where.serverId) {
      const ck = await ready(where.serverId);
      const ciphertext = await E2EE.encryptGroupLook({ raw: ck.raw, serverId: where.serverId, epoch: ck.epoch, signKey: S.signKey, ...look });
      return { ciphertext, epoch: ck.epoch };
    }
    const peer = await writablePeer(where.dmId);
    return { ciphertext: await E2EE.encryptDmLook({ myPriv: S.privateKey, theirPub: peer.publicKey, dmId: where.dmId, ...look }) };
  }
  // A background as the server lists it ({ ciphertext, authorId, version, updatedAt }, with serverId or dmId): { bg, dim }
  // as its author sealed them (cleanLook), { pending: true } while the group key it was sealed with isn't here yet
  // (before: it never will be, as for messages), or { error: true }, with retry: true when its author's keys couldn't be
  // looked up (offline, the server busy). Never throws.
  // The same rule as tags: it only counts when it checks out with a key this device trusts for its author. In a group
  // chat it's signed with their current key or one this device pinned for them back then ('now' or 'pinned'); in a DM
  // it opens with such a key. Anything only a new key not verified yet, or a key the server merely lists, would vouch
  // for is left out: a background has nowhere to carry the warnings a message shows.
  async function openLook(look) {
    try {
      const at = Number(look.updatedAt) || 0;
      const bound = { version: look.version, authorId: look.authorId };
      if (!Number.isInteger(look.version) || look.version < 1 || typeof look.authorId !== 'string' || !look.authorId || typeof look.ciphertext !== 'string') return { error: true };
      let payload = null;
      if (look.serverId) {
        const epoch = E2EE.lookEpoch(look.ciphertext);
        const mine = keysFor(look.serverId);
        const raw = epoch === null ? null : mine.get(epoch);
        if (!raw) {
          if (epoch === null) return { error: true };
          const held = [...mine.keys()];
          return { pending: true, before: held.length > 0 && epoch < Math.max(...held) };
        }
        const author = await lookedUp(userWithKeys(look.authorId));
        if (look.authorId === S.me.id) await ownKeysOk();
        const keys = keysOf(author, 's', at);
        const r = await E2EE.decryptGroupLook({ raw, serverId: look.serverId, ...bound, authorSignPub: keys.map((k) => k.key), text: look.ciphertext });
        const how = r.signedBy ? keys.find((k) => k.key === r.signedBy).trust : null;
        if (how !== 'now' && how !== 'pinned') return { error: true };
        payload = r.payload;
      } else {
        if (!look.dmId || !S.dms.some((d) => d.id === look.dmId)) return { error: true };
        for (const { key, trust: how } of await lookedUp(dmKeys(look.dmId, at))) {
          if (how !== 'now' && how !== 'pinned') continue;
          try { payload = (await E2EE.decryptDmLook({ myPriv: S.privateKey, theirPub: key, dmId: look.dmId, ...bound, text: look.ciphertext })).payload; break; } catch { /* not this key */ }
        }
      }
      return cleanLook(payload) || { error: true };
    } catch (e) {
      return e === LOOKUP ? { error: true, retry: true } : { error: true };
    }
  }

  // ---------------------------------------------------------------- voice handshakes
  const sdpText = (channelId, from, to, desc) => `hearth-voice|${channelId}|${from}|${to}|${desc.type}|${desc.sdp}`;
  const signSdp = (channelId, toUserId, desc) => E2EE.sign(S.signKey, sdpText(channelId, S.me.id, toUserId, desc));
  // A 1-to-1 call ('dm:<dmId>') is with the person this device remembers that DM is with, and nobody else: not whoever
  // the server rings you in the name of, nor whoever it lists in the call (an account of its own made to look like
  // them would otherwise be pinned on first sight and connected). null for a DM this device doesn't have, one the
  // server now names someone else for, and any other call.
  function callPeer(room) {
    if (typeof room !== 'string' || !room.startsWith('dm:')) return null;
    const d = S.dms.find((x) => x.id === room.slice(3));
    if (!d) return null;
    try { return boundPeerId(d); } catch { return null; }
  }
  // A call this device knows: { dm } for 'dm:<id>' of a DM it has, { server, channel } for a voice channel of one of its
  // servers or groups, or null for any other room the server names (a call there would show the server's word for who
  // is calling, and connect with whoever it lists).
  function callRoom(room) {
    if (typeof room !== 'string' || !room) return null;
    if (room.startsWith('dm:')) { const dm = S.dms.find((x) => x.id === room.slice(3)); return dm ? { dm } : null; }
    for (const server of S.servers || []) {
      const channel = (server.channels || []).find((c) => c.id === room);
      if (channel) return channel.type === 'voice' ? { server, channel } : null;
    }
    return null;
  }
  // A ring for a DM this device doesn't have yet (the other person pressed "Message", then called, before anything was
  // written): the conversation the server answers "Message <from>" with (POST /dms, `d`), only if it's exactly the one
  // ringing and with exactly that person, remembered as theirs (dmWith). The same trust on first use as a DM first met
  // through a message.
  function dmForCall(room, from, d) {
    if (typeof room !== 'string' || !room.startsWith('dm:') || !d || d.id !== room.slice(3)) {
      const err = new Error('The server rang for a conversation it then wouldn’t name, so the call wasn’t shown.');
      err.code = 'untrusted';
      throw err;
    }
    return dmWith(d, from);
  }
  // Whether this device may connect with that person in that call at all (voice.js asks before it makes any connection,
  // checkSdp before it takes any handshake): only in a call it knows (callRoom), and in a 1-to-1 call only with callPeer.
  const mayCall = (room, userId) => !!callRoom(room) && (!room.startsWith('dm:') || (!!userId && callPeer(room) === userId));
  // Whether an offer or answer really comes from that person: { ok: true }, or { ok: false, why } with why one of
  //   'no-key'         the server lists no identity key for them (a bot has none), or no signing key at all
  //   'deleted'        the server says the account was deleted (it can't sign in, so it's never in a call)
  //   'key-changed'    their keys aren't the ones this device pinned for them (e2ee.js judgePin), until you compare
  //                    safety numbers and accept the new ones
  //   'lookup-failed'  their keys couldn't be loaded
  //   'bad-signature'  no signature, a wrong one, or one claiming to come from your own account
  //   'not-in-dm'      a 1-to-1 call, and they aren't the person this device has the DM as being with (see callPeer)
  // The signature is checked with the signing key this device pinned for them (pinned on first sight, trust on first
  // use), never just the one the server lists now: the DTLS fingerprint inside the SDP is what the encrypted
  // connection is checked against, so a server that could get its own key accepted could sit in the middle.
  async function checkSdp(channelId, fromUserId, desc, sig) {
    if (!fromUserId || fromUserId === S.me.id || !desc || typeof desc.sdp !== 'string' || !sig) return { ok: false, why: 'bad-signature' };
    if (!mayCall(channelId, fromUserId)) return { ok: false, why: 'not-in-dm' };
    let u;
    try { u = await userWithKeys(fromUserId); } catch { u = null; }
    if (!u) return { ok: false, why: 'lookup-failed' };
    // (An account deleted by an older version has no keys at all; one that lists a signing key without an identity
    // key is no real deletion, e2ee.js judgePin.)
    if (!u.publicKey) return { ok: false, why: u.deleted && !keyChanged(u) ? 'deleted' : 'no-key' };
    if (keyChanged(u)) return { ok: false, why: 'key-changed' };
    if (u.deleted) return { ok: false, why: 'deleted' };
    const signKey = E2EE.pinnedKeys(S.me.id, u).s;
    if (!signKey) return { ok: false, why: 'no-key' };
    return (await E2EE.verify(signKey, sdpText(channelId, fromUserId, S.me.id, desc), sig)) ? { ok: true } : { ok: false, why: 'bad-signature' };
  }
  const verifySdp = async (channelId, fromUserId, desc, sig) => (await checkSdp(channelId, fromUserId, desc, sig)).ok;

  function reset() {
    groupKeys.clear(); states.clear(); busy.clear(); warned.clear(); rewrapped.clear(); keeping.clear(); unverified.clear(); holds.clear();
    waitingPq.clear(); pqFetched.clear(); pqChecked.clear();
    ownCheck = null; proven = null; ownPq = null; pqBusy = null; pqNeed = null; adopted = null; E2EE.clearCaches();
    peers = { key: '', map: new Map() }; peerStore = { key: '', raw: null, all: {} };
  }

  return {
    ensurePqKey, ownPqChanged, neededPassword, lastPqError, pqKeyOf, myPqForWriting,
    waitingForPq: (serverId) => waitingPq.has(serverId),
    proveOwnKeys, ownKeys, applyState, stateOf, currentKey, ready, refresh, forceRotate, maintain, awaitingVerify, heldBack, isHeld,
    encryptChannel, decryptChannelMessage, encryptDm, decryptDmMessage, decryptAttachment, encryptTag, openTag, encryptLook, openLook,
    dmWith, callPeer, callRoom, dmForCall, mayCall, signSdp, verifySdp, checkSdp, keyChanged, keysChanged, acceptKeys, trust, userWithKeys, reset,
    heldEpochs: (serverId) => [...keysFor(serverId).keys()],
    keysSaved: (serverId) => keeping.get(serverId) || Promise.resolve(), // our own copies are stored back
    signKeysFor,
  };
}
