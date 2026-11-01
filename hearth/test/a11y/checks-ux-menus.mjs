// Menus (1.44): submenu rows say they open a menu and whether it's open, their flyout is a named menu that passes the
// audit, focus goes back to the row on Esc, and a phone's sheet page has a named Back row. Signs in to alice (run.mjs),
// in the server the main checks made ("Quality checks").
export async function run({ H, base, check, section, audit, active, settle, PASSWORD }) {
  section('Menus: submenus (aria-haspopup, aria-expanded, Esc back to the row)');
  const p = await H.newPage({ width: 1366, height: 768 });
  await p.goto(base);
  await p.fill('#login-form [name=username]', 'alice');
  await p.fill('#login-form [name=password]', PASSWORD);
  await p.click('#login-form button[type=submit]');
  await p.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
  await p.click('#rail button[aria-label^="Quality checks"]'); await settle(p, 400);

  const head = p.locator('#sidebar-head .server-head');
  await head.focus(); await p.keyboard.press('Enter'); await settle(p, 200);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.popover .menu-item.has-sub')].map((r) => ({ label: r.querySelector('.menu-label').textContent, role: r.getAttribute('role'), popup: r.getAttribute('aria-haspopup'), expanded: r.getAttribute('aria-expanded') })));
  check(rows.length >= 2, 'the server menu has submenu rows (Notifications, Mute)', rows);
  check(rows.every((r) => r.role === 'menuitem' && r.popup === 'menu' && r.expanded === 'false'), 'submenu rows are menuitems with aria-haspopup="menu" and aria-expanded="false"', rows);
  for (let i = 0; i < 20 && !/^Notifications/.test((await active(p)).label); i++) await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowRight'); await settle(p, 200);
  const sub = await p.evaluate(() => {
    const row = document.querySelector('.popover .menu-item.has-sub[aria-expanded="true"]');
    const fly = document.querySelector('.popover .menu-flyout');
    return { expanded: row && row.querySelector('.menu-label').textContent, role: fly && fly.getAttribute('role'), name: fly && fly.getAttribute('aria-label'), focusIn: !!(fly && fly.contains(document.activeElement)) };
  });
  check(sub.expanded === 'Notifications' && sub.role === 'menu' && sub.name === 'Notifications' && sub.focusIn, '→ opens the submenu: its row says aria-expanded="true", the flyout is a named menu with focus inside', sub);
  await audit(p, 'server menu with a submenu open');
  await p.keyboard.press('Escape'); await settle(p, 150);
  const back = await p.evaluate(() => ({ focus: document.activeElement && document.activeElement.classList.contains('has-sub') ? document.activeElement.querySelector('.menu-label').textContent : null, expanded: document.activeElement && document.activeElement.getAttribute('aria-expanded'), open: !!document.querySelector('.popover .menu-flyout'), menu: !!document.querySelector('.popover') }));
  check(back.focus === 'Notifications' && back.expanded === 'false' && !back.open && back.menu, 'Esc closes only the submenu and puts focus back on its row', back);
  await p.keyboard.press('Escape'); await settle(p, 150);
  check((await head.getAttribute('aria-expanded')) === 'false', 'a second Esc closes the menu');
  await p.close();

  section('Menus on a phone: a submenu is a page of the sheet, with a named Back row');
  const ph = await H.newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await ph.goto(base);
  await ph.fill('#login-form [name=username]', 'alice');
  await ph.fill('#login-form [name=password]', PASSWORD);
  await ph.click('#login-form button[type=submit]');
  await ph.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
  await ph.click('#tabbar button[data-tab="home"]').catch(() => {});
  await ph.click('#rail button[aria-label^="Quality checks"]'); await settle(ph, 400);
  await ph.click('#sidebar-head .server-head'); await settle(ph, 400);
  await ph.locator('.sheet .menu-item.has-sub', { hasText: 'Notifications' }).click(); await settle(ph, 300);
  const page2 = await ph.evaluate(() => {
    const s = document.querySelector('.sheet-backdrop:not(.closing) .sheet');
    const b = s && s.querySelector('.sheet-back');
    return { sheet: s && s.getAttribute('aria-label'), back: b && b.getAttribute('aria-label'), items: s ? s.querySelectorAll('.menu-item').length : 0, h: b && Math.round(b.getBoundingClientRect().height) };
  });
  check(page2.sheet === 'Notifications' && /^Back to /.test(page2.back || '') && page2.items >= 3 && page2.h >= 44, 'the sheet is renamed for its page, with a Back row at least 44px tall', page2);
  await audit(ph, 'phone sheet submenu page');
  await ph.keyboard.press('Escape'); await settle(ph, 300);
  const after = await ph.evaluate(() => { const s = document.querySelector('.sheet-backdrop:not(.closing) .sheet'); return { open: !!s, name: s && s.getAttribute('aria-label'), focus: document.activeElement && document.activeElement.textContent }; });
  check(after.open && after.name !== 'Notifications' && /^Notifications/.test(after.focus || ''), 'Esc goes back a page, focus on the row it came from', after);
  await ph.close();
}
