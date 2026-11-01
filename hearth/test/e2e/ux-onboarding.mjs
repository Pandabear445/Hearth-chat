// First run, onboarding and the app's chrome (1.44, docs: the UX plan's WP-D), in the real app: the sign-up form's
// messages, a new account's Home on a phone (how to start, above the tab bar), the iPhone tip, an invite link opened
// signed out, reopening where you were, the desktop app's update, and "Secure your account".
// Run after flows.mjs (run.mjs), with its people: bob signs in again (his password never changes there). The new accounts here come from networks of
// their own (x-forwarded-for, as flows.mjs's nova): the main flows use up the sign-ups one network gets in an hour.
import { PHONE, exact, newPassword } from './harness.mjs';
import { check } from './flows.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const SERVER = 'UX Den';
const fresh = (n) => ({ extraHTTPHeaders: { 'x-forwarded-for': `198.18.90.${n}` } });
const bottomOf = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().bottom : null; }, sel);
const topOf = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : null; }, sel);
// Whether a click in the middle of this element reaches it (nothing covers it).
const reachable = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, sel);
// A REST call as the person signed in on this page.
const api = (p, method, url, body) => p.page.evaluate(async ([m, u, b]) => {
  const r = await fetch('/api' + u, { method: m, headers: { authorization: 'Bearer ' + localStorage.getItem('hearth.token'), ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) throw new Error(`${m} ${u}: ${r.status} ${await r.text()}`);
  return r.json();
}, [method, url, body]);

// ------------------------------------------------------------------ the sign-up form, and a new account on a phone
async function newOnPhone(t) {
  t.pw.uxnew = newPassword();
  const p = await t.open('uxnew', { ...PHONE, ...fresh(1) });
  const { page } = p;
  // The browser's own bubbles are off: the app says what's wrong, on the field it's about.
  await p.$('#login-form button[type=submit]').tap();
  await p.$('#login-form .form-error', { hasText: 'Enter your username.' }).waitFor();
  check(await p.$('#login-form [name=username]').getAttribute('aria-invalid') === 'true', 'An empty username should be marked invalid.');
  await p.$('#to-register').tap();
  const f = p.$('#register-form');
  await f.locator('[name=username]').fill('a b');
  await f.locator('button[type=submit]').tap();
  await f.locator('.form-error', { hasText: 'Usernames can only use letters, numbers, _ and . (no spaces).' }).waitFor();
  await f.locator('[name=username]').fill('uxnew');
  await f.locator('[name=password]').fill(t.pw.uxnew);
  await f.locator('[name=confirm]').fill(t.pw.uxnew);
  // Show/hide: both password boxes, and the button says it's on.
  await f.locator('.pw-eye').tap();
  check(await f.locator('[name=confirm]').getAttribute('type') === 'text' && await f.locator('.pw-eye').getAttribute('aria-pressed') === 'true', 'Show password should show both boxes and be pressed.');
  await f.locator('.pw-eye').tap();
  await f.locator('button[type=submit]').tap();
  await f.locator('.form-error', { hasText: 'Tick the box to agree to the Terms of Service.' }).waitFor();
  await f.locator('[name=tos]').check();
  await f.locator('button[type=submit]').tap();
  await p.waitApp();

  // No servers yet: three ways in, at the bottom of Home's list and above the tab bar.
  const card = p.$('#sidebar-body .start-card');
  await card.waitFor();
  check(await card.locator('.start-item').count() === 3, 'The phone’s Home should offer three ways to start.');
  const cardBottom = await bottomOf(page, '#sidebar-body .start-card');
  const barTop = await topOf(page, '#tabbar');
  check(cardBottom <= barTop, `The start card should end above the tab bar (card ${cardBottom}, bar ${barTop}).`);
  check(await p.$('#sidebar-body .nav-row', { hasText: exact('Overview') }).count() === 1, 'The phone’s inner Home row should be called Overview.');
  check(/secure your account/.test(await p.$('#tabbar button[data-tab="you"]').getAttribute('aria-label')), 'The You tab should have a dot (and say why) while the account isn’t secured.');
  // The first step opens the Join window.
  await card.locator('.start-item', { hasText: 'Join with an invite link' }).tap();
  const join = await p.dialog('Join a server');
  await join.locator('.modal-x').tap();
  await p.noModals();

  // The same account in Safari on an iPhone: the Home Screen tip, in two steps, clear of the tab bar.
  const ip = await t.open('uxnew-iphone', { ...PHONE, userAgent: IPHONE_UA, ...fresh(1) });
  await ip.login('uxnew', t.pw.uxnew);
  const tip = ip.$('.push-offer.ios-tip');
  await tip.waitFor();
  check(await tip.locator('.tip-steps li').count() === 2, 'The iPhone tip should be two steps.');
  const tipBottom = await bottomOf(ip.page, '.push-offer.ios-tip');
  const tipBar = await topOf(ip.page, '#tabbar');
  check(tipBottom <= tipBar, `The iPhone tip should sit above the tab bar (tip ${tipBottom}, bar ${tipBar}).`);
  check((await tip.boundingBox()).width > 300, 'The iPhone tip should be a full-width card, not a narrow column.');
  await tip.locator('button', { hasText: 'Got it' }).tap();
  await tip.waitFor({ state: 'detached' });
  await ip.close();
  await p.close();
}

// ------------------------------------------------------------------ an invite link, signed out
async function inviteSignUp(t) {
  const owner = await t.open('bob-ux');
  await owner.login('bob', t.pw.bob);
  await owner.createServer(SERVER);
  const sid = (await api(owner, 'GET', '/bootstrap')).servers.find((s) => s.name === SERVER).id;
  const { code } = await api(owner, 'POST', `/servers/${sid}/invites`, { expiresHours: 24, maxUses: 0 });
  t.state.uxInvite = code;

  t.pw.ivy = newPassword();
  const ivy = await t.open('ivy', fresh(2));
  await ivy.page.goto(`${t.server.base}/invite/${code}`);
  // Nobody signed in here before: the sign-up form, headed with what it's for.
  await ivy.$('#register-form').waitFor();
  check(await ivy.$('#login-form').isHidden(), 'With an invite link and no account here, the login form should wait behind “Log in”.');
  await ivy.$('#register-title', { hasText: /^Join .* on / }).waitFor();
  const f = ivy.$('#register-form');
  await f.locator('[name=username]').fill('ivy');
  await f.locator('[name=password]').fill(t.pw.ivy);
  await f.locator('[name=confirm]').fill(t.pw.ivy);
  await f.locator('[name=tos]').check();
  await f.locator('button[type=submit]').click();
  await ivy.waitApp();
  // In the server, in its channel, with no Join window in between.
  await ivy.$('#sidebar-head .server-head-name', { hasText: exact(SERVER) }).waitFor();
  await ivy.$('#main-head h1', { hasText: exact('general') }).waitFor();
  check(!(await ivy.$('.modal').count()), 'Signing up through an invite should join at once, with no Join window.');
  t.people['bob-ux'] = owner;
  t.people.ivy = ivy;
}

// ------------------------------------------------------------------ reopening where you were
async function resume(t) {
  const owner = t.people['bob-ux'];
  await owner.$('#main-head h1', { hasText: exact('general') }).waitFor();
  await owner.page.reload();
  await owner.waitApp();
  await owner.$('#sidebar-head .server-head-name', { hasText: exact(SERVER) }).waitFor();
  await owner.$('#main-head h1', { hasText: exact('general') }).waitFor();

  // A phone opens in the conversation, over its list: Back goes to the list.
  const phone = await t.open('ivy-phone', { ...PHONE, ...fresh(2) });
  await phone.login('ivy', t.pw.ivy);
  await phone.phoneServer(SERVER);
  await phone.channelRow('general').locator('.ch-main').tap();
  await phone.page.waitForSelector('body.m-ui.m-conv');
  await phone.page.reload();
  await phone.waitApp();
  await phone.page.waitForSelector('body.m-ui.m-conv[data-mtab="home"]');
  await phone.$('#main-head h1', { hasText: exact('general') }).waitFor();
  await phone.phoneBack();
  await phone.page.waitForSelector('body.m-ui.m-list[data-mtab="home"]');
  await phone.channelRow('general').waitFor();
  await phone.close();
}

// ------------------------------------------------------------------ the desktop app's update
async function desktopUpdate(t) {
  const d = await t.open('bob-desktop', { viewport: { width: 1280, height: 820 } });
  // The desktop app's bridge (desktop/preload.js), with an update downloaded and waiting.
  await d.context.addInitScript(() => {
    window.hearthDesktop = {
      isDesktop: true, platform: 'win32', version: '1.43.0', setBadge() {}, focus() {}, flash() {}, setCallState() {},
      onUpdateReady(cb) { setTimeout(() => cb({ version: '1.44.0' }), 50); }, updateReady() { return null; }, installUpdate() { window.__installed = true; },
      onHotkey() {}, setKeybinds: async () => ({ ok: true }), onResume() {}, idleSeconds: async () => 0, onOpenSettings() {}, onActivity() {}, detectActivity() {},
    };
  });
  await d.page.reload();
  await d.login('bob', t.pw.bob);
  await d.$('#rail button[aria-label^="' + SERVER + '"]').click();
  await d.$('#composer-input').waitFor();
  const pill = d.$('#sidebar #update-pill');
  await pill.waitFor();
  check(!(await d.$('.update-bar.app-update').count()), 'The update should wait in the sidebar, not float over the page.');
  check(await reachable(d.page, '#composer-input'), 'Nothing should cover the message box while an update waits.');
  await d.$('#composer-input').click();
  await pill.locator('button', { hasText: exact('Restart') }).click();
  check(await d.page.evaluate(() => window.__installed === true), 'Restart should install the update (no call to confirm leaving).');
  await d.close();
}

// ------------------------------------------------------------------ "Secure your account"
async function secureCard(t) {
  const ivy = t.people.ivy;
  await ivy.railButton('Home');
  const card = ivy.$('#main .secure-card');
  await card.waitFor();
  await card.locator('button', { hasText: 'Save a recovery key' }).click();
  await ivy.$('.settings-modal').waitFor();
  await ivy.$('.set-content button', { hasText: 'Create a recovery key' }).click();
  await ivy.confirmPassword('Create a recovery key', t.pw.ivy);
  const shown = ivy.modal('recovery key for');
  await shown.locator('input[type=checkbox]').check();
  await shown.locator('button', { hasText: exact('Done') }).click();
  await ivy.closeSettings();
  // That step is ticked; an email is still to do. Put away, it's gone (and stays gone).
  await card.locator('.secure-step.done', { hasText: 'Save a recovery key' }).waitFor();
  check(await card.locator('.secure-step:not(.done)', { hasText: 'Add an email' }).count() === 1, 'Adding an email should still be offered.');
  await card.locator('button[aria-label="Hide this"]').click();
  await card.waitFor({ state: 'detached' });
  await ivy.page.reload();
  await ivy.waitApp();
  await ivy.railButton('Home');
  await ivy.$('#main .home-view').waitFor();
  check(!(await ivy.$('#main .secure-card').count()), 'A card put away should stay away.');
  await ivy.close();
  await t.people['bob-ux'].close();
  delete t.people.ivy;
  delete t.people['bob-ux'];
}

export const FLOWS = [
  ['ux onboarding: the sign-up form says what’s wrong in place; a new account’s phone Home shows three ways to start above the tab bar; the iPhone tip is two steps clear of it', newOnPhone],
  ['ux onboarding: an invite link opened signed out starts on sign-up, headed with the server, and lands in its channel with no Join step', inviteSignUp],
  ['ux onboarding: reopening lands where you were; on a phone in the conversation, with Back to the list', resume],
  ['ux onboarding: the desktop app’s update waits in the sidebar, and the message box stays clickable', desktopUpdate],
  ['ux onboarding: “Secure your account” ticks off a recovery key, and stays away once put away', secureCard],
];
