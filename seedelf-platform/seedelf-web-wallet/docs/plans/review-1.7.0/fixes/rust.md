# Rust lane: overflow traps since #332, the profile's test, its docs

The tree is `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`. All paths below are relative to `W/seedelf-platform/`.

**Status:**
- All of seedelf-core's tests pass (`cargo test --locked -p seedelf-core`: 32 binaries, 0 failures).
- All of seedelf-wasm's native tests pass (`cargo test --locked -p seedelf-wasm`: 15 result lines, 0 failures). Both runs include the other fixers' changes in the tree.
- `cargo fmt -p seedelf-core` has been run. It formats the whole crate, so it also covered the other fixer's lines in `lovejoin/mod.rs` and `lovejoin_pools_test.rs`, formatting only.
- I changed no seedelf-crypto or seedelf-wasm Rust source, so no clippy run was needed.

**The lead must:**
- rebuild `wasm/pkg`;
- run `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`. The new pool test fails on today's module with `RuntimeError: unreachable`, and should pass on the rebuilt one.

## The review's findings

### x-overflow#0: fixed
- **Before:** `eval::resolve` summed a row's token quantities with a plain `+=`. A row naming one token twice past a u64 panicked at `eval.rs:148:9` ("attempt to add with overflow"), which is the store module's trap.
- **Now:** `checked_add`, refused in words naming the UTxO: `UTxO <hash>#<index> holds more of a token than one output can`. Within a u64 the two entries are still one amount, as before. This is not a new guard: no output can hold that much.
- **Tests (each failed before, passes now):**
  - `seedelf-core/tests/eval_test.rs` `a_row_naming_a_token_past_what_an_output_holds_is_refused_in_words`. It covers `resolve_row` and `resolve_reference`, and checks that a sum up to `u64::MAX` is still one amount. Before the fix it panicked at `eval.rs:148:9`.
  - `seedelf-core/tests/orders_test.rs` `a_reference_row_naming_a_token_past_what_an_output_holds_is_refused_in_words`. This is the cancel's Koios reference row (`orders.rs:793`), on the stopping session's loop, which the sweeps flagged. I ran it against a temporary revert of the fix: it panicked in `resolve`. I then restored the fix.
  - WebAssembly node test `wasm/tests/lovejoin-pools.test.mjs`: "a pool row naming its NFT twice, past what an output holds, is refused in words, the module whole (1.7.0's release review, x-overflow#0)".
    - It runs `lovejoinVerifyPool` and `lovejoinCandidate` twice each, then checks a 1 + 1 row still reads as no pool, and a real pool still verifies.
    - On today's `wasm/pkg` it fails with `RuntimeError: unreachable`. It needs the rebuild.
- **What the one change covers:**
  - every `resolve_row` and `resolve_reference` caller: pool verification, `candidate`, `launch_check`, `measure_locally` (build-b's unprotected `buildRemove`), and the cancel's reference row;
  - the extension's handling: `tried` (`lovejoin-pools.ts`) and `verifiedPool` (`lovejoin.ts`) already leave out a pool refused in words.
- **Files:** `seedelf-core/src/eval.rs`, `seedelf-core/tests/eval_test.rs`, `seedelf-core/tests/orders_test.rs`, `seedelf-web-wallet/wasm/tests/lovejoin-pools.test.mjs`.

### x-upgrade#0: fixed by the same change
- A row 1.6.0 kept, verified only by wrapping, now fails verification in words in the 1.7.0 module. `verifiedPool` then leaves it out of the read set without a lock. No TypeScript change was needed.
- **Tests:** the core test and the node test above.
- **Not written:** the finding's extension test (the real module over a stored 1.6.0 record). It could only pass after the rebuild, and it repeats two existing tests: the node test, and `wasm-review-fixes.test.ts`'s "A refusal in words is only a pool left out". It's optional, if the lead wants it.

### pr332#0, x-overflow#1, x-docs#7: fixed (docs and comments)
- **What I checked against the code:**
  - x-overflow#1's claim holds. seedelf-wasm's plain `+` and `.sum()` add counts, fees or lovelace: `holding_enough`, `Worth::apart` via `adds`, `Holdings::spare` and the `total +=`. Its token totals are u128 (`quantity_of`, `held`, `gone`). It checks by hand only in cip30's `Amount` and `chain_from_account_at`'s `needed`.
  - I took pr332#0's rule from its two verifiers: a check goes with the crate that compiles the code.
- **Files changed:**
  - `CLAUDE.md:94`, now a bullet with two sub-bullets: the overrides and their test, where the line falls, "no crate leans on the checks", and what seedelf-wasm's sums are;
  - `Cargo.toml`'s comment on the overrides;
  - `seedelf-web-wallet/wasm/README.md:115`;
  - `seedelf-web-wallet/docs/architecture.md:99`, plus a new sub-bullet after it;
  - `seedelf-web-wallet/docs/post-release-roadmap.md:387`, and `:38`, which pr332#0's trace verifier added;
  - the `MORE_THAN_THERE_IS` doc in `seedelf-core/src/lovejoin/mod.rs`.
- **Not changed:** "LTO" in README and architecture. pr332#0's trace verifier says Cargo applies no LTO to seedelf-wasm (cdylib+rlib); the docs name the profile's setting. I didn't verify this. It's the lead's call.

### pr332#1 / x-mut-rs#2: fixed (a test)
- **The test:** a new `seedelf-core/tests/wasm_profile_test.rs`.
  - `the_store_module_checks_overflow_in_core_crypto_and_koios` reads the workspace `Cargo.toml`. Each of core, crypto and koios must have `overflow-checks = true` under `[profile.wasm-release]`, by its own package setting or else the profile's. `build.sh` must build with `--profile wasm-release` and hand wasm-bindgen that profile's module.
  - `the_settings_are_read_in_each_form_cargo_takes` checks the small TOML reader. It covers headers, quoted names, dotted keys, inline tables and the profile-level setting; every fixture parses as valid TOML (checked with Python's tomllib). It also covers an off and an absent setting.
  - The lock has no TOML crate, so the test brings no new dependency.
- **Shown to fail:** with core's section alone removed (`left: ["seedelf-core"]`, the case a grep of the module misses), and with all three removed. It passes on the tree's `Cargo.toml`. The demonstration used scratch copies of `Cargo.toml`, never the tree's.
- **Limits:** it reads settings, not codegen, so pr332#0's codegen drift isn't caught. Optional: a `build.sh` check of cargo's JSON artifact messages (`"overflow_checks":true` per package), which x-mut-rs's impact verifier tested in scratch. I didn't edit `build.sh`, since I can't run it.

## The lead's known sites

| Site | Outcome | Test |
|---|---|---|
| `eval.rs:148` | fixed (above) | above |
| `build.rs` `apart` 2669, 2677, 2722 | fixed: u128 totals, which are only compared or sorted on. Behaviour for honest values is identical. | `seedelf-core/tests/apart_test.rs` `lovelace_past_what_a_u64_holds_is_never_summed_into_a_trap_when_choosing` |
| `build.rs` ~888 (`held`, account send) | **not-a-bug**: bounded | probe (deleted) |
| `build.rs` ~2950 (`holding`'s first `have`) | **not-a-bug**: bounded | probe (deleted) |

**`apart` test detail:** three cases, each failing before.
- Case 1 panicked at 2669.
- Case 2 panicked at 2677 (2681 in the reverted copy), shown with case 1 skipped.
- Case 3 panicked at 2722, shown with cases 1–2 skipped. It needed a second class, because a one-element sort never computes its key.
- The check was a temporary revert of my own lines, since restored (diffed against a saved copy).
- All three now end in the spend's existing words, "Lovelace sum overflow".

**Why ~888 and ~2950 are bounded:**
- Both see only `fitting`'s output (`utxos.rs:392`). `fitting` refuses a row whose own tokens overflow (`assets_of`), and leaves out any UTxO that would push a token's total past a u64 (checked `Assets::merge`).
- **Probes** (a debug build, so overflow-checked; the file is deleted):
  - three UTxOs of 2^63−1: `held`/`have` top out at 2^64−2;
  - picking `u64::MAX` is refused in words ("holds only 18446744073709551614");
  - a row naming the token twice is refused whole ("Can't Add Assets").
- The sweeps build-a and build-b agree.
- **Optional:** `saturating_add` there is behaviour-neutral belt-and-braces. It's the lead's call; I changed nothing, per the brief.

## The sweep's sites

`ovf-sweep-build-a`, `-build-b`, `-lovejoin` and `-rest` were read.

| Site | Outcome | Test |
|---|---|---|
| `orders.rs:901` (`build_cancel`'s `keep`; confirmed by `ovf-verify-lovejoin-1`) | fixed | `seedelf-core/tests/orders_test.rs` `an_order_reported_near_what_a_u64_holds_never_overflows_its_cancel` |
| `lovejoin/mod.rs:1392` (`withdraw_with`'s `into_register`) | fixed | `seedelf-core/tests/lovejoin_pools_test.rs` `a_private_payer_holding_more_ada_than_there_is_is_refused_in_words` |

**`orders.rs:901`:**
- **Before:** panic at `orders.rs:901:26`.
- **Now:** `refunded.checked_add(6 ₳)` then `lovelace_in.checked_sub`. This is identical wherever the sum fits. Where it doesn't, `None` is what exact arithmetic gives. The cancel builds, and the ledger refuses the lie.

**`lovejoin/mod.rs:1392`:**
- **Before:** panic at `mod.rs:1392:32`.
- **Now:** `checked_add`, refused as `UTxO <hash>#<index> holds more ADA than there is`. A value up to a u64 with the box still builds.
- **Its caller:** seedelf-wasm's `withdraw_private_in` stops on this error (only `PrivateTooSmall` moves on). So Bring every box back now records the reason and stops after `BRING_FAILED_RUNS`, rather than locking at each unlock.
- **Verification:** no per-site verifier report existed when I finished. Both sweeps reproduced it, and so did I.

**Latent, not changed:** the sweeps show each is unreachable today. Hardening any of them is the lead's call, and none is a guard.
- `build.rs` `even` (1138), `collateral_output` (1146) and `Budgets::with_margin` (1299);
- `ScriptSpend::settle`'s budget fold (1991–1993), which no export feeds outside budgets;
- the account branch's `fee * 3 / 2` (2199);
- `lovejoin` `mixes_per_box_at`'s `pow`, on a depth only the worker bounds (1632).

**Missing at the time of writing:**
- only `ovf-verify-lovejoin-1.md` existed under `verify/`;
- there was no `ovf-verify-*` for `lovejoin/mod.rs:1392`, nor for anything in build-a, build-b or rest. Those sweeps report no new sites beyond the ones above.

## Strings, keys, specs, tests, docs

- **UI strings / locale keys:** none.
- **New core error messages** (English, shown raw as core's are, never matched by the extension):
  - `UTxO <hash>#<index> holds more of a token than one output can` (`eval.rs`);
  - `UTxO <hash>#<index> holds more ADA than there is` (`lovejoin/mod.rs`).
- **Critical keys:** none.
- **e2e specs:** none.
- **WebAssembly node tests:** the one test added in `wasm/tests/lovejoin-pools.test.mjs`. It needs the lead's rebuild.
- **Privacy policy:** no data-handling change, so no *Changes* entry.
- **For the docs lanes:**
  - A pool row naming a token twice past a u64 is now a pool left out, in words. Before, it trapped the module and locked the wallet at every pool read.
  - A private UTxO an index reports past what there is stops Bring every box back now in words.
  - A Splash order reported near 2^64 lovelace no longer traps a stopping session's cancel.
  - The profile docs are done (above).
- **Noted, not mine:** ovf-sweep-rest notes that `deposit_across`'s kept merge and a cancel's `assets_of(spent)` refuse, in words, a set of inputs holding more than a u64 of one token together, though the ledger would take one whose outputs split it. It's a refusal, not a trap, and a question for whoever owns those builders.
