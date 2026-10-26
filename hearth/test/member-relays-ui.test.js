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
  assert.match(host, /x\.uninstall \|\| 'sudo hearth-relay-uninstall'/, 'removing one shows how to take it off the machine');
  assert.match(host, /d\.enabled \? null : h\('p', \{ class: 'muted-p' \}, 'The owner has turned off member relays\.'\)/);
  assert.match(host, /d\.enabled \? h\('div', \{ class: 'row gap' \},\n\s+h\('button', \{ class: 'btn primary', disabled: full,/, 'no offer while it’s off, and not past the limit');
  assert.match(host, /if \(app\.onSocket\) stop = app\.onSocket\('relays:mine', tick\);/);
  assert.match(host, /const tick = \(\) => \{ if \(root\.isConnected\) load\(\); else \{ stop\(\); clearInterval\(timer\); \} \};/, 'and stops once the page is gone');
  assert.match(s, /const RELAY_CAPS = \[\[10, '10 Mbit\/s'\], \[25, '25 Mbit\/s'\], \[50, '50 Mbit\/s'\], \[100, '100 Mbit\/s'\], \[0, 'No limit'\]\];/);
  assert.match(host, /let cap = 25;/, '25 Mbit/s unless the member picks another');
  for (const said of ['IP address of everyone whose call goes through it', 'whose app measures it', 'It never sees what’s said or shown', 'different on every member’s relay',
    'Your machine’s IP address goes to everyone’s app', 'locked with this server’s backup key, which never leaves the server', 'refuses to pass anything on to private addresses']) assert.ok(host.includes(said), said);
  // The install command says how long its link works and what it installs.
  const cmd = s.slice(s.indexOf('const relayCommand = '), s.indexOf('function hostTab('));
  assert.ok(cmd.includes('The link works for 24 hours. It installs coturn') && cmd.includes('every minute'));
});

test('Settings → Privacy & safety: avoiding members’ relays is the memberRelays choice on the account', () => {
  const privacy = fnSource(read('public', 'js', 'settings.js'), 'privacyTab');
  assert.match(privacy, /section\('Call relays run by members',\n\s+toggle\('Avoid relays run by members', p\.memberRelays === 'avoid', \(v\) => save\('memberRelays', v \? 'avoid' : 'use'\),/);
  assert.ok(privacy.includes('A relay sees your IP address when your call goes through it, never what’s said or shown. On: your calls only use the owner’s relays'));
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
  assert.match(fnSource(a, 'regions', '  '), /clearInterval\(timer\);\n {4}timer = setInterval\(/);
});

test('the app hands settings pages a way to follow a server event, and the e2e flow runs just before the last one', () => {
  assert.match(read('public', 'js', 'app.js'), /\n {2}onSocket: \(ev, fn\) => \{ if \(!socket\) return \(\) => \{\}; socket\.on\(ev, fn\); return \(\) => socket\.off\(ev, fn\); \},\n\};/);
  const flows = read('test', 'e2e', 'flows.mjs');
  const order = [...flows.slice(flows.indexOf('export const FLOWS = [')).matchAll(/, (\w+)\],\n/g)].map((x) => x[1]);
  assert.deepEqual(order.slice(-2), ['memberRelays', 'updateBar'], 'updateBar (it restarts the server) stays last');
});
