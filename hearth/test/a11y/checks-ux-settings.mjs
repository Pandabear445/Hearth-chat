// Settings, appearance and accessibility (1.44), in a real browser: text size reaches message text, the accent
// swatches are a named radio group that arrow keys move through, Reduce motion shows the device's own choice, a dark
// accent stays readable on the dark theme, the System theme follows the device (signed out too), and on a phone
// Settings is a list of pages. Run by test/a11y/run.mjs (checks-ux-*.mjs) with the account it made (alice).
import { checkApplied, PAIRS } from './contrast.mjs';
import { overflowDom } from './checks.mjs';

export async function run({ H, base, check, section, audit, settle, PASSWORD }) {
  const login = async (p, user = 'alice') => {
    await p.goto(base);
    await p.fill('#login-form [name=username]', user);
    await p.fill('#login-form [name=password]', PASSWORD);
    await p.click('#login-form button[type=submit]');
    await p.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
    await settle(p, 300);
  };
  const setLook = (p, patch) => p.evaluate((x) => {
    const a = JSON.parse(localStorage.getItem('hearth.appearance') || '{}');
    localStorage.setItem('hearth.appearance', JSON.stringify({ ...a, ...x }));
  }, patch);
  const reload = async (p) => { await p.reload(); await p.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 }); await settle(p, 300); };

  section('Text size (1.44): every text size follows the slider');
  const p = await H.newPage({ width: 1366, height: 768 });
  await login(p);
  await p.click('#rail button[aria-label^="Quality checks"]');
  await p.waitForSelector('#messages .msg .msg-body');
  // (A reload may land on Home: the channel is opened again each time.)
  const msgSize = async () => {
    if (!(await p.locator('#messages .msg .msg-body').count())) await p.click('#rail button[aria-label^="Quality checks"]');
    await p.waitForSelector('#messages .msg .msg-body');
    return p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#messages .msg .msg-body')).fontSize));
  };
  await setLook(p, { scale: 100 }); await reload(p);
  const at100 = await msgSize();
  await setLook(p, { scale: 125 }); await reload(p);
  const at125 = await msgSize();
  check(Math.abs(at125 - at100 * 1.25) < 0.05, 'message text at 125% is 1.25 times its size at 100%', { at100, at125 });
  await setLook(p, { scale: 150 }); await reload(p);
  const at150 = await msgSize();
  check(Math.abs(at150 - at100 * 1.5) < 0.05, 'and at 150% (the new top of the slider), 1.5 times', { at100, at150 });
  const wide = await p.evaluate(overflowDom);
  check(wide.scrollWidth <= wide.clientWidth, 'no sideways scrolling at 150%', wide);
  await setLook(p, { scale: 100 }); await reload(p);

  section('Appearance (1.44): accent swatches, the theme cards, Reduce motion');
  await p.click('#user-panel button[aria-label="Settings"]'); await settle(p, 400);
  await p.click('.set-nav-btn[data-tab="appearance"]'); await settle(p, 400);
  await audit(p, 'settings: Appearance');
  const sw = await p.evaluate(() => {
    const g = document.querySelector('.swatches');
    const radios = [...g.querySelectorAll('[role="radio"]')];
    return { role: g.getAttribute('role'), label: g.getAttribute('aria-label'), names: radios.map((r) => r.getAttribute('aria-label')), checked: radios.filter((r) => r.getAttribute('aria-checked') === 'true').length, tabStops: radios.filter((r) => r.tabIndex === 0).length };
  });
  check(sw.role === 'radiogroup' && sw.label === 'Accent color', 'the accent swatches are a radio group named "Accent color"', sw);
  check(sw.names.join() === 'Amber,Rose,Pink,Violet,Blue,Teal,Green,Lime', 'each swatch has a colour name', sw.names);
  check(sw.checked === 1 && sw.tabStops === 1, 'one swatch is checked, and it is the one Tab stops on', sw);
  await p.focus('.swatches [aria-checked="true"]');
  await p.keyboard.press('ArrowRight'); await settle(p, 150);
  const moved = await p.evaluate(() => ({ focused: document.activeElement.getAttribute('aria-label'), checked: document.querySelector('.swatches [aria-checked="true"]').getAttribute('aria-label'), accent: JSON.parse(localStorage.getItem('hearth.appearance')).accent }));
  check(moved.focused === 'Rose' && moved.checked === 'Rose' && moved.accent === '#ef5466', 'ArrowRight picks the next accent and keeps focus on it', moved);
  await p.keyboard.press('ArrowLeft'); await settle(p, 150);
  // The theme cards redraw the page when one is picked: focus follows to the new card.
  await p.focus('.theme-grid [aria-checked="true"]');
  await p.keyboard.press('ArrowRight'); await settle(p, 250);
  const themed = await p.evaluate(() => ({ focused: document.activeElement.closest('.theme-grid') && document.activeElement.getAttribute('aria-checked'), theme: JSON.parse(localStorage.getItem('hearth.appearance')).theme }));
  check(themed.focused === 'true' && themed.theme === 'dark', 'ArrowRight on the theme cards picks the next one (System → Dark) with focus on it', themed);
  await p.keyboard.press('ArrowLeft'); await settle(p, 250);
  // The harness's pages ask for reduced motion, as a device set that way would.
  const rm = await p.evaluate(() => { const row = [...document.querySelectorAll('.toggle-row')].find((r) => /Reduce motion/.test(r.textContent)); const i = row.querySelector('input'); return { checked: i.checked, disabled: i.disabled, hint: row.querySelector('.field-hint').textContent }; });
  check(rm.checked && rm.disabled && /device asks for less motion/.test(rm.hint), 'Reduce motion shows on and fixed when the device asks for less motion', rm);
  await p.keyboard.press('Escape'); await settle(p, 300);
  const q = await H.newPage({ width: 1366, height: 768, reducedMotion: 'no-preference' });
  await login(q);
  await q.click('#user-panel button[aria-label="Settings"]'); await settle(q, 400);
  await q.click('.set-nav-btn[data-tab="appearance"]'); await settle(q, 400);
  const rm2 = await q.evaluate(() => { const row = [...document.querySelectorAll('.toggle-row')].find((r) => /Reduce motion/.test(r.textContent)); const i = row.querySelector('input'); return { checked: i.checked, disabled: i.disabled }; });
  check(!rm2.checked && !rm2.disabled, 'otherwise it is an ordinary switch, off', rm2);
  await q.close();

  section('Accent contrast (1.44): a dark accent on the dark theme');
  await setLook(p, { theme: 'dark', accent: '#2a3f9e' }); await reload(p);
  for (const r of await checkApplied(p)) check(r.ok, `#2a3f9e on Dark: ${r.use} ${r.ratio}:1 ≥ ${r.min}:1`, r);
  const fill = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check(fill === '#2a3f9e', 'buttons and fills keep the accent as picked', fill);
  await p.click('#user-panel button[aria-label="Settings"]'); await settle(p, 400);
  await p.click('.set-nav-btn[data-tab="appearance"]'); await settle(p, 400);
  check(await p.locator('.set-accent-note:not([hidden])', { hasText: 'Adjusted for readability' }).count() === 1, 'Settings says the accent was adjusted for readability');
  await p.keyboard.press('Escape'); await settle(p, 300);
  await setLook(p, { theme: 'system', accent: '#f2a541' });
  await p.close();

  section('The System theme (1.44): follows the device, signed out and in');
  for (const scheme of ['light', 'dark']) {
    const s = await H.newPage({ width: 1366, height: 768, colorScheme: scheme });
    await s.goto(base); await settle(s, 300);
    const out = await s.evaluate(() => ({ theme: document.documentElement.dataset.theme, meta: document.querySelector('meta[name="color-scheme"]').content }));
    check(out.theme === scheme && out.meta === 'dark light', `signed out, a device set to ${scheme} gets the ${scheme} theme`, out);
    const bad = (await checkApplied(s, PAIRS)).filter((r) => !r.ok);
    check(!bad.length, `System (${scheme}): every colour pair meets its minimum`, bad.map((r) => `${r.use}: ${r.ratio}:1`).join('; '));
    await login(s);
    check(await s.evaluate(() => document.documentElement.dataset.theme) === scheme, `signed in, still ${scheme}`);
    await s.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' }); await settle(s, 200);
    check(await s.evaluate(() => document.documentElement.dataset.theme) === (scheme === 'light' ? 'dark' : 'light'), 'and it follows when the device switches');
    await s.close();
  }

  section('Settings on a phone (1.44): a list, then a page with Back');
  const ph = await H.newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ph);
  await ph.click('#tabbar button[data-tab="you"]'); await settle(ph, 300);
  await ph.click('#user-panel button[aria-label="Settings"]'); await settle(ph, 500);
  await audit(ph, 'phone settings: the list');
  const list = await ph.evaluate(() => ({
    page: document.querySelector('.settings').dataset.page,
    rows: [...document.querySelectorAll('.set-nav .set-nav-btn')].filter((b) => b.getClientRects().length).map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) })),
    keybinds: !!document.querySelector('.set-nav-btn[data-tab="keybinds"]'),
    wide: document.querySelector('.set-nav').scrollWidth > document.querySelector('.set-nav').clientWidth,
  }));
  check(list.page === 'list' && list.rows.length >= 10, 'Settings opens on its list of sections', list);
  check(list.rows.every((r) => r.h >= 44), 'every row is at least 44 px tall', list.rows.filter((r) => r.h < 44));
  check(!list.keybinds, 'Keybinds isn\'t offered on a touch screen');
  check(!list.wide, 'the list doesn\'t scroll sideways');
  await ph.click('.set-nav-btn[data-tab="notifications"]'); await settle(ph, 400);
  const pg = await ph.evaluate(() => ({ title: document.querySelector('.set-mtitle').textContent, back: document.activeElement && document.activeElement.getAttribute('aria-label'), label: [...document.querySelectorAll('.set-content .toggle-label')][0].textContent }));
  check(pg.title === 'Notifications' && pg.back === 'Back to Settings', 'a row opens its page, with its name in the header and focus on Back', pg);
  check(pg.label === 'Notifications on this device', 'the phone\'s wording: notifications on this device', pg.label);
  await audit(ph, 'phone settings: Notifications');
  await ph.keyboard.press('Escape'); await settle(ph, 300);
  const esc = await ph.evaluate(() => ({ open: !!document.querySelector('.settings-modal'), page: document.querySelector('.settings') && document.querySelector('.settings').dataset.page, focus: document.activeElement && document.activeElement.dataset.tab }));
  check(esc.open && esc.page === 'list' && esc.focus === 'notifications', 'Esc goes back to the list, onto the row it came from', esc);
  await ph.keyboard.press('Escape'); await settle(ph, 400);
  check(!(await ph.locator('.settings-modal').count()), 'and Esc on the list closes settings');
  await ph.close();
}
