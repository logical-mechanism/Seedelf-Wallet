# Chunk 44 · Lovejoin v2 in the wallet (1.8.0)

Branch `web-wallet/lovejoin-v2`, from `main` at `c15603d5`. It's chunk 42's step 9: the wallet moves to Lovejoin v2, and the older pools keep their withdrawals alone.

**v2** is Lovejoin `main` at `29573c5` (Lovejoin PRs #165 and #166). Its five templates are 8131b1d's, except `mix_logic`, whose xor32 checks both lengths: unapplied `62befd1e…` becomes `7fb45b75…`. The bytes the wallet pins are the ones `seedelf-verification` proves (`Lovejoin/Template/Scripts/mix_logic.hex`, 3439 bytes).

- `one_shot_mint` is unchanged, so a seed makes the same P, and the same pool id, under either set. Only L, and through it M, say which set a pool runs: the datum's `mix_logic` decides.
- The classic pool and every pool on 8131b1d's templates are **retired**. v2 pools are the only ones that take new boxes.

## The owner's calls

- **2026-11-03, the game plan (chunk 42):** 1.8.0 allows no mixing into the old pools and returns every box in them as soon as it can. The UI hides the old pools, shown for withdrawal alone, and the release integrates v2. Once v2 is merged, the owner launches a new 5 ₳ pool, the only pool for now.
- **2026-11-05:** "the faster we get this published the better". Asked four questions, the owner chose:
  1. **The pool list is v2's alone.** The earliest pool of each value among v2 pools is shown. Classic and 8131b1d pools appear only where the wallet holds a box, marked withdraw-only.
  2. **Withdraw only.** No deposit, mix, Mix again or Bootstrap in a retired pool. Scheduled returns, Bring one back now and Bring every box back stay.
  3. **Right away.** At the first unlock on 1.8.0, Bring every box back runs for the retired pools. Back-to-back withdraws are easier to match; the owner chose speed.
  4. **The earliest v2 5 ₳ ADA pool** takes a return's spare ADA and the session's 5 ₳ collateral, by the rule the collateral pool already uses. Until it holds 30 other boxes (the mainnet floor), returns come back direct; Bootstrap fills it.
- **Kept as they are, unless the owner says otherwise:** no ADA pool of exactly 10 ₳ on the new scripts (it would look like the classic pool's copy), and the floor of 30.

## 44a · v2 recognised and launched ✅

Its own PR: core, WebAssembly, the data layer's copy, and the extension's discovery and launch checks, as the copies change together. After it merges and the data layer is deployed, a dev build can launch the v2 pool. Wallets already installed drop v2 pools: their `verify_pool` refuses them.

- **Core** (`seedelf-core/src/lovejoin/`):
  - ✅ `templates.rs`: `Set::V1` (8131b1d) and `Set::V2` (`COMMIT_V2`, `MIX_LOGIC_V2`), never an edit to V1's.
    - `derive` keeps V1's meaning, so its callers' tests run unedited. `derive_in(set, …)` sits beside it.
    - `derive_for(seed, datum's L)` applies P once and tries V2's L first. With no match it returns V2's scripts, so `verify_pool` refuses in its old order.
    - `Derived.set` records the set.
  - ✅ `Version::V2` beside `Classic` and `TokenV1` (`"v2"` in JavaScript), and `Version::retired()`.
  - ✅ `verify_pool` reads the set from the datum's L and accepts both; WebAssembly's `protocol_of` resolves hash-named script rows on that set too.
  - ✅ Launch and the box-value probe run v2 alone. A launch locks 124,990 lovelace more: v2's `mix_logic` is 29 bytes longer.
  - ✅ The builders stay unrestricted (the classic tests run on its preprod pool); 44b enforces retirement.
  - ✅ `v2_templates_are_frozen`, `a_seed_derives_each_sets_scripts`, `only_v2_takes_new_boxes`; the vectors file's `v2` section.
- ✅ **The data layer** (`seedelf-data/api/src/lovejoin/`): `Set`, `derive_in`, `derive_for`, v2's `mix_logic`, and `version` on each pool `lovejoin/pools` serves.
- ✅ **The shown rule keys on the set and the values,** in `standard.rs`, the extension's `lovejoin-pools.ts` and `tests/fixtures/lovejoin-shown.json` (two scenarios added).
  - Not "v2 pools alone", as first written: dropping 8131b1d pools from the data layer's list would drop the coverage wallets find their boxes by.
  - So an 8131b1d pool shown stays shown, and a v2 pool is never its copy. The wallet's screens hide the retired ones (44b, the owner's call 1).
- ✅ **The extension:** a found pool keeps `version: "v2"` (absent for every pool kept before, so old records are unchanged), and so do `LovejoinPool` and the status. A launch is a copy only of a v2 pool, and joins only v2 pools (worker and form).
- ✅ `wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json`: Lovejoin's preprod token-pool launch with its scripts derived on v2 and put at the holder. It's never on chain, and `lovejoin_v2_fixture_test.rs` writes it and verifies it as `v2` (`RECORD_LOVEJOIN_V2_FIXTURE=1`). The tests that a start of a listed pool's values is a copy run on it, and 44b's fixtures can grow from it.
- **Between 44a and 44b (dev builds only):** a retired pool still takes boxes, and the collateral still goes to the first 5 ₳ ADA pool read. With the v2 pool launched, the hub lists it beside 8131b1d's 5 ₳ pool. 1.8.0 ships both parts, so no release sees this.
- ✅ PR #363: CI green (unit on both builds, e2e, store, rust, wasm).

## 44b · The extension on v2 ⬜

Its own PR, after 44a. The worker's tests run their mixes and returns on the classic preprod pool (about 90 in `lovejoin.test.ts` alone, and the e2e), so retiring it moves them to a v2 pool fixture.

- **The ADA pool:** the earliest v2 5 ₳ pool replaces the classic pool wherever a return, a swap's quote or the collateral picks one (`poolNamed`, `split`, `room`, `acrossOf`, `collateralPool`).
- **Withdraw only:** a new unusable reason for retired pools refuses deposits, mixes, Mix again and Bootstrap; every withdraw stays.
- **Right away:** at the first unlock on 1.8.0, Bring every box back runs over the retired pools. Their Bootstrap and Mix-again holds are released.
- **Screens:** the hub and Home list a retired pool only while the wallet holds a box there, withdraw-only; the tile's "Mix ADA in 10 ₳ boxes" and the other 10 ₳ words change.
- **Costs:** `MIX_FEE_ESTIMATE` and the four-wide fit, measured on v2's bytes.

## 44c · Live, the deploy and the launch ⬜

- **Preprod first:** a v2 5 ₳ pool launched with the dev test wallet, and every private flow run live on it.
- **The data layer goes out before the mainnet launch** (CI, the owner approves): a running data layer refuses a v2 pool and keeps that verdict until it restarts.
- **The owner launches the mainnet v2 5 ₳ pool,** then Bootstraps it toward the floor.

## 44d · Docs and the release ⬜

- `architecture.md`, `flows.md` and `privacy.md` (Bring every box back's timing cost), and the data layer's README.
- Then 1.8.0, by `development.md`'s steps.
