// 1.44: no message is ever lost or silently unsent, and read state is right (WP-C). Runs after the main flows
// (run.mjs), with their accounts: alice and bob in SERVER's #general.
import { check, SERVER } from './flows.mjs';

const DESK = { width: 1366, height: 768 };
// Alice on a computer in SERVER's #general, nothing open over it.
async function inGeneral(p, size = DESK) {
  await p.page.setViewportSize(size);
  for (let i = 0; i < 3 && await p.page.locator('.modal-backdrop, .popover').count(); i++) await p.page.keyboard.press('Escape');
  await p.railButton(SERVER);
  await p.openChannel('general');
}
const sentCopies = (p) => p.page.locator('#messages .msg.sending');

// The auditors' lost-message case: the POST hangs, the next message is typed meanwhile, then the POST fails.
async function failedSend(t) {
  const { alice } = t.people;
  const page = alice.page;
  await inGeneral(alice);
  let release;
  const held = new Promise((r) => { release = r; });
  let gotIt;
  const posted = new Promise((r) => { gotIt = r; });
  const route = async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    gotIt();
    await held;
    await r.abort('internetdisconnected');
  };
  await page.route('**/api/channels/*/messages', route);
  const a = `Important first message ${Date.now()}`;
  await alice.$('#composer-input').fill(a);
  await alice.$('#composer-input').press('Enter');
  await posted;
  await alice.$('#composer-input').type('and then B');
  release();
  const failed = page.locator('#messages .msg.sending.failed', { hasText: a });
  await failed.waitFor();
  await page.unroute('**/api/channels/*/messages', route);
  check(await alice.$('#composer-input').inputValue() === 'and then B', 'What was typed after a failed send stays as it was (nothing put over it).');
  check(await failed.locator('.send-why', { hasText: 'Not sent' }).count() === 1, 'The failed copy says Not sent.');
  check(!(await page.locator('#toasts .toast-error').count()), 'A failed send says so on its copy, not in a toast.');
  await failed.locator('button.send-retry').click();
  await alice.message(a).first().waitFor();
  check(!(await sentCopies(alice).count()), 'After Retry the message is sent and its copy is gone.');
  check(await alice.message(a).count() === 1, 'Retry sends it once.');
  await alice.$('#composer-input').fill('');
}

async function offlineSend(t) {
  const { alice } = t.people;
  const page = alice.page;
  await inGeneral(alice);
  await alice.context.setOffline(true);
  try {
    await page.locator('.offline-note:not([hidden])').waitFor();
    check(await page.locator('.offline-note[role="status"]').count() > 0, 'The offline line above the box is a status region.');
    await page.locator('#conn-banner:not([hidden])', { hasText: 'You’re offline' }).waitFor();
    const text = `Written offline ${Date.now()}`;
    await alice.$('#composer-input').fill(text);
    await alice.$('#composer-input').press('Enter');
    await page.locator('#messages .msg.sending.waiting', { hasText: text }).locator('.send-state', { hasText: 'Waiting for connection' }).waitFor();
    check(await alice.$('#composer-input').inputValue() === '', 'Sending offline still clears the box (it waits in the chat).');
    await alice.context.setOffline(false);
    await alice.message(text).first().waitFor({ timeout: 5000 });
    check(await alice.message(text).count() === 1, 'A message that waited is sent once when the connection is back.');
  } finally { await alice.context.setOffline(false); }
  await page.locator('#conn-banner').waitFor({ state: 'hidden', timeout: 30000 });
}

// More than the server takes at once (30 in 10 s): every one arrives, in order, and at most one toast shows.
async function burst(t) {
  const { alice } = t.people;
  const page = alice.page;
  await inGeneral(alice);
  const tag = Date.now().toString(36);
  let most = 0;
  const watch = setInterval(() => { page.evaluate(() => document.querySelectorAll('#toasts .toast:not(.out)').length).then((n) => { most = Math.max(most, n); }).catch(() => {}); }, 150);
  try {
    for (let i = 1; i <= 32; i++) {
      await alice.$('#composer-input').fill(`burst ${tag} ${i}`);
      await alice.$('#composer-input').press('Enter');
    }
    await page.waitForFunction((tg) => {
      const got = [...document.querySelectorAll('#messages .msg[data-mid]:not([data-mid^="pending-"]) .msg-text')].map((x) => x.textContent.trim()).filter((x) => x.startsWith(`burst ${tg} `));
      return got.length >= 32 && !document.querySelector('#messages .msg.sending');
    }, tag, { timeout: 90000 });
  } finally { clearInterval(watch); }
  const order = await page.evaluate((tg) => [...document.querySelectorAll('#messages .msg[data-mid] .msg-text')].map((x) => x.textContent.trim()).filter((x) => x.startsWith(`burst ${tg} `)).map((x) => +x.split(' ').pop()), tag);
  check(order.length === 32 && order.every((n, i) => n === i + 1), `All 32 arrive once, in order (got ${order.join(',')}).`);
  check(most <= 1, `At most one toast shows during a burst (saw ${most}).`);
}

// A phone's list page isn't reading the conversation behind it: a mention there shows on its row.
async function phoneListMention(t) {
  const { alice, bob } = t.people;
  const me = await alice.page.evaluate(() => localStorage.getItem('hearth.userId'));
  const name = t.server.rows('SELECT username FROM users WHERE id = ?', me)[0].username;
  await inGeneral(bob);
  await inGeneral(alice, { width: 390, height: 844 });
  await alice.page.waitForSelector('body.m-ui.m-conv');
  await alice.phoneBack();
  const text = `@${name} on the list ${Date.now()}`;
  await bob.send(text);
  const row = alice.channelRow('general');
  await row.locator('.badge').first().waitFor({ timeout: 10000 });
  check(await row.evaluate((r) => r.classList.contains('unread')), 'The channel you came back from turns unread on the list.');
  await alice.page.setViewportSize(DESK);
}

// Reading along on a computer: a mention that arrives while you're at the bottom isn't left in the bell.
async function liveMention(t) {
  const { alice, bob } = t.people;
  const me = await alice.page.evaluate(() => localStorage.getItem('hearth.userId'));
  const name = t.server.rows('SELECT username FROM users WHERE id = ?', me)[0].username;
  await inGeneral(bob);
  await inGeneral(alice);
  await alice.page.bringToFront();
  await alice.page.evaluate(() => { const sc = document.querySelector('#messages'); sc.scrollTop = sc.scrollHeight; });
  const text = `@${name} seen live ${Date.now()}`;
  await bob.send(text);
  await alice.message(text).first().waitFor();
  await alice.page.waitForFunction(([id, tx]) => {
    const list = JSON.parse(localStorage.getItem(`hearth.inbox.${id}`) || '[]');
    const it = list.find((x) => (x.text || '').includes(tx.slice(tx.indexOf(' ') + 1)));
    return it && it.read;
  }, [me, text], { timeout: 5000 }).catch(() => {});
  const entry = await alice.page.evaluate(([id, tx]) => (JSON.parse(localStorage.getItem(`hearth.inbox.${id}`) || '[]')).find((x) => (x.text || '').includes(tx.slice(tx.indexOf(' ') + 1))) || null, [me, text]);
  check(entry && entry.read, `A mention read as it arrived is read in the notifications too (${JSON.stringify(entry)}).`);
}

export const FLOWS = [
  ['delivery: a send that fails while the next is typed stays in the chat as Not sent; Retry sends it once, the box keeps the new words', failedSend],
  ['delivery: offline, a message waits in the chat ("Waiting for connection"), the line above the box says so, and it goes when back online', offlineSend],
  ['delivery: a burst of 32 past the rate limit all arrive, in order, with at most one toast', burst],
  ['read state: on a phone’s list page, a mention in the channel you came back from shows on its row', phoneListMention],
  ['read state: a mention seen live at the bottom of the chat is read in the notifications too', liveMention],
];
