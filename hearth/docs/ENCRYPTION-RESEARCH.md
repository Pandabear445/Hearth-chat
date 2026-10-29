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
  conflict. Hearth now rotates DM keys in epochs and keeps the old epoch keys wrapped for your account. This
  contains a leaked epoch key, but it is **not** forward secrecy against someone who has your password and the
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
| DMs | `K = HKDF(ECDH(a, b))`, one static key forever | **Epoch keys**: random 256-bit per DM and epoch, wrapped for each of the two with **ML-KEM-768 + ECDH(eph, them) + ECDH(me, them)**, rotated weekly and on key changes | `dk1:` wraps, `d3:<epoch>:` messages |
| Server/group key handoffs | ECIES: ephemeral ECDH P-256 → HKDF → AES-GCM, ECDSA-signed | **ML-KEM-768 + ephemeral ECDH**, ECDSA-signed under its own label | `w2:` |
| Your own stored copies of server keys | `w1` | re-stored as `w2` once you have a PQ key | `w2:` |
| Device-to-device PQ seed handoff | (new) | ML-KEM-768 to a one-off device key + ECDH to your identity key | `ph1:` |
| Channel messages, files | AES-256-GCM from the group key / per-file key | unchanged (symmetric: already quantum-safe) | `c2:` |
| Personal vault (study tools, saved notes, drafts, word filter) | `HKDF(ECDH(me, me))` | **unchanged for now** (see open items) | `x1:` |
| Photo tags / chat backgrounds in DMs | static DM key | **unchanged for now** (see open items) | `td1:` / `lkd1:` |

**The combiner** (`e2ee.js hybridKey`):
`AES key = HKDF-SHA256(ikm = ss_mlkem ‖ dh₁ [‖ dh₂], salt = SHA-256(label ‖ ctx ‖ framed(eph_pub, kem_ct, recipient_pub, [sender_pub], recipient_pq_pub)), info = label ‖ ctx)`.
Every element is length-prefixed. `ctx` names the server, DM, epoch, recipient and sender. Each format has its own
label (`hearth-gk2`, `hearth-dmk1`, `hearth-ph1`), so nothing made for one ever opens as another.

**Authentication.** Server-key handoffs stay ECDSA-signed. The signature covers the ML-KEM ciphertext, and its
label differs from `w1`'s, so neither form's signature verifies for the other. DM epoch keys aren't signed: the
static `ECDH(sender, recipient)` inside the KDF proves the key came from one of the two, so DMs stay **deniable**,
as before. Each account's PQ public key is signed with its ECDSA key over
`hearth-pq-key-v1|<account>|<identity key>|<pq key>`. A server can't swap it, or move it to another account or
identity key. It is covered transitively by the existing safety numbers, which cover the signing key.

**Migration, invisible to users.**
- **New accounts** get the PQ key at sign-up.
- **Existing accounts** get one at their next sign-in with the password. The app opens the envelope, adds a seed
  and saves it back with the public key, in one request that also checks the password.
- **The envelope.** The seed lives *inside* the password-locked envelope (`'HQ' 0x01 | len | PKCS#8 | seed`), so
  every path that re-locks it carries it unchanged: password change, recovery key, PBKDF2→Argon2id upgrade. The seed
  is deliberately **not** locked with anything derived from the P-256 identity key, the way the signing key is.
  Shor's algorithm would recover that key from the public one, and the PQ key would then protect nothing.
- **Devices already signed in** (they don't keep the password) ask your other devices for the seed. They make a
  one-off ML-KEM key, sign its public half with your signing key, and any of your devices that has the seed seals
  it to that key. No password prompt. Until it arrives, such a device shows "Waiting for your keys from another of
  your devices…" on post-quantum DMs it can't open yet. It can still write: writing only needs public keys.
- **Old messages** (`v1`, `d2`, `w1`) open exactly as before.
- **Fallback.** New messages use P-256 alone only while the other person has no PQ key. That's visible in the code
  and invisible to users.

**Downgrade protection.**
- (a) Once a device has checked someone's PQ key, it notes so in its trust-on-first-use pin. A server that later
  hides that key, or lists one that isn't validly signed, gets *nothing* encrypted to that person; the error says
  why. It does not quietly fall back.
- (b) The server refuses a `w1` copy of a server key for a member it knows has a PQ key (the "stale" answer), from
  any app that says what it wrapped for (every app since 1.40; older apps' copies are taken as before). The sharer's
  app then fetches the key and wraps again. That's how a member's first PQ key reaches every server
  they're in.
- (c) DM epochs are wrapped only for the exact keys the server checks as current.

**Races and losses.** The seed must never end up held by nobody. A password change saved from an older envelope than
the server's (one that raced the upgrade on another device) is refused and retried, and the upgrade itself is a
compare-and-swap on both the published key and the envelope. If it's lost anyway, a sign-in with the password whose
handoff request has gone unanswered for 3 days makes a new key. A recovery key made before the upgrade doesn't hold
the seed: Settings asks for a new one, and a reset with an old one says that recent DMs won't open.

**Cost.** A `w2` wrap is ~1.75 KB (a `w1` is ~0.3 KB). A DM epoch is two ~1.66 KB wraps a week per active DM.
Messages themselves don't grow. An ML-KEM-768 decapsulation plus the HKDF/AES work is ~1.7 ms in Node, and
epoch keys are cached per session. A rotation for a 1,000-member server now sends ~1.8 MB, so key routes accept
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

What Hearth's DM epochs do give:
- **A leaked epoch key exposes one epoch** (a week at most), not the whole conversation, past and future. Before,
  one leaked `ECDH(a, b)` value exposed every DM between two people forever.
- **Post-compromise healing for epoch keys.** The next epoch is fresh randomness, wrapped with fresh ephemeral ECDH
  and a fresh ML-KEM encapsulation. Someone who learned an old epoch key (but not your long-term keys) loses access
  at the next rotation.
- **Rotation on key changes.** A password reset with new keys, or a new PQ key, starts a new epoch at once.

What they **don't** give:
- **No FS against your long-term secrets.** Someone with your password (or an unlocked device) **and** a copy of the
  database can unwrap every epoch key you ever had and read everything. The same holds for server channels: every
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
- **Deleting old epochs after a retention window** (say a year). This is real FS for anything older, at the
  cost of history older than that. That's a product decision, not a crypto one.

## 7. Recommendation (and what was done)

1. **Do now (done):** hybrid ML-KEM-768 + P-256 for every identity-to-identity key agreement that protects stored
   or recorded data: DM keys (as epoch keys), server key handoffs, your own stored key copies, and the device-to-
   device seed handoff. There is no visible change; old messages keep opening, and there is downgrade protection
   as described.
2. **Do now (done):** rotating DM epoch keys, which contains a leaked key and heals after compromise, with history
   kept. Don't claim forward secrecy.
3. **Next:**
   - (a) Move the personal vault (`x1:`) and DM tags/backgrounds (`td1:`, `lkd1:`) to keys derived with the PQ
     seed. This was held back because a device still waiting for its seed would then fail to read study decks or
     the word filter, and some of those code paths rewrite data they can't read. It needs a "wait, don't overwrite"
     state first.
   - (b) Switch to native WebCrypto ML-KEM where present (Chromium 156+), keeping the vendored one as fallback.
   - (c) Get the vendored library, or a formally verified one such as libcrux via WASM, independently reviewed.
   - (d) Back off DM epoch creation: a server that keeps answering a device's epoch checks wrongly can make it start
     a new epoch on every send until the rate limit (30 an hour) stops it sending. Availability only.
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
