#!/bin/sh
# Rebuilds public/vendor/ml-kem.js: ML-KEM-768 (FIPS 203) from @noble/post-quantum, bundled into one ES module the
# browser loads from this server (no CDN, so the Content-Security-Policy stays 'self'). Pinned versions; npm checks
# each package against the integrity hash in its lockfile. After rebuilding, update ML_KEM_SHA256 in
# test/pq-crypto.test.js: the test fails on any change to the file that wasn't made on purpose.
set -eu
PQ=0.7.1
ESBUILD=0.25.10
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
npm init -y >/dev/null
npm install --no-audit --no-fund --save-exact "@noble/post-quantum@$PQ" "esbuild@$ESBUILD" >/dev/null
echo "export { ml_kem768 } from '@noble/post-quantum/ml-kem.js';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --target=es2020 --legal-comments=inline --outfile=out.js --log-level=warning
versions=$(cd node_modules/@noble && for d in *; do printf '%s@%s ' "@noble/$d" "$(node -p "require('./$d/package.json').version")"; done)
integrity=$(node -p "require('./package-lock.json').packages['node_modules/@noble/post-quantum'].integrity")
{
  echo "// ML-KEM-768 (NIST FIPS 203) for Hearth's hybrid post-quantum key agreement (public/js/e2ee.js)."
  echo "// Built by scripts/vendor-ml-kem.sh from: ${versions}(MIT, Paul Miller, https://github.com/paulmillr/noble-post-quantum)."
  echo "// @noble/post-quantum@$PQ npm integrity: $integrity"
  echo "// Bundled with esbuild@$ESBUILD. Do not edit by hand; test/pq-crypto.test.js pins this file's SHA-256."
  cat out.js
} > "$here/public/vendor/ml-kem.js"
node -e "console.log('sha256', require('crypto').createHash('sha256').update(require('fs').readFileSync('$here/public/vendor/ml-kem.js')).digest('hex'))"
