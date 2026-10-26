// Member relays (Settings → Help host, server/regions.js): a member offers a Linux machine of their own as a call
// relay. It's someone else's machine, so: it gets a TURN secret of its own (never the main one), nothing uses it until
// the owner approves it with the password, people are named on it by a pseudonym of its own, it gets backup copies
// only if both sides agree, and a member only ever sees and changes their own relays.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer, hex } = require('./helpers');

const ORIGIN = 'https://chat.example.test';
const MAIN_SECRET = hex(32);
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG6vHZd6yfCzVFOySflZG/g7JEVNvf8rvov34t9xjmjr';
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

let srv;
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });
// Each download from an address of its own (rate-limited per address).
let n = 0;
const nextIp = () => { n++; return `198.51.${100 + ((n >> 8) & 3)}.${(n & 255) || 1}`; };
// Each relay's machine at an address of its own, which it checks in from (a member relay's address has to be the one
// it checks in from, and nobody else's).
const machines = new Map();
const ipOf = (id) => { if (!machines.has(id)) { const k = machines.size + 1; machines.set(id, `203.0.${113 + (k >> 8)}.${(k & 255) || 1}`); } return machines.get(id); };
const beat = (id, token, extra = {}) => { const ip = extra.ip || ipOf(id); return srv.api('POST', `/regions/${id}/heartbeat`, { ip: extra.from || ip, headers: { 'x-region-token': token },
  body: { tx: 1000, rx: 2000, load: 0.25, cpus: 2, mem: 30, relay: true, uptime: 600, version: 4, ...extra, ip } }); };
const urlsAt = (ip) => [`turn:${ip}:3478?transport=udp`, `turn:${ip}:3478?transport=tcp`];
const script = async (id, link) => (await srv.call('GET', `/regions/install/${id}?k=${link}`, { ip: nextIp() })).text;
// The secret the installer hands setup-turn.sh (in a root-only file), and the check-in token it gives the agent.
const secretIn = (s) => /\( umask 077 && printf '%s\\n' '([^'\n]+)' > "\$SETUP_DIR\/turn-secret" \)\n/.exec(s)[1];
const tokenIn = (s) => /^TOKEN='([0-9a-f]+)'$/m.exec(s)[1];
const linkIn = (command) => /[?&]k=([0-9a-f]+)/.exec(command)[1];
// An offer: its install link's token (link), and the check-in token inside its installer (token).
async function offer(u, body = {}) {
  const r = await as(u, 'POST', '/me/relays', { name: `Pi ${hex(2)}`, capMbit: 25, backups: false, origin: ORIGIN, ...body });
  assert.equal(r.status, 200, r.text);
  const link = linkIn(r.json.command);
  const token = tokenIn(await script(r.json.relay.id, link));
  return { id: r.json.relay.id, link, token, ip: ipOf(r.json.relay.id), command: r.json.command, relay: r.json.relay };
}
// Offered, checked in and approved (with backup copies if asked for): its own secret comes from its installer.
async function liveRelay(u, body = {}, approveBody = {}) {
  const o = await offer(u, body);
  o.secret = secretIn(await script(o.id, o.link));
  assert.equal((await beat(o.id, o.token)).status, 200);
  assert.equal((await approve(o.id, approveBody)).status, 200);
  return o;
}
const approve = (id, body = {}) => as(srv.owner, 'POST', `/admin/regions/${id}/approve`, { authKey: srv.owner.authKey, ...body });
const admin = async () => { const r = await as(srv.owner, 'GET', '/admin/regions'); assert.equal(r.status, 200, r.text); return r.json; };
const ice = async (u) => { const r = await as(u, 'GET', '/ice'); assert.equal(r.status, 200, r.text); return r.json; };
const community = (list) => list.filter((e) => e.community === true);
const actions = () => srv.sql('SELECT action FROM admin_log ORDER BY id').map((r) => r.action);
const fresh = () => srv.sql('DELETE FROM regions');

before(async () => {
  srv = await startServer();
  // The main server's own relay, so every list also has its entry (and its secret to look for).
  srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnSecret', ?)", MAIN_SECRET);
  srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnUrls', 'turn:relay.example.test:3478?transport=udp')");
});
after(() => srv.stop());

// ------------------------------------------------------------------ offer → install command
test('an offer gives an install command for the relay\'s own secret, with the member\'s choices fixed into it', async () => {
  fresh();
  const maya = await srv.register();
  assert.deepEqual((await as(maya, 'GET', '/me/relays')).json, { enabled: true, max: 2, relays: [], removed: [] });
  const a = await offer(maya, { name: '  Maya’s Pi, Chicago  ', capMbit: 50, backups: true });
  assert.deepEqual(Object.keys(a.relay).sort(), ['alive', 'backup', 'backups', 'capMbit', 'createdAt', 'id', 'installOpen', 'lastSeen', 'mbps', 'monthGb', 'name', 'offersBackups', 'relayUp', 'status', 'waitingForInstall'],
    'the member sees how it is doing, never an address or a secret');
  assert.equal(a.relay.name, 'Maya’s Pi, Chicago');
  assert.equal(a.relay.status, 'pending');
  assert.equal(a.relay.waitingForInstall, true);
  assert.equal(a.relay.installOpen, true);
  assert.equal(a.relay.alive, false);
  assert.equal(a.relay.capMbit, 50);
  assert.equal(a.relay.offersBackups, true);
  assert.equal(a.relay.backups, false, 'backups wait for the owner');
  assert.equal(a.relay.backup, null);
  // Fetched over https, checked against the SHA-256 of exactly what is served, and only then run.
  assert.match(a.command, /^f="\$\(mktemp\)" && curl -fsSL --proto '=https' /);
  assert.ok(a.command.includes(` -o "$f" '${ORIGIN}/regions/install/${a.id}?k=${a.link}' && `), a.command);
  const s1 = await script(a.id, a.link);
  assert.ok(a.command.includes(`echo '${sha256(s1)}  '"$f" | sha256sum -c - && sudo bash "$f"; rm -f "$f"`), 'the command carries the SHA-256 of what is served');
  assert.equal(await script(a.id, a.link), s1, 'byte for byte the same every time');
  // The link's token only downloads the installer: the one the machine checks in with is another, inside it.
  assert.match(a.token, /^[0-9a-f]{48}$/);
  assert.notEqual(a.token, a.link);
  assert.ok(!a.command.includes(a.token), 'the check-in token isn\'t in the command (shell history)');
  // Its own secret, never the main one. Sealed in the database.
  const own = secretIn(s1);
  assert.match(own, /^[0-9a-f]{64}$/);
  assert.notEqual(own, MAIN_SECRET);
  assert.ok(!s1.includes(MAIN_SECRET), 'the main relay secret is nowhere in it');
  const row = srv.sql('SELECT kind, owner_id, status, secret, offer, backups FROM regions WHERE id = ?', a.id)[0];
  assert.equal(row.kind, 'member');
  assert.equal(row.owner_id, maya.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.backups, 0);
  assert.deepEqual(JSON.parse(row.offer), { capMbit: 50, backups: true });
  assert.match(row.secret, /^sealed:/);
  assert.ok(!row.secret.includes(own), 'not stored in plain text');
  // What the member chose: the bandwidth limit for setup-turn.sh, the backup space, the member-relay wording.
  assert.match(s1, /^# Hearth member relay: /m);
  assert.match(s1, /^KIND='member'$/m);
  assert.match(s1, /^export TURN_CAPACITY_MBIT=50\nbash "\$SETUP_DIR\/setup-turn\.sh" --relay-only --managed --member --secret-file "\$SETUP_DIR\/turn-secret"\n/m, 'IPv4 only, and never to its own address');
  // setup-turn.sh --member: relayed addresses only on the machine's IPv4 address (so nothing goes to anyone's IPv6
  // address, the home router's and computers' included), and never to its own public address.
  const turn = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-turn.sh'), 'utf8');
  assert.match(turn, /\n {4}--member\) MEMBER=yes ;;/);
  assert.match(turn, /\nFAM=""; \[ "\$MEMBER" = yes \] && FAM="-4"/);
  assert.match(turn, /\n {4}"relay-ip=\$PRIVATE_IP" "denied-peer-ip=\$PUBLIC_IP"\)"\n/);
  assert.match(turn, /\n\$MEMBER_CONF\nsimple-log\nCONF\n/);
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: turn }).status, 0);
  assert.ok(s1.includes('ForceCommand internal-sftp -d /backups'), 'backup space, as offered');
  assert.ok(s1.includes('\\"version\\":4'), 'agent version 4');
  assert.ok(s1.includes("It waits for the owner'\"'\"'s approval: see Hearth → Settings → Help host."));
  assert.ok(s1.includes('At home: forward UDP and TCP 3478 and UDP 49160–49400 to this machine in your router. On a VPS: open them in the provider\'s firewall.'));
  assert.ok(s1.includes("cat > /usr/local/bin/hearth-relay-uninstall <<'UNINSTALL_EOF'"));
  assert.doesNotMatch(s1, /\/tmp\/hearth-/);
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: s1 }).status, 0, 'the script parses');
  // A second one: no limit, no backups, another secret.
  const b = await offer(maya, { capMbit: 0, backups: false });
  const s2 = await script(b.id, b.link);
  assert.match(s2, /^export TURN_CAPACITY_MBIT=0$/m);
  assert.ok(!s2.includes('ForceCommand') && !s2.includes('Making a safe place'), 'no backup space when it wasn\'t offered');
  assert.notEqual(secretIn(s2), own);
  assert.ok(!s2.includes(MAIN_SECRET));
  // Renaming doesn't change what's served (the name isn't in it).
  assert.equal((await as(srv.owner, 'PATCH', `/admin/regions/${a.id}`, { name: 'Chicago' })).status, 200);
  assert.equal(await script(a.id, a.link), s1);
  // The owner's own region: the main secret, no member bits, and now the uninstaller too.
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Frankfurt', origin: ORIGIN, authKey: srv.owner.authKey });
  assert.equal(reg.status, 200, reg.text);
  const rs = await script(reg.json.region.id, linkIn(reg.json.command));
  assert.equal(secretIn(rs), MAIN_SECRET);
  assert.match(rs, /--relay-only --managed --secret-file/, 'an owner\'s region relays as before');
  assert.match(rs, /^# Hearth region: /m);
  assert.match(rs, /^KIND='region'$/m);
  assert.doesNotMatch(rs, /^export TURN_CAPACITY_MBIT=/m, 'no bandwidth limit of a member\'s');
  assert.ok(rs.includes('ForceCommand internal-sftp -d /backups'));
  assert.ok(rs.includes('hearth-relay-uninstall'));
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: rs }).status, 0);
  const list = (await as(maya, 'GET', '/me/relays')).json.relays;
  assert.deepEqual(list.map((r) => r.id), [a.id, b.id]);
  assert.ok(actions().includes('member_relay_offered'));
});

test('the uninstaller undoes the install, and the installer marks whether it added coturn and which firewall openings it made', async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const s = await script(o.id, o.link);
  const un = /cat > \/usr\/local\/bin\/hearth-relay-uninstall <<'UNINSTALL_EOF'\n([\s\S]*?)\nUNINSTALL_EOF\n/.exec(s)[1];
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: un }).status, 0, 'it parses');
  for (const must of ['systemctl disable --now hearth-region.timer', 'rm -f /usr/local/bin/hearth-region-agent', "sed -i '/^# BEGIN hearth-backup/,/^# END hearth-backup/d' /etc/ssh/sshd_config",
    'if sshd -t 2>/dev/null; then', 'cp -p /etc/ssh/sshd_config.hearth-bak /etc/ssh/sshd_config', 'userdel hearth-backup', 'rm -rf /var/lib/hearth-backup',
    'done < /etc/hearth-region/ufw-opened', 'ufw delete allow "$RULE"', 'systemctl disable --now coturn', '/etc/turnserver.conf.bak-*',
    'rm -f /etc/turnserver.conf', 'rm -rf /etc/hearth-region', 'removed: %s']) assert.ok(un.includes(must), must);
  // coturn goes only if this install added it: the marker is written before setup-turn.sh installs it. Likewise the
  // firewall openings: noted (only those that weren't there) before setup-turn.sh makes them.
  assert.match(un, /if \[ -f \/etc\/hearth-region\/coturn-by-hearth \] && .*\n {2}# .*\n {2}if DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq -o DPkg::Lock::Timeout=120 coturn/);
  const turn = s.indexOf('bash "$SETUP_DIR/setup-turn.sh"');
  const mark = s.indexOf('|| touch /etc/hearth-region/coturn-by-hearth');
  assert.ok(mark > 0 && mark < turn, 'marked before coturn is installed');
  const ufw = s.indexOf('echo "$RULE" >> /etc/hearth-region/ufw-opened');
  assert.ok(ufw > 0 && ufw < turn, 'firewall openings noted before setup-turn.sh makes them');
  assert.ok(s.includes('grep -q "^$RULE " <<< "$UFW" || grep -qxF "$RULE" /etc/hearth-region/ufw-opened'), 'only the ones that weren\'t there');
  // Run as the installer runs it (set -Eeuo pipefail), with 3478/tcp already open: the other two are noted; run again
  // (a reinstall, the rules all there now), the note stays as it was.
  if (has('bash')) {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-ufw-'));
    try {
      const part = s.slice(s.indexOf('# Likewise the relay\'s firewall openings'), s.indexOf('\nfi\n', s.indexOf('# Likewise the relay\'s firewall openings')) + 4);
      fs.mkdirSync(path.join(t, 'bin'));
      fs.writeFileSync(path.join(t, 'bin', 'ufw'), `#!/usr/bin/env bash\necho "Status: active"\ncat "${t}/rules"\n`);
      fs.chmodSync(path.join(t, 'bin', 'ufw'), 0o755);
      fs.writeFileSync(path.join(t, 'rules'), '22/tcp                     ALLOW       Anywhere\n3478/tcp                   ALLOW       Anywhere\n');
      const go = () => spawnSync('bash', ['-c', `set -Eeuo pipefail\n${part.split('/etc/hearth-region').join(t)}`], { env: { ...process.env, PATH: `${path.join(t, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(go().status, 0);
      assert.equal(fs.readFileSync(path.join(t, 'ufw-opened'), 'utf8'), '3478/udp\n49160:49400/udp\n');
      fs.appendFileSync(path.join(t, 'rules'), '3478/udp                   ALLOW       Anywhere\n49160:49400/udp            ALLOW       Anywhere\n');
      assert.equal(go().status, 0);
      assert.equal(fs.readFileSync(path.join(t, 'ufw-opened'), 'utf8'), '3478/udp\n49160:49400/udp\n');
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }
  // sshd is only reloaded with settings that pass its check.
  assert.doesNotMatch(un, /else\n\s*systemctl reload ssh/);
  // The copy of the SSH settings from before Hearth is taken by the first install only (a reinstall finds the block).
  assert.ok(s.includes("grep -q '^# BEGIN hearth-backup' /etc/ssh/sshd_config || cp -p /etc/ssh/sshd_config /etc/ssh/sshd_config.hearth-bak"));
  assert.ok(s.includes('cp -p /etc/ssh/sshd_config.hearth-prev /etc/ssh/sshd_config'), 'the install\'s own way back is this run\'s copy');
});

test('the uninstaller, run on a copy of an installed machine: only what the install added goes, the old relay settings come back readable, twice is safe', { skip: !['bash', 'sed', 'grep', 'head', 'ls', 'find'].every(has) && 'needs bash and the usual tools' }, async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const un = /cat > \/usr\/local\/bin\/hearth-relay-uninstall <<'UNINSTALL_EOF'\n([\s\S]*?)\nUNINSTALL_EOF\n/.exec(await script(o.id, o.link))[1];
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-uninstall-'));
  try {
    // The machine's folders, under t; root's tools that change the system are stubs that write down what they did.
    const P = (p) => path.join(t, p);
    const text = un.split('/usr/local/bin/').join(P('usr-local-bin/')).split('/var/lib/').join(P('var-lib/')).split('/run/sshd').join(P('run-sshd'))
      .split('/etc/').join(P('etc/'));
    const bin = P('bin'); const log = P('log');
    for (const d of ['bin', 'usr-local-bin', 'var-lib/hearth-backup/backups', 'etc/systemd/system', 'etc/ssh', 'etc/hearth-region']) fs.mkdirSync(P(d), { recursive: true });
    const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    stub('systemctl', `case "$1" in is-enabled|is-active) [ "$3" = coturn ] && [ -f "${t}/coturn-on" ]; exit $? ;; disable) [ "$3" = coturn ] && rm -f "${t}/coturn-on" ;; esac; exit 0`);
    // sshd -t [-f file]: fails on a "Broken" line, and on a "NeedsBlock" line in settings without Hearth's block.
    stub('sshd', `f="${P('etc/ssh/sshd_config')}"; [ "$2" = -f ] && f="$3"; grep -q '^Broken' "$f" && exit 1; grep -q '^NeedsBlock' "$f" && ! grep -q '^# BEGIN hearth-backup' "$f" && exit 1; exit 0`);
    stub('ufw', `case "$1" in status) echo "Status: active"; cat "${t}/ufw-rules" 2>/dev/null ;; delete) grep -v "^$3 " "${t}/ufw-rules" > "${t}/ufw-new"; mv "${t}/ufw-new" "${t}/ufw-rules" ;; esac; exit 0`);
    stub('id', `[ "$1" = -u ] && { echo 0; exit 0; }; [ "$1" = hearth-backup ] && [ -f "${t}/user" ]`);
    stub('pkill', 'exit 1');
    stub('userdel', `rm -f "${t}/user"`);
    stub('getent', 'exit 0');
    stub('chgrp', 'exit 0');
    stub('dpkg-query', `[ -f "${t}/coturn-installed" ] && printf 'install ok installed'; exit 0`);
    stub('apt-get', `[ -f "${t}/apt-busy" ] && exit 100; rm -f "${t}/coturn-installed"`);
    const put = (p, s, ago = 0) => { fs.mkdirSync(path.dirname(P(p)), { recursive: true }); fs.writeFileSync(P(p), s); if (ago) fs.utimesSync(P(p), new Date(Date.now() - ago), new Date(Date.now() - ago)); };
    const hearthConf = '# TURN relay for Hearth calls (written by scripts/setup-turn.sh)\nstatic-auth-secret=relaysecret\n';
    const block = '# BEGIN hearth-backup (added by Hearth)\nMatch User hearth-backup\n  ForceCommand internal-sftp -d /backups\n# END hearth-backup\n';
    const installed = ({ byHearth, theirs, sshd = 'Port 22\n', before = 'Port 22\n' }) => {
      for (const f of ['etc/systemd/system/hearth-region.timer', 'etc/systemd/system/hearth-region.service', 'usr-local-bin/hearth-region-agent', 'etc/ssh/hearth-backup.keys',
        'var-lib/hearth-backup/backups/hearth-1.hbk', 'etc/hearth-region/env', 'user', 'coturn-on', 'coturn-installed']) put(f, 'x');
      put('etc/ssh/sshd_config', sshd + block);
      put('etc/ssh/sshd_config.hearth-bak', before);
      // 3478/tcp was open before Hearth (another relay here): the install noted only the two it opened.
      put('ufw-rules', '22/tcp                     ALLOW       Anywhere\n3478/udp                   ALLOW       Anywhere\n3478/tcp                   ALLOW       Anywhere\n49160:49400/udp            ALLOW       Anywhere\n3478/udp (v6)              ALLOW       Anywhere (v6)\n');
      put('etc/hearth-region/ufw-opened', '3478/udp\n49160:49400/udp\n');
      put('etc/turnserver.conf', hearthConf);
      if (theirs) { put('etc/turnserver.conf.bak-1000', '# their own coturn settings\n', 7200000); fs.chmodSync(P('etc/turnserver.conf.bak-1000'), 0o600); }
      put('etc/turnserver.conf.bak-2000', hearthConf, 3600000); // a reinstall kept a copy of Hearth's own
      if (byHearth) put('etc/hearth-region/coturn-by-hearth', '');
      put('usr-local-bin/hearth-relay-uninstall', text);
    };
    const run = (status = 0) => {
      fs.writeFileSync(log, '');
      const r = spawnSync('bash', ['--noprofile', '--norc', P('usr-local-bin/hearth-relay-uninstall')], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(r.status, status, r.stdout + r.stderr);
      return { out: r.stdout, log: fs.readFileSync(log, 'utf8') };
    };
    const exists = (p) => fs.existsSync(P(p));
    const read = (p) => fs.readFileSync(P(p), 'utf8');

    installed({ byHearth: true, theirs: true });
    const first = run();
    for (const p of ['etc/systemd/system/hearth-region.timer', 'etc/systemd/system/hearth-region.service', 'usr-local-bin/hearth-region-agent', 'etc/ssh/hearth-backup.keys',
      'var-lib/hearth-backup', 'etc/hearth-region', 'user', 'etc/ssh/sshd_config.hearth-bak', 'etc/turnserver.conf.bak-2000', 'usr-local-bin/hearth-relay-uninstall', 'coturn-installed']) assert.ok(!exists(p), `${p} is gone`);
    assert.equal(read('etc/ssh/sshd_config'), 'Port 22\n', 'only the hearth-backup block left the SSH settings');
    assert.equal(read('etc/turnserver.conf'), '# their own coturn settings\n', 'the settings from before Hearth are back');
    assert.equal(fs.statSync(P('etc/turnserver.conf')).mode & 0o777, 0o640, 'readable by coturn\'s group again (the copy was kept private)');
    assert.match(first.log, /^chgrp turnserver .*etc\/turnserver\.conf$/m);
    assert.ok(!exists('etc/turnserver.conf.bak-1000'));
    assert.match(first.log, /^systemctl disable --now hearth-region\.timer$/m);
    assert.match(first.log, /^systemctl disable --now coturn$/m);
    assert.match(first.log, /^systemctl reload ssh$/m);
    for (const rule of ['3478/udp', '49160:49400/udp']) assert.match(first.log, new RegExp(`^ufw delete allow ${rule}$`, 'm'));
    assert.doesNotMatch(first.log, /^ufw delete allow 3478\/tcp$/m, 'the opening that was there before Hearth stays');
    assert.equal(read('ufw-rules'), '22/tcp                     ALLOW       Anywhere\n3478/tcp                   ALLOW       Anywhere\n', 'the other firewall rules stay (one delete takes the IPv4 and IPv6 rule)');
    assert.match(first.log, /^userdel hearth-backup$/m);
    assert.match(first.log, /^apt-get remove -y -qq -o DPkg::Lock::Timeout=120 coturn$/m, 'coturn goes: this install had added it');
    assert.ok((first.out.match(/removed: /g) || []).length >= 10, first.out);
    assert.match(first.out, /✓ Done\./);
    // Twice: nothing left to do, nothing fails.
    put('usr-local-bin/hearth-relay-uninstall', text);
    const again = run();
    assert.doesNotMatch(again.out, /removed: /, again.out);
    assert.doesNotMatch(again.log, /^(apt-get|userdel|systemctl reload|ufw delete)/m);

    // coturn was there before Hearth, and the SSH settings have trouble of their own (they fail their check with
    // Hearth's block too): coturn stays installed (switched off, and it says how to start it), the block goes, the
    // member's own settings stay as they are, edits since the install included, and SSH isn't reloaded.
    installed({ byHearth: false, theirs: true, sshd: 'Port 22\nPasswordAuthentication no\nBroken\n' });
    const second = run();
    assert.equal(read('etc/ssh/sshd_config'), 'Port 22\nPasswordAuthentication no\nBroken\n', 'not the copy from before Hearth');
    assert.doesNotMatch(second.log, /^systemctl reload/m, 'never reloaded with settings that fail the check');
    assert.match(second.out, /don't pass their check \(sudo sshd -t\) with it or without it, so SSH wasn't reloaded/);
    assert.doesNotMatch(second.log, /^apt-get/m);
    assert.ok(exists('coturn-installed'));
    assert.match(second.log, /^systemctl disable --now coturn$/m);
    assert.match(second.out, /coturn was here before Hearth, so it stays installed with your own settings back, switched off\. To start it again: sudo systemctl enable --now coturn/);

    // Settings that pass only with Hearth's block (removing it is what breaks them): back to the copy from before Hearth.
    installed({ byHearth: false, theirs: false, sshd: 'Port 22\nNeedsBlock\n' });
    const third = run();
    assert.equal(read('etc/ssh/sshd_config'), 'Port 22\n');
    assert.match(third.log, /^systemctl reload ssh$/m);
    assert.match(third.out, /back as they were before Hearth/);
    assert.ok(!exists('etc/turnserver.conf') && !exists('etc/turnserver.conf.bak-2000'), 'Hearth\'s relay settings, with the secret, are gone');

    // coturn can't be uninstalled (another install holds the package lock): it says so and fails, and keeps the note
    // and itself, so a second run finishes the job. The check-in token goes either way.
    installed({ byHearth: true, theirs: false });
    put('apt-busy', '');
    const stuck = run(1);
    assert.match(stuck.out, /✗ Not quite done: coturn couldn't be uninstalled/);
    assert.doesNotMatch(stuck.out, /✓ Done/);
    assert.ok(exists('etc/hearth-region/coturn-by-hearth') && exists('usr-local-bin/hearth-relay-uninstall') && exists('coturn-installed'));
    assert.ok(!exists('etc/hearth-region/env'), 'the check-in token is gone');
    fs.rmSync(P('apt-busy'));
    const finish = run();
    assert.match(finish.out, /removed: coturn \(this install had added it\)/);
    assert.ok(!exists('coturn-installed') && !exists('etc/hearth-region') && !exists('usr-local-bin/hearth-relay-uninstall'));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ the agent on the relay
test('the agent: its token never on a command line, the backup key goes with an answer without it, coturn follows a new address, and only "gone" for a day switches a member relay off', { skip: !['bash', 'awk', 'sed'].every(has) && 'needs bash, awk and sed' }, async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const s = await script(o.id, o.link);
  const agentSrc = /cat > \/usr\/local\/bin\/hearth-region-agent <<'AGENT_EOF'\n([\s\S]*?)\nAGENT_EOF\n/.exec(s)[1];
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-agent-'));
  try {
    const etc = path.join(t, 'etc'); const keys = path.join(t, 'keys'); const bdir = path.join(t, 'backups'); const bin = path.join(t, 'bin'); const conf = path.join(t, 'turnserver.conf');
    for (const d of [etc, bdir, bin]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(t, 'hostkey.pub'), `${HOST_KEY} root@relay\n`);
    // The same agent, pointed at a folder of its own.
    const agent = path.join(t, 'agent');
    fs.writeFileSync(agent, agentSrc.split('/etc/hearth-region').join(etc).split('/etc/ssh/hearth-backup.keys').join(keys).split('/etc/turnserver.conf').join(conf)
      .split('/var/lib/hearth-backup/backups').join(bdir).split('/etc/ssh/ssh_host_ed25519_key.pub').join(path.join(t, 'hostkey.pub')));
    const env = (kind) => fs.writeFileSync(path.join(etc, 'env'), `MAIN=${ORIGIN}\nREGION=${o.id}\nTOKEN=${o.token}\nPIN=\nKIND=${kind}\n`);
    env('member');
    fs.writeFileSync(path.join(etc, 'ip'), '203.0.113.7\n');
    fs.writeFileSync(path.join(etc, 'backup-ready'), '');
    // coturn's settings as setup-turn.sh --member wrote them, at the address the machine had then.
    fs.writeFileSync(conf, '# TURN relay for Hearth calls (written by scripts/setup-turn.sh)\nlistening-port=3478\nexternal-ip=198.51.100.9/192.168.1.5\nrelay-ip=192.168.1.5\ndenied-peer-ip=198.51.100.9\ndenied-peer-ip=10.0.0.0-10.255.255.255\n');
    const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    // curl answers with the status code and body the test chose, and writes down its arguments and what it read on
    // standard input; systemctl and logger write down what they were asked.
    stub('curl', `printf '%s\\n' "$@" > "${t}/curl-args"; cat > "${t}/curl-stdin"; o=""; for a in "$@"; do [ "$prev" = -o ] && o="$a"; prev="$a"; done; [ -n "$o" ] && cat "${t}/body" > "$o"; cat "${t}/code"`);
    stub('systemctl', `echo "$*" >> "${t}/systemctl.log"; exit 0`);
    stub('logger', `echo "$*" >> "${t}/logger.log"`);
    stub('sshd', 'echo "port 22"');
    stub('ip', 'exit 0');
    const run = (code, body) => {
      fs.writeFileSync(path.join(t, 'code'), code);
      fs.writeFileSync(path.join(t, 'body'), body);
      const r = spawnSync('bash', ['--noprofile', '--norc', agent], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    };
    const keysNow = () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '');
    const log = (f) => (fs.existsSync(path.join(t, f)) ? fs.readFileSync(path.join(t, f), 'utf8') : '');
    const backupKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyOfTheMainServerForUploadsOnly0123456789ab';
    run('200', JSON.stringify({ ok: true, name: 'Pi', status: 'approved', backupKey, keep: 3 }));
    assert.equal(keysNow(), `restrict ${backupKey} hearth-main\n`, 'the main server\'s key may upload');
    // The check-in token goes to curl on standard input, never as an argument (ps shows those to every account).
    assert.ok(!log('curl-args').includes(o.token), 'not on curl\'s command line');
    assert.equal(log('curl-stdin'), `header = "X-Region-Token: ${o.token}"\n`);
    assert.match(log('curl-args'), /^-K\n-\n/);
    // The machine's address changed since coturn was set up: coturn hands out the new one (and keeps refusing to relay
    // to it), and the check-in says which address it hands out.
    assert.equal(fs.readFileSync(conf, 'utf8'), '# TURN relay for Hearth calls (written by scripts/setup-turn.sh)\nlistening-port=3478\nexternal-ip=203.0.113.7/192.168.1.5\nrelay-ip=192.168.1.5\ndenied-peer-ip=203.0.113.7\ndenied-peer-ip=10.0.0.0-10.255.255.255\n');
    assert.match(log('systemctl.log'), /^restart coturn$/m);
    assert.match(log('logger.log'), /address changed from 198\.51\.100\.9 to 203\.0\.113\.7/);
    const sent = JSON.parse(log('curl-args').split('\n')[log('curl-args').split('\n').indexOf('-d') + 1]);
    assert.equal(sent.ip, '203.0.113.7');
    assert.equal(sent.relayIp, '203.0.113.7');
    assert.equal(sent.version, 4);
    fs.writeFileSync(path.join(t, 'systemctl.log'), '');
    run('200', JSON.stringify({ ok: true, name: 'Pi', status: 'paused' }));
    assert.equal(keysNow(), '', 'an answer without the key takes it away (paused, backups off)');
    assert.doesNotMatch(log('systemctl.log'), /restart/, 'coturn is left alone while the address is the same');
    run('200', JSON.stringify({ ok: true, name: 'Pi', status: 'approved', backupKey, keep: 3 }));
    run('000', '');
    assert.equal(keysNow(), `restrict ${backupKey} hearth-main\n`, 'no answer at all (the network) changes nothing');
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')));
    // Turned away for its address: it's looked up again next time.
    run('400', JSON.stringify({ error: 'This relay checks in from 198.51.100.4 but says its address is 203.0.113.7.' }));
    assert.ok(!fs.existsSync(path.join(etc, 'ip')));
    fs.writeFileSync(path.join(etc, 'ip'), '203.0.113.7\n');
    // A server that doesn't know this relay at all (rebuilt with an empty database): the key goes, nothing is counted.
    run('403', JSON.stringify({ error: 'Unknown region or token.' }));
    assert.equal(keysNow(), '', 'refused: the key goes');
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')), 'not counted towards switching off');
    assert.equal(fs.readFileSync(path.join(etc, 'last-error'), 'utf8'), JSON.stringify({ error: 'Unknown region or token.' }), 'the installer can say why');
    // Gone (removed in Hearth, or replaced by a new install command): counted.
    const gone = JSON.stringify({ error: 'This relay was removed in Hearth.', code: 'relay_gone' });
    run('403', gone);
    assert.match(fs.readFileSync(path.join(etc, 'refused-since'), 'utf8'), /^\d+\n$/);
    run('403', gone);
    assert.doesNotMatch(log('systemctl.log'), /disable/, 'not after a few minutes of it');
    // A day of plain refusals after it: still nothing (and the count starts over).
    fs.writeFileSync(path.join(etc, 'refused-since'), `${Math.floor(Date.now() / 1000) - 86401}\n`);
    run('403', JSON.stringify({ error: 'Unknown region or token.' }));
    assert.doesNotMatch(log('systemctl.log'), /disable/);
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')));
    // A whole day of "gone": a member relay switches itself off, and says why.
    fs.writeFileSync(path.join(etc, 'refused-since'), `${Math.floor(Date.now() / 1000) - 86401}\n`);
    run('403', gone);
    assert.match(log('systemctl.log'), /^disable --now coturn$/m);
    assert.match(log('systemctl.log'), /^disable --now hearth-region\.timer$/m);
    assert.match(log('logger.log'), /hearth-relay .*refused this relay's check-ins for 24 hours/);
    // An owner's region never does, and leaves coturn's settings alone.
    fs.writeFileSync(path.join(t, 'systemctl.log'), '');
    env('region');
    fs.writeFileSync(path.join(etc, 'ip'), '198.51.100.77\n');
    run('403', gone);
    assert.doesNotMatch(log('systemctl.log'), /disable|restart/);
    assert.match(fs.readFileSync(conf, 'utf8'), /^external-ip=203\.0\.113\.7\/192\.168\.1\.5$/m);
    // An accepted check-in clears the count.
    run('200', JSON.stringify({ ok: true, name: 'Pi' }));
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')));
    assert.ok(!fs.existsSync(path.join(etc, 'last-error')));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ pending → approved
test('a pending relay checks in, but nothing uses it and it gets no backup key until the owner approves it with the password', async () => {
  fresh();
  const bob = await srv.register(); const viewer = await srv.register();
  const o = await offer(bob, { name: 'Bob’s VPS', backups: true });
  // An older agent (version 2) checks in fine too.
  const hb = await beat(o.id, o.token, { version: 2, ssh: { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } });
  assert.equal(hb.status, 200, hb.text);
  assert.equal(hb.json.ok, true);
  assert.equal(hb.json.status, 'pending');
  assert.equal(hb.json.backupKey, undefined, 'no backup key while pending');
  assert.deepEqual(community(await ice(viewer)), [], 'not in anyone\'s calls');
  // The owner sees it (and its address and load) before approving; the owner's own list leaves it out.
  const a = await admin();
  assert.ok(!a.regions.some((r) => r.id === o.id), 'member relays aren\'t among the owner\'s regions');
  assert.equal(a.memberRelays, 'on');
  const m = a.members.find((r) => r.id === o.id);
  assert.equal(m.status, 'pending');
  assert.deepEqual(m.owner, { id: bob.id, username: bob.username });
  assert.equal(m.ip, o.ip);
  assert.equal(m.alive, true);
  assert.equal(m.load, 0.25);
  assert.equal(m.capMbit, 25);
  assert.equal(m.offersBackups, true);
  assert.equal(m.backups, false);
  assert.equal(m.approvedAt, null);
  const mine = (await as(bob, 'GET', '/me/relays')).json.relays[0];
  assert.equal(mine.alive, true);
  assert.equal(mine.waitingForInstall, false);
  assert.equal(mine.status, 'pending');
  assert.ok(!('ip' in mine) && !JSON.stringify(mine).includes(o.ip));
  // Approving needs an instance admin, a member row, and the password.
  assert.equal((await as(bob, 'POST', `/admin/regions/${o.id}/approve`, { authKey: bob.authKey })).status, 403);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/approve`, {})).status, 401, 'no password');
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/approve`, { authKey: hex(32) })).status, 401, 'wrong password');
  assert.deepEqual(community(await ice(viewer)), []);
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Paris', origin: ORIGIN, authKey: srv.owner.authKey });
  assert.equal((await approve(reg.json.region.id)).status, 404, 'the owner\'s regions aren\'t member relays');
  assert.equal((await approve(o.id, { backups: true })).status, 200);
  const after = (await admin()).members.find((r) => r.id === o.id);
  assert.equal(after.status, 'approved');
  assert.equal(after.backups, true);
  assert.ok(after.approvedAt > 0);
  assert.equal(srv.sql('SELECT approved_by FROM regions WHERE id = ?', o.id)[0].approved_by, srv.owner.id);
  const hb2 = await beat(o.id, o.token, { ssh: { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } });
  assert.equal(hb2.json.status, 'approved');
  if (hb2.json.backupKey) { assert.match(hb2.json.backupKey, /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}$/); assert.equal(hb2.json.keep, 3, 'a member relay keeps 3'); }
  assert.ok(actions().includes('member_relay_approved'));
});

test('in calls: the relay\'s own logins, a pseudonym per relay, at most 8 relays each', async () => {
  fresh();
  const [m1, m2] = [await srv.register(), await srv.register()];
  const viewer = await srv.register(); const other = await srv.register();
  const r1 = await liveRelay(m1); const r2 = await liveRelay(m2);
  const list = await ice(viewer);
  const main = list.find((e) => e.regionId === 'main');
  assert.ok(main, 'the owner\'s relay is still there');
  const ours = community(list);
  assert.equal(ours.length, 2);
  const e1 = ours.find((e) => e.regionId === r1.id); const e2 = ours.find((e) => e.regionId === r2.id);
  assert.deepEqual(Object.keys(e1).sort(), ['community', 'credential', 'expiresAt', 'region', 'regionId', 'urls', 'username']);
  assert.deepEqual(e1.urls, urlsAt(r1.ip));
  // The name its member gave it stays with the owner and that member: next to its address it could say whose home it is.
  assert.equal(e1.region, 'Member relay');
  assert.ok(!JSON.stringify(list).includes(r1.relay.name));
  const [exp, who] = e1.username.split(':');
  assert.equal(e1.expiresAt, +exp * 1000);
  assert.equal(exp, main.username.split(':')[0], 'the same expiry as the owner\'s relays');
  assert.match(who, /^[A-Za-z0-9_-]{22}$/, 'a 22-character pseudonym');
  assert.notEqual(who, viewer.id);
  assert.ok(!e1.username.includes(viewer.id));
  const userHash = main.username.split(':')[1];
  assert.ok(!who.includes(userHash) && who !== userHash, 'not the access log\'s pseudonym either');
  assert.notEqual(e2.username.split(':')[1], who, 'a different pseudonym on every member relay');
  assert.equal(e1.credential, crypto.createHmac('sha1', r1.secret).update(e1.username).digest('base64'), 'checks with the relay\'s own secret');
  assert.equal(e2.credential, crypto.createHmac('sha1', r2.secret).update(e2.username).digest('base64'));
  assert.notEqual(e1.credential, crypto.createHmac('sha1', MAIN_SECRET).update(e1.username).digest('base64'), 'not the main secret');
  assert.equal(main.credential, crypto.createHmac('sha1', MAIN_SECRET).update(main.username).digest('base64'), 'the owner\'s relays as before');
  // Steady for the same person, different for another.
  assert.equal(community(await ice(viewer)).find((e) => e.regionId === r1.id).username, e1.username);
  assert.notEqual(community(await ice(other)).find((e) => e.regionId === r1.id).username.split(':')[1], who);
  // Even when this server has no relay of its own.
  srv.sql("DELETE FROM instance_settings WHERE key IN ('turnSecret', 'turnUrls')");
  try {
    const bare = await ice(viewer);
    assert.ok(!bare.some((e) => e.regionId === 'main'));
    assert.equal(community(bare).length, 2);
  } finally {
    srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnSecret', ?)", MAIN_SECRET);
    srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnUrls', 'turn:relay.example.test:3478?transport=udp')");
  }
  // The app's first relay list has them too.
  assert.equal(community((await as(viewer, 'GET', '/bootstrap')).json.iceServers).length, 2);
  // At most 8 each, picked steadily per person.
  for (let i = 0; i < 4; i++) { const m = await srv.register(); await liveRelay(m); await liveRelay(m); }
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE kind = 'member' AND status = 'approved'")[0].n, 10);
  const pick = community(await ice(viewer)).map((e) => e.regionId);
  assert.equal(pick.length, 8);
  assert.deepEqual(community(await ice(viewer)).map((e) => e.regionId), pick, 'the same 8 every time');
  // A relay that hasn't checked in for 3 minutes drops out.
  srv.sql('UPDATE regions SET last_seen = ? WHERE id = ?', Date.now() - 4 * 60000, r1.id);
  assert.ok(!community(await ice(other)).some((e) => e.regionId === r1.id));
});

// ------------------------------------------------------------------ pause, resume, backups
test('pause takes it out of calls and backups at once; resume and backups on need the password', async () => {
  fresh();
  const m = await srv.register(); const viewer = await srv.register();
  const ssh = { port: 22, hostKey: HOST_KEY, ready: true, files: 1, usedMb: 10, freeMb: 50000 };
  const o = await liveRelay(m, { backups: true }, { backups: true });
  const lone = await liveRelay(m, { backups: false }, { backups: true });
  const keyOf = async (r) => (await beat(r.id, r.token, { ssh })).json;
  const inCalls = async (r) => community(await ice(viewer)).some((e) => e.regionId === r.id);
  assert.ok(await inCalls(o));
  const first = await keyOf(o);
  const keys = !!first.backupKey; // (only where ssh-keygen is installed)
  assert.equal((await keyOf(lone)).backupKey, undefined, 'approving with backups can\'t give copies to a relay whose member didn\'t offer them');
  assert.equal((await admin()).members.find((r) => r.id === lone.id).backups, false);
  // Pause: no password (it only takes away).
  assert.equal((await as(m, 'POST', `/admin/regions/${o.id}/pause`, {})).status, 403, 'members can\'t');
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/pause`, {})).status, 200);
  assert.equal(await inCalls(o), false);
  const paused = await keyOf(o);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.backupKey, undefined, 'a paused relay stops taking copies');
  assert.equal((await as(m, 'GET', '/me/relays')).json.relays.find((r) => r.id === o.id).status, 'paused');
  // Resume: the password.
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/resume`, {})).status, 401);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/resume`, { authKey: srv.owner.authKey })).status, 200);
  assert.ok(await inCalls(o));
  assert.equal(!!(await keyOf(o)).backupKey, keys);
  // Backups off: still in calls, no key. On again: the password.
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/backups`, { on: false })).status, 200);
  assert.ok(await inCalls(o));
  assert.equal((await keyOf(o)).backupKey, undefined);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/backups`, { on: true })).status, 401);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/backups`, { on: true, authKey: srv.owner.authKey })).status, 200);
  assert.equal(!!(await keyOf(o)).backupKey, keys);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${lone.id}/backups`, { on: true, authKey: srv.owner.authKey })).status, 400, 'only if offered');
  // A pending relay can't be paused or resumed into use.
  const p = await offer(await srv.register());
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${p.id}/pause`, {})).status, 400);
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${p.id}/resume`, { authKey: srv.owner.authKey })).status, 400);
  // None of it works on the owner's regions.
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Tokyo', origin: ORIGIN, authKey: srv.owner.authKey });
  for (const a of ['pause', 'resume', 'backups']) assert.equal((await as(srv.owner, 'POST', `/admin/regions/${reg.json.region.id}/${a}`, { on: true, authKey: srv.owner.authKey })).status, 404, a);
  const log = actions();
  for (const a of ['member_relay_paused', 'member_relay_resumed', 'member_relay_backups_off', 'member_relay_backups_on']) assert.ok(log.includes(a), a);
});

test('a suspended member\'s relays leave calls and backups, and come back when the suspension ends', async () => {
  fresh();
  const m = await srv.register(); const viewer = await srv.register();
  const o = await liveRelay(m, { backups: true }, { backups: true });
  const ssh = { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 };
  const keys = !!(await beat(o.id, o.token, { ssh })).json.backupKey;
  assert.equal(community(await ice(viewer)).length, 1);
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${m.id}/suspend`, { reason: 'test' })).status, 200);
  assert.deepEqual(community(await ice(viewer)), []);
  assert.equal((await beat(o.id, o.token, { ssh })).json.backupKey, undefined);
  assert.equal((await as(m, 'GET', '/me/relays')).status, 401, 'signed out by the suspension');
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM regions WHERE id = ?', o.id)[0].n, 1, 'nothing is deleted');
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${m.id}/unsuspend`, {})).status, 200);
  assert.equal(community(await ice(viewer)).length, 1);
  assert.equal(!!(await beat(o.id, o.token, { ssh })).json.backupKey, keys);
  // A timed suspension that has run out counts as over.
  srv.sql('UPDATE users SET suspended_at = ?, suspended_until = ? WHERE id = ?', Date.now() - 7200000, Date.now() - 60000, m.id);
  assert.equal(community(await ice(viewer)).length, 1);
  srv.sql('UPDATE users SET suspended_at = ?, suspended_until = ? WHERE id = ?', Date.now(), Date.now() + 3600000, m.id);
  assert.deepEqual(community(await ice(viewer)), []);
});

// ------------------------------------------------------------------ removing
test('a member removes their relay; deleting the account removes theirs', async () => {
  fresh();
  const m = await srv.register(); const viewer = await srv.register();
  const o = await liveRelay(m);
  const del = await as(m, 'DELETE', `/me/relays/${o.id}`);
  assert.equal(del.status, 200, del.text);
  assert.deepEqual(del.json, { ok: true, uninstall: 'sudo hearth-relay-uninstall' });
  assert.deepEqual(community(await ice(viewer)), []);
  const told = await beat(o.id, o.token);
  assert.equal(told.status, 403, 'its machine is refused from then on');
  assert.equal(told.json.code, 'relay_gone', 'and told it\'s gone, so it switches itself off after a day');
  assert.equal((await as(m, 'DELETE', `/me/relays/${o.id}`)).status, 404);
  assert.ok(actions().includes('member_relay_removed'));
  // Account deletion.
  const gone = await srv.register();
  const g1 = await liveRelay(gone); await offer(gone);
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE owner_id = ?", gone.id)[0].n, 2);
  assert.equal((await as(gone, 'DELETE', '/me', { authKey: gone.authKey, confirm: gone.username })).status, 200);
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE owner_id = ?", gone.id)[0].n, 0);
  assert.deepEqual(community(await ice(viewer)), []);
  assert.equal((await beat(g1.id, g1.token)).json.code, 'relay_gone');
  // A relay this server never knew (a rebuilt server, say) is refused, but not told it's gone.
  const unknown = await srv.api('POST', `/regions/${hex(8)}/heartbeat`, { ip: nextIp(), headers: { 'x-region-token': hex(24) }, body: { ip: '203.0.113.99' } });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.json.code, undefined);
  // The owner can remove (and rename) one too, and its member's page hears about it.
  const k = await liveRelay(m);
  assert.equal((await as(srv.owner, 'DELETE', `/admin/regions/${k.id}`)).status, 200);
  assert.deepEqual((await as(m, 'GET', '/me/relays')).json.relays, []);
});

// ------------------------------------------------------------------ limits
test('limits: 2 each, 40 in all, the owner\'s switch, and only ever your own', async () => {
  fresh();
  const m = await srv.register(); const nosy = await srv.register(); const typo = await srv.register();
  for (const [body, why] of [[{ name: '' }, 'a name'], [{ name: '   ' }, 'a name'], [{ capMbit: 30 }, 'a listed limit'], [{ capMbit: '25x' }, 'a number'], [{ capMbit: null }, 'given'],
    [{ origin: 'http://chat.example.test' }, 'https'], [{ origin: '' }, 'an address']]) {
    const r = await as(typo, 'POST', '/me/relays', { name: 'Pi', capMbit: 25, backups: false, origin: ORIGIN, ...body });
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(body)}`);
  }
  assert.deepEqual((await as(typo, 'GET', '/me/relays')).json.relays, []);
  assert.equal((await as(m, 'POST', '/me/relays', { name: 'x'.repeat(80), capMbit: 100, origin: ORIGIN })).json.relay.name.length, 40);
  await offer(m, { capMbit: '10' });
  const third = await as(m, 'POST', '/me/relays', { name: 'Third', capMbit: 25, origin: ORIGIN });
  assert.equal(third.status, 400, 'two each');
  assert.match(third.json.error, /up to 2/);
  // Someone else's relay is "not found", for every member route, and never listed.
  const [mine] = (await as(m, 'GET', '/me/relays')).json.relays;
  assert.equal((await as(nosy, 'POST', `/me/relays/${mine.id}/reinstall`, { origin: ORIGIN })).status, 404);
  assert.equal((await as(nosy, 'DELETE', `/me/relays/${mine.id}`)).status, 404);
  assert.deepEqual((await as(nosy, 'GET', '/me/relays')).json.relays, []);
  assert.equal((await as(nosy, 'GET', '/admin/regions')).status, 403);
  assert.equal(srv.sql('SELECT COUNT(*) AS n FROM regions WHERE id = ?', mine.id)[0].n, 1);
  // An owner's region isn't a member's to touch either.
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Sydney', origin: ORIGIN, authKey: srv.owner.authKey });
  assert.equal((await as(srv.owner, 'DELETE', `/me/relays/${reg.json.region.id}`)).status, 404);
  // Offers that never checked in and whose link ran out don't hold a place: they go when listing.
  srv.sql("UPDATE regions SET setup_until = ? WHERE kind = 'member' AND owner_id = ?", Date.now() - 1000, m.id);
  assert.deepEqual((await as(m, 'GET', '/me/relays')).json.relays, []);
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE kind = 'member'")[0].n, 0);
  const waiting = await offer(m);
  // 40 approved (or paused) member relays in all: no more offers, and no more approvals.
  const ins = 'INSERT INTO regions (id, name, token_hash, last_seen, created_at, kind, owner_id, status) VALUES (?, ?, ?, ?, ?, \'member\', ?, ?)';
  for (let i = 0; i < 40; i++) srv.sql(ins, `fill${i}${hex(3)}`, `Fill ${i}`, 'x'.repeat(64), Date.now() - 86400000, Date.now(), srv.owner.id, i % 2 ? 'approved' : 'paused');
  const full = await as(nosy, 'POST', '/me/relays', { name: 'One more', capMbit: 25, origin: ORIGIN });
  assert.equal(full.status, 400);
  assert.match(full.json.error, /40/);
  const notMore = await approve(waiting.id);
  assert.equal(notMore.status, 400);
  assert.match(notMore.json.error, /40 member relays approved/);
  srv.sql("DELETE FROM regions WHERE id LIKE 'fill%'");
  // Offers waiting for approval are counted apart (they can't take the places of approved ones), 20 at most. One whose
  // machine hasn't checked in for a week goes (and its member is told), so a few accounts offering machines that
  // don't exist can't hold the places for good.
  for (let i = 0; i < 19; i++) srv.sql(ins, `wait${i}${hex(3)}`, `Waiting ${i}`, 'x'.repeat(64), Date.now() - 60000, Date.now(), srv.owner.id, 'pending');
  const queue = await as(nosy, 'POST', '/me/relays', { name: 'One more', capMbit: 25, origin: ORIGIN });
  assert.equal(queue.status, 400);
  assert.match(queue.json.error, /^20 relays are already waiting for the owner’s approval/);
  srv.sql("UPDATE regions SET last_seen = ? WHERE id LIKE 'wait%'", Date.now() - 8 * 86400000);
  const swept = (await as(srv.owner, 'GET', '/me/relays')).json;
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE id LIKE 'wait%'")[0].n, 0, 'a week without a check-in while waiting: gone');
  assert.equal(swept.removed.filter((g) => g.by === 'sweep').length, 19, 'and its member is told');
  assert.ok((await as(m, 'GET', '/me/relays')).json.relays.some((r) => r.id === waiting.id), 'one waiting that never checked in keeps its install link\'s day');
  srv.sql("DELETE FROM member_relays_gone WHERE id LIKE 'wait%'");
  // The owner's switch: off stops new offers (the member's page says so), approved ones stay as they are.
  const keep = await liveRelay(nosy);
  assert.equal((await as(nosy, 'PATCH', '/admin/member-relays', { enabled: false })).status, 403);
  assert.equal((await as(srv.owner, 'PATCH', '/admin/member-relays', { enabled: 'no' })).status, 400);
  const off = await as(srv.owner, 'PATCH', '/admin/member-relays', { enabled: false });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.json.memberRelays, 'off');
  assert.equal((await admin()).memberRelays, 'off');
  const refused = await as(nosy, 'POST', '/me/relays', { name: 'Late', capMbit: 25, origin: ORIGIN });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'The owner has turned off member relays.');
  const page = (await as(nosy, 'GET', '/me/relays')).json;
  assert.equal(page.enabled, false);
  assert.equal(page.relays.find((r) => r.id === keep.id).status, 'approved', 'existing relays are still listed and keep their status');
  assert.ok(community(await ice(m)).some((e) => e.regionId === keep.id));
  assert.equal((await as(srv.owner, 'PATCH', '/admin/member-relays', { enabled: true })).json.memberRelays, 'on');
  assert.equal((await as(nosy, 'GET', '/me/relays')).json.enabled, true);
  const log = actions();
  assert.ok(log.includes('member_relays_off') && log.includes('member_relays_on'));
  // Admin → Regions lists pending ones first.
  const order = (await admin()).members.map((r) => r.status);
  assert.deepEqual(order, [...order].sort((a, b) => (a === 'pending' ? 0 : 1) - (b === 'pending' ? 0 : 1)));
  assert.equal(order[0], 'pending');
});

test('a new install command replaces the old link; the old token stops working', async () => {
  fresh();
  const m = await srv.register();
  const o = await liveRelay(m, { capMbit: 100 });
  const re = await as(m, 'POST', `/me/relays/${o.id}/reinstall`, { origin: ORIGIN });
  assert.equal(re.status, 200, re.text);
  const link = linkIn(re.json.command);
  assert.notEqual(link, o.link);
  assert.equal((await srv.call('GET', `/regions/install/${o.id}?k=${o.link}`, { ip: nextIp() })).status, 403);
  const old = await srv.call('GET', `/regions/install/${o.id}?k=${o.link}`, { ip: nextIp() });
  assert.match(old.text, /Settings → Help host/, 'it says where to make a new one');
  const s = await script(o.id, link);
  const token = tokenIn(s);
  assert.notEqual(token, o.token);
  assert.ok(re.json.command.includes(sha256(s)));
  assert.equal(secretIn(s), o.secret, 'the same relay, so the same secret');
  assert.match(s, /^export TURN_CAPACITY_MBIT=100$/m, 'and the same choices');
  assert.equal((await beat(o.id, o.token)).status, 403);
  assert.equal((await beat(o.id, link)).status, 403, 'the link\'s own token never checks in');
  assert.equal((await beat(o.id, token)).status, 200);
  assert.equal((await srv.call('GET', `/regions/install/${o.id}?k=${link}`, { ip: nextIp() })).status, 403, 'and the link stops working once the machine has checked in');
  assert.equal((await as(m, 'POST', `/me/relays/${o.id}/reinstall`, { origin: 'http://chat.example.test' })).status, 400);
  // The owner can't make one for a member's relay (it would carry that member's relay).
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/reinstall`, { origin: ORIGIN, authKey: srv.owner.authKey })).status, 404);
  assert.ok(actions().includes('member_relay_reinstalled'));
});

// ------------------------------------------------------------------ calls, health, backups, the member's page
test('a call can\'t be pinned to a member relay', async () => {
  fresh();
  const owner = await srv.register(); const m = await srv.register();
  const o = await liveRelay(m);
  const server = (await as(owner, 'POST', '/servers', { name: 'Calls ' + hex(3) })).json;
  const voice = server.channels.find((c) => c.type === 'voice');
  assert.equal((await as(owner, 'POST', '/calls/region', { room: voice.id, region: o.id })).status, 400);
  const dm = (await as(owner, 'POST', '/dms', { userId: m.id })).json;
  assert.equal((await as(m, 'POST', '/calls/region', { room: 'dm:' + dm.id, region: o.id })).status, 400);
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'US East', origin: ORIGIN, authKey: srv.owner.authKey });
  assert.equal((await as(owner, 'POST', '/calls/region', { room: voice.id, region: reg.json.region.id })).status, 200, 'the owner\'s regions still can be');
  assert.equal((await as(owner, 'POST', '/calls/region', { room: voice.id, region: 'main' })).status, 200);
});

test('health counts only the owner\'s regions: a member\'s machine going offline doesn\'t degrade the server', async () => {
  fresh();
  const m = await srv.register();
  const o = await liveRelay(m);
  srv.sql('UPDATE regions SET last_seen = ? WHERE id = ?', Date.now() - 3600000, o.id); // installed, offline for an hour
  const h = (await as(srv.owner, 'GET', '/admin/health')).json;
  assert.equal(h.regions.status, 'ok', JSON.stringify(h.regions));
  assert.equal(h.regions.down, 0);
  assert.ok(!h.regions.regions.some((r) => r.id === o.id));
  // An owner's region offline does, as before.
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Down', origin: ORIGIN, authKey: srv.owner.authKey });
  srv.sql('UPDATE regions SET last_seen = ? WHERE id = ?', Date.now() - 3600000, reg.json.region.id);
  assert.equal((await as(srv.owner, 'GET', '/admin/health')).json.regions.status, 'degraded');
  // The member's page says it's offline since then.
  const mine = (await as(m, 'GET', '/me/relays')).json.relays[0];
  assert.equal(mine.alive, false);
  assert.ok(mine.lastSeen < Date.now() - 3000000);
});

test('backup copies: only to member relays both sides agreed on, listed as "(member)", never onto a nearly full disk', { skip: !['ssh-keygen'].every(has) && 'needs ssh-keygen' }, async () => {
  fresh();
  const m = await srv.register();
  const o = await liveRelay(m, { name: 'Small disk', backups: true }, { backups: true });
  const no = await liveRelay(m, { name: 'No copies', backups: true }, { backups: false });
  const ssh = (freeMb) => ({ port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb });
  assert.ok((await beat(o.id, o.token, { ssh: ssh(100) })).json.backupKey);
  assert.equal((await beat(no.id, no.token, { ssh: ssh(100) })).json.backupKey, undefined, 'the owner said no');
  const info = (await as(srv.owner, 'GET', '/admin/owner')).json;
  assert.deepEqual(info.regionCopies, ['Small disk (member)']);
  // "Back up now": the relay reported 100 MB free, so nothing is sent there, and it says why.
  const b = await as(srv.owner, 'POST', '/admin/backups', {});
  assert.equal(b.status, 200, b.text);
  const row = (await admin()).members.find((r) => r.id === o.id);
  assert.equal(row.backup.last.ok, false);
  assert.match(row.backup.last.error, /^Not enough free space/);
  assert.equal((await admin()).members.find((r) => r.id === no.id).backup.last, null, 'none tried where the owner said no');
  // Paused, it's no longer a place copies go.
  await as(srv.owner, 'POST', `/admin/regions/${o.id}/pause`, {});
  assert.deepEqual((await as(srv.owner, 'GET', '/admin/owner')).json.regionCopies, []);
});

// Copies go one after another, and a big one can take hours: a relay paused (or removed, switched to Backups off, its
// member suspended) while an earlier copy is on its way gets nothing. Here sftp is a stand-in that writes down where it
// was sent and takes its time with the first relay.
test('backup copies: each relay is looked at again just before its turn, so one paused meanwhile gets nothing', { skip: !has('ssh-keygen') && 'needs ssh-keygen' }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-sftp-'));
  const bin = path.join(t, 'bin'); fs.mkdirSync(bin);
  const sent = path.join(t, 'sent');
  fs.writeFileSync(path.join(bin, 'sftp'), `#!/usr/bin/env bash\nfor a in "$@"; do host="$a"; done\necho "\${host#hearth-backup@}" >> "${sent}"\n[ -f "${t}/slow" ] && sleep 2\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'sftp'), 0o755);
  const two = await startServer({ PATH: `${bin}:${process.env.PATH}` });
  try {
    const call = (u, method, p, body) => two.api(method, p, { token: u.token, ip: u.ip, body });
    const live = async (u, ip) => {
      const r = await call(u, 'POST', '/me/relays', { name: `Copies ${hex(2)}`, capMbit: 25, backups: true, origin: ORIGIN });
      assert.equal(r.status, 200, r.text);
      const { id } = r.json.relay;
      const token = tokenIn((await two.call('GET', `/regions/install/${id}?k=${linkIn(r.json.command)}`, { ip: nextIp() })).text);
      const beatIt = () => two.api('POST', `/regions/${id}/heartbeat`, { ip, headers: { 'x-region-token': token }, body: { ip, relay: true, version: 4, ssh: { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } } });
      assert.equal((await beatIt()).status, 200);
      assert.equal((await call(two.owner, 'POST', `/admin/regions/${id}/approve`, { authKey: two.owner.authKey, backups: true })).status, 200);
      assert.ok((await beatIt()).json.backupKey);
      return { id, beatIt };
    };
    const first = await live(await two.register(), '203.0.113.31');
    const second = await live(await two.register(), '203.0.113.32');
    const lines = () => (fs.existsSync(sent) ? fs.readFileSync(sent, 'utf8').trim().split('\n').filter(Boolean) : []);
    // Both get it.
    assert.equal((await call(two.owner, 'POST', '/admin/backups', {})).status, 200);
    assert.deepEqual(lines(), ['203.0.113.31', '203.0.113.32']);
    // The second is paused while the copy to the first is on its way: it gets nothing.
    fs.writeFileSync(sent, '');
    fs.writeFileSync(path.join(t, 'slow'), '');
    const backup = call(two.owner, 'POST', '/admin/backups', {});
    for (let i = 0; i < 100 && !lines().length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(lines(), ['203.0.113.31'], 'the first copy is on its way');
    assert.equal((await call(two.owner, 'POST', `/admin/regions/${second.id}/pause`, {})).status, 200);
    assert.equal((await backup).status, 200);
    assert.deepEqual(lines(), ['203.0.113.31'], 'nothing went to the relay paused meanwhile');
  } finally { await two.stop(); fs.rmSync(t, { recursive: true, force: true }); }
});

test('the member\'s page hears about changes to their own relays only', async () => {
  fresh();
  const m = await srv.register(); const other = await srv.register();
  const o = await offer(m);
  const mine = await srv.socket(m.token); const theirs = await srv.socket(other.token);
  try {
    let heard = 0; let overheard = 0;
    mine.on('relays:mine', () => { heard++; });
    theirs.on('relays:mine', () => { overheard++; });
    const wait = async (f) => { for (let i = 0; i < 50 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); };
    assert.equal((await beat(o.id, o.token)).status, 200); // its first check-in
    await wait(() => heard >= 1);
    assert.equal(heard, 1);
    await approve(o.id);
    await wait(() => heard >= 2);
    await as(srv.owner, 'POST', `/admin/regions/${o.id}/pause`, {});
    await wait(() => heard >= 3);
    assert.equal(heard, 3);
    assert.equal((await beat(o.id, o.token)).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(heard, 3, 'not on every check-in');
    assert.equal(overheard, 0);
  } finally { mine.close(); theirs.close(); }
});

// ------------------------------------------------------------------ the privacy choice
test('privacy: memberRelays is "use" by default and takes only "use" or "avoid"', async () => {
  const u = await srv.register();
  assert.equal((await as(u, 'GET', '/bootstrap')).json.me.privacy.memberRelays, 'use');
  const r = await as(u, 'PATCH', '/me/privacy', { memberRelays: 'avoid' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.memberRelays, 'avoid');
  for (const bad of ['nope', true, 1, null, ['avoid'], { avoid: true }, 'AVOID']) {
    const x = await as(u, 'PATCH', '/me/privacy', { memberRelays: bad });
    assert.equal(x.json.memberRelays, 'avoid', JSON.stringify(bad));
  }
  assert.equal((await as(u, 'GET', '/bootstrap')).json.me.privacy.memberRelays, 'avoid');
  assert.equal((await as(u, 'PATCH', '/me/privacy', { memberRelays: 'use' })).json.memberRelays, 'use');
  // The other choices are untouched by it.
  assert.equal((await as(u, 'PATCH', '/me/privacy', { memberRelays: 'avoid' })).json.outsideImages, 'ask');
});

// Someone who avoids member relays drops the other side's addresses on any of them, and the other person may use any
// approved one (not just the 8 in someone's list). So they're told where every one is, and get a login for none.
const ipsIn = (list) => community(list).map((e) => [].concat(e.urls)[0].replace(/^turn:\[?|\]?:3478\?transport=udp$/g, ''));
test('an avoider gets every member relay that\'s up by address only, and a login for none; back to using them, logins again', async () => {
  fresh();
  srv.sql('DELETE FROM member_relay_hosts');
  const viewer = await srv.register();
  const live = [];
  for (let i = 0; i < 6; i++) { const m = await srv.register(); live.push(await liveRelay(m), await liveRelay(m)); }
  // Not these: one waiting for approval (it checks in), one paused, one that stopped checking in (before anyone was
  // given a login for them).
  const pending = await offer(await srv.register());
  assert.equal((await beat(pending.id, pending.token)).status, 200);
  const paused = live.pop();
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${paused.id}/pause`, {})).status, 200);
  const offline = live.pop();
  srv.sql('UPDATE regions SET last_seen = ? WHERE id = ?', Date.now() - 4 * 60000, offline.id);
  assert.equal(live.length, 10);
  // Using them: 8, with logins.
  assert.equal(community(await ice(viewer)).length, 8);
  assert.equal((await as(viewer, 'PATCH', '/me/privacy', { memberRelays: 'avoid' })).status, 200);
  for (const list of [await ice(viewer), (await as(viewer, 'GET', '/bootstrap')).json.iceServers]) {
    assert.deepEqual(ipsIn(list).sort(), live.map((r) => r.ip).sort(), 'every approved one that is up, more than 8, and no other');
    for (const e of community(list)) {
      assert.deepEqual(Object.keys(e).sort(), ['community', 'region', 'urls'], 'where it is, and no login');
      assert.equal(e.region, 'Member relay');
    }
    const main = list.find((e) => e.regionId === 'main');
    assert.equal(main.credential, crypto.createHmac('sha1', MAIN_SECRET).update(main.username).digest('base64'), 'the owner\'s relays as before');
  }
  // Even when this server has no relay of its own.
  srv.sql("DELETE FROM instance_settings WHERE key IN ('turnSecret', 'turnUrls')");
  try {
    const bare = await ice(viewer);
    assert.equal(community(bare).length, 10);
    assert.ok(bare.every((e) => !('username' in e) && !('credential' in e)));
  } finally {
    srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnSecret', ?)", MAIN_SECRET);
    srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnUrls', 'turn:relay.example.test:3478?transport=udp')");
  }
  // Another person who uses them is unaffected.
  const other = await srv.register();
  assert.ok(community(await ice(other)).every((e) => e.username && e.credential));
  // Back to using them: 8 again, with logins that work.
  assert.equal((await as(viewer, 'PATCH', '/me/privacy', { memberRelays: 'use' })).status, 200);
  const back = community(await ice(viewer));
  assert.equal(back.length, 8);
  for (const e of back) {
    const r = live.find((x) => x.id === e.regionId);
    assert.equal(e.credential, crypto.createHmac('sha1', r.secret).update(e.username).digest('base64'));
  }
});

// The other person may hold a login for a member relay that has since been paused or removed, stopped checking in, or
// whose member was suspended: its machine still takes that login (for up to 18 hours), so the avoider must still know
// to drop the other side's addresses there.
test('an avoider is still told where a relay is that anyone may hold a login for: paused, removed, offline, or its member suspended, until those logins run out', async () => {
  fresh();
  srv.sql('DELETE FROM member_relay_hosts');
  const bob = await srv.register(); const alice = await srv.register();
  assert.equal((await as(alice, 'PATCH', '/me/privacy', { memberRelays: 'avoid' })).status, 200);
  const owners = [await srv.register(), await srv.register(), await srv.register(), await srv.register()];
  const [paused, removed, offline, suspended] = [await liveRelay(owners[0]), await liveRelay(owners[1]), await liveRelay(owners[2]), await liveRelay(owners[3])];
  const four = [paused, removed, offline, suspended];
  // Bob, who uses them, is given logins for all four.
  assert.deepEqual(community(await ice(bob)).map((e) => e.regionId).sort(), four.map((r) => r.id).sort());
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${paused.id}/pause`, {})).status, 200);
  assert.equal((await as(srv.owner, 'DELETE', `/admin/regions/${removed.id}`)).status, 200);
  srv.sql('UPDATE regions SET last_seen = ? WHERE id = ?', Date.now() - 4 * 60000, offline.id);
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${owners[3].id}/suspend`, { reason: 'test' })).status, 200);
  // One approved and then paused before anyone was given a login for it: nobody can use it, so it isn't listed.
  const unused = await liveRelay(await srv.register());
  assert.equal((await as(srv.owner, 'POST', `/admin/regions/${unused.id}/pause`, {})).status, 200);
  assert.deepEqual(community(await ice(bob)), [], 'none of them in new lists');
  assert.deepEqual(ipsIn(await ice(alice)).sort(), four.map((r) => r.ip).sort(), 'but the avoider still drops addresses on all four');
  // Once every login handed out for them has run out, they go.
  srv.sql('UPDATE member_relay_hosts SET until = ?', Date.now() - 1000);
  assert.deepEqual(community(await ice(alice)), []);
  // The suspension lifted: that one is up again, so it's listed again.
  assert.equal((await as(srv.owner, 'POST', `/admin/users/${owners[3].id}/unsuspend`, {})).status, 200);
  assert.equal((await beat(suspended.id, suspended.token)).status, 200);
  assert.deepEqual(ipsIn(await ice(alice)), [suspended.ip]);
});

test('everyone\'s apps are told to fetch their relay list again when a member relay comes into calls or leaves them', async () => {
  fresh();
  const m = await srv.register(); const viewer = await srv.register(); const m2 = await srv.register();
  const sock = await srv.socket(viewer.token);
  let heard = 0;
  sock.on('ice:changed', () => { heard++; });
  const expect = async (n, why) => {
    for (let i = 0; i < 60 && heard < n; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(heard, n, why);
  };
  try {
    const o = await offer(m, { backups: true });
    assert.equal((await beat(o.id, o.token)).status, 200);
    await expect(0, 'a relay waiting for approval changes nobody\'s calls');
    assert.equal((await approve(o.id)).status, 200);
    await expect(1, 'approved');
    assert.equal((await as(srv.owner, 'PATCH', `/admin/regions/${o.id}`, { name: 'Renamed' })).status, 200);
    assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/backups`, { on: false })).status, 200);
    await expect(1, 'not for a new name or backup copies');
    assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/pause`, {})).status, 200);
    await expect(2, 'paused');
    assert.equal((await as(srv.owner, 'POST', `/admin/regions/${o.id}/resume`, { authKey: srv.owner.authKey })).status, 200);
    await expect(3, 'resumed');
    assert.equal((await as(srv.owner, 'POST', `/admin/users/${m.id}/suspend`, { reason: 'test' })).status, 200);
    await expect(4, 'its member suspended');
    assert.equal((await as(srv.owner, 'POST', `/admin/users/${m.id}/unsuspend`, {})).status, 200);
    await expect(5, 'and back');
    assert.equal((await beat(o.id, o.token, { ip: '203.0.113.240' })).status, 200);
    await expect(6, 'a new address');
    assert.equal((await beat(o.id, o.token, { ip: '203.0.113.240' })).status, 200);
    await expect(6, 'not on every check-in');
    assert.equal((await as(srv.owner, 'DELETE', `/admin/regions/${o.id}`)).status, 200);
    await expect(7, 'removed by the owner');
    const waiting = await offer(m2);
    assert.equal((await as(m2, 'DELETE', `/me/relays/${waiting.id}`)).status, 200);
    await expect(7, 'one that was never approved goes quietly');
    const k = await liveRelay(m2);
    await expect(8);
    assert.equal((await as(m2, 'DELETE', `/me/relays/${k.id}`)).status, 200);
    await expect(9, 'removed by its member');
    const gone = await srv.register();
    await liveRelay(gone);
    await expect(10);
    assert.equal((await as(gone, 'DELETE', '/me', { authKey: gone.authKey, confirm: gone.username })).status, 200);
    await expect(11, 'its member\'s account deleted');
  } finally { sock.close(); }
});

test('a member relay\'s address has to be where it checks in from, the one it hands out, and nobody else\'s; a new one is written down', async () => {
  fresh();
  const m = await srv.register(); const other = await srv.register();
  const o = await liveRelay(m, { backups: true }, { backups: true });
  const at = async () => (await admin()).members.find((r) => r.id === o.id);
  const refused = async (extra, status, why) => {
    const r = await beat(o.id, o.token, extra);
    assert.equal(r.status, status, r.text);
    assert.match(r.json.error, why);
  };
  // From somewhere else.
  await refused({ ip: '203.0.113.150', from: '198.51.100.150' }, 400, /checks in from 198\.51\.100\.150 but says its address is 203\.0\.113\.150/);
  // Not compared: an address of another kind (it checked in over IPv6), or one that isn't public (this server's own
  // network).
  assert.equal((await beat(o.id, o.token, { ip: o.ip, from: '2001:db8::5' })).status, 200);
  assert.equal((await beat(o.id, o.token, { ip: o.ip, from: '10.1.2.3' })).status, 200);
  // The address its relay hands out (agent version 4: coturn's external-ip) has to be the same.
  await refused({ ip: o.ip, relayIp: '203.0.113.152' }, 400, /hands out 203\.0\.113\.152 but checks in as/);
  assert.equal((await beat(o.id, o.token, { ip: o.ip, relayIp: o.ip })).status, 200);
  // Nobody else's: this server's own relay, an owner's region, another member's relay.
  srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnUrls', 'turn:198.51.100.250:3478?transport=udp')");
  try { await refused({ ip: '198.51.100.250' }, 409, /this server’s own relay/); } finally {
    srv.sql("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('turnUrls', 'turn:relay.example.test:3478?transport=udp')");
  }
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Paris', origin: ORIGIN, authKey: srv.owner.authKey });
  const regToken = tokenIn(await script(reg.json.region.id, linkIn(reg.json.command)));
  assert.equal((await beat(reg.json.region.id, regToken)).status, 200);
  await refused({ ip: ipOf(reg.json.region.id) }, 409, /one of the owner’s regions/);
  const o2 = await liveRelay(other);
  await refused({ ip: o2.ip }, 409, /another relay already has it/);
  assert.equal((await at()).ip, o.ip, 'none of that changed its address');
  // A new address: taken, written down for the owner (Admin → Regions and the audit log).
  assert.equal((await beat(o.id, o.token, { ip: '203.0.113.151' })).status, 200);
  const moved = await at();
  assert.equal(moved.ip, '203.0.113.151');
  assert.equal(moved.ipChanged.from, o.ip);
  assert.ok(moved.ipChanged.at > Date.now() - 60000);
  const entry = srv.sql("SELECT admin_id, detail FROM admin_log WHERE action = 'member_relay_address_changed' ORDER BY id DESC LIMIT 1")[0];
  assert.equal(entry.detail, `${o.relay.name}: ${o.ip} → 203.0.113.151`);
  assert.equal(entry.admin_id, m.id);
  // Backup copies to a member's relay only over SSH on port 22 or above 1024 (this server connects there).
  const ready = async (port) => { assert.equal((await beat(o.id, o.token, { ip: '203.0.113.151', ssh: { port, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } })).status, 200); return (await at()).backup.ready; };
  assert.equal(await ready(25), false);
  assert.equal(await ready(1024), false);
  assert.equal(await ready(2222), true);
  assert.equal(await ready(22), true);
});

test('a check-in keeps only a host key that is one, and only numbers that are', async () => {
  fresh();
  const o = await offer(await srv.register(), { backups: true });
  const r = await beat(o.id, o.token, { load: 'x', cpus: 1e9, mem: -5, tx: 'NaN', rx: '1e400', uptime: '1e400', version: {},
    ssh: { port: 99999, hostKey: 'ssh-ed25519 ' + 'A'.repeat(1500000), ready: true, files: -3, usedMb: '7', freeMb: '1e400' } });
  assert.equal(r.status, 200, r.text);
  const raw = srv.sql('SELECT stats FROM regions WHERE id = ?', o.id)[0].stats;
  assert.ok(raw.length < 2000, `nothing big is kept (${raw.length} bytes)`);
  const st = JSON.parse(raw);
  assert.equal(st.backup.hostKey, null);
  assert.equal(st.backup.ready, false);
  for (const v of [st.load, st.cpus, st.mem, st.uptime, st.version, st.lastTx, st.lastRx, st.backup.port, st.backup.files, st.backup.usedMb, st.backup.freeMb]) assert.ok(Number.isFinite(v), String(v));
  assert.equal(st.cpus, 4096);
  assert.equal(st.mem, 0);
  assert.equal(st.backup.usedMb, 7);
  // A real one is kept.
  assert.equal((await beat(o.id, o.token, { ssh: { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } })).status, 200);
  assert.equal(JSON.parse(srv.sql('SELECT stats FROM regions WHERE id = ?', o.id)[0].stats).backup.hostKey, HOST_KEY);
});

test('a member whose relay the owner removed is told on Help host until they dismiss it', async () => {
  fresh();
  const m = await srv.register(); const nosy = await srv.register();
  const o = await liveRelay(m);
  const own = await offer(m);
  assert.deepEqual((await as(m, 'GET', '/me/relays')).json.removed, []);
  assert.equal((await as(srv.owner, 'DELETE', `/admin/regions/${o.id}`)).status, 200);
  assert.equal((await as(m, 'DELETE', `/me/relays/${own.id}`)).status, 200);
  const page = (await as(m, 'GET', '/me/relays')).json;
  assert.deepEqual(page.relays, []);
  assert.equal(page.removed.length, 1, 'only the one the owner removed (the member saw their own go)');
  assert.deepEqual({ ...page.removed[0], at: 0 }, { id: o.id, name: o.relay.name, by: 'owner', at: 0 });
  assert.deepEqual((await as(nosy, 'GET', '/me/relays')).json.removed, []);
  assert.equal((await as(nosy, 'DELETE', `/me/relays/${o.id}`)).status, 404, 'only its member can dismiss it');
  assert.deepEqual(await as(m, 'DELETE', `/me/relays/${o.id}`).then((r) => r.json), { ok: true });
  assert.deepEqual((await as(m, 'GET', '/me/relays')).json.removed, []);
  assert.equal((await beat(o.id, o.token)).json.code, 'relay_gone', 'its machine is still told it\'s gone');
});

test('the people in a call are told who avoids member relays, so their apps leave member relays out of that connection', async () => {
  const a = await srv.register(); const b = await srv.register();
  assert.equal((await as(a, 'POST', '/friends', { username: b.username })).status, 200);
  assert.equal((await as(b, 'POST', `/friends/${a.id}/accept`)).status, 200);
  const dm = (await as(a, 'POST', '/dms', { userId: b.id })).json;
  assert.equal((await as(b, 'PATCH', '/me/privacy', { memberRelays: 'avoid' })).status, 200);
  const sa = await srv.socket(a.token); const sb = await srv.socket(b.token);
  const join = (s) => new Promise((resolve) => s.emit('voice:join', { channelId: 'dm:' + dm.id }, resolve));
  try {
    assert.equal((await join(sb)).ok, true);
    const res = await join(sa);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.peers.map((p) => [p.userId, p.avoid]), [[b.id, true]]);
    // Someone who uses them isn't marked.
    const back = await join(sb); // (b joins again: a fresh join, a is in the call)
    assert.deepEqual(back.peers.map((p) => [p.userId, p.avoid]), [[a.id, undefined]]);
  } finally { sa.close(); sb.close(); }
});

// ------------------------------------------------------------------ the upgrade
test('upgrading a version 22 database keeps the owner\'s regions as they were; the doctor counts member relays apart', async () => {
  fresh();
  const CURRENT = Number(/const SCHEMA_VERSION = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8'))[1]);
  assert.ok(CURRENT >= 23);
  const viewer = await srv.register();
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Old region', origin: ORIGIN, authKey: srv.owner.authKey });
  const { id } = reg.json.region;
  const token = tokenIn(await script(id, linkIn(reg.json.command)));
  assert.equal((await beat(id, token)).status, 200);
  // As a version 22 database: none of the new columns, nor the index.
  srv.sql('DROP INDEX idx_regions_owner');
  for (const c of ['kind', 'owner_id', 'status', 'secret', 'offer', 'backups', 'approved_at', 'approved_by', 'install_hash']) srv.sql(`ALTER TABLE regions DROP COLUMN ${c}`);
  srv.sql('DROP TABLE member_relay_hosts');
  srv.sql('DROP TABLE member_relays_gone');
  srv.sql('PRAGMA user_version = 22');
  await srv.restart();
  const d = srv.db();
  try { assert.equal(d.pragma('user_version', { simple: true }), CURRENT); } finally { d.close(); }
  assert.deepEqual({ ...srv.sql('SELECT kind, owner_id, status, secret, offer, backups, approved_at FROM regions WHERE id = ?', id)[0] },
    { kind: 'region', owner_id: null, status: 'approved', secret: null, offer: '{}', backups: 1, approved_at: null }, 'an old row is one of the owner\'s regions');
  assert.match(srv.sql("SELECT sql FROM sqlite_master WHERE name = 'idx_regions_owner'")[0].sql, /ON regions\(owner_id\) WHERE owner_id IS NOT NULL/);
  // It works as before: in the owner's list, in calls with the main secret, its backup key, no status in the answer.
  const hb = await beat(id, token, { ssh: { port: 22, hostKey: HOST_KEY, ready: true, files: 0, usedMb: 0, freeMb: 50000 } });
  assert.equal(hb.status, 200, hb.text);
  assert.equal(hb.json.status, undefined);
  if (has('ssh-keygen')) assert.equal(hb.json.keep, 14);
  const a = await admin();
  assert.deepEqual(a.regions.map((r) => r.id), [id]);
  assert.deepEqual(a.members, []);
  const e = (await ice(viewer)).find((x) => x.regionId === id);
  assert.ok(e && !e.community);
  assert.equal(e.credential, crypto.createHmac('sha1', MAIN_SECRET).update(e.username).digest('base64'));
  // The doctor: the owner's regions one by one, member relays on one line.
  const m = await srv.register();
  const o = await liveRelay(m, { name: 'Doctor check' });
  const r = spawnSync(process.execPath, ['server/cli.js', 'doctor'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: srv.dir, HTTPS: 'false', PUBLIC_URL: ORIGIN } });
  assert.match(r.stdout, /^PASS {2}Region Old region: last heartbeat /m, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS {2}Member relays: 1 approved, 1 up$/m);
  assert.ok(!r.stdout.includes(o.relay.name), 'a member\'s relay isn\'t listed as a region');
});
