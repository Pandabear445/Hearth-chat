// Settings, appearance and accessibility (1.44), end to end as Bob on three devices: a phone's Settings is a list of
// pages (Back goes page → list → closed, and Android's Back does the same), an iPad held upright gives Profile's
// form the full width, and a computer's text size slider reaches 150%. Bob signs in again on each device (one more
// account would go over the sign-ups allowed from one network in an hour).
import { PHONE } from './harness.mjs';
import { check, SERVER } from './flows.mjs';

const IPAD = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false };

async function phoneSettings(t) {
  const phone = await t.open('bob-settings-phone', PHONE);
  const { page } = phone;
  await phone.login('bob', t.pw.bob);
  await phone.phoneTab('you');
  await page.locator('#user-panel button[aria-label="Settings"]').tap();
  await page.locator('.settings[data-page="list"] .set-nav').waitFor();
  const rows = await page.locator('.set-nav .set-nav-btn:visible').allInnerTexts();
  for (const want of ['Profile', 'Security', 'Privacy & safety', 'Appearance', 'Chat', 'Notifications', 'Voice & video', 'Apps & devices', 'Server settings', 'Log out']) {
    check(rows.some((r) => r.trim() === want), `The phone's settings list should have ${want} (has ${rows.map((r) => r.trim()).join(', ')}).`);
  }
  check(!rows.some((r) => r.trim() === 'Keybinds'), 'A touch screen has no keys to bind: Keybinds should not be listed.');
  check(!(await page.locator('.set-content .set-section').count()), 'The list should show no section until one is picked.');

  await page.locator('.set-nav-btn[data-tab="notifications"]').tap();
  await page.locator('.settings[data-page="page"] .set-content .set-section').first().waitFor();
  check(await page.locator('.set-mtitle').innerText() === 'Notifications', 'The page header should name the section.');
  check(await page.locator('.set-back').isVisible(), 'The page should have a Back arrow.');
  await page.locator('.set-back').tap();
  await page.locator('.settings[data-page="list"] .set-nav').waitFor();

  // Android's Back (the browser's): a page goes back to the list, the list closes settings, and the You page is there.
  await page.locator('.set-nav-btn[data-tab="appearance"]').tap();
  await page.locator('.settings[data-page="page"] .theme-grid').waitFor();
  await page.goBack();
  await page.locator('.settings[data-page="list"] .set-nav').waitFor();
  await page.goBack();
  await page.locator('.settings-modal').waitFor({ state: 'detached' });
  check(await page.evaluate(() => document.body.classList.contains('m-list') && document.body.dataset.mtab === 'you'), 'Back from the list should leave the You page it was opened from.');

  // Opened at a section (You → Theme and appearance), Back goes back to You rather than to a list never shown.
  await page.locator('#sidebar-body', { hasText: 'Theme and appearance' }).locator('text=Theme and appearance').tap();
  await page.locator('.settings[data-page="page"] .theme-grid').waitFor();
  await page.goBack();
  await page.locator('.settings-modal').waitFor({ state: 'detached' });
  await phone.close();
}

async function tabletProfile(t) {
  const ipad = await t.open('bob-settings-ipad', IPAD);
  await ipad.login('bob', t.pw.bob);
  await ipad.openSettings('Profile');
  const field = ipad.$('.set-content .field', { hasText: 'Display name' }).locator('input').first();
  await field.waitFor();
  const w = (await field.boundingBox()).width;
  check(w >= 240, `On an iPad held upright the display name field should get room to type (${Math.round(w)} px, want 240 or more).`);
  const box = (sel) => ipad.page.locator(sel).first().boundingBox();
  const [preview, form] = [await box('.set-preview'), await box('.set-content .field')];
  check(preview.y + preview.height <= form.y + 1, 'Its profile preview should sit above the form, not squeezed beside it.');
  await ipad.closeSettings();
  await ipad.close();
}

async function textSize(t) {
  const bob = await t.open('bob-settings-desk', { viewport: { width: 1366, height: 768 } });
  await bob.login('bob', t.pw.bob);
  await bob.railButton(SERVER);
  await bob.openChannel('general');
  await bob.send('How big is this text?');
  const size = () => bob.page.evaluate(() => parseFloat(getComputedStyle([...document.querySelectorAll('#messages .msg .msg-body')].pop()).fontSize));
  const at100 = await size();
  await bob.openSettings('Appearance');
  const slider = bob.$('.set-content input[type=range][aria-label="Text size"]');
  check(await slider.getAttribute('max') === '150', 'The text size slider should go up to 150%.');
  await slider.evaluate((r) => { r.value = '150'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await bob.closeSettings();
  const at150 = await size();
  check(at100 === 15 && at150 === 22.5, `At 150% message text should be 22.5 px (15 px at 100%; got ${at100} → ${at150}).`);
  const wide = await bob.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(wide <= 0, `No sideways scrolling at 150% (${wide} px too wide).`);
  await bob.close();
}

export const FLOWS = [
  ['settings on a phone: a list of sections, a page with Back, Android Back page → list → closed, no Keybinds; opened at a section, Back returns', phoneSettings],
  ['settings on an iPad upright: Profile gets one column with the preview on top and a wide display name field', tabletProfile],
  ['text size: the slider reaches 150% and message text follows (22.5 px)', textSize],
];
