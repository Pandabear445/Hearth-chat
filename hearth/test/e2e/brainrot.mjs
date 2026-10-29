// Brainrot mode (docs/design/BRAINROT.md), end to end: the toggle and its one-time warning, the gameplay running
// (its canvas keeps changing), the stimulation slider, "your own background" waiting for a tap, Esc, reduced motion,
// scroll together turning it on for everyone (asked first if never warned; each person can turn it off), and the
// call and watch-together views. E2E_SHOTS=<folder> saves the screenshots for docs/brainrot.png
// (scripts/brainrot-sheet.mjs).
import { PHONE } from './harness.mjs';
import { check, fakeSocialSites, SERVER } from './flows.mjs';

const shot = async (p, name) => { if (process.env.E2E_SHOTS) await p.page.screenshot({ path: `${process.env.E2E_SHOTS}/br-${name}.png` }); };
// The gameplay is drawn on a canvas: two looks a moment apart differ while it runs.
const frameOf = (p, scope) => p.page.evaluate((sel) => { const c = document.querySelector(`${sel} .br-under:not([hidden]) canvas`); return c && c.width > 1 ? c.toDataURL('image/png').length + ':' + c.toDataURL('image/png').slice(-200) : null; }, scope);
async function running(p, scope, why) {
  const a = await frameOf(p, scope);
  check(a, `${why}: there's a gameplay canvas.`);
  for (let n = 0; n < 20; n++) { await p.page.waitForTimeout(150); if ((await frameOf(p, scope)) !== a) return; }
  check(false, `${why}: the gameplay should be moving (the canvas didn't change).`);
}
const level = (p, scope, n) => p.page.locator(`${scope} .br-slider`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, n);

export async function brainrot(t) {
  const { alice, bob } = t.people;
  await fakeSocialSites(alice);
  await fakeSocialSites(bob);
  for (const p of [alice, bob]) { await p.openChannel('general'); await p.$('.conv-tab', { hasText: 'Reels' }).click(); await p.$('.reels-layer:not([hidden]) .reel-card').first().waitFor(); }
  const cover = alice.$('.reels-cover button', { hasText: 'Start watching' });
  if (await cover.isVisible()) await cover.click();
  const R = '.reels-layer';
  // Off by default: no gameplay until it's turned on, and the first time, a warning.
  check(!(await alice.$(`${R} .br-under:not([hidden])`).count()), 'Brainrot mode is off by default.');
  await alice.$(`${R} .reels-bar .br-toggle`).click();
  const warn = await alice.dialog('Turn on Brainrot mode?');
  await warn.locator('p', { hasText: 'never flashes more than 3 times a second' }).waitFor();
  await warn.locator('.modal-foot button', { hasText: 'Not now' }).click();
  await alice.page.waitForTimeout(300);
  check(!(await alice.$(`${R} .br-under:not([hidden])`).count()), 'Not now leaves it off.');
  await alice.page.evaluate(() => { const f = document.querySelector('.reels-layer .reel-card[data-i="0"] iframe'); if (f) f.dataset.e2eKeep = '1'; });
  await alice.$(`${R} .reels-bar .br-toggle`).click();
  await (await alice.dialog('Turn on Brainrot mode?')).locator('.modal-foot button', { hasText: 'Turn it on' }).click();
  await alice.$(`${R} .reels-main.br-on .br-under:not([hidden])`).waitFor();
  check(await alice.page.evaluate(() => { const f = document.querySelector('.reels-layer .reel-card[data-i="0"] iframe'); return !f || f.dataset.e2eKeep === '1'; }), 'The video\'s player is the same one (not reloaded).');
  await alice.$(`${R} .reels-bar .br-toggle[aria-pressed="true"]`).waitFor();
  // Half and half: beside the feed where half the width still fits an upright video, otherwise below. The feed only
  // got smaller (its player wasn't reloaded).
  const split = await alice.page.evaluate(() => {
    const m = document.querySelector('.reels-main'); const r = m.getBoundingClientRect();
    const f = m.querySelector('.reels-feed').getBoundingClientRect(); const u = m.querySelector('.br-under').getBoundingClientRect();
    return { row: m.classList.contains('br-row'), want: r.width >= 640 && r.width >= r.height * 0.95, f: [f.x, f.y, f.width, f.height], u: [u.x, u.y, u.width, u.height] };
  });
  check(split.row === split.want, `Beside or below as the space allows (${JSON.stringify(split)}).`);
  check(split.row ? Math.abs(split.f[2] - split.u[2]) < 4 && split.u[0] >= split.f[0] + split.f[2] - 2 : Math.abs(split.f[3] - split.u[3]) < 4 && split.u[1] >= split.f[1] + split.f[3] - 2, `Half and half (${JSON.stringify(split)}).`);
  // The "tap to start watching" cover (and the empty note) keep to the video's half: a tap on the gameplay, its ✕ or its
  // settings is never taken for consent to load TikTok's and Instagram's players.
  await alice.page.locator('.modal-backdrop').waitFor({ state: 'detached' }); // (the warning has finished closing)
  const tapsGameplay = await alice.page.evaluate(() => {
    const m = document.querySelector('.reels-layer .reels-main');
    const cover = m.querySelector('.reels-cover'); const empty = m.querySelector('.reels-empty');
    const was = [cover.hidden, empty.hidden]; cover.hidden = false; empty.hidden = false;
    const u = m.querySelector('.br-under').getBoundingClientRect();
    const hits = [[0.5, 0.5], [0.95, 0.05], [0.05, 0.95]].map(([fx, fy]) => document.elementFromPoint(u.x + u.width * fx, u.y + u.height * fy));
    [cover.hidden, empty.hidden] = was;
    return hits.every((el) => !!el && !!el.closest('.br-under'));
  });
  check(tapsGameplay, 'With the start cover showing, a tap on the gameplay still reaches the gameplay (never the cover).');
  await running(alice, R, 'Block Parkour');
  // The slider: 0 is just the gameplay; 1 adds captions and the progress bar; 2 the counter and emoji rain.
  await alice.$(`${R} .br-gear`).click();
  await alice.$(`${R} .br-panel:not([hidden]) .br-slider`).waitFor();
  check((await alice.$(`${R} .br-score`).isHidden()) && (await alice.$(`${R} .br-prog`).isHidden()), 'Level 0: nothing over the gameplay.');
  await level(alice, R, 1);
  await alice.$(`${R} .br-prog:not([hidden])`).waitFor();
  check(await alice.$(`${R} .br-score`).isHidden(), 'Level 1: no counter yet.');
  await level(alice, R, 3);
  await alice.$(`${R} .br-score:not([hidden])`).waitFor();
  await alice.page.waitForFunction(() => /\d/.test(document.querySelector('.reels-layer .br-score').textContent));
  const s1 = await alice.$(`${R} .br-score`).textContent();
  await alice.page.waitForTimeout(1500);
  check((await alice.$(`${R} .br-score`).textContent()) !== s1, 'The counter ticks up.');
  check(await alice.page.evaluate(() => !document.querySelector('.reels-layer .br-cap').children.length), 'Captions are text only.');
  // Rail Runner.
  await alice.$(`${R} .br-choice`, { hasText: 'Rail Runner' }).click();
  await running(alice, R, 'Rail Runner');
  await alice.$(`${R} .br-panel .icon-btn[aria-label="Close settings"]`).click();
  await shot(alice, 'desktop-reels');
  // Your own background: a YouTube video that loads only after a tap that says so, muted, sandboxed.
  const yt = [];
  const onReq = (r) => { if (/youtube(-nocookie)?\.com/.test(r.url())) yt.push(r.url()); };
  alice.page.on('request', onReq);
  try {
    await alice.$(`${R} .br-gear`).click();
    await alice.$(`${R} .br-choice`, { hasText: 'Your own background' }).click();
    await alice.$(`${R} .br-panel input[aria-label="YouTube link for the background"]`).fill('https://evil.example/watch?v=dQw4w9WgXcQ');
    await alice.$(`${R} .br-yt-form button[type=submit]`).click();
    await alice.toast('That isn’t a link to a YouTube video.');
    await alice.$(`${R} .br-panel input[aria-label="YouTube link for the background"]`).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await alice.$(`${R} .br-yt-form button[type=submit]`).click();
    await alice.$(`${R} .br-note`, { hasText: 'which sees your IP address' }).waitFor();
    await alice.page.waitForTimeout(300);
    check(!yt.length && !(await alice.$(`${R} .br-under iframe`).count()), `Nothing loads from YouTube before the tap (got ${yt.join(', ')}).`);
    await alice.$(`${R} .br-note button`, { hasText: 'Load background' }).click();
    const frame = alice.$(`${R} .br-under iframe.br-frame`);
    await frame.waitFor({ state: 'attached' });
    const src = await frame.getAttribute('src');
    check(src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?') && /[?&]mute=1/.test(src) && /[?&]loop=1/.test(src), `A muted, looping nocookie embed (got ${src}).`);
    check((await frame.getAttribute('sandbox')) === 'allow-scripts allow-same-origin' && (await frame.getAttribute('tabindex')) === '-1', 'Sandboxed, no popups, not focusable.');
  } finally { alice.page.off('request', onReq); }
  await alice.$(`${R} .br-gear`).click();
  await alice.$(`${R} .br-choice`, { hasText: 'Block Parkour' }).click();
  await alice.$(`${R} .br-under iframe`).waitFor({ state: 'detached' });
  // Esc: the settings close first, then Brainrot mode turns off.
  await alice.page.keyboard.press('Escape');
  await alice.$(`${R} .br-panel`).waitFor({ state: 'hidden' });
  await alice.$(`${R} .reels-feed`).focus();
  await alice.page.keyboard.press('Escape');
  await alice.$(`${R} .br-under`).waitFor({ state: 'hidden' });
  check(!(await alice.page.evaluate(() => document.querySelector('.reels-main').classList.contains('br-on'))), 'Esc turns it off.');
  // Reduced motion: the slider stops at 1, and there's no counter or rain.
  await alice.page.emulateMedia({ reducedMotion: 'reduce' });
  await alice.$(`${R} .reels-bar .br-toggle`).click(); // (warned already: no dialog)
  await alice.$(`${R} .br-under:not([hidden])`).waitFor();
  await alice.$(`${R} .br-gear`).click();
  await alice.$(`${R} .br-panel .field-hint`, { hasText: 'Reduced motion is on' }).waitFor();
  check((await alice.$(`${R} .br-slider`).getAttribute('max')) === '1', 'With reduced motion the slider stops at 1.');
  await alice.page.waitForTimeout(400);
  check(await alice.$(`${R} .br-score`).isHidden(), 'With reduced motion: no counter (level 3 is used as 1).');
  await running(alice, R, 'Reduced motion still moves (slower)');
  await alice.$(`${R} .br-x`).click();
  await alice.$(`${R} .br-under`).waitFor({ state: 'hidden' });
  await alice.page.emulateMedia({ reducedMotion: 'no-preference' });

  // Scroll together: Alice turns it on for everyone. Bob was never warned: he's asked, and warned, first.
  await alice.$(`${R} .reels-bar .br-toggle`).click();
  await alice.$(`${R} .br-under:not([hidden])`).waitFor();
  await alice.$(`${R} .reels-bar button`, { hasText: 'Scroll together' }).click();
  await bob.$(`${R} .reels-with`, { hasText: 'Scrolling with Alice Wonder' }).waitFor();
  await alice.$(`${R} .reels-bar .br-everyone`).click();
  await alice.$(`${R} .reels-bar .br-everyone[aria-pressed="true"]`).waitFor();
  await bob.$(`${R} .br-invite`, { hasText: 'Alice Wonder turned on Brainrot mode' }).waitFor();
  check(await bob.$(`${R} .br-under`).isHidden(), 'Nothing starts for Bob before he says yes.');
  await bob.$(`${R} .br-invite button`, { hasText: 'Join in' }).click();
  await (await bob.dialog('Turn on Brainrot mode?')).locator('.modal-foot button', { hasText: 'Turn it on' }).click();
  await bob.$(`${R} .br-under:not([hidden])`).waitFor();
  await running(bob, R, 'Bob, with everyone');
  await shot(bob, 'desktop-together');
  // Bob turns it off for himself: it stays on for Alice, and Bob isn't asked again.
  await bob.$(`${R} .reels-feed`).focus();
  await bob.page.keyboard.press('Escape');
  await bob.$(`${R} .br-under`).waitFor({ state: 'hidden' });
  await bob.page.waitForTimeout(500);
  check(!(await bob.$(`${R} .br-invite`).count()), 'Bob turned it off: he isn\'t asked again.');
  check(await alice.$(`${R} .br-under`).isVisible(), 'It stays on for Alice.');
  // (At most one switch every 2 seconds: flipping it would flicker everyone's screen.)
  await alice.page.waitForTimeout(2100);
  await alice.$(`${R} .reels-bar .br-everyone`).click();
  await alice.$(`${R} .reels-bar .br-everyone[aria-pressed="false"]`).waitFor();
  await alice.$(`${R} .reels-bar button`, { hasText: 'Stop' }).click();
  await bob.$(`${R} .reels-bar button`, { hasText: 'Scroll together' }).waitFor();
  await alice.$(`${R} .br-x`).click();

  // A phone: half and half, one above the other.
  const phone = await t.open('bob-brainrot', PHONE);
  await fakeSocialSites(phone);
  const { page } = phone;
  await phone.login('bob', t.pw.bob);
  // (The server's channels on Home's list; #general opens full screen over it.)
  await phone.phoneServer(SERVER);
  await phone.openChannel('general');
  await page.waitForSelector('body.m-conv');
  await page.locator('.conv-tab', { hasText: 'Reels' }).tap();
  await page.locator('.reels-cover button', { hasText: 'Start watching' }).tap();
  check(!(await page.locator('#tabbar').isVisible()), 'On a phone the tab bar should not show over Reels.');
  await page.waitForFunction(() => !!document.querySelector('.reels-layer .reel-card[data-i="0"] iframe'));
  await page.locator('.reels-bar .br-toggle').tap();
  // (Warned on his desktop, but this is another device: its settings are its own.)
  await (await phone.dialog('Turn on Brainrot mode?')).locator('.modal-foot button', { hasText: 'Turn it on' }).tap();
  await page.locator('.reels-main.br-col .br-under:not([hidden])').waitFor();
  const [feed, under] = await Promise.all(['.reels-feed', '.br-under'].map((s) => page.locator(`.reels-layer ${s}`).boundingBox()));
  check(Math.abs(feed.height - under.height) < 4 && under.y >= feed.y + feed.height - 2, `On a phone: 50/50, the gameplay below (feed ${feed.height}, gameplay ${under.height}).`);
  await running(phone, R, 'On a phone');
  await page.locator('.br-gear').tap();
  await level(phone, R, 2);
  await page.locator('.br-panel .icon-btn[aria-label="Close settings"]').tap();
  await page.waitForTimeout(700);
  await shot(phone, 'phone-parkour');
  await page.locator('.br-gear').tap();
  await page.locator('.br-choice', { hasText: 'Rail Runner' }).tap();
  await page.locator('.br-panel .icon-btn[aria-label="Close settings"]').tap();
  await page.waitForTimeout(900);
  await shot(phone, 'phone-runner');
  // The canvas is capped (at most 1.5 device pixels per CSS pixel, on this 2× phone).
  const c = await page.evaluate(() => { const x = document.querySelector('.reels-layer .br-under canvas'); return [x.width, x.clientWidth]; });
  check(c[0] <= Math.ceil(c[1] * 1.5) + 1, `The canvas resolution is capped (${c[0]} pixels for ${c[1]} CSS pixels).`);
  await page.locator('.br-x').tap();
  await page.locator('.reels-layer .br-under').waitFor({ state: 'hidden' });
  await phone.close();
  for (const p of [alice, bob]) { await p.$('.conv-tab', { hasText: 'Chat' }).click(); await p.$('.reels-layer').waitFor({ state: 'hidden' }); }

  // In a call: under the call's tiles. And in watch together: under (or beside) the shared video.
  await alice.channelRow('Lounge').locator('.ch-main').click();
  await alice.$('.voice-room .cs-tile', { hasText: 'Alice Wonder' }).waitFor();
  await alice.$('.voice-room .cs-controls button.br-call').click();
  await alice.$('.voice-room .call-stage.br-on .br-under:not([hidden])').waitFor();
  await running(alice, '.voice-room', 'In the call');
  await alice.$('.voice-room .cs-controls button.br-call[aria-pressed="true"]').waitFor();
  await shot(alice, 'desktop-call');
  await alice.$('.voice-room .cs-controls button.br-call').click();
  await alice.$('.voice-room .br-under').waitFor({ state: 'hidden' });
  await alice.$('.voice-room .cs-controls button[aria-label="Watch together"]').click();
  const m = await alice.dialog('Watch together');
  await m.locator('input.input').fill(`${t.server.base}/e2e-clip.webm`);
  await m.locator('.modal-foot .btn.primary').click();
  await alice.$('.wt-title', { hasText: 'e2e-clip.webm' }).first().waitFor();
  await alice.$('.wt-actions .br-toggle').first().click();
  await alice.$('.wt.br-on .br-under:not([hidden])').waitFor();
  await running(alice, '.wt', 'Watch together');
  await shot(alice, 'desktop-watch');
  await alice.page.keyboard.press('Escape');
  await alice.$('.wt .br-under').waitFor({ state: 'hidden' });
  await alice.$('.wt-actions button', { hasText: 'Stop' }).first().click();
  await alice.$('.wt-title').first().waitFor({ state: 'detached' });
  await alice.$('#voice-panel button[aria-label="Leave call"]').click();
  await alice.page.waitForSelector('#voice-panel', { state: 'hidden' });
  for (const p of [alice, bob]) await p.context.unroute(/^https:\/\/www\.(tiktok|instagram)\.com\//);
}
