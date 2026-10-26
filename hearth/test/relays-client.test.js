// Member relays on the client (public/js/relays.js, public/js/voice.js): someone who avoids relays run by members
// (Settings → Privacy & safety, memberRelays: 'avoid') never measures one, never gets an address on one, and drops the
// other side's network candidates on one, so nothing from their device reaches a member's machine. Someone who uses
// them always keeps one of the owner's relays among the two they offer, so the two can still call each other.
// The call engine runs on a fake WebRTC, as in voice-hardening.test.js.
const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

let R; let Voice;
before(async () => {
  R = await clientModule('relays.js');
  ({ Voice } = await clientModule('voice.js'));
});

// What GET /api/ice hands out: STUN, the main relay, an owner region, and member relays (community: true).
const STUN = { urls: ['stun:stun.example.test:3478'] };
const MAIN = { urls: ['turn:relay.example.test:3478?transport=udp'], username: 'm', credential: 'x', expiresAt: 9e12 };
const owner = (id, ip) => ({ urls: [`turn:${ip}:3478?transport=udp`, `turn:${ip}:3478?transport=tcp`], username: 'o', credential: 'x', region: 'Region ' + id, regionId: id, expiresAt: 9e12 });
const member = (id, host) => ({ urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username: 'p', credential: 'x', region: 'Member ' + id, regionId: id, expiresAt: 9e12, community: true });
const FRA = owner('fra', '198.51.100.10');
const NYC = owner('nyc', '198.51.100.20');
const PI = member('pi', '203.0.113.7');
const VPS = member('vps', '[2001:DB8::7]');
const PC = member('pc', '192.0.2.44');
const ALL = [STUN, MAIN, FRA, NYC, PI, VPS, PC];
// What someone who avoids member relays is given instead: every one that's up, where it is and no login.
const bare = (e) => { const { username: _u, credential: _c, expiresAt: _x, ...rest } = e; return rest; };
const AVOIDING = [STUN, MAIN, FRA, NYC, bare(PI), bare(VPS), bare(PC), bare(member('new', '203.0.113.90'))];
// Ranks as rankRelays stores them ("<region|urls>": ms, or null for no answer).
const rank = (pairs) => Object.fromEntries(pairs.map(([e, ms]) => [`${e.region || ''}|${[].concat(e.urls).join(',')}`, ms]));
const relaysIn = (ice) => (Array.isArray(ice) ? ice : ice.iceServers).filter((e) => [].concat(e.urls).some((u) => /^turns?:/.test(u)));
const urlsOf = (ice) => relaysIn(ice).map((e) => [].concat(e.urls)[0]);
const first = (e) => [].concat(e.urls)[0];

test('isMemberRelay, avoidsMemberRelays and usableIce', () => {
  assert.equal(R.isMemberRelay(PI), true);
  assert.equal(R.isMemberRelay(FRA), false);
  assert.equal(R.isMemberRelay({ ...FRA, community: 'true' }), false, 'only the server’s own true counts');
  assert.equal(R.isMemberRelay(null), false);
  assert.equal(R.avoidsMemberRelays({ privacy: { memberRelays: 'avoid' } }), true);
  assert.equal(R.avoidsMemberRelays({ privacy: { memberRelays: 'use' } }), false);
  assert.equal(R.avoidsMemberRelays({ privacy: {} }), false, 'default: use them');
  assert.equal(R.avoidsMemberRelays({}), false);
  assert.equal(R.avoidsMemberRelays(null), false);
  assert.deepEqual(R.usableIce(ALL, true), [STUN, MAIN, FRA, NYC]);
  assert.deepEqual(R.usableIce(ALL, false), ALL);
  assert.notEqual(R.usableIce(ALL, false), ALL, 'a copy, never the list itself');
  assert.deepEqual(R.usableIce(undefined, true), []);
  assert.equal(ALL.length, 7, 'the list given is left as it was');
});

test('memberRelayHosts: the machines of member relays only, IPv4 and IPv6 (brackets dropped, however it’s written)', () => {
  const hosts = R.memberRelayHosts(ALL);
  assert.equal(hosts.size, 3, 'one per machine (UDP and TCP are the same machine), and never an owner relay');
  assert.ok(hosts.has('203.0.113.7'));
  assert.ok(hosts.has('192.0.2.44'));
  assert.ok(!hosts.has('198.51.100.10') && !hosts.has('relay.example.test'));
  assert.ok(![...hosts].some((x) => x.includes('[') || x.includes(']')), 'IPv6 without brackets');
  // The same IPv6 address written three ways is one machine.
  const v6 = R.memberRelayHosts([member('a', '[2001:db8::7]'), member('b', '[2001:0DB8:0:0:0:0:0:0007]'), member('c', '[2001:db8:0::7]')]);
  assert.equal(v6.size, 1);
  const more = R.memberRelayHosts([member('d', 'Relay.Example.ORG'), { urls: 'turns:[::1]:5349?transport=tcp', community: true }, { urls: ['stun:203.0.113.99'], community: true }]);
  assert.equal(more.size, 2, 'turns: too, and a single url; STUN isn’t a relay address');
  assert.ok(more.has('relay.example.org'));
  assert.equal(R.memberRelayHosts(undefined).size, 0);
  assert.equal(R.memberRelayHosts([FRA, MAIN]).size, 0);
});

test('dropAvoidedCandidates: drops the other side’s candidates on an avoided machine, by connection address only', () => {
  const hosts = R.memberRelayHosts(ALL);
  const cand = (addr, extra = 'typ relay raddr 100.64.0.1 rport 50000') => ({ candidate: `candidate:842163049 1 udp 1677729535 ${addr} 50123 ${extra} generation 0 ufrag Ab12`, sdpMid: '0', sdpMLineIndex: 0 });
  assert.equal(R.dropAvoidedCandidates(cand('203.0.113.7'), hosts), null, 'relayed on a member relay');
  assert.equal(R.dropAvoidedCandidates(cand('2001:db8::7'), hosts), null, 'IPv6, as browsers write it');
  assert.equal(R.dropAvoidedCandidates(cand('2001:DB8:0:0::7'), hosts), null, 'IPv6, written longer');
  assert.equal(R.dropAvoidedCandidates(cand('192.0.2.44', 'typ srflx raddr 10.0.0.2 rport 1'), hosts), null, 'any candidate on that machine: nothing is sent there');
  assert.equal(R.dropAvoidedCandidates({ candidate: 'a=candidate:1 1 tcp 1518280447 203.0.113.7 9 typ relay tcptype passive', sdpMid: '0' }, hosts), null, 'TCP, and the SDP-line form');
  const kept = cand('198.51.100.10');
  assert.equal(R.dropAvoidedCandidates(kept, hosts), kept, 'an owner relay’s candidate stays, as it was');
  const viaRelated = cand('198.51.100.10', 'typ relay raddr 203.0.113.7 rport 3478');
  assert.equal(R.dropAvoidedCandidates(viaRelated, hosts), viaRelated, 'the related address is where it came from, not where packets go');
  const mdns = cand('3f1c2a9e-1b7d-4f9e-9c3a-7d2e8b6a0f11.local', 'typ host');
  assert.equal(R.dropAvoidedCandidates(mdns, hosts), mdns);
  const end = { candidate: '', sdpMid: '0' };
  assert.equal(R.dropAvoidedCandidates(end, hosts), end, 'end of candidates');
  // Nothing avoided: everything passes, untouched.
  assert.equal(R.dropAvoidedCandidates(cand('203.0.113.7').candidate, new Set()), cand('203.0.113.7').candidate);
  const c = cand('203.0.113.7');
  assert.equal(R.dropAvoidedCandidates(c, new Set()), c);
  assert.equal(R.dropAvoidedCandidates(c, null), c);
  assert.equal(R.dropAvoidedCandidates(null, hosts), null);
  assert.equal(R.dropAvoidedCandidates(c, new Set(['2001:0db8::7'.toUpperCase(), '203.0.113.7'])), null, 'hosts given in any form');
});

test('dropAvoidedCandidates on SDP: only the avoided a=candidate lines go, everything else byte for byte', () => {
  const hosts = R.memberRelayHosts(ALL);
  const lines = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0 1',
    'm=audio 50123 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 203.0.113.7',
    'a=candidate:1 1 udp 2122260223 3f1c2a9e.local 54400 typ host generation 0',
    'a=candidate:2 1 udp 1686052607 198.51.100.77 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0',
    'a=candidate:3 1 udp 41885439 203.0.113.7 50123 typ relay raddr 198.51.100.77 rport 54400 generation 0',
    'a=candidate:4 1 udp 41885439 2001:db8::7 50999 typ relay raddr :: rport 0 generation 0',
    'a=candidate:5 1 udp 41885439 198.51.100.10 61000 typ relay raddr 198.51.100.77 rport 54400 generation 0',
    'a=ice-ufrag:Ab12', 'a=fingerprint:sha-256 AA:BB:CC', 'a=setup:actpass', 'a=mid:0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=candidate:6 1 tcp 1518280447 192.0.2.44 9 typ host tcptype active', 'a=end-of-candidates', 'a=mid:1',
  ];
  const sdp = lines.join('\r\n') + '\r\n';
  const out = R.dropAvoidedCandidates(sdp, hosts);
  const want = lines.filter((l) => !/^a=candidate:[346] /.test(l)).join('\r\n') + '\r\n';
  assert.equal(out, want);
  assert.ok(out.includes('c=IN IP4 203.0.113.7'), 'only candidate lines are touched');
  // Last line without a line break, and \n-only SDP.
  assert.equal(R.dropAvoidedCandidates('v=0\na=mid:0\na=candidate:3 1 udp 1 203.0.113.7 5 typ relay', hosts), 'v=0\na=mid:0\n');
  // A description: a new object only when something was dropped.
  const desc = { type: 'offer', sdp };
  const stripped = R.dropAvoidedCandidates(desc, hosts);
  assert.deepEqual(stripped, { type: 'offer', sdp: want });
  assert.equal(desc.sdp, sdp, 'what arrived is left as it was (its signature was checked on it)');
  const clean = { type: 'answer', sdp: want };
  assert.equal(R.dropAvoidedCandidates(clean, hosts), clean);
  assert.equal(R.dropAvoidedCandidates(desc, new Set()), desc);
});

test('chooseIce with avoid: member relays are left out before anything is picked, and never reach WebRTC', () => {
  // Member relays answered fastest; avoiding, the two fastest of the owner's are used.
  const ranks = rank([[PI, 5], [PC, 6], [VPS, 7], [NYC, 40], [MAIN, 30], [FRA, 20]]);
  const avoid = R.chooseIce(ALL, ranks, null, { avoid: true });
  assert.deepEqual(urlsOf(avoid), [first(FRA), first(MAIN)]);
  assert.deepEqual(avoid[0], STUN, 'STUN stays');
  // Unmeasured, or two relays or fewer after leaving them out: every owner relay, still no member relay.
  assert.deepEqual(urlsOf(R.chooseIce(ALL, null, null, { avoid: true })), [first(MAIN), first(FRA), first(NYC)]);
  assert.deepEqual(urlsOf(R.chooseIce([STUN, MAIN, PI, PC, VPS], rank([[PI, 1], [PC, 2], [VPS, 3], [MAIN, 50]]), null, { avoid: true })), [first(MAIN)]);
  assert.deepEqual(urlsOf(R.chooseIce([STUN, PI, PC], null, null, { avoid: true })), [], 'no owner relay: no relay at all, never a member’s');
  // Not avoiding: the fastest are used, as before (the swap rule aside, below).
  assert.deepEqual(urlsOf(R.chooseIce(ALL, rank([[PI, 5], [FRA, 6], [PC, 7], [MAIN, 30]]))), [first(PI), first(FRA)]);
  // Nothing WebRTC doesn't know goes to it.
  for (const ice of [R.chooseIce(ALL, ranks), R.chooseIce(ALL, null), R.chooseIce(ALL, null, 'fra'), avoid]) {
    for (const e of Array.isArray(ice) ? ice : ice.iceServers) for (const k of ['community', 'region', 'regionId', 'expiresAt']) assert.equal(k in e, false, k);
  }
  // A call region is the owner's: one that names a member relay (the server refuses those) is automatic.
  assert.ok(Array.isArray(R.chooseIce(ALL, ranks, 'pi')), 'not pinned to a member relay');
  assert.deepEqual(R.chooseIce(ALL, ranks, 'fra', { avoid: true }).iceTransportPolicy, 'relay');
});

test('the swap rule: two member relays as the fastest make way for the fastest owner relay that answered', () => {
  // Both fastest are member relays: the slower of the two makes way for the fastest owner relay.
  assert.deepEqual(urlsOf(R.chooseIce(ALL, rank([[PI, 5], [PC, 6], [VPS, 7], [NYC, 40], [MAIN, 30], [FRA, 20]]))), [first(PI), first(FRA)]);
  // Only one of them is a member relay: nothing to swap.
  assert.deepEqual(urlsOf(R.chooseIce(ALL, rank([[PI, 5], [MAIN, 6], [PC, 7], [FRA, 20]]))), [first(PI), first(MAIN)]);
  // No owner relay answered: the two member relays (an avoider couldn't use an owner relay of ours anyway).
  assert.deepEqual(urlsOf(R.chooseIce(ALL, rank([[PI, 5], [PC, 6], [MAIN, null], [FRA, null]]))), [first(PI), first(PC)]);
  // Only one relay answered at all, a member relay: that one.
  assert.deepEqual(urlsOf(R.chooseIce(ALL, rank([[PI, 5], [PC, null], [MAIN, null]]))), [first(PI)]);

  // An avoider and someone who uses member relays, over many measurements: whenever any of the owner's relays
  // answered the user, the relays the user offers include one that the avoider keeps, and the avoider is never
  // given a member relay.
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const relays = [MAIN, FRA, NYC, PI, VPS, PC, member('x', '203.0.113.80'), member('y', '203.0.113.81')];
  const memberUrls = new Set(relays.filter(R.isMemberRelay).map(first));
  let swapped = 0;
  for (let i = 0; i < 500; i++) {
    const ranks = rank(relays.map((e) => [e, rand() < 0.25 ? null : Math.round(rand() * 200)]));
    const user = relaysIn(R.chooseIce([STUN, ...relays], ranks)).map(first);
    const avoider = relaysIn(R.chooseIce([STUN, ...relays], ranks, null, { avoid: true })).map(first);
    assert.ok(!avoider.some((u) => memberUrls.has(u)), `run ${i}: the avoider is never given a member relay`);
    const ownerAnswered = relays.some((e) => !R.isMemberRelay(e) && typeof R.relayTime(ranks, e) === 'number');
    if (ownerAnswered) assert.ok(user.some((u) => !memberUrls.has(u)), `run ${i}: an owner relay is offered`);
    const fastest = relays.filter((e) => typeof R.relayTime(ranks, e) === 'number').sort((a, b) => R.relayTime(ranks, a) - R.relayTime(ranks, b)).slice(0, 2);
    if (ownerAnswered && fastest.length === 2 && fastest.every(R.isMemberRelay)) swapped++;
  }
  assert.ok(swapped > 20, `the runs include plenty where the swap was needed (${swapped})`);
});

// A fake WebRTC that only measures: a relay "answers" with a relay candidate right away. Every relay asked is noted.
const asked = [];
class ProbePC {
  constructor(config) { this.config = config; asked.push(...[].concat(config.iceServers).flatMap((e) => [].concat(e.urls))); }
  createDataChannel() {}
  async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
  async setLocalDescription() { setTimeout(() => this.onicecandidate && this.onicecandidate({ candidate: { candidate: 'candidate:1 1 udp 1 198.51.100.200 50000 typ relay raddr 0.0.0.0 rport 0' } }), 1); }
  close() {}
}

test('an avoider never measures a member relay: what the app passes rankRelays is usableIce', async () => {
  globalThis.RTCPeerConnection = ProbePC;
  asked.length = 0;
  store.clear();
  const memberUrls = ALL.filter(R.isMemberRelay).flatMap((e) => e.urls);
  const ranks = await R.rankRelays(R.usableIce(ALL, true), { force: true });
  assert.deepEqual([...new Set(asked)], [MAIN, FRA, NYC].flatMap((e) => e.urls), 'the owner’s relays were measured, and nothing else');
  assert.ok(!asked.some((u) => memberUrls.includes(u)), 'no member relay was contacted');
  assert.equal(Object.keys(ranks).length, 3);
  // Someone who uses them measures them too.
  asked.length = 0;
  await R.rankRelays(R.usableIce(ALL, false), { force: true });
  assert.ok(memberUrls.every((u) => asked.includes(u)));
});

test('a member relay without a login (what an avoider is given) never reaches WebRTC and is never measured, even after switching back', async () => {
  // Still known as a member relay's machine, so the other side's addresses there are dropped.
  const hosts = R.memberRelayHosts(AVOIDING);
  assert.equal(hosts.size, 4);
  for (const addr of ['203.0.113.90', '203.0.113.7', '2001:db8::7']) assert.equal(R.dropAvoidedCandidates(candAt(addr), hosts), null, addr);
  // Left out whichever way the choice is now (it can be back to using them before new logins come).
  for (const avoid of [true, false]) assert.deepEqual(R.usableIce(AVOIDING, avoid), [STUN, MAIN, FRA, NYC], `avoid: ${avoid}`);
  assert.deepEqual(R.usableIce([{ ...PI, credential: '' }, { ...PC, username: undefined }], false), [], 'half a login is no login');
  assert.deepEqual(R.usableIce([PI, bare(PC)], false), [PI], 'a member relay with a login is still used by someone who uses them');
  const memberUrls = new Set(AVOIDING.filter(R.isMemberRelay).flatMap((e) => e.urls));
  const fast = rank([[PI, 1], [VPS, 2], [PC, 3], [FRA, 20], [NYC, 30], [MAIN, 40]].map(([e, ms]) => [R.isMemberRelay(e) ? bare(e) : e, ms]));
  for (const avoid of [true, false]) {
    for (const ice of [R.chooseIce(AVOIDING, fast, null, { avoid }), R.chooseIce(AVOIDING, null, null, { avoid }), R.chooseIce(AVOIDING, fast, 'pi', { avoid })]) {
      const list = Array.isArray(ice) ? ice : ice.iceServers;
      assert.ok(!list.some((e) => [].concat(e.urls).some((u) => memberUrls.has(u))), `avoid: ${avoid}`);
      assert.ok(list.every((e) => !/^turns?:/.test([].concat(e.urls)[0]) || (e.username && e.credential)), 'every relay handed over has a login');
    }
  }
  // Measuring: rankRelays leaves them out even when it's handed the whole list, and measureRelay never contacts one.
  globalThis.RTCPeerConnection = ProbePC;
  asked.length = 0;
  const ranks = await R.rankRelays(AVOIDING, { force: true });
  assert.deepEqual([...new Set(asked)], [MAIN, FRA, NYC].flatMap((e) => e.urls));
  assert.equal(Object.keys(ranks).length, 3);
  asked.length = 0;
  assert.equal(await R.measureRelay(bare(PI)), null);
  assert.deepEqual(asked, [], 'no connection made for it');
  // Settings → Calls "Test the relay" and Admin → Regions "Measure from this device" go through usableIce too.
  assert.match(read('public', 'js', 'settings.js'), /async function testRelay\(out, app\) \{\n[^\n]*\n  try \{\n    const ice = usableIce\(await api\('GET', '\/ice'\), avoidsMemberRelays\(app && app\.S && app\.S\.me\)\)\.filter\(/);
  assert.match(read('public', 'js', 'admin.js'), /const ice = usableIce\(await api\('GET', '\/ice'\), avoidsMemberRelays\(me\(\)\)\);\n {6}const ranks = await rankRelays\(ice, \{ force: true \}\);/);
});

// The relay list as app.js keeps it (freshIce, bootIce, iceBeforeCall, iceChanged, followRelayChoice), run on its own with
// a fake api, call, clock and timers. voice: a call engine (a stand-in, or a real Voice on a fake WebRTC).
// clock.t is the time that only moves forward (performance.now); clock.wall is how far the device's clock (Date.now) has
// been set away from it.
function appIce({ S, api, voice, rankRelays }) {
  const src = read('public', 'js', 'app.js');
  const start = src.indexOf('// Relay logins run out 12 to 18 hours');
  const end = src.indexOf('\n// When this server switched on end-to-end encryption', start);
  assert.ok(start > 0 && end > start, 'the relay list block');
  assert.match(src, /\n {2}const asked = Date\.now\(\);\n {2}const askedAt = performance\.now\(\);[^\n]*\n {2}const b = await api\('GET', '\/bootstrap'\);\n/);
  assert.match(src, /\n {2}bootIce\(b\.iceServers, askedAt\);\n {2}setTimeout\(\(\) => rankNearest\(\), 4000\);\n/, 'the bootstrap takes the list like any other, and measures in the background');
  const clock = { t: 1.7e12, wall: 0 };
  const timers = []; const later = [];
  const out = new Function('S', 'api', 'voice', 'iceStale', 'avoidsMemberRelays', 'usableIce', 'rankRelays', 'isRelay', 'isMemberRelay', 'memberRelayHosts', 'setInterval', 'setTimeout', 'Date', 'performance',
    `${src.slice(start, end)}\nreturn { freshIce, iceBeforeCall, iceChanged, followRelayChoice, bootIce };`)(
    S, api, voice, R.iceStale, R.avoidsMemberRelays, R.usableIce, rankRelays, R.isRelay, R.isMemberRelay, R.memberRelayHosts,
    (fn, ms) => timers.push({ fn, ms }), (fn, ms) => { later.push({ fn, ms }); return later.length; }, { now: () => clock.t + clock.wall }, { now: () => clock.t });
  // The bootstrap: the list, asked for now (or at `at`).
  return { ...out, boot: (b, at = clock.t) => out.bootIce(b.iceServers, at), clock, timers, later };
}
// A call engine stand-in that writes down what it's asked.
const fakeVoice = (S) => {
  const v = { updates: [], followed: [], avoided: 0 };
  return Object.assign(v, { updateIceServers: () => v.updates.push(S.iceServers), followMemberRelays: (listed) => v.followed.push([...listed].sort()), avoidChanged: () => { v.avoided++; } });
};
const hostsOf = (list) => [...R.memberRelayHosts(list)].sort();

test('app.js: turning avoiding on or off fetches the relay list at once, a call starts over without member relays, and the relays are measured again', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const fetched = []; const ranked = [];
  let answer = () => Promise.resolve(ALL);
  const voice = fakeVoice(S);
  const A = appIce({
    S, api: (method, p) => { fetched.push(`${method} ${p}`); return answer(); }, voice,
    rankRelays: async (list, opts) => { ranked.push({ list, opts }); return {}; },
  });
  A.boot({ iceServers: ALL });
  assert.equal(A.timers.length, 1);
  assert.equal(A.timers[0].ms, 60000, 'the background check, every minute');
  assert.equal(voice.avoided, 0, 'the first list starts nothing over');
  voice.updates.length = 0; voice.followed.length = 0;
  await A.freshIce(); await A.iceBeforeCall(); A.followRelayChoice();
  assert.deepEqual(fetched, [], 'nothing to fetch: the list is new, and for this choice');
  // Turned on, here (Settings) or on another device (user:update): fetched right away, once.
  S.me.privacy = { memberRelays: 'avoid' };
  answer = () => Promise.resolve(AVOIDING);
  A.followRelayChoice(); A.followRelayChoice();
  await sleep(5);
  assert.deepEqual(fetched, ['GET /ice']);
  assert.equal(S.iceServers, AVOIDING);
  assert.deepEqual(voice.updates, [AVOIDING], 'a call in progress gets it');
  assert.deepEqual(voice.followed, [hostsOf(AVOIDING)], 'and the member relays in it, to follow');
  assert.equal(voice.avoided, 1, 'every connection that may use one starts over, telling the others');
  assert.equal(ranked.length, 1);
  assert.deepEqual(ranked[0].opts, { force: true }, 'measured again now');
  assert.deepEqual(ranked[0].list, [STUN, MAIN, FRA, NYC], 'and never a member relay');
  // Before a call, an avoider's list is fetched again once it's over 10 minutes old (relays approved since).
  fetched.length = 0;
  A.clock.t += 9 * 60000;
  await A.iceBeforeCall();
  assert.deepEqual(fetched, []);
  A.clock.t += 2 * 60000;
  await A.iceBeforeCall();
  assert.deepEqual(fetched, ['GET /ice']);
  // Switched back to using them, and the fetch fails: the list in hand has no login for a member relay, so none is
  // used meanwhile; the next check fetches it again even though it isn't running out.
  fetched.length = 0; voice.updates.length = 0; voice.followed.length = 0;
  S.me.privacy = { memberRelays: 'use' };
  answer = () => Promise.reject(new Error('offline'));
  A.followRelayChoice();
  await sleep(5);
  assert.deepEqual(fetched, ['GET /ice']);
  assert.equal(S.iceServers, AVOIDING, 'kept');
  assert.ok(!relaysIn(R.chooseIce(S.iceServers, null)).some(R.isMemberRelay));
  answer = () => Promise.resolve(ALL);
  A.timers[0].fn();
  await sleep(5);
  assert.deepEqual(fetched, ['GET /ice', 'GET /ice']);
  assert.equal(S.iceServers, ALL);
  assert.deepEqual(voice.updates, [ALL]);
  assert.deepEqual(voice.followed, [hostsOf(ALL)]);
  assert.equal(voice.avoided, 1, 'nothing starts over for using them again');
  // A list with member relays in it is fetched again every 10 minutes (one may have been paused or removed meanwhile),
  // but not before a call: only when its logins run out.
  fetched.length = 0;
  A.clock.t += 3 * 3600000;
  await A.iceBeforeCall();
  assert.deepEqual(fetched, []);
  A.timers[0].fn(); await sleep(5);
  assert.deepEqual(fetched, ['GET /ice']);
  // One without: only when its logins run out.
  answer = () => Promise.resolve([STUN, MAIN, FRA, NYC]);
  await A.freshIce({ force: true });
  fetched.length = 0;
  A.clock.t += 3 * 3600000;
  A.timers[0].fn(); await sleep(5);
  assert.deepEqual(fetched, []);
  // An answer that comes after a newer one is dropped (it may be for the other choice).
  let slow; answer = () => new Promise((r) => { slow = r; });
  const older = A.freshIce({ force: true });
  const NEWER = [STUN, MAIN, PI];
  answer = () => Promise.resolve(NEWER);
  await A.freshIce({ force: true });
  slow(AVOIDING); await older;
  assert.equal(S.iceServers, NEWER);
});

test('app.js: told a member relay came or went (ice:changed), the list is fetched again a moment later; relays not measured yet are measured', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const fetched = []; const ranked = [];
  let answer = () => Promise.resolve(ALL);
  const voice = fakeVoice(S);
  const A = appIce({ S, api: (method, p) => { fetched.push(`${method} ${p}`); return answer(); }, voice, rankRelays: async (list, opts) => { ranked.push({ list, opts }); return { measured: 1 }; } });
  // The first list had only this server's relay, so nothing was measured: S.relayRanks stays unset.
  A.boot({ iceServers: [STUN, MAIN] });
  // The owner approves member relays: every app is told, and asks again within 3 seconds (a moment apart each). Told
  // again before it has asked: that one fetch will bring it.
  A.iceChanged(); A.iceChanged();
  assert.equal(A.later.length, 1);
  assert.ok(A.later[0].ms >= 0 && A.later[0].ms < 3000);
  A.later[0].fn(); await sleep(5);
  assert.deepEqual(fetched, ['GET /ice'], 'once');
  assert.equal(S.iceServers, ALL);
  // The new relays are measured now (unmeasured, every relay in the list would go into each call).
  assert.equal(ranked.length, 1);
  assert.deepEqual(ranked[0].opts, { force: false });
  assert.deepEqual(ranked[0].list, ALL);
  assert.deepEqual(S.relayRanks, { measured: 1 });
  // The same relays again (new logins), a minute later: nothing to measure.
  answer = () => Promise.resolve(ALL.map((e) => ({ ...e })));
  A.clock.t += 60000;
  A.iceChanged(); A.later[1].fn(); await sleep(5);
  assert.equal(ranked.length, 1);
  // A member relay paused: it leaves the list, and the call engine follows the member relays still in it.
  answer = () => Promise.resolve([STUN, MAIN, FRA, NYC, PI, PC]);
  A.clock.t += 60000;
  A.iceChanged(); A.later[2].fn(); await sleep(5);
  assert.deepEqual(voice.followed.at(-1), hostsOf([PI, PC]));
  assert.equal(ranked.length, 2, 'the set changed: measured (from the cache when it can)');
  // ice:changed is followed.
  assert.match(read('public', 'js', 'app.js'), /\n {2}socket\.on\('ice:changed', \(\) => iceChanged\(\)\);\n/);
});

test('app.js: told over and over (a relay whose address keeps changing, say), the list is fetched a few times at once, then at most once a minute, and never put off for good', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const fetched = [];
  const A = appIce({ S, api: () => { fetched.push(A.clock.t); return Promise.resolve(ALL); }, voice: fakeVoice(S), rankRelays: async () => ({}) });
  A.boot({ iceServers: ALL });
  const t0 = A.clock.t;
  // Told every 2 seconds for 10 minutes; each fetch goes out when its timer fires.
  const due = [];
  for (let s = 0; s <= 600; s += 2) {
    A.clock.t = t0 + s * 1000;
    while (due.length && due[0].at <= A.clock.t) { const d = due.shift(); A.clock.t = d.at; d.fn(); A.clock.t = t0 + s * 1000; }
    const n = A.later.length;
    A.iceChanged();
    if (A.later.length > n) due.push({ at: A.clock.t + A.later.at(-1).ms, fn: A.later.at(-1).fn });
    await sleep(0);
  }
  const gaps = fetched.slice(1).map((t, i) => t - fetched[i]);
  assert.ok(fetched[0] - t0 < 3000, 'the first one within 3 seconds');
  assert.ok(fetched[4] - t0 < 20000, `five in a row at once (${fetched.slice(0, 5).map((t) => t - t0)})`);
  assert.ok(gaps.slice(5).every((g) => g >= 55000 && g < 66000), `then about a minute apart (${gaps})`);
  assert.ok(fetched.length >= 13 && fetched.length <= 16, `about 15 in 10 minutes, not 300 (${fetched.length}): well inside the 120 an hour the server allows`);
  // Quiet for a while (the one still due goes out), the allowance comes back: a change then is fetched at once again.
  for (const d of due) { A.clock.t = d.at; d.fn(); await sleep(0); }
  const before = fetched.length;
  A.clock.t += 6 * 60000;
  A.iceChanged(); A.later.at(-1).fn(); await sleep(0);
  assert.equal(fetched.length, before + 1);
  assert.ok(A.later.at(-1).ms < 3000);
});

test('app.js: the background check fetches a list with member relays in it every 10 minutes, however long each fetch takes', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const fetched = [];
  let A;
  A = appIce({ S, api: async () => { fetched.push(A.clock.t); A.clock.t += 1500; return ALL; }, voice: fakeVoice(S), rankRelays: async () => ({}) });
  A.boot({ iceServers: ALL });
  const t0 = A.clock.t;
  for (let k = 1; k <= 60; k++) { A.clock.t = t0 + k * 60000 + 3; A.timers[0].fn(); await sleep(0); }
  assert.deepEqual(fetched.map((t) => Math.round((t - t0) / 60000)), [10, 20, 30, 40, 50, 60]);
  // One fetched in between (told of a change) counts: the next is at the first check 10 minutes after that one.
  fetched.length = 0;
  A.clock.t = t0 + 64.25 * 60000; await A.freshIce({ force: true });
  for (let k = 65; k <= 80; k++) { A.clock.t = t0 + k * 60000 + 3; A.timers[0].fn(); await sleep(0); }
  assert.deepEqual(fetched.map((t) => t - t0), [64.25 * 60000, 75 * 60000 + 3]);
});

// Setting the device's clock (by hand, or its time service putting it right) doesn't hold anything off: the waits and the
// list's age go by a clock that only moves forward.
test('app.js: the device\u2019s clock set back an hour changes nothing: told of a change, the list is still fetched within seconds, and the background check keeps to its 10 minutes', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const fetched = [];
  let A;
  A = appIce({ S, api: () => { fetched.push(A.clock.t); return Promise.resolve(ALL); }, voice: fakeVoice(S), rankRelays: async () => ({}) });
  A.boot({ iceServers: ALL });
  // Told of an approval: fetched.
  A.iceChanged(); A.later.at(-1).fn(); await sleep(0);
  // The clock goes an hour back, then the owner pauses a relay: fetched within seconds, and so is the change after it.
  A.clock.t += 60000; A.clock.wall = -3600000;
  for (let k = 0; k < 2; k++) {
    A.clock.t += 60000;
    A.iceChanged();
    assert.ok(A.later.at(-1).ms < 3000, `not put off by the hour (${A.later.at(-1).ms} ms)`);
    A.later.at(-1).fn(); await sleep(0);
  }
  assert.equal(fetched.length, 3);
  // The background check: 10 minutes after the last fetch, not an hour and 10 minutes.
  const last = A.clock.t;
  for (let k = 1; k <= 12; k++) { A.clock.t = last + k * 60000 + 3; A.timers[0].fn(); await sleep(0); }
  assert.deepEqual(fetched.slice(3).map((t) => Math.round((t - last) / 60000)), [10]);
  // Set a day forward instead: still every 10 minutes, not every minute.
  A.clock.wall = 86400000;
  const next = A.clock.t;
  for (let k = 1; k <= 20; k++) { A.clock.t = next + k * 60000; A.timers[0].fn(); await sleep(0); }
  assert.equal(fetched.length, 6);
});

// Logins run out at a time of day by the server's clock: a device whose clock is hours ahead (the bootstrap measured by
// how much: S.clockOffset) doesn't take a list it was just given for one that has run out.
test('app.js: a device whose clock is 17 hours ahead doesn\u2019t take every new list for run out (so it doesn\u2019t fetch it every minute): it goes by the server\u2019s time', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } }, clockOffset: -17 * 3600000 };
  const fetched = [];
  let A;
  // What the server hands out: logins that run out 12 hours from now by its clock (no member relays: only that counts).
  const list = () => [STUN, { ...MAIN, expiresAt: A.clock.t + 12 * 3600000 }, { ...FRA, expiresAt: A.clock.t + 12 * 3600000 }];
  A = appIce({ S, api: async () => { fetched.push(A.clock.t); return list(); }, voice: fakeVoice(S), rankRelays: async () => ({}) });
  A.clock.wall = 17 * 3600000;
  A.boot({ iceServers: list() });
  for (let k = 1; k <= 60; k++) { A.clock.t += 60000; A.timers[0].fn(); await sleep(0); }
  assert.deepEqual(fetched, [], 'not once in an hour (60 times before)');
  // Within an hour of running out (by the server's clock), it's fetched: once.
  A.clock.t += 10 * 3600000 + 60000; A.timers[0].fn(); await sleep(0);
  assert.equal(fetched.length, 1);
  for (let k = 1; k <= 5; k++) { A.clock.t += 60000; A.timers[0].fn(); await sleep(0); }
  assert.equal(fetched.length, 1);
});

// After a reconnect the bootstrap is asked for first, and its answer can take a while. Told of a change meanwhile
// (ice:changed reaches the new connection at once), the app fetches the list: that one is newer than the bootstrap's,
// whichever of the two answers first. A fetch asked for before the bootstrap is still the older one.
test('app.js: after a reconnect, a list fetched while the bootstrap was on its way is newer than the bootstrap\u2019s, whichever answers first', async () => {
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const voice = fakeVoice(S);
  let answer = () => Promise.resolve(ALL);
  const A = appIce({ S, api: () => answer(), voice, rankRelays: async () => ({}) });
  A.boot({ iceServers: ALL });
  const PAUSED = [STUN, MAIN, FRA, NYC, VPS, PC];
  // Back: the bootstrap is asked for (built while PI was still approved). The owner pauses PI; told, the app fetches the
  // list, and that answer comes first.
  A.clock.t += 60000;
  const boot1 = A.clock.t;
  A.clock.t += 500;
  answer = () => Promise.resolve(PAUSED);
  A.iceChanged(); A.later.at(-1).fn(); await sleep(0);
  assert.equal(S.iceServers, PAUSED);
  A.clock.t += 1500;
  voice.updates.length = 0;
  A.boot({ iceServers: ALL }, boot1);
  assert.equal(S.iceServers, PAUSED, 'the bootstrap\u2019s older list makes way');
  assert.deepEqual(voice.updates, [], 'and never reaches the call');
  // The other way round: the fetch answers after the bootstrap. It's taken then.
  A.clock.t += 60000;
  const boot2 = A.clock.t;
  A.clock.t += 500;
  let release; answer = () => new Promise((r) => { release = r; });
  A.iceChanged(); A.later.at(-1).fn();
  A.clock.t += 1500;
  A.boot({ iceServers: ALL }, boot2);
  assert.equal(S.iceServers, ALL);
  release(PAUSED); await sleep(0);
  assert.equal(S.iceServers, PAUSED, 'the fetch asked for after the bootstrap is taken when it answers');
  assert.deepEqual(voice.followed.at(-1), hostsOf(PAUSED));
  // A fetch asked for before the bootstrap is older: dropped when it answers after it.
  A.clock.t += 60000;
  const early = A.freshIce({ force: true });
  A.clock.t += 500;
  A.boot({ iceServers: ALL });
  release(PAUSED); await early;
  assert.equal(S.iceServers, ALL);
  // And the list's age counts from the newest one taken: the background check fetches 10 minutes after it.
  answer = () => Promise.resolve(ALL);
  const at = A.clock.t; let n = 0;
  answer = () => { n++; return Promise.resolve(ALL); };
  for (let k = 1; k <= 10; k++) { A.clock.t = at + k * 60000 + 3; A.timers[0].fn(); await sleep(0); }
  assert.equal(n, 1);
});

test('app.js and settings.js: the choice is followed wherever it changes, and calls ask for a fresh list first', () => {
  const app = read('public', 'js', 'app.js');
  const at = app.indexOf("socket.on('user:update', (u) => {");
  const onUpdate = app.slice(at, app.indexOf('\n  });\n', at));
  assert.match(onUpdate, /\n {4}if \(u\.id === S\.me\.id\) followRelayChoice\(\);\n/, 'your own user:update (PATCH /me/privacy here or on another device)');
  assert.match(app, /\n {2}followRelayChoice: \(\) => followRelayChoice\(\),/, 'settings.js can ask too');
  assert.match(app, /\n {4}ensureIce: \(\) => iceBeforeCall\(\),\n/);
  assert.match(app, /\n {4}memberRelayHosts: \(\) => memberRelayHosts\(S\.iceServers \|\| S\.config\.iceServers \|\| \[\]\),\n/, 'the call engine knows which relays are members’');
  assert.match(read('public', 'js', 'settings.js'), /\n {6}if \(k === 'memberRelays' && app\.followRelayChoice\) app\.followRelayChoice\(\);/);
});

// ------------------------------------------------------------------ the call engine (voice.js), on a fake WebRTC
const pcs = [];
class FakePC {
  constructor(config) {
    this.config = config; this.log = []; this.connectionState = 'new'; this.signalingState = 'stable';
    this.localDescription = null; this.remoteDescription = null; this.lanes = []; this.id = pcs.length;
    pcs.push(this);
  }
  addTransceiver() { const t = { direction: 'sendrecv', sender: { track: null, replaceTrack: async () => {}, getParameters: () => ({}), setParameters: async () => {} } }; this.lanes.push(t); return t; }
  getTransceivers() { return this.lanes; }
  async createOffer() { return { type: 'offer', sdp: `offer-${this.id}` }; }
  async createAnswer() { return { type: 'answer', sdp: `answer-${this.id}` }; }
  async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) { await sleep(5); this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; this.log.push('remote:' + d.sdp); }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error('no remote description'); this.log.push('candidate:' + c.candidate.split(' ')[4]); }
  setConfiguration(c) { this.config = c; }
  close() { this.connectionState = 'closed'; }
}
function fakeSocket(onEmit = () => undefined) {
  const handlers = {}; const sent = [];
  return {
    handlers, sent, id: 'me',
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, payload, cb) { sent.push({ ev, payload }); const r = onEmit(ev, payload); if (cb) setTimeout(() => cb(r || { ok: true }), 1); },
    fire(ev, payload) { (handlers[ev] || []).forEach((fn) => fn(payload)); },
  };
}
// Every call engine a test makes is cleaned up after it, passed or not (its timers would keep the test file running).
const made = [];
const voice = (opts) => { const engine = new Voice(opts); made.push(engine); return engine; };
afterEach(() => { while (made.length) made.pop().cleanup(); });
function useFakeWebRtc() {
  globalThis.RTCPeerConnection = FakePC;
  globalThis.MediaStream = class { constructor(tracks = []) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } getVideoTracks() { return []; } getTracks() { return this.tracks; } };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => new globalThis.MediaStream([]) } }, configurable: true, writable: true });
}
const candAt = (addr) => ({ candidate: `candidate:1 1 udp 41885439 ${addr} 50000 typ relay raddr 198.51.100.77 rport 1 generation 0`, sdpMid: '0' });
const SDP_LINES = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=fingerprint:sha-256 AA:BB', 'a=candidate:1 1 udp 41885439 203.0.113.7 50000 typ relay raddr 198.51.100.77 rport 1', 'a=candidate:2 1 udp 41885439 198.51.100.10 50001 typ relay raddr 198.51.100.77 rport 1', 'a=mid:0'];
const SIGNED = SDP_LINES.join('\r\n') + '\r\n';
const STRIPPED = SDP_LINES.filter((l) => !l.includes('203.0.113.7')).join('\r\n') + '\r\n';

test('voice: an offer is checked as it arrived, then its candidates on avoided machines go; trickled ones too (early and direct)', async () => {
  useFakeWebRtc();
  let avoid = true;
  const hosts = () => (avoid ? R.memberRelayHosts(ALL) : new Set());
  const checked = [];
  const socket = fakeSocket();
  const v = voice({ socket, getIceServers: () => [], avoidHosts: hosts, signSdp: async () => 'sig', verifySdp: async (uid, d) => { checked.push(d.sdp); await sleep(30); return d.sdp === SIGNED; } });
  v.channelId = 'room';
  const sig = (data) => socket.fire('voice:signal', { from: 'A', userId: 'ua', data });
  sig({ candidate: candAt('203.0.113.7') }); // early: before their connection exists here
  sig({ candidate: candAt('198.51.100.10') });
  sig({ candidate: candAt('2001:db8::7') });
  sig({ sdp: { type: 'offer', sdp: SIGNED }, sig: 's' });
  sig({ candidate: candAt('198.51.100.20') }); // sent while the offer is still being checked: used after it
  await v.signalChains.get('A');
  const pc = v.peers.get('A').pc;
  assert.deepEqual(checked, [SIGNED], 'the signature was checked on exactly what arrived');
  assert.equal(pc.remoteDescription.sdp, STRIPPED, 'the connection got it without the avoided candidate');
  assert.deepEqual(pc.log, ['remote:' + STRIPPED, 'candidate:198.51.100.10', 'candidate:198.51.100.20']);
  // Direct: the connection has their description.
  sig({ candidate: candAt('192.0.2.44') });
  sig({ candidate: candAt('198.51.100.30') });
  await v.signalChains.get('A');
  assert.deepEqual(pc.log.slice(3), ['candidate:198.51.100.30']);
  // The choice is read when a candidate is used: turned off, member relays' candidates are used again.
  avoid = false;
  sig({ candidate: candAt('203.0.113.7') });
  await v.signalChains.get('A');
  assert.deepEqual(pc.log.slice(4), ['candidate:203.0.113.7']);
});

test('voice: a candidate kept for later is judged by the choice as it is when it’s used', async () => {
  useFakeWebRtc();
  let avoid = false;
  const socket = fakeSocket();
  const v = voice({ socket, getIceServers: () => [], avoidHosts: () => (avoid ? R.memberRelayHosts(ALL) : new Set()), signSdp: async () => 'sig', verifySdp: async () => true });
  v.channelId = 'room';
  const sig = (data) => socket.fire('voice:signal', { from: 'A', userId: 'ua', data });
  sig({ candidate: candAt('203.0.113.7') }); // kept while not avoiding…
  await v.signalChains.get('A');
  avoid = true; // …then the person turns avoiding on before the offer comes
  sig({ sdp: { type: 'offer', sdp: SIGNED }, sig: 's' });
  await v.signalChains.get('A');
  assert.deepEqual(v.peers.get('A').pc.log, ['remote:' + STRIPPED]);
});

test('voice: an answer is checked as it arrived and set without the avoided candidates, and candidates that waited for it (pending) are judged too', async () => {
  useFakeWebRtc();
  for (const avoid of [true, false]) {
    const checked = [];
    const socket = fakeSocket((ev) => (ev === 'voice:join' ? { ok: true, peers: [{ socketId: 'B', userId: 'ub' }], canSpeak: true } : undefined));
    const v = voice({ socket, getIceServers: () => [], ensureIce: async () => {}, avoidHosts: () => (avoid ? R.memberRelayHosts(ALL) : new Set()), signSdp: async () => 'sig', verifySdp: async (uid, d) => { checked.push(d.sdp); return d.sdp === SIGNED; } });
    await v.join('room');
    const peer = v.peers.get('B');
    assert.equal(peer.pc.signalingState, 'have-local-offer');
    const sig = (data) => socket.fire('voice:signal', { from: 'B', userId: 'ub', data });
    // Their candidates before their answer (an older app sends them first): kept in `pending`.
    sig({ candidate: candAt('192.0.2.44') });
    sig({ candidate: candAt('198.51.100.10') });
    await v.signalChains.get('B');
    assert.equal(peer.pending.length, 2);
    sig({ sdp: { type: 'answer', sdp: SIGNED }, sig: 's' });
    await v.signalChains.get('B');
    assert.deepEqual(checked, [SIGNED]);
    assert.equal(peer.pc.remoteDescription.sdp, avoid ? STRIPPED : SIGNED, avoid ? 'stripped' : 'nothing changes for someone who uses them');
    assert.deepEqual(peer.pc.log.slice(1), avoid ? ['candidate:198.51.100.10'] : ['candidate:192.0.2.44', 'candidate:198.51.100.10']);
  }
});

test('voice: a tampered offer is still refused (the strip never runs before the check)', async () => {
  useFakeWebRtc();
  const warnings = [];
  const socket = fakeSocket();
  // A server that removed the avoided line itself: the signature no longer matches what arrived.
  const v = voice({ socket, getIceServers: () => [], avoidHosts: () => R.memberRelayHosts(ALL), signSdp: async () => 'sig', verifySdp: async (uid, d) => d.sdp === SIGNED, onSecurityWarning: (u, why) => warnings.push(why) });
  v.channelId = 'room';
  socket.fire('voice:signal', { from: 'A', userId: 'ua', data: { sdp: { type: 'offer', sdp: STRIPPED }, sig: 's' } });
  await v.signalChains.get('A');
  assert.equal(v.peers.size, 0);
  assert.deepEqual(warnings, ['bad-signature']);
});

// ------------------------------------------------------------------ the other side leaves member relays out too
// Dropping the other side's candidates isn't enough: a member relay the other side's connection uses is told our
// address (their app asks it to let our packets through) and could carry the call. So whether someone avoids member
// relays goes with every offer and answer (and the server's list of who's in a call says it), and the other side's app
// builds that connection without member relays.
const sdpSignals = (socket) => socket.sent.filter((x) => x.ev === 'voice:signal' && x.payload.data.sdp).map((x) => x.payload);
// getIceServers as app.js gives it: everything, or without member relays when asked (avoid).
const iceFor = (asked) => ({ automatic = false, avoid = false } = {}) => { asked.push({ automatic, avoid }); return R.chooseIce(ALL, null, null, { avoid }); };
const MEMBER_URLS = new Set([PI, VPS, PC].flatMap((e) => e.urls));
const usesMember = (pc) => pc.config.iceServers.some((e) => [].concat(e.urls).some((u) => MEMBER_URLS.has(u)));

test('voice: someone who avoids member relays says so with every offer and answer; someone who doesn’t, doesn’t', async () => {
  useFakeWebRtc();
  for (const avoiding of [true, false]) {
    const socket = fakeSocket();
    // (As app.js: without member relays when this person avoids them, or the connection is with someone who does.)
    const v = voice({ socket, getIceServers: ({ avoid } = {}) => R.chooseIce(ALL, null, null, { avoid: avoid || avoiding }), avoids: () => avoiding, signSdp: async () => 'sig', verifySdp: async () => true });
    v.channelId = 'room';
    const peer = await v.createPeer('B', 'ub', true); // (it sends its offer)
    await sleep(5);
    socket.fire('voice:signal', { from: 'C', userId: 'uc', data: { sdp: { type: 'offer', sdp: SIGNED }, sig: 's', pc: 'c1' } });
    await v.signalChains.get('C');
    const sent = sdpSignals(socket);
    assert.deepEqual([...new Set(sent.map((x) => x.data.sdp.type))].sort(), ['answer', 'offer']);
    assert.ok(sent.every((x) => x.data.avoid === (avoiding || undefined)), JSON.stringify(sent.map((x) => x.data.avoid)));
    assert.equal(usesMember(peer.pc), !avoiding, 'and builds its own connections without them');
  }
});

test('voice: answering someone who avoids member relays, the connection is built without them', async () => {
  useFakeWebRtc();
  const asked = [];
  const socket = fakeSocket();
  const v = voice({ socket, getIceServers: iceFor(asked), avoids: () => false, signSdp: async () => 'sig', verifySdp: async () => true });
  v.channelId = 'room';
  socket.fire('voice:signal', { from: 'A', userId: 'ua', data: { sdp: { type: 'offer', sdp: SIGNED }, sig: 's', pc: 'a1', avoid: true } });
  await v.signalChains.get('A');
  const peer = v.peers.get('A');
  assert.equal(peer.noMember, true);
  assert.ok(!usesMember(peer.pc), 'no member relay in it');
  assert.ok(peer.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(FRA))), 'the owner’s relays are');
  assert.deepEqual(asked.at(-1), { automatic: false, avoid: true });
  // Someone else in the same call who doesn't avoid them: member relays as usual.
  socket.fire('voice:signal', { from: 'C', userId: 'uc', data: { sdp: { type: 'offer', sdp: SIGNED }, sig: 's', pc: 'c1' } });
  await v.signalChains.get('C');
  assert.ok(usesMember(v.peers.get('C').pc));
  // New logins later (updateIceServers): still none for the avoider's connection.
  v.updateIceServers();
  assert.ok(!usesMember(v.peers.get('A').pc) && usesMember(v.peers.get('C').pc));
});

test('voice: calling someone the server lists as avoiding member relays, the connection is built without them from the start', async () => {
  useFakeWebRtc();
  const socket = fakeSocket((ev) => (ev === 'voice:join' ? { ok: true, peers: [{ socketId: 'B', userId: 'ub', avoid: true }, { socketId: 'C', userId: 'uc' }], canSpeak: true } : undefined));
  const v = voice({ socket, getIceServers: iceFor([]), ensureIce: async () => {}, avoids: () => false, signSdp: async () => 'sig', verifySdp: async () => true });
  await v.join('room');
  assert.ok(!usesMember(v.peers.get('B').pc));
  assert.ok(usesMember(v.peers.get('C').pc));
});

test('voice: an answer that says they avoid member relays, to a connection that may use one, isn’t used: the connection starts over without them', async () => {
  useFakeWebRtc();
  const socket = fakeSocket((ev) => (ev === 'voice:join' ? { ok: true, peers: [{ socketId: 'B', userId: 'ub' }], canSpeak: true } : undefined));
  const v = voice({ socket, getIceServers: iceFor([]), ensureIce: async () => {}, avoids: () => false, signSdp: async () => 'sig', verifySdp: async () => true });
  await v.join('room');
  const old = v.peers.get('B');
  assert.ok(usesMember(old.pc), 'the server didn’t say, so member relays are in it');
  await sleep(5);
  const offer = sdpSignals(socket).find((x) => x.to === 'B' && x.data.sdp.type === 'offer');
  socket.fire('voice:signal', { from: 'B', userId: 'ub', data: { sdp: { type: 'answer', sdp: SIGNED }, sig: 's', pc: 'b1', topc: offer.data.pc, avoid: true } });
  await v.signalChains.get('B');
  assert.equal(old.pc.remoteDescription, null, 'none of their addresses went into the old connection');
  assert.ok(old.closed);
  assert.ok(socket.sent.some((x) => x.ev === 'voice:signal' && x.payload.to === 'B' && x.payload.data.reset), 'they’re told it starts over');
  const fresh = v.peers.get('B');
  assert.notEqual(fresh, old);
  assert.ok(!usesMember(fresh.pc), 'the new one has no member relay');
  // Their candidates for the old connection are ignored.
  socket.fire('voice:signal', { from: 'B', userId: 'ub', data: { candidate: candAt('198.51.100.10'), pc: 'b1', topc: old.pcId } });
  await v.signalChains.get('B');
  assert.deepEqual(fresh.pending, []);
  // The same for a new offer on a connection that may use one (they turned avoiding on during the call).
  const socket2 = fakeSocket();
  const w = voice({ socket: socket2, getIceServers: iceFor([]), avoids: () => false, signSdp: async () => 'sig', verifySdp: async () => true });
  w.channelId = 'room';
  socket2.fire('voice:signal', { from: 'A', userId: 'ua', data: { sdp: { type: 'offer', sdp: SIGNED }, sig: 's', pc: 'a1' } });
  await w.signalChains.get('A');
  const before = w.peers.get('A');
  assert.ok(usesMember(before.pc));
  socket2.fire('voice:signal', { from: 'A', userId: 'ua', data: { sdp: { type: 'offer', sdp: SIGNED }, sig: 's', pc: 'a1', topc: before.pcId, avoid: true } });
  await w.signalChains.get('A');
  assert.ok(before.closed);
  assert.ok(!usesMember(w.peers.get('A').pc));
});

test('voice: avoiding turned on during a call starts every connection that may use a member relay over, without them', async () => {
  useFakeWebRtc();
  let avoiding = false;
  const socket = fakeSocket();
  const v = voice({ socket, getIceServers: ({ avoid } = {}) => R.chooseIce(ALL, null, null, { avoid: avoid || avoiding }), avoids: () => avoiding, signSdp: async () => 'sig', verifySdp: async () => true });
  v.channelId = 'room';
  const a = await v.createPeer('A', 'ua', true);
  const b = await v.createPeer('B', 'ub', false);
  assert.ok(usesMember(a.pc) && usesMember(b.pc));
  v.avoidChanged();
  assert.equal(v.peers.get('A'), a, 'nothing while they still use member relays');
  avoiding = true;
  v.avoidChanged();
  await sleep(5);
  for (const id of ['A', 'B']) {
    const p = v.peers.get(id);
    assert.ok(p !== a && p !== b && !usesMember(p.pc), id);
    assert.equal(p.initiator, true, 'a fresh connection from this side, whichever side started the old one');
  }
  const offers = sdpSignals(socket).filter((x) => x.data.sdp.type === 'offer');
  assert.ok(offers.length >= 2 && offers.slice(-2).every((x) => x.data.avoid === true), 'and its offers say so');
  // Once more: nothing left to start over.
  const now = [...v.peers.values()];
  v.avoidChanged();
  assert.deepEqual([...v.peers.values()], now);
});

test('voice: a member relay that left calls (paused or removed by the owner) starts the connections set up with it over; one that’s only offline, or no longer among the 8, doesn’t', async () => {
  useFakeWebRtc();
  const socket = fakeSocket();
  let list = ALL;
  const v = voice({ socket, getIceServers: () => R.chooseIce(list, null), memberRelayHosts: () => R.memberRelayHosts(list), avoids: () => false, signSdp: async () => 'sig', verifySdp: async () => true });
  v.channelId = 'room';
  const a = await v.createPeer('A', 'ua', true);
  assert.deepEqual([...a.memberHosts].sort(), hostsOf(ALL), 'it knows which of its relays are members’ (the owner’s aren’t)');
  // PI is offline for a few minutes (or no longer among this person's 8): the server lists it by address only. The
  // connection gets settings without it, and keeps going.
  list = ALL.map((e) => (e === PI ? bare(PI) : e));
  v.updateIceServers();
  assert.ok(!a.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
  v.followMemberRelays(R.memberRelayHosts(list));
  assert.equal(v.peers.get('A'), a, 'nothing starts over for a relay that’s still listed');
  // An owner's region going offline isn't a member relay leaving.
  list = list.filter((e) => e !== FRA);
  v.updateIceServers();
  v.followMemberRelays(R.memberRelayHosts(list));
  assert.equal(v.peers.get('A'), a);
  // Then the owner pauses PI: it's gone from the list. The connection was set up with it (and its settings had it
  // since), so it may be going through it: it starts over, without it.
  list = list.filter((e) => !(e.community && first(e) === first(PI)));
  v.updateIceServers();
  v.followMemberRelays(R.memberRelayHosts(list));
  await sleep(5);
  const p = v.peers.get('A');
  assert.notEqual(p, a);
  assert.ok(a.closed);
  assert.ok(!p.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
  assert.ok(!p.memberHosts.has('203.0.113.7'));
  // A connection set up without member relays never starts over for one leaving.
  list = [STUN, MAIN, NYC];
  const b = await v.createPeer('B', 'ub', true);
  assert.equal(b.memberHosts.size, 0);
  v.followMemberRelays(new Set());
  assert.equal(v.peers.get('B'), b);
});

test('app.js and voice: a list taken after a reconnect is followed too: a relay paused meanwhile starts its calls over, and avoiding turned on meanwhile starts every call that may use one over', async () => {
  useFakeWebRtc();
  const S = { me: { id: 'me', privacy: { memberRelays: 'use' } } };
  const socket = fakeSocket();
  const avoids = () => R.avoidsMemberRelays(S.me);
  const v = voice({ socket, getIceServers: ({ avoid } = {}) => R.chooseIce(S.iceServers, null, null, { avoid: avoids() || avoid }), memberRelayHosts: () => R.memberRelayHosts(S.iceServers), avoids,
    signSdp: async () => 'sig', verifySdp: async () => true });
  const avoided = []; const orig = v.avoidChanged.bind(v); v.avoidChanged = () => { avoided.push(1); return orig(); };
  let answer = [STUN, MAIN, FRA, PI];
  const A = appIce({ S, api: async () => answer, voice: v, rankRelays: async () => ({}) });
  A.boot({ iceServers: [STUN, MAIN, FRA, PI] });
  v.channelId = 'room';
  const a = await v.createPeer('A', 'ua', true);
  assert.ok(a.memberHosts.has('203.0.113.7'));
  // The owner pauses PI while this device's connection to the server is down (ice:changed missed). Back, the bootstrap's
  // list doesn't have it: the call set up with it starts over without it.
  A.boot({ iceServers: [STUN, MAIN, FRA] });
  await sleep(5);
  const b = v.peers.get('A');
  assert.notEqual(b, a, 'started over');
  assert.ok(!b.memberHosts.size && !b.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
  // And a later fetch with the same list changes nothing.
  answer = [STUN, MAIN, FRA];
  await A.freshIce({ force: true });
  assert.equal(v.peers.get('A'), b);
  // PI back. Avoiding is turned on on another device while this one is away: the bootstrap brings the choice and the
  // avoider's list. Every connection that may use a member relay starts over without them, telling the other side.
  A.boot({ iceServers: [STUN, MAIN, FRA, PI] });
  await v.reconnectPeer('A');
  const c = v.peers.get('A');
  assert.ok(c.memberHosts.has('203.0.113.7') && !c.noMember);
  S.me = { id: 'me', privacy: { memberRelays: 'avoid' } };
  A.boot({ iceServers: [STUN, MAIN, FRA, bare(PI)] });
  await sleep(5);
  assert.equal(avoided.length, 1);
  const d = v.peers.get('A');
  assert.notEqual(d, c);
  assert.ok(d.noMember && !d.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
  // The user:update that may come after it changes nothing more; nor does another reconnect.
  A.followRelayChoice();
  A.boot({ iceServers: [STUN, MAIN, FRA, bare(PI)] });
  await sleep(5);
  assert.equal(avoided.length, 1);
  assert.equal(v.peers.get('A'), d);
});

// A connection made while this person avoided member relays is given some when they stop (new relay settings), and may
// go through one after its next network change. Turned on again (here, or on another device while this one was away),
// it starts over like every other connection that may use one.
test('voice: a connection built without member relays and given some since (avoiding turned off) starts over when avoiding is turned on again', async () => {
  useFakeWebRtc();
  const S = { me: { id: 'me', privacy: { memberRelays: 'avoid' } } };
  const avoids = () => R.avoidsMemberRelays(S.me);
  const v = voice({ socket: fakeSocket(), getIceServers: ({ avoid } = {}) => R.chooseIce(S.iceServers, null, null, { avoid: avoids() || avoid }), memberRelayHosts: () => R.memberRelayHosts(S.iceServers), avoids,
    signSdp: async () => 'sig', verifySdp: async () => true });
  let answer = [STUN, MAIN, FRA, bare(PI)];
  const A = appIce({ S, api: async () => answer, voice: v, rankRelays: async () => ({}) });
  A.boot({ iceServers: answer });
  v.channelId = 'room';
  const a = await v.createPeer('A', 'ua', true);
  assert.ok(a.noMember && !a.memberHosts.size);
  // Turned off: nothing starts over, but the connection's settings have the member relay from now on.
  S.me = { id: 'me', privacy: { memberRelays: 'use' } };
  answer = [STUN, MAIN, FRA, PI];
  A.followRelayChoice(); await sleep(5);
  assert.equal(v.peers.get('A'), a);
  assert.ok(a.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
  assert.ok(a.memberHosts.has('203.0.113.7') && !a.noMember, 'it may use one now');
  // Turned on again on another device while this one was away: the bootstrap brings it, and the connection starts over.
  S.me = { id: 'me', privacy: { memberRelays: 'avoid' } };
  A.clock.t += 60000;
  A.boot({ iceServers: [STUN, MAIN, FRA, bare(PI)] }); await sleep(5);
  const b = v.peers.get('A');
  assert.notEqual(b, a);
  assert.ok(a.closed && b.noMember && !b.pc.config.iceServers.some((e) => [].concat(e.urls).includes(first(PI))));
});

test('Settings → Calls "Test relay" tests this server’s own relay only (a member’s relay answering says nothing about these settings)', () => {
  const s = read('public', 'js', 'settings.js');
  const fn = s.slice(s.indexOf('async function testRelay(out, app) {'), s.indexOf('\n}\n', s.indexOf('async function testRelay(out, app) {')));
  assert.match(fn, /\.filter\(\(x\) => x\.regionId === 'main' \|\| \(!x\.regionId && !isMemberRelay\(x\)\)\);/);
  // As it picks: the main relay (and the old static login without a regionId), never a region or a member relay.
  const pick = (list) => R.usableIce(list, false).filter((x) => x.regionId === 'main' || (!x.regionId && !R.isMemberRelay(x)));
  const MAINE = { ...MAIN, regionId: 'main' };
  assert.deepEqual(pick([STUN, MAINE, FRA, PI, bare(PC)]), [STUN, MAINE]);
  assert.deepEqual(pick([STUN, FRA, PI]).filter(R.isRelay), [], 'no relay of its own: nothing to test');
});
