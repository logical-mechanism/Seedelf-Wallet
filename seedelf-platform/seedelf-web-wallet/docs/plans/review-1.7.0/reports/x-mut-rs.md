# x-mut-rs: do the range's Rust tests fail without their fix?

Label `x-mut-rs`, a cross-PR lens over #325 to #338, on HEAD `6bca8bec`.

The range's Rust:

- **#333:** core's `bootstrap_back_reserve`, `bootstrap_most` building with it, the WebAssembly's `lovejoinBootstrapReserve(paramsJson)`, and the rewritten core test.
- **#332:** three `[profile.wasm-release.package.*]` sections, plus comments.
- **#328:** a lockfile bump.

No other PR in the range touches a `.rs` file.

## Verdict

**#333's core test really tests its main claim, the price of a byte.** Undoing either half of the fix fails it:

- the reserve back to a fixed 1.5 ₳ fails `lovejoin_pools_test.rs:1802`;
- the cap built with a fixed 1.5 ₳ fails `:1808` (68, not 96);
- the binding back to the fixed figure fails two Vitest tests, on a module rebuilt in the copy.

**Score.**

| Mutants of | Run | Caught by the Rust tests | Caught by Vitest's pin only | Equivalent | Survive everything |
|---|---|---|---|---|---|
| the reserve | 17 | 10 | 3 | 2 | 2 (F2) |
| the cap | 9 | 4 | | 4 | 1 (F1) |

Vitest's pin is its exact "1800000" at 6,465 lovelace a byte. An equivalent mutant changes nothing any parameter row I tried can see.

**Two real gaps, both left by #333's rewrite of its test:**

- **F1 (low):** since #333, no test makes `bootstrap_most`'s search bind. A cap that skips the search passes all 4 Rust tests and 591 Vitest tests in the 20 files that reach the Bootstrap.
- **F2 (low):** no test varies the reserve's fee terms. A reserve that ignores `min_fee_a`/`min_fee_b` passes everything, and at a dearer byte and fee it brings #333's own bug back.

**And three more:**

- **F3 (low):** #332's overrides have no test. This is pr332's F2, and I confirmed it: without them the module carries no overflow check and all 57 WebAssembly node tests pass.
- **F4, F5 (nits):** the binding's own tests, and fixtures that encode the old fixed figure.

## How the mutants ran

- **The copy:** `seedelf-platform/` without `target/`, at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/x-mut-rs/`, built with its own `CARGO_TARGET_DIR` (removed after).
- **The switches:** each mutant is a switch in the copy's `bootstrap_back_reserve`, `bootstrap_most` and `lovejoin_bootstrap_reserve`. Native tests read `XMUT` at run time; the WebAssembly reads `XMUT_BUILD` at compile time (`option_env!`).
- **The tests:** only four tests reach these functions, directly or through anything else. Each native mutant ran all four:
  - **pools:** core's `a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for`;
  - **planner:** core's `a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped`;
  - **flows:** seedelf-wasm's `a_private_bootstrap_of_a_token_pool_deposits_and_sweeps_back`;
  - **lj:** seedelf-wasm's `a_bootstrap_with_no_collateral_deposits_and_sweeps_back`.
- **Baseline:** all four pass.
- **The modules:** `cargo build --profile wasm-release --target wasm32-unknown-unknown` (37 s each), then `wasm-bindgen` into the copy's `pkg`. `wasm/build.sh` was not run.
- **The Vitest runs:** in the copy's extension, with `node_modules` linked back to the tree's. The baseline module passed the same tests first.

### `bootstrap_back_reserve` (mod.rs:1744-1751)

**Caught by the Rust tests:**

| Mutant | What it does | Caught at |
|---|---|---|
| R_CONST | the fixed 1.5 ₳: #333 undone in the reserve | pools:1802 |
| R_NO_FLOOR | no 1.5 ₳ floor (1.1 ₳ today) | pools:1783 |
| R_NO_ROUND | not rounded to 0.1 ₳ | pools:1803 |
| R_ROUND_ADA | rounded up to a whole ADA | pools:1783 |
| R_NO_SUB | `DEPOSIT_RESERVE` not taken off | pools:1783 |
| R_NO_SEEDELF | the Seedelf output's least dropped | pools:1802 |
| R_NO_SWEEP | the sweep's fee dropped | pools:1808 (cap 96 fails) |
| R_NO_DEPOSIT | the deposit's fee dropped | pools:1802 |
| R_DEPOSIT_TAIL | the deposit priced at 500 bytes, not 16 KiB | pools:1802 |
| R_BASE_LEAST | a base address's least for the Seedelf output's | pools:1802 |

**Caught by Vitest's pin only:**

| Mutant | What it does | What catches it |
|---|---|---|
| R_MINUS_TENTH | 0.1 ₳ less above the floor (1.7 ₳ at 6,465) | Run: two tests, `expected '1700000' to be '1800000'` |
| R_ROUND_DOWN | rounded down (1.7 ₳ at 6,465) | The same pin: its outputs at both TS rows are R_MINUS_TENTH's (not rebuilt) |
| R_PLUS_TENTH | 0.1 ₳ more (1.9 ₳ at 6,465) | The same pin (not rebuilt) |

**Equivalent:**

| Mutant | What it does | Why it's equivalent |
|---|---|---|
| R_NO_DRAFT_FLOOR | the sweep at `linear_fee(400)` without the 0.2 ₳ first draft | Same figure at every row tried |
| R_SWEEP_FIXED | the sweep's fee hard-coded at 0.2 ₳ | Equivalent until `linear_fee(400)` passes 0.2 ₳ (`min_fee_a` ≥ 112 or `min_fee_b` ≥ 182,401) |

**Survive everything:**

| Mutant | What it does | Notes |
|---|---|---|
| R_DEPOSIT_FIXED | the deposit's fee hard-coded at 876,277 (today's 16 KiB) | F2 |
| R_FEES_FIXED | both fee terms hard-coded | F2. No TS test sets a fee field, so the module answers every TS input as HEAD does |

### `bootstrap_most` (mod.rs:1960-2033)

**Caught by the Rust tests:**

| Mutant | What it does | Caught at |
|---|---|---|
| M_FIXED_BACK | the cap built with the fixed 1.5 ₳: #333 undone in the cap | pools:1808 |
| M_ZERO_BACK | no way-back reserve in the cap | pools:1737, flows:355, lj:346 |
| M_NO_MOST0 | `most == 0` not checked | pools:1746 |
| M_NO_FITS1 | `fits(1)` not asked first | planner:620 |

**Survives everything:**

| Mutant | What it does | Notes |
|---|---|---|
| M_RETURN_MOST | no search: `most` whenever one box fits | All 4 Rust tests pass, and the 20 Vitest files that reach the Bootstrap's cap or reserve: **591 tests pass**. F1 |

**Equivalent:**

| Mutant | What it does | Why it's equivalent |
|---|---|---|
| M_NO_SWEEP | the way back's sweep not built | The priced reserve bounds the way back, so the sweep can't fail where the deposit builds. Same cap at every row tried, binding ones included |
| M_BACK_MORE | the cap's funding 1 ₳ over the worker's | More ADA can't move a cap held by the deposit's size or by `MAX_FEE` |
| M_DEPTH1 | the cap's funding at depth 1 | Likewise |
| M_BACK_LESS | the cap's funding 0.1 ₳ under | The conservative direction, and inside the slack at the rows tried |

### `lovejoinBootstrapReserve` (wasm/src/lib.rs:5767-5774)

| Mutant | What it does | Rust tests | 57 WebAssembly node tests | Vitest |
|---|---|---|---|---|
| W_CONST | ignores the parameters and answers 1.5 ₳, the shape before #333 | None calls the binding | None calls it | **Caught**, 2 tests (below) |
| W_SWALLOW | answers 1.5 ₳ to parameters it can't read, rather than an error | Pass | Pass | The 4 tests that call it pass. F4 |

W_CONST's two failing tests:

- `lovejoin-flows` "caps a Bootstrap…": `{ most: 96, back: '1500000' }` against `'1800000'`;
- `lovejoin-release-rules` "counts the funding's reserves…": `expected '1500000' to be '1800000'`.

### #332's overrides

I removed the three sections from the copy's Cargo.toml and rebuilt.

| | Without the sections | With them |
|---|---|---|
| "attempt to add with overflow" | 0 | 1 (as in the tree's `pkg`) |
| "attempt to subtract with overflow" | 0 | 1 |
| "attempt to multiply with overflow" | 0 | 1 |
| Raw size | 3,206,077 bytes | 3,214,445 bytes |
| Gzipped | 983,009 bytes | 987,533 bytes |
| WebAssembly node tests | 57 of 57 pass | |

`cargo test` builds the test profile, where overflow is checked either way.

## Findings

### F1 (low, tests): since #333, no test makes `bootstrap_most`'s search bind, so a cap that skips it passes everything

**Files:**

- `seedelf-core/src/lovejoin/mod.rs:2020-2032`;
- `seedelf-core/tests/lovejoin_pools_test.rs:1734-1813`;
- `seedelf-core/tests/lovejoin_planner_test.rs:620-623`;
- `extension/tests/lovejoin-flows.test.ts:499-507`.

**Claim.** Every committed assertion on the cap expects either the `most` it was asked or 0:

- the `most` asked: 96 and 12 in the classic pool, 64 in a token pool, and 96 and 64 at 6,465;
- 0: for `most` 0, and for a pool where one box can't be paid.

#333 replaced the only case where the cap bound below what was asked. Before it, the 6,465 case asserted `(1..96).contains(&dear_most)`, then `bootstraps(dear_most)` builds and `bootstraps(dear_most + 1)` doesn't (68 boxes; `git show b2c3940f^1:seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs`, lines 1776-1780). The TS tests ask for 96 and 64 under the fixture's parameters, where those fit.

**Evidence.** M_RETURN_MOST (`return Ok(most)` once `fits(1)` holds) passes the 4 Rust tests and 591 Vitest tests in 20 files. Probed in the copy:

| Asked | Parameters | HEAD's cap | M_RETURN_MOST's cap | Why HEAD stops there |
|---|---|---|---|---|
| 200 classic boxes | today's | 107 | 200 | A deposit of 108 is 16,428 bytes, over 16,384 |
| 96 classic boxes | `min_fee_a` 1,000, `min_fee_b` 2 ₳ | 51 | 96 | 52's deposit: "This transaction's fee would be 10.028000 ADA, over the wallet's limit of 10.000000 ADA" |

**Scenario.** A later simplification passes CI, for example `fits(most)` in place of the search, or an off-by-one in it. Today the search binds only where a deposit's fee passes `MAX_FEE` (10 ₳). The worker asks `mostBootstrap`, 96 or 64, which is under one deposit's size (107 or 80 boxes at today's parameters). It would also bind if `MAX_DEPOSIT_BOXES` were raised to let the cap decide. Where it binds, a broken search lets the form offer more boxes than a deposit holds. The session is funded, its deposit is refused, and it comes back directly with no box in and a second fee (318-rust#0's outcome).

**Fix.** One case where the cap binds, under 1 s in debug:

```rust
// Asked past what one deposit holds (16 KiB), the cap is the most that builds, and one more doesn't.
let cap = lovejoin::bootstrap_most(&params(), &classic, true, 200).unwrap();
assert!((96..200).contains(&cap), "{cap}");
assert!(bootstraps(&params(), &classic, true, cap).is_some());
assert!(bootstraps(&params(), &classic, true, cap + 1).is_none());
```

**Test.** That case, run in the copy: it passes on HEAD's code (cap 107) and fails under M_RETURN_MOST. M_NO_SWEEP, M_BACK_MORE and M_DEPTH1 still pass it, as equivalents should. Since #333 the reserve bounds the way back (pr333's verdict), so `fits`' sweep is belt and braces that no parameter row reaches.

**Confidence:** high.

### F2 (low, tests): no test varies the reserve's fee terms, so a reserve that ignores the fee parameters passes everything, and brings #333's bug back for fees

**Files:**

- `seedelf-core/src/lovejoin/mod.rs:1746-1748`;
- `seedelf-core/tests/lovejoin_pools_test.rs:1783-1790` and `1796-1799`;
- `seedelf-core/tests/fixtures/epoch_params.json` and `epoch_params_mainnet.json`;
- `extension/tests/lovejoin-release-rules.test.ts:503`;
- `extension/tests/lovejoin-flows.test.ts:506`.

**Claim.** The reserve follows two kinds of parameter:

- the Seedelf output's least, from `coins_per_utxo_size`;
- the sweep's and the 16 KiB deposit's fees, from `min_fee_a` and `min_fee_b`.

Every test moves only the first:

- both fixtures are 44 / 155,381 / 4,310, so the mainnet assertion at :1787-1790 repeats :1783-1786 on the same inputs;
- the core test's dearer row is `coins_per_utxo_size * 3 / 2` alone;
- the TS rows set `coins_per_utxo_size: "6465"` alone;
- no test in the extension, the WebAssembly or core's two Lovejoin test files sets a fee field for this formula.

**Evidence.** R_FEES_FIXED (the sweep at 200,000 and the deposit at 876,277, today's figures) passes the 4 Rust tests, and so does R_DEPOSIT_FIXED. Both give the same figures at every row a TS test uses. Probed in the copy:

| Parameters | HEAD: reserve, cap classic / LJTEST | R_FEES_FIXED: reserve, cap classic / LJTEST |
|---|---|---|
| 6,465, `min_fee_a` 55 | 2.0 ₳, 96 / 64 | 1.8 ₳, 90 / 64 |
| 6,465, `min_fee_a` 66 | 2.2 ₳, 96 / 64 | 1.8 ₳, 75 / 56 |
| 6,465, `min_fee_b` 300,000 | 2.1 ₳, 96 / 64 | 1.8 ₳, 74 / 55 |
| `min_fee_a` 600 | 10.4 ₳, 96 / 64 | 1.5 ₳, 9 / 7 |

**Scenario.** A later edit drops the fee dependence, a constant for the 16 KiB deposit's fee for example, and CI stays green. At a dearer byte with a dearer fee, a private Bootstrap is held below one deposit's most again. That's the regression #333 fixed (68 classic boxes at 6,465), now for fees. No money is at risk: the cap and the funding use the same figure.

**Fix.** A row in the core test with both moved:

```rust
// The fees move too: the way back's reserve follows them, and one deposit's most still goes.
let dearer = ProtocolParameters {
    coins_per_utxo_size: params().coins_per_utxo_size * 3 / 2,
    min_fee_a: params().min_fee_a * 3 / 2,
    ..params()
};
assert_eq!(lovejoin::bootstrap_back_reserve(&dearer).unwrap(), 2_200_000);
assert_eq!(lovejoin::bootstrap_most(&dearer, &classic, true, 96).unwrap(), 96);
assert!(bootstraps(&dearer, &classic, true, 96).is_some());
```

**Test.** In the copy:

- HEAD's code passes it: 2.2 ₳, cap 96.
- R_FEES_FIXED and R_DEPOSIT_FIXED fail it: 1.8 ₳, cap 75.
- R_SWEEP_FIXED stays equivalent there: the 0.2 ₳ first draft is the larger until `min_fee_a` ≥ 112 or `min_fee_b` ≥ 182,401.

**Confidence:** high.

### F3 (low, tests): nothing fails without #332's overrides (pr332's F2, confirmed)

**Files:**

- `seedelf-platform/Cargo.toml:44-58`;
- `seedelf-web-wallet/wasm/build.sh:61-75`;
- `extension/package.json`, `build:wasm` and `package`.

**Claim.** The PR's behaviour has no test, so a tidy-up of Cargo.toml that drops the three sections ships a wrapping module with CI green. Merging profiles or renaming a crate would do it.

**Evidence.** The rebuild in "#332's overrides" above:

- the module carries none of the three overflow messages, against one each with the sections;
- all 57 WebAssembly node tests pass;
- the Rust tests can't see it, since the test profile checks overflow either way.

**Scenario.** As x-release#7 had it: a sum past its type wraps to a small, false figure in the store's module, while every test build panics.

**Fix.** Worth having, and cheap. pr332's line at the end of `build.sh` is the one that guards the store's zip itself: `npm run package` runs `build:store` → `build` → `build:wasm`, which is `build.sh`.

```bash
grep -aq "attempt to add with overflow" "$wasm" || { echo "The module carries no overflow check: Cargo.toml's wasm-release overrides are gone" >&2; exit 1; }
```

A text check of Cargo.toml beside `wasm/tests/readme_test.rs`, which already reads files to catch drift, would fail earlier, in CI's Rust tests. It wouldn't catch `build.sh` dropping the profile; the grep catches both.

**Test.** That line: `build.sh` exits 1 on the module without the sections (0 matches) and passes on HEAD's (1 match).

**Confidence:** high.

### F4 (nit, tests): the WebAssembly's own tests never call `lovejoinBootstrapReserve`, and nothing tests that it refuses parameters it can't read

**Files:** `wasm/src/lib.rs:5767-5774`; `wasm/tests/lovejoin-reserve.test.mjs:10` and `:22`.

**Claim.** The reserves' node test covers the two collateral reserves, including `assert.throws(() => lovejoinDirectCollateralReserve("{}"))`. It doesn't cover the new binding beside them, which only Vitest pins (it did catch W_CONST). W_SWALLOW passes everything that runs on it:

- every Rust test, since none calls the binding;
- the 57 node tests;
- the four Vitest tests that call the binding.

**Scenario.** None reachable today. Both callers ask `lovejoinBootstrapMost` first, with the same row, and it refuses a row it can't read:

- `mixOutBuild` calls `privateBootstrapMost` at sessions.ts:2023, before `mixFunding` at :2030;
- `privateBootstrapBounds` (lovejoin.ts:2967-2969) calls it first too.

A new caller asking for the reserve alone would fund on 1.5 ₳ from a row it couldn't read.

**Fix.** Three lines in `lovejoin-reserve.test.mjs`:

- `"1500000"` at the fixture;
- `"1800000"` at `coins_per_utxo_size: "6465"`;
- `assert.throws(() => lovejoinBootstrapReserve("{}"))`.

**Test.** The third line fails under W_SWALLOW; all three pass on HEAD's module (probed: `1500000`, `1800000`, `Error: Missing min_fee_a`).

**Confidence:** high.

### F5 (nit, tests): the WebAssembly's Bootstrap tests still fund the fixed 1.5 ₳, while they say they fund "exactly as the worker funds it"

**Files:**

- `wasm/tests/lovejoin_flows_test.rs:324-325`, `356` and `519`;
- `wasm/tests/lovejoin_test.rs:314-316` and `348`;
- `extension/src/background/sessions.ts:2096`.

**Claim.** Since #333 the worker adds `lovejoinBootstrapReserve(params)`, but these tests add `BOOTSTRAP_BACK_RESERVE`. At the fixture's parameters the two agree, so these tests pass:

- with #333 undone in either half (R_CONST, M_FIXED_BACK);
- with a reserve below the constant (R_NO_FLOOR).

Only M_ZERO_BACK fails them.

**Scenario.** Two ways this goes wrong:

- **The fixture moves to a dearer row:** these tests fund less than the worker and fail on a test bug.
- **The reserve falls under 1.5 ₳:** these tests don't notice. Core's :1783 does.

**Fix.** Fund with `seedelf_core::lovejoin::bootstrap_back_reserve(&ProtocolParameters::from_koios(&params()).unwrap()).unwrap()`, the worker's figure.

**Test.** With the fix, the tests fund what the worker funds at any fixture row. R_NO_FLOOR then funds 1.1 ₳ there, which is still enough, so core's :1783 stays the check on the floor.

**Confidence:** high.

## Already reported elsewhere (not repeated)

- pr333's finding 4: core's 6,465 token case uses LJTEST, whose 2 ₳ box is under the ledger's least at that price.
- pr333's finding 1: the form's fixed fee room.
- pr332's F1: what's checked follows the crate that compiles the code, not the one that defines it.

## Coverage

- **Read:**
  - #332's and #333's diffs, and HEAD's `bootstrap_back_reserve`, `bootstrap_most`, `deposit_across`, `settle`/`check_fee`/`MAX_FEE`, the binding and `bootstrap_most_in`;
  - the four tests, and every other caller found by grep (none);
  - the TS callers and tests of the cap and the reserve, CI's workflow and the npm scripts;
  - the pr332 and pr333 reports.
- **Ran:**
  - 26 native mutants × 4 tests;
  - a probe of the reserve and the cap under the surviving mutants, across 9 parameter rows;
  - both proposed tests under 13 mutants;
  - five rebuilt modules:
    - W_CONST, W_SWALLOW and R_MINUS_TENTH, through the four Vitest tests that call the binding;
    - W_SWALLOW and the module without the overrides, through the 57 node tests;
    - M_RETURN_MOST, through 20 Vitest files and 591 tests.
- **The tree:** no tracked file edited and no scratch file in it. The copy's `target/` is removed; the copy, its switches, scripts and logs stay under the scratch path above.

## Not checked

- The whole Vitest suite (the brief forbids it), e2e and the preprod-only build.
- R_ROUND_DOWN, R_PLUS_TENTH, R_FEES_FIXED and R_DEPOSIT_FIXED weren't rebuilt into modules. Their figures at every TS test's parameters come from native runs:
  - R_ROUND_DOWN's equal R_MINUS_TENTH's, which Vitest caught;
  - the fee mutants' equal HEAD's, since no TS test sets a fee field.
- Mutants of `bootstrap_most_in`, which the range doesn't change.
- No network.

## CLI notes

None. `bootstrap_back_reserve` and `bootstrap_most` serve only the web wallet's WebAssembly, and #332 doesn't touch the CLI's `release` profile (pr332's CLI note covers that).
