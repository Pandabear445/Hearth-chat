// Member relays on the client (public/js/relays.js, public/js/voice.js): someone who avoids relays run by members
// (Settings → Privacy & safety, memberRelays: 'avoid') never measures one, never gets an address on one, and drops the
// other side's network candidates on one, so nothing from their device reaches a member's machine. Someone who uses
// them always keeps one of the owner's relays among the two they offer, so the two can still call each other.
// The call engine runs on a fake WebRTC, as in voice-hardening.test.js.
const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
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
