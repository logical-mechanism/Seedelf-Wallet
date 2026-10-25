# Fixer rr-1 (Lane R): 312#0, 312#1, 314-core#0, 314-core#1, 318-rust#1, 319-rust#0, 319-rust#2

Rust only, core and WebAssembly. No TypeScript changed. The behaviour shows in the extension only after the lead rebuilds `wasm/pkg`; no Vitest test of mine waits for it.

## 312#0 (low, tests): **fixed**

- **Change.** New test `the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation` (core `tests/lovejoin_width_test.rs`).
  - The classic pool on both networks, its V3 cost model 2% dearer. Four boxes then measure about 10.08 billion steps: each script fits (`mix_logic` about 9.97 billion), the sum doesn't. The evaluator lets a transaction run 14 billion, so the measure passes, and the test asserts `lovejoin::mix` refuses with the guard's words, "Mixing 4 boxes at once needs more computation than a transaction may use".
  - Why 2%, not the suggested 3%: at 3% `mix_logic` alone measured 10.07 billion, so that case had a script past the limit and wasn't the "each fits, the sum doesn't" case the guard alone catches. The window, from the measured row, is about 1.2% to 2.3%. The test asserts both conditions, so a later cost model that moves them fails loudly, with the row shown.
- **The five-box test now asserts its true reason**: refused at measurement, "withdraw 0: execution went over budget". `mix_logic` alone needs 14.9 billion steps at five, past the evaluator's 14 billion, so the guard can't be reached at five unless `MEASURE_LIMIT` is raised, which I left alone (see the owner's calls).
- **`eval.rs`'s `MEASURE_LIMIT` comment corrected.** It caps a transaction's scripts together (uplc runs each redeemer on what the ones before left), not each script. Its memory figure said 17.5 million; the ledger's is 16.5 million (both fixtures).
- **Fail before.** None expected: it's a test gap, and today's code is right. The new test passes on it.
- **Mutation.** I narrowed the guard to each script, the finding's own example regression (`used.iter().any(|u| u.steps > MAX_TX_BUDGET.steps)`). Result: `called Result::unwrap_err() on an Ok value: Mix { … }`, so the mix builds. Restored.

## 312#1 (low, tests): **fixed**

- **Change.** `the_harness_builds_the_wallets_mix` now also compares what the wallet's transaction declares against the harness's measured budgets, redeemer by redeemer (the decoded redeemers' tag, index and ex_units, helper `declared`).
  - It still compares a re-measure, the fee and the size.
  - It adds Lovejoin's preprod token pool, read by reference as the harness reads it, at three and four boxes, with the full comparison: declared, re-measured, fee and size.
  - It adds the same pool with its scripts inline, as `verify_pool` gives it and so as the wallet reads this pool, at three and four boxes. There it checks that the mix declares what its scripts use, carries both scripts, and fits a transaction.
  - These are the first wallet-built four-box token-pool mixes in any test. They pass.
- `lovejoin_pools_test.rs`'s comment no longer says the width test checks a withdraw. It now says what does check one: `lovejoin_test.rs` runs it through the deployed scripts and checks its context against a recorded one.
- **Fail before.** A test gap, as above.
- **Mutation.** In `mix_with`, I staged each box's measured budget on the next box's redeemer (a permutation, the finding's scenario).
  - Result: `assertion left == right failed: classic, preprod N=3 First`, with the spends' budgets rotated.
  - With the declared assertion disabled, the old re-measure, fee and size checks all passed on every pool under that mutation, which confirms the finding. Only the inline part's declared check caught it.
  - Restored.

## 314-core#0 (low, performance): **fixed**

- **Change** (core `lovejoin/launch.rs`):
  - `made()` is split. `shaped()` does everything but the usable check; `made()` is `shaped()` plus `check_usable()`. `launch()` and `launch_from_account()` call `made()` as before, with the same checks in the same order, so their outcomes are unchanged.
  - `launch_apart()` makes each seed's pool once, memoized by seed. It makes the first ADA-only row's seed's pool before the selection starts, which checks the terms (fail fast), and passes that pool's `locked.total()` as the selection's `floor`.
  - The floor is seed-independent: a seed reaches the pool only through hashes of a fixed size, so every seed's outputs at the holder are as long. A choice holding no more can't pay, so it isn't tried.
  - Each choice then builds and estimates its spend alone. `usable` (a whole withdraw built, proven and measured) runs once, on the chosen pool, at the end.
  - Derive once: `shaped()` verifies its pool from the scripts it just derived (`pool::verify_derived`). That function runs the same checks as `verify_pool` without deriving again. `verify_pool` itself is unchanged in behaviour; both now share `derived_from`.
- **Test.** Unit test `lovejoin::launch::tests::a_private_launch_derives_a_seeds_scripts_once_and_measures_a_way_back_once`, in `seedelf-core/src/lovejoin/launch.rs`.
  - It uses test-only counters, `#[cfg(test)] lovejoin::counted`, bumped in `templates::derive` and `pool::measured`. They're compiled out of every other build.
  - Setup: 12 Seedelf UTxOs of 9.00 to 9.11 ₳, each its own Received class, with token terms.
  - It asserts the seed (the largest UTxO), 3 inputs, and (derivations, measures) = (1, 1).
- **Fail before.** `left: (30, 15) right: (1, 1)`: 15 choices, each deriving twice and measuring a withdraw. The test went from 0.65 s to 0.06 s natively.
- **Mutations**, each restored:
  - floor back to 0: `(12, 1)`;
  - the usable check inside each choice: `(1, 2)`;
  - `verify_pool` (deriving again) in `shaped()`: `(2, 1)`.

## 314-core#1 (low, correctness): **fixed**

- **Change** (core `lovejoin/mod.rs`):
  - `per_box_in`, `funding_for_in` and `funding_for` now return `Result<u64>`. Past what a u64 holds, they refuse with "These boxes cost more ADA than there is" (new `pub const lovejoin::MORE_THAN_THERE_IS`).
  - `boxes_affordable_in` and `boxes_affordable` give 0 boxes in that case.
  - `plan_across` gives such a leg no box.
  - `bootstrap_most` offers none.
  - `deposit_across` checks the sum it pays out and its change (`change_at`), refused in the same words. The change is still core's typed shortfall when it's short.
  - The private `per_box` returns `Option`, and a shared `affordable()`/`funding()` pair holds the checked sums.
  - The classic values are unchanged: `classic_deposits_are_byte_for_byte_one_point_fives`, `the_classic_pool_plans_three_wide_exactly_as_before` and the 1.5.0 gate (below) pass.
- **WebAssembly** (`wasm/src/lovejoin.rs`): `funding_at` and `chain_from_account_at` pass the refusal on (`?`), and the latter's `needed + minimum_address_payment` is checked too.
- **Left alone: `again_*`.** They hold no box ADA, and in wasm32 (32-bit `usize`), boxes × a box's mixes can't pass a u64 (at most 4.3e9 × 3.2e7 = 1.4e17).
- **Test.** `a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped` (core `tests/lovejoin_planner_test.rs`).
  - It uses a genuine, verified ADA pool of 2^64 − 1 lovelace a box. It checks the box's cost, the funding at each width and depth 0 to 3, the affordable counts, `funding_for`, a plan across pools beside the classic pool, `bootstrap_most` and a deposit.
  - It also uses a 2^63 pool: one box is quoted as it is, and two are refused.
- **Fail before**, a first version of the test written against today's API:
  - in a test build: `attempt to add with overflow` (mod.rs, `funding_for_in`);
  - in a release build, which checks no overflow, as `wasm-release` doesn't: `one box quoted at 1499999 lovelace`. The deposit was built, from a 50 ₳ input: fee 173,949, change 49,826,052, first output 18,446,744,073,709,551,615 lovelace.
- **Mutations**, each restored:
  - `funding()` unchecked: `attempt to add with overflow`;
  - the deposit's sum unchecked: an overflow panic in a test build; in release the deposit builds and the test's `unwrap_err` fails;
  - `per_box_in` unchecked: `attempt to add with overflow`.
- The final planner suite also passes in release, so no wrap is left on these paths.

## 318-rust#1 (low, correctness): **fixed**

- **Change.** `launch_from_account` drops the rows `eval::refusal` names before `account_inputs`, as the other Lovejoin transactions paid from the account do.
  - Those are rows carrying a reference script, or a datum the wallet can't read.
  - The collateral is still picked from all of `available`, since it isn't evaluated.
  - The function's doc says so.
- **Test.** `an_account_launch_never_spends_a_utxo_carrying_a_reference_script` (core `tests/lovejoin_launch_test.rs`).
  - Setup: 20 ₳ of ADA, 10 ₳ of ADA carrying a reference script, and 30 ₳ beside a token, with 5 ₳ of collateral set aside.
  - It spends the 20 ₳ and the token's UTxO and measures locally. The token comes back with the change, and `launched_pool` verifies.
  - A 40 ₳ scripted row alone is refused before anything is built ("There's nothing in the public account to pay for a launch").
- **Fail before.** The inputs were `[71…, 72…]` (the scripted one) against `[71…, 73…]`. With that assertion skipped, `measure_locally` gave the finding's symptom: "UTxO 7272…#0 holds a reference script, which the wallet can't evaluate with yet".
- **Mutation.** With the filter undone, the same inputs assertion fails. Restored.

## 319-rust#0 (low, correctness): **fixed**

- **Change.**
  - `plan_across`'s `kept` skips a leg with no box.
  - `deposit_across`'s token loop skips a leg with no owners.
  - Byte-identical otherwise: a zero leg whose token is held subtracted 0.
- **Test.** `a_token_leg_with_no_box_leaves_the_others_planned_and_deposited` (core `tests/lovejoin_planner_test.rs`).
  - The legs are [an unheld token's pool, LJTEST held for 2 boxes, classic]. The plan is [0, 2, 2], the same as without the first leg.
  - `deposit_across` with the zero leg is byte for byte the deposit without it.
- **Fail before.** `The UTxOs paying for these boxes don't hold enough of a pool's token / Can't Separate Assets / cannot subtract an asset that is not in the collection`.
- **Mutations**, each restored:
  - the plan's skip removed: the same failure, at the plan;
  - the deposit's skip removed: the deposit's version of it, "…don't hold enough of the pool's token … Can't Separate Assets".
- **Not done here (Lane L's file).** The finding also suggests that the worker's `acrossOf` count only rows WebAssembly can spend; see the notes.

## 319-rust#2 (nit, docs): **fixed** (the code comment)

- **Change.** The header of `wasm/src/lovejoin.rs` now describes chains as they are:
  - the deposit, in the classic pool (10 ₳ a box) or the pool a request names, a token pool's boxes taking its token, a return across pools putting each pool's in at once;
  - the mixes, `depth` waves deep in each box's own pool, three or four boxes a mix (`width`);
  - the collateral, put into a box and mixed once (`CollateralTail`) before the return's sweep, where a 5 ₳ pool takes it.
- The width doc's stale core path is already fixed: `docs-1` changed `lovejoin-mix-width.md` to name `seedelf-core/src/lovejoin/mod.rs`. Two other docs still cite the old path (see docs to update). No code comment does (grepped).
- No test: a comment only.

## Files touched

- `seedelf-platform/seedelf-core/src/eval.rs`: comment only.
- `seedelf-platform/seedelf-core/src/lovejoin/mod.rs`:
  - `counted`, test-only;
  - `deposit_across`'s zero legs and checked sums;
  - the planner's checked sums, `MORE_THAN_THERE_IS`;
  - `plan_across`'s zero legs, `bootstrap_most`.
- `seedelf-platform/seedelf-core/src/lovejoin/launch.rs`: `shaped`/`made`/`check_usable`/`spending`, `launch_apart`, `launch_from_account`'s filter, the unit test.
- `seedelf-platform/seedelf-core/src/lovejoin/pool.rs`: `verify_derived`, `derived_from`, a test-only counter.
- `seedelf-platform/seedelf-core/src/lovejoin/templates.rs`: one test-only counter line. The template bytes are untouched, and `templates_are_frozen` passes.
- `seedelf-platform/seedelf-core/tests/lovejoin_width_test.rs`
- `seedelf-platform/seedelf-core/tests/lovejoin_planner_test.rs`
- `seedelf-platform/seedelf-core/tests/lovejoin_launch_test.rs`
- `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs`: a comment, and `.unwrap()` on the now-fallible calls.
- `seedelf-platform/seedelf-core/tests/lovejoin_test.rs`, `tests/lovejoin_mainnet_test.rs`: `.unwrap()` only.
- `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs`: the header, `funding_at`, `chain_from_account_at`.
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs`: `.unwrap()` only.

## Keys

**None added or changed, critical or other.** Core's new refusal, "These boxes cost more ADA than there is", is English, as core's other refusals are. It's reachable only through a pool whose box ADA makes a sum pass 2^64 − 1 lovelace, more ADA than exists.

## Docs to update

1. **`WW/docs/lovejoin-mix-width.md`, "That it's the wallet's mix" (about line 38).** Now true:
   - The test compares the budgets the wallet's mix declares, redeemer by redeemer, besides what it uses, its fee and its size. It does so on the classic pools and on the token pool read by reference, at three and four boxes.
   - With that pool's scripts inline (how the wallet reads this preprod test pool), the mix declares what its scripts use.
   - Five boxes are refused at measurement (`mix_logic` alone needs more than `eval::MEASURE_LIMIT`).
   - A four-box mix whose scripts each fit but whose sum passes `MAX_TX_BUDGET` is refused by that sum (`the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation`, under a V3 cost model 2% dearer: 10.08 billion steps).
2. **`WW/docs/lovejoin-mix-width.md`, about line 139.** `eval::MEASURE_LIMIT` (14 billion steps) caps a transaction's scripts together, not each one: uplc runs each redeemer on what the ones before it left.
3. **`WW/docs/architecture.md:685`.** `owner_context` is in `seedelf-core/src/lovejoin/mod.rs`; `seedelf-core/src/lovejoin.rs` is 1.5.0's path. The same path is in `post-release-roadmap.md:366` (`MIX_FEE_ESTIMATE`), if that history is kept current.
4. **`WW/docs/architecture.md`, a return across pools (or chunk 34's 34g record of this review).**
   - A token leg planned no box takes none of its token, in the plan and the deposit (319-rust#0).
   - A pool whose box ADA makes a sum pass what a u64 holds gets no box in a plan and offers no Bootstrap. A quote, or a deposit, of its boxes is refused in words (314-core#1).
5. **`WW/docs/plans/chunk-34-token-pools.md`, 34g's record of this review.**
   - A private launch makes each seed's pool once and measures whether it's usable once, on the pool chosen, with what a launch locks as the selection's floor (314-core#0).
   - A launch from the public account never spends a UTxO carrying a reference script (318-rust#1).
6. **Optional, `wasm/README.md`, `lovejoinFunding`.** It throws "These boxes cost more ADA than there is" for such a pool.
7. **No `privacy.md` change and no policy entry.** Nothing new is asked, sent or shown to anyone else.

## Calls the owner might overturn

1. **314-core#1: checked sums, refusing in words, rather than bounding `box_lovelace` when a pool is read** (the finding's alternative).
   - This refuses nothing the chain would take. The launch of such a pool still builds, as the owner's "no upper limit" for an ADA pool allows.
   - It leaves the two decoders, the shared vectors and the data layer alone.
   - The words are Claude's.
2. **312#0: the five-box test asserts the measurement's refusal, not the guard's words.** Reaching the guard at five would need `eval::MEASURE_LIMIT` raised past 15 billion steps. That limit bounds the evaluator's work for every spend the wallet measures, so I didn't touch it. The four-box test is the one that reaches the guard.
3. **314-core#0: which refusal comes first for an unusable pool.** A launch whose terms make an unusable pool, from a balance too small to pay for it, now says "Not enough ADA in the Seedelf balance…" first. The selection runs before `usable` is measured. Before, every choice failed with "couldn't be used". The form's own check of a box's least value makes such terms all but unreachable. The alternative: measure `usable` on the first seed's pool before the selection. Its answer is the terms', but that relies on it for the pool chosen, or measures twice.
4. **314-core#0: test-only counters in `templates.rs` and `pool.rs`.** They're compiled out of the WebAssembly and the CLI. `templates.rs`'s frozen part is its bytes, which `templates_are_frozen` still checks. The alternative is counting only in `launch.rs`, which would lose the check that verifying doesn't derive again.
5. **318-rust#1: an account whose only UTxO big enough carries a reference script.** It's refused with the existing "There's nothing in the public account to pay for a launch", as the other account-paid Lovejoin builders don't count such rows. No new words.
6. **319-rust#0: the worker's wording for a zero leg.** A token whose only UTxO WebAssembly can't spend now gets a leg of 0 boxes, where the whole plan used to fail, and the worker's way for it reads `sess.skip.warn.noBox` ("too little ADA"), which isn't the reason. It's fixed in `acrossOf`, Lane L's file (notes).

## Notes for the lead and other fixers

- **The pkg rebuild.** No test of mine needs it: there's no TypeScript change. What shows after the rebuild:
  - Start a pool's review from the private balance is faster (each seed's pool made once, one withdraw measured);
  - an account launch passes over UTxOs carrying a reference script;
  - a plan across pools no longer fails when a token leg gets no box;
  - a pool whose box ADA overflows a u64 gives no box, or a refusal in words.
- **Checked against a private pkg built from this tree** (throwaway copies, deleted), with other lanes' TypeScript as it stood about 12:20:
  - the default build: 11 files, 209 passed, 2 skipped:
    - `lovejoin-1-5-0` (unedited);
    - `lovejoin-planner`, `lovejoin-flows`;
    - `lovejoin-merged-review`, `lovejoin-merged-screens`, `lovejoin-screens-review`;
    - `lovejoin-discovery`, `lovejoin-discovery-review-fixes`, `lovejoin-pools-head-start`;
    - `lovejoin-token-feed`, `wasm-review-fixes`;
  - with `VITE_ENABLE_MAINNET=false`: 5 of them, 150 passed.
- **seedelf-core's public API changed.** `per_box_in`, `funding_for_in` and `funding_for` return `Result<u64>`, and there's a new `lovejoin::MORE_THAN_THERE_IS`. The CLI uses none of them, and every workspace target compiles.
- **For Lane L (wlj-*): `acrossOf` and WebAssembly count held tokens from different rows.**
  - `acrossOf` (`lovejoin.ts`, the `held` loop, about line 3343) counts them from every own-or-fill row.
  - WebAssembly's `holdings_of` counts only rows its evaluator takes: no reference script, and a datum it can read.
  - If the worker counted the same rows, a token WebAssembly can't spend would stay out of `byToken`. It would then come back with the return as any token without a pool does, rather than show a way that says `sess.skip.warn.noBox`.
- **For rr-2.**
  - `launch.rs` is split into `shaped`/`made`/`check_usable`/`spending`.
  - `pool::verify_derived` is for a caller that has derived already.
  - `lovejoin::counted` holds the test counters (`DERIVES`, `MEASURES`).
- **Cleanup.** The private `wasm/pkg-rr-1/`, `wasm/tests-rr-1/`, `extension/tests-rr-1/` and `extension/vitest.rr-1.config.ts` are deleted. Two scratch logs sit in the scratchpad. The wasm-release build sits in the cargo target directory only; `build.sh` rebuilds it.

## Checks run

- **`cargo test -p seedelf-core --locked`:** every binary passes, among them:
  - the lib's unit tests: 2, the new one included;
  - `lovejoin_width_test`: 4, and 1 ignored (live);
  - `lovejoin_planner_test`: 12;
  - `lovejoin_launch_test`: 8;
  - `lovejoin_pools_test`: 31.
- **`cargo test -p seedelf-core --release --test lovejoin_planner_test`:** 12 pass, with no overflow checks, as in WebAssembly.
- **`cargo test -p seedelf-wasm --locked --no-fail-fast`** (native): every binary passes (api 85, lovejoin 23, lovejoin_flows 14, …).
- **`cargo test --workspace --locked --no-run`:** all 64 test executables compile, with no warnings.
- **`cargo clippy --locked -p seedelf-crypto -p seedelf-wasm -p seedelf-core --all-targets -- -D warnings`:** clean.
- **`cargo fmt --all -- --check`:** clean. My fmt run changed only files I'd edited.
- **`cargo build -p seedelf-cli --locked`:** builds.
- **Private `wasm-release` pkg:** `node --test` on every `wasm/tests/*.test.mjs`, 57/57.
- **Vitest on that pkg:** as in the notes.
- **Not run: `npm run typecheck`, and Vitest on the shared pkg.** No TypeScript changed.
