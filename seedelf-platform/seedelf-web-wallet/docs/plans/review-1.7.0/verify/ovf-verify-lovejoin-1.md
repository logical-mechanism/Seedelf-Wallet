# Verify: splash-cancel-keep-901 (`orders.rs:901`)

Label `ovf-verify-lovejoin-1`. HEAD `6bca8bec`. **Verdict: confirmed.** The data class is LYING, and it loops (the alarm's run).

## The site

`seedelf-core/src/orders.rs:899-905`, in `build_cancel`:

```rust
let keep = spend_collateral
    && lovelace_in
        .checked_sub(refunded_lovelace + KEEP_AT_FEE + SESSION_COLLATERAL)   // 901: plain u64 add
```

- `refunded_lovelace` is the Splash order row's `value`, taken from `assets_of(vec![order])` at 853.
- `lovelace_in` is `assets_of(spent)` at 851, a checked sum. In round two, `spent` holds the order, the funds and the collateral.
- `seedelf-core` has `overflow-checks = true` in `[profile.wasm-release]` (`Cargo.toml:51-52`), so in the store module the add panics, which is a trap.

## Reachability

- **The data is LYING only.** One output holds at most the ADA supply (45e15 < 2^56). The add needs `L > 2^64−1 − 6 ₳`, and the checked `lovelace_in` needs `L ≤ 2^64−1 − 5 ₳ − F`, where F is the session's ADA-only funds other than the collateral. That leaves a window of width `1 ₳ − F`. It exists only while `F < 1 ₳`. A lying index can always produce it: it reports the order's value and can leave rows out.
- **Nothing refuses it first.**
  - `read_dex_order` (wasm `lib.rs:703`) never reads the value. `eval::resolve` (`eval.rs:131`) only parses it and encodes it.
  - Round one (`spend_collateral = false`) short-circuits `keep`. Its `stage` then fails on `remaining.checked_sub(L)` with `REFUND_SHORT`, which is a `NotEnough`, so `is_short` sends it to round two (810-811).
  - In round two, `assets_of(spent)` passes inside the window, and 901 is the next arithmetic.
- **The pre-sign dry run can't reach it.** `check_cancels` adds a 20 ₳ stand-in fund (`CHECK_FUNDS`) to a 5 ₳ stand-in collateral. Its checked `lovelace_in` then bounds `L + 25 ₳ ≤ 2^64−1`, so `L + 6 ₳` fits.

## Callers

- **The loop (background):**
  - The path runs from the export `buildOrderCancel` (wasm `lib.rs:5671`) to `api::build_order_cancel` (790), then `cancel_orders` (681) → `build_cancel` (810, then 811) → 901.
  - In the extension, `sessions.ts` `cancelOf` (4046) is called by `cancel` (3998), which the runner's `act` takes after Stop (3640, 3651). `liveOrders` reads the order rows through `utxoInfo`: on mainnet that is the data layer first, then Koios.
  - `cancelOf` rethrows a trap (4048). `step` catches it (3463): `wallet.trapped()` locks the wallet, and "the next unlock's run takes the step afresh" (3459-3462).
  - The `go`/`waits` logic delays the send by the unlock wait. The wallet therefore locks again a few minutes after each unlock, for as long as the index lies.
- **User-started (the claim doesn't list these; one lock per click):**
  - `session-cancel-build` → `cancelBuild` (`sessions.ts:3070`, `cancelOf` at 3076).
  - `session-cancel-collateral-build` → `cancelCollateralBuild` (2284, `cancelOf` at 2297). This one runs on `rows` plus a 5 ₳ stand-in, so funds are usually empty there too.

## Proof (scratch test, debug build)

The test used the real mainnet Splash fixture from `order_cancels.json`. Its owner is the session, its 5 ₳ collateral is among the funds, and each case changed only the order's `value`. The scratch file is deleted.

| Order lovelace (change) | HEAD | With the fix |
|---|---|---|
| fixture 4.5 ₳ (none) | built, fee 207,980 | same |
| fixture 4.5 ₳ (0.5 ₳) | built, fee 209,564 | same |
| MAX−5.5 ₳ (none), the claim | **panic `orders.rs:901:26` "attempt to add with overflow"** | built, fee 208,156 |
| MAX−5 ₳ (none), upper edge | **panic 901:26** | built, fee 208,156 |
| MAX−6 ₳+1 (none), lower edge | **panic 901:26** | built, fee 208,156 |
| MAX−5.9 ₳ (0.4 ₳) | **panic 901:26** | built, fee 209,740 |
| MAX−6 ₳ (none), just outside | built, fee 208,156 | same |
| MAX−5 ₳+1 (none) | refused "Lovelace sum overflow" | same |
| MAX−6 ₳+1 (1 ₳), window empty | refused "Lovelace sum overflow" | same |
| 45e15 (none), supply-sized | built, fee 208,156 | same |

- With the fix, applied in a copy at `scratchpad/review/ovfv-lovejoin1/`, `orders_test` passes 22/22. The run's log is `fixed-run.log` in that folder.
- A debug build checks overflow in every crate, dependencies included, so the fixed lying case builds with no trap anywhere on the path.
- After the build, the extension's `inspect`, `signSessionTx` and `attachWitnesses` run in `seedelf-wasm`'s `cip30.rs`. That crate is unchecked, and its value sums are `checked_add` with words anyway. The node then refuses the cancel, since the real order holds less. That is the same outcome HEAD already gives for an order at MAX−6 ₳.

## Fix

The claim's fix is right and minimal:

```rust
lovelace_in
    .checked_sub(refunded_lovelace)
    .and_then(|rest| rest.checked_sub(KEEP_AT_FEE + SESSION_COLLATERAL))
```

- Wherever `refunded + 6 ₳` fits, it gives the same Some/None and the same value as before.
- Where the sum doesn't fit, it gives the mathematically right `None`, so `keep` is false. Those values then build exactly as their neighbours do, with no new guard.
- `refunded_lovelace.saturating_add(..)` would also work, but the sequential form is the exact one.
- Suggested regression test, in `orders_test`: a Splash order at `u64::MAX − 5_500_000` with only the collateral must not panic, whether it builds or is refused. It panics on HEAD, which is a test failure under the debug profile.

## Rest of the function

No other unchecked site in `build_cancel` or `cancel_orders` takes the order's value:

- `stage` and `change` use `checked_sub` and `checked_mul`. `change_outputs` guards `remaining -= amount`.
- The remaining sums are over measured budgets and pinned reference sizes, or over parameters capped by `ProtocolParameters::from_koios`.
- A separate LYING site on the same loop, a reference row's token listed twice at `eval.rs:148`, is already reported in `ovf-sweep-rest.md`.
