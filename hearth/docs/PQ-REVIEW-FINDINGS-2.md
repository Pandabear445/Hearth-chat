# Second independent review of the post-quantum change (round 2, against b1cd01a; each confirmed by a second agent)

Scratchpad paths are the reviewer's; rebuild the scenarios as tests.

## R2-1. [high] Finding 5 (and the read side of 7) is not fixed for DM epochs you made yourself: someone holding the peer's retired keys can forge d3 messages that show as current, with no warning, even after you accept the peer's new keys and reload

**Where:** hearth/public/js/secure.js:897 and :902: openDmEpoch gives any epoch with wrapperId === you trust 'now', whatever keys its other copy was made for. hearth/public/js/secure.js:974-979: openDm3 checks the message's own date only when trust !== 'now'. The epoch's authenticated key-set tag (got.tag) is checked only on the send path (:936), never when reading. This contradicts SECURITY.md:225 (row 166) and docs/ENCRYPTION-RESEARCH.md:234.

**Scenario:**
1. Alice and Bob both have published PQ keys. Alice writes first, so epoch 1 is Alice's: one dk1 copy for her and one for Bob's keys at that time.
2. Bob's device is stolen. The thief has Bob's old identity key and PQ seed.
3. Bob resets without his recovery key. Alice compares numbers and accepts his new keys (acceptKeys), then reloads.
4. Alice's next send correctly starts epoch 2. That part of the fix works.
5. The thief opens Bob's old copy of epoch 1 (senderPub = Alice's key) and gets K1. With the server, they insert d3:1 messages authored by Bob, and also ones authored by Alice, dated now.
6. Alice's app: openDmEpoch(epoch 1) sees wrapperId = Alice, so trust is 'now'. openDm3 skips the date check, and the messages show as current messages from Bob, or from Alice herself, with no keyNote or flag.
7. Control in the same run: a d2 dated now with the same retired Bob key is refused ({error:true}). So d3 is weaker than d2 here, which is the regression finding 5 was about.
Reproduction: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/rr16/t3-own-epoch-forgery.test.js passes.
- Forged d3 as Bob: {"t":"forged: bob, now"}, no keyNote.
- Forged d3 as Alice: opens.
- d2 control: {"error":true}.
Run with NODE_PATH=<worktree>/hearth/node_modules node --test --test-force-exit <file>.

**Suggested fix:** On the read path, judge an epoch by the keys its copies were made for, not only by who made it.
- Compute the tag for the keys trusted now: proven.e plus your published PQ key, and the peer's pinned e plus their checked PQ key.
- When got.tag differs from that tag, treat the epoch like a 'pinned' one:
  - Accept only messages dated at or before the `until` of the pinned peer key it was made for (the newest pin.old entry), with keyNote 'pinned'.
  - Return an error for anything later, as dmKeys(dmId, at) already does for d2.
- Also, or alternatively, refuse d3 messages dated well past their epoch's authenticated lifetime (madeAt + DM_EPOCH_MS + slack).

**Verifier:** Confirmed. I re-ran rr16/t3-own-epoch-forgery.test.js and it passes.
- A d3 from Bob, dated now, opens as {t:'forged: bob, now'} with no keyNote.
- A d3 authored by Alice also opens.
- The d2 control, same retired key and same date, gives {error:true}.

Code path:
- secure.js:897 and :902: an epoch with wrapperId === me always gets trust 'now'. The authenticated got.tag is compared only in dmSendKey (:936), never on the read path.
- openDm3 (:974-979) checks the message date only when trust !== 'now'.
- app.js:4806-4813 shows notes only for keyNote listed/new/pinned, noPq and legacyFormat, so a 'now' result gets no note.

Why the server can't get the same result with d2: after acceptKeys, Bob's old key is in pin.old with a local `until` of at most the acceptance time (e2ee.js:939-946). keysOf (secure.js:176) drops that key for later dates, so a forged d2 must be backdated into history, where it carries the 'pinned' note.

Why the forgery is necessarily illegitimate:
- Bob's new device can't open his old copy of epoch 1, so no real Bob-authored d3:1 message can be dated after the reset.
- Alice's own app stops writing to epoch 1: writablePeer refuses while Bob's key is changed, and after acceptance the tag mismatch starts epoch 2.

Preconditions:
- Bob's old identity key plus his old ML-KEM seed, from a stolen device, or from an old password envelope the server cracked offline.
- The server, to insert the messages.
This is the same adversary under which the original finding 5 was confirmed.

It contradicts ENCRYPTION-RESEARCH.md §6 ('post-compromise healing', 'rotation on key changes'). It also defeats what row 166 / (d) intend: an epoch effectively vouched for only by a retired key opens messages dated after that key was retired.

## R2-2. [medium] Finding 5 is also bypassed within one session: the dmRaw cache keeps an epoch's trust at 'now' after the peer's keys change, so a retired key's messages dated after its retirement open with no note while d2 refuses them

**Where:** hearth/public/js/secure.js:886 and :909: openDmEpoch caches { raw, trust, key, madeAt, tag } per DM epoch. Only acceptKeys (:145), adoptPq (:311), dropSeed (:320) and reset (:1205) clear the cache. trust() and keyChanged() (:135-141) never invalidate it. openDm3 (:974-979) skips the date check for cached trust 'now'.

**Scenario:**
1. Bob makes epoch 1, and Alice's running app opens it (cached as 'now').
2. Bob's device is stolen and Bob resets with new keys.
3. The server sends Alice Bob's new record: keys changed, and pastKeys lists the old key with retiredAt. Alice has not compared numbers yet; the key-change warning is showing.
4. The thief (Bob's old identity key plus seed) opens Bob's copy of epoch 1. The server delivers a d3:1 message 'from Bob' dated after retiredAt.
5. In the same session Alice's app shows it with no keyNote, because the cached trust is still 'now'.
6. Controls:
   - A d2 dated now with the same old key is refused ({error:true}).
   - After a reload, the same d3 is also refused.
Reproduction: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/rr16/t2-cached-trust.test.js passes.
- Same session: d3 {"t":"forged d3, dated now"}, d2 {"error":true}.
- After reload: d3 {"error":true}.

**Suggested fix:** Cache only { raw, key, madeAt, tag } and work out trust each time it's used (keysOf at madeAt, then the per-message date rule). Alternatively, drop a DM's dmRaw and dmEpochs entries whenever trust() or checkPin reports that the peer's keys changed (for example on a user:update), not only on acceptKeys.

**Verifier:** Real, but the reviewer's exact scenario overstates it.

What holds: rr16/t2 passes, and the mechanism is real. dmRaw (secure.js:886/:909) caches trust. Only acceptKeys (:145), adoptPq, dropSeed and reset clear it. The user:update handler (app.js:785-822) never does, and nothing invalidates it across tabs: the `storage` listener at app.js:157 only clears lsCache.

Why the single-tab, before-acceptance scenario is weak: before acceptance, the old key's cutoff is the server-listed pastKeys.retiredAt (secure.js:171-172). The attacker is the server, since only it can insert the message, and it can simply leave retiredAt out. My test refute-rr16/f2-variants.test.js (A) shows that a FRESH session then opens both a forged d2 and a forged d3 dated now, each with keyNote 'pinned'. So in that window, the cache only removes the mild, non-warning 'Written with an older key' note. The 'd2 refuses them' contrast depends on the attacking server listing retiredAt honestly.

The concrete exploit that remains is two tabs of the same browser, which share the localStorage pins. Test (B):
1. Both tabs have opened Bob's epoch 1.
2. Bob resets.
3. Alice accepts his new keys in tab 1, so the cutoff becomes local and the server can no longer move it (pastKeys were stripped in the test as well).
4. Tab 2 still opens a forged d3:1 from Bob dated after the acceptance as {t:'forged d3 after acceptance'}, with no keyNote.
5. In tab 2 the d2 control gives {error:true}, and tab 1 refuses the d3.

The reviewer's fix covers this: recompute trust per use, or drop the cache when trust()/checkPin reports a change. Severity is low to medium, and it needs the same adversary as finding 1.

## R2-3. [high] Findings 3 (B2) and 9 (b) are only partly fixed: a device without the seed that the server never shows the account's own PQ key silently writes d2 into DMs that are already post-quantum, and w1 own copies on rotation

**Where:** Sending side, hearth/public/js/secure.js:
- :270-279: myPublishedPq returns null when the key isn't listed and this device never pinned it (the pin is only set after seeing the key).
- :283-288, :416 and :637-641: the own copy at rotation becomes w1 to proven.e.
- :843-853: the fallback to d2 happens whenever !minePq and dmHighWater == 0.
- :887-888 and :904: a seedless device returns { pq: true } before noteDmEpoch is ever reached, so its high-water mark stays 0.
Receive side, hearth/public/js/secure.js:985-996: the peer's noPq flag compares against the server-supplied message date.
UI: hearth/public/js/app.js:11230 shows the 'upgrade' bar; app.js:4926 shows the 'locked to your account's post-quantum key' text.
This contradicts docs/ENCRYPTION-RESEARCH.md:214-217 and SECURITY.md:224 (row 165).

**Scenario:**
1. Alice's laptop was signed in before 1.40 and has no seed.
2. Alice signs in with her password on her phone, which publishes PK_A. She and Bob (PQ) exchange d3 messages in epoch 1.
3. The server leaves pqPublicKey and pqSig out of the laptop's /bootstrap `me` record. Nothing else is touched: the laptop's own S.users[me].pq and the DM epoch list's keys[me].pq both still list Alice's fingerprint.
4. On the laptop:
   - It shows the 'upgrade' bar ('turn it on for your account').
   - It shows the DM's d3 messages as '(waiting:pq)' ('Locked to your account's post-quantum key').
   - It has checked and pinned Bob's PQ key.
   - Yet encryptDm writes `d2:` with no error, and P-256 ECDH(Alice, Bob) alone decrypts it.
5. A rotation from the laptop (forceRotate) sends wraps[alice] as w1, while Bob's copy is w2. Only the honest server's staleWraps rule rejects this; a malicious server stores it.
6. Bob's app flags the d2 ('Without post-quantum encryption'). If the server re-dates the message to before the DM's first epoch, the flag disappears.
Reproduction: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/rr16/t1-own-downgrade.test.js passes. Output:
- laptop needs ['upgrade']
- the fingerprint evidence is present in S.users[me].pq and in keys[me].pq
- laptop wrote d2:
- bob sees noPq: true
- backdated: noPq false
- own copy format: w1, bob copy format: w2

**Suggested fix:** Don't conclude that the account has no PQ key from S.me.pqPublicKey alone. Treat the account as post-quantum, refuse d2 and w1-for-self, and show the 'seed' bar instead of 'upgrade' when any of these is present:
- a fingerprint in S.users[me].pq
- keys[me].pq on any DM epoch
- any listed epoch or d3 message in the conversation
- a w2 copy addressed to you
In encryptDm, fall back to d2 only when the DM lists no epochs and has no d3 messages, not merely when dmHighWater is 0. On receive, flag d2/v1 from a PQ-pinned peer in a DM that has epochs, whatever date the server gives the message.

**Verifier:** Confirmed. I re-ran rr16/t1-own-downgrade.test.js and it passes.
- The laptop's needs are ['upgrade'].
- It shows the d3 messages as (waiting:pq).
- It has pinned Bob's PQ key, yet it writes `d2:`, which plain ECDH(Alice, Bob) opens.
- In a rotation, its own copy is w1 and Bob's is w2. Only the honest server's staleWraps rule (server/index.js:3353) refuses that; a malicious server stores it.

Code path:
- myPublishedPq (secure.js:270-279) returns null when the key isn't listed and was never pinned. The pin is set only in myPublishedPq/adoptPq after the key has been seen listed.
- A seedless openDmEpoch returns {pq:true} at :887-888, before noteDmEpoch (:904), so dmHighWater stays 0.
- encryptDm therefore falls back to d2 (:843-853).
- wrapFor's own copy goes through pqKeyOf(S.me) → myLockPq (:283-288), which gives null, so w1 (:637-641).

Trigger: the server leaves pqPublicKey/pqSig out of that device's own record from the start. This is easy for every session signed in before the upgrade, and it is exactly the scenario of the original 9(b), which the fix covers only for devices that once saw the key.

Partial mitigations:
- Bob's app flags normally dated d2 with noPq (secure.js:985-996). That comes after the fact, and the harvest-now-decrypt-later exposure has already happened.
- The 'upgrade' bar (app.js:11229-11230) invites the password, but it wrongly implies the account has no key, and nothing is blocked meanwhile.

This contradicts ENCRYPTION-RESEARCH.md:214-217 (P-256 alone 'only while one of the two has no published PQ key') and SECURITY.md row 167 ('What it makes new without the seed … is locked to your published key'). The device has local evidence it ignores: d3 messages it renders as locked to its own PQ key, keys[me].pq on the epochs, and S.users[me].pq.

## R2-4. [high] Finding 1's trigger (a self user:update carrying the server's public key) still makes the app lock data 'for itself' to a key the server controls, via the personal vault key (pre-existing, outside the PQ diff)

**Where:** - hearth/public/js/app.js:3828-3829: myVaultKey = E2EE.vaultKey(S.privateKey, S.me.publicKey). There is no ownsPublicKey or ownKeysOk check, and the result is cached in vaultKeyP for the life of the page.
- hearth/public/js/recall-host.js:41: the same pattern.
- hearth/public/js/app.js:785-797 and :1367-1371: a self user:update is merged into S.me with no own-key check.
- First uses are at app.js:1299, :1301 and :1304 (WF.apply, PN.apply, SCHED.load). They run after awaits that follow the only ownership check (ensureSigningKey, app.js:1285).
- app.js:8346: scheduled-message drafts are sealed with this key.
- hearth/public/js/scheduled.js:154: drafts that open under this key are trusted for automatic re-encryption.
This breaks SECURITY.md row 67 ('never wrap keys to a wrong key for yourself').

**Scenario:**
1. The server holds back its answer to GET /me/word-filter (started at app.js:1248, awaited at app.js:1298).
2. It emits a socket `user:update` {id: me, publicKey: <server ECDH key>}, then answers the request.
3. WF.apply calls myVaultKey(), which derives HKDF(ECDH(myPriv, serverPub)) and caches it for the page's life.
4. The server sends the real key back with a second update, so ownKeysOk passes again and DMs and rotations keep working.
5. For the rest of the session, every vault write is sealed with a key the server computes as ECDH(serverPriv, myPub). That covers the word filter, personal nicknames, saved-message notes, soundboard data, Recall data and scheduled-message drafts (the plaintext of scheduled DMs and channel messages).
6. The server can also seal a draft under that key for an existing scheduled item (sid = its id). The app trusts it (scheduled.js:154), so after the next key change it re-encrypts and signs text the server chose.
Reproduction at the crypto level, using the real e2ee.js and secure.js mergeUser: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/rr16/t5-vault-selfkey.test.js passes. The server opens the sealed draft with E.vaultKey(evilPriv, myPub).

**Suggested fix:** - Derive the vault key only from a proven key: await ownKeysOk() and use proven.e, and expose that from secure.js.
- Reset vaultKeyP only on a proven key change.
- In the user:update handler, ignore a self record whose publicKey or signPublicKey differs from the proven ones, and warn about it.
- Apply the same change to recall-host.js vkey().

**Verifier:** Confirmed, but pre-existing. The same lines are on the base branch (origin app.js:3785-3786, recall-host.js:41); the PQ diff did not introduce this.

Why it's reachable:
- The socket connects before loadBootstrap, which runs inside the 'connect' handler (app.js:707-715).
- The user:update handler (app.js:785) merges a self record into S.me with no check (setUser, app.js:1367-1371). sec.trust(self) is always true, and app.js has no own-key-mismatch UI.
- vaultKeyP (app.js:3829) is computed from S.me.publicKey as listed and is never reset.
- After the only blocking check (ensureSigningKey, app.js:1285), loadBootstrap awaits server-answered requests (extras, then /me/word-filter) before the first use, WF.apply at app.js:1299.

So the server can hold those requests, push a self user:update with its own ECDH key, answer, and then restore the real key. It can also emit soundboard:changed (app.js:922), whose board.load calls vaultKey() first, to pick the moment exactly, and force a fresh page load through a version change (app.js:713).

My end-to-end test, refute-rr16/f4-vault.test.js, uses the real secure.js and the real scheduled.js with its imports faked as the repo's own test does:
- After the restore, sending works normally, because the own keys prove again.
- The server opens a scheduled draft sealed with the cached key (sealDraft, app.js:8346).
- A held scheduled item the server fabricated, with a draft it sealed itself (sid = the item's id, which satisfies scheduled.js:154 `trusted`), is re-encrypted automatically by the app (PATCH, sendNow).
- Bob reads it as Alice's DM: 'words the server chose'.

So it breaks the confidentiality of vault data, including the plaintext of scheduled messages, and lets the server impersonate the user. This contradicts SECURITY.md row 67. It is high severity, but outside the PQ change's scope.

## R2-5. [high] A device still waiting for the seed keeps no record of what it reads, so the server can make it write P-256-only DMs in a conversation it has already seen go post-quantum

**Where:** hearth/public/js/secure.js:888 (openDmEpoch returns {pq:true} before noteDmEpoch at :904, so the high-water mark is never set), :973 (openDm3 returns before dmKeys, so the pqKeyOf pin at :1007 never runs), :368 (ensurePqKey's 'seed' path sees your signed listed key but never calls pinOwnPq), :846 (the d2 refusal checks only the local high-water mark), :277 and :419 (the refusals depend on those pins). Contradicts SECURITY.md row 165 and ENCRYPTION-RESEARCH section 5 ('never in a DM this device has seen go post-quantum'; 'once a device has seen your key published, it refuses').

**Scenario:**
Account A is from before 1.40. A's phone was signed in before the upgrade, so it is seedless; this is the documented state of every such device until the password is typed there. A upgrades on the laptop, and the laptop and B exchange d3:1 messages. The phone starts: the server lists A's key, so the phone shows the 'seed' bar. Reading the DM, it shows both messages as 'Locked to your account's post-quantum key'. Afterwards localStorage has no hearth.dmepochs entry for the DM, B's pin has no q, and (when A is in no server, so applyState never calls myPublishedPq) there is no hearth.pqself pin. The server then does either of two things. (a) It pushes a self user:update with pqPublicKey:null. ensurePqKey turns the bar into the 'upgrade' text ('turn it on for your account'), myPublishedPq returns null, and the phone's next DM to B is d2. (b) It lists B without his pq fingerprint. This works even when A is in a server, so the own pin exists: pqKeyOf(B) finds no pin and returns null, and the DM is d2. Both d2 messages open with ECDH(A,B) alone, so they can be harvested now and decrypted later. Reproduced: scratchpad/pqhunt3/t2.test.js (own-key variant: own pin null, high-water mark null, 'phone wrote: d2:') and t2b.test.js (own pin set, peer key hidden, 'phone wrote: d2:').

**Suggested fix:** Record that a DM went post-quantum from the epoch list, even when no epoch opens: keep a per-DM 'pq seen' flag set whenever the server lists an epoch made by one of the two, and refuse d2 whenever that flag is set or the server currently lists any epoch for the DM. Call pinOwnPq in ensurePqKey as soon as the listed key verifies as yours, before dropSeed or needPassword('seed'). In openDm3/openDmEpoch, run pqKeyOf(peer) (which pins) before returning {pq:true}.

**Verifier:** Confirmed in the code and in my own runs. In the code: openDmEpoch (secure.js:887-888) returns {pq:true} before noteDmEpoch (:904), so no high-water mark is set. openDm3 (:972-973) returns before dmKeys, so the pqKeyOf/pinPq at :1007 never runs. ensurePqKey's 'seed' path (:368) verifies the listed key with listedPqIsMine but never calls pinOwnPq. encryptDm's d2 refusal (:846) checks only dmHighWater. Runs (scratchpad/pqrefute4/f1.test.js, f1b.test.js): after the seedless phone has shown the two d3 messages as locked, its state is ownPin=false, hw=null, peerQ=false. Hiding A's own key then gives 'd2:' (bar flips to 'upgrade'); this also works with d2 history loaded. Hiding B's fingerprint gives 'd2:' in a fresh DM. Controls: a seed-holding device in the same scene refuses both ('untrusted' / 'own_key_mismatch'). So does a phone that is in a group chat with B, because applyState pins the own key and wrapFor pins B's q. Loading old d2/v1 messages pins B's q and blocks variant (b), but variant (a) still writes d2. Any successful send from the phone records both. Preconditions: (a) A is in no server or group; (b) the phone has opened no d2/v1/tag/background in that DM and wrapped no group key for B. Both need the phone to have sent nothing since the upgrade, and the server can pick that moment. This contradicts SECURITY.md row 165 and ENCRYPTION-RESEARCH §5 ('never in a DM this device has seen go post-quantum'; 'once a device has seen your key published, it refuses'). B's app does show a noPq flag, but finding 2 removes it. Given the preconditions I'd rate it medium rather than high.

## R2-6. [medium] The 'Without post-quantum encryption' flag on d2 messages can be switched off by the server with one bogus epoch entry

**Where:** hearth/public/js/secure.js:985-996 (d2AfterPq). At :991 the lowest epoch is chosen from the server-supplied list. When that entry doesn't open, `first` at :994 falls back to server createdAt, or to Infinity. On seedless devices `first` always comes from server createdAt. An empty or failed list returns false at :990. secure.js:1027 never flags your own d2 written by another of your devices. app.js:4812 renders the flag. This is the only detection SECURITY.md row 165 and ENCRYPTION-RESEARCH (e) give for a P-256 fallback.

**Scenario:**
A and B have been on d3 for a while. A signs in on a new browser (fresh localStorage, password sign-in) or uses a seedless device (previous finding). The server hides B's pq fingerprint and the DM's epochs from that device. A's message goes out as d2 (TOFU path; t1.test.js: 'fresh device wrote: d2:'). B's device has pinned A's post-quantum key, so as a baseline it flags the message (noPq:true). The server then prepends {epoch:0, wrapperId:A, createdAt:0, wrapped:null, keys:{}} to B's GET /dms/:id/keys. openDmEpoch(epoch 0) throws 'Missing key', so first = Number(0)||Infinity and `at > first` is false: no flag. The d3 history still reads, and B's next send is still d3:1, so nothing else is visible. A's own other devices never flag the d2 either. The server keeps a P-256-only DM with no warning anywhere. Reproduced: scratchpad/pqhunt3/t1.test.js.

**Suggested fix:** Take `first` only from epochs this device actually opened, using their authenticated madeAt with trust now or pinned. Ignore entries that don't open or have epoch < 1, and never fall back to server createdAt or Infinity. Better: store the first authenticated epoch time per DM locally, next to the high-water mark, and flag any d2/v1 from a PQ-pinned peer dated after it. Flag your own d2 written by another device too.

**Verifier:** Confirmed. d2AfterPq (secure.js:985-996) takes the lowest epoch from the server's list. If that entry doesn't open, `first` becomes Number(e.createdAt) || Infinity (:994), so the server decides it. My run (scratchpad/pqrefute4/f2.test.js) uses a d2 written by the seedless phone from finding 1. With the honest list, B sees noPq=true. Prepending {epoch:0, createdAt:0, wrapped:null} gives noPq=false, and so does {epoch:-5, createdAt:9e15, wrapped:'junk'}. Nothing else changes: the d3 history still reads and B's next send is still 'd3:1:'. Control: pushing an openable epoch's createdAt into the far future does not remove the flag, because its authenticated madeAt is used. So the bypass relies only on the fallback for entries that don't open. This contradicts ENCRYPTION-RESEARCH 5(e) ('as that epoch's own copy dates it') and SECURITY.md row 165, and it makes TOFU and finding-1 downgrades silent. One sub-claim is not a defect: your own d2 written on another of your devices is never flagged (:1027), but 5(e) only covers messages 'from someone' else.

## R2-7. [low] One P-256-only member copy (w1) makes a whole server or group epoch harvest-now-decrypt-later readable, which SECURITY.md row 163 and the section 4 'not covered yet' list don't say

**Where:** hearth/public/js/secure.js:640-641: wrapFor silently wraps w1 for any member without a listed or pinned post-quantum key. hearth/SECURITY.md:222 (row 163) lists server key handoffs as protected, and the section 4 'Post-quantum: what's not covered yet' bullet names only DMs with a peer who has no key. No UI shows which servers have P-256-only copies.

**Scenario:**
A server has an owner and a member who both have post-quantum keys, plus one member who hasn't signed in with the password since 1.40. The current epoch's copies are w2, w2 and w1. A recorder holding only that member's P-256 private key (what Shor recovers from the public key) unwraps the w1 copy, gets the group key and reads the owner's channel message ('secret plans'). So every channel message in every epoch with at least one non-upgraded member stays readable once P-256 falls, even though the docs present server key handoffs as covered. Reproduced: scratchpad/pqhunt3/t4.test.js ('formats: w2 w2 w1', 'read with P-256 alone: secret plans').

**Suggested fix:** State in row 163 and section 4 that a server or group's channel messages are only post-quantum protected while every member's copy of that epoch is w2. Show it in the app, for example on the member list or channel header. On the receiving side, flag w1 copies addressed to an account that already has a published post-quantum key.

**Verifier:** Documentation defect; the code works as designed. wrapFor (secure.js:639-641) writes w1 whenever pqKeyOf returns null. The server accepts w1 for members without a post-quantum key; staleWraps rejects w1 only for members who have one. So one non-upgraded member, for example a dormant account that never signs in with its password again and so never gets a key, keeps every epoch's group key recoverable with P-256 alone. t4 reproduces this: formats w2 w2 w1, and the owner's message is read with P-256 alone. SECURITY.md:22 says 'Every key that protects stored or recorded messages is agreed with hybrid … server key handoffs … breaking P-256 later … isn't enough' and carves out only DMs. The §4 'not covered yet' list (SECURITY.md:330-336) names the vault, DM tags and backgrounds, DMs with someone who has no key, and non-upgraded accounts themselves. It never says that every member's channel messages stay harvest-now-decrypt-later readable while any member's copy is w1. I found no mention of this in ENCRYPTION-RESEARCH, README or FEATURES, and no UI indicator. One correction: row 163 itself is accurate, since it speaks of '(w2)' handoffs; the overclaim is in the summary row and the §4 omission. Low severity.

## R2-8. [high] After a server restore from backup, or the documented rollback followed by a re-upgrade, DMs that went post-quantum stay blocked for good and server key rotation can freeze. Neither the app nor the docs offer a way to recover.

**Where:** hearth/public/js/e2ee.js:909-918 (hearth.dmepochs.* high-water marks in localStorage, only ever raised), e2ee.js:900-906 (hearth.pqself.*), e2ee.js:890-897 and 920-923 (post-quantum q pin in hearth.pins.*). Sign-out clears none of these: app.js:555-581 signOutHere only calls E2EE.clearKeys (IndexedDB) and usability.js:59-61 clearLocalCopies (inbox, reminders, side view). Consequences: secure.js:921-927 (rollback refusal), secure.js:277 (ownPqMissing), secure.js:419 (pinned peer key missing throws), secure.js:640 (one member's pqKeyOf throw aborts the whole rotation), secure.js:457 (no current key while needsRotation). Docs: docs/RECOVERY.md:280-286 and 307-319 describe restore and rollback as losing only what was written after the backup or upgrade.

**Scenario:**
Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/newfind.test.js, tests B, B2 and B3. Run with NODE_PATH=<worktree>/hearth/node_modules node --test --test-force-exit.

(a) Restore from a nightly backup (RECOVERY.md restore):
1. A and B have a d3 DM. Epochs 2 and 3 were made after the backup, and both browsers saw them (high-water mark 3).
2. After the restore the server lists only epoch 1.
3. Both browsers get code 'rollback' on every send ("…it may have been restored from a backup… Tell the server's owner"). Signing out and back in with the password on the same browser still gives 'rollback', because the mark survives sign-out.
4. A fresh browser can write (it reuses epoch 1), but the old browsers stay blocked until fresh browsers have made epochs up to 3, roughly one per week of use. The owner can do nothing. With weekly rotation, restoring any backup older than a week hits essentially every active DM.

(b) hearth-update --rollback of 1.41 (pre-v26 copy), then upgrading again (test B2):
1. Browsers that used 1.41 still hold hearth.pqself and the peers' q pins.
2. Every DM send fails, including to accounts that never had a post-quantum key, with own_key_mismatch: "The server stopped listing your account's post-quantum key… Reload the page".
3. DMs with pinned peers fail with 'untrusted'.
4. After both people re-enter their passwords, DMs that had gone post-quantum fail with 'rollback' for good.

(c) Servers after the same rollback (test B3):
1. A member leaves, which sets needsRotation.
2. The owner's browser can't rotate (own_key_mismatch).
3. Even after the owner re-enters the password, rotation fails: "<m1>'s post-quantum key isn't listed right now". The server still reports needsRotation true at the old key epoch.
4. The channel stays unwritable until every member whose key is pinned re-enters their password, or someone on a fresh browser rotates.

**Suggested fix:** Give these per-device marks a recovery path. Options:
- Have the server expose a per-database generation (bumped by cli restore, hearth-update --rollback, or a re-run of the v26 migration). When it changes, ask the user once and reset hw, pqself and q for this account.
- Let the 'rollback' error offer "This server was restored: continue" for that DM, which resets its mark after confirmation.
- In wrapFor, leave a member whose pinned post-quantum key is missing out of the rotation (as held members are) instead of failing it. They get a share once their key is back.
- Document the effect in RECOVERY.md.

**Verifier:** I confirmed this in the code and by re-running tests B, B2 and B3 (all pass).

Why it blocks:
- noteDmEpoch (e2ee.js:912-918) only ever raises the mark, and nothing clears hearth.dmepochs.*. signOutHere (app.js:555-581) and clearLocalCopies (usability.js:59-61) leave the mark, pqself and the pins in place.
- With mark 3 and only epoch 1 listed, dmSendKey posts epoch 4 at i=0. The server answers 409 'epoch' (index.js:4425), and i=1 throws 'rollback' (secure.js:921-927).
- Every attempt also uses up one of the account's 30 dmkeys slots per hour (index.js:4413 counts before the epoch check).
- The only ways out are clearing site data, or devices without the mark making epochs up to it, at roughly one a week. app.js has no handler for 'rollback'.

Docs: ENCRYPTION-RESEARCH.md §7(d) (lines 318-320) does list the restore case as a known 'availability only' item for later. It offers no recovery, though, and RECOVERY.md's restore and rollback sections (lines 280-284, 312-313) say nothing about it.

The rollback + re-upgrade path (B2) is not acknowledged anywhere:
- pqself makes every DM fail, including to P-256-only peers, until the password is entered.
- q pins make sends fail with 'untrusted' until the peer publishes again.
- The mark then gives 'rollback' for good.

Rotation (B3): one throwing pqKeyOf aborts wrapFor (secure.js:640). Correction: only browsers that pinned q for a member who hasn't published again are frozen; another member's app without those pins can still rotate through maintain().

## R2-9. [medium] The "Enter your password once" bar is a fixed overlay with no close button: it covers header controls, takes about 40% of a phone screen, and sits under an admin announcement

**Where:** hearth/public/js/app.js:11222-11232 (pqUnlockBar appends #pq-unlock to body with class 'announce' and no close button). hearth/public/css/app.css:2488-2489 (.announce is position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 70). hearth/public/js/app.js:11249 (#announce is appended later at the same spot). secure.js:374 (needPassword('upgrade') fires on every pre-1.41 device of every account that hasn't entered its password).

**Scenario:**
Repro: real app in Chromium via Playwright with /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/bar.mjs, bar2.mjs and bar3.mjs. Screenshots are in .../pqrev3/shots/ (phone-home.png, phone-bar.png, desktop-channel2.png, desktop-both.png).

Who sees it: a device signed in before the update, for an account with no post-quantum key, shows the 'upgrade' bar until the password is entered. Sessions last up to 365 days, so right after release this is most users. Devices waiting for the seed see the same bar.

- Desktop, 1400×900, in a channel: the bar sits at (350,10) and is 700×59. Clicks on "Search this channel (Ctrl+K)", "Threads" and the end-to-end badge land on the bar.
- Phone, 390×844: left: 50% halves the width the bar can use, so it renders 243×341 px with one word per line. On Home, taps on the header title, the server card's name, "New message" and "All friends" all land on the bar.
- With an admin announcement set: both bars are drawn at the same fixed spot, the announcement on top. A click on "Enter password" lands on the announcement, and the two texts overlap and can't be read.

**Suggested fix:** Render the bar in the page layout instead of as a fixed overlay, for example a .key-bar row under #main-head or at the top of #app. If it stays fixed, use left/right: 12px with no translate on narrow screens, and stack it below #announce. Add a "Later" button that hides it for the session.

**Verifier:** I confirmed this in the code and in the real app.

Code:
- pqUnlockBar (app.js:11222-11232) adds #pq-unlock to body with class 'announce'. Its only button is 'Enter password'; it has no dismiss.
- .announce (app.css:2488) is position: fixed, top 10px, left 50%, translateX(-50%), z-index 70, with no phone rule.
- With left: 50% the shrink-to-fit width falls back to the content's minimum width, so the text wraps one word per line.

Re-running bar.mjs and bar3.mjs:
- Phone: the bar is 245×343 px (about 40% of the 844 px height) with dismiss=false. Taps on the header title, the server card, 'New message' and 'All friends' land on the bar (measured mid-entry animation; after it settles the bar sits further left, so the exact list varies, but the title and the card's name stay covered).
- Desktop: the bar is 699×59 px over the channel header.
- Desktop with an announcement: a click on 'Enter password' lands on the announcement. The announcement does have its own Dismiss button, so that part can be undone.

The bar appears on every device signed in before 1.41 (secure.js:374) and only goes away once the password is entered. That contradicts the comment at app.js:11219-11221: 'nothing is blocked meanwhile'.

## R2-10. [medium] Devices without the seed start a new DM epoch whenever they switch or reload. This uses up the 30-per-hour limit and blocks DM sends on all of the account's devices.

**Where:** hearth/public/js/secure.js:884-888 (openDmEpoch returns {pq:true} when this device has no seed). secure.js:935-948 (dmSendKey then mints top+1 and keeps its raw key only in this tab's memory). server/index.js:4413 (rateLimit('dmkeys:'+userId, 30, 1 hour), per account).

**Scenario:**
Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/newfind.test.js, test C.

1. Bob's account has a published key. His phone and laptop were signed in before it existed, so both show the 'seed' bar. Two tabs, or one tab across reloads, behave the same way.
2. Each device can reuse only an epoch it made in its current page session.
3. Sending alternately from the two (with the dm:keys events the app receives) mints a new epoch on every switch: 30 sends made 30 new epochs.
4. The 31st send failed with rate_limited "Too many attempts. Try again in 60 minutes."
5. Bob's device that does have the seed then could not start the first epoch of a new DM with someone else either, because the limit is per account.

Each reload of a device without the seed also mints one epoch per DM it writes in. ENCRYPTION-RESEARCH.md §7(d) blames this behaviour only on a hostile server, but here the server is honest.

**Suggested fix:** Store the raw keys of epochs this device made in IndexedDB, so a reload reuses them. On a device without the seed, when the newest epoch was made by your own account less than a week ago, ask for the password (need_password) instead of minting another. Alternatively, apply the limit per DM, or allow one epoch per DM per day without counting it.

**Verifier:** The mechanism is confirmed. I re-ran test C: 30 alternating sends made 30 epochs, then rate_limited, and the seeded device couldn't start a new DM's epoch.

How it happens:
- openDmEpoch returns {pq:true} without the seed (secure.js:888).
- So dmSendKey mints top+1 unless the epoch is in this tab's in-memory dmRaw (secure.js:935-948).
- The limit is per account and counts every POST, before any check (index.js:4413).

My calibration test narrows the trigger:
- One seedless device alternating with a seeded device of the same account made only 1 epoch in 10 sends. The seeded device reuses the seedless one's epoch.
- Churn needs two or more seedless devices or tabs alternating, or reloads: 3 reloads × 5 DMs made 15 epochs.

So a mobile user whose page reloads often, writing in several DMs, or someone with two seedless tabs, can reach 30 an hour against an honest server. ENCRYPTION-RESEARCH §7(d) blames this only on a hostile server.

Impact is real but lower than 'medium': it happens in a transient state the bar prompts to fix, and the seeded device can still reuse fresh epochs.

## R2-11. [low] After a password reset on a browser that had seen the old key, if the first start doesn't publish the new key, every DM send fails (even to contacts with only P-256 keys). The error blames the server, and no bar appears in that session.

**Where:** hearth/public/js/e2ee.js:900-906 (hearth.pqself.* survives sign-out and reset). secure.js:270-279 (myPublishedPq throws ownPqMissing when the key is pinned but nothing is listed; encryptDm calls it for every DM at secure.js:842). secure.js:371 (the 'publish' bar only appears at the next start). secure.js:376-384 (errors in the password-context publish are only console.warn'ed: no bar, no retry). app.js:11234-11239 (unlockPq shows nothing when its publish fails). This contradicts SECURITY.md row 168: "A seed that was never published (an interrupted first start) writes P-256 DMs". The review-14 test only covers a fresh browser (pins: new Map()).

**Scenario:**
Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/newfind.test.js, test A.

1. User u has used browser X, so X has u's own key pinned.
2. u resets the password on X, either without a recovery key or with a pre-upgrade one (which drops the key).
3. The first start's POST /me/pq-key fails once (test injects a 503), or the tab closes first.
4. In that session neededPassword() is null and no bar is shown.
5. Sending a DM to an account that never had a post-quantum key throws own_key_mismatch: "The server stopped listing your account's post-quantum key, so nothing was encrypted. Reload the page; if it keeps happening, tell the server's owner."
6. After a reload the 'publish' bar appears, but DMs keep failing with the same message until the password is entered.

On a browser that never saw the key, the same account writes d2 as documented.

Related: when the bar's own unlock fails to publish (429, network), the dialog closes and nothing is said.

**Suggested fix:** When the app knows the account's key was legitimately dropped or replaced (a keepKeys reset with pqInEnvelope false, or a reset with new keys), remove hearth.pqself.<id> in openReset/finishLogin before startApp. In ensurePqKey's catch, call needPassword('publish') or needPassword('upgrade') when a password-context publish fails, and rethrow so unlockPq can show the error. When this device holds an unpublished seed, word ownPqMissing to point at the bar instead of the server.

**Verifier:** I confirmed this and re-ran test A (it passes).

The chain:
- hearth.pqself.<id> (e2ee.js:900-906) is never removed: not by signOutHere, openReset or finishLogin.
- Both reset kinds clear pq_public_key on the server: new keys, and keepKeys with pqInEnvelope false (accounts.js diff).
- pendingPq is used up before ensurePqKey runs (app.js:1288-1290). A failed publish is only console.warn'ed (secure.js:383), so pqNeed stays null.
- encryptDm calls myPublishedPq in Promise.all for every DM (secure.js:842). It throws ownPqMissing (secure.js:277) even for P-256-only peers, where your own post-quantum key plays no part in d2. The message says to tell the server's owner.
- unlockPq shows nothing when its publish fails (app.js:11234-11239).

This contradicts SECURITY.md row 168 ('writes P-256 DMs').

Correction: 'no bar in that session' holds only until the next socket reconnect. loadBootstrap runs on every 'connect' (app.js:715), and that run shows the 'publish' bar.

The trigger is one failed request or a closed tab right after a reset. Low severity.

## R2-12. [low] A DM scheduled before the conversation went post-quantum is flagged "Without post-quantum encryption … the server may have tricked it" when it is sent

**Where:** hearth/public/js/secure.js:985-995 (d2AfterPq compares the message's server createdAt with the first epoch's madeAt). secure.js:1027. hearth/public/js/app.js:4812 (the warning note and its tip). hearth/server/scheduled.js:128-137 (a DM is held for re-encryption only when the peer's identity key changed).

**Scenario:**
Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/newfind.test.js, test H.

1. Bob has no post-quantum key yet and schedules a DM to Alice for tomorrow. The composer encrypts it as it would now: d2.
2. The next morning Bob signs in with his password (the upgrade). They chat, and the DM gets epoch 1.
3. At the scheduled time the server posts Bob's stored d2 ciphertext unchanged.
4. Alice's app opens it with dec.noPq = true and shows the warning, whose tip says the server may have tricked Bob's app. Nothing was tricked; the scheduler simply never re-encrypts it.

**Suggested fix:** In server/scheduled.js keyProblem, hold a DM whose ciphertext is d2 or v1 once dm_keys has an epoch for that DM (a new reason such as 'pq'). The sender's app already re-encrypts held messages from its own copy, so it would resend it as d3.

**Verifier:** I confirmed this and re-ran test H (it passes).

- scheduled.js keyProblem (server/scheduled.js:128-137) holds a DM only when the peer's identity key changed, so a d2 ciphertext made before the upgrade is posted unchanged.
- d2AfterPq (secure.js:985-995) compares the server's posting time with the first epoch's madeAt, and app.js:4812 shows the red warning.

Mitigating facts:
- The tip already says '…or held it back until now'.
- The flag follows the documented rule (ENCRYPTION-RESEARCH §5(e)), and the message really is P-256 only.

Still, the tip's premise that 'the other person's app wouldn't fall back like that by itself' is false here. The sender's app would re-encrypt from its own copy if the message were held, but it never is. So a pre-upgrade scheduled DM ships P-256-only into a post-quantum conversation and trips a security warning on a legitimate message. Low severity.

## R2-13. [low] On a device without the seed, channels whose key is locked to the post-quantum key show "Waiting for another member to come online…"

**Where:** hearth/public/js/app.js:8122-8157 (keyNotice has no case for a key waiting for the seed). secure.js:112 and 534 (waitingPq is internal and not exported). By contrast, secure.js:706-710 and 750 correctly say to enter the password.

**Scenario:**
Repro: Chromium via /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/bar3.mjs.

1. Account kdesk signs up on device A and creates a server; its own copy of the server key is w2.
2. On device B (signed in, seed removed), the channel shows a spinner bar above the composer: "Waiting for another member to come online and share this conversation's encryption key with you."
3. Meanwhile each message reads "Locked to your account's post-quantum key: enter your password once…", and sending shows the need_password toast.
4. No member can help: the server already counts B's account as having the key. The composer bar spins forever.

**Suggested fix:** Export a waitingPq(serverId) check from createSecure. In keyNotice, show the password message with an "Enter password" button when it is true.

**Verifier:** I confirmed this in the code and in the real app.

- keyNotice (app.js:8147-8156) has no case for waitingPq, which is internal to secure.js (lines 112 and 534).
- So with no current key it falls through to the spinner text 'Waiting for another member to come online and share this conversation's encryption key with you.'

Re-running bar3.mjs on a seedless device:
- The composer bar showed that text.
- The messages read 'Locked to your account's post-quantum key: enter your password once…'.
- The send toast was the need_password one.

Nobody will share: server_keys is per account, so the account isn't listed as missing.

This also happens without any test setup: a device signed in before the upgrade sees w2 own copies once another device re-stores them (secure.js:530) or a rotation wraps them as w2. The top bar still points to the fix, so severity is low.

## R2-14. [low] The password bar appears right after the password was entered: during simultaneous sign-ins and in other tabs

**Where:** hearth/public/js/secure.js:376-382 (pq_exists leads to needPassword('seed') even when ctx holds the password's keys). secure.js:368-369 (a run without ctx decides 'seed' from the S.pqSeed loaded when this tab started). app.js:797-799 (the user:update handler triggers that run).

**Scenario:**
(a) Simultaneous sign-ins. Repro: /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/newfind.test.js, test F.
1. A pre-1.41 account signs in with its password on two devices at about the same time.
2. The second device's upgrade POST gets 409 pq_exists.
3. It immediately shows the 'seed' bar, although it holds authKey and wrapKey and could fetch the new envelope itself.

(b) Two tabs of one browser, by code reading.
1. Both tabs show the 'upgrade' bar. The user enters the password in tab A, which stores the seed in IndexedDB and publishes the key.
2. Tab B gets user:update but still has S.pqSeed = null from when it started.
3. Tab B switches to "Hearth added post-quantum encryption to your account. Enter your password once on this device…" on the device that just did it, until it is reloaded.

**Suggested fix:** In the pq_exists branch, when ctx is set, re-fetch /me/keys/wrapped with ctx.authKey, unwrap it with ctx.wrapKey and adopt the seed. In the path without ctx, reload the seed from IndexedDB (E2EE.loadPqSeed) before choosing 'seed'.

**Verifier:** Both parts are confirmed.

(a) Simultaneous sign-ins: test F gives B ['seed'] right after B's own password sign-in.
- If B's bootstrap doesn't list A's key yet: 409 pq_exists, then needPassword('seed') (secure.js:376-382).
- If it does: the replace path with a stale fromEnvelope is refused, and it lands in the same branch.
- Either way the ctx with authKey and wrapKey goes unused.

(b) Two tabs: my scratch test shares one localStorage between two secure instances and confirms it. After tab A's unlock, tab B's user:update leads to ensurePqKey() (app.js:799). Tab B still has S.pqSeed = null from start-up and has no cross-tab sync, so it hits needPassword('seed') at secure.js:368, and its bar goes 'upgrade' → 'seed'.

Impact is only an unnecessary second password prompt (or a reload), so low. (a) is rare; (b) is common with several tabs.

## R2-15. [low] The e2e emoji flake (expects 22, gets 21.9997) is a test timing issue, not an app bug

**Where:** hearth/test/e2e/flows.mjs:3600-3601 (exact prev[0] === 22 check on getBoundingClientRect().height). hearth/public/css/app.css:1246-1251 (.modal animates 'rise' for .22s with cubic-bezier(.16,1,.3,1) from scale(.98)). app.css:3661 (.s-inline is fixed at 22px, which outranks img.cemoji's 1.375em).

**Scenario:**
Repro: Chromium via /tmp/claude-0/-home-user-Pandabear445-github-io/4a09fd65-8b34-5500-b468-8ae68479cff6/scratchpad/pqrev3/emoji.mjs, using the real app.css.

The preview's layout height is always 22px. getBoundingClientRect, however, includes the dialog's opening transform. Sampled while the Server settings dialog opens:
- 21.56 at 8 ms
- 21.99 at 129 ms
- 21.9977 at 174 ms
- 21.99997 at 219 ms
- exactly 22 afterwards

offsetHeight is 22 the whole time. On a fast run the test opens the dialog, picks two files and measures within about 200 ms, so it sometimes catches the end of the animation: 21.9997 corresponds to a scale of about 0.99999. Users see a 22px preview. The inline check two lines below already uses Math.round and a range.

**Suggested fix:** Test-only change: compare Math.round(height) or offsetHeight, or wait for document.getAnimations() to finish before measuring.

**Verifier:** Confirmed, and it's a test-only problem: the app is fine.

flows.mjs:3600-3601 checks getBoundingClientRect().height === 22 exactly. The layout height is always 22 (offsetHeight); only an ancestor transform can make it fractional, and .modal's 'rise' animation (app.css:1246-1251, scale .98 → 1 over .22s) does that.

How I checked:
- Re-running emoji.mjs: height 21.56 at the start of the animation, 22 after.
- A Playwright probe: click() can fire inside the animation. One of 5 runs clicked at 65 ms with height 21.56, because the first animation frames are identical and so pass the stability check.
- Repeating the real emojiSizes steps 12 times in the app measured 21.982 once.

This predates the PQ diff: emojiSizes comes from 1.40.0 (commits 8dca4f9/2b9d46c). Fix it with Math.round or offsetHeight.
