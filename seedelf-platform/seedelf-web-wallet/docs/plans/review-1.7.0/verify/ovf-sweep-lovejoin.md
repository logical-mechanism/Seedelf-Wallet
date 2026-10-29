# Overflow sweep: lovejoin/, orders.rs, staking.rs, note.rs, withdraw_zero.rs

Label `ovf-sweep-lovejoin`. HEAD `6bca8bec`. I read every line of
`seedelf-core/src/lovejoin/{mod,box_value,launch,pool,templates,value}.rs`,
`orders.rs`, `staking.rs`, `note.rs` and `withdraw_zero.rs` for integer arithmetic, then traced each
site that wasn't checked back to its `#[wasm_bindgen]` export and its caller in the extension.

## Result

- **No site in these files traps on REAL data.** Every sum of tokens across UTxOs goes through
  `Assets::add`/`merge`/`separate` or `utxos::assets_of`, which use checked arithmetic and refuse in
  words. Every lovelace sum on real UTxOs stays under the ADA supply. Every figure taken from
  parameters is bounded by the caps in `ProtocolParameters::from_koios`, and every wasm entry parses
  its parameters that way.
- **Two sites trap on LYING data.** Both are reproduced in a scratch test (debug build, the same
  panic the store module traps on). Both callers can repeat the trap after each unlock, so each can
  cause a **lock loop** for as long as the index keeps lying:
  1. `lovejoin/mod.rs:1392`: a private UTxO pays a stuck box's way back.
  2. `orders.rs:901`: a stopped swap's Splash cancel.
- Both fixes are tested in a copy outside the tree (scratchpad `review/ovf-sweep-lovejoin/`). Each
  turns the panic into a refusal or a normal build. With the fixes, `orders_test` (22/22) and
  `lovejoin_pools_test` (31/31) still pass.

## Site 1: `lovejoin/mod.rs:1392`, `withdraw_with`'s `into_register`

```rust
(None, Some(s)) => (total + s.coin.lovelace).saturating_sub(fee),
```

- **Data: LYING.** `total` is one box's `denom`, and a real box holds at most the ADA supply. The
  `SeedelfPayer` coin is a real UTxO, so for honest data the sum stays under 2^57. It overflows only
  when the index reports one of the wallet's ADA-only Seedelf UTxOs with more than `u64::MAX − denom`
  lovelace. The index has to copy the UTxO's real datum so that `is_owned` passes.
- **Path:**
  - The wasm export `build_lovejoin_withdraw_private` (`wasm/src/lib.rs:6015`) calls
    `lovejoin::withdraw_private_in` (`wasm/src/lovejoin.rs:2745`), which loops over `request.utxos`.
  - That calls core's `withdraw_private` (`mod.rs:1249`), then `withdraw_with`.
  - The first `stage(500_000, …)` calls `into_register`, which runs line 1392 before anything is
    built or measured.
- **Callers:** `background/lovejoin.ts:6944`, `withdrawOne(…, { paid: "private" })`, which runs:
  - **Bring every box back now** (`bringAllBackNow`, `lovejoin.ts:6722-6732`) for a stuck token-pool
    box (`stuck`). The alarm's `withdrawDueNow` (`lovejoin.ts:6171-6172`) runs it every run, and
    right on unlock, for as long as `bringing` stands. The trap is rethrown (`isTrap`) before
    `bringNoted` counts a failure, so `BRING_FAILED_RUNS` never stops it. **This is a loop.**
  - **Bring one back now** with the private balance paying (`handlers.ts:566`,
    `lovejoin-withdraw-now`). The user starts it: one lock per press.
- **Scenario:**
  1. The wallet has a box in a token pool that can't pay its own way back (REAL: launched with too
     little ADA, or the price of a byte rose).
  2. The user starts Bring every box back now.
  3. The index reports one of the wallet's private UTxOs at, for example, `u64::MAX − 5 ₳`.
  4. The worker sorts the UTxOs lovejoin-made first, then by value ascending, and the wasm loop
     stops at the first one that pays. The lying UTxO is reached when it is the only candidate, or
     when it is the only lovejoin-made one.
  5. `withdraw_private` traps and the wallet locks. The next unlock runs the same step and traps
     again.
- **Fix:** checked, with a sentence naming the UTxO. Data the ledger can't produce is refused, so
  this adds no guard over the ledger. Verified in the copy: the call now returns
  `UTxO f4…f4#0 and the box hold more ADA than there is`.

  ```rust
  (None, Some(s)) => total
      .checked_add(s.coin.lovelace)
      .with_context(|| format!(
          "UTxO {}#{} and the box hold more ADA than there is",
          hex::encode(s.coin.utxo.tx_hash), s.coin.utxo.index
      ))?
      .saturating_sub(fee),
  ```

  `withdraw_private_in` treats that as an error, not as `PrivateTooSmall`, so it stops rather than
  trying the next UTxO. That is acceptable for data that can't be real.
- **Confidence: high.** The scratch test panics at `mod.rs:1392:32` ("attempt to add with
  overflow").

## Site 2: `orders.rs:901`, `build_cancel`'s `keep`

```rust
lovelace_in.checked_sub(refunded_lovelace + KEEP_AT_FEE + SESSION_COLLATERAL)
```

- **Data: LYING.** `refunded_lovelace` is the lovelace of one Splash order row, which is at most the
  ADA supply when real. It overflows only when an order's value is in
  `(u64::MAX − 6 ₳, u64::MAX − 5 ₳ − funds]`. That narrow window is what lets
  `assets_of(spent)` at line 851, which is checked, pass in the collateral round, so the panic comes
  here.
- **Path:**
  - The wasm export `build_order_cancel` (`wasm/src/lib.rs:790`, `buildOrderCancel` in JS) calls
    `orders::cancel_orders` (681).
  - That calls `build_cancel(.., false)`. For a Splash refund that the session's funds can't pay
    beside, it returns `REFUND_SHORT`, which counts as `is_short`.
  - That leads to `build_cancel(.., true)`, which reaches line 901.
- **`check_cancels`, the dry run before a swap is signed, can't reach it:** its 20 ₳ stand-in funds
  pay the first round, and if a round two ever ran, `lovelace_in` (checked) would already bound
  `refunded + 25 ₳`.
- **Caller:** `background/sessions.ts:4046`, `cancelOf`, from `cancel` (3995). After Stop, the
  session runner's `step` takes this on the alarm's runs (`sessions.ts:3640/3651`). On a trap, `step`
  calls `wallet.trapped()`, and "the next unlock's run takes the step afresh" (3462). **This is a
  loop.**
- **Scenario:**
  1. A stopped swap session's Splash order is still open.
  2. The session holds only its 5 ₳ collateral, which `cancel_orders` filters out of funds, so funds
     are empty.
  3. The index reports the order's value as `u64::MAX − 5.5 ₳`.
  4. Round one is `REFUND_SHORT`. In round two, `assets_of` gives `u64::MAX − 0.5 ₳`, which fits, and
     then `+ 1 ₳ + 5 ₳` overflows.
  5. The wallet locks. Each unlock runs the cancel step again.
- **Fix:** subtract in turn. This is the same `None`/`Some` for every value where the sum fits, so
  honest behaviour is unchanged.

  ```rust
  lovelace_in
      .checked_sub(refunded_lovelace)
      .and_then(|rest| rest.checked_sub(KEEP_AT_FEE + SESSION_COLLATERAL))
      .and_then(|rest| change_outputs(…).ok())
  ```

  Verified in the copy: the lying case builds without a trap (fee 208,156), and `orders_test` passes
  22/22. The ledger would refuse the resulting cancel at submit, because the input doesn't hold that
  value.
- **Confidence: high.** The scratch test panics at `orders.rs:901:26`.

## Bounded (why each other site can't overflow)

### `lovejoin/value.rs`

- **49:** `1 + u64::from(bool)` is 1 or 2.
- **124:** already `checked_mul`.

### `lovejoin/box_value.rs`

- **108:** uses `saturating_sub`, `min` and `max`.
- **206:** `t.quantity / 2` is a division.
- **374-386:** the search runs over constants (100 to 2,000 steps of 0.01 ₳).
- **393:** `suggested_box_lovelace`'s `div_ceil(BOX_STEP) * BOX_STEP` would overflow only for
  `least > u64::MAX − 750,000`. Its one caller (`wasm/src/lovejoin.rs:2853`) passes
  `least_box_lovelace`'s result, which is at most `SEARCH_HIGH` (20 ₳).

### `lovejoin/templates.rs`

- **79:** a bundled script's length + 1.
- **108:** `i64::try_from`.

### `lovejoin/pool.rs`

- **461-464:** `script_bytes` `.sum()` covers at most three references:
  - the reference UTxO, where `candidate()` refuses any script, so it adds 0;
  - scripts that byte-equal the derived `mix_box` and `mix_logic`, a few KB.
- **126-220:** the datum decode only uses `i128`/`u64` `try_from`.

### `lovejoin/launch.rs`

- **92 and 97:** the `Locked` sums are three least values at the holder plus `key_deposit`, from
  parameters capped by `from_koios` (≤ 20,000 lovelace a byte, ≤ 10 ₳ deposit). That is about 1e8 at
  worst.
- **501:** in `fee * 3 / 2`, `fee` comes from `settle()`, which runs `check_fee()` on every price
  (≤ 10 ₳).
- **558:** the price is capped parameters × size. `settle` refuses anything over `MAX_TX_SIZE`
  first. Budgets are at most `eval::MEASURE_LIMIT`, and the script fee covers at most 204,800 bytes.
  The total is under 2e8.
- **562:** `stage` puts the three made outputs first, so the subtraction can't underflow.
- **566:** `settle` returns a fee ≥ `even(linear + compute + script_reference)`, so the subtraction
  can't underflow.

### `lovejoin/mod.rs`: sums and prices

- **239-242:** the classic pool's bundled reference outputs.
- **339-341 and 596:** widening casts.
- **564-571 (`price`):**
  - `linear_fee` saturates and is ≤ 1,000 × size + 2 ₳.
  - `computation_fee` is an f64→u64 cast, which saturates.
  - Budgets come from one evaluation, so they are ≤ `MEASURE_LIMIT`, +1%.
  - The total is a few times 1e7.
- **699-751:** the `deposit_across` sums are `checked_*`, `token_total` and `Assets::merge`.
- **780:** output counts of the wallet's own deposit.
- **837:** `121 + index`, where index is 0 or 1.

### `lovejoin/mod.rs`: mix and withdraw

- **1016:** `fee` is `MIX_DRAFT_FEE`, or a price `check_fee()` passed.
- **1047:** `signers` is 1 or `keys.len()` (≤ 2) at every wasm caller.
- **1057 and 1553:** capacities sized by box counts.
- **1074-1075:** the budget fold covers one evaluation, and uplc draws every redeemer from one
  `MEASURE_LIMIT` (14e9 steps, 20e6 memory).
- **1086 and 1562:** both guarded by `needed <= fee`.
- **1110:** `stage(fee)` at 1094 just passed `checked_sub(fee)` for the same fee.
- **1338:** `denom * sorted.len()` multiplies by 1 at every caller, so it never overflows:
  - the wasm `withdraw_in`, `withdraw_paid_in` and `withdraw_private_in` pass
    `std::slice::from_ref`;
  - `usable`, `comes_back` and `way_back` each withdraw one made-up box.
- **1427 and 1450:**
  - `fee` is 500,000 or `even(price)` with capped parameters and one box, so under 1e8.
  - `topped` ≤ the output's least.
- **1542:** derived scripts plus a constant.
- **1584:** `stage(fee)` at 1549 passed `checked_sub(fee + topped)` for the same fee.

### `lovejoin/mod.rs`: planning

- **1632, `mixes_per_box_at`:** this is safe only because depth comes from the extension.
  - `width` passes `check_width()` (3 or 4) at every wasm entry. `depth` is the extension's own
    setting, `isLovejoinDepth` 1..=3 or 0 for a seed (`shared/preferences.ts:84,180`).
  - On wasm32, `pow` traps only past depth 15 at width 4, or past depth 20 at width 3.
  - Hardening, not reachable: `plan_at`, `plan_across_pools` and `chain_at`'s affordable branch reach
    it before any depth check. `fresh_for` and `funding_at`'s `check_depth` do check.
- **1663:** constants.
- **1716-1717 and 1749-1750:** the reserves use capped parameters, each term ≤ about 2e7.
- **1767 and 1774-1776:** saturating or checked.
- **1782, 1788 and 1804:** `mixes × estimate` is ≤ 21 × 1.5 ₳ at depth ≤ 3, and below 2^32 × 1.5e6
  on wasm32 anyway.
- **1823 and 2038:** a division followed by an `as usize` cast. The cast truncates and never traps
  (see the notes). `again_affordable(…, 0)` would divide by zero, but only tests call it.
- **1828 and 2045:** `DEPOSIT_RESERVE + boxes * per`. `funding_at` and the again build (`wasm` 2341)
  check depth 1..=3 first, so `per` ≤ 31.5e6, and `boxes` is a wasm32 `usize` (below 2^32). The
  total is ≤ 1.4e17.
- **1872, 1883 and 1887 (`plan_across`):** a `u128` division, and `n ≤ left / per`, so
  `n × per ≤ left`.
- **2025 and 2029:** the binary search keeps `low < high` and `mid ≥ 2`.
- **2351 and 2383:**
  - depth is checked 0..=3 just before, and width is 3 or 4, so each tree needs at most 63 boxes;
  - `trees` is bounded by memory (fewer than 2e7 boxes or registers on wasm32).
- **2421:** `i < len`.

### `orders.rs`

- **311-312:** guarded by the match ranges.
- **540:** `kind % 2`.
- **965:** `checked_mul`.
- **1012:** sums the reference sizes from the pinned `orders.json`.
- **1019-1020, 1027-1034 and 1065-1066:** budgets from one evaluation (≤ `MEASURE_LIMIT`, +1%),
  capped parameters, size ≤ `MAX_TX_SIZE` (`settle`).
- **1347:** `version - 1` on a `u8` is in the `version != 1` branch, and `with_integrity`'s version
  comes from the table, 1..=3. `integrity_hash`'s other callers are tests.
- **158, 1276 and 1405:** a capacity and widening casts.
- **851 and 853:** `assets_of`, which is checked.

### `staking.rs`

- **383:** two bools.
- **387-423:** deposits come from capped parameters (key ≤ 10 ₳, DRep ≤ 5,000 ₳), with at most two
  registration certificates.
- **426-434 (`refund()`):** one unregistration's Koios deposit. `Staking::of` and `Staking::drep`
  are built apart (`wasm/src/lib.rs:1915/2000`), so there is never a second term.
- **443-448 (`net()`):** checked.

### `note.rs` and `withdraw_zero.rs`

- **`note.rs` 113-117:** `cut` starts at 64 and steps back at most 3 to a char boundary, and
  `space < cut`.
- **`withdraw_zero.rs`:** no arithmetic.

## Notes

### The known `eval.rs` `resolve()` site

- **Only one in its function:** confirmed. The `+=` on `asset_list` quantities is the only unbounded
  arithmetic in `resolve()`. The `fields` sum is 2 to 4.
- **Paths from these files:**
  - **Unprotected:** `orders.rs:793` calls `eval::resolve_reference` on the reference rows from
    Koios's `utxo_info`. A lying row that lists an asset twice past 2^64 traps there. This path runs
    in the cancel after Stop (the runner, so a loop) and in `check_cancels` before a swap is signed.
    The known fix covers it. Its test should include a reference row, not only pool rows.
  - **Protected:**
    - `PoolBox::from_row`: `is_row` requires exactly one asset entry.
    - `Coin::from_row`: refuses any asset.
    - `Holding::from_row`: `assets_of` runs first, and `Asset::new` decodes hex, so it keys tokens
      as `resolve` does.
    - `orders.rs:979`: `assets_of(spent)` runs first, at 851.
    - `orders.rs:981`: the collateral must hold no asset (686).
    - `launch.rs:586-590`: `estimate()` already ran `assets_of` on the same inputs.

### Not a trap, for the record

- `again_affordable_in` (`mod.rs:1823`) casts `as usize`. On wasm32 that wraps past 2^32 boxes'
  worth, which needs a session UTxO over about 4.08 billion ₳ at depth 1. It gives a wrong count,
  never a lock.
- `affordable()` uses `try_from(..).unwrap_or(usize::MAX)` instead. Using the same there would be
  consistent.

## Scratch

- I ran `tests/zz_review_ovf_sweep_lovejoin_1.rs` in `seedelf-core`: both panics, plus two honest
  controls that pass. It is deleted.
- The fix check lives in the scratchpad copy only, never in the tree.
