// Call relays in several regions: measure which answer fastest from this device and use those.
// A relay "answers" when it hands out an address (one round trip to it and back, twice), so the time
// it takes is a good stand-in for distance. Results are kept for 6 hours.
const KEY = 'hearth.relayRtt';
const TTL = 6 * 3600000;
const isRelay = (e) => [].concat(e.urls || []).some((u) => /^turns?:/.test(u));
const sig = (e) => `${e.region || ''}|${[].concat(e.urls).join(',')}`;

// Member relays: call relays that members run on their own machines (Settings → Help host), approved by the owner.
// The server marks their entries `community: true`. A relay sees the IP address of everyone whose call goes through
// it (never what's said or shown), so people can choose to avoid them (Settings → Privacy & safety,
// `memberRelays: 'avoid'`): then this app never measures one, never gets an address on one, and drops the other
// side's network candidates on any member relay (memberRelayHosts), so it never connects through one. That's as far
// as it goes: the browser answers the connection checks that reach it, so when the other side's call goes through a
// member relay, that relay can still learn this device's address.
export const isMemberRelay = (e) => !!e && e.community === true;
export const avoidsMemberRelays = (me) => !!(me && me.privacy && me.privacy.memberRelays === 'avoid');
// Someone who avoids them gets every member relay from the server by address only, with no login (so this app knows
// whose candidates to drop). Such an entry is never handed to WebRTC or measured, even after they switch back to
// using member relays and before new logins come.
const hostsOnly = (e) => isMemberRelay(e) && !(e.username && e.credential);
// The relay list without member relays when they're avoided, and never one without a login (what a call uses, and what
// gets measured).
export const usableIce = (list, avoid) => (list || []).filter((e) => !(isMemberRelay(e) && (avoid || hostsOnly(e))));

// Addresses are compared the way they're written in candidates: lower case, IPv6 without brackets or a zone, and
// with every group spelled out (so "2001:db8::1" and "2001:0db8:0:0:0:0:0:1" are the same machine).
function normHost(a) {
  let s = String(a || '').trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  s = s.replace(/%.*$/, '');
  if (!s.includes(':')) return s;
  const halves = s.split('::');
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return s;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;
  return groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}
// The machines member relays run on: a Set of the hosts in their addresses (turn:<host>:3478?transport=udp, with
// IPv6 in brackets).
export function memberRelayHosts(list) {
  const hosts = new Set();
  for (const e of list || []) {
    if (!isMemberRelay(e)) continue;
    for (const u of [].concat(e.urls || [])) {
      const m = /^turns?:(\[[^\]]*\]|[^:?/\s]+)/i.exec(String(u));
      if (m) hosts.add(normHost(m[1]));
    }
  }
  hosts.delete('');
  return hosts;
}
// The connection address of a candidate ("candidate:<foundation> <component> <transport> <priority> <address> <port>
// typ …", or the same as an SDP line after "a="). Not the related address: that's where it came from, not where
// packets go.
const candidateAddress = (line) => {
  const m = /^(?:a=)?candidate:\S+\s+\d+\s+\S+\s+\d+\s+(\S+)/i.exec(String(line).trim());
  return m ? normHost(m[1]) : null;
};
// Leaves out the other side's network candidates whose address is one of `hosts` (memberRelayHosts), so this app
// never connects through one. (The browser still answers a connection check that comes from one.) Takes a candidate
// ({ candidate, sdpMid, … }: null when dropped), an offer or answer ({ type, sdp }) or its SDP text. In SDP only the
// a=candidate lines that are dropped go; everything else stays byte for byte. A signed offer or answer is checked
// first, on exactly what arrived, and only then passed through this.
export function dropAvoidedCandidates(x, hosts) {
  if (x == null || !hosts || !hosts.size) return x;
  const avoid = new Set([...hosts].map(normHost));
  const avoided = (line) => avoid.has(candidateAddress(line));
  if (typeof x === 'string') return x.replace(/^(?:a=)?candidate:[^\r\n]*(?:\r?\n|$)/gm, (line) => (avoided(line) ? '' : line));
  if (typeof x.sdp === 'string') { const sdp = dropAvoidedCandidates(x.sdp, avoid); return sdp === x.sdp ? x : { ...x, sdp }; }
  if (typeof x.candidate === 'string') return avoided(x.candidate) ? null : x;
  return x;
}

export function measureRelay(entry, timeout = 4000) {
  return new Promise((resolve) => {
    if (!entry || hostsOnly(entry)) { resolve(null); return; } // no login for it: never contacted
    let pc;
    const t0 = performance.now();
    const done = (v) => { clearTimeout(timer); try { pc && pc.close(); } catch { /* closed */ } resolve(v); };
    const timer = setTimeout(() => done(null), timeout);
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: entry.urls, username: entry.username, credential: entry.credential }], iceTransportPolicy: 'relay' });
      pc.onicecandidate = (e) => {
        if (e.candidate && / typ relay /.test(e.candidate.candidate)) done(Math.round(performance.now() - t0));
        else if (!e.candidate) done(null);
      };
      pc.createDataChannel('probe');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => done(null));
    } catch { done(null); }
  });
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
// { "<region|urls>": ms or null }
// Callers pass usableIce(list, avoid); a member relay without a login is left out here as well.
export async function rankRelays(list, { force = false } = {}) {
  const relays = usableIce(list, false).filter(isRelay);
  const saved = load();
  if (!force && saved.at && Date.now() - saved.at < TTL && relays.every((e) => sig(e) in (saved.ms || {}))) return saved.ms;
  if (typeof RTCPeerConnection === 'undefined' || !relays.length) return {};
  const results = await Promise.all(relays.map((e) => measureRelay(e)));
  const ms = Object.fromEntries(relays.map((e, i) => [sig(e), results[i]]));
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ms })); } catch { /* private mode */ }
  return ms;
}
export const relayTime = (ranks, e) => (ranks && sig(e) in ranks ? ranks[sig(e)] : undefined);

// Relay logins run out (expiresAt, 12 to 18 hours after they're handed out). An app left open longer fetches
// new ones before a call, and in the background; true when they're gone or will be within `margin`.
export function iceExpiresAt(list) {
  const times = (list || []).map((e) => e && e.expiresAt).filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : Infinity;
}
export const iceStale = (list, now = Date.now(), margin = 3600000) => iceExpiresAt(list) - now < margin;

// What a call uses: every STUN server, plus the two relays that answered fastest (all of them until measured).
// Fewer relays = the connection is found sooner.
// With a region picked for the call (like Discord's region override), everything goes through that region's
// relay: { iceServers, iceTransportPolicy: 'relay' }. If that region is down, the call falls back to automatic.
// { avoid }: this person avoids member relays, so they're left out before anything is picked.
export function chooseIce(list, ranks, regionId = null, { avoid = false } = {}) {
  const strip = (e) => { const { region, regionId: _r, expiresAt: _x, community: _c, ...rest } = e; return rest; };
  const usable = usableIce(list, avoid);
  const stun = usable.filter((e) => !isRelay(e));
  const relays = usable.filter(isRelay);
  if (regionId) {
    // (A call region is always one of the owner's: the server refuses a member relay.)
    const picked = relays.filter((e) => e.regionId === regionId && !isMemberRelay(e));
    if (picked.length) return { iceServers: picked.map(strip), iceTransportPolicy: 'relay' };
  }
  if (relays.length <= 2 || !ranks) return [...stun, ...relays].map(strip);
  const scored = relays.map((e) => ({ e, ms: relayTime(ranks, e) }));
  const answered = scored.filter((x) => typeof x.ms === 'number').sort((a, b) => a.ms - b.ms);
  if (!answered.length) return [...stun, ...relays].map(strip);
  const picks = answered.slice(0, 2).map((x) => x.e);
  // Someone who avoids member relays drops our addresses on them, so when both picks are member relays the slower
  // one makes way for the fastest of the owner's relays that answered: they can always reach us through that one.
  if (picks.length === 2 && picks.every(isMemberRelay)) {
    const owner = answered.find((x) => !isMemberRelay(x.e));
    if (owner) picks[1] = owner.e;
  }
  return [...stun, ...picks].map(strip);
}
