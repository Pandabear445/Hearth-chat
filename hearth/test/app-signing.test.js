// Windows signing in CI (desktop/build/configure-signing.js and .github/workflows/hearth-apps.yml), in particular
// SignPath's test signing: a manual run signs with the self-signed test certificate SignPath reviews before it issues
// the real one, and nothing from that run may reach anyone (release, the server's download folder, update files,
// Google Play).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');

// Runs the chooser on a copy of the desktop app's package.json with these settings: { status, out, win, log }.
function choose(settings) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-signing-'));
  try {
    fs.mkdirSync(path.join(tmp, 'build'));
    fs.copyFileSync(path.join(DESKTOP, 'build', 'configure-signing.js'), path.join(tmp, 'build', 'configure-signing.js'));
    fs.copyFileSync(path.join(DESKTOP, 'package.json'), path.join(tmp, 'package.json'));
    const out = path.join(tmp, 'github-output');
    fs.writeFileSync(out, '');
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AZURE_|WIN_|SIGNPATH_|SIGN_THIS_BUILD|WINDOWS_REQUIRE_SIGNING|GITHUB_)/.test(k)));
    const r = spawnSync(process.execPath, [path.join(tmp, 'build', 'configure-signing.js')], { env: { ...clean, GITHUB_OUTPUT: out, ...settings }, encoding: 'utf8' });
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    return { status: r.status, out: Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('='))), win: pkg.build.win || {}, log: r.stdout + r.stderr };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const SIGNPATH = { SIGNPATH_API_TOKEN: 'token-not-printed', SIGNPATH_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000', SIGNPATH_PROJECT_SLUG: 'hearth' };

test('a release build signs with SignPath and expects the Foundation as the publisher on updates', () => {
  const r = choose({ ...SIGNPATH, SIGN_THIS_BUILD: 'true' });
  assert.equal(r.status, 0, r.log);
  assert.deepEqual([r.out.method, r.out.test], ['signpath', '0']);
  assert.deepEqual(r.win.signtoolOptions, { publisherName: ['SignPath Foundation'] });
  assert.doesNotMatch(r.log, /token-not-printed/);
});

test('SignPath test signing: signs with SignPath whatever else is set, and the app expects no publisher', () => {
  const r = choose({ ...SIGNPATH, SIGNPATH_TEST: 'true', SIGN_THIS_BUILD: 'true', WIN_CSC_LINK: 'pfx-not-used' });
  assert.equal(r.status, 0, r.log);
  assert.deepEqual([r.out.method, r.out.test], ['signpath', '1']);
  assert.equal(r.win.signtoolOptions, undefined, 'no publisher name pinned from a test certificate');
  assert.match(r.log, /Test signing with SignPath/);
  assert.doesNotMatch(r.log, /token-not-printed/);
});

test('SignPath test signing without the SignPath settings stops the build', () => {
  const r = choose({ SIGNPATH_TEST: 'true', SIGN_THIS_BUILD: 'true' });
  assert.notEqual(r.status, 0);
  assert.match(r.log, /test signing needs the SIGNPATH_API_TOKEN secret/);
});

test('without the test flag nothing changes: a branch build stays unsigned, test=0', () => {
  const r = choose({ ...SIGNPATH, SIGN_THIS_BUILD: 'false' });
  assert.equal(r.status, 0, r.log);
  assert.deepEqual([r.out.method, r.out.test], ['none', '0']);
});

test('the workflow: a test-signing run uses the test policy, accepts only an untrusted signature, and publishes nothing', () => {
  const wf = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'hearth-apps.yml'), 'utf8');
  assert.match(wf, /\n {6}signpath_test:\n {8}description: [^\n]+\n {8}type: boolean\n {8}required: false\n {8}default: false\n/);
  // Both requests (the app, then the installer) pick the test policy in a test run, the release policy otherwise.
  const policy = "signing-policy-slug: ${{ steps.signing.outputs.test == '1' && (vars.SIGNPATH_TEST_POLICY_SLUG || 'test-signing') || (vars.SIGNPATH_POLICY_SLUG || 'release-signing') }}";
  assert.equal(wf.split(policy).length - 1, 2);
  assert.doesNotMatch(wf, /signing-policy-slug: \$\{\{ vars\.SIGNPATH_POLICY_SLUG \|\| 'release-signing' \}\}/);
  // The check accepts an untrusted signature only in a test run, and never a missing one.
  assert.match(wf, /\$ok = \$s\.Status -eq 'Valid' -or \(\$test -and \$s\.SignerCertificate -and \$s\.Status -in @\('UnknownError', 'NotTrusted'\)\)/);
  assert.match(wf, /\$test = \$env:TEST_SIGNING -eq '1'/);
  // Every job that signs update files, releases or publishes stays out of a test run (job conditions can't read env).
  // (A job's header: from its name to its first step.)
  const head = (name) => { const at = wf.indexOf(`\n  ${name}:\n`); assert.ok(at > 0, name); return wf.slice(at, wf.indexOf('steps:', at)); };
  for (const name of ['sign-updates', 'play-upload', 'release', 'publish-to-vps']) {
    assert.match(head(name), /\n {4}if: [^]*github\.event\.inputs\.signpath_test != 'true'/, name);
  }
  assert.doesNotMatch(wf, /if: [^\n]*env\.SIGNPATH_TEST/, 'not through env, which job conditions can\'t see');
  // A test run never cancels a release build on the same branch, and its files are named for what they are.
  assert.match(wf, /group: hearth-apps-\$\{\{ github\.ref \}\}\$\{\{ github\.event\.inputs\.signpath_test == 'true' && '-signpath-test' \|\| '' \}\}/);
  assert.match(wf, /name: hearth-desktop-\$\{\{ runner\.os \}\}\$\{\{ steps\.signing\.outputs\.test == '1' && '-SIGNPATH-TEST' \|\| '' \}\}/);
});
