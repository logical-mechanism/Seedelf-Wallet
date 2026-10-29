# v-x-mut-rs-4-trace: verifying x-mut-rs#4

**Finding:** the WebAssembly Bootstrap tests fund the fixed 1.5 ₳ while saying they fund exactly as the worker does.

**Verdict: partly.** Severity **nit** (tests only, no product effect).

## What is real

Two seedelf-wasm tests say they fund exactly as the worker does, but they don't any more:

- `wasm/tests/lovejoin_flows_test.rs:325`, on `a_private_bootstrap_of_a_token_pool_deposits_and_sweeps_back` (`:331`).
- `wasm/tests/lovejoin_test.rs:314`, on `a_bootstrap_with_no_collateral_deposits_and_sweeps_back` (`:320`).

Both still add the constant `BOOTSTRAP_BACK_RESERVE` (flows `:356`, lovejoin_test `:347-348`). Since #333 the worker adds `lovejoinBootstrapReserve(JSON.stringify(params))` (`sessions.ts:2096`), which is core's `bootstrap_back_reserve(params)` (`wasm/src/lib.rs:5767-5774`).

Before #333 the binding returned the constant (`lovejoin_bootstrap_reserve() -> BOOTSTRAP_BACK_RESERVE.to_string()`), so the tests matched the worker then. #333 didn't touch `wasm/tests/`: `git diff --stat b2c3940f^1 b2c3940f` lists no file there.

**At the fixtures the two figures agree.** Both fixtures are 4,310 lovelace a byte:
- flows uses `seedelf-core/tests/fixtures/epoch_params.json` row 0, epoch 290;
- lovejoin_test uses a JSON row it builds by hand.

There, `bootstrap_back_reserve` works out to 1.1 ₳ and the floor `.max(BOOTSTRAP_BACK_RESERVE)` at `core/src/lovejoin/mod.rs:1750` lifts it to 1.5 ₳. So today the tests fund exactly what the worker funds. Nothing fails on HEAD.

**Scenario 1 holds.** On a fixture row at a dearer byte, these two tests fund less than the worker and fail because of the test, not the code. My scratch run used core's own dearer byte of 6,465 lovelace, the only change to each test's own row:
- The worker's figure is 1.8 ₳.
- `bootstrap_most_in` still returns one deposit's most, since `bootstrap_most` prices its cap from the parameters since #333 (`mod.rs:1974`): 64 LJTEST boxes and 96 classic.
- HEAD's funding, with the constant, fails both bodies at that most: `"64 boxes, funded 131000000: A Seedelf deposit of these tokens needs at least 2.185170 ADA"`, and the same for 96 boxes funded 963000000. That's the way back's sweep falling below its Seedelf least at that price.
- With the worker's 1.8 ₳, both bodies build: 64 boxes funded 131300000 and 96 boxes funded 963300000.

## What is narrower or wrong

- **Two documented tests, not three.** The third place, flows `:519`, is in `every_deposit_into_a_token_pool_reads_its_reference_utxo` (`:457`). It never says it funds the worker's way, and it funds a one-box Bootstrap only to check the reference read. At 6,465 it still builds with the constant (scratch `g`), so scenario 1 doesn't reach it. Changing it is optional, for consistency only.
- **"Reach none of #333's change" is loose.** Both tests do run #333's change through `bootstrap_most_in`. At their 4,310 rows the result can't be told from the constant, which is what the R_CONST pass shows. #333's figure is tested elsewhere:
  - core `lovejoin_pools_test.rs:1782-1813`: equal to the floor on preprod and mainnet; more than 1.5 ₳ at a dearer byte; a fixed 1.5 ₳ fails 96 boxes there; the priced figure builds 96 classic and 64 LJTEST.
  - extension `lovejoin.test.ts:1917-1918`: the worker's `bootstrapReserve` equals WebAssembly's figure, which is `"1500000"`.
  - `lovejoin-flows.test.ts:500-510`: 1.8 ₳ and a 13.3 ₳ funding at 6,465.
  - `lovejoin-release-rules.test.ts:491-505`: the form's limits at both prices.
- **Scenario 2 is not a failure.**
  - On HEAD the priced reserve can't fall below 1.5 ₳, because of the floor at `mod.rs:1750`.
  - Taking that floor out (R_NO_FLOOR) goes unnoticed by these tests with or without the proposed fix. The unfloored figure at today's row is 1.1 ₳, and both bodies still build at one deposit's most with it (scratch `h`: 64 boxes funded 130600000, 96 funded 962600000).
  - The floor is guarded by core `:1782-1790` and by the extension's `lovejoin.test.ts:1918`.

## Fix advice

- **Required:** in the two documented tests, fund the worker's figure instead of the constant: `bootstrap_back_reserve(&ProtocolParameters::from_koios(&params()).unwrap()).unwrap()`.
  - flows already imports `ProtocolParameters`.
  - lovejoin_test already calls `seedelf_koios::koios::ProtocolParameters::from_koios(&params())` at `:336`, and `from_koios` parses its hand-built row (scratch `a`).
  - Their doc comments are then true at any row.
- **Optional:** the same change at flows `:519`.
- **Drop** the scenario-2 claim. The fix doesn't touch it, and the floor is already guarded.

## Repro

Scratch file `wasm/tests/zz_review_v_x_mut_rs_4_trace_1.rs`, run with `cargo test --locked -p seedelf-wasm --test zz_review_v_x_mut_rs_4_trace_1 -- --nocapture`, now deleted. It holds the two tests' bodies verbatim, with the same helpers, taking the row and the reserve figure as parameters.

| Test | What it checks | Result |
|---|---|---|
| `a` | The worker's figure is 1,500,000 at both fixtures and 1,800,000 at 6,465 | pass |
| `b` | Control: both bodies pass at their own rows with either figure | pass |
| `c` | flows body at 6,465 with HEAD's constant | **FAIL**: 64 boxes, needs 2.185170 ADA |
| `d` | flows body at 6,465 with the worker's figure | pass |
| `e` | classic body at 6,465 with HEAD's constant | **FAIL**: 96 boxes, needs 2.185170 ADA |
| `f` | classic body at 6,465 with the worker's figure | pass |
| `g` | the third place (one box, reference read) at 6,465 with the constant | pass |
| `h` | both bodies at today's row with the unfloored 1.1 ₳ | pass |
