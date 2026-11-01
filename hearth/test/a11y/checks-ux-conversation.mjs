// 1.44 (WP-C): a message that didn't go says so with named buttons, and the offline line is a status region.
// Signs in to alice from the main run (no new account: sign-ups are limited) and opens her "Quality checks" server.
export async function run({ H, base, check, section, audit, settle, PASSWORD }) {
  section('Unsent messages and the offline line');
  const p = await H.newPage({ width: 1366, height: 768 });
  try {
    await p.goto(base);
    await p.fill('#login-form [name=username]', 'alice');
    await p.fill('#login-form [name=password]', PASSWORD);
    await p.click('#login-form button[type=submit]');
    await p.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
    await p.click('#rail button[aria-label^="Quality checks"]');
    await p.waitForSelector('#composer-input');
    await settle(p, 300);

    // A send the server never answers: its copy stays, Not sent, with Retry and Delete.
    const fail = (r) => (r.request().method() === 'POST' ? r.abort('connectionreset') : r.continue());
    await p.route('**/api/channels/*/messages', fail);
    await p.fill('#composer-input', 'This one does not go through');
    await p.press('#composer-input', 'Enter');
    await p.waitForSelector('#messages .msg.sending.failed', { timeout: 10000 });
    const btns = await p.evaluate(() => [...document.querySelectorAll('#messages .msg.failed .send-state button')].map((b) => ({ tag: b.tagName, type: b.type, name: b.getAttribute('aria-label') || b.textContent.trim() })));
    check(btns.length === 2 && btns.every((b) => b.tag === 'BUTTON' && b.type === 'button' && b.name), 'a failed message’s Retry and Delete are buttons with names', btns);
    const said = await p.evaluate(() => { const s = document.querySelector('#messages .msg.failed .send-why'); return s && { role: s.getAttribute('role'), text: s.textContent.trim() }; });
    check(said && said.role === 'status' && /Not sent/.test(said.text), 'its “Not sent” is a status (read out once, not an alert)', said);
    await audit(p, 'a message that wasn’t sent');
    await p.unroute('**/api/channels/*/messages', fail);
    await p.click('#messages .msg.failed .send-delete');
    await settle(p, 200);
    check(!(await p.locator('#messages .msg.failed').count()), 'Delete takes the unsent copy away');
    const focus = await p.evaluate(() => document.activeElement && document.activeElement.id);
    check(focus === 'composer-input', 'focus goes back to the message box after Delete', focus);

    // Offline: the quiet line above the box is a status region, and the banner says offline.
    await p.context().setOffline(true);
    await p.waitForSelector('.offline-note:not([hidden])', { timeout: 10000 });
    const note = await p.evaluate(() => { const n = document.querySelector('.offline-note:not([hidden])'); return n && { role: n.getAttribute('role'), text: n.textContent.trim() }; });
    check(note && note.role === 'status' && /messages will send when you’re back/.test(note.text), 'the offline line is in a role=status region', note);
    const banner = await p.evaluate(() => { const b = document.querySelector('#conn-banner'); return { hidden: b.hidden, role: b.getAttribute('role'), text: b.textContent.trim() }; });
    check(!banner.hidden && banner.role === 'status' && banner.text === 'You’re offline', 'the banner says “You’re offline”', banner);
    await audit(p, 'offline');
    await p.context().setOffline(false);
    await p.waitForSelector('.offline-note', { state: 'hidden', timeout: 30000 }).catch(() => {});
  } finally { await p.close(); }
}
