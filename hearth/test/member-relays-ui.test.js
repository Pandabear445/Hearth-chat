// Member relays in the app: Settings → Help host (a member's own relays), Settings → Privacy & safety (avoiding them)
// and Admin → Regions → Member relays (the owner's approval). The words a relay's status and backup copies are shown
// with, run as the module itself; and static checks that the pages use the routes in server/regions.js as agreed:
// approving one, resuming one and sending it backup copies ask for the password again, pausing, stopping copies and
// removing don't; the member's page follows relays:mine while it's open. The e2e flow "member relays" drives it all
// in a browser.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
// The client writes ’, → and · both as they are and as \u escapes: read them all as the characters.
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\\u([0-9a-f]{4})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));

// Browser bits admin.js's imports touch as they load (nothing is drawn here). The timer activity.js starts to keep
// "x min ago" labels fresh mustn't keep this test running.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { crypto: globalThis.crypto, addEventListener() {} };
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null };
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realInterval(...a); if (t && t.unref) t.unref(); return t; };

let A;
before(async () => { A = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'admin.js')).href); });

// The source of one top-level function, or of one a level in (two spaces), up to its closing brace.
function fnSource(text, name, indent = '') {
  const start = text.search(new RegExp(`^${indent}(export )?(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `function ${name}`);
  return text.slice(start, text.indexOf(`\n${indent}}\n`, start) + indent.length + 2);
}

test('a member relay’s status, in the words its member and the owner read', () => {
  const now = Date.now();
  const st = (x, o) => A.relayStatus({ status: 'approved', alive: true, waitingForInstall: false, installOpen: false, lastSeen: now, relayUp: true, ...x }, o);
  assert.deepEqual(st({ status: 'pending', waitingForInstall: true, installOpen: true, alive: false, lastSeen: null }), { kind: 'warn', label: 'Waiting for install' });
  assert.deepEqual(st({ status: 'pending' }), { kind: 'warn', label: 'Waiting for approval' });
  assert.deepEqual(st({}), { kind: 'ok', label: 'Relaying calls' });
  assert.deepEqual(st({ status: 'paused' }, { member: true }), { kind: 'bad', label: 'Paused by the owner' });
  assert.deepEqual(st({ status: 'paused' }), { kind: 'bad', label: 'Paused' });
  // Approved, but no check-in for 3 minutes: offline since the last one, a time today ("3:12 PM")…
  const today = new Date(); today.setHours(15, 12, 0, 0);
  const t = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.deepEqual(st({ alive: false, lastSeen: today.getTime() }), { kind: 'bad', label: `Offline since ${t(today)}` });
  // …with the day before today.
  const old = now - 3 * 86400000;
  assert.equal(st({ alive: false, lastSeen: old }).label, `Offline since ${new Date(old).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t(old)}`);
  // Checking in, but its relay program isn't running: calls get no address for it, so it isn't relaying.
  assert.deepEqual(st({ relayUp: false }), { kind: 'bad', label: 'Relay stopped' });
  // Approved before it ever checked in: it waits for its install. A paused one says so first.
  assert.equal(st({ waitingForInstall: true, installOpen: true, alive: false }).label, 'Waiting for install');
  assert.equal(st({ status: 'pending', waitingForInstall: true, installOpen: false, alive: false }).label, 'Install link expired');
  assert.equal(st({ status: 'paused', waitingForInstall: true, alive: false }, { member: true }).label, 'Paused by the owner');
});

test('backup copies on a member’s relay, as its member reads them', () => {
  const b = (x) => A.relayBackupText({ status: 'approved', offersBackups: true, backups: true, backup: { ready: true, files: 3, usedMb: 900, freeMb: 20000 }, ...x });
  assert.equal(b({}), '3 backup copies');
  assert.equal(b({ backup: { ready: true, files: 1 } }), '1 backup copy');
  assert.equal(b({ offersBackups: false, backups: false }), 'No backups');
  assert.equal(b({ status: 'pending', backups: false }), 'Backups: waiting for approval');
  assert.equal(b({ backups: false }), 'No backups: the owner kept them off');
  assert.match(b({ backup: { ready: false } }), /^Backups: no backup space yet/);
  assert.match(b({ backup: null }), /^Backups: no backup space yet/);
});

test('Settings → Help host: in the Servers group, on the member routes, live while open, and saying what a relay sees', () => {
  const s = read('public', 'js', 'settings.js');
  assert.match(s, /\['Servers', \[\['servers', 'Server settings', 'gear'\], \['host', 'Help host', 'globe'\], \['instance', 'Instance', 'monitor', 'admin'\]\]\]/);
  assert.match(s, /const views = \{[^}]*\bhost: hostTab \};/);
  const host = fnSource(s, 'hostTab');
  assert.match(host, /api\('GET', '\/me\/relays'\)/);
  assert.match(host, /api\('POST', '\/me\/relays', \{ name: name\.value\.trim\(\), capMbit: cap, backups, origin: location\.origin \}\)/);
  assert.match(host, /api\('POST', `\/me\/relays\/\$\{encodeURIComponent\(r\.id\)\}\/reinstall`, \{ origin: location\.origin \}\)/);
  assert.match(host, /api\('DELETE', `\/me\/relays\/\$\{encodeURIComponent\(r\.id\)\}`\)/);
  assert.match(host, /\n {4}uninstall\(r\.name, x\.uninstall\);\n/, 'removing one shows how to take it off the machine');
  assert.match(host, /const uninstall = \(name, command\) => showCommand\(`Uninstall \$\{name\}`, command \|\| 'sudo hearth-relay-uninstall',/);
  // One the owner removed: said so, with the way to take it off the machine, until the member dismisses it.
  assert.match(host, /\.\.\.\(d\.removed \|\| \[\]\)\.map\(goneRow\),/);
  assert.match(host, /h\('span', \{ class: 'rpill bad' \}, g\.by === 'sweep' \? 'Removed' : 'Removed by the owner'\)/);
  assert.match(host, /onclick: \(\) => uninstall\(g\.name\) \}, 'How to uninstall'\)/);
  assert.match(host, /api\('DELETE', `\/me\/relays\/\$\{encodeURIComponent\(g\.id\)\}`\)/);
  // The name stays with the member and the owner, so it doesn't invite personal details either.
  assert.match(host, /placeholder: 'e\.g\. Spare Pi'/);
  assert.ok(host.includes("field('Name', name, 'Only you and the owner see it. Everyone else’s app just says “Member relay”.')"));
  assert.doesNotMatch(host, /Maya|people in calls that use it/);
  assert.match(host, /d\.enabled \? null : h\('p', \{ class: 'muted-p' \}, 'The owner has turned off member relays\.'\)/);
  assert.match(host, /d\.enabled \? h\('div', \{ class: 'row gap' \},\n\s+h\('button', \{ class: 'btn primary', disabled: full,/, 'no offer while it’s off, and not past the limit');
  assert.match(host, /if \(app\.onSocket\) stop = app\.onSocket\('relays:mine', tick\);/);
  assert.match(host, /const tick = \(\) => \{ if \(root\.isConnected\) load\(\); else \{ stop\(\); clearInterval\(timer\); \} \};/, 'and stops once the page is gone');
  assert.match(s, /const RELAY_CAPS = \[\[10, '10 Mbit\/s'\], \[25, '25 Mbit\/s'\], \[50, '50 Mbit\/s'\], \[100, '100 Mbit\/s'\], \[0, 'No limit'\]\];/);
  assert.match(host, /let cap = 25;/, '25 Mbit/s unless the member picks another');
  for (const said of ['IP address of everyone whose call goes through it', 'whose app measures it', 'It never sees what’s said or shown', 'different on every member’s relay',
    'Your machine’s IP address goes to everyone’s app', 'locked with this server’s backup key, which never leaves the server', 'refuses to pass anything on to private addresses',
    // What it doesn't promise: a stable made-up name can be matched to a person by when they join calls.
    'the same person always has the same one, and whoever sees when people join calls can often work out whose it is',
    // The name stays with the member and the owner.
    'Its name doesn’t: only you and the owner see that',
    // Its own home network, IPv6 included (setup-turn.sh --member).
    'or to your own public address, and it relays over IPv4 only']) assert.ok(host.includes(said), said);
  assert.doesNotMatch(host, /doesn’t see who’s who/, 'no promise it can’t keep');
  // The install command says how long its link works and what it installs.
  const cmd = s.slice(s.indexOf('const relayCommand = '), s.indexOf('function hostTab('));
  assert.ok(cmd.includes('The link works for 24 hours. It installs coturn') && cmd.includes('every minute'));
});

test('Settings → Privacy & safety: avoiding members’ relays is the memberRelays choice on the account', () => {
  const privacy = fnSource(read('public', 'js', 'settings.js'), 'privacyTab');
  // A switch that couldn't be saved goes back (save says whether it was), so it never shows a choice not in effect.
  assert.match(privacy, /section\('Call relays run by members',\n\s+toggle\('Avoid relays run by members', p\.memberRelays === 'avoid', \(v, input\) => save\('memberRelays', v \? 'avoid' : 'use'\)\.then\(\(ok\) => \{ if \(!ok\) input\.checked = !v; \}\),/);
  assert.match(privacy, /\n {6}return true;\n {4}\} catch \(e\) \{ toast\(e\.message, 'error'\); return false; \}/);
  assert.match(read('public', 'js', 'settings.js'), /onchange: \(e\) => onChange\(e\.target\.checked, e\.target\)/, 'toggle hands the input over');
  assert.ok(privacy.includes('A relay sees your IP address when your call goes through it, never what’s said or shown. On: your app never uses, measures or connects through a member’s relay, and ignores the other person’s addresses on one'));
  // What it does about the other side (voice.js: told with every offer and answer), and the one thing it can't stop.
  assert.ok(privacy.includes('The others in a call are told you avoid them, so their apps leave members’ relays out of their connection with you too.'));
  assert.ok(privacy.includes('Only someone running a modified app could still put a member’s relay between you.'));
  assert.doesNotMatch(privacy, /only use the owner’s relays|never reach|keeps your calls off|when your network lets its connection checks in/);
  // Saving it follows at once: a new relay list, for a call in progress too (app.js followRelayChoice).
  assert.match(privacy, /if \(k === 'memberRelays' && app\.followRelayChoice\) app\.followRelayChoice\(\);/);
});

test('Admin → Regions → Member relays: the password again where someone else’s machine joins everyone’s calls or the backups', () => {
  const a = read('public', 'js', 'admin.js');
  assert.match(fnSource(a, 'regions', '  '), /\n {6}\.\.\.memberRelays\(d\),\n/);
  const m = fnSource(a, 'memberRelays', '  ');
  assert.match(m, /withPassword\(\(y\) => api\('POST', `\/admin\/regions\/\$\{r\.id\}\/approve`, \{ backups: keep\.checked, \.\.\.y \}\),/);
  assert.match(m, /withPassword\(\(y\) => api\('POST', `\/admin\/regions\/\$\{r\.id\}\/resume`, y\),/);
  assert.match(m, /withPassword\(\(y\) => api\('POST', `\/admin\/regions\/\$\{r\.id\}\/backups`, \{ on: true, \.\.\.y \}\),/);
  // (memberRelays is outside regions(), whose own withPassword always says the install command carries the secret.)
  assert.doesNotMatch(m, /const withPassword/);
  assert.match(m, /run\(\(\) => api\('POST', `\/admin\/regions\/\$\{r\.id\}\/pause`\),/);
  assert.match(m, /run\(\(\) => api\('POST', `\/admin\/regions\/\$\{r\.id\}\/backups`, \{ on: false \}\),/);
  assert.match(m, /run\(\(\) => api\('DELETE', `\/admin\/regions\/\$\{r\.id\}`\),/);
  assert.match(m, /api\('PATCH', `\/admin\/regions\/\$\{r\.id\}`, \{ name: name\.value\.trim\(\) \}\)/);
  assert.match(m, /api\('PATCH', '\/admin\/member-relays', \{ enabled: input\.checked \}\)/);
  assert.ok(m.includes("'Members can’t offer new relays. The ones you approved keep working.'"));
  // Approving: backup copies only for a relay that offered space, off unless the owner turns them on.
  assert.match(m, /const keep = h\('input', \{ type: 'checkbox' \}\);/);
  assert.match(m, /r\.offersBackups\n\s+\? h\('label', \{ class: 'toggle-row' \}, h\('span', \{ class: 'toggle-text' \}, h\('span', \{ class: 'toggle-label' \}, 'Keep encrypted backup copies on it'\),/);
  assert.ok(m.includes("'Copies are locked with your backup key, which never leaves this server. Only send them to people you trust: anyone who someday got the key could open one.'"));
  // Backups on and off only once it's approved (or paused), and only if it offered space.
  assert.match(m, /r\.offersBackups && r\.status !== 'pending' \? \(r\.backups/);
  assert.match(m, /r\.status === 'pending' \? btn\('Approve', \(\) => approve\(r\), 'btn primary sm'\) : null,/);
  // The page refreshes on its own when a member's relay changes, with one timer however often it's redrawn.
  const regionsFn = fnSource(a, 'regions', '  ');
  assert.match(regionsFn, /clearInterval\(timer\);\n {4}timer = setInterval\(/);
  // ...but not for what changes at nearly every check-in (a home machine's traffic): those lines are updated where they
  // are, so keyboard focus and the measurements stay. A redraw puts focus back on the button it was on.
  assert.match(regionsFn, /const \{ load: _l, cpus: _c, mem: _m, mbps: _b, monthGb: _g, month: _mo, lastSeen, backup, \.\.\.rest \} = r;/);
  assert.match(regionsFn, /if \(sig\(x\) !== sig\(d\)\) \{ regions\(\); return; \}/);
  assert.match(regionsFn, /body\.querySelectorAll\('\[data-live\]'\)\.forEach/);
  assert.match(regionsFn, /'data-live': `stats:\$\{r\.id\}`/);
  assert.match(regionsFn, /const again = had && \[\.\.\.body\.querySelectorAll\('\[data-focus\]'\)\]\.find\(\(el\) => el\.dataset\.focus === had\);/);
  assert.match(regionsFn, /const measured = measuredBox \|\| \(measuredBox = h\('div', \{ class: 'stack' \}\)\);/);
  assert.match(m, /'data-live': `stats:\$\{r\.id\}`/);
  assert.match(m, /const btn = \(label, onclick, cls = 'btn ghost sm'\) => h\('button', \{ class: cls, 'data-focus': `\$\{label\}:\$\{r\.id\}`, onclick \}, label\);/);
  // A member relay that moved shows where it was (a member's machine says where it is).
  assert.match(m, /` \(was \$\{moved\.from\} until \$\{ago\(moved\.at\)\}\)`/);
  // Its name: only the owner and its member.
  assert.ok(m.includes("field('Name', name, `Shown to you and to ${who(r)}. Everyone else’s app just says “Member relay”.`)"));
  // "Measure from this device" leaves members' relays alone for an admin who avoids them (the choice read then).
  assert.match(fnSource(a, 'regions', '  '), /const ice = usableIce\(await api\('GET', '\/ice'\), avoidsMemberRelays\(me\(\)\)\);\n {6}const ranks = await rankRelays\(ice, \{ force: true \}\);/);
  assert.match(read('public', 'js', 'app.js'), /adminView\(\{ role: S\.me\.staffRole, confirm: \(fn, opts\) => confirmedCall\(app, fn, opts\), me: \(\) => S\.me,/);
});

test('the app hands settings pages a way to follow a server event, and the e2e flow runs just before the last one', () => {
  assert.match(read('public', 'js', 'app.js'), /\n {2}onSocket: \(ev, fn\) => \{ if \(!socket\) return \(\) => \{\}; socket\.on\(ev, fn\); return \(\) => socket\.off\(ev, fn\); \},\n\};/);
  const flows = read('test', 'e2e', 'flows.mjs');
  const order = [...flows.slice(flows.indexOf('export const FLOWS = [')).matchAll(/, (\w+)\],\n/g)].map((x) => x[1]);
  assert.deepEqual(order.slice(-2), ['memberRelays', 'updateBar'], 'updateBar (it restarts the server) stays last');
});
