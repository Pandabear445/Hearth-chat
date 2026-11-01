// First run, onboarding and the app's chrome (1.44): what the page shows before any script runs, the sign-in forms,
// the offer and update cards, the "Secure your account" card, the empty state, and reopening where you were. Read from
// the files as they ship (index.html, app.js, ux-onboarding.css); test/e2e/ux-onboarding.mjs drives the real app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const html = read('public', 'index.html');
const app = read('public', 'js', 'app.js');
const css = read('public', 'css', 'ux-onboarding.css');
// The body of a function in app.js, from its line to the next top-level function.
function fn(name) {
  const at = app.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(at >= 0, `app.js has no function ${name}`);
  const next = app.slice(at + 1).search(/^(async )?function \w+\(|^const \w+ = /m);
  return app.slice(at, next < 0 ? undefined : at + 1 + next);
}
// The CSS rules for a selector, joined.
const rules = (src, sel) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === sel)).map(([, , body]) => body).join(';');

test('first paint: a splash in the page itself, outside anything hidden, with no script of its own', () => {
  const body = html.slice(html.indexOf('<body>'));
  const splash = body.indexOf('<div id="boot-splash"');
  assert.ok(splash > 0, 'index.html has #boot-splash');
  // Before #auth and #app (both start hidden), not inside them.
  assert.ok(splash < body.indexOf('<div id="auth"') && splash < body.indexOf('<div id="app"'), 'the splash comes before #auth and #app');
  const tag = body.slice(splash, body.indexOf('>', splash) + 1);
  assert.match(tag, /role="status"/);
  assert.match(tag, /aria-live="polite"/);
  assert.doesNotMatch(tag, /\shidden/);
  // CSP: only the two script tags the page always had, both with src; no inline handlers anywhere.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const [, attrs, inner] of scripts) { assert.match(attrs, /\ssrc="/); assert.equal(inner.trim(), ''); }
  assert.doesNotMatch(html, /\son[a-z]+="/i, 'no inline event handlers');
  // Styled by ux-onboarding.css, in the device's light or dark, and still for reduced motion.
  assert.ok(rules(css, '#boot-splash'), 'ux-onboarding.css styles #boot-splash');
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #boot-splash \.boot-mark \{ animation: none; \} \}/);
});

test('first paint: every way the start can end takes the splash away', () => {
  assert.match(fn('showSignIn'), /dropSplash\(\)/, 'the sign-in screen');
  assert.match(fn('startApp'), /dropSplash\(\)/, 'the app');
  assert.match(fn('init'), /try \{ await bootUp\(\); \} catch \(e\) \{ bootFailed\(e\); \}/, 'a start that fails says so in the splash');
  assert.match(fn('bootFailed'), /Reload the page/);
});

test('sign-in forms: the browser\'s own bubbles are off, the app says what\'s wrong in place', () => {
  assert.match(html, /<form id="login-form"[^>]*\snovalidate/);
  assert.match(html, /<form id="register-form"[^>]*\snovalidate/);
  const sign = fn('showSignIn');
  assert.match(sign, /Usernames can only use letters, numbers, _ and \. \(no spaces\)\./);
  assert.match(sign, /Tick the box to agree to the Terms of Service\./);
  assert.match(sign, /Enter your username\./);
  assert.match(sign, /markInvalid\(input, err\)/);
  // A hint under the new password, and show/hide buttons that say whether they're on.
  assert.match(html, /<span class="field-hint" id="register-password-hint">At least 8 characters\.<\/span>/);
  const eyes = [...html.matchAll(/<button type="button" class="pw-eye"([^>]*)>/g)];
  assert.equal(eyes.length, 2);
  for (const [, a] of eyes) { assert.match(a, /aria-pressed="false"/); assert.match(a, /aria-label="Show password"/); assert.match(a, /aria-controls="/); }
  assert.match(sign, /eye\.setAttribute\('aria-pressed', String\(show\)\)/);
});

test('an invite link and no account here: the sign-up form, headed with the server, then joined without a second step', () => {
  const sign = fn('showSignIn');
  assert.match(sign, /sessionStorage\.getItem\('hearth\.pendingInvite'\) && S\.config\.registrationOpen && !S\.config\.registrationRequiresCode && !signedInHereBefore\(\)/);
  assert.match(sign, /regForm\.hidden = false/);
  assert.match(fn('inviteBanner'), /`Join \$\{serverName \|\| 'a server'\} on \$\{S\.config\.name\}`/);
  assert.match(app, /sessionStorage\.setItem\('hearth\.inviteAutoJoin', '1'\)/);
  const boot = fn('loadBootstrap');
  assert.match(boot, /joinInvite\(invite\)\.catch\(\(\) => openJoinModal\(invite\)\)/);
  // Logged in already: the Join window's button names the server.
  assert.match(fn('openJoinModal'), /joinBtn\.textContent = `Join \$\{info\.name\}`/);
});

test('offers and the update: never half the screen, never over the tab bar or the message box', () => {
  const offer = rules(css, '.push-offer');
  assert.doesNotMatch(css, /translateX\(-50%\)/);
  assert.match(rules(css, '.update-bar') + offer, /transform: none/);
  // On a phone: above the tab bar (its real token), and above the message box in a conversation.
  assert.match(css, /body\.m-ui \.update-bar, body\.m-ui \.push-offer \{[^}]*bottom: calc\(var\(--tab-h\) \+ env\(safe-area-inset-bottom\) \+ 10px\)/);
  assert.match(css, /body\.m-ui\.m-conv \.update-bar, body\.m-ui\.m-conv \.push-offer \{ bottom: max\(var\(--offer-lift/);
  assert.doesNotMatch(css, /--tabbar-h/);
  // The desktop app's update: a pill in the sidebar, no floating bar; restarting mid-call still asks first.
  const upd = fn('showAppUpdate');
  assert.doesNotMatch(upd, /update-bar/);
  assert.match(upd, /\$\('#user-panel'\)/);
  assert.match(upd, /confirmDialog\(\{ title: 'Restart now\?'/);
  // The iPhone tip is two steps.
  assert.match(fn('applePushAtStart'), /h\('ol', \{ class: 'tip-steps' \}/);
});

test('the web asks for notifications when they start to matter, and "Not now" holds for a week', () => {
  const ask = fn('firstHappened');
  assert.match(ask, /androidApp\.on \|\| iosApp\.on \|\| window\.hearthDesktop/);
  assert.match(ask, /Notification\.permission !== 'default'/);
  assert.match(app, /const ASK_WAIT = 7 \* 24 \* 60 \* 60 \* 1000;/);
  const watch = fn('watchFirsts');
  for (const ev of ['dm:message', 'relationship:update', 'server:add']) assert.ok(watch.includes(`socket.on('${ev}'`), ev);
});

test('"Secure your account": what\'s missing, for the card, the You tab and Settings', () => {
  assert.match(fn('securityTodo'), /email: !\(me\.email && me\.emailVerified\), recovery: !me\.hasRecovery/);
  assert.match(app, /app\.securityTodo = \(\) => securityTodo\(\);/);
  assert.match(fn('securityCard'), /openSettings\(app, 'account', \{ focus/);
  assert.match(fn('renderTabbarBadges'), /t === 'you' && securityNag\(\)/);
});

test('no servers yet: join, create or add a friend; the phone\'s inner Home is its Overview', () => {
  const steps = fn('firstSteps');
  assert.match(steps, /if \(realServers\(\)\.length\) return null;/);
  for (const t of ['Join with an invite link', 'Create a server', 'Add a friend by username']) assert.ok(steps.includes(`'${t}'`), t);
  const side = fn('renderSidebar');
  assert.match(side, /nav\('Overview', 'home'/);
  assert.match(side, /usedMyReels\(\) \? nav\('My Reels'/);
  // On a computer Saved messages and My Reels are rows of their own; More keeps Updates and People.
  const more = side.slice(side.indexOf('const extras = ['), side.indexOf('].filter(Boolean);', side.indexOf('const extras = [')));
  assert.doesNotMatch(more, /Saved messages|My Reels/);
  // The new-message window with nobody to pick: add a friend there; Start waits for someone.
  const nc = fn('openNewConversation');
  assert.match(nc, /startBtn\.disabled = !picked\.size/);
  assert.match(nc, /'Add a friend'/);
});

test('reopening: where you were is remembered on every view change and when the page goes', () => {
  const sv = fn('setView');
  assert.match(sv, /rememberView\(\);/);
  assert.match(sv, /UI\.hideTip\(\)/);
  assert.match(app, /window\.addEventListener\('pagehide', \(\) => rememberView\(\)\);/);
  assert.match(fn('rememberView'), /`hearth\.last\.\$\{S\.me\.id\}`|lastViewKey\(\)/);
  // Only on the first start, only if it's still there, and before invites and links (which come after).
  const boot = fn('loadBootstrap');
  assert.match(boot, /const resumed = !startedOnce && resumeLastView\(\);/);
  assert.ok(boot.indexOf('resumeLastView()') < boot.indexOf('restoreResume()'));
  const r = fn('resumeLastView');
  assert.match(r, /S\.dms\.some\(\(d\) => d\.id === r\.dmId\)/);
  assert.match(r, /channelById\(r\.channelId\)/);
  assert.match(r, /if \(isPhoneUI\(\)\) phoneEnter\(v\);/);
});

test('the invite window: the VPS line only for whoever runs it on a private address; Share first on touch', () => {
  const inv = fn('openInvite');
  assert.match(inv, /\['owner', 'admin'\]\.includes\(S\.me\.staffRole\) && privateOrigin\(location\.hostname\)/);
  assert.match(inv, /`Anyone with this link can join \$\{server\.name\}\.`/);
  assert.match(inv, /const shareFirst = isTouchUI\(\) && canShare/);
  const priv = fn('privateOrigin');
  // eslint-disable-next-line no-new-func
  const check = new Function(`${priv}; return privateOrigin;`)();
  for (const h of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.1.1', 'hearth.local', '[::1]']) assert.equal(check(h), true, h);
  for (const h of ['chat.example.com', '172.32.0.1', '8.8.8.8', '100.64.0.1']) assert.equal(check(h), false, h);
});
