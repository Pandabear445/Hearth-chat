# Encryption research: post-quantum keys and forward secrecy (October 2026)

This note answers one question: what is the strongest end-to-end encryption Hearth can ship that doesn't make
the app harder to use? It looks at what the big messengers do, at the NIST standards, at what browsers can do,
and at which JavaScript libraries are usable. It then recommends a design and records what was built (Hearth 1.40,
`public/js/e2ee.js`). Paths are relative to `hearth/`. Everything was checked as of late October 2026. Sources are
linked inline and listed at the end.

## Short answer

- **AES-256-GCM is not the weak point.** It isn't "trackable" and nobody can crack it, quantum computers
  included. Grover's algorithm at best halves the effective strength of a symmetric key, which leaves AES-256 at a
  comfortable ~128-bit level. Hearth uses a fresh AES key per message, random 96-bit nonces, and authenticated data
  that binds every message to its place. That stays.
- **The real gap was key agreement.** Every Hearth key exchange (DM keys, the ECIES wraps that hand out server
  keys, the personal vault) relied on P-256 elliptic-curve Diffie-Hellman alone. A large enough quantum computer
  running Shor's algorithm breaks that. Anyone who records Hearth's traffic or copies its database today could read
  it then. This is **"harvest now, decrypt later"**, and it is why Signal, Apple, Chrome, Cloudflare and the IETF
  all moved to hybrid post-quantum key agreement in 2023–2026.
- **The fix is hybrid ML-KEM-768 + P-256** (NIST FIPS 203). Hearth already used P-256, so the combination works the
  way Signal's PQXDH and X-Wing do. To read anything, an attacker must now break both ML-KEM and P-256.
- **Forward secrecy is the harder question.** Hearth promises that a new device reads your whole history after you
  sign in. True forward secrecy means old keys are destroyed, so a stolen key can't read old messages. The two
  conflict. Hearth now gives every DM its own key, wrapped inside the message for both people, so a leaked message
  key exposes that one message. That is **not** forward secrecy against someone who has your password and the
  server's database. The section on forward secrecy below explains why, and what it would cost to go further.

## 1. What others do

### Signal: PQXDH, then SPQR (the "Triple Ratchet")

- **PQXDH (2023).** X3DH plus a CRYSTALS-Kyber (now ML-KEM) encapsulation to a signed one-time PQ prekey. The
  session key is `KDF(DH1 ‖ DH2 ‖ DH3 [‖ DH4] ‖ SS_kem)`, so it falls only if both X25519 and Kyber fall
  ([spec](https://signal.org/docs/specifications/pqxdh/)). It protects session setup against harvest-now attacks.
  Authentication is still classical: prekeys are signed with XEdDSA. A formal analysis found and fixed spec issues
  (KEM re-encapsulation and public-key binding) before they were exploitable ([Cryspen](https://cryspen.com/post/pqxdh/),
  [USENIX Security 2024](https://www.usenix.org/conference/usenixsecurity24/presentation/bhargavan)). The lesson:
  bind the KEM ciphertext and the public keys into the KDF. Hearth does.
- **SPQR, the Sparse Post-Quantum Ratchet (October 2025).** This runs an ML-KEM-768 ratchet beside the Double
  Ratchet, and message keys are derived from both. Forward secrecy and post-compromise security then hold against
  quantum attackers too, not only at session start. ML-KEM payloads are over 1 KB, so SPQR spreads them over many
  messages with chunking and erasure coding ("sparse"). Older sessions upgrade only once all clients support it
  ([Signal blog](https://signal.org/blog/spqr/)).
- **Why Hearth can't just copy it.** The Double Ratchet keeps per-device state and deletes old keys. That is
  exactly why a new Signal device doesn't see old messages (Signal's history transfer is a separate, explicit,
  device-to-device step). Hearth's whole model is the opposite: history lives on the server and every device you
  sign in on reads it.

### Apple iMessage PQ3 (2024)

PQ3 adds a Kyber-768 (ML-KEM) key to each device's registered keys and uses it hybrid with ECC, both at session
setup and in a **periodic post-quantum rekey**. The rekey sends fresh PQ public keys in-band, so a compromise heals
("Level 3" in Apple's own scale). As with SPQR, the rekey is not run on every message because of the
~1.1 KB ciphertexts ([Apple Security](https://security.apple.com/blog/imessage-pq3/),
[PQShield analysis](https://pqshield.com/?p=3206)). Hearth's design is closest to PQ3's "hybrid, rekey every so
often", with history kept.

### MLS (RFC 9420) and post-quantum cipher suites

MLS is the IETF standard for group end-to-end encryption ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)). It
has epochs, a ratchet tree, and forward secrecy plus post-compromise security for groups. Post-quantum is being
added through new cipher suites: ML-KEM alone or hybrid with ECDH, with classical or ML-DSA signatures, in
[draft-ietf-mls-pq-ciphersuites](https://datatracker.ietf.org/doc/draft-ietf-mls-pq-ciphersuites/) (revision 06,
July 2026, still a draft). Its suites with classical signatures exist precisely for harvest-now-decrypt-later.
That is the same trade Hearth makes: post-quantum confidentiality now, classical authentication for now (an
attacker would need a quantum computer *at the time* to forge). MLS is a good long-term target for Hearth's server
channels. It would replace the hand-rolled epoch scheme, but it's a large change, and its forward secrecy conflicts
with server-kept history in the same way (see below).

### WhatsApp

WhatsApp uses the Signal protocol. **I could not confirm a post-quantum rollout.** One 2026 paper modelling
the WhatsApp client it studied found no post-quantum step at session setup
([eprint 2026/1979](https://eprint.iacr.org/2026/1979.pdf)). Secondary sources claim PQXDH is deployed, and a
survey lists WhatsApp as "needs a closer check" ([postquantumsecurity.org](https://www.postquantumsecurity.org/publications/pqc_messengers.html)).
Treat it as unconfirmed.

### Matrix (Olm/Megolm, vodozemac)

As far as I can find, Matrix's mainline crypto (vodozemac) is still classical. A PQXDH pull request exists
([vodozemac #120](https://github.com/matrix-org/vodozemac/pull/120)), but I found no release with it. At the
Matrix Conference 2026 (October) there was a talk on a post-quantum vodozemac wrapper built for a government
deployment ([talk](https://cfp.2026.matrix.org/matrix-conference-2026/talk/TZ8ZYX/)). Matrix is the closest
architecture to Hearth: server-kept history, key backup and many devices. Its Megolm sessions give only partial
forward secrecy, because sessions are shared via key backup to every device. That is the same trade Hearth makes.

## 2. The standards (NIST)

| Standard | What | Status (Oct 2026) | Used here |
|---|---|---|---|
| **FIPS 203** ML-KEM (Kyber) | Key encapsulation (lattice). ML-KEM-768 ≈ AES-192-level, the common choice (Signal, Apple, Chrome TLS, X-Wing) | Final, Aug 2024 ([NIST](https://csrc.nist.gov/pubs/fips/203/final)) | **Yes: ML-KEM-768** |
| **FIPS 204** ML-DSA (Dilithium) | Signatures (lattice), 2.4–4.6 KB signatures | Final, Aug 2024 ([NIST](https://csrc.nist.gov/pubs/fips/204/final)) | Not yet (see below) |
| **FIPS 205** SLH-DSA (SPHINCS+) | Hash-based signatures, very conservative, 8–50 KB signatures | Final, Aug 2024 ([NIST](https://csrc.nist.gov/pubs/fips/205/final)) | No |
| FIPS 206 FN-DSA (Falcon) | Compact lattice signatures; hard to implement in constant time | Draft, final expected late 2026–2027 | No |
| HQC | Backup KEM from a different math family | Selected March 2025; draft standard expected 2026–2027 | No |

**Why no post-quantum signatures yet.** Harvest-now-decrypt-later threatens *confidentiality*. A signature only
matters at the moment it's checked: forging one needs a quantum computer *at that time*. So everyone who has
shipped (Signal, Apple, MLS's harvest-now suites, Chrome's TLS) still signs classically. Hearth signs channel
messages, key handoffs and its post-quantum public keys with ECDSA P-256. ML-DSA signatures on every channel
message would add ~3.3 KB to each one. The time to add ML-DSA (hybrid with ECDSA) is when a quantum computer is
close, not before.

**Hybrid combiners.** Two designs set the pattern:
- [X-Wing](https://www.ietf.org/archive/id/draft-connolly-cfrg-xwing-kem-11.html) (ML-KEM-768 + X25519,
  draft-connolly-cfrg-xwing-kem-11, September 2026) hashes `ss_mlkem ‖ ss_x25519 ‖ ct_x25519 ‖ pk_x25519 ‖ label`.
  It can leave ML-KEM's ciphertext and key out because ML-KEM is IND-CCA2 and binds its own ciphertext.
- PQXDH feeds all DH outputs and the KEM secret to HKDF.

Hearth uses P-256 instead of X25519 because every existing identity key is P-256. Switching would mean new
identity keys for everyone and a verification round. It also binds *more* than X-Wing does: the whole transcript
goes into the HKDF salt (see §5).

## 3. Browsers: what WebCrypto can do now

Tested here in the preinstalled **Chromium 153** (headless, secure context, `http://localhost`):

| Algorithm | Chromium 153 | Notes |
|---|---|---|
| ECDH / ECDSA P-256, AES-GCM, HKDF | yes | What Hearth has always used |
| X25519 (`deriveBits`) | **yes** | |
| Ed25519 (`sign`/`verify`) | **yes** | |
| ML-KEM-768 (`generateKey`, `encapsulateBits`) | **no**: `NotSupportedError: Unrecognized name`; `subtle.encapsulateBits` undefined | |
| ML-DSA-65 | **no** | |

Elsewhere:
- **ML-KEM / ML-DSA in WebCrypto** are specified in the WICG
  [Modern Algorithms in WebCrypto](https://wicg.github.io/webcrypto-modern-algos/) draft. That draft also includes
  hybrid KEMs: MLKEM768-X25519 (X-Wing), MLKEM768-P256 and MLKEM1024-P384
  ([servo #47856](https://github.com/servo/servo/issues/47856), [dchest](https://dchest.com/2025/08/09/mlkem-webcrypto/)).
  Chromium has an Intent to Ship. A project recorded on 28 Oct 2026 that ML-KEM-768 and ML-DSA-65 pass in
  **Chromium 156** and **Node 26.12**, but **fail in Firefox 159.0 and Safari 26.6.2**
  ([alcove #2499](https://github.com/georgetown-mdi/alcove/pull/2499)).
  [Cloudflare Workers](https://developers.cloudflare.com/changelog/post/2026-09-28-webcrypto-modern-algorithms/)
  has them behind a compatibility flag.
- **X25519 / Ed25519** are now in all three engines (Chromium, Firefox, Safari). They're not needed here, as Hearth
  stays on P-256 for compatibility.
- **Electron**: the desktop app pins `electron ^44.7.0` (`desktop/package.json`), so it gets whatever its bundled
  Chromium has. Until the Chromium it ships has ML-KEM on by default, assume it doesn't.
- **Node** (the test suite): 22.22 here; native ML-KEM arrives in newer Node releases.
- **TLS is different.** Chrome, Firefox and Safari already negotiate X25519MLKEM768 for HTTPS. That protects the
  connection to the Hearth server, not the end-to-end layer: the server sees what TLS carries.

**Conclusion:** Hearth can't rely on native ML-KEM in Firefox, Safari, today's Chromium-based Electron, or the
Android/iOS WebViews for a while. **It needs a JavaScript implementation.** It can switch to native
`crypto.subtle` ML-KEM later, when every target has it: the wire format is plain FIPS 203, so nothing on the
server changes.

## 4. JavaScript libraries

| Library | ML-KEM | Size | Audit | Notes |
|---|---|---|---|---|
| **[@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum)** 0.7.1 (Aug 2026) | 512/768/1024, plus ML-DSA, SLH-DSA, Falcon and hybrids (X-Wing, ML-KEM768+P256) | Hearth's bundle of ML-KEM-768 and the SHA-3 it needs: **37 KB, 10.4 KB gzipped** | **No independent audit of this package.** The author self-audited 0.6.1 (April 2026), and an ACVP reproducibility study ran against 0.7.0 ("not an audit"). The sibling noble-curves and noble-hashes were independently audited in earlier versions | Pure JS, 3 small dependencies of the same author, signed releases with provenance, ACVP/Wycheproof vectors. **Not constant-time** (JS can't promise that) |
| libcrux-ml-kem (Cryspen) | 512/768/1024 | WASM, larger | Formally verified (hax/F\*), used by Signal's SPQR | Rust: needs a WASM build pipeline Hearth doesn't have |
| liboqs (Open Quantum Safe) via WASM | all | large (hundreds of KB) | Research-grade; "not for production" by its own docs | |
| @hpke/ml-kem | 512/768/1024 | small | Not independently audited as far as I could find | HPKE-shaped API |

**Chosen: @noble/post-quantum 0.7.1, ML-KEM-768 only, vendored** as `public/vendor/ml-kem.js`. It is bundled once
by `scripts/vendor-ml-kem.sh` from exact npm versions, with npm's sha512 integrity in the file header. Hearth
serves it itself, so the Content-Security-Policy stays `script-src 'self'`, and the service worker caches it for
offline use. `test/pq-crypto.test.js` pins the file's SHA-256 and checks that it produces byte-for-byte the same
keys, ciphertexts and shared secrets as the npm package. The missing third-party audit is a real gap. It is
mitigated by the hybrid design: **if ML-KEM or this implementation turns out broken, every message is still exactly
as safe as it was before (P-256)**. Timing side channels matter less here than on a server: decapsulation runs on
the user's own device, on ciphertexts the server can't usefully vary (AES-GCM rejects anything that doesn't decrypt).

## 5. What Hearth now does (1.40)

| Where | Before | Now (when both sides have a PQ key) | Format |
|---|---|---|---|
| Account keys | P-256 ECDH identity + ECDSA signing | + an **ML-KEM-768 key pair** from a 64-byte seed | seed inside the password envelope; public key published, ECDSA-signed |
| DMs | `K = HKDF(ECDH(a, b))`, one static key forever | **A key per message**: random 256-bit, wrapped inside the message for each of the two with **ML-KEM-768 + ECDH(eph, them) + ECDH(author, them)**, both wraps bound to the DM, the author, the recipient and a hash of the ciphertext | `d3:` messages, self-contained |
| Server/group key handoffs | ECIES: ephemeral ECDH P-256 → HKDF → AES-GCM, ECDSA-signed | **ML-KEM-768 + ephemeral ECDH**, ECDSA-signed under its own label | `w2:` |
| Your own stored copies of server keys | `w1` | re-stored as `w2` by a device that holds your seed, once your recovery key (if any) holds it too | `w2:` |
| Channel messages, files | AES-256-GCM from the group key / per-file key | unchanged (symmetric: already quantum-safe) | `c2:` |
| Personal vault (study tools, saved notes, drafts, word filter, soundboards) | `HKDF(ECDH(me, me))` | **unchanged for now** (see open items) | `x1:` |
| Photo tags / chat backgrounds in DMs | static DM key | **unchanged for now** (see open items) | `td1:` / `lkd1:` |

**The combiner** (`e2ee.js hybridKey`):
`AES key = HKDF-SHA256(ikm = ss_mlkem ‖ dh₁ [‖ dh₂], salt = SHA-256(label ‖ ctx ‖ framed(eph_pub, kem_ct, recipient_pub, [sender_pub], recipient_pq_pub)), info = label ‖ ctx)`.
Every element is length-prefixed. `ctx` names the server or DM, the epoch (server keys), recipient and sender. Each
format has its own label (`hearth-gk2`, `hearth-d3`), so nothing made for one ever opens as another. A d3 wrap's ctx
also carries a hash of the message's ciphertext, which holds the message's own id and time (`binding.js`), so a wrap
can't be moved to another message, another DM or another author, and a message's key can't be put under other words.

**Authentication.** Server-key handoffs stay ECDSA-signed. The signature covers the ML-KEM ciphertext, and its
label differs from `w1`'s, so neither form's signature verifies for the other. DM messages aren't signed: the
static `ECDH(author, recipient)` inside the KDF proves the message came from one of the two, so DMs stay
**deniable**, as before. Your own copy is wrapped with `ECDH(you, you)`, which only you can work out, so nobody but
you can write a message that opens as yours on your devices. Each account's PQ public key is signed with its ECDSA key over
`hearth-pq-key-v1|<account>|<identity key>|<pq key>`. A server can't swap it, or move it to another account or
identity key. It is covered transitively by the existing safety numbers, which cover the signing key.

**Migration (one password prompt at most).**
- **New accounts** get the PQ key at sign-up.
- **Existing accounts** get one at their next sign-in with the password. The app opens the envelope, adds a seed
  and saves it back with the public key, in one request that also checks the password.
- **The envelope.** The seed lives *inside* the password-locked envelope (`'HQ' 0x01 | len | PKCS#8 | seed`), so
  every path that re-locks it carries it unchanged: password change, recovery key, PBKDF2→Argon2id upgrade. The seed
  is deliberately **not** locked with anything derived from the P-256 identity key, the way the signing key is.
  Shor's algorithm would recover that key from the public one, and the PQ key would then protect nothing.
- **Devices already signed in** (they don't keep the password) show a bar asking for the password once: it opens
  the envelope and gives them the seed (it sits above the message box and can be put off for the session). Until
  then they show "enter your password once" on what's locked to the new key and are **read-only for anything
  post-quantum**: they write no d3 DM and make no server key, and write no P-256 DM into a conversation that went
  post-quantum. That's simpler and safer than writing to public keys: a second review found that every rule letting a
  seedless device write had a way for the server to steer it into P-256 (hide your own key from it, or the peer's).
  It reads the seed from this browser's storage first, so a password entered in another tab counts here too. An earlier version of this change handed the seed
  between devices automatically; a review showed why that's wrong. The only thing that could authenticate such a
  request is your P-256 signing key, so whoever can forge P-256 (a future quantum computer, recomputing your keys
  from your public ones) could have asked your devices for the seed and then decrypted everything recorded. The
  seed now comes only from the password envelope.
- **Never re-locked to a key you don't hold.** A device re-stores copies "for itself" only with a post-quantum key
  whose seed it holds, so a device without the seed never replaces a copy it can read with one it can't, and it
  makes nothing new for you before it has the seed (above).
- **Devices signed in before the account had any PQ key** show the same bar ("turn it on"), so an account doesn't
  stay P-256-only just because nobody signs in again.
- **Old messages** (`v1`, `d2`, `w1`) open exactly as before.
- **Fallback.** New messages use P-256 alone only while one of the two has no *published* PQ key and nothing on this
  device says otherwise (an account from before that hasn't signed in with the password yet). Never because the
  server stops listing a key a device has already seen (below), never for your own account once anything on the
  device says it has a key (the seed, your key seen published, its fingerprint in your record, copies made for it),
  and never in a DM this device has seen go post-quantum (any d3 message there, even one it couldn't open), not even
  after accepting someone's new keys. A seed that was never published writes P-256 only to people without a key: the
  device can't tell "never published" from "hidden by the server".

**Downgrade protection.**
- (a) Once a device has checked someone's PQ key, it notes so in its trust-on-first-use pin. A server that later
  hides that key, or lists one that isn't validly signed, gets *nothing* encrypted to that person; the error says
  why. It does not quietly fall back.
- (b) The server refuses a `w1` copy of a server key for a member it knows has a PQ key (the "stale" answer),
  whatever the app says, so an old cached app can't hand them out either. The sharer's app then fetches the key and
  wraps again. That's how a member's first PQ key reaches every server
  they're in.
- (c) The same for your own key: once anything on a device says your account has one (above), it writes nothing
  for you without the seed, whatever the listing says. If the keys the server lists as yours don't match what this device's password
  unlocked, it sends nothing at all; your own copy of a new server key goes to your keys *as this device proved
  them*, never to the listed ones.
- (d) DM messages carry their own keys, so there's nothing about DM keys for a server to list, hold back, roll back
  or re-date. A d3 message is trusted exactly as a d2 one: by which of the author's identity keys made it, at its
  date, from this device's pins. An older key of theirs counts only for what was written before this device first
  saw their keys change (kept from that first time until the change is accepted, with ten minutes for this device's
  clock), or before the server says the key was replaced if that's earlier: the server can only make the cutoff
  earlier, never later. Reading a d3 from them with their current key also pins their post-quantum key (checked, in
  one batch a moment later), as writing to them does.
- (e) A P-256-only DM from someone, dated after the DM's first d3 message, as both messages date themselves (the
  authenticated time inside each, with ten minutes for clocks; never what the server says; and only d3 messages that
  open with a key this device trusts date it), is flagged "Without post-quantum encryption". A DM scheduled as P-256 when both people now have a post-quantum key, or written for a
  post-quantum key the other person no longer has, is held by the server and re-encrypted by the sender's app.
- (f) Servers and groups: a member without a PQ key gets a P-256 copy (`w1`), and that copy opens the epoch's key,
  so **a channel's messages are only post-quantum protected while every member's copy is `w2`**. A member this
  device has seen a PQ key for, whose key isn't listed now, gets no copy at all: the rotation goes on without them,
  the server notes the key as owed to them, and the app whose rotation left them out (its own local record, never
  just the server's word) shares it with them once theirs is back, even after later rotations. The server allows that only for members with no post-quantum key listed, so a
  member's app can't keep a new key from the others.

**Why DMs have no epochs (third review).** An earlier version kept DM keys in weekly epochs, stored apart from the
messages, with each copy carrying when it was made and which keys it was for. Every review found new ways around
the rules that came with them: a server listing epochs, hiding them or rolling them back after a restore; open tabs
writing with keys the server had lost; per-account limits on new epochs; extra requests on every read; and cutoffs
that depended on what the server said about an epoch. A key per message, inside the message, needs none of that:
reading a d3 message is judged as reading a d2 one always was. It costs about 3 KB more per message, and opening one
takes ~2.5 ms (500 in a DM: ~1.3 s, measured in `pq-keys.test.js`; a page of 50, ~0.1 s).

**Races and losses.** The published key's seed must always be in the current envelope. A password change saved
from an older envelope than the server's (one that raced the upgrade on another device) is refused and retried, and
the upgrade itself is a compare-and-swap on both the published key and the envelope. A recovery key made before the
upgrade doesn't hold the seed, which is the one real loss:
- While it's the account's recovery key, copies that open with the identity key alone are never replaced with
  hybrid ones, so a reset with it keeps all history from before the upgrade.
- What was locked to the post-quantum key since the upgrade (d3 DMs, server keys handed out since) can't be opened
  by the account after such a reset; the people it talked to, and other members, still have them. Each server's
  current key is shared again.
- A reset that keeps the keys tells the server whether its envelope holds the seed. If not, the server drops the
  published key instead of leaving a key nobody holds, and the app makes a new one (asking for the password at the
  next start if that first start was interrupted).
- The app says exactly this after such a reset, asks for a new recovery key right after the upgrade, and Settings
  keeps saying so until there is one.
- A server restored from before the key was published lists none, and its envelope has no seed. The password then
  puts the seed a device already holds back into the envelope and publishes that same key, so the other devices
  keep theirs. A seed taken from the envelope is kept even if publishing it is refused, so the device stays
  read-only rather than P-256-only.

**Cost.** A `w2` wrap is ~1.75 KB (a `w1` is ~0.3 KB). A d3 message is ~3.3 KB larger than a d2 one (two ML-KEM
ciphertexts and the wraps). Reading one is an ML-KEM-768 decapsulation plus the HKDF/AES work, ~1.7 ms in Node, and
no requests. A rotation for a 1,000-member server now sends ~1.8 MB, so key routes accept
up to 8 MB.

## 6. Forward secrecy vs. multi-device history: the honest version

What users of Hearth rely on: **sign in on a new phone and your whole history is there.** Forward secrecy (FS)
means a key that's stolen *today* can't decrypt *yesterday's* messages, because yesterday's keys were deleted.
The two are in direct tension:

1. **If old keys are deleted, the new device can't read old messages.** That's Signal's model (history only by an
   explicit transfer from an old device that's still around), and it's also why Signal loses history when a phone
   is lost.
2. **If old keys are kept so new devices can read, then whatever unlocks the kept keys unlocks all of history.**
   In Hearth that is your password (it unlocks the identity key and the PQ seed) plus the server's database (it
   holds the wrapped keys and the ciphertext). Matrix's key backup and iCloud-backed iMessage history make the same
   trade.

What Hearth's per-message DM keys do give:
- **A leaked message key exposes one message**, not the conversation, past or future, and writes nothing: the wraps
  commit to that message's ciphertext. Before, one leaked `ECDH(a, b)` value exposed every DM between two people
  forever.
- **Fresh keys every message.** Each is fresh randomness, wrapped with a fresh ephemeral ECDH and a fresh ML-KEM
  encapsulation, for both people's keys as they are when it's written: a new key after a reset applies from the next
  message.
- **No forward secrecy from them.** Per-message keys add nothing against theft of the long-term keys: whoever has
  your identity key and your post-quantum seed (your password, or an unlocked device) and the stored messages can
  unwrap every message key and read every message, past and future. They only contain a single leaked message key.

What they **don't** give:
- **No FS against your long-term secrets.** Someone with your password (or an unlocked device) **and** a copy of the
  database can unwrap every message key you ever had and read everything. The same holds for server channels: every
  member keeps every epoch key they're given. This was true before and is still true. The difference now is that
  "a copy of the database" is no longer enough *with a future quantum computer*: it also needs the ML-KEM secret,
  which only your password or your devices hold.
- **No per-message ratchet.** A device that's compromised while you use it sees what you see. Nothing in a
  web app can prevent that.

What it would take to go further (not built; listed for the record):
- **Opt-in "no history on new devices" DMs** with a real ratchet (e.g. a SPQR-style triple ratchet in a Web Worker,
  with per-device state in IndexedDB). That works, but it's a *visible* change: new devices and browser data
  clears would lose those conversations. It is a good fit for a "secret chat" toggle, not the default.
- **MLS for servers**, with history for new devices sent by an existing member's device (MLS "history sharing" is
  still being designed). Same trade: real FS for the group means newcomers and new devices depend on someone
  online to share history.
- **Deleting old messages after a retention window** (say a year; disappearing messages already do this per
  conversation). This is real FS for anything older, at the
  cost of history older than that. That's a product decision, not a crypto one.

## 7. Recommendation (and what was done)

1. **Do now (done):** hybrid ML-KEM-768 + P-256 for every identity-to-identity key agreement that protects stored
   or recorded data: DM keys (one per message), server key handoffs and your own stored key copies. The only visible
   change is a one-time password prompt on devices that were signed in before the upgrade, and a request for a new
   recovery key. Old messages keep opening, and there is downgrade protection as described.
2. **Do now (done):** a key per DM message, which contains a leaked key to one message, with history kept. Don't
   claim forward secrecy.
3. **Next:**
   - (a) Move the personal vault (`x1:`) and DM tags/backgrounds (`td1:`, `lkd1:`) to keys derived with the PQ
     seed. This was held back because a device still waiting for its seed would then fail to read study decks or
     the word filter, and some of those code paths rewrite data they can't read. It needs a "wait, don't overwrite"
     state first.
   - (b) Switch to native WebCrypto ML-KEM where present (Chromium 156+), keeping the vendored one as fallback.
   - (c) Get the vendored library, or a formally verified one such as libcrux via WASM, independently reviewed.
   - (d) Show which servers still have a member with a P-256-only copy of the key (5(f)).
4. **Later, only if wanted:**
   - an opt-in ratcheted "secret chat" mode for real forward secrecy;
   - MLS for large servers;
   - hybrid ML-DSA + ECDSA signatures once a quantum computer is a near-term threat to *authentication*.

## Sources

- Signal, *Signal Protocol and Post-Quantum Ratchets* (SPQR), 2 Oct 2025: https://signal.org/blog/spqr/
- Signal, *The PQXDH Key Agreement Protocol*: https://signal.org/docs/specifications/pqxdh/
- Cryspen, *An Analysis of Signal's PQXDH*: https://cryspen.com/post/pqxdh/
- Bhargavan et al., *Formal verification of the PQXDH post-quantum key agreement protocol*, USENIX Security 2024: https://www.usenix.org/conference/usenixsecurity24/presentation/bhargavan
- Apple Security Research, *iMessage with PQ3*: https://security.apple.com/blog/imessage-pq3/
- PQShield, *Post-quantum messaging: examining Apple's new PQ3 protocol*: https://pqshield.com/?p=3206
- RFC 9420, *The Messaging Layer Security (MLS) Protocol*: https://www.rfc-editor.org/rfc/rfc9420
- *ML-KEM and Hybrid Cipher Suites for MLS* (draft-ietf-mls-pq-ciphersuites): https://datatracker.ietf.org/doc/draft-ietf-mls-pq-ciphersuites/
- *X-Wing: general-purpose hybrid post-quantum KEM* (draft-connolly-cfrg-xwing-kem-11): https://www.ietf.org/archive/id/draft-connolly-cfrg-xwing-kem-11.html
- NIST FIPS 203 / 204 / 205: https://csrc.nist.gov/pubs/fips/203/final, https://csrc.nist.gov/pubs/fips/204/final, https://csrc.nist.gov/pubs/fips/205/final
- *From Specs to Apps: Verifying and Monitoring Models of Signal and WhatsApp* (2026): https://eprint.iacr.org/2026/1979.pdf
- *Which Messengers Are Already Quantum-Safe?*: https://www.postquantumsecurity.org/publications/pqc_messengers.html
- vodozemac PQXDH pull request: https://github.com/matrix-org/vodozemac/pull/120
- Matrix Conference 2026, post-quantum vodozemac wrapper talk: https://cfp.2026.matrix.org/matrix-conference-2026/talk/TZ8ZYX/
- WICG, *Modern Algorithms in the Web Cryptography API*: https://wicg.github.io/webcrypto-modern-algos/
- servo, *Implement Hybrid KEMs in WebCrypto* (#47856): https://github.com/servo/servo/issues/47856
- dchest, *ML-KEM in WebCrypto API*: https://dchest.com/2025/08/09/mlkem-webcrypto/
- georgetown-mdi/alcove #2499 (browser test record, 28 Oct 2026): https://github.com/georgetown-mdi/alcove/pull/2499
- Cloudflare changelog, *Web Crypto adds ML-KEM and ML-DSA support* (28 Sep 2026): https://developers.cloudflare.com/changelog/post/2026-09-28-webcrypto-modern-algorithms/
- paulmillr/noble-post-quantum (README: audit status, sizes, API): https://github.com/paulmillr/noble-post-quantum
