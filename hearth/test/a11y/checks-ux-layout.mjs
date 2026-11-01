// Touch targets on touch screens (public/css/ux-layout.css): on an iPad nothing in the sidebar or the conversation's
// header is smaller than 40px to a finger, and on a phone nothing in the conversation's controls is under 44px.
// A small button may look small: what counts is what answers a touch, so an absolutely placed ::before around it
// (the way ux-layout.css widens them) counts too. Signs in as alice (made earlier in run.mjs, with her server
// "Quality checks"), so no sign-up is used.

// Every visible button, link or checkbox inside `scope` that a finger gets less than `min` px of.
function smallTargets([scope, min]) {
  const out = [];
  for (const e of document.querySelectorAll(`:is(${scope}) :is(button, a[href], [role=button], input[type=checkbox])`)) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    let w = r.width; let h = r.height;
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(e, pseudo);
      if (p.content === 'none' || p.position !== 'absolute') continue;
      w = Math.max(w, parseFloat(p.width) || 0); h = Math.max(h, parseFloat(p.height) || 0);
    }
    if (w < min - 0.5 || h < min - 0.5) out.push(`${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20) || e.className} ${Math.round(w)}×${Math.round(h)}`);
  }
  return out;
}

async function signIn(ctx, page) {
  await page.goto(ctx.base);
  await page.fill('#login-form [name=username]', 'alice');
  await page.fill('#login-form [name=password]', ctx.PASSWORD);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
  await ctx.settle(page);
}

export async function run(ctx) {
  const { H, check, section, settle } = ctx;
  section('Touch targets (1.44 layout)');

  // An iPad held upright: the sidebar and the conversation's header.
  const pad = await H.newPage({ width: 820, height: 1180, isMobile: true, hasTouch: true });
  await signIn(ctx, pad);
  await pad.click('#rail button[aria-label^="Quality checks"]'); await settle(pad, 400);
  const padSmall = await pad.evaluate(smallTargets, ['#sidebar, #main-head', 40]);
  check(!padSmall.length, 'iPad (820x1180): nothing in the sidebar or the header is under 40px to a finger', padSmall);
  await pad.close();

  // A phone: the conversation's header, Chat | Reels, the message box, and the avatars and names that open profiles.
  const phone = await H.newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await signIn(ctx, phone);
  await phone.click('#rail button[aria-label^="Quality checks"]'); await settle(phone, 400);
  await ctx.toConversation(phone);
  const phoneSmall = await phone.evaluate(smallTargets, ['#main-head, .conv-tabs, .cw-main, #messages .msg-gutter, #messages .msg-head', 44]);
  check(!phoneSmall.length, 'phone (390x844): nothing in the conversation\'s controls is under 44px', phoneSmall);
  // White initials on a coloured avatar tile read at 4.5:1 (the tile is darkened on phones).
  const tiles = await phone.evaluate(() => [...document.querySelectorAll('#messages .av-inner')].filter((t) => t.querySelector(':scope > .av-initials')).map((t) => getComputedStyle(t).boxShadow));
  check(tiles.length > 0 && tiles.every((s) => /inset/.test(s)), 'phone: avatar initials sit on a darkened tile', tiles.slice(0, 3));
  await phone.close();
}
