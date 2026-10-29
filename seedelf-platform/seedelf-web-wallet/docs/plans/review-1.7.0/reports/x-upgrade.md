# x-upgrade: 1.6.0 to 1.7.0 with state in flight (#325–#338, HEAD 6bca8bec)

Lens: a user's wallet updates from 1.6.0 (`babb8e76`) to 1.7.0 while something is under way. For every record the release reads or writes, what 1.6.0 wrote, and whether 1.7.0 reads it right.

## Summary

**What the update itself does.** Chrome installs an MV3 update once the extension is idle: no worker running and no page open. Nothing in the wallet defers it.
- `chrome.storage.session` is cleared, the worker restarts, and the wallet comes back locked. Pages close, and the alarms may be cleared.
- The unlock's run re-arms the sessions alarm (`sw.ts:173` → `runs.ts:103`).
- So what lives only in session storage goes, as at a lock: a chain being sent, parts waiting, the watch (unless it's maybe sent), and reviews. 1.6.0 already planned for this. `cuts()` names "an update" (`lovejoin.ts:5303-5307`), and `pending.ts:35-40` seals a maybe-sent watch across one.
- What lives in `chrome.storage.local` is what 1.7.0 reads: the sealed schedule and session book, the vault, the sealed maybe-sent watch and the kept pools.

**Shapes: nothing changed.**
- The range adds no storage key and no persisted field. The added lines write only `tail.over`, through the existing `tailOver`, and the kept pools, through `keep`.
- `vault.ts`, `private-store.ts`, `wallet.ts`, `sw.ts`, `runs.ts` and the manifest are unchanged.
- `interface Tail` is byte-identical. So are `tailWaits`, `tailBuildable` and `tailOf`…`tailChain`. `witnessTail` only gains the way out's stop. No existing en/es/ja value changed (six keys were added), so the reasons 1.6.0 persisted still read as before.

**Per item:**
- **The tail:** 1.7.0 reads 1.6.0's tails correctly (no finding). An update cuts every chain mid-send, so every tail held at the update reaches 1.7.0 through `tailHeld`'s cut-chain branch. That branch has no test (pr337 #3). pr337's R3 ran it after a lock, which leaves the same storage.
- **The Bootstrap:** 1.7.0 reads 1.6.0's Bootstraps correctly (no finding).
- **Parts waiting:** finding 2. This was already so in 1.6.0, and the update now triggers it with no warning.
- **Token pools:** findings 1 and 3. Neither `confirmed()` nor `holder()` re-checks a pool 1.6.0 holds, and nothing re-examines a held pool's row.
- **No downgrade:** nothing to do.

**Three findings:** one medium (with x-overflow #1's root cause), one low, one owner-call.

## Findings

### 1. Medium (correctness): a pool row 1.6.0 kept, which verified only by wrapping, traps 1.7.0 on every pool read, Koios-only too

**Files:**
- `lovejoin-pools.ts:454` (1.6.0: `await this.keep(network, found)`), `:381` and `:626` (`slim` keeps `ref.reference` verbatim), `:350` (`kept()` reads it back) and `:568`/`:498` (held refs skipped).
- `lovejoin.ts:2709` (`readSet`, quiet reads via `known` too), `:2722` (sealed `copies`) and `:2736` (`verifiedPool` → `lovejoinVerifyPool`, a trap rethrown).
- `seedelf-core/src/eval.rs:148-152`.
- `seedelf-platform/Cargo.toml:51-58`, against `git show babb8e76:seedelf-platform/Cargo.toml`, which has no overflow checks.

**Claim.**
- **1.6.0 kept the row.** 1.6.0's module had no overflow checks, so `eval::resolve`'s `+= quantity` wrapped. A data layer row naming the pool's NFT twice (2^64 − 1 and 2) summed to 1, verified, and was kept as listed in `seedelf.lovejoinPools.<network>`. 1.6.0 also had no Koios confirmation.
- **1.7.0 traps on it.** 1.7.0's module checks core's overflow (#332), so the same row traps.
- **Nothing in 1.7.0 re-examines it.** It's "known", so `confirmed()` and `holder()` pass it by. `known()` hands it over from local storage with no request, so Settings' Koios-only doesn't avoid it. x-overflow #1 names that switch as the way out for a row listed fresh.

**Scenario.**
1. During 1.6.0's life, a lying or compromised data layer lists such a row, and a 1.6.0 mainnet device keeps it. The row is a real pool's reference outpoint, seed and scripts, with the NFT doubled.
2. 1.7.0 installs.
3. Any pool read now traps and locks the wallet. That includes the Lovejoin page, a swap review's room read, a session return's quiet look, `tailChain`, and a due Lovejoin withdraw in the alarm's run.
4. Unlock, and the next read locks it again.
5. The server fixing its list doesn't help, and neither does Koios-only. Only Remove wallet clears it, by deleting the record. Meanwhile the device can't bring its boxes back.

**Evidence.** A scratch test (`tests/zz-review-x-upgrade-1.test.ts`, deleted) used the real `wasm/pkg` and the real `PoolDiscovery`. It took a stored 1.6.0-shaped record holding preprod's bundled 5 ₳ pool with its NFT listed as `18446744073709551615` and `2`, `index: async () => undefined` (Koios-only), and a Koios that records any call:
- `serviceDeps(d).known("preprod")` and `.pools("preprod")` both handed the row over, with no request (`asked = []`).
- `lovejoinVerifyPool` on it gave `RuntimeError: unreachable isTrap: true`.
- The control, the same pool with the NFT once, verified.

**Fix.** x-overflow #1's fix: `checked_add` in `eval::resolve`, refused in words. The kept row then fails verification in words, and `verifiedPool` leaves it out. It must ship in the 1.7.0 build itself: a server-side fix can't reach a row already on the device.

**Test.** With the real module, a `PoolDiscovery` whose stored record holds that row:
- `known` still hands it over;
- `lovejoinVerifyPool` refuses it in words, with no trap;
- the Lovejoin service's read set leaves it out.

It fails today.

**Confidence:** high on the mechanism, which I proved on the store module. Low on reach: it needs the data layer to have served such a row during 1.6.0's life.

### 2. Low (ux): a payment in parts waiting when the update lands: the rest never go, and nothing says so once Koios took the part before

**Files:**
- `parts.ts:8-17` and `:33`. The waiting record lives in session storage only. The header says "the part the watch holds keeps how far the payment went, sealed with it, so Home says it went in part".
- `pending.ts:385`, and `:850-880` (`if (taken) await unseal(deps, w)`): the sealed copy, with `parts`, is dropped once Koios takes the part.
- `handlers.ts:237-251`. The `stopped: "locked"` path needs a watch that survived the wipe.

**Claim.** After an ordinary submit of the part before, the only record that more parts are due is in session storage. An update clears it with no lock countdown ("A payment is being sent in parts: locking now stops it partway" is the lock's alone). After the unlock, Home hears nothing, and the rest never go. Session fundings are covered: their record's `waits` parts go missed (`sessions.ts:303-308`, `fundingState`). Plain Send and Make public aren't.

**Scenario.**
1. A 1.6.0 user sends tokens in parts: part 2 is chained, so it waits for part 1's block.
2. They close the window. With the worker idle between alarm ticks, Chrome installs 1.7.0.
3. They unlock. Home's banner is empty.
4. The payee got part 1 only, and part 2's tokens stay in the private balance. Nothing says the payment stopped partway. The history shows part 1 with its own figures, so no amount is misstated.
5. The same happens after any closed browser, and after every later update.

**Evidence.** A scratch test (`tests/zz-review-x-upgrade-2.test.ts`, deleted), on test wallet A's shape with two parts, with the worker's handler:
- **Before:** Home hears `{"parts":{"sent":1,"total":2}}`, "Private payment not confirmed yet 1 more to go, once the one before lands", and `maybeSent.preprod` is `undefined`.
- **The update:** lock, `session.clear()`, a restarted worker's services, unlock.
- **After:** Home hears `null`. After part 1 lands, `pump` says `false` and 1 is submitted. Home still hears `null`, and `parts-waiting` is `false`.

**Fix (owner's call on whether it's 1.7.0's).** Nothing in 1.7.0 can recover this update's own instance: 1.6.0 left no trace of it. For a closed browser and later updates:
- Seal a small record while parts wait: the first hash, sent, total and when. Write it with `holdWaiting`, and drop it when the last part goes or the parts stop.
- In `pending-tx`, read it when neither the watch nor the parts' record has the payment, and say it went only in part (`stopped: "locked"`).
- Correct `parts.ts`'s header: a part's `parts` is sealed only until Koios answers it.

**Test.** The scratch test above should end with `parts: { sent: 1, total: 2, stopped: "locked" }` and Home saying "only partly sent". It fails today.

**Confidence:** high. It's pre-existing since 1.6.0, not a 1.7.0 regression.

### 3. Owner-call (privacy/correctness, my idea): pools 1.6.0 took from the data layer are never confirmed

**Files:** `lovejoin-pools.ts:565-583` (`confirmed()`: `known` pools pass unchecked) and `:498` (`holder()`: same). For 1.6.0's head start: `git show babb8e76:…/src/lovejoin-pools.json` has mainnet `pools: []` at height 14110720.

**Claim.**
- 1.6.0's data-layer path kept every listed pool with no check of its launch or of L's registration. #336 checks only pools a device doesn't hold ("Pools already held aren't asked about again", #336's PR body).
- On mainnet, 1.6.0's head start bundled no pool. So every token pool a 1.6.0 device holds there came from the data layer or from Koios's holder look. The data layer is the default, and its pools stay unconfirmed for good after the update.
- That's exactly the population #336 was written for.
- The honest data layer applies the same rule from db-sync (`seedelf-data/api/src/lovejoin/db.rs:142-212`). What's left is a server that lied, or db-sync on a fork that was later rolled back, during 1.6.0's life.

**Scenario.** A pool 1.6.0 took whose launch isn't on chain, or whose L was never registered. After the update, 1.7.0 still offers it, and a deposit into it fails, or its boxes can't be mixed.

**Options.** These are the owner's:
- **Accept as is.**
- **Confirm held pools once.** On 1.7.0's first data-layer refresh per network, run `launched()` once over held pools that aren't in the bundled head start, and mark them confirmed in the record. One that fails stays in the read set (STATE-2: the wallet's boxes may be there), but takes no new box, as a copy doesn't. The cost is one `tx_info` batch and at most one `account_update_history`, once.
- **Also re-read the held reference rows from Koios,** in pr336 F1's direction. That would also replace a row like finding 1's with the chain's.

**Confidence:** high that held pools are never confirmed. Low that any is bogus.

## Checked, no finding

- **The tail (`tailHeld` and `offerAt`).** 1.6.0 writes `landed` in the same two places, `witnessTail` and `tailChain`, both through `tailLanded` and on the wallet's clock. So `offerAt = landed + TAIL_OFFER_MS` means "an hour after its deposit was first known in".
  - A chain's `id` is its last transaction's hash (`recordChain`), as `witnessTail`'s `tailIsOver` and `cuts()` key it.
  - Tails are new in 1.6.0, so no older shape exists.
  - Only the way out marks a tail over on a chain still being sent: every other `tailOver` call acts on an ended chain (`tailOf` and `tailChain`, `recordChain`'s `resumes`). So `lj.tail.skipped` can't misfire on 1.6.0 state.
  - Until a run calls `cuts()`, `tailHeld` doesn't, and sees an update-cut chain as still being sent (`tailWaits`). For that moment it can offer the way out for a cut tail past its day. Pressing it marks over what `tailOf` would mark over anyway, so it's harmless and I'm not filing it.
- **The Bootstrap.**
  - Every 1.6.0 private Bootstrap is recorded `mix.noCollateral`. `sessions.ts:2171` is the same at `babb8e76`. The flag came in `fc8561c7` (2026-10-25), before the gate, and 1.5.0 (`63f87b8`) had no Bootstrap session. So the legacy branch (`sessions.ts:4451`) can't be reached from release state, and the PR comment's claim holds.
  - At today's parameters, the priced reserve is the 1.5 ₳ 1.6.0 funded.
  - Neither the deposit nor its sweep reads the reserve. Its only users are `mixFunding`, the legacy check, `privateBootstrapBounds` and `bootstrap_most`.
  - `privateBootstrapMost`'s cache is in memory (`lovejoin.ts:2684`), so the restart drops it.
  - Every caller passes the parameters as an object, so the new `JSON.stringify(params)` never double-encodes them.
- **Parts and `partHashes`.** Session-only. `txView`'s `partOf` reads only session keys (`tx-view.ts:150-162`), which the update clears.
- **The pools' record.** `Stored` and `FoundPool` are unchanged, and `known` is keyed by the reference outpoint, which never moves at the holder.
  - When the token list changes with the update, the head start's height and `listed` behave as in 1.6.0 (STATE-4).
  - `confirmed()` on 1.6.0's records asks Koios only about pools new to the device.
- **Timing and alarms.** The unlock run re-arms the alarm. A tail's day, a part's clock and the sessions' `FAILED_AFTER_MS` all read timestamps 1.6.0 wrote with the same meaning.

## Not checked

- **1.6.0's module wasn't run** (it isn't built, and building the module is off limits). That it verified the doubled row rests on two things:
  - its profile has no overflow checks (`Cargo.toml` at `babb8e76`);
  - u64 wrapping, as x-overflow's reading has it (2^64 − 1 + 2 = 1).
- **Whether any 1.6.0 device holds such a row, or any mainnet token pool exists:** I made no request to Koios or the data layer.
- **Chrome's update timing,** which installs when idle: this is from Chromium's `ShouldDelayExtensionUpdate` as I know it. I didn't test it in a browser.
- **What I didn't run:**
  - the e2e suite;
  - the whole Vitest suite (only my two scratch files ran);
  - pr337's R3 again (the lock-cut branch).

## CLI notes

None from this lens. The CLI keeps no state that the range touches across versions.
