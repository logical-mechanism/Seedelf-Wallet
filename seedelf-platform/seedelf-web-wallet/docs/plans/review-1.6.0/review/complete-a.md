# complete-a: is each finding fixed? (first half)

Reviewer `complete-a`, 1.6.0's review of the fixes. The tree is `web-wallet/review-1.6.0` at `e43eef7f`, and the working tree was clean. `wasm/pkg` was rebuilt at 13:37 from round 1's Rust, and round 2 changed no Rust.

## Verdict

Of the 66 findings:
- **54 are fixed** on the merged tree.
- **3 are partly fixed**, and each part left over is known or decided:
  - 316#1: case (a) is the owner's call;
  - 323-worker#1: the part left over is L1;
  - 321-lj-screens#0: fixed, with L2 left beside it.
- **9 are properly left**: owner's calls, and the skipped CLI-only finding.
- **No fixer's "fixed" failed to hold.** One new nit came up, on a screen the private Bootstrap's fix touched (below).

## Incident: please read

To run the data layer's offline tests, I ran a binary from `seedelf-data/target/debug/deps/` with its directory set to `seedelf-data/api`. The binary was `seedelf_data_api-0d181236adaef3cd`, and it turned out to be **the API server, not a test harness**.
- Run from there, it found `seedelf-data/.env`, so it started against home's mainnet services: `MAINNET_DATABASE_URL`, Kupo, Ogmios and the submit API.
- It ran for about 2 minutes before I killed it.
- It sends nothing by itself and nothing called it, so no transaction went out. It most likely made read-only queries of home's db-sync and Kupo, the Production Reads the owner runs by hand.
- It wrote no file outside `target/`.
- After that, I ran only the real unit-test binary (`seedelf_data_api-628754fd449d625d`, 103 tests), from `/tmp`, with an empty environment.

## Findings

### N1 (nit): a private Bootstrap's review note says "The deposit goes in now, in one transaction"

- **Where:** `extension/src/ui/screens/Lovejoin.tsx:172` (`reviewHint`) and `en.json:1148`. The note was added in 84c2775f (#318).
- **Scenario:** A user reviews a Bootstrap from the private balance, the form's default side.
  - The review's rows show the one-time account's funding, then *For returning the rest, 1.5 ₳* (bootstrap's new row).
  - The ⓘ note by the title says "The deposit goes in now, in one transaction."
  - What actually happens is three transactions: the funding now, then the deposit once the funding lands, then the sweep back.
- **Evidence:** `reviewHint` returns `lovejoin.review.bootstrapNote` for `bootstraps(r)` on both sides (line 172). It's rendered as the review's hint (line 2789).
  - `fixes/bootstrap.md`, call 5, flagged it for the screens round.
  - `fixes/sc-lj-1.md` says it was left untouched, and sc-lj-2 didn't take it either. It fell between the rounds, and it isn't in L1–L6.
- **Concerns:** bootstrap (318-rust#0 family), the same review screen. The wording predates this round.
- **Fix:** give the private side its own short note, such as "Funded now; the deposit goes once the funding lands, and what's left comes back after." The public note stays as it is. A new key goes into en, es and ja.

## Checks: one line per finding

### High

- **314-wasm#0 (high): fixed.**
  - Core: `resolve_reference` refuses an unreadable datum, and `post_alonzo` is guarded by `output_within_depth`. WebAssembly's `protocol_of` skips such a row (`scriptsInline` ≥ 1, so the pool is never kept), and `standard.rs` follows the same rule.
  - Defence in depth: `isTrap` counts a RangeError with a wasm frame, and runs.ts and `readSet` hand traps on.
  - Node `lovejoin-pools.test.mjs` passes on the rebuilt pkg (57/57), at 3,000 and 100,000 levels, each called twice. Vitest `lovejoin-discovery-review-fixes` and `wasm-review-fixes` pass, and so does the data layer's `standard.rs` test.
  - L3's catch-alls remain (known).
- **316#0 (high): fixed.**
  - `holderOf` is stored on `Withdrawing.holder`, and `countBack` credits that Bootstrap, else the one whose deposit the box sat at.
  - `squareUp` credits first what each deposit no longer lists. `bootstrapOf` uses stand-ins only for a landed Bootstrap.
  - `lovejoin-crediting-review-fixes`' six 316#0 tests pass, the moved-box and bring-all variants among them.
- **318-rust#0 (high): fixed.** `mixFunding` adds `lovejoinBootstrapReserve()` to a private Bootstrap's one payment, and core's `bootstrap_most` builds the deposit and the sweep.
  - My mutation, the reserve zeroed in a copy, fails lovejoin-flows' 318-rust#0 test: `expected [ 'out', 'back' ] to deeply equal [ 'out', 'deposit', 'back' ]`.
- **323-rust#0 (high): fixed.** The same fix and test.
- **docs-small#0 (high): fixed.** Both red tests now pass for the right reason.
  - My mutation, the TOO_MANY mapping disabled, fails `sessions-review-fixes`: `got 'Spending 23 UTxOs at once…'`.
  - CI is still red, on the two L5 es/ja checks alone. The build, e2e, `e2e:data` and the store package are the lead's.
- **x-compat#0 (high): fixed,** as docs-small#0.
- **x-release#0 (high): fixed,** as docs-small#0. The green workflow and a live private Bootstrap stay release steps.
- **x-scenarios-lj#0 (high): fixed.** The same fix. The token pool is covered by 2 LJTEST boxes in the whole-flow test.

### Medium

- **309#0 (medium): fixed.**
  - Opened in place, the page reads only `collateral` (`lookAgain`). Home lets go of an ordinary payment inside its hold when the answer is null (`unwatched`), which also covers two windows.
  - `home-review-fixes` passes. The new e2e wasn't run (Playwright).
  - Its test ids exist: `home-collateral` at Home.tsx:1608, `collateral-status` at Collateral.tsx:176.
- **316#1 (medium): partly, properly left.**
  - Cases (b) and (c) are fixed: sortOut seals `depositors` when a public seed's or Bootstrap's record goes, and `depositAccountOf` reads it after the entry closes.
  - Case (a) is the owner's known call. The policy doesn't claim (a); privacy.md lags (L6).
- **316#2 (medium): fixed:** the two red tests.
- **318-worker#0 (medium): fixed.**
  - `publicStart` returns `bootstrap`, and `publicSubmit` puts `PendingTx.bootstrap` on the watch. `shown()` keeps it, and the sealed copy is stored whole.
  - PendingBanner says "A Bootstrap", then "In Lovejoin, held there until you bring them back".
- **321-lj-worker#0 (medium): fixed.**
  - `mayLand`, `landedBy` and `landedDeposit` are bounded by `LANDING_MS` (15 min). The bring waits (`landing`) and keeps due times, and the regular trim keeps them too.
  - `lovejoin-bring-review-fixes` passes.
- **323-worker#1 (medium): partly.**
  - Fixed: the swap approval, where `swapCosts` adds a *collateral's mix* part row and takes it out of *Comes back*, and `FundingWayBack`.
  - Left: Stop's dialog, which is L1. Confirmed by reading: sessions.ts `stopCost` prices boxes on `held = spareOf(returnable(s, rows))` with no reserve taken off, while WebAssembly's chain sets the reserve aside first.
- **gap-1#1 (medium): fixed.** `atStake.partsWaiting` (not a session's funding), Settings' `settings.remove.warn.partsWaiting` and the second yes. `parts-waiting` serves the countdown.
- **x-release#1 (medium): properly left.** The owner's call: the live run with the real giveme.my is still owed (HANDOFF release prep 4–5).
- **x-scenarios-sessions#0 (medium): fixed.**
  - `recoveredRecords` puts every unsigned transaction, but the funding, whose first wallet-contract input is under this phrase's register into `recovered.own`. Top-ups count too, and a stranger's Seedelf payment doesn't.
  - The restore-scan tests pass for both part orders and for a real 2-part funding.

### Low and nit

- **309#1: fixed.** `collateral()` says "waiting" while `heldSent` holds the payment (two hours at most).
- **309#2: fixed.** `submitCollateral` passes the kept build's account, and `sent()`/`save()` work on that one account.
- **310#0: fixed (doc).** The rollback note is now generic (how to find `.prev`'s commit and diff its routes), names the token routes and their 404 behaviour, and the stale `.prev` lines are gone.
- **311#0: fixed (e2e).** It waits for the figure's regex, then reopens and asserts `[LOGIC, TPREP, TPREP]`. That matches Pools.tsx:210, where reopening drops the history. Not run.
- **311#1: fixed (doc),** as 310#0.
- **312#0: fixed.** A four-box test at a 2% dearer cost model reaches the guard's words, the five-box test asserts the measurement's refusal, and the `MEASURE_LIMIT` comment is corrected. I ran the current width test binary: 4 passed.
- **312#1: fixed.** The declared budgets are compared redeemer by redeemer, now on the token pool too, at 3 and 4 boxes.
- **312#2: fixed (doc).** "by default", the README row, the per-mix switches and `againWay`; the plan's "three wide like" phrase is gone.
- **312#3: fixed (doc).** The `mod.rs` path, `MEASURE_LIMIT`, `WIDTHS`/`check_width` and `LOVEJOIN_WIDTHS` are named, and `mixCost` is marked unread.
- **312#4: fixed:** the two red tests.
- **314-core#0: fixed.** Each seed's pool is made once, the floor comes from `locked.total()`, and `usable` runs once. The unit test passes.
- **314-core#1: fixed.** Checked sums refuse in words. The planner test passes.
- **316#3: fixed.** `chainSent` makes the entry for a `boxes: 0` chain's tail.
- **317-data#0: fixed.** One deadline, the last list when the list fails, and the stable cursor read once a tip. 103 data-layer unit tests pass.
- **317-data#1: fixed.** `lovejoin/tokens` is in `ALWAYS_KEPT`.
- **317-wallet#0: fixed.** A token pool's deposit reads `references[0]`, `refresh` guards on the launch's own transaction, and the wording is corrected. Core and wasm tests pass.
- **318-rust#1: fixed.** `launch_from_account` filters `eval::refusal` rows. The launch test passes.
- **318-worker#1: fixed, as a warning.** That follows the owner's no-refusal rule. `LaunchRecord.box`, a warn callout on the review, and Send again of the reviewed hash says sent already.
- **318-worker#2: fixed.** `lovejoin-back-paid` is named, and the pending row is left out.
- **319-rust#0: fixed.** Zero legs are skipped in the plan and the deposit, and the worker's `acrossOf`/`collateralWanted` count only `evaluable` rows.
- **319-rust#1: properly left** (the owner's call).
- **319-worker#0: fixed.** `wayOver` gives no reason where three takes no box, and the approval's width note is gated on `cost`.
- **319-worker#1: properly left** (the owner's call).
- **319-worker#2: properly left** (the owner's call).
- **319-worker#3: fixed (tests).** Two stopped-across-pools tests, mutation-checked.
- **320-screens#0: fixed.** After 30 minutes, `StartedPools` says the pool "hasn't shown", with the reasons. The Send-time refusal was rightly not added.
- **320-screens#1: fixed.** `AmountField`/`sanitizeAmount` for the quantity, `AdaInput` for the box.
- **320-screens#2: fixed.** `tailReserveOf`, `mixCosts`' tail and `mixMost`'s aside. The form's rule matches `collateralPool`, and a real-WebAssembly test checks they agree.
- **320-screens#3: fixed.** `SendButton` says "Building…" on a rebuild.
- **320-screens#4: fixed.** `AgainSwitch` shows the width the review was built at, and `widthTurned` takes the width only once the review is in.
- **321-lj-rust-data#0: fixed.** `Gathered` (the highest output id and transaction id, whatever they hold) bounds the read on.
- **321-lj-rust-data#2: fixed (doc).** README rows 58 and 71 carry the collateral fields, every export is named (`readme_test`), and the new reserves have rows.
- **321-lj-screens#0: fixed.** `bringFollower` bumps its count in a `finally`. L2 remains (known).
- **321-lj-screens#1: fixed:** `publicMixAda`.
- **321-lj-screens#2: fixed,** as 320-screens#4.
- **321-lj-screens#3: fixed,** as 320-screens#2.
- **321-lj-screens#4: properly left, done as asked.** The owner's call; the tail case leaves the 5 ₳ out of *Comes back once it's mixed* and gives it its own row.
- **321-lj-screens#5: fixed.** `lj.bring.warn.privatePayNone` for the bring's own withdraws.
- **321-lj-worker#1: fixed.** The worker's `bringing.waiting` codes, one page line each, with Stop.
- **321-lj-worker#2: fixed (test).** Mutation-checked both ways.
- **321-lj-worker#3: properly left** (the owner's call).
- **321-lj-worker#4: fixed.** `late` after 10 minutes, with Stop. A dropped box is still retaken only after 2 hours (wlj-2's call 2).
- **321-parts-rust#0: properly left.** CLI-only, skipped; sweep.rs is untouched.
- **321-parts-worker#0: fixed.** `parts {sent, total}` is sealed on the watch, `pending-tx` turns an orphaned part into `stopped: "locked"`, and `sendFunding` does the same.
- **321-parts-worker#1: fixed.** `pumpHolds` resends the first part alone. `send()` skips `laterParts` for a resend, so it doesn't clash with 321-parts-worker#3.
- **321-parts-worker#2: properly left** (the owner's call). The countdown and Remove wallet now warn (gap-3#6, gap-1#1).
- **321-parts-worker#3: fixed.** `send()` checks every later part before the first goes, and `sendChain` refuses a return holding a parts reservation before anything is recorded.
- **321-parts-worker#5: properly left** (the owner's call).
- **321-parts-worker#6: fixed.** WebAssembly's `LeftWhy` and `MaxLeftNote`.

## What I ran

- **Vitest, the whole suite, in a copy** (`$C/seedelf-platform/...`, laid out as the repo, with `wasm/tests` and the core and crypto fixtures):
  - default build: 2,753 passed. Of the 8 failures, 2 are the L5 es/ja checks and 6 timed out under load; those 5 files pass alone, 152/152;
  - preprod build: 2,759 passed, with only the 2 L5 checks failing.
- **`tsc --noEmit`:** clean.
- **`node --test` on wasm/tests:** 57/57.
- **Rust:** I ran the existing test binaries, built at 16:09 and 16:15, after the last Rust change at 12:45:
  - core: width 4, planner 12, launch 8, unit 2, Lovejoin pools 31, Lovejoin 22, cbor 8, vectors 3;
  - wasm: Lovejoin 23, flows 14, across 4, api 85, session 13, return_cost 5, readme 1;
  - every one passed.
- **Data layer:** the unit binary, 103 passed (see the incident above).
- **Mutation checks in the copy:** the Bootstrap's reserve zeroed, and the Bootstrap's TOO_MANY mapping disabled. Each failed its test as described above, and each file was restored.

## Leftovers

- The data layer API's 2-minute run against home's mainnet services (the incident above): for the owner to know.
- **L1 confirmed by reading:** sessions.ts `stopCost`, `held = spareOf(returnable(s, rows))`, keeps the collateral reserve in. Where the spare less the reserve buys one box fewer, Stop's dialog names one more box than the return builds.
- **L2 and L3 seen** as described in the brief; nothing new on them.
- **CI is still red** on the two L5 es/ja checks until round 4. CI's build, e2e, `e2e:data` and store-package steps haven't run on the fix rounds: the lead's.
- **Not run here (Playwright):** 309#0's new e2e and 311#0's changed staking e2e.

## Questions

- After Stop, suppose a node dropped a Bring every box back now withdraw of a held Bootstrap box. Once its spent mark lapses, I think `bootstrapOf` may hold that box and free its sibling at the same deposit, since the entry was credited at submit. The sibling then comes back by itself. Its return, credited with `bootstrap=false`, could land on another open mix in that pool, closing that mix's card one box early. The privacy outcome is the same box count the user asked for. I didn't build a test for it.
