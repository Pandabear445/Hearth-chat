// Menus, touch input and keyboard (1.44): a channel's menu fits a 1366x768 screen and its submenus work from the
// keyboard, Alt+↓ steps through the text channels, and on a touch tablet a finger held on a channel opens its menu
// (never joining a voice channel's call) while taps leave no tooltip behind. Signs in to alice (run.mjs: no new
// accounts), in the main flows' server.
import { exact } from './harness.mjs';
import { check, SERVER } from './flows.mjs';

const TABLET = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false };

// The server's id and channels, from the app's own API with this person's session.
const api = (p, method, url, body) => p.page.evaluate(async ([m, u, b]) => {
  const r = await fetch('/api' + u, { method: m, headers: { authorization: 'Bearer ' + localStorage.getItem('hearth.token'), ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${m} ${u}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}, [method, url, body]);
// Alice's username now (the main flows rename her: alice_w), from her own app when it's open.
const aliceName = async (t) => (t.people.alice ? (await api(t.people.alice, 'GET', '/bootstrap')).me.username : 'alice');
async function toServer(p) {
  await p.$(`#rail button[aria-label^="${SERVER}"]`).first().click();
  await p.page.locator('#sidebar-head .server-head-name', { hasText: exact(SERVER) }).waitFor();
}
// Two text channels and a voice one to work with (made if the server doesn't have them yet).
async function channels(p) {
  const boot = await api(p, 'GET', '/bootstrap');
  const server = boot.servers.find((s) => s.name === SERVER);
  check(server, `${SERVER} should be among alice's servers.`);
  const text = server.channels.filter((c) => c.type === 'text');
  if (text.length < 2) text.push(await api(p, 'POST', `/servers/${server.id}/channels`, { name: 'ux-menus', type: 'text' }));
  let voice = server.channels.find((c) => c.type === 'voice');
  if (!voice) voice = await api(p, 'POST', `/servers/${server.id}/channels`, { name: 'ux-voice', type: 'voice' });
  return { server, text, voice };
}

async function desktopMenus(t) {
  const p = await t.open('alice-ux-menus', { viewport: { width: 1366, height: 768 } });
  const { page } = p;
  await p.login(await aliceName(t), t.pw.alice);
  await toServer(p);
  const { text } = await channels(p);
  await p.channelRow(text[0].name).waitFor();
  await p.openChannel(text[0].name);

  // The ⋯ menu: its last item is on screen without scrolling the page (and the menu needs no scrolling either).
  await p.$('#main-head button[aria-label="More"]').click();
  const fit = await page.evaluate(() => {
    const m = document.querySelector('.popover > .menu');
    const items = [...m.querySelectorAll(':scope > .menu-item')];
    const last = items[items.length - 1].getBoundingClientRect();
    return { bottom: Math.round(last.bottom), vh: innerHeight, scrolls: m.scrollHeight > m.clientHeight + 1, items: items.length, overflow: getComputedStyle(m).overflowY };
  });
  check(fit.bottom <= fit.vh, `The channel menu's last item should be on screen at 1366x768 (bottom ${fit.bottom}, screen ${fit.vh}).`);
  check(!fit.scrolls, `At 1366x768 the whole channel menu should show without scrolling (${fit.items} items).`);
  check(fit.overflow === 'auto', `A menu should scroll when it can't fit, with a mouse too (overflow-y: ${fit.overflow}).`);
  await page.keyboard.press('Escape');

  // Notifications › from the keyboard: → opens it with its first choice focused, ← puts focus back on the row.
  await p.$('#main-head button[aria-label="More"]').focus();
  await page.keyboard.press('Enter');
  await p.$('.popover .menu-item').first().waitFor();
  for (let i = 0; i < 30 && !(await page.evaluate(() => /^Notifications/.test(document.activeElement.textContent))); i++) await page.keyboard.press('ArrowDown');
  const row = p.$('.popover .menu-item.has-sub', { hasText: 'Notifications' });
  check((await row.getAttribute('aria-haspopup')) === 'menu' && (await row.getAttribute('aria-expanded')) === 'false', 'The Notifications row should say it opens a menu, closed.');
  await page.keyboard.press('ArrowRight');
  await p.$('.popover .menu-flyout').waitFor();
  const inFly = await page.evaluate(() => ({ fly: !!document.activeElement.closest('.menu-flyout'), role: document.activeElement.getAttribute('role'), text: document.activeElement.textContent }));
  check(inFly.fly && inFly.role === 'menuitemradio', `→ should open Notifications with focus on its first choice (focus: ${JSON.stringify(inFly)}).`);
  check((await row.getAttribute('aria-expanded')) === 'true', 'The open submenu’s row should say aria-expanded="true".');
  await page.keyboard.press('ArrowLeft');
  await p.$('.popover .menu-flyout').waitFor({ state: 'detached' });
  check(await row.evaluate((el) => el === document.activeElement), '← should close the submenu and put focus back on its row.');
  // Enter opens it too; Esc then closes only the submenu, and a second Esc the menu.
  await page.keyboard.press('Enter');
  await p.$('.popover .menu-flyout').waitFor();
  await page.keyboard.press('Escape');
  await p.$('.popover .menu-flyout').waitFor({ state: 'detached' });
  check(await p.$('.popover > .menu').count() === 1 && await row.evaluate((el) => el === document.activeElement), 'Esc in a submenu should close only the submenu.');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.popover', { state: 'detached' });

  // The message menu's More › Add reaction: the picked emoji is added to the message (the phone sheet's "+" runs the
  // same item).
  const said = `wheel and react ${Date.now()}`;
  await p.send(said);
  await p.messageAction(said, 'Add reaction');
  await p.$('.popover .emoji-grid .emoji-btn').first().waitFor();
  // The wheel over the emoji grid scrolls the grid (the popup around it doesn't scroll, so it mustn't stop the wheel).
  const grid = p.$('.popover .emoji-grid');
  const gb = await grid.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector('.popover .emoji-grid').scrollTop > 0, null, { timeout: 3000 })
    .catch(() => check(false, 'The mouse wheel over the emoji picker should scroll its grid.'));
  await grid.evaluate((el) => { el.scrollTop = 0; });
  await p.$('.popover .emoji-grid .emoji-btn').first().click();
  await p.message(said).first().locator('.reactions .reaction:not(.add-r)').first().waitFor({ timeout: 5000 })
    .catch(() => check(false, 'More › Add reaction should add the picked emoji to the message.'));

  // Alt+↓ goes to the next text channel (the one you're in is found by its aria-current).
  await p.$('#composer-input').click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction((was) => {
    const cur = document.querySelector('#sidebar-body .ch-main[aria-current="page"]');
    return cur && cur.closest('.ch-row').querySelector('.ch-name').textContent !== was;
  }, text[0].name, { timeout: 5000 }).catch(() => check(false, 'Alt+↓ should move to another channel in a server.'));
  const now = await page.evaluate(() => document.querySelector('#sidebar-body .ch-main[aria-current="page"]').getAttribute('aria-label'));
  check(/^Channel /.test(now), `Alt+↓ should land on a text channel, never a voice one (now on: ${now}).`);
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForSelector(`#composer-input[placeholder="Message #${text[0].name}"]`, { timeout: 5000 });
  await p.close();
}

async function tabletTouch(t) {
  const p = await t.open('alice-ux-ipad', TABLET);
  const { page } = p;
  await p.login(await aliceName(t), t.pw.alice);
  await toServer(p);
  const { text, voice } = await channels(p);
  await p.channelRow(voice.name).waitFor();
  const cdp = await p.context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const hold = async (loc, ms = 600) => {
    const b = await loc.boundingBox();
    await touch('touchStart', b.x + 30, b.y + b.height / 2);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
  };
  const sheet = page.locator('.sheet-backdrop:not(.closing) .sheet');

  // Held on a text channel: its menu comes up as a sheet (iOS never reports a long press as a right-click).
  await hold(p.channelRow(text[0].name).locator('.ch-main'));
  await sheet.locator('.menu-item', { hasText: 'Copy channel link' }).waitFor({ timeout: 5000 });
  // A submenu is a second page of the sheet; Esc goes back a page, then closes it.
  await sheet.locator('.menu-item.has-sub', { hasText: 'Notifications' }).tap();
  await sheet.locator('.sheet-back', { hasText: 'Notifications' }).waitFor();
  await page.keyboard.press('Escape');
  await sheet.locator('.menu-item', { hasText: 'Copy channel link' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.sheet-backdrop').waitFor({ state: 'detached' });

  // Held on a voice channel: its menu, and the call is not joined.
  await hold(p.channelRow(voice.name).locator('.ch-main'));
  await sheet.waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  const joined = await page.evaluate(() => !!document.querySelector('.ch-row.connected, .voice-room, #voice-bar:not([hidden]) .vb-leave'));
  check(!joined, 'Holding a voice channel should open its menu, never join its call.');
  await page.keyboard.press('Escape');
  await page.locator('.sheet-backdrop').waitFor({ state: 'detached' });

  // A tap on a button with a tooltip leaves no tooltip on the screen.
  const tipBtn = page.locator('#main-head button[data-tip]:visible').first();
  await tipBtn.tap();
  await page.waitForTimeout(500);
  check(!(await page.locator('.tooltip').count()), 'A tap should never leave a tooltip standing.');
  await page.keyboard.press('Escape');
  // iOS reports the hover after the tap is over (after its mousedown, which used to put tips away): still none.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#main-head button[data-tip]')].find((x) => x.getClientRects().length);
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  check(!(await page.locator('.tooltip').count()), 'A hover reported after a tap should not show a tooltip.');
  await p.close();
}

export const FLOWS = [
  ['ux menus: at 1366x768 a channel’s ⋯ menu fits, Notifications › opens and closes from the keyboard, More › Add reaction adds one, the wheel scrolls the emoji grid, Alt+↓ moves to the next text channel', desktopMenus],
  ['ux menus: on a touch tablet a held channel opens its menu as a sheet (a submenu is a page), a held voice channel never joins, taps leave no tooltip', tabletTouch],
];
