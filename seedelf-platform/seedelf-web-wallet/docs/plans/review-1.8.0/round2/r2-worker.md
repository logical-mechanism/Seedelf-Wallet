# 1.8.0's release review, round two: r2-worker

*Written by the lead from the reviewer's structured output (workflow `wf_af158591-549`); the harness refused the reviewer's own file.*

## r2-worker#0: Stop's dialog (and a swap's Review) counts the 5 ₳ pool's room without the collateral's two draws its return holds, naming a box and its mix fees more than the return makes

**Severity:** low · **Kind:** code · **Introduced:** new · **Lanes:** find, share · **Proven:** test

**Where:**
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1795
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3394
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3454
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3472
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:850
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3643

**Claim:** `priced`'s `fits` is `room.free / draws`, with no hold. The return's chain holds TAIL_DRAWS for the collateral's mix in the same 5 ₳ pool (`holdTail`, `roomIn` → `roomLeavingTail`). Where the room binds, the dialog says one box more, with that box's mixes and mix fees, than the return builds. In the same dialog, share's `tailDrawn` counts the boxes made correctly (`min(cost.boxes, roomLeavingTail(free, draws))`), but only for the collateral's word. So one dialog shows figures from two different counts. stopCost's doc still claims 1.6.0's L1 ("the dialog never names a box more than the return makes"), which 44b's shared pool broke.

**Scenario:** A swap session, a 1.7.2 or a 1.8.0 approval, depth 1, its funding paid the collateral's reserve, 41.5 ₳ + 5 ₳ at its account, and 6 strangers' boxes in v2's 5 ₳ pool. Stop's dialog says at most 3 boxes, 3 mixes, about 2.85 ₳ of mix fees, collateral "mixed". Stop's return builds 2 boxes and 2 mixes, with the collateral's tail. With 5 strangers the dialog says 2 boxes and the return makes 1; with 9 (1.8.0 approval) 4 against 3. The figures stay true as upper bounds ("at most", "about"), and no unshown fee is paid. But the money figure overstates, and the doc's invariant is false.

**Evidence:** Scratch test `tests/r2-worker-flows.test.ts` (found-later's device(), the real WebAssembly), `F-stop` and `flow 2b`: `npx vitest run tests/r2-worker-flows.test.ts -t "flow 2b" --maxWorkers=2 --silent=false` logs, e.g., n=6 `dialog:{boxes:3,mixes:3,mixFees:"2850000",collateralMix:"mixed"}`, `built:{boxes:2,mixes:2,tail:true}`; n=5 `{boxes:2}` against `{boxes:1}`; n=9 (1.8.0) `{boxes:4}` against `{boxes:3}`; n=3 and n=20 agree. `-t "F-stop"` asserts `cost {boxes:3,mixes:3}` and the chain `boxes 2, mixes 2, tail` (passes). Base comparison, pool kept by the page's look (`F-stop-kept`), run against 1beba3fb's sources via `scratchpad/r2-worker-scripts/swap.sh 1beba3fb …`: identical (`dialog boxes 3 / built 2`). So it's 44b's (new in 1.8.0, where the ADA and the collateral first share one pool), and the fix round's tailDrawn put the right count beside it. Known in passing: share's report, For the lead 7 ("priced's own box count … is the find lane's").

**Fix:** Count the hold where the return will take it. In `priced`, where the 5 ₳ pool's room is read and Settings' collateral goes into the pool, `fits` = `roomLeavingTail(room.free, draws)`, as `roomIn` has it. In stopCost, gate it on `takes !== "no"`. Or, in stopCost alone, cap `cost.boxes` at tailDrawn's `made` and recount `mixes`/`mixFees`/`withdrawFees` from it. Then correct stopCost's L1 sentence.

## r2-worker#1: A site's funding review now lists every pool twice: tailReserve's collateralPool read and lovejoinRoomNow's room() read

**Severity:** low · **Kind:** code · **Introduced:** new · **Lanes:** connector, share · **Proven:** test

**Where:**
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1996
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1999
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2052
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4278
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3374

**Claim:** With the collateral switch on (the default), `siteOutBuild` first reads the pools through tailReserve → collateralPool → `split`, which lists every pool. Then O3's `lovejoinRoomNow` → `room()` → `rooms()` → `splitAll` lists every pool again, since `split` never fills `roomsRead`. The same request is made twice in one review: Koios credential_utxos for every pool's mix_box, or the data layer's poolNow and tokensNow. At the base the review made one. The connector's report counts only the switch-off read as new, and says the review now makes fewer requests. A swap's Review has done the same double listing since before 1.8.0 (priced's `room` beside tailReserve's split), so one fix covers both.

**Scenario:** Preprod (Koios alone), the 5 ₳ pool kept, a site asks for a private session and its funding review is built. Koios is asked for the pools twice within milliseconds, where 1beba3fb asked once. The holder isn't read twice (that count is 1), so it's Koios budget, not privacy: the request is the same for everyone.

**Evidence:** `tests/r2-worker-flows.test.ts` `flow 1b` (pool kept by `lookForPools`, then `siteOutBuild`), counting `credential_utxos` calls naming ADA_VIEW.mixBoxHash. Merged: collateral on `reads 2`, off `reads 1`. The same test on 1beba3fb's sources (`swap.sh 1beba3fb src/background/{sessions,lovejoin,lovejoin-pools,dapp}.ts src/shared/rpc.ts`, then restored): on `reads 1`, off `reads 0`. `F-double` asserts 2 (passes). A swap's Review (`flow 2a`): 2 at merged and 2 at base.

**Fix:** Answer the mark from the read tailReserve made when it made one. collateralPool is undefined under the floor or with fewer than two free boxes, and that's short by priced's rule too. So the funding review can mark `room` iff tailReserve's CollateralPool has `free >= mixesPerBox(depth, 3) * 2` (carry `free`, plus `others` if wanted). Call lovejoinRoomNow's own `room()` only where tailReserve read nothing (the switch off). For the swap's Review, have `split` leave its listing in `roomsRead`, or pass priced's read to tailReserve.

## r2-worker#2: The connect card's quiet mark reads the pools where the kept read lapses between collateralPoolTakes and room()

**Severity:** nit · **Kind:** code · **Introduced:** new · **Lanes:** connector, find · **Proven:** test

**Where:**
- seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2075
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3364
- seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1068

**Claim:** `lovejoinRoomKept` (called from `enable()`, where "no read is tied to a site's connect") calls the non-quiet `room(network, ada.id)` after `collateralPoolTakes` said "yes". Each checks POOL_ROOM_MS on its own `now()`. If the 5 minutes run out between the two calls, `rooms()` makes a fresh listing of every pool during the connect. The find lane added `room(network, pool, quiet)` for exactly this, and the connector lane's For the lead suggested it, but the merge didn't use it. tailDrawn has the same pattern, but Stop's dialog may read the pool anyway.

**Scenario:** The pool was read 4 min 59.998 s before a site calls enable(). collateralPoolTakes sees the read inside POOL_ROOM_MS; room() a moment later sees it lapsed and reads Koios (or the data layer) for every pool, tied in time to the site's connect. The window is microseconds in Chrome.

**Evidence:** `tests/r2-worker-flows.test.ts` `F-quiet`: a clock that ticks 1 ms per now() call, started k ms before the kept read lapses, for k = 1..30. Logged `FQUIET [0,0,11,10,…]`: at k=3 the call made one pool listing and returned true (`11`). The test asserts that a read happened (passes).

**Fix:** `await lovejoin.room(network, ada.id, true)` in lovejoinRoomKept: the kept read alone, as its doc says. Also in tailDrawn, where it's meant to ask nobody.

## r2-worker#3: lookSoon's comments say an ask that found no 5 ₳ pool looks; the lead's critic#2 look runs at every Settings press, a pool kept or not

**Severity:** nit · **Kind:** words · **Introduced:** new · **Lanes:** lead, find · **Proven:** test

**Where:**
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:414
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1591
- seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:235
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6873

**Claim:** `bringAllBack` with no pool named calls `lookSoon` whatever is kept: Settings' Bring every box back and its retired Try again. lookSoon's doc ("for a pool read that found no pool it needs (lovejoin.ts adaPool's ask)"), LovejoinDeps.lookSoon's ("where none is kept or listed") and sw.ts's ("where a return, a review or a funding asks for the 5 ₳ pool and none is kept") describe only adaPool's use. The docs writer's draft privacy policy, in the merged worktree, already says it right ("Bring every box back now in Settings looks first, whatever it knows"); the code comments don't.

**Scenario:** The 5 ₳ pool is kept. Past REFRESH_MS, Settings' Bring every box back reads Koios's holder, and so does the retired Try again REFRESH_MS later. Nothing in the comments says so.

**Evidence:** `tests/r2-worker-flows.test.ts` `critic#2's look beside a kept 5 ₳ pool`: page look (1 holder read), then `bringAllBack("preprod")` and, REFRESH_MS on, `bringAllBack("preprod", undefined, true)`. Holder credential_utxos go 1 → 3 (passes, `CRITIC2 1 3`). Read-only grep of the merged worktree's `docs/store/privacy-policy.md:46,93`.

**Fix:** Add Settings' press to the three comments: the look also runs, at most every REFRESH_MS a network, when Bring every box back is asked with no pool named, a pool kept or not.

## r2-worker#4: A swap approved with no 5 ₳ pool known says in its Plan that everything comes back directly, while its return, by O1's look, may find a pool and mix the ADA and the 5 ₳

**Severity:** nit · **Kind:** words · **Introduced:** reachable · **Lanes:** screens, find · **Proven:** reading

**Where:**
- seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1391
- seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1522
- seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:2417
- seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3583

**Claim:** With `skipped` (no pool known at Review), `mixes` is false, so the Plan's step 4 reads `swaps.plan.backDirect`, "The proceeds and everything left, directly", unhedged. No collateral line is shown either, as there's no `collateralMix`. Since O1, the swap's own return asks and looks: a pool launched meanwhile is found and used for the ADA and the collateral (the owner's call). The choice's hedge (`onPoolShort`) and the warn line say "as things are"; the Plan's step doesn't. The same pattern is old for a pool short of room at Review (1.6.0's DX-3); 1.8.0 makes it reachable for no pool at all. This is r2-screens' to weigh; listed because it's the worker's found-later behaviour that makes it false.

**Scenario:** Preprod or mainnet, no 5 ₳ pool anywhere at Review. The approval reads "4 Back in your private balance The proceeds and everything left, directly … Bring it back through Lovejoin Only if Lovejoin's pool has room when it comes back. The wallet knew of no Lovejoin pool …". The pool is launched before the fill, and the runner's return (chain() → adaPool(ask) → lookSoon) mixes.

**Evidence:** `tests/r2-worker-flows.test.ts` `a swap approved with no 5 ₳ pool anywhere` renders SwapApproval from `outBuild`'s summary (`launched: false`). Logged `NOPOOL-APPROVAL {"skipped":"the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it"}` (no collateralMix) and `NOPOOL-WORDS … 4 Back in your private balance The proceeds and everything left, directly … Only if Lovejoin's pool has room when it comes back …`. That a later return finds and mixes is found-later's "found later" tests (site sessions); the swap's return reaches the same `chain()`. Read, not run for a swap.

**Fix:** Where `through && l.skipped`, the Plan's step 4 takes a hedged line, e.g. the plain direct words plus "unless Lovejoin's pool has room by then". Or reuse the choice's hedge there. The screens lane's call; it needs no new worker field.

## Covered

- Flow 1, a site session on preprod, no 5 ₳ pool kept, one at the holder (r2-worker-flows `flow 1`). Holder reads (credential_utxos / tx_info) by step: connect 0/0; funding review 1/1 (tailReserve's collateralPool asks and finds; lovejoinRoomNow finds it kept); next connect 0, its card marked; return's build 0 more; Send 0 more. Preprod asks no list. No double holder read: the e2e lane's "one read" holds on the merged code.
- Flow 1 on mainnet, the funding review and the next card, by mode (`flow 1c`). Koios-only: holder 1/1, list 0. Data layer down: 1/1, 0. Data layer up: 0/0, list 1. Not listed: 0/0, list 1, hedged. Each mode reads once.
- The card against the review on mainnet with the data layer up: the card can stay hedged while the review is marked, where the data layer's crowd count is under the floor and the live room read is over it (collateralPoolTakes' crowd rule). Hedged is never false there.
- Flow 2, a swap's Review with no pool kept (`flow 2c`). The quote as the user types reads nothing. Review: priced's ask looks once (1/1); tailReserve finds the pool kept; 2 pool listings, as at base; the critic#4 marker is recorded (`{depth:1,delay:'1-6',box:'5000000'}`). outSubmit drops `auto.lovejoin` for a direct approval, and pricedClassic is moot there, since throughLovejoin is false and Stop never undoes direct.
- Stop's dialog against its return, both approval kinds, at 3, 5, 6, 7, 9 and 20 strangers (`flow 2b`). The dialog looks once (1/1) and the return reads no holder more. The lead's classic cap: a 1.7.2 record at 20 gives dialog 3 = return 3 (critic#4). tailDrawn's collateral word matches the return's tail in every case (n=3: ifLeft, no tail; otherwise mixed, tail). Only the box count differs (r2-worker#0).
- O5 beside holdTail and P2. chain()'s no-pool AcrossCall carries no collateralPool or holdTail. That's consistent: collateralPool and chain() read the same kept set, and the set only grows, so `way.collateralPool` implies `into`. The token legs reserve in acrossOf's attempt. P2's reservation is only on the direct branch, after `release`. sendChain's `start` replaces it under the same owner.
- P2's rebuild with fewer than two free boxes left (r2-worker-share `P2's rebuild`): with 2 strangers it builds again with 1 box and no tail; with 3, with 2 and the tail. No refusal. The loop is bounded by STALE_POOL_TRIES.
- The tailChain sibling of P2 (open, judged). Same class: buildCollateralMix draws at build and is reserved only at Send. Reachable only through Bring everything back over a session whose chain was cut between its collateral's deposit and mix, plus another chain into the same pool within BUILT_TTL_MS. The outcome is one Send refused (lj.stalePool), mended by reviewing again. No money is at risk, and restored sessions never take this path (not started). Worth P2's pattern when convenient, not a gate for 1.8.0.
- critic#4's cap beside O5, P1 and across pools. No ADA leg to cap in O5. P1's hold is for Mix again, never a swap. A 1.7.2 approval names only 8131b1d pools, retired, so acrossOf's uncapped ADA leg isn't reachable on chain (the chain lane's item 5). priced's `tens`/`approved` match chain()'s classic plan at each width.
- retireOnce and Bring every box back, what each press asks. Settings with nothing going: look, then every pool's run. Settings while the retired run or a pool's run goes: look, then widen to every pool's. Settings' Try again on the retired run stopped: `{retired:true}` → look → a new retired run, covering the read's retired pools. Try again on every pool's: look, then every pool's run. A pool's page: no look, that pool's run. The first unlock: retireOnce, no look, the retired run. The run covers `ours`' read set, which includes a pool the look just found (found-later's critic#2 tests). R1's widen, R3's undecided deferral and R4's refusal while a v2 pool's run goes were traced; the refusal is reachable only from a stale Settings page, since one bringing slot can't hold both.
- Connector agreement, card/review/return, by state. No pool: hedged/hedged/direct noAdaPool. Found at Review: hedged (before the review)/marked/mixes. Under the floor: hedged/hedged/direct with the floor's words. Too few free for a box but enough for the collateral: hedged/hedged, collateralMix ifLeft/direct with the collateral mixed. Failed read: hedged (maybe)/hedged (may)/read again. lovejoinRoomNow restates priced's skipped rule, plus usable; lovejoinRoomKept is collateralPoolTakes' yes plus poolShort. Every hedge reads true in every state.
- Traps. Every new `.catch(unlessTrap(...))` hands a trap on: adaPool's lookSoon, bringAllBack's lookSoon, chains()'s readSet. lovejoinRoomNow and lovejoinRoomKept rethrow. A trap inside room()'s pool read is swallowed by rooms()'s old bare catch, but lovejoinOwned runs under wallet.withKeys, whose serial locks the wallet on a trap (scratch `F-trap`: siteOutBuild and backBuild reject "locked"), so nothing is built on. enable()'s trap goes through the dApp service's trapped() → lock.
- Sums of outside values in the diff. `perFive`, `tens`/`tenPer`/`approved`, stopCost's `cancelled` (old) and buildBack's fee sum (old) are bigint. roomLeavingTail, mixFunding's draws, tailReserve's `free − count` and tailDrawn are small counts. Every division is guarded: depth 0 never reaches a divisor (fanOut's perBox guard, tailDrawn's `draws < 1`). No new u64 or Number sum of rows' values.
- lookSoon's throttle, sharing and failure. `scanned` is set as a scan starts, the page's look and a launch's look included. A look under way is joined. A failed look counts. Refresh is shared. answeredWithin keeps a holder read away while the data layer answered lately. found-later's 37 tests pass in the sandbox.
- The lanes' files at the merge pass in my sandbox: lovejoin-share-review-fixes, lovejoin-chain-review-fixes, connector-lovejoin-review-fixes and lovejoin-retire-review-fixes, 83 tests (`npx vitest run … --maxWorkers=2`). `npx tsc --noEmit -p .` is clean but for my scratch file's unused imports.
- dapp.ts enable(): lovejoinRoomKept is awaited before `asking` is computed, so "nothing is awaited from here until it's asked" holds. handlers.ts passes `retired` only as `=== true`. sw.ts spreads serviceDeps, lookSoon included. lovejoin-launch.ts: V1's `version: 'v2'` survives the schedule's sanitizer (launches are filtered whole).

## Not checked

- Whole returns on mainnet (sessions addressed on mainnet): counted at the funding review and adaPool level only.
- A swap's Review with a v2 token pool for the swap's own token (the token pools' cost leg beside priced's ask): my harness has no v2 MIN pool wired. Read only: tokenPool's poolsOf/rooms ask no holder, so the holder count can't rise.
- That a swap's own return, approved with no pool, later mixes once the pool is found (r2-worker#4's second half). Read through chain(), and run for site sessions only (found-later).
- Playwright and e2e of any of these flows, the mainnet "found later" e2e included.
- BringAllBack.tsx's bringAsk/retired wiring and every UI string: r2-screens. The privacy policy beyond the look's scope (the docs writer's draft, read read-only, covers it): r2-critic.
- Real Chrome timing of Date.now across await boundaries (r2-worker#2's window is shown with a ticking test clock).
- Storage-failure paths beyond R3's: a run's end over a read set that fell back to `handed`, which may end "Done" over the classic pool alone. Seen, not traced to a finding.
- Mutation checks of the lanes' guards (r2-tests' lens).
- The data layer's Rust, and rpc.ts beyond the shapes the worker uses.
