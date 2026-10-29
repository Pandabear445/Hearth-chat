// Hearth web client.
// Layout: server rail | sidebar (home or server) | conversation | contextual right panel (members, pins, thread).
import { androidApp, noPayments } from './android.js';
import { h, $, $$, clear, icon, fmtTime, fmtStamp, fmtDay, fmtSize, toast, playSound, copyText, debounce } from './util.js';
import { api, upload, getToken, setToken, setTokenOwner, onTokenChange, tokenMovedFrom } from './api.js';
import * as E2EE from './e2ee.js';
import { render as md, renderDoc, extractImageUrls, isOnlyImageUrl, isJumbo, setResolvers, linkedUrls, readableText, linkChannelNames } from './markdown.js';
import { findPreviewUrl, looksPrivate, payloadVariants, hostLabel, cleanText as cleanPreviewText, KINDS as PREVIEW_KINDS, TITLE_MAX, DESC_MAX, SITE_MAX } from './linkpreview.js';
import { PERMS, PERM_GROUPS, ALL as ALL_PERMS, has, memberRoles, basePerms, topColor, mayMentionRole, mayEmbed } from './perms.js';
import { openCropper } from './cropper.js';
import { adminView, CATEGORY_LABEL } from './admin.js';
import { captchaWidget } from './captcha.js';
import { prepareImage, makeQueue, whenVisible, whenOnScreen, previewThumb } from './media.js';
import { isUploadUrl, safeDownloadHref, ALT_MAX, MAX_FILES, maxFilesFor } from './attachments.js';
import { outsideMode, outsideHost, imageDecision, openedLinks } from './outside.js';
import { CHUNKED_ABOVE, uploadResumable, uploadSimple, download, makeUrlCache, mediaKind, typeLabel } from './files.js';
import { EMOJI, EMOJI_NAMES, CATEGORY_ICONS, QUICK_REACTIONS, recentEmoji, pushRecentEmoji, searchEmoji } from './emoji.js';
import { Voice } from './voice.js';
import { openCallDiagnostics } from './call-diagnostics.js';
import { createSecure, mergeUser, callRefusedText, noSafetyNumbersText } from './secure.js';
import { avatarEl, nameEl, displayName, displayNameIn, nicknameIn, realName, forwardText, nameMatches, setPersonalNames, profileCard, presenceOf, STATUS_LABEL, cropStyle, stopSong, songPlaying } from './profile-ui.js';
import { renderPage } from './page.js';
import { watchPlayer, dropWatchPlayer } from './watch.js';
import { socialLinks, parseSocialUrl, playerMode } from './social.js';
import { socialEmbedEl, resolveSocial } from './social-embed.js';
import { initFeatures, pollEl, onPollUpdate, openPollCreator, voiceButton, voiceEl, openEvents, onEventsUpdate, eventsFor, loadEvents, repeatLabel, upcomingSection, onEventStarting, remindItems, startReminders, purgeReminders, reminderDeadlines, stopVoice, voicePlaying } from './features.js';
import { rankRelays, chooseIce, relayTime, iceStale, usableIce, memberRelayHosts, avoidsMemberRelays, isMemberRelay, isRelay } from './relays.js';
import { watchConnection } from './conn.js';
import { unseenNotes, markNotesSeen } from './whatsnew.js';
import { autocorrect, correctSending, isCommand, englishHere, lastWordPasted } from './spelling.js';
import { initKeybinds, getKeybinds, comboLabel, reportCall, flashTaskbar, installUpdate, shortcutGroups, comboParts, keyName } from './keybinds.js';
import { initActivity, activityLine, openActivityPicker, startDesktopDetection } from './activity.js';
import { modal, popover, closePopover, menu, contextMenu, sheet, quietFocus, confirmDialog, field, ibtn, markInvalid, clearInvalid, trapTab } from './ui.js';
import { openSettings, applyAppearance, confirmedCall, displayNameDialog } from './settings.js';
import { createFolders, dragDrop } from './folders.js';
import { createUpdates } from './updates.js';
import { createRecall } from './recall-host.js';
import { openMemberships, membershipsTab } from './memberships.js';
import { openRolePicker, pickableRoles, selfAssignProblem, SELF_BLOCKED } from './selfroles.js';
import { botsTab, createSlash, NEWS_BOT_ID } from './bots.js';
import { webhooksPanel, onWebhooksUpdate } from './webhooks.js';
import { initServerAudit, auditTab, reportsTab } from './serveraudit.js';
import { openDiscordImport } from './discord-import.js';
import { loadAppearance, saveAppearance, setServerTheme, BACKGROUNDS } from './appearance.js';
import { createDrafts, clearAllDrafts, clearLocalCopies, expireLocalCopies, claimOnce, rememberNotification, closeNotifications, closeNotificationFor, alsoCloseNotifications, quietNow } from './usability.js';
import { label as disLabel, deadline, expired as isExpired, disappears, serverKept, nextDeadline, waitFor, sysLineParts, remaining, TIMERS, setChoices as setTimerChoices, weaker as weakerTimer, stricter as stricterTimer } from './disappear.js';
import { createScheduled } from './scheduled.js';
import { createSoundboard } from './soundboard.js';
import { createMediaPanel } from './media-panel.js';
import { createPhotoNotes } from './photo-notes.js';
import { createChatLook } from './chat-look.js';
import { createSideView, placeLabel as sidePlaceLabel } from './side-view.js';
import { bindNew, bindEdit, describe as describeBinding, createVersions, createCopies, createOriginals, noteMessage, bindingState } from './binding.js';
import { trackViewport } from './viewport.js';
import { isPhone, isPhoneLayout, isTouchUI, onDeviceChange } from './device.js';
import { createUpdater, underWay, jobsUnderWay } from './auto-update.js';
import { canShrink, startShrink, probe as probeVideo, plan as shrinkPlan, longestFitting, budgetFor, fitsText } from './video-shrink.js';
import { touchGestures } from './viewer-touch.js';
import { backStack, edgeSwipes } from './phone-nav.js';
import { initAway, CLEAR_AFTER, clearAfterMs, clearsLabel, onlyPresenceChanged } from './presence.js';
import { createTyping, typingLine, typingPreview } from './typing.js';
import { createWordFilter, filterLabel, previewLabel } from './wordfilter-app.js';
import { createPersonalNames } from './personal-names.js';
import { prepareEmoji, suggestName, sizeLabel } from './emoji-upload.js';
import { inviteMessage, movingMessage, joinNote, signUpMode, canShare, nudgeWanted, nudgeDismissed, dismissNudge } from './invite-share.js';

// ======================================================================= state
const S = {
  watch: {}, // call room -> shared video (watch together)
  regionWarned: new Set(), // calls already told that their pinned region is offline
  config: null,
  me: null,
  privateKey: null,
  users: {},
  servers: [],          // includes group DMs (kind: 'group')
  dms: [],
  relationships: {},
  blocked: new Set(),
  voice: {},
  view: { type: 'home' },
  panel: null,          // right panel: 'members' | 'pins' | 'threads' | 'thread' | 'media' (Photos & videos) | 'side' (Pinned to side) | null
  thread: null,         // { rootId, channelId, serverId, from: 'threads' when opened from the Threads panel }
  msgs: {},             // 'c:<channelId>' | 'd:<dmId>' -> { list, hasMore, hasNewer, loaded }
  threads: {},          // rootId -> { root, list, loaded }
  threadState: {},      // rootId -> { channelId, unread, mentions, lastReadId, lastId }: your read state per thread (on the server)
  threadMentions: new Map(), // 'c:<channelId>' -> pings in its threads not read yet (they count in the channel's badge)
  threadsPanel: null,   // the Threads panel's list: { channelId, items, hasMore, next, loading, error }
  previews: {},         // conversation key -> decrypted preview text
  unread: new Set(),
  mentions: new Map(),
  lastRead: {},         // conversation key -> last message id read (kept on the server, synced across devices)
  lastIds: {},          // conversation key -> newest message id we know of
  chatFloor: {},        // voice chat key -> the newest message known before it last turned unread (one you never opened)
  notifyPrefs: {},      // 's:'|'c:'|'d:' key -> { level, muteUntil, suppressEveryone } (on the server)
  notifySettings: { dnd: { on: false }, previews: 'hidden' },
  savedIds: new Set(),  // saved messages (ids only; on the server)
  speaking: new Set(),
  boardPlaying: new Set(), // people in the call whose soundboard sound is playing (their tiles glow, like speaking)
  clockOffset: 0,       // the server's clock minus this device's (disappearing messages go by the server's time)
};
// The server's time now: disappearing messages are hidden by it, whatever this device's clock says.
const nowServer = () => Date.now() + (S.clockOffset || 0);
let socket;
// The token the live connection last connected with. When this tab's token changes (this tab or another one of
// this browser changed the password, turned on two-factor or signed out the other devices, and the server gave
// the sign-in a new token), a connection still on the old one is made again with the new one. (One the server has
// already closed for it comes back by itself: see tokenMoved in watchConnection, conn.js.)
let socketToken = '';
onTokenChange((t) => { if (socket && socket.connected && t !== socketToken) { socket.disconnect(); socket.connect(); } });
let hadController = false; // was a service worker already in charge when the page loaded?
let voice;
// Your own soundboard (soundboard.js): played into calls from the call controls, edited in Settings → Soundboard.
const board = createSoundboard({
  S, vaultKey: () => myVaultKey(), voice: () => voice,
  canPlay: (room) => boardBlocked(room),
  emojiPicker: (anchor, onPick) => emojiPicker(anchor, onPick),
  openSettings: () => openSettings(app, 'soundboard'),
  onMe: (u) => app.onMe(u),
  userName: (id) => displayName(getUser(id)),
});
// Why this person can't play a sound into this call right now ('' when they can). The server checks the same.
function boardBlocked(room) {
  if (!voice || voice.channelId !== room) return 'Join a voice call to play sounds.';
  if (voice.speakLocked || voice.serverMuted) return 'You can\u2019t talk in this call, so you can\u2019t play sounds either.';
  if (voice.muted || voice.deafened) return 'Unmute to play sounds.';
  const c = !room.startsWith('dm:') && channelById(room);
  if (c && !canIn(c, PERMS.USE_SOUNDBOARD)) return 'You don\u2019t have permission to use the soundboard here.';
  return '';
}
let away = null; // automatic Away (presence.js)
const sec = createSecure({ S, onKeysChanged, onKeyWarning });
// Who's typing where (typing.js): drawn under the open conversation's box and in the conversation lists.
const TYPING = createTyping({ onChange: (key) => typingChanged(key) });
// Word filter (wordfilter-app.js): your own list and your servers' suggested ones, applied on this device only.
const WF = createWordFilter({ S, vaultKey: () => myVaultKey(), serverOf: (m) => msgServer(m), onChange: () => wordFilterChanged() });
// Nicknames only you see (personal-names.js): every name the app shows asks profile-ui.js, which asks this first.
const PN = createPersonalNames({ S, vaultKey: () => myVaultKey(), onChange: () => personalNamesChanged() });
setPersonalNames((id) => PN.get(id));
const fetchingUsers = new Set();

// ---- per-device preferences
// Kept in memory after the first read: these are read constantly while drawing (every channel's
// notification level, the saved list for every message…), and parsing them each time was slow.
const lsCache = new Map();
const LS = {
  get(k, d) {
    if (lsCache.has(k)) return lsCache.get(k);
    let v = d;
    try { const raw = localStorage.getItem(k); if (raw != null) v = JSON.parse(raw); } catch { /* default */ }
    lsCache.set(k, v);
    return v;
  },
  set(k, v) { lsCache.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};
// Another tab changed something: forget our copy so the next read picks it up.
window.addEventListener('storage', (e) => { if (e.key) lsCache.delete(e.key); else lsCache.clear(); });

// Several things asking to redraw the same part in one go (a burst of messages, people coming
// online) redraw it once, on the next frame.
const queuedDraws = new Set();
let drawFrame = 0;
function later(fn) {
  queuedDraws.add(fn);
  if (drawFrame) return;
  const run = () => { drawFrame = 0; const fns = [...queuedDraws]; queuedDraws.clear(); fns.forEach((f) => f()); };
  // Hidden tabs don't get animation frames; a timer keeps them up to date anyway.
  drawFrame = document.hidden ? setTimeout(run, 250) : requestAnimationFrame(run);
}
const mine = (k) => `hearth.${k}.${S.me.id}`;
// Below this width the member list floats over the chat, so it only opens when asked (not on every channel). In the
// phone layout it covers the chat, whatever the width (a phone held sideways).
const wideEnoughForPanel = () => matchMedia('(min-width: 1241px)').matches && !isPhoneLayout();
const P = {
  get favorites() { return LS.get(mine('favs'), []); },
  set favorites(v) { LS.set(mine('favs'), v); },
  get collapsed() { return LS.get(mine('collapsed'), {}); },
  set collapsed(v) { LS.set(mine('collapsed'), v); },
  // Notification levels by key ('all' | 'mentions' | 'muted'), from the preferences kept on the server.
  get notify() { const out = {}; for (const [k, v] of Object.entries(S.notifyPrefs)) if (v.level !== 'default') out[k] = v.level === 'none' ? 'muted' : v.level; return out; },
  get lastRead() { return S.lastRead; },
  get inbox() { return LS.get(mine('inbox'), []); },
  set inbox(v) { LS.set(mine('inbox'), v.slice(0, 200)); },
  get lastChannel() { return LS.get(mine('lastChannel'), {}); },
  set lastChannel(v) { LS.set(mine('lastChannel'), v); },
  // linkPreviews: 'ask' | 'always' | 'never' (when I send a link); linkCards: show previews in messages.
  get chat() { return { enterToSend: true, embeds: true, markdown: true, jumbo: true, linkPreviews: 'ask', linkCards: true, spellcheck: true, ...LS.get('hearth.chat', {}) }; },
  // A server's or group chat's member list beside the chat, shown or hidden as you last left it.
  get showMembers() { return localStorage.getItem('hearth.members') !== 'off'; },
  set showMembers(v) { localStorage.setItem('hearth.members', v ? 'on' : 'off'); },
  // A DM's profile beside the chat, shown or folded away as you last left it. A choice of its own: it used to be the
  // member list's, so folding it in a DM hid servers' member lists too, and showing one brought it back. Not set yet
  // (see below), it goes with the member list's.
  get showDmProfile() { const v = localStorage.getItem('hearth.dmprofile'); return v === null ? this.showMembers : v !== 'off'; },
  set showDmProfile(v) { localStorage.setItem('hearth.dmprofile', v ? 'on' : 'off'); },
  // The chat beside a voice channel's call: shown or hidden as you last left it (closed until you first open it).
  get voiceChat() { return localStorage.getItem('hearth.voiceChat') === 'on'; },
  set voiceChat(v) { localStorage.setItem('hearth.voiceChat', v ? 'on' : 'off'); },
};
// The first time this app starts with a choice of its own for the DM profile, it takes the member list's as it is now,
// before anything here can change that: a profile someone had hidden stays hidden.
try { if (localStorage.getItem('hearth.dmprofile') === null) P.showDmProfile = P.showMembers; } catch { /* storage blocked: it goes with the member list's */ }

// expose for settings.js
export const app = {
  S,
  sec,
  P,
  get voice() { return voice; },
  soundboard: board,
  onMe(u) { setUser(u); renderUserPanel(); },
  checkAway: () => away && away.check(), // after "Away after" changes
  logout,
  rerender: () => { lsCache.clear(); renderAll(); }, // settings.js writes some preferences straight to localStorage
  redrawImageLinks: () => redrawImageLinks(),
  followRelayChoice: () => followRelayChoice(), // after "Avoid relays run by members" changes
  openProfile: (id) => openProfileModal(id),
  install: () => installApp(),
  get canInstall() { return !!installPrompt; },
  get isInstalled() { return isStandalone(); },
  push: {
    // In the Android app, push goes through the app (a UnifiedPush push app such as ntfy), not the browser's.
    supported: () => (androidApp.push ? !!(S.config && S.config.pushEnabled) : 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && S.config && S.config.pushEnabled),
    status: () => pushStatus(),
    enable: () => enablePush(),
    disable: () => disablePush(),
    // Android app only: pick another push app (resubscribes with the new address).
    choose: () => enablePush({ choose: true }),
    get android() { return androidApp.push; },
  },
  openServerSettings: (id) => openServerSettings(S.servers.find((s) => s.id === id)),
  unblock: (id) => toggleBlock(id, false),
  openAdmin: () => setView({ type: 'admin', tab: 'overview' }),
  study: () => study,
  fileInfo: (url, where) => fileInfo(url, where),
  showMessage: (where) => (where && where.messageId ? jumpToMessage(where.type === 'dm' ? 'd:' + where.dmId : 'c:' + where.channelId, where.messageId) : null),
  setNotify: (key, level, extra) => setNotify(key, level, extra),
  setNotifySettings: (body) => setNotifySettings(body),
  decryptMessage: (m) => decryptMessage(m),
  wordFilter: WF,
  personalNames: PN,
  realName: (u) => realName(u),
  openShortcuts: () => openShortcuts(),
  // A server event for a settings page that follows it live (Help host: relays:mine). Returns how to stop listening.
  onSocket: (ev, fn) => { if (!socket) return () => {}; socket.on(ev, fn); return () => socket.off(ev, fn); },
};

// ======================================================================= boot
init();

async function init() {
  // Copies of messages' words kept in this browser (inbox, reminders) whose message's deadline has passed go now,
  // whichever account they belong to and whether or not anyone signs in (usability.js).
  expireLocalCopies(Date.now());
  applyAppearance();
  setupServiceWorker();
  trackViewport();
  // "Skip to conversation": the first Tab stop, so keyboard users don't have to go through the server
  // list and channels first.
  $('#skip-main').onclick = () => { const c = $('#composer-input') || $('#messages') || $('#main'); if (c) c.focus(); };
  const resetToken = (location.hash.match(/^#reset=([A-Za-z0-9_-]{20,100})$/) || [])[1];
  if (resetToken) { history.replaceState(null, '', '/'); sessionStorage.setItem('hearth.resetToken', resetToken); } // keep it out of the address bar
  const m = location.pathname.match(/^\/invite\/([A-Za-z0-9]+)/);
  if (m) { sessionStorage.setItem('hearth.pendingInvite', m[1]); history.replaceState(null, '', '/'); }
  try { S.config = await api('GET', '/config'); } catch { S.config = { name: 'Hearth', iceServers: [] }; }
  // A disappearing timer inside a message counts only if it's one this server offers (disappear.js).
  setTimerChoices((S.config.disappearing || {}).choices);
  document.title = S.config.name;
  $$('[data-instance-name]').forEach((el) => { el.textContent = S.config.name; });
  $$('[data-instance-tagline]').forEach((el) => { el.textContent = S.config.tagline || ''; el.hidden = !S.config.tagline; });

  // A reset link opened in a tab that already shows Hearth only changes the #part: catch that too.
  window.addEventListener('hashchange', () => {
    const t = (location.hash.match(/^#reset=([A-Za-z0-9_-]{20,100})$/) || [])[1];
    if (t) { history.replaceState(null, '', '/'); if (S.me) { sessionStorage.setItem('hearth.resetToken', t); location.reload(); } else openReset(t); }
  });
  // A password-reset link: show the sign-in screen with the reset window on top.
  const pendingReset = sessionStorage.getItem('hearth.resetToken');
  if (pendingReset) { sessionStorage.removeItem('hearth.resetToken'); showSignIn(); openReset(pendingReset); return; }
  const uid = localStorage.getItem('hearth.userId');
  if (getToken() && uid) {
    const key = await E2EE.loadKey(uid).catch(() => null);
    if (key) { S.privateKey = key; return startApp(uid); }
  }
  showSignIn();
}

// ======================================================================= auth screen
// "This device has signed in here before" notes from the server, one per account (see /auth/login). With one, a
// flood of wrong passwords from somewhere else can't lock this device out of the account. Kept across log-outs.
const DEVICE_NOTES = 'hearth.deviceNotes';
function deviceNote(username) {
  try { return (JSON.parse(localStorage.getItem(DEVICE_NOTES) || '{}') || {})[username.toLowerCase()] || undefined; } catch { return undefined; }
}
function saveDeviceNote(username, note) {
  if (typeof note !== 'string') return;
  try {
    const all = JSON.parse(localStorage.getItem(DEVICE_NOTES) || '{}') || {};
    delete all[username.toLowerCase()];
    all[username.toLowerCase()] = note;
    const names = Object.keys(all);
    names.slice(0, Math.max(0, names.length - 10)).forEach((k) => delete all[k]); // the 10 most recent accounts
    localStorage.setItem(DEVICE_NOTES, JSON.stringify(all));
  } catch { /* storage blocked: the limit for this network still applies */ }
}
// Signed out with an invite link (kept from start-up until after signing in, when the join dialog opens): say what
// it's for. The server's name only when it chose to show it in invite previews (server/invitepreview.js); otherwise,
// or if the server can't be asked, "a server".
function inviteBanner() {
  const box = $('#auth-invite');
  const code = sessionStorage.getItem('hearth.pendingInvite');
  box.hidden = !code;
  if (!code) return;
  const open = S.config.registrationOpen && !S.config.registrationRequiresCode;
  const draw = (serverName) => {
    clear(box).append(h('span', null, 'You’re invited to ', h('strong', null, serverName || 'a server'), ` on ${S.config.name}. `,
      open ? 'Create an account or sign in to join.' : S.config.registrationRequiresCode ? 'Sign in to join, or create an account with a sign-up code from whoever invited you.' : 'Sign in to join.'),
    open ? h('button', { type: 'button', class: 'link-btn auth-invite-new', onclick: () => { $('#login-form').hidden = true; $('#register-form').hidden = false; const u = $('#register-form [name=username]'); if (u) u.focus(); } }, 'Create an account') : null);
  };
  draw(null);
  api('GET', `/invites/${encodeURIComponent(code)}/preview`)
    .then((p) => { if (p && p.server && sessionStorage.getItem('hearth.pendingInvite') === code) draw(p.server.name); })
    .catch(() => { /* the generic line stays */ });
}

// While lots of people are signing in (or this network keeps getting passwords wrong), the server can ask for a
// harder robot check: solve a new one and try once more.
const harderOnce = (attempt) => attempt().catch((ex) => (ex.code === 'captcha_harder' ? attempt() : Promise.reject(ex)));

function showSignIn() {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  const loginForm = $('#login-form');
  const regForm = $('#register-form');
  const secure = !!(window.crypto && window.crypto.subtle);
  $('#insecure-warning').hidden = secure;
  $('#reg-code-field').hidden = !S.config.registrationRequiresCode;
  if (!S.config.registrationOpen) $('#to-register').parentElement.hidden = true;
  // The server's privacy policy (PRIVACY_URL) under the terms, when it has one.
  const privacyUrl = typeof S.config.privacyUrl === 'string' && /^https:\/\//i.test(S.config.privacyUrl) ? S.config.privacyUrl : '';
  $('#reg-privacy').hidden = !privacyUrl;
  if (privacyUrl) $('#reg-privacy-link').href = privacyUrl;
  inviteBanner();

  // "I'm not a robot" checks. They start solving as soon as someone starts filling in the form.
  const loginCap = captchaWidget('login');
  const regCap = captchaWidget('register');
  if (!loginForm.querySelector('.captcha')) loginForm.querySelector('.form-error').before(loginCap.el);
  if (!regForm.querySelector('.captcha')) regForm.querySelector('.form-error').before(regCap.el);
  loginForm.addEventListener('focusin', () => loginCap.start());
  regForm.addEventListener('focusin', () => regCap.start());
  // Why this device was signed out, if it was done from somewhere else.
  const why = sessionStorage.getItem('hearth.signedOutWhy');
  if (why) { sessionStorage.removeItem('hearth.signedOutWhy'); loginForm.querySelector('.form-error').textContent = why; }

  $('#to-register').onclick = (e) => { e.preventDefault(); loginForm.hidden = true; regForm.hidden = false; };
  $('#to-login').onclick = (e) => { e.preventDefault(); regForm.hidden = true; loginForm.hidden = false; };

  // Two-factor step: after a right password, the server asks for the app's code (or a backup code).
  const totpField = $('#totp-field');
  let useBackup = false;
  let derived = null; // { who, params, keys } so the slow password step isn't repeated for the 2FA code
  $('#totp-switch').onclick = (e) => {
    e.preventDefault(); useBackup = !useBackup;
    $('#totp-label').textContent = useBackup ? 'Backup code' : 'Two-factor code';
    e.currentTarget.textContent = useBackup ? 'Use the code from my app' : 'Use a backup code instead';
    loginForm.totp.value = ''; loginForm.totp.inputMode = useBackup ? 'text' : 'numeric'; loginForm.totp.focus();
  };
  $('#to-forgot').onclick = (e) => { e.preventDefault(); openForgot(loginForm.username.value.trim()); };
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type=submit]');
    const err = loginForm.querySelector('.form-error');
    err.textContent = '';
    [...loginForm.elements].forEach((x) => x.name && clearInvalid(x));
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      const username = loginForm.username.value.trim();
      const password = loginForm.password.value;
      const who = `${username}\n${password}`;
      if (!derived || derived.who !== who) {
        const params = await api('GET', '/auth/params?username=' + encodeURIComponent(username));
        derived = { who, params, keys: await E2EE.deriveKeys(username, password, params) };
      }
      const { params } = derived;
      const { authKey, wrapKey } = derived.keys;
      const second = !totpField.hidden && loginForm.totp.value.trim() ? (useBackup ? { backupCode: loginForm.totp.value.trim() } : { totp: loginForm.totp.value.trim() }) : {};
      const res = await harderOnce(async () => api('POST', '/auth/login', { username, authKey, captcha: await loginCap.token(), device: deviceNote(username), ...second }).finally(() => loginCap.reset()))
        .catch((ex) => {
          if (ex.code === 'need_2fa' || ex.code === 'bad_2fa') { totpField.hidden = false; setTimeout(() => loginForm.totp.focus(), 30); }
          throw ex;
        });
      saveDeviceNote(username, res.device);
      totpField.hidden = true; loginForm.totp.value = ''; derived = null;
      const priv = await E2EE.unwrapPrivateKey(wrapKey, res.encPrivateKey);
      if (params.kdf !== 'argon2id') {
        // Older account: upgrade password hashing from PBKDF2 to Argon2id. Same password, same keys.
        btn.textContent = 'Upgrading your encryption…';
        setToken(res.token);
        const salt = E2EE.newKdfSalt();
        const next = await E2EE.deriveKeys(username, password, { kdf: 'argon2id', salt });
        const encPrivateKey = await E2EE.rewrapPrivateKey(wrapKey, next.wrapKey, res.encPrivateKey);
        // (With two-factor on, the sign-in's step-up ticket stands in for the code just used.) The session gets a
        // new token with the re-saved password.
        const up = await api('POST', '/me/password', { oldAuthKey: authKey, newAuthKey: next.authKey, encPrivateKey, salt, keepSessions: true, ...(res.stepUpTicket ? { stepUpTicket: res.stepUpTicket } : {}) });
        if (up.token) res.token = up.token;
      }
      await finishLogin(res, priv);
    } catch (ex) {
      err.textContent = ex.message;
      // Point the error at the field it's about, so screen readers read them together.
      const bad = /2fa|code/i.test(ex.code || '') && !totpField.hidden ? loginForm.totp : /captcha/i.test(ex.code || '') ? null : loginForm.password;
      if (bad) markInvalid(bad, err);
    } finally { btn.disabled = false; btn.textContent = 'Log in'; }
  };

  regForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = regForm.querySelector('button[type=submit]');
    const err = regForm.querySelector('.form-error');
    err.textContent = '';
    [...regForm.elements].forEach((x) => x.name && clearInvalid(x));
    const username = regForm.username.value.trim();
    const pw = regForm.password.value;
    const fail = (input, text) => { err.textContent = text; markInvalid(input, err); input.focus(); };
    if (pw.length < 8) return fail(regForm.password, 'Use at least 8 characters for your password.');
    if (pw !== regForm.confirm.value) return fail(regForm.confirm, 'The passwords do not match.');
    btn.disabled = true; btn.textContent = 'Creating your keys…';
    try {
      const kdfSalt = E2EE.newKdfSalt();
      const [{ authKey, wrapKey }, captcha] = await Promise.all([E2EE.deriveKeys(username, pw, { kdf: 'argon2id', salt: kdfSalt }), regCap.token()]);
      const id = await E2EE.createIdentity(wrapKey);
      const body = {
        username, authKey, kdfSalt, publicKey: id.publicKey, encPrivateKey: id.encPrivateKey, code: regForm.code ? regForm.code.value : '',
        acceptTos: regForm.tos && regForm.tos.checked ? S.config.termsVersion || 1 : 0,
      };
      const send = (c) => api('POST', '/auth/register', { captcha: c, ...body }).finally(() => regCap.reset());
      const res = await send(captcha).catch(async (ex) => (ex.code === 'captcha_harder' ? send(await regCap.token()) : Promise.reject(ex)));
      saveDeviceNote(username, res.device);
      await finishLogin(res, id.privateKey);
    } catch (ex) {
      err.textContent = ex.message;
      const bad = /username|name/i.test(ex.message) ? regForm.username : /code/i.test(ex.code || ex.message) && regForm.code && !$('#reg-code-field').hidden ? regForm.code : null;
      if (bad) markInvalid(bad, err);
    } finally { btn.disabled = false; btn.textContent = 'Create account'; }
  };
}

// "Forgot your password?": a reset link goes to the account's verified email.
function openForgot(prefill) {
  const input = h('input', { class: 'input', value: prefill || '', placeholder: 'Username or email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' });
  const cap = captchaWidget('login'); // the same robot check as signing in
  modal({ title: 'Reset your password', size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, 'We\u2019ll email a reset link to the address on your account (if it has a confirmed one).'), field('Username or email', input), cap.el),
    actions: [{ label: 'Cancel' }, { label: 'Send reset link', kind: 'primary', action: async () => {
      if (!input.value.trim()) throw new Error('Enter your username or email.');
      await harderOnce(async () => api('POST', '/auth/forgot', { login: input.value.trim(), captcha: await cap.token() }).finally(() => cap.reset()));
      toast('If that account has a confirmed email, a reset link is on its way. Check your inbox (and spam).');
    } }] });
  cap.start(); // solving starts right away, so it's usually done by the time the name is typed
}
// The link from that email: #reset=<token>. Recovery key → everything stays readable; without → new keys.
async function openReset(token) {
  let info;
  try { info = await api('POST', '/auth/reset/info', { token }); } catch (e) { toast(e.message, 'error'); return; }
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const rec = h('input', { class: 'input mono', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' });
  const noRec = h('input', { type: 'checkbox' });
  const code = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456 (or a backup code)' });
  const recBox = info.hasRecovery ? h('div', { class: 'stack' }, field('Recovery key', rec, 'With it, all your messages stay readable.'),
    h('label', { class: 'row gap tight' }, noRec, h('span', { class: 'field-hint' }, 'I don\u2019t have it: start over with new keys (old direct messages can\u2019t be read any more, and a member has to verify you before you can read your servers and groups again)')))
    : h('p', { class: 'warn-box' }, 'You don\u2019t have a recovery key, so this reset makes you new encryption keys: you\u2019ll get back into all your servers and friends, but your old direct messages can\u2019t be read any more, and someone in your servers or groups has to verify you (compare safety numbers with you) before you can read new messages there. (That\u2019s the price of nobody, not even this server, being able to read them.)');
  modal({ title: `Choose a new password for ${info.username}`, size: 'md', dismissable: true,
    body: h('div', { class: 'stack' }, field('New password', pw), field('Confirm new password', pw2), recBox, info.need2fa ? field('Two-factor code', code, 'From your authenticator app, or one of your backup codes.') : ''),
    actions: [{ label: 'Cancel' }, { label: 'Reset password', kind: 'primary', action: async () => {
      if (pw.value.length < 8) throw new Error('Use at least 8 characters.');
      if (pw.value !== pw2.value) throw new Error('The passwords do not match.');
      const kdfSalt = E2EE.newKdfSalt();
      const next = await E2EE.deriveKeys(info.username, pw.value, { kdf: 'argon2id', salt: kdfSalt });
      const body = { token, authKey: next.authKey, kdfSalt };
      const c = code.value.trim();
      if (info.need2fa) { if (!c) throw new Error('Enter your two-factor code.'); Object.assign(body, /^\d{6}$/.test(c.replace(/\s/g, '')) ? { totp: c } : { backupCode: c }); }
      let privateKey;
      if (info.hasRecovery && !noRec.checked) {
        // Unlock the old key with the recovery key and lock it again with the new password.
        const rk = await E2EE.recoveryWrapKey(rec.value, info.recoverySalt);
        try { body.encPrivateKey = await E2EE.rewrapPrivateKey(rk, next.wrapKey, info.encPrivateKeyRecovery); } catch { throw new Error('That recovery key isn\u2019t right.'); }
        privateKey = await E2EE.unwrapPrivateKey(next.wrapKey, body.encPrivateKey);
        body.keepKeys = true;
        body.keyProof = await E2EE.resetKeyProof(privateKey, info.keyChallenge.serverPublicKey, info.keyChallenge.nonce, info.userId);
      } else {
        const id = await E2EE.createIdentity(next.wrapKey);
        Object.assign(body, { encPrivateKey: id.encPrivateKey, publicKey: id.publicKey });
        privateKey = id.privateKey;
      }
      const res = await api('POST', '/auth/reset', body);
      history.replaceState(null, '', '/');
      toast(body.keepKeys ? 'Password reset. All your messages are still here.'
        : res.user && res.user.keysReset ? 'Password reset with new keys. Ask a member to verify you so you can read your servers and groups again, and add a recovery key in Settings so this can\u2019t happen again.'
          : 'Password reset with new keys. Add a recovery key in Settings so this can\u2019t happen again.');
      await finishLogin(res, privateKey);
    } }] });
}

async function finishLogin(res, privateKey) {
  // Whose sign-in this browser holds goes first: another tab still signed in as someone else sees the new token only
  // after it, and so never takes it for its own (api.js sameOwner).
  localStorage.setItem('hearth.userId', res.user.id);
  setToken(res.token);
  await E2EE.storeKey(res.user.id, privateKey);
  S.privateKey = privateKey;
  startApp(res.user.id);
}

// Signing out runs once: the server answers our own "Log out" by also telling this device its sign-in ended
// ('session:revoked', see watchConnection), which must not start a second sign-out or explain it as one done
// from somewhere else.
let loggingOut = null;
function logout() {
  if (!loggingOut) loggingOut = signOutHere();
  return loggingOut;
}
async function signOutHere() {
  // This browser stops getting notifications for the account (the server drops the subscription too), and
  // doesn't pass them on to whoever signs in here next. In the Android app the phone's push registration goes
  // too. Never holds up signing out for more than a moment.
  if (androidApp.push || (localStorage.getItem('hearth.push') === 'on' && 'serviceWorker' in navigator)) await Promise.race([disablePush({ signOut: true }).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  try { await api('POST', '/auth/logout'); } catch { /* ignore */ }
  if (voice) await voice.leave().catch(() => {});
  setToken('');
  localStorage.removeItem('hearth.userId');
  fileUrls.release(); // decrypted files in memory
  LOOK.reset(); // and chat backgrounds' pictures
  clearAllDrafts(); // unsent words stay with the account, not the next person on this browser
  // So do the inbox and reminders, which keep copies of messages' words (disappearing ones too): nothing here would
  // drop them at their deadline once no one is signed in. (addInbox writes nothing more while signing out; this
  // runs again last, in case anything else did.)
  clearLocalCopies();
  SCHED.reset();
  MEDIA.reset({ all: true });
  SIDE.reset({ all: true }); // (its list in this browser went with the local copies above)
  sec.reset();
  copies.clear();
  originals.clear();
  await E2EE.clearKeys();
  clearLocalCopies();
  lsCache.clear();
  location.href = '/';
}

// The first start-up was refused (another account, or keys that aren't yours): the loading screen says why, for good,
// with a way out.
function showStartRefused(text) {
  const box = $('#app .app-loader');
  if (!box) return;
  clear(box).append(h('p', { class: 'muted-p', role: 'alert', style: { maxWidth: '34em', textAlign: 'center', padding: '0 16px' } }, text),
    h('button', { class: 'btn', onclick: () => logout() }, 'Sign out'));
}

// ======================================================================= realtime
// The account this tab started as: the one whose private key it unlocked (signing in here, or the one stored for this
// browser when the page opened). Every start-up must be for it (loadBootstrap). Never read again from storage, which
// every tab of this browser shares: another tab signing in as someone else changes that, not which account this is.
let signedInAs = null;
function startApp(account) {
  signedInAs = account;
  // Desktop app: Ctrl+, (and the tray's "Settings…") open Settings.
  if (window.hearthDesktop && typeof window.hearthDesktop.onOpenSettings === 'function' && !window.__hearthSettingsHook) {
    window.__hearthSettingsHook = true;
    window.hearthDesktop.onOpenSettings(() => { if (!document.querySelector('.settings-modal, .set-nav')) openSettings(app); });
  }
  initActivity({
    mediaToken: () => S.mediaToken || '',
    changed: (a) => { if (!S.me) return; S.me.activity = a; if (S.users[S.me.id]) S.users[S.me.id].activity = a; renderUserPanel(); },
  });
  initFeatures({
    S, getUser, displayName, avatarEl, playSound, addInbox, nowServer,
    jump: (key, id) => jumpToMessage(key, id),
    canManage: (server) => isAdmin(server) || can(server, PERMS.MANAGE_SERVER),
    openChannelOrVoice: (c, server) => (c.type === 'voice' ? joinVoice(c, server) : openChannel(c.id, server.id)),
    onEventsChanged: (serverId) => { if (S.view.serverId === serverId) later(renderSidebar); if (S.view.type === 'home') later(renderMain); },
    // tag and msgId: one with a message's words (a reminder) closes when that message disappears (forgetCopies).
    notify: ({ title, body, tag = null, msgId = null }) => {
      if (!('Notification' in window) || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
      try {
        const n = new Notification(title, { body, icon: '/icons/icon-192.png', ...(tag ? { tag } : {}) });
        if (tag) rememberNotification(tag, n, msgId);
      } catch { /* ignore */ }
    },
  });
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#app').classList.add('loading');
  setTokenOwner(account);
  // Asked for the token on every (re)connect, so a token that changed meanwhile is the one used.
  socket = io({ auth: (cb) => { socketToken = getToken(); cb({ token: socketToken }); }, transports: ['websocket', 'polling'] });
  // Tells the server when this app goes unused (and comes back), for automatic Away. Until the account has
  // loaded there's no setting yet, and while the status isn't Online it can't change anything: nothing is sent.
  // Being in a call counts as using Hearth (talking, or watching a shared screen without touching anything).
  // (A connection made again with a new sign-in token starts out "in use" on the server like any new one, and
  // presence.js reports again on 'connect', so the person shows as Away again once this app is idle.)
  away = initAway({
    socket,
    minutes: () => (S.me && S.me.status === 'online' && Number.isFinite(S.me.awayAfter) ? S.me.awayAfter : 0),
    busy: () => !!(voice && voice.channelId),
  });
  // Keybinds (push-to-talk, mute, deafen) and the desktop app's extras. Global keys in the desktop app.
  if (!S.keybindsOn) {
    S.keybindsOn = true;
    initKeybinds({
      onPtt: (isDown) => { if (voice && voice.channelId) voice.setPtt(isDown); else if (voice) voice.pttHeld = false; },
      onMute: () => toggleMute(),
      onDeafen: () => toggleDeafen(),
      reconnect: () => { if (socket && !socket.connected) socket.connect(); },
      showUpdate: (version) => showAppUpdate(version),
    }).catch(() => {});
  }
  androidApp.onHangUp = () => { if (voice && voice.channelId) { voice.leave(); playSound('selfLeave'); } };
  // A conversation read here (or on another device) also clears the notification the Android app posted for it
  // while it was closed (same tag).
  if (androidApp.cancel) alsoCloseNotifications(androidApp.cancel);
  voice = new Voice({
    // The call's soundboard lane carries our sounds; someone else's lights up their tile while one plays.
    boardTrack: () => board.track(),
    // Remembered, so tiles and avatars drawn again while it plays (someone joins, a camera turns on) still glow.
    onBoard: (id, on) => {
      if (on) S.boardPlaying.add(id); else S.boardPlaying.delete(id);
      $$(`[data-speak="${id}"]`).forEach((el) => el.classList.toggle('board-playing', on));
    },
    // Lets the speaking detector ignore people whose mic is off (their state comes from the server).
    isPeerMuted: (userId) => { const st = voice && (S.voice[voice.channelId] || []).find((x) => x.userId === userId); return !!(st && (st.muted || st.deafened)); },
    socket,
    // automatic: the call's region relay didn't answer, so this app falls back to the nearest relays (voice.js).
    // avoid: the connection is with someone who avoids member relays, so it's built without them too.
    getIceServers: ({ automatic = false, avoid = false } = {}) => {
      const room = voice && voice.channelId;
      const pinned = room && !automatic ? callRegion(room) : null;
      // Pinned to a region that's offline right now: automatic relays are used instead. Say so, once per call.
      if (pinned && !callRegions().some((r) => r.id === pinned) && !S.regionWarned.has(room)) {
        S.regionWarned.add(room);
        setTimeout(() => toast(`This call\u2019s region (${regionName(pinned)}) is offline, so your connection uses automatic relays.`), 0);
      }
      return chooseIce(S.iceServers || S.config.iceServers || [], S.relayRanks, pinned, { avoid: avoidsMemberRelays(S.me) || avoid });
    },
    // Avoiding member relays (Settings → Privacy & safety): the other side's candidates on their machines are dropped,
    // and the others in the call are told, so their connections with us leave member relays out too.
    avoidHosts: () => (avoidsMemberRelays(S.me) ? memberRelayHosts(S.iceServers || S.config.iceServers || []) : new Set()),
    avoids: () => avoidsMemberRelays(S.me),
    // Where the member relays in this app's list are (so it knows which relays a connection is set up with are members').
    memberRelayHosts: () => memberRelayHosts(S.iceServers || S.config.iceServers || []),
    myId: () => S.me && S.me.id,
    onNotice: (text, kind) => toast(text, kind),
    onRegion: (room, region, version) => applyCallRegion({ room, region, version }),
    // A moderator moved us to another voice channel: join it (and follow it on screen if we were looking at the call).
    onMoved: (to) => {
      const c = channelById(to); const srv = c && serverOfChannel(to);
      if (!c || !srv) { toast('A moderator moved you out of the call.'); return; }
      toast(`A moderator moved you to ${c.name}.`);
      joinVoice(c, srv, { stay: S.view.type !== 'voice' });
    },
    ensureIce: () => iceBeforeCall(),
    signSdp: (toUserId, desc) => sec.signSdp(voice.channelId, toUserId, desc),
    verifySdp: (fromUserId, desc, sig) => sec.checkSdp(voice.channelId, fromUserId, desc, sig),
    mayConnect: (room, userId) => sec.mayCall(room, userId), // a 1-to-1 call: only the person the DM is with
    onSecurityWarning: (userId, why) => callWarning(userId, why),
    onChange: () => {
      if (!voice.channelId) S.regionWarned.clear();
      shareChanged(); renderVoicePanel(); renderUserPanel(); renderCallStages(); syncWatchDock(); renderSidebarVoiceUsers();
      if (S.view.type === 'channel' || S.view.type === 'dm' || S.view.type === 'voice') renderHeader();
      reportCall({ inCall: !!voice.channelId, muted: voice.muted, deafened: voice.deafened });
      syncCallNotification();
    },
    onSpeaking: (id, on) => {
      const uid = id === 'me' ? S.me.id : id;
      // Never show someone as speaking while they're muted or deafened, whatever audio arrives.
      if (on) { const st = (S.voice[voice.channelId] || []).find((x) => x.userId === uid); if (st && (st.muted || st.deafened)) on = false; }
      if (on) S.speaking.add(uid); else S.speaking.delete(uid);
      $$(`[data-speak="${uid}"]`).forEach((el) => el.classList.toggle('speaking', on));
    },
  });

  // Test and support hook, off unless turned on on this device: the call engine, for the voice test harness.
  try {
    if (localStorage.getItem('hearth.voiceDebug') === '1') {
      window.__hearthVoice = voice;
      window.__hearthCallRegion = (room) => { const t = room.startsWith('dm:') ? S.dms.find((x) => x.id === room.slice(3)) : channelById(room); return t ? { region: t.region || null, version: t.regionVersion || 0 } : null; };
    }
  } catch { /* storage off */ }

  socket.on('connect', async () => {
    const used = getToken();
    try {
      // Back after a restart: same version → carry on; new version → switch to it.
      if (S.restarting || S.config.version) {
        const cfg = await api('GET', '/config').catch(() => null);
        if (cfg && cfg.version && S.config.version && cfg.version !== S.config.version) return onNewVersion(cfg.version);
      }
      await loadBootstrap();
      if (voice.channelId && S.voice[voice.channelId]) voice.setListed(S.voice[voice.channelId].map((u) => u.userId));
      hideUpdating();
      $('#app').classList.remove('loading');
      $('#conn-banner').hidden = true;
    } catch (e) {
      // Turned away: unless another tab of this browser has just stored a newer token for this sign-in (then the
      // connection is made again with it, above), this device was signed out.
      if (e.status === 401) { if (await tokenMovedFrom(used, 5000)) return; return logout(); }
      // A start-up for another account, or with keys that aren't yours: none of it was used (loadBootstrap). Until
      // one has checked out there's nothing to carry on with, so the app stops there with the reason on screen; after
      // that it carries on with what it had proven.
      if (e.code === 'own_key_mismatch' && !S.me) showStartRefused(e.message);
      toast(e.message, 'error');
    }
  });
  socket.on('connect_error', (e) => {
    if (e.message === 'maintenance') { api('GET', '/config').then((c) => showUpdating('Down for maintenance', c.maintenance || 'Back soon.')).catch(() => {}); return; }
    if (e.message !== 'unauthorized' && !S.restarting) $('#conn-banner').hidden = false; // 'unauthorized': signed out (below)
  });
  // Signed out from somewhere else (Settings → Sessions, a password change or reset, staff), or this device isn't
  // let back in. Any other connection the server closes (too many events at once, say) just reconnects.
  watchConnection(socket, {
    paused: () => !!S.restarting, // expected: the server is restarting for an update
    tokenMoved: (ms) => tokenMovedFrom(socketToken, ms), // a new token for this sign-in (conn.js)
    onDown: () => { $('#conn-banner').hidden = false; },
    onSignedOut: (reason) => {
      if (loggingOut) return; // already signing out (this device's own "Log out", say): nothing more to explain
      const why = {
        password_changed: 'Your password was changed', password_reset: 'Your password was reset', '2fa_enabled': 'Two-factor sign-in was turned on',
        expired: 'Your sign-in expired', account_deleted: 'This account was deleted', suspended: 'This account was suspended', staff: 'A server admin signed you out',
        // This device's sign-in token was replaced (a password change, two-factor turned on, or "Log out all other
        // devices" with the password), and this device never got the new one: it only had a copy, say.
        token_rotated: 'This sign-in was renewed on another device',
      }[reason];
      // 'logged_out' is this sign-in's own "Log out", pressed in another tab of this browser: nothing to explain.
      if (reason !== 'unauthorized' && reason !== 'logged_out') sessionStorage.setItem('hearth.signedOutWhy', `${why || 'This device was signed out'}. Sign in again.`);
      logout();
    },
  });
  socket.on('server:restarting', () => showUpdating());
  socket.on('server:maintenance', ({ text }) => showUpdating('Down for maintenance', text || 'Back soon.'));

  // Someone came online, went offline or changed status: just update their dots and lists.
  socket.on('user:presence', (list) => {
    if (!S.me) return;
    let changed = false;
    for (const { id, presence } of Array.isArray(list) ? list : [list]) {
      if (!S.users[id] || id === S.me.id || S.users[id].presence === presence) continue;
      changed = true;
      S.users[id] = { ...S.users[id], presence };
      $$(`[data-user-av="${id}"][data-status="1"] .status-dot`).forEach((d) => {
        d.className = d.className.replace(/\bst-\S+/, `st-${presence}`);
        d.title = STATUS_LABEL[presence] || '';
        d.setAttribute('aria-label', STATUS_LABEL[presence] || '');
      });
      showPresenceText(id);
    }
    if (!changed) return;
    later(redrawPeople);
  });
  // Someone started or stopped a game or a song.
  socket.on('user:activity', (list) => {
    if (!S.me) return;
    for (const { id, activity } of Array.isArray(list) ? list : []) {
      if (!S.users[id]) continue;
      S.users[id] = { ...S.users[id], activity: activity || null };
      if (id === S.me.id) { S.me.activity = activity || null; renderUserPanel(); }
    }
    later(redrawPeople);
    if (S.view.type === 'people' && S.view.tab !== 'add') later(renderMain);
  });
  // A member's call relay came into calls or left them (server/regions.js iceChanged).
  socket.on('ice:changed', () => iceChanged());
  socket.on('user:update', (u) => {
    if (!S.me) return;
    // Only your own Away for being inactive (or back): just the dots and the line under your name. Nothing is
    // rebuilt, so a call stays as it is (full screen too), and a button being pressed or focused stays put. (The
    // server folders stay as this app has them: presence.js onlyPresenceChanged says why.)
    if (onlyPresenceChanged(S.me, u)) { setUser({ ...u, rail: S.me.rail }); showMyPresence(); return; }
    const roleBefore = S.me.staffRole;
    const outsideBefore = outsideMode(S.me.privacy);
    const wasWaiting = sec.awaitingVerify(S.users[u.id]) || (u.id === S.me.id && sec.awaitingVerify(S.me));
    const keysNow = () => { const x = S.users[u.id]; return x ? `${x.publicKey || ''}|${x.signPublicKey || ''}` : ''; };
    const keysBefore = keysNow();
    setUser(u); sec.trust(u); refreshUserBits(u.id);
    if (keysNow() !== keysBefore) { NOTES.onTrust(u.id); LOOK.onTrust(u.id); } // photo tags and backgrounds that didn't open with the keys known before
    // Outside images changed on another device: the image links on screen follow the new choice.
    if (u.id === S.me.id && outsideMode(S.me.privacy) !== outsideBefore) later(redrawImageLinks);
    // So do call relays, when avoiding member relays was turned on or off.
    if (u.id === S.me.id) followRelayChoice();
    // Verified after a reset without their recovery key (crypto-2): their servers' keys can go to them now.
    if (wasWaiting && !sec.awaitingVerify(S.users[u.id])) {
      S.servers.filter((s) => s.memberIds.includes(u.id)).forEach((s) => sec.maintain(s.id));
      if (u.id === S.me.id) toast('You’re verified: members’ apps are sharing the keys to your servers and groups with you again.');
    }
    if (wasWaiting !== sec.awaitingVerify(S.users[u.id]) && (S.view.type === 'dm' || S.view.serverId)) {
      if (S.panel === 'members') later(renderPanel);
      later(renderHeader); if (composers.main) composers.main.renderExtras();
    }
    // Given or lost a staff role: show or hide the admin dashboard right away.
    if (u.id === S.me.id && 'staffRole' in u && (u.staffRole || null) !== (roleBefore || null)) {
      if (S.view.type === 'admin' && !u.staffRole) setView({ type: 'home' }); else app.rerender();
      toast(u.staffRole ? `You\u2019re now ${({ owner: 'the owner', admin: 'an admin', moderator: 'a moderator' })[u.staffRole]} on this server.` : 'You\u2019re no longer on the staff team.');
    }
  });
  socket.on('membership:update', ({ serverId, membership: m }) => {
    const sv = S.servers.find((x) => x.id === serverId);
    const where = sv ? sv.name : 'the server';
    if (m.status === 'active' && !m.cancelAtEnd && Date.now() - m.since < 10 * 60000) { toast(`\u2B50 You\u2019re a member of ${where}. Thank you!`); playSound('mention'); }
    else if (m.status === 'past_due' && !noPayments) toast(`Your membership payment for ${where} didn\u2019t go through. Stripe will try again; check your card.`, 'error');
    else if (m.status === 'ended') toast(`Your membership of ${where} has ended.`);
  });
  socket.on('support:thanks', ({ until, forever }) => {
    toast(forever ? '\uD83D\uDC9C Thank you for your support!' : `\uD83D\uDC9C Thank you! You\u2019re a supporter until ${new Date(until).toLocaleDateString()}.`);
    playSound('mention');
  });
  socket.on('keys:state', (st) => { if (S.me) sec.applyState(st); });
  socket.on('call:ring', (p) => onRing(p));
  socket.on('call:end', ({ room }) => stopRinging(room));
  socket.on('call:declined', ({ room, userId }) => {
    toast(`${displayName(getUser(userId))} declined the call.`);
    // In a 1-to-1 call nobody else is coming, so hang up.
    if (room.startsWith('dm:') && voice.channelId === room && (S.voice[room] || []).length <= 1) { voice.leave(); playSound('selfLeave'); }
  });
  // Server settings → Audit log and Reports follow along live; a new report for a server you moderate says so.
  initServerAudit(socket, { instanceName: () => S.config.name, onFreshReport: ({ serverId, category }) => {
    const sv = S.servers.find((x) => x.id === serverId);
    if (sv) toast(`New report in ${sv.name}: ${CATEGORY_LABEL[category] || category}. Open Server settings \u2192 Reports.`);
  } });
  socket.on('admin:report', ({ category }) => {
    S.adminReports = (S.adminReports || 0) + 1;
    renderRail();
    toast(`New report: ${CATEGORY_LABEL[category] || category}. Open Admin → Reports.`);
    playSound('mention');
    if (S.view.type === 'admin' && S.view.tab === 'reports') renderMain();
  });
  // Only the Health page's own content is redrawn (a new admin view would jump back to the top and drop focus, for
  // whoever pressed the button and for every other admin looking at Health).
  const refreshHealth = () => { if (S.view.type === 'admin' && S.adminEl && S.adminEl._refreshHealth) S.adminEl._refreshHealth(); };
  // Problems the server found (failed backup, a relay down, low disk...): staff see them as they happen.
  socket.on('admin:alert', ({ title, severity }) => {
    toast(`${severity === 'critical' ? 'Urgent: ' : ''}${title}. Open Admin \u2192 Health.`, severity === 'critical' ? 'error' : undefined);
    refreshHealth();
  });
  // Another admin added, changed, tested or removed an alert channel: the Health tab shows it at once.
  socket.on('admin:alert-channels', refreshHealth);
  socket.on('profile:comment', ({ from }) => toast(`${displayName(getUser(from))} commented on your profile.`));
  // The owner published an update note: it shows now, or as soon as the person isn't in the middle of something.
  socket.on('update-notes', () => showUpdateNotes());
  socket.on('config:update', (c) => {
    Object.assign(S.config, c);
    if ('name' in c || 'tagline' in c) { document.title = S.config.name; $$('[data-instance-name]').forEach((el) => { el.textContent = S.config.name; }); }
    if (!noPayments && 'funding' in c && S.view.type === 'home') later(renderMain); // the funding card on Home (none in the app)
    if ('announcement' in c) renderAnnouncement();
    if (c.termsVersion) askToAcceptTerms();
    if (composers.main) composers.main.renderExtras();
    if (S.view.type === 'channel' || S.view.type === 'dm') renderMain();
  });
  socket.on('relationship:update', ({ relationship, user }) => {
    if (!S.me) return;
    if (user) setUser(user);
    if (relationship.removed) delete S.relationships[relationship.userId];
    else {
      const prev = S.relationships[relationship.userId];
      S.relationships[relationship.userId] = relationship;
      if (relationship.direction === 'incoming' && !prev) {
        playSound('friend');
        addInbox({ type: 'friend', userId: user.id, title: `${displayName(user)} sent you a friend request`, text: 'Open Friends to accept or ignore it.' });
      }
      if (relationship.direction === 'mutual' && prev && prev.direction === 'outgoing') {
        playSound('friend');
        addInbox({ type: 'friend', userId: user.id, title: `${displayName(user)} accepted your friend request`, text: '' });
      }
    }
    renderRail();
    if (!S.view.serverId) renderSidebar();
    if (['friends', 'home'].includes(S.view.type) && S.view.tab !== 'add') renderMain();
  });
  socket.on('server:add', ({ server, users, voice: vs, keyState }) => {
    if (!S.me) return;
    Object.values(users || {}).forEach(setUser);
    Object.values(users || {}).forEach((u) => sec.trust(u));
    Object.assign(S.voice, vs || {});
    if (!S.servers.find((s) => s.id === server.id)) S.servers.push(server);
    if (keyState) sec.applyState(keyState);
    // Added to a group chat that has a background (chat-look.js): it opens once the group's key is here.
    if (isGroup(server) && server.look !== undefined) LOOK.onEvent('group:look', { serverId: server.id, look: server.look });
    // A group chat's line in the conversation list, from the copy the list draws (drawn again once decrypted).
    if (isGroup(server)) previewGroup(S.servers.find((s) => s.id === server.id)).then(redrawConvList);
    renderRail();
    if (!S.view.serverId) renderSidebar();
  });
  socket.on('rail:update', ({ rail }) => folders.applyRemote(rail));
  // Read markers, notification preferences and saved messages changed on another of your devices.
  socket.on('read:update', (st) => onReadUpdate(st));
  socket.on('notify:update', (r) => applyNotifyPref(r));
  socket.on('notify:settings', (st) => { S.notifySettings = st; syncCallNotification(); });
  socket.on('scheduled:update', (it) => { if (S.me) SCHED.onUpdate(it); });
  socket.on('scheduled:remove', (p) => SCHED.onRemove(p));
  socket.on('saved:update', (p) => { if (p.saved) S.savedIds.add(p.messageId); else S.savedIds.delete(p.messageId); if (S.view.type === 'saved') later(renderMain); });
  socket.on('timeout:update', ({ serverId, until }) => {
    const sv = S.servers.find((x) => x.id === serverId);
    if (!sv) return;
    toast(until ? `You\u2019re timed out in ${sv.name} until ${fmtStamp(until)}. You can still read.` : `Your timeout in ${sv.name} is over.`);
  });
  socket.on('study:changed', (p) => { if (S.me.studyEnabled) study.onRemoteChange(p); });
  socket.on('soundboard:changed', () => { board.load(true).catch(() => {}); });
  socket.on('study:enabled', ({ enabled }) => { S.me.studyEnabled = enabled; if (!S.view.serverId) renderSidebar(); });
  socket.on('updates:new', (p) => { updates.onNew(p); if (S.view.type === 'updates') renderMain(); });
  socket.on('server:update', (server) => {
    const i = S.servers.findIndex((s) => s.id === server.id);
    if (i >= 0) S.servers[i] = server;
    // A group chat carries its chat background (chat-look.js keeps only a newer one than it has).
    if (isGroup(server) && server.look !== undefined) LOOK.onEvent('group:look', { serverId: server.id, look: server.look });
    const w = serverWaiters.get(server.id);
    if (w) { serverWaiters.delete(server.id); setTimeout(w, 0); }
    // A group chat comes with its newest message (deleting a channel can change it): its line in the conversation
    // list is drawn again once decrypted.
    if (isGroup(server)) previewGroup(server).then(redrawConvList);
    renderRail();
    if (S.view.serverId === server.id) {
      applyServerTheme();
      // Lost access to the channel you're in (permissions changed)? Go somewhere you can see.
      if (S.view.channelId && !server.channels.some((c) => c.id === S.view.channelId)) { toast('You no longer have access to that channel.'); return openServer(server.id); }
      renderSidebar(); renderHeader(); renderPanel();
      if (composers.main) composers.main.renderExtras();
      refreshWelcomeRoles(server);
      refreshInviteNudge(server);
    }
    else if (server.kind === 'group' && !S.view.serverId) renderSidebar();
  });
  socket.on('server:remove', ({ serverId }) => {
    const was = S.servers.find((s) => s.id === serverId);
    S.servers = S.servers.filter((s) => s.id !== serverId);
    // Live updates stop while you're out, so what's loaded would be missing anything said meanwhile if you come
    // back: load it fresh then.
    if (was) {
      const gone = new Set(was.channels.map((c) => c.id));
      gone.forEach((id) => { delete S.msgs['c:' + id]; S.threadMentions.delete('c:' + id); });
      Object.entries(S.threads).forEach(([id, t]) => { if (t.root && gone.has(t.root.channelId)) delete S.threads[id]; });
      Object.entries(S.threadState).forEach(([id, t]) => { if (gone.has(t.channelId)) delete S.threadState[id]; });
      updateTitle();
    }
    if (S.view.serverId === serverId) { toast(was && was.kind === 'group' ? 'You left the group.' : 'You are no longer in that server.'); goHome(); }
    else { renderRail(); if (!S.view.serverId) renderSidebar(); }
  });
  socket.on('member:add', ({ serverId, user }) => {
    setUser(user);
    sec.trust(user);
    const s = S.servers.find((x) => x.id === serverId);
    if (s && !s.memberIds.includes(user.id)) s.memberIds.push(user.id);
    // Someone joining (or coming back) has no roles yet: any the server hands out follow in a server update.
    if (s && s.memberRoles) s.memberRoles[user.id] = [];
    if (S.view.serverId === serverId) { renderPanel(); renderHeader(); refreshInviteNudge(s); }
  });
  socket.on('member:remove', ({ serverId, userId }) => {
    const s = S.servers.find((x) => x.id === serverId);
    if (s) {
      s.memberIds = s.memberIds.filter((i) => i !== userId);
      // The server deleted their roles and their own channel permissions. Copies kept here would be sent back if
      // they rejoin: the role menu sends the roles someone has plus the new one, and saving a channel's
      // permissions sends all of its overrides.
      if (s.memberRoles) delete s.memberRoles[userId];
      if (s.nicknames) delete s.nicknames[userId];
      s.channels.forEach((c) => { if (c.overrides) c.overrides = c.overrides.filter((o) => !(o.type === 'member' && o.id === userId)); });
    }
    if (S.view.serverId === serverId) { renderPanel(); renderHeader(); refreshInviteNudge(s); }
  });
  // A nickname set, changed or removed in one of your servers (server/nicknames.js).
  socket.on('member:nick', ({ serverId, userId, nickname } = {}) => applyNick(serverId, userId, typeof nickname === 'string' ? nickname : null));
  WF.listen(socket); // your word filter saved on another device, a server's suggested list changed
  PN.listen(socket); // your nicknames for people, changed on another device
  socket.on('channel:create', (ch) => {
    const s = S.servers.find((x) => x.id === ch.serverId);
    if (s && !s.channels.find((c) => c.id === ch.id)) s.channels.push(ch);
    if (S.view.serverId === ch.serverId) renderSidebar();
  });
  socket.on('call:region', (p) => onCallRegion(p));
  socket.on('channel:update', (ch) => {
    const s = S.servers.find((x) => x.id === ch.serverId);
    if (!s) return;
    const i = s.channels.findIndex((c) => c.id === ch.id);
    if (i >= 0) s.channels[i] = ch;
    if (S.view.serverId === ch.serverId) { renderSidebar(); renderHeader(); }
  });
  socket.on('channel:delete', ({ id, serverId }) => {
    const s = S.servers.find((x) => x.id === serverId);
    if (s) s.channels = s.channels.filter((c) => c.id !== id);
    delete S.msgs['c:' + id];
    if (S.threadMentions.delete('c:' + id)) updateTitle();
    if (S.view.channelId === id) openServer(serverId);
    else if (S.view.serverId === serverId) renderSidebar();
  });

  socket.on('message:new', (m) => { if (!S.me) return; if (m.threadId) onThreadMessage(m); else onNewMessage('c:' + m.channelId, m); });
  socket.on('message:update', (m) => { if (m.threadId) onThreadUpdate(m); else onUpdateMessage('c:' + m.channelId, m); });
  // Deletes in a group chat carry its newest message now (last) and its time (lastMessageAt), for its line in the
  // conversation list.
  socket.on('message:delete', ({ id, channelId, threadId, last, lastMessageAt }) => { onDeleteChannelMessages(channelId, [{ id, threadId }]); groupLastIs(channelId, last, lastMessageAt); });
  // Bulk delete and a ban's cleanup: many at once, one redraw. Disappearing messages that reached their time come
  // the same way (expired: true).
  socket.on('message:delete-bulk', ({ channelId, messages, expired, last, lastMessageAt } = {}) => {
    if (Array.isArray(messages)) onDeleteChannelMessages(channelId, messages, { expired: !!expired });
    groupLastIs(channelId, last, lastMessageAt);
  });
  socket.on('disappear:update', (p) => onDisappearUpdate(p));
  // Chat backgrounds (chat-look.js): a DM's or group chat's background changed, with its line in the conversation.
  socket.on('dm:look', (p) => onLookEvent('dm:look', p));
  socket.on('group:look', (p) => onLookEvent('group:look', p));
  socket.on('thread:update', ({ rootId, channelId, threadCount, threadLastAt }) => {
    const store = S.msgs['c:' + channelId];
    const m = store && store.list.find((x) => x.id === rootId);
    if (m) { m.threadCount = threadCount || 0; m.threadLastAt = threadLastAt; if (currentKey() === 'c:' + channelId) replaceMessageEl(m); }
    onThreadCount(rootId, channelId, threadCount || 0, threadLastAt);
  });
  socket.on('bot:interaction', (x) => SLASH.onInteraction(x));
  socket.on('webhooks:update', (x) => onWebhooksUpdate(x));
  socket.on('reaction:update', (p) => {
    const key = p.channelId ? 'c:' + p.channelId : 'd:' + p.dmId;
    const store = S.msgs[key];
    const m = (store && store.list.find((x) => x.id === p.messageId)) || findThreadMessage(p.messageId);
    if (m) { m.reactions = p.reactions; replaceMessageEl(m); }
  });
  // Photo comments and tags (photo-notes.js): a message's tags (its whole list), or how many comments each of its photos
  // has. Its loaded copies take them, and only what shows them is drawn again (the counts on its pictures, an open
  // viewer's side panel, the Photos & videos panel): never the whole message, which would load its pictures again.
  socket.on('dm:tags', (p) => { if (S.me && p) NOTES.onTags('d:' + p.dmId, p.id, p.tags); });
  socket.on('message:tags', (p) => { if (S.me && p) NOTES.onTags('c:' + p.channelId, p.id, p.tags); });
  socket.on('dm:file-replies', (p) => { if (S.me && p) NOTES.onFileReplies('d:' + p.dmId, p.id, p.fileReplies); });
  socket.on('message:file-replies', (p) => { if (S.me && p) NOTES.onFileReplies('c:' + p.channelId, p.id, p.fileReplies); });
  // Back after the connection dropped: what came live before is no longer the latest word.
  socket.on('connect', () => NOTES.reconnected());
  socket.on('pin:update', (p) => {
    const key = p.channelId ? 'c:' + p.channelId : 'd:' + p.dmId;
    const store = S.msgs[key];
    const m = (store && store.list.find((x) => x.id === p.messageId)) || findThreadMessage(p.messageId);
    if (m) { m.pinnedAt = p.pinnedAt; replaceMessageEl(m); }
    if (S.panel === 'pins' && currentKey() === key) renderPanel();
  });
  socket.on('dm:message', async ({ dm, message, user }) => {
    if (!S.me || !dm || !message) return;
    // Opened as a message of the conversation it's shown in, never of the one the server labels it with: the
    // conversation is bound into every DM (e2ee.js), and only opening it with this one's id checks that.
    message.dmId = dm.id;
    if (user) setUser(user);
    const i = S.dms.findIndex((d) => d.id === dm.id);
    if (i >= 0) S.dms.splice(i, 1);
    S.dms.unshift(dm);
    if (dm.look !== undefined) LOOK.onEvent('dm:look', { dmId: dm.id, look: dm.look }); // (a new DM's chat background)
    await onNewMessage('d:' + dm.id, message);
    if (!S.view.serverId) renderSidebar();
  });
  socket.on('dm:update', (m) => onUpdateMessage('d:' + m.dmId, m));
  // With the DM's newest message now (last), for its line in the conversation list.
  socket.on('dm:delete', ({ id, dmId, expired, last }) => {
    onDeleteMessage('d:' + dmId, id, { expired: !!expired });
    const d = last !== undefined && S.dms.find((x) => x.id === dmId);
    if (d) setLast(d, last);
  });
  // Kept for every conversation, open or not: the lists show it too, and it's there when you open one.
  socket.on('typing', (p) => {
    if (!S.me || !p || p.userId === S.me.id) return; // (yourself on another device)
    TYPING.start(p.channelId ? 'c:' + p.channelId : 'd:' + p.dmId, p.userId);
  });
  socket.on('poll:update', (st) => onPollUpdate(st));
  socket.on('events:update', (p) => onEventsUpdate(p));
  socket.on('event:starting', (e) => onEventStarting(e));
  socket.on('watch:state', ({ room, state }) => {
    if (!S.me) return;
    if (!voice || voice.channelId !== room) return;
    S.watch[room] = state;
    watchPlayer(room, watchCtx(room)).apply(state);
    if (state) wtDock.hidden = false; // a new video shows up even if you hid the last one
    renderCallStages();
    syncWatchDock();
  });
  socket.on('voice:state', ({ channelId, users }) => {
    if (!S.me) return;
    const before = (S.voice[channelId] || []).map((u) => u.userId);
    if (channelId.startsWith('dm:') && voice.channelId === channelId) {
      const had = (S.voice[channelId] || []).some((u) => u.userId !== S.me.id);
      const has = users.some((u) => u.userId !== S.me.id);
      // (Still connected to them: the server may just have restarted, and they'll be back in a moment.)
      if (had && !has) { setTimeout(() => { if (voice.channelId === channelId && !(S.voice[channelId] || []).some((u) => u.userId !== S.me.id) && !voice.peers.size) { voice.leave(); playSound('selfLeave'); toast('Call ended.'); } }, 1500); }
    }
    S.voice[channelId] = users;
    if (voice.channelId === channelId) voice.setListed(users.map((u) => u.userId));
    users.filter((u) => u.muted || u.deafened).forEach((u) => { if (S.speaking.delete(u.userId)) $$(`[data-speak="${u.userId}"]`).forEach((el) => el.classList.remove('speaking')); });
    if (voice.channelId === channelId) {
      const after = users.map((u) => u.userId);
      if (after.some((id) => !before.includes(id) && id !== S.me.id)) playSound('userJoin');
      if (before.some((id) => !after.includes(id) && id !== S.me.id)) playSound('userLeave');
    }
    renderSidebarVoiceUsers();
    // A call started or ended in the conversation you're looking at: show/hide its call area.
    const here = S.view.type === 'dm' ? dmRoom(S.view.dmId) : S.view.type === 'channel' ? callRoomFor(currentServer()) : S.view.type === 'voice' ? S.view.channelId : null;
    if (here === channelId) {
      const shown = !!$('.chat > .call-stage, .voice-room .call-stage');
      if (shown !== (users.length > 0) && S.view.type !== 'voice') renderMain(); else renderCallStages();
      renderHeader();
    } else renderCallStages();
    if (S.view.serverId) { const s = currentServer(); if (s && s.kind === 'group') renderHeader(); }
  });

  window.addEventListener('focus', () => { purgeExpired(); markRead(currentKey()); });
  // Hidden tabs check their timers only now and then: catch up on disappearing messages as soon as they're back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) purgeExpired(); });
  window.addEventListener('pagehide', () => { drafts.flush(); if (voice && voice.channelId) socket.emit('voice:leave', {}); });
  window.addEventListener('hashchange', () => openLinkFromHash());
  document.addEventListener('keydown', globalKeys);
  initLongPress();
  // A window narrowed past the phone layout (or a phone turned): the message boxes' + follows (createComposer).
  onDeviceChange(() => Object.values(composers).forEach((c) => c && c.fitAttach()));
  document.querySelector('.nav-scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#sidebar').append(resizeHandle('sidebar'));
  phoneNav();
}

// Relay logins run out 12 to 18 hours after they're handed out, and an app can stay open for days without
// reconnecting. So new ones are fetched before a call when they're about to run out, and checked every
// minute in the background (calls in progress switch to them too).
// { force }: fetch now, however new they are. { maxAge }: also when the list is older than that (in ms).
// { remeasure }: measure the relays again afterwards, even the ones measured before.
// Ages and waits here go by performance.now(), a clock that only moves forward: setting the device's clock (by hand, or
// its time service putting it right) doesn't move it. Only the logins' expiry is a time of day, the server's, so it's
// compared with the server's time (this device's clock corrected by the bootstrap's clockOffset).
let iceAt = -Infinity; // when S.iceServers was asked for (its age counts from then)
let iceFor = null; // and for which choice: avoidsMemberRelays(S.me) then (the list depends on it, see followRelayChoice)
let iceAsked = 0; // the latest fetch: an older one that answers after it is stale (the choice may have changed since)
let iceAskedAt = -Infinity; // when that one was asked for
const ICE_CHECK = 10 * 60000; // how old a list with member relays in it gets before it's fetched again
// The relays in a list this app may use (with a login), as one string to compare.
const relaySet = (list) => usableIce(list, avoidsMemberRelays(S.me)).filter(isRelay).map((e) => [].concat(e.urls).join(',')).sort().join(' ');
// A new relay list, from GET /api/ice or the bootstrap. A call in progress follows it: new relay logins from its next
// network change on, and a connection set up with a member relay that isn't in the list at all any more (the owner paused
// or removed it, or its member was suspended) starts over without it (voice.js followMemberRelays). A member relay
// that's only offline for a few minutes, or that's no longer among this person's 8, is still in the list (by address,
// without a login), so the calls set up with it are left alone. Returns the list it replaced.
function takeIce(list, avoid, at) {
  const before = S.iceServers;
  S.iceServers = list; iceAt = at; iceFor = avoid;
  if (voice) {
    voice.updateIceServers();
    voice.followMemberRelays(memberRelayHosts(list));
  }
  return before;
}
async function freshIce({ force = false, maxAge = Infinity, remeasure = false } = {}) {
  if (!force && iceFor === avoidsMemberRelays(S.me) && !iceStale(S.iceServers, Date.now() + (S.clockOffset || 0)) && performance.now() - iceAt < maxAge) return;
  const n = ++iceAsked;
  const avoid = avoidsMemberRelays(S.me);
  const asked = iceAskedAt = performance.now();
  try {
    const list = await api('GET', '/ice');
    if (n !== iceAsked) return;
    const before = takeIce(list, avoid, asked);
    // Relays not measured yet (approved since, say) are measured now. Unmeasured, every relay in the list would go
    // into each call, so every member relay among them would see this device's address.
    if (remeasure || !S.relayRanks || relaySet(list) !== relaySet(before)) rankNearest({ force: remeasure });
  } catch { /* keep the old ones: the next check is soon */ }
}
// The bootstrap's list (at the start, and after every reconnect; `at`: when the bootstrap was asked for), taken like any
// other, as long as it's the newest: a fetch asked for before the bootstrap is older (dropped when it answers), but one
// asked for while the bootstrap was on its way (told of a change meanwhile: ice:changed) is newer, and its list stays.
// A choice made on another device while this one was away (its user:update missed) is followed as followRelayChoice
// would have: turned on, every connection in a call that may use a member relay starts over without them.
function bootIce(list, at) {
  const was = relayChoice;
  if (iceAskedAt < at) iceAsked++;
  if (at >= iceAt) takeIce(list, avoidsMemberRelays(S.me), at);
  relayChoice = avoidsMemberRelays(S.me);
  if (relayChoice && was === false && voice) voice.avoidChanged();
}
// The background check, every minute: a list whose logins are about to run out is fetched again, and so is a list with
// member relays in it once it's 10 minutes old (counted from when it was asked for, so it really is every 10 minutes):
// one the owner paused or removed meanwhile (the server says so at once, ice:changed, but this app may have missed it)
// isn't used for long, and an avoider learns about relays approved since.
setInterval(() => { if (S.me) freshIce((S.iceServers || []).some(isMemberRelay) ? { maxAge: ICE_CHECK } : {}); }, 60000);
// Before a call. Someone who avoids member relays drops the other side's addresses on any of them, so their list
// (where every member relay is, without logins) is fetched again when it's more than 10 minutes old, to know the
// relays approved since.
const iceBeforeCall = () => freshIce(avoidsMemberRelays(S.me) ? { maxAge: ICE_CHECK } : {});
// A member relay came into calls or left them: the list is fetched again a moment later (a moment apart on each device,
// so everyone's apps don't ask at the same instant). A few changes in a row are each fetched at once (an owner approving
// a relay and pausing it again); past that, once a minute however often this comes, and whatever changed meanwhile comes
// with that fetch. (The server lets each person fetch it 120 times an hour.)
const ICE_CHANGED_BURST = 5;
const ICE_CHANGED_EVERY = 60000;
let iceChangeTimer = null;
let iceChangeTokens = ICE_CHANGED_BURST; // fetches that may go out at once, one more every ICE_CHANGED_EVERY
let iceChangeTokensAt = null;
function iceChanged() {
  if (iceChangeTimer) return; // one is coming: it brings this change too
  const t = performance.now();
  if (iceChangeTokensAt !== null) iceChangeTokens = Math.min(ICE_CHANGED_BURST, iceChangeTokens + (t - iceChangeTokensAt) / ICE_CHANGED_EVERY);
  iceChangeTokensAt = t;
  const wait = (iceChangeTokens >= 1 ? 0 : (1 - iceChangeTokens) * ICE_CHANGED_EVERY) + Math.floor(Math.random() * 3000);
  iceChangeTokens -= 1;
  iceChangeTimer = setTimeout(() => { iceChangeTimer = null; if (S.me) freshIce({ force: true }); }, wait);
}
// With relays in several regions, find the nearest ones in the background (cached for 6 hours; force: measure again
// now). Someone who avoids member relays never measures one (measuring shows the relay this device's IP address).
function rankNearest({ force = false } = {}) {
  const usable = usableIce(S.iceServers, avoidsMemberRelays(S.me));
  if (usable.filter(isRelay).length > 2) rankRelays(usable, { force }).then((r) => { S.relayRanks = r; }).catch(() => {});
}
// Avoiding member relays turned on or off (Settings → Privacy & safety, on this device or another: user:update). The
// relay list depends on it (logins for member relays, or only where they are), so it's fetched again right away and
// the relays are measured again. Turned on during a call, every connection that may use a member relay starts over
// without them (voice.avoidChanged), and tells the others in the call to leave them out too.
// (A fetch that fails is tried again by the next check, or before the next call: freshIce compares iceFor.)
let relayChoice = null; // the choice last followed
function followRelayChoice() {
  const avoid = avoidsMemberRelays(S.me);
  if (relayChoice === avoid) return;
  relayChoice = avoid;
  freshIce({ force: true, remeasure: true }).then(() => { if (avoid && voice) voice.avoidChanged(); });
}
// When this server switched on end-to-end encryption: plaintext channel messages dated later can only have come
// from the server, so they aren't shown (secure.js). Remembered on this device, and the earliest time it was
// ever told wins, so the server can't move it later.
function rememberE2eeSince(t) {
  let known = 0;
  try { known = Number(localStorage.getItem('hearth.e2eeSince')) || 0; } catch { /* storage off */ }
  const v = Number(t) || 0;
  const out = known && v ? Math.min(known, v) : known || v;
  try { if (out && out !== known) localStorage.setItem('hearth.e2eeSince', String(out)); } catch { /* storage off */ }
  return out;
}

let clockWarned = false;
async function loadBootstrap() {
  // Read markers, notification preferences and saved ids come alongside, so unread badges are right at start.
  const extras = Promise.all(['/me/unread', '/me/notify', '/me/saved/ids'].map((p) => api('GET', p).catch(() => null)));
  // Your word filter comes alongside too, and is opened before anything is drawn, so nothing it hides shows first.
  const filterList = api('GET', '/me/word-filter').catch(() => null);
  const personalList = api('GET', '/me/personal-nicknames').catch(() => null);
  const asked = Date.now();
  const askedAt = performance.now(); // (for the relay list in it: see bootIce)
  const b = await api('GET', '/bootstrap');
  // How far this device's clock is from the server's (at most a day either way), for disappearing messages and the
  // time inside each message you send (binding.js ts). Further off than that, the times inside your messages are off
  // too, and everyone's apps would flag them: say so, once.
  if (Number.isFinite(b.serverNow)) {
    const off = b.serverNow - Math.round((asked + Date.now()) / 2);
    S.clockOffset = Math.max(-86400000, Math.min(86400000, off));
    if (Math.abs(off) > 86400000 && !clockWarned) {
      clockWarned = true;
      setTimeout(() => toast(`This device’s clock is off by about ${Math.round(Math.abs(off) / 86400000)} day${Math.round(Math.abs(off) / 86400000) === 1 ? '' : 's'}. Set it right in its settings: until then, other people’s apps may flag the messages you send for their time.`, 'error'), 1500);
    }
  }
  // Your own record is proven before anything of this start-up is used (secure.js proveOwnKeys): it's for the account
  // this tab started as, never another one the server names (every pin and trust record on this device is kept under
  // that id, so a different one would quietly start them all from nothing), and its keys are the ones your password
  // unlocks. If not, this throws with nothing assigned, so S keeps what was proven before.
  const me = await sec.proveOwnKeys(b.me, b.encSignPrivateKey, { account: signedInAs });
  S.me = me;
  drafts = createDrafts(S.me.id);
  S.mediaToken = b.mediaToken;
  bootIce(b.iceServers, askedAt);
  setTimeout(() => rankNearest(), 4000);
  S.e2eeSince = rememberE2eeSince(b.e2eeSince);
  // Only records filed under their own id (see mergeUser: pins are looked up by the record's id). Yours has the keys
  // just proven, whatever the list says.
  S.users = Object.fromEntries(Object.entries(b.users || {}).filter(([id, u]) => u && u.id === id));
  S.users[me.id] = { ...(S.users[me.id] || {}), ...me };
  S.servers = b.servers;
  S.serversLoaded = true;
  S.dms = b.dms;
  S.relationships = Object.fromEntries(b.relationships.map((r) => [r.userId, r]));
  S.blocked = new Set(b.blocked || []);
  S.voice = b.voice;
  S.msgs = {};
  S.threads = {};
  S.threadState = {};
  S.threadsPanel = null;
  // (An open Photos & videos panel asks for its newest page again, and lets go of the copies photo-notes.js handed it:
  // comments, tags or edits made while this app was away aren't in them.)
  MEDIA.reset({ all: true });
  SIDE.reset(); // (and the side view loads what's pinned there again: edited or deleted meanwhile)
  Object.values(S.users).forEach((u) => sec.trust(u));
  for (const st of Object.values(b.keyStates || {})) await sec.applyState(st);
  LOOK.fromBootstrap(b.dms, b.servers); // (after the keys: a group chat's background opens with its group's)
  if (S.view.serverId && !S.servers.find((s) => s.id === S.view.serverId)) S.view = { type: 'home' };
  if (S.view.dmId && !S.dms.find((d) => d.id === S.view.dmId)) S.view = { type: 'home' };
  if (!S.view.serverId && !S.view.dmId && !['friends', 'saved', 'people'].includes(S.view.type)) S.view = { type: 'home' };
  applyUserState(await extras);
  const savedFilter = await filterList;
  if (savedFilter) await WF.apply(savedFilter, { quiet: true }).catch(() => {});
  const savedNames = await personalList;
  if (savedNames) await PN.apply(savedNames, { quiet: true }).catch(() => {});
  renderAll();
  loadPreviews();
  SCHED.load(); // your scheduled messages (after the keys above: some may need re-encrypting)
  if (!S.remindersOn) { S.remindersOn = true; startReminders(); }
  purgeInbox();
  armClientExpiry();
  if (window.hearthDesktop && window.hearthDesktop.detectActivity) api('GET', '/me/activity-settings').then(startDesktopDetection).catch(() => {});
  if ((b.termsVersion || 0) > (b.tosAccepted || 0)) askToAcceptTerms();
  restoreResume();
  renderAnnouncement();
  if (S.me.staffRole) api('GET', '/admin/stats').then((st) => { S.adminReports = st.openReports; renderRail(); }).catch(() => {});
  backFromStripe();
  const open = new URLSearchParams(location.search).get('open');
  if (open) { history.replaceState(null, '', '/' + location.hash); if (open === 'messages') openMessages(); if (open === 'friends') goFriends(); }
  if (localStorage.getItem('hearth.push') === 'on') enablePush({ quiet: true }).catch(() => {});
  if (androidApp.on) androidPushAtStart(); else applePushAtStart();
  const invite = sessionStorage.getItem('hearth.pendingInvite');
  if (invite) { sessionStorage.removeItem('hearth.pendingInvite'); openJoinModal(invite); }
  else {
    showUpdateNotes(); // (every start and reconnect: a note published while this app was asleep or offline shows too)
    // A link this page was opened with (a tapped notification, an invite in the Android app) opens on the
    // first start too, not only after a reconnect.
    if (location.hash) openLinkFromHash();
  }
}

// "What's new": the update notes the owner published that this device hasn't shown yet (whatsnew.js), as plain text.
// Never on top of something the person is in the middle of (a dialog or sheet, a menu, the picture viewer, typing),
// nor while the app is out of sight: then it waits and looks again. A note counts as seen once its window is closed,
// so one that's cut off (a reload for an update) comes back. The owner's own are seen already: they wrote them.
let notesBusy = false; // a look at the notes, or their window, is under way
let notesLater = null;
let lastTyped = 0;
document.addEventListener('keydown', () => { lastTyped = Date.now(); }, true);
document.addEventListener('visibilitychange', () => { if (!document.hidden && notesLater) { clearTimeout(notesLater); notesLater = null; setTimeout(showUpdateNotes, 3000); } });
function busyForNotes() {
  if (document.hidden || $$('#layer > .modal-backdrop:not(.closing), .sheet-backdrop, .popover, .viewer:not(.closing)').length) return true;
  const a = document.activeElement;
  const editing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  return !!editing && (!!(a.value && a.value.trim()) || Date.now() - lastTyped < 10000);
}
const notesAfterwards = () => { if (!notesLater) notesLater = setTimeout(() => { notesLater = null; showUpdateNotes(); }, 20000); };
async function showUpdateNotes() {
  if (notesBusy || !S.me) return;
  if (busyForNotes()) { notesAfterwards(); return; }
  notesBusy = true;
  let open = false;
  try {
    let notes;
    try { notes = (await api('GET', '/update-notes')).notes; } catch { return; }
    if (S.me.staffRole === 'owner') { markNotesSeen((notes || []).map((n) => n.id)); return; }
    const { notes: news, ids } = unseenNotes(notes, { android: noPayments });
    if (!news.length) return;
    if (busyForNotes()) { notesAfterwards(); return; } // something began meanwhile
    open = true;
    modal({ title: 'What\u2019s new', size: 'md', className: 'whatsnew',
      body: h('div', { class: 'stack' }, ...news.map((n) => h('section', null, n.title ? h('h3', { class: 'set-h' }, n.title) : null,
        h('ul', { class: 'perk-list' }, n.items.map((t) => h('li', null, t)))))),
      onClose: () => { markNotesSeen(ids); notesBusy = false; },
      actions: [{ label: 'Nice', kind: 'primary' }] });
  } finally {
    if (!open) notesBusy = false;
  }
}

function setUser(u) {
  if (!u || !u.id) return;
  // Your own keys only ever come from a start-up the app checked (bootstrap, through sec.proveOwnKeys's proof): a
  // record pushed for you later can't swap them, or the app would lock what it keeps for itself to the server's key.
  if (S.me && u.id === S.me.id) {
    const rest = { ...u };
    delete rest.publicKey; delete rest.signPublicKey;
    S.users[u.id] = mergeUser(S.users[u.id], { ...rest, publicKey: S.me.publicKey, signPublicKey: S.me.signPublicKey });
    S.me = mergeUser(S.me, rest);
    return;
  }
  S.users[u.id] = mergeUser(S.users[u.id], u);
}
function getUser(id) {
  const u = S.users[id];
  if (u) return u;
  if (!fetchingUsers.has(id)) {
    fetchingUsers.add(id);
    api('GET', '/users/' + id).then((x) => { setUser(x); refreshUserBits(id); }).catch(() => {});
  }
  return { id, username: 'unknown', profile: { displayName: 'Unknown user' }, presence: 'offline' };
}
// Swap every rendered avatar/name for this user.
function refreshUserBits(id) {
  const u = S.users[id];
  if (!u || !S.me) return;
  $$(`[data-user-av="${id}"]`).forEach((el) => {
    const fresh = avatarEl(u, +el.dataset.size, { status: el.dataset.status === '1', meId: S.me.id });
    if (el.classList.contains('speaking')) fresh.classList.add('speaking');
    if (el.dataset.speak) fresh.dataset.speak = el.dataset.speak;
    el.replaceWith(fresh);
  });
  $$(`[data-user-name="${id}"]`).forEach((el) => redrawName(el, u));
  showPresenceText(id);
  if (id === S.me.id) renderUserPanel();
  if (S.panel === 'members' || S.view.type === 'dm') renderPanel();
  if (['friends', 'home'].includes(S.view.type) && S.view.tab !== 'add') renderMain();
  if (S.view.type === 'voice') renderMain();
}
// The words for someone's status drawn outside the lists (the DM header's "Online"), which nothing else redraws.
function showPresenceText(id) {
  $$(`[data-presence-of="${id}"]`).forEach((t) => { t.textContent = STATUS_LABEL[presenceOf(S.users[id], S.me.id)] || ''; });
}
// Someone came online, went Away, went offline or started a game: the lists that show it. The friends list and the
// member list redraw only their rows, so what's typed in their search boxes (and focus there) stays; on Home only
// the online friends. Automatic Away makes these frequent, so nothing else is rebuilt (or fetched again).
function redrawPeople() {
  if (S.panel === 'members' || S.view.type === 'dm') {
    const list = S.view.type !== 'dm' && $('#members .member-list');
    if (list && list._redraw) list._redraw(); else renderPanel();
  }
  if (S.view.tab === 'add') return;
  if (S.view.type === 'friends') {
    const list = $('#main .friend-list');
    if (list && list._redraw) list._redraw(); else renderMain();
  } else if (S.view.type === 'home') {
    const sec = $('#main .home-online');
    if (sec) sec.replaceWith(onlineFriendsSection()); else renderMain();
  }
}
// Your own Away for being inactive (or back), in place: the dots and the line under your name.
function showMyPresence() {
  const st = presenceOf(S.me, S.me.id);
  $$(`[data-user-av="${S.me.id}"][data-status="1"] .status-dot`).forEach((d) => {
    d.className = d.className.replace(/\bst-\S+/, `st-${st}`);
    d.title = STATUS_LABEL[st] || '';
    d.setAttribute('aria-label', STATUS_LABEL[st] || '');
  });
  const sub = $('#user-panel .me-sub');
  if (sub) sub.textContent = mySubLine(); else renderUserPanel();
}

// Draws one name again for this person, in the server it was drawn for (their nickname there) and with the role
// color it had: both are kept on the element (profile-ui.js nameEl).
function redrawName(el, u) {
  const server = el.dataset.nameIn ? S.servers.find((s) => s.id === el.dataset.nameIn) : null;
  el.replaceWith(nameEl(u, { tag: el.tagName.toLowerCase(), server, roleColor: el.dataset.roleColor || '',
    cls: [...el.classList].filter((c) => !c.startsWith('fx-') && c !== 'uname' && c !== 'grad' && !c.startsWith('font-')).join(' ') }));
}
// Someone's nickname in a server changed (server/nicknames.js): the names drawn for that server follow, and the
// lists that sort or search by name, the typing line and call tiles are drawn again.
function applyNick(serverId, userId, nickname) {
  const s = S.servers.find((x) => x.id === serverId);
  if (!s || isGroup(s)) return;
  const nicks = (s.nicknames ||= {});
  if ((nicks[userId] || null) === (nickname || null)) return;
  if (nickname) nicks[userId] = nickname; else delete nicks[userId];
  const u = S.users[userId];
  if (u && S.me) $$(`[data-user-name="${userId}"][data-name-in="${serverId}"]`).forEach((el) => redrawName(el, u));
  if (S.view.serverId !== serverId) return;
  if (S.panel === 'members') renderPanel();
  renderTyping();
  renderCallStages();
  if (S.view.type === 'voice') renderMain();
}

// Your nicknames for people changed (here or on another device): every name drawn follows, and the lists that sort or
// search by name, the typing line, call tiles and the conversation list are drawn again.
function personalNamesChanged() {
  if (!S.me || !S.serversLoaded) return;
  $$('[data-user-name]').forEach((el) => { const u = S.users[el.dataset.userName]; if (u) redrawName(el, u); });
  renderSidebar();
  if (panelMode()) renderPanel();
  renderTyping();
  renderCallStages();
  if (S.view.type === 'voice' || S.view.type === 'friends' || S.view.type === 'home') renderMain();
}
// "Set nickname (only you see it)" for someone else: in their menus and on their profile.
function personalNameItem(u) {
  if (!u || !S.me || u.id === S.me.id || !u.username) return null;
  const has = !!PN.get(u.id);
  return { label: has ? 'Change your nickname for them\u2026' : 'Set nickname (only you see it)\u2026', icon: 'edit', action: () => openPersonalName(u) };
}
const openPersonalName = (u) => PN.openEditor(u, { realName });

// ======================================================================= conversation previews (decrypted locally)
// Each DM and group chat keeps its newest message (d.last / s.last: from the server, then kept up to date by new
// messages, edits and deletes as they come), and the conversation list shows it decrypted. Decrypting takes a
// moment, in which the newest message can change again (a delete, then a new message): a preview is only written
// while the message it was worked out from is still the conversation's newest, and whatever replaced it writes its own.
async function loadPreviews() {
  for (const d of S.dms) await previewDm(d);
  for (const s of S.servers.filter((x) => x.kind === 'group')) await previewGroup(s);
  if (!S.view.serverId) renderSidebar();
  if (S.view.type === 'home') renderMain();
}
function dmById(id) { return S.dms.find((x) => x.id === id); }
async function previewDm(d) {
  const last = d.last;
  if (!last) { S.previews['d:' + d.id] = ''; return; }
  const m = { ...last, dmId: d.id };
  await sec.decryptDmMessage(m);
  if ((dmById(d.id) || {}).last !== last) return;
  // A last message that has disappeared shows nothing (the server sends the one before it with its next update).
  S.previews['d:' + d.id] = isExpired(m, nowServer()) ? '' : previewText(m);
  if (disappears(m)) { last.dec = m.dec; armClientExpiry(); }
}
async function previewGroup(s) {
  if (s.kind !== 'group') return;
  const last = s.last;
  if (!last) { S.previews['g:' + s.id] = ''; return; }
  const m = { ...last, serverId: s.id };
  if (m.ciphertext) await sec.decryptChannelMessage(m); else m.dec = { t: '' };
  if ((serverById(s.id) || {}).last !== last) return;
  S.previews['g:' + s.id] = isExpired(m, nowServer()) ? '' : previewText(m, true);
  if (disappears(m)) { last.dec = m.dec; armClientExpiry(); }
}
// The DM or group chat that a conversation ('d:<dm>' | 'c:<channel>') is a line of the conversation list for, or
// null (a server's channel).
function convOf(key) {
  if (key.startsWith('d:')) return dmById(key.slice(2)) || null;
  const s = serverOfChannel(key.slice(2));
  return isGroup(s) ? s : null;
}
// A conversation's newest message changed (a delete, an edit, one disappearing): its line is worked out again and
// drawn where it shows. A group chat is also placed in the list and dated by its newest message, as the server does
// it (serverCommon's lastMessageAt), so a delete can move it down; with none left that's the group's own start, which
// only the server knows (at). A DM keeps its time: the server doesn't go back on a delete either.
function setLast(conv, last, at = null) {
  conv.last = last;
  const t = last ? last.createdAt : at;
  if (isGroup(conv) && t != null) conv.lastMessageAt = t;
  return (isGroup(conv) ? previewGroup(conv) : previewDm(conv)).then(redrawConvList);
}
// Deletes in a group chat come with its newest message now, and its time (server/index.js lastIfGroup).
function groupLastIs(channelId, last, at) {
  const s = last !== undefined && serverOfChannel(channelId);
  if (isGroup(s)) setLast(s, last, at);
}
// An edit to a conversation's newest message changes its line too, whether or not the conversation is loaded here:
// the newest message takes the new words (still encrypted, as the server keeps it) and is decrypted again.
function lastEdited(key, m) {
  const conv = convOf(key);
  if (!conv || !conv.last || conv.last.id !== m.id) return;
  setLast(conv, {
    id: m.id, authorId: m.authorId, ...(m.channelId ? { channelId: m.channelId } : {}), ciphertext: m.ciphertext,
    createdAt: m.createdAt, expiresAt: m.expiresAt || null, editedAt: m.editedAt || null,
  });
}
// The conversation list is the sidebar on Home, in a DM and in a group chat; Home's recent conversations show it too.
function redrawConvList() {
  if (!S.view.serverId || isGroup(currentServer())) later(renderSidebar);
  if (S.view.type === 'home') later(renderMain);
}
function previewText(m, group = false) {
  if (!m.dec || m.dec.error) return 'Encrypted message';
  if (m.dec.pending) return 'Waiting for key…';
  const who = m.authorId === S.me.id ? 'You: ' : group ? `${displayName(getUser(m.authorId))}: ` : '';
  // The word filter covers previews and notifications too: they say it's hidden instead of what it says.
  const wf = WF.check(m);
  if (wf) return who + previewLabel(wf);
  const t = readableText(m.dec.t).replace(/\s+/g, ' ').trim();
  return who + (t || ((m.dec.f || []).length ? 'Sent an attachment' : ''));
}

// ======================================================================= disappearing messages
// A conversation ('c:<channel>' | 'd:<dm>') can have a timer: new messages disappear that long after they're sent,
// for everyone. The server stamps each message's deadline and deletes it then; this app hides it on time by itself
// (the earlier of the server's deadline and the timer inside the encrypted message, see disappear.js) and lets go of
// every copy it kept: decrypted files, inbox entries, reminders, notifications, search results.

// The conversation's timer in seconds (0 = off).
function convSecs(key) {
  if (!key) return 0;
  if (key.startsWith('d:')) return (S.dms.find((x) => x.id === key.slice(2)) || {}).disappear || 0;
  return (channelById(key.slice(2)) || {}).disappear || 0;
}
// The choices this server offers (under test it adds a 5-second one).
const timerChoices = () => (((S.config || {}).disappearing || {}).choices || TIMERS.map(([v]) => v));
// Who may change it: either person in a DM (not someone they blocked, not a deleted account), anyone in a group chat,
// and in a server channel people who can edit it (Manage Channels there). The server checks all of this again.
// A server's voice channel has one for its chat, like a text channel (a group's call has no chat of its own).
function mayChangeTimer(key) {
  if (!key) return false;
  if (key.startsWith('d:')) { const d = S.dms.find((x) => x.id === key.slice(2)); return !!d && !S.blocked.has(d.userId) && !getUser(d.userId).deleted; }
  const c = channelById(key.slice(2));
  const srv = c && serverOfChannel(c.id);
  return !!c && hasChat(c) && (isGroup(srv) || canEditChannel(srv, c));
}
// The section in a conversation's menu: the choices with the one in force ticked; people who can't change it just
// see what it is.
function disappearItems(key) {
  const secs = convSecs(key);
  if (!mayChangeTimer(key)) return secs ? ['-', { header: `Disappearing messages: ${disLabel(secs)}` }] : [];
  return ['-', { header: 'Disappearing messages' }, ...timerChoices().map((v) => ({ label: disLabel(v), checked: secs === v, action: () => setDisappearing(key, v) }))];
}
// "your chat with Bob", "Weekend plans", "#general", "🔊 Lounge": where a conversation is, in a sentence.
function convTitle(key) {
  if (key.startsWith('d:')) { const d = S.dms.find((x) => x.id === key.slice(2)); return d ? `your chat with ${displayName(getUser(d.userId))}` : 'this chat'; }
  const s = serverOfChannel(key.slice(2));
  if (isGroup(s)) return groupName(s);
  const c = channelById(key.slice(2));
  return c ? chanLabel(c) : 'this channel';
}
const timerUrl = (key) => `${key.startsWith('d:') ? '/dms/' : '/channels/'}${encodeURIComponent(key.slice(2))}/disappearing`;
// Returns whether the timer is now secs: false when they cancelled, or when it failed (shown as a toast, or thrown
// with raise for a dialog that shows its own errors).
async function setDisappearing(key, secs, { ask = true, quiet: silent = false, raise = false } = {}) {
  const prev = convSecs(key);
  if (secs === prev) return true;
  // Turning it on says plainly what it does and doesn't do.
  if (ask && !prev && secs && !(await confirmDialog({
    title: 'Turn on disappearing messages?',
    text: `New messages here will disappear for everyone ${disLabel(secs).toLowerCase()} after they’re sent, with their files. Messages already here aren’t affected. This server does the deleting: anyone here can still screenshot, copy, forward or save what they see, and the server’s backups keep copies until they’re rotated out.`,
    confirm: 'Turn on',
  }))) return false;
  try {
    onDisappearUpdate(await api('PUT', timerUrl(key), { seconds: secs }));
    if (!silent) toast(secs ? `New messages disappear after ${disLabel(secs).toLowerCase()}.` : 'Disappearing messages are off. Messages sent before still disappear on time.');
    return true;
  } catch (e) {
    if (raise) throw e;
    toast(e.message, 'error');
    return false;
  }
}
// Someone changed the timer while we were sending (the server refused with disappear_changed): fetch it.
async function refreshTimer(key) {
  const r = await api('GET', timerUrl(key));
  const store = S.msgs[key];
  if (store && store.loaded && !store.hasNewer) mergeTimerEvents(store, r.log);
  onDisappearUpdate({ conv: key, ...(key.startsWith('d:') ? { dmId: key.slice(2) } : { channelId: key.slice(2) }), seconds: r.seconds });
}
// A timer change, live (disappear:update) or our own coming back: the setting, the line in the conversation, the
// header and the composer note.
function onDisappearUpdate(p) {
  if (!p || !p.conv || !S.me) return;
  const key = p.conv;
  if (p.channelId) { const c = channelById(p.channelId); if (c) c.disappear = p.seconds; }
  if (p.dmId) { const d = S.dms.find((x) => x.id === p.dmId); if (d) d.disappear = p.seconds; }
  const store = S.msgs[key];
  if (p.id && store && store.loaded && !store.hasNewer && !(store.events && store.events.has(p.id))) {
    mergeTimerEvents(store, [{ id: p.id, by: p.by, secs: p.seconds, prev: p.prev, at: p.at }]);
    const sc = currentKey() === key && $('#messages');
    if (sc) {
      const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
      const firstPending = sc.querySelector('.msg.sending');
      const put = (node) => (firstPending ? sc.insertBefore(node, firstPending) : sc.append(node));
      // The same as a full redraw draws it: under its own day's divider.
      if (shownDay(sc, firstPending) !== new Date(p.at).toDateString()) put(dayDivEl(p.at));
      put(sysLineEl(store.events.get(p.id)));
      if (near) sc.scrollTop = sc.scrollHeight;
    }
  }
  if (currentKey() === key) {
    renderHeader();
    if (composers.main) composers.main.renderExtras();
    // (A thread's composer can outlive its panel; only the open one is redrawn.)
    if (composers.thread && S.thread && S.thread.channelId === key.slice(2)) composers.thread.renderExtras();
  }
}
// Timer changes the server handed out with a page of history, kept with the conversation by id. Returns how many
// are new.
function mergeTimerEvents(store, list) {
  if (!Array.isArray(list) || !list.length) return 0;
  store.events ||= new Map();
  let n = 0;
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || store.events.has(e.id)) continue;
    store.events.set(e.id, { id: e.id, by: e.by || null, secs: Number(e.secs) || 0, prev: Number(e.prev) || 0, at: Number(e.at) || 0 });
    n++;
  }
  return n;
}
// Chat background changes (chat-look.js) the server handed out with a page of history (lookEvents), or live: kept with
// the timer's, by id ('lk:' in front keeps the two apart), so they page and draw the same way (sysLineEl). Returns how
// many are new.
function mergeLookEvents(store, list) {
  const fresh = LOOK.events(list).filter((e) => !(store.events && store.events.has(e.id)));
  if (!fresh.length) return 0;
  store.events ||= new Map();
  fresh.forEach((e) => store.events.set(e.id, e));
  return fresh.length;
}
// A live dm:look / group:look: the background (LOOK.onEvent), then "maya changed the chat background" in the
// conversation, at the bottom like a new timer line (onDisappearUpdate), when its newest messages are loaded.
function onLookEvent(kind, p) {
  if (!S.me || !p || typeof p !== 'object') return;
  LOOK.onEvent(kind, p);
  if (!p.event || typeof p.event !== 'object') return;
  let key = null;
  if (kind === 'dm:look' && typeof p.dmId === 'string') key = 'd:' + p.dmId;
  if (kind === 'group:look') { const s = S.servers.find((x) => x.id === p.serverId); const c = isGroup(s) && textChannel(s); key = c ? 'c:' + c.id : null; }
  const store = key && S.msgs[key];
  if (!store || !store.loaded || store.hasNewer || !mergeLookEvents(store, [p.event])) return;
  const e = store.events.get('lk:' + p.event.id);
  const sc = currentKey() === key && $('#messages');
  if (!e || !sc) return;
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  const firstPending = sc.querySelector('.msg.sending');
  const put = (node) => (firstPending ? sc.insertBefore(node, firstPending) : sc.append(node));
  if (shownDay(sc, firstPending) !== new Date(e.at).toDateString()) put(dayDivEl(e.at));
  put(sysLineEl(e));
  if (near) sc.scrollTop = sc.scrollHeight;
}
// The lines that belong between the messages loaded now, oldest first (the rest show with their part of history).
function timerLines(store) {
  if (!store.events || !store.events.size) return [];
  const first = store.list[0];
  const last = store.list[store.list.length - 1];
  return [...store.events.values()].filter((e) => (!store.hasMore || !first || e.at >= first.createdAt) && (!store.hasNewer || !last || e.at <= last.createdAt))
    .sort((a, b) => a.at - b.at);
}
// "Today", "Yesterday", "March 3": the divider before the first message (or timer line) of a day.
const dayDivEl = (t) => h('div', { class: 'day-div', role: 'separator', dataset: { day: new Date(t).toDateString() } }, h('span', null, fmtDay(t)));
// The day of the last divider above `before` (or the end of the list), for adding to the bottom live.
function shownDay(sc, before = null) {
  for (let el = before ? before.previousElementSibling : sc.lastElementChild; el; el = el.previousElementSibling) if (el.classList.contains('day-div')) return el.dataset.day || null;
  return null;
}
// "Alice turned on disappearing messages: 1 week · 3:04 PM"
function sysLineEl(e) {
  // Drawn in the conversation on screen: in a server channel (a voice channel's chat too), whoever changed it goes by
  // their nickname there; in DMs and group chats, their display name. "You" only for a change made with your own
  // account (the entry's user id); anyone else's name is drawn apart from it, and their @username follows any name
  // that isn't simply that username (sysLineParts), so no display name or nickname, look-alike letters or not, can
  // pass for your own change.
  const nameOf = (id) => nameInServer(currentServer(), getUser(id));
  const handleOf = (id) => (S.users[id] ? S.users[id].username : null);
  // A chat background change (chat-look.js, e.look: 'set' or 'clear') is drawn the same way, with its own words.
  const p = e.look ? LOOK.lineParts(e, S.me.id, nameOf, handleOf) : sysLineParts(e, S.me.id, nameOf, handleOf);
  const handle = !p.self && e.by && S.users[e.by] ? '@' + S.users[e.by].username : null;
  const who = p.self ? h('span', { class: 'sys-you' }, 'You')
    : h('bdi', { class: 'sys-who', ...(handle ? { title: handle } : {}) }, p.who);
  return h('div', { class: 'sys-line', role: 'note' }, icon(e.look ? 'palette' : 'timer'),
    h('span', null, who, p.handle ? h('span', { class: 'sys-handle' }, ` (@${p.handle})`) : null, ` ${p.action}`),
    h('time', { datetime: new Date(e.at).toISOString(), title: new Date(e.at).toLocaleString() }, fmtStamp(e.at)));
}
// In the header while the timer is on: opens the choices, or says what it is to people who can't change it.
function timerButton(key) {
  const secs = convSecs(key);
  if (!secs) return null;
  const tip = `Disappearing messages: ${disLabel(secs)}`;
  return ibtn('timer', tip, (e) => (mayChangeTimer(key) ? menu(e.currentTarget, disappearItems(key).slice(1), { align: 'end' })
    : toast(`New messages here disappear ${disLabel(secs).toLowerCase()} after they’re sent.`)), { attrs: { 'data-pop-anchor': '' } });
}
function timerWelcome(key) {
  const secs = convSecs(key);
  return secs ? h('p', { class: 'welcome-note' }, icon('timer'), `Disappearing messages are on: new messages go ${disLabel(secs).toLowerCase()} after they’re sent.`) : null;
}
// The small timer on a disappearing message, with when it goes. The "in 20 minutes" part is worked out each time the
// tooltip shows (it would go stale on a message that stays on screen); the label has the time only.
function expBadge(m) {
  const at = deadline(m);
  if (!Number.isFinite(at)) return null;
  const note = serverKept(m) ? '. Its sender’s timer is shorter than the server’s; this app goes by the shorter one.' : '';
  const tip = () => `Disappears ${fmtStamp(at)} (${remaining(at - nowServer())})${note}`;
  // (This mouseover runs before the tooltip's listener on the document reads data-tip.)
  return h('span', { class: 'msg-exp', role: 'img', 'aria-label': `Disappears ${fmtStamp(at)}${note}`, 'data-tip': tip(), onmouseover: (e) => { e.currentTarget.dataset.tip = tip(); } }, icon('timer'));
}
const expOf = (m) => (disappears(m) ? { exp: deadline(m) } : {});

// ---- hiding them on time
const expiryListeners = new Set(); // open search windows: (ids) => drop what they found
let expiryTimer = 0;
// Messages in a freshly loaded page that are already past their time: never shown. Returns how many.
function dropExpired(store) {
  const t = nowServer();
  const gone = store.list.filter((m) => isExpired(m, t));
  if (gone.length) {
    store.list = store.list.filter((m) => !isExpired(m, t));
    forgetCopies(gone, new Set(gone.map((m) => m.id)));
  } else if (store.list.some(disappears)) armClientExpiry();
  return gone.length;
}
// One timer for the soonest deadline among everything loaded or kept (at most an hour away: it checks again then).
function armClientExpiry() {
  clearTimeout(expiryTimer);
  if (!S.me) return;
  const items = [];
  for (const st of Object.values(S.msgs)) for (const m of st.list) items.push(m);
  for (const t of Object.values(S.threads)) { if (t.root) items.push(t.root); for (const m of t.list || []) items.push(m); }
  if (S.threadsPanel) for (const x of S.threadsPanel.items) items.push(x.root);
  for (const m of MEDIA.messages()) items.push(m); // (Photos & videos keep messages the chat may not have)
  for (const m of SIDE.messages()) items.push(m); // (and so does the side view)
  for (const m of NOTES.messages()) items.push(m); // (and so do photo tags and comments)
  for (const d of S.dms) if (d.last) items.push(d.last);
  for (const sv of S.servers) if (sv.last) items.push(sv.last);
  for (const exp of [...P.inbox.map((x) => x.exp), ...reminderDeadlines()]) if (exp) items.push({ expiresAt: exp });
  const next = nextDeadline(items, nowServer());
  if (next) expiryTimer = setTimeout(purgeExpired, waitFor(next, nowServer()));
}
const newestLive = (key) => { const st = S.msgs[key]; return (st && !st.hasNewer && [...st.list].reverse().find((x) => !x.threadId)) || null; };
// Everything whose time has come goes: from the conversations, threads, previews, inbox and reminders. The server
// deletes them at the same moment and says so (message:delete-bulk / dm:delete), which then changes nothing here.
function purgeExpired() {
  if (!S.me) return;
  const t = nowServer();
  for (const [key, st] of Object.entries(S.msgs)) {
    const ids = st.list.filter((m) => isExpired(m, t)).map((m) => m.id);
    if (ids.length) onDeleteMessage(key, ids, { expired: true });
  }
  for (const [rootId, th] of Object.entries(S.threads)) {
    if (!th.root) continue;
    const replies = (th.list || []).filter((m) => isExpired(m, t)).map((m) => ({ id: m.id, threadId: rootId }));
    if (replies.length) onDeleteChannelMessages(th.root.channelId, replies, { expired: true });
    if (isExpired(th.root, t)) { delete S.threads[rootId]; if (S.thread && S.thread.rootId === rootId) closeThread(); }
  }
  // Threads in the Threads panel whose first message went (their cards, and their counts in the channel's badge).
  const tp = S.threadsPanel;
  const goneRoots = tp ? tp.items.filter((x) => isExpired(x.root, t)).map((x) => x.rootId) : [];
  if (goneRoots.length) forgetThreads('c:' + tp.channelId, new Set(goneRoots));
  // Photos & videos of messages the chat hasn't loaded (the rest went with the conversations above).
  MEDIA.expire();
  NOTES.expire(); // and the copies photo tags and comments keep by themselves
  SIDE.expire(); // and the side view's
  for (const d of S.dms) if (d.last && isExpired(d.last, t)) setLast(d, newestLive('d:' + d.id));
  for (const g of groups()) if (g.last && isExpired(g.last, t)) { const c = textChannel(g); setLast(g, c ? newestLive('c:' + c.id) : null); }
  purgeInbox();
  purgeReminders();
  armClientExpiry();
}
// A disappearing message went: let go of everything this device kept of it. Its decrypted files (in memory), a voice
// message playing, the image viewer, a reply or edit in progress, its notification, inbox entries and reminders
// (which keep its words in this browser's storage) and open search results.
// key: the conversation they were in, when known (its unread and mention counts are asked for again).
function forgetCopies(msgs, ids, key = null) {
  const urls = [];
  for (const m of msgs) for (const f of filesOf(m)) { urls.push(f.url); if (f.th && f.th.url) urls.push(f.th.url); }
  stopVoice(urls);
  urls.forEach((u) => fileUrls.drop(u, true));
  const v = document.querySelector('.viewer');
  if (v && v._mids && [...ids].some((id) => v._mids.has(id))) v._close();
  for (const c of [composers.main, S.thread ? composers.thread : null]) if (c && c.state.replyTo && ids.has(c.state.replyTo.id)) c.setReply(null);
  if (S.editing && ids.has(S.editing)) { S.editing = null; toast('That message disappeared.'); }
  closeNotificationFor(ids);
  purgeInbox(ids);
  purgeReminders(ids);
  expiryListeners.forEach((fn) => fn(ids));
  if (panelMode() === 'pins') later(renderPanel);
  if (S.view.type === 'saved') later(renderMain);
  // (Pings in a channel's threads count in its badge too.)
  if (key ? S.unread.has(key) || S.mentions.has(key) || S.threadMentions.has(key) : S.unread.size || S.mentions.size || S.threadMentions.size) refreshUnreadSoon();
  armClientExpiry();
}
// Unread and mention counts still include messages that have since disappeared or were deleted: ask the server again,
// a moment after its sweep, and at most every 30 seconds.
let unreadTimer = 0;
let unreadAsked = 0;
function refreshUnreadSoon() {
  if (unreadTimer) return;
  unreadTimer = setTimeout(async () => {
    unreadTimer = 0;
    unreadAsked = Date.now();
    try {
      applyUserState([await api('GET', '/me/unread'), null, null]);
      later(renderRail);
      later(renderSidebar);
      // (Home's recent conversations show what's unread too.)
      if (S.view.type === 'home') later(renderMain);
    } catch { /* the next change asks again */ }
  }, Math.max(1500, 30000 - (Date.now() - unreadAsked)));
}

// ======================================================================= navigation
// The conversation on screen: a channel, a DM, or a voice channel's chat while it's open beside the call.
const currentKey = () => (S.view.type === 'channel' || (S.view.type === 'voice' && S.view.chat) ? 'c:' + S.view.channelId : S.view.type === 'dm' ? 'd:' + S.view.dmId : null);
const currentServer = () => S.servers.find((s) => s.id === S.view.serverId);
const isOwner = (server) => !!server && server.ownerId === S.me.id;
// ---- permissions (the server sends our own, already resolved, per server and per channel)
const myPerms = (server) => (!server ? 0 : server.myPerms || 0);
const can = (server, bit) => has(myPerms(server), bit);
const chanPerms = (c) => (!c ? 0 : c.perms ?? ALL_PERMS);
const canIn = (c, bit) => has(chanPerms(c), bit);
const isAdmin = (server) => can(server, PERMS.MANAGE_CHANNELS); // can manage channels & categories
// One channel's settings and permissions need the permission server-wide and in that channel (the server checks
// both, so a per-channel deny hides what would only fail).
const canEditChannel = (server, c) => isAdmin(server) && canIn(c, PERMS.MANAGE_CHANNELS);
const canEditChannelPerms = (server, c) => can(server, PERMS.MANAGE_ROLES) && canIn(c, PERMS.MANAGE_ROLES);
// A text channel's webhooks: Manage Channels there (as for editing it) or Manage Server; never in group chats.
const canManageHooks = (server, c) => !!c && c.type === 'text' && !isGroup(server) && (can(server, PERMS.MANAGE_SERVER) || canEditChannel(server, c));
// The owner and Administrators can change anything; anyone else's changes can't take their own access away.
const isFullAdmin = (server) => isOwner(server) || can(server, PERMS.ADMINISTRATOR);
// You can only give a role whose permissions you have yourself (the server also checks its channel overrides,
// which the app can't see for every channel, and explains when that's the reason).
const mayGiveRole = (server, r) => !(r.permissions & ALL_PERMS & ~myPerms(server));
const canManageServer = (server) => !!server && !isGroup(server) && (can(server, PERMS.MANAGE_SERVER) || can(server, PERMS.MANAGE_ROLES) || can(server, PERMS.MANAGE_EMOJIS) || can(server, PERMS.BAN_MEMBERS) || can(server, PERMS.KICK_MEMBERS)
  || can(server, PERMS.VIEW_AUDIT_LOG) || can(server, PERMS.MANAGE_MESSAGES));
// Reports about this server reach people with these (server/serveraudit.js): Server settings → Reports.
const canSeeReports = (server) => !!server && !isGroup(server) && (can(server, PERMS.MANAGE_MESSAGES) || can(server, PERMS.KICK_MEMBERS) || can(server, PERMS.BAN_MEMBERS));
// Name color + badge for a member, from their roles in this server.
function roleStyle(server, userId) {
  if (!server || isGroup(server)) return { color: '', badge: null };
  const roles = memberRoles(server, userId);
  const color = server.theme && server.theme.roleColors === false ? '' : topColor(server, userId);
  const iconRole = roles.find((r) => r.icon);
  return { color, top: roles[0] || null, iconRole, owner: server.ownerId === userId };
}
const allEmojis = () => S.servers.flatMap((s) => (s.emojis || []).map((e) => ({ ...e, serverId: s.id, serverName: s.name })));
const emojiToken = (e) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
setResolvers({
  emoji: (id) => allEmojis().find((e) => e.id === id) || null,
  role: (id) => {
    for (const s of S.servers) {
      const r = (s.roleDefs || []).find((x) => x.id === id);
      if (r) return { name: r.name, color: r.color, mine: !!S.me && ((s.memberRoles || {})[S.me.id] || []).includes(id) };
    }
    return null;
  },
  // #channel mentions: only channels this person can see are in S.servers, so anything else stays #unknown-channel.
  channel: (id) => {
    for (const s of S.servers) {
      if (isGroup(s)) continue;
      const c = s.channels.find((x) => x.id === id);
      if (c) return { name: c.name, type: c.type, serverId: s.id };
    }
    return null;
  },
});
// Render an emoji string or a custom emoji token (used for reactions).
function emojiNode(str, cls = '') {
  const m = /^<a?:([A-Za-z0-9_]{2,32}):([a-z0-9]{6,40})>$/.exec(str);
  if (!m) return h('span', { class: cls }, str);
  const e = allEmojis().find((x) => x.id === m[2]);
  return e ? h('img', { class: `cemoji ${cls}`, src: e.url, alt: `:${m[1]}:`, title: `:${m[1]}:` }) : h('span', { class: cls }, `:${m[1]}:`);
}
const isGroup = (server) => !!server && server.kind === 'group';
const realServers = () => S.servers.filter((s) => s.kind !== 'group');
const groups = () => S.servers.filter((s) => s.kind === 'group');
const serverOfChannel = (channelId) => S.servers.find((s) => s.channels.some((c) => c.id === channelId));
// The name someone goes by where it's shown (profile-ui.js displayNameIn): inside a server, their nickname there;
// in DMs, group chats and anywhere outside a server, their display name.
const nameInServer = (server, u) => displayNameIn(server, u);
const serverById = (id) => (id ? S.servers.find((s) => s.id === id) || null : null);
// A message's server (null for DMs), for its author's name.
const msgServer = (m) => (!m || m.dmId ? null : serverById(m.serverId) || (m.channelId ? serverOfChannel(m.channelId) || null : null));
const nameInMsg = (m, u) => displayNameIn(msgServer(m), u);
const channelById = (id) => { for (const s of S.servers) { const c = s.channels.find((x) => x.id === id); if (c) return c; } return null; };

// ---- voice channel chats
// A server's voice channels have a text chat beside the call (a group's call doesn't: the group's own conversation
// is its chat). It's the channel's ordinary messages, so it uses the server's keys like any text channel. It opens
// in the call view's side panel. Its new messages count as unread only for people who follow it: who opened it once
// or wrote there (that leaves a read marker, synced to all their devices), picked "All messages" for it (the server
// then leaves one too), or are in its call right now. The server uses the same rule for pushes. Pings always count.
const hasChat = (c) => !!c && (c.type === 'text' || (c.type === 'voice' && !isGroup(serverOfChannel(c.id))));
const isVoiceChat = (key) => { const c = key && key.startsWith('c:') ? channelById(key.slice(2)) : null; return !!c && c.type === 'voice' && hasChat(c); };
const followsVoiceChat = (c) => !!S.lastRead['c:' + c.id] || (!!voice && voice.channelId === c.id) || (S.notifyPrefs['c:' + c.id] || {}).level === 'all';
// Whether new messages in this channel count as unread for me.
const chatCounts = (c) => !c || c.type !== 'voice' || followsVoiceChat(c);
const countsUnread = (key) => !key.startsWith('c:') || chatCounts(channelById(key.slice(2)));
// How a channel is named in sentences: #general, or 🔊 Lounge for a voice channel's chat.
const chanLabel = (c) => (c && c.type === 'voice' ? `\uD83D\uDD0A ${c.name}` : `#${c ? c.name : 'channel'}`);

// ---- screen sharing: keep DMs private
// While you share your screen, direct messages and group chats are covered (and their previews and pop-up
// notifications hidden), so you can't show a private conversation by accident. "Show while sharing" opens one
// conversation for the rest of this share. Settings → Chat can turn this off.
const shareAllowed = new Set(); // conversation keys shown anyway during the current share
let wasSharing = false;
const isSharing = () => !!(voice && voice.screenStream) && P.chat.hideDmsWhileSharing !== false;
// The conversation key ('d:<dm>' or 'c:<group text channel>') if this view is a private conversation.
function privateKey(v = S.view) {
  if (v.type === 'dm') return 'd:' + v.dmId;
  if (v.type === 'channel') { const s = currentServer(); if (s && isGroup(s)) return 'c:' + v.channelId; }
  return null;
}
const hiddenWhileSharing = (key) => !!key && isSharing() && !shareAllowed.has(key);
function shareChanged() {
  const now = isSharing();
  if (now === wasSharing) return;
  wasSharing = now;
  if (!now) shareAllowed.clear();
  // The chat background goes with the conversation it belongs to (applyServerTheme), and comes back with it; its dialog
  // doesn't stay up either (LOOK.coverChanged).
  applyServerTheme(); LOOK.coverChanged(); renderMain(); renderSidebar(); renderPanel();
  if (now && privateKey()) toast('You\u2019re sharing your screen, so this conversation is hidden from view.');
}
function shareCover(key) {
  const v = S.view;
  const who = v.type === 'dm' ? displayName(getUser((S.dms.find((d) => d.id === v.dmId) || {}).userId)) : groupName(currentServer());
  return h('div', { class: 'share-cover' },
    h('div', { class: 'share-cover-card' }, icon('monitor', 'ic share-cover-ic'),
      h('h2', null, 'Hidden while you share your screen'),
      h('p', null, `Your conversation with ${who} stays private: anyone watching your screen sees this instead.`),
      h('div', { class: 'row gap center' },
        h('button', { class: 'btn primary', onclick: () => { shareAllowed.add(key); applyServerTheme(); renderMain(); renderSidebar(); renderPanel(); } }, 'Show while sharing'),
        h('button', { class: 'btn ghost', onclick: () => toggleScreen() }, 'Stop sharing')),
      h('p', { class: 'field-hint' }, 'Only for this conversation, until you stop sharing. You can turn this off in Settings \u2192 Chat.')));
}

// ---- call regions (like Discord's region override)
// A voice channel or DM call can be pinned to one region's relay; everyone in it switches together.
// null = automatic: direct when possible, otherwise the nearest relays.
function callRegion(room) {
  if (!room) return null;
  if (room.startsWith('dm:')) return (S.dms.find((d) => d.id === room.slice(3)) || {}).region || null;
  return (channelById(room) || {}).region || null;
}
// Regions this server can relay calls through right now: [{ id, name, ms }]
function callRegions() {
  const seen = new Map();
  for (const e of S.iceServers || []) if (e.regionId && !isMemberRelay(e) && !seen.has(e.regionId)) seen.set(e.regionId, { id: e.regionId, name: e.region || 'Relay', ms: relayTime(S.relayRanks, e) });
  return [...seen.values()];
}
const regionName = (id) => (id ? (callRegions().find((r) => r.id === id) || {}).name || 'an offline region' : 'Automatic');
function canSetRegion(room) {
  if (room.startsWith('dm:')) return true;
  const c = channelById(room); const s = c && serverOfChannel(c.id);
  return !!s && (isGroup(s) || can(s, PERMS.MANAGE_CHANNELS));
}
function regionMenuItems(room) {
  const cur = callRegion(room);
  const regions = callRegions();
  const set = (region) => api('POST', '/calls/region', { room, region }).catch((e) => toast(e.message, 'error'));
  const items = [{ header: 'Call region' }];
  if (!canSetRegion(room)) {
    items.push({ label: regionName(cur), icon: 'globe', checked: true, action: () => toast('Only people who can manage this channel can change its region.') });
    return items;
  }
  items.push({ label: 'Automatic', hint: 'fastest for each person', checked: !cur, action: () => set(null) });
  for (const r of regions) items.push({ label: r.name, hint: typeof r.ms === 'number' ? `${r.ms} ms` : '', checked: cur === r.id, action: () => set(r.id) });
  if (cur && !regions.some((r) => r.id === cur)) items.push({ label: 'Pinned region is offline \u2014 using Automatic', icon: 'globe', checked: true, action: () => set(null) });
  return items;
}
function onCallRegion(p) {
  if (!p || typeof p.room !== 'string') return;
  const before = S.callNet && S.callNet.room === p.room ? S.callNet.region : undefined;
  applyCallRegion(p);
  if (voice && voice.channelId === p.room && p.by && before !== undefined && before !== S.callNet.region) {
    const who = p.by === S.me.id ? 'You' : nameInServer(serverOfChannel(p.room), getUser(p.by));
    toast(`${who} moved the call to ${p.region ? regionName(p.region) : 'automatic region'}. Everyone is switching over.`);
  }
}
// Two people switching at once: the server keeps the last one and numbers every change, so a change older than the
// one we have (announcements can arrive out of order) is ignored and everyone ends up on the server's choice.
// True when it changed anything.
function applyCallRegion({ room, region = null, version }) {
  const target = room.startsWith('dm:') ? S.dms.find((x) => x.id === room.slice(3)) : channelById(room);
  if (!target) return false;
  const known = target.regionVersion || 0;
  if (typeof version === 'number' && version < known) return false;
  const changed = (target.region || null) !== (region || null);
  target.region = region || null;
  if (typeof version === 'number') target.regionVersion = version;
  // The call's connections follow the region they were made with: rebuild them when that's no longer the one.
  // (Compared with what they use rather than with the channel, which a server update may have changed already.)
  if (voice && voice.channelId === room) {
    if (!S.callNet || S.callNet.room !== room) S.callNet = { room, region: region || null };
    else if (S.callNet.region !== (region || null)) { S.callNet.region = region || null; voice.switchNetwork(); }
  }
  renderVoicePanel();
  return changed;
}
const textChannel = (server) => server.channels.find((c) => c.type === 'text');

function setView(v) {
  const from = currentKey();
  S.view = v;
  S.editing = null;
  if (S.panel === 'thread' && (!S.thread || S.thread.channelId !== v.channelId)) { S.panel = null; S.thread = null; }
  if (S.panel === 'pins' || (S.panel === 'threads' && (!S.threadsPanel || S.threadsPanel.channelId !== v.channelId))) S.panel = null;
  // Photos & videos belong to their conversation: going to another one closes them (coming back to the same one doesn't).
  if (S.panel === 'media' && (!['channel', 'dm'].includes(v.type) || currentKey() !== from)) S.panel = null;
  // The side view ('side') stays: what's pinned there is from anywhere, and it's there to keep beside another chat. On a
  // phone, where it covers the chat, going to another conversation shows that conversation instead.
  if (S.panel === 'side' && isPhoneLayout() && currentKey() !== from) S.panel = null;
  // A DM's profile and a member list are two choices: going from a channel to a DM or back, the panel stays open only
  // if it's shown where you're going too.
  if (S.panel === 'members' && (v.type === 'dm' ? !P.showDmProfile : v.type === 'channel' && !P.showMembers)) S.panel = null;
  if (S.panel === null && (v.type === 'channel' || v.type === 'dm')) S.panel = restingPanel(v);
  document.body.classList.remove('nav-open');
  // Going somewhere draws the side panel afresh (a voice chat panel otherwise stays as it is through redraws).
  const panelEl = $('#members');
  if (panelEl) delete panelEl.dataset.key;
  if (v.type === 'channel') { const lc = new Map(Object.entries(P.lastChannel)); lc.set(v.serverId, v.channelId); P.lastChannel = Object.fromEntries(lc); }
  // Where "New messages" goes: the read marker as it was when you opened the conversation.
  const ck = currentKey();
  S.unreadMarker = ck && S.unread.has(ck) ? ck : null;
  // (A voice chat you never opened, that turned unread while you were in its call: from the last message before that.)
  S.markerId = S.unreadMarker ? S.lastRead[ck] || S.chatFloor[ck] || '0' : null;
  S.markerCount = S.unreadMarker ? S.unreadCounts && S.unreadCounts[ck] || 0 : 0;
  renderAll();
  markRead(currentKey());
}
function goHome() { setView({ type: 'home' }); }
function goFriends(tab = 'online') { setView({ type: 'friends', tab }); }
function openDm(dmId) { setView({ type: 'dm', dmId }); }
async function openDmWith(userId) {
  try {
    // Only a conversation with exactly the person asked for, remembered as being with them before it's shown
    // (secure.js dmWith): never whichever one the server answers with.
    const d = sec.dmWith(await api('POST', '/dms', { userId }), userId);
    if (!S.dms.find((x) => x.id === d.id)) S.dms.unshift(d);
    if (d.look !== undefined) LOOK.onEvent('dm:look', { dmId: d.id, look: d.look }); // its chat background (chat-look.js)
    openDm(d.id);
  } catch (e) { toast(e.message, 'error'); }
}
function openServer(serverId) {
  const s = S.servers.find((x) => x.id === serverId);
  if (!s) return;
  const last = P.lastChannel[serverId];
  const c = s.channels.find((x) => x.id === last && x.type === 'text') || orderedChannels(s).find((x) => x.type === 'text');
  if (c) openChannel(c.id, s.id); else setView({ type: 'empty-server', serverId });
}
// Where a channel's messages are read: its own view, or for a voice channel the call view with the chat open beside it
// (from a notification, a message link, a search result...).
function channelView(channelId, serverId, extra = {}) {
  const c = channelById(channelId);
  return c && c.type === 'voice' && hasChat(c) ? { type: 'voice', channelId, serverId, chat: true, ...extra } : { type: 'channel', channelId, serverId, ...extra };
}
function openChannel(channelId, serverId) { setView(channelView(channelId, serverId)); }
function openVoiceRoom(channelId, serverId, { chat = P.voiceChat } = {}) { setView({ type: 'voice', channelId, serverId, chat: !!chat && hasChat(channelById(channelId)) }); }
// The chat button in the call view's header (and the chat panel's close button): remembered for the next call.
function toggleVoiceChat(on = !S.view.chat) {
  if (S.view.type !== 'voice') return;
  P.voiceChat = on;
  // From the keyboard (the header's button or the panel's close button): focus stays on the chat button, not lost
  // with the redraw.
  const keep = !!(document.activeElement && document.activeElement.closest('#main-head, #members'));
  setView({ ...S.view, chat: on && hasChat(channelById(S.view.channelId)), jumpTo: undefined });
  const b = keep && $('#main-head .voice-chat-btn');
  if (b) b.focus({ preventScroll: true });
}
function openGroup(serverId) {
  const s = S.servers.find((x) => x.id === serverId);
  const c = s && textChannel(s);
  if (c) openChannel(c.id, s.id);
}
function openMessages() {
  const recent = conversations()[0];
  if (recent) recent.open(); else goFriends();
}

// ======================================================================= unread + notification levels
// Levels: 'all' | 'mentions' | 'muted'. Channels inherit from their server unless set.
// The preferences live on the server (so push follows them too) and sync to your other devices. 'none' there
// is 'muted' here; "mute for a while" (muteUntil) counts as muted until it runs out.
const mutedFor = (p) => !!(p && p.muteUntil && p.muteUntil > Date.now());
function notifyLevel(key) {
  const own = S.notifyPrefs[key];
  const srv = key.startsWith('c:') ? serverOfChannel(key.slice(2)) : null;
  const sp = srv ? S.notifyPrefs['s:' + srv.id] : null;
  if (mutedFor(own) || mutedFor(sp)) return 'muted';
  const pick = (p) => (p && p.level !== 'default' ? p.level : null);
  const lvl = pick(own) || pick(sp) || 'all';
  return lvl === 'none' ? 'muted' : lvl;
}
// Does @everyone ping me here? Not when I've switched that off for the channel or its server.
function everyoneMuted(key) {
  const srv = key.startsWith('c:') ? serverOfChannel(key.slice(2)) : null;
  return !!((S.notifyPrefs[key] || {}).suppressEveryone || (srv && (S.notifyPrefs['s:' + srv.id] || {}).suppressEveryone));
}
function applyNotifyPref(r) {
  if (!r || !r.target) return;
  if (r.level === 'default' && !r.muteUntil && !r.suppressEveryone) delete S.notifyPrefs[r.target];
  else S.notifyPrefs[r.target] = { level: r.level, muteUntil: r.muteUntil || null, suppressEveryone: !!r.suppressEveryone };
  later(renderSidebar); later(renderRail); later(renderHeader);
}
async function setNotify(key, level, extra = {}) {
  const body = { ...extra };
  if (level !== undefined) body.level = level === 'muted' ? 'none' : level;
  try { applyNotifyPref(await api('PUT', `/me/notify/${encodeURIComponent(key)}`, body)); } catch (e) { toast(e.message, 'error'); }
}
async function setNotifySettings(body) {
  const r = await api('PUT', '/me/notify-settings', body);
  S.notifySettings = { dnd: r.dnd, tz: r.tz, previews: r.previews };
  syncCallNotification();
  return r;
}
// Do Not Disturb: the status, or quiet hours right now.
const quiet = () => S.me.status === 'dnd' || quietNow(S.notifySettings);
// Unread state, preferences and saved ids from the server, at start-up.
function applyUserState([unread, notify, savedIds]) {
  if (notify) { S.notifyPrefs = notify.prefs || {}; S.notifySettings = notify.settings || S.notifySettings; migrateLocalNotify(); syncTimeZone(); }
  if (savedIds) { S.savedIds = new Set(savedIds); migrateLocalSaved(); }
  if (unread) { S.unreadCounts = {}; S.threadMentions = new Map(); for (const [conv, st] of Object.entries(unread.states || {})) applyReadState(conv, st); }
  updateTitle();
}
function applyReadState(conv, st) {
  if (!st) return;
  if (conv.startsWith('t:')) return applyThreadState(st);
  if (st.lastReadId) S.lastRead[conv] = st.lastReadId;
  if (st.lastId) S.lastIds[conv] = st.lastId;
  (S.unreadCounts ||= {})[conv] = st.unread || 0;
  if (st.unread > 0) S.unread.add(conv); else S.unread.delete(conv);
  if (st.mentions > 0 && notifyLevel(conv) !== 'muted') S.mentions.set(conv, st.mentions); else S.mentions.delete(conv);
  if (st.threadMentions !== undefined) setThreadPings(conv, st.threadMentions);
  // "Mark as read" on the channel (here or on another device) took its threads with it.
  if (st.threadsRead) clearThreads(conv.slice(2));
}

// ---- threads: your read state per thread, and the pings in a channel's threads
// Reading a channel leaves its threads alone (each has its own marker, moved by opening the thread). Pings in a
// thread count in its channel's badge until then; "Mark as read" on the channel or server clears those too.
function setThreadPings(key, n) { if (n > 0) S.threadMentions.set(key, n); else S.threadMentions.delete(key); }
const threadPings = (key) => (notifyLevel(key) === 'muted' ? 0 : S.threadMentions.get(key) || 0);
// What a channel's badge counts: its own mentions plus the pings in its threads.
const mentionsOf = (key) => (S.mentions.get(key) || 0) + (key.startsWith('c:') ? threadPings(key) : 0);
// One thread's state from the server (a page of messages, the Threads panel, or a read on another device).
function applyThreadState(st, { quiet = false } = {}) {
  if (!st || !st.rootId) return;
  S.threadState[st.rootId] = { channelId: st.channelId, unread: st.unread || 0, mentions: st.mentions || 0, lastReadId: st.lastReadId || null, lastId: st.lastId || null };
  if (st.threadMentions !== undefined && st.channelId) setThreadPings('c:' + st.channelId, st.threadMentions);
  if (!quiet) refreshThreadBits(st.rootId, st.channelId);
}
// The thread states that come with a page of channel messages ({ rootId: state }); the page is drawn next.
function applyThreadStates(map) {
  const list = Object.values(map || {});
  list.forEach((st) => applyThreadState(st, { quiet: true }));
  if (list.length) later(renderHeader);
}
function clearThreads(channelId) {
  let any = false;
  for (const [id, t] of Object.entries(S.threadState)) if (t.channelId === channelId && (t.unread || t.mentions)) { t.unread = 0; t.mentions = 0; any = true; refreshThreadBits(id, channelId, false); }
  if (S.threadsPanel && S.threadsPanel.channelId === channelId) S.threadsPanel.items.forEach((x) => { x.unread = 0; x.mentions = 0; });
  if (any || S.threadsPanel) { redrawThreads(); if (S.view.channelId === channelId) later(renderHeader); }
}
// Redraws what shows a thread's state: the line under the message that starts it, the Threads panel and button, and
// the badges.
function refreshThreadBits(rootId, channelId, badges = true) {
  const store = S.msgs['c:' + channelId];
  const m = store && store.list.find((x) => x.id === rootId);
  if (m && currentKey() === 'c:' + channelId) replaceMessageEl(m);
  const tp = S.threadsPanel;
  const item = tp && tp.channelId === channelId && tp.items.find((x) => x.rootId === rootId);
  if (item) { const st = S.threadState[rootId]; item.unread = st.unread; item.mentions = st.mentions; redrawThreads(); }
  if (!badges) return;
  if (S.view.channelId === channelId) later(renderHeader);
  updateTitle(); later(renderRail); later(renderSidebar);
}
// Read on another device (or another tab): same badges here, and its notifications go away.
function onReadUpdate(st) {
  // (Not before the start-up data is in: a connection made a moment earlier, say just after a reload or a new
  // sign-in token, can get one from another tab first. The start-up data brings the read state anyway.)
  if (!st || !st.conv || !S.me) return;
  applyReadState(st.conv, st);
  if (!st.unread) closeNotifications(st.conv);
  updateTitle(); later(renderRail); later(renderSidebar);
  if (S.view.type === 'home') later(renderMain);
  if (S.view.type === 'voice') later(renderHeader); // the chat button's badge
}
// Preferences and saved messages used to be kept only in this browser. The first time this device sees the
// server's (empty) copy, it hands its own over (ids and levels only: the saved text it kept is deleted).
function migrateLocalNotify() {
  const k = mine('notify');
  let old = null;
  try { old = JSON.parse(localStorage.getItem(k) || 'null'); } catch { /* none */ }
  if (!old || typeof old !== 'object') return;
  localStorage.removeItem(k); lsCache.delete(k);
  if (Object.keys(S.notifyPrefs).length) return;
  for (const [key, lvl] of Object.entries(old).slice(0, 100)) if (/^[scd]:/.test(key) && ['all', 'mentions', 'muted'].includes(lvl)) setNotify(key, lvl);
}
function migrateLocalSaved() {
  const k = mine('saved');
  let old = null;
  try { old = JSON.parse(localStorage.getItem(k) || 'null'); } catch { /* none */ }
  localStorage.removeItem(mine('lastRead')); lsCache.delete(mine('lastRead'));
  if (!Array.isArray(old)) return;
  localStorage.removeItem(k); lsCache.delete(k);
  for (const it of old.slice(0, 200).reverse()) if (it && it.msgId && !S.savedIds.has(it.msgId)) api('PUT', `/me/saved/${it.msgId}`, {}).then(() => S.savedIds.add(it.msgId)).catch(() => {});
}
// Quiet hours follow your clock: the server needs your time zone to know when they start.
function syncTimeZone() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
  if (tz && tz !== S.notifySettings.tz) setNotifySettings({ tz }).catch(() => {});
}
const isMuted = (key) => notifyLevel(key) === 'muted';
function serverUnread(s) {
  let unread = false;
  let mentions = 0;
  for (const c of s.channels) {
    const k = 'c:' + c.id;
    mentions += mentionsOf(k);
    if (S.unread.has(k) && notifyLevel(k) === 'all' && chatCounts(c)) unread = true;
  }
  if (notifyLevel('s:' + s.id) === 'muted') unread = false;
  return { unread, mentions };
}
// The read marker is saved on the server (a moment after it moves, so scrolling through a busy channel is one
// request), which tells your other devices.
const readSync = new Map(); // key -> timer
// threads: "Mark as read" on a channel, which takes its threads with it (sent straight away, so a later scroll
// can't replace it with a plain read).
function syncRead(key, messageId, unread = false, threads = false) {
  clearTimeout(readSync.get(key));
  const go = () => { readSync.delete(key); api('POST', '/me/read', { conv: key, messageId, ...(unread ? { unread: true } : {}), ...(threads ? { threads: true } : {}) }).catch(() => {}); };
  if (unread || threads) go(); else readSync.set(key, setTimeout(go, 600));
}
function markRead(key) {
  if (!key || document.hidden) return;
  const st = S.msgs[key];
  // A voice channel's chat opened before anyone wrote in it: the marker '0' (before every message) says you opened
  // it, so what's written there next counts as unread for you, on all your devices.
  if (st && st.loaded && !st.list.length && !S.lastRead[key] && isVoiceChat(key)) { S.lastRead[key] = '0'; syncRead(key, '0'); }
  const lastId = st && st.list.length && !st.hasNewer ? st.list[st.list.length - 1].id : null;
  const badges = S.unread.has(key) || S.mentions.has(key);
  // Called on every scroll near the bottom: only do the work when something actually changes.
  if (!badges && (!lastId || (S.lastRead[key] && S.lastRead[key] >= lastId))) return;
  if (lastId && !(S.lastRead[key] && S.lastRead[key] >= lastId)) { S.lastRead[key] = lastId; syncRead(key, lastId); }
  // Only unread dots and mention counts show in the server bar and channel list.
  if (!badges) return;
  S.unread.delete(key);
  S.mentions.delete(key);
  if (S.unreadCounts) S.unreadCounts[key] = 0;
  closeNotifications(key);
  updateTitle();
  later(renderRail);
  later(renderSidebar);
}
// "Mark as read" from a menu: up to the newest message we know of, loaded or not. A channel's menus take its threads
// with it; the bar over the messages (threads: false) speaks of the channel's own messages, so it marks only those.
function markConvRead(key, { threads: withThreads = true } = {}) {
  const st = S.msgs[key];
  const lastId = (st && st.list.length && !st.hasNewer && st.list[st.list.length - 1].id) || S.lastIds[key];
  const threads = withThreads && key.startsWith('c:');
  // A voice chat you never opened, from a menu: its pings are read, and it stays that way (marking it read isn't
  // opening it). One on screen is open, so that's an ordinary read.
  if (lastId && isVoiceChat(key) && !S.lastRead[key] && currentKey() !== key) { S.chatFloor[key] = lastId; api('POST', '/me/read', { conv: key, messageId: lastId, pings: true }).catch(() => {}); }
  else if (lastId) { S.lastRead[key] = lastId; syncRead(key, lastId, false, threads); }
  S.unread.delete(key); S.mentions.delete(key);
  if (threads) { S.threadMentions.delete(key); clearThreads(key.slice(2)); }
  if (S.unreadCounts) S.unreadCounts[key] = 0;
  if (S.unreadMarker === key) { S.unreadMarker = null; if (currentKey() === key) renderMessages(false); }
  closeNotifications(key);
  renderSidebar(); renderRail(); updateTitle();
}
async function markServerRead(server) {
  server.channels.forEach((c) => { S.unread.delete('c:' + c.id); S.mentions.delete('c:' + c.id); S.threadMentions.delete('c:' + c.id); clearThreads(c.id); });
  renderAll(); updateTitle();
  try { (await api('POST', `/servers/${server.id}/read`)).states.forEach((st) => applyReadState(st.conv, st)); } catch (e) { toast(e.message, 'error'); }
}
function markUnread(key, msgId) {
  const store = S.msgs[key];
  const i = store ? store.list.findIndex((m) => m.id === msgId) : -1;
  const id = i > 0 ? store.list[i - 1].id : '0';
  S.lastRead[key] = id;
  S.unread.add(key);
  S.unreadMarker = key; S.markerId = id;
  S.markerCount = store ? store.list.filter((m) => m.id > id && m.authorId !== S.me.id).length : 0;
  syncRead(key, id, true);
  updateTitle(); renderRail(); renderSidebar();
  if (currentKey() === key) renderMessages(false);
}
function updateTitle() {
  let n = 0;
  S.mentions.forEach((c) => { n += c; });
  S.threadMentions.forEach((c, k) => { n += threadPings(k); });
  const inbox = P.inbox.filter((x) => !x.read).length;
  document.title = (n ? `(${n}) ` : '') + (S.config.name || 'Hearth');
  if (window.hearthDesktop) window.hearthDesktop.setBadge(n);
  if (navigator.setAppBadge && isStandalone()) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  const b = $('#rail .inbox-badge');
  if (b) { b.textContent = inbox > 99 ? '99+' : inbox; b.hidden = !inbox; }
}

// ======================================================================= notification center (kept on this device)
function addInbox(entry) {
  if (!S.me || loggingOut) return; // signing out clears the inbox from this browser
  const list = P.inbox;
  list.unshift({ id: Math.random().toString(36).slice(2), at: Date.now(), read: false, ...entry });
  P.inbox = list;
  updateTitle();
  if (entry.exp) armClientExpiry();
}
// Inbox entries keep a copy of a message's words on this device: one for a disappearing message goes with it (exp,
// in the server's time), and so does one whose message disappeared (gone: ids).
function purgeInbox(gone = new Set()) {
  if (!S.me) return;
  const list = P.inbox;
  const t = nowServer();
  const keep = list.filter((x) => !(x.exp && x.exp <= t) && !(x.msgId && gone.has(x.msgId)));
  if (keep.length !== list.length) { P.inbox = keep; updateTitle(); }
}
function openInbox(anchor) {
  let tab = 'all';
  const body = h('div', { class: 'inbox-list' });
  const tabs = h('div', { class: 'seg' });
  const draw = () => {
    clear(tabs);
    [['all', 'All'], ['mention', 'Mentions'], ['reply', 'Replies'], ['friend', 'Friends']].forEach(([k, l]) => tabs.append(
      h('button', { class: `seg-btn${tab === k ? ' active' : ''}`, onclick: () => { tab = k; draw(); } }, l)));
    clear(body);
    const items = P.inbox.filter((x) => tab === 'all' || x.type === tab);
    if (!items.length) { body.append(h('div', { class: 'panel-empty' }, icon('inbox'), h('p', null, 'You\u2019re all caught up.'))); return; }
    let lastGroup = '';
    for (const it of items) {
      const g = dayGroup(it.at);
      if (g !== lastGroup) { body.append(h('div', { class: 'inbox-day' }, g)); lastGroup = g; }
      const u = it.userId ? getUser(it.userId) : null;
      body.append(h('button', {
        class: `inbox-item${it.read ? '' : ' unread'}`,
        onclick: () => {
          closePopover();
          const list = P.inbox; const x = list.find((y) => y.id === it.id); if (x) x.read = true; P.inbox = list; updateTitle();
          if (it.msgId) jumpToMessageId(it.msgId); else if (it.type === 'friend') goFriends(it.title.includes('accepted') ? 'all' : 'pending');
        },
      }, u ? avatarEl(u, 32) : h('span', { class: 'inbox-ic' }, icon('bell')),
      h('span', { class: 'inbox-text' }, h('strong', null, it.title), it.text ? h('span', { class: 'inbox-snippet' }, it.text) : null,
        h('span', { class: 'inbox-time' }, relTime(it.at)))));
    }
  };
  draw();
  const el = h('div', { class: 'inbox' },
    h('div', { class: 'inbox-head' }, h('h3', null, 'Notifications'),
      h('button', { class: 'link-btn', onclick: () => { P.inbox = P.inbox.map((x) => ({ ...x, read: true })); updateTitle(); draw(); } }, 'Mark all read'),
      ibtn('trash', 'Clear all', () => { P.inbox = []; updateTitle(); draw(); }, { cls: 'sm' })),
    tabs, body);
  popover(anchor, el, { side: anchor.closest('#rail') ? railSide() : 'bottom', className: 'pop-inbox' });
}
function dayGroup(ts) {
  const d = new Date(ts); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtStamp(ts);
}

// ======================================================================= keyboard
// Every key here is in the shortcuts sheet (keybinds.js SHORTCUTS; test/shortcuts-client.test.js checks).
function globalKeys(e) {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openSearch(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '/') { e.preventDefault(); openShortcuts(); return; }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); stepChannel(e.key === 'ArrowUp' ? -1 : 1); }
  // Shift+Esc: mark the whole server you're in as read (not a group chat, and not while a dialog or menu is open).
  if (e.shiftKey && e.key === 'Escape') {
    const server = currentServer();
    if (server && !isGroup(server) && !document.querySelector('.modal-backdrop, .popover')) {
      e.preventDefault();
      markServerRead(server);
      toast(`Marked ${server.name} as read.`);
      return;
    }
  }
  if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .popover, .sheet-backdrop')) {
    // Phones: the navigation drawer closes first, and focus goes back to the button that opened it.
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); const t = $('.nav-toggle'); if (t) t.focus(); }
    // Phones: the side panel covers the conversation, so it closes next (beside the chat on wider screens, it stays).
    else if (isPhoneLayout() && panelMode()) closePanel();
    // Picking messages to delete ends first (wherever focus is: often the bar's own buttons), and only that.
    else if (S.select) { e.preventDefault(); endSelect({ refocus: true }); }
    else if (S.editing) { S.editing = null; renderMessages(false); }
    else if (composers.main && composers.main.state.replyTo) composers.main.setReply(null);
    else if (S.panel === 'thread') closeThread();
  }
}
// Ctrl+/ (⌘+/ on a Mac), Settings → Keybinds or the user menu: every shortcut, with this person's own call keys.
// Pressed again while it's open, it closes.
function openShortcuts() {
  const open = document.querySelector('.modal-backdrop:not(.closing) .shortcuts-modal');
  if (open) { open.closest('.modal-backdrop')._close(); return; }
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const combo = (c) => h('span', { class: 'sc-combo' }, comboParts(c).map((key, i) => [i ? h('span', { class: 'sc-plus', 'aria-hidden': 'true' }, '+') : null, h('kbd', null, keyName(key, mac))]));
  const keys = (list) => (list.length ? list.map((c, i) => [i ? h('span', { class: 'sc-or' }, i === list.length - 1 ? ' or ' : ', ') : null, combo(c)]) : h('span', { class: 'sc-none' }, '\u2014'));
  modal({
    title: 'Keyboard shortcuts', size: 'md', className: 'shortcuts-modal',
    body: h('div', { class: 'sc-groups' }, shortcutGroups({ enterSends: P.chat.enterToSend !== false }).map(([group, rows]) => h('section', { class: 'sc-group' },
      h('h3', { class: 'set-h' }, group),
      h('dl', { class: 'sc-list' }, rows.map(([list, what]) => h('div', { class: 'sc-row' }, h('dt', null, keys(list)), h('dd', null, what))))))),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}
// Alt+↑/↓ moves through the channels of the current sidebar.
function stepChannel(dir) {
  const rows = $$('#sidebar-body [data-nav]');
  const i = rows.findIndex((r) => r.classList.contains('active'));
  const next = rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
  if (next) next.click();
}

// ======================================================================= render: shell
function applyServerTheme() {
  const server = currentServer();
  // A DM or group chat shows the background someone there set (chat-look.js), while this device shows them (LOOK.themeFor
  // is null otherwise). A server's own theme never passes for one: "Show server themes" is the switch for it. Not while
  // the conversation is covered because you're sharing your screen: its background is the app's backdrop, which shows
  // around and through the cover, so it's as private as the conversation.
  setServerTheme(server && !isGroup(server) ? server.theme && { ...server.theme, chat: false } : hiddenWhileSharing(privateKey()) ? null : LOOK.themeFor(S.view));
}
function renderAll() {
  applyServerTheme();
  const showPanel = !!panelMode();
  document.body.classList.toggle('panel-open', showPanel);
  renderRail();
  renderSidebar();
  renderMain();
  renderPanel();
  renderUserPanel();
  renderVoicePanel();
  updateTitle();
}
// What the right panel should show for the current view (or null).
function panelMode() {
  if (S.panel === 'thread' && S.thread) return 'thread';
  // The call view's side panel is the voice channel's chat (or the chat's pinned messages), while it's open.
  if (S.view.type === 'voice') return S.view.chat ? (S.panel === 'pins' ? 'pins' : 'chat') : null;
  if (!['channel', 'dm'].includes(S.view.type)) return null;
  return S.panel;
}
// The panel a channel or DM opens with, and goes back to when nothing else is open in it: a server's or group chat's
// member list, or a DM's profile, each as you last left it on this device. Only where it fits beside the chat: a
// narrower window or a phone opens it when asked.
function restingPanel(v = S.view) {
  if (!wideEnoughForPanel()) return null;
  if (v.type === 'dm') return P.showDmProfile ? 'members' : null;
  return v.type === 'channel' && P.showMembers ? 'members' : null;
}

// Which way popups from the server bar should open (it can sit left, right or on top).
function railSide() {
  const d = document.documentElement.dataset;
  return d.rail === 'top' ? 'bottom' : d.railSide === 'right' ? 'left' : 'right';
}

// ---- resizable sidebar / side panel (drag the inner edge, double-click to reset, arrow keys too)
function resizeHandle(which) {
  const el = h('div', { class: 'resize-handle', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': which === 'sidebar' ? 'Resize sidebar' : 'Resize side panel', 'data-tip': 'Drag to resize \u00b7 double-click to reset' });
  const cfg = () => {
    const d = document.documentElement.dataset;
    if (which === 'sidebar') return { key: 'sideW', v: '--side-w', min: 200, max: 420, def: 256, dir: d.sidebarSide === 'right' ? -1 : 1, box: $('#sidebar') };
    // Conversations in the panel share one width, and Photos & videos (a grid of them) and the side view take it too.
    const thread = panelMode() === 'thread' || panelMode() === 'chat' || panelMode() === 'media' || panelMode() === 'side';
    return { key: thread ? 'threadW' : 'panelW', v: thread ? '--thread-w' : '--members-w', min: thread ? 300 : 220, max: thread ? 680 : 520, def: thread ? 400 : 272, dir: d.panelSide === 'left' ? 1 : -1, box: $('#members') };
  };
  const save = (key, w) => { const a = loadAppearance(); a.layout[key] = Math.round(w); saveAppearance(a); };
  el.addEventListener('pointerdown', (e) => {
    const c = cfg();
    const startX = e.clientX;
    const startW = c.box.getBoundingClientRect().width;
    let w = startW;
    el.setPointerCapture(e.pointerId);
    el.classList.add('active'); document.body.classList.add('resizing');
    const move = (ev) => { w = Math.min(c.max, Math.max(c.min, startW + c.dir * (ev.clientX - startX))); document.documentElement.style.setProperty(c.v, w + 'px'); };
    const up = () => { el.removeEventListener('pointermove', move); el.classList.remove('active'); document.body.classList.remove('resizing'); save(c.key, w); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
  });
  el.addEventListener('dblclick', () => { const c = cfg(); save(c.key, c.def); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const c = cfg();
    const w = c.box.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16) * c.dir;
    save(c.key, Math.min(c.max, Math.max(c.min, w)));
  });
  return el;
}

// ---- server rail: rounded tiles, favorites first
const serverIconEl = (s) => (s.icon ? h('img', { src: s.icon, alt: '' }) : h('span', { class: 'rail-initials', style: s.theme && s.theme.accent ? { color: s.theme.accent } : null }, s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)));
const updates = createUpdates({
  S, mediaSrc: (src) => mediaSrc(src),
  onUnread: () => { if (!S.view.serverId) renderSidebar(); renderRail(); },
});
// Study tools: Recall in a sandboxed frame, with its decks end-to-end encrypted and synced (recall-host.js).
// Input in its frame doesn't reach this page, so the frame says when it's in use (for automatic Away, and so an update
// waits; while Study is open an update waits anyway: updateBlockedBy).
const study = createRecall({ S, vaultKey: () => myVaultKey(), onEnabled: () => { if (!S.view.serverId) renderSidebar(); }, onActive: () => { if (away) away.used(); autoUpdate.input(); } });
const folders = createFolders({
  S, servers: () => realServers(), favorites: () => new Set(P.favorites.filter((f) => f.startsWith('s:')).map((f) => f.slice(2))),
  rerender: () => renderRail(), serverUnread: (s) => serverUnread(s), setNotify: (k, v) => setNotify(k, v), railSide: () => railSide(),
  markServerRead: (server) => markServerRead(server),
  serverIcon: (s) => serverIconEl(s),
});
function renderRail() {
  const rail = clear($('#rail'));
  if (!S.me) return;
  const dmUnread = S.dms.reduce((n, d) => n + (S.mentions.get('d:' + d.id) || 0), 0) + groups().reduce((n, g) => n + serverUnread(g).mentions, 0);
  const pending = Object.values(S.relationships).filter((r) => r.direction === 'incoming').length;
  const homeActive = !S.view.serverId || isGroup(currentServer());
  const tile = (opts) => h('div', { class: `rail-item${opts.active ? ' active' : ''}${opts.unread ? ' unread' : ''}` },
    h('span', { class: 'pill', 'aria-hidden': 'true' }),
    h('button', {
      class: `rail-btn ${opts.cls || ''}${opts.active ? ' active' : ''}`,
      'aria-label': opts.label, 'data-tip': opts.label, 'data-tip-side': railSide(), 'aria-current': opts.active ? 'page' : null,
      onclick: opts.onclick, oncontextmenu: opts.oncontext, 'data-pop-anchor': opts.anchor ? '' : null,
    }, opts.content, opts.badge ? h('span', { class: 'badge', 'aria-label': `${opts.badge} unread` }, opts.badge > 99 ? '99+' : opts.badge) : null));

  rail.append(
    tile({ label: 'Home', cls: 'home', active: homeActive && S.view.type !== 'dm' && !isGroup(currentServer()), onclick: goHome, content: icon('flame'), badge: pending + (S.me.updatesUnread || 0) }),
    tile({ label: 'Direct messages', cls: 'nav', active: S.view.type === 'dm' || isGroup(currentServer()), onclick: openMessages, content: icon('message'), badge: dmUnread }),
    h('div', { class: 'rail-item' }, h('button', {
      class: 'rail-btn nav', 'aria-label': 'Notifications', 'data-tip': 'Notifications', 'data-tip-side': railSide(), 'data-pop-anchor': '',
      onclick: (e) => openInbox(e.currentTarget),
    }, icon('bell'), h('span', { class: 'badge inbox-badge', hidden: true }))),
    ...(S.me.staffRole ? [tile({ label: 'Admin', cls: 'nav', active: S.view.type === 'admin', onclick: () => setView({ type: 'admin', tab: S.adminReports ? 'reports' : 'overview' }), content: icon('shield'), badge: S.adminReports })] : []),
    h('div', { class: 'rail-sep', role: 'separator' }),
  );
  // Favorites first, then your folders and the rest in your own order (see folders.js).
  const favs = P.favorites;
  const serverTile = (s, inFolder) => {
    const { unread, mentions } = serverUnread(s);
    return tile({
      label: s.name + (favs.includes('s:' + s.id) ? ' (favorite)' : ''),
      active: S.view.serverId === s.id, unread,
      onclick: () => openServer(s.id),
      oncontext: (e) => contextMenu(e, serverMenuItems(s)),
      cls: `shape-${(s.theme && s.theme.iconShape) || 'rounded'}`,
      content: serverIconEl(s),
      badge: mentions,
    });
  };
  const favServers = realServers().filter((s) => favs.includes('s:' + s.id));
  favServers.forEach((s) => rail.append(serverTile(s)));
  if (favServers.length) rail.append(h('div', { class: 'rail-sep thin', role: 'separator' }));
  folders.render(rail, serverTile);
  rail.append(
    tile({ label: 'Add a server', cls: 'add', onclick: openAddServer, oncontext: (e) => contextMenu(e, [{ label: 'Organize servers\u2026', icon: 'folder', action: () => folders.openOrganize() }]), content: icon('plus') }),
  );
  updateTitle();
}

// ---- sidebar
// Redraws replace the sidebar's buttons. When one of a server's channels or categories had keyboard focus (after Move
// up in its menu, opening a category, or a live update from someone else), this finds it again among the new ones.
function sidebarFocus() {
  const el = document.activeElement;
  const body = $('#sidebar-body');
  if (!el || !body || !body.contains(el) || !window.CSS || !CSS.escape) return null;
  const row = el.closest('[data-cid]');
  if (row) return `[data-cid="${CSS.escape(row.dataset.cid)}"] ${el.classList.contains('ch-gear') ? '.ch-gear' : '.ch-main'}`;
  const group = el.closest('.cat-group');
  if (group && el.classList.contains('cat-toggle')) return `.cat-group[data-cat="${CSS.escape(group.dataset.cat)}"] .cat-toggle`;
  return null;
}
function renderSidebar() {
  const focused = sidebarFocus();
  const head = clear($('#sidebar-head'));
  head.classList.remove('has-banner');
  const body = clear($('#sidebar-body'));
  if (!S.me) return;
  const server = currentServer();
  if (server && !isGroup(server)) {
    renderServerSidebar(server, head, body);
    // Back on the same channel or category, now drawn anew.
    const el = focused && body.querySelector(focused);
    if (el) el.focus({ preventScroll: true });
    return;
  }
  // Home / messages sidebar
  head.append(h('button', { class: 'find-btn', onclick: () => openSearch(), 'aria-label': 'Search (Ctrl+K)' }, icon('search'), h('span', null, 'Search or jump to\u2026'), h('kbd', null, 'Ctrl K')));
  const pending = Object.values(S.relationships).filter((r) => r.direction === 'incoming').length;
  const nav = (label, ic, active, onclick, badge) => h('button', { class: `nav-row${active ? ' active' : ''}`, 'data-nav': '', onclick }, icon(ic), h('span', null, label), badge ? h('span', { class: 'badge inline' }, badge) : null);
  body.append(
    nav('Home', 'home', S.view.type === 'home', goHome),
    nav('Friends', 'people', S.view.type === 'friends', () => goFriends(pending ? 'pending' : 'online'), pending),
  );
  // The less-used pages sit behind one "More" row so the sidebar stays about your conversations.
  const extras = [
    nav('Updates', 'rss', S.view.type === 'updates', () => setView({ type: 'updates' }), S.me.updatesUnread || 0),
    S.me.studyEnabled ? nav('Study', 'graduation', S.view.type === 'study', () => setView({ type: 'study' })) : null,
    nav('People', 'user', S.view.type === 'people', () => setView({ type: 'people' })),
    nav('Saved messages', 'bookmark', S.view.type === 'saved', () => setView({ type: 'saved' })),
  ].filter(Boolean);
  const extraActive = ['updates', 'study', 'people', 'saved'].includes(S.view.type);
  let moreOpen = extraActive;
  try { moreOpen = moreOpen || localStorage.getItem('hearth.navMore') === '1'; } catch { /* storage blocked */ }
  const moreBox = h('div', { class: 'nav-more', id: 'nav-more', hidden: !moreOpen }, extras);
  body.append(h('button', {
    class: `nav-row nav-more-btn${moreOpen ? ' open' : ''}`, 'aria-expanded': String(moreOpen), 'aria-controls': 'nav-more',
    onclick: (e) => {
      const open = moreBox.hidden;
      moreBox.hidden = !open;
      e.currentTarget.classList.toggle('open', open);
      e.currentTarget.setAttribute('aria-expanded', String(open));
      try { localStorage.setItem('hearth.navMore', open ? '1' : '0'); } catch { /* storage blocked */ }
    },
  }, icon('chevronRight'), h('span', null, 'More'),
  !moreOpen && S.me.updatesUnread ? h('span', { class: 'badge inline' }, S.me.updatesUnread) : null), moreBox);
  const convs = conversations();
  const favs = P.favorites;
  const pinned = convs.filter((c) => favs.includes(c.fav));
  if (pinned.length) {
    body.append(h('div', { class: 'group-label' }, h('span', null, 'Pinned')));
    pinned.forEach((c) => body.append(convRow(c)));
  }
  body.append(h('div', { class: 'group-label' }, h('span', null, 'Direct messages'),
    ibtn('plus', 'New message or group chat', (e) => menu(e.currentTarget, [
      { label: 'New message', icon: 'message', action: () => openNewConversation() },
      { label: 'New group chat', icon: 'people', action: () => openNewConversation(null, { group: true }) },
    ], { align: 'end' }), { cls: 'sm', attrs: { 'data-pop-anchor': '' } })));
  const rest = convs.filter((c) => !favs.includes(c.fav));
  if (!rest.length && !pinned.length) body.append(h('p', { class: 'sidebar-empty' }, 'No conversations yet. Start one with a friend or someone from a server.'));
  rest.forEach((c) => body.append(convRow(c)));
}

// DMs and group DMs, newest first.
function conversations() {
  const out = S.dms.map((d) => {
    const u = getUser(d.userId);
    return {
      key: 'd:' + d.id, fav: 'd:' + d.id, at: d.lastMessageAt, active: S.view.dmId === d.id,
      title: displayName(u), avatar: avatarEl(u, 34, { status: true, meId: S.me.id }),
      unreadKey: 'd:' + d.id, open: () => openDm(d.id), menu: dmMenuItems(d), userId: u.id,
    };
  });
  for (const g of groups()) {
    const c = textChannel(g);
    out.push({
      key: 'g:' + g.id, fav: 'g:' + g.id, at: g.lastMessageAt || 0, active: S.view.serverId === g.id,
      title: groupName(g), avatar: groupAvatar(g, 34),
      unreadKey: c ? 'c:' + c.id : '', open: () => openGroup(g.id), menu: groupMenuItems(g),
    });
  }
  return out.filter((c) => !c.userId || !S.blocked.has(c.userId) || c.active).sort((a, b) => (b.at || 0) - (a.at || 0));
}
// A conversation's last message as the lists show it ('d:<dm>' or 'g:<group>'): a group chat without one says how
// many are in it.
function convPreview(key) {
  if (S.previews[key]) return S.previews[key];
  const g = key.startsWith('g:') && S.servers.find((s) => s.id === key.slice(2));
  return g ? `${g.memberIds.length} members` : '';
}
// The line under a conversation's name in the lists (the sidebar, Home's cards): its last message, or the dots and
// "typing…" while someone is typing there, like Discord's (typingChanged keeps it up to date in place). Hidden for a
// screen share, it stays hidden. empty: what it says before there's a message.
function convLine(c, cls, empty) {
  if (isSharing() && !shareAllowed.has(c.unreadKey)) return h('span', { class: cls }, 'Hidden while sharing');
  // (unreadKey is the conversation's own key, the one typing events name: 'd:<dm>', or 'c:<the group's chat>'.)
  const el = h('span', { class: `${cls} conv-line`, dataset: c.unreadKey ? { typingKey: c.unreadKey } : null });
  el._text = () => convPreview(c.key) || empty;
  return drawConvLine(el);
}
// Drawn again only when what it says changes, so the dots keep going while the same people go on typing.
function drawConvLine(el) {
  const key = el.dataset.typingKey;
  const said = key ? typingPreview(typingNames(key), { group: key.startsWith('c:') }) : '';
  const text = said || el._text();
  if (el._shown === text && el._typing === !!said) return el;
  el._shown = text; el._typing = !!said;
  clear(el).classList.toggle('is-typing', !!said);
  if (said) el.append(typingDots(), h('span', { class: 'conv-typing-text' }, said));
  else el.append(text);
  return el;
}
function groupName(g) {
  if (g.name) return g.name;
  const others = g.memberIds.filter((id) => id !== S.me.id).map((id) => displayName(getUser(id)));
  return others.length ? others.slice(0, 3).join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '') : 'Just you';
}
function groupAvatar(g, size) {
  if (g.icon) return h('span', { class: 'group-av icon', style: { '--size': size + 'px' } }, h('img', { src: g.icon, alt: '' }));
  const others = g.memberIds.filter((id) => id !== S.me.id).slice(0, 2);
  return h('span', { class: 'group-av', style: { '--size': size + 'px' } }, others.map((id) => avatarEl(getUser(id), Math.round(size * 0.68))));
}
function convRow(c) {
  const unread = c.unreadKey && S.unread.has(c.unreadKey) && !isMuted(c.unreadKey);
  const mentions = c.unreadKey ? mentionsOf(c.unreadKey) : 0;
  return h('button', {
    class: `dm-row${c.active ? ' active' : ''}${unread || mentions ? ' unread' : ''}${c.unreadKey && isMuted(c.unreadKey) ? ' muted' : ''}`,
    'data-nav': '', onclick: c.open, oncontextmenu: (e) => contextMenu(e, c.menu),
  }, c.avatar,
  h('span', { class: 'dm-row-text' },
    h('span', { class: 'dm-row-top' }, h('span', { class: 'dm-row-name' }, c.title), c.at ? h('span', { class: 'dm-row-time' }, shortTime(c.at)) : null),
    convLine(c, 'dm-row-status', '\u00a0')),
  mentions ? h('span', { class: 'badge', 'aria-label': `${mentions} unread` }, mentions) : unread ? h('span', { class: 'unread-dot', 'aria-label': 'Unread' }) : null);
}
function shortTime(ts) {
  const d = new Date(ts); const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ts);
  if (now - d < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function toggleFavorite(id) {
  const f = P.favorites;
  P.favorites = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
  renderRail(); renderSidebar();
}
function dmMenuItems(d) {
  const u = getUser(d.userId);
  const fav = P.favorites.includes('d:' + d.id);
  return [
    { label: fav ? 'Unpin conversation' : 'Pin conversation', icon: 'pin', action: () => toggleFavorite('d:' + d.id) },
    { label: 'Mark as read', icon: 'check', action: () => markConvRead('d:' + d.id) },
    ...notifyItems('d:' + d.id),
    ...disappearItems('d:' + d.id),
    '-',
    LOOK.menuItem('d:' + d.id), // "Chat background…" (none once they're blocked or their account is gone)
    { label: 'View profile', icon: 'user', action: () => openProfileModal(u.id) },
    personalNameItem(u),
    { label: 'Verify encryption', icon: 'shield', action: () => openSafetyNumber(u) },
  ];
}
function groupMenuItems(g) {
  const c = textChannel(g);
  const fav = P.favorites.includes('g:' + g.id);
  return [
    { label: fav ? 'Unpin conversation' : 'Pin conversation', icon: 'pin', action: () => toggleFavorite('g:' + g.id) },
    ...(c ? [{ label: 'Mark as read', icon: 'check', action: () => markConvRead('c:' + c.id) }, ...notifyItems('c:' + c.id), ...disappearItems('c:' + c.id), '-'] : []),
    { label: 'Rename group', icon: 'edit', action: () => renameGroup(g) },
    { label: 'Change group picture', icon: 'image', action: () => changeGroupIcon(g) },
    LOOK.menuItem('g:' + g.id), // "Chat background…"
    { label: 'Add people', icon: 'userPlus', action: () => openNewConversation(g) },
    { label: 'Members', icon: 'people', action: () => manageGroup(g) },
    '-',
    { label: 'Leave group', icon: 'logout', danger: true, action: () => leaveServer(g) },
  ];
}
// Mute for a while or until turned back on; muted shows how long is left.
const MUTE_FOR = [['For 15 minutes', 15], ['For 1 hour', 60], ['For 8 hours', 480], ['For 24 hours', 1440]];
function muteLeft(key) {
  const p = S.notifyPrefs[key];
  if (p && p.muteUntil > Date.now()) return `until ${fmtStamp(p.muteUntil)}`;
  return p && p.level === 'none' ? 'until you turn it back on' : '';
}
function notifyItems(key) {
  if (isMuted(key) && S.notifyPrefs[key]) {
    const left = muteLeft(key);
    return [{ label: 'Unmute', icon: 'bell', hint: left, action: () => setNotify(key, S.notifyPrefs[key].level === 'none' ? 'default' : undefined, { muteUntil: null }) }];
  }
  return [{ header: 'Mute' },
    ...MUTE_FOR.map(([l, min]) => ({ label: l, icon: 'bellOff', action: () => setNotify(key, undefined, { muteUntil: Date.now() + min * 60000 }) })),
    { label: 'Until I turn it back on', icon: 'bellOff', action: () => setNotify(key, 'muted') }];
}

// ---- server sidebar with categories
// A channel's category (older channels without one go under Text or Voice, as on the server).
const catOf = (c) => c.category || (c.type === 'voice' ? 'Voice' : 'Text');
function orderedCategories(server) {
  const seen = [];
  const byPos = [...server.channels].sort((a, b) => a.position - b.position);
  byPos.forEach((c) => { const cat = catOf(c); if (!seen.includes(cat)) seen.push(cat); });
  const order = (server.categoryOrder || []).filter((c) => seen.includes(c));
  return [...order, ...seen.filter((c) => !order.includes(c))];
}
const channelsIn = (server, cat) => server.channels.filter((c) => catOf(c) === cat).sort((a, b) => a.position - b.position);
const orderedChannels = (server) => orderedCategories(server).flatMap((cat) => channelsIn(server, cat));
function channelIcon(c) {
  if (c.type === 'voice') return 'speaker';
  if (/announce|news|updates/i.test(c.name)) return 'megaphone';
  if (/rules|info|welcome|faq|readme/i.test(c.name)) return 'book';
  return 'hash';
}

const eventsLoaded = new Set();
function renderServerSidebar(server, head, body) {
  const th = server.theme || {};
  head.classList.toggle('has-banner', !!th.banner);
  if (th.banner) head.append(h('div', { class: 'server-banner' }, h('img', { class: 'cropped', src: th.banner, alt: '', style: cropStyle(th.bannerCrop) })));
  head.append(h('button', { class: 'server-head', 'data-pop-anchor': '', 'aria-haspopup': 'menu', onclick: (e) => menu(e.currentTarget, serverMenuItems(server), { align: 'start' }) },
    h('span', { class: 'server-head-name' }, server.name), icon('chevron')));
  const admin = isAdmin(server);
  // Events: what's planned in this server (loaded once, kept fresh by live updates).
  const evs = eventsFor(server.id);
  if (!eventsLoaded.has(server.id)) { eventsLoaded.add(server.id); loadEvents(server.id).then(() => later(renderSidebar)); }
  const next = evs[0];
  body.append(h('button', { class: `ev-row${next ? ' has' : ''}`, onclick: () => openEvents(server) }, icon('book'),
    h('span', { class: 'ev-row-text' }, next ? h('span', null, h('strong', null, next.title), h('small', null, new Date(next.startsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      next.repeat ? ` · ${repeatLabel(next).toLowerCase()}` : '')) : 'Events'),
    evs.length ? h('span', { class: 'badge inline' }, evs.length) : null));
  // Memberships this server sells (support the creator, get a role / private channels).
  if (server.memberships && !noPayments) body.append(h('button', { class: 'ev-row mb-row', onclick: () => (isOwner(server) ? openServerSettings(server, 'memberships') : openMemberships(server)) }, icon('star'), h('span', { class: 'ev-row-text' }, 'Memberships')));
  const collapsed = P.collapsed[server.id] || [];
  const cats = orderedCategories(server);
  cats.forEach((cat, ci) => {
    const chans = channelsIn(server, cat);
    const isCollapsed = collapsed.includes(cat);
    const catUnread = isCollapsed && chans.some((c) => S.unread.has('c:' + c.id) && !isMuted('c:' + c.id) && chatCounts(c));
    const head = h('div', { class: 'cat-head' },
      h('button', {
        class: `cat-toggle${catUnread ? ' unread' : ''}`, 'aria-expanded': String(!isCollapsed),
        draggable: canMoveCategory(server, cat) ? 'true' : null,
        onclick: () => {
          const all = P.collapsed; const list = all[server.id] || [];
          all[server.id] = isCollapsed ? list.filter((x) => x !== cat) : [...list, cat];
          P.collapsed = all; renderSidebar();
        },
        oncontextmenu: admin ? (e) => contextMenu(e, categoryMenuItems(server, cat, ci, cats)) : null,
      }, icon('chevron', `ic cat-chev${isCollapsed ? ' closed' : ''}`), h('span', null, cat)),
      admin ? ibtn('plus', `Create channel in ${cat}`, () => openCreateChannel(server, chans[0] ? chans[0].type : 'text', cat), { cls: 'sm' }) : null);
    // Each category with its channels, so a category is dragged (and dropped on) as a whole.
    const group = h('div', { class: 'cat-group', dataset: { cat } }, head);
    body.append(group);
    if (admin) {
      channelDrag.attach(group, { kind: 'category', id: cat });
      channelDrag.attach(head, { kind: 'catHead', id: cat }, { source: false });
    }
    for (const c of chans) {
      const active = S.view.channelId === c.id;
      const k = 'c:' + c.id;
      // Collapsed categories still show the channel you're in, plus ones with mentions.
      if (isCollapsed && !active && !mentionsOf(k) && !(voice && voice.channelId === c.id)) continue;
      const row = channelRow(c, server);
      if (admin) channelDrag.attach(row, { kind: 'channel', id: c.id, category: cat });
      group.append(row);
      if (c.type === 'voice') group.append(h('div', { class: 'vc-users', 'data-vc-users': c.id }));
    }
  });
  if (!server.channels.length) body.append(h('p', { class: 'sidebar-empty' }, admin ? 'No channels yet. Use the server menu to create one.' : 'No channels yet.'));
  renderSidebarVoiceUsers();
}
function channelRow(c, server) {
  const k = 'c:' + c.id;
  const active = S.view.channelId === c.id;
  const muted = isMuted(k);
  // A voice channel's chat shows as unread only to people who follow it (see hasChat above); its pings always show.
  const unread = hasChat(c) && chatCounts(c) && S.unread.has(k) && notifyLevel(k) === 'all';
  const mentions = mentionsOf(k);
  const connected = voice && voice.channelId === c.id;
  return h('div', {
    class: `ch-row${active ? ' active' : ''}${unread ? ' unread' : ''}${muted ? ' muted' : ''}${connected ? ' connected' : ''}`,
    dataset: { cid: c.id },
    oncontextmenu: (e) => contextMenu(e, channelMenuItems(c, server)),
  },
  h('button', {
    class: 'ch-main', 'data-nav': '', 'aria-current': active ? 'page' : null, draggable: canMoveChannel(server, c) ? 'true' : null,
    'aria-label': `${c.type === 'voice' ? 'Voice channel' : 'Channel'} ${c.name}${mentions ? `, ${mentions} mentions` : unread ? ', unread' : ''}${muted ? ', muted' : ''}`,
    onclick: () => (c.type === 'voice' ? (connected ? openVoiceRoom(c.id, server.id) : joinVoice(c, server)) : openChannel(c.id, server.id)),
  }, icon(mentions ? 'at' : channelIcon(c), 'ic ch-ic'), h('span', { class: 'ch-name' }, c.name),
  muted ? icon('bellOff', 'ic ch-muted') : null,
  mentions ? h('span', { class: 'badge' }, mentions) : null),
  canEditChannel(server, c) || canEditChannelPerms(server, c) || canManageHooks(server, c) ? ibtn('gear', 'Edit channel', () => openEditChannel(c), { cls: 'sm ch-gear' }) : null);
}
function channelMenuItems(c, server) {
  const k = 'c:' + c.id;
  const edit = canEditChannel(server, c);
  const roles = canEditChannelPerms(server, c);
  const pk = S.notifyPrefs[k];
  const lvl = pk && pk.level !== 'default' ? (pk.level === 'none' ? 'muted' : pk.level) : 'default';
  const chat = hasChat(c);
  // A voice chat you don't follow has nothing to mark read unless it pinged you (that reads the pings and leaves it
  // unfollowed: see markConvRead).
  const markable = c.type === 'text' || (chat && (mentionsOf(k) > 0 || (S.unread.has(k) && chatCounts(c))));
  return [
    chat && c.type === 'voice' ? { label: S.view.type === 'voice' && S.view.channelId === c.id && S.view.chat ? 'Hide chat' : 'Open chat', icon: 'message', action: () => (S.view.type === 'voice' && S.view.channelId === c.id ? toggleVoiceChat() : openVoiceRoom(c.id, server.id, { chat: true })) } : null,
    markable ? { label: 'Mark as read', icon: 'check', action: () => markConvRead(k) } : null,
    ...(c.type === 'voice' && callRegions().length ? [...regionMenuItems(c.id), '-'] : []),
    chat ? { header: c.type === 'voice' ? 'Chat notifications' : 'Notifications' } : null,
    ...(chat ? [['default', 'Use server default'], ['all', 'All messages'], ['mentions', 'Only @mentions'], ['muted', 'Nothing']].map(([v, l]) => ({ label: l, checked: lvl === v, action: () => setNotify(k, v) })) : []),
    chat ? { label: 'Ignore @everyone and @here', checked: !!(pk && pk.suppressEveryone), action: () => setNotify(k, undefined, { suppressEveryone: !(pk && pk.suppressEveryone) }) } : null,
    ...(chat ? notifyItems(k) : []),
    // A voice channel's chat disappears like a text channel's (the timer is the channel's).
    ...(chat ? disappearItems(k) : []),
    '-',
    { label: 'Copy channel link', icon: 'link', action: () => { copyText(`${location.origin}/#c/${c.id}`); toast('Link copied.'); } },
    edit ? { label: 'Edit channel', icon: 'edit', action: () => openEditChannel(c) } : null,
    roles ? { label: 'Permissions', icon: 'shield', action: () => openEditChannel(c, 'perms') } : null,
    canManageHooks(server, c) ? { label: 'Webhooks', icon: 'link', action: () => openEditChannel(c, 'hooks') } : null,
    roles && c.type === 'text' ? { label: 'Make read-only (announcements)', icon: 'megaphone', action: () => quickOverride(server, c, 'readonly') } : null,
    roles && c.type === 'voice' && hasChat(c) ? { label: 'Make the chat read-only', icon: 'message', action: () => quickOverride(server, c, 'readonly') } : null,
    roles ? { label: 'Make private', icon: 'lock', action: () => quickOverride(server, c, 'private') } : null,
    ...channelMoveItems(server, c),
    hasChat(c) && canIn(c, PERMS.MANAGE_MESSAGES) ? { label: 'Delete recent messages\u2026', icon: 'trash', danger: true, action: () => openPurgeRecent(c) } : null,
    edit ? { label: 'Delete channel', icon: 'trash', danger: true, action: () => deleteChannel(c) } : null,
  ];
}
// One-click channel setups: read-only for @everyone, or hidden from @everyone (then pick who can see it).
async function quickOverride(server, c, kind) {
  const bits = kind === 'readonly' ? PERMS.SEND_MESSAGES | PERMS.CREATE_THREADS : PERMS.VIEW_CHANNEL;
  const isEveryone = (o) => o.type === 'role' && o.id === server.id;
  const isMe = (o) => o.type === 'member' && o.id === S.me.id;
  const old = (c.overrides || []).find(isEveryone) || { type: 'role', id: server.id, allow: 0, deny: 0 };
  const everyone = { ...old, allow: old.allow & ~bits, deny: old.deny | bits };
  // Unless you're the owner or an Administrator, the @everyone deny reaches you too, and the server refuses a
  // change that takes your own access away (you couldn't undo it), so keep yours with an override for yourself.
  const keep = isFullAdmin(server) ? 0 : bits & chanPerms(c);
  const meOld = (c.overrides || []).find(isMe);
  const me = keep ? { type: 'member', id: S.me.id, allow: ((meOld && meOld.allow) || 0) | keep, deny: ((meOld && meOld.deny) || 0) & ~keep } : meOld;
  const overrides = [...(c.overrides || []).filter((o) => !isEveryone(o) && !isMe(o)), everyone, ...(me ? [me] : [])];
  try {
    await api('PUT', `/channels/${c.id}/overrides`, { overrides });
    toast(kind === 'readonly' ? `${chanLabel(c)}${c.type === 'voice' ? '\u2019s chat' : ''} is now read-only. Give roles "Send messages" in its permissions to let them post.` : `${chanLabel(c)} is now private. Add roles or people who should see it.`);
    if (kind === 'private') openEditChannel(c, 'perms', { overrides });
  } catch (e) { toast(e.message, 'error'); }
}

function categoryMenuItems(server, cat, i, cats) {
  // Renaming relabels every channel in it, so it takes what moving the category does (the server checks the same).
  const movable = canMoveCategory(server, cat);
  return [
    { label: 'Create channel here', icon: 'plus', action: () => openCreateChannel(server, 'text', cat) },
    movable ? { label: 'Rename category', icon: 'edit', action: () => renameCategory(server, cat) } : null,
    movable && i > 0 ? { label: 'Move up', icon: 'arrowUp', action: () => moveCategoryBy(server.id, cat, -1) } : null,
    movable && i < cats.length - 1 ? { label: 'Move down', icon: 'arrowDown', action: () => moveCategoryBy(server.id, cat, 1) } : null,
  ];
}

// ---- arranging channels and categories (Manage Channels): drag and drop, or Move up / Move down in their menus
// The server gets the whole list as you see it (server/channelorder.js). What you can't see or can't manage keeps
// its place there, so a channel where Manage Channels is denied to you isn't draggable, nor is a category holding one.
const canMoveChannel = (server, c) => canEditChannel(server, c);
const canMoveCategory = (server, cat) => isAdmin(server) && channelsIn(server, cat).every((c) => canIn(c, PERMS.MANAGE_CHANNELS));
const channelLayout = (server) => orderedCategories(server).map((cat) => ({ cat, list: channelsIn(server, cat) }));
// (Toasts name the channel with chanLabel, above: "#news moved up.", "🔊 Lounge moved down.")
// Built on the server bar's drag code (folders.js): a channel lands between channels, or on a category's name (first
// in it); a category lands before or after another one.
const channelDrag = dragDrop({
  zones: (d, t) => {
    if (d.kind === 'channel') return t.kind === 'channel' ? ['before', 'after'] : t.kind === 'catHead' ? ['into'] : [];
    return d.kind === 'category' && t.kind === 'category' ? ['before', 'after'] : [];
  },
  onDrop: (d, t, z) => {
    const server = currentServer();
    if (!server) return;
    if (d.kind === 'category') {
      const i = orderedCategories(server).filter((k) => k !== d.id).indexOf(t.id);
      if (i >= 0) placeCategory(server, d.id, z === 'before' ? i : i + 1);
      return;
    }
    const c = server.channels.find((x) => x.id === d.id);
    if (!c) return;
    if (t.kind === 'catHead') { placeChannel(server, c, t.id, 0); return; }
    const i = channelsIn(server, t.category).filter((x) => x.id !== c.id).findIndex((x) => x.id === t.id);
    if (i >= 0) placeChannel(server, c, t.category, z === 'before' ? i : i + 1);
  },
});
// Puts channel c at `index` in category `cat` and saves it. The list changes straight away; everyone's apps follow
// with the server's update, and if the server refuses, it goes back as it was. The server also gets the layout this
// started from, and refuses the move if someone changed it meanwhile (rather than this quietly undoing theirs).
// `said`: what to announce once saved, for a move from a menu (the menu items say what happened, for screen readers;
// a drag shows it). Such a move opens the category the channel lands in if it was collapsed, so the channel stays in
// sight and keeps the focus.
async function placeChannel(server, c, cat, index, said) {
  const from = channelLayout(server).map((g) => [g.cat, g.list.map((x) => x.id)]);
  const layout = channelLayout(server).map((g) => ({ cat: g.cat, list: g.list.filter((x) => x.id !== c.id) }));
  const dest = layout.find((g) => g.cat === cat);
  if (!dest) return;
  dest.list.splice(Math.max(0, Math.min(index, dest.list.length)), 0, c);
  const ids = layout.flatMap((g) => g.list.map((x) => x.id));
  const was = catOf(c);
  if (was === cat && ids.join() === orderedChannels(server).map((x) => x.id).join()) return;
  const before = server.channels.map((x) => [x, x.position, x.category]);
  let pos = 0;
  for (const g of layout) for (const x of g.list) x.position = pos++;
  if (was !== cat) c.category = cat;
  if (said) openCategory(server, cat);
  renderSidebar();
  if (said) refocus((el) => el.matches('.ch-main') && el.closest('[data-cid]').dataset.cid === c.id);
  try {
    await api('POST', `/servers/${server.id}/channel-order`, { ids, categories: was !== cat ? { [c.id]: cat } : undefined, from });
    if (said) toast(said);
  } catch (e) {
    for (const [x, p, k] of before) { x.position = p; x.category = k; }
    renderSidebar();
    toast(e.message, 'error');
  }
}
// The same for a category: moves it to `index` in the list of categories.
async function placeCategory(server, cat, index, said) {
  const now = orderedCategories(server);
  const cats = now.filter((k) => k !== cat);
  cats.splice(Math.max(0, Math.min(index, cats.length)), 0, cat);
  if (JSON.stringify(cats) === JSON.stringify(now)) return;
  const old = server.categoryOrder;
  server.categoryOrder = cats;
  renderSidebar();
  if (said) refocus((el) => el.matches('.cat-toggle') && el.closest('.cat-group').dataset.cat === cat);
  try {
    await api('PATCH', `/servers/${server.id}`, { categoryOrder: cats, categoryOrderFrom: now });
    if (said) toast(said);
  } catch (e) {
    server.categoryOrder = old;
    renderSidebar();
    toast(e.message, 'error');
  }
}
// Opens a category collapsed in this server's sidebar.
function openCategory(server, cat) {
  const all = P.collapsed; const list = all[server.id] || [];
  if (!list.includes(cat)) return;
  all[server.id] = list.filter((x) => x !== cat);
  P.collapsed = all;
}
// After a move from a menu, the sidebar's redraw keeps the focus where it was (sidebarFocus). If the menu outlived
// its channel or category (a live update redrew the sidebar while it was open), the focus fell to the page: put it
// back on the item that moved.
function refocus(match) {
  const el = document.activeElement;
  if (el && el !== document.body) return;
  const t = $$('#sidebar-body .ch-main, #sidebar-body .cat-toggle').find(match);
  if (t) t.focus({ preventScroll: true });
}
// Where Move up (dir -1) or Move down (1) takes channel c in the layout as it is: the next place in its category, or
// at the top or bottom of it, on into the category above (to its end) or below (to its start). Null: nowhere.
function channelStep(server, c, dir) {
  const layout = channelLayout(server);
  const g = layout.findIndex((x) => x.cat === catOf(c));
  if (g < 0) return null;
  const { cat, list } = layout[g];
  const i = list.findIndex((x) => x.id === c.id) + dir;
  if (i >= 0 && i < list.length) return { cat, index: i, said: `${chanLabel(c)} moved ${dir < 0 ? 'up' : 'down'}.` };
  const other = layout[g + dir];
  return other ? { cat: other.cat, index: dir < 0 ? other.list.length : 0, into: true, said: `${chanLabel(c)} moved to ${other.cat}.` } : null;
}
// Move up / Move down in a channel's menu: the keyboard's way to do what dragging does. The menu shows where each one
// goes ("Move down · to Voice"); choosing it works that out again from the channel list as it is then, in case
// someone else moved channels while the menu was open (so it never sends back the order the menu was opened on).
function channelMoveItems(server, c) {
  if (!canMoveChannel(server, c)) return [];
  return [-1, 1].map((dir) => {
    const step = channelStep(server, c, dir);
    return step && { label: dir < 0 ? 'Move up' : 'Move down', hint: step.into ? `to ${step.cat}` : undefined, icon: dir < 0 ? 'arrowUp' : 'arrowDown', action: () => moveChannelBy(server.id, c.id, dir) };
  });
}
function moveChannelBy(serverId, channelId, dir) {
  const server = S.servers.find((x) => x.id === serverId);
  const c = server && server.channels.find((x) => x.id === channelId);
  if (!c || !canMoveChannel(server, c)) return;
  const step = channelStep(server, c, dir);
  if (step) placeChannel(server, c, step.cat, step.index, step.said);
}
function moveCategoryBy(serverId, cat, dir) {
  const server = S.servers.find((x) => x.id === serverId);
  if (!server || !canMoveCategory(server, cat)) return;
  const i = orderedCategories(server).indexOf(cat);
  if (i >= 0) placeCategory(server, cat, i + dir, `${cat} moved ${dir < 0 ? 'up' : 'down'}.`);
}
function renameCategory(server, cat) {
  const input = h('input', { class: 'input', value: cat, maxlength: '32' });
  modal({
    title: 'Rename category', size: 'sm', body: field('Category name', input),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', action: async () => { await api('POST', `/servers/${server.id}/categories/rename`, { from: cat, to: input.value.trim() }); } }],
  });
}

function renderSidebarVoiceUsers() {
  $$('[data-vc-users]').forEach((el) => {
    clear(el);
    const list = S.voice[el.dataset.vcUsers] || [];
    const server = serverOfChannel(el.dataset.vcUsers);
    for (const st of list) {
      const u = getUser(st.userId);
      const av = avatarEl(u, 22);
      av.dataset.speak = u.id;
      if (S.speaking.has(u.id)) av.classList.add('speaking');
      if (S.boardPlaying.has(u.id)) av.classList.add('board-playing');
      el.append(h('button', { class: 'vc-user', 'data-pop-anchor': '', onclick: (e) => openProfilePop(e.currentTarget, u.id, 'right'),
        oncontextmenu: server ? (e) => contextMenu(e, memberMenuItems(server, u)) : null },
        av, nameEl(u, { server }),
        h('span', { class: 'vc-flags' }, st.serverMuted ? h('span', { class: 'server-muted', 'data-tip': 'Server muted by a moderator', role: 'img', 'aria-label': 'Server muted' }, icon('micOff', 'ic flag'))
          : st.deafened ? icon('headphonesOff', 'ic flag') : st.muted ? icon('micOff', 'ic flag') : null)));
    }
  });
  $$('.ch-row').forEach((r) => r.classList.toggle('connected', !!voice && r.dataset.cid === voice.channelId));
}

// ======================================================================= user + call panels
// The line under your name: what you're playing or listening to, your custom status, or your status.
function mySubLine() {
  const p = S.me.profile || {};
  const act = S.me.activity || {};
  return act.game ? `Playing ${act.game.name}` : act.music ? `\u266B ${act.music.title}` : p.customStatus && (p.customStatus.text || p.customStatus.emoji)
    ? `${p.customStatus.emoji || ''} ${p.customStatus.text || ''}`.trim()
    : S.me.status === 'online' && S.me.autoAway ? 'Away (inactive)' : STATUS_LABEL[S.me.status] || 'Online';
}
function renderUserPanel() {
  const el = clear($('#user-panel'));
  if (!S.me) return;
  const sub = mySubLine();
  const av = avatarEl(S.me, 34, { status: true, meId: S.me.id });
  av.dataset.speak = S.me.id;
  const inCall = voice && voice.channelId;
  el.append(
    h('button', { class: 'me-btn', 'data-pop-anchor': '', 'aria-label': 'Your status and profile', onclick: (e) => statusMenu(e.currentTarget) },
      av, h('span', { class: 'me-text' }, nameEl(S.me), h('span', { class: 'me-sub' }, sub))),
    h('div', { class: 'me-actions' },
      inCall ? ibtn(voice.muted ? 'micOff' : 'mic', `${voice.muted ? 'Unmute' : 'Mute'}${getKeybinds().mute ? ` (${comboLabel(getKeybinds().mute)})` : ''}`, toggleMute, { cls: voice.muted ? 'off' : '', active: voice.muted }) : null,
      inCall ? ibtn(voice.deafened ? 'headphonesOff' : 'headphones', `${voice.deafened ? 'Undeafen' : 'Deafen'}${getKeybinds().deafen ? ` (${comboLabel(getKeybinds().deafen)})` : ''}`, toggleDeafen, { cls: voice.deafened ? 'off' : '', active: voice.deafened }) : null,
      ibtn('gear', 'Settings', () => openSettings(app))),
  );
}
function toggleMute() { if (!voice || !voice.channelId) return; if (voice.speakLocked && voice.muted) { toast(voice.serverMuted ? 'A moderator muted you in this server. You can listen, but not talk.' : 'You can listen here, but your roles don\u2019t allow speaking in this channel.'); return; } voice.setMuted(!voice.muted); playSound(voice.muted ? 'mute' : 'unmute'); renderUserPanel(); }
function toggleDeafen() { if (!voice || !voice.channelId) return; voice.setDeafened(!voice.deafened); playSound(voice.deafened ? 'deafen' : 'undeafen'); renderUserPanel(); }

// Compact call bar docked above your profile while you're in voice.
function renderVoicePanel() {
  const el = clear($('#voice-panel'));
  if (!voice || !voice.channelId) { el.hidden = true; return; }
  el.hidden = false;
  const room = voice.channelId;
  // What the call engine says, never a guess: "Connected" only while every connection's media is up.
  const st = voice.status();
  const others = (S.voice[room] || []).filter((x) => x.userId !== S.me.id).length;
  const label = st.state === 'connected' && room.startsWith('dm:') && !others ? 'Calling\u2026' : st.label;
  const q = { ok: 'connected', bad: 'failed', warn: 'warn' }[st.tone] || 'connecting';
  const ch = !room.startsWith('dm:') && channelById(room);
  const srv = ch && serverOfChannel(ch.id);
  const where = room.startsWith('dm:') ? `Call with ${roomTitle(room)}` : srv ? (isGroup(srv) ? groupName(srv) : `${ch.name} \u00b7 ${srv.name}`) : '';
  const go = () => goToCall(room);
  el.append(
    h('div', { class: 'vp-top' },
      h('div', { class: 'vp-info' }, h('div', { class: `vp-status q-${q}`, role: 'status', 'aria-live': 'polite', 'data-tip': st.detail, dataset: { callState: st.state } }, label), h('button', { class: 'vp-where', onclick: go }, where)),
      callRegions().length ? h('button', {
        class: `vp-region${callRegion(room) ? ' pinned' : ''}`, 'data-pop-anchor': '', 'data-tip': 'Call region: everyone in the call switches together',
        onclick: (e) => menu(e.currentTarget, regionMenuItems(room), { align: 'end' }),
      }, icon('globe'), h('span', null, callRegion(room) ? regionName(callRegion(room)) : 'Auto')) : null),
    // Anything but a healthy call says what's going on, and a call that couldn't be restored can be retried.
    st.tone === 'warn' || st.tone === 'bad' ? h('div', { class: `vp-detail ${st.tone}` }, h('span', null, st.detail),
      st.state === 'failed' ? h('button', { class: 'btn sm primary', onclick: () => voice.retry().catch((e) => toast(e.name === 'NotAllowedError' ? 'Allow microphone access in your browser to join.' : e.message, 'error')) }, 'Retry') : null) : '',
    h('div', { class: 'vp-controls' },
      ibtn(voice.muted ? 'micOff' : 'mic', voice.muted ? 'Unmute' : 'Mute', toggleMute, { cls: voice.muted ? 'off' : '' }),
      ibtn(voice.camStream ? 'video' : 'videoOff', voice.camStream ? 'Turn camera off' : 'Turn camera on', toggleCamera, { cls: voice.camStream ? 'on' : '' }),
      ibtn('monitor', voice.screenStream ? 'Stop sharing' : 'Share your screen', toggleScreen, { cls: voice.screenStream ? 'on' : '' }),
      ibtn('music', 'Soundboard', (e) => board.openPicker(e.currentTarget), { attrs: { 'data-pop-anchor': '' } }),
      ibtn('phoneOff', 'Leave call', () => { voice.leave(); playSound('selfLeave'); }, { cls: 'hang' })),
    voice.pttMode() ? h('div', { class: `ptt-hint${voice.pttHeld && !voice.muted ? ' on' : ''}` }, icon('mic'),
      getKeybinds().ptt ? (voice.pttHeld && !voice.muted ? 'Talking' : `Push to talk: hold ${comboLabel(getKeybinds().ptt)}`) : h('button', { class: 'link-btn', onclick: () => openSettings(app, 'keybinds') }, 'Push to talk is on, but no key is set')) : '',
  );
}

async function joinVoice(c, server, { stay = false } = {}) {
  try {
    await voice.join(c.id);
    playSound('selfJoin');
    if (!stay) openVoiceRoom(c.id, server.id);
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Allow microphone access in your browser to join voice.' : e.message, 'error');
  }
}

function statusMenu(anchor) {
  const opts = ['online', 'idle', 'dnd', 'invisible'];
  const desc = { online: S.me.autoAway ? 'Shown as away while you\u2019re inactive' : '', idle: 'Shown as away', dnd: 'Silences notifications', invisible: 'Appear offline, keep full access' };
  const el = h('div', { class: 'menu status-menu' },
    opts.map((s) => h('button', {
      class: `menu-item${S.me.status === s ? ' current' : ''}`,
      onclick: async () => {
        closePopover();
        try { await api('PATCH', '/me/status', { status: s }); setUser({ id: S.me.id, status: s, autoAway: false }); renderUserPanel(); } catch (e) { toast(e.message, 'error'); }
      },
    }, h('span', { class: `status-dot inline st-${s}`, 'aria-hidden': 'true' }), h('span', { class: 'menu-col' }, s === 'idle' ? 'Away' : STATUS_LABEL[s], desc[s] ? h('span', { class: 'menu-desc' }, desc[s]) : null))),
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openCustomStatus(); } }, icon('smile', 'ic menu-ic'), 'Set a custom status'),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openActivityPicker(S.me.activity); } }, icon('gamepad', 'ic menu-ic'), 'Set what I\u2019m playing or listening to'),
    !noPayments && (S.config.funding || S.config.support) ? h('button', { class: 'menu-item', onclick: () => { closePopover(); openSupport(); } }, icon('coin', 'ic menu-ic'), `Support ${S.config.name}`) : null,
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openProfileModal(S.me.id); } }, icon('user', 'ic menu-ic'), 'View my profile'),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); displayNameDialog(app); } }, icon('user', 'ic menu-ic'), 'Change display name'),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings(app, 'profile'); } }, icon('edit', 'ic menu-ic'), 'Edit profile'),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings(app, 'appearance'); } }, icon('palette', 'ic menu-ic'), 'Theme and appearance'),
    h('button', { class: 'menu-item', onclick: () => { closePopover(); openShortcuts(); } }, icon('info', 'ic menu-ic'), h('span', { class: 'menu-col' }, 'Keyboard shortcuts', h('span', { class: 'menu-desc' }, /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318 + /' : 'Ctrl + /'))),
  );
  popover(anchor, el, { side: 'top' });
}
function openCustomStatus() {
  const cs = (S.me.profile && S.me.profile.customStatus) || {};
  const emoji = h('input', { class: 'input emoji-input', maxlength: '16', value: cs.emoji || '', placeholder: '😊', 'aria-label': 'Status emoji' });
  const text = h('input', { class: 'input', maxlength: '128', value: cs.text || '', placeholder: "What's happening?", 'aria-label': 'Status text' });
  const pickBtn = ibtn('smile', 'Pick emoji', (e) => emojiPicker(e.currentTarget, (em) => { emoji.value = em; }), { attrs: { type: 'button', 'data-pop-anchor': '' } });
  // When it clears itself. A status that already has a time keeps it unless another choice is made.
  const current = (cs.text || cs.emoji) && S.me.customStatusExpiresAt;
  const until = h('select', { class: 'input', 'aria-label': 'Clear after' },
    current ? h('option', { value: 'keep' }, `Keep (${clearsLabel(current).replace(/^C/, 'c').replace(/\.$/, '')})`) : null,
    CLEAR_AFTER.map(([v, label]) => h('option', { value: v }, label)));
  until.value = current ? 'keep' : 'never';
  const when = h('span', { class: 'field-hint', 'aria-live': 'polite' });
  const expiresIn = () => (until.value === 'keep' ? Math.max(60000, current - Date.now()) : clearAfterMs(until.value));
  const drawWhen = () => { const ms = expiresIn(); when.textContent = clearsLabel(ms ? Date.now() + ms : null); };
  until.onchange = drawWhen;
  drawWhen();
  modal({
    title: 'Set a custom status', size: 'sm',
    body: h('div', { class: 'stack' }, h('div', { class: 'row gap' }, pickBtn, emoji, text),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Clear after'), until, when)),
    actions: [
      { label: 'Clear', action: () => saveCustomStatus('', '') },
      { label: 'Save', kind: 'primary', action: () => saveCustomStatus(emoji.value.trim(), text.value.trim(), expiresIn()) },
    ],
  });
}
// expiresIn: how long it lasts, in ms (worked out here, in this device's time zone), or null until it's cleared.
async function saveCustomStatus(emoji, text, expiresIn = null) {
  const u = await api('PUT', '/me/custom-status', { emoji, text, expiresIn: emoji || text ? expiresIn : null });
  setUser(u);
  renderUserPanel();
}

// ======================================================================= main column
function renderMain() {
  if (S.adminEl && S.adminEl._stop) S.adminEl._stop();
  S.adminEl = null;
  const main = clear($('#main'));
  if (!S.me) return;
  main.append(h('header', { id: 'main-head' }));
  renderHeader();
  const v = S.view;
  if (v.type === 'home') main.append(homeView());
  else if (v.type === 'friends') main.append(friendsView());
  else if (v.type === 'saved') main.append(savedView());
  else if (v.type === 'people') main.append(peopleView());
  else if (v.type === 'updates') main.append(updates.view());
  else if (v.type === 'study') main.append(study.view());
  else if (v.type === 'admin' && S.me.staffRole) main.append(S.adminEl = adminView({ role: S.me.staffRole, confirm: (fn, opts) => confirmedCall(app, fn, opts), me: () => S.me, tab: v.tab, setTab: (t) => { S.view.tab = t; }, openReports: S.adminReports, onCount: (n) => { if (S.adminReports !== n) { S.adminReports = n; renderRail(); } } }));
  else if ((v.type === 'channel' || v.type === 'dm') && hiddenWhileSharing(privateKey(v))) main.append(shareCover(privateKey(v)));
  else if (v.type === 'channel' || v.type === 'dm') main.append(chatView());
  else if (v.type === 'voice') main.append(voiceRoomView());
  else if (v.type === 'empty-server') {
    main.append(h('div', { class: 'empty-state' }, h('h3', null, 'No text channels yet'),
      h('p', null, isAdmin(currentServer()) ? 'Create one from the server menu.' : 'Ask an admin to create one.')));
  }
}
const navToggle = () => ibtn('menu', 'Open navigation', () => document.body.classList.toggle('nav-open'), { cls: 'nav-toggle' });
const navOpen = () => document.body.classList.contains('nav-open');
function closeNav() {
  const inside = !!document.activeElement && !!document.activeElement.closest('#rail, #sidebar');
  document.body.classList.remove('nav-open');
  // Focus doesn't stay behind in the hidden drawer: it goes back to the button that opens it.
  const t = inside && $('.nav-toggle');
  if (t) t.focus({ preventScroll: true });
}
// What the side panel's close button does (a thread opened from the Threads list goes back to the list, as with Esc).
function closePanel() {
  const panel = $('#members');
  const hadFocus = !!panel && panel.contains(document.activeElement);
  const mode = panelMode();
  if (mode === 'chat') toggleVoiceChat(false);
  else if (mode === 'thread') closeThread();
  else if (mode) togglePanel(S.panel);
  if (hadFocus && !panelMode()) $('#main').focus({ preventScroll: true });
}
// Phones and tablets (phone-nav.js): Back closes the menu, picture, message actions, dialog, side panel or drawer on
// top instead of leaving Hearth, and cancels a voice message being recorded, a message being edited or a reply (as Esc
// does); in the phone layout a swipe from the screen's left edge opens the drawer (or closes the side panel, which
// covers the chat there).
function phoneNav() {
  const viewer = () => document.querySelector('.viewer:not(.closing)');
  const popup = () => document.querySelector('#layer > .popover');
  const actions = () => document.querySelector('#layer > .sheet-backdrop:not(.closing)');
  const dialog = () => [...document.querySelectorAll('#layer > .modal-backdrop:not(.closing)')].pop();
  // What's under way in a message box or the message list, the recording first: each one's element says how it's
  // cancelled (_cancel). The one in the side panel (a thread's) goes before the panel, the chat's after the drawer.
  const underWay = (inPanel) => {
    if (inPanel && !panelMode()) return null;
    const panel = $('#members');
    for (const sel of ['.rec-bar', '.edit-wrap', '.reply-bar']) {
      const el = $$(sel).find((x) => x._cancel && panel.contains(x) === inPanel);
      if (el) return el;
    }
    return null;
  };
  const enabled = () => isPhoneLayout() || isTouchUI();
  const back = backStack({
    // The phone layout, and touch screens (a tablet's back gesture). A desktop with a mouse adds nothing.
    enabled,
    layers: [
      { open: () => !!popup(), close: closePopover }, // (a menu can sit on the picture viewer: its More)
      { open: () => !!viewer(), close: () => viewer()._close() },
      { open: () => !!actions(), close: () => actions()._close() },
      { open: () => !!dialog(), close: () => dialog()._close() },
      { open: () => !!underWay(true), close: () => underWay(true)._cancel() },
      // Beside the chat on a wider screen, the side panel is part of the page rather than something on top of it.
      { open: () => isPhoneLayout() && !!panelMode(), close: closePanel },
      { open: navOpen, close: closeNav },
      { open: () => !!underWay(false), close: () => underWay(false)._cancel() },
    ],
  });
  // Whatever opens or closes them: the drawer and panel are classes on the body; pictures, menus, sheets and dialogs
  // are added and removed. Recording, editing and replying come and go inside the chat and the side panel, which are
  // watched only while Back is Hearth's (they change with every message).
  const watch = new MutationObserver(() => back.sync());
  watch.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  watch.observe($('#layer'), { childList: true });
  const inside = new MutationObserver(() => back.sync());
  const watchInside = () => {
    inside.disconnect();
    if (enabled()) for (const el of [$('#main'), $('#members')]) inside.observe(el, { childList: true, subtree: true });
  };
  watchInside();
  const swipes = edgeSwipes({
    enabled: () => isPhoneLayout() && isTouchUI(),
    blocked: () => !!(viewer() || popup() || actions() || dialog()),
    drawer: { isOpen: navOpen, parts: () => [$('#rail'), $('#sidebar')], scrim: () => $('.nav-scrim'), setOpen: (on) => (on ? document.body.classList.add('nav-open') : closeNav()) },
    panel: { isOpen: () => !!panelMode(), el: () => $('#members'), close: closePanel },
  });
  onDeviceChange(() => { swipes.update(); watchInside(); back.sync(); });
}
function headTools(...items) { return h('div', { class: 'head-tools', role: 'toolbar', 'aria-label': 'Conversation tools' }, items.filter(Boolean)); }
// The channel's Threads panel. Its badge counts pings in the channel's threads; a dot means new replies in a thread
// this app has seen (the panel itself has the full list).
function threadsButton(channelId) {
  const open = S.panel === 'threads' || (S.panel === 'thread' && S.thread && S.thread.from === 'threads');
  const pings = threadPings('c:' + channelId);
  const fresh = !pings && Object.entries(S.threadState).some(([id, t]) => t.channelId === channelId && t.unread > 0 && !S.blocked.has(threadAuthor(id, channelId)));
  const label = `${S.panel === 'threads' ? 'Hide threads' : 'Threads'}${pings ? ` · ${pings} mention${pings === 1 ? '' : 's'}` : fresh ? ' · new replies' : ''}`;
  const b = ibtn('thread', label, () => { if (S.panel !== 'threads') S.threadsPanel = null; togglePanel('threads'); }, { active: open, cls: 'with-badge' });
  if (pings) b.append(h('span', { class: 'badge', 'aria-hidden': 'true' }, pings > 99 ? '99+' : pings));
  else if (fresh) b.append(h('span', { class: 'unread-dot', 'aria-hidden': 'true' }));
  return b;
}
// The side view (side-view.js): shows and hides it, with how many things are pinned there. Only once something is (the
// ⋯ menu always has it), and not in the phone layout, whose header is full (app.css).
function sideButton() {
  const n = SIDE.count();
  const open = S.panel === 'side';
  if (!n && !open) return null;
  const label = `${open ? 'Hide pinned to side' : 'Pinned to side'}${n ? ` (${n})` : ''}`;
  const b = ibtn('sidebar', label, () => togglePanel('side'), { active: open, cls: 'with-badge head-side' });
  if (n) b.append(h('span', { class: 'sv-count', 'aria-hidden': 'true' }, String(n)));
  return b;
}
// A DM's profile beside the chat: shows it and folds it away (as its own fold button does), remembered on this device.
// Lit while it's open (app.css), so it's the button to look for once it's folded. The label says what pressing it
// does, so it says whether the panel is open with aria-expanded rather than aria-pressed ("Hide profile, pressed"
// contradicts itself).
function profileButton() {
  const open = S.panel === 'members';
  return ibtn('user', open ? 'Hide profile' : 'Show profile', () => togglePanel('members'),
    { active: open, cls: 'head-profile', attrs: { 'aria-pressed': null, 'aria-expanded': String(open), 'aria-controls': 'members' } });
}
// Show or hide the chat beside a call. While it's hidden, its badge counts your pings there, and a dot means new
// messages (when they count for you: you opened it before, or you're in the call).
function voiceChatButton(c) {
  const k = 'c:' + c.id;
  const open = !!S.view.chat;
  const pings = open ? 0 : mentionsOf(k);
  const fresh = !open && !pings && S.unread.has(k) && chatCounts(c) && !isMuted(k);
  const label = `${open ? 'Hide chat' : 'Show chat'}${pings ? ` \u00b7 ${pings} mention${pings === 1 ? '' : 's'}` : fresh ? ' \u00b7 new messages' : ''}`;
  // The label says what pressing it does (Show or Hide), so no aria-pressed as well: "Hide chat, pressed" contradicts itself.
  const b = ibtn('message', label, () => toggleVoiceChat(), { active: open, cls: 'with-badge voice-chat-btn', attrs: { 'aria-pressed': null } });
  if (pings) b.append(h('span', { class: 'badge', 'aria-hidden': 'true' }, pings > 99 ? '99+' : pings));
  else if (fresh) b.append(h('span', { class: 'unread-dot', 'aria-hidden': 'true' }));
  return b;
}
function togglePanel(mode) {
  const el = $('#members');
  const dm = S.view.type === 'dm';
  const shown = !!el && !el.hidden;
  const profileShown = dm && shown && panelMode() === 'members';
  // Still sliding shut: shown again, it turns back from where it got to (slidePanel) rather than jumping to its width.
  const folding = dm && shown && !!sliding && sliding.shut;
  const fromPanel = shown && el.contains(document.activeElement);
  S.panel = S.panel === mode ? null : mode;
  // In a DM, closing something else (pinned messages, photos & videos, the side view) goes back to its profile when
  // that's shown there.
  if (!S.panel && dm && mode !== 'members') S.panel = restingPanel();
  // Two choices: folding a DM's profile leaves servers' member lists as they are, and the other way round.
  if (mode === 'members') { if (dm) P.showDmProfile = S.panel === 'members'; else P.showMembers = S.panel === 'members'; }
  if (S.panel !== 'thread') S.thread = null;
  if (profileShown && !S.panel && slidesPanel()) slidePanel(el, true, () => renderPanel());
  else {
    if (folding && S.panel === 'members' && slidesPanel()) slidePanel(el, false);
    document.body.classList.toggle('panel-open', !!panelMode());
    renderPanel();
    if (dm && !shown && S.panel === 'members' && !el.hidden && slidesPanel()) slidePanel(el, false);
  }
  renderHeader();
  // Folded with its own button: the keyboard carries on from the header's profile button, which brings it back.
  if (fromPanel && dm && mode === 'members' && !S.panel) { const b = $('#main-head .head-profile'); if (b) b.focus({ preventScroll: true }); }
}
// ---- the DM profile folding away and back
// Its fold button and the header's profile button slide it shut and open (app.css #members.panel-folding): its width
// goes to nothing and back, so the chat beside it widens and narrows with it rather than jumping, and keepPlace keeps
// the newest message at the bottom as its lines rewrap. Only where it sits beside the chat: a narrower window
// floats it over the chat and a phone covers the chat with it, so there it shows and hides as before, as it does with
// Reduce motion (the app's or the system's).
const FOLD_MS = 180;
let sliding = null; // { shut, key, turn(done), end(finished) }
const slidesPanel = () => wideEnoughForPanel() && !document.documentElement.classList.contains('reduce-motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
// shut: folding away (done, once it's shut, closes it); otherwise coming back, drawn already.
function slidePanel(el, shut, done = null) {
  // Pressed again before it's done: the slide under way goes back the way it came, from where it got to, rather than
  // the panel jumping to its full width (and the chat with it) and starting over from there.
  if (sliding && sliding.shut !== shut && sliding.key === currentKey() && sliding.turn(done)) return;
  if (sliding) sliding.end(false);
  const main = $('#main');
  // The gap between the chat and the panel, and the panel's borders (all that's left of it at the end), go and come
  // with it: the chat reaches over them meanwhile. Only when there's nothing else between the two. (Where they're laid
  // out, not drawn: panel-in moves the panel aside as it starts.)
  const right = el.offsetLeft >= main.offsetLeft + main.offsetWidth;
  const gap = right ? el.offsetLeft - main.offsetLeft - main.offsetWidth : main.offsetLeft - el.offsetLeft - el.offsetWidth;
  if (gap >= 0 && gap <= (parseFloat(getComputedStyle($('#app')).columnGap) || 0) + 1) main.style.setProperty(right ? '--fold-mr' : '--fold-ml', `${-(gap + el.offsetWidth - el.clientWidth)}px`);
  // What's in it keeps its width and slides out under the edge, rather than squeezing.
  el.style.setProperty('--fold-w', `${el.clientWidth}px`);
  const cls = shut ? 'panel-folding' : 'panel-unfolding';
  el.classList.add(cls); main.classList.add(cls);
  // Folding away, it's out of reach at once (togglePanel then hands the focus its button had to the header's).
  if (shut) el.inert = true;
  let timer = 0;
  const onEnd = (e) => { if (e.target === el && /^panel-(un)?fold$/.test(e.animationName)) s.end(true); };
  const s = {
    shut, key: currentKey(),
    // The panel's slide and the chat's, played backwards from where they are. They keep their classes (a new animation
    // would start over from its own beginning), and each is held where it ends up until the slide's over: the panel at
    // nothing until done closes it, as a fold is.
    turn(then) {
      if (!el.getAnimations) return false;
      const runs = [el, main].flatMap((x) => x.getAnimations()).filter((a) => /^(panel|main)-(un)?fold$/.test(a.animationName));
      if (runs.length !== 2 || runs.some((a) => a.playState !== 'running')) return false;
      for (const a of runs) { a.effect.updateTiming({ fill: 'both' }); a.reverse(); }
      s.shut = !s.shut; done = then; el.inert = s.shut;
      clearTimeout(timer);
      timer = setTimeout(() => s.end(true), FOLD_MS + 150);
      return true;
    },
    end(finished) {
      if (sliding !== s) return;
      sliding = null;
      clearTimeout(timer);
      el.removeEventListener('animationend', onEnd);
      el.classList.remove(cls); main.classList.remove(cls);
      main.style.removeProperty('--fold-mr'); main.style.removeProperty('--fold-ml'); el.style.removeProperty('--fold-w');
      el.inert = false;
      if (finished && done) done();
    },
  };
  sliding = s;
  el.addEventListener('animationend', onEnd);
  // In case the animation's end never comes (a tab in the background).
  timer = setTimeout(() => s.end(true), FOLD_MS + 150);
}

function renderHeader() {
  const head = $('#main-head');
  if (!head || !S.me) return;
  // Redrawing replaces the buttons: keep keyboard focus on the same one ("Show members" becomes "Hide members").
  const buttons = () => [...head.querySelectorAll('button')];
  const at = buttons().indexOf(document.activeElement);
  clear(head);
  drawHeader(head);
  if (at >= 0 && buttons()[at]) buttons()[at].focus({ preventScroll: true });
}
function drawHeader(head) {
  head.append(navToggle());
  const v = S.view;
  const key = currentKey();
  const server = currentServer();
  const PIN_ITEM = { label: S.panel === 'pins' ? 'Hide pinned messages' : 'Pinned messages', icon: 'pin', action: () => togglePanel('pins') };
  // Photos & videos: in the ⋯ menu everywhere (the way in on a phone, whose header is full), and a header button of
  // their own in DMs and group chats on wider screens (app.css hides it in the phone layout).
  const MEDIA_ITEM = { label: S.panel === 'media' ? 'Hide photos & videos' : 'Photos & videos', icon: 'images', action: () => togglePanel('media') };
  const mediaButton = () => ibtn('images', S.panel === 'media' ? 'Hide photos & videos' : 'Photos & videos', () => togglePanel('media'), { active: S.panel === 'media', cls: 'head-media' });
  // Counted when the menu opens, so it's never out of date.
  const SCHED_ITEM = () => { const n = key ? SCHED.forKey(key).length : 0; return { label: 'Scheduled messages', icon: 'clock', hint: n ? String(n) : null, action: () => SCHED.openList(key) }; };
  // Pinned to side (side-view.js): in the ⋯ menu of every chat, with how many (the header's button, sideButton, is for
  // wider screens).
  const sideCount = SIDE.count();
  const SIDE_ITEM = { label: S.panel === 'side' ? 'Hide pinned to side' : 'Pinned to side', icon: 'sidebar', hint: sideCount ? String(sideCount) : null, action: () => togglePanel('side') };
  if (v.type === 'channel' && server && !isGroup(server)) {
    const c = server.channels.find((x) => x.id === v.channelId);
    if (!c) return;
    head.append(
      h('div', { class: 'head-title' }, icon(channelIcon(c), 'ic head-ic'), h('h1', null, c.name),
        c.topic ? h('span', { class: 'head-topic', title: c.topic }, c.topic) : null),
      headTools(
        encBadge(() => openServerSecurity(server)),
        timerButton(key),
        ibtn('search', 'Search this channel (Ctrl+K)', () => openSearch({ scope: key })),
        // Notification options live in the ⋯ menu; the bell only shows up as a reminder when it's muted.
        isMuted(key) ? ibtn('bellOff', 'Muted. Click to change.', (e) => menu(e.currentTarget, notifyMenu(key), { align: 'end' }), { attrs: { 'data-pop-anchor': '' } }) : null,
        threadsButton(c.id),
        sideButton(),
        ibtn('people', S.panel === 'members' ? 'Hide members' : 'Show members', () => togglePanel('members'), { active: S.panel === 'members' }),
        ibtn('more', 'More', (e) => menu(e.currentTarget, [PIN_ITEM, MEDIA_ITEM, SCHED_ITEM(), SIDE_ITEM, ...channelMenuItems(c, server)], { align: 'end' }), { attrs: { 'data-pop-anchor': '' }, active: S.panel === 'pins' || S.panel === 'media' })));
  } else if (v.type === 'channel' && isGroup(server)) {
    const call = server.channels.find((c) => c.type === 'voice');
    const inCall = voice && call && voice.channelId === call.id;
    const callers = call ? (S.voice[call.id] || []).length : 0;
    head.append(
      h('div', { class: 'head-title' }, groupAvatar(server, 26), h('h1', null, groupName(server)),
        h('span', { class: 'head-topic' }, `${server.memberIds.length} members`)),
      headTools(
        encBadge(() => openServerSecurity(server)),
        timerButton(key),
        call && !inCall ? ibtn('video', 'Start a video call', () => joinRoom(call.id, { video: true })) : null,
        call ? h('button', { class: `btn sm ${inCall ? 'danger' : callers ? 'primary' : 'ghost'}`, onclick: () => (inCall ? voice.leave() : joinRoom(call.id)) },
          icon(inCall ? 'phoneOff' : 'phone'), inCall ? 'Leave call' : callers ? `Join call (${callers})` : 'Call') : null,
        ibtn('search', 'Search (Ctrl+K)', () => openSearch({ scope: key })),
        threadsButton(v.channelId),
        mediaButton(),
        sideButton(),
        ibtn('people', 'Members', () => togglePanel('members'), { active: S.panel === 'members' }),
        ibtn('more', 'More', (e) => menu(e.currentTarget, [PIN_ITEM, MEDIA_ITEM, SCHED_ITEM(), SIDE_ITEM, ...groupMenuItems(server)], { align: 'end' }), { attrs: { 'data-pop-anchor': '' }, active: S.panel === 'pins' })));
  } else if (v.type === 'dm') {
    const d = S.dms.find((x) => x.id === v.dmId);
    if (!d) return;
    const u = getUser(d.userId);
    const p = presenceOf(u, S.me.id);
    head.append(
      h('div', { class: 'head-title' }, avatarEl(u, 26, { status: true, meId: S.me.id }), h('h1', null, displayName(u)),
        h('span', { class: 'head-topic', 'data-presence-of': u.id }, STATUS_LABEL[p] || '')),
      headTools(
        sec.keyChanged(u)
          ? h('button', { class: 'head-badge warn', 'data-tip': 'This person\u2019s security key changed. Click to verify.', onclick: () => openSafetyNumber(u) }, icon('shield'), 'Key changed')
          : resetUnverified(u)
            ? h('button', { class: 'head-badge warn', 'data-tip': `${RESET_TIP}. Click to compare safety numbers.`, onclick: () => openSafetyNumber(u) }, icon('shield'), 'Not verified')
            : encBadge(() => openSafetyNumber(u), 'Compare safety numbers'),
        timerButton(key),
        ...(() => {
          const room = dmRoom(d.id);
          const inCall = voice && voice.channelId === room;
          const live = (S.voice[room] || []).length;
          if (S.blocked.has(u.id)) return [];
          if (inCall) return [h('button', { class: 'btn sm danger', onclick: () => { voice.leave(); playSound('selfLeave'); } }, icon('phoneOff'), 'Leave call')];
          return [ibtn('phone', live ? 'Join the call' : 'Start a voice call', () => startDmCall(d.id)), ibtn('video', live ? 'Join with video' : 'Start a video call', () => startDmCall(d.id, true))];
        })(),
        ibtn('search', 'Search (Ctrl+K)', () => openSearch({ scope: key })),
        mediaButton(),
        sideButton(),
        profileButton(),
        ibtn('more', 'More', (e) => menu(e.currentTarget, [PIN_ITEM, MEDIA_ITEM, SCHED_ITEM(), SIDE_ITEM, ...dmMenuItems(d), '-', blockItem(u)], { align: 'end' }), { attrs: { 'data-pop-anchor': '' }, active: S.panel === 'pins' })));
  } else if (v.type === 'voice' && server) {
    const c = server.channels.find((x) => x.id === v.channelId);
    const ck = 'c:' + v.channelId;
    const chatOpen = !!v.chat && hasChat(c);
    head.append(h('div', { class: 'head-title' }, icon('speaker', 'ic head-ic'), h('h1', null, c ? c.name : 'Voice')),
      headTools(h('span', { class: 'head-note call-note' }, icon('lock', 'ic'), c && c.region && callRegions().some((r) => r.id === c.region) ? `Audio goes through ${regionName(c.region)}, encrypted end to end` : 'Audio goes directly between members, encrypted'),
        chatOpen ? encBadge(() => openServerSecurity(server)) : null,
        chatOpen ? timerButton(ck) : null,
        chatOpen ? ibtn('search', 'Search this chat (Ctrl+K)', () => openSearch({ scope: ck })) : null,
        chatOpen && isMuted(ck) ? ibtn('bellOff', 'Muted. Click to change.', (e) => menu(e.currentTarget, notifyMenu(ck), { align: 'end' }), { attrs: { 'data-pop-anchor': '' } }) : null,
        hasChat(c) ? voiceChatButton(c) : null,
        chatOpen ? ibtn('more', 'More', (e) => menu(e.currentTarget, [PIN_ITEM, SCHED_ITEM(), ...channelMenuItems(c, server)], { align: 'end' }), { attrs: { 'data-pop-anchor': '' }, active: S.panel === 'pins' }) : null));
  } else if (v.type === 'friends') {
    const pending = Object.values(S.relationships).filter((r) => r.direction === 'incoming').length;
    const tab = (k, label, extra) => h('button', { class: `tab${v.tab === k ? ' active' : ''}${k === 'add' ? ' tab-add' : ''}`, role: 'tab', 'aria-selected': String(v.tab === k), onclick: () => goFriends(k) }, label, extra);
    head.append(h('div', { class: 'head-title' }, icon('people', 'ic head-ic'), h('h1', null, 'Friends')),
      h('div', { class: 'tabs', role: 'tablist' }, tab('online', 'Online'), tab('all', 'All'), tab('pending', 'Pending', pending ? h('span', { class: 'badge inline' }, pending) : null), tab('add', 'Add friend')));
  } else if (v.type === 'home') {
    head.append(h('div', { class: 'head-title' }, icon('home', 'ic head-ic'), h('h1', null, 'Home')),
      headTools(ibtn('search', 'Search (Ctrl+K)', () => openSearch())));
  } else if (v.type === 'admin') {
    head.append(h('div', { class: 'head-title' }, icon('shield', 'ic head-ic'), h('h1', null, 'Admin'), h('span', { class: 'head-topic' }, `Only staff can see this \u00b7 you\u2019re ${({ owner: 'the owner', admin: 'an admin', moderator: 'a moderator' })[S.me.staffRole] || 'staff'}`)));
  } else if (v.type === 'people') {
    head.append(h('div', { class: 'head-title' }, icon('user', 'ic head-ic'), h('h1', null, 'People'), h('span', { class: 'head-topic' }, 'Profiles of people you share a server with')),
      headTools(h('button', { class: 'btn ghost sm', onclick: () => openProfileModal(S.me.id) }, icon('user'), 'My page')));
  } else if (v.type === 'study') {
    head.append(h('div', { class: 'head-title' }, icon('graduation', 'ic head-ic'), h('h1', null, 'Study'), h('span', { class: 'head-topic' }, 'Recall flashcards \u00b7 end-to-end encrypted, on all your devices')));
  } else if (v.type === 'updates') {
    head.append(h('div', { class: 'head-title' }, icon('rss', 'ic head-ic'), h('h1', null, 'Updates'), h('span', { class: 'head-topic' }, 'Topics, channels and projects you track')),
      headTools(h('button', { class: 'btn ghost sm', onclick: () => updates.trackDialog(() => renderMain()) }, icon('plus'), 'Track something')));
  } else if (v.type === 'saved') {
    head.append(h('div', { class: 'head-title' }, icon('bookmark', 'ic head-ic'), h('h1', null, 'Saved messages')),
      headTools(h('span', { class: 'head-note' }, 'Synced to your devices. Only you can see them. Saved messages from disappearing conversations disappear with them.')));
  } else if (server) {
    head.append(h('div', { class: 'head-title' }, h('h1', null, server.name)));
  }
}
function encBadge(onclick, tip = 'End-to-end encrypted. Click for details.') {
  return h('button', { class: 'head-badge e2ee', 'data-tip': tip, 'aria-label': tip, onclick }, icon('lock'));
}
function notifyMenu(key) {
  const pk = S.notifyPrefs[key];
  const lvl = pk && pk.level !== 'default' ? (pk.level === 'none' ? 'muted' : pk.level) : 'default';
  return [{ header: 'Notify me about' },
    ...[['default', 'Server default'], ['all', 'All messages'], ['mentions', 'Only @mentions'], ['muted', 'Nothing (mute)']].map(([v, l]) => ({ label: l, checked: lvl === v, action: () => setNotify(key, v) })),
    ...(pk && pk.muteUntil > Date.now() ? [{ label: 'Unmute', icon: 'bell', hint: muteLeft(key), action: () => setNotify(key, undefined, { muteUntil: null }) }] : [])];
}

// ---- Home: a quick launchpad, not a wall of content
// "Keep this server running": the owner's monthly cost, how much is covered, and where to chip in.
// No ads, no tracking: just an honest number. It can be hidden for a month. Never in the Android app (no way to pay there).
function fundingCard() {
  const f = S.config.funding;
  if (noPayments || !f || !f.enabled || !f.url) return null;
  const hidKey = `hearth.fundHidden.${S.me.id}`;
  if (+(localStorage.getItem(hidKey) || 0) > Date.now()) return null;
  const money = (n) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: f.currency || 'USD', maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${f.currency}`; } };
  const pct = f.monthly ? Math.min(100, Math.round((f.raised / f.monthly) * 100)) : 0;
  const card = h('section', { class: 'fund-card' },
    h('div', { class: 'fund-text' },
      h('strong', null, `Keep ${S.config.name} running`),
      h('span', null, f.note || `No ads, no selling your data. This server costs ${money(f.monthly)} a month and is paid for by the people who use it.`),
      f.monthly ? h('div', { class: 'fund-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: pct + '%' } })) : null,
      h('span', { class: 'fund-meta' }, f.monthly ? `${money(f.raised)} of ${money(f.monthly)} this month` : '', f.supporters ? ` \u00b7 ${f.supporters} supporter${f.supporters === 1 ? '' : 's'} \uD83D\uDC9C` : '')),
    h('div', { class: 'fund-actions' },
      h('button', { class: 'btn primary sm', onclick: () => openSupport() }, 'Chip in'),
      h('button', { class: 'btn ghost sm', onclick: () => { localStorage.setItem(hidKey, String(Date.now() + 30 * 86400000)); card.remove(); } }, 'Hide for a month')));
  return card;
}
// The Support window: perks, the person's own support code, and the ways to pay (Stripe / Ko-fi / the
// owner's own link). Payments with the code turn on the supporter badge by themselves. Not in the Android app.
async function openSupport() {
  if (noPayments) return;
  let d;
  try { d = await api('GET', '/me/support'); } catch (e) { return toast(e.message, 'error'); }
  const f = S.config.funding || {};
  const money = (cents) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: d.currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${d.currency}`; } };
  const perks = [h('li', null, '\uD83D\uDC9C Supporter badge on your profile'),
    d.perks.storageMb ? h('li', null, `${d.perks.storageMb >= 1024 ? `${(d.perks.storageMb / 1024).toFixed(d.perks.storageMb % 1024 ? 1 : 0)} GB` : `${d.perks.storageMb} MB`} of storage`) : null,
    d.perks.fileMb ? h('li', null, `Send files up to ${d.perks.fileMb} MB`) : null,
    h('li', null, 'The good feeling of keeping this place ad-free')];
  const codeBox = h('div', { class: 'cmd-box' }, h('code', null, d.code), h('button', { class: 'btn sm', onclick: () => { copyText(d.code); toast('Code copied.'); } }, icon('copy'), 'Copy'));
  const ways = [];
  if (d.stripeUrl) ways.push(h('a', { class: 'btn primary', href: d.stripeUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Pay with card, Apple Pay or Google Pay'));
  if (d.kofiUrl) ways.push(h('a', { class: 'btn', href: d.kofiUrl, target: '_blank', rel: 'noopener noreferrer', onclick: () => { copyText(d.code); toast('Your code is copied: paste it into the Ko-fi message.'); } }, 'Tip on Ko-fi'));
  if (!ways.length && f.url) ways.push(h('a', { class: 'btn primary', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'Chip in'));
  modal({
    title: `Support ${S.config.name}`, size: 'md',
    body: h('div', { class: 'stack support-modal' },
      d.supporter ? h('p', { class: 'support-now' }, d.until ? `\uD83D\uDC9C You\u2019re a supporter until ${new Date(d.until).toLocaleDateString()}. Thank you!` : '\uD83D\uDC9C You\u2019re a supporter. Thank you!') : null,
      h('p', { class: 'muted-p' }, f.note || `No ads, no selling data. ${S.config.name} is paid for by the people who use it.`),
      h('p', { class: 'muted-p' }, `${money(d.monthlyCents)} keeps you a supporter for a month (pay more, it lasts longer). You get:`),
      h('ul', { class: 'perk-list' }, perks),
      ways.length ? h('div', { class: 'row gap wrap' }, ways) : h('p', { class: 'field-hint' }, 'The owner hasn\u2019t set up a way to pay yet.'),
      d.kofiUrl ? h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, 'Your support code'), codeBox,
        h('p', { class: 'field-hint' }, 'On Ko-fi, put this code in your message so the payment finds you. Card payments find you by themselves.')) : null,
      d.mine.length ? h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, 'Your payments'),
        ...d.mine.map((p) => h('div', { class: 'kv' }, h('span', null, `${new Date(p.created_at).toLocaleDateString()} \u00b7 ${p.kind}`), h('b', null, money(p.amount_cents))))) : null),
  });
}
function homeView() {
  const wrap = h('div', { class: 'home-view' });
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  wrap.append(h('div', { class: 'home-hero' }, h('h2', null, `${greet}, ${displayName(S.me)}`)));

  const convs = conversations();
  const favs = P.favorites;
  const pinned = convs.filter((c) => favs.includes(c.fav));
  const section = (title, action, ...kids) => h('section', { class: 'home-sec' }, h('div', { class: 'home-sec-head' }, h('h3', null, title), action), ...kids);

  const fundCard = fundingCard();
  if (fundCard) wrap.append(fundCard);
  const upcomingSlot = h('div', { hidden: true }); // no empty gap while it loads (or when there's nothing coming up)
  wrap.append(upcomingSlot);
  upcomingSection().then((sec) => { if (sec) upcomingSlot.replaceWith(sec); });
  if (pinned.length) wrap.append(section('Pinned conversations', null, h('div', { class: 'conv-cards' }, pinned.map(convCard))));
  wrap.append(section('Recent conversations', h('button', { class: 'link-btn', onclick: () => openNewConversation() }, 'New message'),
    convs.length ? h('div', { class: 'conv-cards' }, convs.filter((c) => !favs.includes(c.fav)).slice(0, 6).map(convCard))
      : h('p', { class: 'muted-p' }, 'No conversations yet.')));

  wrap.append(onlineFriendsSection());

  const servers = realServers();
  wrap.append(section('Your servers', h('button', { class: 'link-btn', onclick: openAddServer }, 'Create or join'),
    servers.length ? h('div', { class: 'server-cards' }, servers.map((s) => {
      const { unread, mentions } = serverUnread(s);
      return h('button', { class: `server-card${unread ? ' unread' : ''}`, onclick: () => openServer(s.id) },
        s.icon ? h('img', { src: s.icon, alt: '' }) : h('span', { class: 'server-card-initials' }, s.name.slice(0, 2)),
        h('span', { class: 'server-card-text' }, h('strong', null, s.name), h('span', null, `${s.memberIds.length} members`)),
        mentions ? h('span', { class: 'badge' }, mentions) : unread ? h('span', { class: 'unread-dot' }) : null);
    })) : h('p', { class: 'muted-p' }, 'You\u2019re not in any servers yet.')));

  const activity = P.inbox.slice(0, 5);
  if (activity.length) {
    wrap.append(section('Recent activity', h('button', { class: 'link-btn', 'data-pop-anchor': '', onclick: (e) => openInbox(e.currentTarget) }, 'All notifications'),
      h('div', { class: 'activity' }, activity.map((it) => h('button', { class: 'activity-row', onclick: () => (it.msgId ? jumpToMessageId(it.msgId) : goFriends('pending')) },
        icon(it.type === 'mention' ? 'at' : it.type === 'reply' ? 'reply' : 'userPlus', 'ic activity-ic'),
        h('span', { class: 'activity-text' }, it.title, it.text ? h('span', null, it.text) : null),
        h('span', { class: 'activity-time' }, relTime(it.at)))))));
  }
  return wrap;
}
// Home: friends who are online (redrawn by itself when someone comes or goes, see redrawPeople).
function onlineFriendsSection() {
  const online = Object.values(S.relationships).filter((r) => r.status === 'accepted').map((r) => getUser(r.userId)).filter((u) => (u.presence || 'offline') !== 'offline');
  return h('section', { class: 'home-sec home-online' },
    h('div', { class: 'home-sec-head' }, h('h3', null, `Online friends \u2014 ${online.length}`), h('button', { class: 'link-btn', onclick: () => goFriends('all') }, 'All friends')),
    online.length ? h('div', { class: 'friend-chips' }, online.map((u) => h('button', { class: 'friend-chip', 'data-pop-anchor': '', onclick: (e) => openProfilePop(e.currentTarget, u.id, 'bottom') },
      avatarEl(u, 30, { status: true, meId: S.me.id }), h('span', null, displayName(u)))))
      : h('p', { class: 'muted-p' }, 'Nobody\u2019s online right now.'));
}
function convCard(c) {
  const unread = c.unreadKey && S.unread.has(c.unreadKey) && !isMuted(c.unreadKey);
  return h('button', { class: `conv-card${unread ? ' unread' : ''}`, onclick: c.open, oncontextmenu: (e) => contextMenu(e, c.menu) },
    c.avatar, h('span', { class: 'conv-card-text' }, h('strong', null, c.title), convLine(c, 'conv-card-sub', 'No messages yet')),
    c.at ? h('span', { class: 'conv-card-time' }, shortTime(c.at)) : null);
}

function friendsView() {
  const v = S.view;
  const wrap = h('div', { class: 'friends' });
  if (v.tab === 'add') {
    const input = h('input', { class: 'input', placeholder: 'Enter a username', maxlength: '24', autocomplete: 'off', 'aria-label': 'Username' });
    const msg = h('p', { class: 'add-msg', role: 'status' });
    const send = async () => {
      msg.className = 'add-msg';
      try {
        await api('POST', '/friends', { username: input.value.trim() });
        msg.textContent = `Friend request sent to ${input.value.trim()}.`;
        msg.classList.add('ok');
        input.value = '';
      } catch (e) { msg.textContent = e.message; msg.classList.add('bad'); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    wrap.append(h('div', { class: 'add-friend' },
      h('h2', null, 'Add a friend'),
      h('p', { class: 'muted-p' }, 'Type their username on this server. Usernames aren\u2019t case-sensitive.'),
      h('div', { class: 'add-row' }, input, h('button', { class: 'btn primary', onclick: send }, 'Send request')), msg));
    return wrap;
  }
  const search = h('input', { class: 'input search-input', placeholder: 'Search friends', 'aria-label': 'Search friends' });
  const listEl = h('div', { class: 'friend-list' });
  const draw = () => {
    clear(listEl);
    const rels = Object.values(S.relationships);
    let list;
    if (v.tab === 'pending') list = rels.filter((r) => r.status === 'pending');
    else {
      list = rels.filter((r) => r.status === 'accepted');
      if (v.tab === 'online') list = list.filter((r) => (getUser(r.userId).presence || 'offline') !== 'offline');
    }
    const q = search.value.trim().toLowerCase();
    if (q) list = list.filter((r) => { const u = getUser(r.userId); return nameMatches(u, q); });
    list.sort((a, b) => displayName(getUser(a.userId)).localeCompare(displayName(getUser(b.userId))));
    const label = { online: 'Online', all: 'All friends', pending: 'Pending' }[v.tab];
    listEl.append(h('div', { class: 'list-label' }, `${label} \u2014 ${list.length}`));
    if (!list.length) {
      const msg = { online: 'No friends are online right now.', all: 'No friends yet. Add someone by their username.', pending: 'No pending requests.' }[v.tab];
      listEl.append(h('div', { class: 'empty-state small' }, h('p', null, q ? 'No one matches that search.' : msg),
        v.tab !== 'pending' && !q ? h('button', { class: 'btn primary', onclick: () => goFriends('add') }, 'Add friend') : null));
    }
    for (const r of list) {
      const u = getUser(r.userId);
      const p = u.profile || {};
      const sub = r.status === 'pending'
        ? (r.direction === 'incoming' ? 'Wants to be friends' : 'Request sent')
        : (p.customStatus && (p.customStatus.text || p.customStatus.emoji) ? `${p.customStatus.emoji || ''} ${p.customStatus.text || ''}` : STATUS_LABEL[presenceOf(u, S.me.id)]);
      const actions = [];
      if (r.status === 'accepted') {
        actions.push(ibtn('message', 'Message', () => openDmWith(u.id)));
        actions.push(ibtn('more', 'More', (e) => menu(e.currentTarget, [
          { label: 'View profile', icon: 'user', action: () => openProfileModal(u.id) },
          personalNameItem(u),
          { label: 'Start a group chat with them', icon: 'people', action: () => openNewConversation(null, { group: true, preselect: [u.id] }) },
          ...groups().filter((g) => !g.memberIds.includes(u.id) && g.memberIds.length < GROUP_MAX).slice(0, 8).map((g) => ({ label: `Add to ${groupName(g)}`, icon: 'userPlus', action: () => api('POST', `/groups/${g.id}/members`, { userId: u.id }).then(() => toast('Added.')).catch((x) => toast(x.message, 'error')) })),
          { label: 'Remove friend', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: `Remove ${displayName(u)}?`, text: 'You can add them again later.', confirm: 'Remove friend', danger: true })) api('DELETE', '/friends/' + u.id).catch((e2) => toast(e2.message, 'error'));
          } },
          blockItem(u)], { align: 'end' }), { attrs: { 'data-pop-anchor': '' } }));
      } else if (r.direction === 'incoming') {
        actions.push(h('button', { class: 'btn primary sm', onclick: () => api('POST', `/friends/${u.id}/accept`).catch((e) => toast(e.message, 'error')) }, 'Accept'));
        actions.push(h('button', { class: 'btn ghost sm', onclick: () => api('DELETE', '/friends/' + u.id).catch((e) => toast(e.message, 'error')) }, 'Ignore'));
      } else {
        actions.push(h('button', { class: 'btn ghost sm', onclick: () => api('DELETE', '/friends/' + u.id).catch((e) => toast(e.message, 'error')) }, 'Cancel request'));
      }
      listEl.append(h('div', { class: 'friend-row' },
        h('button', { class: 'friend-who', 'data-pop-anchor': '', onclick: (e) => openProfilePop(e.currentTarget, u.id, 'right') },
          avatarEl(u, 38, { status: true, meId: S.me.id }),
          h('span', { class: 'friend-text' }, h('span', { class: 'friend-name' }, nameEl(u), h('span', { class: 'friend-handle' }, u.username)), h('span', { class: 'friend-sub' }, (r.status === 'accepted' && activityLine(u)) || sub))),
        h('div', { class: 'friend-actions' }, actions)));
    }
  };
  search.addEventListener('input', draw);
  listEl._redraw = draw; // people coming and going redraw the rows only (redrawPeople)
  draw();
  wrap.append(h('div', { class: 'friends-top' }, h('div', { class: 'friends-search' }, icon('search'), search),
    h('button', { class: 'btn', onclick: () => openNewConversation(null, { group: true }) }, icon('people'), 'New group chat')), listEl);
  return wrap;
}

// Saved messages: kept on the server as message ids (plus a note encrypted with your own key), so they follow
// you to every device. Each one is fetched and decrypted here; one you can't see anymore says so.
// The vault key is worked out from your public key as this device proved it (secure.js ownKeys), never one a record of
// you lists: with a key of the server's in its place, the server could work it out too and open everything in it.
let vaultKeyP = null;
function myVaultKey() {
  const own = sec.ownKeys();
  if (!vaultKeyP && !own) return Promise.reject(new Error('Your own keys haven\u2019t been checked on this device yet. Reload the page.'));
  return (vaultKeyP ||= E2EE.vaultKey(S.privateKey, own.publicKey));
}
async function openNote(it) {
  if (!it.note) return '';
  try { return (await E2EE.openVault(await myVaultKey(), 'saved', it.messageId, it.note)).n || ''; } catch { return ''; }
}
function savedView() {
  const wrap = h('div', { class: 'saved', 'aria-busy': 'true' }, h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' })));
  const state = { items: [], hasMore: false };
  const draw = () => {
    wrap.removeAttribute('aria-busy');
    clear(wrap);
    if (!state.items.length) {
      wrap.append(h('div', { class: 'empty-state' }, h('h3', null, 'Nothing saved yet'),
        h('p', null, 'Hover a message and choose More \u2192 Save message to keep it here. Saved messages follow you to all your devices.')));
      return;
    }
    for (const it of state.items) {
      const m = it.message;
      if (m && isExpired(m, nowServer())) continue; // disappeared (the server deletes the saved entry too)
      if (!m) {
        wrap.append(h('div', { class: 'saved-row unavailable' }, h('div', { class: 'saved-av-empty' }, icon('bookmark')),
          h('div', { class: 'saved-body' }, h('div', { class: 'saved-meta' }, h('span', null, `Saved ${fmtStamp(it.savedAt)}`)),
            h('div', { class: 'saved-text muted-p' }, 'This message is no longer available. It was deleted, or you can\u2019t see that conversation anymore.'),
            it.noteText ? h('div', { class: 'saved-note' }, icon('edit'), it.noteText) : null),
          h('div', { class: 'saved-actions' }, ibtn('trash', 'Remove from saved', () => unsave(it.messageId)))));
        continue;
      }
      const u = getUser(m.authorId);
      const text = readable(m) ? textOf(m) || (filesOf(m).length ? '_Attachment_' : m.dec && m.dec.p ? `\uD83D\uDCCA ${m.dec.p.q}` : '') : '';
      const wf = WF.isShown(m.id) ? null : WF.check(m); // your word filter covers saved messages too
      wrap.append(h('div', { class: 'saved-row', dataset: { saved: it.messageId } },
        avatarEl(u, 36),
        h('div', { class: 'saved-body' },
          h('div', { class: 'saved-meta' }, nameEl(u), h('span', null, `${whereLabel(m)} \u00b7 ${fmtStamp(m.createdAt)}`)),
          !readable(m) ? h('div', { class: 'saved-text muted-p' }, 'Can\u2019t decrypt this message on this device yet.')
            : wf ? h('div', { class: 'saved-text' }, h('em', null, previewLabel(wf)))
              : h('div', { class: 'saved-text md', html: md(text, { mentionName: S.me.username }) }),
          it.noteText ? h('div', { class: 'saved-note' }, icon('edit'), it.noteText) : null),
        h('div', { class: 'saved-actions' },
          ibtn('arrowUp', 'Jump to message', () => jumpToMessageId(it.messageId)),
          ibtn('edit', it.noteText ? 'Edit note' : 'Add a note', () => editSavedNote(it)),
          ibtn('trash', 'Remove from saved', () => unsave(it.messageId)))));
    }
    if (state.hasMore) wrap.append(h('div', { class: 'saved-more' }, h('button', { class: 'btn ghost', onclick: () => load(state.items[state.items.length - 1].savedAt) }, 'Show older')));
  };
  const load = async (before) => {
    try {
      const res = await api('GET', `/me/saved?limit=50${before ? `&before=${before}` : ''}`);
      await Promise.all(res.items.map(async (it) => { if (it.message) await decryptMessage(it.message); it.noteText = await openNote(it); }));
      state.items = before ? [...state.items, ...res.items] : res.items;
      state.hasMore = res.hasMore;
      if (S.view.type === 'saved') draw();
    } catch (e) { clear(wrap).append(h('p', { class: 'sidebar-empty' }, e.message)); }
  };
  load();
  return wrap;
}
async function unsave(id) {
  try { await api('DELETE', `/me/saved/${id}`); S.savedIds.delete(id); toast('Removed from saved.'); if (S.view.type === 'saved') renderMain(); } catch (e) { toast(e.message, 'error'); }
}
function editSavedNote(it) {
  const inp = h('textarea', { class: 'input', rows: '3', maxlength: '500', placeholder: 'Why you saved it, a to-do\u2026' });
  inp.value = it.noteText || '';
  modal({ title: it.noteText ? 'Edit note' : 'Add a note', size: 'sm',
    body: h('div', { class: 'stack' }, field('Note', inp, 'Only you can read it: it\u2019s encrypted on this device before it\u2019s saved.')),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', action: async () => {
      const n = inp.value.trim();
      const note = n ? await E2EE.sealVault(await myVaultKey(), 'saved', it.messageId, { n }) : null;
      await api('PUT', `/me/saved/${it.messageId}`, { note });
      toast('Note saved.');
      if (S.view.type === 'saved') renderMain();
    } }] });
}

// ======================================================================= conversation view
// ---- keeping your place in the message list
// The list has overflow-anchor: none (app.css): the app decides where it sits. Putting it there once isn't enough. A
// GIF, a video or a picture link only gets its size once it has loaded (a photo's size comes with it), a page of older
// or newer messages comes in, the message box or the window changes height: each of these moved what you were looking
// at after it was put on screen. Reopening a conversation left you somewhere above the newest message, and a jump (a
// pin, a search result, a reply…) left the message pushed down out of sight by the pictures loading above it. So the
// list keeps one of two places through such changes:
//  - the newest message at the bottom, as long as you're there (opening a conversation and sending put you there);
//  - a message it was sent to, until the pictures on screen are in and nothing has moved for a moment, or until you
//    scroll yourself.
const PLACE_QUIET = 1200; // a message's place is let go once nothing has moved for this long (ms)…
const PLACE_MAX = 10000; // …or after this long at most
const NEAR_NEWEST = 8; // px from the bottom that still counts as being at the newest message
const MARKER_GAP = 80; // the "New messages" line goes this far below the top (clear of the unread bar over the list)
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
function keepPlace(sc) {
  let stuck = true; // at the newest message: stays there
  let held = null; // { find: () => element, block: 'center' | 'start', offset, found, quiet, max }
  let lastTop = 0;
  let shown = false;
  let ro = null;
  let mo = null;
  const fromBottom = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight;
  const release = () => {
    if (!held) return;
    clearTimeout(held.quiet); clearTimeout(held.max);
    held = null;
    stuck = sc.isConnected && fromBottom() < NEAR_NEWEST;
  };
  const place = () => {
    // Gone with its conversation: nothing more to keep.
    if (!sc.isConnected) { if (shown) { release(); if (ro) ro.disconnect(); if (mo) mo.disconnect(); } return; }
    shown = true;
    if (held) {
      const el = held.find();
      if (!el || !el.isConnected) return;
      held.found = true;
      const box = sc.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // In the middle (its top at the top when it's taller than the list), or a set distance below the top.
      const want = held.block === 'start' ? box.top + held.offset : box.top + Math.max(0, (box.height - r.height) / 2);
      if (Math.abs(r.top - want) >= 1) sc.scrollTop += r.top - want;
    } else if (stuck && fromBottom() > 1) sc.scrollTop = sc.scrollHeight;
    lastTop = sc.scrollTop;
  };
  // A message's place is let go once it's on screen and has settled: nothing moved for a moment, and no picture still
  // loading. (Not drawn yet, its page still on the way: it's waited for, up to PLACE_MAX.)
  const settle = () => {
    const now = held;
    if (!now || !now.found) return;
    clearTimeout(now.quiet);
    now.quiet = setTimeout(() => { if (held === now) { if (sc.querySelector('.att-media.loading')) settle(); else release(); } }, PLACE_QUIET);
  };
  // At the newest message, the list moving up can mean two things: you (or something) scrolled it, and the newest
  // message is let go; or it got shorter under you (a video that turned out smaller, a message deleted) and the
  // browser pulled it up, and it stays. Scrolled by you (a wheel, a finger, the keyboard, the scrollbar) is clear at
  // once. Otherwise it's the second when a size change comes with it (by the next frame), else the first.
  let unsure = 0;
  const changed = () => { unsure = 0; place(); settle(); };
  // Watched: the list's own size (the message box, the keyboard on a phone, the window) and each row's (a picture
  // coming in), and rows coming and going (a page loading, a redraw).
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(changed); ro.observe(sc); }
  if (typeof MutationObserver === 'function') {
    mo = new MutationObserver((records) => {
      if (ro) for (const r of records) { for (const n of r.addedNodes) if (n.nodeType === 1) ro.observe(n); for (const n of r.removedNodes) if (n.nodeType === 1) ro.unobserve(n); }
      changed();
    });
    mo.observe(sc, { childList: true });
  }
  let lastInput = 0;
  let downAt = 0; // a mouse button, finger or pen down on the list (or its scrollbar) since then
  const byYou = () => (downAt && Date.now() - downAt < 30000) || Date.now() - lastInput < 1000;
  sc.addEventListener('scroll', () => {
    if (fromBottom() < NEAR_NEWEST) { stuck = true; unsure = 0; } else if (!held && stuck && sc.scrollTop < lastTop - 1) {
      if (byYou()) stuck = false;
      else {
        const mark = ++unsure;
        requestAnimationFrame(() => requestAnimationFrame(() => { if (unsure === mark) { unsure = 0; stuck = false; } }));
      }
    }
    lastTop = sc.scrollTop;
  }, { passive: true });
  // Scrolling yourself also lets go of a message's place.
  const yours = (upward) => { lastInput = Date.now(); release(); if (upward) stuck = false; };
  sc.addEventListener('wheel', (e) => yours(e.deltaY < 0), { passive: true });
  sc.addEventListener('touchstart', () => yours(false), { passive: true });
  sc.addEventListener('touchmove', () => { lastInput = Date.now(); }, { passive: true });
  const lifted = () => { downAt = 0; lastInput = Date.now(); };
  sc.addEventListener('pointerdown', (e) => {
    downAt = lastInput = Date.now();
    window.addEventListener('pointerup', lifted, { once: true });
    window.addEventListener('pointercancel', lifted, { once: true });
    if (e.target === sc) release(); // its scrollbar
  });
  sc.addEventListener('keydown', (e) => {
    // (Not keys typed into a message being edited, or a poll's field.)
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (SCROLL_KEYS.has(e.key)) yours(['ArrowUp', 'PageUp', 'Home'].includes(e.key)); else lastInput = Date.now();
  });
  sc._place = {
    // The newest message at the bottom, and staying there (smoothly: Jump to latest).
    newest(smooth = false) {
      release();
      stuck = true;
      if (smooth) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); else sc.scrollTop = sc.scrollHeight;
      lastTop = sc.scrollTop;
    },
    // What find() returns, in the middle (block 'start': `offset` below the top), now and as things around it move.
    hold(find, { block = 'center', offset = 0 } = {}) {
      if (held) { clearTimeout(held.quiet); clearTimeout(held.max); }
      stuck = false;
      const now = held = { find, block, offset, found: false, quiet: 0, max: 0 };
      now.max = setTimeout(() => { if (held === now) release(); }, PLACE_MAX);
      changed();
    },
    release,
  };
}
// The newest message at the bottom of the list, and kept there while you stay (keepPlace).
function toNewest(sc, smooth = false) {
  if (!sc) return;
  if (sc._place) sc._place.newest(smooth); else sc.scrollTop = sc.scrollHeight;
}
// A message in the list (by id) held in place as it's drawn and while what's around it settles (keepPlace).
function holdMessage(sc, id, opts) {
  if (sc && sc._place) sc._place.hold(() => sc.querySelector(`.msg[data-mid="${id}"]`), opts);
}
function chatView() {
  const wrap = h('div', { class: 'chat' });
  const scroller = h('div', { class: 'messages', id: 'messages', tabindex: '0', 'aria-label': 'Messages', role: 'log' });
  scroller.addEventListener('scroll', onMessagesScroll);
  scroller.addEventListener('click', onMessageAreaClick);
  messageListKeys(scroller);
  // Where it stays as things load (keepPlace). On a phone, too: the keyboard coming up (or the phone turning) makes the
  // list shorter, and the newest messages stay in view instead of sliding down behind the message box.
  keepPlace(scroller);
  const jump = h('button', { class: 'jump-latest', id: 'jump-latest', hidden: true, onclick: () => jumpToLatest() }, icon('arrowDown'), 'Jump to latest');
  const unreadBar = h('div', { class: 'unread-bar', id: 'unread-bar', role: 'status', hidden: true });
  const selectBar = h('div', { class: 'select-bar', id: 'select-bar', role: 'region', 'aria-label': 'Selected messages', hidden: true });
  const key = currentKey();
  if (S.select && S.select.key !== key) S.select = null; // selecting is per channel
  const comp = createComposer({ id: 'main', key: () => currentKey(), threadId: () => null });
  composers.main = comp;
  const room = S.view.type === 'dm' ? dmRoom(S.view.dmId) : callRoomFor(currentServer());
  if (room && ((S.voice[room] || []).length || (voice && voice.channelId === room))) wrap.append(callStage(room, { compact: true }));
  wrap.append(unreadBar, scroller, jump, selectBar, comp.el);
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dropping'); });
  wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('dropping'); });
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('dropping'); comp.addFiles(e.dataTransfer.files); });
  queueMicrotask(() => {
    comp.renderExtras();
    if (S.view.jumpTo) { const id = S.view.jumpTo; S.view.jumpTo = null; jumpToMessage(key, id); }
    // Back after an update's reload, where you'd scrolled to: that message at the top, quietly (and kept there while
    // the pictures around it load).
    else if (S.view.restoreAt) {
      const id = S.view.restoreAt; S.view.restoreAt = null;
      holdMessage(scroller, id, { block: 'start' });
      loadMessages(key, { around: id }).then(() => {
        if (!scroller.querySelector(`.msg[data-mid="${id}"]`) && scroller.isConnected) { if (scroller._place) scroller._place.release(); loadMessages(key, 'open'); }
      }).catch(() => {});
    } else loadMessages(key, 'open');
  });
  return wrap;
}
function onMessageAreaClick(e) {
  const sp = e.target.closest('.md-spoiler');
  const veiledNow = !!sp && !sp.classList.contains('revealed');
  if (sp) sp.classList.add('revealed');
  const mention = e.target.closest('.mention[data-user]');
  if (mention) openProfilePop(mention, mention.dataset.user, 'right');
  // A #channel mention (markdown.js) opens that channel here, without going through the address bar. Inside a spoiler
  // that isn't shown yet, the first click only reveals it.
  const chan = e.target.closest('.channel-mention[data-channel]');
  if (chan) { e.preventDefault(); if (!veiledNow) openChannelMention(chan); }
}
// The channel is looked up again in this person's own list (the link's server attribute is only a hint).
function openChannelMention(el) {
  const s = serverOfChannel(el.dataset.channel);
  if (!s || isGroup(s)) return toast('You don’t have access to that channel.');
  closePopover();
  openChannel(el.dataset.channel, s.id);
}

const msgUrl = (key) => (key.startsWith('c:') ? `/channels/${encodeURIComponent(key.slice(2))}/messages` : `/dms/${encodeURIComponent(key.slice(2))}/messages`);
// mode: 'latest' | 'open' | 'older' | 'newer' | { around: id }
// ('open': the latest, as the conversation opens. renderMessages puts a server channel at its "New messages" line.)
async function loadMessages(key, mode = 'latest') {
  const stick = mode === 'open' ? 'open' : true;
  if (mode === 'open') mode = 'latest';
  let store = S.msgs[key];
  if (mode === 'latest' && store && store.loaded && !store.hasNewer) {
    trimStore(store, 120);
    await decryptAll(key);
    dropExpired(store);
    return renderMessages(stick);
  }
  if (!store || (mode === 'latest' && store.hasNewer) || typeof mode === 'object') store = S.msgs[key] = { list: [], hasMore: true, hasNewer: false, loaded: false, loading: false };
  if (store.loading || (mode === 'older' && !store.hasMore) || (mode === 'newer' && !store.hasNewer)) return;
  store.loading = true;
  let q = '';
  if (mode === 'older' && store.list.length) q = `?before=${encodeURIComponent(store.list[0].id)}`;
  else if (mode === 'newer' && store.list.length) q = `?after=${encodeURIComponent(store.list[store.list.length - 1].id)}`;
  else if (typeof mode === 'object') q = `?around=${encodeURIComponent(mode.around)}`;
  if (!store.loaded) renderMessages(true);
  try {
    const res = await api('GET', msgUrl(key) + q);
    applyThreadStates(res.threads);
    const known = new Set(store.list.map((m) => m.id));
    // Each opened as a message of this conversation, whichever one the server labels it with (see dm:message).
    const fresh = res.messages.filter((m) => !known.has(m.id)).map((m) => (key.startsWith('d:') ? { ...m, dmId: key.slice(2) } : { ...m, channelId: key.slice(2) }));
    store.list = [...store.list, ...fresh].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (mode !== 'newer') store.hasMore = res.hasMore;
    // The page that reaches the start says whether the server left older messages out for you (joined a server where
    // new members can't read back).
    if (mode !== 'newer' && !res.hasMore) store.hidden = !!res.hidden;
    if (mode !== 'older') store.hasNewer = !!res.hasNewer;
    store.loaded = true;
    const newLines = mergeTimerEvents(store, res.timerEvents) + mergeLookEvents(store, res.lookEvents);
    await decryptAll(key);
    // The timer inside a message can say it's gone before the server has deleted it.
    const hid = dropExpired(store);
    if (currentKey() !== key) return;
    const sc = $('#messages');
    if (mode === 'older') {
      const prevH = sc.scrollHeight;
      const prevTop = sc.scrollTop;
      if (newLines || hid || !prependOlder(sc, store, fresh)) renderMessages(false);
      sc.scrollTop = sc.scrollHeight - prevH + prevTop;
      dropNewest(sc, store);
    } else if (mode === 'newer') {
      // Coming back down: let go of the oldest ones instead, and keep what you're reading where it is.
      if (store.list.length > HISTORY_WINDOW) { store.list.splice(0, store.list.length - HISTORY_WINDOW); store.hasMore = true; }
      keepAnchor(sc, () => renderMessages(false));
    } else renderMessages(typeof mode === 'object' ? false : stick);
    if (!store.hasNewer) markRead(key);
  } catch (e) {
    toast(e.message, 'error');
  } finally { store.loading = false; }
}
// Keep only the newest messages of a conversation in memory and on screen; older ones load again
// when you scroll up. Without this, a long session made the page heavier and heavier.
function trimStore(store, keep) {
  if (store.list.length <= keep * 1.5 || store.hasNewer) return false;
  store.list.splice(0, store.list.length - keep);
  store.hasMore = true;
  return true;
}
// Reading far back: at most this many messages stay loaded and on screen. Scrolling up lets go of the newest
// ones (they load again on the way down), so a long read back through history doesn't keep growing the page.
const HISTORY_WINDOW = 300;
function dropNewest(sc, store) {
  if (store.list.length <= HISTORY_WINDOW) return false;
  const gone = new Set(store.list.splice(HISTORY_WINDOW).map((m) => m.id));
  store.hasNewer = true;
  for (const el of sc.querySelectorAll(':scope > .msg[data-mid]')) if (gone.has(el.dataset.mid)) el.remove();
  // Your own unsent messages and dividers left dangling at the bottom go too (they come back with the latest).
  for (let el = sc.lastElementChild; el && !el.matches('.msg[data-mid]');) {
    const prev = el.previousElementSibling;
    if (el.matches('.day-div, .new-div, .msg.sending')) el.remove();
    el = prev;
  }
  // The message keyboard focus was on may be gone: give the Tab order a current one again.
  ensureCurrentMessage(sc);
  const jl = $('#jump-latest');
  if (jl) jl.hidden = false;
  return true;
}
// Redraws with `fn` and keeps the first message in view at the same spot on screen.
function keepAnchor(sc, fn) {
  const top = sc.getBoundingClientRect().top;
  const anchor = [...sc.querySelectorAll(':scope > .msg[data-mid]')].find((el) => el.getBoundingClientRect().bottom > top);
  const id = anchor && anchor.dataset.mid;
  const offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  const before = sc.scrollTop;
  fn();
  const again = id && sc.querySelector(`.msg[data-mid="${id}"]`);
  if (again) sc.scrollTop += again.getBoundingClientRect().top - top - offset;
  else sc.scrollTop = before;
}
// Scrolling up: add just the older messages at the top instead of redrawing everything.
function prependOlder(sc, store, fresh) {
  const first = sc.querySelector('.msg[data-mid]');
  if (!first) return false;
  const firstMsg = store.list.find((x) => x.id === first.dataset.mid);
  const older = fresh.filter((m) => !firstMsg || m.id < firstMsg.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (fresh.length !== older.length) return false;
  // A timer line kept from before (a trimmed page) that now falls among these: a full redraw puts it in its place.
  if (firstMsg && older.length && store.events && [...store.events.values()].some((e) => e.at <= firstMsg.createdAt && (!store.hasMore || e.at >= older[0].createdAt))) return false;
  const frag = document.createDocumentFragment();
  if (!store.hasMore) frag.append(...historyStart(store));
  let prev = null;
  for (const m of older) {
    if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) {
      frag.append(dayDivEl(m.createdAt));
      prev = null;
    }
    frag.append(messageEl(m, prev, 'main'));
    prev = m;
  }
  // The message that used to be first may now join the group above it, and its day divider may be a repeat.
  if (prev && firstMsg) {
    const before = first.previousElementSibling;
    if (before && before.classList.contains('day-div') && new Date(prev.createdAt).toDateString() === new Date(firstMsg.createdAt).toDateString()) before.remove();
    const top = first.previousElementSibling && first.previousElementSibling.classList.contains('day-div') ? null : prev;
    first.replaceWith(messageEl(firstMsg, top, 'main'));
  }
  sc.prepend(frag);
  return true;
}
function onMessagesScroll(e) {
  const sc = e.target;
  const key = currentKey();
  const store = S.msgs[key];
  if (!store) return;
  if (sc.scrollTop < 200 && store.hasMore && !store.loading) loadMessages(key, 'older');
  const fromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
  if (fromBottom < 200 && store.hasNewer && !store.loading) loadMessages(key, 'newer');
  const jl = $('#jump-latest');
  if (jl) jl.hidden = !(store.hasNewer || fromBottom > 1200);
  if (fromBottom < 40 && !store.hasNewer) markRead(key);
}
function jumpToLatest() {
  const key = currentKey();
  const store = S.msgs[key];
  if (store && store.hasNewer) { delete S.msgs[key]; loadMessages(key); }
  else toNewest($('#messages'), !matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ---- decryption (DMs and channels are both end-to-end encrypted)
async function decryptMessage(m) {
  if (m.dmId) await sec.decryptDmMessage(m);
  else await sec.decryptChannelMessage(m);
  noteBinding(m);
}

// ---- where a message belongs (binding.js, crypto-7): its id, reply, thread, time and edit count are inside it
// The highest edit of each message this device has shown (kept across reloads), and the ids each message has
// shown up under this session.
const versions = createVersions({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) },
  () => (S.me && S.me.id ? 'hearth.msgv.' + S.me.id : ''));
const copies = createCopies();
// Called for every message as it's decrypted (binding.js noteMessage): a second id for the same message, or a newer
// edit, redraws the other copies too, so each of them carries the flag. The side view's too: it holds one of them, or
// a copy of this very message it fetched itself (the older edit now), which none of the chat's lists have.
function noteBinding(m) {
  const ids = noteMessage(m, keyOfMessage(m), { versions, copies });
  for (const id of ids) { const x = loadedMessage(id); if (x) later(() => replaceMessageEl(x)); }
  if (SIDE.messages().some((x) => ids.includes(x.id) || (x.id === m.id && x !== m))) later(redrawSide);
}
// The side view drawn again (side-view.js refresh: only the cards whose flags changed are drawn anew), once a frame
// however many ask.
const redrawSide = () => SIDE.refresh();
// A message loaded anywhere in this conversation: its list, a thread, a thread's first message.
function loadedMessage(id) {
  for (const st of Object.values(S.msgs)) { const m = st && st.list && st.list.find((x) => x.id === id); if (m) return m; }
  return findThreadMessage(id);
}
// Is a message with this id loaded in this conversation (and not disappeared)? A reply the server left out while the
// original is right here was taken away, not lost.
function loadedAlive(key, id) {
  const t = nowServer();
  const ok = (x) => !!x && x.id === id && !isExpired(x, t);
  const st = S.msgs[key];
  if (st && st.list.some(ok)) return true;
  return Object.values(S.threads).some((th) => th.root && keyOfMessage(th.root) === key && (ok(th.root) || th.list.some(ok)));
}
// Replied-to messages that aren't loaded here, asked of the server once each (the lookup message links use): one it
// can still find was taken away from the reply, not lost (binding.js createOriginals). Gone or not yours to see is
// "gone"; no answer (offline, rate limited) is asked again the next time the reply is drawn.
const originals = createOriginals(async (id) => {
  try { await api('GET', `/messages/${encodeURIComponent(id)}/locate`); return true; } catch (e) {
    if (e.status === 404 || e.status === 403) return false;
    throw e;
  }
});
// The loaded replies to that message, drawn again (it turned out to be still there: they're flagged now), and the
// side view's cards of replies to it (often copies it fetched itself, so in none of these lists).
function redrawRepliesTo(id) {
  const all = [...Object.values(S.msgs).flatMap((st) => (st && st.list) || []), ...Object.values(S.threads).flatMap((th) => [th.root, ...(th.list || [])])];
  const replies = (x) => !!x && !!x.dec && !!x.dec.b && x.dec.b.r === id;
  for (const x of all) if (replies(x)) later(() => replaceMessageEl(x));
  if (SIDE.messages().some(replies)) later(redrawSide);
}
// { issues, notes, … } for a message (binding.js bindingState), or null when it carries nothing to check. A reply
// shown without its original, which isn't loaded here, says "no longer available" until the server is asked whether
// that original is still there; if it is, the reply is flagged instead.
function bindingOfMessage(m) {
  const key = keyOfMessage(m);
  const st = bindingState(m, key, { versions, copies, present: (id) => originals.found(id) || loadedAlive(key, id) });
  if (st && st.notes.includes('replyGone')) originals.ask(st.b.r, () => redrawRepliesTo(st.b.r));
  return st;
}
// Messages deleted or disappeared no longer count as copies of another: what's left of them is drawn again, in the
// side view too.
function forgetBindings(key, gone) {
  const ids = copies.drop(key, gone);
  for (const id of ids) { const x = loadedMessage(id); if (x) later(() => replaceMessageEl(x)); }
  if (SIDE.messages().some((x) => ids.includes(x.id))) later(redrawSide);
}
// The one small flag for a message the server may have moved, repeated or rolled back, naming what didn't match.
function bindingFlag(m, st) {
  const lines = describeBinding(st.issues, { m, b: st.b, copies: st.copies, top: st.top });
  const label = 'The server may have moved, repeated or rolled back this message';
  return h('button', {
    type: 'button', class: 'msg-flag warn', 'data-tip': lines.join(' '), 'aria-label': `${label}. ${lines.join(' ')}`,
    onclick: () => modal({
      title: 'This message may have been tampered with', size: 'sm',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted-p' }, 'Its sender’s app put where it belongs, when it was sent and its edit count inside the encrypted message. What this server says about it doesn’t match:'),
        h('ul', { class: 'bind-list' }, lines.map((l) => h('li', null, l))),
        h('p', { class: 'field-hint' }, 'The words are the sender’s (the server can’t change those), but the server may have shown them somewhere else, at another time, more than once, or from before an edit. If it keeps happening, tell the server’s owner.')),
      actions: [{ label: 'OK', kind: 'primary' }],
    }),
  }, '⚠ ', label);
}
async function decryptAll(key) {
  const store = S.msgs[key];
  if (store) await Promise.all(store.list.map(decryptMessage));
}
const textOf = (m) => (m.dec && m.dec.t) || '';
// A message's words for a snippet (the inbox): the word filter's note instead, when it hides or blurs the message.
const snippetOf = (m, n) => { const wf = WF.check(m); return wf ? previewLabel(wf) : textOf(m).slice(0, n); };
const filesOf = (m) => (m.dec && m.dec.f) || [];
const linksOf = (m) => (m.dec && m.dec.l) || []; // link previews the sender built (already checked by secure.js)
const readable = (m) => !!m.dec && !m.dec.error && !m.dec.pending;
const keyOfMessage = (m) => (m.dmId ? 'd:' + m.dmId : 'c:' + m.channelId);
// Does this message ping me? @username, or @everyone/@channel/@here in a server channel.
// Does this message ping me? @me, a role I have, or @everyone/@channel from someone allowed to use it.
// How does this message ping me? 'mention' (@me), 'everyone' (@everyone/@channel/@here from someone
// allowed to use it), 'roleMention' (a role I have), or null.
function mentionKind(m) {
  const t = textOf(m);
  if (!t) return null;
  const me = S.me.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|\\s)@${me}(?![\\w.])`, 'i').test(t)) return 'mention';
  if (m.dmId) return null;
  const server = S.servers.find((x) => x.id === m.serverId);
  const mine = server ? (server.memberRoles || {})[S.me.id] || [] : [];
  for (const [, id] of t.matchAll(/<@&([a-z0-9]{6,40})>/g)) if (mine.includes(id) && (hookPings(m) || mayMentionRole(server, id, m.authorId))) return 'roleMention';
  if (/(^|\s)@(everyone|channel|here)\b/i.test(t) && senderMayPingEveryone(m)) return 'everyone';
  return null;
}
const mentionsMe = (m) => !!mentionKind(m);

async function onKeysChanged(serverId, added, heldChanged) {
  if (!S.me) return;
  // crypto-2: someone here was verified (or is held back now): their shield in the member list and, in a DM with
  // them, the header's badge.
  if (heldChanged && S.view.serverId === serverId && S.panel === 'members') later(renderPanel);
  if (heldChanged && S.view.type === 'dm') { later(renderHeader); if (composers.main) composers.main.renderExtras(); }
  // A group chat's background that was waiting for a key, or that's sealed with an older key than the group's now. Also
  // when nothing was added: a key this app made itself (secure.js rotate) is held before the state that names it comes
  // back, so it never counts as added, and this app may be the only one here to seal the background again with it.
  LOOK.onKeys(serverId);
  if (added) {
    NOTES.onKeys(serverId); // photo tags that were waiting for this key
    const server = S.servers.find((s) => s.id === serverId);
    for (const c of server ? server.channels : []) {
      const store = S.msgs['c:' + c.id];
      if (!store) continue;
      store.list.forEach((m) => {
        if (m.dec && m.dec.pending) m.dec = null;
        if (m.reply && m.reply.dec && m.reply.dec.pending) m.reply.dec = null;
      });
      await decryptAll('c:' + c.id);
      if (!store.loaded) continue;
      if (currentKey() === 'c:' + c.id) {
        const sc = $('#messages');
        const atBottom = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
        const top = sc ? sc.scrollTop : 0;
        renderMessages(atBottom);
        if (sc && !atBottom) sc.scrollTop = top;
      }
    }
    // Photos & videos: what was waiting for this key shows there now (its own copies are opened; the chat's just were).
    MEDIA.onKeys(serverId);
    SIDE.onKeys(serverId); // (and in the side view)
    if (server && isGroup(server)) { await previewGroup(server); if (!S.view.serverId) renderSidebar(); }
  }
  if (S.view.serverId === serverId && composers.main) { composers.main.renderExtras(); renderHeader(); }
  if (added) SCHED.onKeys(); // scheduled messages waiting for this key can be re-encrypted now
}
// A call connection the app refused (voice.js handleSignal; why from secure.js checkSdp). The other app keeps trying,
// so the same warning about the same person is shown once a minute at most.
const callWarned = new Map(); // `${userId}|${why}` -> when it was last shown
function callWarning(userId, why) {
  const key = `${userId}|${why}`;
  if (Date.now() - (callWarned.get(key) || 0) < 60000) return;
  callWarned.set(key, Date.now());
  toast(callRefusedText(why, displayName(getUser(userId))), 'error');
}
function onKeyWarning(user) {
  toast(`${displayName(user)}'s security key changed. Compare safety numbers before trusting it.`, 'error');
  if (S.view.type === 'dm' || S.view.serverId) { renderHeader(); if (composers.main) composers.main.renderExtras(); }
}
// Run a channel send/edit, refreshing our key and retrying once if the server says it's out of date.
async function withKeyRetry(serverId, fn) {
  try { return await fn(); } catch (e) {
    if (e.status === 409 && ['rotate', 'stale-key'].includes(e.code)) {
      await sec.refresh(serverId);
      return fn();
    }
    throw e;
  }
}

// ---- rendering the list
const GROUP_GAP = 7 * 60 * 1000;
function grouped(m, prev) {
  return !!prev && prev.authorId === m.authorId && !m.reply && m.createdAt - prev.createdAt < GROUP_GAP
    && new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString() && faceKey(prev) === faceKey(m);
}
// A webhook's posts can each carry their own name and picture, so they only group with posts that look the same.
const faceKey = (m) => (m.webhook ? `${m.webhook.name || ''}\n${m.webhook.avatar || ''}` : '');
// The name and picture a webhook post asked for (Uptime Kuma, Grafana…). The picture only loads through this server's
// image proxy, and the profile behind both is still the webhook's own (its name shows in the label's tip).
function hookFace(author, m) {
  const w = m.dec && m.dec.bot && m.dec.webhook;
  if (!w || (!w.name && !w.avatar)) return author;
  return { id: `hook:${author.id}`, username: author.username, bot: true, profile: { displayName: w.name || displayName(author) }, avatar: (w.avatarSrc && mediaSrc(w.avatarSrc)) || author.avatar || null };
}
// DMs and group chats open at their newest message, whatever is unread (renderMessages).
const opensAtNewest = () => S.view.type === 'dm' || isGroup(currentServer());
function renderMessages(stick) {
  const sc = $('#messages');
  if (!sc) return;
  const key = currentKey();
  const store = S.msgs[key];
  clear(sc);
  if (!store || !store.loaded) {
    sc.append(h('div', { class: 'msg-skeleton', 'aria-label': 'Loading messages' }, [1, 2, 3, 4].map(() => h('div', { class: 'sk-row' }, h('span', { class: 'sk-av' }), h('span', { class: 'sk-lines' }, h('i'), h('i'))))));
    return;
  }
  if (!store.hasMore) sc.append(...historyStart(store));
  const lastRead = S.unreadMarker === key ? S.markerId : null;
  let newShown = false;
  let prev = null; // the message above, for grouping (anything drawn in between breaks the group)
  let day = null; // the day whose divider was drawn last
  // A divider before the first thing of each day: a timer line gets its own day's, like a message.
  const dayOf = (t) => { const d = new Date(t).toDateString(); if (d !== day) { sc.append(dayDivEl(t)); day = d; prev = null; } };
  const lines = timerLines(store);
  let li = 0;
  const line = () => { const e = lines[li++]; dayOf(e.at); sc.append(sysLineEl(e)); prev = null; };
  for (const m of store.list) {
    while (li < lines.length && lines[li].at <= m.createdAt) line();
    dayOf(m.createdAt);
    if (!newShown && lastRead && m.id > lastRead && m.authorId !== S.me.id) {
      sc.append(h('div', { class: 'new-div', role: 'separator', 'aria-label': 'New messages', id: 'new-div' }, h('span', null, 'New messages')));
      newShown = true;
      prev = null;
    }
    sc.append(messageEl(m, prev, 'main'));
    prev = m;
  }
  while (li < lines.length) line();
  // stick: true for the newest message at the bottom; 'open' as the conversation opens. Opening a server channel with
  // more than a screenful unread starts at its "New messages" line. A DM or group chat always opens at the newest
  // message: the line, and the bar's "Jump to first unread", are there to go up to. Either place is kept while the
  // pictures load (keepPlace).
  if (stick) {
    const marker = stick === 'open' && !opensAtNewest() && sc.querySelector('.new-div');
    if (marker && sc._place && marker.offsetTop > sc.clientHeight * 0.6) sc._place.hold(() => sc.querySelector('.new-div'), { block: 'start', offset: MARKER_GAP });
    else toNewest(sc);
  }
  if (!store.hasNewer) redrawPendingSends(key);
  const jl = $('#jump-latest');
  if (jl) jl.hidden = !store.hasNewer;
  renderUnreadBar();
  renderSelectBar();
  ensureCurrentMessage(sc);
  renderTyping();
}
// "12 new messages since 3:04 PM · Jump to first unread · Mark as read", above the messages while there's a
// "New messages" line in this conversation.
function renderUnreadBar() {
  const bar = $('#unread-bar');
  if (!bar) return;
  const key = currentKey();
  clear(bar);
  const store = S.msgs[key];
  const n = S.unreadMarker === key ? Math.max(S.markerCount || 0, store ? store.list.filter((m) => m.id > S.markerId && m.authorId !== S.me.id).length : 0) : 0;
  bar.hidden = !n;
  if (!n) return;
  const first = store && store.list.find((m) => m.id > S.markerId && m.authorId !== S.me.id);
  bar.append(h('button', { class: 'unread-jump', onclick: () => jumpToFirstUnread() }, icon('arrowUp'),
    h('span', null, `${n >= 100 ? '99+' : n} new message${n === 1 ? '' : 's'}${first ? ` since ${fmtTime(first.createdAt)}` : ''}`), h('strong', null, 'Jump to first unread')),
  h('button', { class: 'unread-mark', onclick: () => markConvRead(key, { threads: false }) }, 'Mark as read', icon('check')));
}
async function jumpToFirstUnread() {
  const key = currentKey();
  if (S.unreadMarker !== key) return;
  const store = S.msgs[key];
  const loadedFrom = store && store.list.length ? store.list[0].id : null;
  // Straight to the line, just under the bar, and kept there while the pictures around it load (keepPlace).
  const sc = $('#messages');
  if (!sc || !sc._place) return;
  sc._place.hold(() => sc.querySelector('.new-div'), { block: 'start', offset: MARKER_GAP });
  // The first unread message isn't loaded yet (lots of new messages): load the page around the marker.
  if (!loadedFrom || loadedFrom > S.markerId) await loadMessages(key, { around: S.markerId });
  if (!sc.querySelector('.new-div')) sc._place.release();
}
// The top of a conversation once its first message is loaded: the welcome, and in a server that keeps what came before
// from new members, one line saying so when the server left messages out for you (store.hidden), instead of a row
// per message you could never open.
function historyStart(store) {
  return [welcomeBlock(), store && store.hidden ? h('div', { class: 'sys-line history-hidden', role: 'note' }, icon('lock'), h('span', null, 'Messages from before you joined are hidden in this server')) : null].filter(Boolean);
}
function welcomeBlock() {
  if (S.view.type === 'dm') {
    const d = S.dms.find((x) => x.id === S.view.dmId);
    const u = getUser(d.userId);
    return h('div', { class: 'welcome' }, avatarEl(u, 72), nameEl(u, { tag: 'h2' }),
      h('p', null, `This is the start of your conversation with ${displayName(u)}.`),
      h('p', { class: 'welcome-note' }, icon('lock'), 'Messages and files here are end-to-end encrypted. Only the two of you can read them.'),
      timerWelcome('d:' + d.id));
  }
  const server = currentServer();
  if (isGroup(server)) {
    return h('div', { class: 'welcome' }, groupAvatar(server, 72), h('h2', null, groupName(server)),
      h('p', null, 'This is the start of your group.'),
      h('p', { class: 'welcome-note' }, icon('lock'), 'End-to-end encrypted. Only people in this group can read it.'),
      timerWelcome(currentKey()));
  }
  const c = server.channels.find((x) => x.id === S.view.channelId);
  if (c.type === 'voice') {
    return h('div', { class: 'welcome' }, h('div', { class: 'welcome-ic' }, icon('message')), h('h2', null, `${c.name} chat`),
      h('p', null, 'Text chat for this voice channel: links, notes and anything said while you talk. Anyone who can see the channel can read it, in the call or not.'),
      h('p', { class: 'welcome-note' }, icon('lock'), 'End-to-end encrypted. Only members of this server can read it.'),
      timerWelcome('c:' + c.id));
  }
  const th = server.theme || {};
  return h('div', { class: 'welcome' }, h('div', { class: 'welcome-ic' }, icon(channelIcon(c))), h('h2', null, `Welcome to #${c.name}`),
    h('p', null, c.topic || 'This is the start of the channel.'),
    h('div', { class: 'welcome-invite-slot' }, inviteNudge(server, c)),
    th.welcome ? h('div', { class: 'server-welcome', html: md(linkChannelNames(th.welcome, server.channels), { mentionName: S.me.username }) }) : null,
    h('div', { class: 'welcome-roles-slot' }, welcomeRoles(server)),
    h('p', { class: 'welcome-note' }, icon('lock'), 'End-to-end encrypted. Only members of this server can read it.'),
    timerWelcome('c:' + c.id));
}
// "Pick your roles" at the start of a channel, while there's something to pick. Redrawn in place when a role is
// marked or unmarked (server:update), since the message list itself isn't.
function welcomeRoles(server) {
  return pickableRoles(server, S.me.id).length ? h('button', { class: 'btn ghost sm welcome-roles', onclick: () => pickRoles(currentServer() || server) }, icon('at'), 'Pick your roles') : null;
}
// "It's just you here. Invite people": at the top of a server's first text channel while you're its only member and
// may invite people (invite-share.js), until you dismiss it in this browser. Goes by itself once someone joins.
function inviteNudge(server, c) {
  const first = server.channels.find((x) => x.type === 'text');
  if (!c || !first || first.id !== c.id) return null;
  if (!nudgeWanted(server, { canInvite: can(server, PERMS.CREATE_INVITE), dismissed: nudgeDismissed(server.id) })) return null;
  return h('div', { class: 'invite-nudge', role: 'note' }, icon('userPlus'),
    h('span', { class: 'invite-nudge-text' }, 'It’s just you here.'),
    h('button', { class: 'btn primary sm', onclick: () => openInvite(currentServer() || server) }, 'Invite people'),
    h('button', { class: 'icon-btn sm invite-nudge-x', 'aria-label': 'Dismiss', onclick: () => {
      dismissNudge(server.id);
      refreshInviteNudge(currentServer() || server);
      const box = $('#composer-input'); if (box) box.focus({ preventScroll: true });
    } }, icon('close')));
}
function refreshInviteNudge(server) {
  if (!server || S.view.serverId !== server.id) return;
  const c = server.channels.find((x) => x.id === S.view.channelId);
  for (const slot of document.querySelectorAll('#messages .welcome-invite-slot')) {
    const card = inviteNudge(server, c);
    if (!!card !== !!slot.firstChild) { clear(slot); if (card) slot.append(card); }
  }
}
function refreshWelcomeRoles(server) {
  for (const slot of document.querySelectorAll('#messages .welcome-roles-slot')) {
    const btn = welcomeRoles(server);
    // Only when it appears or goes, so a focused button isn't swapped under the keyboard.
    if (!!btn !== !!slot.firstChild) { clear(slot); if (btn) slot.append(btn); }
  }
}

// ---- one message
function messageEl(m, prev, ctx = 'main') {
  const author = getUser(m.authorId);
  const mine = m.authorId === S.me.id;
  // A message the word filter hides shows no name, so the next one from the same person starts its own group (with
  // their name) rather than sitting under whoever spoke before.
  const isGrouped = grouped(m, prev) && !hiddenByFilter(prev);
  const text = textOf(m);
  const mentioned = !mine && mentionsMe(m);
  const replying = composers[ctx] && composers[ctx].state.replyTo && composers[ctx].state.replyTo.id === m.id;
  const el = h('div', {
    class: `msg${isGrouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${replying ? ' replying' : ''}${m.pinnedAt ? ' pinned' : ''}`,
    dataset: { mid: m.id, ctx, wf: filterState(m, prev) }, tabindex: '-1',
    oncontextmenu: (e) => {
      // On a touch screen this is a long press (Android reports one this way): the actions sheet instead.
      if (isTouchUI() && e.pointerType !== 'mouse') { e.preventDefault(); longPressed(el, e.target); return; }
      if (!e.target.closest('a, .md-code, .md-pre') || e.shiftKey) contextMenu(e, messageMenuItems(m, ctx));
    },
  });
  el._actions = (target) => messageSheet(m, ctx, el, target);
  if (S.blocked.has(m.authorId) && !el._reveal) {
    el.classList.add('blocked');
    el.append(h('div', { class: 'msg-gutter' }), h('div', { class: 'msg-body' }, h('div', { class: 'blocked-note' }, icon('ban'), 'Message from someone you blocked. ',
      h('button', { class: 'link-btn', onclick: () => { el._reveal = true; const fresh = messageElRevealed(m, prev, ctx); el.replaceWith(fresh); } }, 'Show'))));
    return selectBox(el, m, ctx);
  }
  // The word filter (wordfilter-app.js): hidden behind a row with Show, or blurred like a spoiler (fillMessage).
  // Never your own messages, and not once you've chosen to see it.
  const wf = veiled(m);
  if (wf && wf.action === 'hide') return selectBox(filteredEl(el, m, prev, ctx, wf, { author, isGrouped, text }), m, ctx);
  return selectBox(fillMessage(el, m, prev, ctx, { author, mine, isGrouped, text, blur: wf }), m, ctx);
}
// What the word filter does to a message here: null, or { action, by } (wordfilter-app.js check). Never your own
// messages, nor one you chose to see.
const veiled = (m) => (!m || m.authorId === S.me.id || WF.isShown(m.id) ? null : WF.check(m));
const hiddenByFilter = (m) => { const r = veiled(m); return !!r && r.action === 'hide'; };
// The message a reply quotes, through the filter too.
const veiledQuote = (m) => (m.reply && !WF.isShown(m.reply.id) ? WF.check({ authorId: m.reply.authorId, dec: m.reply.dec, serverId: m.serverId, channelId: m.channelId, dmId: m.dmId }) : null);
// Everything about the word filter a message row was drawn with (kept on it as data-wf): a list change redraws only
// the rows where this changed, so nothing else on screen (an edit being typed, an open poll) is touched.
const filterState = (m, prev) => { const a = veiled(m); const q = veiledQuote(m); return `${a ? a.action : ''}|${q ? q.action : ''}|${grouped(m, prev) && hiddenByFilter(prev) ? 1 : 0}`; };
// What a reply bar or reminder quotes from a message: the filter's note instead of words it hides or blurs.
const quoteOf = (m, fallback = 'Attachment') => { const wf = veiled(m); return wf ? previewLabel(wf) : readableText(textOf(m)) || fallback; };
// "Show" on a hidden or blurred message: drawn in full, and the message after it drawn again (it may now group).
function revealFiltered(m) {
  WF.reveal(m.id);
  replaceMessageEl(m);
  redrawFilterChanges();
}
// While a hidden message is drawn out of sight (filteredEl): what its pictures would load, instead of waiting for them
// to come on screen themselves.
let lazyLoads = null;
let lazyRow = null; // (and the row on screen in its place)
const loadWhenVisible = (el, fn) => (lazyLoads ? lazyLoads.push(fn) : whenVisible(el, fn));
// A message the word filter hides: one row that says so, with Show. The message is still drawn behind it, out of
// sight, and loads what it would have shown (its pictures, a poll's votes) when its row comes near the screen like any
// other: the server sees the same requests either way, so it can't tell that anything was hidden.
function filteredEl(el, m, prev, ctx, wf, o) {
  const loads = [];
  lazyLoads = loads;
  let shadow;
  lazyRow = el;
  try { shadow = fillMessage(h('div'), m, prev, ctx, { ...o, mine: false }); } finally { lazyLoads = null; lazyRow = null; }
  for (const img of shadow.querySelectorAll('img[loading="lazy"]')) {
    const src = img.getAttribute('src') || '';
    if (src && !src.startsWith('data:')) loads.push(() => { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = src; });
  }
  el.classList.add('filtered');
  // Who wrote it, unless the row above already says (the words are what's hidden, not the person).
  const who = o.isGrouped ? null : h('strong', { class: 'filtered-who' }, nameInMsg(m, o.author));
  // Its warnings stay on the row: a key or signature that doesn't check out, and the server having moved, repeated or
  // rolled it back (bindingFlag, a button that still opens its details). The words are what's hidden, never those:
  // else a server could keep its tampering out of sight by putting a word from the message on its suggested list.
  const flags = shadow.querySelectorAll(':scope > .msg-body > .msg-flag.bad, :scope > .msg-body > .msg-flag.warn');
  el.append(h('div', { class: 'msg-gutter' }), h('div', { class: 'msg-body' }, h('div', { class: 'filtered-note' }, icon('eyeOff'), who, who ? ' · ' : null, `${filterLabel(wf)}. `,
    h('button', { class: 'link-btn', type: 'button', onclick: () => revealFiltered(m) }, 'Show')), ...flags));
  if (loads.length) whenVisible(el, () => loads.forEach((f) => f()));
  // One message at a time is in the Tab order (roveMessage): this row's Show button too.
  roveMessage(el, false);
  return el;
}
// ---- bulk delete (Manage Messages): pick messages in a channel, or delete the most recent ones
const BULK_MAX = 100;
const BULK_DAYS = 14;
// Older than bulk delete reaches (the server refuses those): they're deleted one at a time.
const tooOldForBulk = (m) => Date.now() - new Date(m.createdAt).getTime() > BULK_DAYS * 86400000;
function selectBox(el, m, ctx) {
  const sel = S.select;
  if (!sel || ctx !== 'main' || sel.key !== keyOfMessage(m)) return el;
  const who = nameInMsg(m, getUser(m.authorId));
  const old = tooOldForBulk(m);
  const on = sel.ids.has(m.id);
  el.classList.toggle('selected', on);
  el.prepend(h('input', {
    type: 'checkbox', class: 'msg-select', checked: on, disabled: old,
    'aria-label': old ? `Message from ${who}: older than ${BULK_DAYS} days, delete it on its own` : `Select message from ${who}`,
    'data-tip': old ? `Older than ${BULK_DAYS} days: delete it on its own` : null,
    onchange: (e) => toggleSelect(m, e.target, el),
  }));
  if (el.tabIndex !== 0) roveMessage(el, false); // only the current message's checkbox is in the Tab order
  return el;
}
function toggleSelect(m, box, el) {
  const sel = S.select;
  if (!sel) return;
  if (box.checked && !sel.ids.has(m.id) && sel.ids.size >= BULK_MAX) { box.checked = false; toast(`You can delete up to ${BULK_MAX} messages at once.`); return; }
  if (box.checked) sel.ids.add(m.id); else sel.ids.delete(m.id);
  el.classList.toggle('selected', box.checked);
  renderSelectBar();
}
function redrawKeepingScroll() {
  const sc = $('#messages');
  const top = sc ? sc.scrollTop : 0;
  renderMessages(false);
  if (sc) sc.scrollTop = top;
}
function startSelect(m) {
  // The message it started from is ticked, unless it's too old to go in bulk (then nothing is, yet).
  S.select = { key: keyOfMessage(m), ids: new Set(tooOldForBulk(m) ? [] : [m.id]) };
  redrawKeepingScroll();
  const box = $(`#messages [data-mid="${m.id}"] .msg-select`);
  if (box) box.focus({ preventScroll: true });
}
// refocus: focus was likely on the selection bar, which goes away: put it back on the message list.
function endSelect({ refocus = false } = {}) {
  if (!S.select) return;
  const inBar = refocus && document.activeElement && document.activeElement.closest && document.activeElement.closest('#select-bar, .msg-select');
  S.select = null;
  redrawKeepingScroll();
  if (inBar || (refocus && document.activeElement === document.body)) {
    const sc = $('#messages');
    const cur = sc && sc.querySelector('.msg[tabindex="0"]');
    if (cur || sc) (cur || sc).focus({ preventScroll: true });
  }
}
function renderSelectBar() {
  const bar = $('#select-bar');
  if (!bar) return;
  const sel = S.select && S.select.key === currentKey() ? S.select : null;
  const sc = $('#messages');
  if (sc) sc.classList.toggle('selecting', !!sel);
  clear(bar);
  bar.hidden = !sel;
  if (!sel) return;
  const n = sel.ids.size;
  bar.append(h('span', { class: 'sel-count', role: 'status', 'aria-live': 'polite' }, `${n} selected`, h('span', { class: 'sel-hint' }, ` \u00b7 up to ${BULK_MAX}, from the last ${BULK_DAYS} days`)),
    h('button', { class: 'btn ghost sm', onclick: () => endSelect({ refocus: true }) }, 'Cancel'),
    h('button', { class: 'btn danger sm', disabled: !n, onclick: () => deleteSelected() }, icon('trash'), n ? `Delete ${n}` : 'Delete'));
}
const bulkDone = (r) => `Deleted ${r.deleted} message${r.deleted === 1 ? '' : 's'}.${r.kept ? ` ${r.kept} by people at or above your highest role ${r.kept === 1 ? 'was' : 'were'} kept.` : ''}`;
async function deleteSelected() {
  const sel = S.select;
  if (!sel || !sel.ids.size) return;
  // Anything that turned 14 days old while it was ticked is left out (the server would refuse the whole lot).
  const store = S.msgs[sel.key];
  for (const id of [...sel.ids]) { const m = store && store.list.find((x) => x.id === id); if (m && tooOldForBulk(m)) sel.ids.delete(id); }
  renderSelectBar();
  const n = sel.ids.size;
  if (!n) { toast(`Messages older than ${BULK_DAYS} days can\u2019t be deleted in bulk. Delete them one at a time.`, 'error'); return; }
  if (!await confirmDialog({ title: `Delete ${n} message${n === 1 ? '' : 's'}?`, text: 'They\u2019re deleted for everyone, with their files and thread replies. Messages by people at or above your highest role are kept. This can\u2019t be undone.', confirm: 'Delete', danger: true })) return;
  try {
    const r = await api('POST', `/channels/${encodeURIComponent(sel.key.slice(2))}/messages/bulk-delete`, { ids: [...sel.ids] });
    toast(bulkDone(r));
    endSelect({ refocus: true });
  } catch (e) { toast(e.message, 'error'); }
}
function openPurgeRecent(c) {
  const count = h('input', { class: 'input', type: 'number', min: '1', max: String(BULK_MAX), step: '1', value: '20', inputmode: 'numeric' });
  modal({ title: `Delete recent messages in ${chanLabel(c)}?`, size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, `The newest messages in this channel from the last ${BULK_DAYS} days go for everyone, with their files and thread replies. Messages by people at or above your highest role are kept. This can\u2019t be undone.`),
      field(`How many (up to ${BULK_MAX})`, count)),
    actions: [{ label: 'Cancel' }, { label: 'Delete', kind: 'danger', action: async () => {
      const n = Number(count.value);
      if (!Number.isInteger(n) || n < 1 || n > BULK_MAX) throw new Error(`Pick a number from 1 to ${BULK_MAX}.`);
      toast(bulkDone(await api('POST', `/channels/${encodeURIComponent(c.id)}/messages/bulk-delete`, { count: n })));
    } }] });
}
// Bot and webhook posts are labelled wherever they show (the channel, the Threads panel), so one can't pass for a
// member: the BOT tag next to the name, and a flag saying the text isn't end-to-end encrypted.
const isBotPost = (author, m) => !!(author.bot || m.bot || (m.dec && m.dec.bot));
function postFlag(m, author) {
  const d = m.dec;
  if (!d) return null;
  if (d.bot && m.authorId === NEWS_BOT_ID) return { label: 'News bot \u00b7 public feed, not end-to-end encrypted', tip: 'Posted by this server\u2019s news bot from a public feed, so it isn\u2019t end-to-end encrypted. Everything people write still is.' };
  if (d.bot && d.webhook) return { label: 'Webhook \u00b7 not end-to-end encrypted', tip: `Posted by a program outside Hearth through this channel’s webhook “${displayName(author)}”, so it isn’t end-to-end encrypted. Everything people write still is.` };
  if (d.bot) return { label: 'Bot \u00b7 not end-to-end encrypted', tip: 'Posted by a bot this server added. Bot messages aren\u2019t end-to-end encrypted. Everything people write still is.' };
  if (d.legacy) return { label: 'Older message \u2014 not end-to-end encrypted, sender not verified', tip: 'Sent before end-to-end encryption was turned on. Protected by the server\u2019s encryption only, and nothing proves who wrote it: the server could have.' };
  return null;
}
// What a message's row says about who wrote it, besides the words: the name and picture it goes by (a webhook post's
// own, hookFace), the BOT tag, and its flags (a bot's or an older message's, postFlag; a key that isn't the person's
// current trusted one; a signature that doesn't match; the server having moved, repeated or rolled it back,
// bindingFlag). The chat's rows (fillMessage) and the side view's cards both take it from here, so a message never
// shows anywhere with less said about it than in the chat: else a server could serve it there instead, under its
// author's name with nothing to say it may not be theirs.
//   flags({ warnings: true }): only the warnings, which stay on a row even when the word filter hides it (filteredEl).
//   sig: all of it in one string, so something drawn from it is drawn again when it changes (a copy of the message
//   loaded elsewhere can turn up a binding issue, say).
// bind: bindingOfMessage(m), when the caller has it already.
function messageTrust(m, author, bind = bindingOfMessage(m)) {
  const d = m.dec;
  const notes = [];
  const flag = postFlag(m, author);
  if (flag) notes.push({ label: flag.label, tip: flag.tip });
  // Opened or signed with a key that isn't the person's current, trusted one (secure.js keysOf).
  else if (d && d.keyNote === 'listed') notes.push({ warn: true, label: '\u26a0 Older key \u2014 not verified', tip: 'Written with a key the server says this person had before they reset their password. This device never saw that key as theirs and it can\u2019t be checked with safety numbers, so the server could have written this.' });
  else if (d && d.keyNote === 'new') notes.push({ warn: true, label: '\u26a0 New key \u2014 not verified yet', tip: 'This person\u2019s security key changed and you haven\u2019t verified the new one yet. Compare safety numbers from their profile.' });
  else if (d && d.keyNote === 'pinned') notes.push({ label: 'Written with an older key', tip: 'Written with a key this person had before they changed keys. This device trusted that key back then.' });
  else if (d && d.verified === false && !m.dmId) notes.push({ warn: true, label: '\u26a0 Sender could not be verified', tip: 'The signature on this message does not match the sender\u2019s key.' });
  if (bind && bind.issues.length) notes.push({ warn: true, bind });
  // The first DM format bound nothing in (not even who wrote it): say so, quietly.
  else if (m.dmId && d && d.legacyFormat) notes.push({ label: 'Older encryption format', tip: 'Encrypted by an early version of Hearth that didn\u2019t bind the conversation or the sender into the message, so the server could show it as written by either of you.' });
  const bot = isBotPost(author, m);
  return {
    face: hookFace(author, m),
    bot,
    sig: [bot ? 'bot' : '', ...notes.map((n) => (n.bind ? `bind:${n.bind.issues.join(',')}:${n.bind.copies}:${n.bind.top}` : n.label))].join('|'),
    flags: ({ warnings = false } = {}) => notes.filter((n) => n.warn || !warnings)
      .map((n) => (n.bind ? bindingFlag(m, n.bind) : h('div', { class: `msg-flag${n.warn ? ' bad' : ''}`, 'data-tip': n.tip }, n.label))),
  };
}
function messageElRevealed(m, prev, ctx) {
  const el = h('div', { class: 'msg', dataset: { mid: m.id, ctx }, tabindex: '-1' });
  return fillMessage(el, m, prev, ctx, { author: getUser(m.authorId), mine: false, isGrouped: false, text: textOf(m) });
}
// The quote of a comment on one photo (photo-notes.js): "<name>’s photo" with a small thumbnail of that very photo, in
// place of the quoted words. null when the message isn't such a comment, or names a photo the quoted message doesn't
// have (then it's quoted as any reply). Without the quoted message's files at hand (one the server left out for its
// size and that isn't loaded here, or one that can't be opened), it still says whose photo, without the picture.
// Clicking it opens that photo in the viewer when its message is on screen here, otherwise it jumps there.
function photoQuote(m, server, ru) {
  const ph = readable(m) && m.dec.ph;
  if (!ph || !m.reply) return null;
  const rd = m.reply.dec;
  const opened = !!rd && !rd.error && !rd.pending && !rd.big;
  const f = opened ? (rd.f || [])[ph.i] : null;
  if (opened && (!f || f.url !== ph.u)) return null;
  const kind = f ? mediaKind(f.type || '', f.name) : null;
  const what = kind === 'video' ? 'video' : 'photo';
  const name = nameInServer(server, ru);
  const thumb = h('span', { class: `pn-quote-thumb${f && f.sp ? ' spoiler' : ''}` }, icon(f && f.sp ? 'eyeOff' : what === 'video' ? 'video' : 'image'));
  // The small picture: its thumbnail, or a small picture itself, decrypted like the chat's (never a spoiler's, nor one
  // from someone you blocked: those keep the icon).
  const src = f && kind === 'img' && !f.sp && !S.blocked.has(m.reply.authorId) && (f.k || m.dmId)
    ? (f.th ? { ...f.th, type: 'image/webp', thumb: true } : f.size > 0 && f.size <= MANY_AUTOLOAD_MAX ? f : null) : null;
  if (src) {
    const qm = { ...m.reply, dmId: m.dmId, channelId: m.channelId, serverId: m.serverId };
    const show = (u) => { thumb.replaceChildren(h('img', { class: 'pn-quote-img', src: u, alt: '' })); thumb.classList.add('loaded'); };
    const hit = fileUrls.get(src.url); // already decrypted: drawn at once, so a redraw doesn't blink
    if (hit) show(hit);
    else loadWhenVisible(thumb, () => loadQueue(() => decryptedUrl(qm, src)).then(show).catch(() => {}));
  }
  return h('button', { class: 'msg-reply pn-reply', 'aria-label': `Replying to ${name}’s ${what}. Open it.`, onclick: () => openQuotedPhoto(m, ph) },
    h('span', { class: 'reply-spine' }), avatarEl(ru, 16), thumb,
    h('span', { class: 'reply-text pn-reply-text' }, h('strong', { class: 'pn-reply-name' }, name), `’s ${what}`));
}
function openQuotedPhoto(m, ph) {
  const el = $$('#messages .att-img, #messages .att-video, .thread-list .att-img, .thread-list .att-video').find((x) => x._item && x._item.m.id === m.reply.id
    && x._item.fi === ph.i && x._item.f.url === ph.u && !x.closest('.att-spoiler:not(.revealed)'));
  if (el) return openPhotoViewer(el, true);
  // Not on screen: to the message (in its thread if it's a thread reply).
  return m.threadId ? jumpToMessageId(m.reply.id) : jumpToMessage(keyOfMessage(m), m.reply.id);
}
// The viewer on one photo or video of the chat (el: its <img> or <video>, which carries el._item), with its side panel
// of comments and tags (side: true, or 'comment' for its comment box too). A video goes on its own: the chat's list is
// its pictures.
function openPhotoViewer(el, side) {
  const it = el._item;
  const download = () => downloadAttachment(it.m, it.f);
  if (el.tagName !== 'VIDEO') return openViewer(el, { name: it.f.name, download, side });
  return openViewer(null, { items: [{ ...it, kind: 'video', thumb: () => null, full: () => decryptedUrl(it.m, it.f), name: it.f.name || 'Video', alt: it.f.alt || '', download }], side });
}
function fillMessage(el, m, prev, ctx, { author, mine, isGrouped, text, blur = null }) {
  // In a server, people go by their nicknames there (none in DMs and group chats).
  const server = msgServer(m);
  const bind = bindingOfMessage(m);
  const trust = messageTrust(m, author, bind);
  if (m.reply) {
    const ru = getUser(m.reply.authorId);
    // A quote the server left out for its size (big: the owner's, with many files): the original says what it was,
    // when it's loaded here (in the conversation, or the thread).
    // Only that message: the one the reply names, by the author the reply names, in this conversation, opened as theirs
    // (the server can mark any quote big; it mustn't be able to put someone's words under someone else's name).
    if (m.reply.dec && m.reply.dec.big) {
      const here = [...(S.msgs[keyOfMessage(m)] || { list: [] }).list, ...(S.thread && m.channelId && S.thread.channelId === m.channelId ? threadList() : [])];
      const o = here.find((x) => x.id === m.reply.id && x.id === m.replyTo && x.authorId === m.reply.authorId && keyOfMessage(x) === keyOfMessage(m));
      if (o && o.dec && !o.dec.error && !o.dec.pending && !o.dec.forged) m.reply.dec = o.dec;
    }
    const rd = m.reply.dec;
    const rtext = rd && !rd.error && !rd.pending ? rd.t : '';
    // The quoted message goes through the word filter too (it's someone's words shown here).
    const rwf = veiledQuote(m);
    // A comment on one of its photos (photo-notes.js) quotes that photo instead of its words.
    const pq = rwf ? null : photoQuote(m, server, ru);
    if (pq) el.append(pq);
    else el.append(h('button', { class: 'msg-reply', 'aria-label': `Replying to ${nameInServer(server, ru)}. Jump to original.`, onclick: () => jumpToMessage(keyOfMessage(m), m.reply.id) },
      h('span', { class: 'reply-spine' }), avatarEl(ru, 16), nameEl(ru, { cls: 'reply-name', server }),
      rwf ? h('span', { class: 'reply-text' }, h('em', null, previewLabel(rwf)))
        : h('span', { class: 'reply-text', html: rtext ? md(rtext, { inline: true }) : rd && rd.big ? '<em>A message with many files</em>' : '<em>Attachment or encrypted message</em>' })));
  } else if (m.replyTo || (bind && bind.notes.includes('replyGone'))) {
    // Also when its sender replied to a message that was gone by the time it was posted (the server rightly leaves
    // the reply out then): no flag for that, unless the server can still find the original (bindingOfMessage).
    // replyHidden: the server left out a quote from before you joined (new members can't read back in this server).
    el.append(h('div', { class: 'msg-reply gone' }, h('span', { class: 'reply-spine' }), m.replyHidden ? 'Replying to a message from before you joined' : 'Original message is no longer available'));
  }
  const gutter = h('div', { class: 'msg-gutter', dataset: { time: fmtTime(m.createdAt) } });
  if (isGrouped) gutter.append(h('time', { class: 'msg-hover-time', datetime: new Date(m.createdAt).toISOString() }, fmtTime(m.createdAt)));
  else gutter.append(h('button', { class: 'msg-av', 'data-pop-anchor': '', 'aria-label': `View ${nameInServer(server, author)}'s profile`, onclick: (e) => openProfilePop(e.currentTarget, author.id, 'right') }, avatarEl(trust.face, 40)));
  const body = h('div', { class: 'msg-body' });
  if (!isGrouped) {
    const rs = roleStyle(server, author.id);
    body.append(h('div', { class: 'msg-head' },
      h('button', { class: 'msg-name', 'data-pop-anchor': '', onclick: (e) => openProfilePop(e.currentTarget, author.id, 'right') }, nameEl(trust.face, { roleColor: rs.color, server })),
      trust.bot ? h('span', { class: 'bot-tag' }, 'BOT') : null,
      rs.iconRole ? h('span', { class: 'role-icon', 'data-tip': rs.iconRole.name }, rs.iconRole.icon) : null,
      rs.owner ? h('span', { class: 'role-icon', 'data-tip': 'Server owner' }, '\uD83D\uDC51') : null,
      h('time', { class: 'msg-time', datetime: new Date(m.createdAt).toISOString(), title: new Date(m.createdAt).toLocaleString() }, fmtStamp(m.createdAt)),
      m.pinnedAt ? h('span', { class: 'msg-pin', 'data-tip': 'Pinned' }, icon('pin')) : null));
  }
  if (S.editing === m.id) body.append(editBox(m, ctx));
  else if (m.dec && m.dec.forged) body.append(h('div', { class: 'msg-text undecryptable', 'data-tip': 'Members\u2019 apps can\u2019t send messages without end-to-end encryption, so only the server could have written this one.' }, icon('shield'), 'Hidden: a message without end-to-end encryption, dated after this server turned it on.'));
  else if (m.dec && m.dec.error) body.append(h('div', { class: 'msg-text undecryptable' }, icon('lock'), 'This message could not be decrypted on this device.'));
  else if (m.dec && m.dec.pending) {
    body.append(h('div', { class: 'msg-text undecryptable' }, icon('lock'), m.dec.before
      ? 'Sent before you joined. Only members who had the key then can read it.'
      : 'Waiting for the encryption key from another member\u2026'));
  } else {
    const chat = P.chat;
    // A message that's only an image link shows just the picture, once the picture is really shown.
    const hideText = chat.embeds && isOnlyImageUrl(text) && !filesOf(m).length && embedDecision(text.trim(), m) === 'show';
    const embed = m.dec && m.dec.embed;
    // Blurred by the word filter: what the message shows goes under a blur, with a button on top to show it. Inert
    // until then, so nothing in it can be clicked, focused or read out by accident. It's laid out as usual, so its
    // pictures load as they would (the server can't tell).
    const out = blur ? h('div', { class: 'wf-blur-inner', inert: true }) : body;
    if (text && !hideText && !(embed && text === embed.title)) {
      const html = chat.markdown ? md(text, { mentionName: S.me.username, everyone: senderMayPingEveryone(m) }) : escapeText(text);
      out.append(h('div', { class: `msg-text${chat.jumbo && isJumbo(text) ? ' jumbo' : ''}`, html: html + (m.editedAt ? '<span class="edited" title="Edited">(edited)</span>' : '') }));
    }
    // A link preview built by the sender: it came inside the encrypted message, so nothing is fetched to show it.
    const cards = chat.linkCards !== false && senderMayEmbed(m) ? linksOf(m) : [];
    // TikTok videos and Instagram reels play in place (social-embed.js): a placeholder until tapped. One with a
    // preview card shows the card's picture and title instead of the card.
    const socials = playerMode(chat) !== 'off' && senderMayEmbed(m) ? socialLinks(text) : [];
    const links = cards.filter((l) => !socials.some((p) => p.url === l.url));
    if (links.length) out.append(h('div', { class: 'msg-links' }, links.map(linkCardEl)));
    if (socials.length) {
      out.append(h('div', { class: `msg-socials${socials.length > 1 ? ' many' : ''}` }, socials.map((p) => socialEmbedEl(p, {
        // Blurred by the word filter: always a placeholder, so nothing loads for a message you chose to hide.
        key: `${m.id}|${p.kind}:${p.id || p.short}`, card: cards.find((l) => l.url === p.url) || null, mode: blur ? 'ask' : playerMode(chat), blurred: !!blur,
      }))));
    }
    // Image links wait for a click unless they load from here or you chose Always (embedEl). Blurred, the Load button
    // is under the blur with the rest; hidden, the row drawn out of sight (filteredEl) has only the placeholder, so a
    // picture from another site loads for it only when it would have loaded anyway.
    const embeds = chat.embeds ? extractImageUrls(text).filter((u) => !links.some((l) => l.url === u) && embedDecision(u, m) !== 'skip') : [];
    if (embeds.length) out.append(h('div', { class: 'msg-embeds' }, embeds.map((u) => embedEl(u, m))));
    if (m.dec && m.dec.p) out.append(pollEl(m));
    const files = filesOf(m);
    // More than 10 (only the server's owner sends that many): pictures as a grid of small tiles (app.css).
    const many = files.length > MAX_FILES;
    if (files.length) out.append(h('div', { class: `msg-files${many ? ' many' : ''}` }, files.map((f, fi) => attachmentEl(f, m, { many, fi }))));
    const wc = watchChips(text);
    if (wc) out.append(wc);
    if (embed) out.append(newsCard(embed));
    if (blur) {
      // A click anywhere on it shows it, like a spoiler; the button is the same thing for keyboards and screen readers.
      body.append(h('div', { class: 'wf-blur', onclick: () => revealFiltered(m) }, out,
        h('button', { class: 'wf-blur-show', type: 'button' }, icon('eyeOff'), h('span', null, `${filterLabel(blur)} · Show`))));
    }
    body.append(...trust.flags());
  }
  if (m.reactions && m.reactions.length) {
    body.append(h('div', { class: 'reactions' }, m.reactions.map((r) => {
      const mineR = r.userIds.includes(S.me.id);
      const names = r.userIds.slice(0, 6).map((id) => nameInServer(server, getUser(id))).join(', ') + (r.userIds.length > 6 ? ` and ${r.userIds.length - 6} more` : '');
      const label = r.emoji.startsWith('<') ? r.emoji.replace(/^<a?(:[A-Za-z0-9_]+:).*$/, '$1') : r.emoji;
      return h('button', { class: `reaction${mineR ? ' mine' : ''}`, 'data-tip': `${names} reacted with ${label}`, 'aria-pressed': String(mineR), 'aria-label': `${label} ${r.userIds.length}`, onclick: () => react(m, r.emoji) },
        emojiNode(r.emoji, 'r-emoji'), h('span', { class: 'r-count' }, r.userIds.length));
    }), h('button', { class: 'reaction add-r', 'data-pop-anchor': '', 'aria-label': 'Add reaction', 'data-tip': 'Add reaction', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em)) }, icon('smile'))));
  }
  if (m.threadCount && ctx === 'main') {
    // "3 replies · 2 new": the new ones are other people's replies since you last read the thread (@ when one pings you).
    const ts = S.threadState[m.id];
    const fresh = ts ? ts.unread : 0;
    const pinged = fresh > 0 && ts.mentions > 0;
    const count = `${m.threadCount} ${m.threadCount === 1 ? 'reply' : 'replies'}`;
    body.append(h('button', {
      class: `thread-chip${fresh ? ' unread' : ''}`, onclick: () => openThread(m),
      'aria-label': `${count}${fresh ? `, ${fresh >= 100 ? '99+' : fresh} new${pinged ? ', mentions you' : ''}` : ''}${m.threadLastAt ? `, last reply ${relTime(m.threadLastAt)}` : ''}. Open thread`,
    }, icon('thread'),
    h('strong', null, count),
    fresh ? h('span', { class: `thread-new${pinged ? ' ping' : ''}` }, `${pinged ? '@ ' : ''}${fresh >= 100 ? '99+' : fresh} new`) : null,
    m.threadLastAt ? h('span', null, `Last reply ${relTime(m.threadLastAt)}`) : null, icon('chevronRight')));
  }
  // A disappearing message shows when it goes: next to its time, or after its text when it's grouped.
  const exp = expBadge(m);
  if (exp) (body.querySelector(':scope > .msg-head') || body.querySelector(':scope > .msg-text') || body).append(exp);
  el.append(gutter, body, messageTools(m, ctx));
  roveMessage(el, false);
  return el;
}

// ---- keyboard in message lists
// One message at a time is in the Tab order, together with its links and buttons; ↑/↓, Home and End
// move between messages. Otherwise Tab would walk through every message's toolbar to reach the composer.
const ROVABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
function roveMessage(el, on) {
  el.tabIndex = on ? 0 : -1;
  if (on) {
    for (const x of el.querySelectorAll('[data-roved]')) {
      if (x.dataset.roved) x.setAttribute('tabindex', x.dataset.roved); else x.removeAttribute('tabindex');
      delete x.dataset.roved;
    }
  } else {
    for (const x of el.querySelectorAll(ROVABLE)) {
      if (x.dataset.roved !== undefined) continue;
      x.dataset.roved = x.getAttribute('tabindex') || '';
      x.tabIndex = -1;
    }
  }
}
// Makes `msg` the list's current message (the one Tab reaches).
function setCurrentMessage(list, msg) {
  const cur = list.querySelector(':scope > .msg[tabindex="0"]');
  if (cur === msg) return;
  if (cur) roveMessage(cur, false);
  if (msg) roveMessage(msg, true);
}
// After a redraw: keep the current message if it's still there, else the newest one.
function ensureCurrentMessage(list) {
  if (!list || list.querySelector(':scope > .msg[tabindex="0"]')) return;
  const all = list.querySelectorAll(':scope > .msg[data-mid]');
  if (all.length) setCurrentMessage(list, all[all.length - 1]);
}
function messageListKeys(list) {
  list.addEventListener('focusin', (e) => {
    const msg = e.target.closest('.msg[data-mid]');
    if (msg && msg.parentElement === list) setCurrentMessage(list, msg);
  });
  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const msg = e.target.closest('.msg[data-mid]');
    // Only from the message itself: arrows inside an edit box or a slider keep their usual meaning.
    if (!msg || e.target !== msg) return;
    const all = [...list.querySelectorAll(':scope > .msg[data-mid]')];
    const i = all.indexOf(msg);
    const next = e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  });
}
// GIPHY media goes through our server (if the admin left the privacy proxy on), so GIPHY never sees viewers' IPs.
// The GIF hosts the server's media proxy accepts (server/gifmedia.js): anything else loads directly.
const isGiphy = (u) => /^https:\/\/(media\d?\.giphy\.com|i\.giphy\.com|static\.klipy\.com|static\.klipy\.co|media\.klipy\.com)\//i.test(u);
// Each GIF gets its own path (/media/gif/<short hash>), not just its own "?u=…". Older app caches ignored
// everything after "?" and showed the same GIF everywhere; a distinct path can't be mixed up.
const urlKey = (u) => { let x = 5381; for (let i = 0; i < u.length; i++) x = ((x * 33) ^ u.charCodeAt(i)) >>> 0; return x.toString(36); };
const mediaUrl = (u) => (isGiphy(u) && S.config.gifProxy && S.mediaToken ? `/media/gif/${urlKey(u)}?u=${encodeURIComponent(u)}&t=${encodeURIComponent(S.mediaToken)}` : u);
// Image links in messages (xss-8). One on another site would show that site every reader's IP address, so it
// waits behind a placeholder until clicked, unless Settings → Privacy & safety says Always or Never. Files uploaded
// here, GIFs through this server's GIF proxy and link preview pictures (inside the message) never contact the other
// site. Any other address on this server stays a plain link (outside.js imagePlace says why).
const openedOutside = openedLinks(); // Load clicked in that message this session, so a redraw doesn't ask again
const embedDecision = (u, m) => imageDecision(u, { origin: location.origin, viaProxy: mediaUrl(u) !== u, mode: outsideMode(S.me && S.me.privacy), opened: openedOutside.has(m && m.id, u) });
function embedImg(u) {
  return h('div', { class: `embed-wrap${isGiphy(u) ? ' giphy' : ''}` },
    h('img', { class: 'embed-img', src: mediaUrl(u), alt: isGiphy(u) ? 'GIF' : 'Linked image', loading: 'lazy', referrerpolicy: 'no-referrer', onclick: (e) => openViewer(e.currentTarget) }),
    isGiphy(u) ? h('span', { class: 'giphy-tag' }, /klipy/i.test(u) ? 'KLIPY' : 'GIPHY') : null);
}
function embedEl(u, m) {
  const decision = embedDecision(u, m);
  if (decision === 'show') return embedImg(u);
  const host = outsideHost(u);
  const box = h('div', { class: `embed-ask${decision === 'hidden' ? ' never' : ''}`, title: u },
    icon('image'),
    h('span', { class: 'embed-ask-text' }, h('span', { class: 'embed-ask-title' }, 'Image from ', h('strong', null, host)),
      h('span', { class: 'embed-ask-sub' }, decision === 'hidden' ? 'Not loaded: you chose Never load in Privacy & safety.' : `Loading it shows ${host} your IP address.`)));
  if (decision === 'ask') {
    box.append(h('button', { class: 'btn ghost sm', 'aria-label': `Load image from ${host}`, onclick: () => {
      openedOutside.add(m && m.id, u);
      // Redraw the whole message: one that's only this link then shows just the picture, and keyboard focus
      // (on the button, now gone) moves to the message instead of falling back to the page.
      if (m && box.closest('.msg[data-mid]')) return replaceMessageEl(m);
      const shown = embedImg(u);
      box.replaceWith(shown);
      shown.tabIndex = -1;
      shown.focus({ preventScroll: true });
    } }, 'Load image'));
  }
  return box;
}
// Outside images changed (here, or on another device): redraw just the messages showing an image link, in place,
// keeping what you're reading where it is. The message being edited is left alone (a redraw would throw away what
// you've typed); it follows the new choice when you save or cancel. So is a blocked person's message you chose to
// show (a redraw would hide it again).
function redrawImageLinks() {
  const lists = { main: (S.msgs[currentKey()] || { list: [] }).list, thread: threadList() };
  const loading = []; // [message element, its pictures still on their way]
  const run = () => {
    const done = new Set();
    for (const el of $$('.msg[data-mid]')) {
      const id = el.dataset.mid;
      if (done.has(id) || id === S.editing || !el.querySelector('.msg-embeds')) continue;
      const m = (lists[el.dataset.ctx || 'main'] || []).find((x) => x.id === id);
      if (!m || S.blocked.has(m.authorId)) continue;
      done.add(id);
      const was = new Map($$(`.msg[data-mid="${id}"]`).map((x) => [x.dataset.ctx, x.offsetHeight]));
      replaceMessageEl(m);
      // A picture switched on has no size until it's in: until then the message keeps its height, so the list
      // doesn't shrink under what you're reading and grow back.
      for (const x of $$(`.msg[data-mid="${id}"]`)) {
        const imgs = $$('img.embed-img', x).filter((i) => !i.complete);
        if (!imgs.length) continue;
        x.style.minHeight = `${was.get(x.dataset.ctx) || 0}px`;
        loading.push([x, imgs]);
      }
    }
  };
  const sc = $('#messages');
  if (!sc) return run();
  const atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80; // reading the newest: stay there
  keepAnchor(sc, run);
  if (atEnd) sc.scrollTop = sc.scrollHeight;
  // As each picture comes in, its message may grow; the first message in view goes back to its spot (the list
  // doesn't do that by itself), or the newest stays in view, unless you've scrolled since.
  const scTop = () => sc.getBoundingClientRect().top;
  const anchor = $$(':scope > .msg[data-mid]', sc).find((el) => el.getBoundingClientRect().bottom > scTop());
  const offset = anchor ? anchor.getBoundingClientRect().top - scTop() : 0;
  let at = sc.scrollTop;
  for (const [x, imgs] of loading) {
    let left = imgs.length;
    const settle = () => {
      if (--left === 0) x.style.minHeight = '';
      if (sc.scrollTop !== at) return;
      if (atEnd) sc.scrollTop = sc.scrollHeight;
      else if (anchor && anchor.isConnected) sc.scrollTop += anchor.getBoundingClientRect().top - scTop() - offset;
      at = sc.scrollTop;
    };
    for (const i of imgs) { i.addEventListener('load', settle, { once: true }); i.addEventListener('error', settle, { once: true }); }
  }
}
const escapeText = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n/g, '<br>');

// Hover toolbar: just the essentials. Everything else lives in the ⋯ menu / right-click.
function messageTools(m, ctx) {
  const ok = readable(m);
  return h('div', { class: 'msg-tools', role: 'toolbar', 'aria-label': 'Message actions' },
    h('button', { class: 'tool quick', 'data-tip': 'React with 👍', 'aria-label': 'React with thumbs up', onclick: () => react(m, '👍') }, '👍'),
    h('button', { class: 'tool', 'data-tip': 'Add reaction', 'aria-label': 'Add reaction', 'data-pop-anchor': '', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em)) }, icon('smile')),
    ok ? h('button', { class: 'tool', 'data-tip': 'Reply', 'aria-label': 'Reply', onclick: () => startReply(m, ctx) }, icon('reply')) : null,
    ok && threadable(m) && ctx === 'main' ? h('button', { class: 'tool', 'data-tip': m.threadCount ? 'Open thread' : 'Reply in thread', 'aria-label': 'Reply in thread', onclick: () => openThread(m) }, icon('thread')) : null,
    h('button', { class: 'tool', 'data-tip': 'More', 'aria-label': 'More actions', 'data-pop-anchor': '', onclick: (e) => menu(e.currentTarget, messageMenuItems(m, ctx), { align: 'end' }) }, icon('more')),
  );
}
// Threads start from a text channel's messages (a voice channel's chat is one conversation next to the call).
const threadable = (m) => !m.dmId && !m.threadId && (channelById(m.channelId) || {}).type !== 'voice';
function canModerate(m) {
  if (m.dmId) return false;
  return canIn(channelById(m.channelId), PERMS.MANAGE_MESSAGES);
}
// A channel webhook pings only if it was allowed to (the server defused its mentions otherwise, before storing it).
const hookPings = (m) => !!(m.dec && m.dec.bot && m.dec.webhook && m.dec.webhook.pings);
// Whether this message's @everyone is highlighted and pings on this device. Push notifications are the server's own check.
function senderMayPingEveryone(m) {
  if (m.dmId) return false;
  if (m.dec && m.dec.bot && m.dec.webhook) return hookPings(m);
  const server = S.servers.find((x) => x.id === m.serverId);
  return !!server && has(basePerms(server, m.authorId), PERMS.MENTION_EVERYONE);
}
// Whether this message's link previews show here. The server can't see inside messages, so members' apps
// enforce Show link previews (EMBED_LINKS), from the sender's server-wide permission (channel overrides aren't
// visible to other members, the same as @everyone above; perms.js mayEmbed). DMs always show them.
function senderMayEmbed(m) {
  if (m.dmId) return true;
  return mayEmbed(S.servers.find((x) => x.id === m.serverId), m.authorId);
}

function messageMenuItems(m, ctx) {
  const mine = m.authorId === S.me.id;
  const ok = readable(m);
  const saved = S.savedIds.has(m.id);
  const server = m.serverId && S.servers.find((s) => s.id === m.serverId);
  // Pins are the channel's notice board: in servers they need Manage Messages, even for your own messages.
  const canPin = m.dmId || isGroup(server) || canModerate(m);
  return [
    // (Beside the message's hover toolbar; on a touch screen, which has none showing, beside the message itself.)
    { key: 'react', label: 'Add reaction', icon: 'smile', action: () => { const el = $(`[data-mid="${m.id}"] .msg-tools .tool:nth-child(2)`); emojiPicker((el && el.getClientRects().length ? el : $(`[data-mid="${m.id}"]`)) || $('#main'), (em) => react(m, em)); } },
    ok ? { key: 'reply', label: 'Reply', icon: 'reply', action: () => startReply(m, ctx) } : null,
    ok && threadable(m) && ctx === 'main' ? { key: 'thread', label: m.threadCount ? 'Open thread' : 'Reply in thread', icon: 'thread', action: () => openThread(m) } : null,
    ok ? { label: 'Forward', icon: 'forward', action: () => openForward(m) } : null,
    '-',
    canPin ? { label: m.pinnedAt ? 'Unpin message' : 'Pin message', icon: 'pin', action: () => togglePin(m) } : null,
    ok ? { label: saved ? 'Remove from saved' : 'Save message', icon: 'bookmark', action: () => toggleSaved(m) } : null,
    SIDE.menuItemFor(m), // Pin to side (side-view.js): beside the chat, wherever you go next
    ctx === 'main' ? { label: 'Mark unread', icon: 'eye', action: () => markUnread(keyOfMessage(m), m.id) } : null,
    ...(ok ? remindItems(m, keyOfMessage(m), quoteOf(m, m.dec && m.dec.p ? `Poll: ${m.dec.p.q}` : 'Attachment')).map((it) => it && { ...it, key: 'remind' }) : []),
    '-',
    // Not while the word filter hides or blurs it: Show first.
    ok && textOf(m) && !veiled(m) ? { key: 'copy', label: 'Copy text', icon: 'copy', action: () => { copyText(textOf(m)); toast('Copied.'); } } : null,
    { label: 'Copy message link', icon: 'link', action: () => { copyText(messageLink(m)); toast('Message link copied. It only works for people who can see this conversation.'); } },
    mine && ok ? { key: 'edit', label: 'Edit message', icon: 'edit', hint: '\u2191', action: () => { S.editing = m.id; replaceMessageEl(m); } } : null,
    mine || canModerate(m) ? { label: 'Delete message', icon: 'trash', danger: true, action: () => deleteMessage(m) } : null,
    canModerate(m) && ctx === 'main' && !m.threadId && !S.select && !tooOldForBulk(m) ? { label: 'Select messages to delete\u2026', icon: 'check', action: () => startSelect(m) } : null,
    !mine && readable(m) ? { label: 'Report message', icon: 'shield', danger: true, action: () => openReport({ message: m, ctx }) } : null,
  ];
}
const messageLink = (m) => `${location.origin}/#m/${m.id}`;

// ---- a message's actions on a touch screen
// There's no hover there, so a long press on a message opens its actions in a sheet from the bottom of the screen:
// the quick reactions, then what its ⋯ menu offers (messageMenuItems, so the same permissions), everyday ones
// first and the ones that delete or report last. Several reminder times wait behind one "Remind me…" row, so the
// list stays short. target: what the finger was on (a link adds Copy link).
function messageSheet(m, ctx, el, target) {
  const all = messageMenuItems(m, ctx);
  const pick = all.find((it) => it && it.key === 'react');
  const first = ['reply', 'thread', 'copy', 'edit'].map((k) => all.find((it) => it && it.key === k)).filter(Boolean);
  const last = all.filter((it) => it && it !== '-' && it.danger);
  const reminders = all.filter((it) => it && it.key === 'remind');
  const remind = reminders.length > 1 ? { label: 'Remind me\u2026', icon: 'bell', more: reminders } : null;
  // The rest keep the menu's own groups.
  const groups = [first, []];
  for (const it of all) {
    if (it === '-') groups.push([]);
    else if (remind && it === reminders[0]) groups[groups.length - 1].push(remind);
    else if (it && it !== pick && !(remind && reminders.includes(it)) && !first.includes(it) && !last.includes(it)) groups[groups.length - 1].push(it);
  }
  groups.push(last);
  // The browser's own menu for a link (which would offer this) doesn't open over the sheet.
  const a = target && target.closest && target.closest('a[href]:not(.mention)');
  if (a && /^https?:/i.test(a.href)) first.unshift({ label: 'Copy link', icon: 'link', action: () => { copyText(a.href); toast('Link copied.'); } });
  const mineR = (e) => (m.reactions || []).some((r) => r.emoji === e && r.userIds.includes(S.me.id));
  let sh = null;
  const run = (fn) => () => { sh.close(); fn(); };
  // (Remind me… opens a second sheet in this one's place: the message stays marked, and focus goes back to it after.)
  const open = (content, label) => { sh = sheet(content, { label, returnTo: el, onClose: ({ replaced }) => { if (!replaced) el.classList.remove('pressed'); } }); };
  const rows = (list) => list.map((it) => h('button', {
    class: `sheet-row${it.danger ? ' danger' : ''}`, 'aria-haspopup': it.more ? 'dialog' : null, 'aria-expanded': it.more ? 'false' : null,
    onclick: it.more ? () => open(h('div', { class: 'sheet-list' }, rows(it.more)), 'Remind me') : run(it.action),
  }, icon(it.icon), h('span', null, it.label)));
  const reacts = h('div', { class: 'sheet-reacts', role: 'group', 'aria-label': 'Quick reactions' },
    QUICK_REACTIONS.map((e) => h('button', { class: `sheet-react${mineR(e) ? ' mine' : ''}`, 'aria-label': `React with ${e}`, 'aria-pressed': String(mineR(e)), onclick: run(() => react(m, e)) }, e)),
    pick ? h('button', { class: 'sheet-react more', 'aria-label': 'More reactions', onclick: run(pick.action) }, icon('plus')) : null);
  const list = h('div', { class: 'sheet-list' }, groups.filter((g) => g.length).map((g, i) => [i ? h('div', { class: 'sheet-sep', role: 'separator' }) : null, rows(g)]));
  el.classList.add('pressed');
  open([reacts, list], 'Message actions');
}
// A finger held still on a message for a moment opens that sheet, with a short buzz where the phone can. Moving the
// finger (a scroll, a swipe), a second finger or lifting it first cancels it, so taps on links, pictures, mentions and
// reactions are left alone. Android also reports the long press as a right-click (messageEl's oncontextmenu):
// whichever comes first opens the sheet, once. Only on a touch screen (device.js).
const PRESS_MS = 450;
let press = null; // the touch under way: { el, target, x, y, timer, done }
function initLongPress() {
  const stop = () => { if (press && !press.done) { clearTimeout(press.timer); press = null; } };
  document.addEventListener('touchstart', (e) => {
    stop();
    press = null;
    if (e.touches.length !== 1 || !isTouchUI() || S.select) return;
    const el = e.target.closest && e.target.closest('.msg[data-mid]');
    if (!el || !el._actions || e.target.closest('textarea, input, select, .edit-wrap')) return;
    const t = e.touches[0];
    const p = { el, target: e.target, x: t.clientX, y: t.clientY, done: false };
    p.timer = setTimeout(() => longPressed(el, p.target), PRESS_MS);
    press = p;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!press || press.done) return;
    const t = e.touches[0];
    if (e.touches.length > 1 || Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) stop();
  }, { passive: true });
  // Lifting the finger after a long press doesn't also tap what's under it (now the sheet, or its backdrop).
  document.addEventListener('touchend', (e) => {
    if (press && press.done && e.cancelable) e.preventDefault();
    stop();
    press = null;
  }, { passive: false });
  document.addEventListener('touchcancel', () => { stop(); press = null; }, { passive: true });
  document.addEventListener('scroll', stop, { capture: true, passive: true });
}
function longPressed(el, target) {
  if (press) {
    if (press.done) return;
    clearTimeout(press.timer);
    press.done = true;
  }
  if (!el.isConnected || !el._actions) return;
  try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* not allowed here */ }
  el._actions(target);
}

// A word filter list changed (yours, here or on another device, or a server's): what it changes on screen is drawn
// again. Only message rows whose filtering changed are redrawn, never one being edited, so scroll, focus and
// anything being typed stay; previews and lists are redone.
function wordFilterChanged() {
  if (!S.me || !S.serversLoaded) return;
  later(redrawFiltered);
}
function redrawFiltered() {
  redrawFilterChanges();
  const mode = panelMode();
  // (Photos & videos draw only the tiles whose filtering changed, and the side view only such cards.)
  if (mode === 'side' || mode === 'pins' || mode === 'threads' || mode === 'media') renderPanel();
  if (S.view.type === 'saved') renderMain();
  loadPreviews();
}
function redrawFilterChanges() {
  const lists = { main: (S.msgs[currentKey()] || { list: [] }).list, thread: threadList() };
  for (const el of $$('.msg[data-mid][data-wf]')) {
    const list = lists[el.dataset.ctx || 'main'] || [];
    const i = list.findIndex((x) => x.id === el.dataset.mid);
    if (!el.isConnected || i < 0 || S.editing === list[i].id) continue;
    // (replaceMessageEl draws it after the message before it in the list, so that's what it's compared with.)
    if (el.dataset.wf !== filterState(list[i], i > 0 ? list[i - 1] : null)) replaceMessageEl(list[i]);
  }
}
function replaceMessageEl(m) {
  $$(`[data-mid="${m.id}"]`).forEach((el) => {
    const ctx = el.dataset.ctx || 'main';
    const list = ctx === 'thread' ? threadList() : (S.msgs[keyOfMessage(m)] || { list: [] }).list;
    const i = list.findIndex((x) => x.id === m.id);
    const fresh = messageEl(m, i > 0 ? list[i - 1] : null, ctx);
    const wasCurrent = el.tabIndex === 0;
    const hadFocus = el.contains(document.activeElement);
    el.replaceWith(fresh);
    if (wasCurrent) setCurrentMessage(fresh.parentElement, fresh);
    // (Focus given back after a gesture stays without its ring: ui.js quietFocus.)
    if (hadFocus) { if (el.classList.contains('quiet-focus')) quietFocus(fresh); else fresh.focus({ preventScroll: true }); }
    if (S.editing === m.id) { const ta = fresh.querySelector('textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  });
}

// ---- jumping to messages (pins, replies, links, search results, Photos & videos, the side view, notifications)
// In the chat it goes straight there rather than gliding: on the way, every picture passed would start loading and,
// those whose size isn't known yet (GIFs, videos, picture links), push the message on down as they came in. It lands
// in the middle and stays there while the pictures around it load (keepPlace), lit up for a moment (again, should it
// be drawn anew meanwhile).
function flash(el) {
  const sc = el.closest('#messages');
  const id = el.dataset.mid;
  if (sc && sc._place && id) {
    const until = Date.now() + 2000;
    let at = el;
    sc._place.hold(() => {
      if (at.isConnected) return at;
      const again = sc.querySelector(`.msg[data-mid="${id}"]`);
      if (again) { at = again; if (Date.now() < until) flashRow(again); }
      return again;
    });
  } else el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  flashRow(el);
}
function flashRow(el) {
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 2000);
}
async function jumpToMessage(key, id) {
  // A voice channel's chat whose pinned messages are showing in its place: back to the chat, at the message.
  if (currentKey() !== key || (S.view.type === 'voice' && !$('#messages'))) {
    if (key.startsWith('d:')) setView({ type: 'dm', dmId: key.slice(2), jumpTo: id });
    else { const s = serverOfChannel(key.slice(2)); if (s) setView(channelView(key.slice(2), s.id, { jumpTo: id })); }
    return;
  }
  const el = $(`#messages [data-mid="${id}"]`);
  if (el) return flash(el);
  // Not loaded: the page around it, the list held at it from the moment it's drawn.
  const sc = $('#messages');
  holdMessage(sc, id);
  await loadMessages(key, { around: id });
  const again = $(`#messages [data-mid="${id}"]`);
  if (again) flash(again);
  else { if (sc && sc._place) sc._place.release(); toast('That message was deleted.'); }
}
// Jump from a side panel: on a phone the panel covers the chat, so it closes first (beside the chat, it stays).
function jumpFromPanel(key, id) {
  if (isPhoneLayout() && panelMode()) closePanel();
  return jumpToMessage(key, id);
}
// Settings → Storage: the name and type of one of your files. The server only knows sizes and where it was posted;
// the name is inside the encrypted message, so it comes from a message this app has open, or fetches and opens now.
async function fileInfo(url, where) {
  const look = (list) => {
    for (const m of list || []) for (const f of filesOf(m)) { if (f.url === url) return f; if (f.th && f.th.url === url) return { ...f, preview: true }; }
    return null;
  };
  for (const st of Object.values(S.msgs)) { const f = look(st.list); if (f) return f; }
  const key = where && where.messageId ? (where.type === 'dm' ? 'd:' + where.dmId : where.type === 'channel' ? 'c:' + where.channelId : null) : null;
  if (!key) return null;
  const res = await api('GET', `${msgUrl(key)}?around=${encodeURIComponent(where.messageId)}`);
  const m = (res.messages || []).find((x) => x.id === where.messageId);
  if (!m) return null;
  await decryptMessage(m);
  return look([m]);
}
async function jumpToMessageId(id) {
  try {
    const loc = await api('GET', `/messages/${encodeURIComponent(id)}/locate`);
    if (loc.kind === 'dm') return jumpToMessage('d:' + loc.dmId, id);
    if (loc.threadId) {
      await jumpToMessage('c:' + loc.channelId, loc.threadId);
      const store = S.msgs['c:' + loc.channelId];
      const root = store && store.list.find((x) => x.id === loc.threadId);
      if (root) openThread(root, id);
      return;
    }
    return jumpToMessage('c:' + loc.channelId, id);
  } catch (e) { toast(e.message, 'error'); }
}
// Links: /#m/<messageId>, /#c/<channelId>, /#d/<dmId>, /#call/<room> (a call notification), /#invite/<code>
// (an invite link the Android app was opened with).
function openLinkFromHash() {
  const hsh = location.hash;
  if (!S.me || !hsh) return;
  history.replaceState(null, '', location.pathname);
  let m = hsh.match(/^#m\/([a-z0-9]+)$/i);
  if (m) return jumpToMessageId(m[1]);
  if (hsh === '#updates') return setView({ type: 'updates' });
  if (hsh === '#study') return setView({ type: 'study' });
  if (hsh === '#scheduled') return SCHED.openList(null); // a push about a scheduled message
  m = hsh.match(/^#c\/([a-z0-9]+)$/i);
  if (m) { const s = serverOfChannel(m[1]); if (s) openChannel(m[1], s.id); else toast('You don\u2019t have access to that channel.'); return; }
  m = hsh.match(/^#d\/([a-z0-9]{1,64})$/i);
  if (m) { if (S.dms.find((d) => d.id === m[1])) openDm(m[1]); else toast('That conversation isn\u2019t available.'); return; }
  m = hsh.match(/^#call\/((?:dm:)?[a-z0-9]{1,64})$/i);
  if (m) return openCallFromLink(m[1]);
  m = hsh.match(/^#invite\/([A-Za-z0-9]{2,64})$/);
  if (m) openJoinModal(m[1]);
}
// A call notification was tapped: open the conversation, and ring again if the call is still going (onRing
// skips calls you're already in, Do Not Disturb and rings already showing). Only calls the server rings ring here
// (a DM call with the other person in it, a group chat's call), so a #call/ link to a server's voice channel,
// which anyone can post, never shows a made-up "incoming call" from whoever is sitting in it.
// The room passed on is rebuilt from our own list of DMs and channels, never the link's text.
function openCallFromLink(link) {
  const inCall = (room, userId) => (S.voice[room] || []).some((x) => x.userId === userId);
  let room = null;
  let from = null;
  if (link.startsWith('dm:')) {
    const d = S.dms.find((x) => x.id === link.slice(3));
    if (!d) return toast('That call isn\u2019t available.');
    openDm(d.id);
    room = 'dm:' + d.id;
    if (d.userId && inCall(room, d.userId)) from = d.userId;
  } else {
    const s = serverOfChannel(link);
    if (!s) return toast('You don\u2019t have access to that call.');
    const c = textChannel(s);
    if (c) openChannel(c.id, s.id);
    const ch = channelById(link);
    if (isGroup(s) && ch && ch.type === 'voice') {
      room = ch.id;
      from = ((S.voice[room] || []).find((x) => x.userId !== S.me.id) || {}).userId || null;
    }
  }
  if (room && from && !(voice && voice.channelId === room)) onRing({ room, from, video: false });
}

// ---- message actions
// Spelling (Settings → Chat; spelling.js): the browser's underlines, and corrections as people type on a computer
// (phones and tablets have their keyboard's own; on unless chosen otherwise where the browser's language is English).
// On this device only.
const spellcheckAttr = () => (P.chat.spellcheck !== false ? 'true' : 'false');
const correcting = () => (P.chat.autocorrect ?? englishHere()) !== false && !isTouchUI();
// What a box sends, its last word corrected (not a bot's /command or a word just pasted; for an edit, was: the text
// before, only a new last word).
const spelled = (ta, was = null) => (correcting() && !lastWordPasted(ta) ? correctSending(ta.value, { was }) : ta.value);
// Another box people write a message in (scheduled.js): the same spelling.
const spellBox = (ta) => { ta.spellcheck = P.chat.spellcheck !== false; autocorrect(ta, { on: correcting }); };
function editBox(m, ctx) {
  const ta = h('textarea', { class: 'edit-input', rows: '1', 'aria-label': 'Edit message', spellcheck: spellcheckAttr() });
  ta.value = textOf(m);
  autocorrect(ta, { on: correcting });
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 300) + 'px'; };
  ta.addEventListener('input', autosize);
  setTimeout(autosize);
  const done = () => { S.editing = null; replaceMessageEl(m); const c = composers[ctx]; if (c) c.focus(); };
  const save = async () => {
    const content = ta.value === textOf(m) ? ta.value : spelled(ta, textOf(m));
    if (!content.trim() && !filesOf(m).length) return deleteMessage(m);
    if (content === textOf(m)) return done();
    try {
      // Everything else inside the message stays as it was: its poll, its disappearing timer (edits never move
      // when a message goes) and any link preview whose link is still in the text (an edit never fetches a new
      // preview).
      const still = linkedUrls(content, { skipSpoilers: true });
      const kept = linksOf(m).filter((x) => still.includes(x.url));
      // Where it belongs stays too (binding.js): the same id, reply, thread and time, one edit later. One sent by an
      // app from before that stays without. So does the photo a comment is about (ph, photo-notes.js).
      const payload = { t: content, f: filesOf(m), ...(m.dec && m.dec.p ? { p: m.dec.p } : {}), ...(m.dec && m.dec.x ? { x: m.dec.x } : {}), ...(kept.length ? { l: kept } : {}),
        ...(m.dec && m.dec.ph ? { ph: m.dec.ph } : {}), ...(m.dec && m.dec.b ? bindEdit(m.dec.b) : {}) };
      if (m.dmId) await api('PATCH', `/dm-messages/${m.id}`, { ciphertext: await encryptFitting(payload, (p) => sec.encryptDm(m.dmId, p)) });
      else {
        await withKeyRetry(m.serverId, async () => {
          const { ciphertext, epoch } = await encryptFitting(payload, (p) => sec.encryptChannel(m.serverId, m.channelId, p));
          await api('PATCH', `/messages/${m.id}`, { ciphertext, epoch });
        });
      }
      S.editing = null;
    } catch (e) { toast(e.message, 'error'); }
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
  });
  const wrap = h('div', { class: 'edit-wrap' }, ta, h('div', { class: 'edit-hint' }, 'Esc to ', h('button', { class: 'link-btn', onclick: done }, 'cancel'), ' \u00b7 Enter to ', h('button', { class: 'link-btn', onclick: save }, 'save')));
  // Back on a phone (phoneNav) cancels too. Focus stays on the message, without a ring (it came from a gesture), and
  // the keyboard doesn't come back up for the message box.
  wrap._cancel = () => {
    const had = wrap.contains(document.activeElement);
    if (had) document.activeElement.blur();
    S.editing = null;
    replaceMessageEl(m);
    const el = had && $(`[data-mid="${m.id}"][data-ctx="${ctx}"]`);
    if (el) quietFocus(el);
  };
  return wrap;
}
async function deleteMessage(m) {
  if (!(await confirmDialog({ title: 'Delete message?', text: m.threadCount ? 'This removes the message and its thread for everyone.' : 'This removes it for everyone.', confirm: 'Delete', danger: true }))) return;
  try {
    if (m.dmId) await api('DELETE', `/dm-messages/${m.id}`);
    else await api('DELETE', `/messages/${m.id}`);
  } catch (e) { toast(e.message, 'error'); }
}
async function react(m, emoji) {
  pushRecentEmoji(emoji);
  try { await api('POST', `/messages/${m.id}/reactions`, { emoji }); } catch (e) { toast(e.message, 'error'); }
}
async function togglePin(m) {
  const wasPinned = !!m.pinnedAt; // read before the request: the live update can land first
  try { await api(wasPinned ? 'DELETE' : 'POST', `/messages/${m.id}/pin`); toast(wasPinned ? 'Message unpinned.' : 'Message pinned. Find it under the pin icon in the header.'); } catch (e) { toast(e.message, 'error'); }
}
function whereLabel(m) {
  if (m.dmId) { const d = S.dms.find((x) => x.id === m.dmId); return d ? `DM with ${displayName(getUser(d.userId))}` : 'Direct message'; }
  const s = S.servers.find((x) => x.id === m.serverId);
  if (isGroup(s)) return groupName(s);
  const c = channelById(m.channelId);
  return s && c ? `${chanLabel(c)} \u00b7 ${s.name}` : 'Channel';
}
async function toggleSaved(m) {
  const was = S.savedIds.has(m.id);
  try {
    if (was) { await api('DELETE', `/me/saved/${m.id}`); S.savedIds.delete(m.id); toast('Removed from saved.'); }
    else { await api('PUT', `/me/saved/${m.id}`, {}); S.savedIds.add(m.id); toast('Saved. Find it under Home \u2192 Saved messages.'); }
  } catch (e) { toast(e.message, 'error'); }
  if (S.view.type === 'saved') renderMain();
}
function startReply(m, ctx = 'main') {
  const c = composers[ctx];
  if (c) c.setReply(m);
}
// Forward: re-encrypt the message (and its file keys) for another conversation.
function openForward(m) {
  const input = h('input', { class: 'input', placeholder: 'Search conversations and channels', 'aria-label': 'Search destinations' });
  const note = h('input', { class: 'input', placeholder: 'Add a message (optional)', maxlength: '2000' });
  const list = h('div', { class: 'quick-list' });
  const dests = [
    ...conversations().map((c) => ({ label: c.title, sub: c.key.startsWith('g:') ? 'Group' : 'Direct message', key: c.key.startsWith('g:') ? c.unreadKey : c.key, av: c.avatar })),
    ...realServers().flatMap((s) => s.channels.filter((c) => c.type === 'text').map((c) => ({ label: `#${c.name}`, sub: s.name, key: 'c:' + c.id, av: h('span', { class: 'dest-ic' }, icon('hash')) }))),
  ].filter((d) => d.key);
  let mdl;
  const draw = () => {
    clear(list);
    const q = input.value.trim().toLowerCase();
    dests.filter((d) => !q || d.label.toLowerCase().includes(q) || d.sub.toLowerCase().includes(q)).slice(0, 40).forEach((d) => list.append(
      h('button', { class: 'quick-row', onclick: async () => {
        try {
          // Sent to other people, so the author goes by their own name, never your private nickname for them.
          const fwd = forwardText({ note: note.value, author: getUser(m.authorId), text: textOf(m) });
          // A link preview goes along: the quoted text still has its link, so readers there keep the card.
          const all = filesOf(m);
          const go = (f) => sendTo(d.key, null, { t: fwd, f, ...(linksOf(m).length ? { l: linksOf(m) } : {}) }, null);
          // The server's owner can send 100 files in one message, and everyone else 10: a message of theirs too big for
          // anyone else to send on goes with the first 10.
          let some = 0;
          try { await go(all); } catch (e) {
            if (!(e.code === 'too_long' && all.length > maxFiles())) throw e;
            some = maxFiles();
            await go(all.slice(0, some));
          }
          mdl.close();
          toast(some ? `Forwarded to ${d.label} with the first ${some} of its ${all.length} files.` : `Forwarded to ${d.label}.`);
        } catch (e) { toast(e.message, 'error'); }
      } }, d.av.cloneNode(true), h('span', { class: 'quick-text' }, h('strong', null, d.label), h('span', null, d.sub)))));
  };
  input.addEventListener('input', draw);
  const disNote = disappears(m) ? h('p', { class: 'field-hint dis-hint' }, icon('timer'), 'This message is set to disappear. Your copy follows the setting where you send it, and its files stop loading when the original disappears.') : null;
  mdl = modal({ title: 'Forward message', size: 'sm', body: h('div', { class: 'stack' }, input, list, note, disNote) });
  draw();
  input.focus();
}

// ======================================================================= attachments + media viewer
// Decrypted files are blob: URLs, kept in a bounded cache (files.js makeUrlCache) so a long session full of
// photos and videos doesn't keep every one in memory: the least recently used are revoked once they're off screen.
const fileUrls = makeUrlCache();
const fileJobs = new Map(); // url -> { job, listeners }: downloads in progress, shared by everyone asking
const AUTOLOAD_MAX = 20 * 1024 * 1024; // bigger videos and songs wait for a click instead of downloading by themselves
const goneFile = () => Object.assign(new Error('This file is no longer available.'), { code: 'gone' });
const THUMB_MAX = 2 * 1024 * 1024; // a thumbnail is 480 px (media.js): tens of KB
function decryptedUrl(m, f) {
  if (!isUploadUrl(f.url)) return Promise.reject(new Error('This file isn\u2019t on this server.'));
  // A disappearing message's files go with it: nothing is fetched or decrypted for one whose time has passed.
  if (isExpired(m, nowServer())) return Promise.reject(goneFile());
  const ready = fileUrls.get(f.url);
  if (ready) return Promise.resolve(ready);
  if (!fileJobs.has(f.url)) {
    const listeners = new Set();
    const job = (async () => {
      // f.size is the plain size; the ciphertext adds a 12-byte IV and a 16-byte tag. Whoever sent the message wrote
      // it (and a thumbnail has none), so the download stops past it (a thumbnail past THUMB_MAX): a message can't
      // make everyone who scrolls past it download big files it calls small.
      const buf = await download(f.url, { expected: f.size ? f.size + 28 : 0, max: f.thumb ? THUMB_MAX : f.size > 0 ? f.size + 28 + 4096 : AUTOLOAD_MAX, onProgress: (x) => listeners.forEach((fn) => fn(x)) });
      const plain = await sec.decryptAttachment(m, f, buf);
      if (isExpired(m, nowServer())) throw goneFile(); // it went while downloading: don't keep a copy
      return fileUrls.put(f.url, new Blob([plain], { type: f.type || 'application/octet-stream' }));
    })();
    fileJobs.set(f.url, { job, listeners });
    // A failed try isn't remembered: the next click fetches again instead of failing straight away.
    job.then(() => fileJobs.delete(f.url), () => fileJobs.delete(f.url));
  }
  return fileJobs.get(f.url).job;
}
// Download progress (0–1) of a file decryptedUrl is fetching right now, if it is.
function watchFile(url, fn) { const entry = fileJobs.get(url); if (entry && fn) entry.listeners.add(fn); }
function fileIcon(type, name) {
  if (/^image\//.test(type)) return 'image';
  if (/pdf|text|document|msword|sheet|presentation/.test(type) || /\.(pdf|txt|md|docx?|xlsx?|pptx?|csv)$/i.test(name)) return 'file';
  return 'file';
}
const goneText = 'This file is no longer available';
async function downloadAttachment(m, f, btn) {
  if (btn && btn.disabled) return;
  const label = btn && !btn.classList.contains('att-dl') ? btn.lastChild : null;
  const before = label && label.nodeType === 3 ? label.textContent : null;
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try {
    const enc = !!f.k || !!m.dmId;
    // Big files show how far the download has got on the button.
    const onProgress = before != null && (f.size || 0) > 2 * 1024 * 1024 ? (x) => { label.textContent = `${Math.round(x * 100)}%`; } : null;
    // Only ever a decrypted copy or a file on this server: never a jump to another site.
    const copy = enc ? decryptedUrl(m, f) : null;
    if (copy) watchFile(f.url, onProgress);
    const href = safeDownloadHref(enc ? await copy : f.url, location.origin);
    if (!href) throw new Error('This file isn\u2019t on this server.');
    const a = h('a', { href, download: f.name || 'file' });
    document.body.append(a); a.click(); a.remove();
  } catch (e) {
    if (e.code === 'gone') {
      const card = btn && btn.closest('.att-file, .att-media');
      if (card) markGone(card);
      toast(`${f.name || 'This file'} is no longer available.`, 'error');
    } else toast(`Couldn\u2019t download ${f.name || 'the file'}: ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    if (before != null) label.textContent = before;
  }
}
// A file that was deleted (with its message, its server, or by an admin) says so plainly, instead of a retry
// button that can never work.
function markGone(card) {
  card.classList.remove('loading', 'locked', 'failed');
  card.classList.add('gone');
  card.querySelectorAll('.att-retry, .att-dl, .att-play, img, video, audio').forEach((x) => x.remove());
  const btn = card.querySelector('.btn');
  if (btn) btn.remove();
  if (card.querySelector('.att-gone')) return;
  const text = card.querySelector('.att-file-text');
  if (text) text.append(h('span', { class: 'att-gone' }, goneText)); else card.append(h('div', { class: 'att-gone' }, icon('file', 'ic'), goneText));
}
// A small "Download" button on photos, videos and audio, which otherwise have no way to save them.
function mediaDownloadBtn(m, f) {
  const b = h('button', { class: 'att-dl', type: 'button', title: `Download ${f.name || 'file'}`, 'aria-label': `Download ${f.name || 'file'}`,
    onclick: (e) => { e.stopPropagation(); downloadAttachment(m, f, b); } }, icon('download'));
  return b;
}
const loadQueue = makeQueue(3);
// Phones and touch screens (device.js): the chat shows a picture's thumbnail (480 px, made for desktops), and drawn
// much bigger than that on a sharp screen it looks soft. So once it's on screen, the full picture loads (through the
// same queue, with the same progress bar) and takes the thumbnail's place once it's ready to draw, without a flash.
// Not with Data Saver on or for a very big file; what's sent and stored stays the same.
// standIn: the row a message the word filter hides is drawn as (filteredEl). Its picture isn't on screen, so it's
// sized as it would be there (app.css: on a phone the message's width, at most 70% of the screen's height; elsewhere
// at most 440 x 340, and 40% of the window's height) and loads the same way when the row comes on screen: the server
// sees the same downloads either way.
function sharpenWhenShown(el, holder, f, full, standIn) {
  if (!(isTouchUI() || isPhoneLayout()) || !holder.classList.contains('sized')) return;
  if ((navigator.connection && navigator.connection.saveData) || !(f.size > 0) || f.size > AUTOLOAD_MAX) return;
  const w = Number(f.w); const h = Number(f.h);
  const soft = () => {
    const nw = el.naturalWidth; const nh = el.naturalHeight;
    if (!nw || !nh || !(standIn || el).isConnected) return false;
    const body = standIn && standIn.querySelector('.msg-body');
    const drawn = standIn ? Math.min(body ? body.clientWidth : 0, w, isPhone() ? (0.7 * innerHeight * w) / h : Math.min(440, (340 * w) / h, (0.4 * innerHeight * w) / h))
      : Math.min(el.clientWidth, (el.clientHeight * nw) / nh); // (the box may be letterboxed)
    return drawn * (window.devicePixelRatio || 1) > 1.25 * nw && w > nw * 1.1;
  };
  const shown = el.complete ? Promise.resolve() : new Promise((resolve) => el.addEventListener('load', resolve, { once: true }));
  shown.then(() => whenOnScreen(standIn || holder, () => {
    if (!soft()) return;
    loadQueue(full).then((u) => {
      if (!el.isConnected || el.getAttribute('src') === u) return null;
      const next = new Image();
      next.src = u;
      return (next.decode ? next.decode() : Promise.resolve()).then(() => { if (el.isConnected) el.src = u; });
    }).catch(() => {}); // the thumbnail stays (the viewer still loads the full picture when it's opened)
  }));
}
// many: one of more than 10 files in a message (the server's owner can send up to 100). Pictures are small tiles there,
// so their thumbnail is sharp enough everywhere (no full picture loads by itself), and videos, songs and pictures
// without a thumbnail over 2 MB wait for a click: a hundred of them shouldn't all download for everyone who scrolls by.
const MANY_AUTOLOAD_MAX = 2 * 1024 * 1024;
function attachmentEl(f, m, { many = false, fi = 0 } = {}) {
  // Unencrypted entries (older messages) load straight from this server; anything else was dropped when the
  // message was decrypted (see attachments.js), and is refused here too.
  const direct = () => (isUploadUrl(f.url) ? Promise.resolve(f.url) : Promise.reject(new Error('This file isn\u2019t on this server.')));
  if (f.voice) return voiceEl(f, () => ((f.k || m.dmId) ? decryptedUrl(m, f) : direct()));
  const enc = !!f.k || !!m.dmId;
  const type = f.type || '';
  const media = mediaKind(type, f.name);
  if (media) {
    // The sender's description (alt text) is what screen readers say; the file name stands in without one.
    const el = media === 'img'
      ? h('img', { class: 'att-img', alt: f.alt || f.name || 'Image', tabindex: '0', role: 'button', 'aria-label': `Open ${f.alt || f.name || 'image'}` })
      : h(media, { class: `att-${media}`, controls: true, preload: 'metadata', 'aria-label': f.alt || null });
    // Which file of which message this is (the viewer, photo comments and tags work from it).
    el._item = { m, f, fi, key: keyOfMessage(m) };
    const holder = h('div', { class: `att-media${enc ? ' locked' : ''}`, dataset: { name: f.name || '' } }, el);
    const standIn = lazyRow;
    if (f.alt && media !== 'audio') { holder.classList.add('has-alt'); holder.append(altChip(f.alt)); }
    if (f.sp) spoilerCover(holder, el, media);
    // Reserve the right space up front so the chat doesn't jump while images load (a tile's is its grid cell).
    if (media === 'img' && many) holder.classList.add('tile');
    else if (media === 'img' && Number(f.w) > 0 && Number(f.h) > 0) {
      const w = Math.min(440, f.w, Math.round(340 * f.w / f.h));
      holder.style.width = `${w}px`;
      holder.style.aspectRatio = `${f.w} / ${f.h}`;
      // Its shape, for app.css: a short window shrinks it to fit, and a phone sizes it up to the message's width.
      holder.style.setProperty('--att-w', String(Number(f.w))); holder.style.setProperty('--att-h', String(Number(f.h)));
      holder.classList.add('sized');
    }
    const meter = h('div', { class: 'att-meter', hidden: true }, h('i'));
    const onProgress = (x) => { meter.hidden = x >= 1; meter.firstChild.style.width = `${Math.round(x * 100)}%`; };
    const full = () => (enc ? decryptedUrl(m, f) : direct());
    const fullWatched = () => { const p = full(); watchFile(f.url, onProgress); const hide = () => { meter.hidden = true; }; p.then(hide, hide); return p; };
    if (media === 'img') {
      el._full = fullWatched;
      el.addEventListener('click', () => openViewer(el, { name: f.name, download: () => downloadAttachment(m, f) }));
      // It's a button for screen readers and keyboards, so Enter and Space open it too.
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    }
    if (media === 'audio') holder.prepend(h('div', { class: 'att-audio-name' }, icon('file', 'ic'), f.name, h('span', { class: 'att-size' }, fmtSize(f.size || 0))));
    holder.append(meter, mediaDownloadBtn(m, f));
    // One of several photos and videos in a message (photo-notes.js): its comment and tag counts, and on hover "Comment
    // on this photo", which opens it in the viewer with the comment box ready. Never a spoiler nobody has opened yet
    // (the button only shows once it's open, app.css).
    if (media !== 'audio') holder.append(...NOTES.tileExtras(m, fi, () => { if (!holder.matches('.att-spoiler:not(.revealed)')) openPhotoViewer(el, 'comment'); }));
    // Load only when it scrolls near the screen, a few at a time; images show the small thumbnail first.
    const load = () => {
      holder.classList.add('loading');
      const want = media === 'img' && f.th ? () => decryptedUrl(m, { ...f.th, type: 'image/webp', thumb: true }) : fullWatched;
      loadQueue(want).then((u) => { el.src = u; holder.classList.remove('locked', 'loading', 'failed'); if (media === 'img' && f.th) sharpenWhenShown(el, holder, f, fullWatched, standIn); })
        .catch((e) => {
          holder.classList.remove('loading');
          if (e && e.code === 'gone') return markGone(holder);
          holder.classList.add('failed');
          const again = h('button', { class: 'att-retry', onclick: (ev) => { ev.stopPropagation(); again.remove(); load(); } }, icon('arrowDown'), 'Couldn\u2019t load \u2014 tap to retry');
          holder.append(again);
        });
    };
    // Big videos and songs wait for a click (with the size on the button), then download with a progress bar; among
    // many files, every video and song, and big pictures without a thumbnail, too.
    // (A size the sender left out is unknown, not small.)
    const waits = media === 'img' ? many && !f.th && !((f.size || 0) > 0 && f.size <= MANY_AUTOLOAD_MAX) : many || !(f.size > 0) || f.size > AUTOLOAD_MAX;
    if (enc && waits) {
      holder.classList.remove('locked');
      holder.classList.add('click-to-load');
      el.hidden = true;
      const play = h('button', { class: 'att-play', type: 'button', onclick: (e) => {
        e.stopPropagation(); play.remove(); el.hidden = false; holder.classList.remove('click-to-load');
        loadQueue(fullWatched, { front: true }).then((u) => { el.src = u; holder.classList.remove('locked'); if (media === 'video') el.play().catch(() => {}); })
          .catch((err) => { if (err && err.code === 'gone') markGone(holder); else { toast(err.message, 'error'); holder.append(play); el.hidden = true; holder.classList.add('click-to-load'); } });
      } }, icon(media === 'video' ? 'play' : media === 'img' ? 'image' : 'music'), h('span', null, `${media === 'video' ? 'Play video' : media === 'img' ? 'Show' : 'Play audio'} · ${fmtSize(f.size)}`));
      holder.append(play);
      if (media === 'video') holder.prepend(h('div', { class: 'att-audio-name' }, icon('file', 'ic'), f.name));
    } else if (enc || f.th || !isUploadUrl(f.url)) loadWhenVisible(holder, load); else el.src = f.url;
    return holder;
  }
  // Anything the app can't show: a card with the name, size and kind of file. The whole card downloads it.
  const btn = h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => { e.stopPropagation(); downloadAttachment(m, f, btn); } }, icon('download'), 'Download');
  // Only files stored as they are (older, unencrypted messages) have a link worth sharing: an encrypted file's
  // address leads to scrambled bytes, and its key is only in the message.
  const link = !enc && isUploadUrl(f.url)
    ? h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => { e.stopPropagation(); copyText(new URL(f.url, location.origin).href); toast('Link copied.'); } }, icon('link'), 'Copy link') : null;
  return h('div', { class: `att-file${f.sp ? ' spoiler' : ''}`, title: `Download ${f.name || 'file'}`, onclick: () => downloadAttachment(m, f, btn) },
    h('span', { class: 'att-file-badge' }, icon(fileIcon(type, f.name || ''), 'ic'), h('span', null, ((f.name || '').split('.').pop() || 'file').slice(0, 4).toUpperCase())),
    h('div', { class: 'att-file-text' }, f.sp ? h('span', { class: 'att-spoiler-tag' }, icon('eyeOff', 'ic'), 'Spoiler') : null, h('span', { class: 'att-name', title: f.name }, f.name || 'file'),
      h('span', { class: 'att-size' }, fmtSize(f.size || 0), h('span', { class: 'att-kind' }, typeLabel(type, f.name || '')), enc ? h('span', { class: 'att-enc' }, icon('lock', 'ic'), 'Encrypted') : null)),
    link, btn);
}

// The ALT button in a picture's corner: the sender's description, for anyone (screen readers read it anyway).
function altChip(text) {
  const b = h('button', { class: 'att-alt', type: 'button', 'aria-label': 'Show description', 'data-pop-anchor': '',
    onclick: (e) => { e.stopPropagation(); popover(b, h('div', { class: 'alt-pop' }, h('div', { class: 'alt-pop-head' }, 'Description'), h('p', null, text)), { side: 'top', label: 'Image description' }); } }, 'ALT');
  return b;
}
// A spoiler attachment is blurred under a Spoiler button. The first click (or Enter) only shows it; after that the
// picture opens in the viewer as usual. Videos and songs stay paused until then.
function spoilerCover(holder, el, media) {
  holder.classList.add('att-spoiler');
  if (media === 'img') el.tabIndex = -1;
  const what = media === 'img' ? 'picture' : media === 'video' ? 'video' : 'audio';
  const cover = h('button', { class: 'att-spoiler-btn', type: 'button', 'aria-label': `Spoiler ${what}, select to show` },
    h('span', { class: 'att-spoiler-pill' }, icon('eyeOff'), h('span', null, 'Spoiler')));
  cover.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    holder.classList.add('revealed');
    cover.remove();
    if (media === 'img') el.tabIndex = 0;
    const next = el.hidden ? holder.querySelector('.att-play') : el; // a big video waits behind its Play button
    if (next) next.focus({ preventScroll: true });
  });
  holder.append(cover);
}

// A picture in the chat as an item for the viewer: which photo of which message it is (img._item, from attachmentEl),
// or a picture link's (a message's, with nothing to decrypt).
function chatViewerItem(img, { name: named, download } = {}) {
  const holder = img.closest('.att-media');
  const name = (holder ? holder.dataset.name : img.alt) || named || 'Image';
  const shown = () => (img.src ? Promise.resolve(img.src) : null); // what the chat shows now (the thumbnail, often)
  const it = img._item;
  if (it) return { ...it, kind: 'img', thumb: shown, full: img._full || null, name, alt: it.f.alt || '', download: download || (() => downloadAttachment(it.m, it.f)) };
  const row = img.closest('[data-mid]');
  return { m: null, mid: row ? row.dataset.mid : null, key: currentKey(), kind: 'img', thumb: shown, full: img._full || null, name, alt: '', download: download || null };
}
// The full-screen viewer, for pictures and videos.
//   items: what left and right go through, starting at index (the Photos & videos panel passes its list, videos too).
//   Without it, every picture in the conversation loaded so far, as always. An item is { m, f, fi, key,
//   kind: 'img'|'video', thumb: () => Promise<url>|null, full: () => Promise<url>, name, alt, download: () => void }.
//   side: true opens it with the photo's side panel of comments and tags (photo-notes.js) showing; 'comment' also puts
//   the focus in its comment box.
function openViewer(fromImg, { name, download, items: given = null, index = 0, side = false } = {}) {
  const opener = document.activeElement;
  // A tile of Photos & videos that opened it: which one, should it have been drawn anew meanwhile (an edit).
  const openerTile = opener && opener.closest ? opener.closest('.mp-tile') : null;
  const openerGid = openerTile ? openerTile.dataset.gid : null;
  // A card of the side view that opened it: which one, and which of its pictures (drawn anew meanwhile: an edit, the
  // word filter, a key that came, or unpinned and pinned again from this viewer's bar).
  const openerCard = opener && opener.closest ? opener.closest('.sv-card') : null;
  const openerSid = openerCard ? openerCard.dataset.sid : null;
  const openerAt = openerCard ? [...openerCard.querySelectorAll('.sv-open')].indexOf(opener) : -1;
  let items;
  let idx;
  if (Array.isArray(given) && given.length) {
    items = given;
    idx = Math.min(given.length - 1, Math.max(0, Math.floor(Number(index) || 0)));
  } else {
    // Every picture in the conversation loaded so far, including those not scrolled into view yet (they load as
    // you reach them here). Spoilers nobody has opened yet are left out.
    const imgs = $$('#messages .att-img, #messages .embed-img, .thread-list .att-img').filter((i) => (i.src || i._full) && !i.closest('.att-spoiler:not(.revealed)'));
    if (fromImg && !imgs.includes(fromImg)) imgs.unshift(fromImg);
    items = imgs.map((i) => chatViewerItem(i, i === fromImg ? { name, download } : {}));
    idx = Math.max(0, imgs.indexOf(fromImg));
  }
  if (!items.length) return;
  let scale = 1; let tx = 0; let ty = 0;
  let closed = false;
  const img = h('img', { class: 'viewer-img', alt: '' });
  // A video plays in the stage, with the browser's own controls (no zoom). One that's big, or whose size its sender
  // left out, waits for Play, as in the chat: going past it with the arrow keys shouldn't download it.
  const video = h('video', { class: 'viewer-video', controls: true, playsinline: true, preload: 'metadata', hidden: true });
  const play = h('button', { class: 'viewer-play', type: 'button', hidden: true }, icon('play'), h('span'));
  // Fingers on them work them, rather than swiping or zooming the viewer (viewer-touch.js listens on the stage).
  for (const el of [video, play]) el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.stopPropagation(); });
  const caption = h('span', { class: 'viewer-name' });
  // The picture's name. On a phone it's in two parts, so it can be shortened and still show how it ends (".jpg");
  // elsewhere it's the plain text it always was (fit() below redoes it when the screen changes over).
  let captionText = '';
  const setCaption = (text) => {
    captionText = text;
    if (!isPhoneLayout()) { caption.textContent = text; return; }
    const parts = /^(.+?)(\.[a-z0-9]{1,8})$/i.exec(text) || [text, text, ''];
    caption.replaceChildren(h('span', { class: 'viewer-name-base' }, parts[1]), h('span', { class: 'viewer-name-ext' }, parts[2]));
  };
  const counter = h('span', { class: 'viewer-count' });
  const stage = h('div', { class: 'viewer-stage' }, img, video, play);
  const isVideo = () => items[idx].kind === 'video';
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; stage.classList.toggle('zoomed', scale > 1); };
  const stopVideo = () => {
    if (!video.hasAttribute('src')) return;
    video.pause();
    video.removeAttribute('src');
    video.load(); // (lets go of what it had loaded)
  };
  // Which show() is the current one: what an earlier one asked for and gets late is dropped.
  let turn = 0;
  let startOn = idx; // the item it was opened on: a video there starts playing
  let played = null; // Play on a big video
  const showPicture = (it, current) => {
    video.hidden = true; play.hidden = true; img.hidden = false;
    img.removeAttribute('src');
    img.alt = it.alt || '';
    let sharp = false;
    // The thumbnail (instant)…
    const quick = typeof it.thumb === 'function' ? it.thumb() : null;
    if (quick) Promise.resolve(quick).then((u) => { if (current() && !sharp && u) img.src = u; }, () => {});
    if (typeof it.full !== 'function') return;
    // …then the full picture.
    stage.classList.add('loading-full');
    Promise.resolve().then(() => it.full()).then((u) => { if (current()) { sharp = true; img.src = u; } })
      .catch((e) => { if (current() && e && e.code === 'gone') setCaption(`${captionText} \u2014 no longer available`); })
      .finally(() => { if (current()) stage.classList.remove('loading-full'); });
  };
  const showVideo = (it, current, autoplay) => {
    img.hidden = true; img.removeAttribute('src');
    const f = it.f || {};
    const start = (go) => {
      play.hidden = true; video.hidden = false;
      stage.classList.add('loading-full');
      stage.dataset.loading = 'Loading video\u2026';
      let p;
      try { p = Promise.resolve(it.full()); } catch (e) { p = Promise.reject(e); }
      if (f.url) watchFile(f.url, (x) => { if (current() && x < 1) stage.dataset.loading = `Loading video\u2026 ${Math.round(x * 100)}%`; });
      p.then((u) => { if (!current()) return; video.src = u; if (go) video.play().catch(() => {}); })
        .catch((e) => {
          if (!current()) return;
          video.hidden = true;
          if (e && e.code === 'gone') setCaption(`${captionText} \u2014 no longer available`);
          else { toast(e && e.message ? e.message : 'Couldn\u2019t load this video.', 'error'); play.hidden = false; }
        })
        .finally(() => { if (current()) { stage.classList.remove('loading-full'); delete stage.dataset.loading; } });
    };
    played = () => start(true);
    if (!(Number(f.size) > 0) || f.size > AUTOLOAD_MAX) {
      video.hidden = true;
      play.lastChild.textContent = Number(f.size) > 0 ? `Play video \u00b7 ${fmtSize(f.size)}` : 'Play video';
      play.hidden = false;
    } else start(autoplay);
  };
  play.addEventListener('click', () => { if (played) played(); });
  const show = (i) => {
    idx = (i + items.length) % items.length;
    const it = items[idx];
    const mine = ++turn;
    const current = () => mine === turn && !closed;
    stopVideo();
    played = null;
    stage.classList.remove('loading-full');
    delete stage.dataset.loading;
    stage.classList.toggle('video', it.kind === 'video');
    setCaption(it.name || (it.kind === 'video' ? 'Video' : 'Image'));
    if (it.kind === 'video') showVideo(it, current, idx === startOn); else showPicture(it, current);
    startOn = -1;
    counter.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
    scale = 1; tx = 0; ty = 0; apply();
    drawSide(it);
    fit();
  };
  const zoom = (f) => { if (isVideo()) return; scale = Math.min(6, Math.max(1, scale * f)); if (scale === 1) { tx = 0; ty = 0; } apply(); };
  // Jump to message: the viewer closes (and on a phone, the side panel it was opened from, which covers the chat).
  const jumpable = (it) => !!it && !!it.key && !!(it.m ? it.m.id : it.mid);
  const jump = () => {
    const it = items[idx];
    if (!jumpable(it)) return;
    close();
    if (isPhoneLayout() && panelMode()) closePanel();
    if (it.m && it.m.threadId) jumpToMessageId(it.m.id); else jumpToMessage(it.key, it.m ? it.m.id : it.mid);
  };
  // The photo's comments and tags (photo-notes.js): a column on the right, or a sheet over the bottom on a phone, with
  // a Comments button that shows and hides it. On a wider screen it starts open on a photo that already has some.
  const sideBox = h('aside', { class: 'viewer-side', 'aria-label': 'Comments and tags', hidden: true });
  // Whether a photo has some, as its counts say (NOTES.counts: the latest comment count, and the tags that count). Its
  // tags only count once they've been opened, which they often aren't yet as it opens here (a photo alone in its
  // message has no counts in the chat to open them first): until then, any on it by someone you haven't blocked do.
  const notesOn = (it) => {
    if (!it || !it.m || !Number.isInteger(it.fi)) return false;
    const c = NOTES.counts(it.m, it.fi);
    return c.comments > 0 || c.tags > 0 || NOTES.unopened(it.m, it.fi) > 0;
  };
  let sideOpen = !!side || (!isPhoneLayout() && notesOn(items[idx]));
  let sideFocus = side === 'comment' ? 'comment' : null;
  const sideBtn = ibtn('message', 'Comments', () => setSide(!sideOpen), { cls: 'viewer-side-btn with-badge' });
  sideBtn.hidden = true;
  const setSide = (on) => {
    sideOpen = on;
    const showing = on && !!sideBox.firstChild;
    sideBox.hidden = !showing;
    overlay.classList.toggle('side-open', showing);
    sideBtn.classList.toggle('active', showing);
    sideBtn.setAttribute('aria-pressed', String(showing));
    scale = 1; tx = 0; ty = 0; apply(); // (the stage changed size)
  };
  const drawSide = (it) => {
    const el = it.m && it.f ? NOTES.side(it, { close: () => setSide(false), focus: sideFocus }) : null;
    sideFocus = null;
    sideBox.replaceChildren(...(el ? [el] : []));
    sideBtn.hidden = !el;
    countSide(it);
    setSide(sideOpen);
  };
  // The Comments button's count: drawn with the photo, and again when a comment on it comes or goes while it's shown
  // (photo-notes.js tells the app, which calls overlay._photoChanged).
  const countSide = (it) => {
    const n = !sideBtn.hidden && it.m ? NOTES.counts(it.m, it.fi).comments : 0;
    const label = n ? `Comments (${n})` : 'Comments';
    sideBtn.setAttribute('aria-label', label);
    sideBtn.dataset.tip = label;
    const badge = sideBtn.querySelector('.badge');
    if (n) (badge || sideBtn.appendChild(h('span', { class: 'badge', 'aria-hidden': 'true' }))).textContent = n > 99 ? '99+' : String(n);
    else if (badge) badge.remove();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 140); document.removeEventListener('keydown', keys, true);
    stopVideo();
    stopFitting();
    above.disconnect();
    if ((morePop && morePop.isConnected) || $('#layer > .popover.over-viewer')) closePopover();
    // Back to whatever opened it (the picture in the chat), like other dialogs: for a tile of Photos & videos drawn anew
    // while it was open, the same photo's tile; for a side view card, the same picture on that card drawn anew. Gone
    // from the panel (unpinned from here, or Pin to side swapped Photos & videos for the side view): the panel's first
    // card, else its own buttons, rather than nowhere (the page).
    const back = (() => {
      if (!opener || opener.isConnected || (!openerGid && !openerSid)) return opener;
      const tile = openerGid ? $$('#members .mp-tile').find((x) => x.dataset.gid === openerGid) : null;
      if (tile) return tile.querySelector('.mp-cover') || tile.querySelector('.mp-open');
      const card = openerSid ? $$('#members .sv-card').find((x) => x.dataset.sid === openerSid) : null;
      if (card) return card.querySelectorAll('.sv-open')[openerAt] || card.querySelector('.sv-open, .sv-x');
      return $('#members .sv-card button') || $('#members button') || $('#main');
    })();
    if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
  };
  const keys = (e) => {
    if (morePop && morePop.isConnected) return; // the More menu (phones) takes the keys while it's open
    // So does anything opened from inside the viewer (a menu, a popup or a question from its side panel).
    if (document.querySelector('#layer > .over-viewer:not(.closing)')) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') trapTab(e, overlay);
    // Typing in the side panel (a comment, a tag): the keys are the words'.
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    // A video with the focus (its own controls): the arrow keys seek it, as anywhere else, rather than going on to the
    // next item (which would stop it and lose its place).
    if (e.target === video || (e.target && e.target.closest && e.target.closest('video'))) return;
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === '+' || e.key === '=') zoom(1.4);
    if (e.key === '-') zoom(1 / 1.4);
  };
  const dl = () => {
    const it = items[idx];
    if (it.download) return it.download();
    const a = h('a', { href: img.src, download: captionText || 'image', target: '_blank', rel: 'noopener noreferrer' });
    document.body.append(a); a.click(); a.remove();
  };
  const copy = async () => {
    try {
      const blob = await (await fetch(img.src)).blob();
      const png = blob.type === 'image/png' ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Image copied.');
    } catch { copyText(img.src.startsWith('blob:') ? '' : img.src); toast(img.src.startsWith('blob:') ? 'Your browser can\u2019t copy this image.' : 'Image link copied.'); }
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : overlay.requestFullscreen().catch(() => {}));
  // On a phone (device.js PHONE_LAYOUT) the bar keeps Download and Close, with bigger buttons (and Comments, when the
  // photo has a side panel), and the rest goes under More, with the previous and next pictures (swipes stand in for the
  // arrow buttons there, which screen readers can't make). It changes over if the screen does (a window narrowed, say).
  // Zoom and Copy image are for pictures only.
  const jumpBtn = h('button', { class: 'viewer-jump', type: 'button', onclick: jump }, icon('arrowUp'), h('span', null, 'Jump to message'));
  const zoomOutBtn = ibtn('zoomOut', 'Zoom out (−)', () => zoom(1 / 1.4));
  const zoomInBtn = ibtn('zoomIn', 'Zoom in (+)', () => zoom(1.4));
  const fullBtn = ibtn('maximize', 'Fullscreen', fullscreen);
  const copyBtn = ibtn('copy', 'Copy image', copy);
  // Pin to side (side-view.js): the picture or video shown, which stays beside the chat once the viewer closes. In the
  // bar, and under More on a phone; it says Unpin when it's there already.
  const sideItem = () => { const it = items[idx]; return it && it.m && Number.isInteger(it.fi) ? SIDE.menuItemFor(it.m, it.fi) : null; };
  const sidePin = ibtn('sidebar', 'Pin to side', () => { const p = sideItem(); if (p) p.action(); fit(); }, { cls: 'viewer-pin' });
  let morePop = null;
  const more = ibtn('more', 'More', () => {
    const it = items[idx];
    const vid = isVideo();
    const many = items.length > 1;
    const what = items.some((x) => x.kind === 'video') ? '' : ' picture';
    const list = [
      many ? { label: `Previous${what}`, icon: 'chevronLeft', action: () => show(idx - 1) } : null,
      many ? { label: `Next${what}`, icon: 'chevronRight', action: () => show(idx + 1) } : null,
      jumpable(it) ? { label: 'Jump to message', icon: 'arrowUp', action: jump } : null,
      sideItem(),
      many || jumpable(it) ? '-' : null,
      vid ? null : { label: 'Zoom in', icon: 'zoomIn', action: () => zoom(1.4) },
      vid ? null : { label: 'Zoom out', icon: 'zoomOut', action: () => zoom(1 / 1.4) },
      document.fullscreenEnabled ? { label: document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen', icon: 'maximize', action: fullscreen } : null,
      vid ? null : { label: 'Copy image', icon: 'copy', action: copy },
    ].filter(Boolean);
    while (list[list.length - 1] === '-') list.pop();
    morePop = menu(more, list, { align: 'end', className: 'viewer-menu' });
  }, { attrs: { 'data-pop-anchor': '' } });
  const fit = () => {
    const phone = isPhoneLayout();
    const vid = isVideo();
    zoomOutBtn.hidden = phone || vid; zoomInBtn.hidden = phone || vid; copyBtn.hidden = phone || vid;
    fullBtn.hidden = phone;
    jumpBtn.hidden = phone || !jumpable(items[idx]);
    const pin = sideItem();
    sidePin.hidden = phone || !pin;
    if (pin) { sidePin.setAttribute('aria-label', pin.label); sidePin.dataset.tip = pin.label; sidePin.classList.toggle('active', pin.label !== 'Pin to side'); }
    more.hidden = !phone;
    setCaption(captionText);
  };
  const stopFitting = onDeviceChange(fit);
  const bar = h('div', { class: 'viewer-bar' }, caption, counter, h('span', { class: 'spacer' }),
    jumpBtn, sidePin, zoomOutBtn, zoomInBtn, fullBtn, copyBtn, ibtn('download', 'Download', dl), sideBtn, more, ibtn('close', 'Close (Esc)', close));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Image viewer', 'aria-modal': 'true' }, bar,
    h('div', { class: 'viewer-body' }, stage, sideBox),
    items.length > 1 ? h('button', { class: 'viewer-nav prev', 'aria-label': 'Previous image', onclick: () => show(idx - 1) }, icon('chevronLeft')) : null,
    items.length > 1 ? h('button', { class: 'viewer-nav next', 'aria-label': 'Next image', onclick: () => show(idx + 1) }, icon('chevronRight')) : null);
  // The messages it shows (not the rows they're in: the panel's tiles have none): when one of them disappears, the
  // viewer closes (forgetCopies).
  overlay._mids = new Set(items.map((it) => (it.m ? it.m.id : it.mid)).filter(Boolean));
  overlay._close = close;
  overlay._photoChanged = (id) => { const it = items[idx]; if (it && it.m && it.m.id === id) countSide(it); };
  // Menus, popups and questions opened from inside the viewer (its side panel's) go over it, not behind (app.css).
  const above = new MutationObserver((changes) => { for (const c of changes) for (const n of c.addedNodes) if (n.nodeType === 1) n.classList.add('over-viewer'); });
  const layer = $('#layer');
  if (layer) above.observe(layer, { childList: true });
  // Touch screens (device.js TOUCH_UI): pinch, double tap, swipes (viewer-touch.js). The clicks a browser makes out
  // of those taps are left to it; a mouse works as on a desktop. A video doesn't zoom.
  const touch = isTouchUI() ? touchGestures({
    stage, img, bar, backdrop: overlay, close, count: () => items.length, step: (d) => show(idx + d),
    view: () => ({ scale, tx, ty }), setView: (v) => { if (isVideo()) return; ({ scale, tx, ty } = v); apply(); },
    busy: () => { if (!morePop || !morePop.isConnected) return false; closePopover(); return true; },
  }) : null;
  const fromTouch = () => !!touch && touch.touchedRecently();
  stage.addEventListener('click', (e) => { if (e.target === stage && !fromTouch()) close(); });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  img.addEventListener('dblclick', () => { if (fromTouch()) return; if (scale > 1) { scale = 1; tx = 0; ty = 0; apply(); } else zoom(2.5); });
  let drag = null;
  img.addEventListener('pointerdown', (e) => { if (scale <= 1 || (touch && e.pointerType !== 'mouse')) return; drag = { x: e.clientX - tx, y: e.clientY - ty }; img.setPointerCapture(e.pointerId); });
  img.addEventListener('pointermove', (e) => { if (!drag) return; tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); });
  img.addEventListener('pointerup', () => { drag = null; });
  document.addEventListener('keydown', keys, true);
  document.body.append(overlay);
  show(idx);
  overlay.querySelector('.viewer-bar .icon-btn:last-child').focus();
  // Opened to comment on this photo: into its comment box, once the side panel is drawn.
  if (side === 'comment') {
    requestAnimationFrame(() => {
      if (closed || sideBox.hidden || sideBox.contains(document.activeElement)) return;
      const box = sideBox.querySelector('textarea');
      if (box) box.focus();
    });
  }
}
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// ======================================================================= incoming events
async function onNewMessage(key, m) {
  const store = S.msgs[key];
  // In a DM or group chat it's the newest message from now on, set before decrypting: a delete or a newer message
  // that comes meanwhile takes its place, and this one's preview is then left alone (see previewDm).
  const conv = convOf(key);
  const before = conv && conv.last;
  if (conv && (!before || m.id >= before.id)) conv.last = m;
  await decryptMessage(m);
  if (m.nonce) dropPendingSend(m.nonce);
  // Already past its time (a timer shorter than the trip here, or a server that held on to it): never shown.
  if (isExpired(m, nowServer())) { const cur = convOf(key); if (cur && cur.last === m) cur.last = before; return; }
  MEDIA.onNew(key, m); // its pictures and videos go on top in Photos & videos, if that's open here
  // Kept decrypted as the newest message, the preview also goes at its time by the timer inside it (the server's copy
  // can't be decrypted there). When the server's copy of it took its place meanwhile (sent with a delete or an edit),
  // setLast already wrote the line and the group's time from that.
  const cur = convOf(key);
  if (cur && cur.last === m) {
    const group = isGroup(cur);
    S.previews[(group ? 'g:' : 'd:') + cur.id] = previewText(m, group);
    if (group) cur.lastMessageAt = m.createdAt;
  }
  if (store && store.loaded && !store.hasNewer && !store.list.find((x) => x.id === m.id)) {
    store.list.push(m);
    const viewingThis = currentKey() === key;
    const scNow = viewingThis && $('#messages');
    const atEnd = scNow && scNow.scrollHeight - scNow.scrollTop - scNow.clientHeight < 160;
    // Busy channel: drop the oldest when you're reading the latest (or not looking at it at all).
    if ((!viewingThis || atEnd) && trimStore(store, 150) && viewingThis) { renderMessages(true); }
    else if (viewingThis) {
      const sc = $('#messages');
      const near = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
      const prev = store.list[store.list.length - 2];
      if (sc) {
        // Real messages go above any of your own still "sending…".
        const firstPending = sc.querySelector('.msg.sending');
        const put = (node) => (firstPending ? sc.insertBefore(node, firstPending) : sc.append(node));
        const newDay = shownDay(sc, firstPending) !== new Date(m.createdAt).toDateString();
        if (newDay) put(dayDivEl(m.createdAt));
        const above = firstPending ? firstPending.previousElementSibling : sc.lastElementChild;
        put(messageEl(m, newDay || (above && above.classList.contains('sys-line')) ? null : prev, 'main'));
        ensureCurrentMessage(sc);
        if (m.authorId === S.me.id && !m.scheduled) toNewest(sc);
        else if (near) sc.scrollTop = sc.scrollHeight;
      }
    }
  }
  // Now that it's in the conversation and the preview: the timer looks there for the soonest deadline.
  if (disappears(m)) armClientExpiry();
  TYPING.stop(key, m.authorId); // their message is here: they've stopped typing it
  const knewUpTo = S.lastIds[key];
  if (!m.threadId && !(S.lastIds[key] && S.lastIds[key] >= m.id)) S.lastIds[key] = m.id;
  // Your own message (from here or another device) means you've read the conversation up to it. Not one the server
  // posted for you at its time (Send later, m.scheduled): you may not have been here, so what's unread stays so.
  if (m.authorId === S.me.id) {
    if (!m.scheduled) {
      S.lastRead[key] = m.id;
      if (S.unread.delete(key) | S.mentions.delete(key)) { closeNotifications(key); updateTitle(); later(renderRail); }
    }
    if (!S.view.serverId || S.view.serverId === m.serverId) later(renderSidebar);
    return;
  }
  const viewing = currentKey() === key && !document.hidden;
  const level = notifyLevel(key);
  const isDm = key.startsWith('d:') || isGroup(S.servers.find((x) => x.id === m.serverId));
  const kind = mentionKind(m);
  // @everyone you've chosen to ignore here isn't a ping.
  const mentioned = !!kind && !(kind === 'everyone' && everyoneMuted(key));
  const repliedToMe = m.reply && m.reply.authorId === S.me.id;
  // A voice channel's chat you don't follow (never opened, not in its call): only pings count, quietly otherwise.
  const counts = countsUnread(key);
  if (!viewing) {
    if (counts) {
      // A voice chat you follow only by being in its call has no read marker: "New messages" goes after what was there
      // before it turned unread.
      if (!S.unread.has(key) && !S.lastRead[key] && isVoiceChat(key)) S.chatFloor[key] = knewUpTo || '0';
      S.unread.add(key);
      if (S.unreadCounts) S.unreadCounts[key] = (S.unreadCounts[key] || 0) + 1;
    }
    if ((isDm || mentioned || repliedToMe) && level !== 'muted' && !S.blocked.has(m.authorId)) {
      S.mentions.set(key, (S.mentions.get(key) || 0) + 1);
      // Several tabs open: only the first to claim this message makes a sound and shows it.
      if (!quiet()) claimOnce(m.id).then((mineToShow) => { if (!mineToShow) return; playSound((mentioned && kind) || (isDm ? (key.startsWith('d:') ? 'dm' : 'groupDm') : 'reply')); notify(getUser(m.authorId), previewText(m).replace(/^You: /, ''), key, m.id); if (!document.hasFocus()) flashTaskbar(); });
    } else if (counts && level === 'all' && !S.blocked.has(m.authorId) && !quiet()) claimOnce(m.id).then((ok) => { if (ok) playSound('message'); });
  } else {
    // Reading along at the bottom: the marker follows (and your other devices clear their badge).
    later(() => { const sc = currentKey() === key && $('#messages'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160) markRead(key); });
  }
  if ((mentioned || repliedToMe) && !S.blocked.has(m.authorId)) {
    addInbox({
      type: mentioned ? 'mention' : 'reply', userId: m.authorId, msgId: m.id,
      title: `${nameInMsg(m, getUser(m.authorId))} ${mentioned ? 'mentioned you' : 'replied to you'} in ${whereLabel(m)}`,
      text: snippetOf(m, 140), ...expOf(m),
    });
  }
  // Reading this very channel: nothing in the server bar or channel list changes.
  if (viewing && !isDm && !mentioned && !repliedToMe) return;
  updateTitle();
  later(renderRail);
  if ((isDm && !S.view.serverId) || (!isDm && S.view.serverId === m.serverId) || (isDm && isGroup(currentServer()))) later(renderSidebar);
  if (S.view.type === 'home') later(renderMain);
  // The call view of this voice channel with its chat hidden: the chat button shows what's new.
  if (S.view.type === 'voice' && 'c:' + S.view.channelId === key) later(renderHeader);
}
function notify(author, body, key, msgId = null) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
  if (localStorage.getItem('hearth.notify') === 'off') return;
  try {
    const priv = key.startsWith('d:') || isGroup(serverOfChannel(key.slice(2)));
    const shown = priv && isSharing() && !shareAllowed.has(key) ? 'New message (hidden while you share your screen)' : body.slice(0, 140);
    const n = new Notification(key.startsWith('c:') ? nameInServer(serverOfChannel(key.slice(2)), author) : displayName(author), { body: shown, icon: author.avatar || undefined, tag: key });
    rememberNotification(key, n, msgId); // a disappearing message's notification closes when it goes
    n.onclick = () => { window.focus(); if (window.hearthDesktop) window.hearthDesktop.focus(); if (key.startsWith('d:')) openDm(key.slice(2)); else { const s = serverOfChannel(key.slice(2)); if (s) openChannel(key.slice(2), s.id); } n.close(); };
  } catch { /* ignore */ }
}
async function onUpdateMessage(key, m) {
  SIDE.onUpdate(key, m); // (the side view decrypts it itself when it shows it, whether or not the chat has it)
  lastEdited(key, m);
  const store = S.msgs[key];
  const i = store ? store.list.findIndex((x) => x.id === m.id) : -1;
  // (Photos & videos may have it when the chat doesn't: it decrypts it itself then.)
  if (i < 0) return MEDIA.onUpdate(key, m);
  await decryptMessage(m);
  store.list[i] = m;
  if (S.editing === m.id) S.editing = null;
  replaceMessageEl(m);
  MEDIA.onUpdate(key, m);
}
// Channel messages deleted (one, or a batch): thread replies leave their thread, the rest leave the channel.
// expired: disappearing messages whose time came (this device's copies of them go too, see forgetCopies).
function onDeleteChannelMessages(channelId, list, { expired = false } = {}) {
  const top = [];
  const threads = new Set();
  const pinged = (S.threadMentions.get('c:' + channelId) || 0) > 0;
  const roots = new Set(list.filter((x) => !x.threadId).map((x) => x.id)); // whole threads going (forgetThreads)
  const removed = [];
  for (const { id, threadId } of list) {
    const t = threadId && S.threads[threadId];
    if (threadId) {
      // (Only when it's still here: this app's own timer may have hidden a disappearing reply already.)
      if (t) {
        const had = t.list.find((x) => x.id === id);
        if (had) { removed.push(had); t.list = t.list.filter((x) => x.id !== id); t.total = Math.max(0, (t.total || 0) - 1); threads.add(threadId); }
      }
      // A reply that may have counted here (in its thread's "N new", or as a ping in the channel's badge).
      const st = S.threadState[threadId];
      if (!roots.has(threadId) && (pinged || (st && (st.unread || st.mentions) && (!st.lastReadId || id > st.lastReadId)))) recheckThread(threadId);
    } else top.push(id);
  }
  if (S.thread && threads.has(S.thread.rootId)) renderPanel();
  const replies = list.filter((x) => x.threadId).map((x) => x.id);
  if (replies.length) { forgetBindings('c:' + channelId, replies); MEDIA.onDelete('c:' + channelId, replies); }
  if (replies.length) NOTES.onDelete('c:' + channelId, replies); // their photos' tags and comments, and as comments
  if (replies.length) SIDE.onDelete('c:' + channelId, replies); // and in the side view, they say they're gone
  if (top.length) onDeleteMessage('c:' + channelId, top, { expired });
  if (expired && removed.length) forgetCopies(removed, new Set(removed.map((x) => x.id)), 'c:' + channelId);
}
// Replies were deleted that a thread's counts may include: ask the server for its state again (with the channel's
// thread pings), once per thread, a moment later and at slightly different times on different people's apps. A
// big purge rechecks a few threads: any of them sets the channel's badge right.
const threadRecheck = new Map(); // rootId -> timer
function recheckThread(rootId) {
  if (threadRecheck.has(rootId) || threadRecheck.size >= 5) return;
  threadRecheck.set(rootId, setTimeout(() => {
    threadRecheck.delete(rootId);
    api('GET', `/messages/${encodeURIComponent(rootId)}/thread?limit=1`).then((r) => applyThreadState(r.state)).catch(() => {});
  }, 300 + Math.floor(Math.random() * 700)));
}
function onDeleteMessage(key, id, { expired = false } = {}) {
  const named = new Set(Array.isArray(id) ? id : [id]);
  // In a channel, a thread's first message takes its replies with it: the server deletes them too, but its event names
  // only the first. The replies this app holds go with it, wherever they are: in the thread as it was loaded here, and
  // in Photos & videos and photo tags (which may hold older ones, or ones from a thread never opened here).
  const threads = key.startsWith('c:') ? [...named].map((x) => S.threads[x]).filter(Boolean) : [];
  const threadCopies = threads.flatMap((t) => [t.root, ...(t.list || [])]).filter(Boolean);
  const gone = key.startsWith('c:')
    ? new Set([...named, ...threadCopies.map((x) => x.id), ...MEDIA.repliesTo(named), ...NOTES.repliesTo(named, key)])
    : named;
  forgetBindings(key, gone);
  MEDIA.onDelete(key, gone); // their tiles in Photos & videos, and the decrypted copies it had of them
  NOTES.onDelete(key, gone); // their photos' tags (the chips, the suggestions) and comments, and as comments
  SIDE.onDelete(key, gone); // their cards in the side view say they're gone, and its decrypted copies of them go
  // Threads these messages started go with them (their counts, and their cards in the Threads panel), and so does
  // what was loaded of them: nothing finds their replies any more (loadedMessage, which Photos & videos takes copies
  // from). One open in the side panel closes.
  if (key.startsWith('c:')) {
    forgetThreads(key, named);
    for (const x of named) delete S.threads[x];
  }
  const store = S.msgs[key];
  const removed = store ? store.list.filter((x) => gone.has(x.id)) : [];
  if (S.thread && named.has(S.thread.rootId)) closeThread();
  if (store) {
    store.list = store.list.filter((x) => !gone.has(x.id));
    let quotes = false;
    store.list.forEach((x) => { if (x.reply && gone.has(x.reply.id)) { x.reply = null; quotes = true; } });
    if (S.select && S.select.key === key) { for (const x of gone) S.select.ids.delete(x); renderSelectBar(); }
    // (Already hidden here when this app's own timer got there first: nothing to redraw.)
    if ((removed.length || quotes) && currentKey() === key) {
      const sc = $('#messages');
      const top = sc ? sc.scrollTop : 0;
      renderMessages(false);
      if (sc) sc.scrollTop = top;
    }
  }
  // (With what was loaded of their threads: a reply never outlives its thread's first message, and the timer's pass
  // over the threads, purgeExpired, no longer finds them.)
  if (expired) forgetCopies([...removed, ...threadCopies.filter((x) => !removed.includes(x))], gone, key);
  else forgetUnread(key, gone);
}
// Deleted by someone before it was read here: a notification still showing it (with its words) closes, and the
// conversation's unread and mention counts, which may include it, are asked for again (the server counts the
// messages still there). One older than the read marker never counted.
function forgetUnread(key, ids) {
  closeNotificationFor(ids);
  const read = S.lastRead[key];
  if ((S.unread.has(key) || S.mentions.has(key)) && [...ids].some((id) => !read || id > read)) refreshUnreadSoon();
}
// ---- "is typing…" (typing.js keeps who's typing where)
// The names of who's typing in a conversation ('c:<channel>' or 'd:<dm>'), as that conversation shows them.
function typingNames(key) {
  if (!S.me || !key) return [];
  const sv = key.startsWith('c:') ? serverOfChannel(key.slice(2)) : null;
  return TYPING.who(key, S.me.id).map((id) => nameInServer(sv, getUser(id)));
}
function typingDots() { return h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')); }
// Someone started or stopped typing in a conversation: its line under the box and its line in the lists (the
// sidebar's conversations, Home's), in place. Nothing else is drawn again: typing comes and goes all the time.
function typingChanged(key) {
  if (!S.me) return;
  renderTyping(key);
  $$('.conv-line[data-typing-key]').forEach((el) => { if (el.dataset.typingKey === key) drawConvLine(el); });
}
// The line under the message box (the main one and a thread's), for its conversation, or only those of `key`.
// Drawn again only when what it says changes, so the dots keep going and screen readers (it's a polite live
// region) hear it once rather than at every typing event.
function renderTyping(key = null) {
  $$('.typing').forEach((el) => {
    if (key && el.dataset.key !== key) return;
    const text = typingLine(typingNames(el.dataset.key));
    if (el._said === text) return;
    el._said = text;
    clear(el);
    if (text) el.append(typingDots(), h('span', null, text));
  });
}

// ======================================================================= threads
function threadList() {
  const t = S.thread && S.threads[S.thread.rootId];
  return t ? [t.root, ...t.list] : [];
}
function findThreadMessage(id) {
  for (const t of Object.values(S.threads)) {
    if (t.root && t.root.id === id) return t.root;
    const m = t.list.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}
// from: 'threads' when picked in the Threads panel (closing the thread goes back to it).
async function openThread(root, focusId, { from = null } = {}) {
  if (root.threadId) return;
  S.thread = { rootId: root.id, channelId: root.channelId, serverId: root.serverId, focusId, from };
  S.panel = 'thread';
  document.body.classList.add('panel-open');
  renderPanel(); renderHeader();
  try {
    // Threads come a page at a time, newest replies first. Opening one at a linked reply asks for the page around it
    // instead (there may be newer replies after that page: see loadNewerReplies).
    const res = await api('GET', `/messages/${root.id}/thread?${focusId ? `around=${encodeURIComponent(focusId)}` : 'limit=100'}`);
    const t = { root: res.root, list: res.messages, loaded: true, hasMore: !!res.hasMore, hasNewer: !!res.hasNewer, total: Math.max(res.messages.length, res.root.threadCount || 0) };
    await Promise.all([t.root, ...t.list].map(decryptMessage));
    t.list = t.list.filter((x) => !isExpired(x, nowServer()));
    if (isExpired(t.root, nowServer())) throw new Error('That thread no longer exists.');
    if (res.state) applyThreadState(res.state);
    // Closed while it loaded, or its first message deleted (onDeleteMessage closes it): not kept, so nothing finds the
    // replies it had (loadedMessage).
    if (!S.thread || S.thread.rootId !== root.id) return;
    S.threads[root.id] = t;
    if ([t.root, ...t.list].some(disappears)) setTimeout(armClientExpiry, 0);
    // Where you'd read up to before this: the "New" line, which stays put while the thread is open.
    if (res.state && res.state.unread > 0) S.thread.markerId = res.state.lastReadId;
    renderPanel();
    markThreadRead(root.id);
  } catch (e) { toast(e.message, 'error'); closeThread(); }
}
// all: the panel's close button (otherwise a thread opened from the Threads panel goes back to it).
function closeThread(all = false) {
  const back = !all && S.thread && S.thread.from === 'threads' && S.view.channelId === S.thread.channelId;
  const rootId = S.thread && S.thread.rootId;
  const panel = $('#members');
  const hadFocus = !!panel && panel.contains(document.activeElement);
  S.thread = null;
  S.panel = back ? 'threads' : restingPanel();
  document.body.classList.toggle('panel-open', !!panelMode());
  delete composers.thread;
  renderPanel(); renderHeader();
  // Back in the list: the keyboard carries on from the thread you were in (or the panel's heading).
  if (back && hadFocus) focusThreadCard(rootId, { fallback: true });
}
// You're reading this thread: the side panel shows it, the window is showing, and its newest replies are loaded.
// Only then do replies count as read (the thread can stay chosen while the panel shows something else).
function readingThread(rootId) {
  const t = S.threads[rootId];
  return panelMode() === 'thread' && !!S.thread && S.thread.rootId === rootId && !document.hidden && !!t && t.loaded && !t.hasNewer;
}
// Reading a thread moves its marker to its newest reply, a moment later (one request for a burst of replies). The
// server tells your other devices, and its answer sets the channel's badge right.
const threadReadSync = new Map(); // rootId -> timer
function markThreadRead(rootId) {
  if (!readingThread(rootId)) return;
  const t = S.threads[rootId];
  const last = t.list.length ? t.list[t.list.length - 1].id : null;
  const st = S.threadState[rootId];
  if (!last || (st && !st.unread && !st.mentions && st.lastReadId && st.lastReadId >= last)) return;
  if (st) {
    const k = 'c:' + st.channelId;
    if (st.mentions) setThreadPings(k, Math.max(0, (S.threadMentions.get(k) || 0) - st.mentions));
    Object.assign(st, { unread: 0, mentions: 0, lastReadId: last });
    refreshThreadBits(rootId, st.channelId);
  }
  clearTimeout(threadReadSync.get(rootId));
  threadReadSync.set(rootId, setTimeout(() => {
    threadReadSync.delete(rootId);
    api('POST', '/me/read', { conv: 't:' + rootId, messageId: last }).then((r) => applyThreadState(r)).catch(() => {});
  }, 400));
}
async function onThreadMessage(m) {
  await decryptMessage(m);
  if (isExpired(m, nowServer())) return;
  MEDIA.onNew('c:' + m.channelId, m); // (a channel's Photos & videos include its threads')
  const t = S.threads[m.threadId];
  if (t && t.hasNewer && !t.list.find((x) => x.id === m.id)) {
    // Showing an older part of the thread: a new reply doesn't belong right after it. Your own reply takes you to
    // the newest replies (where it is); anyone else's just counts.
    t.total = (t.total || 0) + 1;
    if (S.thread && S.thread.rootId === m.threadId) {
      if (m.authorId === S.me.id && !m.scheduled && !t.jumping) loadNewestReplies();
      else { const div = $('.thread-list .thread-divider span'); if (div) div.textContent = threadCountLabel(t); }
    }
  } else if (t && !t.list.find((x) => x.id === m.id)) {
    t.list.push(m);
    t.total = (t.total || 0) + 1;
    if (S.thread && S.thread.rootId === m.threadId) {
      const list = $('.thread-list');
      if (list) {
        list.append(messageEl(m, t.list[t.list.length - 2] || null, 'thread'));
        const div = list.querySelector('.thread-divider span');
        if (div) div.textContent = threadCountLabel(t);
        list.scrollTop = list.scrollHeight;
      }
    }
  }
  countThreadReply(m);
  // (After it's in the thread: the timer looks there for the soonest deadline.)
  if (disappears(m)) armClientExpiry();
  if (m.authorId !== S.me.id && (mentionsMe(m) || (m.reply && m.reply.authorId === S.me.id)) && !S.blocked.has(m.authorId)) {
    addInbox({ type: mentionsMe(m) ? 'mention' : 'reply', userId: m.authorId, msgId: m.id, title: `${nameInMsg(m, getUser(m.authorId))} ${mentionsMe(m) ? 'mentioned you' : 'replied to you'} in a thread in ${whereLabel(m)}`, text: snippetOf(m, 140), ...expOf(m) });
    if (!quiet() && notifyLevel('c:' + m.channelId) !== 'muted') claimOnce(m.id).then((ok) => { if (ok) playSound(mentionKind(m) || 'reply'); });
  }
}
// Messages that started threads were deleted (their replies went with them): drop those threads here too.
function forgetThreads(key, gone) {
  let pings = 0; let had = false;
  for (const x of gone) { const st = S.threadState[x]; if (st) { pings += st.mentions; had = true; delete S.threadState[x]; } }
  if (pings) { setThreadPings(key, Math.max(0, (S.threadMentions.get(key) || 0) - pings)); updateTitle(); later(renderRail); later(renderSidebar); }
  if (had && currentKey() === key) later(renderHeader);
  const tp = S.threadsPanel;
  if (tp && 'c:' + tp.channelId === key && tp.items.some((x) => gone.has(x.rootId))) { tp.items = tp.items.filter((x) => !gone.has(x.rootId)); redrawThreads(); }
}
// A reply arrived: what's new in its thread for you. Reading along (the thread open, the window showing) keeps it
// read; otherwise it counts, and a ping in it counts in the channel's badge too (as the server counts them).
function countThreadReply(m) {
  const key = 'c:' + m.channelId;
  const st = (S.threadState[m.threadId] ||= { channelId: m.channelId, unread: 0, mentions: 0, lastReadId: null, lastId: null });
  if (!st.lastId || m.id > st.lastId) st.lastId = m.id;
  if (m.authorId === S.me.id) {
    // Yours, from here or another device: read up to it (the server says so too, with the channel's badge). Not a
    // scheduled one posted at its time: what's new in the thread stays new.
    if (!m.scheduled) {
      const k = st.mentions; Object.assign(st, { unread: 0, mentions: 0, lastReadId: m.id });
      if (k) setThreadPings(key, Math.max(0, (S.threadMentions.get(key) || 0) - k));
    }
  } else if (readingThread(m.threadId)) {
    markThreadRead(m.threadId);
  } else {
    st.unread += 1;
    const kind = mentionKind(m);
    const pinged = ((kind && !(kind === 'everyone' && everyoneMuted(key))) || (m.reply && m.reply.authorId === S.me.id)) && !S.blocked.has(m.authorId);
    if (pinged) { st.mentions += 1; S.threadMentions.set(key, (S.threadMentions.get(key) || 0) + 1); }
  }
  refreshThreadBits(m.threadId, m.channelId);
  threadsPanelReply(m);
}
async function onThreadUpdate(m) {
  SIDE.onUpdate('c:' + m.channelId, m);
  const t = S.threads[m.threadId];
  const i = t ? t.list.findIndex((x) => x.id === m.id) : -1;
  if (i < 0) return MEDIA.onUpdate('c:' + m.channelId, m);
  await decryptMessage(m);
  t.list[i] = m;
  if (S.editing === m.id) S.editing = null;
  replaceMessageEl(m);
  MEDIA.onUpdate('c:' + m.channelId, m);
}

// ======================================================================= right panel (contextual)
function renderPanel() {
  const el = $('#members');
  if (!el) return;
  // The Threads list keeps the card that had focus through a rebuild (server updates, people joining…).
  const was = el.querySelector(':scope > .threads-list');
  const refocus = was && was.contains(document.activeElement) ? document.activeElement.closest('[data-root]') : null;
  // Photos & videos put the same elements back (media-panel.js), so whatever had focus in them can have it again.
  const mediaFocus = el.dataset.mode === 'media' && el.contains(document.activeElement) ? document.activeElement : null;
  const mode = panelMode();
  // The DM profile sliding shut (slidePanel) stays as it is until it's shut: a presence change, which redraws a DM's
  // panel often, waits for it. Anything else to show stops a slide where it is.
  if (sliding) {
    if (sliding.shut && !mode && sliding.key === currentKey()) { document.body.classList.add('panel-open'); return; }
    if (sliding.shut || mode !== 'members' || sliding.key !== currentKey()) sliding.end(false);
  }
  // Closed (or showing something else): it lets go of what it had, and starts from the newest when it opens again.
  if (mode !== 'media') MEDIA.reset();
  // The side view keeps what it loaded while it's open, though not shown in a view without a side panel (Friends,
  // say): back in a chat, it's there as it was. Closed, it lets go of it.
  if (S.panel !== 'side') SIDE.reset();
  // A voice channel's chat stays as it is through the panel's redraws (people joining, server updates): drawing it
  // again would lose your place in it and the focus of what you're typing. Going somewhere else draws it afresh.
  if (mode === 'chat' && el.dataset.mode === 'chat' && el.dataset.key === currentKey() && el.querySelector(':scope > .chat')) {
    if (composers.main) composers.main.renderExtras();
    return;
  }
  // So does Photos & videos (people coming online or going Away redraw a DM's side panel often): taken out and put
  // back, its list would stop scrolling midway. Only what changed in it is drawn again.
  if (mode === 'media' && el.dataset.mode === 'media' && !hiddenWhileSharing(privateKey()) && MEDIA.drawn(el)) {
    MEDIA.draw(el);
    return;
  }
  // And the side view, which stays through going from one conversation to another: only cards that changed are drawn
  // again (it covers the ones from DMs and group chats itself while you share your screen).
  if (mode === 'side' && el.dataset.mode === 'side' && SIDE.drawn(el)) {
    SIDE.draw(el);
    return;
  }
  // A DM's profile is drawn afresh whenever anyone's status or game changes (automatic Away makes that often): what
  // had focus in it gets it back, and it stays scrolled where it was.
  const dmPlace = mode === 'members' && S.view.type === 'dm' ? dmProfilePlace(el) : null;
  clear(el);
  delete el.dataset.key;
  document.body.classList.toggle('panel-open', !!mode);
  el.hidden = !mode;
  if (!mode || !S.me) return;
  el.dataset.mode = mode;
  queueMicrotask(() => { if (!el.querySelector(':scope > .resize-handle')) el.append(resizeHandle('panel')); });
  if ((mode === 'thread' || mode === 'pins' || mode === 'threads' || mode === 'media') && hiddenWhileSharing(privateKey())) return el.append(h('p', { class: 'sidebar-empty' }, 'Hidden while you share your screen.'));
  if (mode === 'thread') return threadPanel(el);
  if (mode === 'chat') return voiceChatPanel(el);
  if (mode === 'pins') return pinsPanel(el);
  if (mode === 'threads') return threadsPanel(el, refocus && refocus.dataset.root);
  if (mode === 'side') return SIDE.draw(el);
  if (mode === 'media') {
    MEDIA.draw(el);
    if (mediaFocus && mediaFocus.isConnected) mediaFocus.focus({ preventScroll: true });
    return;
  }
  if (S.view.type === 'dm') {
    dmProfilePanel(el);
    if (dmPlace) dmPlace();
    return;
  }
  return membersPanel(el);
}
// Where you were in a DM's profile before it's drawn afresh, and a function that puts you back there once it is: the
// control that had focus (its fold button, a link, a mutual server) and how far it was scrolled. The control is found
// again by what it is and says, the nth of those alike, so a game showing up above it doesn't hand focus to another.
function dmProfilePlace(el) {
  if (el.dataset.mode !== 'members' || el.dataset.key !== currentKey()) return null;
  const box = el.querySelector(':scope > .dm-profile');
  const top = box ? box.scrollTop : 0;
  const a = document.activeElement;
  const had = a && a !== el && el.contains(a) ? a : null;
  const like = (n) => `${n.tagName}|${n.className}|${n.getAttribute('aria-label') || ''}|${n.getAttribute('href') || ''}|${n.matches('a, button') ? n.textContent : ''}`;
  const alike = (sig) => [...el.querySelectorAll(had.tagName)].filter((n) => like(n) === sig);
  const sig = had ? like(had) : '';
  const nth = had ? alike(sig).indexOf(had) : -1;
  return () => {
    const now = el.querySelector(':scope > .dm-profile');
    if (now && top) now.scrollTop = top;
    const n = nth >= 0 ? alike(sig)[nth] : null;
    if (n && !el.contains(document.activeElement)) n.focus({ preventScroll: true });
  };
}
function panelHead(title, sub, extra, close = null) {
  return h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, h('h2', null, title), sub ? h('span', null, sub) : null),
    extra, close || ibtn('close', 'Close panel', () => (S.panel === 'thread' ? closeThread(true) : togglePanel(S.panel))));
}
// The chat beside a voice channel's call: the same conversation view as a text channel (messages, the composer, the
// "New messages" line, picking messages to delete), in the side panel. Pinned messages open in its place.
function voiceChatPanel(el) {
  const c = channelById(S.view.channelId);
  el.dataset.key = currentKey();
  el.append(panelHead('Chat', c ? chanLabel(c) : '', null, ibtn('close', 'Hide chat', () => toggleVoiceChat(false))), chatView());
}

function membersPanel(el) {
  const server = currentServer();
  if (!server) return;
  const group = isGroup(server);
  const search = h('input', { class: 'input search-input', placeholder: 'Search members', 'aria-label': 'Search members' });
  const list = h('div', { class: 'member-list' });
  const draw = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    // Search finds people by username, display name, nickname here or your own nickname for them; the list shows and
    // sorts by the name shown.
    const users = server.memberIds.map(getUser).filter((u) => nameMatches(u, q, server));
    const changedKeys = sec.keysChanged(users);
    // Like Discord: online people grouped under their highest "show separately" role, then Online, then Offline.
    const hoisted = (server.roleDefs || []).filter((r) => r.hoist && !r.everyone).sort((a, b) => b.position - a.position);
    const sections = new Map(hoisted.map((r) => [r.id, []]));
    const online = []; const offline = [];
    for (const u of users) {
      if (presenceOf(u, S.me.id) === 'offline') { offline.push(u); continue; }
      const top = memberRoles(server, u.id).find((r) => r.hoist);
      if (top && sections.has(top.id)) sections.get(top.id).push(u); else online.push(u);
    }
    const byName = (a, b) => nameInServer(server, a).localeCompare(nameInServer(server, b));
    const row = (u) => {
      const p = u.profile || {};
      const cs = p.customStatus && (p.customStatus.text || p.customStatus.emoji) ? `${p.customStatus.emoji || ''} ${p.customStatus.text || ''}`.trim() : '';
      const rs = roleStyle(server, u.id);
      return h('button', {
        class: `member${presenceOf(u, S.me.id) === 'offline' ? ' dim' : ''}`, 'data-pop-anchor': '',
        onclick: (e) => openProfilePop(e.currentTarget, u.id, 'left'),
        oncontextmenu: (e) => contextMenu(e, memberMenuItems(server, u)),
      }, avatarEl(u, 34, { status: true, meId: S.me.id }),
      h('span', { class: 'member-text' },
        h('span', { class: 'member-name' }, nameEl(u, { roleColor: rs.color, server }),
          rs.owner ? h('span', { class: 'role-icon', 'data-tip': 'Server owner' }, '\uD83D\uDC51') : null,
          rs.iconRole ? h('span', { class: 'role-icon', 'data-tip': rs.iconRole.name }, rs.iconRole.icon) : null,
          sec.heldBack(server.id, u.id) ? keyWarn(u, `${displayName(u)} reset their password without their recovery key. Verify them`, RESET_TIP)
            : changedKeys.has(u.id) ? keyWarn(u, `${displayName(u)}\u2019s security key changed. Verify them`, 'Security key changed \u2014 click to verify') : null),
        activityLine(u) ? h('span', { class: 'member-status' }, activityLine(u)) : cs ? h('span', { class: 'member-status' }, cs) : null));
    };
    for (const r of hoisted) {
      const list2 = sections.get(r.id).sort(byName);
      if (list2.length) list.append(h('div', { class: 'group-label' }, h('span', { style: r.color ? { color: r.color } : null }, `${r.icon ? r.icon + ' ' : ''}${r.name} \u2014 ${list2.length}`)), ...list2.map(row));
    }
    if (online.length) list.append(h('div', { class: 'group-label' }, h('span', null, `Online \u2014 ${online.length}`)), ...online.sort(byName).map(row));
    // Bots working for this server (the news bot while it follows something), like Discord shows them.
    const bots = (server.bots || []).map(getUser).filter((u) => nameMatches(u, q));
    if (bots.length) list.append(h('div', { class: 'group-label' }, h('span', null, `Bots \u2014 ${bots.length}`)), ...bots.map((u) => h('button', {
      class: 'member', 'data-pop-anchor': '', onclick: (e) => openProfilePop(e.currentTarget, u.id, 'left'),
    }, avatarEl(u, 34, { status: true, meId: S.me.id }),
    h('span', { class: 'member-text' }, h('span', { class: 'member-name' }, nameEl(u), h('span', { class: 'bot-tag' }, 'BOT')),
      h('span', { class: 'member-status' }, u.id === NEWS_BOT_ID ? 'Posting news from the feeds this server follows' : ((u.profile || {}).bio || 'A bot added to this server'))))));
    if (offline.length) list.append(h('div', { class: 'group-label' }, h('span', null, `Offline \u2014 ${offline.length}`)), ...offline.sort(byName).map(row));
    if (!users.length && !bots.length) list.append(h('p', { class: 'sidebar-empty' }, 'No one matches.'));
  };
  search.addEventListener('input', draw);
  list._redraw = () => (currentServer() === server ? draw() : renderPanel()); // people coming and going: the rows only (redrawPeople)
  draw();
  el.append(panelHead(group ? 'People' : 'Members', `${server.memberIds.length}`,
    group ? ibtn('userPlus', 'Add people', () => openNewConversation(server), { cls: 'sm' }) : can(server, PERMS.CREATE_INVITE) ? ibtn('userPlus', 'Invite people', () => openInvite(server), { cls: 'sm' }) : null),
  h('div', { class: 'panel-search' }, icon('search'), search), list);
}

function memberMenuItems(server, u) {
  const me = u.id === S.me.id;
  const items = [
    { label: 'View profile', icon: 'user', action: () => openProfileModal(u.id) },
    !me ? { label: 'Message', icon: 'message', action: () => openDmWith(u.id) } : null,
    { label: 'Copy username', icon: 'copy', action: () => { copyText(u.username); toast('Copied.'); } },
    personalNameItem(u),
    mayNickname(server, u) ? { label: me ? 'Change my nickname\u2026' : 'Change nickname\u2026', icon: 'edit', action: () => openNickname(server, u) } : null,
  ];
  if (isGroup(server)) return items;
  const isOwnerTarget = server.ownerId === u.id;
  const myTop = server.ownerId === S.me.id ? Infinity : Math.max(0, ...memberRoles(server, S.me.id).map((r) => r.position));
  const theirTop = isOwnerTarget ? Infinity : Math.max(0, ...memberRoles(server, u.id).map((r) => r.position));
  if (can(server, PERMS.MANAGE_ROLES)) {
    const current = (server.memberRoles || {})[u.id] || [];
    // Roles below yours: ones they have (taking one away is fine) and ones you could give.
    const assignable = (server.roleDefs || []).filter((r) => !r.everyone && r.position < myTop && (current.includes(r.id) || mayGiveRole(server, r)));
    if (assignable.length && (me || theirTop < myTop)) {
      items.push('-', { header: 'Roles' });
      assignable.forEach((r) => items.push({
        label: `${r.icon ? r.icon + ' ' : ''}${r.name}`, checked: current.includes(r.id),
        // Just this role: members change their own roles too, so the rest of this list may be out of date.
        action: () => api('PUT', `/servers/${server.id}/members/${u.id}/roles`, current.includes(r.id) ? { remove: [r.id] } : { add: [r.id] }).catch((e) => toast(e.message, 'error')),
      }));
    }
  }
  if (!me && !isOwnerTarget && theirTop < myTop) {
    items.push(...voiceModItems(server, u));
    if (can(server, PERMS.KICK_MEMBERS) || can(server, PERMS.BAN_MEMBERS)) items.push('-');
    if (can(server, PERMS.KICK_MEMBERS)) items.push({ label: `Time out ${nameInServer(server, u)}\u2026`, icon: 'timer', action: () => openTimeout(server, u) });
    if (can(server, PERMS.KICK_MEMBERS)) items.push({ label: `Kick ${nameInServer(server, u)}`, icon: 'logout', danger: true, action: async () => {
      if (await confirmDialog({ title: `Kick ${nameInServer(server, u)}?`, text: 'They can rejoin with an invite. The server\u2019s encryption key is replaced automatically so they can\u2019t read new messages.', confirm: 'Kick', danger: true })) api('DELETE', `/servers/${server.id}/members/${u.id}`).catch((e) => toast(e.message, 'error'));
    } });
    if (can(server, PERMS.BAN_MEMBERS)) items.push({ label: `Ban ${nameInServer(server, u)}`, icon: 'ban', danger: true, action: () => openBan(server, u) });
  }
  return items;
}
// Nicknames (server/nicknames.js): your own needs Change Nickname (or Manage Nicknames), someone else's needs Manage
// Nicknames and them below your highest role (never the owner); nobody's while you're timed out. The server checks
// it all again.
function mayNickname(server, u) {
  if (!server || isGroup(server) || !u || !server.memberIds.includes(u.id)) return false;
  if (server.timeout && server.timeout.until > Date.now()) return false;
  if (u.id === S.me.id) return can(server, PERMS.CHANGE_NICKNAME) || can(server, PERMS.MANAGE_NICKNAMES);
  if (!can(server, PERMS.MANAGE_NICKNAMES) || server.ownerId === u.id) return false;
  const top = (id) => (server.ownerId === id ? Infinity : Math.max(0, ...memberRoles(server, id).map((r) => r.position)));
  return top(u.id) < top(S.me.id);
}
// What someone goes by in this server instead of their display name. DMs and profiles keep the display name.
function openNickname(server, u) {
  const me = u.id === S.me.id;
  const cur = nicknameIn(server, u.id);
  const global = realName(u);
  const inp = h('input', { class: 'input', maxlength: '32', value: cur, placeholder: global, autocomplete: 'off' });
  const save = async (nickname) => {
    const r = await api('PUT', `/servers/${server.id}/members/${u.id}/nickname`, { nickname });
    // Shown at once here; everyone else's app hears it from the server (member:nick).
    applyNick(server.id, u.id, r.nickname);
    if (r.nickname) toast(me ? `Your nickname in ${server.name} is now ${r.nickname}.` : `${global} is now ${r.nickname} in ${server.name}.`);
    else toast(me ? `Nickname removed: you show as ${global} in ${server.name}.` : `${global}\u2019s nickname was removed.`);
  };
  modal({ title: me ? 'Change your nickname' : `Change ${global}\u2019s nickname`, size: 'sm',
    body: h('div', { class: 'stack' }, field('Nickname', inp, me
      ? `What people in ${server.name} see instead of your display name. DMs and your profile still show ${global}. Up to 32 characters; leave it empty to go back to ${global}. Each change is listed in the server\u2019s audit log.`
      : `What people in ${server.name} see instead of their display name (${global}). Up to 32 characters; leave it empty to remove it. It\u2019s listed in the server\u2019s audit log.`)),
    actions: [
      cur ? { label: 'Remove nickname', action: () => save('') } : null,
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', action: () => save(inp.value.trim()) },
    ].filter(Boolean) });
  setTimeout(() => inp.select(), 50);
}
// Timeouts: they keep reading but can't post, react or talk until it ends. The server checks permissions and
// role order again, and logs it.
function openTimeout(server, u) {
  const reason = h('input', { class: 'input', maxlength: '300', placeholder: 'Optional \u2014 they\u2019re told the reason' });
  const len = h('select', { class: 'input', 'aria-label': 'How long' },
    [[5, '5 minutes'], [10, '10 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '1 week'], [40320, '28 days']].map(([v, l]) => h('option', { value: String(v) }, l)));
  len.value = '60';
  modal({ title: `Time out ${nameInServer(server, u)}?`, size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, 'They can still read, but can\u2019t send messages, react, start threads or talk in calls until it ends.'), field('For', len), field('Reason', reason)),
    actions: [
      { label: 'Remove timeout', action: () => api('DELETE', `/servers/${server.id}/members/${u.id}/timeout`).then(() => toast('Timeout removed.')) },
      { label: 'Cancel' },
      { label: 'Time out', kind: 'danger', action: () => api('POST', `/servers/${server.id}/members/${u.id}/timeout`, { minutes: Number(len.value), reason: reason.value }).then((r) => toast(`${nameInServer(server, u)} is timed out until ${fmtStamp(r.until)}.`)) }] });
}
function openBan(server, u) {
  const reason = h('input', { class: 'input', maxlength: '300', placeholder: 'Optional — moderators see it (in Bans and the audit log)' });
  // Cleanup after a raid or a spammer: their messages in this server's channels from that window go too.
  const wipe = h('select', { class: 'input', 'aria-label': 'Delete their messages from the last' },
    [[0, 'Don\u2019t delete any'], [1, 'Last hour'], [24, 'Last 24 hours'], [168, 'Last 7 days']].map(([v, l]) => h('option', { value: String(v) }, l)));
  modal({ title: `Ban ${nameInServer(server, u)}?`, size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, 'They\u2019re removed now and can\u2019t rejoin, even with an invite, until someone unbans them.'), field('Reason', reason),
      field('Delete their messages', wipe, 'From every channel in this server, with their files. A thread they started goes with its replies, unless it has replies you couldn\u2019t delete yourself. This can\u2019t be undone.')),
    actions: [{ label: 'Cancel' }, { label: 'Ban', kind: 'danger', action: () => api('POST', `/servers/${server.id}/bans`, { userId: u.id, reason: reason.value, deleteHours: Number(wipe.value) })
      .then((r) => toast((r.deleted ? `${nameInServer(server, u)} is banned and ${r.deleted} of their message${r.deleted === 1 ? ' was' : 's were'} deleted.` : `${nameInServer(server, u)} is banned.`)
        + (r.kept ? ` ${r.kept} thread${r.kept === 1 ? '' : 's'} they started ${r.kept === 1 ? 'was' : 'were'} kept: ${r.kept === 1 ? 'it has' : 'they have'} replies you can\u2019t delete.` : ''))) }] });
}
// Voice moderation: server mute (Mute Members, for the whole server, whether or not they're in a call right now),
// and, for someone in one of this server's voice channels you can see, move and disconnect (Move Members in that
// channel). The server checks it all again.
// (The server sends moderators the list of server-muted members; a call's own list says so too.)
const isServerMuted = (server, u) => (server.voiceMutes || []).includes(u.id)
  || (server.channels || []).some((c) => (S.voice[c.id] || []).some((x) => x.userId === u.id && x.serverMuted));
function voiceModItems(server, u) {
  if (isGroup(server)) return [];
  const vc = (server.channels || []).find((c) => c.type === 'voice' && (S.voice[c.id] || []).some((x) => x.userId === u.id));
  const name = nameInServer(server, u);
  const run = (p, done) => p.then(() => toast(done)).catch((e) => toast(e.message, 'error'));
  const out = [];
  if (can(server, PERMS.MUTE_MEMBERS)) {
    out.push(isServerMuted(server, u)
      ? { label: 'Remove server mute', icon: 'mic', action: () => run(api('DELETE', `/servers/${server.id}/voice/${u.id}/mute`), `${name} can talk again.`) }
      : { label: 'Server mute', icon: 'micOff', action: () => run(api('POST', `/servers/${server.id}/voice/${u.id}/mute`), `${name} is muted for everyone in this server.`) });
  }
  if (vc && canIn(vc, PERMS.MOVE_MEMBERS)) {
    const dest = server.channels.filter((c) => c.type === 'voice' && c.id !== vc.id && canIn(c, PERMS.MOVE_MEMBERS));
    if (dest.length) out.push({ label: 'Move to another voice channel\u2026', icon: 'speaker', action: () => openMoveVoice(server, u, vc, dest) });
    out.push({ label: 'Disconnect from voice', icon: 'phoneOff', danger: true, action: () => run(api('POST', `/servers/${server.id}/voice/${u.id}/disconnect`), `${name} was disconnected from ${vc.name}.`) });
  }
  return out.length ? ['-', { header: vc ? `Voice \u2014 ${vc.name}` : 'Voice' }, ...out] : [];
}
function openMoveVoice(server, u, from, dest) {
  const to = h('select', { class: 'input', 'aria-label': 'Voice channel' }, dest.map((c) => h('option', { value: c.id }, c.name)));
  modal({ title: `Move ${nameInServer(server, u)}?`, size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, `They leave ${from.name} and join the channel you pick, if they\u2019re allowed to connect there.`), field('Move to', to)),
    actions: [{ label: 'Cancel' }, { label: 'Move', kind: 'primary', action: () => api('POST', `/servers/${server.id}/voice/${u.id}/move`, { channelId: to.value })
      .then(() => toast(`${nameInServer(server, u)} was moved to ${(dest.find((c) => c.id === to.value) || {}).name || 'another channel'}.`)) }] });
}

function dmProfilePanel(el) {
  const d = S.dms.find((x) => x.id === S.view.dmId);
  if (!d) return;
  const u = getUser(d.userId);
  const mutual = realServers().filter((s) => s.memberIds.includes(u.id));
  el.dataset.key = currentKey(); // drawn for this DM (dmProfilePlace)
  // Its fold button sits where the panel meets the chat (app.css puts it on the other end of the row when the panel is
  // on the left), and folds it away until the header's profile button brings it back.
  el.append(h('div', { class: 'panel-head dm-profile-head' },
    ibtn('panelClose', 'Hide profile', () => togglePanel('members'), { cls: 'dm-fold', side: 'bottom' }),
    h('div', { class: 'panel-title' }, h('h2', null, 'Profile'))));
  el.append(h('div', { class: 'dm-profile' }, profileCard(u, {
    meId: S.me.id,
    mutual: mutual.length ? h('div', { class: 'pc-section' }, h('div', { class: 'pc-label' }, `Mutual servers \u2014 ${mutual.length}`),
      h('div', { class: 'pc-mutuals' }, mutual.map((s) => h('button', { class: 'pc-mutual', onclick: () => openServer(s.id) }, s.icon ? h('img', { src: s.icon, alt: '' }) : h('span', null, s.name.slice(0, 1)), s.name)))) : null,
  })));
}
async function pinsPanel(el) {
  const key = currentKey();
  el.append(panelHead('Pinned messages', null));
  const list = h('div', { class: 'pin-list' }, h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' })));
  el.append(list);
  try {
    const url = key.startsWith('c:') ? `/channels/${encodeURIComponent(key.slice(2))}/pins` : `/dms/${encodeURIComponent(key.slice(2))}/pins`;
    const all = await api('GET', url);
    await Promise.all(all.map(decryptMessage));
    const pins = all.filter((m) => !isExpired(m, nowServer()));
    if (currentKey() !== key || panelMode() !== 'pins') return;
    clear(list);
    if (key.startsWith('c:')) pinHistory(el, key.slice(2));
    if (!pins.length) { list.append(h('div', { class: 'panel-empty' }, icon('pin'), h('p', null, 'No pinned messages yet. Pin important messages from the \u22ef menu so everyone can find them.'))); return; }
    const pinServer = key.startsWith('c:') ? serverOfChannel(key.slice(2)) : null;
    pins.forEach((m) => {
      const u = getUser(m.authorId);
      const wf = WF.isShown(m.id) ? null : WF.check(m); // the word filter covers pins too
      list.append(h('div', { class: 'pin-card' },
        h('div', { class: 'pin-meta' }, avatarEl(u, 20), nameEl(u, { server: pinServer }), h('span', null, fmtStamp(m.createdAt))),
        wf ? h('div', { class: 'pin-text' }, h('em', null, previewLabel(wf)))
          : h('div', { class: 'pin-text', html: readable(m) ? md(textOf(m) || (filesOf(m).length ? '_Attachment_' : ''), { mentionName: S.me.username }) : '<em>Encrypted message</em>' }),
        h('div', { class: 'pin-actions' },
          h('button', { class: 'btn ghost sm', onclick: () => jumpFromPanel(key, m.id) }, 'Jump'),
          ibtn('close', 'Unpin', () => togglePin(m), { cls: 'sm' }))));
    });
  } catch (e) { clear(list).append(h('p', { class: 'sidebar-empty' }, e.message)); }
}
// Who pinned and unpinned what in this channel, newest first (kept by the server).
async function pinHistory(el, channelId) {
  try {
    const log = await api('GET', `/channels/${channelId}/pins/log`);
    if (!log.length || currentKey() !== 'c:' + channelId || panelMode() !== 'pins') return;
    el.append(h('details', { class: 'pin-history' }, h('summary', null, 'Pin history'),
      h('ul', null, log.slice(0, 20).map((x) => h('li', null, nameEl(getUser(x.userId), { server: serverOfChannel(channelId) }), ` ${x.action === 'pin' ? 'pinned' : 'unpinned'} a message \u00b7 ${fmtStamp(x.at)} `,
        h('button', { class: 'link-btn', onclick: () => jumpFromPanel('c:' + channelId, x.messageId) }, 'Jump'))))));
  } catch { /* the pins still show */ }
}
function threadPanel(el) {
  const t = S.threads[S.thread.rootId];
  const c = channelById(S.thread.channelId);
  const back = S.thread.from === 'threads' ? ibtn('chevronLeft', 'Back to threads', () => closeThread()) : null;
  el.append(panelHead('Thread', c ? `#${c.name}` : '', back));
  if (!t) { el.append(h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' }))); return; }
  const list = h('div', { class: 'thread-list', role: 'log', 'aria-label': 'Thread messages' });
  list.addEventListener('click', onMessageAreaClick);
  messageListKeys(list);
  list.append(messageEl(t.root, null, 'thread'));
  list.append(h('div', { class: 'thread-divider' }, h('span', null, threadCountLabel(t))));
  if (t.hasMore) list.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => loadOlderReplies(e.currentTarget) }, 'Show earlier replies'));
  let prev = null;
  // "New replies" above the first reply you hadn't read when you opened the thread.
  const marker = S.thread.markerId;
  let newShown = false;
  t.list.forEach((m) => {
    if (!newShown && marker && m.id > marker && m.authorId !== S.me.id) {
      list.append(h('div', { class: 'new-div', role: 'separator', 'aria-label': 'New replies' }, h('span', null, 'New replies')));
      newShown = true; prev = null;
    }
    list.append(messageEl(m, prev, 'thread')); prev = m;
  });
  if (t.hasNewer) list.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => loadNewerReplies(e.currentTarget) }, 'Show newer replies'));
  ensureCurrentMessage(list);
  // Once the thread is closed (S.thread is null) the composer has no conversation: something still on a timer for it
  // (the link check after a pause in typing) finds none instead of failing.
  const comp = createComposer({ id: 'thread', key: () => (S.thread ? 'c:' + S.thread.channelId : null), threadId: () => (S.thread ? S.thread.rootId : null), placeholder: 'Reply in thread\u2026' });
  composers.thread = comp;
  el.append(list, comp.el);
  comp.renderExtras();
  requestAnimationFrame(() => {
    // After "Show earlier replies", stay where the reader was instead of jumping to the newest reply.
    const keep = S.thread && S.thread.keepId && list.querySelector(`[data-mid="${S.thread.keepId}"]`);
    if (keep) { keep.scrollIntoView({ block: 'start' }); S.thread.keepId = null; } else list.scrollTop = list.scrollHeight;
    if (S.thread && S.thread.focusId) { const f = list.querySelector(`[data-mid="${S.thread.focusId}"]`); if (f) flash(f); S.thread.focusId = null; }
    if (!keep) comp.focus();
  });
}
// "12 replies": with only part of the thread loaded, the count comes from the server.
function threadCountLabel(t) {
  const n = t.hasMore || t.hasNewer ? Math.max(t.list.length, t.total || 0) : t.list.length;
  return n ? `${n} ${n === 1 ? 'reply' : 'replies'}` : 'No replies yet';
}
async function loadOlderReplies(btn) {
  const t = S.thread && S.threads[S.thread.rootId];
  if (!t || !t.hasMore || !t.list.length) return;
  btn.disabled = true;
  try {
    const rootId = S.thread.rootId;
    const res = await api('GET', `/messages/${rootId}/thread?limit=100&before=${encodeURIComponent(t.list[0].id)}`);
    await Promise.all(res.messages.map(decryptMessage));
    const have = new Set(t.list.map((m) => m.id));
    t.list = [...res.messages.filter((m) => !have.has(m.id)), ...t.list];
    t.hasMore = !!res.hasMore;
    if (S.thread && S.thread.rootId === rootId) { S.thread.keepId = [...have][0]; renderPanel(); }
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
}
// After opening a thread at an older reply: the next page of newer ones.
async function loadNewerReplies(btn) {
  const t = S.thread && S.threads[S.thread.rootId];
  if (!t || !t.hasNewer || !t.list.length) return;
  btn.disabled = true;
  try {
    const rootId = S.thread.rootId;
    const last = t.list[t.list.length - 1].id;
    const res = await api('GET', `/messages/${rootId}/thread?limit=100&after=${encodeURIComponent(last)}`);
    await Promise.all(res.messages.map(decryptMessage));
    const have = new Set(t.list.map((m) => m.id));
    t.list = [...t.list, ...res.messages.filter((m) => !have.has(m.id))];
    t.hasNewer = !!res.hasNewer;
    if (S.thread && S.thread.rootId === rootId) { S.thread.keepId = last; renderPanel(); markThreadRead(rootId); }
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
}
// Straight to the newest replies (after you reply while an older part of the thread is showing).
async function loadNewestReplies() {
  const rootId = S.thread && S.thread.rootId;
  const t = rootId && S.threads[rootId];
  if (!t) return;
  t.jumping = true; // your reply arrives twice (the answer and the socket): one reload is enough
  try {
    const res = await api('GET', `/messages/${rootId}/thread?limit=100`);
    await Promise.all(res.messages.map(decryptMessage));
    Object.assign(t, { list: res.messages, hasMore: !!res.hasMore, hasNewer: false, total: Math.max(res.messages.length, res.root.threadCount || 0) });
    if (S.thread && S.thread.rootId === rootId) { renderPanel(); markThreadRead(rootId); }
  } catch (e) { toast(e.message, 'error'); } finally { t.jumping = false; }
}

// ======================================================================= the Threads panel
// A channel's threads, the one with the latest reply first (GET /channels/:id/threads), with what's new for you in
// each. The first messages come encrypted and are decrypted here. Live: replies move their thread to the top.
// refocus: the card that had focus before the panel was rebuilt.
function threadsPanel(el, refocus = null) {
  const channelId = S.view.channelId;
  const c = channelById(channelId);
  el.append(panelHead('Threads', c ? `#${c.name}` : ''));
  const list = h('ul', { class: 'threads-list', 'aria-label': `Threads in ${c ? '#' + c.name : 'this channel'}` });
  // Where the list is scrolled to, so a rebuild or coming back from a thread doesn't jump to the top.
  list.addEventListener('scroll', () => { const tp = S.threadsPanel; if (tp && tp.channelId === channelId) tp.scrollTop = list.scrollTop; }, { passive: true });
  el.append(list);
  if (!S.threadsPanel || S.threadsPanel.channelId !== channelId) loadThreads(channelId);
  drawThreads(list, S.threadsPanel);
  if (S.threadsPanel && S.threadsPanel.scrollTop) list.scrollTop = S.threadsPanel.scrollTop;
  if (refocus) focusThreadCard(refocus);
}
// Focus a thread's card in the Threads list (fallback: the panel's heading when the card isn't there).
function focusThreadCard(rootId, { fallback = false } = {}) {
  const panel = $('#members');
  if (!panel || panelMode() !== 'threads') return;
  const card = rootId && panel.querySelector(`.threads-list [data-root="${CSS.escape(rootId)}"]`);
  const target = card && (card.matches('button') ? card : card.querySelector('button'));
  if (target) { target.focus({ preventScroll: !!S.threadsPanel && !!S.threadsPanel.scrollTop }); return; }
  if (!fallback) return;
  const head = panel.querySelector('.panel-head h2');
  if (head) { head.tabIndex = -1; head.focus(); }
}
async function loadThreads(channelId, more = false) {
  let tp = S.threadsPanel;
  if (!more || !tp || tp.channelId !== channelId) tp = S.threadsPanel = { channelId, items: [], hasMore: false, next: null, loading: false, error: null };
  if (tp.loading) return;
  tp.loading = true;
  if (more) redrawThreads();
  try {
    const res = await api('GET', `/channels/${encodeURIComponent(channelId)}/threads${more && tp.next ? `?before=${encodeURIComponent(tp.next)}` : ''}`);
    await Promise.all(res.threads.map((t) => decryptMessage(t.root)));
    if (S.threadsPanel !== tp) return;
    const have = new Set(tp.items.map((t) => t.rootId));
    // A thread whose first message has disappeared (by its own timer, before the server's sweep) isn't listed; one
    // that will is dropped when it goes (purgeExpired).
    const live = res.threads.filter((t) => !isExpired(t.root, nowServer()));
    tp.items.push(...live.filter((t) => !have.has(t.rootId)));
    if (live.some((t) => disappears(t.root))) setTimeout(armClientExpiry, 0);
    tp.hasMore = !!res.hasMore; tp.next = res.next; tp.error = null;
    // Only the listed threads get their state: one left out above (this app's clock or the sender's timer is ahead of
    // the server's) must not count in the Threads button or the badge again after purgeExpired dropped it.
    const dropped = res.threads.filter((t) => !live.includes(t));
    for (const t of dropped) delete S.threadState[t.rootId];
    for (const t of live) applyThreadState({ rootId: t.rootId, channelId, unread: t.unread, mentions: t.mentions, lastReadId: t.lastReadId, lastId: t.lastReplyId }, { quiet: true });
    // The first page carries the channel's thread pings (less those in threads left out): its badge is right once the
    // panel opens.
    if (res.threadMentions !== undefined) {
      setThreadPings('c:' + channelId, Math.max(0, res.threadMentions - dropped.reduce((n, t) => n + (t.mentions || 0), 0)));
      updateTitle(); later(renderRail); later(renderSidebar);
    }
    // The same threads' lines under their messages, if they're on screen.
    const store = currentKey() === 'c:' + channelId && S.msgs['c:' + channelId];
    if (store) for (const t of live) { const m = store.list.find((x) => x.id === t.rootId); if (m) replaceMessageEl(m); }
  } catch (e) { tp.error = e.message; } finally { tp.loading = false; }
  if (S.threadsPanel === tp) { redrawThreads(); if (S.view.channelId === channelId) renderHeader(); }
}
// A reply arrived while the list is showing a new thread (or one further down): fetch the top again, once.
let threadsReload = 0;
function reloadThreadsSoon(channelId) {
  clearTimeout(threadsReload);
  threadsReload = setTimeout(() => {
    const old = S.threadsPanel;
    if (!old || old.channelId !== channelId) return;
    S.threadsPanel = null;
    loadThreads(channelId);
    // Same list, newer contents: where it's scrolled to and the threads you chose to see stay.
    if (S.threadsPanel) Object.assign(S.threadsPanel, { scrollTop: old.scrollTop, revealed: old.revealed });
  }, 300);
}
function drawThreads(list, tp) {
  if (!tp || (tp.loading && !tp.items.length)) return list.append(h('li', { class: 'panel-loading' }, h('span', { class: 'spinner', 'aria-label': 'Loading threads' })));
  if (tp.error && !tp.items.length) return list.append(h('li', { class: 'sidebar-empty' }, tp.error));
  if (!tp.items.length) return list.append(h('li', { class: 'panel-empty' }, icon('thread'), h('p', null, 'No threads here yet. Hover over a message and pick “Reply in thread” to start one.')));
  for (const t of tp.items) list.append(h('li', null, threadCard(t)));
  if (tp.hasMore) list.append(h('li', null, h('button', { class: 'btn ghost sm', type: 'button', disabled: tp.loading, onclick: () => loadThreads(tp.channelId, true) }, tp.loading ? 'Loading…' : 'Show older threads')));
}
// Redraws the list where it is (keeps the scroll position and the card that had focus).
function redrawThreads() {
  const list = panelMode() === 'threads' && $('#members .threads-list');
  if (!list || !S.threadsPanel || S.threadsPanel.channelId !== S.view.channelId) return;
  const top = list.scrollTop;
  const focused = document.activeElement && list.contains(document.activeElement) && document.activeElement.closest('[data-root]');
  clear(list);
  drawThreads(list, S.threadsPanel);
  list.scrollTop = top;
  if (focused) focusThreadCard(focused.dataset.root);
}
const newLabel = (n) => `${n >= 100 ? '99+' : n} new`;
// Who started a thread, if this app has its first message (in the channel's loaded messages, the thread itself or
// the Threads list).
function threadAuthor(rootId, channelId) {
  const store = S.msgs['c:' + channelId];
  const m = (store && store.list.find((x) => x.id === rootId)) || (S.threads[rootId] && S.threads[rootId].root)
    || (S.threadsPanel && S.threadsPanel.items.find((x) => x.rootId === rootId) || {}).root;
  return m ? m.authorId : null;
}
function threadCard(t) {
  const tp = S.threadsPanel;
  // Someone you blocked started it: folded away like their messages in the channel, until you ask to see it.
  if (S.blocked.has(t.root.authorId) && !(tp && tp.revealed && tp.revealed.has(t.rootId))) {
    return h('div', { class: 'thread-card blocked', dataset: { root: t.rootId } }, h('span', { class: 'blocked-note' }, icon('ban'), 'Thread started by someone you blocked. ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => { const cur = S.threadsPanel; if (!cur) return; (cur.revealed ||= new Set()).add(t.rootId); redrawThreads(); focusThreadCard(t.rootId); } }, 'Show')));
  }
  const st = S.threadState[t.rootId] || t;
  const fresh = st.unread || 0;
  const pinged = fresh > 0 && st.mentions > 0;
  // The name, picture and labels the message has in the channel (a webhook's own name, BOT, not end-to-end encrypted).
  const author = getUser(t.root.authorId);
  const face = hookFace(author, t.root);
  const bot = isBotPost(author, t.root);
  const tServer = msgServer(t.root);
  const flag = readable(t.root) ? postFlag(t.root, author) : null;
  const text = readable(t.root) ? textOf(t.root) : '';
  const wf = WF.isShown(t.root.id) ? null : WF.check(t.root);
  const preview = wf ? h('span', { class: 'thread-card-text' }, h('em', null, previewLabel(wf))) : h('span', { class: 'thread-card-text', html: text
    ? md(text, { inline: true, mentionName: S.me.username, everyone: senderMayPingEveryone(t.root) })
    : readable(t.root) && filesOf(t.root).length ? '<em>Attachment</em>' : '<em>Encrypted message</em>' });
  // The card is one button: links and spoilers in the preview are plain text (open the thread to use them).
  preview.querySelectorAll('a').forEach((a) => a.replaceWith(h('span', { class: 'link-text' }, a.textContent)));
  preview.querySelectorAll('[tabindex], [role]').forEach((x) => { x.removeAttribute('tabindex'); x.removeAttribute('role'); x.removeAttribute('aria-label'); });
  const count = `${t.replyCount} ${t.replyCount === 1 ? 'reply' : 'replies'}`;
  const when = t.lastReplyAt ? `Last reply ${relTime(t.lastReplyAt)}` : '';
  const people = (t.participants || []).filter((id) => !S.blocked.has(id));
  return h('button', {
    class: `thread-card${fresh ? ' unread' : ''}`, type: 'button', dataset: { root: t.rootId },
    'aria-label': `Thread by ${nameInServer(tServer, face)}${bot ? ` (${flag ? flag.label.toLowerCase().replace(' \u00b7 ', ', ') : 'bot'})` : ''}: ${count}${fresh ? `, ${newLabel(fresh)}${pinged ? ', mentions you' : ''}` : ''}${when ? `, ${when.toLowerCase()}` : ''}. Open thread`,
    onclick: () => openThread(t.root, null, { from: 'threads' }),
  },
  h('span', { class: 'thread-card-head' }, avatarEl(face, 20), nameEl(face, { server: tServer }), bot ? h('span', { class: 'bot-tag' }, 'BOT') : null,
    fresh ? h('span', { class: `thread-new${pinged ? ' ping' : ''}` }, `${pinged ? '@ ' : ''}${newLabel(fresh)}`) : null),
  preview,
  flag ? h('span', { class: 'msg-flag thread-card-flag' }, flag.label) : null,
  h('span', { class: 'thread-card-foot' },
    people.length ? h('span', { class: 'thread-card-people', 'aria-hidden': 'true' }, people.map((id) => avatarEl(getUser(id), 18))) : null,
    h('strong', null, count), when ? h('span', null, when) : null));
}
// A reply came in: its thread goes to the top, with the newest people and your counts (the reply count comes with
// thread:update, which can arrive before this does).
function threadsPanelReply(m) {
  const tp = S.threadsPanel;
  if (!tp || tp.channelId !== m.channelId || tp.loading) return;
  const i = tp.items.findIndex((x) => x.rootId === m.threadId);
  if (i < 0) return reloadThreadsSoon(m.channelId);
  const [it] = tp.items.splice(i, 1);
  Object.assign(it, { lastReplyId: m.id, lastReplyAt: m.createdAt, participants: [m.authorId, ...(it.participants || []).filter((x) => x !== m.authorId)].slice(0, 5) });
  tp.items.unshift(it);
  redrawThreads();
}
// thread:update: a thread's reply count changed (a reply was added or deleted). No replies left: not a thread.
function onThreadCount(rootId, channelId, count, lastAt) {
  if (!count) forgetThreads('c:' + channelId, new Set([rootId]));
  const tp = S.threadsPanel;
  const it = tp && tp.channelId === channelId && tp.items.find((x) => x.rootId === rootId);
  if (!it) return;
  if (!count) tp.items = tp.items.filter((x) => x !== it);
  else Object.assign(it, { replyCount: count, lastReplyAt: lastAt || it.lastReplyAt });
  redrawThreads();
}

// ======================================================================= composer
const composers = {};
// Scheduled messages, "Send later" (scheduled.js): your list, the bar above the composer, and re-encrypting the ones
// the server holds because a key changed after you wrote them.
const SCHED = createScheduled({
  me: () => S.me,
  spellBox,
  spelled: (ta, was) => spelled(ta, was),
  openDraft: (it) => openDraft(it.ref, it.dmId ? 'd:' + it.dmId : 'c:' + it.channelId, it.threadId, it.draft),
  sealFor: (key, payload, keep) => sealFor(key, payload, keep),
  withKeyRetry: (serverId, fn) => withKeyRetry(serverId, fn),
  clock: () => nowServer(),
  // The conversation's disappearing timer changed under a re-encrypt (409 disappear_changed): fetch it, then try again.
  refreshTimer: (key) => refreshTimer(key),
  placeOf: (it) => {
    if (it.dmId) {
      const d = S.dms.find((x) => x.id === it.dmId);
      return { label: d ? displayName(getUser(d.userId)) : 'a conversation you can no longer open', dm: !!d };
    }
    const c = channelById(it.channelId);
    const s = c && serverOfChannel(c.id);
    if (!c || !s) return { label: 'a channel you can no longer open', dm: false };
    return { label: isGroup(s) ? groupName(s) : `${chanLabel(c)} · ${s.name}`, dm: false };
  },
  onChange: (key) => {
    if (currentKey() !== key) return;
    if (composers.main) composers.main.renderExtras();
  },
  openKey: (key) => {
    if (key.startsWith('d:')) { if (S.dms.some((d) => d.id === key.slice(2))) openDm(key.slice(2)); return; }
    const s = serverOfChannel(key.slice(2));
    if (s) openChannel(key.slice(2), s.id);
  },
});

// Photos & videos (media-panel.js): the side panel of every picture and video in a conversation.
// A file to show: its decrypted copy, or (an older unencrypted channel file) the file on this server as it is.
const mediaCopy = (m, f) => ((f.k || m.dmId) ? decryptedUrl(m, f)
  : isUploadUrl(f.url) ? Promise.resolve(f.url) : Promise.reject(new Error('This file isn\u2019t on this server.')));
const MEDIA = createMediaPanel({
  key: () => currentKey(),
  get: (path) => api('GET', path),
  decrypt: (m) => decryptMessage(m),
  // The chat's own copy, when it has one: nothing is decrypted twice, and changes to it (tags) show in both.
  known: (id) => { const m = loadedMessage(id); return m && m.dec ? m : null; },
  files: (m) => filesOf(m),
  readable: (m) => readable(m),
  expired: (m) => isExpired(m, nowServer()),
  disappears: (m) => disappears(m),
  blocked: (id) => S.blocked.has(id),
  veiled: (m) => veiled(m),
  filterLabel: (wf) => filterLabel(wf),
  reveal: (m) => revealFiltered(loadedMessage(m.id) || m),
  thumb: (m, f) => decryptedUrl(m, { ...f.th, type: 'image/webp', thumb: true }),
  full: (m, f) => mediaCopy(m, f),
  queue: (fn) => loadQueue(fn),
  // Its tiles are small, so they load like the tiles of a message with many files: a picture without a thumbnail
  // (a GIF, say) by itself only up to 2 MB; videos never.
  autoloadMax: MANY_AUTOLOAD_MAX,
  open: (tile, opts) => openViewer(tile, opts),
  download: (m, f) => downloadAttachment(m, f),
  badges: (m, fi) => NOTES.badges(m, fi),
  tagIndex: (key) => NOTES.tagIndex(key),
  panelHead: (title) => panelHead(title, null),
  forget: (msgs, ids, key) => forgetCopies(msgs, ids, key),
  drop: (urls) => urls.forEach((u) => fileUrls.drop(u, true)),
  armExpiry: () => armClientExpiry(),
});
// Disappearing messages that went from wherever else they were loaded go from the panel too.
expiryListeners.add((ids) => MEDIA.onDelete(null, ids));

// Comments on one photo and tags on photos (photo-notes.js).
const NOTES = createPhotoNotes({
  me: () => S.me,
  where: (key) => {
    if (key.startsWith('d:')) return S.dms.some((d) => d.id === key.slice(2)) ? { dmId: key.slice(2) } : null;
    const s = serverOfChannel(key.slice(2));
    return s ? { serverId: s.id, channelId: key.slice(2) } : null;
  },
  encryptTag: (where, tag) => sec.encryptTag(where, tag),
  openTag: (t) => sec.openTag(t),
  withKeyRetry: (serverId, fn) => withKeyRetry(serverId, fn),
  // (What it fetches and decrypts for its tag index, Photos & videos takes when a tag is picked: not fetched twice.)
  decrypt: (m) => decryptMessage(m).then(() => MEDIA.offer(m)),
  readable: (m) => readable(m),
  filesOf: (m) => filesOf(m),
  expired: (m) => isExpired(m, nowServer()),
  blocked: (id) => S.blocked.has(id),
  getUser: (id) => getUser(id),
  nameOf: (m, u) => nameInMsg(m, u),
  avatar: (u, size) => avatarEl(u, size),
  // A comment's words as the chat shows them, through the word filter too. (A click shows a spoiler in them; what
  // else a click does in the chat, such as a profile card, would open behind the viewer.)
  textEl: (m) => {
    const wf = veiled(m);
    if (wf) return h('div', { class: 'pn-c-text' }, h('em', null, previewLabel(wf)));
    return h('div', { class: 'pn-c-text md', html: md(textOf(m) || '_Attachment_', { mentionName: S.me.username }),
      onclick: (e) => { const sp = e.target.closest('.md-spoiler'); if (sp) sp.classList.add('revealed'); } });
  },
  canPost: (key, threadId) => photoPostBlock(key, threadId),
  canManage: (key) => { const c = key.startsWith('c:') ? channelById(key.slice(2)) : null; return !!c && canIn(c, PERMS.MANAGE_MESSAGES); },
  sendComment: (item, text) => sendComment(item, text),
  enterSends: () => P.chat.enterToSend !== false, // as the message box (Settings → "Enter sends the message")
  spellBox: (ta) => spellBox(ta),
  spelled: (ta) => spelled(ta),
  spellcheck: () => spellcheckAttr(),
  copies: (id) => loadedCopies(id),
  loaded: (id) => loadedMessage(id),
  onMeta: (key, id) => {
    MEDIA.onMeta(key, id);
    const v = $('.viewer:not(.closing)');
    if (v && v._photoChanged) v._photoChanged(id);
  },
  // (MEDIA.onMeta about no message in particular: only its tag chips again.)
  onIndex: (key) => MEDIA.onMeta(key, null),
  // A comment, from the viewer's side panel: the viewer closes (and on a phone the side panel it may have been opened
  // from, which covers the chat), then the chat goes to it.
  openMessage: (m) => {
    const v = $('.viewer:not(.closing)');
    if (v && v._close) v._close();
    if (isPhoneLayout() && panelMode()) closePanel();
    return m.dmId ? jumpToMessage('d:' + m.dmId, m.id) : jumpToMessageId(m.id);
  },
  // (Comments and tagged messages it loads that disappear: the timer counts them in, NOTES.messages.)
  armExpiry: () => armClientExpiry(),
});

// Chat backgrounds (chat-look.js): a background for a DM or group chat, set by someone in it.
const LOOK = createChatLook({
  me: () => S.me,
  dms: () => S.dms,
  server: (id) => S.servers.find((s) => s.id === id),
  getUser: (id) => getUser(id),
  blocked: (id) => S.blocked.has(id),
  title: (key) => {
    if (key.startsWith('d:')) return convTitle(key);
    const g = S.servers.find((s) => s.id === key.slice(2));
    return g ? groupName(g) : 'this group chat';
  },
  encryptLook: (where, look) => sec.encryptLook(where, look),
  openLook: (look) => sec.openLook(look),
  withKeyRetry: (serverId, fn) => withKeyRetry(serverId, fn),
  // The group key this device would seal with now, if it has it: a background sealed with an older one is sealed again.
  currentEpoch: (serverId) => { const ck = sec.currentKey(serverId); return ck ? ck.epoch : null; },
  // Another background passed off as the same one sealed again: drawn in the group chat as the change it is.
  changedQuietly: (serverId, event) => onLookEvent('group:look', { serverId, event }),
  // Covered while you share your screen (a group chat by its chat's key, as the cover goes): no dialog for it then.
  covered: (key) => {
    const g = key.startsWith('g:') ? S.servers.find((s) => s.id === key.slice(2)) : null;
    const c = g && textChannel(g);
    return hiddenWhileSharing(g && c ? 'c:' + c.id : key);
  },
  // A picture is made ready like a photo (at most 2560 px, re-encoded), and goes up the way attachments do.
  prepareImage: (file) => prepareImage(file, { compress: true }),
  upload: (bytes) => (bytes.byteLength > CHUNKED_ABOVE ? uploadResumable(bytes) : uploadSimple(bytes)),
  download: (url, opts) => download(url, opts),
  // Settings → Appearance → "Show backgrounds people set for chats" (on this device).
  enabled: () => loadAppearance().chatLooks !== false,
  changed: () => applyServerTheme(),
});

// The side view (side-view.js): messages and pictures pinned to a panel that stays open while you chat.
// Where a conversation is, for a card ("#general · Indie Game Club", "DM with maya", a group's name), or null when it's
// not one you're in any more. private: a DM or a group chat (covered while you share your screen).
function sidePlace(key) {
  if (key.startsWith('d:')) {
    const d = S.dms.find((x) => x.id === key.slice(2));
    return d ? { kind: 'dm', private: true, label: sidePlaceLabel({ dm: displayName(getUser(d.userId)) }) } : null;
  }
  const c = channelById(key.slice(2));
  const s = c && serverOfChannel(c.id);
  if (!c || !s) return null;
  if (isGroup(s)) return { kind: 'group', private: true, label: sidePlaceLabel({ group: groupName(s) }) };
  return { kind: 'channel', private: false, label: sidePlaceLabel({ channel: chanLabel(c), server: s.name }) };
}
const SIDE = createSideView({
  userId: () => (S.me ? S.me.id : null),
  get: (path) => api('GET', path),
  decrypt: (m) => decryptMessage(m),
  // The chat's own copy, when it has one: nothing is decrypted twice.
  known: (id) => { const m = loadedMessage(id); return m && m.dec ? m : null; },
  keyOf: (m) => keyOfMessage(m),
  files: (m) => filesOf(m),
  readable: (m) => readable(m),
  expired: (m) => isExpired(m, nowServer()),
  disappears: (m) => disappears(m),
  blocked: (id) => S.blocked.has(id),
  veiled: (m) => veiled(m),
  filterLabel: (wf) => previewLabel(wf),
  reveal: (m) => revealFiltered(loadedMessage(m.id) || m),
  place: (key) => sidePlace(key),
  // DMs and group chats while you share your screen, unless you chose to show that one (Show while sharing).
  hidden: (key) => { const p = sidePlace(key); return !!p && p.private && hiddenWhileSharing(key); },
  // Who wrote it, and what's said about that, as on its row in the chat (messageTrust): a webhook post's own name and
  // picture with BOT, and the flags for a bot's or an older message, a key or signature that doesn't check out, or the
  // server having moved, repeated or rolled it back. A card is often a copy the side view fetched by itself, so a
  // server could serve it there instead of in the chat: it must say no less.
  author: (m) => { const t = messageTrust(m, getUser(m.authorId)); return [avatarEl(t.face, 20), nameEl(t.face, { server: msgServer(m) }), t.bot ? h('span', { class: 'bot-tag' }, 'BOT') : null]; },
  trust: (m) => messageTrust(m, getUser(m.authorId)),
  stamp: (ts) => fmtStamp(ts),
  // Its words as the chat draws them (Markdown unless that's off, mentions, @everyone only from someone allowed to use
  // it, spoilers a click shows), or a poll's question.
  textEl: (m) => {
    const t = textOf(m);
    if (t) {
      return h('div', { class: 'sv-text md', html: P.chat.markdown ? md(t, { mentionName: S.me.username, everyone: senderMayPingEveryone(m) }) : escapeText(t),
        onclick: (e) => { const sp = e.target.closest('.md-spoiler'); if (sp) sp.classList.add('revealed'); } });
    }
    return m.dec && m.dec.p ? h('div', { class: 'sv-text' }, h('em', null, `Poll: ${m.dec.p.q}`)) : null;
  },
  thumb: (m, f) => decryptedUrl(m, { ...f.th, type: 'image/webp', thumb: true }),
  full: (m, f) => mediaCopy(m, f),
  queue: (fn, opts) => loadQueue(fn, opts),
  autoloadMax: AUTOLOAD_MAX, // a picture pinned on its own, as in the chat
  thumbMax: MANY_AUTOLOAD_MAX, // a message's pictures, small: like the tiles of a message with many files
  open: (from, opts) => openViewer(from, opts),
  download: (m, f) => downloadAttachment(m, f),
  // Jump: the chat goes to it. Beside the chat the panel stays; on a phone, which it covers, it closes first.
  jump: (it, m) => {
    if (isPhoneLayout() && panelMode()) closePanel();
    if (m && m.threadId) jumpToMessageId(m.id); else jumpToMessage(it.key, it.messageId);
  },
  panelHead: (title, sub) => panelHead(title, sub),
  // Pinning opens the panel. Somewhere it can't show (Friends, say), or under the picture viewer, a toast says so.
  show: () => {
    if (S.panel !== 'side') togglePanel('side');
    if (panelMode() !== 'side' || $('.viewer:not(.closing)')) toast('Pinned to the side.');
  },
  changed: () => { if (S.me) renderHeader(); },
  toast: (text) => toast(text),
  forget: (msgs, ids, key) => forgetCopies(msgs, ids, key),
  drop: (urls) => urls.forEach((u) => fileUrls.drop(u, true)),
  armExpiry: () => armClientExpiry(),
});
// Disappearing messages that went from wherever else they were loaded: their side view cards say they're gone.
expiryListeners.add((ids) => SIDE.onDelete(null, ids));
// Disappearing messages that went from wherever else they were loaded: their tags and comments go too.
expiryListeners.add((ids) => NOTES.onDelete(null, ids));
// Why you can't add a comment or a tag here (a sentence), or null when you can: the same rules as the message box.
function photoPostBlock(key, threadId) {
  if (key.startsWith('d:')) {
    const d = S.dms.find((x) => x.id === key.slice(2));
    if (!d) return 'This conversation isn’t available.';
    const u = getUser(d.userId);
    if (S.blocked.has(d.userId)) return `You blocked ${displayName(u)}.`;
    if (u.deleted) return 'This account was deleted, so nobody can read anything new here.';
    if (sec.keyChanged(u)) return `${displayName(u)}’s security key changed. Verify it before you add anything here.`;
    return null;
  }
  const ch = channelById(key.slice(2));
  if (!ch) return 'You can’t post here.';
  if (canIn(ch, threadId ? PERMS.CREATE_THREADS : PERMS.SEND_MESSAGES)) return null;
  const to = (serverOfChannel(ch.id) || {}).timeout;
  return to && to.until > Date.now() ? `You’re timed out until ${fmtStamp(to.until)}. You can still read.` : 'You don’t have permission to post here.';
}
// A comment on one photo, from the picture viewer's side panel (photo-notes.js): sent like a reply from the message box
// (the same encryption, binding, disappearing timer, key retry and errors), in the thread the photo is in, with which
// photo it is about inside it. Resolves to the message as the server took it.
async function sendComment({ m, f, fi, key }, text) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const msg = await underWay(sendTo(key, m.threadId || null, { t: text, f: [], ph: { i: fi, u: f.url } }, m.id, nonce));
  playSound('sent');
  // Normally the live connection delivers it first; this covers a slow or dropped connection.
  if (msg && msg.id) { if (msg.threadId) onThreadMessage(msg); else onNewMessage(key, msg); }
  return msg;
}
// Every loaded copy of a message: in its conversation's list, and in threads (as a reply or as the first message).
function loadedCopies(id) {
  const out = [];
  for (const st of Object.values(S.msgs)) for (const x of (st && st.list) || []) if (x.id === id) out.push(x);
  for (const th of Object.values(S.threads)) for (const x of [th.root, ...(th.list || [])]) if (x && x.id === id && !out.includes(x)) out.push(x);
  return out;
}
// Bots' slash commands (bots.js). Answers only you can see live in memory and show above the main composer.
const SLASH = createSlash({
  getSocketId: () => (socket && socket.id) || null,
  members: (s) => (s.memberIds || []).map(getUser),
  onEphemeral: () => { if (composers.main) composers.main.renderEph(); },
});
// What you were typing, per conversation (and thread): kept on this device across reloads (see usability.js).
let drafts = createDrafts('signed-out');
// When this app last said you're typing, per conversation: at most every 3 seconds while you type there (the
// others' apps keep showing it for 6, typing.js). Typing somewhere else, or again after sending, says so at the next
// key, but never within a second of the last time anywhere: the server would drop that one (it passes one person's
// typing on at most once a second), and the next key tries again instead.
const typingSent = new Map();
let typingSentAny = 0;
function createComposer({ id, key, threadId, placeholder }) {
  // link: the link preview being offered or built for the link in the box (see checkLink below).
  const state = { replyTo: null, pending: [], link: null };
  const k = key();
  const ta = h('textarea', { class: 'composer-input', rows: '1', maxlength: '4000', 'aria-label': 'Message', id: id === 'main' ? 'composer-input' : null, spellcheck: spellcheckAttr() });
  autocorrect(ta, { on: () => correcting() && !isCommand(ta.value), pasteKey: () => k + (threadId() || '') }); // (pastes: as the draft)
  ta.addEventListener('focus', () => { ta.spellcheck = P.chat.spellcheck !== false; }); // (changed in Settings meanwhile)
  ta.placeholder = placeholder || placeholderFor(k);
  ta.value = drafts.get(k + (threadId() || '')) || '';
  let synced = ta.value; // what this box last read from or wrote to the drafts
  const extras = h('div', { class: 'composer-extras' });
  // Upload progress for the message being sent: kept across redraws of the extras, with a Cancel button.
  const upText = h('span', { class: 'upload-text' });
  const upCancel = h('button', { class: 'btn ghost sm upload-cancel', type: 'button' }, 'Cancel');
  const upStatus = h('div', { class: 'upload-status', hidden: true, role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'upload-progress' }, h('div', { class: 'bar' })), h('div', { class: 'upload-line' }, upText, upCancel));
  let uploading = null; // the AbortController of the upload in progress
  upCancel.addEventListener('click', () => { if (uploading) uploading.abort(); });
  const convId = () => (key() || '') + (threadId() || '');
  const typing = h('div', { class: 'typing', 'aria-live': 'polite', dataset: { key: k } });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addFiles(fileIn.files); fileIn.value = ''; } });
  const sendBtn = h('button', { class: 'send-btn', 'data-tip': P.chat.enterToSend ? 'Send (Enter)' : 'Send (Ctrl+Enter)', 'aria-label': 'Send message', onclick: () => send() }, icon('send'));
  // Send later (scheduled.js): the clock next to the send button, or a right-click (a long press) on it.
  const laterBtn = h('button', { class: 'icon-btn send-later', 'aria-label': 'Send later', 'data-tip': 'Send later', 'data-pop-anchor': '', onclick: (e) => sendLater(e.currentTarget) }, icon('clock'));
  sendBtn.addEventListener('contextmenu', (e) => { if (sendBtn.disabled || laterBtn.hidden) return; e.preventDefault(); sendLater(sendBtn); });
  const suggest = h('div', { class: 'suggest', role: 'listbox', hidden: true });
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; };
  // A video still being looked at (checkShrink) can't go yet: whether it fits isn't known.
  const checking = () => state.pending.some((p) => p.shrink === 'checking');
  const update = () => { sendBtn.disabled = (!ta.value.trim() && !state.pending.length) || checking(); laterBtn.disabled = sendBtn.disabled; };
  const openGifs = (anchor) => gifPicker(anchor, (url) => send(url), { onEmoji: (em) => insertAtCursor(ta, em) });
  const gifBtn = (S.config.features || {}).gifs === false ? null : h('button', { class: 'icon-btn composer-more', 'aria-label': 'GIFs', 'data-tip': 'GIFs', 'data-pop-anchor': '', onclick: (e) => openGifs(e.currentTarget) }, icon('gif'));
  const micBtn = voiceButton(() => box, (file, dur) => send('', { files: [{ file, voice: true, dur }] }));
  micBtn.classList.add('composer-more');
  laterBtn.classList.add('composer-more');
  let canAttach = true; // here (renderExtras)
  // The + menu. On a phone it also has GIFs, voice messages and Send later, whose buttons beside the box are hidden
  // there (app.css) so the box has room to type in.
  const attachItems = () => {
    const more = isPhoneLayout() ? [
      gifBtn ? { label: 'GIFs', icon: 'gif', action: () => openGifs(attachBtn) } : null,
      { label: 'Voice message', icon: 'mic', action: () => micBtn.click() },
      laterBtn.hidden ? null : { label: 'Send later', icon: 'clock', action: () => (sendBtn.disabled ? toast(checking() ? 'Still checking the video\u2026' : 'Write your message first, then choose when it goes.') : sendLater(attachBtn)) },
    ].filter(Boolean) : [];
    return [
      canAttach ? { label: 'Upload a file', icon: 'file', action: () => fileIn.click() } : null,
      canAttach ? { label: 'Create a poll', icon: 'check', action: () => openPollCreator((poll) => send('', { poll })) } : null,
      canAttach && more.length ? '-' : null,
      ...more,
    ];
  };
  const attachBtn = h('button', { class: 'icon-btn attach', 'aria-label': 'Attach a file or create a poll', 'data-tip': 'Attach or poll', 'data-pop-anchor': '', onclick: (e) => menu(e.currentTarget, attachItems(), { side: 'top' }) }, icon('plus'));
  // On a phone the + stays without permission to attach files: GIFs, voice messages and Send later are in it there.
  const fitAttach = () => {
    const phone = isPhoneLayout();
    attachBtn.hidden = !canAttach && !phone;
    attachBtn.setAttribute('aria-label', phone ? 'Attach, GIFs, voice message and more' : 'Attach a file or create a poll');
  };
  const box = h('div', { class: 'composer' },
    attachBtn,
    ta,
    h('div', { class: 'composer-tools' },
      h('button', { class: 'icon-btn', 'aria-label': 'Emoji', 'data-tip': 'Emoji', 'data-pop-anchor': '', onclick: (e) => emojiPicker(e.currentTarget, (em) => insertAtCursor(ta, em), { keepOpen: true }) }, icon('smile')),
      micBtn, gifBtn, laterBtn, sendBtn),
    fileIn);
  const slowNote = h('div', { class: 'slow-note', hidden: true });
  const disNote = h('div', { class: 'dis-note', hidden: true });
  let slowUntil = 0;
  const startSlow = (secs) => {
    slowUntil = Date.now() + secs * 1000;
    const tick = () => {
      const left = Math.ceil((slowUntil - Date.now()) / 1000);
      if (left <= 0 || !document.body.contains(slowNote)) { slowUntil = 0; renderExtras(); return; }
      slowNote.hidden = false; slowNote.textContent = `Slowmode: you can send again in ${fmtDuration(left)}`;
      setTimeout(tick, 1000);
    };
    tick();
  };
  // Slash commands (bots.js): the bar with usage and the encryption warning, and bot answers only you can see.
  const cmdBar = h('div', { class: 'cmd-bar', hidden: true });
  const ephBox = h('div', { class: 'eph-list' });
  const el = h('div', { class: `composer-wrap cw-${id}` }, suggest, ephBox, cmdBar, extras, box, disNote, slowNote, typing);
  // Bots' commands work in text channels (not a group's chat, nor a voice channel's).
  const slashChannel = () => { const kk = key(); if (id !== 'main' || !kk || !kk.startsWith('c:')) return null; const s = serverOfChannel(kk.slice(2)); return s && !isGroup(s) && (channelById(kk.slice(2)) || {}).type === 'text' ? kk.slice(2) : null; };
  const renderCmdBar = () => {
    const ch = slashChannel();
    const cmd = ch && SLASH.match(ch, ta.value);
    clear(cmdBar).hidden = !cmd;
    if (cmd) cmdBar.append(SLASH.hint(cmd, ta.value, serverOfChannel(ch)));
  };
  const renderEph = () => {
    clear(ephBox);
    const ch = slashChannel();
    if (!ch) return;
    for (const e of SLASH.ephemeralFor(ch)) {
      ephBox.append(h('div', { class: 'eph-msg' },
        h('div', { class: 'eph-head' }, icon('bot'), h('b', null, e.botName), h('span', { class: 'bot-tag' }, 'BOT'), h('span', { class: 'field-hint' }, 'Only you can see this \u00b7 not end-to-end encrypted \u00b7 not saved'),
          ibtn('close', 'Dismiss', () => SLASH.dismiss(e), { cls: 'sm' })),
        h('div', { class: 'msg-text', html: md(e.content, { mentionName: S.me.username }) })));
    }
  };

  // ---- @mention autocomplete
  let sugg = { items: [], i: 0, start: -1 };
  // The server this box writes in (null in DMs), for people's nicknames there.
  const suggServer = () => { const kk = key(); return kk.startsWith('c:') ? serverOfChannel(kk.slice(2)) || null : null; };
  // Autocomplete: @people, @roles, @everyone (if allowed) and :emoji: (standard + custom from all your servers)
  const candidates = () => {
    const kk = key();
    if (kk.startsWith('d:')) { const d = S.dms.find((x) => x.id === kk.slice(2)); return d ? [getUser(d.userId)] : []; }
    const s = serverOfChannel(kk.slice(2));
    if (!s) return [];
    const people = s.memberIds.filter((x) => x !== S.me.id).map(getUser);
    if (isGroup(s)) return people;
    const ch = channelById(kk.slice(2));
    // Other people's apps decide whether @everyone or a role mention pings them from the sender's server-wide
    // permission (they can't see channel overrides), so only suggest them when the sender has that and this
    // channel doesn't deny it. A per-channel allow alone would offer pings that never arrive.
    const pingAll = can(s, PERMS.MENTION_EVERYONE) && canIn(ch, PERMS.MENTION_EVERYONE);
    const roles = (s.roleDefs || []).filter((r) => !r.everyone && (r.mentionable || pingAll)).map((r) => ({ role: r }));
    return [...people, ...roles, ...(pingAll ? [{ special: 'everyone', hint: 'Notify everyone in this server' }, { special: 'channel', hint: 'Notify everyone in this channel' }] : [])];
  };
  const closeSuggest = () => { suggest.hidden = true; sugg = { items: [], i: 0, start: -1 }; };
  const drawSuggest = () => {
    clear(suggest);
    sugg.items.forEach((c, i) => suggest.append(h('button', {
      class: `suggest-item${i === sugg.i ? ' active' : ''}`, role: 'option', 'aria-selected': String(i === sugg.i),
      onmousedown: (e) => { e.preventDefault(); pick(i); },
    },
    c.cmd ? h('span', { class: 'suggest-at' }, icon('bot'))
      : c.chan ? h('span', { class: 'suggest-at' }, icon(channelIcon(c.chan)))
      : c.emoji ? h('span', { class: 'suggest-emoji' }, c.custom ? h('img', { class: 'cemoji', src: c.custom.url, alt: '' }) : c.emoji)
      : c.special ? h('span', { class: 'suggest-at' }, icon('at'))
        : c.role ? h('span', { class: 'suggest-at role', style: c.role.color ? { color: c.role.color } : null }, c.role.icon || icon('shield'))
          : avatarEl(c, 24),
    h('span', { class: 'suggest-name', style: c.role && c.role.color ? { color: c.role.color } : null },
      c.cmd ? SLASH.usage(c.cmd) : c.chan ? c.chan.name : c.emoji ? `:${c.name}:` : c.special ? `@${c.special}` : c.role ? `@${c.role.name}` : nameInServer(suggServer(), c)),
    h('span', { class: 'suggest-hint' }, c.cmd ? `${c.cmd.botName} \u00b7 ${c.cmd.description}` : c.chan ? (c.chan.type === 'voice' ? 'Voice channel' : catOf(c.chan))
      : c.emoji ? (c.custom ? c.custom.serverName : '') : c.special ? c.hint : c.role ? 'Role' : c.username))));
    suggest.hidden = !sugg.items.length;
  };
  const checkSuggest = () => {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const slashIn = slashChannel();
    const sm = slashIn && /^\/([a-z0-9_-]{0,32})$/i.exec(before);
    if (sm) {
      const list = SLASH.cached(slashIn);
      if (!list) { SLASH.load(slashIn).then(() => { if (ta.value.startsWith('/')) { checkSuggest(); renderCmdBar(); } }); return closeSuggest(); }
      const items = list.filter((c) => c.name.startsWith(sm[1].toLowerCase())).slice(0, 8).map((c) => ({ cmd: c }));
      sugg = { items, i: 0, start: 0, kind: 'cmd' };
      return drawSuggest();
    }
    const em = before.match(/(^|\s):([A-Za-z0-9_]{2,32})$/);
    if (em) {
      const q = em[2].toLowerCase();
      const custom = allEmojis().filter((e) => e.name.toLowerCase().includes(q)).slice(0, 6).map((e) => ({ emoji: true, custom: e, name: e.name }));
      const std = searchEmoji(q).slice(0, 8 - custom.length).map((e) => ({ emoji: e, name: (EMOJI_NAMES.get(e) || q).split(' ')[0] }));
      sugg = { items: [...custom, ...std], i: 0, start: pos - em[2].length - 1, kind: 'emoji' };
      return drawSuggest();
    }
    // #channel: this server's text and voice channels (in a server only; a space after a lone # is a heading).
    const cm = before.match(/(^|\s)#([\w-]{0,32})$/);
    const csv = cm && suggServer();
    if (csv && !isGroup(csv)) {
      const q = cm[2].toLowerCase();
      const all = orderedChannels(csv).filter((c) => c.type === 'text' || c.type === 'voice');
      const items = [...all.filter((c) => c.name.toLowerCase().startsWith(q)), ...all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))]
        .slice(0, 8).map((c) => ({ chan: c }));
      sugg = { items, i: 0, start: pos - cm[2].length - 1, kind: 'channel' };
      return drawSuggest();
    }
    const m = before.match(/(^|\s)@([\w.]{0,24})$/);
    if (!m) return closeSuggest();
    const q = m[2].toLowerCase();
    const sv = suggServer();
    const items = candidates().filter((c) => (c.special ? c.special.startsWith(q) : c.role ? c.role.name.toLowerCase().includes(q)
      : (c.username.toLowerCase().startsWith(q) || nameMatches(c, q, sv)))).slice(0, 8);
    sugg = { items, i: 0, start: pos - m[2].length - 1, kind: 'at' };
    drawSuggest();
  };
  const pick = (i) => {
    const c = sugg.items[i];
    if (!c) return;
    if (c.cmd) {
      ta.value = `/${c.cmd.name} ` + ta.value.slice(ta.selectionStart).trimStart();
      const at = c.cmd.name.length + 2;
      ta.setSelectionRange(at, at);
      keepDraft(); closeSuggest(); update(); renderCmdBar(); ta.focus();
      return;
    }
    const insert = c.chan ? `<#${c.chan.id}>` : c.emoji ? (c.custom ? emojiToken(c.custom) : c.emoji) : c.role ? `<@&${c.role.id}>` : '@' + (c.special || c.username);
    if (c.emoji) pushRecentEmoji(c.custom ? emojiToken(c.custom) : c.emoji);
    ta.value = ta.value.slice(0, sugg.start) + insert + ' ' + ta.value.slice(ta.selectionStart);
    const at = sugg.start + insert.length + 1;
    ta.setSelectionRange(at, at);
    keepDraft(); closeSuggest(); update(); ta.focus();
  };

  // ---- link previews
  // A link in the box can carry a preview card. Asking for one sends the link to this server (which fetches the
  // page), so by default the app only offers it ("Preview example.org?") and nothing leaves the device until the
  // person says so. The card then goes inside the encrypted message; people reading it never contact the site.
  const linkBox = h('div', { class: 'link-chip-wrap', role: 'status', 'aria-live': 'polite' });
  const linkDismissed = new Set(); // links the person said no to, until the message is sent
  let linkGen = 0; // bumps whenever an answer on its way would be out of date
  let linkHide = 0;
  const convKey = () => key() + (threadId() || '');
  const linkMode = () => { const v = P.chat.linkPreviews; return v === 'always' || v === 'never' ? v : 'ask'; };
  const previewOpts = () => ({ origin: location.host, anyPort: !!S.config.linkPreviewAnyPort });
  const linksAllowedHere = () => {
    if ((S.config.features || {}).linkPreviews === false || linkMode() === 'never') return false;
    const kk = key();
    if (!kk) return false;
    if (!kk.startsWith('c:')) return true;
    // This channel's permission, and the server-wide one readers check (senderMayEmbed): with only the first
    // (a channel override allowing it), the page would be fetched for a card nobody, you included, would see.
    const ch = channelById(kk.slice(2));
    return !!ch && canIn(ch, PERMS.EMBED_LINKS) && mayEmbed(serverOfChannel(ch.id), S.me.id);
  };
  const setLink = (v) => { clearTimeout(linkHide); state.link = v; renderExtras(); };
  // Looks for a link to offer a preview for. Never on its own when a draft is put back: only typing or pasting.
  function checkLink() {
    const sc = slashChannel();
    const url = linksAllowedHere() && !(sc && SLASH.match(sc, ta.value)) ? findPreviewUrl(ta.value, previewOpts()) : null;
    if (!url || linkDismissed.has(url)) { if (state.link) { linkGen++; setLink(null); } return; }
    if (state.link && state.link.url === url && state.link.key === convKey()) return;
    linkGen++;
    if (linkMode() === 'always' && !looksPrivate(url)) return requestPreview(url);
    setLink({ key: convKey(), url, status: linkMode() === 'always' ? 'private' : 'ask' });
  }
  // While typing, a link counts once a space follows it and the caret has left it (or after a pause), so
  // half-typed links aren't offered (or, in "Always" mode, fetched). Editing inside a link counts as typing
  // it: each Backspace in "…/story-one please" makes a new link, and none of them may be fetched until the pause.
  // A composer that has left the page (its thread was closed or another one opened) has nothing to check any more.
  const checkLinkSoon = debounce(() => { if (el.isConnected) checkLink(); }, 1200);
  function onTypeForLink() {
    const url = findPreviewUrl(ta.value, previewOpts());
    // The link with a chip changed or went: the chip goes now (and any answer on its way is ignored).
    if (state.link && state.link.url !== url) { linkGen++; setLink(null); }
    const at = url ? ta.value.indexOf(url) : -1;
    const inLink = at >= 0 && ta.selectionEnd >= at && ta.selectionEnd <= at + url.length;
    if (at >= 0 && !inLink && /\s/.test(ta.value[at + url.length] || '')) checkLink(); else checkLinkSoon();
  }
  async function requestPreview(url) {
    const gen = ++linkGen;
    const k0 = convKey();
    setLink({ key: k0, url, status: 'loading' });
    const stale = () => gen !== linkGen || !state.link || state.link.url !== url || convKey() !== k0;
    let next;
    try {
      const r = await api('POST', '/link-previews', { url });
      if (stale()) return;
      const p = r && r.preview;
      let img = null;
      if (p && p.image && typeof p.image.data === 'string') img = await previewThumb(E2EE.unb64(p.image.data), p.image.type).catch(() => null);
      if (stale()) return;
      const entry = p && { v: 1, url, title: cleanPreviewText(p.title, TITLE_MAX), desc: cleanPreviewText(p.description, DESC_MAX), site: cleanPreviewText(p.siteName, SITE_MAX),
        kind: PREVIEW_KINDS.has(p.kind) ? p.kind : 'web', ...(img ? { img } : {}) };
      next = entry && (entry.title || entry.desc || entry.img) ? { key: k0, url, status: 'ready', entry }
        : { key: k0, url, status: 'none', msg: r && r.reason === 'busy' ? 'That site is busy. No preview this time.' : 'No preview for this link.' };
    } catch (e) {
      if (stale()) return;
      next = { key: k0, url, status: 'none', msg: e.status === 429 || e.status === 404 || e.status === 400 ? e.message : 'Couldn’t get a preview.' };
    }
    setLink(next);
    // A "no preview" note goes away by itself; that link isn't offered again until this message is sent.
    if (next.status === 'none') linkHide = setTimeout(() => { if (state.link === next) { linkDismissed.add(url); setLink(null); } }, 4000);
  }
  function dismissLink() {
    if (state.link) linkDismissed.add(state.link.url);
    linkGen++;
    setLink(null);
    ta.focus();
  }
  function drawLinkChip() {
    clear(linkBox);
    const L = state.link;
    linkBox.hidden = !L;
    if (!L) return;
    const host = hostLabel(L.url);
    const x = (label) => ibtn('close', label, dismissLink, { cls: 'sm link-chip-x', attrs: { 'data-act': 'x' } });
    let chip;
    if (L.status === 'ask' || L.status === 'private') {
      chip = h('div', { class: 'link-chip' }, icon('link', 'ic'),
        h('div', { class: 'link-chip-text' },
          L.status === 'ask' ? h('span', null, 'Preview ', h('strong', null, host), '?') : h('span', null, 'This link may be private (a sign-in, share or reset link).'),
          h('span', { class: 'link-chip-hint' }, 'Your Hearth server fetches the page, so it sees this link. People reading don’t contact the site.')),
        h('button', { class: 'btn sm', type: 'button', 'data-act': 'preview', onclick: () => { requestPreview(L.url); ta.focus(); } }, L.status === 'ask' ? 'Preview' : 'Preview anyway'),
        L.status === 'ask' ? h('button', { class: 'btn ghost sm', type: 'button', 'data-act': 'always', 'data-tip': 'Preview links without asking (Settings → Chat)', onclick: () => {
          LS.set('hearth.chat', { ...LS.get('hearth.chat', {}), linkPreviews: 'always' });
          requestPreview(L.url);
          ta.focus();
        } }, 'Always') : null,
        x('No preview for this link'));
    } else if (L.status === 'loading') {
      chip = h('div', { class: 'link-chip' }, h('span', { class: 'spinner sm' }), h('div', { class: 'link-chip-text' }, h('span', null, 'Getting a preview…'), h('span', { class: 'link-chip-hint' }, host)), x('Cancel link preview'));
    } else if (L.status === 'ready') {
      const e = L.entry;
      chip = h('div', { class: 'link-chip ready' },
        e.img ? h('img', { class: 'link-chip-img', src: `data:${e.img.type};base64,${e.img.data}`, alt: '' }) : icon('link', 'ic'),
        h('div', { class: 'link-chip-text' }, h('strong', { class: 'link-chip-title' }, e.title || e.site || host), h('span', { class: 'link-chip-hint' }, `Link preview · ${host}`)),
        x('Remove link preview'));
    } else {
      chip = h('div', { class: 'link-chip muted' }, icon('link', 'ic'), h('div', { class: 'link-chip-text' }, h('span', null, L.msg || 'No preview for this link.')), x('Dismiss'));
    }
    linkBox.append(chip);
  }

  // What's in the box is its draft (kept across channels and reloads), also when it was changed by the app.
  const keepDraft = () => { const k = key(); if (k) { drafts.set(k + (threadId() || ''), ta.value); synced = ta.value; } };
  ta.addEventListener('input', () => {
    autosize(); update(); checkSuggest(); renderCmdBar(); onTypeForLink();
    keepDraft();
    const kk = key();
    const now = Date.now();
    if (ta.value && kk && !threadId() && now - (typingSent.get(kk) || 0) > 3000 && now - typingSentAny > 1000) {
      typingSent.set(kk, now); typingSentAny = now;
      socket.emit('typing', kk.startsWith('c:') ? { channelId: kk.slice(2) } : { dmId: kk.slice(2) });
    }
  });
  ta.addEventListener('keydown', (e) => {
    if (!suggest.hidden && sugg.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sugg.i = (sugg.i + 1) % sugg.items.length; return drawSuggest(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sugg.i = (sugg.i - 1 + sugg.items.length) % sugg.items.length; return drawSuggest(); }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(sugg.i); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeSuggest(); }
    }
    const enterSends = P.chat.enterToSend;
    if (e.key === 'Enter' && ((enterSends && !e.shiftKey) || (!enterSends && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape' && state.replyTo) { e.preventDefault(); e.stopPropagation(); setReply(null); return; }
    if (e.key === 'ArrowUp' && !ta.value && id === 'main') {
      const store = S.msgs[key()];
      const last = store && [...store.list].reverse().find((m) => m.authorId === S.me.id && readable(m));
      if (last) { e.preventDefault(); S.editing = last.id; replaceMessageEl(last); }
    }
  });
  // Leaving the box closes the list a moment later (so a click on an item still lands), unless the person is back in
  // it by then: otherwise coming straight back to type "@" would see the new list vanish under them.
  let blurTimer = null;
  ta.addEventListener('blur', () => { clearTimeout(blurTimer); blurTimer = setTimeout(closeSuggest, 120); });
  ta.addEventListener('focus', () => { clearTimeout(blurTimer); blurTimer = null; });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    // Pasting a link is a fresh "I want this one", even if its preview was turned down before.
    for (const u of linkedUrls(e.clipboardData.getData('text') || '')) linkDismissed.delete(u);
    setTimeout(checkLink, 0);
  });

  function addFiles(list) {
    const mb = S.config.maxUploadMb || 25;
    const max = mb * 1024 * 1024;
    const most = maxFiles();
    for (const f of list) {
      if (state.pending.length >= most) { toast(`You can attach up to ${most} files at once.`, 'error'); break; }
      // A video over the limit (a phone's, usually) is made smaller to fit when it's sent (video-shrink.js).
      const video = mediaKind(f.type || '', f.name) === 'video';
      if (f.size > max && !(video && canShrink())) {
        toast(video ? `${f.name} is ${fmtSize(f.size)}, and files here can be up to ${mb} MB. This browser can\u2019t make videos smaller, so trim it first, or send it from a phone or another browser.`
          : `${f.name} is ${fmtSize(f.size)}, and files here can be up to ${mb} MB.`, 'error');
        continue;
      }
      if (f.size > max && state.pending.filter((x) => x.shrink).length >= MAX_SHRINK) {
        toast(`Up to ${MAX_SHRINK} videos that need making smaller can go in one message. Send ${f.name} in the next one.`, 'error');
        continue;
      }
      const p = { file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null };
      state.pending.push(p);
      if (f.size > max) checkShrink(p, max, mb);
    }
    renderExtras(); update(); ta.focus();
  }
  // Can this video be made small enough? Its length decides: a long one would be mush, so it's turned down now.
  // (The same room as when it's sent: uploadEncryptedFiles.) No picture to read means this browser can't show it.
  async function checkShrink(p, max, mb) {
    p.shrink = 'checking';
    const room = budgetFor(max);
    const info = await probeVideo(p.file);
    const fits = info && shrinkPlan({ ...info, maxBytes: room });
    if (!state.pending.includes(p)) return;
    if (fits) { p.shrink = 'yes'; p.shrinkTo = Math.round((fits.videoBps + fits.audioBps) * info.duration / 8); }
    else {
      state.pending.splice(state.pending.indexOf(p), 1);
      toast(info ? `${p.file.name} is too long to send here, even made smaller: about ${fitsText(longestFitting(room))} of video fits in ${mb} MB. Trim it first.`
        : `${p.file.name} can\u2019t be opened here, so it can\u2019t be made smaller to fit the ${mb} MB limit.`, 'error');
    }
    renderExtras(); update();
  }
  // A file's Edit button: a description (alt text) for pictures and videos, and "Mark as spoiler" for any file.
  // Both go inside the encrypted message with the file (uploadEncryptedFiles), so the server never sees them.
  function editPending(p) {
    const kind = mediaKind(p.file.type || '', p.file.name);
    const describe = kind === 'img' || kind === 'video';
    const alt = h('textarea', { class: 'input', rows: '3', maxlength: String(ALT_MAX), value: p.alt || '',
      placeholder: kind === 'video' ? 'What happens in the video' : 'What’s in the picture' });
    const spoiler = h('input', { type: 'checkbox', checked: !!p.spoiler, 'aria-describedby': 'att-spoiler-hint' });
    // Focus goes back to this file's Edit button, which the tray draws again when something changes.
    const refocus = () => {
      const i = state.pending.indexOf(p);
      const b = i >= 0 && extras.querySelector(`.pending-edit[data-pending="${i}"]`);
      (b || ta).focus({ preventScroll: true });
    };
    modal({
      title: 'Attachment options', size: 'sm', className: 'att-options',
      onClose: () => setTimeout(refocus, 0),
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted-p att-options-name' }, icon('file', 'ic'), p.file.name),
        describe ? field('Description (alt text)', alt, 'Screen readers read it out, and anyone can open it from the ALT button. It’s end-to-end encrypted with the message.') : null,
        h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Mark as spoiler'),
          h('span', { class: 'field-hint', id: 'att-spoiler-hint' }, kind === 'img' || kind === 'video' ? 'People see it blurred until they click it.' : 'People see a spoiler warning on the file.')),
        h('span', { class: 'switch' }, spoiler, h('span', { class: 'switch-track' })))),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', action: () => {
        if (!state.pending.includes(p)) return;
        p.alt = describe ? alt.value.replace(/\s+/g, ' ').trim().slice(0, ALT_MAX) : '';
        p.spoiler = spoiler.checked;
        renderExtras();
      } }],
    });
  }
  function setReply(m) {
    const old = state.replyTo;
    state.replyTo = m;
    renderExtras();
    if (old) replaceMessageEl(old);
    if (m) { replaceMessageEl(m); ta.focus(); }
  }
  // A send that stopped gives its files back (always: the uploads that went up are kept for the next Send, p.sent),
  // and its words unless something new was typed here meanwhile.
  function takeBack({ files, text, link }) {
    if (!ta.value.trim() && !(drafts.get(convId()) || '').trim()) {
      ta.value = text; drafts.set(convId(), text); synced = text; autosize();
      if (link && !state.link) state.link = link; // and its preview
    }
    // All of them, even past what one message takes: Send says so (send()), and nothing is dropped.
    state.pending = [...files.filter((p) => !state.pending.includes(p)), ...state.pending];
    // A video that was still being looked at when it was sent is looked at again.
    const mb = S.config.maxUploadMb || 25;
    for (const p of files) if (p.shrink === 'checking') checkShrink(p, mb * 1024 * 1024, mb);
  }
  function renderExtras() {
    const back = givenBack.get(convId());
    if (back) { givenBack.delete(convId()); takeBack(back); }
    // Keyboard focus on the link chip outlives its redraw (a preview arriving, a note going away): it stays on
    // the same button if there still is one, else it goes back to the box, never to the page.
    const chipFocus = linkBox.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') || '' : null;
    clear(extras);
    if (id === 'main') { const notice = keyNotice(); if (notice) extras.append(notice); }
    if (state.replyTo) {
      const ru = getUser(state.replyTo.authorId);
      const bar = h('div', { class: 'reply-bar' }, icon('reply', 'ic'),
        h('span', { class: 'reply-bar-text' }, 'Replying to ', h('strong', null, nameInMsg(state.replyTo, ru)),
          h('span', { class: 'reply-bar-quote' }, quoteOf(state.replyTo).slice(0, 120))),
        ibtn('close', 'Cancel reply (Esc)', () => setReply(null), { cls: 'sm' }));
      bar._cancel = () => setReply(null); // (Back on a phone: phoneNav)
      extras.append(bar);
    }
    // A preview belongs to the conversation it was made in, and goes when previews stop being allowed here.
    if (state.link && (state.link.key !== convKey() || !linksAllowedHere())) { linkGen++; clearTimeout(linkHide); state.link = null; }
    drawLinkChip();
    extras.append(linkBox);
    if (chipFocus !== null) ((chipFocus && linkBox.querySelector(`[data-act="${chipFocus}"]`)) || ta).focus();
    if (state.pending.length) {
      extras.append(h('div', { class: 'pending-files' }, state.pending.map((p, i) => h('div', { class: `pending${p.spoiler ? ' is-spoiler' : ''}` },
        p.url ? h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async' }) : h('div', { class: 'pending-ic' }, icon('file')),
        p.spoiler || p.alt ? h('span', { class: 'pending-tags' }, p.spoiler ? h('span', { class: 'pending-tag' }, 'SPOILER') : null, p.alt ? h('span', { class: 'pending-tag' }, 'ALT') : null) : null,
        h('span', { class: 'pending-name', title: p.file.name }, p.file.name),
        h('span', { class: 'pending-size' }, p.shrink ? (p.shrinkTo ? `${fmtSize(p.file.size)} \u2192 about ${fmtSize(p.shrinkTo)}` : fmtSize(p.file.size)) : fmtSize(p.file.size)),
        p.shrink ? h('span', { class: 'pending-note' }, p.shrink === 'checking' ? 'Checking the video\u2026' : 'Made smaller when you send it') : null,
        h('button', { class: 'pending-edit', type: 'button', 'aria-label': `Edit ${p.file.name} (description, spoiler)`, 'data-tip': 'Edit', 'data-pending': String(i), onclick: () => editPending(p) }, icon('edit')),
        h('button', { class: 'pending-x', 'aria-label': `Remove ${p.file.name}`, 'data-tip': 'Remove', onclick: () => { if (p.url) URL.revokeObjectURL(p.url); state.pending.splice(i, 1); renderExtras(); update(); } }, icon('close'))))));
    }
    const going = sendingUi.get(convId()) || new Set();
    extras.append(...going, ...(going.has(upStatus) ? [] : [upStatus]));
    const blockedNote = blockedDmNotice();
    const kk = key();
    const ch = kk && kk.startsWith('c:') ? channelById(kk.slice(2)) : null;
    const noSend = ch && !canIn(ch, threadId() ? PERMS.CREATE_THREADS : PERMS.SEND_MESSAGES);
    ta.disabled = !!blockedNote || !!noSend;
    canAttach = !ch || canIn(ch, PERMS.ATTACH_FILES);
    fitAttach();
    laterBtn.hidden = !kk || !!blockedNote || !!noSend;
    // This conversation's scheduled messages (on the main composer only: the list covers its threads too).
    const schedBar = id === 'main' && kk ? SCHED.bar(kk) : null;
    if (schedBar) extras.append(schedBar);
    if (blockedNote) extras.append(blockedNote);
    const to = ch && (serverOfChannel(ch.id) || {}).timeout;
    if (noSend && to && to.until > Date.now()) extras.append(h('div', { class: 'key-bar' }, icon('timer'), h('span', null, `You\u2019re timed out until ${fmtStamp(to.until)}${to.reason ? ` (${to.reason})` : ''}. You can still read.`)));
    else if (noSend) extras.append(h('div', { class: 'key-bar' }, icon('lock'), h('span', null, threadId() ? 'You can read this thread but not reply.' : `You can read ${chanLabel(ch)} but you don\u2019t have permission to send messages here.`)));
    ta.placeholder = noSend ? 'Read only' : placeholder || placeholderFor(kk);
    slowNote.hidden = !(ch && ch.slowmode > 0 && !canIn(ch, PERMS.MANAGE_MESSAGES));
    if (!slowNote.hidden && !slowUntil) slowNote.textContent = `Slowmode is on: one message every ${fmtDuration(ch.slowmode)}`;
    const secs = kk ? convSecs(kk) : 0;
    clear(disNote).hidden = !secs;
    if (secs) disNote.append(icon('timer'), h('span', null, `New messages disappear after ${disLabel(secs).toLowerCase()}.`));
    update();
  }
  // Sending never blocks typing: the box clears at once, the message shows up right away as
  // "sending…", and messages go out one after another in the background (so they stay in order).
  let queue = Promise.resolve();
  // extra: { poll } for a poll, { files } for a voice message; the typed text stays in the box for those.
  // { sendAt } schedules what's in the box for then (Send later) instead of sending it now.
  function send(overrideText, extra = {}) {
    // (Typed: its last word is corrected as it goes, as phones do: spelling.js correctSending.)
    const text = overrideText != null ? overrideText : spelled(ta);
    const files = extra.files || (overrideText != null ? [] : state.pending.slice());
    const poll = extra.poll || null;
    const sendAt = extra.sendAt || null;
    if (!text.trim() && !files.length && !poll) return;
    if (overrideText == null && !extra.files && checking()) { toast('Still checking the video\u2026 It can go in a moment.'); return; }
    // (More than may go: the server was handed to someone else since they were added, or files came back to the box.)
    if (overrideText == null && !extra.files && files.length > maxFiles()) { toast(`You can send up to ${maxFiles()} files in one message. Remove some first.`, 'error'); return; }
    if (overrideText == null && !extra.files && files.filter((p) => p.shrink && !sentFresh(p)).length > MAX_SHRINK) {
      toast(`Up to ${MAX_SHRINK} videos that need making smaller can go in one message. Remove some first.`, 'error');
      return;
    }
    // A bot's slash command goes to the bot (after the warning), not into the channel.
    const slashIn = overrideText == null && !poll && slashChannel();
    const cmd = slashIn && SLASH.match(slashIn, text.trim());
    if (cmd && sendAt) { toast('Bot commands can\u2019t be scheduled. Send it now, or remove the / to schedule it as a message.', 'error'); return; }
    if (cmd) {
      SLASH.run(slashIn, cmd, text.trim(), serverOfChannel(slashIn)).then((sent) => {
        if (!sent || ta.value.trim() !== text.trim()) return;
        ta.value = ''; synced = ''; drafts.delete(key()); autosize(); update(); renderCmdBar();
      });
      return;
    }
    const kk = key();
    const tid = threadId();
    const replyTo = state.replyTo ? state.replyTo.id : null;
    // The link preview goes along only with the typed message, only once it's ready (sending never waits for
    // one), and only if its link is still in the text. GIFs, polls and voice messages never carry one.
    const linkState = overrideText == null ? state.link : null;
    const links = linkState && linkState.status === 'ready' && !poll && !extra.files && linkedUrls(text, { skipSpoilers: true }).includes(linkState.url) ? [linkState.entry] : null;
    // A message going out ends your "typing…" on the others' screens as it arrives, so typing on says so again at once.
    if (!tid && !sendAt) typingSent.delete(kk);
    if (overrideText == null) {
      ta.value = ''; synced = '';
      drafts.delete(kk + (tid || ''));
      state.pending = [];
      linkGen++; clearTimeout(linkHide); state.link = null; linkDismissed.clear();
    }
    const old = state.replyTo;
    state.replyTo = null;
    if (old) replaceMessageEl(old);
    renderExtras(); autosize(); update();
    // A video to make smaller starts in this tap: phones only let it play (to record it smaller) after one.
    for (const p of files) if (p.shrink && !p.session && !sentFresh(p)) p.session = startShrink(p.file);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
    if (id === 'main' && !tid && !sendAt) showPendingSend(kk, nonce, poll ? `\uD83D\uDCCA ${poll.q}` : files.some((f) => f.voice) ? '\uD83C\uDFA4 Voice message' : text, files.some((f) => f.voice) ? 0 : files.length, replyTo);
    // The disappearing timer they wrote it under (the note above the box): a weaker one by the time it goes out asks
    // first. A scheduled message is encrypted now, for the timer in force now, like one sent now.
    const wrote = convSecs(kk);
    queue = queue.then(() => underWay(deliver({ kk, tid, text, files, replyTo, nonce, poll, links, linkState, wrote, sendAt })));
    return queue;
  }
  // Send later: when, from the quick picks or a date and time; then it goes like a send, scheduled.
  function sendLater(anchor) {
    if (sendBtn.disabled) return;
    SCHED.pickTime(anchor, (sendAt) => send(null, { sendAt }));
  }
  async function deliver({ kk, tid, text, files, replyTo, nonce, poll, links, linkState, wrote, sendAt }) {
    const bar = upStatus.querySelector('.bar');
    const totalBytes = files.reduce((a, p) => a + (p.file ? p.file.size : 0), 0);
    let retrying = null;
    let shrunk = false; // a video was made smaller: its size isn't what was picked any more
    const setProgress = (f) => {
      upStatus.hidden = !files.length || f >= 1;
      bar.style.width = Math.round(f * 100) + '%';
      const what = files.length === 1 ? files[0].file.name : `${files.length} files`;
      const stay = files.length > MAX_FILES ? ' (keep Hearth on screen)' : ''; // a big send takes a while (keepAwake)
      if (!retrying) upText.textContent = shrunk ? `Uploading ${what} (${Math.round(f * 100)}%)${stay}` : `Uploading ${what} — ${fmtSize(Math.round(f * totalBytes))} of ${fmtSize(totalBytes)} (${Math.round(f * 100)}%)${stay}`;
    };
    const onStatus = ({ retrying: r, wait, rate, shrinking }) => {
      if (shrinking != null) {
        shrunk = true;
        upStatus.hidden = false;
        bar.style.width = Math.round(shrinking * 100) + '%';
        upText.textContent = `Making the video smaller to send\u2026 ${Math.round(shrinking * 100)}% (keep Hearth on screen)`;
        return;
      }
      retrying = r ? wait : null;
      upStatus.classList.toggle('retrying', !!r);
      if (r) upText.textContent = rate ? `The server takes only so many files at a time: going on in ${Math.max(1, Math.round(wait / 1000))} s… (nothing sent so far is lost)`
        : `Connection lost. Trying again in ${Math.max(1, Math.round(wait / 1000))} s… (nothing sent so far is lost)`;
    };
    const ctl = files.length ? new AbortController() : null;
    uploading = ctl;
    const conv = kk + (tid || '');
    if (files.length) { if (!sendingUi.has(conv)) sendingUi.set(conv, new Set()); sendingUi.get(conv).add(upStatus); }
    const awake = files.length > MAX_FILES ? keepAwake() : null;
    let posting = false;
    try {
      const f = await uploadEncryptedFiles(kk, files, setProgress, { signal: ctl && ctl.signal, onStatus });
      // The server was handed to someone else meanwhile: it would keep only the first 10 of these.
      if (f.length > maxFiles()) throw new Error(`You can send up to ${maxFiles()} files in one message now. They\u2019re back in the box: send them in parts.`);
      posting = true;
      const msg = await sendTo(kk, tid, { t: text, f, ...(poll ? { p: poll } : {}), ...(links ? { l: links } : {}) }, replyTo, nonce, { wrote, sendAt });
      posting = false;
      files.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      if (sendAt) { SCHED.added(msg); toast(`Scheduled for ${SCHED.whenPhrase(msg.sendAt)}.`); return; }
      playSound('sent');
      // Normally the live connection delivers it first; this covers a slow or dropped connection.
      if (msg && msg.id) { if (msg.threadId) onThreadMessage(msg); else onNewMessage(kk, msg); }
      dropPendingSend(nonce);
      const sch = kk.startsWith('c:') ? channelById(kk.slice(2)) : null;
      if (sch && sch.slowmode > 0 && !canIn(sch, PERMS.MANAGE_MESSAGES)) startSlow(sch.slowmode);
    } catch (e) {
      // Videos still waiting to be made smaller let go of what they'd started; sending again starts afresh.
      files.forEach((p) => { if (p.session) { p.session.stop(); p.session = null; } });
      // The message may have got there after all when its answer was lost (the request failed on the way: fetch's
      // TypeError, or the server failing): then sending again uploads the files again, rather than share them with a
      // message that has them (the server links a file to the first message only). Anything refused before or by
      // the server (a changed key, too long, slow mode…) keeps them.
      if (posting && (e instanceof TypeError || e.status >= 500)) files.forEach((p) => { delete p.sent; });
      dropPendingSend(nonce);
      const wait = /in (\d+)s/.exec(e.message || '');
      if (e.code === 'slowmode' && wait) startSlow(+wait[1]);
      if (e.cancelled) toast('Upload cancelled. Your message and files are back in the box.');
      else toast(e.message, 'error');
      // Give the files and words back so nothing is lost: to this box if it still shows the conversation, else to the
      // one that shows it now or next (takeBack, renderExtras).
      if (!poll && !files.some((f) => f.voice)) {
        const prev = givenBack.get(conv); // an earlier send there that stopped too, not picked up yet
        const link = linkState && linkState.status === 'ready' ? linkState : null;
        givenBack.set(conv, prev ? { files: [...prev.files, ...files.filter((p) => !prev.files.includes(p))], text: [prev.text, text].filter((t) => t && t.trim()).join('\n'), link: prev.link || link }
          : { files, text, link });
        const here = ta.isConnected && convId() === conv ? null : Object.values(composers).find((c) => c && c.showing && c.showing() === conv);
        if (here) here.renderExtras();
        else if (ta.isConnected && convId() === conv) { renderExtras(); update(); }
      }
    } finally {
      if (uploading === ctl) uploading = null;
      const going = sendingUi.get(conv);
      if (going) { going.delete(upStatus); if (!going.size) sendingUi.delete(conv); }
      if (awake) awake();
      setProgress(1);
    }
  }
  setTimeout(() => { autosize(); update(); renderEph(); }, 0);
  return { el, state, focus: () => ta.focus(), addFiles, setReply, renderExtras, send, renderEph, fitAttach, showing: () => (ta.isConnected ? convId() : null), keepDraft: () => { if (ta.isConnected && ta.value !== synced) keepDraft(); } };
}
const fmtDuration = (sec) => (sec >= 3600 ? `${Math.round(sec / 3600)}h` : sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`);
function placeholderFor(k) {
  if (!k) return 'Message';
  if (k.startsWith('d:')) { const d = S.dms.find((x) => x.id === k.slice(2)); return d ? `Message ${displayName(getUser(d.userId))}` : 'Message'; }
  const s = serverOfChannel(k.slice(2));
  if (isGroup(s)) return `Message ${groupName(s)}`;
  const c = channelById(k.slice(2));
  return c ? `Message ${chanLabel(c)}` : 'Message';
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart; const e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.setSelectionRange(s + text.length, s + text.length);
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}
// A bar above the composer when we can't encrypt here yet (or shouldn't).
function keyNotice() {
  if (S.view.type === 'dm') {
    const d = S.dms.find((x) => x.id === S.view.dmId);
    const u = d && getUser(d.userId);
    if (u && sec.keyChanged(u)) {
      return h('div', { class: 'key-bar bad' }, icon('shield'),
        h('span', null, `${displayName(u)}'s security key changed. Sending is paused until you verify it.`),
        h('button', { class: 'btn sm ghost', onclick: () => openSafetyNumber(u) }, 'Verify'));
    }
    if (u && resetUnverified(u)) {
      return h('div', { class: 'key-bar' }, icon('shield'),
        h('span', null, `${displayName(u)} reset their password without their recovery key, so their keys are new. Compare safety numbers before you share anything private.`),
        h('button', { class: 'btn sm ghost', onclick: () => openSafetyNumber(u) }, 'Verify'));
    }
    return null;
  }
  if (S.view.type !== 'channel' && !(S.view.type === 'voice' && S.view.chat)) return null;
  // crypto-2: waiting to be verified here yourself, nobody shares this conversation's key with you (a voice channel's
  // chat uses its server's key, so the same there).
  const here = S.servers.find((x) => x.id === S.view.serverId);
  if (here && sec.isHeld(here.id, S.me.id) && !sec.currentKey(here.id) && here.memberIds.some((id) => id !== S.me.id)) {
    return h('div', { class: 'key-bar bad' }, icon('shield'),
      h('span', null, 'You reset your password without your recovery key, so members’ apps share this conversation’s key with you once someone who knew you before verifies you here.'),
      h('button', { class: 'btn sm ghost', onclick: () => openGetVerified() }, 'Ask a member to verify you'));
  }
  const st = sec.stateOf(S.view.serverId);
  if (!st || sec.currentKey(S.view.serverId) || st.needsRotation || !st.keyEpoch) return null;
  // Joined a server where new members can't read what came before (since: where your history starts): the key you
  // get is the next one, which the members' apps make for you; nobody can share you the current one.
  if (st.since && st.since.epoch > st.keyEpoch) {
    return h('div', { class: 'key-bar' }, h('span', { class: 'spinner' }),
      h('span', null, 'Your encryption key is on its way. This server gives new members a fresh key, which can take a few minutes.'));
  }
  return h('div', { class: 'key-bar' }, h('span', { class: 'spinner' }),
    h('span', null, 'Waiting for another member to come online and share this conversation\u2019s encryption key with you.'));
}
function blockedDmNotice() {
  if (S.view.type !== 'dm') return null;
  const d = S.dms.find((x) => x.id === S.view.dmId);
  if (!d || !S.blocked.has(d.userId)) return null;
  return h('div', { class: 'key-bar' }, icon('ban'), h('span', null, `You blocked ${displayName(getUser(d.userId))}.`),
    h('button', { class: 'btn sm ghost', onclick: () => toggleBlock(d.userId, false) }, 'Unblock'));
}

// How many files one message may carry: 10, or 100 for the server's owner (attachments.js, server/index.js maxFilesOf).
const maxFiles = () => maxFilesFor(S.me && S.me.staffRole);
// A file that went up for a message that then couldn't be sent isn't sent again when it's tried again (p.sent): the
// server keeps a file that no message uses for a day (server/index.js uploads.unlinked_cleanup).
const SENT_KEEP_MS = 6 * 3600 * 1000;
const sentFresh = (p) => !!p.sent && p.sent.at > Date.now() - SENT_KEEP_MS;
// Videos made smaller on the device in one message: each plays (into the recording) in its own player, so not too many.
const MAX_SHRINK = 10;
// The sends still going in a conversation (key + thread): their progress bars, with their Cancel, from the boxes that
// started them. A box drawn again meanwhile (another conversation and back, a setting that changed) shows those too.
// And what sends that stopped give back (their files, and words), for the box that shows the conversation.
const sendingUi = new Map();
const givenBack = new Map();
// Keeps a phone's screen on while a long send uploads (a phone puts away an app whose screen goes off, and its uploads
// stop with it). Returns what lets it go.
function keepAwake() {
  if (!navigator.wakeLock) return () => {};
  let lock = null; let done = false;
  const take = () => {
    if (done || lock || document.hidden) return;
    navigator.wakeLock.request('screen').then((l) => {
      if (done) { l.release().catch(() => {}); return; }
      lock = l; l.addEventListener('release', () => { if (lock === l) lock = null; });
    }, () => {});
  };
  const onVisible = () => { if (!document.hidden) take(); };
  document.addEventListener('visibilitychange', onVisible);
  take();
  return () => { done = true; document.removeEventListener('visibilitychange', onVisible); if (lock) lock.release().catch(() => {}); lock = null; };
}

// ---- sending (every file gets its own random key, carried inside the encrypted message)
// Small files go up in one request; bigger ones (CHUNKED_ABOVE) in resumable chunks that survive a dropped
// connection (files.js). onStatus reports "connection lost (or too many at once), retrying"; signal cancels.
// One file at a time: made ready (big photos made smaller, a thumbnail), encrypted and uploaded before the next, so a
// message with many photos never holds them all in memory. Progress counts the files by their size as picked.
async function uploadEncryptedFiles(key, files, onProgress, { signal, onStatus } = {}) {
  if (!files.length) return [];
  if (key.startsWith('c:')) await sec.ready(serverOfChannel(key.slice(2)).id);
  const compress = P.chat.compressImages !== false;
  const total = files.reduce((a, p) => a + (p.file.size || 1), 0);
  // What went up for an earlier try counts as done.
  let done = files.reduce((a, p) => a + (sentFresh(p) ? p.file.size || 1 : 0), 0);
  onProgress(done / total);
  const send = async (blobLike, weight) => {
    if (signal && signal.aborted) throw Object.assign(new Error('Upload cancelled.'), { cancelled: true });
    const { blob, k } = await E2EE.encryptFile(await blobLike.arrayBuffer());
    const progress = (x) => onProgress((done + x * weight) / total);
    const url = blob.byteLength > CHUNKED_ABOVE ? await uploadResumable(blob, { onProgress: progress, onStatus, signal }) : await uploadSimple(blob, { onProgress: progress, onStatus, signal });
    done += weight;
    return { url, k };
  };
  // Set from the file's Edit button in the box (also after a send that failed); like the rest, inside the message.
  const tags = (p) => ({ ...(p.spoiler ? { sp: 1 } : {}), ...(p.alt ? { alt: String(p.alt).slice(0, ALT_MAX) } : {}) });
  // One file: made ready, encrypted and uploaded. What went up is kept for a next try (p.sent).
  const upload = async (p, file) => {
    const weight = p.file.size || 1;
    const r = p.voice ? { file } : await prepareImage(file, { compress });
    const both = r.file.size + (r.thumb ? r.thumb.size : 0) || 1;
    const th = r.thumb ? await send(r.thumb, (weight * r.thumb.size) / both) : null;
    const main = await send(r.file, weight - (th ? (weight * r.thumb.size) / both : 0));
    // (Names and types as long as readers keep them: attachments.js cleanFiles.)
    p.sent = { base: { url: main.url, name: String(r.file.name || '').slice(0, 255), type: String(r.file.type || '').slice(0, 100), size: r.file.size, k: main.k, ...(r.w ? { w: r.w, h: r.h } : {}), ...(th ? { th: { url: th.url, k: th.k } } : {}),
      ...(p.voice ? { voice: true, dur: p.dur } : {}) }, at: Date.now() };
  };
  // Videos over the limit go first, each made smaller (video-shrink.js; started in the tap that sent them) and
  // uploaded before the next: it takes as long as they last, with "keep Hearth on screen" up from the start, their
  // players don't wait behind the rest, and only one smaller copy is in memory at a time.
  for (const p of files) {
    if (!p.session) continue;
    const s = p.session; p.session = null;
    if (sentFresh(p)) { s.stop(); continue; } // made smaller and uploaded already
    await upload(p, await s.run({ maxBytes: budgetFor((S.config.maxUploadMb || 25) * 1024 * 1024), signal, onProgress: (x) => onStatus && onStatus({ shrinking: x }) }));
  }
  for (const p of files) if (!sentFresh(p)) await upload(p, p.file);
  return files.map((p) => ({ ...p.sent.base, ...tags(p) }));
}

function mentionedIds(server, text) {
  const t = String(text || '');
  const names = new Set([...t.matchAll(/(?:^|\s)@([\w.]{2,24})/g)].map((m) => m[1].toLowerCase()));
  const roleIds = new Set([...t.matchAll(/<@&([a-z0-9]{6,40})>/g)].map((m) => m[1]).filter((id) => mayMentionRole(server, id, S.me.id)));
  if (!names.size && !roleIds.size) return [];
  return server.memberIds.filter((id) => id !== S.me.id && (names.has((getUser(id).username || '').toLowerCase())
    || ((server.memberRoles || {})[id] || []).some((r) => roleIds.has(r))));
}

// The longest ciphertext the server takes (validCipher in server/index.js; keep the two the same).
const CIPHER_MAX = 64000;
const OWNER_CIPHER_MAX = 262144; // the owner's messages may carry 100 files (maxFiles)
const cipherMax = () => (S.me && S.me.staffRole === 'owner' ? OWNER_CIPHER_MAX : CIPHER_MAX);
// Encrypts the payload, or if that comes out too long, the same message with less of its link preview: first
// without the picture, then without the card (linkpreview.js payloadVariants). A message too long even then isn't
// sent: it says what to make shorter. Everything else in it (the disappearing timer x among them) stays in every
// variant.
async function encryptFitting(payload, encrypt) {
  let out;
  const variants = payloadVariants(payload);
  // Many long image descriptions on top of a long message can be too much as well: then they're cut short.
  const last = variants[variants.length - 1];
  if (Array.isArray(last.f) && last.f.some((f) => f && typeof f.alt === 'string' && f.alt.length > 200)) {
    variants.push({ ...last, f: last.f.map((f) => (f && typeof f.alt === 'string' ? { ...f, alt: f.alt.slice(0, 200) } : f)) });
  }
  for (const p of variants) {
    out = await encrypt(p);
    if ((typeof out === 'string' ? out : out.ciphertext).length <= cipherMax()) return out;
  }
  const n = Array.isArray(payload.f) ? payload.f.length : 0;
  throw Object.assign(new Error(n > 1 ? `This message is too long to send with ${n} files. Shorten the text, the file descriptions or the file names, or send fewer files at once.`
    : 'This message is too long to send. Shorten it and try again.'), { code: 'too_long' });
}
// Disappearing messages: the conversation's timer goes inside the encrypted message (x, so readers' apps hide it on
// time even if the server doesn't delete it) and alongside it (ttl, so the server stamps the same one). If someone
// changed the timer meanwhile, the server says so (409 disappear_changed): fetch the new one and send again, once.
// wrote: the timer in force when they wrote it (pressed Send). Turned off or made longer since, the message isn't
// sent unless they say so: they wrote it expecting it to disappear.
// sendAt (ms): schedule it for then instead (server/scheduled.js); the answer is the scheduled message. It's encrypted
// now for the timer in force now, like a message sent now; the server gives it its deadline when it's posted.
async function sendTo(key, threadId, payload, replyTo, nonce, { wrote = convSecs(key), sendAt = null } = {}) {
  const agreed = await stillSend(key, wrote);
  try { return await sendOnce(key, threadId, payload, replyTo, nonce, sendAt); } catch (e) {
    if (!(e.status === 409 && e.code === 'disappear_changed')) throw e;
    await refreshTimer(key);
    await stillSend(key, agreed);
    return sendOnce(key, threadId, payload, replyTo, nonce, sendAt);
  }
}
// Asks when the timer got weaker than the one a message was written under. Returns the timer they've now agreed to;
// throws (not sent) when they'd rather not.
async function stillSend(key, wrote) {
  const now = convSecs(key);
  if (!weakerTimer(wrote, now)) return wrote;
  const where = convTitle(key);
  const yes = await confirmDialog(now ? {
    title: 'Disappearing messages changed',
    text: `Disappearing messages in ${where} were changed to ${disLabel(now).toLowerCase()} after you wrote your message. Send it anyway? It will disappear after ${disLabel(now).toLowerCase()} instead of ${disLabel(wrote).toLowerCase()}.`,
    confirm: 'Send anyway',
  } : {
    title: 'Disappearing messages turned off',
    text: `Disappearing messages were turned off in ${where} after you wrote your message. Send it anyway? It won’t disappear.`,
    confirm: 'Send anyway',
  });
  if (!yes) throw Object.assign(new Error('Not sent: disappearing messages changed here.'), { code: 'disappear_weaker' });
  return now;
}
// The encrypted message for a conversation, as it goes to the server: { ciphertext, epoch, mentions, everyone, ttl }
// for a channel (with its current key), { ciphertext, ttl } for a DM. Sending, scheduling and re-encrypting a
// scheduled message all use it, so a scheduled message is exactly what sending it now would have sent: the text,
// files, poll and link preview card, and the conversation's disappearing timer as it is now (x inside, ttl beside).
// keep: { ref, threadId, x?, sid? } for a scheduled message: then `draft` comes too, your own copy of what was
// encrypted (the version that fitted), which only your keys open (sealDraft). keep.x is the timer it was written for,
// when it's being re-encrypted: x inside is then the stricter of that and the conversation's timer now (ttl still says
// the conversation's, which the server checks; it keeps the same stricter one), so a timer turned off or made longer
// since never makes it last longer than its sender wrote it for. keep.sid: the scheduled message's id, put inside
// your copy only (never inside the message), so your apps know the copy belongs to that one (scheduled.js). Never
// anything readable: all of this goes to the server.
async function sealFor(key, payload0, keep = null) {
  const ttl = convSecs(key);
  const secs = keep && Number.isInteger(keep.x) && keep.x > 0 ? stricterTimer(keep.x, ttl) : ttl;
  const { x, ...rest } = payload0;
  const payload = secs ? { ...rest, x: secs } : rest;
  let fitted = payload; // encryptFitting tries smaller versions in turn and keeps the first that fits: the last one tried
  const out = { ttl };
  if (key.startsWith('c:')) {
    const channelId = key.slice(2);
    const server = serverOfChannel(channelId);
    if (!server) throw new Error('Channel not found.');
    const { ciphertext, epoch } = await encryptFitting(payload, (p) => { fitted = p; return sec.encryptChannel(server.id, channelId, p); });
    // @everyone / @here: the server checks the sender may use it, then counts and pushes it as a ping. Said either
    // way, so new words for a scheduled message that drop it ping nobody.
    const everyone = !isGroup(server) && /(^|\s)@(everyone|channel|here)\b/i.test(String(payload.t || ''));
    Object.assign(out, { ciphertext, epoch, mentions: mentionedIds(server, payload.t), everyone });
  } else out.ciphertext = await encryptFitting(payload, (p) => { fitted = p; return sec.encryptDm(key.slice(2), p); });
  if (keep) out.draft = await sealDraft(keep.ref, key, keep.threadId, keep.sid ? { ...fitted, sid: keep.sid } : fitted);
  return out;
}
// A scheduled message's own copy for its sender (server/scheduled.js): sealed with your personal vault key, which only
// your identity key derives, and bound to its ref, conversation and thread. Your app re-encrypts a scheduled message
// only from this copy, so the server (or a stolen session) can't get it to re-sign something you didn't schedule there.
const draftId = (ref, key, threadId) => `${ref}|${key}|${threadId || ''}`;
const sealDraft = async (ref, key, threadId, payload) => E2EE.sealVault(await myVaultKey(), 'scheduled', draftId(ref, key, threadId), payload);
const openDraft = async (ref, key, threadId, text) => E2EE.openVault(await myVaultKey(), 'scheduled', draftId(ref, key, threadId), text);
async function sendOnce(key, threadId, payload0, replyTo, nonce, sendAt = null) {
  // Where it belongs goes inside it (binding.js): a new id, what it replies to, its thread and when it's sent, or for
  // a scheduled one, when it's due. A forward comes through here too, so it's a new message with a new id.
  const payload = { ...payload0, ...bindNew({ replyTo, threadId, at: sendAt || nowServer(), scheduled: !!sendAt }) };
  const files = (payload.f || []).flatMap((x) => [x.url, x.th && x.th.url]).filter(Boolean);
  const where = key.startsWith('c:') ? `/channels/${key.slice(2)}` : `/dms/${key.slice(2)}`;
  // A comment on one photo (photo-notes.js) says which one inside it (ph); the server is told the index beside it
  // (replyFile), only so it can count each photo's comments.
  const photo = replyTo && payload.ph ? { replyFile: payload.ph.i } : {};
  // A scheduled one gets an id of this app's choosing for its own copy (sealFor's keep).
  const ref = sendAt ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('') : null;
  if (key.startsWith('c:')) {
    const server = serverOfChannel(key.slice(2));
    if (!server) throw new Error('Channel not found.');
    return withKeyRetry(server.id, async () => {
      const sealed = await sealFor(key, payload, sendAt ? { ref, threadId } : null);
      return sendAt ? bindScheduled(await api('POST', `${where}/scheduled-messages`, { ...sealed, ref, replyTo, ...photo, threadId, files, sendAt }), sealed, key, ref, threadId)
        : api('POST', `${where}/messages`, { ...sealed, replyTo, ...photo, threadId, files, nonce });
    });
  }
  const sealed = await sealFor(key, payload, sendAt ? { ref, threadId: null } : null);
  return sendAt ? bindScheduled(await api('POST', `${where}/scheduled-messages`, { ...sealed, ref, replyTo, ...photo, files, sendAt }), sealed, key, ref, null)
    : api('POST', `${where}/messages`, { ...sealed, replyTo, ...photo, files, nonce });
}
// A scheduled message's own copy can't name it when it's made (the server picks its id), so as soon as the server
// answers, the copy is sealed again naming it (sid) and goes back with the very same ciphertext. From then on any of
// your apps re-encrypts it by itself after a key change, while a copy a stolen session puts back in another scheduled
// message (after you sent or cancelled this one) never is (scheduled.js). If this doesn't go through, this device
// still re-encrypts it by itself: it knows it made it.
async function bindScheduled(item, sealed, key, ref, threadId) {
  if (!item || !item.id) return item;
  try {
    const copy = await openDraft(ref, key, threadId, sealed.draft);
    const draft = await sealDraft(ref, key, threadId, { ...copy, sid: item.id });
    return await api('PATCH', `/scheduled-messages/${item.id}`, { ...sealed, draft });
  } catch { return item; }
}
// "Sending…" copies of your own messages, shown until the real one arrives.
const pendingSends = new Map(); // nonce -> { key, text, files, replyTo, el }
function pendingEl(p) {
  const prevList = (S.msgs[p.key] || { list: [] }).list;
  const fake = { id: 'pending-' + p.nonce, authorId: S.me.id, createdAt: Date.now(), dec: { t: p.text, f: [] }, reactions: [], replyTo: null };
  let el;
  try { el = messageEl(fake, prevList[prevList.length - 1] || null, 'main'); } catch { el = h('div', { class: 'msg' }, h('div', { class: 'msg-gutter' }), h('div', { class: 'msg-body' }, p.text)); }
  el.classList.add('sending');
  el.removeAttribute('data-mid');
  el.oncontextmenu = null;
  if (p.files) el.append(h('div', { class: 'sending-note' }, `Uploading ${p.files} file${p.files === 1 ? '' : 's'}\u2026`));
  return el;
}
function showPendingSend(key, nonce, text, files, replyTo) {
  const p = { key, nonce, text, files, replyTo };
  pendingSends.set(nonce, p);
  const sc = $('#messages');
  if (sc && currentKey() === key) { p.el = pendingEl(p); sc.append(p.el); toNewest(sc); }
}
function dropPendingSend(nonce) {
  const p = pendingSends.get(nonce);
  if (!p) return;
  pendingSends.delete(nonce);
  if (p.el) p.el.remove();
}
function redrawPendingSends(key) {
  const sc = $('#messages');
  if (!sc) return;
  for (const p of pendingSends.values()) if (p.key === key) { p.el = pendingEl(p); sc.append(p.el); }
}

// ======================================================================= emoji + GIF pickers
function emojiPicker(anchor, onPick, { keepOpen = false } = {}) {
  popover(anchor, emojiPanel(onPick, { keepOpen }), { side: 'top', align: 'end' });
}
// The emoji grid on its own, so it can also live in the GIF picker's "Emoji" tab.
function emojiPanel(onPick, { keepOpen = false } = {}) {
  const search = h('input', { class: 'input emoji-search', placeholder: 'Search emoji', 'aria-label': 'Search emoji' });
  const grid = h('div', { class: 'emoji-grid', role: 'listbox' });
  // The category buttons jump within one scrolling grid, so they're a toolbar rather than tabs.
  const tabs = h('div', { class: 'emoji-tabs', role: 'toolbar', 'aria-label': 'Emoji categories' });
  const preview = h('div', { class: 'emoji-preview' });
  const custom = allEmojis();
  // Custom emoji from every server you're in can be used anywhere.
  const serverSections = S.servers.filter((sv) => (sv.emojis || []).length).map((sv) => [sv.name, sv.emojis.map((e) => ({ ...e, serverName: sv.name })), sv]);
  const sections = [['Frequently used', recentEmoji()], ...serverSections, ...Object.entries(EMOJI)].filter(([, l]) => l.length);
  const pick = (val) => { pushRecentEmoji(val); onPick(val); if (!keepOpen) closePopover(); };
  const btn = (e) => {
    const isCustom = typeof e === 'object';
    const token = isCustom ? emojiToken(e) : e;
    const node = isCustom ? h('img', { class: 'cemoji', src: e.url, alt: `:${e.name}:`, loading: 'lazy' }) : (token.startsWith('<') ? emojiNode(token) : token);
    const label = isCustom ? `:${e.name}:` : token.startsWith('<') ? token.replace(/^<a?(:[^:]+:).*$/, '$1') : (EMOJI_NAMES.get(e) || '').split(' ')[0];
    return h('button', {
      class: 'emoji-btn', role: 'option', 'aria-label': label, onclick: () => pick(token),
      onmouseenter: () => { clear(preview).append(h('span', { class: 'ep-big' }, isCustom ? h('img', { class: 'cemoji', src: e.url, alt: '' }) : node.cloneNode ? node.cloneNode(true) : node), h('span', null, label), isCustom ? h('span', { class: 'ep-src' }, e.serverName) : ''); },
    }, node);
  };
  const slug = (n) => 'ecat-' + n.replace(/[^A-Za-z0-9]/g, '');
  const drawAll = () => {
    clear(grid);
    sections.forEach(([name, list]) => grid.append(h('div', { class: 'emoji-cat', id: slug(name) }, name), ...list.map(btn)));
  };
  sections.forEach(([name, , sv]) => tabs.append(h('button', {
    class: 'emoji-tab', 'data-tip': name, 'aria-label': name,
    onclick: () => { search.value = ''; drawAll(); const t = grid.querySelector('#' + slug(name)); if (t) grid.scrollTop = t.offsetTop - grid.offsetTop; },
  }, name === 'Frequently used' ? icon('star') : sv ? (sv.icon ? h('img', { class: 'emoji-tab-img', src: sv.icon, alt: '' }) : h('span', { class: 'emoji-tab-txt' }, sv.name.slice(0, 2))) : CATEGORY_ICONS[name])));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return drawAll();
    clear(grid);
    const r = [...custom.filter((e) => e.name.toLowerCase().includes(q)), ...searchEmoji(q)];
    if (!r.length) grid.append(h('p', { class: 'muted-p' }, 'No emoji found.'));
    r.forEach((e) => grid.append(btn(e)));
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = grid.querySelector('.emoji-btn'); if (first) first.click(); } });
  drawAll();
  setTimeout(() => search.focus(), 20);
  return h('div', { class: 'emoji-picker' }, h('div', { class: 'emoji-top' }, search), tabs, grid, preview);
}

// GIF picker, laid out like Discord's: GIFs / Stickers / Emoji tabs; a home screen of big tiles (Favorites,
// Trending, this server's own GIFs, then categories); a back arrow out of any category or search; and results in a
// masonry of two columns that stay put while more load in as you scroll. Also used for "emoji from GIPHY".
const GIF_FAVS = 'hearth.gifFavs';
const gifFavs = () => LS.get(GIF_FAVS, []);
function gifPanel({ onPick, startTab = 'gifs', height = 440, onEmoji = null } = {}) {
  const libOnly = !!S.config.gifLibraryOnly;
  let tab = startTab === 'stickers' ? 'stickers' : startTab === 'emoji' && onEmoji ? 'emoji' : 'gifs';
  let view = startTab === 'favs' ? 'favs' : 'home'; // home | search | trending | library | favs
  let q = '';
  let next = null;
  let loading = false;
  let reqId = 0;
  let lib = null; // { canAdd, count }
  let cols = [];
  const provName = S.config.gifProvider === 'giphy' ? 'GIPHY' : 'KLIPY';
  const tabsEl = h('div', { class: 'xp-tabs', role: 'tablist' });
  const back = h('button', { class: 'xp-back', 'aria-label': 'Back', 'data-tip': 'Back', onclick: () => goHome() }, icon('chevronLeft'));
  const title = h('span', { class: 'xp-title' });
  const input = h('input', { class: 'xp-input', 'aria-label': 'Search GIFs', autocomplete: 'off', spellcheck: 'false' });
  const clearBtn = h('button', { class: 'xp-clear', 'aria-label': 'Clear search', onclick: () => { input.value = ''; q = ''; goHome(); input.focus(); } }, icon('close'));
  const bar = h('div', { class: 'xp-bar' }, back, title, input, h('span', { class: 'xp-search-ic' }, icon('search')), clearBtn);
  const notice = h('div', { class: 'gif-notice', hidden: true });
  const scroller = h('div', { class: 'xp-scroll', role: 'listbox' });
  const credit = h('div', { class: 'gif-credit' });
  const body = h('div', { class: 'xp-body' }, bar, notice, scroller, credit);
  const root = h('div', { class: 'gif-picker xp', style: { height: height + 'px' } }, tabsEl, body);

  const sticker = () => tab === 'stickers';
  const source = () => (view === 'library' || libOnly ? '&source=library' : '');
  // Picking a GIF: library GIFs are sent as a link to this server; the server also counts what's popular.
  const pick = (g) => {
    const out = g.library ? { ...g, url: location.origin + g.url } : g;
    api('POST', '/gifs/used', { id: g.id, url: g.url, title: g.title, query: q, sticker: sticker() }).catch(() => {});
    onPick(out);
  };
  const tile = (g) => {
    const fav = gifFavs().some((x) => x.id === g.id);
    return h('div', { class: 'gif-btn', role: 'option', tabindex: '0', 'aria-label': g.title || 'GIF', title: g.title || '',
      onclick: () => pick(g), onkeydown: (e) => { if (e.key === 'Enter') pick(g); } },
    h('img', { src: mediaUrl(g.preview), alt: '', loading: 'lazy', style: sticker() ? null : { aspectRatio: `${g.width || 1} / ${g.height || 1}` } }),
    h('button', { class: `gif-fav${fav ? ' on' : ''}`, 'aria-label': fav ? 'Remove from favorites' : 'Add to favorites', 'data-tip': fav ? 'Unfavorite' : 'Favorite',
      onclick: (e) => {
        e.stopPropagation();
        const list = gifFavs();
        const has = list.some((x) => x.id === g.id);
        LS.set(GIF_FAVS, has ? list.filter((x) => x.id !== g.id) : [{ ...g, sticker: sticker() }, ...list].slice(0, 200));
        e.currentTarget.classList.toggle('on', !has);
        if (view === 'favs' && has) e.currentTarget.closest('.gif-btn').remove();
      } }, icon('star')),
    g.library && S.me.staffRole ? h('button', { class: 'gif-del', 'aria-label': 'Remove from library', 'data-tip': 'Remove from library', onclick: async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog({ title: 'Remove this GIF from the library?', confirm: 'Remove', danger: true }))) return;
      await api('DELETE', `/gifs/library/${g.id}`).catch((x) => toast(x.message, 'error'));
      e.target.closest('.gif-btn').remove();
    } }, icon('close')) : null);
  };
  // Masonry: each GIF goes into the shortest column, so nothing jumps when more arrive.
  const startMasonry = () => {
    const n = sticker() ? 3 : 2;
    cols = Array.from({ length: n }, () => ({ el: h('div', { class: 'gif-col' }), h: 0 }));
    scroller.append(h('div', { class: `gif-masonry${sticker() ? ' stickers' : ''}` }, cols.map((c) => c.el)));
  };
  const place = (g) => {
    const c = cols.reduce((a, b2) => (b2.h < a.h ? b2 : a));
    c.el.append(tile(g));
    c.h += sticker() ? 1 : (g.height || 1) / (g.width || 1) + 0.04;
  };
  const empty = (msg, ...extra) => scroller.append(h('div', { class: 'gif-empty' }, h('p', null, msg), ...extra));
  const spinner = () => scroller.append(h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' })));
  const showError = (msg) => {
    clear(scroller);
    empty(msg, S.me && S.me.instanceAdmin && /set up|key/i.test(msg) ? h('button', { class: 'btn primary sm', onclick: () => { closePopover(); openSettings(app, 'instance'); } }, 'Set up GIF search') : null);
  };
  // Add a GIF to this server's library (title + words people will search for).
  const addGif = () => {
    const fileIn = h('input', { type: 'file', accept: 'image/gif,image/webp,image/png', hidden: true });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) return toast('GIFs for the library can be up to 8 MB.', 'error');
      const titleIn = h('input', { class: 'input', maxlength: '120', placeholder: 'e.g. cat falling off couch', value: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
      const tags = h('input', { class: 'input', maxlength: '200', placeholder: 'funny, cat, fail' });
      const stk = h('input', { type: 'checkbox' });
      closePopover();
      modal({ title: 'Add to this server’s GIFs', size: 'sm',
        body: h('div', { class: 'stack' }, field('Name', titleIn), field('Search words', tags, 'Words people might type to find it.'), h('label', { class: 'row gap' }, stk, 'It’s a sticker (transparent background)')),
        actions: [{ label: 'Cancel' }, { label: 'Add GIF', kind: 'primary', action: async () => {
          const fd = new FormData(); fd.append('file', f, f.name); fd.append('title', titleIn.value); fd.append('tags', tags.value); fd.append('sticker', String(stk.checked));
          await upload('/gifs/library', fd); toast('Added. Everyone on this server can use it now.');
        } }] });
    });
    fileIn.click();
  };

  // ---- results: search, trending, this server's library (infinite scroll)
  const load = async (more = false) => {
    if (loading || (more && next == null)) return;
    loading = true;
    const id = ++reqId;
    if (!more) { clear(scroller); spinner(); }
    try {
      const res = await api('GET', `/gifs?type=${sticker() ? 'stickers' : 'gifs'}&q=${encodeURIComponent(q)}&offset=${more ? encodeURIComponent(next) : ''}${source()}`);
      if (id !== reqId) return;
      if (!more) { clear(scroller); startMasonry(); }
      notice.hidden = !res.limited && !res.stale;
      notice.textContent = res.limited ? `${provName}’s limit was reached for now, so these come from this server’s own GIFs.` : res.stale ? 'Showing saved results while GIF search catches its breath.' : '';
      res.items.forEach(place);
      next = res.nextOffset;
      if (!more && !res.items.length) {
        clear(scroller);
        empty(res.library ? (q ? 'No GIFs here match that yet.' : 'This server has no GIFs of its own yet.') : 'No results. Try another word.',
          res.library && lib && lib.canAdd ? h('button', { class: 'btn primary sm', onclick: addGif }, '+ Add a GIF') : null);
      }
    } catch (e) { if (id === reqId) showError(e.message); } finally { loading = false; }
    // Short first page on a tall picker: keep filling until it scrolls.
    if (id === reqId && next != null && scroller.scrollHeight <= scroller.clientHeight + 50) load(true);
  };

  // ---- home: big tiles, like Discord
  const bigTile = (label, onclick, { img = '', ic = null, cls = '' } = {}) => {
    const t = h('button', { class: `gif-cat ${cls}`, onclick }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : null, h('span', { class: 'gif-cat-label' }, ic, h('b', null, label)));
    return t;
  };
  const home = async () => {
    const id = ++reqId;
    clear(scroller);
    const grid = h('div', { class: 'gif-home' });
    scroller.append(grid);
    const favs = gifFavs();
    grid.append(bigTile('Favorites', () => go('favs'), { img: favs[0] ? mediaUrl(favs[0].preview) : '', ic: icon('star'), cls: 'fav-tile' }));
    const trend = bigTile(libOnly ? 'Most used' : 'Trending GIFs', () => go('trending'), { ic: icon('flame'), cls: 'trend-tile' });
    grid.append(trend);
    if (!libOnly && lib) grid.append(bigTile(`${S.config.name}’s GIFs`, () => go('library'), { ic: icon('home'), cls: 'lib-tile' }));
    // A moving picture behind "Trending", from the first trending GIF (the server caches it).
    api('GET', `/gifs?type=gifs&q=&offset=${libOnly ? '&source=library' : ''}`).then((r) => {
      const g = r.items && r.items[0];
      if (g && id === reqId) trend.prepend(h('img', { src: mediaUrl(g.preview), alt: '', loading: 'lazy' }));
    }).catch(() => {});
    try {
      const cats = await api('GET', `/gifs/categories${libOnly ? '?source=library' : ''}`);
      if (id !== reqId) return;
      cats.forEach((c) => grid.append(bigTile(c.name, () => { input.value = c.name; q = c.name; go('search'); }, { img: c.preview ? mediaUrl(c.preview) : '' })));
    } catch (e) {
      if (id !== reqId) return;
      if (!/limit/i.test(e.message)) scroller.append(h('div', { class: 'gif-empty' }, h('p', null, e.message),
        S.me && S.me.instanceAdmin && /set up|key/i.test(e.message) ? h('button', { class: 'btn primary sm', onclick: () => { closePopover(); openSettings(app, 'instance'); } }, 'Set up GIF search') : null));
    }
  };
  const favsView = () => {
    reqId++;
    clear(scroller);
    const list = gifFavs();
    if (!list.length) return empty('You haven’t favorited any GIFs yet. Hover over one and click the star.');
    startMasonry();
    list.forEach(place);
  };

  // ---- the top bar and tabs
  const drawTabs = () => {
    clear(tabsEl);
    [['gifs', 'GIFs'], ['stickers', 'Stickers'], ...(onEmoji ? [['emoji', 'Emoji']] : [])].forEach(([k, l]) => tabsEl.append(h('button', {
      class: `xp-tab${tab === k ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === k),
      onclick: () => { if (tab === k) return; tab = k; q = ''; input.value = ''; view = 'home'; render(); },
    }, l)));
  };
  const drawBar = () => {
    const titled = view === 'favs' || view === 'trending';
    back.hidden = view === 'home' || (sticker() && view === 'search' && !q);
    title.hidden = !titled;
    title.textContent = view === 'favs' ? 'Favorites' : view === 'trending' ? (libOnly ? 'Most used' : 'Trending GIFs') : '';
    input.hidden = titled;
    clearBtn.hidden = titled || !input.value;
    input.placeholder = sticker() ? `Search ${provName} stickers` : view === 'library' || libOnly ? `Search ${S.config.name}’s GIFs` : `Search ${provName}`;
    clear(credit).append(view === 'library' || libOnly ? h('span', null, 'This server’s own GIFs: free, no limits') : h('span', null, `Powered by ${provName}`));
    if ((view === 'library' || libOnly) && lib && lib.canAdd) credit.append(h('button', { class: 'link-btn', onclick: addGif }, '+ Add a GIF'));
  };
  const go = (v) => { view = v; render(); scroller.scrollTop = 0; };
  const goHome = () => { q = ''; input.value = ''; view = sticker() ? 'search' : 'home'; render(); };
  function render() {
    drawTabs();
    if (tab === 'emoji') {
      reqId++;
      root.classList.add('emoji-mode');
      clear(body).append(emojiPanel(onEmoji, { keepOpen: true }));
      return;
    }
    root.classList.remove('emoji-mode');
    if (!body.contains(bar)) clear(body).append(bar, notice, scroller, credit);
    if (sticker() && view === 'home') view = 'search'; // stickers open straight on trending stickers
    notice.hidden = true;
    drawBar();
    if (view === 'favs') return favsView();
    if (view === 'home') return home();
    load();
  }
  input.addEventListener('input', debounce(() => {
    q = input.value.trim();
    clearBtn.hidden = !input.value;
    if (view === 'library') return render();
    view = q || sticker() ? 'search' : 'home';
    render();
  }, 300));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = scroller.querySelector('.gif-btn'); if (first) first.click(); }
    if (e.key === 'Backspace' && !input.value && view !== 'home') goHome();
  });
  scroller.addEventListener('scroll', () => { if (view !== 'home' && view !== 'favs' && scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 400) load(true); });
  api('GET', '/gifs/library').then((x) => { lib = x; render(); }).catch(() => render());
  setTimeout(() => input.focus(), 30);
  return root;
}
function gifPicker(anchor, onPick, { onEmoji = null } = {}) {
  popover(anchor, gifPanel({ onPick: (g) => { closePopover(); onPick(g.url); }, onEmoji }), { side: 'top', align: 'end' });
}

// ======================================================================= global search (Ctrl+K)
// Messages are end-to-end encrypted, so the server can't read them, and the words you search for never leave
// this device. The server is only asked for messages by where, who and when (server/search.js); each page is
// decrypted here and matched against the words, together with the messages already loaded on this device.
// The filter syntax (from:, in:, has:, dates, "phrases") is parsed by search-query.js. Imports are hoisted,
// so this one sits next to the only code that uses it.
import * as SQ from './search-query.js';

const SEARCH_RUN = 1000; // messages checked per click, so one search never runs on for long
const SEARCH_PAGE = 200; // the server's largest page
const SEARCH_ENOUGH = 50; // a run also stops early once this many results are showing
const SEARCH_SHOWN = 200; // results drawn at most
// Recent searches are kept only in this browser, and only while "Remember my searches" is on.
const searchHistory = {
  get on() { return LS.get(mine('searchHistoryOn'), true) !== false; },
  set on(v) { LS.set(mine('searchHistoryOn'), !!v); if (!v) this.clear(); },
  get list() { return this.on ? LS.get(mine('searchHistory'), []) : []; },
  add(text) {
    const t = String(text || '').trim();
    if (t && this.on) LS.set(mine('searchHistory'), [t, ...this.list.filter((x) => x !== t)].slice(0, 15));
  },
  clear() { LS.set(mine('searchHistory'), []); },
};
const SEARCH_HINTS = {
  from: 'Type a name: from:@username, from:name or from:me',
  in: 'Type a channel: in:#general (or in:@username for a DM)',
  has: 'has:file, has:image or has:link',
  is: 'is:edited or is:pinned',
  before: 'A date: 2025-05-31, or a month (2025-05) or a year (2025)',
};
SEARCH_HINTS.after = SEARCH_HINTS.before;
SEARCH_HINTS.during = SEARCH_HINTS.before;

function openSearch({ scope = null } = {}) {
  let tab = scope ? 'messages' : 'all';
  let scopeKey = scope; // 'c:<channel>' | 'd:<dm>' | 's:<server>' | null (everywhere)
  let q = SQ.parseQuery('');
  let scan = null; // the server-side part of the current search (see runScan)
  const scans = new Map(); // recent ones by filters, while this search is open
  let rows = []; // what the arrow keys move through: { id, action, build }
  let sel = 0;
  let selId = null;
  let lastHits = 0;
  let closed = false;
  const gone = new Set(); // results deleted (or hidden from us) since the search found them
  // Disappearing messages that go while this is open: forget the decrypted copies found so far, too.
  const onExpired = (ids) => { for (const sc of scans.values()) for (const id of ids) sc.items.delete(id); ids.forEach((id) => gone.add(id)); if (!closed) draw(); };
  expiryListeners.add(onExpired);
  const input = h('input', { class: 'search-main', placeholder: scope ? 'Search this conversation' : 'Search messages, people, channels, servers', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false', 'aria-controls': 'search-results', 'aria-autocomplete': 'list' });
  const chipsEl = h('div', { class: 'search-chips' });
  const noteEl = h('div', { class: 'search-note', 'aria-live': 'polite' });
  const tabsEl = h('div', { class: 'seg', role: 'tablist' });
  const results = h('div', { class: 'search-results', id: 'search-results', role: 'listbox', 'aria-label': 'Search results' });
  const footNote = h('span'); // where what you type goes, for the tab that's open
  const go = (fn) => () => { mdl.close(); fn(); };
  const refocus = () => { selId = null; draw(); input.focus(); };

  // ---- where and who: from: and in: name people and places, the server wants ids
  const serverOfScope = (key) => (!key ? null : key.startsWith('s:') ? S.servers.find((s) => s.id === key.slice(2)) : key.startsWith('c:') ? serverOfChannel(key.slice(2)) : null);
  function scopeLabel(key) {
    if (key.startsWith('d:')) return `In DM with ${displayName(getUser((S.dms.find((d) => d.id === key.slice(2)) || {}).userId))}`;
    const s = serverOfScope(key);
    if (key.startsWith('s:')) return `In ${s ? s.name : 'this server'}`;
    return isGroup(s) ? `In ${groupName(s)}` : `In ${chanLabel(channelById(key.slice(2)))}`;
  }
  const handles = (list) => list.slice(0, 4).map((u) => '@' + u.username).join(', ') + (list.length > 4 ? '…' : '');
  function findPerson(f) {
    if (f.me) return { id: S.me.id, user: S.me };
    const n = f.name.toLowerCase();
    const users = Object.values(S.users).filter((u) => u && u.username);
    const exact = users.find((u) => u.username.toLowerCase() === n);
    if (exact) return { id: exact.id, user: exact };
    if (f.exact) return { error: `No one with the username @${f.name} in your servers or DMs.` };
    const named = users.filter((u) => displayName(u).toLowerCase() === n || realName(u).toLowerCase() === n);
    if (named.length > 1) return { error: `Several people are called “${f.name}” (${handles(named)}). Use from:@username.` };
    const near = named.length ? named : users.filter((u) => u.username.toLowerCase().startsWith(n) || displayName(u).toLowerCase().startsWith(n));
    if (near.length === 1) return { id: near[0].id, user: near[0] };
    return { error: near.length ? `“${f.name}” could be ${handles(near)}. Type more, or use from:@username.` : `No one called “${f.name}” in your servers or DMs. Try from:@username.` };
  }
  function findPlace(f) {
    if (f.kind === 'user') {
      const p = findPerson({ name: f.name });
      if (p.error) return p;
      const d = S.dms.find((x) => x.userId === p.id);
      return d ? { key: 'd:' + d.id } : { error: `You don’t have a DM with @${p.user.username}.` };
    }
    const n = f.name.toLowerCase();
    // Text channels first; a voice channel's chat when no text channel has that name.
    const named = (type) => realServers().flatMap((s) => s.channels.filter((c) => c.type === type && c.name.toLowerCase() === n).map((c) => ({ c, s })));
    const text = named('text');
    const hits = text.length ? text : named('voice');
    if (!hits.length) return { error: `No channel called #${f.name} that you can see.` };
    // Several servers have one: take the one being searched or looked at.
    const here = (serverOfScope(scopeKey) || {}).id || S.view.serverId;
    const pick = hits.length === 1 ? hits[0] : hits.find((x) => x.s.id === here);
    if (!pick) return { error: `#${f.name} is in ${hits.length} servers (${hits.slice(0, 3).map((x) => x.s.name).join(', ')}). Search from inside the one you mean.` };
    return { key: 'c:' + pick.c.id };
  }
  // What to ask the server for. Only these metadata filters are sent; the words stay here.
  function plan() {
    const p = { errors: [...q.errors], fromId: null, where: scopeKey, badFrom: false, badIn: false };
    if (q.from) { const r = findPerson(q.from); if (r.error) { p.errors.push(r.error); p.badFrom = true; } else p.fromId = r.id; }
    if (q.in) { const r = findPlace(q.in); if (r.error) { p.errors.push(r.error); p.badIn = true; } else p.where = r.key; }
    p.params = { scope: p.where || 'all', limit: String(SEARCH_PAGE) };
    if (p.fromId) p.params.from = p.fromId;
    if (q.after !== null) p.params.after = String(q.after);
    if (q.before !== null) p.params.before = String(q.before);
    p.sig = JSON.stringify([p.params.scope, p.fromId, q.after, q.before]);
    return p;
  }

  // ---- the server part: ciphertext pages, newest first. Each click checks up to SEARCH_RUN messages, and
  // "Search further back" carries on from the cursor. Typing more words reuses what's already decrypted.
  function startScan(p) {
    if (scan && scan.sig === p.sig) return;
    // Going back to filters used a moment ago picks up where that search was (draw() continues it if needed).
    scan = scans.get(p.sig);
    if (scan) return;
    scan = { sig: p.sig, params: p.params, items: new Map(), cursor: null, done: false, checked: 0, unreadable: 0, goal: SEARCH_RUN, running: false, error: null, oldest: null };
    scans.set(p.sig, scan);
    if (scans.size > 8) scans.delete(scans.keys().next().value);
    runScan(scan);
  }
  async function runScan(sc, further = false) {
    if (further) sc.goal = sc.checked + SEARCH_RUN;
    if (sc.running || sc.done || closed || sc.checked >= sc.goal) return;
    sc.running = true;
    sc.error = null;
    const stale = () => closed || scan !== sc;
    try {
      while (!sc.done && sc.checked < sc.goal && !stale()) {
        const res = await api('GET', '/search/messages?' + new URLSearchParams({ ...sc.params, ...(sc.cursor ? { cursor: sc.cursor } : {}) }));
        await Promise.all(res.messages.map((m) => decryptMessage(m).catch(() => {})));
        if (stale()) return;
        for (const m of res.messages) {
          if (isExpired(m, nowServer())) continue;
          if (readable(m)) sc.items.set(m.id, { m, key: keyOfMessage(m) });
          else sc.unreadable++;
        }
        sc.checked += res.messages.length;
        if (res.messages.length) sc.oldest = res.messages[res.messages.length - 1].createdAt;
        sc.cursor = res.nextCursor;
        sc.done = !res.nextCursor;
        draw();
        if (lastHits >= SEARCH_ENOUGH) break;
      }
    } catch (e) {
      if (!stale()) sc.error = e.message;
    } finally {
      sc.running = false;
      if (!stale()) draw();
    }
  }

  // ---- server search (server/discovery.js): servers that chose to be listed. Unlike message search this asks the
  // server, with what was typed, so it only runs on its own tab, once you pick it (never from Enter elsewhere).
  // q: the words the results are for (null: never asked; undefined: the words changed, results dropped).
  // seq: the request whose answer counts; an older one's answer (another query, a page asked twice) is dropped.
  const disc = { q: null, items: [], page: 0, hasMore: false, loading: false, waiting: false, timer: null, error: null, seq: 0, joining: null };
  async function loadServers(text, more = false) {
    if (more && disc.loading) return; // 'Show more servers' clicked twice: one request
    if (!more) Object.assign(disc, { q: text, items: [], page: 0, hasMore: false });
    disc.loading = true;
    disc.error = null;
    const want = disc.q;
    const seq = ++disc.seq;
    draw();
    try {
      const r = await api('GET', '/discover/servers?' + new URLSearchParams({ q: want, page: String(more ? disc.page + 1 : 0) }));
      if (closed || disc.seq !== seq) return;
      disc.items = more ? disc.items.concat(r.servers.filter((x) => !disc.items.some((y) => y.id === x.id))) : r.servers;
      disc.page = r.page;
      disc.hasMore = r.hasMore;
    } catch (e) {
      if (disc.seq === seq) disc.error = e.message;
    } finally {
      if (disc.seq === seq) { disc.loading = false; draw(); }
    }
  }
  async function joinListed(x) {
    if (S.servers.some((y) => y.id === x.id)) { mdl.close(); openServer(x.id); return; }
    if (disc.joining) return; // a double click or Enter held down: one join
    disc.joining = x.id;
    draw();
    try {
      const sv = await api('POST', `/discover/servers/${x.id}/join`);
      if (!S.servers.find((y) => y.id === sv.id)) S.servers.push(sv);
      if (sv.keyState) await sec.applyState(sv.keyState);
      mdl.close();
      openServer(sv.id);
    } catch (e) { toast(e.message, 'error'); } finally { disc.joining = null; draw(); }
  }
  function serversTab(add) {
    // Only the words: filters (from:, in: …) are for message search and never go to the server.
    const text = q.terms.join(' ').trim().slice(0, 64);
    // Asked a moment after typing stops (searches are limited per minute); a changed query shows as loading meanwhile.
    // Results for other words are dropped at once, so Enter or a click can never join a server from them.
    clearTimeout(disc.timer);
    if (disc.q !== null && disc.q !== text) { Object.assign(disc, { q: undefined, items: [], page: 0, hasMore: false, error: null }); disc.seq++; disc.loading = false; }
    disc.waiting = disc.q !== text;
    if (disc.waiting) disc.timer = setTimeout(() => { if (!closed && disc.q !== text) { disc.waiting = false; loadServers(text); } }, disc.q === null ? 0 : 350);
    results.append(h('div', { class: 'search-empty' }, `Servers whose owners chose to show them in search. What you type here goes to ${S.config.name}’s server to find them (message search never does).`));
    const n = (x) => `${x.memberCount.toLocaleString()} member${x.memberCount === 1 ? '' : 's'}`;
    add(text ? 'Servers' : 'Biggest servers', (disc.q === text ? disc.items : []).map((x) => {
      const mine = S.servers.some((y) => y.id === x.id);
      return item('ds:' + x.id, {
        av: x.icon ? h('img', { class: 'search-img', src: x.icon, alt: '' }) : h('span', { class: 'search-ic' }, x.name.slice(0, 2)),
        title: x.name, sub: x.about || null,
        badges: x.tags.map((t) => h('span', { class: 'search-badge' }, t)),
        meta: h('span', null, `${n(x)} · `, h('strong', null, mine ? 'Open' : disc.joining === x.id ? 'Joining…' : 'Join')),
        action: () => joinListed(x),
      });
    }));
    if (disc.loading || disc.waiting) results.append(h('div', { class: 'search-status' }, h('span', { class: 'spinner' }), h('span', null, 'Looking for servers…')));
    else if (disc.error) results.append(h('div', { class: 'search-status bad' }, h('span', null, disc.error), h('button', { class: 'btn ghost sm', onclick: () => { disc.q = null; draw(); } }, 'Try again')));
    else if (!disc.items.length) results.append(h('div', { class: 'search-empty' }, text ? 'No listed servers match.' : `No servers on ${S.config.name} are shown in search yet.`));
    else if (disc.hasMore) results.append(h('div', { class: 'search-status' }, h('button', { class: 'btn ghost sm', disabled: disc.loading, onclick: () => loadServers(disc.q, true) }, 'Show more servers')));
  }

  // ---- matching, on this device
  // While you share your screen, DMs and group chats stay out of the results (see shareCover).
  const privateHidden = (key) => (key.startsWith('d:') || isGroup(serverOfChannel(key.slice(2)))) && hiddenWhileSharing(key);
  const inPlace = (key, m, where) => !where || (where.startsWith('s:') ? !m.dmId && m.serverId === where.slice(2) : key === where);
  const viewOf = (m) => ({ text: textOf(m), files: filesOf(m), edited: !!m.editedAt, pinned: !!m.pinnedAt, createdAt: m.createdAt, get imageLinks() { return extractImageUrls(textOf(m)).length; } });
  function messageHits(p) {
    const found = new Map();
    const t = nowServer();
    const consider = (m, key) => {
      if (found.has(m.id) || !readable(m) || isExpired(m, t) || !inPlace(key, m, p.where) || (p.fromId && m.authorId !== p.fromId)) return;
      if (privateHidden(key) || S.blocked.has(m.authorId)) return;
      if (tab === 'files' && !filesOf(m).length) return;
      if (tab === 'links' && !/https?:\/\//i.test(textOf(m))) return;
      if (SQ.matchMessage(q, viewOf(m))) found.set(m.id, { m, key });
    };
    // Loaded on this device first (kept up to date live), then what the server search turned up.
    for (const [key, store] of Object.entries(S.msgs)) store.list.forEach((m) => consider(m, key));
    for (const t of Object.values(S.threads)) (t.list || []).forEach((m) => consider(m, 'c:' + m.channelId));
    if (scan && scan.sig === p.sig) scan.items.forEach(({ m, key }) => consider(m, key));
    return [...found.values()].sort((a, b) => b.m.createdAt - a.m.createdAt || (a.m.id < b.m.id ? 1 : -1));
  }
  // Matches are highlighted with real text nodes and <mark> elements, never HTML.
  const marked = (text) => SQ.segments(text, q).map((s) => (s.hit ? h('mark', null, s.text) : s.text));

  async function openResult(m, key) {
    if (gone.has(m.id)) return;
    searchHistory.add(input.value);
    let loc;
    try { loc = await api('GET', `/messages/${m.id}/locate`); } catch (e) {
      if (e.status === 404) { gone.add(m.id); draw(); return; }
      toast(e.message, 'error');
      return;
    }
    if (closed) return;
    mdl.close();
    if (loc.threadId) {
      // A reply in a thread: open its channel at the thread's first message, then the thread itself.
      await jumpToMessage('c:' + loc.channelId, loc.threadId);
      openThread({ id: loc.threadId, channelId: loc.channelId, serverId: loc.serverId }, m.id);
    } else jumpToMessage(key, m.id);
  }

  // ---- drawing
  const item = (id, o) => ({ id, action: o.action, build: (i) => h('button', {
    class: `search-item${o.cls ? ' ' + o.cls : ''}`, id: 'sr-' + i, role: 'option', 'aria-selected': 'false', 'aria-disabled': o.disabled ? 'true' : null,
    onclick: o.action, onmouseenter: () => select(i),
  }, o.av, h('span', { class: 'search-item-text' }, h('span', { class: 'search-item-title' }, o.title), o.sub ? h('span', { class: 'search-item-sub' }, o.sub) : null,
    o.badges && o.badges.length ? h('span', { class: 'search-badges' }, o.badges) : null), o.meta ? h('span', { class: 'search-item-meta' }, o.meta) : null) });
  function messageItem({ m, key }) {
    const u = getUser(m.authorId);
    const files = filesOf(m);
    const deleted = gone.has(m.id);
    // Found, but the word filter hides or blurs it: the result says so instead of quoting it (open it to show it).
    const wf = WF.isShown(m.id) ? null : WF.check(m);
    const body = wf ? '' : tab === 'files' ? files.map((f) => f.name).join(', ') : SQ.excerpt(textOf(m), q);
    const badges = [];
    if (files.length) {
      const img = files.some(SQ.isImageFile);
      const what = `${files.length} ${img ? 'image' : 'file'}${files.length > 1 ? 's' : ''}`;
      badges.push(h('span', { class: 'search-badge', title: what, 'aria-label': what }, icon(img ? 'image' : 'file'), String(files.length)));
    }
    if (m.threadId) badges.push(h('span', { class: 'search-badge' }, icon('thread'), 'In a thread'));
    if (m.editedAt) badges.push(h('span', { class: 'search-badge' }, 'Edited'));
    return item('m:' + m.id, {
      cls: `search-msg${deleted ? ' gone' : ''}`, disabled: deleted, av: avatarEl(u, 30),
      title: h('span', null, h('strong', null, nameInMsg(m, u)), h('span', { class: 'search-where' }, ` · ${whereLabel(m)}`)),
      sub: deleted ? h('span', { class: 'search-gone' }, 'This message was deleted after the search found it, or you can’t see it any more.')
        : wf ? h('em', { class: 'wf-hidden-text' }, previewLabel(wf)) : body ? marked(body) : h('em', null, files.length ? 'Only attachments' : 'No text'),
      badges: deleted ? [] : badges,
      meta: h('time', { datetime: new Date(m.createdAt).toISOString(), title: new Date(m.createdAt).toLocaleString() }, fmtStamp(m.createdAt)),
      action: () => openResult(m, key),
    });
  }
  function chipLabel(f, p) {
    if (SQ.parseQuery(f.raw).errors.length) return f.raw;
    if (f.key === 'from') return p.fromId ? `From ${displayName(getUser(p.fromId))}` : f.raw;
    if (f.key === 'in') return p.where && !p.badIn ? scopeLabel(p.where) : f.raw;
    if (f.key === 'has') return { file: 'Has a file', image: 'Has an image', link: 'Has a link' }[SQ.parseQuery(f.raw).has[0]];
    if (f.key === 'is') return f.value.toLowerCase() === 'edited' ? 'Edited' : 'Pinned';
    return `${f.key[0].toUpperCase()}${f.key.slice(1)} ${f.value}`;
  }
  function statusEl(p, n) {
    const sc = scan;
    if (!sc || sc.sig !== p.sig) return null;
    const count = (x) => x.toLocaleString();
    const lost = sc.unreadable ? ` ${count(sc.unreadable)} couldn’t be decrypted on this device.` : '';
    if (sc.running) return h('div', { class: 'search-status' }, h('span', { class: 'spinner' }), h('span', null, `Searching… ${count(sc.checked)} messages checked`));
    if (sc.error) {
      return h('div', { class: 'search-status bad' }, h('span', null, `Couldn’t search further: ${sc.error}`),
        h('button', { class: 'btn ghost sm', onclick: () => { runScan(sc, true); draw(); } }, 'Try again'));
    }
    if (sc.done) return h('div', { class: 'search-status' }, h('span', null, `${n ? '' : 'No messages match. '}Checked all ${count(sc.checked)} messages that fit the filters.${lost}`));
    return h('div', { class: 'search-status' },
      h('span', null, `${n ? '' : 'No matches yet. '}Checked ${count(sc.checked)} messages, back to ${fmtDay(sc.oldest)}.${lost}`),
      h('button', { class: 'btn ghost sm', onclick: () => { searchHistory.add(input.value); runScan(sc, true); draw(); } }, 'Search further back'));
  }
  function select(i, scroll = false) {
    if (!rows.length) { input.removeAttribute('aria-activedescendant'); return; }
    sel = Math.max(0, Math.min(rows.length - 1, i));
    selId = rows[sel].id;
    results.querySelectorAll('.search-item').forEach((b, n) => { b.classList.toggle('active', n === sel); b.setAttribute('aria-selected', String(n === sel)); });
    const el = results.querySelector('#sr-' + sel);
    if (el) { input.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); }
  }
  const insert = (token) => {
    const v = input.value.replace(/\s+$/, '');
    input.value = (v ? v + ' ' : '') + token;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    refocus();
  };

  function draw() {
    if (closed) return;
    q = SQ.parseQuery(input.value);
    const p = plan();
    const empty = !input.value.trim();
    const words = q.terms.join(' ').toLowerCase();
    // A filter still being typed ("from:" at the end) gets a hint, not an error, and doesn't search yet.
    const typing = /(?:^|\s)(from|in|before|after|during|has|is):[#@"]?$/i.exec(input.value);
    const wantsMessages = ['all', 'messages', 'files', 'links'].includes(tab);
    const messageQuery = !typing && !p.errors.length && (q.filters.length > 0 || tab === 'files' || tab === 'links' || q.terms.join('').length >= (scopeKey ? 1 : 2));
    if (wantsMessages && messageQuery) startScan(p);

    clear(tabsEl);
    [['all', 'All'], ['messages', 'Messages'], ['people', 'People'], ['places', 'Channels & servers'], ['servers', 'Find servers'], ['files', 'Files'], ['links', 'Links']].forEach(([k, l]) => tabsEl.append(
      h('button', { class: `seg-btn${tab === k ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; refocus(); } }, l)));

    // Chips: where the search is limited to, then each filter (× removes it from the box).
    clear(chipsEl);
    if (scopeKey && !q.in) {
      chipsEl.append(h('span', { class: 'chip active search-chip' }, scopeLabel(scopeKey), h('button', { class: 'chip-x', 'aria-label': 'Search everywhere', onclick: () => { scopeKey = null; refocus(); } }, icon('close'))));
      const s = serverOfScope(scopeKey);
      if (scopeKey.startsWith('c:') && s && !isGroup(s)) chipsEl.append(h('button', { class: 'chip search-chip', onclick: () => { scopeKey = 's:' + s.id; refocus(); } }, `All of ${s.name}`));
    }
    q.filters.forEach((f) => {
      const bad = SQ.parseQuery(f.raw).errors.length > 0 || (f.key === 'from' && p.badFrom) || (f.key === 'in' && p.badIn);
      chipsEl.append(h('span', { class: `chip active search-chip${bad ? ' bad' : ''}`, title: f.raw }, chipLabel(f, p),
        h('button', { class: 'chip-x', 'aria-label': `Remove ${f.raw}`, onclick: () => { input.value = SQ.removeFilter(input.value, f); refocus(); } }, icon('close'))));
    });
    if (q.filters.length || scopeKey) chipsEl.append(h('button', { class: 'link-btn search-clear', onclick: () => { input.value = SQ.clearFilters(input.value); scopeKey = null; refocus(); } }, 'Clear filters'));

    clear(noteEl);
    noteEl.className = 'search-note';
    if (typing) { noteEl.classList.add('hint'); noteEl.append(icon('info'), h('span', null, SEARCH_HINTS[typing[1].toLowerCase()])); }
    else if (p.errors.length) { noteEl.classList.add('bad'); noteEl.append(icon('info'), h('span', null, p.errors.join(' '))); }

    clear(footNote).append(...(tab === 'servers' ? [icon('compass', 'ic'), `What you type here is sent to ${S.config.name}’s server`] : [icon('lock', 'ic'), 'Search words stay on this device']));
    clear(results);
    rows = [];
    const add = (title, items) => {
      if (!items.length) return;
      if (title) results.append(h('div', { class: 'search-sec' }, title));
      items.forEach((it) => { const i = rows.length; rows.push(it); results.append(it.build(i)); });
    };

    if (empty && (tab === 'all' || tab === 'messages')) {
      results.append(h('div', { class: 'search-suggest' }, h('span', { class: 'search-sec' }, 'Filters'),
        h('div', { class: 'search-suggest-list' }, SQ.SUGGESTIONS.map((s) => h('button', { class: 'chip search-chip', title: s.hint, onclick: () => insert(s.insert) }, s.insert)))));
      const hist = searchHistory.list;
      if (hist.length && isSharing()) results.append(h('div', { class: 'search-empty' }, 'Recent searches are hidden while you share your screen.'));
      else if (hist.length) {
        add('Recent searches', hist.map((t) => item('h:' + t, { av: h('span', { class: 'search-ic' }, icon('search')), title: t, action: () => { input.value = t; refocus(); } })));
        results.append(h('div', { class: 'search-hist-actions' }, h('button', { class: 'link-btn', onclick: () => { searchHistory.clear(); refocus(); } }, 'Clear history')));
      }
      results.append(h('div', { class: 'search-privacy' }, icon('lock'), h('div', { class: 'stack' },
        h('p', null, 'Search runs on this device. Messages are decrypted here, and your search words never leave it: the server only learns which conversation, person and dates you filter by.'),
        h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Remember my searches on this device'), h('span', { class: 'field-hint' }, 'Kept only in this browser.')),
          h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: searchHistory.on, onchange: (e) => { searchHistory.on = e.target.checked; refocus(); } }), h('span', { class: 'switch-track' }))))));
    }
    // People and places only for plain words (filters are about messages).
    if (!scopeKey && !q.filters.length && (tab === 'people' || (tab === 'all' && !empty))) {
      const people = Object.values(S.users).filter((u) => u.id !== S.me.id && (!words || nameMatches(u, words)))
        .sort((a, b) => displayName(a).localeCompare(displayName(b))).slice(0, tab === 'all' ? 5 : 30);
      add('People', people.map((u) => item('u:' + u.id, { av: avatarEl(u, 30, { status: true, meId: S.me.id }), title: displayName(u), sub: u.username, action: go(() => openDmWith(u.id)) })));
    }
    if (!scopeKey && !q.filters.length && (tab === 'places' || (tab === 'all' && !empty))) {
      const places = [];
      realServers().forEach((s) => {
        if (!words || s.name.toLowerCase().includes(words)) places.push({ id: 's:' + s.id, av: s.icon ? h('img', { class: 'search-img', src: s.icon, alt: '' }) : h('span', { class: 'search-ic' }, s.name.slice(0, 2)), title: s.name, sub: 'Server', action: go(() => openServer(s.id)) });
        s.channels.forEach((c) => { if (!words || c.name.toLowerCase().includes(words)) places.push({ id: 'c:' + c.id, av: h('span', { class: 'search-ic' }, icon(channelIcon(c))), title: c.name, sub: s.name, action: go(() => (c.type === 'voice' ? joinVoice(c, s) : openChannel(c.id, s.id))) }); });
      });
      groups().forEach((g) => { if (!words || groupName(g).toLowerCase().includes(words)) places.push({ id: 'g:' + g.id, av: groupAvatar(g, 30), title: groupName(g), sub: 'Group', action: go(() => openGroup(g.id)) }); });
      add('Channels & servers', places.slice(0, tab === 'all' ? 6 : 50).map((x) => item(x.id, x)));
    }
    if (tab === 'servers') serversTab(add);
    lastHits = 0;
    if (wantsMessages && messageQuery) {
      const hits = messageHits(p);
      lastHits = hits.length;
      // Fewer results than a run aims for (say, after adding a word): use the rest of this click's budget.
      if (scan && scan.sig === p.sig && !scan.running && !scan.error && hits.length < SEARCH_ENOUGH) runScan(scan);
      const shown = hits.slice(0, tab === 'all' ? 8 : SEARCH_SHOWN);
      add(tab === 'files' ? 'Files' : tab === 'links' ? 'Links' : 'Messages', shown.map(messageItem));
      if (tab === 'all' && hits.length > shown.length) {
        add('', [item('more', { av: h('span', { class: 'search-ic' }, icon('message')), title: `Show all ${hits.length.toLocaleString()} message results`, action: () => { tab = 'messages'; refocus(); } })]);
      } else if (hits.length > shown.length) results.append(h('div', { class: 'search-empty' }, `Showing the newest ${SEARCH_SHOWN} of ${hits.length.toLocaleString()} results. Add words or filters to narrow them down.`));
      const st = statusEl(p, hits.length);
      if (st) results.append(st);
      else if (!hits.length) results.append(h('div', { class: 'search-empty' }, 'No messages match.'));
    } else if (!empty && !rows.length && !typing && !p.errors.length && tab !== 'servers') {
      results.append(h('div', { class: 'search-empty' }, wantsMessages ? 'Keep typing to search messages.' : 'Nothing matches.'));
    }
    // Servers you're not in: a button to the Find servers tab (which asks the server), after everything else. Not a
    // result row, so Enter can never pick it: message search never sends the words, only choosing that tab does.
    if (!scopeKey && !q.filters.length && tab === 'all' && words) {
      results.append(h('div', { class: 'search-status' }, h('button', { class: 'btn ghost sm', onclick: () => { tab = 'servers'; refocus(); } }, icon('compass', 'ic'), `Find servers matching “${words}”`)));
    }
    const keep = selId ? rows.findIndex((r) => r.id === selId) : -1;
    select(keep >= 0 ? keep : 0);
  }

  input.addEventListener('input', debounce(() => { selId = null; draw(); }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1, true); }
    if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1, true); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value !== q.text) { selId = null; draw(); } // don't act on results from before the last keystroke
      if (rows[sel]) rows[sel].action(); else searchHistory.add(input.value);
    }
  });
  const mdl = modal({ size: 'search', className: 'search-modal', label: 'Search', onClose: () => { closed = true; expiryListeners.delete(onExpired); }, body: h('div', { class: 'search' },
    h('div', { class: 'search-bar' }, icon('search'), input, h('kbd', null, 'Esc'), h('button', { class: 'icon-btn search-close', 'aria-label': 'Close search', onclick: () => mdl.close() }, icon('close'))),
    chipsEl, noteEl, tabsEl, results,
    h('div', { class: 'search-foot' }, h('span', { class: 'search-keys' }, h('kbd', null, '↑'), h('kbd', null, '↓'), ' to move'), h('span', { class: 'search-keys' }, h('kbd', null, 'Enter'), ' to open'),
      footNote)) });
  mdl.box.setAttribute('aria-label', 'Search');
  draw();
  input.focus();
  requestAnimationFrame(() => { if (document.activeElement !== input) input.focus(); });
}

// ======================================================================= voice room
function voiceRoomView() {
  const wrap = h('div', { class: 'voice-room' });
  wrap.append(callStage(S.view.channelId));
  return wrap;
}
// The call room that belongs to a group DM (its built-in voice channel).
function callRoomFor(server) {
  if (!server || !isGroup(server)) return null;
  const c = server.channels.find((x) => x.type === 'voice');
  return c ? c.id : null;
}

// ======================================================================= profiles, blocking, verification
function relationshipActions(u) {
  const r = S.relationships[u.id];
  const out = [];
  if (u.id === S.me.id) {
    out.push(h('button', { class: 'btn primary sm', onclick: () => { closePopover(); openSettings(app, 'profile'); } }, icon('edit'), 'Edit profile'));
    return out;
  }
  out.push(h('button', { class: 'btn primary sm', onclick: () => { closePopover(); openDmWith(u.id); } }, icon('message'), 'Message'));
  if (!S.blocked.has(u.id)) {
    if (!r) out.push(h('button', { class: 'btn ghost sm', onclick: (e) => api('POST', '/friends', { username: u.username }).then(() => { e.target.textContent = 'Request sent'; e.target.disabled = true; }).catch((x) => toast(x.message, 'error')) }, icon('userPlus'), 'Add friend'));
    else if (r.direction === 'incoming') out.push(h('button', { class: 'btn ghost sm', onclick: () => api('POST', `/friends/${u.id}/accept`).then(closePopover).catch((x) => toast(x.message, 'error')) }, 'Accept request'));
    else if (r.direction === 'outgoing') out.push(h('button', { class: 'btn ghost sm', disabled: true }, 'Request sent'));
  }
  out.push(h('button', { class: 'icon-btn', 'aria-label': 'More', 'data-tip': 'More', 'data-pop-anchor': '', onclick: (e) => {
    const items = [
      { label: 'View full profile', icon: 'user', action: () => openProfileModal(u.id) },
      { label: 'Verify encryption', icon: 'shield', action: () => openSafetyNumber(u) },
      { label: 'Copy username', icon: 'copy', action: () => { copyText(u.username); toast('Copied.'); } },
      personalNameItem(u),
      r && r.status === 'accepted' ? { label: 'Remove friend', icon: 'trash', action: () => api('DELETE', '/friends/' + u.id).catch((x) => toast(x.message, 'error')) } : null,
      '-', blockItem(u), { label: 'Report', icon: 'shield', danger: true, action: () => openReport({ user: u }) }];
    menu(e.currentTarget, items, { align: 'end' });
  } }, icon('more')));
  return out;
}
function blockItem(u) {
  const blocked = S.blocked.has(u.id);
  return { label: blocked ? 'Unblock' : 'Block', icon: 'ban', danger: !blocked, action: () => toggleBlock(u.id, !blocked) };
}
async function toggleBlock(userId, on) {
  const u = getUser(userId);
  if (on && !(await confirmDialog({ title: `Block ${displayName(u)}?`, text: 'They won\u2019t be able to message you or send friend requests, and their messages in servers are hidden behind a click. They aren\u2019t told.', confirm: 'Block', danger: true }))) return;
  try {
    await api(on ? 'POST' : 'DELETE', `/blocks/${userId}`);
    if (on) S.blocked.add(userId); else S.blocked.delete(userId);
    NOTES.onBlock(); // (their photo tags in the chips and suggestions)
    toast(on ? `${displayName(u)} is blocked.` : `${displayName(u)} is unblocked.`);
    renderAll();
  } catch (e) { toast(e.message, 'error'); }
}
function mutualServersEl(u) {
  if (u.id === S.me.id) return null;
  const mutual = realServers().filter((s) => s.memberIds.includes(u.id));
  if (!mutual.length) return null;
  return h('div', { class: 'pc-section' }, h('div', { class: 'pc-label' }, `Mutual servers \u2014 ${mutual.length}`),
    h('div', { class: 'pc-mutuals' }, mutual.slice(0, 6).map((s) => h('button', { class: 'pc-mutual', onclick: () => { closePopover(); $$('.modal-backdrop').forEach((b) => b._close && b._close()); openServer(s.id); } }, s.icon ? h('img', { src: s.icon, alt: '' }) : h('span', null, s.name.slice(0, 1)), s.name))));
}
function openProfilePop(anchor, userId, side = 'right') {
  const u = getUser(userId);
  // Opened inside a server (its member list, messages, calls): their nickname there too, with Change when you may.
  const sv = currentServer();
  const nick = sv && sv.memberIds.includes(u.id) ? nicknameIn(sv, u.id) : '';
  const nickname = nick ? { name: nick, place: sv.name, edit: mayNickname(sv, u) ? () => { closePopover(); openNickname(sv, u); } : null } : null;
  const editPersonal = u.id === S.me.id ? null : () => { closePopover(); openPersonalName(u); };
  const card = profileCard(u, { meId: S.me.id, compact: true, actions: relationshipActions(u), mutual: mutualServersEl(u), nickname, editPersonal });
  // The full page is the best part of a profile: make it one obvious click away.
  const open = () => openProfileModal(u.id);
  card.querySelector('.pc-inner')?.prepend(h('button', { class: 'btn primary pc-open-page', onclick: open }, icon('user'), u.id === S.me.id ? 'View my page' : 'View full profile'));
  card.querySelectorAll('.pc-av, .pc-name').forEach((el) => { el.style.cursor = 'pointer'; el.addEventListener('click', open); });
  if (S.blocked.has(u.id)) card.prepend(h('div', { class: 'pc-blocked' }, icon('ban'), 'Blocked'));
  popover(anchor, card, { side, className: 'pop-profile' });
}
function topFriendsEl(u) {
  const ids = ((u.profile || {}).topFriends || []).filter((id) => S.users[id]);
  if (!ids.length) return null;
  return h('div', { class: 'pc-section' }, h('div', { class: 'pc-label' }, 'Top friends'),
    h('div', { class: 'pc-friends' }, ids.map((id) => { const f = getUser(id); return h('button', { class: 'pc-friend', onclick: () => openProfileModal(id) }, avatarEl(f, 44), h('span', null, displayName(f))); })));
}
// ---- People: browse everyone's profile (MySpace "browse"), sorted and searchable.
function peopleView() {
  const wrap = h('div', { class: 'people-view' });
  const search = h('input', { class: 'input search-input', placeholder: 'Search names, headlines and interests' });
  let sort = 'online';
  const grid = h('div', { class: 'people-grid' });
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => clear(seg).append(...[['online', 'Online first'], ['new', 'Newest'], ['views', 'Most viewed'], ['name', 'A\u2013Z']].map(([k, l]) => h('button', { class: `seg-btn${sort === k ? ' active' : ''}`, onclick: () => { sort = k; drawSeg(); load(); } }, l)));
  let t = 0; let req = 0;
  const load = async () => {
    const id = ++req;
    try {
      const r = await api('GET', `/people?sort=${sort}&q=${encodeURIComponent(search.value.trim())}`);
      if (id !== req) return;
      r.people.forEach(setUser);
      clear(grid);
      if (!r.people.length) grid.append(h('div', { class: 'panel-empty' }, icon('user'), h('p', null, search.value ? 'Nobody matches that.' : 'Join a server or add friends to see people here.')));
      r.people.forEach((u) => grid.append(personCard(u)));
    } catch (e) { toast(e.message, 'error'); }
  };
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  drawSeg();
  wrap.append(
    h('div', { class: 'people-me' }, avatarEl(S.me, 48), h('div', { class: 'people-me-text' }, h('strong', null, 'Your profile page'), h('span', null, 'Make it yours: themes, a song, a comment wall, your own effects.')),
      h('button', { class: 'btn ghost sm', onclick: () => openProfileModal(S.me.id) }, 'View'), h('button', { class: 'btn primary sm', onclick: () => openSettings(app, 'page') }, 'Edit')),
    h('div', { class: 'people-tools' }, h('div', { class: 'friends-search' }, icon('search'), search), seg),
    grid);
  load();
  return wrap;
}
function personCard(u) {
  const p = u.profile || {};
  const online = u.presence && u.presence !== 'offline';
  return h('button', { class: 'person-card', onclick: () => openProfileModal(u.id), style: { '--c1': p.themePrimary, '--c2': p.themeSecondary } },
    h('div', { class: 'person-banner', style: { background: p.bannerColor || 'var(--accent)' } }, u.banner ? h('img', { class: 'cropped', src: u.banner, alt: '', loading: 'lazy', style: cropStyle(p.bannerCrop) }) : null),
    h('div', { class: 'person-av' }, avatarEl(u, 64, { status: true, meId: S.me.id })),
    h('div', { class: 'person-body' },
      nameEl(u, { tag: 'strong', cls: 'person-name' }),
      h('span', { class: 'person-handle' }, '@' + u.username, u.supporter ? ' \uD83D\uDC9C' : ''),
      p.headline ? h('span', { class: 'person-headline' }, `\u201C${p.headline}\u201D`) : p.mood && p.mood.text ? h('span', { class: 'person-headline' }, `${p.mood.emoji || ''} ${p.mood.text}`) : null,
      (p.interests || []).length ? h('div', { class: 'pc-tags' }, p.interests.slice(0, 3).map((x) => h('span', { class: 'pc-tag' }, x))) : null,
      h('span', { class: 'person-meta' }, online ? 'Online now' : `Joined ${fmtDay(u.createdAt)}`, u.views ? ` \u00b7 ${u.views} views` : '')));
}
// The full, MySpace-style profile page.
async function openProfileModal(userId) {
  closePopover();
  let data;
  try { data = await api('GET', `/users/${userId}/page`); } catch (e) { return toast(e.message, 'error'); }
  (data.topFriends || []).forEach(setUser);
  data.comments.forEach((c) => c.author && setUser(c.author));
  const u = getUser(userId);
  let m = null;
  const view = renderPage(data, u, {
    me: S.me, isStaff: !!S.me.staffRole,
    actions: u.id === S.me.id ? null : relationshipActions(u),
    openUser: (id) => { m.close(); openProfileModal(id); },
    onEdit: () => { m.close(); openSettings(app, 'page'); },
    editPersonal: u.id === S.me.id ? null : () => { m.close(); openPersonalName(u); },
  });
  m = modal({ size: 'full', className: 'mys-modal', title: `${displayName(u)}'s profile`, body: h('div', { class: 'mys-host' }, h('button', { class: 'icon-btn mys-close', 'aria-label': 'Close', onclick: () => m.close() }, icon('close')), view), onClose: stopSong });
}
// crypto-2: someone whose keys a password reset without their recovery key replaced, until a member verifies them.
const RESET_TIP = 'Reset their password without their recovery key \u2014 verify them before they can read new messages';
// Someone whose new keys are still held back where you could do something about it: in a server or group you share
// with them, or anywhere at all if you share none (then it's only a warning: direct messages aren't held back).
function resetUnverified(u) {
  if (!u || u.id === S.me.id || !sec.awaitingVerify(u)) return false;
  const shared = S.servers.filter((s) => s.memberIds.includes(u.id));
  return !shared.length || shared.some((s) => sec.heldBack(s.id, u.id));
}
// The shield on a member-list row: a control of its own inside the row's button, so Enter and Space open it too
// (without also opening the row's profile card).
function keyWarn(u, label, tip) {
  const open = (e) => { e.preventDefault(); e.stopPropagation(); openSafetyNumber(u); };
  return h('span', { class: 'key-warn', role: 'button', tabindex: '0', 'aria-label': label, 'data-tip': tip, onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); } }, icon('shield'));
}
async function openSafetyNumber(u) {
  try {
    const user = await sec.userWithKeys(u.id);
    // No identity key listed for them (a server that blanked it, or an account deleted long ago): no numbers to
    // compare, and nothing to accept.
    const none = user.id !== S.me.id && noSafetyNumbersText(user, displayName(user));
    if (none) return toast(none, 'error');
    // Yours are the keys this device proved are yours, never a record of you the server sent: numbers worked out from
    // keys of its own would match what it shows the other person, and they'd trust its keys as yours.
    const own = sec.ownKeys();
    if (!own) return toast('Your own keys haven\u2019t been checked on this device yet, so there are no safety numbers to compare. Reload the page.', 'error');
    const groupsN = await E2EE.safetyNumber(own, user.id === S.me.id ? own : user);
    const changed = sec.keyChanged(user);
    // They're waiting to be verified, and you may be the one to do it (the server checks you knew them before).
    // Not keys from a reset link you made yourself (the owner): someone else has to vouch for those.
    const madeTheLink = !!user.keysResetBy && user.keysResetBy === S.me.id;
    const vouch = user.id !== S.me.id && sec.awaitingVerify(user) && !sec.awaitingVerify(S.me) && !madeTheLink;
    const name = displayName(user);
    modal({
      title: changed ? 'Security key changed' : 'Verify encryption',
      size: 'sm',
      body: h('div', { class: 'stack' },
        changed ? h('p', { class: 'key-bar bad' }, icon('shield'), h('span', null, `${name}'s keys are different from the ones this browser saw before. That happens if someone \u2014 including whoever runs this server \u2014 tries to listen in. Only continue once the numbers match on both screens.`)) : null,
        vouch ? h('p', { class: 'key-bar bad' }, icon('shield'), h('span', null, `${name} reset their password without their recovery key, so their keys are new. Anyone who got into their email could have done that, so nobody\u2019s app shares a server\u2019s or group\u2019s keys with them until someone there who knew them before verifies them. Verifying them shares the keys of the servers and groups you\u2019re both in.`)) : null,
        madeTheLink && sec.awaitingVerify(user) ? h('p', { class: 'key-bar' }, icon('shield'), h('span', null, `${name}\u2019s keys came from a password reset link you made, so someone else has to verify them: a member who knew them before, or another admin.`)) : null,
        sec.awaitingVerify(S.me) && user.id !== S.me.id ? h('p', { class: 'key-bar' }, icon('shield'), h('span', null, `To get verified, ask ${name} to open your profile (\u22ef \u2192 Verify encryption), check these same numbers and press \u201cNumbers match \u2014 verify and share keys\u201d.`)) : null,
        h('p', { class: 'muted-p' }, `Compare these numbers with ${name} in person or on a call. If they match on both screens, nobody \u2014 not even the server \u2014 can read or fake your messages.`),
        h('div', { class: 'safety' }, groupsN.map((g) => h('span', null, g)))),
      actions: [
        { label: changed || vouch ? 'Not now' : 'Close' },
        { label: vouch ? 'Numbers match \u2014 verify and share keys' : changed ? 'Numbers match \u2014 trust new key' : 'Numbers match', kind: 'primary', action: async () => {
          sec.acceptKeys(user);
          SCHED.onKeys(); // a scheduled DM waiting for their new key
          NOTES.onTrust(user.id); // photo tags only their new key vouches for
          LOOK.onTrust(user.id); // and a chat background
          if (vouch) {
            // Tells the server too, with the key compared: everyone's apps share the keys of the servers and groups
            // you're both in with them again (and of all theirs, once each one they were in has been verified).
            try {
              const r = await api('POST', `/users/${user.id}/keys/verify`, { publicKey: user.publicKey });
              toast(r.everywhere ? `${name} is verified. Everyone’s apps share the keys to their servers and groups with them again.`
                : r.verified ? `${name} is verified in the servers and groups you share. Where you aren’t a member, someone there has to verify them too.`
                  : `${name} was already verified in the servers and groups you share. Where you aren’t a member, someone there has to verify them.`);
            } catch (e) { toast(`${name} is verified on this device, but not for everyone: ${e.message}`, 'error'); }
          } else toast(`${name} is verified on this device.`);
          renderHeader(); if (composers.main) composers.main.renderExtras();
          S.servers.filter((s) => s.memberIds.includes(user.id)).forEach((s) => sec.maintain(s.id));
        } },
      ],
    });
  } catch (e) { toast(e.message, 'error'); }
}
// For someone waiting to be verified: why, and the people worth asking. The server says who: someone who was in a
// server or group with you before the reset and is in one where you're held back now (their word only counts in the
// servers and groups they're in). Each opens your safety number with them.
async function openGetVerified() {
  let r;
  try { r = await api('GET', '/me/verifiers'); } catch (e) { return toast(e.message, 'error'); }
  (r.users || []).forEach((x) => { const u = { ...x }; delete u.serverIds; setUser(u); });
  const where = (ids) => ids.map((id) => S.servers.find((x) => x.id === id)).filter(Boolean).map((x) => (isGroup(x) ? groupName(x) : x.name));
  const here = S.view.serverId;
  const people = (r.users || []).map((u) => ({ u: getUser(u.id), ids: u.serverIds || [], names: where(u.serverIds || []) }))
    .sort((a, b) => Number(b.ids.includes(here)) - Number(a.ids.includes(here)) || displayName(a.u).localeCompare(displayName(b.u)));
  const m = modal({
    title: 'Ask a member to verify you',
    size: 'sm',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, 'You reset your password without your recovery key, so your encryption keys are new. Anyone who got into your email could have done that, so members\u2019 apps don\u2019t share a server\u2019s or group\u2019s keys with you until someone there who knew you before checks that it\u2019s really you.'),
      h('p', { class: 'muted-p' }, 'Compare safety numbers with one of them in person or on a call. When they match, they press \u201cNumbers match \u2014 verify and share keys\u201d on their side, and you can read new messages in the servers and groups you share with them again. (What was said before your reset stays locked to your old keys.)'),
      !r.waiting ? h('p', { class: 'field-hint' }, 'You\u2019re verified everywhere already.')
        : people.length ? h('div', { class: 'stack tight' }, ...people.map(({ u, names }) => h('div', { class: 'ss-row' }, avatarEl(u, 30),
          h('span', { class: 'ss-row-name' }, nameEl(u), names.length ? h('span', null, names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')) : null),
          h('button', { class: 'btn ghost sm', onclick: () => { m.close(); openSafetyNumber(u); } }, 'Compare safety numbers'))))
          : h('p', { class: 'field-hint' }, 'Nobody who was in a server or group with you before your reset is in one where you\u2019re waiting now. Ask an admin of this Hearth server to verify you (Admin \u2192 Users).')),
    actions: [{ label: 'Close' }],
  });
}
function openServerSecurity(server) {
  if (!server) return;
  const st = sec.stateOf(server.id) || { keyEpoch: 0, missing: [] };
  // held: members waiting to be verified (crypto-2). newcomers: new members who get the next key, not this one (the
  // server hides older messages from new members); someone held is named as held only.
  const held = server.memberIds.filter((id) => sec.heldBack(server.id, id)).map(getUser);
  const newcomers = (st.waiting || []).filter((id) => server.memberIds.includes(id) && !held.some((u) => u.id === id));
  const without = new Set([...(st.missing || []), ...(st.held || []), ...(st.waiting || [])].filter((id) => server.memberIds.includes(id)));
  const holders = server.memberIds.length - without.size;
  const changed = server.memberIds.map(getUser).filter((u) => sec.keyChanged(u) && !held.some((w) => w.id === u.id));
  const label = isGroup(server) ? 'this group' : server.name;
  modal({
    title: 'End-to-end encryption',
    size: 'sm',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, `Messages and files in ${label} are encrypted on your device with a key that only members have. The server stores scrambled data it can\u2019t read, and every message is signed by its sender.`),
      h('p', { class: 'muted-p' }, 'When someone leaves or is removed, the key is replaced automatically so they can\u2019t read anything new.'),
      h('div', { class: 'kv' }, h('span', null, 'Key version'), h('strong', null, st.keyEpoch ? `#${st.keyEpoch}` : 'Not set up yet')),
      st.keyCreatorId ? h('div', { class: 'kv' }, h('span', null, 'Made by'), h('strong', null, `${nameInServer(server, getUser(st.keyCreatorId))}${st.keyCreatedAt ? `, ${new Date(st.keyCreatedAt).toLocaleString()}` : ''}`)) : null,
      h('div', { class: 'kv' }, h('span', null, 'Members with the current key'), h('strong', null, `${Math.max(0, holders)} of ${server.memberIds.length}`)),
      newcomers.length ? h('p', { class: 'field-hint' }, `${newcomers.length === 1 ? 'One new member gets' : `${newcomers.length} new members get`} the next key instead: this server hides messages from before someone joined, so the apps make a new key for them shortly.`) : null,
      changed.length ? h('p', { class: 'key-bar bad' }, icon('shield'), h('span', null, `Security key changed for ${changed.map(displayName).join(', ')}. Verify them from their profile before the key can be shared.`)) : null,
      held.length ? h('p', { class: 'key-bar bad' }, icon('shield'), h('span', null, `${held.map(displayName).join(', ')} reset ${held.length === 1 ? 'their password' : 'their passwords'} without a recovery key. Nobody\u2019s app shares this key with them until a member here who knew them before verifies them (their profile \u2192 Verify encryption).`)) : null,
      sec.isHeld(server.id, S.me.id) ? h('p', { class: 'key-bar' }, icon('shield'), h('span', null, 'You reset your password without your recovery key: someone here who knew you before has to verify you before you get this key.'), h('button', { class: 'btn sm ghost', onclick: () => openGetVerified() }, 'Get verified')) : null,
      h('p', { class: 'field-hint' }, 'To make sure nobody is impersonating a member, compare safety numbers with them from their profile (\u22ef \u2192 Verify encryption).')),
    actions: [
      { label: 'Close' },
      { label: 'Replace key now', kind: 'ghost', action: async () => { await sec.forceRotate(server.id); toast('New encryption key created and shared with every member.'); } },
    ],
  });
}

// Coming back from Stripe (memberships): say what happened and open the right place.
function backFromStripe() {
  const q = new URLSearchParams(location.search);
  const what = q.get('membership');
  if (!what) return;
  history.replaceState(null, '', '/' + location.hash);
  if (noPayments) return;
  const sv = S.servers.find((x) => x.id === q.get('server'));
  if (what === 'thanks') toast('\u2B50 Thanks! Your membership starts as soon as Stripe confirms the payment (a few seconds).');
  else if (what === 'cancelled') toast('No payment was made.');
  else if ((what === 'connected' || what === 'connect') && sv) {
    openServerSettings(sv, 'memberships');
    if (what === 'connected') api('POST', `/servers/${sv.id}/memberships/refresh`).then((r) => toast(r.ready ? 'Stripe is connected: you can be paid.' : 'Stripe still needs a few details from you.')).catch(() => {});
  }
}

// ======================================================================= servers, groups, channels, invites
function serverMenuItems(server) {
  const admin = isAdmin(server);
  const fav = P.favorites.includes('s:' + server.id);
  const sp = S.notifyPrefs['s:' + server.id];
  const lvl = sp && sp.level !== 'default' ? (sp.level === 'none' ? 'muted' : sp.level) : 'all';
  return [
    can(server, PERMS.CREATE_INVITE) ? { label: 'Invite people', icon: 'userPlus', action: () => openInvite(server) } : null,
    canManageServer(server) ? { label: 'Server settings', icon: 'gear', action: () => openServerSettings(server) } : null,
    canManageServer(server) && can(server, PERMS.MANAGE_ROLES) ? { label: 'Roles', icon: 'shield', action: () => openServerSettings(server, 'roles') } : null,
    { label: 'Members', icon: 'people', action: () => { if (S.view.serverId !== server.id) openServer(server.id); S.panel = 'members'; S.thread = null; delete composers.thread; P.showMembers = true; renderAll(); } },
    pickableRoles(server, S.me.id).length ? { label: 'Pick your roles', icon: 'at', action: () => pickRoles(server) } : null,
    mayNickname(server, S.me) ? { label: 'Change nickname', icon: 'edit', action: () => openNickname(server, S.me) } : null,
    server.memberships && !isOwner(server) && !noPayments ? { label: 'Memberships', icon: 'star', action: () => openMemberships(server) } : null,
    { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: 'star', action: () => toggleFavorite('s:' + server.id) },
    ...folders.serverMenuExtras(server),
    '-',
    { header: 'Notifications' },
    ...[['all', 'All messages'], ['mentions', 'Only @mentions'], ['muted', 'Nothing']].map(([v, l]) => ({ label: l, checked: lvl === v, action: () => setNotify('s:' + server.id, v === 'all' ? 'default' : v) })),
    { label: 'Ignore @everyone and @here', checked: !!(sp && sp.suppressEveryone), action: () => setNotify('s:' + server.id, undefined, { suppressEveryone: !(sp && sp.suppressEveryone) }) },
    ...notifyItems('s:' + server.id),
    '-',
    admin ? { label: 'Create channel', icon: 'plus', action: () => openCreateChannel(server, 'text') } : null,
    admin ? { label: 'Create category', icon: 'folderPlus', action: () => openCreateCategory(server) } : null,
    { label: 'Encryption details', icon: 'lock', action: () => openServerSecurity(server) },
    { label: 'Mark server as read', icon: 'check', action: () => markServerRead(server) },
    !isOwner(server) ? '-' : null,
    !isOwner(server) ? { label: 'Leave server', icon: 'logout', danger: true, action: () => leaveServer(server) } : null,
  ];
}
// Roles members can pick themselves (public/js/selfroles.js).
function pickRoles(server) {
  openRolePicker(server, { myId: S.me.id, live: () => S.servers.find((x) => x.id === server.id), nextUpdate: () => nextServerUpdate(server.id) });
}
async function leaveServer(server) {
  const group = isGroup(server);
  if (!(await confirmDialog({ title: group ? 'Leave group?' : `Leave ${server.name}?`, text: group ? 'You won\u2019t get its messages anymore unless someone adds you back.' : 'You can rejoin with an invite.', confirm: 'Leave', danger: true }))) return;
  try { await api('POST', `/servers/${server.id}/leave`); } catch (e) { toast(e.message, 'error'); }
}
function openAddServer() {
  const m = modal({
    title: 'Add a server', size: 'sm',
    body: h('div', { class: 'stack' },
      h('button', { class: 'choice', onclick: () => { m.close(); openCreateServer(); } }, icon('plus', 'ic choice-ic'), h('span', null, h('strong', null, 'Create my own'), h('span', null, 'Start a space for you and your friends.'))),
      h('button', { class: 'choice', onclick: () => { m.close(); openJoinModal(''); } }, icon('link', 'ic choice-ic'), h('span', null, h('strong', null, 'Join with an invite'), h('span', null, 'Paste an invite link or code from a friend.'))),
      h('button', { class: 'choice', onclick: () => { m.close(); openDiscordImport({ S, sec, openServer, back: openAddServer, invite: (srv) => openInvite(srv, { welcome: 'imported' }) }); } }, icon('download', 'ic choice-ic'),
        h('span', null, h('strong', null, 'Import from Discord'), h('span', null, 'Start with a Discord server’s roles and channels.')))),
  });
}
function openCreateServer() {
  const name = h('input', { class: 'input', maxlength: '64', value: `${realName(S.me)}'s place` });
  let iconFile = null;
  const preview = h('div', { class: 'icon-preview' }, icon('image'));
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true, onchange: (e) => {
    iconFile = e.target.files[0];
    if (iconFile) clear(preview).append(h('img', { src: URL.createObjectURL(iconFile), alt: '' }));
  } });
  // Templates (server/templates.js): the server builds the channels and roles; the app only names one.
  let template = 'blank';
  let templates = [];
  const tplChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Template' });
  const tplHint = h('p', { class: 'field-hint' });
  const drawTemplates = () => {
    clear(tplChips).append(...templates.map((t) => h('button', { class: `chip${template === t.key ? ' active' : ''}`, role: 'radio', 'aria-checked': String(template === t.key),
      onclick: () => { template = t.key; drawTemplates(); } }, t.name)));
    const t = templates.find((x) => x.key === template);
    tplHint.textContent = t ? `${t.about} ${t.text} text and ${t.voice} voice channel${t.voice === 1 ? '' : 's'}${t.roles.length ? `; roles: ${t.roles.join(', ')}` : ''}.` : '';
  };
  api('GET', '/server-templates').then((list) => { templates = list; drawTemplates(); }).catch(() => {});
  modal({
    title: 'Create a server', size: 'sm',
    body: h('div', { class: 'stack center' },
      h('button', { class: 'icon-upload', onclick: () => fileIn.click() }, preview, h('span', null, 'Upload an icon (GIFs work)')), fileIn,
      field('Server name', name),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start from a template'), tplChips, tplHint)),
    actions: [
      { label: 'Back', action: () => openAddServer() },
      { label: 'Create', kind: 'primary', action: async () => {
        const fd = new FormData();
        fd.append('name', name.value);
        fd.append('template', template);
        if (iconFile) fd.append('icon', iconFile);
        const s = await api('POST', '/servers', fd);
        if (!S.servers.find((x) => x.id === s.id)) S.servers.push(s);
        if (s.keyState) await sec.applyState(s.keyState);
        openServer(s.id);
        // The moment people most want to bring their friends: hand them the link and a message to send.
        if (can(s, PERMS.CREATE_INVITE)) openInvite(s, { welcome: 'created' });
      } },
    ],
  });
}
function parseInvite(v) {
  const m = String(v).trim().match(/(?:invite\/)?([A-Za-z0-9]{6,16})\/?$/);
  return m ? m[1] : '';
}
function openJoinModal(code) {
  const input = h('input', { class: 'input', placeholder: `${location.origin}/invite/abcd2345`, value: code ? `${location.origin}/invite/${code}` : '' });
  const preview = h('div', { class: 'invite-preview' });
  const look = async () => {
    clear(preview);
    const c = parseInvite(input.value);
    if (!c) return;
    try {
      const info = await api('GET', '/invites/' + c);
      preview.append(info.icon ? h('img', { src: info.icon, alt: '' }) : h('span', { class: 'ip-initial' }, [...info.name][0]),
        h('div', null, h('strong', null, info.name), h('span', null, `${info.memberCount} member${info.memberCount === 1 ? '' : 's'}${info.alreadyMember ? ' \u00b7 you\u2019re already in it' : ''}`)));
    } catch (e) { preview.append(h('span', { class: 'bad' }, e.message)); }
  };
  input.addEventListener('input', debounce(look, 300));
  modal({
    title: 'Join a server', size: 'sm',
    body: h('div', { class: 'stack' }, field('Invite link or code', input), preview,
      // In a browser on a computer: hand the invite to the installed desktop app instead.
      code && !window.hearthDesktop && !/Android|iPhone|iPad/.test(navigator.userAgent)
        ? h('p', { class: 'field-hint' }, 'Have the desktop app? ', h('a', { href: `hearth://invite/${encodeURIComponent(code)}` }, 'Open this invite in the app'))
        // In a phone's browser: the Hearth Android app takes the same link.
        : code && !androidApp.on && /Android/.test(navigator.userAgent)
          ? h('p', { class: 'field-hint' }, 'Have the Hearth app? ', h('a', { href: `hearth://invite/${encodeURIComponent(code)}` }, 'Open this invite in the app')) : null),
    actions: [
      { label: 'Cancel' },
      { label: 'Join server', kind: 'primary', action: async () => {
        const c = parseInvite(input.value);
        if (!c) throw new Error('Paste an invite link or code.');
        const s = await api('POST', `/invites/${c}/join`);
        if (!S.servers.find((x) => x.id === s.id)) S.servers.push(s);
        if (s.keyState) await sec.applyState(s.keyState);
        openServer(s.id);
      } },
    ],
  });
  if (code) look();
}
// The invite dialog. welcome: 'created' or 'imported' right after making a server ("Your server is ready. Invite
// your people."), with a ready-to-send message, and for an import an announcement to post on Discord. Share opens
// the device's own share sheet where there is one (invite-share.js); nothing is sent by Hearth itself.
function openInvite(server, { welcome } = {}) {
  server = S.servers.find((x) => x.id === server.id) || server;
  const out = h('input', { class: 'input mono', readonly: true, value: 'Creating\u2026', 'aria-label': 'Invite link' });
  // Links expire after 7 days unless you choose otherwise, so one that leaks or gets forgotten stops working. An
  // announcement for a moving server stays up for a while, so that one starts at 30 days.
  const expires = h('select', { class: 'input' }, [['1', '1 hour'], ['24', '1 day'], ['168', '7 days'], ['720', '30 days'], ['0', 'Never']].map(([v, l]) => h('option', { value: v }, l)));
  expires.value = welcome === 'imported' ? '720' : '168';
  const uses = h('select', { class: 'input' }, [['0', 'No limit'], ['1', '1 use'], ['5', '5 uses'], ['10', '10 uses'], ['25', '25 uses']].map(([v, l]) => h('option', { value: v }, l)));
  let link = ''; // the link once made (not an error message shown in its place)
  const extras = [];
  const make = async () => {
    link = '';
    extras.forEach((b) => { b.disabled = true; });
    try {
      // reuse: the same kind of link made in the last few minutes comes back, so reopening this doesn't make another.
      const { code } = await api('POST', `/servers/${server.id}/invites`, { expiresHours: expires.value, maxUses: uses.value, reuse: true });
      link = `${location.origin}/invite/${code}`;
      out.value = link;
      extras.forEach((b) => { b.disabled = false; });
    } catch (e) { out.value = e.message; }
  };
  expires.onchange = make; uses.onchange = make;
  const copied = async (btn, text, note) => {
    if (!link) return;
    await copyText(text());
    toast(note);
    const was = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = was; }, 1500);
  };
  // What the words promise follows how this instance lets new people in (open, sign-up code, or closed).
  const mode = signUpMode(S.config);
  const message = () => inviteMessage({ serverName: server.name, link, instance: S.config.name, mode });
  const shareBtn = canShare({ desktop: !!window.hearthDesktop, android: androidApp.on }) ? h('button', { class: 'btn ghost sm invite-share', disabled: true, onclick: async () => {
    if (!link) return;
    try { await navigator.share({ title: server.name, text: inviteMessage({ serverName: server.name, link: null, instance: S.config.name, mode }), url: link }); } catch (e) { if (e && e.name !== 'AbortError') toast('Couldn’t open the share sheet. Copy the message instead.'); }
  } }, 'Share…') : null;
  const msgBtn = h('button', { class: 'btn ghost sm invite-copy-msg', disabled: true, onclick: (e) => copied(e.currentTarget, message, 'Invite message copied.') }, 'Copy invite message');
  const movingBtn = welcome === 'imported' ? h('button', { class: 'btn ghost sm invite-copy-moving', disabled: true,
    onclick: (e) => copied(e.currentTarget, () => movingMessage({ link, hours: +expires.value, mode, instance: S.config.name }), 'Announcement copied. Paste it in your Discord server.') }, 'Copy a moving announcement for Discord') : null;
  extras.push(...[shareBtn, msgBtn, movingBtn].filter(Boolean));
  modal({
    title: welcome ? 'Your server is ready. Invite your people.' : `Invite people to ${server.name}`, size: 'sm', className: welcome ? 'invite-welcome' : '',
    // A new server's welcome: back to the channel once it closes (the dialog that opened it is gone by then).
    onClose: welcome ? () => setTimeout(() => { if (document.activeElement === document.body) { const c = $('#composer-input'); if (c) c.focus({ preventScroll: true }); } }, 160) : undefined,
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, 'Send this link to people. They need to be able to reach this computer or VPS.'),
      // Always when new people need a sign-up code or can't sign up at all; otherwise only in the welcome.
      welcome || mode !== 'open' ? h('p', { class: `muted-p invite-signup invite-signup-${mode}` },
        joinNote({ serverName: server.name, instance: S.config.name, mode, manages: ['owner', 'admin'].includes(S.me.staffRole) })) : null,
      h('div', { class: 'row gap' }, out, h('button', { class: 'btn primary', onclick: async (e) => { await copyText(out.value); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); } }, 'Copy')),
      h('div', { class: 'row gap invite-extras' }, ...extras),
      welcome === 'imported' ? h('p', { class: 'field-hint' }, 'The announcement says when the link expires. Choose Never below if you’ll pin it there.') : null,
      h('div', { class: 'row gap' }, field('Expires after', expires), field('Max uses', uses)),
      can(server, PERMS.MANAGE_SERVER) ? h('p', { class: 'field-hint' }, 'See or revoke invite links in Server settings \u2192 Invites.') : null),
    actions: welcome ? [{ label: 'Done', kind: 'primary' }] : [],
  });
  make();
}

// Server settings: Overview, Roles, Members, Danger zone — tabs inside one modal.
// Wait for the server's next live update (after a settings change) so screens redraw with fresh data.
const serverWaiters = new Map();
function nextServerUpdate(id, ms = 1500) {
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); serverWaiters.set(id, () => { clearTimeout(t); resolve(); }); });
}

// Server settings: overview, appearance, roles, members, emoji, bans, danger zone.
// Server settings → News bot: follow topics, YouTube channels, subreddits, Steam games, GitHub projects or any
// RSS feed; the bot posts only new items into the chosen channel.
const FEED_KINDS = [
  ['topic', 'Topic', 'Anything: a game, a team, a band, a company\u2026', 'e.g. Elden Ring DLC'],
  ['youtube', 'YouTube', 'A channel\u2019s new videos.', 'youtube.com/@channel or @handle'],
  ['reddit', 'Reddit', 'New posts in a subreddit.', 'e.g. pcgaming'],
  ['steam', 'Steam game', 'Patch notes and announcements for a game.', 'Game name or Steam store link'],
  ['github', 'GitHub', 'New releases of a project.', 'owner/project'],
  ['rss', 'RSS', 'Any site\u2019s RSS or Atom feed.', 'https://example.com/feed.xml'],
];
async function newsBotTab(s, body) {
  clear(body).append(h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' })));
  let feeds = [];
  try { feeds = await api('GET', `/servers/${s.id}/feeds`); } catch (e) { clear(body).append(h('p', { class: 'form-error' }, e.message)); return; }
  const textChannels = (s.channels || []).filter((c) => c.type === 'text');
  const chName = (id) => (textChannels.find((c) => c.id === id) || {}).name || 'deleted channel';
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  let kind = 'topic';
  const query = h('input', { class: 'input', placeholder: FEED_KINDS[0][3] });
  const hint = h('span', { class: 'field-hint' }, FEED_KINDS[0][2]);
  const channel = h('select', { class: 'input' }, textChannels.map((c) => h('option', { value: c.id }, `#${c.name}`)));
  const keywords = h('input', { class: 'input', placeholder: 'optional: patch, update, release' });
  const postNow = h('input', { type: 'checkbox', checked: true });
  const preview = h('div', { class: 'stack' });
  const kindChips = h('div', { class: 'chips' });
  const drawKinds = () => {
    clear(kindChips).append(...FEED_KINDS.map(([k, l, d, ph]) => h('button', { type: 'button', class: `chip${kind === k ? ' active' : ''}`, onclick: () => { kind = k; query.placeholder = ph; hint.textContent = d; clear(preview); drawKinds(); } }, l)));
  };
  drawKinds();
  const doPreview = async (btn) => {
    btn.disabled = true; clear(preview).append(h('span', { class: 'spinner' }));
    try {
      const r = await api('POST', `/servers/${s.id}/feeds/preview`, { kind, query: query.value });
      clear(preview).append(h('p', { class: 'muted-p' }, h('b', null, r.title || 'Feed'), ` \u2014 the newest items right now (these count as already seen; only newer ones get posted):`),
        ...r.items.map((i) => h('div', { class: 'feed-prev' }, mediaSrc(i.imageSrc) ? h('img', { src: mediaSrc(i.imageSrc), alt: '', loading: 'lazy' }) : h('span', { class: 'feed-prev-ph' }, icon('megaphone')),
          h('div', { class: 'act-text' }, h('a', { class: 'act-title', href: i.link, target: '_blank', rel: 'noopener noreferrer' }, i.title), h('span', { class: 'act-sub' }, i.date ? new Date(i.date).toLocaleString() : '')))));
      if (!r.items.length) preview.append(h('p', { class: 'field-hint' }, 'Nothing in it right now, which is fine: new items will still get posted.'));
    } catch (e) { clear(preview).append(h('p', { class: 'form-error' }, e.message)); }
    btn.disabled = false;
  };
  const list = h('div', { class: 'adm-table' }, ...feeds.map((f) => h('div', { class: 'adm-row feed-row' },
    h('div', { class: 'act-text' }, h('b', null, f.title), h('span', { class: 'act-sub' }, `${f.kindName} \u00b7 into #${chName(f.channelId)}${f.keywords ? ` \u00b7 only \u201c${f.keywords}\u201d` : ''}`)),
    h('span', { class: 'stat-sub' }, `${f.posted} posted \u00b7 checked ${ago(f.lastCheck)}`),
    f.paused ? h('span', { class: 'rpill warn' }, 'Paused') : f.lastError ? h('span', { class: 'rpill bad', 'data-tip': f.lastError }, 'Problem') : h('span', { class: 'rpill ok' }, 'Working'),
    h('span', { class: 'row gap tight' },
      h('button', { class: 'btn ghost sm', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await api('POST', `/feeds/${f.id}/check`); toast(r.posted ? `Posted ${r.posted} new item${r.posted === 1 ? '' : 's'}.` : r.feed.lastError ? `Problem: ${r.feed.lastError}` : 'Working \u2014 nothing new since the last check. New items are posted as soon as they come out.'); } catch (x) { toast(x.message, 'error'); } newsBotTab(s, body); } }, 'Check now'),
      h('button', { class: 'btn ghost sm', onclick: async () => { await api('PATCH', `/feeds/${f.id}`, { paused: !f.paused }); newsBotTab(s, body); } }, f.paused ? 'Resume' : 'Pause'),
      h('button', { class: 'btn ghost sm danger-text', onclick: async () => { if (await confirmDialog({ title: `Stop following ${f.title}?`, confirm: 'Remove', danger: true })) { await api('DELETE', `/feeds/${f.id}`); newsBotTab(s, body); } } }, 'Remove')))));
  clear(body).append(
    h('h3', null, 'News bot'),
    h('p', { class: 'muted-p' }, 'Follow things your server cares about. The bot checks every 10 minutes and posts only new items, never old news. Its posts are public news, so they aren\u2019t end-to-end encrypted (and say so); everything people write still is.'),
    feeds.length ? list : h('p', { class: 'field-hint' }, 'Not following anything yet.'),
    h('h4', null, 'Follow something new'),
    kindChips,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What to follow'), query, hint),
    h('div', { class: 'grid-2' }, field('Post into', channel), field('Only posts mentioning (optional)', keywords, 'Comma-separated words. Leave empty for everything.')),
    h('label', { class: 'row gap tight' }, postNow, h('span', null, 'Post the newest item right now, so you can see it working')),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn', onclick: (e) => doPreview(e.currentTarget) }, 'Preview'),
      h('button', { class: 'btn primary', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          if (!textChannels.length) throw new Error('Make a text channel first.');
          const f = await api('POST', `/servers/${s.id}/feeds`, { kind, query: query.value, channelId: channel.value, keywords: keywords.value, postLatest: postNow.checked });
          toast(`Following ${f.title}. New items will show up in #${chName(f.channelId)}.`);
          newsBotTab(s, body);
        } catch (x) { toast(x.message, 'error'); b.disabled = false; }
      } }, 'Follow')),
    preview);
}
// News pictures and webhook avatars load through this server's picture proxies, with a link the server signed for
// that one picture (imageSrc, avatarSrc; files-10). The app only adds its sign-in media token: it never makes up a
// proxy link for an address of its own, and anything but a /media/news/ or /media/avatar/ link from the server is
// ignored.
const mediaSrc = (src) => (typeof src === 'string' && /^\/media\/(news|avatar)\/[\w-]+\?/.test(src) ? `${src}&t=${encodeURIComponent(S.mediaToken || '')}` : '');
function newsCard(e) {
  let host = '';
  try { host = new URL(e.url).hostname.replace(/^www\./, ''); } catch { /* bad link */ }
  return h('a', { class: `news-card kind-${e.kind || 'rss'}`, href: e.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
    h('div', { class: 'news-text' },
      h('span', { class: 'news-source' }, e.source || host),
      h('span', { class: 'news-title' }, e.title),
      e.summary ? h('span', { class: 'news-summary' }, e.summary.length > 220 ? `${e.summary.slice(0, 220)}\u2026` : e.summary) : null,
      h('span', { class: 'news-meta' }, [host, e.date ? fmtStamp(e.date) : ''].filter(Boolean).join(' \u00b7 '))),
    mediaSrc(e.imageSrc) ? h('img', { class: 'news-img', src: mediaSrc(e.imageSrc), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (ev) => ev.currentTarget.remove() }) : null);
}
// A link preview from inside a message (secure.js already checked it: an https link that's in the text, capped
// fields, a small WebP/JPEG thumbnail). Text goes in as text nodes only, never as HTML. The picture is a data:
// URL from the message itself, and the domain line is read from the link here, so the card can't hide where
// the link goes.
function linkCardEl(l) {
  const host = hostLabel(l.url);
  const big = !!l.img && l.img.w >= 280 && l.img.w / l.img.h >= 1.3;
  const desc = [...(l.desc || '')]; // cut by characters, so an emoji is never split
  return h('a', { class: `news-card link-card kind-${l.kind}${big ? ' big' : ''}`, href: l.url, title: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
    h('div', { class: 'news-text' },
      h('span', { class: 'news-source' }, l.site || host),
      l.title ? h('span', { class: 'news-title' }, l.title) : null,
      desc.length ? h('span', { class: 'news-summary' }, desc.length > 220 ? `${desc.slice(0, 220).join('')}…` : l.desc) : null,
      h('span', { class: 'news-meta' }, host)),
    l.img ? h('img', { class: 'news-img link-img', src: `data:${l.img.type};base64,${l.img.data}`, alt: '', width: l.img.w, height: l.img.h, loading: 'lazy', decoding: 'async' }) : null);
}

function openServerSettings(server, startTab = 'overview') {
  if (!server) return;
  const live = () => S.servers.find((s) => s.id === server.id) || server;
  const TABS = [
    ['overview', 'Overview', 'info', (s) => can(s, PERMS.MANAGE_SERVER)],
    ['appearance', 'Appearance', 'palette', (s) => can(s, PERMS.MANAGE_SERVER)],
    ['roles', 'Roles', 'shield', (s) => can(s, PERMS.MANAGE_ROLES)],
    ['members', 'Members', 'people', (s) => can(s, PERMS.MANAGE_ROLES) || can(s, PERMS.KICK_MEMBERS) || can(s, PERMS.BAN_MEMBERS) || can(s, PERMS.MUTE_MEMBERS)],
    ['emoji', 'Emoji', 'smile', (s) => can(s, PERMS.MANAGE_EMOJIS)],
    ['news', 'News bot', 'megaphone', (s) => !isGroup(s) && can(s, PERMS.MANAGE_SERVER)],
    ['bots', 'Bots', 'bot', (s) => !isGroup(s) && can(s, PERMS.MANAGE_SERVER)],
    ['bans', 'Bans', 'ban', (s) => can(s, PERMS.BAN_MEMBERS)],
    ['reports', 'Reports', 'shield', (s) => canSeeReports(s)],
    ['audit', 'Audit log', 'file', (s) => !isGroup(s) && can(s, PERMS.VIEW_AUDIT_LOG)],
    ['invites', 'Invites', 'link', (s) => !isGroup(s) && can(s, PERMS.MANAGE_SERVER)],
    ['wordfilter', 'Word filter', 'eyeOff', (s) => !isGroup(s) && can(s, PERMS.MANAGE_SERVER)],
    ['memberships', 'Memberships', 'star', (s) => !noPayments && !isGroup(s) && isOwner(s) && s.membershipsOn],
    ['danger', 'Danger zone', 'trash', (s) => isOwner(s)],
  ];
  const add = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));
  let tab = startTab;
  let roleSel = null;
  const nav = h('nav', { class: 'ss-nav' });
  const body = h('div', { class: 'ss-body' });
  const run = async (fn, okMsg) => {
    try { const wait = nextServerUpdate(server.id); await fn(); await wait; if (okMsg) toast(okMsg); draw(); } catch (e) { toast(e.message, 'error'); }
  };
  const draw = () => {
    const s = live();
    const allowed = TABS.filter(([, , , ok]) => ok(s));
    // Nothing left that's yours to change here (say, right after handing the server to someone else): close
    // instead of showing forms the server would refuse.
    if (!allowed.length) { mdl.close(); return; }
    if (!allowed.some(([k]) => k === tab)) tab = allowed[0][0];
    clear(nav).append(...allowed.map(([k, l, ic]) => h('button', { class: `ss-tab${tab === k ? ' active' : ''}`, onclick: () => { tab = k; draw(); } }, icon(ic), l)));
    clear(body);
    ({ overview, appearance, roles, members, emoji, news: (sv) => newsBotTab(sv, body), bots: (sv) => botsTab(sv, body, { confirm: (fn, opts) => confirmedCall(app, fn, opts) }), memberships: (sv) => membershipsTab(sv, body, { roles: sv.roleDefs }), bans, invites, danger,
      audit: (sv) => auditTab(sv, body, { memberIds: sv.memberIds, userOf: (id) => S.users[id] || null }),
      wordfilter: (sv) => WF.serverTab(sv, body),
      reports: (sv) => reportsTab(sv, body, { jumpTo: (id) => { mdl.close(); jumpToMessageId(id); } }) })[tab](s);
  };

  function overview(s) {
    const th = s.theme || {};
    const name = h('input', { class: 'input', maxlength: '64', value: s.name });
    const desc = h('textarea', { class: 'input', rows: '3', maxlength: '300', placeholder: 'What is this server about?' });
    desc.value = s.description || '';
    const pickFile = (cb) => { const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', onchange: () => f.files[0] && cb(f.files[0]) }); f.click(); };
    const upload2 = (path, file, field = 'file') => { const fd = new FormData(); fd.append(field, file); return api('POST', path, fd); };
    add(body, h('h3', null, 'Overview'),
      h('div', { class: 'ss-icon-row' },
        s.icon ? h('img', { class: `ss-icon shape-${th.iconShape || 'rounded'}`, src: s.icon, alt: '' }) : h('span', { class: `ss-icon shape-${th.iconShape || 'rounded'}` }, s.name.slice(0, 2)),
        h('div', { class: 'stack tight' },
          h('button', { class: 'btn ghost sm', onclick: () => pickFile((f) => run(() => upload2(`/servers/${s.id}/icon`, f, 'icon'), 'Icon updated.')) }, 'Change icon (GIFs work)'),
          h('div', { class: 'chips' }, [['rounded', 'Rounded'], ['circle', 'Circle'], ['square', 'Square']].map(([v, l]) => h('button', {
            class: `chip${(th.iconShape || 'rounded') === v ? ' active' : ''}`, onclick: () => run(() => api('PATCH', `/servers/${s.id}`, { theme: { iconShape: v } })),
          }, l))))),
      field('Server name', name), field('Description', desc, 'Shown on invites and at the top of the server.'),
      h('div', null, h('button', { class: 'btn primary', onclick: () => run(() => api('PATCH', `/servers/${s.id}`, { name: name.value, description: desc.value }), 'Saved.') }, 'Save')),
      h('h3', null, 'Banner'),
      h('p', { class: 'muted-p' }, 'Shown above the channel list. Animated GIFs work.'),
      th.banner ? h('div', { class: 'ss-banner' }, h('img', { class: 'cropped', src: th.banner, alt: '', style: cropStyle(th.bannerCrop) })) : null,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost sm', onclick: () => pickFile((f) => run(() => upload2(`/servers/${s.id}/media/banner`, f), 'Banner updated.')) }, th.banner ? 'Change banner' : 'Upload banner'),
        th.banner ? h('button', { class: 'btn ghost sm', onclick: () => openCropper({ src: th.banner, kind: 'banner', crop: th.bannerCrop, onSave: (crop) => run(() => api('PATCH', `/servers/${s.id}`, { theme: { bannerCrop: crop } }), 'Banner position saved.') }) }, 'Adjust') : null,
        th.banner ? h('button', { class: 'btn ghost sm', onclick: () => run(() => api('DELETE', `/servers/${s.id}/media/banner`)) }, 'Remove') : null));
    // "New members can't read messages from before they joined" (server/joinhistory.js). Group chats don't have it.
    if (isGroup(s)) return;
    add(body, h('h3', null, 'Privacy'),
      h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'New members can’t read messages from before they joined'),
        h('span', { class: 'field-hint' }, 'Each time someone joins, everyone’s apps switch to a new encryption key, and the newcomer only gets keys from then on. People already here keep everything. Turning this on switches keys once right away.')),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!s.hideHistory, onchange: (e) => {
        const box = e.target;
        // Refused (say, changed too often): the switch goes back to what the server has.
        run(() => api('PATCH', `/servers/${s.id}`, { hideHistory: box.checked }), box.checked ? 'New members will only see messages from after they join.' : 'New members can read earlier messages again.')
          .then(() => { box.checked = !!live().hideHistory; });
      } }), h('span', { class: 'switch-track' }))),
      // Invite link previews (server/invitepreview.js): off, a link's preview only says it's an invite to a server here.
      h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Show this server’s name and member count in invite link previews'),
        h('span', { class: 'field-hint' }, `Anyone who has one of this server’s invite links sees “Join ${s.name} on ${S.config.name}” and how many members it has before signing in, and so do the preview bots of apps the link is pasted into, like Discord’s, Reddit’s and X’s. Never its icon, channels, members or messages. Off, previews only say it’s an invite to a server on ${S.config.name}.`)),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!s.invitePreview, onchange: (e) => {
        const box = e.target;
        run(() => api('PATCH', `/servers/${s.id}`, { invitePreview: box.checked }), box.checked ? 'Invite link previews now show this server’s name.' : 'Invite link previews no longer show this server’s name.')
          .then(() => { box.checked = !!live().invitePreview; });
      } }), h('span', { class: 'switch-track' }))));
    // Server search (server/discovery.js): off until someone turns it on here.
    const about = h('textarea', { class: 'input', rows: '2', maxlength: '200', placeholder: 'What should people know before they join?' });
    about.value = s.discoverAbout || '';
    const tags = h('input', { class: 'input', maxlength: '140', placeholder: 'gaming, art, study', value: (s.discoverTags || []).join(', ') });
    // Turning it off sends only that, so a description or tags that wouldn't pass can't keep it listed.
    const listing = (on) => (on ? { discoverable: true, discoverAbout: about.value, discoverTags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) } : { discoverable: false });
    add(body, h('h3', null, 'Server search'),
      h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Show in server search'),
        h('span', { class: 'field-hint' }, `Anyone on ${S.config.name} can find this server in Search → Servers by its name, the description and tags below, see its icon and member count, and join without an invite. Bans still apply. Never its channels, members or messages. Turn it off and it’s gone from search right away.`)),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!s.discoverable, onchange: (e) => {
        const box = e.target;
        run(() => api('PATCH', `/servers/${s.id}`, listing(box.checked)), box.checked ? 'This server now shows in server search.' : 'This server no longer shows in server search.')
          .then(() => { box.checked = !!live().discoverable; });
      } }), h('span', { class: 'switch-track' }))),
      field('Description for search', about, 'A sentence or two, up to 200 characters. Needed to show in search.'),
      field('Tags', tags, 'Up to 5, separated by commas.'),
      h('div', null, h('button', { class: 'btn ghost', onclick: () => run(() => api('PATCH', `/servers/${s.id}`, { ...listing(true), discoverable: !!live().discoverable }), 'Saved.') }, 'Save search listing')));
  }

  function appearance(s) {
    const th = s.theme || {};
    const bg = { kind: 'none', colors: ['#120338', '#d53369', '#ffb347'], angle: 160, style: 'linear', dim: 0.25, ...(th.background || {}) };
    const save = (theme, msg) => run(() => api('PATCH', `/servers/${s.id}`, { theme }), msg);
    const accentIn = h('input', { type: 'color', class: 'color-in', value: th.accent || '#f2a541', 'aria-label': 'Server accent' });
    const welcome = h('textarea', { class: 'input', rows: '4', maxlength: '600', placeholder: 'Welcome! Read **#rules** and say hi in #general.' });
    welcome.value = th.welcome || '';
    const colorInputs = (bg.colors.length ? bg.colors : ['#120338', '#d53369']).concat(['#ffb347']).slice(0, 3).map((c, i) => h('input', { type: 'color', class: 'color-in', value: c, 'aria-label': `Gradient color ${i + 1}` }));
    const angle = h('input', { type: 'range', class: 'range', min: '0', max: '360', value: String(bg.angle || 160), 'aria-label': 'Gradient angle' });
    const dim = h('input', { type: 'range', class: 'range', min: '0', max: '80', value: String(Math.round((bg.dim ?? 0.25) * 100)), 'aria-label': 'Darken background' });
    const presetGrid = h('div', { class: 'bg-grid' }, BACKGROUNDS.filter((b) => !b.solid).map((b) => h('button', {
      class: `bg-tile${bg.kind === 'preset' && bg.preset === b.id ? ' active' : ''}`,
      onclick: () => save({ background: { ...bg, kind: 'preset', preset: b.id, dim: +dim.value / 100 } }),
    }, h('span', { class: 'bg-sw', style: { background: b.css } }), h('span', { class: 'bg-tile-name' }, b.name))));
    add(body, h('h3', null, 'Appearance'),
      h('p', { class: 'muted-p' }, 'Everyone sees this while they\u2019re in the server (unless they turned off server themes in their own settings).'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Accent color'),
        h('div', { class: 'row gap' }, accentIn,
          h('button', { class: 'btn ghost sm', onclick: () => save({ accent: accentIn.value }, 'Accent saved.') }, 'Use this color'),
          th.accent ? h('button', { class: 'btn ghost sm', onclick: () => save({ accent: '' }) }, 'Use each person\u2019s own') : null)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Background'),
        h('div', { class: 'chips' }, [['none', 'Their own'], ['preset', 'Preset'], ['gradient', 'Custom gradient'], ['image', 'Image']].map(([v, l]) => h('button', {
          class: `chip${bg.kind === v ? ' active' : ''}`,
          onclick: () => (v === 'image' ? (() => { const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', onchange: () => { const fd = new FormData(); fd.append('file', f.files[0]); run(() => api('POST', `/servers/${s.id}/media/background`, fd), 'Background updated.'); } }); f.click(); })()
            : v === 'preset' ? save({ background: { ...bg, kind: 'preset', preset: bg.preset || 'nebula' } }) : save({ background: { ...bg, kind: v } })),
        }, l)))),
      bg.kind === 'preset' ? presetGrid : null,
      bg.kind === 'gradient' ? h('div', { class: 'grad-builder' },
        h('div', { class: 'row gap' }, ...colorInputs),
        h('label', { class: 'slider-row' }, h('span', null, 'Angle'), angle, h('span', { class: 'counter' }, '')),
        h('div', null, h('button', { class: 'btn ghost sm', onclick: () => save({ background: { ...bg, kind: 'gradient', colors: colorInputs.map((c) => c.value), angle: +angle.value, three: true } }, 'Gradient saved.') }, 'Apply gradient'))) : null,
      bg.kind !== 'none' ? h('label', { class: 'slider-row' }, h('span', null, 'Darken'), dim, h('button', { class: 'btn ghost sm', onclick: () => save({ background: { ...bg, dim: +dim.value / 100 } }) }, 'Apply')) : null,
      h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Color names by role'), h('span', { class: 'field-hint' }, 'People who haven\u2019t chosen their own name color show their top role\u2019s color.')),
        h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: th.roleColors !== false, onchange: (e) => save({ roleColors: e.target.checked }) }), h('span', { class: 'switch-track' }))),
      field('Welcome message', welcome, 'Shown at the top of every channel. Markdown works.'),
      h('div', null, h('button', { class: 'btn primary', onclick: () => save({ welcome: welcome.value }, 'Welcome message saved.') }, 'Save welcome message')));
  }

  function roles(s) {
    const myTop = s.ownerId === S.me.id ? Infinity : Math.max(0, ...memberRoles(s, S.me.id).map((r) => r.position));
    const list = (s.roleDefs || []).slice().sort((a, b) => b.position - a.position);
    if (!roleSel || !list.some((r) => r.id === roleSel)) roleSel = (list.find((r) => !r.everyone) || list[0] || {}).id;
    const sel = list.find((r) => r.id === roleSel);
    const editable = (r) => r.everyone || r.position < myTop;
    const move = (r, dir) => {
      const movable = list.filter((x) => !x.everyone && x.position < myTop);
      const i = movable.findIndex((x) => x.id === r.id); const j = i + dir;
      if (i < 0 || j < 0 || j >= movable.length) return;
      [movable[i], movable[j]] = [movable[j], movable[i]];
      run(() => api('POST', `/servers/${s.id}/roles/order`, { ids: movable.map((x) => x.id) }));
    };
    const side = h('div', { class: 'role-list' },
      h('button', { class: 'btn primary sm block', onclick: () => run(async () => { const r = await api('POST', `/servers/${s.id}/roles`, { name: 'new role', color: '#5c8dff' }); roleSel = r.id; }) }, icon('plus'), 'Create role'),
      ...list.map((r) => h('div', { class: `role-row${r.id === roleSel ? ' active' : ''}` },
        h('button', { class: 'role-pick', onclick: () => { roleSel = r.id; draw(); } },
          h('span', { class: 'role-dot', style: { background: r.color || 'var(--muted)' } }), r.icon ? h('span', null, r.icon) : null,
          h('span', { class: 'role-name' }, r.name), h('span', { class: 'role-count' }, r.everyone ? '' : String(Object.values(s.memberRoles || {}).filter((l) => l.includes(r.id)).length))),
        !r.everyone && editable(r) ? h('span', { class: 'role-move' }, ibtn('arrowUp', 'Move up', () => move(r, -1), { cls: 'sm' }), ibtn('arrowDown', 'Move down', () => move(r, 1), { cls: 'sm' })) : null)),
      h('p', { class: 'field-hint' }, 'Higher roles outrank lower ones. You can only edit roles below your own highest role.'));
    const editor = h('div', { class: 'role-editor' });
    if (sel) {
      const locked = !editable(sel);
      const d = { name: sel.name, color: sel.color, icon: sel.icon, hoist: sel.hoist, mentionable: sel.mentionable, permissions: sel.permissions, selfAssign: !!sel.selfAssign };
      const nameIn = h('input', { class: 'input', maxlength: '32', value: d.name, disabled: sel.everyone || locked, oninput: (e) => { d.name = e.target.value; } });
      const iconIn = h('input', { class: 'input emoji-input', maxlength: '4', value: d.icon || '', placeholder: '\u2728', disabled: sel.everyone || locked, oninput: (e) => { d.icon = e.target.value; } });
      const swatches = ['#f2a541', '#ef5466', '#ff7ab6', '#b07cff', '#5c8dff', '#38c6d9', '#3fcf83', '#c4e05a', '#ffffff', ''];
      const swEl = h('div', { class: 'swatches' });
      const drawSw = () => clear(swEl).append(...swatches.map((c) => h('button', { class: `swatch${d.color === c ? ' active' : ''}${c ? '' : ' none'}`, style: c ? { background: c } : null, 'aria-label': c || 'No color', disabled: sel.everyone || locked, onclick: () => { d.color = c; drawSw(); } }, c ? null : icon('ban'))),
        h('input', { type: 'color', class: 'color-in', value: d.color || '#5c8dff', 'aria-label': 'Custom role color', disabled: sel.everyone || locked, oninput: (e) => { d.color = e.target.value; drawSw(); } }));
      drawSw();
      const tg = (label, hint, val, on) => h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, label), hint ? h('span', { class: 'field-hint' }, hint) : null),
        h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!val, disabled: locked, onchange: (e) => on(e.target.checked) }), h('span', { class: 'switch-track' })));
      const mine = myPerms(s);
      // "Members can pick this role themselves": off (and saying why) for roles that can't be, as the server
      // would refuse. Rechecked as permissions are ticked below.
      const selfHint = h('span', { class: 'field-hint' });
      const selfIn = h('input', { type: 'checkbox', checked: d.selfAssign, onchange: (e) => { d.selfAssign = e.target.checked; drawSelf(); } });
      const drawSelf = () => {
        const why = selfAssignProblem(s, sel, d.permissions, mine);
        // Turning it on needs no problem at all; a role that already has it only can't gain the powers it bars.
        const refused = d.selfAssign && (sel.selfAssign ? !!(d.permissions & SELF_BLOCKED & ~sel.permissions) : !!why);
        selfIn.disabled = locked || (!!why && !d.selfAssign);
        selfHint.textContent = why ? (refused ? `${why} Turn this off, or saving won\u2019t work.` : why)
          : 'They\u2019ll find it in Pick your roles in the server menu: good for ping roles like @game-night, pronouns, colors and opt-in channels.';
        selfHint.classList.toggle('warn', !!why);
      };
      drawSelf();
      const selfRow = h('label', { class: 'toggle-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, 'Members can pick this role themselves'), selfHint),
        h('span', { class: 'switch' }, selfIn, h('span', { class: 'switch-track' })));
      const permsEl = h('div', { class: 'perm-groups' }, PERM_GROUPS.map(([g, list2]) => h('div', { class: 'perm-group' }, h('div', { class: 'perm-group-label' }, g),
        ...list2.map(([k, label, hint]) => tg(label, hint + (has(mine, PERMS[k]) ? '' : ' (You don\u2019t have this yourself, so you can\u2019t give it.)'), has(d.permissions, PERMS[k]), (on) => { d.permissions = on ? d.permissions | PERMS[k] : d.permissions & ~PERMS[k]; drawSelf(); })))));
      const holders = s.memberIds.filter((id) => ((s.memberRoles || {})[id] || []).includes(sel.id));
      const addSel = h('select', { class: 'input sm', 'aria-label': 'Add member to role' }, h('option', { value: '' }, 'Add member\u2026'),
        s.memberIds.filter((id) => !holders.includes(id)).map((id) => h('option', { value: id }, nameInServer(s, getUser(id)))));
      // Only this role changes (not the member's whole list as this window last saw it, which may be out of date).
      addSel.onchange = () => { const id = addSel.value; if (id) run(() => api('PUT', `/servers/${s.id}/members/${id}/roles`, { add: [sel.id] })); };
      add(editor, 
        h('div', { class: 'role-editor-head' }, h('h3', null, sel.everyone ? '@everyone' : `Edit role \u2014 ${sel.name}`),
          locked ? h('span', { class: 'role-tag' }, 'Above your highest role') : null),
        sel.everyone ? h('p', { class: 'muted-p' }, 'Default permissions for everyone in the server. Other roles add to these.') : h('div', { class: 'stack' },
          h('div', { class: 'row gap' }, field('Role name', nameIn), field('Icon', iconIn)),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), swEl),
          tg('Show separately in the member list', 'Members with this as their highest such role get their own section.', d.hoist, (v) => { d.hoist = v; }),
          tg('Allow anyone to @mention this role', 'People with "Mention @everyone" can always mention it.', d.mentionable, (v) => { d.mentionable = v; }),
          selfRow),
        h('h3', null, 'Permissions'), permsEl,
        sel.everyone ? null : h('h3', null, `Members \u2014 ${holders.length}`),
        sel.everyone ? null : h('div', { class: 'role-members' },
          ...holders.map((id) => { const u = getUser(id); return h('span', { class: 'chip active' }, avatarEl(u, 20), nameInServer(s, u), locked ? null : h('button', { class: 'chip-x', 'aria-label': `Remove ${nameInServer(s, u)} from role`, onclick: () => run(() => api('PUT', `/servers/${s.id}/members/${id}/roles`, { remove: [sel.id] })) }, icon('close'))); }),
          locked ? null : mayGiveRole(s, sel) ? addSel : h('span', { class: 'field-hint' }, 'It has permissions you don\u2019t have, so you can\u2019t give it (you can take it away).')),
        locked ? null : h('div', { class: 'role-actions' },
          !sel.everyone ? h('button', { class: 'btn danger-ghost', onclick: async () => { if (await confirmDialog({ title: `Delete ${sel.name}?`, text: 'Everyone loses this role. This can\u2019t be undone.', confirm: 'Delete role', danger: true })) run(() => api('DELETE', `/roles/${sel.id}`), 'Role deleted.'); } }, 'Delete role') : h('span'),
          h('button', { class: 'btn primary', onclick: () => run(() => api('PATCH', `/roles/${sel.id}`, d), 'Role saved.') }, 'Save changes')));
    }
    add(body, h('div', { class: 'roles-layout' }, side, editor));
  }

  function members(s) {
    const q = h('input', { class: 'input search-input', placeholder: 'Search members', 'aria-label': 'Search members' });
    const listEl = h('div', { class: 'stack tight' });
    const drawList = () => {
      clear(listEl);
      const term = q.value.trim().toLowerCase();
      const muted = new Set(s.voiceMutes || []);
      s.memberIds.map(getUser).filter((u) => nameMatches(u, term, s)).forEach((u) => {
        const rs = memberRoles(s, u.id);
        add(listEl, h('div', { class: 'ss-row' }, avatarEl(u, 32, { status: true, meId: S.me.id }),
          h('span', { class: 'ss-row-name' }, nameEl(u, { roleColor: topColor(s, u.id), server: s }), h('span', null, u.username + (s.ownerId === u.id ? ' \u00b7 Owner' : '') + (muted.has(u.id) ? ' \u00b7 Server muted' : ''))),
          h('span', { class: 'role-chips' }, ...rs.map((r) => h('span', { class: 'role-chip', style: r.color ? { '--rc': r.color } : null }, r.icon ? r.icon + ' ' : '', r.name))),
          ibtn('more', 'Manage', (e) => menu(e.currentTarget, memberMenuItems(s, u), { align: 'end' }), { cls: 'sm', attrs: { 'data-pop-anchor': '' } })));
      });
    };
    q.addEventListener('input', drawList);
    drawList();
    // Everyone a moderator server-muted (people with Mute Members get this list), with a way to lift it, since
    // outside a call nothing else shows it.
    const mutedNow = (s.voiceMutes || []).filter((id) => s.memberIds.includes(id));
    if (mutedNow.length) {
      // Only someone below you can be unmuted by you (the server checks it again).
      const top = (id) => (s.ownerId === id ? Infinity : Math.max(0, ...memberRoles(s, id).map((r) => r.position)));
      add(body, h('h3', null, `Server muted \u2014 ${mutedNow.length}`), h('p', { class: 'muted-p' }, 'Nobody hears them in this server\u2019s voice channels until the mute is lifted.'),
        h('div', { class: 'stack tight' }, mutedNow.map(getUser).map((u) => h('div', { class: 'ss-row' }, avatarEl(u, 30), h('span', { class: 'ss-row-name' }, nameEl(u, { roleColor: topColor(s, u.id), server: s }), h('span', null, u.username)),
          top(u.id) < top(S.me.id)
            ? h('button', { class: 'btn ghost sm', 'aria-label': `Remove server mute for ${nameInServer(s, u)}`, onclick: () => run(() => api('DELETE', `/servers/${s.id}/voice/${u.id}/mute`), `${nameInServer(s, u)} can talk again.`) }, 'Remove mute')
            : h('span', { class: 'field-hint' }, 'Above your highest role')))));
    }
    add(body, h('h3', null, `Members \u2014 ${s.memberIds.length}`), h('div', { class: 'friends-search' }, icon('search'), q), listEl);
  }

  function emoji(s) {
    const list = s.emojis || [];
    // Pick one or many images (animated GIF/WebP/PNG welcome). Each is made to fit 128×128 first (emoji-upload.js) and
    // shown as it will look (in a line of text and on its own), with a name suggested from its file name.
    const queue = h('div', { class: 'emoji-queue' });
    const pending = [];
    const taken = () => new Set([...list.map((e) => e.name), ...pending.map((it) => it.name)]);
    const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/png,image/gif,image/webp,image/jpeg', hidden: true, onchange: () => {
      for (const f of fileIn.files) {
        const item = { file: f, name: suggestName(f.name, taken()), prep: null };
        pending.push(item);
        prepareEmoji(f).catch(() => ({ error: 'That picture couldn\u2019t be opened.' })).then((r) => {
          item.prep = r;
          if (r.blob) item.url = URL.createObjectURL(r.blob);
          if (pending.includes(item)) drawQueue();
        });
      }
      fileIn.value = '';
      drawQueue();
    } });
    const forget = (it) => { if (it.url) URL.revokeObjectURL(it.url); pending.splice(pending.indexOf(it), 1); };
    const infoOf = (p) => {
      if (!p) return 'Getting it ready\u2026';
      if (p.error) return p.error;
      const size = `${p.width}\u00d7${p.height}`;
      if (p.note) return `${p.note} \u00b7 ${size}`;
      return p.was ? `Shrunk from ${p.was.width}\u00d7${p.was.height} to ${size} \u00b7 ${sizeLabel(p.blob.size)}` : `${size} \u00b7 ${sizeLabel(p.blob.size)}`;
    };
    const drawQueue = () => {
      clear(queue);
      pending.forEach((it) => queue.append(h('div', { class: `emoji-admin pending-emoji${it.prep && it.prep.error ? ' bad' : ''}` },
        it.url ? h('span', { class: 'ep-sizes', 'aria-hidden': 'true' }, h('img', { class: 'cemoji s-jumbo', src: it.url, alt: '' }), h('img', { class: 'cemoji s-inline', src: it.url, alt: '' })) : null,
        h('input', { class: 'input sm', value: it.name, maxlength: '32', 'aria-label': 'Emoji name', oninput: (e) => { it.name = e.target.value; } }),
        ibtn('close', 'Remove', () => { forget(it); drawQueue(); }, { cls: 'sm' }),
        h('span', { class: `ep-info${it.prep && it.prep.error ? ' bad' : ''}`, role: it.prep && it.prep.error ? 'alert' : null }, infoOf(it.prep)))));
      const ready = pending.filter((it) => it.prep && it.prep.blob);
      const waiting = pending.some((it) => !it.prep);
      if (pending.length) queue.append(h('div', { class: 'row gap' }, h('button', { class: 'btn primary', disabled: waiting || !ready.length, onclick: async (e) => {
        e.currentTarget.disabled = true;
        let ok = 0;
        for (const it of ready) {
          const fd = new FormData(); fd.append('file', it.prep.blob, it.prep.filename); fd.append('name', it.name);
          try { await api('POST', `/servers/${s.id}/emojis`, fd); ok++; forget(it); } catch (err) { toast(`:${it.name}: \u2014 ${err.message}`, 'error'); }
        }
        if (ok) toast(`Added ${ok} emoji.`);
        await nextServerUpdate(s.id);
        draw();
      } }, `Upload ${ready.length} emoji`), h('span', { class: 'field-hint' }, 'Names can use letters, numbers and _')));
    };
    const fromGiphy = () => {
      let m;
      const panel = gifPanel({ startTab: 'stickers', height: 420, onPick: (g) => {
        m.close();
        const nameIn = h('input', { class: 'input', maxlength: '32', value: suggestName(`${g.title || 'gif'}.gif`, taken()) });
        modal({ title: 'Name your emoji', size: 'sm', body: h('div', { class: 'stack' }, h('div', { class: 'row gap' }, h('img', { class: 'cemoji big', src: mediaUrl(g.preview), alt: '' }), field('Name', nameIn))),
          actions: [{ label: 'Cancel' }, { label: 'Add emoji', kind: 'primary', action: () => run(() => api('POST', `/servers/${s.id}/emojis/from-giphy`, { gifId: g.id, name: nameIn.value }), `Added :${nameIn.value}:`) }] });
      } });
      m = modal({ title: 'Add an emoji from GIPHY', size: 'md', className: 'giphy-emoji', body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, 'Stickers make great emoji. A small version is saved to this server.'), panel) });
    };
    const animated = list.filter((e) => e.animated).length;
    add(body, h('h3', null, `Emoji \u2014 ${list.length} / 200`),
      h('p', { class: 'muted-p' }, `Members can use these in any server or DM and as reactions. PNG, JPG, GIF or WebP up to 2 MB \u2014 animated GIF, WebP and PNG keep moving. Every emoji is stored at most 128\u00d7128: bigger pictures and GIFs are shrunk for you, keeping their shape and transparency.${animated ? ` (${animated} animated)` : ''}`),
      h('div', { class: 'emoji-upload' },
        h('button', { class: 'btn primary', onclick: () => fileIn.click() }, icon('plus'), 'Upload emoji'),
        S.config.gifsEnabled ? h('button', { class: 'btn ghost', onclick: fromGiphy }, icon('gif'), 'Add from GIPHY') : null,
        h('span', { class: 'field-hint' }, 'You can pick several files at once.'), fileIn),
      queue,
      h('div', { class: 'emoji-admin-grid' }, list.map((e) => h('div', { class: 'emoji-admin' },
        h('img', { class: 'cemoji big', src: e.url, alt: '' }),
        h('input', { class: 'input sm', value: e.name, 'aria-label': 'Emoji name', onchange: (ev) => run(() => api('PATCH', `/emojis/${e.id}`, { name: ev.target.value })) }),
        e.animated ? h('span', { class: 'gif-badge', 'data-tip': 'Animated' }, 'GIF') : null,
        ibtn('trash', `Delete :${e.name}:`, () => run(() => api('DELETE', `/emojis/${e.id}`)), { cls: 'sm' })))));
    drawQueue();
  }

  async function bans(s) {
    add(body, h('h3', null, 'Bans'));
    const host = h('div', { class: 'stack tight' }, h('span', { class: 'spinner' }));
    add(body, host);
    try {
      const list = await api('GET', `/servers/${s.id}/bans`);
      clear(host);
      if (!list.length) add(host, h('p', { class: 'muted-p' }, 'No one is banned.'));
      list.forEach((b) => add(host, h('div', { class: 'ss-row' }, avatarEl(b.user, 30), h('span', { class: 'ss-row-name' }, displayName(b.user), h('span', null, b.reason || 'No reason given')),
        h('button', { class: 'btn ghost sm', onclick: () => api('DELETE', `/servers/${s.id}/bans/${b.user.id}`).then(() => { toast('Unbanned.'); draw(); }).catch((e) => toast(e.message, 'error')) }, 'Unban'))));
    } catch (e) { clear(host).append(h('p', { class: 'form-error' }, e.message)); }
  }

  // Invite links that still work, newest first, with who made them; a leaked or old one can be revoked here.
  async function invites(s) {
    add(body, h('h3', null, 'Invites'));
    const host = h('div', { class: 'stack tight' }, h('span', { class: 'spinner' }));
    add(body, host);
    try {
      const list = await api('GET', `/servers/${s.id}/invites`);
      clear(host);
      if (!list.length) add(host, h('p', { class: 'muted-p' }, 'No invite links are active.'));
      list.forEach((i) => add(host, h('div', { class: 'ss-row' }, avatarEl(getUser(i.creatorId), 30),
        h('span', { class: 'ss-row-name' }, h('span', { class: 'mono' }, i.code),
          h('span', null, [`by ${nameInServer(s, getUser(i.creatorId))}`, `${i.uses}${i.maxUses ? ` of ${i.maxUses}` : ''} use${i.uses === 1 && !i.maxUses ? '' : 's'}`,
            i.expiresAt ? `expires ${fmtStamp(i.expiresAt)}` : 'never expires'].join(' \u00b7 '))),
        h('button', { class: 'btn ghost sm danger-text', onclick: () => api('DELETE', `/invites/${encodeURIComponent(i.code)}`).then(() => { toast('Invite revoked.'); draw(); }).catch((e) => toast(e.message, 'error')) }, 'Revoke'))));
    } catch (e) { clear(host).append(h('p', { class: 'form-error' }, e.message)); }
  }

  function danger(s) {
    const transfer = h('select', { class: 'input', 'aria-label': 'New owner' }, h('option', { value: '' }, 'Choose a member'),
      s.memberIds.filter((id) => id !== S.me.id).map((id) => h('option', { value: id }, `${nameInServer(s, getUser(id))} (${getUser(id).username})`)));
    add(body, h('h3', null, 'Danger zone'),
      h('div', { class: 'danger-zone' }, h('strong', null, 'Transfer ownership'), h('p', { class: 'muted-p' }, 'You\u2019ll keep your roles but lose owner powers.'),
        h('div', { class: 'row gap' }, transfer, h('button', { class: 'btn ghost', onclick: async () => {
          if (!transfer.value) return;
          // Needs your password (and a two-factor code when it's on): it can't be undone.
          try {
            // Start waiting for the live update only as the request goes out (typing the password can take longer
            // than the wait lasts, and then the tabs would redraw from the old data, still showing owner controls).
            let wait = null;
            const done = await confirmedCall(app, (x) => { wait = nextServerUpdate(s.id); return api('POST', `/servers/${s.id}/transfer`, { userId: transfer.value, ...x }); },
              { title: 'Transfer ownership?', text: `You will lose owner controls for ${s.name}. Enter your password to confirm.`, button: 'Transfer' });
            if (!done) return;
            await wait; toast('Ownership transferred.'); draw();
          } catch (e) { if (!e.cancelled) toast(e.message, 'error'); }
        } }, 'Transfer'))),
      h('div', { class: 'danger-zone' }, h('strong', null, 'Delete server'), h('p', { class: 'muted-p' }, 'Deletes every channel, message and file. This can\u2019t be undone.'),
        h('div', null, h('button', { class: 'btn danger', onclick: async () => { if (await deleteServer(s)) mdl.close(); } }, 'Delete server'))));
  }

  const mdl = modal({ title: `${server.name} \u2014 server settings`, size: 'xl', className: 'server-settings', body: h('div', { class: 'ss' }, nav, body) });
  draw();
}

// Needs your password (and a two-factor code when it's on), like other changes that can't be undone.
async function deleteServer(server) {
  try {
    const done = await confirmedCall(app, (x) => api('DELETE', `/servers/${server.id}`, x).then(() => true),
      { title: `Delete ${server.name}?`, text: 'This deletes every channel and message in it. This cannot be undone. Enter your password to confirm.', button: 'Delete server' });
    return !!done;
  } catch (e) { if (!e.cancelled) toast(e.message, 'error'); return false; }
}
function categoryField(server, value) {
  const cats = orderedCategories(server);
  const input = h('input', { class: 'input', maxlength: '32', value: value || '', list: 'cat-options', placeholder: 'Text' });
  return { input, el: h('div', null, input, h('datalist', { id: 'cat-options' }, cats.map((c) => h('option', { value: c })))) };
}
// The category Create channel starts with when none was picked: Text or Voice, as on the server, when that's in this
// person's list (or they have none). Otherwise the first of theirs with a channel of that type, or their first: a
// Text they don't see may be a category of channels they can't see, which the server won't add channels to.
function defaultCategory(server, type) {
  const def = type === 'voice' ? 'Voice' : 'Text';
  const cats = orderedCategories(server);
  if (!cats.length || cats.includes(def)) return def;
  return cats.find((k) => server.channels.some((c) => c.type === type && catOf(c) === k)) || cats[0];
}
function openCreateChannel(server, type, category) {
  let t = type;
  const name = h('input', { class: 'input', maxlength: '48', placeholder: type === 'text' ? 'new-channel' : 'Hangout' });
  const cat = categoryField(server, category || defaultCategory(server, type));
  const opt = (val, label, desc) => h('label', { class: 'radio-card' },
    h('input', { type: 'radio', name: 'ctype', value: val, checked: t === val, onchange: () => { t = val; } }),
    icon(val === 'text' ? 'hash' : 'speaker'), h('span', null, h('strong', null, label), h('span', null, desc)));
  modal({
    title: 'Create channel', size: 'sm',
    body: h('div', { class: 'stack' }, opt('text', 'Text', 'Messages, images, GIFs, files'), opt('voice', 'Voice', 'Talk together with your mic'), field('Channel name', name), field('Category', cat.el, 'Pick an existing category or type a new one.')),
    actions: [
      { label: 'Cancel' },
      { label: 'Create channel', kind: 'primary', action: async () => {
        const ch = await api('POST', `/servers/${server.id}/channels`, { name: name.value, type: t, category: cat.input.value.trim() });
        if (ch.type === 'text') openChannel(ch.id, server.id);
      } },
    ],
  });
  setTimeout(() => name.focus(), 30);
}
function openCreateCategory(server) {
  const name = h('input', { class: 'input', maxlength: '32', placeholder: 'Information' });
  const chan = h('input', { class: 'input', maxlength: '48', placeholder: 'announcements' });
  modal({
    title: 'Create category', size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted-p' }, 'Categories group channels in the sidebar. Every category needs at least one channel.'),
      field('Category name', name), field('First channel', chan)),
    actions: [{ label: 'Cancel' }, { label: 'Create', kind: 'primary', action: async () => {
      if (!name.value.trim()) throw new Error('Give the category a name.');
      const ch = await api('POST', `/servers/${server.id}/channels`, { name: chan.value || 'general', type: 'text', category: name.value.trim() });
      openChannel(ch.id, server.id);
    } }],
  });
}
// overrides: what was just saved, when the live update with it may not have arrived yet.
function openEditChannel(c, startTab = 'overview', { overrides } = {}) {
  const server = serverOfChannel(c.id) || S.servers.find((s) => s.id === c.serverId);
  if (!server) return;
  const fresh = () => (serverOfChannel(c.id) || server).channels.find((x) => x.id === c.id) || c;
  const ch0 = fresh();
  const mayEdit = canEditChannel(server, ch0); const mayPerms = canEditChannelPerms(server, ch0); const mayHooks = canManageHooks(server, ch0);
  const TABS = [['overview', 'Overview', mayEdit], ['perms', 'Permissions', mayPerms], ['hooks', 'Webhooks', mayHooks]].filter((t) => t[2]);
  let tab = TABS.some(([k]) => k === startTab) ? startTab : (TABS[0] || ['overview'])[0];
  // Overrides being edited: [{ type, id, allow, deny }]; @everyone always listed first.
  let ovs = (overrides || ch0.overrides || []).map((o) => ({ ...o }));
  if (!ovs.some((o) => o.type === 'role' && o.id === server.id)) ovs.unshift({ type: 'role', id: server.id, allow: 0, deny: 0 });
  let selKey = `role:${server.id}`;
  const name = h('input', { class: 'input', maxlength: '48', value: ch0.name });
  const topic = h('textarea', { class: 'input', maxlength: '300', rows: '3', placeholder: 'What is this channel for?' });
  topic.value = ch0.topic || '';
  const cat = categoryField(server, ch0.category);
  const slow = h('select', { class: 'input' }, [[0, 'Off'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour'], [21600, '6 hours']].map(([v, l]) => h('option', { value: String(v) }, l)));
  slow.value = String(ch0.slowmode || 0);
  const dis = h('select', { class: 'input' }, timerChoices().map((v) => h('option', { value: String(v) }, disLabel(v))));
  dis.value = String(ch0.disappear || 0);
  const tabs = h('div', { class: 'seg' });
  const body = h('div', { class: 'stack' });
  // A voice channel's chat follows the chat permissions too (deny Send Messages to keep it voice only); it has no threads.
  const VOICE_CHAT = hasChat(ch0) ? ['SEND_MESSAGES', 'EMBED_LINKS', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE', 'MANAGE_MESSAGES'] : [];
  const scoped = PERM_GROUPS.flatMap(([, l]) => l).filter(([k]) => (c.type === 'voice'
    ? ['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'MOVE_MEMBERS', 'USE_SOUNDBOARD', 'MANAGE_CHANNELS', 'MANAGE_ROLES', ...VOICE_CHAT]
    : ['VIEW_CHANNEL', 'SEND_MESSAGES', 'CREATE_THREADS', 'EMBED_LINKS', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE', 'MANAGE_MESSAGES', 'MANAGE_CHANNELS', 'MANAGE_ROLES']).includes(k));
  const label = (o) => {
    if (o.type === 'member') return nameInServer(server, getUser(o.id));
    const r = (server.roleDefs || []).find((x) => x.id === o.id);
    return r ? (r.everyone ? '@everyone' : r.name) : 'Deleted role';
  };
  const draw = () => {
    clear(tabs);
    TABS.forEach(([k, l]) => tabs.append(h('button', { class: `seg-btn${tab === k ? ' active' : ''}`, onclick: () => { tab = k; draw(); } }, l)));
    clear(body);
    // Save is for the Overview and Permissions tabs; webhooks save as you go, so it's hidden there.
    const save = body.closest('.modal') && body.closest('.modal').querySelector('.modal-foot .btn.primary');
    if (save) save.hidden = tab === 'hooks';
    if (tab === 'overview') {
      body.append(field('Channel name', name), ...(c.type === 'text' ? [field('Topic', topic)] : []),
        ...(hasChat(ch0) ? [field('Slowmode', slow, `How long people wait between messages${c.type === 'voice' ? ' in its chat' : ''}. Anyone with Manage Messages skips it.`),
          field('Disappearing messages', dis, `New messages${c.type === 'voice' ? ' in its chat' : ''} disappear this long after they\u2019re sent. Messages already here aren\u2019t affected.`)] : []), field('Category', cat.el));
      return;
    }
    // Webhooks save as you go (webhooks.js). Enter in its fields stays there: the dialog would otherwise take it as
    // "Save" and quietly save the other tabs too.
    if (tab === 'hooks') {
      const panel = h('div', { class: 'stack hooks-panel', onkeydown: (e) => { if (e.key === 'Enter') e.stopPropagation(); } });
      body.append(panel);
      webhooksPanel(fresh(), panel);
      return;
    }
    const sel = ovs.find((o) => `${o.type}:${o.id}` === selKey) || ovs[0];
    const addable = [
      ...(server.roleDefs || []).filter((r) => !ovs.some((o) => o.type === 'role' && o.id === r.id)).map((r) => ({ type: 'role', id: r.id, label: r.name })),
      ...server.memberIds.filter((id) => !ovs.some((o) => o.type === 'member' && o.id === id)).map((id) => ({ type: 'member', id, label: nameInServer(server, getUser(id)) })),
    ];
    const addSel = h('select', { class: 'input sm', 'aria-label': 'Add a role or member' }, h('option', { value: '' }, '+ Add role or member'),
      addable.map((a) => h('option', { value: `${a.type}:${a.id}` }, `${a.type === 'role' ? '\u25C6 ' : '\u25CF '}${a.label}`)));
    addSel.onchange = () => { const [type, id] = addSel.value.split(':'); if (!id) return; ovs.push({ type, id, allow: 0, deny: 0 }); selKey = `${type}:${id}`; draw(); };
    const state = (o, bit) => (o.allow & bit ? 'allow' : o.deny & bit ? 'deny' : 'inherit');
    const setState = (o, bit, v) => { o.allow &= ~bit; o.deny &= ~bit; if (v === 'allow') o.allow |= bit; if (v === 'deny') o.deny |= bit; draw(); };
    body.append(
      h('p', { class: 'muted-p' }, 'Override what roles or specific people can do in this channel. \u2713 allows, \u2715 denies, and / uses their normal role permissions.'),
      h('div', { class: 'ov-layout' },
        h('div', { class: 'ov-list' }, ...ovs.map((o) => h('div', { class: `role-row${`${o.type}:${o.id}` === `${sel.type}:${sel.id}` ? ' active' : ''}` },
          h('button', { class: 'role-pick', onclick: () => { selKey = `${o.type}:${o.id}`; draw(); } },
            o.type === 'member' ? avatarEl(getUser(o.id), 18) : h('span', { class: 'role-dot', style: { background: ((server.roleDefs || []).find((r) => r.id === o.id) || {}).color || 'var(--muted)' } }),
            h('span', { class: 'role-name' }, label(o))),
          o.type === 'role' && o.id === server.id ? null : ibtn('close', 'Remove override', () => { ovs = ovs.filter((x) => x !== o); selKey = `role:${server.id}`; draw(); }, { cls: 'sm' }))), addSel),
        h('div', { class: 'ov-perms' }, h('div', { class: 'perm-group-label' }, label(sel)),
          ...scoped.map(([k, l, hint0]) => {
            const bit = PERMS[k]; const st = state(sel, bit);
            // Pings are checked by each reader's app against the server-wide permission (see mayMentionRole).
            // A voice channel's chat is read by everyone who can see the channel, Connect or not.
            const hint = k === 'MENTION_EVERYONE' ? 'Needs the permission server-wide too: allowing it only here doesn\u2019t make pings work. Denying it here hides the suggestions.'
              : k === 'SEND_MESSAGES' && c.type === 'voice' ? 'Write in its chat. Everyone who can see this channel can read the chat, whether or not they may join the call.' : hint0;
            return h('div', { class: 'ov-row' }, h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, l), hint ? h('span', { class: 'field-hint' }, hint) : null),
              h('div', { class: 'tri', role: 'radiogroup', 'aria-label': l },
                h('button', { class: `tri-btn deny${st === 'deny' ? ' on' : ''}`, 'aria-label': 'Deny', 'data-tip': 'Deny', onclick: () => setState(sel, bit, 'deny') }, icon('close')),
                h('button', { class: `tri-btn${st === 'inherit' ? ' on' : ''}`, 'aria-label': 'Inherit', 'data-tip': 'Use role permissions', onclick: () => setState(sel, bit, 'inherit') }, '/'),
                h('button', { class: `tri-btn allow${st === 'allow' ? ' on' : ''}`, 'aria-label': 'Allow', 'data-tip': 'Allow', onclick: () => setState(sel, bit, 'allow') }, icon('check'))));
          }))));
  };
  modal({
    title: `${c.type === 'voice' ? '\uD83D\uDD0A' : '#'} ${ch0.name} \u2014 settings`, size: 'lg', className: 'channel-settings',
    body: h('div', { class: 'stack' }, tabs, body),
    actions: [
      mayEdit ? { label: 'Delete channel', kind: 'danger-ghost', action: () => deleteChannel(c) } : null,
      { label: mayEdit || mayPerms ? 'Cancel' : 'Close' },
      mayEdit || mayPerms ? { label: 'Save', kind: 'primary', action: async () => {
        // Each part only when it's yours to change here, so one refusal doesn't stop the other from saving.
        if (mayEdit) await api('PATCH', `/channels/${c.id}`, { name: name.value, topic: topic.value, category: cat.input.value.trim(), slowmode: +slow.value });
        if (mayPerms) await api('PUT', `/channels/${c.id}/overrides`, { overrides: ovs.filter((o) => o.allow || o.deny) });
        // The timer has its own route, so every change is logged and shown in the channel. Last, so the rest is saved
        // either way; refused, the dialog shows why and stays open, and cancelling the question keeps it open too.
        if (mayEdit && hasChat(ch0) && +dis.value !== (fresh().disappear || 0) && !(await setDisappearing('c:' + c.id, +dis.value, { quiet: true, raise: true }))) return false;
        toast('Channel saved.');
      } } : null,
    ].filter(Boolean),
  });
  draw();
}

async function deleteChannel(c) {
  if (await confirmDialog({ title: `Delete ${c.name}?`, text: 'All of its messages will be deleted too.', confirm: 'Delete channel', danger: true })) await api('DELETE', `/channels/${c.id}`).catch((e) => toast(e.message, 'error'));
}

// New DM, new group chat, or adding people to a group. Friends are listed first, then people you share a server
// with (those are the only people a group can include).
const GROUP_MAX = 25;
function openNewConversation(existingGroup = null, { group = false, preselect = [] } = {}) {
  const isFriend = (id) => (S.relationships[id] || {}).status === 'accepted';
  const known = Object.values(S.users).filter((u) => u.id !== S.me.id && !u.bot && !u.deleted && !S.blocked.has(u.id) && (!existingGroup || !existingGroup.memberIds.includes(u.id)));
  const room = existingGroup ? GROUP_MAX - existingGroup.memberIds.length : GROUP_MAX - 1;
  const picked = new Set(preselect.filter((id) => known.some((u) => u.id === id)));
  const groupMode = () => !!existingGroup || group || picked.size > 1;
  const input = h('input', { class: 'input', placeholder: 'Search friends and people you know', 'aria-label': 'Search people' });
  const nameIn = h('input', { class: 'input', maxlength: '64', placeholder: 'Optional, e.g. "Study group" or "Squad"' });
  const nameField = field('Group name', nameIn);
  const chips = h('div', { class: 'pick-chips' });
  const results = h('div', { class: 'quick-list' });
  const hint = h('p', { class: 'field-hint' });
  const row = (u) => h('button', { class: `quick-row${picked.has(u.id) ? ' picked' : ''}`, 'aria-pressed': String(picked.has(u.id)), onclick: () => {
    if (picked.has(u.id)) picked.delete(u.id); else if (picked.size < room) picked.add(u.id); else toast(`A group chat can have up to ${GROUP_MAX} people.`);
    draw();
  } },
  avatarEl(u, 30, { status: true, meId: S.me.id }), h('span', { class: 'quick-text' }, h('strong', null, displayName(u)), h('span', null, u.username)),
  h('span', { class: 'pick-box' }, picked.has(u.id) ? icon('check') : null));
  const draw = () => {
    clear(chips);
    picked.forEach((id) => { const u = getUser(id); chips.append(h('button', { class: 'chip active', onclick: () => { picked.delete(id); draw(); } }, displayName(u), icon('close'))); });
    clear(results);
    const q = input.value.trim().toLowerCase();
    const match = (u) => nameMatches(u, q);
    const byName = (a, b) => displayName(a).localeCompare(displayName(b));
    const friends = known.filter((u) => isFriend(u.id) && match(u)).sort(byName);
    const others = known.filter((u) => !isFriend(u.id) && match(u)).sort(byName).slice(0, 40);
    if (friends.length) results.append(h('div', { class: 'list-label' }, `Friends — ${friends.length}`), ...friends.map(row));
    if (others.length) results.append(h('div', { class: 'list-label' }, 'From your servers'), ...others.map(row));
    if (!friends.length && !others.length) results.append(h('p', { class: 'muted-p' }, q ? 'No one matches.' : 'Add some friends first (Friends → Add friend). You can also include anyone who shares a server with you.'));
    nameField.hidden = !!existingGroup || !groupMode();
    hint.textContent = existingGroup ? `Pick people to add (room for ${room - picked.size} more).`
      : groupMode() ? `${picked.size ? `${picked.size + 1} people including you` : 'Pick the people to include'} — up to ${GROUP_MAX}. Everyone in the group can add more people later.`
        : 'Pick one person for a direct message, or several for a group chat.';
    startBtn.textContent = existingGroup ? 'Add' : groupMode() ? 'Create group chat' : 'Start';
  };
  input.addEventListener('input', draw);
  let startBtn;
  const mdl = modal({
    title: existingGroup ? `Add people to ${groupName(existingGroup)}` : group ? 'New group chat' : 'New message', size: 'sm',
    body: h('div', { class: 'stack' }, nameField, input, chips, results, hint),
    actions: [{ label: 'Cancel' }, { label: existingGroup ? 'Add' : 'Start', kind: 'primary', action: async () => {
      const ids = [...picked];
      if (!ids.length) throw new Error('Pick at least one person.');
      if (existingGroup) { for (const id of ids) await api('POST', `/groups/${existingGroup.id}/members`, { userId: id }); toast(ids.length === 1 ? 'Added.' : `Added ${ids.length} people.`); return; }
      if (ids.length === 1 && !group) return openDmWith(ids[0]);
      const g = await api('POST', '/groups', { userIds: ids, name: nameIn.value.trim() });
      if (!S.servers.find((x) => x.id === g.id)) S.servers.push(g);
      if (g.keyState) await sec.applyState(g.keyState);
      openGroup(g.id);
    } }],
  });
  startBtn = mdl.box.querySelector('.modal-foot .btn.primary');
  draw();
  setTimeout(() => input.focus(), 30);
  return mdl;
}
// Members of a group chat: who's in it, who owns it; the owner can remove people or hand the group over.
function manageGroup(g) {
  const list = h('div', { class: 'quick-list' });
  const draw = () => {
    const cur = S.servers.find((x) => x.id === g.id) || g;
    clear(list);
    const mine = cur.ownerId === S.me.id;
    cur.memberIds.map(getUser).sort((a, b) => (a.id === cur.ownerId ? -1 : b.id === cur.ownerId ? 1 : displayName(a).localeCompare(displayName(b)))).forEach((u) => list.append(h('div', { class: 'quick-row static' },
      avatarEl(u, 30, { status: true, meId: S.me.id }),
      h('span', { class: 'quick-text' }, h('strong', null, displayName(u), u.id === S.me.id ? ' (you)' : ''), h('span', null, u.id === cur.ownerId ? 'Owner' : u.username)),
      mine && u.id !== S.me.id ? h('span', { class: 'row gap tight' },
        h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmDialog({ title: `Make ${displayName(u)} the owner?`, text: 'They’ll be able to remove people. You stay in the group.', confirm: 'Make owner' })) { await api('POST', `/groups/${cur.id}/owner`, { userId: u.id }).catch((e) => toast(e.message, 'error')); setTimeout(draw, 300); } } }, 'Make owner'),
        h('button', { class: 'btn ghost sm danger-text', onclick: async () => { if (await confirmDialog({ title: `Remove ${displayName(u)}?`, text: 'They won’t see new messages. The group switches to a new encryption key.', confirm: 'Remove', danger: true })) { await api('DELETE', `/groups/${cur.id}/members/${u.id}`).catch((e) => toast(e.message, 'error')); setTimeout(draw, 300); } } }, 'Remove')) : null)));
  };
  draw();
  modal({ title: `${groupName(g)} — members`, size: 'sm', body: h('div', { class: 'stack' }, list,
    h('button', { class: 'btn', onclick: () => openNewConversation(S.servers.find((x) => x.id === g.id) || g) }, icon('userPlus'), 'Add people')) });
}
// Group picture: any member can set one (like the name).
function changeGroupIcon(g) {
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    if (!f) return;
    const fd = new FormData(); fd.append('icon', f);
    try { await upload(`/servers/${g.id}/icon`, fd); toast('Group picture updated.'); } catch (e) { toast(e.message, 'error'); }
  };
  document.body.append(fileIn); fileIn.click(); setTimeout(() => fileIn.remove(), 60000);
}
function renameGroup(g) {
  const input = h('input', { class: 'input', maxlength: '64', value: g.name || '', placeholder: groupName(g) });
  modal({ title: 'Rename group', size: 'sm', body: field('Group name', input, 'Leave empty to show everyone\u2019s names.'),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', action: () => api('PATCH', `/servers/${g.id}`, { name: input.value }) }] });
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) { markRead(currentKey()); if (S.thread) markThreadRead(S.thread.rootId); } });

// ======================================================================= installable app (PWA), updates, push
let installPrompt = null;
let wantReload = false;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || !!window.hearthDesktop || androidApp.on;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed. You can open it from your apps like any other program.'); });
async function installApp() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome === 'accepted';
}
// The desktop app downloaded an update from this server: offer to restart into it (never mid-call by itself).
function showAppUpdate(version) {
  if (document.querySelector('.update-bar.app-update')) return;
  const bar = h('div', { class: 'update-bar app-update', role: 'status' }, icon('download'),
    h('span', null, `The ${S.config.name || 'Hearth'} app ${version ? `${version} ` : ''}is ready to install.`),
    h('button', { class: 'btn primary sm', onclick: async () => { if (voice && voice.channelId && !(await confirmDialog({ title: 'Restart now?', text: 'Restarting leaves your call. It takes a few seconds.', confirm: 'Restart' }))) return; installUpdate(); } }, 'Restart now'),
    ibtn('close', 'Later (restart from Settings \u2192 Apps & devices when you\u2019re ready)', () => bar.remove(), { cls: 'sm' }));
  document.body.append(bar);
}
function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // A new version finished installing in the background: it takes over by itself (sw.js does that as soon as it
    // has installed; a browser that kept it waiting is told to). The page then switches to it (controllerchange).
    const takeOver = (w) => w.postMessage('skipWaiting');
    if (reg.waiting && navigator.serviceWorker.controller) takeOver(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) takeOver(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wantReload) { wantReload = false; location.reload(); return; }
    // A new version took over in the background, while this page still runs the one it opened with: it reloads
    // into the new one by itself when that interrupts nothing (autoUpdate). The very first install also fires
    // this event, with nothing to switch from (and the page runs that version already).
    if (hadController) autoUpdate.due();
    hadController = true;
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open' && e.data.url) {
      const hash = e.data.url.split('#')[1];
      if (hash) location.hash = hash;
    }
  });
}
const b64url = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pushStatus() {
  if (androidApp.on) await androidApp.ready;
  if (!app.push.supported()) return 'unsupported';
  if (androidApp.push) return androidPushStatus();
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}
async function enablePush({ quiet = false, choose = false } = {}) {
  if (androidApp.on) await androidApp.ready;
  if (androidApp.push && app.push.supported()) return enableAndroidPush({ quiet, choose });
  if (!app.push.supported()) throw new Error(/iPhone|iPad/.test(navigator.userAgent) && !isStandalone() ? 'On iPhone and iPad, add Hearth to your Home Screen first, then turn this on from the app.' : 'This browser doesn\u2019t support push notifications.');
  if (Notification.permission !== 'granted') {
    if (quiet) return;
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api('GET', '/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(publicKey) });
  }
  await api('POST', '/push/subscribe', { subscription: sub.toJSON() });
  localStorage.setItem('hearth.push', 'on');
}
// signOut: nobody chose "off" (the next person to sign in here can be offered push again).
async function disablePush({ signOut = false } = {}) {
  if (signOut) localStorage.removeItem('hearth.push'); else localStorage.setItem('hearth.push', 'off');
  if (androidApp.push) {
    const endpoint = localStorage.getItem('hearth.push.endpoint');
    if (endpoint) await api('POST', '/push/unsubscribe', { endpoint }).catch(() => {});
    await androidApp.push.unregister();
    localStorage.removeItem('hearth.push.endpoint');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
}

// ---- push in the Android app: the app's push registration (android-push.js), subscribed here like a browser's
async function androidPushStatus() {
  const st = await androidApp.push.state();
  if (st.state === 'blocked' || androidApp.notify === 'denied') return 'blocked';
  if (st.state === 'registered' && localStorage.getItem('hearth.push') === 'on') return 'on';
  if (st.state === 'noDistributor') return 'nodistributor';
  if (st.state === 'failed') return 'failed';
  return 'off';
}
let androidEnabling = 0; // a subscribe in progress: the push app's own change events wait for it
async function enableAndroidPush(opts = {}) {
  androidEnabling++;
  try { await subscribeAndroidPush(opts); } finally { androidEnabling--; }
}
async function subscribeAndroidPush({ quiet = false, choose = false } = {}) {
  if (Notification.permission !== 'granted') {
    if (quiet) return;
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are turned off for Hearth. Turn them on in Android Settings \u2192 Apps \u2192 Hearth \u2192 Notifications.');
  }
  const { publicKey } = await api('GET', '/push/key');
  let st = await androidApp.push.state();
  if (choose || st.state !== 'registered' || st.vapid !== String(publicKey || '').replace(/=+$/, '') || !st.p256dh) {
    // At start-up nothing pops up: no push app list, no questions. Only a tap in Settings (or the offer) does.
    if (quiet && !st.distributor) return;
    st = await androidApp.push.register(publicKey, { choose });
  }
  const prev = localStorage.getItem('hearth.push.endpoint');
  await api('POST', '/push/subscribe', { subscription: { endpoint: st.endpoint, keys: { p256dh: st.p256dh, auth: st.auth } }, replaces: prev && prev !== st.endpoint ? prev : undefined });
  localStorage.setItem('hearth.push.endpoint', st.endpoint);
  localStorage.setItem('hearth.push', 'on');
}
// Once per start: keep the server's copy of this phone's push address current when the push app changes it,
// and offer push once to someone who never decided.
let androidPushWatched = false;
async function androidPushAtStart() {
  await androidApp.ready;
  if (!androidApp.push || !app.push.supported() || androidPushWatched) return;
  androidPushWatched = true;
  androidApp.push.onChange((st) => {
    if (localStorage.getItem('hearth.push') !== 'on' || androidEnabling) return;
    if (st.state === 'registered' && st.endpoint !== localStorage.getItem('hearth.push.endpoint')) enablePush({ quiet: true }).catch(() => {});
  });
  // (Not over an update offer, which shares its place on screen: it's offered again next start.)
  if (localStorage.getItem('hearth.push') !== null || androidApp.notify === 'denied' || document.querySelector('.push-offer, .update-bar')) return;
  offerPush();
}
// The one-time "Get notifications?" bar (Android app, and Hearth on an iPhone or iPad Home Screen).
function offerPush() {
  const no = () => { localStorage.setItem('hearth.push', 'off'); bar.remove(); };
  const bar = h('div', { class: 'push-offer', role: 'status' }, icon('bell'),
    h('span', null, 'Get notifications when Hearth is closed?'),
    h('button', { class: 'btn primary sm', onclick: async () => {
      bar.remove();
      try { await enablePush(); toast('Notifications are on, even when Hearth is closed.'); } catch (e) { if (e.code !== 'CANCELLED') toast(e.message, 'error'); }
    } }, 'Turn on'),
    h('button', { class: 'btn ghost sm', onclick: no }, 'Not now'));
  document.body.append(bar);
}
// iPhone and iPad: web push works only for Hearth opened from the Home Screen, on iOS 16.4 and newer. In Safari,
// say so once; once it's on the Home Screen, offer notifications once, as the Android app does.
const appleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const iosVersion = () => { const m = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; };
function applePushAtStart() {
  if (!appleMobile() || !(S.config && S.config.pushEnabled) || document.querySelector('.push-offer, .update-bar')) return;
  if (!isStandalone()) {
    // An iPad asking for the desktop site says "Macintosh" without an iOS version: assume it's new enough.
    const v = iosVersion();
    if (localStorage.getItem('hearth.ios.homeTip') || (v && v < 16.04)) return;
    const done = () => { localStorage.setItem('hearth.ios.homeTip', 'seen'); bar.remove(); };
    const bar = h('div', { class: 'push-offer', role: 'status' }, icon('bell'),
      h('span', null, 'To get notifications on this ' + (/iPad|Macintosh/.test(navigator.userAgent) ? 'iPad' : 'iPhone') + ', add Hearth to your Home Screen: tap Share, then \u201cAdd to Home Screen\u201d, and open Hearth from there.'),
      h('button', { class: 'btn ghost sm', onclick: done }, 'Got it'));
    document.body.append(bar);
    return;
  }
  if (!app.push.supported() || localStorage.getItem('hearth.push') !== null || Notification.permission !== 'default') return;
  offerPush();
}

// ======================================================================= Terms of Service
async function askToAcceptTerms() {
  if (document.querySelector('.terms-modal')) return;
  let t;
  try { t = await api('GET', '/terms'); } catch { return; }
  modal({
    title: 'Terms of Service', size: 'md', className: 'terms-modal', dismissable: false,
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, 'Please read and accept this server\u2019s terms to keep using it.'),
      h('div', { class: 'tos-text md', html: renderDoc(t.text) })),
    actions: [
      { label: 'Log out', action: () => logout() },
      { label: 'I agree', kind: 'primary', action: () => api('POST', '/terms/accept') },
    ],
  });
}

// ======================================================================= reporting
// Messages are end-to-end encrypted, so admins can only see what the reporter chooses to share from
// their own device. The dialog shows exactly what will be sent.
function openReport({ message, user, ctx = 'main' }) {
  const target = user || getUser(message.authorId);
  let category = '';
  // The server it happened in (a message in one of its channels, or a member reported while you're in a server you
  // share): its moderators can see the report too, without your name, unless you untick it. Not for group chats, and
  // child-safety reports stay with this instance's admins (the server decides that again). Of the messages shared,
  // they get only the reported person's: yours would give you away (server/serveraudit.js).
  const instance = S.config.name || 'Hearth';
  const viewed = !message && S.view.serverId && S.servers.find((x) => x.id === S.view.serverId);
  const inServer = message ? (message.channelId && serverOfChannel(message.channelId)) : (viewed && viewed.memberIds.includes(target.id) ? viewed : null);
  const shareable = inServer && !isGroup(inServer) ? inServer : null;
  let shareWanted = true; // the person's own choice, kept while a category that can't be shared is picked
  const toServer = h('input', { type: 'checkbox', checked: true, onchange: (e) => { shareWanted = e.target.checked; } });
  const shareHint = h('span', { class: 'field-hint' });
  const shareRow = shareable ? h('label', { class: 'tos-check' }, toServer, h('span', null, `Also show it to the moderators of ${shareable.name}`, h('br'), shareHint)) : null;
  const drawShare = () => {
    if (!shareRow) return;
    const staffOnly = category === 'child_safety';
    toServer.disabled = staffOnly;
    toServer.checked = !staffOnly && shareWanted;
    shareHint.textContent = staffOnly ? `Child-safety reports go to the admins of ${instance} only.`
      : message ? `They won\u2019t see who sent it. They get what\u2019s wrong, your details and ${displayName(target)}\u2019s messages below; the other messages (yours too) go to the admins only.`
        : 'They won\u2019t see who sent it. They get what\u2019s wrong and your details.';
  };
  drawShare();
  const cats = h('div', { class: 'report-cats', role: 'radiogroup' }, Object.entries(CATEGORY_LABEL).map(([k, l]) => h('label', { class: 'radio-card sm' },
    h('input', { type: 'radio', name: 'rcat', value: k, onchange: () => { category = k; drawShare(); } }), h('span', null, l))));
  const details = h('textarea', { class: 'input', rows: '3', maxlength: '2000', placeholder: 'Anything that helps the admins understand (optional)' });
  let evidence = [];
  let includeContext = true;
  const preview = h('div', { class: 'evidence' });
  const drawPreview = () => {
    if (!message) return;
    const list = ctx === 'thread' ? threadList() : (S.msgs[keyOfMessage(message)] || { list: [] }).list;
    const i = list.findIndex((x) => x.id === message.id);
    const before = includeContext && i > 0 ? list.slice(Math.max(0, i - 4), i).filter(readable) : [];
    evidence = [...before, message].map((x) => ({ id: x.id, text: textOf(x), files: filesOf(x).map((f) => f.name), reported: x.id === message.id, authorId: x.authorId, createdAt: x.createdAt }));
    clear(preview).append(...evidence.map((e) => h('div', { class: `ev${e.reported ? ' reported' : ''}` }, avatarEl(getUser(e.authorId), 22),
      h('div', { class: 'ev-body' }, h('div', { class: 'ev-meta' }, h('strong', null, displayName(getUser(e.authorId))), h('span', null, fmtStamp(e.createdAt))),
        h('div', { class: 'ev-text', html: e.text ? md(e.text) : escapeText(e.files.length ? `[${e.files.join(', ')}]` : '') })))));
  };
  drawPreview();
  modal({
    title: message ? 'Report message' : `Report ${displayName(target)}`, size: 'md',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, `Reports go to the admins of ${instance}. The person you report isn\u2019t told who reported them.`),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'What\u2019s wrong?'), cats),
      field('Details', details),
      shareRow,
      message ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'These messages will be shared with the admins'),
        h('label', { class: 'tos-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { includeContext = e.target.checked; drawPreview(); } }), h('span', null, 'Include up to 4 earlier messages for context')),
        preview,
        h('p', { class: 'field-hint' }, 'Messages are end-to-end encrypted, so admins can only see what you share here.'),
        disappears(message) ? h('p', { class: 'field-hint dis-hint' }, icon('timer'), `Reporting sends the text of these messages to this Hearth\u2019s staff${shareable ? ` (and ${displayName(target)}\u2019s to the moderators of ${shareable.name}, if you show it to them)` : ''}, who keep it with the report after the messages disappear here.`) : null) : null,
      h('p', { class: 'field-hint' }, 'In danger right now? Contact your local emergency services.')),
    actions: [
      { label: 'Cancel' },
      { label: 'Send report', kind: 'danger', action: async () => {
        if (!category) throw new Error('Pick what\u2019s wrong.');
        await api('POST', '/reports', {
          category, details: details.value, targetId: target.id,
          context: message ? { kind: 'message', messageId: message.id } : { kind: 'user', ...(shareable ? { serverId: shareable.id } : {}) },
          evidence: evidence.map(({ id, text, files }) => ({ id, text, files })),
          toServer: !!shareable && toServer.checked,
        });
        toast('Thanks \u2014 the admins have your report.');
        if (!S.blocked.has(target.id)) setTimeout(() => toggleBlock(target.id, true), 200); // offers to block them too
      } },
    ],
  });
}

// ======================================================================= calls: video, screen sharing, DM calls
// A "room" is a server voice channel id, or "dm:<dmId>" for a 1-to-1 DM call.
const dmRoom = (dmId) => 'dm:' + dmId;
const videoEls = new Map(); // reused <video> elements so tiles don't flicker on re-render
function videoEl(key, track, mirror) {
  let v = videoEls.get(key);
  if (!v) {
    v = document.createElement('video');
    v.autoplay = true; v.playsInline = true; v.muted = true; // sound comes through the call's audio elements
    v.className = 'cs-video';
    videoEls.set(key, v);
  }
  v.classList.toggle('mirror', !!mirror);
  const cur = v.srcObject && v.srcObject.getVideoTracks()[0];
  if (track && cur !== track) { v.srcObject = new MediaStream([track]); v.play().catch(() => {}); }
  if (!track && v.srcObject) v.srcObject = null;
  return v;
}
const stageSpotlight = new Map(); // room -> tile key
// Android app: keeps the call (and the mic) going with the screen locked, with Hang up in a notification. Also
// called when the lock-screen setting changes, so the notification's title follows it.
function syncCallNotification() {
  if (androidApp.callState && voice) androidApp.callState({ inCall: !!voice.channelId, title: voice.channelId ? callTitle(voice.channelId) : '' });
}
// What the Android app's call notification says. Android shows it on the lock screen too (unless the phone is set
// to hide sensitive content), so it names who or where only with "Show who and where on the lock screen" on, like
// push notifications (server/usability.js shapePush).
function callTitle(room) {
  if ((S.notifySettings || {}).previews !== 'names') return 'In a call';
  const t = roomTitle(room);
  return room.startsWith('dm:') ? `Call with ${t}` : t === 'Call' ? 'In a call' : `In a call \u00b7 ${t}`;
}
function roomTitle(room) {
  if (room.startsWith('dm:')) { const d = S.dms.find((x) => x.id === room.slice(3)); return d ? displayName(getUser(d.userId)) : 'Call'; }
  const c = channelById(room); const s = c && serverOfChannel(c.id);
  return s ? (isGroup(s) ? groupName(s) : c.name) : 'Call';
}
// Everyone's tiles for a room: a screen share tile (if sharing) and a camera/avatar tile per person.
function stageTiles(room) {
  const inCall = voice && voice.channelId === room;
  const tiles = [];
  for (const st of S.voice[room] || []) {
    const me = st.userId === S.me.id;
    const media = !inCall ? {} : me ? { cam: voice.camStream && voice.camStream.getVideoTracks()[0], screen: voice.screenStream && voice.screenStream.getVideoTracks()[0] } : voice.remoteMedia(st.userId);
    const u = getUser(st.userId);
    if (st.screen && media.screen) tiles.push({ key: `${st.userId}:screen`, u, st, kind: 'screen', track: media.screen, me });
    tiles.push({ key: `${st.userId}:cam`, u, st, kind: st.video && media.cam ? 'cam' : 'avatar', track: media.cam, me });
  }
  return tiles;
}
function tileEl(room, t, big) {
  // A server's voice channel shows nicknames there; DM and group calls the display name.
  const shown = nameInServer(serverOfChannel(room), t.u);
  const name = t.kind === 'screen' ? `${shown}\u2019s screen` : shown;
  const el = h('div', {
    class: `cs-tile kind-${t.kind}${big ? ' big' : ''}${t.kind !== 'screen' && S.speaking.has(t.u.id) ? ' speaking' : ''}${t.kind !== 'screen' && S.boardPlaying.has(t.u.id) ? ' board-playing' : ''}`,
    dataset: { speak: t.kind === 'screen' ? '' : t.u.id, key: t.key }, tabindex: '0',
    'aria-label': name, onclick: (e) => { if (e.target.closest('button')) return; stageSpotlight.set(room, stageSpotlight.get(room) === t.key ? null : t.key); renderCallStages(); },
  });
  if (t.kind === 'avatar') {
    if (t.u.banner) el.append(h('div', { class: 'vr-bg' }, h('img', { class: 'cropped', src: t.u.banner, alt: '', style: cropStyle(t.u.profile.bannerCrop) })));
    const av = avatarEl(t.u, big ? 96 : 64); av.dataset.speak = t.u.id;
    if (S.speaking.has(t.u.id)) av.classList.add('speaking');
    if (S.boardPlaying.has(t.u.id)) av.classList.add('board-playing');
    el.append(av);
  } else {
    const v = videoEl(t.key, t.track, t.me && t.kind === 'cam');
    el.append(v, h('div', { class: 'cs-tools' },
      document.pictureInPictureEnabled ? ibtn('external', 'Pop out (picture-in-picture)', () => v.requestPictureInPicture().catch(() => {}), { cls: 'sm' }) : null,
      ibtn('maximize', 'Fullscreen', () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen().catch(() => {})), { cls: 'sm' })));
  }
  const ps = !t.me && t.kind !== 'screen' && voice && voice.channelId === room ? voice.peerState(t.u.id) : null;
  // Their app lost the server (the server keeps their place for a few seconds): say so rather than "connected".
  if (t.kind !== 'screen' && t.st.reconnecting && ps !== 'failed') el.append(h('div', { class: 'cs-conn warn' }, h('span', { class: 'spinner' }), 'Reconnecting\u2026'));
  else if (ps === 'connecting') el.append(h('div', { class: 'cs-conn' }, h('span', { class: 'spinner' }), 'Connecting\u2026'));
  else if (ps === 'reconnecting') el.append(h('div', { class: 'cs-conn warn' }, h('span', { class: 'spinner' }), 'Reconnecting\u2026'));
  if (ps === 'failed') {
    el.append(h('div', { class: 'cs-conn bad', 'data-tip': 'Their network or yours blocks direct calls. The server admin can fix this by setting up the call relay (scripts/setup-turn.sh).' }, icon('shield'), 'Can\u2019t connect',
      h('button', { class: 'link-btn', onclick: () => { voice.retryPeer(t.u.id).catch(() => {}); renderCallStages(); } }, 'Retry')));
  }
  el.append(h('div', { class: 'cs-name' }, t.kind === 'screen' ? icon('monitor', 'ic') : null, h('span', null, name),
    t.kind !== 'screen' && t.st.serverMuted ? h('span', { class: 'server-muted', 'data-tip': 'Server muted by a moderator', role: 'img', 'aria-label': 'Server muted' }, icon('micOff', 'ic flag'))
      : t.kind !== 'screen' && t.st.deafened ? icon('headphonesOff', 'ic flag') : t.kind !== 'screen' && t.st.muted ? icon('micOff', 'ic flag') : null));
  if (!t.me && t.kind !== 'screen' && voice && voice.channelId === room) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slider = h('input', { type: 'range', class: 'range', min: '0', max: '2', step: '0.05', value: String(voice.volumeFor(t.u.id)), 'aria-label': `Volume for ${shown}`, oninput: (ev) => voice.setVolume(t.u.id, +ev.target.value) });
      const pt = h('span', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px' } }); document.body.append(pt);
      const sbMute = h('label', { class: 'toggle-row sm' }, h('span', { class: 'toggle-label' }, 'Mute their soundboard'),
        h('input', { type: 'checkbox', checked: board.mutedFor(t.u.id), onchange: (ev) => board.setMutedFor(t.u.id, ev.target.checked) }));
      popover(pt, h('div', { class: 'menu vol-pop' }, h('div', { class: 'menu-header' }, `Volume \u2014 ${shown}`), slider, sbMute), { side: 'bottom' });
      pt.remove();
    });
  }
  return el;
}
function callControls(room) {
  const inCall = voice && voice.channelId === room;
  if (!inCall) {
    return h('div', { class: 'cs-controls' },
      h('button', { class: 'btn primary', onclick: () => joinRoom(room) }, icon('phone'), 'Join call'),
      h('button', { class: 'btn ghost', onclick: () => joinRoom(room, { video: true }) }, icon('video'), 'Join with video'));
  }
  const camOn = !!voice.camStream; const scrOn = !!voice.screenStream;
  return h('div', { class: 'cs-controls' },
    h('button', { class: `round-btn${voice.muted ? ' off' : ''}`, 'data-tip': voice.muted ? 'Unmute' : 'Mute', 'aria-label': voice.muted ? 'Unmute' : 'Mute', onclick: () => { toggleMute(); renderCallStages(); } }, icon(voice.muted ? 'micOff' : 'mic')),
    h('button', { class: `round-btn${voice.deafened ? ' off' : ''}`, 'data-tip': voice.deafened ? 'Undeafen' : 'Deafen', 'aria-label': voice.deafened ? 'Undeafen' : 'Deafen', onclick: () => { toggleDeafen(); renderCallStages(); } }, icon(voice.deafened ? 'headphonesOff' : 'headphones')),
    h('button', { class: `round-btn${camOn ? ' on' : ''}`, 'data-tip': camOn ? 'Turn camera off' : 'Turn camera on', 'aria-label': camOn ? 'Turn camera off' : 'Turn camera on', 'aria-pressed': String(camOn), onclick: () => toggleCamera() }, icon(camOn ? 'video' : 'videoOff')),
    (S.config.features || {}).watch === false ? null : h('button', { class: `round-btn${S.watch[room] ? ' on' : ''}`, 'data-tip': S.watch[room] ? 'Add a video to the queue' : 'Watch together', 'aria-label': 'Watch together', onclick: () => openWatchStart(room, !!S.watch[room]) }, icon('eye')),
    h('button', { class: `round-btn${scrOn ? ' on' : ''}`, 'data-tip': scrOn ? 'Stop sharing' : 'Share your screen', 'aria-label': scrOn ? 'Stop sharing your screen' : 'Share your screen', 'aria-pressed': String(scrOn), onclick: () => toggleScreen() }, icon('monitor')),
    h('button', { class: 'round-btn sb-open', 'data-tip': 'Soundboard', 'aria-label': 'Soundboard', 'data-pop-anchor': '', onclick: (e) => board.openPicker(e.currentTarget) }, icon('music')),
    h('button', { class: 'round-btn hang', 'data-tip': 'Leave call', 'aria-label': 'Leave call', onclick: () => { voice.leave(); playSound('selfLeave'); } }, icon('phoneOff')));
}
// The call area: a grid, or one big spotlighted tile (screen shares get it automatically) with the rest in a strip.
function callStage(room, { compact = false } = {}) {
  const el = h('section', { class: `call-stage${compact ? ' compact' : ''}`, dataset: { room }, 'aria-label': 'Call' });
  fillStage(el);
  return el;
}
function fillStage(el) {
  const room = el.dataset.room;
  const tiles = stageTiles(room);
  let spot = stageSpotlight.get(room);
  if (!tiles.some((t) => t.key === spot)) spot = (tiles.find((t) => t.kind === 'screen') || {}).key || null;
  const people = (S.voice[room] || []).length;
  const mine = voice && voice.channelId === room;
  // In the call: its real state (never "connected" while the media isn't). Otherwise just who's there.
  const st = mine ? voice.status() : null;
  const live = st && st.state !== 'connected' ? `${st.label}${people ? ` \u00b7 ${people} in call` : ''}` : people ? `${people} in call` : 'Call';
  const head = h('div', { class: 'cs-head' }, h('span', { class: `cs-live${st ? ` st-${st.tone}` : ''}`, role: mine ? 'status' : null, 'data-tip': st ? st.detail : null, dataset: { callState: st ? st.state : '' } }, live),
    h('span', { class: 'cs-head-tools' },
      mine ? ibtn('info', 'Call diagnostics', () => openCallDiagnostics(diagCtx()), { cls: 'sm' }) : null,
      el.classList.contains('compact') ? ibtn(el.classList.contains('tall') ? 'chevron' : 'maximize', el.classList.contains('tall') ? 'Smaller' : 'Bigger', () => { el.classList.toggle('tall'); fillStage(el); }, { cls: 'sm' }) : null));
  // Connections the server never listed in this call: someone may be listening in without showing up.
  const hidden = mine ? voice.unlistedPeers().filter((p) => p.neverListed) : [];
  const body = spot
    ? h('div', { class: 'cs-spot' }, tileEl(room, tiles.find((t) => t.key === spot), true), h('div', { class: 'cs-strip' }, tiles.filter((t) => t.key !== spot).map((t) => tileEl(room, t, false))))
    : h('div', { class: `cs-grid n${Math.min(tiles.length, 9)}` }, tiles.map((t) => tileEl(room, t, false)));
  // The shared video only has a placeholder here: the player itself lives in its own layer and is laid over this
  // box (moving a video in the page would reload it), or shrinks to a mini player when you're elsewhere.
  const inCall = voice && voice.channelId === room;
  let host = el.querySelector(':scope > .cs-watch-host');
  if (inCall && S.watch[room]) {
    if (!host) host = h('div', { class: 'cs-watch-host', dataset: { room } });
  } else if (host) { host.remove(); host = null; }
  syncWatchDock();
  [...el.children].forEach((c) => { if (c !== host) c.remove(); });
  const warn = hidden.length ? h('p', { class: 'cs-hidden-peers', role: 'alert' }, `Warning: you\u2019re connected to ${hidden.map((p) => nameInServer(serverOfChannel(room), getUser(p.userId))).join(', ')}, who the server doesn\u2019t list in this call. Leave the call if you didn\u2019t expect them.`) : null;
  const rest = [warn, tiles.length ? body : h('div', { class: 'empty-state' }, h('p', null, 'No one\u2019s here yet.')), callControls(room)].filter(Boolean);
  if (host) { if (!host.parentNode) el.append(host); el.insertBefore(head, host); el.append(...rest); el.classList.add('watching'); }
  else { el.append(head, ...rest); el.classList.remove('watching'); }
}
const watchCtx = (room) => ({
  socket, me: S.me, isStaff: !!S.me.staffRole,
  userName: (id) => (id ? nameInServer(serverOfChannel(room), getUser(id)) : 'someone'),
  openStart: (queue) => openWatchStart(room, queue),
  openSide: () => openWatchSide(room),
});
// Put a second TikTok or reel beside the one playing (watch:side).
function openWatchSide(room) {
  const url = h('input', { class: 'input', placeholder: 'Paste a TikTok or Instagram reel link', autocomplete: 'off', spellcheck: 'false' });
  modal({
    title: 'Side by side', size: 'sm',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, 'A second upright video next to this one, for everyone in the call. Both start together; after that each plays on its own.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Link'), url)),
    actions: [{ label: 'Cancel' }, { label: 'Show side by side', kind: 'primary', action: async () => emitAck('watch:side', { url: await watchLink(url.value) }) }],
  });
  setTimeout(() => url.focus(), 50);
}
// Open the page of the call you're in (voice channel, DM or group).
function goToCall(room) {
  if (!room) return;
  if (room.startsWith('dm:')) return openDm(room.slice(3));
  const ch = channelById(room);
  const srv = ch && serverOfChannel(ch.id);
  if (srv && isGroup(srv)) openGroup(srv.id); else if (ch && srv) openVoiceRoom(ch.id, srv.id);
}

// ---- the watch-together dock
// The shared video lives in one fixed layer that is never moved around the page (moving a video reloads it,
// which paused it and made it jump). When the call is on screen it's laid exactly over the call's video box;
// anywhere else in the app it becomes a mini player in the corner that keeps playing in sync. You can drag the
// mini player, go back to the call, or hide it (the sound keeps playing; it comes back in the call).
const wtDock = { el: null, body: null, head: null, title: null, room: null, hidden: false, raf: 0, pos: null, mode: '' };
function wtDockEl() {
  if (wtDock.el) return wtDock.el;
  try { wtDock.pos = JSON.parse(sessionStorage.getItem('hearth.wtMini') || 'null'); } catch { wtDock.pos = null; }
  wtDock.title = h('span', { class: 'wt-dock-title' });
  wtDock.head = h('div', { class: 'wt-dock-head' },
    icon('eye', 'ic'), wtDock.title,
    ibtn('maximize', 'Back to the call', () => goToCall(wtDock.room), { cls: 'sm' }),
    ibtn('close', 'Hide (it keeps playing)', () => { wtDock.hidden = true; placeWatchDock(); }, { cls: 'sm' }));
  wtDock.body = h('div', { class: 'wt-dock-body' });
  wtDock.el = h('div', { class: 'wt-dock', hidden: true }, wtDock.head, wtDock.body);
  // Drag the mini player by its top bar.
  wtDock.head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || wtDock.mode !== 'mini') return;
    const r = wtDock.el.getBoundingClientRect(); const dx = e.clientX - r.left; const dy = e.clientY - r.top;
    wtDock.head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      wtDock.pos = { x: Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - r.height, ev.clientY - dy)) };
      placeWatchDock();
    };
    const up = () => { wtDock.head.removeEventListener('pointermove', move); try { sessionStorage.setItem('hearth.wtMini', JSON.stringify(wtDock.pos)); } catch { /* private mode */ } };
    wtDock.head.addEventListener('pointermove', move);
    wtDock.head.addEventListener('pointerup', up, { once: true });
  });
  wtDock.head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) goToCall(wtDock.room); });
  document.body.append(wtDock.el);
  return wtDock.el;
}
// Called whenever the call or the shared video changes: show, move or drop the player.
function syncWatchDock() {
  const room = voice && voice.channelId;
  const state = room && S.watch[room];
  // Left the call (or switched to another one): that video is done for us.
  if (wtDock.room && wtDock.room !== room) { dropWatchPlayer(wtDock.room); delete S.watch[wtDock.room]; wtDock.room = null; }
  if (!state) {
    if (wtDock.room) { dropWatchPlayer(wtDock.room); wtDock.room = null; }
    if (wtDock.el) wtDock.el.hidden = true;
    cancelAnimationFrame(wtDock.raf); wtDock.raf = 0; wtDock.hidden = false;
    return;
  }
  const p = watchPlayer(room, watchCtx(room));
  wtDockEl();
  if (p.el.parentNode !== wtDock.body) { clear(wtDock.body).append(p.el); p.apply(state); }
  wtDock.room = room;
  wtDock.title.textContent = state.item.title || state.item.link || 'Watching together';
  if (!wtDock.raf) { const loop = () => { placeWatchDock(); wtDock.raf = requestAnimationFrame(loop); }; wtDock.raf = requestAnimationFrame(loop); }
}
// Every frame while something is playing: over the call's box if it's on screen, otherwise the mini player.
function placeWatchDock() {
  const el = wtDock.el;
  if (!el || !wtDock.room) return;
  if (wtDock.body.querySelector('.wt-is-full')) { el.style.clipPath = ''; el.hidden = false; return; } // full screen: leave it be
  const host = $$('.cs-watch-host').find((x) => x.dataset.room === wtDock.room && x.isConnected && x.getClientRects().length);
  const style = el.style;
  if (host) {
    wtDock.hidden = false;
    const r = host.getBoundingClientRect();
    // Only the part of the box that's visible in its scrolling area (the video mustn't float over other things).
    let clip = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    for (let a = host.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/(auto|scroll|hidden)/.test(o.overflowY + o.overflowX)) { const ar = a.getBoundingClientRect(); clip = { top: Math.max(clip.top, ar.top), bottom: Math.min(clip.bottom, ar.bottom), left: Math.max(clip.left, ar.left), right: Math.min(clip.right, ar.right) }; }
    }
    // The call's buttons stick to the bottom of the call while you scroll: never cover them.
    const ctl = host.parentElement && host.parentElement.querySelector(':scope > .cs-controls');
    if (ctl) { const c = ctl.getBoundingClientRect(); if (c.height && c.top < clip.bottom) clip.bottom = c.top; }
    if (wtDock.mode !== 'inline') { wtDock.mode = 'inline'; el.classList.remove('mini'); el.classList.add('inline'); }
    el.hidden = false;
    style.left = `${r.left}px`; style.top = `${r.top}px`; style.width = `${r.width}px`; style.right = ''; style.bottom = '';
    const ct = Math.max(0, clip.top - r.top); const cb = Math.max(0, r.top + el.offsetHeight - clip.bottom);
    const cl = Math.max(0, clip.left - r.left); const cr = Math.max(0, r.right - clip.right);
    style.clipPath = ct || cb || cl || cr ? `inset(${ct}px ${cr}px ${cb}px ${cl}px)` : '';
    // The placeholder takes the player's height, so the call's tiles and buttons sit below it.
    const want = `${el.offsetHeight}px`;
    if (host.style.height !== want) host.style.height = want;
    return;
  }
  if (wtDock.mode !== 'mini') { wtDock.mode = 'mini'; el.classList.remove('inline'); el.classList.add('mini'); style.clipPath = ''; style.width = ''; }
  el.hidden = wtDock.hidden;
  if (wtDock.pos) {
    const w = el.offsetWidth || 320; const hgt = el.offsetHeight || 200;
    style.left = `${Math.max(0, Math.min(innerWidth - w, wtDock.pos.x))}px`; style.top = `${Math.max(0, Math.min(innerHeight - hgt, wtDock.pos.y))}px`; style.right = 'auto'; style.bottom = 'auto';
  } else { style.left = 'auto'; style.top = 'auto'; style.right = ''; style.bottom = ''; }
}
// Start (or queue) a video for everyone in the call.
// What kind of link this is (the server checks again): YouTube, Vimeo, Twitch or a video file.
function watchKind(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (/^(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(host)) return 'YouTube video';
  if (/^(player\.)?vimeo\.com$/.test(host)) return 'Vimeo video';
  if (host === 'twitch.tv') return 'Twitch live stream';
  const so = parseSocialUrl(u);
  if (so) return so.kind === 'tiktok' ? 'TikTok video' : so.type === 'p' ? 'Instagram post' : 'Instagram reel';
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(u.pathname)) return 'Video file';
  return null;
}
const watchRecent = () => { try { return JSON.parse(localStorage.getItem('hearth.watchRecent') || '[]').slice(0, 6); } catch { return []; } };
function rememberWatch(link) { try { localStorage.setItem('hearth.watchRecent', JSON.stringify([link, ...watchRecent().filter((x) => x !== link)].slice(0, 6))); } catch { /* private mode */ } }
// A short TikTok link is opened first (this server asks TikTok where it goes), so watch together gets the
// video's own link.
async function watchLink(link) {
  const p = parseSocialUrl(String(link || '').trim());
  return p && p.short ? (await resolveSocial(p)).link : String(link || '').trim();
}
const emitAck = (ev, data) => new Promise((resolve, reject) => socket.emit(ev, data, (r) => (r && r.error ? reject(new Error(r.error)) : resolve(r))));
async function startWatching(room, link, queue, extra = {}) {
  await emitAck('watch:start', { url: await watchLink(link), queue, ...extra });
  rememberWatch(String(link).trim());
}
// Two upright videos side by side (a TikTok and a reel): the first plays, the second sits beside it.
async function startSideBySide(room, a, b) {
  await startWatching(room, a, false);
  await emitAck('watch:side', { url: await watchLink(b) });
}
function openWatchStart(room, queue = false) {
  const url = h('input', { class: 'input', placeholder: 'Paste a YouTube, Vimeo, Twitch, TikTok or Instagram link', autocomplete: 'off', spellcheck: 'false' });
  const kind = h('span', { class: 'field-hint' }, 'YouTube, Vimeo, Twitch (live), TikTok, Instagram reels and video files (.mp4, .webm). For anything else (like Netflix), share your screen.');
  const hostOnly = h('input', { type: 'checkbox' });
  const check = () => { const k = watchKind(url.value); kind.textContent = url.value.trim() ? (k ? `✓ ${k}${k.startsWith('Instagram') ? ' (Instagram’s player can’t be kept in step: everyone starts it together)' : ''}` : 'That link isn’t a video this can play. Try a YouTube, Vimeo, Twitch, TikTok or Instagram link.') : kind.textContent; kind.classList.toggle('ok', !!k); };
  url.addEventListener('input', check);
  let m;
  const submit = () => startWatching(room, url.value, queue).then(() => m && m.close());
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit().catch((x) => toast(x.message, 'error')); } });
  const paste = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { url.value = (await navigator.clipboard.readText()).trim(); check(); url.focus(); } catch { url.focus(); toast('Press Ctrl+V to paste the link.'); } } }, 'Paste');
  const recent = watchRecent();
  m = modal({
    title: queue ? 'Add to the queue' : 'Watch together', size: 'sm',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted-p' }, queue ? 'It plays for everyone when the current video ends.' : 'Everyone in this call sees the same video at the same moment, and anyone can pause or skip ahead (unless you keep the controls).'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Link'), h('div', { class: 'row gap' }, url, paste), kind),
      recent.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Watched recently'),
        h('div', { class: 'wt-recent' }, recent.map((link) => h('button', { class: 'chip', type: 'button', title: link, onclick: () => { url.value = link; check(); submit().catch((x) => toast(x.message, 'error')); } }, link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))))) : null,
      queue ? null : h('label', { class: 'row gap' }, hostOnly, 'Only I can play, pause and skip'),
      h('p', { class: 'field-hint' }, 'The video loads straight from YouTube/Vimeo/Twitch/TikTok/Instagram, so they can see each viewer’s IP address, like when you watch there. A video file on another site does too, so each viewer is told before it loads.')),
    actions: [{ label: 'Cancel' }, { label: queue ? 'Add to queue' : 'Start watching', kind: 'primary', action: () => new Promise((resolve, reject) => {
      startWatching(room, url.value, queue, { hostOnly: hostOnly.checked }).then(resolve, reject);
    }) }],
  });
  setTimeout(() => url.focus(), 50);
}
// Video links in chat get a "Watch together" button: one click plays it for everyone in your call.
const WATCH_LINK = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s<>"']*v=|shorts\/|live\/)[\w-]{11}[^\s<>"']*|youtu\.be\/[\w-]{11}[^\s<>"']*|vimeo\.com\/\d{5,12}[^\s<>"']*|twitch\.tv\/[a-z0-9_]{3,25}(?=[\s/?#]|$)|[^\s<>"']+\.(?:mp4|webm|m4v)(?=[\s?#]|$))/gi;
function watchChips(text) {
  if ((S.config.features || {}).watch === false || !text) return null;
  // TikTok and Instagram links too (social.js), counted once each however they're written.
  const socials = socialLinks(text).map((p) => p.url);
  const links = [...new Set([...(String(text).match(WATCH_LINK) || []), ...socials])].slice(0, 4);
  if (!links.length) return null;
  const inCall = () => {
    const room = voice && voice.channelId;
    if (!room) toast('Join a voice channel or call first, then press this to watch it together.');
    return room;
  };
  const chips = links.map((link) => h('button', {
    class: 'watch-chip', 'data-tip': 'Play it for everyone in your call',
    onclick: () => {
      const room = inCall();
      if (!room) return;
      const queued = !!S.watch[room];
      startWatching(room, link, queued).then(() => toast(queued ? 'Added to the watch queue.' : 'Playing for everyone in the call.')).catch((e) => toast(e.message, 'error'));
    },
  }, icon('play'), `Watch together${links.length > 1 ? ` · ${watchKind(link) || 'video'}` : ''}`));
  // Two upright videos (a TikTok and a reel, say): both at once, side by side, or all of them in the queue.
  if (socials.length >= 2) {
    chips.push(h('button', { class: 'watch-chip', 'data-tip': 'Both at once, next to each other, for everyone in your call', onclick: () => {
      const room = inCall();
      if (room) startSideBySide(room, socials[0], socials[1]).then(() => toast('Side by side for everyone in the call.')).catch((e) => toast(e.message, 'error'));
    } }, icon('play'), 'Watch side by side'));
    chips.push(h('button', { class: 'watch-chip', 'data-tip': 'One after the other, for everyone in your call', onclick: async () => {
      const room = inCall();
      if (!room) return;
      try { for (const [i, link] of socials.entries()) await startWatching(room, link, i > 0 || !!S.watch[room]); toast(`${socials.length} videos in the watch queue.`); } catch (e) { toast(e.message, 'error'); }
    } }, icon('play'), `Queue all ${socials.length}`));
  }
  return h('div', { class: 'watch-chips' }, chips);
}
function renderCallStages() { $$('.call-stage').forEach(fillStage); }
// What the diagnostics panel needs: names, and the relays' region names (never their addresses).
const diagCtx = () => ({ voice, name: (id) => nameInServer(voice && voice.channelId ? serverOfChannel(voice.channelId) : null, getUser(id)), relays: (S.iceServers || []).filter((e) => e.region).map((e) => ({ urls: e.urls, region: e.region })), region: () => (voice && voice.channelId ? regionName(callRegion(voice.channelId)) : '') });

async function joinRoom(room, { video = false } = {}) {
  try {
    stopRinging(room);
    await voice.join(room, { video });
    playSound('selfJoin');
    if (voice.noMic) toast('No microphone found (or it\u2019s in use by another app), so you joined listen-only.');
    renderCallStages();
    renderHeader();
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Allow microphone (and camera) access in your browser to join.' : e.message, 'error');
  }
}
async function toggleCamera() {
  try { await voice.setCamera(!voice.camStream); } catch (e) { toast(e.name === 'NotAllowedError' ? 'Allow camera access in your browser to turn your camera on.' : e.name === 'NotFoundError' ? 'No camera found.' : e.message, 'error'); }
  renderCallStages(); renderVoicePanel();
}
async function toggleScreen() {
  try { await voice.setScreen(!voice.screenStream); } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message, 'error'); }
  renderCallStages(); renderVoicePanel();
}
async function startDmCall(dmId, video = false) {
  const room = dmRoom(dmId);
  if (voice.channelId === room) return;
  await joinRoom(room, { video });
}

// ---- ringing
const ringing = new Map(); // room -> { el, timer, stop }
function stopRinging(room) {
  const r = ringing.get(room);
  if (!r) return;
  clearInterval(r.timer); clearTimeout(r.timeout); r.el.remove();
  ringing.delete(room);
}
function onRing({ room, from, video }) {
  if (!S.me || from === S.me.id || ringing.has(room) || (voice && voice.channelId === room) || S.me.status === 'dnd') return;
  // A 1-to-1 call names the person this device has the DM as being with (only they can connect in it: secure.js
  // mayCall), never just whoever the server says is calling. A DM this device doesn't have doesn't ring.
  const caller = room.startsWith('dm:') ? sec.callPeer(room) : from;
  if (!caller) return;
  const u = getUser(caller);
  const where = room.startsWith('dm:') ? '' : ` in ${roomTitle(room)}`;
  const decline = () => { socket.emit('call:decline', { room }, () => {}); stopRinging(room); };
  const el = h('div', { class: 'ring-card', role: 'alertdialog', 'aria-label': `Incoming call from ${displayName(u)}` },
    h('div', { class: 'ring-av' }, avatarEl(u, 56)),
    h('div', { class: 'ring-text' }, h('strong', null, displayName(u)), h('span', null, `${video ? 'Video call' : 'Calling'}${where}\u2026`)),
    h('div', { class: 'ring-actions' },
      h('button', { class: 'round-btn hang', 'aria-label': 'Decline', 'data-tip': 'Decline', onclick: decline }, icon('phoneOff')),
      h('button', { class: 'round-btn accept', 'aria-label': 'Accept', 'data-tip': 'Accept', onclick: () => acceptRing(room) }, icon('phone')),
      h('button', { class: 'round-btn accept', 'aria-label': 'Accept with video', 'data-tip': 'Accept with video', onclick: () => acceptRing(room, true) }, icon('video'))));
  document.body.append(el);
  playSound('ring');
  const timer = setInterval(() => playSound('ring'), 3000);
  const timeout = setTimeout(() => stopRinging(room), 45000);
  ringing.set(room, { el, timer, timeout });
  notify(u, video ? 'Incoming video call' : 'Incoming call', room.startsWith('dm:') ? 'd:' + room.slice(3) : 'c:' + room);
}
async function acceptRing(room, video = false) {
  stopRinging(room);
  if (room.startsWith('dm:') && !sec.callPeer(room)) return toast('That call isn\u2019t available.', 'error');
  if (room.startsWith('dm:')) openDm(room.slice(3));
  else { const s = serverOfChannel(room); if (s) { const c = textChannel(s); if (isGroup(s) && c) openChannel(c.id, s.id); } }
  await joinRoom(room, { video });
}

// Older desktop apps: "Choose what to share" picker for screen sharing (Electron has none built in). Current
// ones show their own picker window instead and don't offer onPickScreen, so the page never sees your windows.
if (window.hearthDesktop && window.hearthDesktop.onPickScreen) {
  window.hearthDesktop.onPickScreen((sources) => {
    let answered = false;
    const answer = (id) => { if (!answered) { answered = true; window.hearthDesktop.pickScreen(id); } };
    const grid = (list) => h('div', { class: 'pick-grid' }, list.map((src) => h('button', { class: 'pick-src', onclick: () => { answer(src.id); m.close(); } },
      h('img', { src: src.thumb, alt: '' }), h('span', null, src.name))));
    const screens = sources.filter((x) => x.screen); const windows = sources.filter((x) => !x.screen);
    const m = modal({
      title: 'Choose what to share', size: 'lg', className: 'screen-picker', onClose: () => answer(null),
      body: h('div', { class: 'stack' },
        screens.length ? h('h4', null, 'Screens') : null, screens.length ? grid(screens) : null,
        windows.length ? h('h4', null, 'Windows') : null, windows.length ? grid(windows) : null,
        h('p', { class: 'field-hint' }, window.hearthDesktop.platform === 'win32' ? 'Your computer\u2019s sound is shared too.' : 'Sharing sound from your computer isn\u2019t available on this system.')),
      actions: [{ label: 'Cancel', action: () => answer(null) }],
    });
  });
}

// ======================================================================= updates without the fuss
// When the server restarts (an update), it tells everyone first. We show "Updating…", wait for it to
// come back, then either carry on (same version) or switch to the new version, landing right where
// you were with any unsent message kept. A new version is never something to click: every open Hearth
// switches to it by itself (auto-update.js), at a moment that interrupts nothing (never during a call).
let updatingTimer = null;
function showUpdating(text = 'Updating Hearth\u2026', sub = 'You\u2019ll be right back \u2014 this usually takes a few seconds.') {
  S.restarting = S.restarting || Date.now();
  // The server may have closed our connection on purpose (maintenance) or refused it for now; Socket.IO
  // doesn't retry those by itself, so keep knocking every few seconds until we're back.
  if (!S.retryTimer) S.retryTimer = setInterval(() => { if (!S.restarting) { clearInterval(S.retryTimer); S.retryTimer = null; return; } if (socket && !socket.connected) socket.connect(); }, 4000);
  let el = $('#update-overlay');
  if (!el) {
    el = h('div', { id: 'update-overlay', class: 'update-overlay', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'uo-card' }, h('span', { class: 'uo-spinner', 'aria-hidden': 'true' }), h('strong', { class: 'uo-title' }), h('span', { class: 'uo-sub' })));
    document.body.append(el);
  }
  el.querySelector('.uo-title').textContent = text;
  el.querySelector('.uo-sub').textContent = sub;
  $('#conn-banner').hidden = true;
  clearTimeout(updatingTimer);
  updatingTimer = setTimeout(() => { if ($('#update-overlay')) showUpdating('Still updating\u2026', 'This is taking longer than usual. It will reconnect by itself.'); }, 45000);
}
function hideUpdating() {
  S.restarting = 0;
  clearTimeout(updatingTimer);
  const el = $('#update-overlay');
  if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 250); }
}
function onNewVersion(version) {
  // Something under way (a call, say) carries on with this version for now; it switches by itself once that's done.
  if (updateBlockedBy()) { hideUpdating(); loadBootstrap().catch(() => {}); }
  autoUpdate.due(version, { soon: true });
}
// What a reload would cut off or lose. Words typed in a message box aren't on the list: their drafts are kept
// across the reload (saveResume); files attached to one, or a reply being set up, are.
function updateBlockedBy() {
  // A call that failed (and didn't come back by itself within a few minutes) has nothing left to cut off.
  if (voice && (voice.joinPromise || (voice.channelId && (voice.state !== 'failed' || Date.now() - (voice.stateSince || 0) < 5 * 60 * 1000)))) return 'call';
  if (ringing.size) return 'ringing';
  if (pendingSends.size || jobsUnderWay()) return 'sending';
  if ($('.rec-bar, .edit-wrap, .pending-files, .reply-bar')) return 'composing';
  if (S.select && S.select.ids.size) return 'selecting';
  if ($$('.upload-status, .att-meter').some((x) => !x.hidden) || $('.att-dl.busy, .att-file .btn.busy')) return 'transfer';
  // A video, song or voice message playing (calls' own live streams, srcObject, are the call check's business).
  if ($$('video, audio').some((m) => !m.paused && !m.ended && !m.error && !m.srcObject && m.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE)
    || voicePlaying() || songPlaying() || (wtDock.el && !wtDock.el.hidden)) return 'playing';
  if (choosingFile) return 'choosing';
  // Study (its rounds and timer live in its frame) and the admin dashboard (forms without a save bar).
  if (S.view && (S.view.type === 'study' || S.view.type === 'admin')) return S.view.type;
  if ($('.viewer:not(.closing), .settings')) return 'open';
  // Any dialog, except the ones that only tell you something and come back by themselves after the reload (What's
  // new, the terms to accept), or one left open would hold every later update up.
  if ($$('#layer > .modal-backdrop:not(.closing)').some((d) => !d.querySelector('.modal.whatsnew, .modal.terms-modal'))) return 'dialog';
  if ($$('.save-bar').some((x) => !x.hidden)) return 'unsaved';
  // Signing in or up, partly filled in (or being checked).
  const auth = $('#auth');
  if (!S.me && auth && !auth.hidden && ((authTyped && $$('#auth input:not([type=checkbox]):not([type=hidden])').some((i) => i.value)) || $('#auth button[type=submit]:disabled'))) return 'signing-in';
  const a = document.activeElement;
  if (a && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]), textarea, [contenteditable="true"]')
    && !a.closest('.composer') && String(a.value ?? a.textContent ?? '').trim()) return 'typing';
  return null;
}
const autoUpdate = createUpdater({
  hidden: () => document.hidden,
  blockedBy: updateBlockedBy,
  lastApplied: () => { try { return Number(sessionStorage.getItem('hearth.updatedAt')) || 0; } catch { return 0; } },
  apply: (version) => {
    try { sessionStorage.setItem('hearth.updatedAt', String(Date.now())); } catch { /* ignore */ }
    if (!document.hidden) showUpdating('Updated!', version ? `Loading Hearth ${version}\u2026` : 'Loading the new version of Hearth\u2026');
    updateAndReload();
  },
});
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'input']) addEventListener(type, () => autoUpdate.input(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => autoUpdate.poke());
// A phone's file picker or camera covers the page while it's open: that isn't "out of sight", and a reload would
// lose the files being picked. File inputs are mostly opened from code (input.click()), often off the page.
let choosingFile = false;
let choosingTimer = 0;
let choosingSeq = 0;
const choosing = (input) => {
  if (!input || input.type !== 'file') return;
  const me = ++choosingSeq; // only the latest picker's answer (or its time running out) counts
  choosingFile = true;
  clearTimeout(choosingTimer);
  const done = () => { if (me !== choosingSeq) return; choosingFile = false; clearTimeout(choosingTimer); };
  choosingTimer = setTimeout(done, 10 * 60 * 1000);
  input.addEventListener('change', done, { once: true });
  input.addEventListener('cancel', done, { once: true });
};
// Sign-in fields only count once someone has typed in them (a browser filling them in by itself isn't someone
// half-way through signing in).
let authTyped = false;
for (const type of ['keydown', 'paste', 'input']) $('#auth').addEventListener(type, (e) => { if (e.isTrusted) authTyped = true; }, true);
const inputClick = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function () { choosing(this); return inputClick.call(this); };
addEventListener('click', (e) => { if (e.isTrusted && e.target instanceof HTMLInputElement) choosing(e.target); }, true);
// Remember where you were (and unsent messages) across the reload.
function saveResume() {
  for (const c of Object.values(composers)) c.keepDraft();
  // Scrolled up into older messages: come back to the one at the top of the screen.
  let at;
  const sc = $('#messages');
  if (sc && !$('#jump-latest[hidden]') && $('#jump-latest')) {
    const top = sc.getBoundingClientRect().top;
    const first = [...sc.querySelectorAll(':scope > .msg[data-mid]')].find((m) => m.getBoundingClientRect().bottom > top + 8);
    if (first) at = first.dataset.mid;
  }
  const thread = S.panel === 'thread' && S.thread ? { id: S.thread.rootId, channelId: S.thread.channelId, serverId: S.thread.serverId } : null;
  try { sessionStorage.setItem('hearth.resume', JSON.stringify({ view: { ...S.view, jumpTo: at }, thread, drafts: [...drafts.entries()].filter(([, v]) => v) })); } catch { /* ignore */ }
}
function restoreResume() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem('hearth.resume') || 'null'); sessionStorage.removeItem('hearth.resume'); } catch { /* ignore */ }
  if (!r) return;
  for (const [k, v] of r.drafts || []) drafts.set(k, v);
  const v = r.view || {};
  const ok = ((v.type === 'channel' || v.type === 'voice') && channelById(v.channelId)) || (v.type === 'dm' && S.dms.some((d) => d.id === v.dmId))
    || ['home', 'friends', 'saved', 'updates', 'people'].includes(v.type) || (v.type === 'study' && S.me.studyEnabled) || (v.type === 'admin' && S.me.staffRole);
  if (!ok) return;
  setView({ ...v, jumpTo: undefined, restoreAt: typeof v.jumpTo === 'string' ? v.jumpTo : undefined });
  if (r.thread && r.thread.channelId === v.channelId && channelById(r.thread.channelId)) openThread({ id: r.thread.id, channelId: r.thread.channelId, serverId: r.thread.serverId }).catch(() => {});
}
async function updateAndReload() {
  saveResume();
  wantReload = true;
  const fallback = setTimeout(() => location.reload(), 8000);
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update(); // fetch the new version's files into the offline cache first
      const w = reg.installing || reg.waiting;
      if (w) {
        const go = () => w.postMessage('skipWaiting'); // the page reloads when the new version takes over
        if (w.state === 'installed') go(); else w.addEventListener('statechange', () => { if (w.state === 'installed') go(); });
        return;
      }
    }
  } catch { /* fall through */ }
  clearTimeout(fallback);
  location.reload();
}

// ======================================================================= announcement banner (from the admins)
function renderAnnouncement() {
  const a = S.config.announcement;
  let el = $('#announce');
  if (!a || localStorage.getItem('hearth.annDismissed') === a.id) { if (el) el.remove(); return; }
  if (!el) { el = h('div', { id: 'announce', role: 'status' }); document.body.append(el); }
  el.className = `announce lvl-${a.level || 'info'}`;
  clear(el).append(icon(a.level === 'warning' ? 'shield' : a.level === 'success' ? 'check' : 'megaphone'),
    h('span', { class: 'announce-text', html: md(a.text, { inline: true }) }),
    ibtn('close', 'Dismiss', () => { localStorage.setItem('hearth.annDismissed', a.id); el.remove(); }, { cls: 'sm' }));
}
