# Third independent review of the post-quantum change (round 3, against 8225e5c; each confirmed by a second agent)

Scratchpad paths are the reviewer's; rebuild the scenarios as tests. The two critical ones predate this change and are being fixed by the parent on the 1.40 line (1.40.1): merge that in rather than fixing them separately.

## R3-1. [critical] A server can rename your own account in /bootstrap (me.id). That silently empties every pin and post-quantum mark on the device, so DMs go to the server's keys, or out as P-256 only, with no warning.

**Where:** hearth/public/js/app.js:1276 (`S.me = b.me`; never compared with the id this browser signed in as, app.js:286/:539). secure.js:233 and :325 (`S.me = { ...S.me, ...me }` can also change the id). Every local trust store is keyed by S.me.id: e2ee.js:790 (identity/q pins), :900 (own PQ pin), :909 (DM high-water marks), :928 (dmpq 'went post-quantum' plus first-epoch time). They are read at secure.js:141, :268, :442, :882, :1065 and :1076. Neither ownKeysOk nor ensureSigningKey (secure.js:196-241) binds the id. This is pre-existing for the identity pins; the PQ evidence stores added in this change inherit it.

**Scenario:**
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r3hunt/repro.test.js, test A (also f5.test.js and f5b.test.js). Setup: Alice and Bob have DMed in d3:1, and Alice's devices have pinned Bob's identity and PQ keys.

A1, seed-holding device. The server's next /bootstrap lists Alice's real keys under id Z, so ownKeysOk still passes. It leaves out Bob's `pq` and returns no epochs from GET /dms/:id/keys. encryptDm then writes `d2:`, which ECDH(A,B) alone opens. The same tampering without the id swap is refused ('untrusted').

A2. Same swap, with Bob listed under the server's own identity and signing keys from the start of the session. keyChanged(Bob) is false, so there is no warning. The d2 opens with the server's private key. A call offer signed by the server passes checkSdp as Bob's ({ok:true}), so the server can sit in the middle of calls.

A3, seedless laptop. It has already read the DM and seen the key published; the control is need_password. With the swap and its own pq left out, the bar switches to 'upgrade' ('turn it on for your account') and it writes `d2:`.

On the reading side, d2AfterPq's pinnedPq/dmFirstAt also read the empty store under Z, so the 'Without post-quantum encryption' flag never shows.

This defeats rows 164, 165 and 167 and ENCRYPTION-RESEARCH §5 (a)-(e) at API level, with no modified JS.

**Suggested fix:** Key every per-account local store (pins, pqself, dmepochs, dmpq) by something the server can't change, for example a hash of the identity public key this device proved (proven.e), not by the server-supplied id. Alternatively, record the id together with the proven identity key at first sign-in and refuse any bootstrap, login, publish or sign-key response whose me.id differs for that key. Never let a server response merged into S.me change S.me.id.

**Verifier:** Confirmed. The root cause predates this change; the new PQ stores inherit it. Code path: app.js:1276 `S.me = b.me` is never compared with localStorage 'hearth.userId' (app.js:286, the id used to load the IndexedDB key) or with the proven keys. ownKeysOk and ensureSigningKey only sign and verify with the device's own keys, so the id is never bound. Every local store is keyed by S.me.id: pins, pqself, dmepochs and dmpq. The base branch has the same line (app.js:1226).

My own test (r3verify/v.test.js V1): with only Bob's pq left out, the swapped seed-holding device wrote `d2:`. No epoch hiding was needed, because isEpochEntry drops Alice-made epochs once me.id differs and no Bob-made epochs were listed. The same tampering without the swap was refused ('untrusted'). The reviewer's A2 (no key-change warning, server key reads the d2, server-signed SDP gives ok:true) and A3 (seedless device writes d2) also pass.

Corrections, so it is noisier than claimed:
- On a seed device the swap raises the 'publish' bar, because the PQ key's signature covers the real id.
- The swapped device's own d3 history shows errors.
- Every server key stops opening (V1b: heldEpochs [], the channel message stays pending).
- The reader-side claim is wrong as stated: an unswapped Bob flags the harvested d2 (noPq:true). The flag only disappears if the server swaps Bob's id as well (V1).

Still, no 'Security key changed' or downgrade warning appears in any variant. That contradicts row 152 (calls checked against the pinned key) and row 165. I'd rate it high rather than critical.

## R3-2. [critical] A user record whose own `id` differs from the key it is stored under is checked against that other id's pin. The server can swap any pinned contact's identity and PQ keys with no warning and read new DMs to them.

**Where:** hearth/public/js/app.js:1282 (`S.users = b.users`, map keys vs record ids never compared). secure.js:118 (userWithKeys) and :682 (refreshUsers) do `S.users[id] = mergeUser(S.users[id], x)` without checking x.id; refreshUsers is triggered by the server's own 409 stale_keys at secure.js:695 and :1029. Pin lookups use the record's self-declared id: e2ee.js:861 checkPin, :961 pinnedPq, :994 pinnedKeys, and pinPq. PQ code inherits it: pqKeyOf fetches `/users/${user.id}/pq-key` (secure.js:447); wrapFor, dmSendKey and currentDmTag use u.id/peer.id (secure.js:654, :989, :1017, :943). Related: S.dms[].userId (app.js:1285) is also unbound (dmPeer, secure.js:851-856). Pre-existing in the base for d2 and signatures.

**Scenario:**
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r3hunt/repro.test.js, test B (also f4.test.js, f4b.test.js and f4c.test.js). Alice has Bob pinned (identity plus q), and the DM is on d3:1.

The server's bootstrap files under users[bob] a record with id = a fresh id 'zz…', the server's identity and signing keys, and a PQ key signed for that id. trust() TOFU-pins the fresh id, and keyChanged(Bob) stays false. Alice's next message is d3:2, in a new epoch wrapped for {alice, zz…}; a malicious server accepts the POST. The server unwraps its copy and reads 'secret for bob'.

For a DM that isn't post-quantum, the message is simply d2 to the server's key (f4.test.js pq=false). In the same state, a channel message 'from Bob' signed by the server's key decrypts with verified:true and no note, and a call offer passes checkSdp (f4b.test.js).

Variant (f4c.test.js): bootstrap relabels the DM's userId to the fresh id, with Bob's profile copied. Same result: d3:2 for {alice, zz…}, read by the server.

This contradicts §4 ('can't decrypt stored messages… can't change a message's content or author') and rows 164 and 165 (Bob's q pin is never consulted).

**Suggested fix:** Refuse or drop any user record whose id differs from the key it is stored under or the id that was requested: bootstrap users map, GET /users/:id in userWithKeys and refreshUsers, socket payloads. Pass the expected id explicitly to checkPin, pinnedKeys, pinnedPq and pinPq instead of trusting user.id. Remember dmId → peer id locally on first sight and refuse or warn when the server later names another peer for that DM.

**Verifier:** Confirmed, and it predates this change. Code path:
- app.js:1282 `S.users = b.users` never compares map keys with record ids.
- userWithKeys (secure.js:115-121) returns S.users[d.userId] without checking record.id.
- checkPin, pinnedKeys and pinnedPq all look up the pin by user.id.
- checkSdp uses pinnedKeys(S.me.id, u).s.

My own test (V2, P-256-only DM):
- Control: the server's keys under Bob's own id give keyChanged true, the send is refused ('untrusted'), and checkSdp says 'key-changed'.
- Swap: the same keys in a record with id 'zz…' stored under users[bob] give keyChanged false. The device writes `d2:` to the server's key and the server decrypts it ('only for bob'). A call offer signed by the server gives checkSdp {ok:true}.

The reviewer's B passes too: a d3:2 epoch is wrapped for {alice, zz…} and the server reads it.

Side effect: earlier DM history on that device no longer decrypts (or gets the 'listed' warning if the server lists Bob's real key as a past key). There is still no key-change warning. This contradicts row 152 ('checked against the signing key this device pinned for the sender') and rows 164/165 (Bob's q pin is never consulted).

## R3-3. [medium] Regression from 6c41813: by listing the old key's retiredAt just before the epoch's madeAt when Alice accepts Bob's new keys, the server erases the R2-1 cutoff. Forged d3 messages dated now then show only 'Written with an older key'.

**Where:** hearth/public/js/e2ee.js:954-958 (keyChangeAfter counts only `until > madeAt`). e2ee.js:978-980 (acceptPin takes the server-listed pastKeys retiredAt as `until` whenever it is earlier than now). secure.js:1063-1066 (openDm3 cutoff). The madeAt to aim at is cleartext in the dk1 header (`dk1:<madeAt>:…`).

**Scenario:**
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r3hunt/repro.test.js, test C (also f1.test.js).

Same adversary as R2-1: a thief with Bob's old identity key and PQ seed, plus the server.
1. Alice writes d3:1, an epoch of hers for Bob's old keys, with madeAt M1.
2. Bob resets without his recovery key.
3. When Alice presses 'Numbers match', the server lists Bob's old key with retiredAt = M1-1. One UPDATE of user_key_history, put back afterwards. Bob's pin.old now has until = M1-1, so keyChangeAfter(M1) returns 0.
4. After a reload, forged d3:1 messages authored as Bob or as Alice, dated now, open with keyNote 'pinned' (a mild note, not a warning).
5. Control: the same old key used as d2, dated now, is refused. With the honest retiredAt, both forgeries are refused (the repo's 'second review 1').

Before 6c41813, lastKeyChange took the newest until regardless of madeAt, so this lie didn't help.

**Suggested fix:** Don't treat a recorded change that is 'before' the epoch as exempting an epoch that is pinned only because of a tag mismatch. For example, remember locally, for each epoch this device made or opened with trust 'now', which peer identity key it was made for, and cut off at that key's `until`. Or refuse a listed retiredAt earlier than the newest epoch madeAt this device has seen for that key. Separately, acceptPin should not move `until` before epochs it already trusted for that key.

**Verifier:** Confirmed, including that it is a regression. Code path:
- acceptPin (e2ee.js:979-980) takes the server-listed pastKeys retiredAt as `until` whenever it is earlier than now.
- keyChangeAfter (e2ee.js:957) ignores any `until` at or before madeAt.
- madeAt is in cleartext in the dk1 header.
- The Verify dialog (app.js openSafetyNumber) passes sec.userWithKeys(u.id), whose pastKeys come straight from the server.

My own test (V3), same pins each time:
- Honest acceptance: forged d3:1 messages dated now, authored as Bob and as Alice, are refused.
- Acceptance of a record whose retiredAt is M1-1: both open with keyNote 'pinned'. That is the mild 'Written with an older key' note (app.js:4827), not a warning.
- The identical scenario on f491e6e's client (lastKeyChange): both forgeries are refused even with the lie.

The adversary is the same as R2-1: a thief with Bob's old identity key and PQ seed, plus the server. The lie is only needed in the record shown at acceptance time. Medium.

## R3-4. [low] An epoch key alone keeps forging fully trusted 'current' messages after the DM has moved on. There is no upper bound on a d3 message's date against the epoch's authenticated madeAt.

**Where:** hearth/public/js/secure.js:1049-1053 (openDm3 deliberately doesn't refuse messages dated past the epoch's week, but enforces no bound at all) and :979 (an epoch made for still-current keys is 'now'). Claims contradicted: ENCRYPTION-RESEARCH.md §6 ('Someone who learned an old epoch key (but not your long-term keys) loses access at the next rotation') and SECURITY.md §4 ('a leaked epoch key exposes one epoch… and the next epoch heals').

**Scenario:**
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r3hunt/repro.test.js, test E (also f3.test.js).
1. Epoch 1 is made by Alice for both people's current keys, with madeAt 60 days ago.
2. Both apps then write in epoch 2, so the DM has rotated.
3. Someone holding only epoch 1's raw key, with the server, posts d3:1 authored by Bob (or Alice), dated now.
4. Both Alice's and Bob's apps show it with no keyNote and no flag.

Legitimate d3 messages can never be dated later than about madeAt + 7 days (epoch life) + 30 days (scheduling) + 1 day (late limit) + 24 h (maker clock allowance), so anything later can only be a forgery.

**Suggested fix:** In openDm3, refuse (or at least flag as a warning) d3 messages dated more than about 40 days after the epoch's authenticated madeAt. Or document that a leaked epoch key keeps authenticity broken for that epoch forever.

**Verifier:** Confirmed, low severity. Code path: epochTrust gives 'now' to an epoch made for the current keys (secure.js:979), and openDm3 checks no date when trust is 'now'. Neither app.js nor binding.js adds an epoch or date check, and a forger can set ts=now in the binding.

My own test (V4): Alice's own app made epoch 1 with its clock set 60 days back. Both apps then moved on to d3:2. A d3:1 message dated now opened on Alice's and on Bob's device with no keyNote. This held both when passed directly and when inserted into dm_messages and read through GET.

Legitimate dates are bounded:
- epochs are reused for under 7 days by madeAt;
- scheduled.js MAX_DAYS is 30, with a 24 h late limit;
- the app's reschedule re-encrypts in place (scheduled.js reseal).

So a bound of about 40 days only affects devices with badly wrong clocks, which the app already warns about.

Caveats: confidentiality healing does hold. The docs' 'heals' and 'loses access' are about reading, so this is an authenticity gap the docs leave out. The precondition is narrow: a raw old epoch key without the identity keys, plus the server to insert the message.

## R3-5. [low] The cutoff is skipped when the peer's user record is missing: openDm3 reads the pin through S.users[d.userId], and the server can withhold that record.

**Where:** hearth/public/js/secure.js:1057 and :1065 (`const peer = d && S.users[d.userId]`; `changed = peer ? E2EE.keyChangeAfter(…) : 0`). currentDmTag swallows the failed lookup (secure.js:939).

**Scenario:**
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r3hunt/repro.test.js, test D (also f2.test.js).
1. Same R2-1 setup. Alice accepts Bob's new keys honestly, so her pin has the correct cutoff.
2. On her next load the server leaves Bob out of /bootstrap users and answers GET /users/:bob with 503.
3. A forged d3:1 authored as Bob, dated now, opens with keyNote 'pinned'.
4. Control: with Bob's record present it is refused.

The pin needed for the cutoff is local and needs only Bob's id, which the DM already has. An id-less record has the same effect (f2b.test.js).

**Suggested fix:** Call keyChangeAfter(S.me.id, { id: d.userId }, got.madeAt), with the id taken from the DM, and fail closed (refuse) when the epoch's trust is not 'now' and the peer's pin can't be consulted.

**Verifier:** Confirmed, low severity. Code path:
- openDm3 (secure.js:1057, :1065) only checks the cutoff when S.users[d.userId] exists. Otherwise `changed` is 0.
- keyChangeAfter needs only the id: in V5, keyChangeAfter(a.id, {id: b.id}, M1) > M1 is true.
- Without the record, currentDmTag's catch (secure.js:939) returns null, so the epoch drops to 'pinned'.

My own test (V5): after Alice accepts Bob's new keys honestly, the bootstrap leaves Bob out and GET /users/:bob returns 404. A forged d3:1 authored as Bob, dated now, then opens with keyNote 'pinned'. With the record present it is refused.

In the app the result persists once the record arrives: the user:update handler doesn't re-decrypt DMs, and decryptDmMessage keeps a decrypted result that isn't pending.

Side effects while the record is withheld: d2 history shows errors, every d3 message gets the 'pinned' note, sending fails, and the author shows as 'Unknown user'. The adversary is the same as R2-1. The reviewer's f2b (record without an id) has the same effect.

## R3-6. [high] R2-4 bypassed: a self user:update during the first ensureSigningKey gets the new ECDSA signing key locked to the server's ECDH key

**Where:** hearth/public/js/secure.js:218-232 (ensureSigningKey checks ownsPublicKey(S.privateKey, S.me.publicKey) at :220, then after that await re-reads S.me.publicKey for createSigningKey at :226 and for the signature text at :231). hearth/public/js/app.js:801-809: the self-record filter only runs when sec.provenKeys() is non-null, and proven is first set by ownKeysOk at the end of ensureSigningKey. Other self-record merges have no filter at all: app.js:1379-1383 setUser, reached from :886-888 (relationship:update), :974-975 (member:add), :1067-1069 (dm:message) and :1389 (getUser). Contradicts SECURITY.md row 167 ('a self record listing other public keys for you is ignored'). The mechanism predates this change (same ensureSigningKey on the base branch), but the R2-4 fix and row 167 claim it is covered.

**Scenario:**
This happens on the first start of a new account, or after a reset without a recovery key (sign_public_key is NULL).
1. loadBootstrap sets S.me = b.me.
2. ensureSigningKey awaits ownsPublicKey on the real key.
3. During that await the server pushes user:update {id: me, publicKey: serverPub}. provenKeys() is null, so app.js merges it into S.me.
4. createSigningKey locks the new signing private key with HKDF(ECDH(myPriv, serverPub)).
5. The server pushes the real key back before it answers /me/sign-key/challenge. The signature text then holds the real key, so even the honest route accepts it.
6. ownKeysOk passes and the user sees no error.
7. The server computes ECDH(serverPriv, myPub) and opens the posted encSignPrivateKey.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t2-signkey-race.test.js: provenKeys() is null when the record arrives, and the key opened from the posted copy signs text that verifies under the account's published signing key.
With that key the server can:
- rotate a server's key in the member's name; members adopt a key it chose, so it reads those channels now;
- sign its own ML-KEM key as the account's post-quantum key; peers then wrap dk1/w2 for the account to a key it holds, which is harvest-now-decrypt-later;
- forge signed messages.
It is timing-dependent: the record must arrive during ownsPublicKey's WebCrypto awaits. A miss mostly goes unnoticed, and the server can force a retry by refusing the sign-key POST.
After proven is set, the same record via member:add or dm:message still overwrites S.me.publicKey. That only makes every write fail with own_key_mismatch (a DoS).

**Suggested fix:** In ensureSigningKey, read `const pub = S.me.publicKey` once. Check ownsPublicKey(pub), use pub for createSigningKey, unwrapSigningKey and the sign-key signature text, and re-check S.me.publicKey === pub before posting. In setUser, never merge publicKey, signPublicKey, pqPublicKey or pqSig from socket or user records into S.me; drop those fields whether or not anything is proven yet. Own keys change only by a reset, which signs the device out.

**Verifier:** Confirmed. secure.js:220 checks ownsPublicKey on the value read before the await, then :226 re-reads S.me.publicKey for createSigningKey. The self-record filter at app.js:801-809 only runs once sec.provenKeys() is non-null, and proven is first set by ownKeysOk at :240 (:223 on the unwrap path). member:add (app.js:974), relationship:update (:887), dm:message (:1068) and getUser call setUser with no filter at all. My test pq4v/v1-signkey-pump.test.js does not hook WebCrypto: the 'server' sends one self record {publicKey: its key} per macrotask (setImmediate, like websocket frames) from the bootstrap answer until the challenge request, then the real key once. 8 of 8 first starts of new accounts finished with no error, the honest /me/sign-key route stored the key, and the server opened encSignPrivateKey with ECDH(evilPriv, myPub). pq4v/v3-fresh-key.test.js shows what that key allows: peers accept a server-made ML-KEM key signed with it, and the q pin moves without a warning, so dk1/w2 for the account become P-256-only (harvest now, decrypt later). The SDP and message signatures can be forged as well. The proven-key tail is right too: member:add still rewrites S.me.publicKey after proven is set, so every write fails with own_key_mismatch (DoS). Caveats: (1) the mechanism predates this diff (base ensureSigningKey is identical, and base had no self-record filter at all), but the diff's row 167 now claims a self record listing other keys is ignored. (2) It is not silent forever: the next start cannot open the copy sealed under the server's key (OperationError) unless the server races again. With a naive alternating stream, 13 of 30 later starts still worked (pq4v/v1b-later-starts.test.js). The key is already out by then.

## R3-7. [medium] R2-1 not fixed: a retiredAt the server lists earlier than the epoch's madeAt switches off the cutoff for epochs you made, so forged d3 dated after acceptance open as 'pinned' while d2 is refused

**Where:** hearth/public/js/e2ee.js:980 (acceptPin uses the server-listed retiredAt as `until` whenever it is earlier than now). e2ee.js:954-958 (keyChangeAfter only counts old entries with until > madeAt). hearth/public/js/secure.js:979 (an epoch you made whose tag mismatches becomes 'pinned'), :1053-1066 (the only check left is keyChangeAfter(peer, got.madeAt) with at > changed). app.js:4827 ('pinned' shows the mild 'Written with an older key', no warning). binding.js:265 (binding trusted for 'pinned'). Contradicts SECURITY.md row 166 and ENCRYPTION-RESEARCH 5(d): 'before the first change of their identity key this device saw after the epoch was made'.

**Scenario:**
Same adversary as R2-1: Bob's stolen device (old identity key and old seed) plus the server.
1. a and b both have PQ keys. a makes epoch 1 (madeAt T1).
2. The thief opens b's copy of epoch 1 and gets K1.
3. b resets without the recovery key.
4. When a compares numbers and accepts b's new keys, the server lists b's old key in pastKeys with retiredAt = T1 - 1 s. acceptPin stores until = T1 - 1 s, so keyChangeAfter(b, T1) = 0.
5. After a reload, a forged d3:1 authored by b and dated after the acceptance opens as {t:'forged d3 as b…', keyNote:'pinned'}. One authored by a also opens.
6. Control: a d2 with b's retired key and the same date gives {error:true}. With the honest retiredAt, the same d3 is refused.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t1-retired-before-epoch.test.js.
The server does not even need a false retiredAt. It can hide b's reset from a for a while, so that a's app makes an epoch for b's old keys after the real retirement. A malicious server accepts that POST. Then the true retiredAt already precedes that epoch's madeAt, and the epoch refuses nothing.

**Suggested fix:** Store locally when this device saw or accepted each change, e.g. old[].seen = Date.now() in acceptPin. Make keyChangeAfter and openDm3 cut off at the first change this device saw after madeAt, using that local time and never the server-listed retiredAt. An epoch you made whose tag is stale should refuse everything dated after that local acceptance time, even when the listed until is earlier than its madeAt.

**Verifier:** Confirmed. acceptPin (e2ee.js:979-980) stores the server-listed retiredAt as until whenever it is in the past. keyChangeAfter (e2ee.js:954-958) only counts entries with until > t. For an epoch you made whose tag is stale (secure.js:979 makes it 'pinned'), openDm3 (:1053-1066) refuses only messages dated after keyChangeAfter(peer, madeAt), which is then 0. Re-ran t1: with retiredAt = madeAt-1s at the moment of acceptance, forged d3:1 messages from b and from a, dated after the acceptance, open after a reload with keyNote 'pinned'. A d2 with the same retired key and date gives {error:true}, and with the honest retiredAt the same d3 is refused. The row-166 branch 'a change before it refuses nothing' can only be reached through a lying server for an epoch a made for b's old keys: an honest server refuses such an epoch with stale_keys (index.js:4428), so either a false retiredAt or a hidden reset is needed. The UI shows only the mild 'Written with an older key' (app.js:4827), and binding.js:265 trusts the forged message's binding. Same adversary and severity class as R1-5/R2-1: b's old identity key plus seed, and the server.

## R3-8. [low] R2-3/R2-5 not fully fixed: d3 messages whose epoch isn't listed are no evidence, so a seedless device the server shows nothing else writes d2 in that DM and a w1 own copy when it rotates

**Where:** hearth/public/js/secure.js:1040-1048 (openDm3 throws 'Missing key' at :1045 before E2EE.noteDmPq at :1046). secure.js:268-270 (accountHasPq). secure.js:881-893 (dmIsPq; encryptDm writes d2 when !minePq && !pqDm). secure.js:669-674 (the own copy goes through myPqForWriting, which returns null, so w1). secure.js:353-357 (with the password, the envelope's seed is adopted only after a successful publish).

**Scenario:**
The laptop was signed in before the account got its key: no seed and nothing in its storage. From its first start the server:
- strips pqPublicKey and pqSig from its me record, and pq from its users entry;
- answers its GET /dms/:id/keys with {epochs:[]};
- withholds the account's w2 server-key copies.
The DM still shows its d3:1 messages, as 'could not be decrypted'. The laptop shows the 'upgrade' bar ('turn it on for your account') and has pinned b's PQ key. Yet:
- encryptDm writes d2:, which P-256 alone opens;
- with needsRotation set, forceRotate sends {own: w1, b: w2}. The honest server refuses (stale_keys); a malicious one keeps it.
Entering the password doesn't help if the server then refuses the publish: the seed taken from the envelope is never adopted, and the bar goes back to 'upgrade'.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t3-d3-not-evidence.test.js and t3b-rotation-w1.test.js. b's seed-holding device flags the d2 (noPq), but only after it has been recorded.

**Suggested fix:** In openDm3, call noteDmPq as soon as the text is d3, before looking up its epoch, and count any d3 message as evidence in accountHasPq; show the 'seed' bar, not 'upgrade'. In ensurePqKey with ctx, adopt the envelope's seed before trying to publish, so a refused publish leaves the device read-only rather than P-256-only.

**Verifier:** Confirmed, in two parts. (a) openDm3 throws 'Missing key' at secure.js:1045, before noteDmPq at :1046, so d3 messages whose epoch is not listed leave no evidence. With me.pqPublicKey/pqSig, users[me].pq and the epoch list stripped, accountHasPq (:268-270) is false and encryptDm (:893) writes d2 to b, whose PQ key is pinned. Re-running t3/t3b gives d2 and a w1 own copy in a rotation. (b) is stronger and not covered by the TOFU caveat (pq4v/v4-refused-publish.test.js): after the password is entered, the envelope holds the seed, but the ctx path (:353-357) adopts it only after publishPq succeeds. A server that answers 503 leaves the bar at 'upgrade' with S.pqSeed null, and the device keeps writing d2 that P-256 alone opens. That contradicts row 168 ('a seed that was never published writes P-256 DMs only to people without a post-quantum key') and row 167. It needs a malicious server, and b's device flags noPq only after the fact. Low to medium.

## R3-9. [low] R1-11 not fully fixed: staleRecovery and lockPq are taken once per applyState, but keepForMyself picks the key later, so a w1 copy from another member is re-stored as w2 if the upgrade's publish lands in between

**Where:** hearth/public/js/secure.js:499-501 (canKeep, lockPq and staleRecovery computed before the loop). :552 (`!(staleRecovery && w1 && lockPq)` is true while lockPq is null). :584 (keepForMyself calls myPqForWriting later, in its job). app.js:1302 (applyState runs after 8 s even while ensurePqKey's publish is still going). Any keys:state applyState that straddles the publish hits the same gap. Contradicts ENCRYPTION-RESEARCH ('copies that open with the identity key alone are never replaced with hybrid ones') and SECURITY.md row 163.

**Scenario:**
Setup: a pre-1.40 account with a pre-1.40 recovery key, and another member's w1 handoff (wrapper is not you) of an epoch with pre-upgrade history.
1. At the upgrade sign-in, POST /me/pq-key takes more than 8 s, or a keys:state arrives while it runs.
2. applyState sees no PQ key yet (lockPq null, staleRecovery false) and queues the copy.
3. The publish lands.
4. keepForMyself's myPqForWriting returns the new key, and keys/self stores a w2 self copy over the w1 one.
5. Later the epoch rotates, and the user resets with that recovery key (pqInEnvelope false, new key). That epoch never opens again, pre-upgrade history included.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t5-stale-recovery-race.test.js: recoveryStale is true, the copy is w2 by v, and after the reset the message is {pending:true}.

**Suggested fix:** Decide at wrap time. In keepForMyself, after myPqForWriting, re-read S.me.hasRecovery && S.me.recoveryStale and skip entries that arrived as w1 (pass each entry's original format). Alternatively, don't open server keys until ensurePqKey has settled, or re-run applyState after adoptPq.

**Verifier:** Confirmed with plain timing. applyState snapshots canKeep, lockPq and staleRecovery at secure.js:499-501 and decides at :552, but keepForMyself's job picks recipientPq later, at :584. In pq4v/v5-slow-publish.test.js a timer releases the answer to the upgrade's POST /me/pq-key X ms after applyState starts. This models loadBootstrap's 8 s race (app.js:1302) with a publish that took 8 s + X. Nothing in the loop is gated and nothing is forced to fetch. At X=20 ms (inside the 38 ms applyState), all 20 w1 handoffs from o were re-stored as v's w2 self copies with recoveryStale=true. At X=60 and X=400 (after applyState), they all stay w1. t5 shows the loss that follows a reset with that recovery key ({pending:true}). It is a narrow race: the answer must land within one server's applyState, or a keys:state must arrive during the publish. Low.

## R3-10. [low] R2-8 not fully fixed: a tab open across a restore keeps the lost epochs' raw keys in dmRaw by epoch number, then reads new epochs as errors and writes messages nobody else can open

**Where:** hearth/public/js/secure.js:918 and :949 (dmRaw is keyed only by `${dmId}|${epoch}` and returned before the listed entry is looked at). :929 (dm:keys drops only the epoch list). :1009-1011 (dmSendKey reuses the cached madeAt, tag and raw). app.js loadBootstrap (from :1265) runs on every reconnect and never calls sec.reset; only app.js:577 does. Contradicts RECOVERY.md ('Nothing is lost by it').

**Scenario:**
1. The owner restores a backup from before a DM's epochs; tabs stay open.
2. The server restarts and the apps reconnect with the same version.
3. a's app says the conversation went back in time. a confirms, and a's app makes a new epoch 1.
4. b's tab still has the old epoch 1 in dmRaw. The listed top now equals its high-water mark, so it shows no prompt.
5. b's tab opens 'epoch 1' from the cache: old raw, old madeAt and tag, so trust 'now' and under a week old. It writes d3:1 with the lost key, and shows a's new message as an error.
6. a cannot read b's message, and neither can b after a reload.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t4-restore-stale-raw.test.js: a reads ['a after the restore','(error)'], and so does b after reloading.

**Suggested fix:** Key the cache by the copy itself, e.g. `${dmId}|${epoch}|${e.wrapped}`, or have openDmEpoch check that the cached entry was opened from the same wrapped string. Also clear dmRaw and dmEpochs in loadBootstrap on every reconnect, and on dm:keys.

**Verifier:** Confirmed. dmRaw is keyed only by `${dmId}|${epoch}` (secure.js:918) and is returned at :949 before the listed entry is looked at. sec.reset is called only from signOutHere (app.js:577), and the reconnect's loadBootstrap keeps both caches. pq4v/v6-restore-open-tab.test.js runs two variants. (1) Right after the restore, b's open tab writes d3:1 with the lost key and shows no 'went back in time' prompt, because its cached list still has the old epoch 1. (2) a's reloaded app gets 'rollback', confirms, and makes a new epoch 1; the server's dm:keys (index.js:4436) reaches b's tab, which again writes d3:1 with the old raw key. a reads both of b's messages as (error), and so does b after a reload. This contradicts RECOVERY.md's restore paragraph ('says so … and sends nothing', 'Nothing is lost by it'). Needs a restore with tabs left open. Low.

## R3-11. [low] R2-14(b) not fully fixed: in the 'seed' case, the password entered in one tab doesn't reach the other tabs, which stay read-only behind the bar

**Where:** hearth/public/js/secure.js:344 (with the key already published, the password path adopts the seed without publishing, so no user:update goes out). secure.js:303-316 (adoptPq stores the seed in IndexedDB and sends no cross-tab signal). app.js:810 (only a change of pqPublicKey re-runs ensurePqKey). app.js:157 (the storage listener only clears a cache).

**Scenario:**
Two tabs of a browser that was signed in before the account got its key both show the 'seed' bar. The user enters the password in tab A, which adopts the envelope's seed. Tab B keeps the bar and refuses sends with need_password ('enter your password once on this device') until it is reloaded or the password is entered there too.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pq4r/t6-two-tabs-seed.test.js: tab A needs nothing, the seed is in IndexedDB, and tab B still needs 'seed' and gets need_password on send.

**Suggested fix:** After adoptPq, signal other tabs, for example with a localStorage key plus a storage event, or a BroadcastChannel. On that signal they run ensurePqKey() without ctx, which already loads the seed from IndexedDB.

**Verifier:** Confirmed, minor. In the 'seed' case, ensurePqKey with ctx adopts the envelope's seed (secure.js:344) without publishing, so no user:update goes out. adoptPq (:303-316) writes only to IndexedDB, plus a localStorage pin that hasn't changed. Nothing signals the other tabs: app.js:157 only clears lsCache, and there is no BroadcastChannel. Re-ran t6: tab A needs nothing and the seed is in IndexedDB, but tab B still needs 'seed' and its sends fail with need_password. Low: tab B recovers at its next reconnect (loadBootstrap, then ensurePqKey loads the stored seed at :371-372), on a reload, or by entering the password again. Same impact class as the accepted R2-14.

## R3-12. [high] After a restore from backup (same Hearth version), apps left open keep writing DMs with epoch keys the server no longer has; every such message is permanently undecryptable after any reload, and the rollback dialog never appears

**Where:** hearth/public/js/secure.js:917-929 (dmEpochs list cache, cleared only by dm:keys), :949 (dmRaw keyed by `${dmId}|${epoch}` only, never checked against the listed copy), :991-1011 (i=0 uses the cached list and returns before the hw > listedTop check at :994), :1293-1297 (reset() runs only at sign-out, app.js:577); hearth/public/js/app.js:710-718 (a reconnect with the same version just reruns loadBootstrap, which touches neither cache); hearth/server/index.js:4006-4008 (POST /dms/:id/messages accepts a d3 for an epoch dm_keys doesn't have). Contradicts docs/RECOVERY.md:286-292 ('says so … and sends nothing', 'Nothing is lost by it'). Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t8-restore-opentab.test.js

**Scenario:**
1. Users a and b have published PQ keys. After the nightly backup they start (or weekly-rotate) a DM epoch: d3:1.
2. The owner restores that backup per RECOVERY.md with the same version. Sessions are restored, and open apps reconnect without reloading.
3. Both open apps send 'a, after the restore' and 'b, after the restore'. Each is written d3:1 with the lost key, the server lists no epochs, and both POSTs return 200. Both open apps read each other, so nobody notices.
4. b reloads. Both messages read '(error)' ('This message could not be decrypted on this device'), permanently.
5. b's reloaded app now gets 'rollback'. b confirms it and makes a new epoch 1.
6. a's still-open app has the old raw key cached under the same 'dm|1' id. It can't read b's new message, and its own next message is '(error)' for b.
The server-key analog (base secure.js:270 skipping held epochs) is pre-existing; this DM path is new.

**Suggested fix:** Clear dmEpochs, dmRaw and dmAsked on every (re)connect / loadBootstrap, and re-check the high-water mark before the first write after a reconnect (do the hw > listedTop check on a fresh list at i=0, not only on retries). Key dmRaw by the listed `wrapped` text, or drop an entry whose listed copy changed. Server side, refuse a d3 message whose epoch has no dm_keys row for that DM.

**Verifier:** Confirmed in code, and independently with an actual file-level restore: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/v4refute/f1-real-restore.test.js takes a snapshot with VACUUM INTO, stops the server, copies the snapshot back over hearth.db and restarts, while both secure.js instances stay open. Result: both apps write 'd3:1:', the server lists no epochs, and a fresh device reads ['(error)','(error)'].

Why it happens:
- `sec` lives for the whole page (app.js:132). reset() runs only at sign-out (app.js:577).
- A same-version 'connect' (app.js:710-718) only reruns loadBootstrap, which clears S.msgs but leaves dmEpochs, dmRaw and dmAsked alone.
- dmSendKey's first pass uses the cached list (secure.js:991). The hw > listedTop rollback check runs only on retries (:994), so the open app reuses the cached epoch and key.
- The server's POST /dms/:id/messages (index.js:4377-4389) only runs validCipher (length check), so it stores d3 messages for an epoch it no longer has.

Re-running t8 also confirms the second half. After the reloaded app confirms the rollback and makes a new epoch 1, the still-open app's dmRaw entry 'dm|1' (keyed by epoch only, :948-949) is the old key. It can't read the new epoch, its own next message is '(error)' for the peer, and hw == listedTop, so it is never asked.

This contradicts RECOVERY.md:286-292 ('sends nothing', 'Nothing is lost'). The loss is availability, not confidentiality. Restores are documented and nightly backups make post-backup epochs common, so high severity is fair.

## R3-13. [high] A member left out of a rotation (deferred) is never re-shared the key when their PQ key comes back, and permanently loses every epoch that rotates away meanwhile (before 1.41 they got a P-256 copy)

**Where:** hearth/public/js/secure.js:669-672 (deferral), :610-618 (maintain/share only from applyState); hearth/public/js/app.js:788-831 (user:update calls maintain only for a verified reset, :818, not when someone's pq changes); hearth/server/index.js:2618 (/me/pq-key only broadcastUser, no key-state emit), :3454-3465 (deferral accepted), :3492 (keys/share only for the current epoch). Contradicts docs/RECOVERY.md:295-296 and SECURITY.md §4 ('shared with them once their key is back'). Repros: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t4-deferred.test.js, t11-deferred-loss.test.js

**Scenario:**
t4: the server is restored from before m's PQ key. Someone leaves, and the owner's rotation defers m, as designed. m enters the password and republishes. The owner's open app receives only 'user:update' and 'user:presence', never keys:state, so maintain() never runs. m's app says 'You don't have this server's encryption key yet. It arrives as soon as another member comes online.' while the owner is online. In a quiet server or group this lasts until another member's app reconnects or restarts.
t11: the same setup. The owner writes in epoch 2 while m is deferred. m republishes. Then another member leaves and the owner rotates to epoch 3, this time including m. m holds epochs [1,3] and sees '(pending, before)', i.e. 'Sent before you joined…', for the epoch-2 message. keys/share for epoch 2 returns 409 'epoch', so no one can ever give it to m. After a 1.41→1.40→1.41 rollback, every account's key is gone, so most members are deferred by every pinning app and lose each rotated epoch.

**Suggested fix:** Record deferrals server-side (server, epoch, user). Let keys/share accept those epochs for those members, and have apps share any epoch they hold to listed deferrals. When /me/pq-key publishes for someone with pending deferrals or who is in `missing`, emit keys:state for their servers (or call maintain for shared servers from the user:update handler when `pq` changes).

**Verifier:** Confirmed by re-running t4 and t11, and in code. 'Never' is overstated: the share does happen at the next maintain() trigger (t4's last step). But that trigger isn't tied to the key coming back, and the permanent loss is real.

Why the share waits:
- POST /me/pq-key only calls broadcastUser (index.js:2618), with no emitKeyState.
- The app's user:update handler calls maintain only when a held-back member gets verified (app.js:817-820).
- Otherwise maintain runs only from applyState: keys:state, bootstrap, server:add.
- The owner's live socket saw only user:update and user:presence. Meanwhile the member's ready() says 'It arrives as soon as another member comes online' while the owner is online.

Why an epoch can be lost for good:
- keys/share accepts only the current epoch (index.js:3492).
- If another rotation happens before a share, the member never gets that epoch. In t11 m holds epochs [1,3], sees '(pending, before)' ('Sent before you joined') for epoch 2, and a share of epoch 2 returns 409 'epoch'.
- Before 1.41 every member got a w1 copy, so this is new.

Besides restore or rollback, a keep-keys reset with a recovery key from before the upgrade also clears pq_public_key (accounts.js, pqInEnvelope === false) while others still have the member's PQ pin, which also defers them. This contradicts SECURITY.md §4 and RECOVERY.md:295-296 ('shared with them once it's back'). Severity medium-high.

## R3-14. [medium] Per-account limit of 30 new DM epochs an hour blocks ordinary users: the 31st DM that needs a new epoch fails with 'Too many attempts. Try again in 60 minutes.'

**Where:** hearth/server/index.js:4420 (rateLimit('dmkeys:'+userId, 30, 1 h), counted before any check, fixed window); hearth/public/js/secure.js:1013-1035 (each DM's first PQ message, and the first after a week, posts a new epoch; a 429 just throws). SECURITY.md §4 / ENCRYPTION-RESEARCH §7(d) mention the limit only under a hostile server. Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t1-ratelimit.test.js

**Scenario:**
Honest server. A user with a PQ key writes one message to each of 31 contacts with PQ keys, e.g. after signing in on 1.41, catching up after a week away, or 'happy new year' to friends. Output: [... 'd3:1:', 'd3:1:', 'ERR rate_limited: Too many attempts. Try again in 60 minutes.'].
For the rest of the hour, no DM that needs a new epoch can be sent from any of the account's devices. That includes every conversation whose weekly epoch expired. Retries also count. The same message as d2 (1.40 behaviour) goes through.

**Suggested fix:** Count only epochs actually created, per DM (e.g. one new epoch per DM per day, plus key-change epochs), instead of 30 an hour per account. Or raise the cap well above realistic fan-out.

**Verifier:** Re-ran t1 against the server's own limiter (the test server doesn't override it): 30 × 'd3:1:', then 'rate_limited: Too many attempts. Try again in 60 minutes.'. The d2 control for the same DM is accepted.

Details:
- rateLimit('dmkeys:'+userId, 30, 1h) at index.js:4420 is a fixed window, counted before any check, shared by all of the account's devices. Retries count too.
- dmSendKey posts a new epoch for the first post-quantum message in each DM where you write first, after the week expires, and after key changes (secure.js:1013-1035). The 429 surfaces as a failed send.
- Messages themselves are allowed 1,500 an hour (index.js:132).

So an honest user who is first to write in more than 30 post-quantum DMs within an hour can't send in any DM that needs a new epoch for up to an hour. Examples: an admin messaging members, replying to many DMs after a week away, or the first day on 1.41. SECURITY.md §4 and ENCRYPTION-RESEARCH §7(d) describe this limit only as something a hostile server can trigger. Medium-low, since it needs heavy fan-out.

## R3-15. [medium] Start-up previews of post-quantum DMs cost 2 API requests per DM against the account-wide 1,200/min limit; heavy users get 429s app-wide and previews stuck on 'could not be decrypted'

**Where:** hearth/public/js/app.js:1491-1507 (loadPreviews decrypts every DM's last message; bootstrap returns all DMs ever, server/index.js:2641); hearth/public/js/secure.js:1042 (GET /dms/:id/keys), :1097 and :941 (GET /users/:id/pq-key per peer, not batched); hearth/server/index.js:1735/1749 (API_RATE_LIMIT 1200/min per account, all devices). Repros: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t7-preview-requests.test.js, t9-preview-burst.test.js

**Scenario:**
t7 measures {'GET /api/dms/:id/keys': 6, 'GET /api/users/:id/pq-key': 6} for 6 d3 previews: 2 per DM, where 1.40 needed none. d2 DMs with PQ peers cost 1–2 as well, for never-upgraded accounts too.
t9 scales the limit to 100/min with 60 such DMs. 11 previews come back '(error)', and the account's next request gets 429 'Too many attempts. Try again in 60 seconds.' Failed previews stay failed: decryptDmMessage skips non-pending results.
At the defaults the threshold is about 600 such DMs per account, or about 300 when two of the account's apps reload together, which every server update causes.

**Suggested fix:** Batch peer PQ keys through POST /users/pq-keys and DM epoch lists in one request (or skip them for previews). Treat a lookup or 429 failure as retryable rather than a final error.

**Verifier:** The mechanism is confirmed. t7 counts exactly 2 requests per d3 preview: GET /dms/:id/keys (openDm3 → dmKeyList) and GET /users/:id/pq-key (pqKeyOf via dmKeys/currentDmTag). They aren't batched, although POST /users/pq-keys exists. The 1.40 openDm made no requests.
- d2 DMs with post-quantum peers cost 1-2 requests as well (secure.js:1097, :1079), even for accounts that never upgraded.
- Re-ran the scaled t9 (limit 100/min, 60 DMs): 11 previews come back '(error)' and the next request gets a 429.
- A failed preview stays failed: openDm returns {error:true} and decryptDmMessage skips non-pending results (:1124) until the next loadBootstrap.

Reach is narrower than 'heavy users' suggests. loadPreviews runs sequentially (app.js:1492) with about 2 round trips per DM. At the default 1,200/min, one app needs more than about 600 such DMs and under about 50 ms round-trip time. Two of the account's apps reloading together (every server update) halve that to about 300. Real, but low severity rather than medium.

## R3-16. [medium] Spurious red '⚠ Without post-quantum encryption' on honest pre-upgrade d2 messages when the device that made the DM's first epoch has a slow clock

**Where:** hearth/public/js/secure.js:1005/1015 (madeAt = the maker's raw Date.now()), :1073-1085 (d2AfterPq: flags any d2 whose server createdAt > first, with no tolerance), :1117; tip text in hearth/public/js/app.js messageTrust (noPq: '…so the server may have tricked it'). Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t2-clockskew.test.js

**Scenario:**
1. Alice (no PQ key yet) and Bob (PQ) chat in d2: 'alice before (d2)', 'bob before (d2)'.
2. A minute later Alice signs in with her password on a laptop whose clock is 5 minutes slow, and sends, which makes epoch 1.
3. Bob sees ['alice before (d2) [noPq]', …], and Alice sees ['bob before (d2) [noPq]', …]. Each gets the red warning blaming the server for an honest message written before the DM went post-quantum.
Control with accurate clocks: nothing flagged. Any skew Δ flags the d2 messages from the last Δ before the epoch, which is exactly when people are chatting through the switch.

**Suggested fix:** Allow a tolerance in d2AfterPq (e.g. at > first + 10 min). Or base `first` on the server-adjusted clock (clockOffset) only for this comparison, keeping the raw clock for epoch age.

**Verifier:** Re-ran t2. The test server is a separate process, so the mocked clock affects only the client. With the epoch maker's clock 5 minutes slow, Bob sees 'alice before (d2) [noPq]' and Alice sees 'bob before (d2) [noPq]'. The accurate-clock control flags nothing.

Why:
- madeAt is the maker's raw Date.now() (secure.js:1005/1015).
- d2AfterPq compares it with the server's createdAt (:1125) using `at > first` with no tolerance (:1085).
- The result is the red warning whose tip says the server may have tricked the sender (app.js:4831).
- Elsewhere the app tolerates up to a day of clock skew (it warns only past that, app.js:1268-1276), so minute-level skew is common and never reported.

The falsely flagged window is the Δ just before the epoch, which is exactly when people chat through the switch. Low-medium: a false alarm that needs more skew than the gap between the last d2 and the first post-quantum send.

## R3-17. [low] One failed post-quantum key lookup marks every d3 message in the DM 'Written with an older key', the reader's own included, until the messages are reloaded

**Where:** hearth/public/js/secure.js:941-943 (currentDmTag maps any pqKeyOf failure, network or 503 included, to null), :979 (epochTrust then demotes every epoch to 'pinned'), :1123-1124 (decryptDmMessage never re-opens a non-pending result). The third-review test 'a failed lookup' checks texts only. Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t3-lookupfail.test.js

**Scenario:**
Two PQ users, d3 messages, nobody changed keys. b's app restarts while GET /users/:a/pq-key returns 503 once (a phone dropping signal, a busy server, or the 429s from the preview burst). It shows ['from a [pinned]', 'from b [pinned]'] ('Written with an older key — Written with a key this person had before they changed keys'). After the lookup works again, the same loaded messages keep the note. Only a fresh load of the DM (reconnect) shows them clean.

**Suggested fix:** Distinguish 'couldn't check now' from 'doesn't match' in currentDmTag. On a lookup error keep 'now' or return a retryable state, and re-decrypt once the lookup succeeds.

**Verifier:** Real, but the scope is overstated.

The mechanism is as described:
- currentDmTag turns any pqKeyOf failure into null (secure.js:941-943).
- epochTrust then downgrades 'now' to 'pinned' (:979).
- The decrypted result is kept: decryptDmMessage skips non-pending results (:1124), and loadMessages/decryptAll reuse S.msgs until the next loadBootstrap.

What 'one failed lookup' actually does (my variants, f6-single-failure.test.js and f6-variants.test.js in the scratchpad v4refute folder):
- A single immediate 503 is absorbed by the next pqKeyOf call, and nothing is marked.
- A single slow failure, or an epoch the reader made, marks only the first message decrypted: ['b0 [pinned]','a0','b1',…].
- Every message is marked only while lookups keep failing for the whole read, as in t3, for example during finding 4's 429 window.

The reader's own messages are affected. The note is mild ('Written with an older key'), so low severity.

## R3-18. [low] The password entered in one tab doesn't reach the browser's other tabs in the common 'seed' case: they stay read-only and keep the bar (contradicts SECURITY.md row 168)

**Where:** hearth/public/js/secure.js:303-316 (adoptPq stores the seed in IndexedDB but nothing tells other tabs), :366-372 (loadPqSeed only runs inside ensurePqKey); hearth/public/js/app.js:811 (other tabs call ensurePqKey only when pqPublicKey changes, which doesn't happen when the key was already published). SECURITY.md:227 (row 168: '…or in another tab, doesn't bring the bar back'). Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t5-tabs.test.js

**Scenario:**
An account whose key another device already published. Two tabs of one browser, both signed in before, both show the 'seed' bar. The password is entered in tab A, so the seed lands in IndexedDB.
Tab B receives only ['user:update', 'user:presence'], with no pq change. Tab B still has neededPassword 'seed', reads ['(waiting)'], and a send fails with need_password ('Enter your password once on this device'). That lasts until a reload or reconnect, or until the password is typed again there. The R2-14(b) fix covers only the upgrade case, where a publish happens.

**Suggested fix:** After adoptPq, signal other tabs (BroadcastChannel, or a localStorage 'storage' event) so they run ensurePqKey(), which loads the seed from IndexedDB. Also try loadPqSeed before throwing need_password.

**Verifier:** Re-ran t5 and checked every caller. In the 'seed' case (key already published by another device), entering the password in tab A only adopts the seed into IndexedDB (secure.js:306). Nothing is published, so tab B sees no pqPublicKey change and app.js:811 doesn't run ensurePqKey.
- ensurePqKey's only other callers are start-up (app.js:1302) and the unlock (app.js:212).
- No storage event or BroadcastChannel carries the change.
- myPqForWriting (secure.js:281-291) throws need_password without trying loadPqSeed.

Tab B keeps neededPassword 'seed', shows d3 messages as '(waiting)', and refuses sends with need_password. This lasts until a reconnect or reload, or until the password is typed in that tab too. That breaks 'Enter your password once on this device'. R2-14's fix covers only the upgrade case, where a publish happens. Low.

## R3-19. [low] After a restore (or rollback and re-upgrade), the first password re-entry mints a brand-new PQ key instead of republishing the seed the device holds, so every other device drops its seed and asks again

**Where:** hearth/public/js/secure.js:339-363 (ctx path: with pub null and envSeed null, S.pqSeed is ignored and addPqToEnvelope makes a new seed at :360), :375 (other devices then dropSeed). Contradicts docs/RECOVERY.md:293-294 ('publishes the key again from their password envelope') and :329-332. Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/r4hunt/t6-restore-republish.test.js

**Scenario:**
1. A legacy account upgrades after the backup on two devices, both holding seed S1 (PK1).
2. The restore brings back the backup's users row: no key, and an envelope without a seed. Both devices show the 'publish' bar.
3. The password on device 1 publishes a new key: 'published again is the same key: false', 'device 1 kept its seed: false'.
4. Device 2 hears of it, drops S1 and shows 'seed'. Every device needs the password again, not once per account.

**Suggested fix:** In ensurePqKey(ctx), when nothing is listed and the envelope has no seed but this device holds one, put S.pqSeed into the envelope (addPqToEnvelope with seed) and publish it. Correct RECOVERY.md.

**Verifier:** Re-ran t6. After the restore both devices show 'publish'. The password on device 1 publishes a new key ('same key: false'), and device 2 then drops S1 and shows 'seed'.

Code: in ensurePqKey(ctx), when nothing is listed and the restored envelope has no seed (secure.js:339-363), S.pqSeed is never considered and addPqToEnvelope mints a new seed (:360). The other devices then reach dropSeed (:375).

Nothing is lost on the server: the restored database has no copies for PK1, and while nothing is listed no device writes with S1. So the impact is a password prompt on every device instead of once per account. RECOVERY.md:293-294 ('publishes the key again from their password envelope') and :329-332 ('come back') are also inaccurate: the restored envelope has no seed and a new key is made. Low.

## R3-20. [low] After 'Later', locked DMs tell the user to use 'the bar above the message box', which stays hidden for the whole tab session; there's no other way to unlock short of a send that fails

**Where:** hearth/public/js/app.js:11258-11260 (pqNotice returns null after Later unless always), :8158/:8160/:8170 (DMs, and channels whose current key is held, call pqNotice() without always; only the no-current-key channel case uses always, :8173), :4945 (the locked message text points at the bar), :8104 (only a need_password send clears Later), :11252-11256 (sessionStorage survives reloads). No other unlock entry exists (only callers are the bar and settings.js:555).

**Scenario:**
On a seedless device the user taps 'Later'. Opening a DM with d3 messages shows each as 'Locked to your account's post-quantum key: enter your password once on this device (the bar above the message box) to read it.', with no bar. The same happens for older channel messages when the current key is readable.
Reloading doesn't help (sessionStorage), and on Android the WebView session can last days. The only ways to get the bar back are trying to send something into a post-quantum DM (which fails with a toast) or closing the tab. Contradicts row 168 ('comes back when something needs it').

**Suggested fix:** Show the bar with always: true whenever the open conversation has pq-pending messages. Or add an 'Enter password' action to the locked message and to Settings → Security.

**Verifier:** Confirmed in code:
- pqNotice returns null after 'Later' unless called with always (app.js:11258-11260).
- DMs (app.js:8158/8160) and channels whose current key is held (8170) call it without always. Only channels waiting for the seed use always (8173).
- The locked d3 text (app.js:4945) points to 'the bar above the message box'.
- 'Later' is kept in sessionStorage (11252-11256), so it survives reloads. Only a send that fails with need_password clears it (8104).
- There is no other unlock entry point: unlockPq's only callers are the bar and the password change in settings.js:555.

So after 'Later', a seedless device's locked DMs point at a hidden bar until a send fails or the tab is closed. That contradicts row 168 ('comes back when something needs it') for reading. Low.

## R3-21. [low] Settings → Security account check tells seedless devices they're 'still waiting for it from another of your devices', a handoff that no longer exists

**Where:** hearth/public/js/selftest.js:129 (also the stale comment at secure.js:76-77)

**Scenario:**
On any device signed in before the account got its key, running the encryption checks reports '1 of N checks need attention' with 'This device has your post-quantum key: still waiting for it from another of your devices'. No device will ever hand it over (the handoff was removed). The fix is the password bar, which the check doesn't mention.

**Suggested fix:** Say 'enter your password once on this device (the bar above the message box)'. Optionally, offer the unlock from there.

**Verifier:** Confirmed. selftest.js:129 reports 'still waiting for it from another of your devices' whenever the device lacks the seed. Settings → Security (settings.js:950) shows it as a check that needs attention.

The handoff no longer exists: secure.js:244-249 says the seed is never handed from one device to another. So nothing will ever arrive; the only fix is the password, which the message doesn't mention. The comment at secure.js:76-77 is stale too. Settings' server-key line has a similar wrong cause for keys locked to the seed (settings.js:948, 'waiting for another member to share it'). Low: a wrong fix in a diagnostic.
