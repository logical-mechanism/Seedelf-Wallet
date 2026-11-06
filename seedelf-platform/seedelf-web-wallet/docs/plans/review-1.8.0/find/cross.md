# 1.8.0 release review: cross

Lens: where 44a and 44b meet the rest of the wallet, and the upgrade from 1.7.2. Read at `a6c94743` in the sandbox worktree, with 1.7.2's code through `git show 6b70c1f8:<path>`. Every finding below was proved in the sandbox, by a scratch test, a mutation, or both, except cross#8, which rests on a trace. The scratch tests are in the sandbox's `extension/tests/cross-scratch-*.test.ts`. They run from `<sandbox>/seedelf-platform/seedelf-web-wallet/extension` with `npx vitest run tests/<file> --maxWorkers=2` (add `--silent=false --reporter=verbose` to see their logs).

Paths are from the repository root. `lovejoin.ts` is `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts`, and `sessions.ts` sits beside it.

## Findings

### cross#0 · Low · code · new: 1.8.0's first run waits up to a day on a collateral mix that can never be built in a retired pool

- **Where:**
  - `lovejoin.ts:6348` (retireOnce runs before anything marks cut chains)
  - `lovejoin.ts:4086` (`tails` needs `c.ended`)
  - `lovejoin.ts:1400-1405` (`tailBoxes`)
  - `lovejoin.ts:1385-1392` (`tailBuildable`)
  - `lovejoin.ts:6811-6834` (the run leaves the box and says `waiting: "collateral"`)
  - `lovejoin.ts:6351` (every scheduled withdraw waits behind the run)
- **Claim:**
  - `withdrawDueNow` calls `retireOnce` before any `cuts`. A 1.7.2 chain that the update (or a lock or a closed browser, with no 1.7.2 unlock since) cut while its collateral's mix waited still has `ended` unset, so `retireOnce`'s `tails` misses it: the tail isn't marked `over`.
  - Then `chainsMixing` calls `cuts` inside the retired pools' run, and the tail reads as `tailBuildable`.
  - `tailBoxes` leaves its box to a mix that `tailChain` would refuse in a retired pool. The retired run then waits on it with "What's left is a session's 5 ₳ collateral: it waits for its mix, a day at most."
  - While the run goes, `withdrawDueNow` returns into it, so no scheduled withdraw runs, not even a v2 pool's.
- **Scenario:**
  - On 1.7.2, a site's private session's return chain (deposit, mixes into the classic pool, then its collateral's deposit into 8131b1d's 5 ₳ pool) waits for giveme.my's signature on the collateral's mix. The wallet locks or the browser closes, Chrome applies 1.8.0, and the user unlocks within a day of that deposit landing.
  - The first run brings the classic box back and marks `retired`. The tail is not `over`. The next runs report `waiting: "collateral"`.
  - A box the user mixes into v2's 5 ₳ pool on 1.8.0 comes due and doesn't come back. Neither does anything else, until TAIL_KEEP_MS from the tail's landing (a day), until the user presses Stop, or until that session's return is built (`tailChain` then ends the tail).
  - A read that runs `cuts` first, as Home's `held()` does for the network on screen, can win the race at unlock. The network not on screen always gets this order.
- **Evidence:** `tests/cross-scratch-retire.test.ts`, test "D". The record holds a chain with no `ended`, `sent = total - 2`, its tail in 1.7's bundled 5 ₳ pool `18c4df77…` (`tail.landed` 10 minutes ago), and the tail's box listed there.
  - The first `withdrawDue(unlock)` gives `retired` set and `bringing {retired, back: 1}`, with the chain's tail not `over`.
  - The next run gives `bringing {…, left: 1, waiting: "collateral"}`, and the tail box is not withdrawn.
  - A v2 5 ₳ box of the wallet's, due since the start, is still not withdrawn after ten more runs over five hours: `v2Due {"due":[1800000000000]}`, still `waiting: "collateral"`.
  - Command: `npx vitest run tests/cross-scratch-retire.test.ts -t "D:" --maxWorkers=2`. Result: passes, with the assertions above.
- **Fix:** call `await this.cuts(network)` at the top of `retireOnce` (no request), or drop `c.ended` from `tails`: no chain built on 1.8.0 has a tail in a retired pool. Also have `tailBoxes`/`tailBuildable` skip a tail whose pool is retired, so no wait is ever kept for a mix that can't be built.

### cross#1 · Low · test · new: untested guards: nothing in the suite catches a mix in a retired pool for a 1.7 session

- **Where:**
  - `lovejoin.ts:4193-4196` (`tailChain`'s `isRetired(pool)` → `tailOver`)
  - `lovejoin.ts:3523` (`chain()`'s `|| isRetired(into)`, for mixing again)
- **Claim:** each guard alone keeps a 1.7.2 session from mixing in a retired pool, and the suite passes with either one removed.
  - `tailChain`'s guard is the only one for a tail that `retireOnce` didn't end (cross#0).
  - `chain()`'s guard is the only one for a 1.7 "Mix my boxes again" session, since `againBuild` checks only new fundings.
- **Scenario:**
  - First guard removed: a 1.7 session's tail in 8131b1d's 5 ₳ pool is built again: a collateral's mix in a retired pool.
  - Second guard removed: a 1.7 `mix: { again: true }` session funded for the classic pool builds a mix-again chain there (4 mixes, 7 transactions).
- **Evidence:**
  - Mutation 1 (delete the `if (isRetired(pool)) { await this.tailOver(…); return undefined; }` block in `tailChain`):
    - `npx vitest run tests/lovejoin-retired.test.ts tests/lovejoin-planner.test.ts tests/lovejoin-bring-review-fixes.test.ts tests/lovejoin.test.ts tests/session-collateral.test.ts tests/collateral-reserve-review-fixes.test.ts --maxWorkers=2`: 6 files, 253 tests pass.
    - 14 more files (`chain-entry`, `chain-requests`, `lovejoin-stopped-shown`, `lovejoin-stopped-before`, `lovejoin-crediting-review-fixes`, `collateral-held`, `sessions`, `restore-scan-lovejoin`, `swap-runner`, `payment-parts-chain`, `lovejoin-form-review-fixes`, `lovejoin-1-5-0`, `lovejoin-merged-review`, `lovejoin-release-rules`): 235 tests pass.
    - The scratch test "tailChain's own retired check (mutation target)" fails under it: `tailChain` returns a chain where it returns `undefined` at `a6c94743`.
  - Mutation 2 (`if (!again || isRetired(into))` → `if (!again)`):
    - `npx vitest run tests/lovejoin-retired.test.ts tests/lovejoin-planner.test.ts tests/lovejoin.test.ts tests/lovejoin-restore.test.ts tests/return-plan.test.ts tests/sessions.test.ts tests/lovejoin-merged-review.test.ts tests/lovejoin-release-rules.test.ts tests/lovejoin-accounts.test.ts --maxWorkers=2`: 9 files, 373 tests pass.
    - The scratch test "chain()'s retired check for mixing again (mutation target)" fails under it: the review has `lovejoin: {boxes: 1, depth: 2, mixes: 4, txs: 7, again: true}`, where `a6c94743` gives `lovejoinSkipped` = `lj.unusable.warn.retired`.
  - A third upgrade rule is tested: sessions.ts:4497's `record.mix.pool ?? CLASSIC` mutated to `record?.mix?.pool` fails `lovejoin-retired`'s "comes back directly from a 1.7 mix session into the classic pool".
- **Fix:** add the two scratch tests (or their equivalents) to `lovejoin-retired.test.ts`.

### cross#2 · Low · test · new: untested rule: a Bring every box back that 1.7.2 stopped is asked afresh as the retired pools' run

- **Where:** `lovejoin.ts:4096` (`if (!s.bringing || s.bringing.stopped)`).
- **Claim:** the `|| s.bringing.stopped` half of the rule is what asks the retired pools' run over a 1.7.2 run that stopped after its failed runs. No test catches its removal.
- **Scenario:** with it removed, a wallet whose 1.7.2 bring-back stopped (`stopped: true` kept) gets `retired` marked and no run asked. The retired pools' boxes wait their own times, and Settings keeps showing the old Stopped callout.
- **Evidence:**
  - Mutation: `if (!s.bringing || s.bringing.stopped)` → `if (!s.bringing)`. Command: `npx vitest run tests/lovejoin-retired.test.ts tests/lovejoin-bring-all-back.test.ts tests/lovejoin-bring-review-fixes.test.ts tests/lovejoin-bring-screen-review-fixes.test.ts --maxWorkers=2`. Result: 4 files, 66 tests pass.
  - The scratch test "retireOnce over a run 1.7.2 stopped (mutation target)" passes at `a6c94743`, with `bringing {retired: true, back: 1}` and the classic box withdrawn.
  - Under the mutation the same test fails: `bringing` is still the old `{…, stopped: true}` and nothing is withdrawn.
- **Fix:** add that test to `lovejoin-retired.test.ts`.

### cross#3 · Low · code · new: one pool's Bring every box back still going at the update means the retired pools' run is never asked

- **Where:**
  - `lovejoin.ts:4092-4100` (retireOnce keeps a going run, then marks `retired`)
  - `lovejoin.ts:4083` (`retired` set: never again)
  - `lovejoin.ts:6792` (a pool's run covers that pool alone)
- **Claim:**
  - The owner's call 3 is that the retired pools' boxes come back right away at the first unlock.
  - `retireOnce` keeps a run that still goes ("one the user asked that still goes stays as it is"). If that run was one pool's page's, it covers that pool alone.
  - `retireOnce` marks `retired` all the same, so the retired pools' run is never asked. When the pool's run ends, every other retired pool's boxes wait their own due times, 1–6 h.
- **Scenario:**
  - On 1.7.2 the user presses "Bring every box in this pool back now" on 8131b1d's token pool, then closes the browser before it ends. 1.8.0 is applied.
  - The first run continues that pool's run and marks `retired`. The wallet's classic-pool box isn't brought back. When the token pool's run is over, the classic box still has its due time 3.5 h away, and no run is asked.
  - The suite's own "from a pool's page brings back that pool's boxes alone: the other pools' keep their waits" (`tests/lovejoin-bring-all-back.test.ts:275-294`) runs this state, both pools retired and no `retiredAlready`, and asserts that the classic box keeps its wait.
- **Evidence:** `tests/cross-scratch-retire.test.ts`, test "A":
  - after the first run: `{"retired":1800000000000,"bringing":{…,"pool":"c5852bb7…","left":0},"due":[1800012600000]}`
  - after its run: `{"retired":1800000000000,"due":[1800012600000],"withdrawn":["f1f1…#0"]}`, the classic box `c1c1…#0` not withdrawn, `bringing` gone
  - Command: `npx vitest run tests/cross-scratch-retire.test.ts -t "A:" --maxWorkers=2`. Result: passes.
- **Fix:** in `retireOnce`, when the going run is a retired pool's (`s.bringing.pool !== undefined && old(s.bringing.pool)`), widen it to the retired pools' run (`delete s.bringing.pool; s.bringing.retired = true`). An every-pool run already covers them.

### cross#4 · Low · code · new: an unreadable discovery list makes a v2 pool read as retired, and its Bootstraps and collateral mixes are let go for good

- **Where:**
  - `lovejoin.ts:4067-4071` (`retiredIds`: every id not in the quiet read set is retired)
  - `lovejoin.ts:2763-2769` (`readSet` falls back to `handed`, empty on a worker that has handed nothing over since it started)
  - `lovejoin.ts:4092-4094` (Bootstraps released and tails ended)
- **Claim:**
  - `retireOnce` runs at every run until it marks the record, which never happens for a wallet that had nothing in a retired pool.
  - It decides retirement from `readSet(network, true)`. When discovery's `known` fails, that set holds the classic pool alone, plus sealed copies.
  - Every v2 pool the records name then reads as retired. `retireOnce` marks `retired` and releases every Bootstrap there (`released: true`). It ends every collateral tail there (`over`), so that box comes back unmixed, tied to its session.
  - It asks a retired run that, from the real read, covers nothing. None of this is undone.
- **Scenario:**
  - A wallet new on 1.8.0 Bootstraps two boxes into v2's 5 ₳ pool. Later, on a worker Chrome just restarted, `discovery.known` throws (a chrome.storage read or write failing).
  - The run marks `retired` and releases the Bootstrap. Its boxes then come back by themselves, against the user's Bootstrap.
- **Evidence:** `tests/cross-scratch-retire.test.ts`, test "B": a run whose `known` answers leaves `retired` unset. On a fresh `LovejoinService` whose `known` throws, `withdrawDue` gives `{"retired":1800000000000,"mixes":[{…,"bootstrap":true,"shares":[{"pool":"0eedc4eb…","boxes":2}],"found":true,"released":true}]}`. Command: `npx vitest run tests/cross-scratch-retire.test.ts -t "B:" --maxWorkers=2`. Result: passes. The trigger is a storage failure, so it's rare.
- **Fix:** decide nothing on a read that fell back: skip the run (it runs again at the next) when discovery couldn't answer. Or take an id as retired only when the read set has the pool and `isRetired` says so, leaving one missing from it undecided.

### cross#5 · Low · code · reachable: Bring everything back over found sessions draws a direct return's collateral boxes twice, and one Send is refused

- **Where:**
  - `sessions.ts:4585` (a direct return's collateral mix draws from `intoPool.rows`; nothing is reserved until Send)
  - `sessions.ts:3175-3185` (`claimBuildNow` builds each return, then Send sends them all)
  - `lovejoin.ts:3681` (a chain reserves at build)
  - `lovejoin.ts:4343-4352` (`reserve` refuses inputs another owner holds)
- **Claim:**
  - A session's return that comes back directly, its 5 ₳ collateral mixed into the 5 ₳ pool, draws two of that pool's boxes, reserved only when it's sent (`sendChain`).
  - Since chunk 44, a return's chain draws from the same 5 ₳ pool: in a small pool, nearly every box. A chain return built after it in the same claim draws those two again, kept for Send with its reservation.
  - At Send the direct return is refused as `lj.stalePool`, "Lovejoin's pool changed while the wallet read it.", and has to be pressed again. By then the chain holds the boxes, so its collateral comes back unmixed.
  - On 1.7.2 only two collateral mixes could collide (2 + 2 draws). Chains went into the classic pool.
- **Scenario:** after a restore, Bring everything back takes found sessions 0 (3 ₳ spare and its 5 ₳: no box, collateral mixed) and 1 (40 ₳ and its 5 ₳: a chain), with 14 strangers' boxes in v2's 5 ₳ pool. Session 0's mix draws 2 and session 1 draws all 14: the same 2 twice. Send sends session 1 and fails session 0.
- **Evidence:** `tests/cross-scratch-claim.test.ts`: `DRAWN [{"index":0,"n":2},{"index":1,"n":14}]`, `DRAWN BY BOTH 2`, then `claimSubmit`: `{"sent":[{"index":1,…}],"failed":[{"index":0,"error":"Lovejoin's pool changed while the wallet read it."}]}`. Command: `npx vitest run tests/cross-scratch-claim.test.ts --maxWorkers=2`. Result: fails with `expected 14 to be 16`. A page's review kept for Send, while the runner sends another session's chain, meets the same refusal.
- **Fix:** reserve a direct return's collateral mix when it's built, as `fanOut` reserves a chain (`lovejoin.reserve(network, chainOwner(index), txs, now + BUILT_TTL_MS)`). Or have `claimBuildNow` pass each built return's draws to the next build to avoid.

### cross#6 · Low · code · new: with no v2 5 ₳ pool shown, a return's tokens skip their own v2 token pools

- **Where:**
  - `lovejoin.ts:3516-3517` (`chain()` throws `noAdaPool` before `acrossOf`)
  - compare `lovejoin.ts:3812-3817` (under the ADA pool's floor the tokens still go)
- **Claim:**
  - `chain()` refuses the whole return when no 5 ₳ pool is shown, before `acrossOf` looks at the tokens. A token that holds a box's worth for a shown, usable v2 token pool comes back directly with everything else.
  - Under the 5 ₳ pool's floor, `acrossOf` sends the tokens and brings the ADA back: the two states disagree.
  - A swap's approval in this state still funds the token's boxes and says the token goes into its pool.
- **Scenario:** a site session holds 2 boxes' worth of LJTEST, 40 ₳ and its 5 ₳. Lovejoin reads v2's LJTEST pool but no v2 5 ₳ pool. The review gives `lovejoinSkipped` = "Lovejoin has no pool of 5 ₳ boxes to take it yet", and no ways. With the 5 ₳ pool there too, the token's way has 2 boxes.
- **Evidence:** `tests/cross-scratch-token.test.ts`, using `wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json`:
  - `WITH ADA POOL {"ways":[{…,"pool":"c5852bb7…","boxes":2,…}],"boxes":7}`
  - `NO ADA POOL {"skipped":"Lovejoin has no pool of 5 ₳ boxes to take it yet"}`
  - Command: `npx vitest run tests/cross-scratch-token.test.ts --maxWorkers=2`. Result: passes. It needs a v2 token pool shown where no v2 5 ₳ pool is, which 44c's head start makes rare.
- **Fix:** when no ADA pool is shown, let `acrossOf` run with no ADA leg, or one that takes nothing, as `adaShort` does. Throw `noAdaPool` only when no token goes either.

### cross#7 · Low · words · new: a swap's review still calls its Lovejoin boxes 10 ₳ boxes

- **Where:**
  - `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:2272` (`swaps.cost.boxesLabel`, "Boxes of 10 ₳")
  - `en.json:2262-2265` (`swaps.boxes.atMost_*`, `swaps.boxes.roomFor_*`, "box(es) of 10 ₳")
  - the same keys in `es.json` and `ja.json`
  - `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1650-1655,1679,1632-1638,2898`
- **Claim:**
  - Since chunk 44 a swap's spare ADA, and an ADA swap's proceeds, go into v2's 5 ₳ pool, and sessions.ts `priced` counts 5 ₳ boxes.
  - The swap review's cost row is labelled "Boxes of 10 ₳". Its "if you stop it" note and Stop's dialog (`swaps.stop.throughCost`) say "at most N boxes of 10 ₳": twice the ADA the boxes hold.
  - The plan says the 10 ₳ words moved to 5 ₳. These were missed.
- **Evidence:**
  - `tests/cross-scratch-swap-words.test.ts` renders `LovejoinCost` and `LovejoinChoice`: "On the way back, through Lovejoin Boxes of 10 ₳ About 6, at most …" and "If you stop it or the order is refunded, its 60 ₳ come back through Lovejoin instead: at most 8 boxes of 10 ₳, …".
  - Command: `npx vitest run tests/cross-scratch-swap-words.test.ts --maxWorkers=2`. Result: passes.
- **Fix:** name the ADA pool's box value (5 ₳, or the pool's from its values) in those keys in all three languages, and in `boxesText`'s comment.

### cross#8 · Low · words · reachable: the connector's approval promises mixing even with the 5 ₳ pool under the floor

- **Where:**
  - `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:533` (`lovejoinBack = prefs.lovejoinReturns && lovejoinOn(network)`)
  - `DappApprovals.tsx:478,488,921`
  - `en.json:348-349,468` (`dappUi.back.privacy.noteLovejoin`, `…noteLovejoinMixed`, `dappUi.private.privacy.staysLovejoin`, all critical)
- **Claim:**
  - The private session's approval and its funding review say spare ADA "is mixed through Lovejoin … back in 5 ₳ boxes hours later", on Settings' switch alone. They never ask whether the 5 ₳ pool holds the floor.
  - On mainnet, v2's 5 ₳ pool starts empty. Until it holds 30 others, every site session's return comes back directly: `fanOut`'s floor throws `LovejoinSkipped` (`lovejoin.ts:3604-3605`), and `collateralPool` refuses the collateral (`lovejoin.ts:4123`).
  - A swap's approval reads the pool at Review and hedges (`swaps.lovejoin.privacy.onPoolShort`, `swaps.lovejoin.warn.pool`). The connector's doesn't.
  - The plan records the no-pool-known case for 44c, but not the floor's.
- **Scenario:** 1.8.0 is out on mainnet while v2's 5 ₳ pool holds fewer than 30 boxes that aren't the user's. A user connects a dApp privately and is told the spare ADA will be mixed. Bringing it back, the return's review says "Lovejoin is left out of this return: Right now Lovejoin's pool holds N boxes that aren't yours, under the 30 it needs".
- **Evidence:** trace only. Preprod's floor is 0, so a unit test can't reach it. The return's own review tells the truth before anything is sent. If the owner's 44c Bootstrap fills the pool past 30 before the release, the window closes, and it reopens whenever the others there drop under 30.
- **Fix:** have the connector's approval read the 5 ₳ pool as a swap's Review does (`collateralPoolTakes`, or `room`), and hedge ("only if Lovejoin's pool has room when it comes back") when it's under the floor or none is shown.

### cross#9 · Low · words · new: after the retired pools' run stops, Settings' Try again asks every pool's run

- **Where:**
  - `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:353,377,196-197` (Try again sends no pool)
  - `lovejoin.ts:6695-6706` (a stopped run is replaced by every pool's)
  - `en.json:1987` (`settings.lovejoin.warn.bringStopped`, critical)
- **Claim:**
  - When the retired pools' run stops after its failed runs, Settings shows "Stopped: … Press Try again to bring back the rest."
  - Try again sends `lovejoin-bring-all-back` with no pool, so the worker asks every pool's run. The user's v2 boxes come back back to back too, mixed as they are, besides "the rest" of the retired pools.
  - The note above the button ("Every box in every pool, without the waits.") and the question say every pool, so the user is told, but the critical callout says less than the button does.
- **Evidence:** `tests/cross-scratch-retire.test.ts`, test "Try again". A stopped `{retired: true, stopped: true}` run, then `bringAllBack("preprod")` (Settings' press), gives `TRY AGAIN {"at":…,"back":0}` (no `retired`). The next run withdraws `["c1c1…#0","f6f6…#0"]`: the v2 5 ₳ box too. Command: `npx vitest run tests/cross-scratch-retire.test.ts -t "Try again" --maxWorkers=2`. Result: passes.
- **Fix:** when the stopped run was the retired pools', have Try again ask that run again (a `retired` flag on the request). Or show Settings' own button label there, not Try again.

## Covered

What I checked and found sound:

- **The first unlock's order.** It's `runs.ts`'s `runAll` (markCut; steps that send nothing in the unlock run), then `pumpPublic` (nothing left to pump: session storage, and every progress and reservation in it, goes with the update), then `pending`, `parts`, and finally `withdrawDue`: `dropRefused`, `retireOnce`, the retired run (which sends even in the unlock run, as accepted).
  - Nothing builds into a retired pool before or after `retireOnce` marks the record. Every build guard reads the pool's `isRetired` from the read set, not the mark: `chain()` (`takesNewBoxes`, and `|| isRetired` for again), `publicBuild`, `publicAgainBuild`, `fits`, `againBoxes`, `privateBootstrapMost`, `tailChain`, `collateralPool` and `adaPool` (v2 alone), `poolsOf`, `usable`, and the launch (v2 alone).
  - The withdraws are serialised (`inTurn withdraw.<network>` for the run, the scheduled ones and Bring one back). The retired run waits for chains (after `cuts`), mixing again, a maybe-sent withdraw and a maybe-sent payment.
- **In flight from 1.7.2, each with every box back and nothing spent twice:**
  - a chain part-sent (cut): its boxes are free in a retired pool, and `cuts`' unschedule is made good by `scheduleFound`
  - a held Bootstrap (released, counted back against its entry) and a seed (no longer held)
  - a public mix cut or maybe-sent (`publicUnsettled` unchanged)
  - a mix or mix-again session funded for the classic pool (`?? CLASSIC`, refused, back directly; scratch "mixing again")
  - a 1.7 swap approved into an 8131b1d token pool (its token comes back directly, its ADA into the 5 ₳ pool)
  - Bring every box back running for every pool (kept), stopped by Stop (asked afresh, `bringStopped` dropped), or stopped after failures (asked afresh; see cross#2)
  - boxes not mixed yet, which come back with no "anyway" in a retired pool, as the owner's 2026-11-06 call says
  - scheduled withdraws: the retired run supersedes them, its end resets the retired pools' due times, and v2's keep theirs
  - records with no `version`: discovery's 1.7.2 pools key as `tokenV1`, and a session's `mix.pool` absent names the classic pool
  - a kept-for-Send review from 1.7.2 can't survive the update, since session storage goes with it
- **Several accounts:** public Bootstraps from any account are released and come back into the private balance, with their history's ties, by the owner's calls 3 and 2026-11-06.
- **Restore and Remove wallet:** after a restore, `retireOnce` fires once a pool read gives the found boxes due times. Remove wallet and the same phrase restored behave the same way.
- **Once a network:** `runs.ts` runs `withdrawDue` for every network the build has, and `VITE_ENABLE_MAINNET=false` runs `lovejoin-retired` and my scratch file green (19 tests).
- **The lock:** `retireOnce`'s write fails while locked and runs again at the next unlock; the run stops on a lock and resumes at the next unlock.
- **A swap's price and return:**
  - With no 5 ₳ pool: 0 boxes, `noAdaPool`, Review's warning, the return direct.
  - Under the floor: Review's `poolShort`; the return direct; the collateral back with the rest; tokens still go (`adaShort`).
  - Over the floor: `most` is 64 a deposit, as `fanOut` holds it. `collateralPoolTakes` and `collateralWanted` read v2's pool.
- **The public account's mix:** none shown (the classic pool is refused), under the floor (refused, Bootstrap suggested; Bootstrap has no floor), over it (fine).
- **The connector's return:** under the floor and with none shown it comes back directly, saying why (see cross#8 for the approval's words).
- **Privacy:**
  - The retired run covers retired pools alone (`covered`). It never touches v2 boxes, but see cross#4 and cross#9.
  - Each withdraw is one box. A stuck token box is paid from the private balance, which the 1.6.0 question already says; no such retired pool is bundled.
  - Its withdraws skip the quiet after the wallet's own sends, which is 1.6.0's Bring every box back design, adopted by call 3.
  - `adaPool`'s `ask` is `discovery.refresh`: the same `lovejoin/pools` list every wallet asks, throttled, at a return's build, where a split already asked it for any chain. It's new only for a return paying for no box with no 5 ₳ pool known, and wallet-specific in nothing. No Koios holder scan.
  - No retired-pool path moved from the data layer to Koios: the classic pool still comes from the private index, and 8131b1d pools from the combined feed. Origin lookups for retired pools are skipped in the scheduled withdraw.
- **Mutations caught by the suite:**
  - `retireOnce`'s `released` and its tails' `over` (lovejoin-retired, "lets go of a Bootstrap's hold…")
  - sessions' `?? CLASSIC`
- **The UI's buttons in the states 1.8.0 makes reachable:**
  - A retired pool with boxes: Bring one back, the pool's Bring every box back, joining the retired run; Mix, Mix again and Bootstrap off, with the reason.
  - A released Bootstrap: its boxes come back by themselves.
  - A tail ended: a plain return.
  - The retired run going: Stop, Settings widens; a v2 page is refused.
  - The retired run stopped: Try again (cross#9), and every box still comes back by itself.
  - No 5 ₳ pool: "No pool to mix in yet", launch allowed.
  - The floor not reached: Bootstrap.

## Not checked

- The data layer's copy, the WebAssembly and core changes of #363, the shown-rule vectors, the e2e, and es/ja wording beyond the keys named in cross#7: other lenses'.
- Whether giveme.my or a node at the update's moment can leave a 1.7.2 withdraw sent and unrecorded beyond what `settleWithdrawing` already looks for.
- A live preprod or mainnet run of the first unlock (no network in this review).
- The pass that would compare each worker reason saved with a session (`sess.skip.warn.noAdaPool`: "Lovejoin has no pool of 5 ₳ boxes to take it yet") in the later past-tense frame: left to the words lens. I noticed that it reads as still true after a pool exists.
- The connector's floor case on mainnet in a unit test (preprod's floor is 0): cross#8 rests on the trace.
