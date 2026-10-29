// Getting videos into the Reels tab (docs/design/SCROLL-TOGETHER.md › Getting videos in): links shared to Hearth
// (public/js/share.js, the manifest's share_target, /share, mobile/native/ShareLinks.java), imports from TikTok's and
// Instagram's data downloads (public/js/reels-import.js), and My Reels in the vault (public/js/my-reels.js,
// server/myreels.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./helpers');

const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
const ID = '7234567890123456789';
const enc = (s) => new TextEncoder().encode(s);

// ================================================================== shared links
test('share: only TikTok and Instagram links come out of shared text, in social.js’s own form', async () => {
  const S = await clientModule('share.js');
  const got = S.socialLinksIn(`Watch this! https://vm.tiktok.com/ZMabc123/). And https://www.tiktok.com/@hearth/video/${ID}?is_from_webapp=1, `
    + `again https://www.tiktok.com/embed/v2/${ID} plus https://www.instagram.com/reel/C9abc_DEF-1/?igsh=x. Not https://evil.example/@a/video/${ID} `
    + `or javascript:alert(1) or https://www.tiktok.com.evil.net/@a/video/${ID}`);
  assert.deepEqual(got.map((p) => p.url), ['https://vm.tiktok.com/ZMabc123/', `https://www.tiktok.com/@hearth/video/${ID}`, 'https://www.instagram.com/reel/C9abc_DEF-1/']);
  assert.equal(S.socialLinksIn('x'.repeat(100) + ' https://www.instagram.com/p/AAAAAAAAAA1/ https://www.instagram.com/p/AAAAAAAAAA2/', 1).length, 1);
  assert.deepEqual(S.socialLinksIn(null), []);
  // A share sheet puts the link in url, text or title.
  assert.equal(S.sharedLink({ text: `Look https://www.tiktok.com/@a/video/${ID}` }).id, ID);
  assert.equal(S.sharedLink({ url: 'https://example.org', title: 'https://www.instagram.com/reel/C9abc_DEF-1/' }).id, 'C9abc_DEF-1');
  assert.equal(S.sharedLink({ url: 'x'.repeat(5000) }), null);
  assert.equal(S.sharedLink({}), null);
  // Where it comes from: /share?url=… (share target, bookmarklet) or #share=… (the Android app).
  const loc = (href) => new URL(href);
  assert.equal(S.shareFromLocation(loc(`https://chat.example/share?url=${encodeURIComponent(`https://www.tiktok.com/@a/video/${ID}`)}`)).link.id, ID);
  assert.equal(S.shareFromLocation(loc(`https://chat.example/share?title=x&text=${encodeURIComponent(`hi https://vm.tiktok.com/ZMabc123/`)}`)).link.short, 'ZMabc123');
  assert.deepEqual(S.shareFromLocation(loc('https://chat.example/share?url=https://evil.example/')), { found: true, link: null });
  assert.equal(S.shareFromLocation(loc(`https://chat.example/${S.shareHash(`https://www.tiktok.com/@a/video/${ID}`)}`)).link.id, ID);
  assert.deepEqual(S.shareFromLocation(loc('https://chat.example/#share=%E0%A4%A')), { found: true, link: null }, 'a broken escape is nothing');
  assert.deepEqual(S.shareFromLocation(loc('https://chat.example/')), { found: false, link: null });
  // The bookmarklet reads location.href and opens a Hearth tab: nothing else.
  const b = S.bookmarklet('https://chat.example.com:8443');
  assert.equal(b, 'javascript:void(window.open("https://chat.example.com:8443/share?url="+encodeURIComponent(location.href),\'_blank\',\'noopener\'))');
  for (const bad of ['javascript:alert(1)', 'https://a"b.example', 'https://x.example/path', '']) assert.throws(() => S.bookmarklet(bad), /origin/, bad);
  // The picker's order: recent first, then as given; a search keeps every word.
  const list = [{ key: 'me', name: 'My Reels' }, { key: 'd:1', name: 'Ana', where: 'Direct message' }, { key: 'c:2', name: '#general', where: 'Book club' }, { key: 'c:3', name: '#memes', where: 'Book club' }];
  assert.deepEqual(S.rankConversations(list, ['c:3', 'd:1']).map((x) => x.key), ['c:3', 'd:1', 'me', 'c:2']);
  assert.deepEqual(S.rankConversations(list, [], 'book GEN').map((x) => x.key), ['c:2']);
  assert.deepEqual(S.pushRecent(['a', 'b', 'c'], 'b', 2), ['b', 'a']);
  assert.deepEqual(S.batches([1, 2, 3, 4, 5, 6, 7, 8, 9]), [[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
});

// ================================================================== imports
function zip(entries) {
  const locals = []; const centrals = []; let off = 0;
  for (const { name, data, lie } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const c = zlib.deflateRawSync(raw); const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(lie || raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(c.length, 20); cd.writeUInt32LE(lie || raw.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    const local = Buffer.concat([lh, n, c]); locals.push(local); centrals.push(Buffer.concat([cd, n])); off += local.length;
  }
  const central = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(central.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, central, e]));
}
// Modelled on the real files (trimmed): TikTok's user_data_tiktok.json and "Like List.txt", Instagram's
// liked_posts.json and saved_posts.json.
const TIKTOK_JSON = { Profile: { 'Profile Information': { ProfileMap: { userName: 'hearth' } } },
  Activity: {
    'Like List': { ItemFavoriteList: [{ date: '2026-03-01 10:00:00', link: `https://www.tiktokv.com/share/video/${ID}/` }, { date: '2026-02-01 10:00:00', link: 'https://www.tiktokv.com/share/video/7111111111111111111/' }] },
    'Favorite Videos': { FavoriteVideoList: [{ Date: '2026-01-01 10:00:00', Link: `https://www.tiktokv.com/share/video/${ID}/` }, { Date: 'x', Link: 'javascript:alert(1)' }, { Date: 'y', Link: '<img src=x onerror=alert(1)>' }] },
  } };
const TIKTOK_TXT = 'Date: 2026-01-01 12:00:00\nLink: https://www.tiktokv.com/share/video/7222222222222222222/\n\nDate: 2026-01-02 12:00:00\nLink: https://evil.example/share/video/7333333333333333333/\n';
const IG_LIKED = { likes_media_likes: [{ title: 'someone', string_list_data: [{ href: 'https://www.instagram.com/reel/C9abc_DEF-1/', value: '👍', timestamp: 1767225600 }] }] };
const IG_SAVED = { saved_saved_media: [{ title: 'other', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/p/CAbcdEfgh12/', timestamp: 1767225600 } } }] };

test('import: TikTok’s and Instagram’s exports, as files or in their .zip, read on the device with every cap', async () => {
  const I = await clientModule('reels-import.js');
  const r = await I.readExport([
    { name: 'user_data_tiktok.json', bytes: enc(JSON.stringify(TIKTOK_JSON)) },
    { name: 'Like List.txt', bytes: enc(TIKTOK_TXT) },
    { name: 'instagram.zip', bytes: zip([{ name: 'your_instagram_activity/likes/liked_posts.json', data: JSON.stringify(IG_LIKED) }, { name: 'your_instagram_activity/saved/saved_posts.json', data: JSON.stringify(IG_SAVED) }, { name: 'media/photo.jpg', data: 'not read' }]) },
    { name: 'photo.png', bytes: enc('\x89PNG') },
  ]);
  assert.deepEqual(r.items.map((x) => `${x.kind}:${x.id}`), [`tiktok:${ID}`, 'tiktok:7111111111111111111', 'tiktok:7222222222222222222', 'instagram:C9abc_DEF-1', 'instagram:CAbcdEfgh12']);
  assert.deepEqual([r.tiktok, r.instagram, r.duplicates, r.files, r.skipped, r.capped], [3, 2, 1, 4, ['photo.png'], false]);
  assert.equal(r.items[0].link, `https://www.tiktok.com/embed/v2/${ID}`, 'tiktokv share links become TikTok’s own form');
  assert.equal(I.exportLink('https://vm.tiktok.com/ZMabc123/'), null, 'short links can’t be checked without asking TikTok: left out');
  // Hostile files: nesting that would overflow a recursive walk, a .zip entry that lies about its size (unpacks past
  // the cap), a damaged .zip, and not JSON at all.
  const deep = await I.readExport([{ name: 'deep.json', bytes: enc(`${'['.repeat(50000)}"https://www.instagram.com/p/AAAAAAAAAA1/"${']'.repeat(50000)}`) }]);
  assert.equal(deep.items.length, 0, 'past DEPTH_MAX nothing is read (and nothing crashes)');
  const bomb = await I.readExport([{ name: 'x.zip', bytes: zip([{ name: 'big.json', data: Buffer.alloc(I.TEXT_MAX + 1024, 0x20), lie: 100 }, { name: 'ok.txt', data: `https://www.tiktok.com/@a/video/${ID}` }]) }]);
  assert.deepEqual([bomb.skipped, bomb.items.length], [['big.json'], 1], 'the unpacking stops at the cap; the rest is still read');
  await assert.rejects(I.readExport([{ name: 'broken.zip', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) }]), /damaged/);
  const junk = await I.readExport([{ name: 'notes.json', bytes: enc(`{ broken json https://www.instagram.com/reel/C9abc_DEF-1/ "__proto__": 1`) }]);
  assert.equal(junk.items[0].id, 'C9abc_DEF-1', 'a file that isn’t JSON is searched as text');
  const proto = await I.readExport([{ name: 'p.json', bytes: enc('{"__proto__": {"polluted": "https://www.instagram.com/reel/C9abc_DEF-1/"}, "constructor": {"prototype": {"x": 1}}}') }]);
  assert.equal(proto.items.length, 1);
  assert.equal({}.polluted, undefined, 'nothing reaches Object.prototype');
  await assert.rejects(I.readExport([{ name: 'huge.json', bytes: new Uint8Array(I.FILE_MAX + 1) }]), /too much/);
  // Text that made a regular expression take quadratic time (a link followed by a long run of dots), and a .zip whose
  // entries all point at the same data: both read quickly, the data once.
  let t0 = Date.now();
  await I.readExport([{ name: 'dots.txt', bytes: enc(`http://${'.'.repeat(2040)}x `.repeat(4000)) }]);
  assert.ok(Date.now() - t0 < 3000, `dots: ${Date.now() - t0} ms`);
  const one = zip([{ name: 'a.txt', data: `https://www.tiktok.com/@a/video/${ID}` }]);
  // (Rebuilt with 200 central entries all naming the first local header.)
  const dv = new DataView(one.buffer); const eocd = one.length - 22; const cdOff = dv.getUint32(eocd + 16, true); const cdLen = dv.getUint32(eocd + 12, true);
  const cd = one.slice(cdOff, cdOff + cdLen);
  const shared = new Uint8Array(cdOff + cdLen * 200 + 22);
  shared.set(one.slice(0, cdOff)); for (let k = 0; k < 200; k++) shared.set(cd, cdOff + k * cdLen);
  const tail = one.slice(eocd); const tv = new DataView(tail.buffer, tail.byteOffset);
  tv.setUint16(8, 200, true); tv.setUint16(10, 200, true); tv.setUint32(12, cdLen * 200, true);
  shared.set(tail, cdOff + cdLen * 200);
  t0 = Date.now();
  const dup = await I.readExport([{ name: 'dup.zip', bytes: shared }]);
  assert.deepEqual([dup.files, dup.items.length], [1, 1], 'the same data is read once');
  const S = await clientModule('share.js');
  t0 = Date.now();
  S.socialLinksIn(`https://www.tiktok.com/${'.'.repeat(2040)}x `.repeat(2000));
  assert.ok(Date.now() - t0 < 3000, 'shared text too');
  assert.equal(S.trimTail('https://x/y)."»'), 'https://x/y');
  // At most ITEMS_MAX videos.
  const many = { list: Array.from({ length: I.ITEMS_MAX + 5 }, (_, i) => `https://www.tiktok.com/@a/video/${(7000000000000000000n + BigInt(i)).toString()}`) };
  const capped = await I.readExport([{ name: 'many.json', bytes: enc(JSON.stringify(many)) }]);
  assert.deepEqual([capped.items.length, capped.capped], [I.ITEMS_MAX, true]);
});

// ================================================================== My Reels
test('my reels: the list is checked, and sealed with the vault key before it leaves the device', async () => {
  globalThis.window = globalThis.window || { crypto: globalThis.crypto };
  const M = await clientModule('my-reels.js');
  const clean = M.cleanList([{ k: 't', id: ID, at: 1 }, { k: 't', id: ID, at: 9 }, { k: 'i', id: 'C9abc_DEF-1', ty: 'stories', at: 5 }, { k: 'x', id: ID }, { k: 't', id: '1/../2' }, null, { k: 'i', id: '<b>' }]);
  assert.deepEqual(clean, [{ k: 'i', id: 'C9abc_DEF-1', ty: 'reel', at: 5 }, { k: 't', id: ID, at: 1 }]);
  assert.equal(M.linkOf({ k: 'i', id: 'C9abc_DEF-1', ty: 'p' }), 'https://www.instagram.com/p/C9abc_DEF-1/');
  assert.deepEqual(M.entryOf({ kind: 'tiktok', id: ID }, 3), { k: 't', id: ID, at: 3 });
  // A short link (what the TikTok app shares) is kept as one, and looked up when it's played.
  assert.deepEqual(M.entryOf({ kind: 'tiktok', short: 'ZMabc123', link: 'https://vm.tiktok.com/ZMabc123/' }, 4), { k: 'ts', id: 'ZMabc123', h: 'vm', at: 4 });
  assert.equal(M.linkOf({ k: 'ts', id: 'ZTabc123', h: 't' }), 'https://www.tiktok.com/t/ZTabc123/');
  assert.deepEqual(M.cleanList([{ k: 'ts', id: 'bad-code!', h: 'vm' }, { k: 'ts', id: 'ZMabc123', h: 'evil' }]), [{ k: 'ts', id: 'ZMabc123', h: 'vm', at: 0 }]);
  // A store with a fake server: what goes up is 'x1:…' ciphertext with no id in it; a stale save is made again on top.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  let server = { data: null, updatedAt: 0 }; const puts = [];
  const api = async (method, p, body) => {
    if (method === 'GET') return { ...server };
    puts.push(body.data);
    if (body.base !== server.updatedAt) throw Object.assign(new Error('stale'), { code: 'stale' });
    server = { data: body.data, updatedAt: server.updatedAt + 1 };
    return { updatedAt: server.updatedAt };
  };
  let local = null;
  const mr = M.createMyReels({ api, vaultKey: async () => key, me: () => 'u1', store: { get: () => local, set: (v) => { local = v; } } });
  assert.deepEqual(await mr.add([{ kind: 'tiktok', id: ID }, { kind: 'instagram', id: 'C9abc_DEF-1', type: 'reel' }]), { added: 2, full: 0 });
  assert.match(puts[0], /^x1:/);
  assert.doesNotMatch(puts[0], new RegExp(ID));
  assert.equal(puts[0].length % 4, 0);
  assert.deepEqual(await mr.add([{ kind: 'tiktok', id: ID }]), { added: 0, full: 0 }, 'already there');
  // Another device saved meanwhile: refused as stale, loaded, and the removal made again on top of theirs.
  const other = M.createMyReels({ api, vaultKey: async () => key, me: () => 'u1', store: { get: () => null, set() {} } });
  await other.add([{ kind: 'instagram', id: 'CAbcdEfgh12', type: 'p' }]);
  await mr.remove([`t:${ID}`]);
  assert.deepEqual(mr.list().map((e) => e.id).sort(), ['C9abc_DEF-1', 'CAbcdEfgh12']);
  // A server handing back an older copy than this device opened: this device's newer one wins.
  const older = puts[0];
  server = { data: older, updatedAt: 99 };
  await mr.load();
  assert.deepEqual(mr.list().map((e) => e.id).sort(), ['C9abc_DEF-1', 'CAbcdEfgh12']);
  // It loads the newest copy any device wrote, and keeps that as the one to compare with.
  let seen = null;
  const fourth = M.createMyReels({ api, vaultKey: async () => key, me: () => 'u1', store: { get: () => seen, set: (v) => { seen = v; } } });
  await fourth.load();
  assert.ok(seen && seen.n >= 1, 'a device that only loaded a copy keeps it as the newest seen');
  await fourth.add([{ kind: 'tiktok', short: 'ZMabc123', link: 'https://vm.tiktok.com/ZMabc123/' }]);
  assert.ok(fourth.list().some((e) => e.k === 'ts' && e.id === 'ZMabc123'), 'a short link is kept');
  // Full: as many as fit go in, and the rest are counted.
  const big = M.createMyReels({ api: async (m, p, b) => (m === 'GET' ? { data: null, updatedAt: 0 } : { updatedAt: 1 }), vaultKey: async () => key, me: () => 'u2', store: { get: () => null, set() {} } });
  const lots = Array.from({ length: M.MAX + 3 }, (_, i) => ({ kind: 'tiktok', id: (7000000000000000000n + BigInt(i)).toString() }));
  assert.deepEqual(await big.add(lots), { added: M.MAX, full: 3 });
  // Sealed to the account: another account's key can't open it.
  const key2 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const stranger = M.createMyReels({ api, vaultKey: async () => key2, me: () => 'u1', store: { get: () => null, set() {} } });
  await assert.rejects(stranger.load());
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });

test('my reels: the server keeps only sealed data, per account, newest wins', async () => {
  const a = await srv.register(); const b = await srv.register();
  const SEALED = (n) => `x1:${Buffer.alloc(12, n).toString('base64')}:${Buffer.alloc(64, n).toString('base64')}`;
  assert.deepEqual((await as(a, 'GET', '/me/reels')).json, { data: null, updatedAt: 0 });
  const put = await as(a, 'PUT', '/me/reels', { data: SEALED(1), base: 0 });
  assert.equal(put.status, 200, put.text);
  assert.equal((await as(a, 'GET', '/me/reels')).json.data, SEALED(1));
  assert.deepEqual((await as(b, 'GET', '/me/reels')).json, { data: null, updatedAt: 0 }, 'per account');
  assert.equal((await as(a, 'PUT', '/me/reels', { data: SEALED(2), base: 1 })).json.code, 'stale');
  for (const data of ['https://www.tiktok.com/@a/video/' + ID, '{"list":[]}', 42, `x1:${'A'.repeat(600 * 1024)}:AA==`]) {
    assert.ok([400, 413].includes((await as(a, 'PUT', '/me/reels', { data })).status), String(data).slice(0, 30));
  }
  assert.equal((await as(a, 'PUT', '/me/reels', { data: null })).status, 200, 'emptied');
  assert.equal((await srv.api('GET', '/me/reels')).status, 401);
});

test('share target: the manifest offers Hearth in share sheets, and /share is the app', async () => {
  const man = await (await fetch(srv.base + '/manifest.webmanifest')).json();
  assert.deepEqual(man.share_target, { action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } });
  const page = await fetch(`${srv.base}/share?url=${encodeURIComponent(`https://www.tiktok.com/@a/video/${ID}`)}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /js\/app\.js/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

// ================================================================== the Android app
test('android: Share → Hearth takes only a TikTok or Instagram link from what another app sends', (t) => {
  let javac;
  try { javac = execFileSync('which', ['javac']).toString().trim(); } catch { return t.skip('no javac here'); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-share-java-'));
  try {
    const cases = [
      [`Check this out! https://vm.tiktok.com/ZMabc123/`, null, 'https://vm.tiktok.com/ZMabc123/'],
      [`https://www.tiktok.com/@hearth/video/${ID}?is_from_webapp=1&sender_device=pc).`, null, `https://www.tiktok.com/@hearth/video/${ID}?is_from_webapp=1&sender_device=pc`],
      ['nothing here', 'https://www.instagram.com/reel/C9abc_DEF-1/', 'https://www.instagram.com/reel/C9abc_DEF-1/'],
      [`http://www.tiktok.com/@a/video/${ID}`, null, null],
      [`https://user:pw@www.tiktok.com/@a/video/${ID}`, null, null],
      [`https://www.tiktok.com:8443/@a/video/${ID}`, null, null],
      [`https://www.tiktok.com.evil.net/@a/video/${ID}`, null, null],
      ['https://www.tiktok.com/%2e%2e/%2fsettings', null, null],
      ['https://www.instagram.com/', null, null],
      // (A link inside other text is still a link: the page then refuses one that isn't a video, share.js.)
      ['javascript:alert(1)//https://www.tiktok.com/x', null, 'https://www.tiktok.com/x'],
      [`${'x '.repeat(5000)}https://www.tiktok.com/@a/video/${ID}`, null, null],
      [null, null, null],
    ];
    const lit = (s) => (s === null ? 'null' : JSON.stringify(s));
    fs.writeFileSync(path.join(tmp, 'Check.java'), `package app.hearth.mobile;\npublic class Check { public static void main(String[] a) {\n${cases.map(([x, y]) => `  System.out.println(String.valueOf(ShareLinks.extract(${lit(x)}, ${lit(y)})));`).join('\n')}\n} }\n`);
    execFileSync(javac, ['-encoding', 'UTF-8', '-d', tmp, path.join(__dirname, '..', 'mobile', 'native', 'ShareLinks.java'), path.join(tmp, 'Check.java')], { stdio: 'pipe' });
    const out = execFileSync('java', ['-cp', tmp, 'app.hearth.mobile.Check']).toString().trim().split('\n');
    cases.forEach(([x, , want], i) => assert.equal(out[i], String(want), String(x).slice(0, 60)));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const P = require('../mobile/scripts/patch-android.js');
  const main = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'native', 'MainActivity.java'), 'utf8');
  assert.match(main, /ShareLinks\.extract\(intent\.getStringExtra\(Intent\.EXTRA_TEXT\), intent\.getStringExtra\(Intent\.EXTRA_SUBJECT\)\)/);
  assert.match(main, /toServerPage\("hearth-share", JSONObject\.quote\(link\)\)/, 'only the checked link reaches the page, quoted');
  assert.ok(typeof P.patchManifest === 'function');
});
