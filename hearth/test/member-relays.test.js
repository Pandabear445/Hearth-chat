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
// Each check-in and download from an address of its own (both are rate-limited per address).
let n = 0;
const nextIp = () => { n++; return `198.51.${100 + ((n >> 8) & 3)}.${(n & 255) || 1}`; };
const beat = (id, token, extra = {}) => srv.api('POST', `/regions/${id}/heartbeat`, { ip: nextIp(), headers: { 'x-region-token': token },
  body: { ip: '203.0.113.7', tx: 1000, rx: 2000, load: 0.25, cpus: 2, mem: 30, relay: true, uptime: 600, version: 3, ...extra } });
const script = async (id, token) => (await srv.call('GET', `/regions/install/${id}?k=${token}`, { ip: nextIp() })).text;
// The secret the installer hands setup-turn.sh (in a root-only file).
const secretIn = (s) => /\( umask 077 && printf '%s\\n' '([^'\n]+)' > "\$SETUP_DIR\/turn-secret" \)\n/.exec(s)[1];
async function offer(u, body = {}) {
  const r = await as(u, 'POST', '/me/relays', { name: `Pi ${hex(2)}`, capMbit: 25, backups: false, origin: ORIGIN, ...body });
  assert.equal(r.status, 200, r.text);
  const token = /[?&]k=([0-9a-f]+)/.exec(r.json.command)[1];
  return { id: r.json.relay.id, token, command: r.json.command, relay: r.json.relay };
}
// Offered, checked in and approved (with backup copies if asked for): its own secret comes from its installer.
async function liveRelay(u, body = {}, approveBody = {}) {
  const o = await offer(u, body);
  o.secret = secretIn(await script(o.id, o.token));
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
  assert.deepEqual((await as(maya, 'GET', '/me/relays')).json, { enabled: true, max: 2, relays: [] });
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
  assert.ok(a.command.includes(` -o "$f" '${ORIGIN}/regions/install/${a.id}?k=${a.token}' && `), a.command);
  const s1 = await script(a.id, a.token);
  assert.ok(a.command.includes(`echo '${sha256(s1)}  '"$f" | sha256sum -c - && sudo bash "$f"; rm -f "$f"`), 'the command carries the SHA-256 of what is served');
  assert.equal(await script(a.id, a.token), s1, 'byte for byte the same every time');
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
  assert.match(s1, /^export TURN_CAPACITY_MBIT=50\nbash "\$SETUP_DIR\/setup-turn\.sh" --relay-only --managed --secret-file "\$SETUP_DIR\/turn-secret"\n/m);
  assert.ok(s1.includes('ForceCommand internal-sftp -d /backups'), 'backup space, as offered');
  assert.ok(s1.includes('\\"version\\":3'), 'agent version 3');
  assert.ok(s1.includes("It waits for the owner'\"'\"'s approval: see Hearth → Settings → Help host."));
  assert.ok(s1.includes('At home: forward UDP and TCP 3478 and UDP 49160–49400 to this machine in your router. On a VPS: open them in the provider\'s firewall.'));
  assert.ok(s1.includes("cat > /usr/local/bin/hearth-relay-uninstall <<'UNINSTALL_EOF'"));
  assert.doesNotMatch(s1, /\/tmp\/hearth-/);
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: s1 }).status, 0, 'the script parses');
  // A second one: no limit, no backups, another secret.
  const b = await offer(maya, { capMbit: 0, backups: false });
  const s2 = await script(b.id, b.token);
  assert.match(s2, /^export TURN_CAPACITY_MBIT=0$/m);
  assert.ok(!s2.includes('ForceCommand') && !s2.includes('Making a safe place'), 'no backup space when it wasn\'t offered');
  assert.notEqual(secretIn(s2), own);
  assert.ok(!s2.includes(MAIN_SECRET));
  // Renaming doesn't change what's served (the name isn't in it).
  assert.equal((await as(srv.owner, 'PATCH', `/admin/regions/${a.id}`, { name: 'Chicago' })).status, 200);
  assert.equal(await script(a.id, a.token), s1);
  // The owner's own region: the main secret, no member bits, and now the uninstaller too.
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Frankfurt', origin: ORIGIN, authKey: srv.owner.authKey });
  assert.equal(reg.status, 200, reg.text);
  const rs = await script(reg.json.region.id, /[?&]k=([0-9a-f]+)/.exec(reg.json.command)[1]);
  assert.equal(secretIn(rs), MAIN_SECRET);
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

test('the uninstaller undoes the install, and the installer marks whether it added coturn', async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const s = await script(o.id, o.token);
  const un = /cat > \/usr\/local\/bin\/hearth-relay-uninstall <<'UNINSTALL_EOF'\n([\s\S]*?)\nUNINSTALL_EOF\n/.exec(s)[1];
  if (has('bash')) assert.equal(spawnSync('bash', ['-n'], { input: un }).status, 0, 'it parses');
  for (const must of ['systemctl disable --now hearth-region.timer', 'rm -f /usr/local/bin/hearth-region-agent', "sed -i '/^# BEGIN hearth-backup/,/^# END hearth-backup/d' /etc/ssh/sshd_config",
    'if sshd -t 2>/dev/null; then', 'cp /etc/ssh/sshd_config.hearth-bak /etc/ssh/sshd_config', 'userdel hearth-backup', 'rm -rf /var/lib/hearth-backup',
    'for RULE in 3478/udp 3478/tcp 49160:49400/udp; do', 'ufw delete allow "$RULE"', 'systemctl disable --now coturn', '/etc/turnserver.conf.bak-*',
    'rm -f /etc/turnserver.conf', 'rm -rf /etc/hearth-region', 'removed: %s']) assert.ok(un.includes(must), must);
  // coturn goes only if this install added it: the marker is written before setup-turn.sh installs it.
  assert.match(un, /if \[ -f \/etc\/hearth-region\/coturn-by-hearth \] && .*\n {2}DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq coturn/);
  const mark = s.indexOf('|| touch /etc/hearth-region/coturn-by-hearth');
  assert.ok(mark > 0 && mark < s.indexOf('bash "$SETUP_DIR/setup-turn.sh"'), 'marked before coturn is installed');
  // sshd is only reloaded with settings that pass its check.
  assert.doesNotMatch(un, /else\n\s*systemctl reload ssh/);
});

test('the uninstaller, run on a copy of an installed machine: everything goes, the old relay settings come back, twice is safe', { skip: !['bash', 'sed', 'grep', 'head', 'ls'].every(has) && 'needs bash and the usual tools' }, async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const un = /cat > \/usr\/local\/bin\/hearth-relay-uninstall <<'UNINSTALL_EOF'\n([\s\S]*?)\nUNINSTALL_EOF\n/.exec(await script(o.id, o.token))[1];
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
    stub('sshd', `[ -f "${t}/sshd-ok" ] || exit 1; grep -q '^Broken' "${P('etc/ssh/sshd_config')}" && exit 1; exit 0`);
    stub('ufw', `case "$1" in status) echo "Status: active"; cat "${t}/ufw-rules" 2>/dev/null ;; delete) grep -v "^$3 " "${t}/ufw-rules" > "${t}/ufw-new"; mv "${t}/ufw-new" "${t}/ufw-rules" ;; esac; exit 0`);
    stub('id', `[ "$1" = -u ] && { echo 0; exit 0; }; [ "$1" = hearth-backup ] && [ -f "${t}/user" ]`);
    stub('pkill', 'exit 1');
    stub('userdel', `rm -f "${t}/user"`);
    stub('dpkg-query', `[ -f "${t}/coturn-installed" ] && printf 'install ok installed'; exit 0`);
    stub('apt-get', `rm -f "${t}/coturn-installed"`);
    const put = (p, s, ago = 0) => { fs.mkdirSync(path.dirname(P(p)), { recursive: true }); fs.writeFileSync(P(p), s); if (ago) fs.utimesSync(P(p), new Date(Date.now() - ago), new Date(Date.now() - ago)); };
    const hearthConf = '# TURN relay for Hearth calls (written by scripts/setup-turn.sh)\nstatic-auth-secret=relaysecret\n';
    const installed = ({ byHearth, sshdOk, theirs }) => {
      for (const f of ['etc/systemd/system/hearth-region.timer', 'etc/systemd/system/hearth-region.service', 'usr-local-bin/hearth-region-agent', 'etc/ssh/hearth-backup.keys',
        'var-lib/hearth-backup/backups/hearth-1.hbk', 'etc/hearth-region/env', 'user', 'coturn-on', 'coturn-installed']) put(f, 'x');
      put('etc/ssh/sshd_config', 'Port 22\n# BEGIN hearth-backup (added by Hearth)\nMatch User hearth-backup\n  ForceCommand internal-sftp -d /backups\n# END hearth-backup\n');
      put('etc/ssh/sshd_config.hearth-bak', 'Port 22\n');
      put('ufw-rules', '22/tcp                     ALLOW       Anywhere\n3478/udp                   ALLOW       Anywhere\n3478/tcp                   ALLOW       Anywhere\n49160:49400/udp            ALLOW       Anywhere\n3478/udp (v6)              ALLOW       Anywhere (v6)\n');
      put('etc/turnserver.conf', hearthConf);
      if (theirs) put('etc/turnserver.conf.bak-1000', '# their own coturn settings\n', 7200000);
      put('etc/turnserver.conf.bak-2000', hearthConf, 3600000); // a reinstall kept a copy of Hearth's own
      if (byHearth) put('etc/hearth-region/coturn-by-hearth', '');
      if (sshdOk) put('sshd-ok', '');
      put('usr-local-bin/hearth-relay-uninstall', text);
    };
    const run = () => {
      fs.writeFileSync(log, '');
      const r = spawnSync('bash', ['--noprofile', '--norc', P('usr-local-bin/hearth-relay-uninstall')], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return { out: r.stdout, log: fs.readFileSync(log, 'utf8') };
    };
    const exists = (p) => fs.existsSync(P(p));

    installed({ byHearth: true, sshdOk: true, theirs: true });
    const first = run();
    for (const p of ['etc/systemd/system/hearth-region.timer', 'etc/systemd/system/hearth-region.service', 'usr-local-bin/hearth-region-agent', 'etc/ssh/hearth-backup.keys',
      'var-lib/hearth-backup', 'etc/hearth-region', 'user', 'etc/ssh/sshd_config.hearth-bak', 'etc/turnserver.conf.bak-2000', 'usr-local-bin/hearth-relay-uninstall', 'coturn-installed']) assert.ok(!exists(p), `${p} is gone`);
    assert.equal(fs.readFileSync(P('etc/ssh/sshd_config'), 'utf8'), 'Port 22\n', 'only the hearth-backup block left the SSH settings');
    assert.equal(fs.readFileSync(P('etc/turnserver.conf'), 'utf8'), '# their own coturn settings\n', 'the settings from before Hearth are back');
    assert.ok(!exists('etc/turnserver.conf.bak-1000'));
    assert.match(first.log, /^systemctl disable --now hearth-region\.timer$/m);
    assert.match(first.log, /^systemctl disable --now coturn$/m);
    assert.match(first.log, /^systemctl reload ssh$/m);
    for (const rule of ['3478/udp', '3478/tcp', '49160:49400/udp']) assert.match(first.log, new RegExp(`^ufw delete allow ${rule}$`, 'm'));
    assert.equal(fs.readFileSync(P('ufw-rules'), 'utf8'), '22/tcp                     ALLOW       Anywhere\n', 'the other firewall rules stay (one delete takes the IPv4 and IPv6 rule)');
    assert.match(first.log, /^userdel hearth-backup$/m);
    assert.match(first.log, /^apt-get remove -y -qq coturn$/m, 'coturn goes: this install had added it');
    assert.ok((first.out.match(/removed: /g) || []).length >= 10, first.out);
    // Twice: nothing left to do, nothing fails.
    put('usr-local-bin/hearth-relay-uninstall', text);
    const again = run();
    assert.doesNotMatch(again.out, /removed: /, again.out);
    assert.doesNotMatch(again.log, /^(apt-get|userdel|systemctl reload|ufw delete)/m);

    // coturn was there before Hearth, and the SSH settings fail their check without the block: coturn stays installed
    // (switched off), the SSH settings go back to the copy from before Hearth, and with no older relay settings Hearth's go.
    fs.rmSync(P('sshd-ok'), { force: true });
    installed({ byHearth: false, sshdOk: false, theirs: false });
    const second = run();
    assert.equal(fs.readFileSync(P('etc/ssh/sshd_config'), 'utf8'), 'Port 22\n');
    assert.doesNotMatch(second.log, /^systemctl reload/m, 'never reloaded with settings that fail the check');
    assert.doesNotMatch(second.log, /^apt-get/m);
    assert.ok(exists('coturn-installed'));
    assert.match(second.log, /^systemctl disable --now coturn$/m);
    assert.ok(!exists('etc/turnserver.conf') && !exists('etc/turnserver.conf.bak-2000'), 'Hearth\'s relay settings, with the secret, are gone');
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ the agent on the relay
test('the agent takes the backup key away when an answer has none, and a member relay refused for a day switches itself off', { skip: !['bash', 'awk', 'sed'].every(has) && 'needs bash, awk and sed' }, async () => {
  fresh();
  const u = await srv.register();
  const o = await offer(u, { backups: true });
  const s = await script(o.id, o.token);
  const agentSrc = /cat > \/usr\/local\/bin\/hearth-region-agent <<'AGENT_EOF'\n([\s\S]*?)\nAGENT_EOF\n/.exec(s)[1];
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-agent-'));
  try {
    const etc = path.join(t, 'etc'); const keys = path.join(t, 'keys'); const bdir = path.join(t, 'backups'); const bin = path.join(t, 'bin');
    for (const d of [etc, bdir, bin]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(t, 'hostkey.pub'), `${HOST_KEY} root@relay\n`);
    // The same agent, pointed at a folder of its own.
    const agent = path.join(t, 'agent');
    fs.writeFileSync(agent, agentSrc.split('/etc/hearth-region').join(etc).split('/etc/ssh/hearth-backup.keys').join(keys)
      .split('/var/lib/hearth-backup/backups').join(bdir).split('/etc/ssh/ssh_host_ed25519_key.pub').join(path.join(t, 'hostkey.pub')));
    const env = (kind) => fs.writeFileSync(path.join(etc, 'env'), `MAIN=${ORIGIN}\nREGION=${o.id}\nTOKEN=${o.token}\nPIN=\nKIND=${kind}\n`);
    env('member');
    fs.writeFileSync(path.join(etc, 'ip'), '203.0.113.7\n');
    fs.writeFileSync(path.join(etc, 'backup-ready'), '');
    const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    // curl answers with the status code and body the test chose; systemctl and logger write down what they were asked.
    stub('curl', `o=""; for a in "$@"; do [ "$prev" = -o ] && o="$a"; prev="$a"; done; [ -n "$o" ] && cat "${t}/body" > "$o"; cat "${t}/code"`);
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
    run('200', JSON.stringify({ ok: true, name: 'Pi', status: 'paused' }));
    assert.equal(keysNow(), '', 'an answer without the key takes it away (paused, backups off)');
    run('200', JSON.stringify({ ok: true, name: 'Pi', status: 'approved', backupKey, keep: 3 }));
    run('000', '');
    assert.equal(keysNow(), `restrict ${backupKey} hearth-main\n`, 'no answer at all (the network) changes nothing');
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')));
    run('403', JSON.stringify({ error: 'Unknown region or token.' }));
    assert.equal(keysNow(), '', 'refused: the key goes');
    assert.match(fs.readFileSync(path.join(etc, 'refused-since'), 'utf8'), /^\d+\n$/);
    assert.equal(fs.readFileSync(path.join(etc, 'last-error'), 'utf8'), JSON.stringify({ error: 'Unknown region or token.' }), 'the installer can say why');
    run('403', '{}');
    assert.doesNotMatch(log('systemctl.log'), /disable/, 'not after a few minutes of refusals');
    // A whole day of refusals: a member relay switches itself off, and says why.
    fs.writeFileSync(path.join(etc, 'refused-since'), `${Math.floor(Date.now() / 1000) - 86401}\n`);
    run('403', '{}');
    assert.match(log('systemctl.log'), /^disable --now coturn$/m);
    assert.match(log('systemctl.log'), /^disable --now hearth-region\.timer$/m);
    assert.match(log('logger.log'), /hearth-relay .*refused this relay's check-ins for 24 hours/);
    // An owner's region never does.
    fs.writeFileSync(path.join(t, 'systemctl.log'), '');
    env('region');
    run('403', '{}');
    assert.doesNotMatch(log('systemctl.log'), /disable/);
    // An accepted check-in clears the count.
    run('200', JSON.stringify({ ok: true, name: 'Pi' }));
    assert.ok(!fs.existsSync(path.join(etc, 'refused-since')));
    assert.ok(!fs.existsSync(path.join(etc, 'last-error')));
    assert.ok(agentSrc.includes('\\"version\\":3'), 'it says it\'s version 3');
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
  assert.equal(m.ip, '203.0.113.7');
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
  assert.ok(!('ip' in mine) && !JSON.stringify(mine).includes('203.0.113.7'));
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
  assert.deepEqual(e1.urls, ['turn:203.0.113.7:3478?transport=udp', 'turn:203.0.113.7:3478?transport=tcp']);
  assert.equal(e1.region, r1.relay.name);
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
  assert.equal((await beat(o.id, o.token)).status, 403, 'its machine is refused from then on');
  assert.equal((await as(m, 'DELETE', `/me/relays/${o.id}`)).status, 404);
  assert.ok(actions().includes('member_relay_removed'));
  // Account deletion.
  const gone = await srv.register();
  const g1 = await liveRelay(gone); await offer(gone);
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE owner_id = ?", gone.id)[0].n, 2);
  assert.equal((await as(gone, 'DELETE', '/me', { authKey: gone.authKey, confirm: gone.username })).status, 200);
  assert.equal(srv.sql("SELECT COUNT(*) AS n FROM regions WHERE owner_id = ?", gone.id)[0].n, 0);
  assert.deepEqual(community(await ice(viewer)), []);
  assert.equal((await beat(g1.id, g1.token)).status, 403);
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
  await offer(m);
  // 40 member relays in all.
  const ins = 'INSERT INTO regions (id, name, token_hash, last_seen, created_at, kind, owner_id, status) VALUES (?, ?, ?, ?, ?, \'member\', ?, \'pending\')';
  for (let i = 0; i < 39; i++) srv.sql(ins, `fill${i}${hex(3)}`, `Fill ${i}`, 'x'.repeat(64), Date.now() - 86400000, Date.now(), srv.owner.id);
  const full = await as(nosy, 'POST', '/me/relays', { name: 'One more', capMbit: 25, origin: ORIGIN });
  assert.equal(full.status, 400);
  assert.match(full.json.error, /40/);
  srv.sql("DELETE FROM regions WHERE id LIKE 'fill%'");
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
  const token = /[?&]k=([0-9a-f]+)/.exec(re.json.command)[1];
  assert.notEqual(token, o.token);
  assert.equal((await srv.call('GET', `/regions/install/${o.id}?k=${o.token}`, { ip: nextIp() })).status, 403);
  const old = await srv.call('GET', `/regions/install/${o.id}?k=${o.token}`, { ip: nextIp() });
  assert.match(old.text, /Settings → Help host/, 'it says where to make a new one');
  const s = await script(o.id, token);
  assert.ok(re.json.command.includes(sha256(s)));
  assert.equal(secretIn(s), o.secret, 'the same relay, so the same secret');
  assert.match(s, /^export TURN_CAPACITY_MBIT=100$/m, 'and the same choices');
  assert.equal((await beat(o.id, o.token)).status, 403);
  assert.equal((await beat(o.id, token)).status, 200);
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

// ------------------------------------------------------------------ the upgrade
test('upgrading a version 22 database keeps the owner\'s regions as they were; the doctor counts member relays apart', async () => {
  fresh();
  const CURRENT = Number(/const SCHEMA_VERSION = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8'))[1]);
  assert.ok(CURRENT >= 23);
  const viewer = await srv.register();
  const reg = await as(srv.owner, 'POST', '/admin/regions', { name: 'Old region', origin: ORIGIN, authKey: srv.owner.authKey });
  const { id } = reg.json.region;
  const token = /[?&]k=([0-9a-f]+)/.exec(reg.json.command)[1];
  assert.equal((await beat(id, token)).status, 200);
  // As a version 22 database: none of the new columns, nor the index.
  srv.sql('DROP INDEX idx_regions_owner');
  for (const c of ['kind', 'owner_id', 'status', 'secret', 'offer', 'backups', 'approved_at', 'approved_by']) srv.sql(`ALTER TABLE regions DROP COLUMN ${c}`);
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
