// The iPhone app's shell and how it's built: the Swift rules that must say exactly what the Android app's Java says
// (payment pages, the in-app links a notification may open), the workflow's iPhone jobs (pinned actions, signing and
// uploading only in the production environment, no .ipa ever released or copied to a server), and the packaging
// (scripts/patch-ios.rb, the extensions' Info.plist files and entitlements, the ring sound, the pinned Ruby gems).
//
// Static: no server, no Xcode. Swift itself is compiled and tested on GitHub's macOS runners (the ios job runs
// `swift test` and the simulator build); here only its constants are read. The patch script's syntax is checked when
// Ruby is installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const MOBILE = path.join(ROOT, 'mobile');
const KIT = ['mobile', 'ios-native', 'HearthKit', 'Sources', 'HearthKit'];
const WORKFLOW = path.join(ROOT, '..', '.github', 'workflows', 'hearth-apps.yml');
const noWorkflow = !fs.existsSync(WORKFLOW) && 'no apps workflow in this checkout';

// A Java or Swift string literal's value (both use \\ and \" here).
const unquote = (s) => s.replace(/\\(["\\])/g, '$1');
const strings = (src) => [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unquote(m[1]));

// The jobs of a workflow by name, each as its text (from its name line to the next job's).
function jobsOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = {}; let cur = null;
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) { cur = m[1]; jobs[cur] = []; } else if (cur) jobs[cur].push(l);
  }
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join('\n')]));
}
const stepsOf = (job) => job.split(/\n(?= {6}- )/).filter((s) => /^ {6}- /.test(s));
// A job's header: what comes before its steps (needs, if, runs-on, environment, env).
const headOf = (job) => job.slice(0, job.indexOf('\n    steps:'));
const RELEASE_ONLY = /startsWith\(github\.ref, 'refs\/tags\/app-v'\) \|\| github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/;

// ================================================================== 1. the same rules as the Android app
test('ios-shell-1: the iPhone app blocks exactly the payment hosts the Android app blocks', () => {
  const java = read('mobile', 'native', 'BridgePolicy.java');
  const swift = read(...KIT, 'BridgePolicy.swift');
  const javaHosts = strings(/PAYMENT_HOSTS = \{([^}]*)\}/.exec(java)[1]);
  const swiftHosts = strings(/public static let paymentHosts = \[([^\]]*)\]/.exec(swift)[1]);
  assert.ok(javaHosts.length >= 4, 'the Java list');
  assert.deepEqual(swiftHosts, javaHosts);
  for (const h of ['checkout.stripe.com', 'buy.stripe.com', 'donate.stripe.com', 'billing.stripe.com']) assert.ok(swiftHosts.includes(h), h);
  // Ko-fi and every subdomain of it, checked apart from the list in both.
  assert.match(java, /host\.equals\("ko-fi\.com"\) \|\| host\.endsWith\("\.ko-fi\.com"\)/);
  assert.match(swift, /J\.units\("ko-fi\.com"\)/);
  assert.match(swift, /J\.units\("\.ko-fi\.com"\)/);
});

test('ios-shell-2: a notification opens only the in-app links Android and the page allow (one OPEN pattern in Swift, Java and JS)', () => {
  const java = /Pattern OPEN = Pattern\.compile\("((?:[^"\\]|\\.)*)"\)/.exec(read('mobile', 'native', 'PushPolicy.java'));
  const swift = /static let OPEN = WholeMatch\("((?:[^"\\]|\\.)*)"\)/.exec(read(...KIT, 'PushPolicy.swift'));
  const js = /export const OPEN_RE = \/(.+)\/;$/m.exec(read('public', 'js', 'android-push.js'));
  assert.ok(java && swift && js, 'all three patterns found');
  const fromJava = unquote(java[1]);
  const fromSwift = unquote(swift[1]);
  const fromJs = js[1].replace(/\\\//g, '/');
  assert.equal(fromSwift, fromJava);
  assert.equal(fromJs, fromJava);
  // The page's iPhone push module uses the same one.
  assert.match(read('public', 'js', 'ios-push.js'), /export \{[^}]*\bOPEN_RE\b[^}]*\} from '\.\/android-push\.js';/);
  // What the pattern means (Swift wraps it in \A(?: )\z, the same as a whole match here).
  const re = new RegExp(fromSwift);
  for (const ok of ['/', '/#m/abc123', '/#c/x', '/#d/0', '/#call/room1', '/#call/dm:abc', '/#updates', '/#study', '/#scheduled']) assert.ok(re.test(ok), ok);
  for (const bad of ['javascript:alert(1)', '//evil.example', 'https://evil.example/', '/#m/ABC', '/#m/', '/#settings', '/x', '/#updates/1', `/#m/${'a'.repeat(65)}`]) assert.ok(!re.test(bad), bad);
});

// ================================================================== 2. the workflow
test('ios-shell-3: the ios job runs on every push with no secrets: pinned actions, HearthKit tests, the patched project, an unsigned simulator build', { skip: noWorkflow }, () => {
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const jobs = jobsOf(text);
  const ios = jobs.ios;
  assert.ok(ios, 'an ios job');
  // On every push: no condition, no environment, no secret.
  assert.doesNotMatch(headOf(ios), /^ {4}if:/m);
  assert.doesNotMatch(ios, /environment:|secrets\./);
  assert.match(headOf(ios), /^ {4}runs-on: macos-\d+$/m);
  // Every action in the iPhone jobs pinned to a commit, the same commit as everywhere else in the workflow.
  const pins = {};
  for (const m of text.matchAll(/uses: ([\w./-]+)@([^\s#]+)/g)) (pins[m[1]] ||= new Set()).add(m[2]);
  for (const name of ['ios', 'ios-archive', 'testflight-upload']) {
    const uses = [...jobs[name].matchAll(/uses: ([\w./-]+)@(\S+) # v[\d.]+$/gm)];
    assert.ok(uses.length >= 2, name);
    assert.equal(uses.length, (jobs[name].match(/uses: /g) || []).length, `${name}: every action has its version comment`);
    for (const [, action, sha] of uses) {
      assert.match(sha, /^[0-9a-f]{40}$/, `${name}: ${action} pinned to a commit`);
      assert.equal(pins[action].size, 1, `${action}: one commit across the workflow`);
    }
    for (const s of stepsOf(jobs[name]).filter((x) => x.includes('actions/checkout@'))) assert.match(s, /persist-credentials: false/, name);
  }
  // The same actions (and commits) as the Android job, where it uses them.
  const android = Object.fromEntries([...jobs.android.matchAll(/uses: ([\w./-]+)@(\S+)/g)].map((m) => [m[1], m[2]]));
  for (const [, action, sha] of ios.matchAll(/uses: ([\w./-]+)@(\S+)/g)) if (android[action]) assert.equal(sha, android[action], action);

  const steps = stepsOf(ios);
  const at = (re) => { const i = steps.findIndex((s) => re.test(s)); assert.ok(i >= 0, String(re)); return i; };
  // An Xcode 26 that isn't a beta (App Store Connect needs the iOS 26 SDK).
  assert.match(steps[at(/name: Xcode 26/)], /ls -d \/Applications\/Xcode_26\*\.app[^\n]*grep -viE 'beta\|_rc'[^\n]*sort -V \| tail -1/);
  // HearthKit's own tests.
  assert.match(steps[at(/name: HearthKit tests/)], /working-directory: hearth\/mobile\/ios-native\/HearthKit\n\s+run: swift test/);
  // Locked gems, the project made and patched, synced, then checked again with the plugin allowlist.
  assert.match(headOf(ios), /BUNDLE_DEPLOYMENT: 'true'/);
  const create = at(/npx cap add ios\n\s+(#.*\n\s+)*bundle exec ruby scripts\/patch-ios\.rb ios$/m);
  const sync = at(/run: npx cap sync ios$/m);
  const check = at(/bundle exec ruby scripts\/patch-ios\.rb --check ios/);
  assert.ok(at(/run: npm ci --no-audit --no-fund/) < create && create < sync && sync < check);
  assert.match(steps[check], /\(c\.packageClassList \|\| \[\]\)\.filter\(\(p\) => p !== 'KeyboardPlugin'\)/);
  // The simulator build: unsigned, after the checks; then the app opened once.
  const build = at(/xcodebuild -project ios\/App\/App\.xcodeproj -scheme App/);
  assert.ok(check < build);
  assert.match(steps[build], /CODE_SIGNING_ALLOWED=NO build/);
  assert.doesNotMatch(steps[build], /allowProvisioningUpdates|authenticationKey/);
  assert.match(steps[at(/name: Open it in the simulator/)], /xcrun simctl launch "\$UDID" app\.hearth\.mobile/);
  // The build number: Android's versionCode formula, so both always go up together.
  const formula = (job) => /code=\$\(\( .+ \)\)/.exec(job)[0];
  assert.equal(formula(ios), formula(jobs.android));
  // The server: baked in and locked (push only works on the publisher's own server). For tags and the default branch
  // always HEARTH_SERVER (never a manual run's input), and only then is the project handed to ios-archive, before
  // anything builds in it.
  assert.match(steps[at(/name: Bake in the server address/)], /c\.defaultServer=process\.env\.SERVER;c\.lockServer=true;/);
  const which = at(/name: Which server/);
  assert.ok(which < at(/name: Bake in the server address/));
  assert.match(steps[which], /HEARTH_SERVER: \$\{\{ vars\.HEARTH_SERVER \}\}/);
  assert.doesNotMatch(steps[which], /inputs\.server/);
  assert.match(steps[which], /echo "SERVER=\$HEARTH_SERVER" >> "\$GITHUB_ENV"/);
  const handOver = at(/name: hearth-ios-project/);
  assert.match(steps[handOver], /if: steps\.server\.outputs\.store == '1'/);
  assert.ok(check < handOver && handOver < build);
});

test('ios-shell-4: signing and uploading only in the production environment, for tags and the default branch', { skip: noWorkflow }, () => {
  const jobs = jobsOf(fs.readFileSync(WORKFLOW, 'utf8'));
  const signing = /secrets\.(ASC_|IOS_)/;
  const withSecrets = Object.keys(jobs).filter((n) => signing.test(jobs[n]));
  assert.deepEqual(withSecrets.sort(), ['ios-archive', 'testflight-upload']);
  for (const name of withSecrets) {
    const head = headOf(jobs[name]);
    assert.match(head, /^ {4}environment: production$/m, name);
    assert.match(head, RELEASE_ONLY, `${name}: tags and the default branch only`);
    assert.match(head, /github\.event\.inputs\.signpath_test != 'true'/, `${name}: never in a SignPath test run`);
    assert.doesNotMatch(head, /workflow_dispatch|event_name/, name);
    // Secrets only in a step's env:, never in the job's env (where every step, npm's included, would see them).
    assert.doesNotMatch(head, signing, `${name}: no signing secret in the job's env`);
  }
  assert.match(headOf(jobs['ios-archive']), /^ {4}needs: ios$/m);
  assert.match(headOf(jobs['testflight-upload']), /^ {4}needs: ios-archive$/m);
  assert.match(headOf(jobs['testflight-upload']), /needs\.ios-archive\.outputs\.built == '1'/);

  const archive = stepsOf(jobs['ios-archive']);
  const at = (re) => { const i = archive.findIndex((s) => re.test(s)); assert.ok(i >= 0, String(re)); return i; };
  // The key file: written with mode 600 just before the two xcodebuild steps that use it, after the patch.
  const key = at(/name: App Store Connect key/);
  assert.match(archive[key], /umask 077\n\s+printf '%s' "\$ASC_KEY_P8_BASE64" \| base64 -D > "\$RUNNER_TEMP\/AuthKey\.p8"/);
  assert.ok(at(/bundle exec ruby scripts\/patch-ios\.rb ios/) < key);
  // No npm package's code runs in this job: it signs the ios job's project, with the keyboard plugin's tarball
  // checked against package-lock.json, and the build locked to HEARTH_SERVER only.
  assert.doesNotMatch(jobs['ios-archive'], /\bnpm (ci|install|run|exec)\b|\bnpx |setup-node|capacitor-assets|node -e/);
  assert.match(archive[at(/name: hearth-ios-project/)], /download-artifact@/);
  assert.match(archive[at(/name: Keyboard plugin from package-lock\.json/)], /\[ "\$got" = "\$integrity" \] \|\| \{/);
  assert.match(headOf(jobs['ios-archive']), /^ {6}SERVER: \$\{\{ vars\.HEARTH_SERVER \}\}$/m);
  assert.match(archive[at(/name: Check the project, sign and version it/)], /c\["lockServer"\] == true && c\["defaultServer"\] == ENV\["SERVER"\]/);
  assert.ok(key < at(/xcodebuild archive /) && at(/xcodebuild archive /) < at(/xcodebuild -exportArchive /));
  // Before it, only the first step sees that the key exists (to choose how to sign), before anything is checked out.
  const choose = at(/name: Choose how to sign/);
  assert.equal(choose, 0);
  assert.doesNotMatch(archive[choose], /base64 -D|AuthKey|printf/, 'it only checks the key is there');
  assert.doesNotMatch(archive[choose], /uses:|npm|npx|bundle/);
  for (const s of archive.slice(1, key)) assert.doesNotMatch(s, /ASC_KEY_P8_BASE64|ASC_KEY_ID|ASC_ISSUER_ID/, 'no other step before it sees the key');
  // Option A: Xcode's cloud-managed signing with the key; option B: the certificate in a throwaway keychain.
  assert.match(archive[at(/xcodebuild archive /)], /-allowProvisioningUpdates -authenticationKeyPath "\$RUNNER_TEMP\/AuthKey\.p8" -authenticationKeyID "\$ASC_KEY_ID" -authenticationKeyIssuerID "\$ASC_ISSUER_ID"/);
  const optionB = archive[at(/name: Certificate and profiles \(option B\)/)];
  assert.match(optionB, /if: steps\.signing\.outputs\.method == 'manual'/);
  assert.match(optionB, /kc_pass="\$\(openssl rand -hex 32\)"\n[\s\S]*security create-keychain -p "\$kc_pass" "\$kc"/);
  assert.match(optionB, /if \[ "\$appid" != "\$APPLE_TEAM_ID\.\$bundle" \]; then [^\n]*exit 1; fi/, 'each profile is for the right app');
  assert.match(archive[at(/name: Export the \.ipa/)], /-exportOptionsPlist "\$opts"/);
  // Everything removed afterwards, whatever happened.
  const cleanup = archive[at(/name: Remove the key, certificate and profiles/)];
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /rm -f "\$RUNNER_TEMP\/AuthKey\.p8"/);
  assert.match(cleanup, /security delete-keychain/);
  // The .ipa goes to one place: the TestFlight job.
  assert.match(archive[at(/name: hearth-ios-ipa/)], /retention-days: 7/);
  const upload = stepsOf(jobs['testflight-upload']);
  const tf = upload.find((s) => s.includes('name: Upload to TestFlight'));
  assert.match(tf, /bundle exec fastlane run upload_to_testflight ipa:"\$ipa" api_key_path:"\$RUNNER_TEMP\/asc\.json" skip_waiting_for_build_processing:true/);
  assert.match(tf, /umask 077/);
  assert.match(upload.find((s) => s.includes('name: Remove the key')), /if: always\(\)[\s\S]*rm -f "\$RUNNER_TEMP\/asc\.json"/);
  for (const [name, body] of Object.entries(jobs)) {
    if (name !== 'ios-archive') assert.doesNotMatch(body, /upload-artifact@[^\n]*\n(\s+if:[^\n]*\n)?\s+with:\n\s+name: hearth-ios-ipa/, `${name} doesn't make the .ipa`);
    if (name !== 'testflight-upload') assert.doesNotMatch(body, /name: hearth-ios-ipa\n\s+path: hearth\/mobile\/ios-dist$/m, `${name} doesn't take the .ipa`);
  }
  // The export options: for App Store Connect, nothing secret in them.
  const opts = read('mobile', 'ios-native', 'ExportOptions.plist');
  assert.match(opts, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(opts, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
  assert.doesNotMatch(opts, /<key>teamID<\/key>|PRIVATE KEY/, 'the team comes from APPLE_TEAM_ID');
});

test('ios-shell-5: the release and the server copy refuse an .ipa and never download one', { skip: noWorkflow }, () => {
  const jobs = jobsOf(fs.readFileSync(WORKFLOW, 'utf8'));
  for (const name of ['release', 'publish-to-vps']) {
    const steps = stepsOf(jobs[name]);
    assert.doesNotMatch(jobs[name], /hearth-ios|ios-dist/, `${name} downloads nothing from the iPhone jobs`);
    const glob = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    for (const s of steps.filter((x) => /download-artifact@/.test(x))) {
      const want = /^\s+(?:pattern|name): (\S+)$/m.exec(s);
      assert.ok(want, `${name}: every download names what it takes`);
      for (const ios of ['hearth-ios-ipa', 'hearth-ios-project', 'hearth-ios-simulator-screenshot']) assert.doesNotMatch(ios, glob(want[1]), `${name} never downloads ${ios}`);
    }
    const refuse = steps.findIndex((s) => s.includes('name: Refuse unsigned and intermediate files'));
    const publish = steps.findIndex((s) => /softprops\/action-gh-release|name: Copy installers to the server/.test(s));
    assert.ok(refuse >= 0 && refuse < publish, `${name} refuses before publishing`);
    assert.match(steps[refuse], /nocaseglob/);
    assert.match(steps[refuse], /ipa=\(dist\/\*\.ipa\)\n\s+if \[ \$\{#ipa\[@\]\} -gt 0 \]; then echo "::error::[^"]*"; exit 1; fi/);
  }
  // And the server copy's file list has no .ipa in it.
  assert.doesNotMatch(/files=\(([^)]*)\)/.exec(jobs['publish-to-vps'])[1], /ipa/);
});

// ================================================================== 3. packaging
test('ios-shell-6: Capacitor for iOS: the version matching core, the user agent, no HTTP or cookie plugins, the scripts', () => {
  const pkg = JSON.parse(read('mobile', 'package.json'));
  const major = (v) => /\d+/.exec(v)[0];
  assert.equal(major(pkg.dependencies['@capacitor/ios']), major(pkg.dependencies['@capacitor/core']));
  assert.ok(pkg.dependencies['@capacitor/keyboard'], 'the keyboard plugin');
  assert.equal(pkg.scripts['ios:add'], 'cap add ios');
  assert.match(pkg.scripts['ios:patch'], /ruby scripts\/patch-ios\.rb ios$/);
  const lock = JSON.parse(read('mobile', 'package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'lockfile matches package.json');
  const cfg = JSON.parse(read('mobile', 'capacitor.config.json'));
  assert.deepEqual(cfg.ios, { appendUserAgent: 'HearthiOS', webContentsDebuggingEnabled: false, contentInset: 'never', scrollEnabled: true, allowsLinkPreview: false, includePlugins: ['@capacitor/keyboard'] });
  // The keyboard plugin is for the iPhone only: no npm plugin at all in the Android app.
  assert.deepEqual(cfg.android.includePlugins, []);
  assert.equal(cfg.plugins.CapacitorHttp.enabled, false);
  assert.equal(cfg.plugins.CapacitorCookies.enabled, false);
  assert.equal(cfg.plugins.Keyboard.resize, 'native');
  assert.equal(cfg.server.iosScheme, undefined, 'the connect screen stays at capacitor://localhost');
  assert.match(read('mobile', '.gitignore'), /^\/ios\/$/m, 'the generated project is never committed');
});

test('ios-shell-7: the extensions\' Info.plist files and entitlements say what the Swift code and the patch script expect', () => {
  const res = (f) => read('mobile', 'ios-native', 'resources', f);
  const patch = read('mobile', 'scripts', 'patch-ios.rb');
  const key = (xml, k) => { const m = new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(xml); return m && m[1]; };
  for (const [target, point, file] of [
    ['NotificationService', 'com.apple.usernotifications.service', 'NotificationService/NotificationService.swift'],
    ['ShareExtension', 'com.apple.share-services', 'ShareExtension/ShareViewController.swift'],
  ]) {
    const plist = res(`${target}-Info.plist`);
    const swift = read('mobile', 'ios-native', ...file.split('/'));
    const objc = /^@objc\((\w+)\)$/m.exec(swift)[1];
    // A plain class name (no module prefix): the @objc name, which doesn't depend on the module.
    assert.equal(key(plist, 'NSExtensionPrincipalClass'), objc, target);
    assert.equal(key(plist, 'NSExtensionPointIdentifier'), point, target);
    assert.equal(key(plist, 'CFBundleShortVersionString'), '$(MARKETING_VERSION)', `${target}: the app's version`);
    assert.equal(key(plist, 'CFBundleVersion'), '$(CURRENT_PROJECT_VERSION)', `${target}: the app's build`);
    assert.ok(patch.includes(`point: '${point}', principal: '${objc}'`), `patch-ios.rb checks ${target}`);
    assert.match(res(`${target}.entitlements`), /<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>group\.app\.hearth\.mobile<\/string>/);
  }
  assert.match(res('ShareExtension-Info.plist'), /<key>NSExtensionActivationSupportsWebURLWithMaxCount<\/key>\s*<integer>1<\/integer>\s*<key>NSExtensionActivationSupportsText<\/key>\s*<true\/>/);
  // The Keychain group the app and the notification extension share comes first: DeviceKeys uses the default group.
  for (const f of ['App.entitlements', 'NotificationService.entitlements']) {
    assert.match(res(f), /<key>keychain-access-groups<\/key>\s*<array>\s*<string>\$\(AppIdentifierPrefix\)group\.app\.hearth\.mobile<\/string>/, f);
  }
  assert.doesNotMatch(res('ShareExtension.entitlements'), /keychain/);
  const app = res('App.entitlements');
  assert.match(app, /<key>com\.apple\.developer\.usernotifications\.time-sensitive<\/key>\s*<true\/>/);
  assert.match(app, /<key>aps-environment<\/key>/);
  assert.doesNotMatch(app, /associated-domains/, 'only added for a build with HEARTH_SERVER');
  // The App Group and Keychain names are the ones HearthKit uses.
  assert.match(read(...KIT, 'DeviceKeys.swift'), /public static let appGroup = "group\.app\.hearth\.mobile"/);
  assert.match(patch, /^APP_GROUP = 'group\.app\.hearth\.mobile'$/m);
  // The App target gets every Swift file in ios-native/App, including the two that replace Capacitor's.
  assert.match(patch, /Dir\[File\.join\(NATIVE, dir, '\*\.swift'\)\]/);
  for (const f of ['AppDelegate.swift', 'SceneDelegate.swift']) assert.ok(fs.existsSync(path.join(MOBILE, 'ios-native', 'App', f)), f);
  assert.match(read('mobile', 'ios-native', 'App', 'SceneDelegate.swift'), /rootViewController = HearthViewController\(\)/);
  // No ATS exceptions and no Photos permission in the App Store build.
  assert.match(patch, /plist\.delete\('NSAppTransportSecurity'\)/);
  assert.match(patch, /'ITSAppUsesNonExemptEncryption' => false/);
  assert.match(patch, /'UIBackgroundModes' => \['audio'\]/);
});

test('ios-shell-8: the ring is a WAV of 30 seconds or less, the name the server and the extension use, and make-ring.js makes it', () => {
  const file = path.join(MOBILE, 'ios-native', 'resources', 'ring.wav');
  const wav = fs.readFileSync(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1, 'PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt16LE(34), 16, '16-bit');
  const rate = wav.readUInt32LE(24);
  const seconds = wav.readUInt32LE(40) / (rate * 2);
  assert.ok(seconds > 5 && seconds <= 30, `${seconds} s`);
  assert.ok(wav.length < 1024 * 1024, 'small');
  assert.match(read('mobile', 'ios-native', 'NotificationService', 'NotificationService.swift'), /UNNotificationSoundName\("ring\.wav"\)/);
  assert.match(read('server', 'apns.js'), /'ring\.wav'/);
  // The same bytes again from the script.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-ring-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'ios-native', 'resources'), { recursive: true });
    fs.copyFileSync(path.join(MOBILE, 'scripts', 'make-ring.js'), path.join(tmp, 'scripts', 'make-ring.js'));
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'make-ring.js')], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(path.join(tmp, 'ios-native', 'resources', 'ring.wav')).equals(wav), 'make-ring.js reproduces ring.wav');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ios-shell-9: the Ruby tools are pinned, and the patch script is valid Ruby', () => {
  const gemfile = read('mobile', 'Gemfile');
  const lock = read('mobile', 'Gemfile.lock');
  const gems = [...gemfile.matchAll(/^\s*gem '([\w-]+)', '([^']+)'$/gm)];
  assert.deepEqual(gems.map((m) => m[1]).sort(), ['fastlane', 'xcodeproj']);
  for (const [, name, version] of gems) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: an exact version`);
    assert.match(lock, new RegExp(`^ {4}${name} \\(${version.replace(/\./g, '\\.')}\\)$`, 'm'), `${name} ${version} in Gemfile.lock`);
    assert.match(lock, new RegExp(`^ {2}${name} \\(= ${version.replace(/\./g, '\\.')}\\)$`, 'm'), `${name} pinned in DEPENDENCIES`);
  }
  assert.match(lock, /^CHECKSUMS$/m, 'with checksums');
  assert.match(lock, /^ {2}arm64-darwin$/m, 'for GitHub\u2019s macOS runners');
  assert.match(gemfile, /group :upload do\n\s+gem 'fastlane'/, 'the build jobs leave fastlane out');
  if (spawnSync('ruby', ['-v'], { stdio: 'ignore' }).status !== 0) return;
  const r = spawnSync('ruby', ['-c', path.join(MOBILE, 'scripts', 'patch-ios.rb')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
