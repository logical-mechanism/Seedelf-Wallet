# tests-e2e: the end-to-end tests and the fixtures (1.8.0's release review)

Reviewer: tests-e2e. Tree: `a6c94743`, sandbox `…/scratchpad/wt/tests-e2e`. Every command below ran there, from `seedelf-platform/seedelf-web-wallet/extension` unless it says otherwise. The sandbox was put back to `a6c94743` after each mutation and simulation (`git status` clean), and `dist/` rebuilt from it.

Scratch files, all in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/tests-e2e-scripts/`:
- `tests-e2e-44c-sim.py`: writes a 44c-like head start into the sandbox: a second v2 5 ₳ ADA pool, bundled on preprod at block 5378705 (preprod's real v2 pool's block), height 5380000. It uses the v2 token fixture's seed (index 2), whose scripts v2 derives from the seed alone, under an ADA pool's datum. `lovejoin-pools-head-start.test.ts` verifies it as a genuine v2 pool (2 passed).
- `tests-e2e-44c-sim-mainnet.py`: the same pool at mainnet's holder, bundled on mainnet too (also verifies).
- `tests-e2e-44c-spec.py`: the e2e as 44c would have it: on a network whose head start bundles a v2 5 ₳ pool, the boxes go to that pool's mix_box, with no holder rows, no launch route and no look.
- `tests-e2e-nopool-scratch.py` and `.ts.txt`: a scratch e2e in the connect test's own world, with no 5 ₳ pool known.

### tests-e2e#0

- **Title:** The connector promises spare ADA is mixed in 5 ₳ boxes whether or not any pool can take it, and the e2e pins the promise in a world where no pool can.
- **Severity:** medium. **Kind:** words. **Introduced:** new. **Proven:** test (no pool known), trace (the floor).
- **Where:**
  - `extension/src/ui/screens/DappApprovals.tsx:533`: `lovejoinBack = prefs.lovejoinReturns && lovejoinOn(network)`.
  - `DappApprovals.tsx:921`: `dappUi.private.privacy.staysLovejoin`, critical.
  - `DappApprovals.tsx:478` and `:487-488`: "Through Lovejoin first" and `dappUi.back.privacy.noteLovejoin`, critical.
  - `extension/src/i18n/translations/en.json:468` and `:348`.
  - `extension/src/background/lovejoin.ts:3516-3517`: no pool gives `sess.skip.warn.noAdaPool`.
  - `lovejoin.ts:3604-3605`: under the floor gives `lj.skip.warn.floorShort`.
  - `extension/e2e/extension.spec.ts:5103-5105` and `:5121`.
- **Claim:**
  - The window and its review say spare ADA "is mixed through Lovejoin so it's harder to tie to this session … a 5 ₳ box". It turns on Settings' preference and whether the network has Lovejoin, nothing more.
  - Since chunk 44 only a v2 5 ₳ pool at or over the floor takes that ADA (call 4). Wherever there's none, the return comes back directly.
  - That happens on preprod for every wallet that hasn't opened Lovejoin's page, the half 44c's bundling is planned to fix. It also happens on mainnet from the pool's launch until it holds 30 other boxes, which bundling doesn't fix: the pool is known then, but under its floor.
  - The connect e2e asserts both promises with no 5 ₳ pool in its world.
- **Scenario:**
  - Mainnet on 1.8.0. The owner's v2 5 ₳ pool is launched and bundled but holds under 30 other boxes, the state the e2e's own floor test shows ("Being started: 0 of 30 boxes").
  - A user, Lovejoin on by default, connects a site to a private session. The window says spare ADA is mixed through Lovejoin, about 4.1 ₳ a 5 ₳ box. The review says "Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later."
  - The session's return then comes back directly: "Lovejoin is left out of this return: Lovejoin's pool holds N boxes not yours, and the wallet mixes only from 30".
  - On preprod at `a6c94743` it's the same, with "Lovejoin has no pool of 5 ₳ boxes to take it yet".
- **Evidence:**
  - The trace:
    - `lovejoinBack` (`:533`) picks `staysLovejoin` (`:921`), the "Through Lovejoin first" row (`:478`) and `noteLovejoin` (`:488`), unless `summary.collateralMix`. `collateralMix` picks `noteLovejoinMixed`, which also says the spare ADA is mixed.
    - The return's `chain()` takes `adaPool(network, true)`. None throws `noAdaPool` (`lovejoin.ts:3517`). One under the floor throws `floorShort` (`:3604-3605`).
  - The test: `python3 -I tests-e2e-nopool-scratch.py e2e/extension.spec.ts` adds the scratch test, then `npx playwright test --project=extension --workers=1 -g "tests-e2e scratch"`: **1 passed**. In one world (the classic pool's 20 recorded boxes, retired, and no v2 pool), it asserts:
    - the window's "Spare ADA is mixed through Lovejoin so it's harder to tie to this session";
    - the review's "Through Lovejoin first, about4.1 ₳ a 5 ₳ box" and "Lovejoin mixes the spare ADA … back in 5 ₳ boxes hours later";
    - and that the same session's Bring it back review comes back directly, with `lovejoin-skipped` saying "Lovejoin has no pool of 5 ₳ boxes to take it yet".
- **Fix:**
  - Let the approval's way back follow what the worker knows of the 5 ₳ pool. The funding summary already carries `collateralMix` from `collateralPoolTakes`; carry the same for the spare ADA. Where no pool takes it, use the direct words (`staysDirect`, `noteDirect`), or one short line that it comes back directly until Lovejoin's 5 ₳ pool can take it.
  - Have the e2e assert the Lovejoin words with a pool that takes boxes, and the direct words without one.
  - Any new critical string needs back-translation.
  - `DappApprovals.tsx:530`'s comment still says "a 10 ₳ box".

### tests-e2e#1

- **Title:** Once 44c bundles a v2 5 ₳ pool, "mix my boxes again" passes on a copy while nine moved tests and the 1.5.0 head-start case fail.
- **Severity:** low. **Kind:** test. **Introduced:** new. **Proven:** test (simulated).
- **Where:**
  - `extension/e2e/extension.spec.ts:3159-3162` and `:3171-3174`: its boxes, its status and its row.
  - `extension.spec.ts:3240-3293`: `fivePool`, launched at the head start's height + 1.
  - `extension/src/background/lovejoin-pools.ts:175-182`, `:206-210`: the earliest pool of a set and value is shown; a later one is a copy.
  - `extension/src/background/lovejoin.ts:4006`, `:4044`: a copy is refused new boxes but not Mix again.
- **Claim:**
  - With the bundled pool earlier, `fivePool`'s own pool is a copy. The test still finds the wallet's three boxes in it (the one-time copy read seals it), its row shows "3 boxes", and Mix again runs there.
  - That is Mix again in a copy, not in the pool every return goes into. Fixing only the red tests in 44c would leave this one testing the wrong pool.
- **Scenario:** 44c refreshes the head start with preprod's v2 5 ₳ pool, and later mainnet's. Nothing else in the e2e changes. Then:
  - Five tests fail at `fiveRow`'s 20 s wait, because the copy with nothing of the wallet's in it isn't listed: mix in 5 ₳, a mix that stopped partway, Home's row (both through `stoppedPublicMix`), the collateral test, a mix being sent.
  - The three site-session tests fail: the return comes back directly ("Into your private balance44.827855 ₳Network fee0.172145 ₳…"), because the return's pool is now the bundled one and the fakes put no boxes at its mix_box.
  - The mainnet floor test fails the same way once mainnet's pool is bundled.
  - `lovejoin-1-5-0`'s head-start case fails both its tests (the section below gives every diff).
  - "Mix my boxes again" stays green.
- **Evidence** (each from the sandbox root, then the extension):
  - `python3 -I tests-e2e-44c-sim.py <sandbox>`, `npx vitest run tests/lovejoin-pools-head-start.test.ts`: 2 passed. Then `npm run build:ext` and the moved tests (`npx playwright test --project=extension --workers=2 -g "Lovejoin: |a mix being sent|a session the restore scan found: Home|site session|a site's private session|a site connects to a private session|Settings' Bring every box back"`): **8 failed, 5 passed**. Mix my boxes again passes (4.5 s).
  - The same, with an added assertion that its row's `lovejoin-pool-unusable` contains "another pool of this box value was started before this one" (the copy's flag): **1 passed**, so it does run in a copy.
  - With mainnet bundled too (`tests-e2e-44c-sim-mainnet.py`), the floor test **fails**: `getByTestId('lovejoin-pool-0eedc4eb…')` is never visible.
- **Fix (each verified on the simulated head start):**
  - The e2e: run `tests-e2e-44c-spec.py`, then all 13 tests pass with preprod bundled and with both networks bundled (**13 passed** each).
    - On a network whose head start bundles a v2 5 ₳ ADA pool, the strangers and the wallet's boxes go to that pool's mix_box (its datum's M) and the tests open its id.
    - No holder rows, no `tx_info` route, no `lookedForFive` (a look finds nothing new then).
    - `madeByFiveMix`'s input moves to that mix_box.
    - `fivePool`'s own launch stays only where no v2 5 ₳ pool is bundled.
  - `lovejoin-1-5-0` is in the section below.

### tests-e2e#2

- **Title:** A retired pool's page, the withdraw-only page every user with old boxes lands on, is pinned by no test: hiding Bring one back now there passes everything.
- **Severity:** low. **Kind:** test. **Introduced:** new. **Proven:** mutation.
- **Where:**
  - `extension/src/ui/screens/Lovejoin.tsx:1621-1625`: Bring one back now's condition.
  - `extension/e2e/extension.spec.ts:3213-3216`: the moved assertions, now in the v2 pool.
  - `extension/tests/lovejoin-merged-screens.test.ts:141-143`: "the classic pool … as on main", rendered with no `unusable`. 1.8.0's worker always sets `unusable: { why: "retired" }` there.
- **Claim:**
  - At `c15603d5` the e2e held Bring one back now enabled on the classic pool's page with the wallet's three boxes (old spec `:3195-3197`). 44b moved that test to the v2 pool.
  - Under call 2 the classic pool's page with the wallet's boxes is withdraw-only, and Bring one back now must stay. Nothing checks that it does.
- **Scenario:**
  - A 1.7 wallet's boxes sit in the classic pool or an 8131b1d pool. On 1.8.0 the hub lists that pool, withdraw-only.
  - A change that drops Bring one back now from retired pools' pages leaves those boxes only to the schedule and to Settings' Bring every box back, and no test notices.
- **Evidence:**
  - The mutation: `{!stuck && owned > held && !nowRefused && !isRetired(pool) && (` at `Lovejoin.tsx:1621`.
  - 29 files pass, every test that imports `ui/screens/Lovejoin` among them (543 tests):
    - `npx vitest run tests/lovejoin-held-balance.test.ts tests/lovejoin-hub.test.ts tests/lovejoin-merged-screens.test.ts tests/lovejoin-retired.test.ts tests/lovejoin-screens-review.test.ts tests/lovejoin-session5-screens.test.ts tests/screens-wiring-review-fixes.test.ts tests/screens-nits-review-fixes.test.ts tests/lovejoin-merged-review.test.ts tests/lovejoin-release-rules.test.ts --maxWorkers=2`: **243 passed**.
    - `tests/i18n-screens.test.ts tests/screens.test.ts tests/lovejoin-form-review-fixes.test.ts tests/lovejoin-stopped-shown.test.ts tests/pool-return-screen.test.ts`: **119 passed**.
    - The other 14 files importing `ui/screens/Lovejoin` (`collateral-held`, `chain-stopped-copy`, `lovejoin-advance`, `i18n-assembly`, `lovejoin-accounts-page`, `lovejoin-stopped-before`, `lovejoin-restore`, `lovejoin-crediting-review-fixes`, `public-mix-maybe`, `lovejoin-launch-review-fixes`, `approvals-review-fixes`, `lovejoin-public-cap-review-fixes`, `lovejoin-accounts-review-fixes`, `collateral-reserve-review-fixes`): **181 passed**.
  - `npm run build:ext && npx playwright test --project=extension --workers=2 -g "Lovejoin|Bring every box back|a mix being sent"`: **11 passed**.
  - No test renders `PoolPage` with `unusable: { why: "retired" }` (grep of `tests/`).
- **Fix:** A screen test of `PoolPage` for a retired pool with mixed and not-mixed boxes: Bring one back now there and on, Bring one back anyway in the callout, no Mix, Mix again or Bootstrap, and the retired reason. Or an e2e with the wallet's box in the classic pool, using `ownedLovejoinBox` at its mix_box.

### tests-e2e#3

- **Title:** No test reaches a token's list of pools any more: its rows can open nothing and every test passes.
- **Severity:** low. **Kind:** test. **Introduced:** new. **Proven:** mutation.
- **Where:**
  - `extension/src/ui/screens/Lovejoin.tsx:1872-1889`: the token list screen, its rows at `:1886`.
  - `Lovejoin.tsx:1998`: the grid once there's more than ADA's.
  - `extension/e2e/extension.spec.ts:3332-3338`: `poolToHub`'s ADA branch, which no test reaches now.
  - `extension.spec.ts:3325-3329`: `fiveRow`, which reads the hub's own rows.
- **Claim:**
  - At `c15603d5` every preprod Lovejoin e2e reached its pool through the grid. `classicRow` (old spec `:3206-3209`) clicked ADA's tile, then the classic row in ADA's list, and `poolToHub` came back through that list.
  - With the head start's pools retired and hidden, the e2e hub shows ADA's rows alone. Nothing tests the grid's tiles, a token's list, or Back through it now.
  - That UI is still reachable in 1.8.0:
    - on preprod, while the wallet holds boxes in a retired MIN pool;
    - on any network, once a v2 token pool or a second ADA pool is shown.
  - The unit tests render the grid and `tileOpens` statically, never the list screen.
- **Scenario:** A row in ADA's list (or MIN's) that stops opening its pool, or a Back that loses the list, ships unseen.
- **Evidence:**
  - The mutation: `onOpen={() => setView(undefined)}` at `Lovejoin.tsx:1886`.
  - `npx vitest run tests/lovejoin-hub.test.ts tests/lovejoin-session5-screens.test.ts tests/lovejoin-merged-screens.test.ts tests/lovejoin-retired.test.ts tests/lovejoin-screens-review.test.ts --maxWorkers=2`: **118 passed**.
  - `npm run build:ext && npx playwright test --project=extension --workers=2 -g "Lovejoin: "`: **6 passed**.
  - `grep` finds `lovejoin-token-` and `lovejoin-token-title` in no spec or unit test.
- **Fix:** One e2e that puts two pools under one tile, then opens the tile, a row and Back. For example, the wallet's box in the head start's retired 5 ₳ or MIN pool beside `fivePool`, or the v2 token fixture at the holder.

### tests-e2e#4

- **Title:** `lovejoin-mix-width.md` still says the wallet mixes on the classic pool, and states four's margin from the retired pools.
- **Severity:** low. **Kind:** docs. **Introduced:** new. **Proven:** reading.
- **Where:** `seedelf-web-wallet/docs/lovejoin-mix-width.md:3`, `:7-8`, `:13`, `:54`, `:109-115`, `:135`.
- **Claim:** The v2 table and its line (`:74-82`) are right, and match the plan and the commit. But the page's summary and the sections built on it still describe the three retired deployments, which 1.8.0 takes no new box in:
  - "**The classic pool on mainnet** (what the wallet mixes on)" (`:54`) is false since 1.8.0.
  - "A four-box mix uses 98.8–98.9% … leaving 111 to 118 million" (`:7`) and "four fits by 111 million steps, the thinnest of the three deployments" (`:8`): v2, the only pools 1.8.0 mixes in, uses 99.0% and leaves 100.3 million, the thinnest.
  - "Worst case, any of the three deployments" (`:109-115`): v2's worst case is 5.82 / 9.90 / 15.07 / 21.32 billion steps; 11.00 billion with 10% to spare at four; 0.20 billion left in a block of two. The table has 9.89, 10.99 and 0.22.
  - "What four would cost a user" (`:135`) prices the user's mix at mainnet's classic pool (0.823 ₳, 1.214 ₳), where 1.8.0's are v2's (0.837 ₳, 1.230 ₳ on preprod's stand-in).
  - "Measured on 2026-10-16" (`:3`) now covers only part of the page.
- **Scenario:** A reader checking how much room four has, or what a mix costs, reads figures from pools 1.8.0 no longer mixes in.
- **Evidence:** From the doc's own tables:
  - 5,815,442,941 − 5,809,358,265 = 6,084,676, and 9,899,749,344 − 9,888,981,920 = 10,767,424. So the plan's "6 million" and "10.8 million" hold.
  - 10,000,000,000 − 9,899,749,344 = 100,250,656 (1.0025%).
  - 9,899,749,344 / 0.9 = 11.0 billion; 20 − 2 × 9.8997 = 0.2005 billion.
- **Fix:** Lead the summary with v2's figures (four fits by 100.3 million, 99.0%), call the classic and 8131b1d tables what the wallet mixed on before 1.8.0, and recompute the worst-case table and the user's costs on v2.

### tests-e2e#5

- **Title:** No test holds a v2 mix's fee under the estimates that the plan and the doc say still stand.
- **Severity:** low. **Kind:** test. **Introduced:** new. **Proven:** reading.
- **Where:**
  - `seedelf-core/tests/lovejoin_width_test.rs:917-955`: `every_width_measured`, the v2 pool among `pools()`.
  - `seedelf-core/src/lovejoin/mod.rs:1663`, `:1668`.
  - `docs/lovejoin-mix-width.md:74`.
  - `docs/plans/chunk-44-lovejoin-v2.md:54`.
- **Claim:**
  - The width test pins only coarse bounds on v2: whether a width fits, under 60% at three, over 98% at four, six past a block, memory and size. Its exact figures are printed, not pinned, which is fine.
  - But "0.837 ₳ against `MIX_FEE_ESTIMATE`'s 0.95 ₳, 1.230 ₳ against 1.35 ₳" is checked nowhere for v2. The only comparisons with the estimates are on the classic pools:
    - `lovejoin_mainnet_test.rs:307`, `:503`: mainnet's classic pool, three wide.
    - `lovejoin_planner_test.rs:893-901`: preprod's classic pool, four wide.
    - `lovejoin_pools_test.rs:901` bounds an 8131b1d token pool's mix at 1.2 ₳.
  - v2 costs 0.014 to 0.016 ₳ more than those, so a parameter or cost-model change could take v2 past an estimate while every classic check passes.
- **Scenario:** After a fee parameter change and a re-recorded params fixture, a v2 mix costs more than its estimate. Chains are planned short by the overrun, and the 1.5 ₳ room absorbs it until it doesn't. No test fails.
- **Evidence:** `grep -rn MIX_FEE_ESTIMATE seedelf-core seedelf-web-wallet/wasm` lists every use: none on a v2 pool. Rust isn't this lens's to run (the brief), so there's no mutation.
- **Fix:** In `every_width_measured`, for every pool, `assert!(worst.fee <= lovejoin::MIX_FEE_ESTIMATE)` at three and `assert!(worst.fee <= lovejoin::MIX_FEE_ESTIMATE_FOUR)` at four.

### tests-e2e#6

- **Title:** The v2 fixtures put one launch transaction's three outputs in three blocks.
- **Severity:** nit. **Kind:** test. **Introduced:** new. **Proven:** reading.
- **Where:**
  - `seedelf-web-wallet/wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json:14`, `:62`, `:84`.
  - `wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json:14`, `:62`, `:84`.
  - `wasm/tests/lovejoin_v2_fixture_test.rs:80-81`, `:154-155`.
- **Claim:** The writer moves the token pool's two script rows into the launch's transaction (`tx_hash`, `tx_index`, address) but keeps their own `block_height`, `block_time` and `epoch_no`. `0d481468…#0` sits in block 5279206 and `#1` and `#2` in 5279194 and 5279197; the same holds for `7f767b3e…`.
- **Scenario:** Nothing reads them so today. `fivePool` overrides every row's height, `v2-pools.ts` hands the PoolRef as it is, and discovery takes a launch's block from `tx_info`. A later test that scans the holder from these rows, as 44c might, starts from an impossible launch.
- **Fix:** In both writers, give the script rows the reference row's `block_height`, `block_time` and `epoch_no`, then re-record (`RECORD_LOVEJOIN_V2_FIXTURE=1`).

## 44c, simulated: what breaks and what each must become

The plan's 44c item, run in the sandbox with the simulated head start: a v2 5 ₳ pool bundled on preprod at block 5378705, with the height at 5380000.

**The e2e** (`extension.spec.ts`, built with `npm run build:ext`):
- **Breaks:**
  - Five tests fail because the hub never lists `fivePool`'s pool, now a copy with nothing of the wallet's: "Lovejoin: mix in 5 ₳ boxes…", "a mix that stopped partway…", "Home's row doesn't count…", "a mix from the public account without its collateral…" and "a mix being sent…". Each times out at `fiveRow`'s 20 s wait.
  - The three site-session tests fail because the return comes back directly: the bundled pool has no boxes in the fakes.
  - The mainnet floor test fails once mainnet's head start bundles its pool (checked with both networks bundled).
- **Still passing:**
  - The restore-found session, Settings' Bring every box back and the connect test.
  - Mix my boxes again, on a copy (tests-e2e#1).
- **Must become** (`tests-e2e-44c-spec.py`, 13 passed with preprod bundled, 13 passed with both):
  - On a network whose head start bundles a v2 5 ₳ ADA pool, the boxes sit at that pool's mix_box (its datum's M), and the tests open its id.
  - No holder rows, launch route or `lookedForFive`.
  - `madeByFiveMix`'s input at that mix_box.
  - `fivePool`'s own launch only where none is bundled.
  - The `FIVE` fixture import can then go, unless mainnet's pool isn't bundled yet.

**`tests/lovejoin-1-5-0.test.ts`, its head-start case** (soft asserts, `-t "with the token pools every preprod wallet"`):
- **Breaks:**
  - `:922`: `shownPools(...).filter(v2)` is `[the bundled pool]`, not `[]`.
  - `:924`: `plans(headStart)` against `asRetired(recorded.plans)`, 87 differences:
    - Preprod's funding at depth 1 to 3 (`funding[6..41]`) gains `collateralReserve: "1500000"` and `collateralPool: <id>`.
    - Every return's `lovejoinSkipped` becomes "Lovejoin's pool has 0 boxes to mix with, and this needs 2", 8 or 26, in place of `NO_ADA_POOL`.
    - The swap's quote loses `skipped` and prices `ifStopped` (1 box, 4 mixes, 3.8 ₳ and 0.3 ₳).
    - The swap's review and Stop say "Right now Lovejoin's pool has 0 boxes to mix with, and a box 2 waves deep needs 8" (`stop.of: 4`).
  - `:929` (`finishesRetired`):
    - "bring session 0 back" makes one more pool read: a `credential_utxos` naming the classic pool's `67ffe4ed…` once `classicCalls` strips the bundled pool's mix box.
    - Every page's `status`, and the restore's, gains `pools: [the bundled pool, empty]`.
  - `:933`: `status.pools` isn't undefined.
- **Every other unit file reading the bundled head start passes:** lovejoin-discovery, -discovery-review-fixes, -form-review-fixes, -crediting-review-fixes, -screens-review, -merged-review, -retired, run-traps-review-fixes and wasm-review-fixes (9 files, 159 passed).
- **Must become:**
  - The case hands the head start's retired pools alone for its comparison with 1.5.0's record (`pools.filter((p) => p.version !== "v2")` in its `headStart`). Both its tests then pass on the simulated head start (2 passed).
  - It asserts the bundled v2 pools separately: preprod's, and mainnet's once bundled, each a 5 ₳ ADA pool on v2.
  - A return into the bundled pool, given its boxes, is tested where `adaStrangers` gives them (`lovejoin-retired.test.ts`'s "a session's return"). 1.5.0's record can't say what that return does.

## Covered

- **The moved tests at `a6c94743`.** The 12 moved, plus Settings' Bring every box back and the restore-found sibling, in every run:
  - Dev build, unloaded, `--workers=2` (one worker for one file): 14 passed.
  - `taskset -c 0,1 --workers=2 --repeat-each=2`, two runs at once on two CPUs: dev build 24 passed; store build (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npm run build:ext`, no packaging) 26 passed, with the extension-loads test.
  - `taskset -c 0,1 --workers=1 --repeat-each=3` for the three tightest: 9 passed. "A site session's return … four at a time" takes 21.2 s unloaded, 23.0–24.0 s at the owner's two-CPU standard and 25.8–27.5 s at double load, of its 30 s. "Mix in 5 ₳" takes 19.8 s, 21.3–21.5 s and 25.6–27.1 s. No failure. The tight one's `expect.poll(…, { timeout: 30_000 })` inside a 30 s test is older than 1.8.0.
  - The whole extension e2e suite once, dev build, one worker: **105 passed** (9.6 min).
- **The data layer's e2e.** `VITE_DATA_ORIGIN=https://data.seedelf.test npx vite build && npx playwright test --project=data-layer`: 3 passed. 44a and 44b change nothing it fakes: no diff in `e2e/data-layer*`, `tests/fake-index.ts` or `src/background/private-index.ts`. The data layer's new `version` on each pool isn't read by the extension, which verifies every pool itself (`lovejoin-pools.ts` `verified`).
- **`fivePool` against a real wallet's pool:**
  - Its rows sit above the head start's height, all in one launch transaction.
  - Its launch is settled (a day old, past `SETTLE_MS`).
  - The routed `tx_info` has the seed among the inputs and L's registration under the right `stake_test`/`stake` header (0xf0/0xf1).
  - It has 20 strangers' boxes of 5 ₳ alone at its mix_box, empty at mainnet's holder for the floor test.
  - The routes run in the right order (`madeByFiveMix` before `fivePool`'s, before the Koios fake).
  - Caveats, none of them a defect:
    - The return tests ask the look themselves (`lookedForFive`), so the e2e never shows a preprod wallet that hasn't opened Lovejoin's page, the gap the plan gives to 44c.
    - Mainnet's way of finding the pool, the data layer's list and `adaPool`'s `ask`, has no e2e, only `lovejoin-retired.test.ts:214`.
    - The strangers' boxes predate the pool's launch (harmless).
    - A routed `tx_info` answers only the hashes it fakes (harmless here).
- **The moved tests' figures, recomputed from the estimates:**
  - A private mix of 5 ₳: 6.35 ₳ (127%), 11.8 ₳, 17.05 ₳; 8.8 ₳ a box, so two from 28 ₳.
  - The pool's room: 16 others for two boxes plus 2 for the collateral's mix.
  - The public side: 10.3 ₳ in, 9.05 ₳ leaving, 4.35 ₳ (87%).
  - Mix again: 9.1 ₳ and 7.6 ₳; at four, 5 mixes using 15 others.
  - Bootstrap: 150 ₳ and 60 ₳.
  - A site's return: 12 transactions.
- **What the e2e lost on the classic pool:**
  - Lost with nothing left to cover it: the token list (tests-e2e#3) and the classic, now retired, pool's page with the wallet's boxes (tests-e2e#2).
  - Covered by unit tests with the same WebAssembly: the classic pool's withdraw (`lovejoin-1-5-0`'s `finishesRetired`, `lovejoin.test.ts`), what made a classic box (moot in a retired pool), and the classic pool read with boxes (still e2e, Settings' test).
  - Unreachable by design: the classic pool's Mix, Mix again, Bootstrap and 1.5.x review.
- **The first unlock's bring-back, a released Bootstrap and a collateral's tail ended in a retired pool.** No e2e covers them. Unit tests cover them (`lovejoin-retired.test.ts` 278–399), and the owner ran them live on preprod.
- **The v2 fixtures and `lovejoin_v2_fixture_test.rs`, by reading:**
  - The committed files are held to their derivation (`held_to`). Each verifies as v2 with its scripts at the holder. The ADA pool's id isn't the token pool's.
  - The datum's hashes are swapped the way the writer does it.
  - Two pools' rows built from these seeds verify in the extension's WebAssembly (`lovejoin-pools-head-start.test.ts` on the simulated head start).
- **The width test and the doc's v2 table, by reading.** The arithmetic of the plan's figures holds (tests-e2e#4). The v2 pool's harness is held to `lovejoin::mix` (`the_harness_builds_the_wallets_mix`, three and four wide), and the live test leaves it out by name.
- **What the e2e pins of 44b's rules, by mutation:**
  - Taking a retired pool for a return's ADA (`!isRetired(p)` dropped from `adaPoolOf`, `lovejoin.ts:671-672`) is caught by the e2e: the three site-session tests fail, the review coming back directly. `lovejoin-retired.test.ts` catches it too (2 failed).
  - Listing a retired pool on the hub with nothing of the wallet's in it (`shownOnHub` without `isRetired`, `ui/lovejoin-pools.ts:89`) isn't caught by the e2e ("mix in 5 ₳" and the floor test pass: the worker's status already leaves out 8131b1d pools without the wallet's boxes, and the classic pool's row sits beside the 5 ₳ pool's). `lovejoin-retired.test.ts:431` catches it (1 failed).

## Not checked

- No Rust was run: the brief gives it to the pr363 reviewer. The width test's v2 rows and the fixture test weren't run, so the doc's v2 table wasn't re-measured.
- No e2e of the first unlock's bring-back (`retireOnce`) or a retired pool with the wallet's boxes was written; tests-e2e#2's fix asks for one.
- The real preprod v2 pool (`47bece42…`) wasn't used in the 44c simulation, which stands in a pool of the same kind: no network.
- The data layer's mainnet list with a v2 pool (`version`) through the data-layer e2e: its fake index serves no Lovejoin pools.
- The words of the moved tests' strings against the critical lists: the words lens's.
