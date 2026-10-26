# Review of the fixes, lens `tests-mutation`: do the tests prove the fixes?

Every fix for a high or medium finding in HANDOFF.md, and 40-odd lows across all fixers, was reverted in a copy of `seedelf-platform` and `seedelf-data`, with its own `CARGO_TARGET_DIR`s. The named tests were then run there. The copy and the throwaway test are deleted. Each mutation's spec (file, old text, new text, command) is in the scratchpad's `tm-specs/`, and the runner is `tm-tools/mut.py`.

**Result.** Every high and medium fix has a test that fails without it, and fails for its finding's reason. That covers:
- the private Bootstrap, the worker and core halves both;
- the hostile pool, in core, the data layer, WebAssembly's `protocol_of` and `isTrap`;
- the two Bootstraps in one pool;
- the deposits' ties;
- Home's banner for a Bootstrap;
- Bring every box back now's landing wait;
- Remove wallet with parts waiting;
- the restore of a session funded in parts.

Four gaps are left, and none is a wrong fix:
- **medium:** the site funding review's and the top-up's half of 323-worker#1 and #6 can be reverted with every test green;
- **low:** four of runs.ts's six new trap rethrows have no test;
- **low:** eight screen wirings can be reverted with every test green;
- **low, pre-existing:** the 1.5.0 gate lets a classic funding plan drift up to 0.5%.

## Findings

### 1. The site funding review's and the top-up's collateral-mix wiring has no test (medium)

- **Where:** `WW/extension/src/ui/screens/DappApprovals.tsx:764`, `collateral={!!review.collateralReserve}`, and `WW/extension/src/ui/screens/SiteSessions.tsx:633`, `mixed={!!review.collateralReserve}`.
- **Fix:** sc-o-1: 323-worker#1 (the site half), and 323-worker#6 / gap-3#2 (the site's and the top-up's notes).
- **Scenario.** Drop either prop, or rename `collateralReserve` in a refactor. A site funding that pays the 1.5 ₳ (preprod: 2.8 ₳ direct) reserve then reviews without the *Its collateral's mix, about* row, and *Network fees both ways* comes out ~1.5 ₳ short. Its critical note goes back to `dappUi.back.privacy.noteLovejoin`, "…the 5 ₳ come back at once", which is false when the collateral is mixed. The top-up says its new 5 ₳ "comes back with the next return".
- **Evidence.**
  - Mutation o1a, `collateral={false && !!review.collateralReserve}`: `approvals-review-fixes`, every `dapp*`, `review-totals*` and `screens`: **23 files, 271 tests pass**.
  - Mutation o1c, `mixed={false && …}`: `approvals-review-fixes`, every `site*`, `session*`, `dapp*` and `screens`: **39 files, 424 tests pass**.
  - The named tests ("a site's funding review counts the collateral's mix in the way back", "a site's funding review never says the 5 ₳ comes back at once", "a site's top-up never says its new 5 ₳ comes back with the next return") render `FundingWayBack` / `TopUpCollateralNote` with `collateral: true` / `mixed: true` handed in. So they stub away the very decision the fix makes.
  - sc-o-1's report says e2e's site fundings carry no reserve, so nothing else covers it.
  - The swap approval's half is wired and tested: mutation o1b (`collateralMixed && false`) fails "says so on the approval…".
- **Suggested fix.** Export the funding review's body, or a `FundingReview({ review })`, and the top-up review. Render each with a `SessionOutSummary` that carries `collateralReserve`, and assert the row, the both-ways total and the mixed note; render one without it, and assert the old ones. No behaviour change.

### 2. runs.ts: four of the six new trap rethrows have no test (low)

- **Where:** `WW/extension/src/background/runs.ts:83, 86, 91, 101`: `sessions.runAll`, `lovejoin.pumpPublic`, `parts.pump` and `lovejoin.returning`, each `.catch(unlessTrap(…))`.
- **Fix:** w-left, 314-wasm#0's defence in depth.
- **Scenario.** Any of the four catches can go back to `() => false` (or `() => true`), so a trap from that step is swallowed again and the run goes on on a broken instance. Every test stays green.
  - `parts.pump` really can throw a trap (parts.ts:465, 520, 648 rethrow one), so its catch is live.
  - `sessions.runAll` catches its own steps, so that one matters least.
- **Evidence.**
  - Mutations wr1 to wr4: `run-traps-review-fixes` and `runs.test.ts`, **12 of 12 pass** under each.
  - Only `withdrawDue`'s (via wt2 and d1) and `pending.watch`'s are tested: wr5 fails, "watch: expected vi.fn() to be called 1 times, but got 0 times".
  - A throwaway `tests/zz-review-tests-mutation-1.test.ts`, written in the copy and since deleted, has four cases. Each throws a `WebAssembly.RuntimeError` from one step on mainnet, then expects `wallet.trapped()` once and `alarm.stop()`. It passes on HEAD, and fails under each of wr1 to wr4: "expected "vi.fn()" to be called 1 times, but got 0 times".
- **Suggested fix.** Add those four cases to run-traps-review-fixes' "a trap under the worker's runs" (`runner()` already stubs every step).

### 3. Screen fixes proven only through extracted helpers: their wiring can be reverted with every test green (low)

- **Fixes:** sc-o-2's 309#0; sc-lj-1's 320-screens#2, 321-lj-screens#1, #3, 320-screens#4 and 323-worker#0's form half; sc-lj-2's 321-lj-screens#0; wss-1's gap-3#6; sc-o-1's 320-screens#3.
- **What's tested and what isn't.** Each fixer extracted the rule and tested it, and each rule's mutation fails (checks below). The line that makes the screen use the rule isn't exercised by any Vitest test, since there's no DOM. Most of the fixers said so. Each of these reverts left its suites green:
  - `Collateral.tsx:98`, `const inPlace = false && !!onSent` (309#0): 11 files, 287 tests pass. Only the new e2e (not run here) drives it, and sc-o-2 says HEAD failed that e2e "in nearly every run", which isn't every run.
  - `Home.tsx:367-368`, the `unwatched` wiring put back to the old line (309#0's two-window hardening): 287 pass. No test at any level.
  - `Lovejoin.tsx:2558`, `tail = 0n` (320-screens#2, 321-lj-screens#3, 323-worker#0): 8 files, 206 pass.
    - The form's figures go 1.5 ₳ off the review.
    - Within a ~1.5 ₳ window, the stepper offers a count whose funding falls back without the collateral's mix, quietly less private.
  - `Lovejoin.tsx:2554`, the public side back on Home's figure (321-lj-screens#1): 206 pass.
  - `Lovejoin.tsx:2680`, `againAt` taking the width before the rebuild (320-screens#4): 206 pass.
  - `BringAllBack.tsx:147`, the ask bypassing `follow.current.press` (321-lj-screens#0): 5 files, 166 pass.
  - `LockCountdown.tsx:86`, never asking `parts-waiting` (gap-3#6): 4 files, 116 pass.
  - `Swaps.tsx:905`, `rebuilding={false && rebuilding}` (320-screens#3): 11 files, 218 pass.
- **Suggested fix.** A small jsdom harness (or `react-test-renderer`) for these components: open the page in place, press, rebuild. Or an e2e case each for the Lovejoin form with a 5 ₳ pool shown and for the countdown's parts line. No code change.

### 4. The 1.5.0 gate lets a classic funding plan drift up to 0.5%, and x-compat#2's new case inherits it (low, pre-existing)

- **Where:** `WW/extension/tests/lovejoin-1-5-0.test.ts:229`. `MEASURED` includes `"lovelace"`, so `nearly` compares lovejoin-funding's planned lovelace within `MEASURED_SLACK` (0.5%), lines 729 and 745.
- **Concerns:** wlj-4's x-compat#2, whose report says "every other figure … matched exactly". Also every fix that leans on "never in `funding_for`, which the 1.5.0 gate pins" (bootstrap, reserve).
- **Scenario.** A change that makes the classic pool's funding plan dearer by less than 0.5% passes all four gate cases. That's up to 4.48 ₳ on the gate's own largest plan: 895.5 ₳, 40 boxes at depth 3. The owner's rule is byte-identical to 1.5.0.
- **Evidence.**
  - xc1, +1 lovelace on every classic funding when a 5 ₳ pool is shown: **4 of 4 pass**.
  - gp1, every classic funding plan ×1.004: **4 of 4 pass**.
  - gp2: an exact check of `funding[*].funding.lovelace`, added to the original plans case, **passes on HEAD**. These figures are planned, not measured.
  - gp3: the same check **fails** under gp1: `expected [ Array(84) ] to deeply equal [ Array(84) ]`.
- **Suggested fix.** Keep the slack for what chains measure (`fee`, `fees`, outputs' `measured`), and compare the plans' figures exactly (lovejoin-funding's `lovelace`). Exactness costs nothing today (gp2).

## Checks: every fix checked, and its result

Format: fix (fixer, finding): the mutation, then what failed. **Proven** means the named test failed for the finding's reason.

### High and medium

- **bootstrap: 318-rust#0, 323-rust#0, x-scenarios-lj#0** (worker `mixFunding`).
  - b1, `back = 0n`, which drops the payment and the mark: the named lovejoin-flows test fails (`expected ['out','back'] to deeply equal ['out','deposit','back']`), here through the compat rule's path.
  - b2, back unpaid with the mark kept: 7 tests in 4 files fail. The named one fails with "a Seedelf deposit of these tokens needs at least 1.456780 ADA".
  - **Proven.**
- **bootstrap core** (`BOOTSTRAP_BACK_RESERVE`, `bootstrap_most`), Rust in the copy.
  - br1, no sweep check: `lovejoin_pools_test.rs:1778` fails (the dear cap). The wasm Bootstrap tests stay green, but they don't claim the sweep.
  - br2, no back reserve: the core test fails (most 0), and so does wasm `lovejoin_flows_test.rs:355`.
  - **Proven.**
- **bootstrap: docs-small#0, x-compat#0, x-release#0, 316#2, 312#4** (the red tests).
  - lovejoin.test.ts, merged-review and planner fail under b2.
  - sessions-review-fixes' "stays one transaction" fails under b3, `inParts` forced for a Bootstrap ("promise resolved … instead of rejecting").
  - The rewritten tests aren't weakened. **Proven.**
- **bootstrap screens.** bs1, `BOOTSTRAP_RESERVE` at 1.5 ₳: fails. bs2, PrivateReview's way-back row off: fails. **Proven.**
- **deep-datum: 314-wasm#0.**
  - dr1, `post_alonzo` guard: `lovejoin_pools_test:582` fails.
  - dr2, outer walk only: `cbor_test:201` and `lovejoin_pools_test:582` fail.
  - dr3, `resolve_reference` refusal: `cbor_test:146` fails.
  - dl1, the data layer's readable filter: `standard.rs:534` fails.
  - dl2, the depth limit `==`→`>`: `datum.rs:381` and `standard.rs:534` fail.
  - dw1, `protocol_of`'s skip: a throwaway native test at 128/129/2,000 levels fails with "129 levels: UTxO 7d7d…#0 holds a datum the wallet can't read". The node test asserts `scriptsInline` 1 at 129, so it fails the same way; it wasn't run, as it needs a private pkg.
  - d1, `isTrap`'s RangeError line: 8 tests in wasm-review-fixes and run-traps-review-fixes fail. lovejoin-discovery-review-fixes rightly passes without it: it holds the Rust half, on the rebuilt pkg.
  - **Proven.**
- **w-left: 314-wasm#0's defence in depth.** wt1 to wt4 (readSet `kept`, withdrawDueNow, the bring's pool read, its per-box catch) each fail, and so does wr5 (`pending.watch`). wr1 to wr4 all pass: **finding 2**.
- **wlj-1: 316#0.**
  - (a) countBack by age: 3 fail.
  - (b) no holder in dropWithdrawing: 2 fail.
  - (c) squareUp without the at-deposit pass: 1 fails.
  - (d) stand-ins before landing: 1 fails.
  - (f) no let-go rule: 1 fails.
  - holderOf → the oldest: 3 fail.
  - **Proven.**
- **wlj-1: 316#1.** The `depositors` read removed: 2 fail. Its write removed: 2 fail. `read()` dropping it (persistence): 2 fail. **Proven.**
- **sc-o-2: 309#0.** The fixer's gate and hold mutations fail. The wiring (o2a, o2b) passes: **finding 3**.
- **wlj-4 and sc-o-2: 318-worker#0.** bw1, publicSubmit's mark: fails. bw2, the banner ignoring `bootstrap`: 3 fail. **Proven.**
- **wlj-2: 321-lj-worker#0.** M1, the bring's landing wait: 3 fail. M2, the trim guard's `mayLand`: 1 fails. **Proven.**
- **sc-o-1: 323-worker#1.** o1b, the swap approval: fails. o1a, the site review: all pass: **finding 1**.
- **wss-1: gap-1#1.** h1, atStake never lists parts: fails. Settings' `held` counts any entry (read). **Proven.**
- **wss-2: x-scenarios-sessions#0.** s0a, parts left out of `recovered.own`: 3 fail. s0b, no register check: the stranger guard fails. s0c, no not-caught-up throw: 1 fails. **Proven.**

### Low (and three nits), across fixers

- **bootstrap.** 323-worker#4, b4: fails. The compat one-box-fewer rule, b5: fails.
- **wlj-1.** 316#3, w1i: fails. x-privacy#0, the payer sort without `another` (w1j): fails.
- **wlj-2.** x-scenarios-lj#1, M10 (`mixing` ignoring `tailWaits`): 3 fail. 321-lj-worker#4, `late` never set: 2 fail.
- **wlj-3.**
  - 323-worker#2, noPool said as unlisted: fails.
  - 323-worker#5, the listing grace: 2 fail.
  - 323-worker#8, `chainSoFar` without `from`: fails.
  - gap-1#0, h2 (every chain counted) and h3 (public chains ignored): each fails.
- **wlj-4.**
  - 318-worker#1, `startedBefore` dropped, and submit's `reviewed` check: each fails.
  - 319-worker#0, `wayOver`'s branch: 2 fail.
  - 318-worker#3 (nit), one parameters read: fails.
  - x-compat#2: the fixer's +1.5 ₳ mutation fails, but xc1 and gp1 pass: **finding 4**.
- **pool-exists: 317-wallet#0.**
  - Rust pe1, the reads never staged: core `:1384`, wasm `across:343`, `flows:504` and four `lovejoin_test` tails (`:1476`) fail.
  - TS pt1, the refresh guard: fails.
- **max-left.**
  - 321-parts-worker#6: Rust ml1 (Fee), `left: Some(Tokens), right: Some(Fee)`, and ml2 (Limit) each fail; TS mt1 (`whole()`) and mt2 (MaxLeftNote's fee branch) each fail.
  - 321-parts-rust#2 (nit): ml3 fails.
- **reserve.**
  - 323-rust#1: rs1 (1.5 ₳) and rs2 (no Seedelf least) each fail at `lovejoin_test.rs:2017`, "no tail built from …"; re2 (site `direct: false`) fails 2.
  - 323-worker#0: re1, no fallback: 5 fail.
- **rr-1.**
  - 312#0, the guard per script: `width_test:840` fails.
  - 314-core#1, `funding()` unchecked: fails.
  - 318-rust#1, the scripted UTxO spent: fails.
  - 319-rust#0, a zero leg's token taken: fails.
- **rr-2.** 314-core#2 (nit), the old predicate: `staking_test:481` fails. 321-lj-rust-data#2, a README row renamed: `readme_test` fails.
- **wss-1.**
  - gap-3#6, the answer forced false: 3 fail. The LockCountdown wiring passes: finding 3.
  - 321-parts-worker#0, pending-tx's locked rule: 5 fail.
  - 321-parts-worker#1, pumpHolds off: fails.
  - 321-parts-worker#3, later parts out of the spent check and out of the reservation check: each fails.
- **wss-2.**
  - 309#1, `onItsWay` removed: 2 fail.
  - 309#2, no account passed: fails.
  - 318-worker#2: `named = mine` fails 2, and the pending early return off fails 1.
- **sc-lj-1.** 320-screens#2, 321-lj-screens#1, #3, 320-screens#4: the rules' mutations are the fixer's. The wiring (lj1a, lj1b, lj1c) passes: finding 3.
- **sc-lj-2.** 321-lj-screens#0, the `finally` bump: 3 fail; the wiring (l2c) passes, finding 3. 321-lj-screens#5, the bring's words never used: fails.
- **sc-o-1.**
  - 322#1, `aria-live` back on the outer div: fails.
  - 320-screens#3, SendButton's branch: fails. Its wiring (o1g) passes: finding 3.
  - 323-worker#0's form half, `maxAdaIn` ignoring the reserve: 2 fail.
  - 323-worker#6's top-up (o1c): passes, finding 1.
- **w-left.**
  - 321-parts-worker#3's second half (sendChain): fails.
  - rr-1's note: `acrossOf` and `collateralWanted` without `evaluable`, each fails.
  - wlj-2's notes: countBack every time (2 fail), Stop's recheck (fails), the auto-stop's recheck (fails).
- **i18n-existing: x-i18n-ja#0.** en `partlyMaybe` back to "Koios": the guard and the parts test fail.

### Not run, and other checks

- **Not run:**
  - sc-o-2's 311#0 and 309#0 e2e (Playwright isn't allowed);
  - docs-1, docs-2 (doc-only);
  - deep-datum's node test and its Vitest discovery test against a private pkg (a native equivalent was run instead).
- **Baseline of the 35 touched test files in the copy:** 673 of 674 pass. The one failure, restore-scan's "offers 5 ₳ where the account's ADA alone…" (C41, C47, from before this round), timed out at 5 s under my parallel run. It passes alone.
- **The timeouts:** every new test file (21 files) also passes with `--testTimeout=2500`. Each new test is either fast or carries an explicit timeout, so none leans on Vitest's 5 s default.
- **The tree:** never edited. `git status` shows only other reviewers' files in `review/`.

## Leftovers

- **L4, confirmed from the tests' side.** w-left's bring tests delete spent marks (`lapsed`) to let a mark lapse, because `listing()` reads them with `Date.now()`. Once L4 is fixed, those tests should move the clock instead.
- **Stubs that are fine.**
  - reserve's `collateral-reserve-review-fixes` stubs `lovejoinDirectCollateralReserve` (`DIRECT`). That's fine: the planner test uses the real export, and wasm's `a_direct_returns_collateral_tail_is_paid_by_its_reserve_alone` pins 2.8 and 3.6 ₳ and builds the tails.
  - max-left's worker tests stub WebAssembly's `leftWhy`. That's fine: the Rust tests in api_test.rs hold it.
- **x-compat#2's record guard** (`RECORD_1_5_0` refused unless `package.json` is 1.5.0) has no test, as wlj-4 said. It's tooling, not the wallet.

## Questions

- The only guard of 309#0's in-place gate is its new e2e, which sc-o-2 says failed on HEAD "in nearly every run". Is it deterministic enough to stand as that fix's test? I couldn't run Playwright to see.
- Has the lead run `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"` against the rebuilt pkg (CI's step)? deep-datum's 128/129/3,000/100,000-level node test is the only test of `protocol_of`'s skip through the module itself. I checked the skip natively.
