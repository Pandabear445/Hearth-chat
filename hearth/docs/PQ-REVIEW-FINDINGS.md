# Independent review of the post-quantum change (all confirmed by a second agent)

## 1. [critical] (Pre-existing, on a line this diff rewrote) A key rotation wraps the member's own copy of the new server key to whatever identity key the server lists for them, so a malicious server gets the group key

**Where:** hearth/public/js/secure.js:632-643 (wrapFor: own copy uses `u = S.me`, `trust()` is always true for self, `pqKeyOf(S.me)` -> `myPqPublic()` returns null when ownKeysOk() fails, then `wrapGroupKey({ recipientPub: u.publicKey })`). Triggered via secure.js:600/610 (maintain -> rotate) and app.js:730-741 / 1308-1311 (`user:update` -> setUser merges into S.me). No ownKeysOk check, unlike keepForMyself at secure.js:568.

**Scenario:**
1. The server sends a socket `user:update` for the victim's own id with publicKey set to an ECDH key the server holds.
2. It sends `keys:state` with needsRotation: true (or waits for the victim's next send, since ready() also rotates).
3. maintain() -> rotate() -> wrapFor(). The own copy goes out as w1 to the server's key: pqKeyOf(S.me) -> myPqPublic() -> ownKeysOk() is false, so it returns null and the code falls back.
4. POST /servers/:id/keys/rotate carries that wrap. The server unwraps it, and the keyCheck matches the posted check.
5. If the server accepts the rotation, every member adopts the new epoch (it comes from a member and is signed with their 'now' key). The server reads everything sent in it.
Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/pq-malicious.test.js test P: the captured wraps[owner] is w1 and opens with the server's private key. The base branch has the same `recipientPub: u.publicKey` line. The new code reaches the 'own keys don't check' state through myPqPublic() and still falls back silently.

**Suggested fix:** In wrapFor, for uid === S.me.id: `if (!(await ownKeysOk())) throw ownKeysMismatch();`, wrap to `proven.e`, and require a non-null myPqPublic() whenever the account lists or this device holds a PQ key. Never emit a w1 copy for yourself.

**Verifier:** Confirmed, and it is pre-existing: the base wrapFor has the same `recipientPub: u.publicKey` for `u = S.me`. A socket user:update for yourself goes through app.js:1308-1311 setUser, then mergeUser, with no own-key check. trust() returns true for yourself (secure.js:133). In wrapFor (secure.js:632-643), pqKeyOf(S.me) calls myPqPublic(), which gets ownKeysOk()=false and returns null, so the code silently falls back to a w1 wrap to the listed key. Nothing on the rotate path calls ownKeysOk; keepForMyself does (secure.js:568). I checked this with my own scratch test using the app's real mergeUser (refute-pq-verdicts/verdicts.test.js F1). The own copy is w1 and opens with the server's private key; its keyCheck matches. The member's copy is w2, signed with the owner's real signing key, and holds the same raw key, so members adopt the epoch. This breaks SECURITY.md row 67 ('never wrap keys to a wrong key for yourself'); the row-67 test only covers keepForMyself. Caveat: §4 already concedes that a server can add a hidden member to get a server key. This path leaves no trace in the member list, but it is not a new class of capability, so 'critical' is overstated.

## 2. [high] The ph1 seed handoff gives the ML-KEM seed to anyone holding the P-256 keys, so a future quantum-capable server can decrypt all recorded dk1/w2 (contradicts SECURITY.md:328-330)

**Where:** hearth/public/js/secure.js:388-401 (serveHandoffs runs automatically at every start, line 333, and on each `pq:handoff` event; it seals S.pqSeed for any request that verifies under proven.s). hearth/public/js/e2ee.js:343-359: the request is authenticated only by ECDSA P-256, and the sealed answer only by ECDH(me,me). Claim being contradicted: hearth/SECURITY.md:328-330 ('could forge them, though not decrypt anything recorded'); docs/ENCRYPTION-RESEARCH.md §5 says the seed is deliberately never locked with anything derivable from the P-256 key.

**Scenario:**
1. When a quantum computer exists, the server recovers Alice's ECDSA and ECDH private keys from her published public keys (Shor).
2. It signs `hearth-pq-handoff|<alice>|<id>|<its own ML-KEM pk>`, inserts the request and emits pq:handoff.
3. Any of Alice's devices that is online or starting checks the signature and seals her seed to the attacker's ML-KEM key. No user interaction is needed.
4. The attacker decapsulates the answer (both ECDH terms are computable from the recovered keys) and gets the seed.
5. With the seed and the recovered identity key, it opens every recorded dk1 epoch and every w2 copy for Alice, i.e. her whole harvested history. This is the exact harvest-now-decrypt-later outcome the feature claims to stop.
Reproduced in test A using only Alice's classical private keys (no seed): the online device answered, openPqHandoff returned her exact seed, and a recorded dk1/d3 decrypted.

**Suggested fix:** Don't serve handoffs automatically. Options: require approval on the serving device with a short authentication string, bound to id and devicePk, shown on both devices; or require the password on the waiting device, as the envelope does. At minimum, correct SECURITY.md and ENCRYPTION-RESEARCH.md: a classical forgery here yields retroactive decryption, not only future forgeries.

**Verifier:** Confirmed. verifyPqHandoffRequest (e2ee.js:350) authenticates the request only with ECDSA P-256 under proven.s. sealPqHandoff (e2ee.js:352-361) seals to a devicePk the requester chooses, plus ECDH(eph, myPub) and ECDH(myPriv, myPub). Anyone holding the identity private key can compute both ECDH terms. serveHandoffs (secure.js:388-397) answers with no user action, on every start (secure.js:309, not 333 as stated) and on each pq:handoff event. My scratch test F2: a forged request inserted while the device was offline was answered as soon as the device started. openPqHandoff, using only the classical keys and the attacker's device seed, returned the exact seed. The reviewer's test A opens a recorded dk1/d3 with it. So an active server with a quantum computer recovers the seed from any live device. That contradicts SECURITY.md:329 ('could forge them, though not decrypt anything recorded') and ENCRYPTION-RESEARCH.md:198-199, which says the seed must never depend on the P-256 key. It is a real design defect within the stated quantum-adversary threat model.

## 3. [high] Own-side downgrade: DMs (and own server-key copies) silently fall back to P-256 whenever myPqPublic() returns null, which the server can force

**Where:** hearth/public/js/secure.js:262-267: myPqPublic() returns null if ownKeysOk() fails, or if the device has no seed and S.me.pqPublicKey is absent. That null leads to:
- secure.js:836-837: encryptDm writes d2.
- secure.js:642-643: the own copy in a rotation is w1.
- secure.js:569: keepForMyself writes w1.
Trigger: app.js:730-741 / 1311 (self `user:update` merged into S.me). Only the peer side has a pin (secure.js:434-435).

**Scenario:**
B1, any device:
1. The server pushes a self `user:update` listing another signPublicKey (or publicKey).
2. ownKeysOk() becomes false, so myPqPublic() returns null.
3. The next DM to a contact whose PQ key is pinned is written `d2:`, with no error or warning. Stripping the peer's key in the same situation throws 'untrusted'.

B2, a device still waiting for its seed (the server can withhold the handoff forever):
1. The server leaves pqPublicKey out of bootstrap or the self update.
2. That device writes d2 DMs and w1 copies for itself, which a quantum-recording server can read later.

Reproduced in tests B1 and B2.

**Suggested fix:** When peerPq is set, never fall back to d2: throw ownKeysMismatch when own keys don't check out. Remember locally (next to the pins / pqreq) that the account has a signed PQ key, and refuse P-256-only output for yourself if the listing disappears. Apply the same rule to own copies in wrapFor and keepForMyself.

**Verifier:** Confirmed. B1: a self user:update with another signPublicKey makes ownKeysOk() false, so myPqPublic() returns null (secure.js:263). encryptDm (secure.js:836-837) then writes d2 with no error, although the peer's PQ key is pinned; stripping the peer's key instead throws 'untrusted'. My test F1(b) also shows the own copy in a rotation becomes w1 (P-256 only) to my real key. B2: on a device with no seed, leaving out S.me.pqPublicKey makes listedPqIsMine false, so myPqPublic() returns null and the device writes d2. Nothing in app.js reacts to a mismatch of your own keys mid-session. This breaks the stated rule (ENCRYPTION-RESEARCH §5) that fallback happens only while the other person has no PQ key, and myPqPublic's own comment. One correction: keepForMyself throws on ownKeysOk failure (secure.js:568), so its w1 fallback applies only to B2.

## 4. [high] Which DM epoch is current is unauthenticated: the server can keep a DM on an old epoch after the peer changes keys, and whoever holds the peer's old keys reads the new messages (a regression from d2)

**Where:** hearth/public/js/secure.js:889-902. dmSendKey takes `list[list.length-1]` and trusts its server-supplied createdAt and `keys` metadata (line 895). The next epoch number also comes from the served list (line 902); nothing remembers the highest epoch seen. hearth/public/js/e2ee.js:496: the dk1 ctx binds neither the creation time nor the keys of the other copy. createdAt and keys come from the server (server/index.js:4423-4431).

**Scenario:**
1. Alice makes epoch 1. Bob's copy is wrapped for Bob's old identity and PQ keys.
2. Bob's device is stolen. Bob resets without the recovery key (new identity, signing and PQ keys), and Alice verifies his new keys.
3. The server answers GET /dms/:id/keys with only epoch 1, createdAt = now, and keys[bob] = Bob's new publicKey and pq.
4. Alice's app opens her own copy (trust 'now') and keeps writing `d3:1:`.
5. The thief unwraps Bob's old epoch-1 copy and reads Alice's messages sent after the reset.
Under d2, after the reset Alice encrypted with ECDH(Alice, Bob_new), which the old keys can't open. The same mechanism lets the server keep any epoch past a week, so 'a week at most', 'post-compromise healing' and 'rotation on key changes' (ENCRYPTION-RESEARCH.md:244-249, SECURITY.md row 166) don't hold against a malicious server.
Reproduced in test C.

**Suggested fix:** Bind the epoch's creation time and both copies' recipient keys (identity key and PQ fingerprint) into the dk1 ctx/AAD, so each side can check them from its own copy. Keep a local high-water mark of epochs per DM. Refuse to write into an epoch lower than the highest seen, or past DM_EPOCH_MS by the authenticated time, or whose authenticated peer keys differ from the current trusted ones.

**Verifier:** Confirmed. dmSendKey (secure.js:889-899) decides from the server-supplied createdAt and keys metadata. dmKeyCtx (e2ee.js:496) binds only dm, epoch, recipient and sender, not the creation time or the keys the other copy was wrapped for. An epoch the user made opens with trust 'now' (secure.js:873), whatever its age. The server controls the list: it can emit dm:keys to force a refetch, or answer a POST for a new epoch with code 'epoch' to force a retry. The reviewer's test C passes: after B resets and A verifies, A writes d3:1, and B's old keys unwrap B's old copy and read it. Under d2, A would have used ECDH(A, B_new), so this is a real regression. It contradicts ENCRYPTION-RESEARCH.md:244-249 ('rotation on key changes', 'a week at most') against a malicious server. It needs the old keys, for example from a stolen device or an old envelope the server cracked offline.

## 5. [medium] In d3, a retired (pinned) key of the peer vouches for messages dated now: the trust date is the epoch's server-supplied createdAt, not the message date

**Where:** hearth/public/js/secure.js:874: a peer-made epoch's trust is evaluated at `e.createdAt` via dmKeys -> keysOf -> pinnedKeys(at). secure.js:925-934 and 955: openDm3 never uses the message's own createdAt. app.js:4726: the 'pinned' note is not shown as a warning.

**Scenario:**
1. After Bob resets, a thief who holds Bob's old identity key, together with the server, inserts epoch N 'from Bob'. Alice's copy is wrapped with Bob's old key and dated just before the reset, so Bob's old key still counts as 'pinned' for that date.
2. They add a d3 message in that epoch, authored by Bob and dated now.
3. Alice's app shows a current message from Bob with only the mild 'Written with an older key' note.
The same old key cannot vouch for a d2 message dated now, because keysOf filters by at <= until.
Reproduced in test E: keyNote 'pinned', createdAt now; the d2 control does not open.

**Suggested fix:** Also check the vouching key against each message's own date. Reject 'pinned' or 'listed' epochs for messages dated after that key's `until`, or bind an authenticated validity window into the epoch and reject messages dated outside it.

**Verifier:** Confirmed. For an epoch the peer made, openDmEpoch evaluates trust at e.createdAt (secure.js:874), and openDm3 (secure.js:925-934) never looks at the message's own date. So an old key that counts as 'pinned' for that epoch date vouches for messages of any date. That breaks the rule in pinnedKeys (e2ee.js:951-953): 'an old key that leaked can't vouch for anything undated or newer'. Test E passes: keyNote 'pinned' on a message dated now. My control test: with d2, the same retired key opens a forged message only when the message itself is backdated, and one dated now is refused. So d3 newly lets a holder of the retired key, with the server's help, show a forged message from Bob as current. It carries only the mild 'Written with an older key' note (app.js:4726, no warning), and trustedBinding also accepts 'pinned'. Lower severity: it needs the old private key.

## 6. [medium] Pressing 'Numbers match' for an unchanged contact erases their PQ pin, which turns the server's PQ-strip downgrade back into a silent fallback

**Where:** hearth/public/js/e2ee.js:937-947: acceptPin rebuilds the pin as `{ ...cur, verified: true, old }` and drops `q` even when e and s are unchanged. secure.js:142 (acceptKeys). app.js:9221: the Verify dialog calls it whether or not the keys changed.

**Scenario:**
1. The server stops listing Bob's `pq`.
2. Alice's send is refused ('untrusted', 'Reload the page…'), as intended.
3. Alice opens Verify encryption. The numbers match because Bob's keys didn't change, so she presses 'Numbers match'.
4. The pin is rebuilt without q, and the next send is `d2:` with no warning. Routine verification of contacts has the same effect.
Reproduced in test D.

**Suggested fix:** In acceptPin, keep `q` when the accepted identity key equals the pinned `e`. Only reset it when the identity key actually changes.

**Verifier:** Confirmed. acceptPin (e2ee.js:937-947) rebuilds the pin as { e, s, verified, old } and always drops q. The previous e/s pair is not even kept in old when unchanged. The Verify dialog's plain 'Numbers match' button calls sec.acceptKeys whether or not the keys changed (app.js:9221). My test F6: if pq is still listed, the next send pins q again (d3). If the record without pq is in place when the user presses the button, every later send is silent d2. The server can time that, because opening the profile fetches GET /users/:id/page just before the dialog. pinPq's comment says the reset is meant for accepting new keys, so this side effect for unchanged keys is a bug.

## 7. [high] DM epoch reuse is decided from unauthenticated server metadata, so a malicious server can pin a DM to an old or compromised epoch key indefinitely (no weekly rotation, no rotation after a key reset)

**Where:** hearth/public/js/secure.js:892-899 (dmSendKey takes cur = list[list.length-1] and reuses it when the server's cur.createdAt and cur.keys look current, keeping no local high-water mark); hearth/public/js/e2ee.js:496 (dmKeyCtx binds dmId, epoch, recipient and sender, but not the creation time or the key set each copy was wrapped for); hearth/server/index.js:4427-4430 (createdAt and keys are plain DB columns). Contradicts hearth/docs/ENCRYPTION-RESEARCH.md:244-249 and SECURITY.md row 166.

**Scenario:**
1. Alice starts epoch 1 and wraps K1 for herself and Bob.
2. Bob's device is compromised. The attacker opens Bob's dk1 copy with Bob's identity key and PQ seed and gets K1.
3. Bob resets to new identity, signing and PQ keys, and Alice accepts them (acceptKeys).
4. An honest server would now force epoch 2, because sameKeys(cur.keys[bob], newPub, newFp) fails. A malicious server instead rewrites epoch 1's metadata: public_key and pq_public_key become Bob's new keys and created_at becomes now. (Or it answers the new-epoch POST with 409 'epoch' and serves that list again.)
5. Alice's app opens her own copy with trust 'now' and keeps sending d3:1 under K1, which the attacker reads.
The same trick (resetting createdAt, reordering or hiding newer epochs) keeps any epoch alive forever. That defeats 'rotated weekly', 'a leaked epoch key exposes one epoch (a week at most)' and 'post-compromise healing'. It is also a regression from d2, which after Bob's reset used ECDH(Alice, Bob_new). Bob only sees decrypt failures after the messages have already leaked.
Reproduced by PoC A in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/poc/pq-poc.test.js (run with node --test --test-force-exit): Alice reuses d3:1 after Bob's reset and again 30 days later, and K1 from Bob's old keys decrypts both.

**Suggested fix:** Authenticate the epoch's metadata inside each dk1 wrap. Put the creator's timestamp and both recipients' identity keys and PQ fingerprints into the ctx/AAD. Decide reuse only from those authenticated values and the local clock, never from cur.createdAt or cur.keys. Keep a per-DM high-water mark next to the pins (the highest epoch seen or created) and never write below it. After acceptKeys for the peer, require an epoch whose authenticated key set names the new keys.

**Verifier:** Confirmed. dmSendKey (secure.js:893-899) reuses list[list.length-1] whenever the server-supplied createdAt and keys look current. Alice's own dk1 copy opens with trust 'now' no matter which Bob keys the other copy was wrapped for: dmKeyCtx (e2ee.js:496) and the transcript bind no key set and no time. There is no local high-water mark, and acceptKeys (secure.js:142, app.js ~9221) clears dmRaw but never forces a new epoch. Independent test: Bob reset through the real email flow (/auth/forgot then /auth/reset with a new identity, sign key and PQ key) and Alice accepted his new keys. With an honest server Alice rotated to d3:2. With the server only rewriting its GET /dms/:id/keys answer (no DB edits) and answering one POST with 409 'epoch', Alice wrote d3:1, and K1 taken from Bob's old keys decrypted it. It did so again after the DB epoch was 30 days old. Bob's new device only shows an error afterwards. Other routes for the old-key holder fail: the pin blocks Bob's old keys; an epoch 'from Bob' made with old keys gets 'pinned' trust and is never written in; acceptPin drops the PQ pin, so hiding Bob's PQ key only yields d2 to his new key. So this is a real loss of post-reset healing and of the 'a week at most' claim (ENCRYPTION-RESEARCH.md:244-249, SECURITY.md:322). It needs a leaked epoch key (for example Bob's compromised old device) plus server control.

## 8. [high] The ph1 seed handoff gives the account's long-term ML-KEM seed to any request authenticated only by classical crypto, so a future quantum attacker with API access gets the seed and decrypts every recorded dk1/w2

**Where:** hearth/public/js/secure.js:388-395 (serveHandoffs seals the seed for every request that verifies under proven.s); hearth/public/js/secure.js:399-402 (runs automatically on the server-sent pq:handoff event, with no user approval); hearth/public/js/e2ee.js:350-351 (verifyPqHandoffRequest is ECDSA P-256 only); hearth/public/js/e2ee.js:352-361 (besides ECDH(eph,me) and ECDH(me,me), the only input is the requester-chosen KEM key); hearth/server/index.js:2633 (needs only a session plus that signature). Contradicts hearth/SECURITY.md:329 ('could forge them, though not decrypt anything recorded') and row 167.

**Scenario:**
1. The adversary records the database or traffic today.
2. Once it has a quantum computer, Shor on Alice's published signPublicKey and publicKey gives her ECDSA and ECDH private keys.
3. Using the server (or any stolen session of Alice's), it makes its own ML-KEM key, signs hearth-pq-handoff|<alice>|<id>|<devicePk> with the recovered ECDSA key, and POSTs it (or inserts it and emits pq:handoff).
4. Any online device of Alice's checks the signature against proven.s and seals her seed to the attacker's key. Both ECDH terms can be computed from her recovered identity key.
5. openPqHandoff gives the attacker the seed. Seed plus identity key open every recorded dk1 and w2 copy, so all DM and server-key history since the upgrade is exposed.
The hybrid otherwise holds against this adversary; this path makes it collapse to P-256 retroactively.
Reproduced by PoC B in the same file. The attacker holds only Alice's classical private keys and a session, recovers her seed, and decrypts a d3 message recorded earlier.

**Suggested fix:** Don't release the seed on classical authentication alone. Either:
- require the user to approve on the answering device after comparing a short code derived from H(id‖devicePk) shown on both devices, or
- have the waiting device ask for the password, since the envelope already holds the seed.
Also:
- only serve handoffs during the migration window or for sessions created before the account's PQ key;
- notify the user of every handoff;
- fix SECURITY.md §4 and row 167.

**Verifier:** Confirmed. serveHandoffs (secure.js:388-395) seals S.pqSeed for every pending request that passes verifyPqHandoffRequest (e2ee.js:350-351, ECDSA P-256 only). It runs automatically at every start-up (ensurePqKey -> serveHandoffs, secure.js:308) and on the server's pq:handoff event (app.js:777, emitted by server/index.js:2645), with no user prompt. In sealPqHandoff the only non-classical input is the requester's own ML-KEM key. Independent test: an attacker holding only Alice's ECDSA and ECDH private keys (standing in for Shor) and her session posted a forged request. Alice merely starting a seed-holding device sealed the seed. openPqHandoff returned it, and it plus her identity key opened a previously recorded dk1 copy and its d3 message. This directly contradicts SECURITY.md:329 ('could forge them, though not decrypt anything recorded') and row 167. A malicious server could also get the seed by serving modified JS, which §4 already accepts. The stolen-session path and the stated claim make this a real protocol defect. It needs a quantum computer at attack time and an online device holding the seed.

## 9. [medium] encryptDm silently falls back to P-256-only d2 whenever myPqPublic() returns null, which the server can force; the other person's app accepts d2 in a d3 conversation without a warning

**Where:** hearth/public/js/secure.js:837 (`if (!peerPq || !minePq)` falls back to d2); hearth/public/js/secure.js:263 (myPqPublic returns null when ownKeysOk() fails); hearth/public/js/secure.js:266-267 (also returns null on a seedless device when the own key is omitted); hearth/public/js/secure.js:954-961 (openDm accepts d2/v1 even after the DM has d3 epochs and the peer's PQ key is pinned). There is no own-account equivalent of pinnedPq (hearth/public/js/e2ee.js:924-927).

**Scenario:**
(a) A device that holds the seed. The server pushes user:update for the user's own id with a different signPublicKey (or publicKey). setUser merges it into S.me, ownKeysOk() turns false, myPqPublic() returns null, and every DM this device sends is d2 (ECDH P-256 only), with no error. This happens even though both people have PQ keys and the DM is already on d3.
(b) A device still waiting for its handoff. The server leaves S.me.pqPublicKey out of bootstrap or user:update. myPqPublic() returns null and the device writes d2 indefinitely. It never asks for the handoff either, because pub is null.
In both cases Bob's app opens the d2 like any other message, with no keyNote and no error. The server records them and reads them later with a quantum computer. This bypasses the downgrade protection in SECURITY.md row 165 and the doc's 'Fallback … only while the other person has no PQ key'.
Reproduced by PoC C and PoC D in the same file.

**Suggested fix:** Fall back to d2 only when the peer has no checked PQ key and the DM has no epochs yet. If myPqPublic() is null because ownKeysOk() failed, throw ownKeysMismatch. Pin on each device that the own account has a PQ key (like pinPq) and refuse to send rather than downgrade if it disappears. On receive, flag or refuse d2/v1 messages from a peer with a pinned PQ key once the DM has an epoch.

**Verifier:** Confirmed. encryptDm (secure.js:837) writes d2 whenever minePq is null. myPqPublic returns null whenever ownKeysOk() fails (secure.js:263). app.js setUser (1308-1312) merges any user:update for your own id into S.me, and the handler (app.js:730-744) does no own-key check, so nothing throws or warns. Independent test: I applied a user:update carrying another signPublicKey through the exact mergeUser path setUser uses. In a DM that already had d3 epochs, with both PQ keys published and pinned, the next send was d2, and plain ECDH(Alice, Bob) opened it. Bob's openDm returned it with no error, keyNote or legacyFormat (no format check on receive, secure.js:954-961). Putting the real key back flipped sending back to d3, so the server can downgrade chosen messages silently and briefly for later quantum decryption. The server's POST /dms/:id/messages only checks the ciphertext format (validCipher). Variant (b) also holds by code reading and PoC D: on a device without the seed, the listed own PQ key being omitted gives null, d2 is written, and ensurePqKey never asks for the handoff. Contradicts SECURITY.md row 165 ('no quiet fallback'), ENCRYPTION-RESEARCH.md:205 and the myPqPublic comment.

## 10. [high] A device still waiting for the PQ seed rewraps its readable server-key copies to a PQ key it doesn't hold, then can't read or write in any channel, old history included

**Where:** hearth/public/js/secure.js:262-268 (myPqPublic returns the server-listed key when this device has no seed); secure.js:488 + 540 and 569 (applyState / keepForMyself rewrap self w1 copies with that key); hearth/server/index.js:3575 (POST /servers/:id/keys/self overwrites the stored copy in place); secure.js:543 (no_pq is never reported); misleading text at secure.js:718 and app.js:4846; secure.js:338 (only a handoff is ever tried)

**Scenario:**
Pre-1.40 account. Laptop L has been signed in for months, so it has no seed. The user signs in once with the password on another machine F (this is the one-time upgrade), then signs out there; clearKeys wipes F's seed. L gets user:update and asks for a handoff that nobody answers. On L's next start, applyState computes pqMine = myPqPublic(), which is the listed key because L has no seed. It then takes every w1 self copy, including years of pre-PQ history, and keepForMyself rewraps each as w2 to that listed key. keys/self UPDATEs the server row in place. F's own at-rest pass does the same if it loads servers. From then on L can't open any server or group key: every channel message, pre-PQ ones included, shows 'Waiting for the encryption key from another member…'. Sending fails with 'You don't have this server's encryption key yet. It arrives as soon as another member comes online.' No member can help: the server thinks L has a copy, and no_pq is never reported. Because no device holds the seed, this never ends. The app has no password unlock (ensurePqKey only gets a context at sign-in); only signing out and back in fixes it, and nothing suggests that. This contradicts SECURITY.md row 168 ('only shows waiting for post-quantum messages … it can still write'). Reproduced: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/r1.test.js (copy w1→w2, laptop reads {pending:true}, write refused). Also r1b.test.js: F only publishes and never loads keys, and the seedless laptop's own first start turns its w1 copy into w2; on its next start the pre-PQ message is pending and encryptChannel is refused. Run with NODE_PATH=<worktree>/hearth/node_modules node --test <file>.

**Suggested fix:** Never lock anything 'for yourself' to a PQ key this device doesn't hold. In applyState, keepForMyself and wrapFor's self copy, use myPq()?.publicKey, and only when it equals the listed key; otherwise keep or write w1. Don't overwrite a w1 self copy in place while the account has open handoff requests, or keep the w1 copy in its own column until every session has the seed. Give a waiting device a password unlock (POST /me/keys/wrapped → unwrapIdentity → adoptPq) once a handoff has gone unanswered. Use a no_pq-specific message for channels.

**Verifier:** Confirmed with my own harness, /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f1.test.js. It runs the real e2ee.js, secure.js and api.js against a real server, gives each device its own IndexedDB, and uses real /auth/login and sign-out with clearKeys. The account's server_keys rows are shared by all its devices, and keys/self (index.js:3575) overwrites them in place.

F1a: the password sign-in on F publishes the key, and F's at-rest pass (secure.js:540/569) turns the pre-PQ copy from w1 into w2. After F signs out, the seedless laptop reads the pre-PQ message as {pending:true,before:false}, which the UI shows as 'Waiting for the encryption key from another member…'. encryptChannel fails with code no-key ('…arrives as soon as another member comes online'). The server lists the laptop as not missing, so nobody re-shares, and nothing changes across restarts: the handoff request stays open and is never sealed.

F1b: F publishes but never runs its at-rest pass. The laptop's own applyState then rewraps its readable w1 copy to w2 under the listed key, because myPqPublic returns the listed key when the device has no seed (secure.js:266-267). From its next start on, the laptop is locked out.

Only signing out and back in with the password fixes it, since the envelope holds the seed. Even in the control case, where F comes back later and serves the laptop, the laptop cannot write in any channel until the handoff arrives. That contradicts SECURITY.md row 168 ('it can still write') and the comment at secure.js:244-245.

## 11. [high] A reset with a recovery key made before the upgrade permanently loses all server/group channel history, including history from before the upgrade, while the toast says only recent DMs are lost

**Where:** hearth/public/js/secure.js:540 (at-rest w1→w2 rewrap of every self copy, in place via server/index.js:3575); hearth/public/js/app.js:474-480 (toast, replace:true); hearth/public/js/secure.js:329-335 (replace makes a fresh seed); hearth/server/accounts.js:379 (reset email: 'all your old messages stay readable')

**Scenario:**
An existing account made its recovery key before 1.40, then signs in once with the password. Its app rewrites every server-key copy it holds, every epoch with years of history, from w1 to w2 under PK1, in place. Later the user forgets the password and resets with that recovery key. The recovery envelope has no seed, so app.js passes replace:true and ensurePqKey publishes a new key PK2. Every stored copy is locked to PK1, whose seed now exists nowhere, and the server only re-shares the current epoch. Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/r3b.test.js. A channel message written before the upgrade, in an epoch that has since rotated, decrypts to {pending:true, before:true} after the reset, which the UI shows as 'Sent before you joined'; the current epoch is re-shared and readable. Meanwhile the toast says 'Your messages are still here, apart from direct messages sent since your account's last security upgrade'. Before 1.40 the same reset kept everything. This affects every pre-1.40 recovery key after one password sign-in, unless the user happens to see the recoveryStale hint in Settings → Security.

**Suggested fix:** Don't rewrap w1 self copies to w2 while the account's recovery key lacks the seed (S.me.hasRecovery && S.me.recoveryStale), or keep the w1 copy alongside until a new recovery key exists. Prompt for a new recovery key during the upgrade sign-in. Make the toast and the reset email describe the real scope of the loss.

**Verifier:** Confirmed in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f2.test.js. After one password sign-in, the account's stored copies for epochs 1 and 2 are both w2, rewritten in place by the at-rest pass. A reset with the pre-1.40 recovery key then takes the replace path and publishes a new key. The epoch-1 message, written before the upgrade, now shows 'Sent before you joined…'. Only the current epoch is re-shared (keys/bad, then share); older epochs can never be re-shared because keys/share only takes the current epoch.

The control run, the same reset without the upgrade, reads both epochs. So this is a regression caused by the migration.

Meanwhile the toast (app.js:474) says only DMs sent since the upgrade are gone, and the reset email (accounts.js:379) says 'with it, all your old messages stay readable'. SECURITY.md §4 mentions copies 'locked only to the old one', but never says the at-rest pass puts all history in that category. Row 168 claims 'the app says so', and it doesn't.

## 12. [high] If the first start after a recovery-key reset is interrupted, the old PQ key stays published with no holder, and everything sent to the user meanwhile is lost

**Where:** hearth/server/accounts.js:429 (a keepKeys reset leaves pq_public_key/pq_sig in place); hearth/public/js/app.js:480 and 1231-1233 (the password context is used once and dropped); hearth/public/js/secure.js:323-338 (a start without that context only calls askForPq); hearth/server/index.js:2642-2644 (requests older than 7 days are re-inserted with a fresh created_at)

**Scenario:**
Account upgraded (PK1), with a recovery key made before the upgrade. The user resets with it on a phone. The reset succeeds and the toast shows, but the app is backgrounded or killed, or POST /me/pq-key fails once, before ensurePqKey's replace publish. pendingPq is gone, so the next start (ctx null) just calls askForPq(). Every other device was signed out and wipes IndexedDB, and the envelope has no seed. So PK1 stays published and validly signed while no device holds it. Peers keep wrapping d3 DM epochs and w2 server keys to PK1, and the user sees '(waiting)' indefinitely. The 3-day rule only fires on a password sign-in while this device's request is between 3 and 7 days old; after 7 days the server re-inserts it with a new created_at. When it does fire, everything sent in between becomes permanently '(error)'. Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/r5.test.js (loads idbshim.js so the request persists as in a browser). Output: the old key is still listed with no seed on the device; a peer's d3 DM reads as '(waiting)'; after the replacement it reads as '(error)'.

**Suggested fix:** Don't leave a holderless key published after a keepKeys reset. Either have the client tell /auth/reset that its envelope has no seed and clear pq_public_key/pq_sig there, or send the new PQ key, signature and envelope with /auth/reset in one transaction. Persist a 'needs a new PQ key' marker so the next start asks for the password instead of waiting for a handoff.

**Verifier:** Confirmed, and it lasts longer than the finding states: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f3.test.js. A keepKeys reset leaves pq_public_key in place; accounts.js clears it only when keys are not kept. The test drops POST /me/pq-key once. pendingPq is already used up by then (app.js:1231-1233), so the next start only calls askForPq. PK1 stays listed and no device holds its seed: the laptop gets a 401 and clears its keys, and the envelope copied from the recovery key has no seed. The peer's d3 DMs show '(waiting:pq)'.

Signing out and back in with the password does not replace the key, even with the server row aged 4 days. Sign-out's clearKeys deletes the stored request, so each sign-in posts a fresh request with a new createdAt, and the 3-day rule (secure.js:323-328) never fires in app.js. It fires only if the same device keeps its old request through a password sign-in, which app.js never allows. In that case the in-between DMs become '(error)'.

Either way, everything sent to the user after the reset is unreadable, and channels stay locked to PK1.

## 13. [medium] A password change on a device still waiting for the seed signs out every device that has it and throws away the seed it just unlocked

**Where:** hearth/public/js/settings.js:446-461 (the change rewraps locked.encPrivateKey without looking inside and never adopts the seed); hearth/server/index.js:2429 (other sessions revoked); hearth/public/js/app.js:529 (a signed-out app runs clearKeys, which wipes the seed); same effect from hearth/server/accounts.js:309 (turning on 2FA) and hearth/server/index.js:5144 (log out other devices)

**Scenario:**
Pre-1.40 account. The laptop did the upgrade and holds the seed; the phone was signed in before and is still waiting. On the phone, the user changes the password in Settings. Settings fetches the envelope, which contains the seed, rewraps it without opening it, and POST /me/password revokes every other session. The laptop's app signs out and clearKeys() wipes its seed. The phone never adopts the seed from the envelope it just decrypted, so no device holds it and the phone's handoff request can't be answered. Combined with the first finding, the phone can't read any channel or d3 DM until the user signs out and back in. Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/r4.test.js: the saved envelope holds the seed (true), the phone doesn't (false), and the laptop's handoff API now returns 401.

**Suggested fix:** After a successful change, if S.pqSeed is null, call unwrapIdentity(newK.wrapKey, enc) and run sec.ensurePqKey({authKey: newK.authKey, wrapKey: newK.wrapKey, encPrivateKey: enc, pqSeed}) to adopt the seed and serve handoffs. Do the same wherever the password is entered to turn on 2FA or sign out other devices, or warn before revoking the only device that holds the seed.

**Verifier:** Confirmed in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f4.test.js. The envelope the phone saves through settings.js:446-461 holds the seed, but the phone never adopts it. POST /me/password revokes the laptop (index.js:2429); the laptop gets a 401 and clears its keys. The phone stays waiting across restarts with its handoff request still open, and its DM hint ('Open Hearth on one where you're signed in') points at devices the change just signed out.

Caveat, so it is less severe than reported: the seed is not lost. As soon as the user signs in with the new password on any device, for example back on the laptop the change signed out, that device takes the seed from the envelope and answers the phone's open request; the test shows this. Until then, the phone cannot read d3 DMs or any channel (finding 1).

## 14. [medium] Seed held but key never published (first start after sign-up, or after a reset without a recovery key, was interrupted): every DM to a post-quantum contact fails

**Where:** hearth/public/js/app.js:493-495 (the seed is stored in IndexedDB before the publish) and 253 (init loads it); hearth/public/js/secure.js:320 ('!pub && seed && !ctx' → adoptPq), 266 (myPqPublic returns the unpublished key), 837 (encryptDm picks d3), 906-918 (stale_keys turned into 'keys just changed'); hearth/server/index.js:4447 (epoch refused when the sender has no published key)

**Scenario:**
finishLogin stores the new account's seed before loadBootstrap's ensurePqKey publishes it. If the tab reloads or closes, or loadBootstrap or the publish fails, pendingPq is lost. The next start has ctx null and runs adoptPq(seed), so myPqPublic() returns a key the server doesn't list. encryptDm then chooses d3 for any peer with a PQ key. POST /dms/:id/keys returns 409 stale_keys because the sender has no pq_public_key, and dmSendKey throws '<peer>'s keys just changed. Try sending again.' on every attempt, for every PQ contact, until the user signs out and back in with the password. Reproduced in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/repro/r2.test.js: the server lists no key, and two sends both fail with stale_keys.

**Suggested fix:** In encryptDm, use d3 only when the server lists the account's key and it equals the held one (S.me.pqPublicKey === myPq().publicKey). Otherwise fall back to d2, as for an account without a key, or treat a stale_keys about yourself as d2. Self-locking can keep using the held seed.

**Verifier:** Confirmed in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f5.test.js. finishLogin stores the seed in IndexedDB, and dropping the first start's POST /me/pq-key once leaves the server listing no key. The next start runs adoptPq(seed) (secure.js:320), and myPqPublic returns the unpublished key (secure.js:266). encryptDm therefore picks d3, and POST /dms/:id/keys returns 409 stale_keys because the sender has no pq_public_key (index.js:4447). The user sees "<peer>'s keys just changed. Try sending again." on every attempt and after restarts.

Incoming d2 messages still work. Nothing re-publishes the key without the password. Only signing out and back in publishes it, after which d3 works.

## 15. [low] The recovery-reset toast tells accounts that never had a PQ key that their recent DMs are lost

**Where:** hearth/public/js/app.js:474; hearth/server/accounts.js:399 (/auth/reset/info doesn't say whether the account has a PQ key)

**Scenario:**
Take a pre-1.40 account that hasn't signed in with its password since the update, so it has no PQ key, no d3 DMs and no w2 copies. It resets with its recovery key. The recovery envelope has no seed, so the app shows 'Your messages are still here, apart from direct messages sent since your account's last security upgrade (your recovery key is older than that). Make a new recovery key in Settings.' Nothing was lost, so this is a false, new prompt for users who never touched the feature. The same text also appears when this browser still holds the seed and ensurePqKey puts it back into the envelope.

**Suggested fix:** Return hasPq (and recovery_pq) from /auth/reset/info. Show the loss wording only when the account had a PQ key that the recovery key doesn't hold, and update it once ensurePqKey knows whether it restored the seed.

**Verifier:** Confirmed by the control run in /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/vmux/f2.test.js. The test resets an account that never signed in with its password after the update, using its recovery key. The toast condition (keepKeys && !pqSeed, app.js:474) is true, so the user sees '…apart from direct messages sent since your account's last security upgrade (your recovery key is older than that)…'. Yet both channel epochs read fine afterwards, and the account had no PQ key, so it had no d3 DMs and no w2 copies.

/auth/reset/info gives the app no way to tell these cases apart. These users are the most likely to reset: they forgot their password before ever signing in after the update. The 'make a new recovery key' advice is correct after the reset, since a new key gets published, but the loss claim is false. Low severity, but a concrete false message.
