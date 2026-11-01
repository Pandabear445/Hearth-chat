// First run and onboarding (1.44): the page's own loading screen is announced politely, the sign-in forms' new parts
// (show/hide password, the hint under it) have names and ties a screen reader follows, a mistake is said on its
// field, and Home's first-run cards (Secure your account, ways to start) pass the audit on a computer and a phone.
// Run by run.mjs with its helpers (run(ctx)); pages are its own, from a network of their own (x-forwarded-for), since
// the main checks use up the sign-ups one network gets in an hour.
export async function run({ H, base, check, section, audit, settle, PASSWORD }) {
  section('First run and onboarding');
  const page = async (opts, n) => {
    const p = await H.newPage(opts);
    await p.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.91.${n}` });
    return p;
  };

  // The splash, while the app's script is still on its way.
  const s = await page({ width: 1366, height: 768 }, 1);
  await s.route('**/js/app.js', async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
  const loading = s.goto(base);
  await s.waitForSelector('#boot-splash');
  const splash = await s.evaluate(() => {
    const el = document.getElementById('boot-splash');
    const cs = getComputedStyle(el);
    return { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.querySelector('.boot-text').textContent, shown: cs.display !== 'none' && cs.visibility !== 'hidden', svgHidden: el.querySelector('svg').getAttribute('aria-hidden') };
  });
  check(splash.role === 'status' && splash.live === 'polite', 'the loading screen is a polite status', splash);
  check(splash.shown && /Loading/.test(splash.text) && splash.svgHidden === 'true', 'it says it is loading, with its picture hidden from screen readers', splash);
  await loading;
  await s.waitForSelector('#auth:not([hidden])');
  check(await s.evaluate(() => !document.getElementById('boot-splash')), 'the loading screen is gone once the sign-in screen is up');

  // Show/hide password: a named toggle button, tied to the box(es) it shows.
  const eyes = await s.evaluate(() => [...document.querySelectorAll('#auth .pw-eye')].map((b) => ({
    name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), type: b.type,
    controls: (b.getAttribute('aria-controls') || '').split(/\s+/).every((id) => !!document.getElementById(id)),
    icon: !!b.querySelector('svg[aria-hidden="true"]'),
  })));
  check(eyes.length === 2 && eyes.every((e) => e.name === 'Show password' && e.pressed === 'false' && e.type === 'button' && e.controls && e.icon), 'the password toggles have a name, a pressed state and what they control', eyes);
  await s.click('#login-form .pw-eye');
  check(await s.getAttribute('#login-form .pw-eye', 'aria-pressed') === 'true' && await s.getAttribute('#login-password', 'type') === 'text', 'pressing it shows the password and says so');
  await s.click('#login-form .pw-eye');
  await audit(s, 'sign-in form with the password toggle');

  // The sign-up form: the hint is tied to the password box; a username with a space is said on its field.
  await s.click('#to-register');
  const hint = await s.evaluate(() => {
    const pw = document.querySelector('#register-form [name=password]');
    return (pw.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent).join(' ');
  });
  check(/At least 8 characters/.test(hint), 'the password hint is read with the password box', hint);
  await s.fill('#register-form [name=username]', 'a b');
  await s.click('#register-form button[type=submit]');
  const bad = await s.evaluate(() => {
    const u = document.querySelector('#register-form [name=username]');
    const ids = (u.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return { invalid: u.getAttribute('aria-invalid'), said: ids.map((id) => (document.getElementById(id) || {}).textContent).join(' '), focused: document.activeElement === u };
  });
  check(bad.invalid === 'true' && /no spaces/.test(bad.said) && bad.focused, 'a username with a space is marked, explained and focused', bad);
  await audit(s, 'sign-up form with a mistake');

  // A new account's Home: the first-run cards on a computer…
  await s.fill('#register-form [name=username]', 'firstrun');
  await s.fill('#register-form [name=password]', PASSWORD);
  await s.fill('#register-form [name=confirm]', PASSWORD);
  await s.check('#register-form [name=tos]');
  await s.click('#register-form button[type=submit]');
  await s.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
  await settle(s, 400);
  const cards = await s.evaluate(() => {
    const sc = document.querySelector('#main .secure-card');
    const st = document.querySelector('#main .start-card');
    const name = (el) => { const id = el && el.getAttribute('aria-labelledby'); return id ? (document.getElementById(id) || {}).textContent : null; };
    return { secure: name(sc), start: name(st), steps: st ? [...st.querySelectorAll('.start-item')].map((b) => b.tagName + ':' + b.textContent.trim().slice(0, 30)) : [] };
  });
  check(cards.secure === 'Secure your account' && cards.start && cards.steps.length === 3 && cards.steps.every((x) => x.startsWith('BUTTON:')), 'Home\'s first-run cards are named regions of buttons', cards);
  await audit(s, 'Home on a new account (computer)');
  await s.close();

  // …and on a phone: the You tab says why it has a dot.
  const ph = await page({ width: 390, height: 844, isMobile: true, hasTouch: true }, 2);
  await ph.goto(base);
  await ph.fill('#login-form [name=username]', 'firstrun');
  await ph.fill('#login-form [name=password]', PASSWORD);
  await ph.click('#login-form button[type=submit]');
  await ph.waitForSelector('#app:not([hidden]):not(.loading)', { timeout: 60000 });
  await settle(ph, 400);
  const you = await ph.getAttribute('#tabbar button[data-tab="you"]', 'aria-label');
  check(/secure your account/.test(you), 'the You tab\'s name says what its dot is for', you);
  await audit(ph, 'Home\'s list on a new account (phone)');
  await ph.close();
}
