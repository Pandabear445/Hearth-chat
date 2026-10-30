// The phone layout (app.js phoneShell: a list page under a tab bar, a conversation pushed over it), checked where a
// review found it going wrong: a window crossing into it and back, changes made elsewhere while a list page is
// showing, a call (Esc with Brainrot on, the call bar's buttons from the keyboard, its words in the light theme, a
// second call ringing, a phone held sideways with a notch) and targets a finger can hit (44 px).
import { PHONE, exact } from './harness.mjs';
import { check, SERVER } from './flows.mjs';
import { ratio } from '../a11y/contrast.mjs';

// The signed-in app's own REST calls, for set-up done "on another device" (not what's under test).
const api = (p, method, url, body) => p.page.evaluate(async ([m, u, b]) => {
  const r = await fetch('/api' + u, { method: m, headers: { authorization: 'Bearer ' + localStorage.getItem('hearth.token'), ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${m} ${u}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}, [method, url, body]);
const boot = (p) => api(p, 'GET', '/bootstrap');
const serverId = async (p, name) => (await boot(p)).servers.find((s) => s.name === name).id;
const level = (page) => page.evaluate(() => (document.body.classList.contains('m-conv') ? 'conv' : document.body.classList.contains('m-list') ? `list:${document.body.dataset.mtab}` : 'none'));
const atLevel = (page, want) => page.waitForFunction((w) => (document.body.classList.contains('m-conv') ? 'conv' : document.body.classList.contains('m-list') ? `list:${document.body.dataset.mtab}` : 'none') === w, want);
// Everything matching `sel` that's on screen, with its size.
const sizes = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => {
  const r = e.getBoundingClientRect();
  return { what: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 24) || e.className, w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}), sel);
const small = (list, min = 44) => list.filter((b) => b.w < min - 0.5 || b.h < min - 0.5).map((b) => `${b.what} ${b.w}×${b.h}`);

// ------------------------------------------------------------------ crossing the layout; changes from elsewhere
export async function phoneStaysPut(t) {
  const { alice, bob } = t.people;
  const me = (await boot(bob)).me;
  const aliceId = (await boot(alice)).me.id;

  // A computer's window narrowed into the phone layout and widened again (snapped to half a screen, devtools opened):
  // the chat is the same one, scrolled where it was, both ways.
  const { page: desk } = bob;
  await desk.setViewportSize({ width: 1280, height: 800 });
  await bob.openChannel('general');
  for (let i = 0; i < 14 && (await desk.$eval('#messages', (m) => m.scrollHeight - m.clientHeight)) < 900; i++) {
    await bob.send(`A long line for scrolling back through, number ${i + 1}: ${'the quick brown fox jumps over the lazy dog, '.repeat(6)}`);
  }
  // (Every line sent has gone through first: the app keeps you at the newest message while your own are still being
  // sent, so a place picked before that isn't one it was asked to keep.)
  await desk.waitForFunction(() => !document.querySelector('#messages .msg.sending'), null, { timeout: 15000 });
  await desk.waitForTimeout(1000);
  const mark = () => desk.evaluate(() => {
    const m = document.querySelector('#messages');
    m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 2);
    window.__keptMessages = m;
    const top = m.getBoundingClientRect().top;
    const first = [...m.querySelectorAll('.msg[data-mid]')].find((x) => x.getBoundingClientRect().bottom > top + 40);
    return first && first.dataset.mid;
  });
  const kept = (mid) => desk.evaluate((id) => {
    const m = document.querySelector('#messages');
    const el = m && m.querySelector(`.msg[data-mid="${id}"]`);
    const r = el && el.getBoundingClientRect(); const v = m && m.getBoundingClientRect();
    return { same: m === window.__keptMessages, atBottom: !!m && m.scrollHeight - m.scrollTop - m.clientHeight < 40, inView: !!r && r.bottom > v.top && r.top < v.bottom };
  }, mid);
  let mid = await mark();
  await desk.waitForTimeout(400);
  await desk.setViewportSize({ width: 740, height: 800 });
  await desk.waitForSelector('body.m-ui.m-conv');
  await desk.waitForTimeout(500);
  let k = await kept(mid);
  check(k.same && !k.atBottom && k.inView, `Narrowed into the phone layout, the chat should be the same one, still where it was scrolled (got ${JSON.stringify(k)}).`);
  check(await bob.$('#main-head .head-back').isVisible(), 'Narrowed into the phone layout, the conversation\'s header should have Back.');
  mid = await mark();
  await desk.waitForTimeout(400);
  await desk.setViewportSize({ width: 1280, height: 800 });
  await desk.waitForFunction(() => !document.body.classList.contains('m-ui'));
  await desk.waitForTimeout(500);
  k = await kept(mid);
  check(k.same && !k.atBottom && k.inView, `Widened again, the chat should still be the same one, where it was scrolled (got ${JSON.stringify(k)}).`);
  await bob.$('#sidebar-head .server-head-name', { hasText: exact(SERVER) }).waitFor();
  check(!(await bob.$('#main-head .head-back').count()) && !(await bob.$('#tabbar').isVisible()), 'Widened again, the computer\'s layout should be back (no Back button, no tab bar).');
  await desk.setViewportSize({ width: 1400, height: 900 });

  // A server of alice's that bob is in, for changes made while his phone shows a list.
  const NAME = 'Pocket Changes';
  await alice.createServer(NAME);
  const link = await alice.inviteLink();
  await bob.join(link, NAME);
  const sid = await serverId(alice, NAME);
  const phone = await t.open('bob-lists', PHONE);
  const { page } = phone;
  await phone.login('bob', t.pw.bob);

  // A channel made while the phone's list shows that server's channels (and something else is open): it's there.
  await phone.phoneTab('home');
  await phone.$('#sidebar-body .nav-row', { hasText: exact('Home') }).tap();
  await atLevel(page, 'conv');
  await phone.phoneBack();
  await phone.phoneServer(NAME);
  await api(alice, 'POST', `/servers/${sid}/channels`, { name: 'newone' });
  await phone.channelRow('newone').waitFor({ timeout: 10000 });
  // …renamed, then gone, the same.
  const newone = (await boot(alice)).servers.find((s) => s.id === sid).channels.find((c) => c.name === 'newone');
  await api(alice, 'PATCH', `/channels/${newone.id}`, { name: 'renamed' });
  await phone.channelRow('renamed').waitFor({ timeout: 10000 });
  await api(alice, 'DELETE', `/channels/${newone.id}`);
  await phone.channelRow('renamed').waitFor({ state: 'detached', timeout: 10000 });

  // The channel open behind the You page deleted: the You page stays, nothing pushed over it.
  const extra = await api(alice, 'POST', `/servers/${sid}/channels`, { name: 'extra' });
  await phone.channelRow('extra').locator('.ch-main').tap();
  await page.waitForSelector('body.m-conv #composer-input[placeholder="Message #extra"]');
  await phone.phoneBack();
  await phone.phoneTab('you');
  // (A mention for bob waiting in #general, the channel the app moves to once #extra is gone. His computer looks at
  // another server meanwhile, so nothing there reads it.)
  await bob.railButton(SERVER);
  await bob.openChannel('general');
  await alice.railButton(NAME);
  await alice.openChannel('general');
  await alice.send('@bob something for you in general');
  await page.waitForTimeout(1500);
  await api(alice, 'DELETE', `/channels/${extra.id}`);
  await page.waitForFunction(() => !document.querySelector('#composer-input[placeholder="Message #extra"]'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  check(await level(page) === 'list:you', `A channel deleted from elsewhere shouldn't take the phone off the You page (now ${await level(page)}).`);
  // …and #general, never shown, isn't marked read by being moved to behind the list.
  await phone.phoneServer(NAME);
  await page.waitForTimeout(500);
  check(await phone.channelRow('general').locator('.badge').count() > 0, 'A channel the app moved to behind the list, never shown, should keep its unread mention.');

  // Its server left from another device while the Messages page shows: still the Messages page.
  await phone.phoneServer(NAME);
  await phone.channelRow('general').locator('.ch-main').tap();
  await atLevel(page, 'conv');
  await phone.phoneBack();
  await phone.phoneTab('dms');
  await api(bob, 'POST', `/servers/${sid}/leave`);
  await phone.$(`#rail button[aria-label="${NAME}"]`).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(500);
  check(await level(page) === 'list:dms', `Leaving a server from another device shouldn't push anything over the Messages page (now ${await level(page)}).`);
  check(await page.evaluate(() => !document.querySelector('#main').contains(document.activeElement) && document.querySelector('#main').inert), 'The conversation should stay out of reach behind the Messages page.');

  // A friend request while the Messages page shows (with a server's channel open behind it): its Friends row says so.
  await phone.phoneServer(SERVER);
  await phone.channelRow('general').locator('.ch-main').tap();
  await atLevel(page, 'conv');
  await phone.phoneBack();
  await phone.phoneTab('dms');
  const wereFriends = (await boot(alice)).relationships.some((r) => r.userId === me.id && r.direction === 'mutual');
  await api(alice, 'DELETE', `/friends/${me.id}`);
  await api(alice, 'POST', '/friends', { username: 'bob' });
  await phone.$('#sidebar-body .nav-row', { hasText: 'Friends' }).locator('.badge').waitFor({ timeout: 10000 });
  // (As they were.)
  if (wereFriends) await api(bob, 'POST', `/friends/${aliceId}/accept`);
  else await api(alice, 'DELETE', `/friends/${me.id}`);
  await phone.$('#sidebar-body .nav-row', { hasText: 'Friends' }).locator('.badge').waitFor({ state: 'detached', timeout: 10000 });
  // The Notifications page with a filter picked: a change elsewhere (a friend request) leaves the filter as it was.
  await phone.phoneTab('inbox');
  await phone.$('#sidebar-body .seg-btn', { hasText: 'Mentions' }).tap();
  const wereFriends2 = (await boot(alice)).relationships.some((r) => r.userId === me.id && r.direction === 'mutual');
  await api(alice, 'DELETE', `/friends/${me.id}`);
  await api(alice, 'POST', '/friends', { username: 'bob' });
  await page.waitForTimeout(1500);
  check(await phone.$('#sidebar-body .seg-btn.active', { hasText: 'Mentions' }).count() === 1, 'A friend request arriving should leave the Notifications page on the filter picked.');
  if (wereFriends2) await api(bob, 'POST', `/friends/${aliceId}/accept`);
  else await api(alice, 'DELETE', `/friends/${me.id}`);
  await phone.close();
  await alice.railButton(SERVER);
}

// ------------------------------------------------------------------ a call on a phone
export async function phoneCall(t) {
  const { alice, bob } = t.people;
  const bobId = (await boot(bob)).me.id;
  const phone = await t.open('bob-call', PHONE);
  const { page } = phone;
  await phone.login('bob', t.pw.bob);
  await page.setViewportSize({ width: 360, height: 640 });
  await phone.phoneServer(SERVER);
  await phone.channelRow('Lounge').locator('.ch-main').tap();
  await page.waitForSelector('body.m-conv .voice-room .cs-controls button[aria-label="Leave call"]', { timeout: 30000 });

  // Every call control a finger's size (44 px) and on screen at 360 px wide.
  await page.waitForTimeout(400);
  const ctl = await sizes(page, '.voice-room .cs-controls .round-btn');
  check(ctl.length >= 7, `The call should have all its controls (got ${ctl.map((b) => b.what).join(', ')}).`);
  check(!small(ctl).length, `At 360 px every call control should be at least 44 px (got ${small(ctl).join(', ')}).`);
  check(ctl.every((b) => b.left >= 0 && b.right <= 360 && b.top >= 0 && b.bottom <= 640), `At 360 px every call control should be on screen (got ${JSON.stringify(ctl)}).`);
  for (const label of ['Mute', 'Deafen', 'Share your screen', 'Soundboard', 'Leave call']) check(ctl.some((b) => b.what === label), `"${label}" should be among the call controls.`);

  // Brainrot on in the call: Esc turns it off (as its tip says), and the call stays open.
  const br = page.locator('.voice-room .cs-controls button.br-call');
  if (await br.count()) {
    await br.tap();
    const warn = page.locator('.modal .modal-head h2', { hasText: 'Turn on Brainrot mode?' });
    await Promise.race([warn.waitFor(), page.waitForSelector('.voice-room .call-stage.br-on .br-under:not([hidden])')]);
    if (await warn.count()) { await page.locator('.modal-foot button', { hasText: 'Turn it on' }).tap(); await phone.noModals(); }
    await page.waitForSelector('.voice-room .call-stage.br-on .br-under:not([hidden])');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('.voice-room .br-under', { state: 'hidden', timeout: 5000 }).catch(() => {});
    check(!(await page.locator('.voice-room .br-under:not([hidden])').count()), 'Esc with Brainrot on in the call should turn Brainrot off.');
    check(await level(page) === 'conv', `Esc that turned Brainrot off should leave the call open (now ${await level(page)}).`);
  } else check(false, 'The call should have its Brainrot button.');

  // On a list page, the call floats over it: from the keyboard, Mute and Unmute stay focused as they swap. Focus put
  // on Mute right as Back lands stays there (going back moves focus to the list a frame later, unless it was taken).
  const raced = await page.evaluate(async () => {
    document.querySelector('#main-head .head-back').click();
    const mute = document.querySelector('#m-callbar:not([hidden]) button[aria-label="Mute"]');
    if (!mute) return 'no call bar';
    mute.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const a = document.activeElement;
    return a === mute ? 'ok' : (a && (a.getAttribute('aria-label') || a.tagName));
  });
  check(raced === 'ok', `Focus put on the call bar's Mute as Back landed should stay there (it's on ${raced}).`);
  await page.waitForSelector('#m-callbar:not([hidden]) button[aria-label="Mute"]');
  await page.locator('#m-callbar button[aria-label="Mute"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#m-callbar button[aria-label="Unmute"]');
  check(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Unmute' && document.querySelector('#m-callbar').contains(document.activeElement)), `After Mute from the keyboard, focus should be on Unmute (it's on ${await page.evaluate(() => document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName))}).`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#m-callbar button[aria-label="Mute"]');
  check(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Mute'), 'After Unmute from the keyboard, focus should be back on Mute.');

  // Its words readable in the light theme (4.5:1), floating over a list and across the top of a conversation.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const contrast = async () => {
    const [fg, bg] = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const x = cv.getContext('2d', { willReadFrequently: true });
      const paint = (c, under) => { x.fillStyle = `rgb(${under.join(' ')})`; x.fillRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const b = paint(getComputedStyle(document.querySelector('#m-callbar')).backgroundColor, [255, 255, 255]);
      return [paint(getComputedStyle(document.querySelector('#m-callbar .cb-text small')).color, b), b];
    });
    return Math.round(ratio(fg, bg) * 100) / 100;
  };
  const onList = await contrast();
  check(onList >= 4.5, `In the light theme the call bar's "In call" should have 4.5:1 contrast over a list (got ${onList}:1).`);
  await phone.channelRow('general').locator('.ch-main').tap();
  await atLevel(page, 'conv');
  await page.waitForSelector('body.m-conv #m-callbar:not([hidden])');
  const onTop = await contrast();
  check(onTop >= 4.5, `In the light theme the call bar's "In call" should have 4.5:1 contrast across a conversation (got ${onTop}:1).`);
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await phone.phoneBack();
  await page.waitForSelector('body.m-list #m-callbar:not([hidden])');

  // A second call ringing comes up above the call bar, not over its Mute and Leave.
  const d = await api(alice, 'POST', '/dms', { userId: bobId });
  const dmRow = alice.$(`#sidebar-body .dm-row[data-nav-key="d:${d.id}"]`);
  await alice.railButton('Direct messages');
  // (A conversation made just now through the API is in her list once the app loads again.)
  if (!(await dmRow.count())) { await alice.page.reload(); await alice.waitApp(); await alice.railButton('Direct messages'); }
  await dmRow.click();
  await alice.$('#main-head button[aria-label="Start a voice call"]').click();
  await page.waitForSelector('.ring-card');
  await page.waitForTimeout(400);
  const [ring] = await sizes(page, '.ring-card');
  const [bar] = await sizes(page, '#m-callbar');
  check(ring.bottom <= bar.top + 0.5, `The ringing call should sit above the call bar (ring card ${Math.round(ring.top)}–${Math.round(ring.bottom)}, call bar from ${Math.round(bar.top)}).`);
  // Sideways, with a notch on one side and rounded corners: both clear of them.
  const cdp = await phone.context.newCDPSession(page);
  let insets = true;
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } }).catch(() => { insets = false; });
  check(insets, 'The browser should let the test set safe-area insets (Emulation.setSafeAreaInsetsOverride).');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  const [ring2] = await sizes(page, '.ring-card');
  const [bar2] = await sizes(page, '#m-callbar');
  check(ring2.left >= 47 && ring2.right <= 844 - 47, `Sideways, the ringing call should keep clear of the notch (got ${Math.round(ring2.left)}–${Math.round(ring2.right)} of 844, insets 47).`);
  check(bar2.left >= 47 && bar2.right <= 844 - 47, `Sideways, the call bar should keep clear of the notch (got ${Math.round(bar2.left)}–${Math.round(bar2.right)} of 844, insets 47).`);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
  await page.setViewportSize({ width: 360, height: 640 });
  await page.locator('.ring-card button[aria-label="Decline"]').tap();
  await page.waitForSelector('.ring-card', { state: 'detached' });
  await alice.page.waitForSelector('#voice-panel', { state: 'hidden' });

  // Leave from the keyboard: the bar goes, and focus goes to the page rather than being lost.
  await page.locator('#m-callbar button[aria-label="Leave call"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#m-callbar', { state: 'hidden' });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.activeElement && document.activeElement !== document.body && document.querySelector('#sidebar').contains(document.activeElement)), `After Leave call on the call bar, focus should be on the list page (it's on ${await page.evaluate(() => document.activeElement && document.activeElement.tagName)}).`);
  await phone.close();
  await alice.railButton(SERVER);
}

// ------------------------------------------------------------------ targets a finger can hit, at 360 px
export async function phoneTargets(t) {
  const { alice, bob } = t.people;
  const d = await api(alice, 'POST', '/dms', { userId: (await boot(bob)).me.id });
  // Alice on her phone, with a server of her own (its categories have Create channel; she may have handed the shared
  // one over by now).
  const MINE = 'Targets of mine';
  await alice.createServer(MINE);
  const phone = await t.open('alice-targets', PHONE);
  const { page } = phone;
  await phone.login((await boot(alice)).me.username, t.pw.alice); // (renamed earlier on: alice_w)
  await page.setViewportSize({ width: 360, height: 640 });
  const allIn = async (where, sel) => {
    const got = await sizes(page, sel);
    check(got.length, `${where}: there should be some to measure (${sel}).`);
    check(!small(got).length, `${where}: each should be at least 44 px (got ${small(got).join(', ')}).`);
  };
  // A server's channels: the categories, their Create channel, every icon button on the list.
  await phone.phoneServer(MINE);
  await allIn('Category names', '#sidebar-body .cat-toggle');
  await allIn('Categories\' Create channel', '#sidebar-body .cat-head .icon-btn');
  await allIn('Icon buttons on the channel list', '#sidebar .icon-btn');
  // Notifications: its All and Mentions.
  await phone.phoneTab('inbox');
  await allIn('Notifications tabs', '#sidebar-body .inbox-page .seg-btn');
  await allIn('Icon buttons on the Notifications page', '#sidebar .icon-btn');
  // Friends' tabs, in its header.
  await phone.phoneTab('dms');
  await phone.$('#sidebar-body .nav-row', { hasText: 'Friends' }).tap();
  await atLevel(page, 'conv');
  await allIn('Friends tabs', '#main-head .m-head-tabs .tab');
  await allIn('Icon buttons in the Friends header', '#main-head .icon-btn');
  await phone.phoneBack();

  // A DM's name opens the profile: the whole title is the button to tap (picture, name and the line under it).
  await phone.$(`#sidebar-body .dm-row[data-nav-key="d:${d.id}"]`).waitFor({ timeout: 10000 });
  await phone.$(`#sidebar-body .dm-row[data-nav-key="d:${d.id}"]`).tap();
  await atLevel(page, 'conv');
  await page.waitForTimeout(400); // (slid into place)
  const title = await page.evaluate(() => {
    const t = document.querySelector('#main-head .head-title');
    const r = t.getBoundingClientRect();
    const hit = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && !!top.closest('.head-name-btn'); };
    return { h: Math.round(r.height), w: Math.round(r.width), avatar: hit(t.querySelector('.av')), name: hit(t.querySelector('.head-name-btn')), sub: hit(t.querySelector('.head-sub')) };
  });
  // An owner's announcement showing (one was posted earlier on) is a strip above everything else on a phone, never
  // over Back, the title or its buttons.
  const over = await page.evaluate(() => {
    const a = document.querySelector('.announce'); if (!a) return 'none';
    const r = a.getBoundingClientRect(); const head = document.querySelector('#main-head').getBoundingClientRect();
    return r.bottom <= head.top + 1 || r.top >= head.bottom - 1 ? 'ok' : `${Math.round(r.top)}-${Math.round(r.bottom)} over the header at ${Math.round(head.top)}-${Math.round(head.bottom)}`;
  });
  check(over === 'none' || over === 'ok', `The announcement shouldn't cover the header on a phone (${over}).`);
  check(title.h >= 44 && title.avatar && title.name && title.sub, `In a DM the title (picture, name, status) should all open the profile, at least 44 px tall (got ${JSON.stringify(title)}).`);
  // (A tap on the picture, as a finger would.)
  const av = await page.locator('#main-head .head-title .av').boundingBox();
  await page.touchscreen.tap(av.x + av.width / 2, av.y + av.height / 2);
  await page.waitForSelector('#main-head .head-name-btn[aria-expanded="true"]', { timeout: 5000 }).catch(() => {});
  check(await page.locator('#main-head .head-name-btn[aria-expanded="true"]').count() === 1 || await page.locator('#members .dm-profile').isVisible(), 'A tap on the DM\'s picture should open the profile.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await allIn('Icon buttons in a DM\'s header', '#main-head .icon-btn');

  // The emoji picker's categories, and the GIF picker's Back and Clear.
  await page.locator('.cw-main button[aria-label="Emoji"]').tap();
  await page.locator('.popover .emoji-tab').first().waitFor();
  await page.waitForTimeout(400); // (its opening animation done)
  await allIn('Emoji categories', '.popover .emoji-tab');
  await page.keyboard.press('Escape');
  await page.locator('.popover').waitFor({ state: 'detached' });
  await page.locator('.cw-main .composer .attach').tap();
  await phone.menuItem('GIFs').tap();
  await page.locator('.popover .gif-picker .xp-input').fill('cats');
  await page.waitForTimeout(600);
  await allIn('The GIF picker\'s Back and Clear', '.popover .xp-back, .popover .xp-clear');
  await page.keyboard.press('Escape');
  await page.locator('.popover').waitFor({ state: 'detached' });
  await phone.close();
  await alice.railButton(SERVER); // (where the next flows expect her)
}
