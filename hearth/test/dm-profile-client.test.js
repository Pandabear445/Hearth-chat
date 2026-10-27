// The profile beside a DM, the app's side (public/js/app.js): a choice of its own on this device (P.showDmProfile,
// 'hearth.dmprofile'), taken once from the member list's when the app first has it, so a profile someone had hidden
// stays hidden; DMs and servers (group chats too) then each keep theirs, whatever the other does. The code that keeps it
// (the preferences, restingPanel, togglePanel, setView's choice) runs here as it is, with the rest of the app stubbed;
// then what's in the page for it: the fold button, the header button, the slide and Reduce motion. test/e2e flows.mjs
// awayAndStatus folds and unfolds it in the real app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const APP = read('public', 'js', 'app.js');
const CSS = read('public', 'css', 'app.css');
const fn = (name) => {
  const a = APP.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(a >= 0, name);
  return APP.slice(a, APP.indexOf('\n}\n', a) + 2);
};

// This device's localStorage, as a Map (missing: never set). broken: every call throws, like storage that's blocked.
const storage = (init = {}, { broken = false } = {}) => {
  const m = new Map(Object.entries(init));
  const no = () => { throw new Error('SecurityError'); };
  return { m, getItem: broken ? no : (k) => (m.has(k) ? m.get(k) : null), setItem: broken ? no : (k, v) => { m.set(k, String(v)); } };
};

// The preferences (P) as app.js defines them, with what follows them when the module loads: a new start of the app.
function start(ls) {
  const a = APP.indexOf('\nconst P = {');
  const b = APP.indexOf('\n};\n', a) + 4;
  assert.ok(a > 0 && b > a, 'the preferences');
  // What runs right after them, at load (before init(), the first thing that could change the member list's choice).
  const next = APP.slice(b, APP.indexOf('\n\n', b));
  assert.match(next, /^try \{ if \(localStorage\.getItem\('hearth\.dmprofile'\) === null\) P\.showDmProfile = P\.showMembers; \} catch/m, 'taken once, at load');
  assert.ok(b < APP.indexOf('\ninit();\n'), 'before the app starts');
  return new Function('localStorage', 'LS', 'mine', 'S', `${APP.slice(a, b)}\n${next}\nreturn P;`)(ls, { get: (k, d) => d, set() {} }, (k) => k, {});
}

test('first start: the DM profile takes the member list’s choice once, so a hidden one stays hidden', () => {
  // Never chosen either: shown, as before.
  let ls = storage();
  let P = start(ls);
  assert.equal(ls.m.get('hearth.dmprofile'), 'on');
  assert.equal(P.showDmProfile, true);
  assert.equal(ls.m.has('hearth.members'), false, 'the member list’s is left as it was');
  // Hidden (one choice for both until now): stays hidden in DMs, and the member list stays hidden in servers.
  ls = storage({ 'hearth.members': 'off' });
  P = start(ls);
  assert.equal(ls.m.get('hearth.dmprofile'), 'off');
  assert.equal(P.showDmProfile, false);
  assert.equal(P.showMembers, false);
  // Shown: shown.
  ls = storage({ 'hearth.members': 'on' });
  P = start(ls);
  assert.equal(ls.m.get('hearth.dmprofile'), 'on');
  // Only once: showing a server's member list later doesn't bring a folded profile back, on this start or the next.
  ls = storage({ 'hearth.members': 'off' });
  P = start(ls);
  P.showMembers = true;
  assert.equal(P.showDmProfile, false);
  P = start(ls);
  assert.equal(P.showDmProfile, false, 'not taken again on the next start');
  assert.equal(ls.m.get('hearth.members'), 'on');
  // Already its own: never overwritten.
  ls = storage({ 'hearth.members': 'off', 'hearth.dmprofile': 'on' });
  P = start(ls);
  assert.equal(P.showDmProfile, true);
  ls = storage({ 'hearth.members': 'on', 'hearth.dmprofile': 'off' });
  P = start(ls);
  assert.equal(P.showDmProfile, false);
  // Storage that's blocked doesn't stop the app from loading.
  assert.doesNotThrow(() => start(storage({}, { broken: true })));
});

test('the two choices are independent: one changing leaves the other as it was', () => {
  const ls = storage();
  const P = start(ls);
  P.showDmProfile = false;
  assert.equal(P.showMembers, true);
  assert.equal(ls.m.get('hearth.members') ?? 'on', 'on');
  P.showMembers = false;
  assert.equal(P.showDmProfile, false);
  P.showDmProfile = true;
  assert.equal(P.showMembers, false);
  assert.deepEqual([ls.m.get('hearth.dmprofile'), ls.m.get('hearth.members')], ['on', 'off']);
  // Not taken yet (storage that couldn't be written at load): it goes with the member list's until it's set.
  const full = storage({ 'hearth.members': 'off' });
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(start(full).showDmProfile, false);
  assert.equal(full.m.has('hearth.dmprofile'), false);
});

// The side panel's choices as the app makes them: panelMode, restingPanel, togglePanel and setView's lines about it,
// with the page, the slide and the redraws stubbed. wide: the window has room for the panel beside the chat.
function panels({ view, panel = null, members = 'on', dmprofile = 'on', wide = true, shown = !!panel, focusInPanel = false }) {
  const ls = storage({ 'hearth.members': members, 'hearth.dmprofile': dmprofile });
  const P = start(ls);
  const S = { view, panel, thread: null };
  const focused = [];
  const panelEl = { hidden: !shown, contains: () => focusInPanel };
  const headProfile = { focus: () => focused.push('head-profile') };
  const $ = (sel) => (sel === '#members' ? panelEl : sel === '#main-head .head-profile' ? headProfile : null);
  const drawn = [];
  const document = { activeElement: {}, body: { classList: { toggle() {}, add() {} } } };
  const src = [fn('panelMode'), fn('restingPanel'), fn('togglePanel')].join('\n');
  const api = new Function('S', 'P', '$', 'document', 'wideEnoughForPanel', 'slidesPanel', 'slidePanel', 'renderPanel', 'renderHeader',
    `${src}\nreturn { panelMode, restingPanel, togglePanel };`)(
    S, P, $, document, () => wide, () => false, () => assert.fail('no slide here'),
    () => { drawn.push(S.panel); panelEl.hidden = !api.panelMode(); }, () => {});
  // setView's lines that choose the panel for where you're going.
  const at = APP.indexOf("  // A DM's profile and a member list are two choices");
  assert.ok(at > 0 && at < APP.indexOf('\nfunction goHome('), 'in setView');
  const lines = APP.slice(APP.indexOf('\n', APP.indexOf('\n', at) + 1) + 1, APP.indexOf("  document.body.classList.remove('nav-open');", at));
  const arrive = new Function('S', 'P', 'restingPanel', 'v', `S.view = v;\n${lines}`);
  return { ...api, S, P, ls, focused, drawn, go: (v) => arrive(S, P, api.restingPanel, v) };
}
const DM = { type: 'dm', dmId: 'd1' };
const DM2 = { type: 'dm', dmId: 'd2' };
const CHAN = { type: 'channel', channelId: 'c1', serverId: 's1' };

test('in a DM, the profile’s button folds and unfolds it and remembers that, leaving servers’ member lists alone', () => {
  const x = panels({ view: DM, panel: 'members' });
  x.togglePanel('members');
  assert.equal(x.S.panel, null);
  assert.deepEqual([x.ls.m.get('hearth.dmprofile'), x.ls.m.get('hearth.members')], ['off', 'on']);
  x.togglePanel('members');
  assert.equal(x.S.panel, 'members');
  assert.deepEqual([x.ls.m.get('hearth.dmprofile'), x.ls.m.get('hearth.members')], ['on', 'on']);
  // A server's (or a group chat's, a channel too) member list: its own choice only.
  const y = panels({ view: CHAN, panel: 'members' });
  y.togglePanel('members');
  assert.deepEqual([y.ls.m.get('hearth.dmprofile'), y.ls.m.get('hearth.members')], ['on', 'off']);
  y.togglePanel('members');
  assert.deepEqual([y.ls.m.get('hearth.dmprofile'), y.ls.m.get('hearth.members')], ['on', 'on']);
});

test('folded with its own button, the keyboard carries on from the header’s profile button', () => {
  const x = panels({ view: DM, panel: 'members', focusInPanel: true });
  x.togglePanel('members');
  assert.deepEqual(x.focused, ['head-profile']);
  // From the header's own button, focus is already there (renderHeader keeps it on the same button).
  const y = panels({ view: DM, panel: 'members', focusInPanel: false });
  y.togglePanel('members');
  assert.deepEqual(y.focused, []);
});

test('the panel a conversation opens with: a DM’s profile or a member list, each by its own choice, only where it fits', () => {
  for (const [members, dmprofile] of [['on', 'on'], ['on', 'off'], ['off', 'on'], ['off', 'off']]) {
    const x = panels({ view: DM, members, dmprofile });
    assert.equal(x.restingPanel(DM), dmprofile === 'on' ? 'members' : null, `DM, members ${members}, profile ${dmprofile}`);
    assert.equal(x.restingPanel(CHAN), members === 'on' ? 'members' : null, `channel, members ${members}, profile ${dmprofile}`);
    for (const v of [{ type: 'home' }, { type: 'voice', channelId: 'v1' }, { type: 'friends' }]) assert.equal(x.restingPanel(v), null, v.type);
    // A narrower window or a phone: never by itself.
    const n = panels({ view: DM, members, dmprofile, wide: false });
    assert.equal(n.restingPanel(DM), null);
    assert.equal(n.restingPanel(CHAN), null);
  }
});

test('going between DMs and channels: each opens with its own choice, and an open panel stays only where it’s shown too', () => {
  // Folded in DMs, shown in servers: a channel's member list doesn't follow you into a DM, and comes back in the channel.
  const x = panels({ view: CHAN, panel: 'members', dmprofile: 'off' });
  x.go(DM);
  assert.equal(x.S.panel, null);
  x.go(DM2);
  assert.equal(x.S.panel, null, 'another DM: still folded');
  x.go(CHAN);
  assert.equal(x.S.panel, 'members');
  // The other way round.
  const y = panels({ view: DM, panel: 'members', members: 'off' });
  y.go(DM2);
  assert.equal(y.S.panel, 'members');
  y.go(CHAN);
  assert.equal(y.S.panel, null);
  y.go(DM);
  assert.equal(y.S.panel, 'members');
  // A narrower window: nothing opens by itself, and one opened by hand stays open where it's shown.
  const n = panels({ view: CHAN, panel: null, wide: false });
  n.go(DM);
  assert.equal(n.S.panel, null);
  n.S.panel = 'members';
  n.go(DM2);
  assert.equal(n.S.panel, 'members');
  n.P.showMembers = false;
  n.go(CHAN);
  assert.equal(n.S.panel, null);
  // Whatever else is open (Pinned to side, a call's chat…) is left to setView's other lines.
  const s = panels({ view: DM, panel: 'side', dmprofile: 'off' });
  s.go(CHAN);
  assert.equal(s.S.panel, 'side');
});

test('closing pinned messages, photos & videos or the side view in a DM goes back to its profile when that’s shown', () => {
  for (const mode of ['pins', 'media', 'side']) {
    const x = panels({ view: DM, panel: mode });
    x.togglePanel(mode);
    assert.equal(x.S.panel, 'members', mode);
    assert.equal(x.ls.m.get('hearth.dmprofile'), 'on', 'its choice is left as it was');
    const y = panels({ view: DM, panel: mode, dmprofile: 'off' });
    y.togglePanel(mode);
    assert.equal(y.S.panel, null, `${mode}, folded`);
    const n = panels({ view: DM, panel: mode, wide: false });
    n.togglePanel(mode);
    assert.equal(n.S.panel, null, `${mode}, on a narrower window or a phone, as before`);
    // A channel's panels close as before.
    const c = panels({ view: CHAN, panel: mode });
    c.togglePanel(mode);
    assert.equal(c.S.panel, null, `${mode} in a channel`);
  }
  // A thread closing (closeThread) goes back to the same panel, and the server menu's Members is the member list's.
  assert.match(fn('closeThread'), /S\.panel = back \? 'threads' : restingPanel\(\);/);
  assert.match(APP, /label: 'Members', icon: 'people', action: \(\) => \{[^\n]*P\.showMembers = true; renderAll\(\); \}/);
  assert.doesNotMatch(APP, /P\.showMembers && wideEnoughForPanel\(\)/, 'nothing else decides it by the member list’s choice alone');
});

test('the page: a fold button on the profile, the header’s button says whether it’s open, and the slide follows Reduce motion', () => {
  // The panel's own row, its fold button first (where the panel meets the chat), and the same toggle.
  const dmp = fn('dmProfilePanel');
  assert.match(dmp, /h\('div', \{ class: 'panel-head dm-profile-head' \},\n {4}ibtn\('panelClose', 'Hide profile', \(\) => togglePanel\('members'\), \{ cls: 'dm-fold', side: 'bottom' \}\),\n {4}h\('div', \{ class: 'panel-title' \}, h\('h2', null, 'Profile'\)\)\)\);/);
  assert.match(read('public', 'js', 'util.js'), /^ {2}panelClose: '<svg /m);
  // The header's button: Show/Hide in its name, aria-expanded (not aria-pressed) and what it controls.
  const pb = fn('profileButton');
  assert.match(pb, /open \? 'Hide profile' : 'Show profile', \(\) => togglePanel\('members'\)/);
  assert.match(pb, /cls: 'head-profile', attrs: \{ 'aria-pressed': null, 'aria-expanded': String\(open\), 'aria-controls': 'members' \}/);
  assert.match(fn('drawHeader'), /sideButton\(\),\n {8}profileButton\(\),/);
  assert.match(CSS, /#main-head \.head-profile\.active \{/);
  // The slide: only beside the chat, never with Reduce motion (the app's or the system's).
  assert.match(APP, /const slidesPanel = \(\) => wideEnoughForPanel\(\) && !document\.documentElement\.classList\.contains\('reduce-motion'\) && !matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/);
  const tp = fn('togglePanel');
  assert.match(tp, /if \(profileShown && !S\.panel && slidesPanel\(\)\) slidePanel\(el, true, \(\) => renderPanel\(\)\);/);
  assert.match(tp, /if \(dm && !shown && S\.panel === 'members' && !el\.hidden && slidesPanel\(\)\) slidePanel\(el, false\);/);
  // Meanwhile a redraw (presence) leaves the panel sliding shut as it is; anything else stops it.
  const rp = fn('renderPanel');
  assert.ok(rp.indexOf('if (sliding) {') > 0 && rp.indexOf('if (sliding) {') < rp.indexOf('clear(el);'), 'before the panel is emptied');
  // The CSS: ~180 ms, width and opacity, in the panel-in style, which stays in the list so it isn't played again.
  assert.match(CSS, /#members\.panel-folding \{ animation: panel-in \.18s var\(--ease\), panel-fold \.18s var\(--ease\) forwards; \}/);
  assert.match(CSS, /#members\.panel-unfolding \{ animation: panel-in \.18s var\(--ease\), panel-unfold \.18s var\(--ease\); \}/);
  assert.match(CSS, /@keyframes panel-fold \{ to \{ width: 0; opacity: 0; \} \}/);
  // And the reduced-motion rules cover every animation (these among them) as a second guard.
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\*:not\(\.spinner\), \*::before, \*::after \{ animation-duration: \.001ms !important;/);
  assert.match(CSS, /html\.reduce-motion \*:not\(\.spinner\), html\.reduce-motion \*::before, html\.reduce-motion \*::after \{ animation-duration: \.001ms !important;/);
});
