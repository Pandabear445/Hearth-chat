// TikTok videos and Instagram reels played in place, and watched together (docs/design/SOCIAL-EMBEDS.md):
// server/social.js and public/js/social.js (the same rules, checked against each other), the page's CSP, short
// TikTok links looked up through netguard (POST /api/social/resolve), TikTok's oEmbed card, and the watch-together
// events for both (manual Instagram items, the ready check, side by side).
//
// Nothing here touches the internet: TikTok is a local HTTPS stand-in that the Hearth under test reaches through
// a fake resolver (as in linkpreview.test.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, hex, sleep } = require('./helpers');
const SO = require('../server/social');

const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
const ID = '7234567890123456789';
const ID2 = '7111111111111111111';

// ================================================================== the rules
const TABLE = [
  // TikTok videos: every form names the same id; the link kept is TikTok's own.
  [`https://www.tiktok.com/@hearth.app/video/${ID}`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/@hearth.app/video/${ID}` }],
  [`https://www.tiktok.com/@hearth/video/${ID}?is_from_webapp=1&sender_device=pc#x`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/@hearth/video/${ID}` }],
  [`https://tiktok.com/@a_b/video/${ID}/`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/@a_b/video/${ID}` }],
  [`https://m.tiktok.com/v/${ID}.html`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/embed/v2/${ID}` }],
  [`https://www.tiktok.com/embed/v2/${ID}`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/embed/v2/${ID}` }],
  [`https://www.tiktok.com/embed/${ID}`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/embed/v2/${ID}` }],
  [`https://www.tiktok.com/player/v1/${ID}?autoplay=1`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/embed/v2/${ID}` }],
  [`http://www.tiktok.com/@x/video/${ID}`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/@x/video/${ID}` }],
  [`https://www.tiktok.com/@bad<user>/video/${ID}`, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/embed/v2/${ID}` }],
  // short links: a code only, looked up by the server later
  ['https://vm.tiktok.com/ZMabc123/', { kind: 'tiktok', short: 'ZMabc123', link: 'https://vm.tiktok.com/ZMabc123/' }],
  ['https://vt.tiktok.com/ZSxyz789', { kind: 'tiktok', short: 'ZSxyz789', link: 'https://vt.tiktok.com/ZSxyz789/' }],
  ['https://www.tiktok.com/t/ZTRabc12/', { kind: 'tiktok', short: 'ZTRabc12', link: 'https://www.tiktok.com/t/ZTRabc12/' }],
  // Instagram
  ['https://www.instagram.com/reel/C9abc_DEF-1/', { kind: 'instagram', id: 'C9abc_DEF-1', type: 'reel', link: 'https://www.instagram.com/reel/C9abc_DEF-1/' }],
  ['https://instagram.com/reels/C9abc_DEF-1?igsh=xyz', { kind: 'instagram', id: 'C9abc_DEF-1', type: 'reel', link: 'https://www.instagram.com/reel/C9abc_DEF-1/' }],
  ['https://www.instagram.com/tv/CAbcdEfgh12/', { kind: 'instagram', id: 'CAbcdEfgh12', type: 'reel', link: 'https://www.instagram.com/reel/CAbcdEfgh12/' }],
  ['https://www.instagram.com/p/CAbcdEfgh12/', { kind: 'instagram', id: 'CAbcdEfgh12', type: 'p', link: 'https://www.instagram.com/p/CAbcdEfgh12/' }],
  ['https://www.instagram.com/some.user/reel/CAbcdEfgh12/', { kind: 'instagram', id: 'CAbcdEfgh12', type: 'reel', link: 'https://www.instagram.com/reel/CAbcdEfgh12/' }],
  ['https://m.instagram.com/reel/CAbcdEfgh12/embed/', { kind: 'instagram', id: 'CAbcdEfgh12', type: 'reel', link: 'https://www.instagram.com/reel/CAbcdEfgh12/' }],
  // not one video: null
  ...[
    'https://www.tiktok.com/@hearth', `https://www.tiktok.com/@hearth/video/${ID}x`, 'https://www.tiktok.com/@hearth/video/123', `https://www.tiktok.com/@hearth/video/${'9'.repeat(22)}`,
    `https://www.tiktok.com/@hearth/photo/${ID}`, `https://www.tiktok.com.evil.net/@a/video/${ID}`, `https://eviltiktok.com/@a/video/${ID}`, `https://tiktok.com:8443/@a/video/${ID}`,
    `https://user:pass@www.tiktok.com/@a/video/${ID}`, `javascript:alert(1)//www.tiktok.com/@a/video/${ID}`, `data:text/html,www.tiktok.com/@a/video/${ID}`,
    `ftp://www.tiktok.com/@a/video/${ID}`, `https://www.tiktok.com/@a/video/${ID.slice(0, 5)}%2F..%2F${ID.slice(5)}`, `https://www.tiktok.com/@a/video/١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨٩`,
    'https://vm.tiktok.com/', 'https://vm.tiktok.com/ab/', 'https://vm.tiktok.com/ZMa-bc/', 'https://vm.tiktok.com/ZMabc123/extra', 'https://www.tiktok.com/t/', 'https://www.tiktok.com/t/a"b/',
    'https://www.instagram.com/', 'https://www.instagram.com/hearth/', 'https://www.instagram.com/reel/', 'https://www.instagram.com/reel/abc/', 'https://www.instagram.com/reel/C9abc%3Cscript%3E/',
    'https://www.instagram.com/reel/C9abcDEF/extra/more', 'https://www.instagram.com/reel/C9abcDEF/comments/', 'https://www.instagram.com/stories/user/123/', 'https://instagram.com.evil.net/reel/C9abcDEF/',
    `https://www.instagram.com/reel/${'a'.repeat(49)}/`, 'https://www.instagram.com/a/b/reel/C9abcDEF/', 'not a link', '', `https://www.tiktok.com/@a/video/${ID}${'/x'.repeat(1100)}`,
  ].map((u) => [u, null]),
];

test('social: server and app read every TikTok and Instagram link form the same way, and refuse the rest', async () => {
  const C = await clientModule('social.js');
  for (const [url, want] of TABLE) {
    assert.deepEqual(SO.parseSocial(url), want, `server: ${url}`);
    assert.deepEqual(C.parseSocialUrl(url), want, `app: ${url}`);
  }
  // Both sides use the same patterns.
  for (const k of ['TIKTOK_ID', 'TIKTOK_SHORT', 'IG_CODE']) assert.equal(String(SO[k]), String(C[k]), k);
  assert.equal(SO.parseSocial(`https://tiktok.com:8443/@a/video/${ID}`, { anyPort: true }).id, ID, 'ports only for tests');
});

test('social: a player address is built from a checked id only, on exactly two origins', async () => {
  const C = await clientModule('social.js');
  const tt = C.playerSrc({ kind: 'tiktok', id: ID });
  assert.ok(tt.startsWith(`https://www.tiktok.com/player/v1/${ID}?`), tt);
  const q = new URL(tt).searchParams;
  assert.deepEqual([q.get('autoplay'), q.get('rel'), q.get('music_info'), q.get('description'), q.get('native_context_menu')], ['0', '0', '0', '0', '0']);
  assert.equal(new URL(C.playerSrc({ kind: 'tiktok', id: ID }, { autoplay: true })).searchParams.get('autoplay'), '1');
  assert.equal(C.playerSrc({ kind: 'instagram', id: 'C9abc_DEF-1', type: 'reel' }), 'https://www.instagram.com/reel/C9abc_DEF-1/embed/');
  assert.equal(C.playerSrc({ kind: 'instagram', id: 'C9abc_DEF-1', type: 'p' }), 'https://www.instagram.com/p/C9abc_DEF-1/embed/');
  assert.equal(SO.playerSrc('tiktok', ID), `https://www.tiktok.com/player/v1/${ID}`);
  const bad = [
    { kind: 'tiktok', id: '123' }, { kind: 'tiktok', id: `${ID}/../../evil` }, { kind: 'tiktok', id: `${ID}?x=1` }, { kind: 'tiktok', id: 'javascript:alert(1)' },
    { kind: 'tiktok', id: 7234567890123456789 }, // a number loses digits: not an id
    { kind: 'instagram', id: 'C9abc_DEF-1', type: 'stories' }, { kind: 'instagram', id: 'a/b', type: 'reel' }, { kind: 'instagram', id: '//evil.net/x', type: 'reel' },
    { kind: 'youtube', id: ID }, null, {},
  ];
  for (const b of bad) assert.throws(() => C.playerSrc(b), /not a TikTok/, JSON.stringify(b));
  assert.throws(() => SO.playerSrc('instagram', '../x'), /not a TikTok/);
  assert.deepEqual(C.FRAME_ORIGINS, SO.FRAME_ORIGINS);
  // Sandboxed: scripts and popups (which leave the app), never the Hearth tab itself, forms or downloads.
  const sb = C.SOCIAL_SANDBOX.split(' ');
  for (const no of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-forms', 'allow-modals', 'allow-downloads', 'allow-storage-access-by-user-activation']) assert.ok(!sb.includes(no), no);
  assert.ok(sb.includes('allow-scripts') && sb.includes('allow-popups-to-escape-sandbox'));
});

test('social: a player opened earlier stays a placeholder when the word filter blurs its message', async () => {
  // social-embed.js with a stand-in for the page (util.js) and the API: elements are plain objects.
  const { register } = require('node:module');
  const fakes = {
    './util.js': `const el = (tag, props, kids) => ({ tag, props: props || {}, kids, append(...k) { this.kids.push(...k.flat(9).filter(Boolean)); return this; }, classList: { add() {}, remove() {} } });
      export const h = (tag, props, ...kids) => el(tag, props, kids.flat(9).filter(Boolean)); export const clear = (x) => { x.kids = []; return x; }; export const icon = () => null; export const toast = () => {};`,
    './api.js': 'export const api = async () => { throw new Error("no server here"); };',
  };
  const urls = Object.fromEntries(Object.entries(fakes).map(([k, src]) => [k, 'data:text/javascript,' + encodeURIComponent(src)]));
  register('data:text/javascript,' + encodeURIComponent(`const urls = ${JSON.stringify(urls)};
    export async function resolve(spec, ctx, next) {
      if (ctx.parentURL && /\\/social-embed\\.js$/.test(ctx.parentURL) && urls[spec]) return { url: urls[spec], shortCircuit: true };
      return next(spec, ctx);
    }`));
  const SE = await clientModule('social-embed.js');
  const C = await clientModule('social.js');
  const find = (node, test) => (!node || typeof node !== 'object' ? null : test(node) ? node : (node.kids || []).reduce((a, k) => a || find(k, test), null));
  const frameIn = (box) => find(box, (n) => n.tag === 'iframe');
  const p = C.parseSocialUrl(`https://www.tiktok.com/@hearth/video/${ID}`);
  const key = `m1|tiktok:${ID}`;
  const settle = () => new Promise((r) => setTimeout(r, 10));
  // Tapped: the player loads and is remembered for this tab.
  const box = SE.socialEmbedEl(p, { key, mode: 'ask' });
  assert.equal(frameIn(box), null, 'a placeholder until tapped');
  find(box, (n) => n.props && n.props.class === 'soc-play').props.onclick({ currentTarget: {} });
  await settle();
  assert.ok(frameIn(box), 'tapped: the player');
  // Drawn again: it comes back as a player, unless the message is now blurred.
  const again = SE.socialEmbedEl(p, { key, mode: 'ask' });
  await settle();
  assert.ok(frameIn(again));
  const blurred = SE.socialEmbedEl(p, { key, mode: 'ask', blurred: true });
  await settle();
  assert.equal(frameIn(blurred), null, 'blurred: nothing loads from TikTok');
  const always = SE.socialEmbedEl(p, { key: 'm2|x', mode: 'always', blurred: true });
  await settle();
  assert.equal(frameIn(always), null, 'not even with "Always"');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'), /mode: blur \? 'ask' : playerMode\(chat\), blurred: !!blur,/);
});

test('social: links in a message (not in code or spoilers), one each, at most four; TikTok player messages', async () => {
  const C = await clientModule('social.js');
  const text = [
    `look https://www.tiktok.com/@a/video/${ID} and https://www.tiktok.com/embed/v2/${ID} (same one)`,
    'and https://www.instagram.com/reel/C9abc_DEF-1/ also https://vm.tiktok.com/ZMabc123/',
    `\`https://www.tiktok.com/@a/video/${ID2}\` ||https://www.instagram.com/reel/SPOILERcode1/||`,
    'https://www.instagram.com/p/AAAAAAAAAA1/ https://www.instagram.com/p/AAAAAAAAAA2/ https://www.instagram.com/p/AAAAAAAAAA3/',
  ].join('\n');
  const got = C.socialLinks(text);
  assert.deepEqual(got.map((p) => `${p.kind}:${p.id || p.short}`), [`tiktok:${ID}`, 'instagram:C9abc_DEF-1', 'tiktok:ZMabc123', 'instagram:AAAAAAAAAA1']);
  assert.equal(got[0].url, `https://www.tiktok.com/@a/video/${ID}`, 'the link as written, to match its preview card');
  assert.deepEqual(C.socialLinks('nothing here'), []);
  assert.deepEqual(C.tiktokCommand('seekTo', 12), { type: 'seekTo', value: 12, 'x-tiktok-player': true });
  assert.deepEqual(C.readTiktokMessage({ type: 'onStateChange', value: 1, 'x-tiktok-player': true }), { type: 'onStateChange', value: 1 });
  assert.deepEqual(C.readTiktokMessage(JSON.stringify({ type: 'onPlayerReady', 'x-tiktok-player': true })), { type: 'onPlayerReady', value: undefined });
  for (const x of [{ type: 'onStateChange', value: 1 }, { type: 1, 'x-tiktok-player': true }, '{bad json', 'x'.repeat(5000), null, 42]) assert.equal(C.readTiktokMessage(x), null, JSON.stringify(x));
  assert.equal(C.playerMode({ socialPlayers: 'always' }), 'always');
  assert.equal(C.playerMode({ socialPlayers: 'everything' }), 'ask');
  assert.equal(C.playerMode({}), 'ask');
});

// ================================================================== the server
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-social-'));
const NAMES = ['www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'p16-sign.tiktokcdn.com', 'evil.preview-site.net'];
const hits = [];
let port; let tlsServer; let srv;
function site(req, res) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const u = new URL(req.url, 'https://x');
  hits.push(host + u.pathname);
  const go = (to) => { res.writeHead(302, { location: to }); res.end(); };
  const p = u.pathname;
  if (host === 'vm.tiktok.com') {
    if (p === '/ZMgood01/') return go(`https://www.tiktok.com:${port}/@hearth/video/${ID}?_r=1`);
    if (p === '/ZMhop001/') return go(`https://www.tiktok.com:${port}/t/ZThop002/`);
    if (p === '/ZMevil01/') return go(`https://evil.preview-site.net:${port}/@hearth/video/${ID}`);
    if (p === '/ZMloop01/') return go(`https://vm.tiktok.com:${port}/ZMloop01/`);
    if (p === '/ZMjs0001/') return go('javascript:alert(1)');
    if (p === '/ZMprof01/') return go(`https://www.tiktok.com:${port}/@hearth`);
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>not a redirect</html>');
  }
  if (host === 'www.tiktok.com' && p === '/t/ZThop002/') return go(`https://www.tiktok.com:${port}/@hearth/video/${ID2}`);
  if (host === 'www.tiktok.com' && p === '/oembed') {
    const url = u.searchParams.get('url') || '';
    if (url.endsWith(ID)) {
      return res.end(JSON.stringify({ title: 'Dancing <b>cat</b> &amp; friends', author_name: 'Hearth', thumbnail_url: `https://p16-sign.tiktokcdn.com:${port}/obj/cat.jpeg?x-expires=1` }));
    }
    if (url.endsWith(ID2)) return res.end(JSON.stringify({ title: 'Elsewhere', author_name: 'X', thumbnail_url: `https://evil.preview-site.net:${port}/pic.jpeg` }));
    res.writeHead(404); return res.end();
  }
  if (host === 'p16-sign.tiktokcdn.com' || host === 'evil.preview-site.net') {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x00, 0x90, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.from([0xff, 0xd9])]);
    res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(jpeg);
  }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><title>A TikTok page</title></head></html>');
}
const PRELOAD = path.join(work, 'fake-dns.js');
fs.writeFileSync(PRELOAD, `
const ng = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'netguard.js'))});
const map = JSON.parse(process.env.FAKE_DNS || '{}');
ng.setResolver(async (host) => {
  const entry = map[host.toLowerCase()];
  if (!entry) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  return entry.map((address) => ({ address, family: 4 }));
});
`);
const as = (u, method, p, body) => srv.api(method, p, { token: u.token, ip: u.ip, body });

before(async () => {
  const selfsigned = require('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'www.tiktok.com' }], { keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: NAMES.map((value) => ({ type: 2, value })) }] });
  fs.writeFileSync(path.join(work, 'ca.pem'), pems.cert);
  tlsServer = https.createServer({ key: pems.private, cert: pems.cert }, site);
  await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
  port = tlsServer.address().port;
  srv = await startServer({
    NODE_OPTIONS: `--require ${PRELOAD}`, FAKE_DNS: JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, ['127.0.0.1']]))), NODE_EXTRA_CA_CERTS: path.join(work, 'ca.pem'),
    NO_PROXY: '*', no_proxy: '*', LINK_PREVIEW_ALLOW_PRIVATE: NAMES.join(','), LINK_PREVIEW_TIMEOUT_MS: '4000', LINK_PREVIEW_TIKTOK_OEMBED: `https://www.tiktok.com:${port}/oembed`,
    TURN_SECRET: 'test-secret', TURN_URL: 'turn:relay.example.test:3478?transport=udp',
  });
});
after(async () => {
  await srv.stop();
  try { tlsServer.closeAllConnections(); } catch { /* older Node */ }
  await new Promise((r) => tlsServer.close(() => r()));
  fs.rmSync(work, { recursive: true, force: true });
});

test('social: the page lets frames come from exactly TikTok’s and Instagram’s player hosts, nothing broader', async () => {
  const r = await fetch(srv.base + '/');
  const csp = r.headers.get('content-security-policy');
  const frame = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-src ')).split(/\s+/).slice(1);
  for (const o of SO.FRAME_ORIGINS) assert.ok(frame.includes(o), o);
  for (const src of frame) assert.ok(!/\*|^https:$|^data:|^blob:|tiktok\.com\/|instagram\.com\//.test(src), `frame-src ${src}`);
  assert.ok(!frame.some((x) => /tiktokcdn|cdninstagram|fbcdn/.test(x)));
  assert.match(csp, /frame-ancestors 'none'/);
});

test('social: a short TikTok link is looked up hop by hop, only on TikTok’s names, without fetching the video page', async () => {
  const u = await srv.register();
  const L = (code, host = 'vm.tiktok.com') => `https://${host}:${port}/${code}/`;
  const r = await as(u, 'POST', '/social/resolve', { url: L('ZMgood01') });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { kind: 'tiktok', id: ID, link: `https://www.tiktok.com/@hearth/video/${ID}` });
  assert.equal(hits.filter((h) => h.startsWith('www.tiktok.com/@hearth')).length, 0, 'the video page itself is never fetched');
  assert.equal((await as(u, 'POST', '/social/resolve', { url: L('ZMhop001') })).json.id, ID2, 'a short link that goes through tiktok.com/t/');
  const before = hits.filter((h) => h.startsWith('evil.')).length;
  for (const code of ['ZMevil01', 'ZMloop01', 'ZMjs0001', 'ZMprof01', 'ZMnone01']) {
    const x = await as(u, 'POST', '/social/resolve', { url: L(code) });
    assert.equal(x.status, 404, `${code}: ${x.text}`);
  }
  assert.equal(hits.filter((h) => h.startsWith('evil.')).length, before, 'another site is never contacted');
  // A full link needs no lookup; anything else is refused before anything is fetched.
  assert.deepEqual((await as(u, 'POST', '/social/resolve', { url: 'https://www.instagram.com/reel/C9abc_DEF-1/' })).json, { kind: 'instagram', id: 'C9abc_DEF-1', type: 'reel', link: 'https://www.instagram.com/reel/C9abc_DEF-1/' });
  for (const url of ['https://example.org/x', `https://evil.preview-site.net:${port}/ZMgood01/`, 'javascript:alert(1)', 42, null, 'x'.repeat(3000)]) {
    assert.equal((await as(u, 'POST', '/social/resolve', { url })).status, 400, String(url).slice(0, 40));
  }
  assert.equal((await srv.api('POST', '/social/resolve', { body: { url: L('ZMgood01') } })).status, 401, 'signed in only');
});

test('social: a TikTok link’s preview comes from oEmbed, its picture only from TikTok’s picture hosts', async () => {
  const u = await srv.register();
  const p = (await as(u, 'POST', '/link-previews', { url: `https://www.tiktok.com:${port}/@hearth/video/${ID}` })).json.preview;
  assert.equal(p.title, 'Dancing cat & friends');
  assert.equal(p.description, 'Hearth');
  assert.equal(p.siteName, 'TikTok');
  assert.equal(p.kind, 'video');
  assert.equal(p.image && p.image.height, 256);
  const q = (await as(u, 'POST', '/link-previews', { url: `https://vm.tiktok.com:${port}/ZMhop001/` })).json.preview;
  assert.equal(q.title, 'Elsewhere', 'a short link is looked up first');
  assert.equal(q.image, null, 'a picture from anywhere else is left out');
  assert.equal(hits.filter((h) => h.startsWith('evil.')).length, 0);
});

// ================================================================== watch together
const socks = [];
const ack = (s, ev, p, ms = 5000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.emit(ev, p, (x) => { clearTimeout(t); r(x); }); });
const sock = async (u) => { const s = await srv.socket(u.token); socks.push(s); return s; };
after(() => socks.forEach((s) => s.close()));

test('social: watch together plays TikTok in step and Instagram as "start together", with a ready check and side by side', async () => {
  const owner = await srv.register(); const guest = await srv.register();
  const server = (await as(owner, 'POST', '/servers', { name: 'Watch ' + hex(3) })).json;
  const invite = (await as(owner, 'POST', `/servers/${server.id}/invites`, {})).json;
  assert.equal((await as(guest, 'POST', `/invites/${invite.code}/join`)).status, 200);
  const voiceCh = server.channels.find((c) => c.type === 'voice');
  const so = await sock(owner); const sg = await sock(guest);
  let state = null;
  so.on('watch:state', (x) => { state = x.state; });
  for (const s of [so, sg]) assert.equal((await ack(s, 'voice:join', { channelId: voiceCh.id })).ok, true);
  const settle = () => sleep(350);

  assert.equal((await ack(so, 'watch:start', { url: `https://www.tiktok.com/@hearth/video/${ID}?lang=en` })).ok, true);
  await settle();
  assert.deepEqual([state.item.kind, state.item.src, state.item.link, state.playing, !!state.item.manual], ['tiktok', ID, `https://www.tiktok.com/@hearth/video/${ID}`, true, false]);
  assert.match((await ack(so, 'watch:start', { url: 'https://vm.tiktok.com/ZMabc123/', queue: true })).error, /short TikTok link/);
  assert.match((await ack(so, 'watch:start', { url: 'https://www.tiktok.com/@hearth', queue: true })).error, /one TikTok video/);
  assert.equal((await ack(so, 'watch:start', { url: 'https://www.instagram.com/reel/C9abc_DEF-1/', queue: true })).ok, true, 'a queue mixing both');
  await settle();
  assert.deepEqual(state.queue.map((q) => [q.kind, q.src, q.postType, q.manual]), [['instagram', 'C9abc_DEF-1', 'reel', true]]);

  // Side by side: a second upright video, both paused until "play" starts a countdown for both.
  assert.equal((await ack(so, 'watch:side', { url: 'https://www.instagram.com/p/CAbcdEfgh12/' })).ok, true);
  await settle();
  assert.deepEqual([state.side.kind, state.side.src, state.side.postType, state.playing], ['instagram', 'CAbcdEfgh12', 'p', false]);
  assert.match((await ack(so, 'watch:side', { url: 'https://x.example/movie.mp4' })).error, /Side by side/);
  const t0 = Date.now();
  assert.equal((await ack(so, 'watch:control', { action: 'play', position: 0, itemId: state.item.id })).ok, true);
  await settle();
  assert.equal(state.playing, true);
  assert.ok(state.startAt >= t0 + 2500 && state.startAt <= Date.now() + 3100, 'a 3-second countdown');
  assert.equal(state.updatedAt, state.startAt, 'the shared clock starts when the countdown ends');
  const counted = state.startAt;
  assert.equal((await ack(so, 'watch:control', { action: 'seek', position: 7, itemId: state.item.id })).ok, true);
  await settle();
  assert.deepEqual([state.startAt, state.updatedAt, state.position], [counted, counted, 7], 'a seek during the countdown keeps it');
  assert.equal((await ack(so, 'watch:side', { url: null })).ok, true);
  await settle();
  assert.equal(state.side, null);

  // Next: the reel. Instagram can't be controlled, so it waits paused for "start together".
  assert.equal((await ack(so, 'watch:next', { itemId: state.item.id, skip: true })).ok, true);
  await settle();
  assert.deepEqual([state.item.kind, state.item.manual, state.playing, state.startAt, state.ready], ['instagram', true, false, 0, []]);
  const reel = state.item.id;
  assert.equal((await ack(sg, 'watch:ready', { itemId: reel })).ok, true);
  await settle();
  assert.deepEqual(state.ready, [guest.id]);
  assert.equal((await ack(sg, 'watch:ready', { itemId: 'an-older-one' })).ok, true);
  assert.equal((await ack(so, 'watch:ready', { itemId: reel })).ok, true);
  await settle();
  assert.deepEqual(state.ready.sort(), [owner.id, guest.id].sort());
  assert.equal((await ack(sg, 'watch:ready', { itemId: reel, ready: false })).ok, true);
  await settle();
  assert.deepEqual(state.ready, [owner.id]);
  assert.equal((await ack(so, 'watch:control', { action: 'play', position: 0, itemId: reel })).ok, true);
  await settle();
  assert.ok(state.playing && state.startAt > Date.now(), 'start together');
  // Who controls changes nothing about where the video is.
  const at = [state.position, state.updatedAt, state.startAt];
  assert.equal((await ack(so, 'watch:control', { action: 'hostOnly', value: true })).ok, true);
  await settle();
  assert.deepEqual([state.position, state.updatedAt, state.startAt], at);
  assert.equal(state.hostOnly, true);
  assert.match((await ack(sg, 'watch:side', { url: `https://www.tiktok.com/@hearth/video/${ID}` })).error, /host/);
  // A guest's "I'm done" counts once most of the call says so (two of two here).
  assert.equal((await ack(sg, 'watch:next', { itemId: reel })).ok, true);
  await settle();
  assert.equal(state.item.id, reel, 'one of two is not most');
  assert.equal((await ack(so, 'watch:next', { itemId: reel })).ok, true);
  await settle();
  assert.equal(state.playing, false, 'the queue is empty: it stops');
  assert.equal((await ack(so, 'watch:stop', {})).ok, true);
});

test('social: adding watch-together videos is limited per person, and titles are looked up only within the link-preview rules', async () => {
  const owner = await srv.register();
  const server = (await as(owner, 'POST', '/servers', { name: 'Flood ' + hex(3) })).json;
  const voiceCh = server.channels.find((c) => c.type === 'voice');
  const so = await sock(owner);
  assert.equal((await ack(so, 'voice:join', { channelId: voiceCh.id })).ok, true);
  assert.equal((await ack(so, 'watch:start', { url: `https://www.tiktok.com/@hearth/video/${ID}` })).ok, true);
  let refused = null;
  for (let i = 0; i < 25 && !refused; i++) {
    const r = await ack(so, 'watch:side', { url: `https://www.tiktok.com/@hearth/video/72${String(i).padStart(17, '0')}` });
    if (!r.ok) refused = { i, error: r.error };
  }
  assert.ok(refused, 'a flood of side videos is cut off');
  assert.equal(refused.i, 19, 'twenty a minute, watch:start included');
  assert.match(refused.error, /Too many/);
  assert.match((await ack(so, 'watch:start', { url: `https://www.tiktok.com/@hearth/video/${ID2}`, queue: true })).error, /Too many/, 'shared with watch:start');
  await ack(so, 'watch:stop', {});
  // The title lookup: through netguard with a size cap, skipped when link previews are off or past the 'lpf:' budget.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function watchTitle('), src.indexOf('// ready: who in the call said'));
  assert.doesNotMatch(fn, /await fetch\(/);
  assert.match(fn, /netguard\.request\(api, \{[\s\S]*maxBytes: WATCH_TITLE_MAX_BYTES/);
  assert.match(fn, /features\(\)\.linkPreviews === false\) return ''/);
  assert.match(fn, /hitsSoFar\('lpf:' \+ uid\) >= 100\) return ''/);
});
