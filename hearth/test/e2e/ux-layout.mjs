// The 1.44 responsive layout (public/css/ux-layout.css, js/viewport.js, app.js dockPanel): nothing covers anything,
// and nothing is out of reach, at the sizes people really use. Dialogs on a phone held sideways, the side panel on a
// laptop and a narrow window, a ringing call beside the message box, a short conversation on a big screen, and a
// file card on a small phone. Alice signs in on new devices (the sign-ups from one network are used up by now).
import { PHONE } from './harness.mjs';
import { check } from './flows.mjs';

const SIDEWAYS = 'UX Sideways';
// A finger's or the mouse's way to it: on screen, and the thing at its middle is it (nothing on top of it).
// (Once it has finished moving: a phone's dialogs slide up from the bottom.)
const reachable = async (page, sel) => {
  await page.waitForFunction((s) => { const el = document.querySelector(s); return !!el && !el.closest('.modal, .ring-card, #members, body').getAnimations({ subtree: true }).some((a) => a.playState === 'running' && !(a.effect && a.effect.getTiming().iterations === Infinity)); }, sel).catch(() => {});
  return where(page, sel);
};
const where = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).pop();
  if (!el) return { ok: false, why: `no ${s}` };
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const on = !!at && (at === el || el.contains(at));
  return { ok: on && r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5, bottom: Math.round(r.bottom), height: innerHeight, top: at && (at.id || String(at.className)) };
}, sel);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const panelHidden = (page) => page.evaluate(() => document.querySelector('#members').hidden);
const SEND = '.cw-main .send-btn';
// Alice as she is by now: the main flows rename her alice_w (her name is still alice when these run alone).
async function aliceOn(t, name, device) {
  const p = await t.open(name, device);
  const [{ username }] = t.server.rows("SELECT username FROM users WHERE username IN ('alice_w', 'alice') ORDER BY username DESC");
  await p.login(username, t.pw.alice);
  return p;
}

// ------------------------------------------------------------------ a phone held sideways: dialogs fit
async function sidewaysDialogs(t) {
  const p = await aliceOn(t, 'alice-sideways', { ...PHONE, viewport: { width: 844, height: 390 } });
  await p.phoneHome();
  await p.$('#rail button[aria-label="Add a server"]').click();
  await p.$('.modal button.choice').first().click();
  await p.$('.modal input.input').first().waitFor();
  let foot = await reachable(p.page, '.modal .modal-foot .btn.primary');
  check(foot.ok, `Sideways, Create a server's button should be on screen and uncovered (got ${JSON.stringify(foot)}).`);
  await p.$('.modal input.input').first().fill(SIDEWAYS);
  await p.$('.modal .modal-foot .btn.primary').click();
  await p.$('.modal.invite-welcome').waitFor();
  foot = await reachable(p.page, '.modal.invite-welcome .modal-foot .btn.primary');
  check(foot.ok, `Sideways, the invite step's Done should be on screen (got ${JSON.stringify(foot)}).`);
  await p.$('.modal.invite-welcome .modal-foot .btn.primary').click();
  await p.noModals();
  await p.page.waitForSelector('#composer-input');
  if (await p.page.evaluate(() => document.body.classList.contains('m-conv'))) await p.phoneBack();
  await p.$('#sidebar-body button[aria-label^="Create channel in"]').first().click();
  await p.$('.modal input[placeholder="new-channel"]').waitFor();
  foot = await reachable(p.page, '.modal .modal-foot .btn.primary');
  check(foot.ok, `Sideways, Create channel's button should be on screen and uncovered (got ${JSON.stringify(foot)}).`);
  await p.$('.modal input[placeholder="new-channel"]').fill('sideways-chat');
  await p.$('.modal .modal-foot .btn.primary').click();
  await p.page.waitForSelector('#composer-input[placeholder="Message #sideways-chat"]');
  check(await noSideScroll(p.page), 'Sideways, the page should never scroll sideways.');
  // Chat | Reels sit in the header row rather than a row of their own, clear of the title and its buttons.
  const tabs = await p.page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect(); };
    const tabs = r('.conv-tabs'); const head = r('#main-head'); const tools = r('#main-head .head-tools'); const title = r('#main-head .head-title');
    return { inHead: !!tabs && tabs.top >= head.top - 0.5 && tabs.bottom <= head.bottom + 0.5, clear: !!tabs && tabs.left >= title.right - 0.5 && tabs.right <= tools.left + 0.5 };
  });
  check(tabs.inHead && tabs.clear, `Sideways, Chat | Reels should sit in the header between the title and its buttons (got ${JSON.stringify(tabs)}).`);
  await p.close();
}

// ------------------------------------------------------------------ laptops and narrow windows: the side panel
async function sidePanel(t) {
  const p = await aliceOn(t, 'alice-laptop-ux', { viewport: { width: 1024, height: 768 } });
  const { page } = p;
  // (An owner's announcement from an earlier flow floats over the top of the page on a computer, as it always has:
  // put away, so what's checked here is the panel.)
  if (await p.$('#announce button[aria-label="Dismiss"]').count()) await p.$('#announce button[aria-label="Dismiss"]').click();
  await p.$(`#rail button[aria-label="${SIDEWAYS}"]`).click();
  await p.openChannel('general');
  for (let i = 1; i <= 6; i++) await p.send(`Layout check ${i}`);
  t.state.uxLayout = p;
  if (await p.$('#main-head button[aria-label="Show members"]').count()) await p.$('#main-head button[aria-label="Show members"]').click();
  await page.waitForSelector('#members.docked:not([hidden])');
  const send = await reachable(page, SEND);
  check(send.ok, `With the members list open at 1024px, Send should be reachable (got ${JSON.stringify(send)}).`);
  const toggle = await reachable(page, '#main-head button[aria-label="Hide members"]');
  check(toggle.ok, `With the members list open at 1024px, the header button should be reachable (got ${JSON.stringify(toggle)}).`);
  // Its header button closes it…
  await p.$('#main-head button[aria-label="Hide members"]').click();
  await page.waitForFunction(() => document.querySelector('#members').hidden);
  // …so does a click in the conversation…
  await p.$('#main-head button[aria-label="Show members"]').click();
  await page.waitForSelector('#members.docked:not([hidden]) .member-list');
  const chat = await page.evaluate(() => { const r = document.querySelector('#messages').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; });
  await page.mouse.click(chat.x, chat.y);
  await page.waitForFunction(() => document.querySelector('#members').hidden);
  // (The see-through cover goes with it, once the button or finger is up.)
  await page.waitForSelector('.panel-scrim', { state: 'detached', timeout: 2000 }).catch(() => check(false, 'The see-through cover should go with the panel.'));
  // …and Esc, which hands the keyboard back to the header button.
  await p.$('#main-head button[aria-label="Show members"]').click();
  await page.waitForSelector('#members.docked:not([hidden]) .member-list');
  await page.locator('#members .search-input').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#members').hidden);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  check(focused === 'Show members', `After Esc the keyboard should be back on the header's members button (got ${focused}).`);
  check(await noSideScroll(page), 'At 1024px the page should never scroll sideways.');

  // 800px wide: a thread takes the conversation's whole place, with a Back arrow.
  await page.setViewportSize({ width: 800, height: 900 });
  const last = p.message('Layout check 6').first();
  await last.hover();
  await last.locator('button[aria-label="Reply in thread"]').click();
  await page.waitForSelector('#members[data-mode="thread"].docked');
  await page.waitForTimeout(300);
  const widths = await page.evaluate(() => [document.querySelector('#members').getBoundingClientRect(), document.querySelector('#main').getBoundingClientRect()].map((r) => [Math.round(r.left), Math.round(r.width)]));
  check(Math.abs(widths[0][1] - widths[1][1]) <= 1 && Math.abs(widths[0][0] - widths[1][0]) <= 1, `At 800px the thread should cover the conversation exactly (panel ${widths[0]}, conversation ${widths[1]}).`);
  const back = await reachable(page, '#members .panel-back');
  check(back.ok, `At 800px the thread should have a Back arrow (got ${JSON.stringify(back)}).`);
  await p.$('#members .panel-back').click();
  await page.waitForFunction(() => document.querySelector('#members').hidden);
  check(await noSideScroll(page), 'At 800px the page should never scroll sideways.');
}

// ------------------------------------------------------------------ a ringing call; a short conversation; a file card
async function ringShortFile(t) {
  const p = t.state.uxLayout;
  const { page } = p;
  // 1366x768: a call ringing (the card the app shows, made here: what's checked is where it sits) leaves Send alone.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'ring-card ux-test-ring';
    el.innerHTML = '<div class="ring-text"><strong>bob</strong><span>Calling…</span></div><div class="ring-actions"><button class="round-btn hang" aria-label="Decline"></button><button class="round-btn accept" aria-label="Accept"></button><button class="round-btn accept" aria-label="Accept with video"></button></div>';
    document.body.append(el);
  });
  await page.waitForTimeout(400);
  const send = await reachable(page, SEND);
  check(send.ok, `While a call rings at 1366px, Send should be reachable (got ${JSON.stringify(send)}).`);
  await page.evaluate(() => document.querySelector('.ux-test-ring').remove());

  // 1920x1080: six messages sit just above the message box, not at the top of the screen.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  const gap = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#messages .msg')];
    return Math.round(document.querySelector('.cw-main').getBoundingClientRect().top - msgs[msgs.length - 1].getBoundingClientRect().bottom);
  });
  check(gap >= 0 && gap <= 120, `At 1920px a short conversation should end within 120px of the message box (got ${gap}px).`);

  // 360x740: a file card's size line doesn't break inside "x.y MB".
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.setInputFiles('.cw-main input[type=file]', [{ name: 'quarterly-report-final-version.zip', mimeType: 'application/zip', buffer: Buffer.alloc(1234567, 7) }]);
  await page.press('#composer-input', 'Enter');
  await page.waitForSelector('#messages .msg[data-mid]:not([data-mid^="pending-"]) .att-file', { timeout: 60000 });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(500);
  const pieces = await page.evaluate(() => [...document.querySelector('#messages .att-file .att-size').children].map((s) => [s.textContent.trim(), s.getClientRects().length]));
  check(pieces.length >= 2 && pieces.every(([, n]) => n === 1), `At 360px each piece of the file's size line should stay on one line (got ${JSON.stringify(pieces)}).`);
  const dl = await page.evaluate(() => { const b = document.querySelector('#messages .att-file > .btn'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), name: b.getAttribute('aria-label') }; });
  check(dl.w >= 44 && dl.h >= 44 && /^Download quarterly-report/.test(dl.name), `At 360px Download should be a 44px icon named for the file (got ${JSON.stringify(dl)}).`);
  check(await noSideScroll(page), 'At 360px the page should never scroll sideways.');
  await p.close();
  delete t.state.uxLayout;
}

export const FLOWS = [
  ['ux layout: dialogs fit a phone held sideways', sidewaysDialogs],
  ['ux layout: the side panel on a laptop and a narrow window', sidePanel],
  ['ux layout: a ringing call, a short conversation, a file card on a small phone', ringShortFile],
];
