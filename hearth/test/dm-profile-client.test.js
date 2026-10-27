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
// slides: it would slide here (wide, no Reduce motion); sliding: a slide under way ({ shut }). log: what was drawn and
// slid, in order.
function panels({ view, panel = null, members = 'on', dmprofile = 'on', wide = true, shown = !!panel, focusInPanel = false, slides = false, sliding = null }) {
  const ls = storage({ 'hearth.members': members, 'hearth.dmprofile': dmprofile });
  const P = start(ls);
  const S = { view, panel, thread: null };
  const focused = [];
  const panelEl = { hidden: !shown, contains: () => focusInPanel };
  const headProfile = { focus: () => focused.push('head-profile') };
  const $ = (sel) => (sel === '#members' ? panelEl : sel === '#main-head .head-profile' ? headProfile : null);
  const drawn = [];
  const log = [];
  const document = { activeElement: {}, body: { classList: { toggle() {}, add() {} } } };
  const src = [fn('panelMode'), fn('restingPanel'), fn('togglePanel')].join('\n');
  const api = new Function('S', 'P', '$', 'document', 'wideEnoughForPanel', 'slidesPanel', 'slidePanel', 'renderPanel', 'renderHeader', 'sliding',
    `${src}\nreturn { panelMode, restingPanel, togglePanel };`)(
    S, P, $, document, () => wide, () => slides,
    slides ? (el, shut) => log.push(shut ? 'slide shut' : 'slide open') : () => assert.fail('no slide here'),
    () => { drawn.push(S.panel); log.push(`draw ${S.panel}`); panelEl.hidden = !api.panelMode(); }, () => {}, sliding);
  // setView's lines that choose the panel for where you're going.
  const at = APP.indexOf("  // A DM's profile and a member list are two choices");
  assert.ok(at > 0 && at < APP.indexOf('\nfunction goHome('), 'in setView');
  const lines = APP.slice(APP.indexOf('\n', APP.indexOf('\n', at) + 1) + 1, APP.indexOf("  document.body.classList.remove('nav-open');", at));
  const arrive = new Function('S', 'P', 'restingPanel', 'v', `S.view = v;\n${lines}`);
  return { ...api, S, P, ls, focused, drawn, log, go: (v) => arrive(S, P, api.restingPanel, v) };
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

test('pressed again while the profile slides, it turns back rather than starting over', () => {
  // Sliding shut (still shown): shown again, the slide under way turns round before the panel is drawn, and the choice
  // is remembered.
  const x = panels({ view: DM, panel: null, shown: true, slides: true, sliding: { shut: true } });
  x.togglePanel('members');
  assert.equal(x.S.panel, 'members');
  assert.deepEqual(x.log, ['slide open', 'draw members']);
  assert.equal(x.ls.m.get('hearth.dmprofile'), 'on');
  // Sliding open: folded again, slidePanel is asked to fold it (and turns the slide under way, below).
  const y = panels({ view: DM, panel: 'members', slides: true, sliding: { shut: false } });
  y.togglePanel('members');
  assert.equal(y.S.panel, null);
  assert.deepEqual(y.log, ['slide shut']);
  assert.equal(y.ls.m.get('hearth.dmprofile'), 'off');
  // Where it doesn't slide (Reduce motion turned on meanwhile, a narrower window): shown at once, as before.
  const z = panels({ view: DM, panel: null, shown: true, sliding: { shut: true } });
  z.togglePanel('members');
  assert.deepEqual(z.log, ['draw members']);
});

// slidePanel as it is, with the panel, the chat, their animations and the timer stubbed.
function slider() {
  let key = 'd:d1';
  const timers = new Map();
  let seq = 0;
  const anim = (name, playState = 'running') => ({
    animationName: name, playState, calls: [],
    effect: { updateTiming(t) { this.owner.calls.push(`fill ${t.fill}`); } },
    reverse() { this.calls.push('reverse'); },
  });
  const withOwner = (a) => { a.effect.owner = a; return a; };
  const node = (box) => {
    const cls = new Set();
    const props = {};
    const on = {};
    return {
      ...box, cls, props, anims: [], inert: false,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
      addEventListener: (t, f) => { on[t] = f; }, removeEventListener: (t) => { delete on[t]; },
      fire: (t, e) => on[t] && on[t](e),
      getAnimations() { return this.anims; },
    };
  };
  const el = node({ offsetLeft: 808, offsetWidth: 272, clientWidth: 271 });
  const main = node({ offsetLeft: 0, offsetWidth: 800, clientWidth: 800 });
  const $ = (sel) => (sel === '#main' ? main : sel === '#app' ? {} : null);
  assert.match(APP, /^const FOLD_MS = 180;$/m);
  const api = new Function('$', 'currentKey', 'getComputedStyle', 'setTimeout', 'clearTimeout',
    `const FOLD_MS = 180;\nlet sliding = null;\n${fn('slidePanel')}\nreturn { slidePanel, sliding: () => sliding };`)(
    $, () => key, () => ({ columnGap: '8px' }), (f) => { timers.set(++seq, f); return seq; }, (id) => timers.delete(id));
  // The animations app.css starts for a slide each way.
  const runs = (shut, state) => {
    el.anims = [withOwner(anim('panel-in')), withOwner(anim(shut ? 'panel-fold' : 'panel-unfold', state))];
    main.anims = [withOwner(anim(shut ? 'main-fold' : 'main-unfold', state))];
  };
  return { ...api, el, main, runs, timeUp: () => [...timers.values()].forEach((f) => f()), go: (k) => { key = k; } };
}

test('turned back partway, the slide under way plays backwards from where it is, and ends the way it’s now going', () => {
  const z = slider();
  const closed = [];
  // Folding, then shown again before it's shut: the same slide, its animations reversed and held where they end up;
  // its classes stay (new animations would start over from their beginning), and it's in reach again.
  z.runs(true);
  z.slidePanel(z.el, true, () => closed.push('closed'));
  const s = z.sliding();
  assert.equal(z.el.inert, true);
  z.slidePanel(z.el, false);
  assert.equal(z.sliding(), s, 'the same slide');
  assert.equal(s.shut, false);
  assert.deepEqual(z.el.anims.map((a) => a.calls), [[], ['fill both', 'reverse']], 'the fold only, not panel-in');
  assert.deepEqual(z.main.anims[0].calls, ['fill both', 'reverse']);
  assert.ok(z.el.cls.has('panel-folding') && z.main.cls.has('panel-folding') && !z.el.cls.has('panel-unfolding'));
  assert.equal(z.el.inert, false);
  // Back where it started: over, and not closed.
  z.el.fire('animationend', { target: z.el, animationName: 'panel-fold' });
  assert.equal(z.sliding(), null);
  assert.deepEqual(closed, []);
  assert.ok(!z.el.cls.has('panel-folding') && !z.main.cls.has('panel-folding') && !('--fold-w' in z.el.props));
  // Unfolding, then folded again: out of reach, and closed once it's shut (by the timer, should the end not come).
  z.runs(false);
  z.slidePanel(z.el, false);
  z.slidePanel(z.el, true, () => closed.push('closed'));
  assert.equal(z.sliding().shut, true);
  assert.equal(z.el.inert, true);
  assert.ok(z.el.cls.has('panel-unfolding'));
  z.timeUp();
  assert.deepEqual(closed, ['closed']);
  assert.equal(z.sliding(), null);
  // Turned twice: back to folding, and closed then.
  z.runs(true);
  z.slidePanel(z.el, true, () => closed.push('closed again'));
  z.slidePanel(z.el, false);
  z.slidePanel(z.el, true, () => closed.push('closed again'));
  assert.deepEqual(z.el.anims[1].calls, ['fill both', 'reverse', 'fill both', 'reverse']);
  z.el.fire('animationend', { target: z.el, animationName: 'panel-fold' });
  assert.deepEqual(closed, ['closed', 'closed again']);
  // Already over (its animations done), or in another conversation by then: stopped, and a new slide starts as before.
  for (const [state, k] of [['finished', 'd:d1'], ['running', 'd:d2']]) {
    z.go('d:d1');
    z.runs(true, state);
    z.slidePanel(z.el, true, () => closed.push('not this'));
    const old = z.sliding();
    z.go(k);
    z.slidePanel(z.el, false);
    assert.notEqual(z.sliding(), old, `${state} in ${k}`);
    assert.ok(z.el.cls.has('panel-unfolding') && !z.el.cls.has('panel-folding'));
    assert.deepEqual(z.el.anims[1].calls, []);
    z.sliding().end(false);
  }
  assert.deepEqual(closed, ['closed', 'closed again']);
});

// A small page for dmProfilePlace: elements with a tag, a class, a label, a link and text, found by their tag.
function page() {
  const doc = { activeElement: null };
  const make = (tag, { cls = '', label = null, href = null, text = '' } = {}, kids = []) => {
    const n = {
      tagName: tag.toUpperCase(), className: cls, kids, scrollTop: 0, dataset: {},
      get textContent() { return text + kids.map((k) => k.textContent).join(''); },
      getAttribute: (k) => (k === 'aria-label' ? label : k === 'href' ? href : null),
      matches: (sel) => sel.split(',').map((x) => x.trim().toUpperCase()).includes(n.tagName),
      all: () => kids.flatMap((k) => [k, ...k.all()]),
      contains: (x) => x === n || n.all().includes(x),
      querySelectorAll: (t) => n.all().filter((k) => k.tagName === t.toUpperCase()),
      querySelector: (sel) => { assert.equal(sel, ':scope > .dm-profile'); return kids.find((k) => k.className === 'dm-profile') || null; },
      focus: (o) => { assert.deepEqual(o, { preventScroll: true }); doc.activeElement = n; },
    };
    return n;
  };
  return { doc, make };
}

test('a DM’s profile drawn afresh (anyone’s status or game changing) keeps the focus where it was, and its scroll', () => {
  const { doc, make } = page();
  // The profile as dmProfilePanel draws it; game: what someone's playing, now shown above the rest.
  const draw = (game = false) => [
    make('div', { cls: 'panel-head dm-profile-head' }, [make('button', { cls: 'icon-btn dm-fold', label: 'Hide profile' })]),
    make('div', { cls: 'dm-profile' }, [
      ...(game ? [make('button', { cls: 'act-join', text: 'Join' }), make('a', { cls: 'pc-link', href: 'https://game.example', text: 'Store page' })] : []),
      make('a', { cls: 'pc-link', href: 'https://example.org', text: 'example.org' }),
      make('button', { cls: 'pc-mutual', text: 'Alpha' }),
      make('button', { cls: 'pc-mutual', text: 'Beta' }),
    ]),
  ];
  const panel = make('div', {}, draw());
  panel.dataset.mode = 'members';
  panel.dataset.key = 'd:d1';
  let key = 'd:d1';
  const place = () => new Function('document', 'currentKey', `${fn('dmProfilePlace')}\nreturn dmProfilePlace;`)(doc, () => key)(panel);
  // renderPanel: emptied (the focus falls to the page), then drawn again.
  const redraw = (game) => { panel.kids.splice(0, panel.kids.length, ...draw(game)); doc.activeElement = { tagName: 'BODY' }; };
  const fold = () => panel.kids[0].kids[0];
  const box = () => panel.querySelector(':scope > .dm-profile');
  const named = (text) => box().kids.find((k) => k.textContent === text);

  // Its fold button: the new one has the focus.
  doc.activeElement = fold();
  let back = place();
  redraw();
  back();
  assert.equal(doc.activeElement, fold());
  // A mutual server further down, scrolled to: the same one, scrolled the same, though a game's buttons and links
  // show up above it.
  box().scrollTop = 240;
  doc.activeElement = named('Beta');
  back = place();
  redraw(true);
  back();
  assert.equal(doc.activeElement, named('Beta'));
  assert.equal(box().scrollTop, 240);
  doc.activeElement = named('example.org');
  back = place();
  redraw(false);
  back();
  assert.equal(doc.activeElement, named('example.org'));
  // Focus somewhere else (the message box): only the scroll, and nothing taken from it.
  const composer = make('textarea');
  doc.activeElement = composer;
  box().scrollTop = 120;
  back = place();
  redraw();
  doc.activeElement = composer;
  back();
  assert.equal(doc.activeElement, composer);
  assert.equal(box().scrollTop, 120);
  // Gone from it (no longer a mutual server): the focus isn't put on anything else.
  doc.activeElement = named('Alpha');
  back = place();
  panel.kids.splice(0, panel.kids.length, ...draw());
  box().kids.splice(1, 1);
  doc.activeElement = { tagName: 'BODY' };
  back();
  assert.equal(doc.activeElement.tagName, 'BODY');
  // Drawn for another conversation (setView forgets what it was drawn for), or showing something else: drawn as new.
  key = 'd:d2';
  assert.equal(place(), null);
  key = 'd:d1';
  panel.dataset.mode = 'pins';
  assert.equal(place(), null);

  // renderPanel notes it before emptying the panel and puts it back once the profile's drawn; dmProfilePanel says
  // which conversation it's drawn for.
  const rp = fn('renderPanel');
  const noted = rp.indexOf("const dmPlace = mode === 'members' && S.view.type === 'dm' ? dmProfilePlace(el) : null;");
  assert.ok(noted > 0 && noted < rp.indexOf('clear(el);'), 'noted before the panel is emptied');
  assert.match(rp, /dmProfilePanel\(el\);\n {4}if \(dmPlace\) dmPlace\(\);/);
  assert.match(fn('dmProfilePanel'), /el\.dataset\.key = currentKey\(\);/);
  assert.match(fn('setView'), /if \(panelEl\) delete panelEl\.dataset\.key;/);
});
