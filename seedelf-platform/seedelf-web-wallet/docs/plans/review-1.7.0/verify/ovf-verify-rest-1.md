# Verify: cancel-keep-sum-901 (`orders.rs:901`)

Label `ovf-verify-rest-1`. HEAD `6bca8bec`. **Verdict: confirmed.** Data class **LYING**. **Loops**: the stop step runs on the alarm and when a page reads. I also proved it on the store module itself, and checked the proposed fix in a copy outside the tree.

## The site

`seedelf-core/src/orders.rs:899-905`, in `build_cancel`:

```rust
let keep = spend_collateral
    && lovelace_in
        .checked_sub(refunded_lovelace + KEEP_AT_FEE + SESSION_COLLATERAL)   // 901
```

- `refunded_lovelace` is the Splash order row's `value`, from `assets_of(vec![order])`, so it's `Some` only when `placed[0]` is Splash (`Protocol::alone`).
- `seedelf-core` has `overflow-checks = true` in `[profile.wasm-release]` (`seedelf-platform/Cargo.toml:51-52`, PR #332). The add therefore panics, which is an `unreachable` trap in the store module.
- `git blame` dates the line to `5f7a405af` (2026-10-08). Before #332 the sum wrapped, and the wrap was harmless:
  - The wrapped `held` is small, so `keep` came out true.
  - The `change` closure checks `remaining.checked_sub(SESSION_COLLATERAL)` again and falls back to a plain change output.
  - The cancel built exactly as with the fix below.

  So #332 turned a harmless wrap into a lock loop.

## Reachable only on LYING data, and nothing refuses it first

- **Real data can't reach it.** One output holds at most the ADA supply (45e15 < 2^56), and the add needs the order's lovelace O > 2^64−1 − 6 ₳.
- **The only check is too loose.** The one checked sum on the path is `assets_of(spent)` in round two (order, funds and collateral): O + F + 5 ₳ ≤ 2^64−1, where F is the session's ADA-only funds other than the collateral. That leaves a trapping window O ∈ (2^64−1 − 6 ₳, 2^64−1 − 5 ₳ − F], which exists only while F < 1 ₳.
  - A lying index controls both O (`utxo_info` on mainnet goes to the data layer first: `data-layer.ts:251`) and F (the session's own listing).
  - Neither `koios.ts` `utxoInfo`/`trimmed` nor `data-layer.ts` checks a value against the supply.
- **Nothing before 901 reads the value:**
  - The worker: `liveOrders` uses `readDexOrder`, which reads the datum and address only (wasm `lib.rs:703-747`). `cancelOf` passes the row through untouched.
  - `api::build_order_cancel` (`lib.rs:790-829`) only checks that the funds and the collateral are at the session's payment key.
  - Round one (`spend_collateral = false`) short-circuits `keep`, then fails in `stage`:
    - `REFUND_SHORT` at 937 when F < 0.2 ₳.
    - Otherwise `CANCEL_SHORT` from `change_outputs` (F − 0.2 ₳ is under the 0.978 ₳ least).
    - Both are `NotEnough`, so `is_short` sends the cancel to round two (810-811).
- **The dry run can't get there.** `checkOrderCancels` → `check_cancels` uses a 20 ₳ stand-in fund (`CHECK_FUNDS`, 1164):
  - Round one isn't short, so `keep` is never evaluated.
  - Even in round two, `lovelace_in` ≥ O + 25 ₳ bounds O + 6 ₳.

## Proof (scratch tests, both deleted)

**Core, debug build** (`seedelf-core/tests/zz_review_ovfv_rest1_1.rs`, on the mainnet Splash fixture, a 5 ₳ collateral, given as the worker gives it, among the funds):

| Order lovelace | Other funds F | Result |
|---|---|---|
| 4.5 ₳ (honest) | none / 0.4 ₳ | Ok, fee 207980 / 209564 |
| 2^64−1 − 5.5 ₳ | none | panic `attempt to add with overflow @ seedelf-core/src/orders.rs:901` |
| 2^64−1 − 5.5 ₳ | 0.4 ₳ | panic at orders.rs:901 |
| 2^64−1 − 5.5 ₳ | 0.9 ₳ / 1 ₳ | `Err("Lovelace sum overflow")` (assets_of, in words) |
| 2^64−1 − 5 ₳ / − 5.999999 ₳ | none | panic at orders.rs:901 (the window's ends) |
| 2^64−1 − 6 ₳ | none | Ok, fee 208156 |
| 2^64−1 − 4.999999 ₳ | none | `Err("Lovelace sum overflow")` |
| 45e15 | none / 0.4 ₳ | Ok |

**The store module itself** (`extension/tests/zz-review-ovfv-rest1-1.test.ts`, `wasm/pkg/seedelf_wasm_bg.wasm` loaded as `fakes.ts` loads it, with the worker's `buildOrderCancel` request JSON):

- Honest → fee 207980.
- 2^64−1 − 5.5 ₳ with no funds, and with 0.4 ₳ → `RuntimeError: unreachable`, `isTrap(e) === true`.
- 2^64−1 − 6 ₳ → fee 208156.

Nothing else on the path traps for huge O: the case just outside the window builds in the store module too.

## Callers

- **The loop (background and page reads):**
  - A self-running session after Stop (`auto.stopping`, still `running()`: `sessions.ts:1230`) with its Splash order open takes `act` → `go(() => this.cancel(...))` at 3651 (or 3640) → `cancel` (3991) → `cancelOf` (4013) → `wasm.buildOrderCancel` (4046).
  - The trap is handed on at 4048. `step` catches it (3462-3465): `wallet.trapped()` locks the wallet, and the record is left untouched, so there's no pause and no retry delay.
  - Runs come from `runNetworks` → `sessions.runAll` (`runs.ts:83`) on every alarm run while unlocked, and from the Swaps page's `session-advance` (`Swaps.tsx:2145`, every `ADVANCE_EVERY_MS` (20 s), and Refresh with `now: true`, which is an "asked" run).
  - After each unlock, the unlock run draws a wait (`waits`, 3746: 2-20 min, `UNLOCK_WAIT_MS`). The next alarm run past it (or a Refresh at once) builds the cancel again → trap → locked again, for as long as the index reports the same value.
  - Settings' Koios-only switch is the way out, if the user finds it in the window.
- **User-started (one lock per attempt):**
  - `cancelBuild` (handlers.ts:485 → sessions.ts:3070), a session brought back by hand: "cancel it myself".
  - `cancelCollateralBuild` (2297, its stand-in collateral run of the cancel). Both are trapped → locked through `handlers.ts:50`.

## The proposed fix: right and minimal

```rust
let keep = spend_collateral
    && refunded_lovelace
        .checked_add(KEEP_AT_FEE + SESSION_COLLATERAL)
        .and_then(|held| lovelace_in.checked_sub(held))
        .and_then(|rest| {
            change_outputs(c.params, c.address, rest, &kept_tokens, CANCEL_SHORT).ok()
        })
        .is_some_and(|rest| !rest.is_empty());
```

- **It gives exactly what exact arithmetic gives.** A sum past `u64::MAX` is above any u64, `lovelace_in` included, so the exact subtraction would be negative anyway: `None`, and `keep = false`.
- **It's no new guard.** It refuses nothing, and the cancel still builds. The ledger then refuses it for the lie (value not conserved against the real order), which is an ordinary failed step and retry, not a lock.
- **Checked in a copy** (`scratchpad/review/ovfv_rest1/copy`, its own `CARGO_TARGET_DIR`):
  - `orders_test` passes 22/22.
  - Honest fees are unchanged (207980, 209564).
  - Every case in the window now builds (fee 208156 / 209740), and the out-of-range cases still say `Lovelace sum overflow`.
- **What comes after doesn't trap.** On the fixed cancel the worker goes on to `inspect` → `inspectSessionTx` (`cip30.rs` `inspect`):
  - `Amount::add` is checked and refuses in words.
  - The net is an `i128` difference.
  - `seedelf-wasm`'s own crate isn't overflow-checked.
- **Equivalent forms:** `lovelace_in.checked_sub(refunded_lovelace).and_then(|x| x.checked_sub(KEEP_AT_FEE + SESSION_COLLATERAL))` works too, since the refund is one of the spent inputs.
- **Suggested test (in `orders_test.rs`):** a Splash order listed at 2^64−1 − 5.5 ₳, with only the collateral, never panics. It fails in a debug build without the fix.

## Severity note for the lead

By the brief's scale, a lock loop is high. But it needs the data layer or Koios to report an order of about 4×10^5 times the ADA supply, within a band under 1 ₳ wide just below 2^64, while a stopped session holds under 1 ₳ beside its collateral. In practice the risk is low. The fix is one line and restores the behaviour from before #332.

## Same function, not this claim

- Line 1034 (`even(linear_fee(..) + compute + script_reference)`) and the `computation_fee` sum: `ProtocolParameters::from_koios` caps the prices and fees (`MAX_MIN_FEE_A`, `MAX_PRICE_MEM`, …), and `linear_fee` saturates.
- 1019 and 1065 (budget sums): they are bounded by what the wallet's evaluator measures.
- I didn't verify these in depth.
