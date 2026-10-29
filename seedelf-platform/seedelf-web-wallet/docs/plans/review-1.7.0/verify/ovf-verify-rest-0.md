# ovf-verify-rest-0: `lovejoin/mod.rs:1392` (withdraw-private-total-1392)

Label `ovf-verify-rest-0`. HEAD `6bca8bec`. The claim comes from `ovf-sweep-rest` (site 1) and `ovf-sweep-lovejoin` (site 1).

```rust
(None, Some(s)) => (total + s.coin.lovelace).saturating_sub(fee),   // seedelf-core/src/lovejoin/mod.rs:1392
```

## Verdict

**Confirmed.**
- **Data:** LYING.
- **Loop:** yes, through *Bring every box back now*. *Bring one back now* locks once per press.
- **Fix:** the proposed fix is right and minimal. I checked it in a copy outside the tree.
- **Two corrections to how the claim describes the mechanism.** Neither changes the outcome:
  - The trap isn't passed on at lovejoin.ts:6748. `withKeys` turns it into a lock first.
  - The loop lasts longer than the claim says, because the sealed contract record keeps the false value.

## Evidence

### 1. The store module itself checks this add

I scanned the data segments of `wasm/pkg/seedelf_wasm_bg.wasm` with `scratchpad/review/ovf-verify-rest-0/locations.py`.

- **Build time:** 15:57:32. That is two minutes after HEAD's merge (15:55:42). `mod.rs` last changed at `fe900cea`, 09:46.
- **What it holds:** a panic `Location` record for `seedelf-core/src/lovejoin/mod.rs:1392:32`, at 0x10e6d0.
  - Column 32 is the `(` of `(total + s.coin.lovelace)`. Lowering keeps the parentheses in the span.
- **The other `Location` nearby** is `1338:17`, `protocol.denom * sorted.len() as u64`. It is bounded: every caller passes one box.

So `withdraw_with` and its closures are compiled in core, with checks on, and not in seedelf-wasm, where they would wrap.

### 2. The shipped module traps through the export

I ran Node 24 with `wasm/pkg` loaded read-only (`scratchpad/review/ovf-verify-rest-0/probe.mjs`). It calls `buildLovejoinWithdrawPrivate` with the same request as `wasm/tests/lovejoin-pools.test.mjs`:
- a classic box, made the key's own;
- the fixture's 25 ₳ private UTxO, with its real datum;
- that UTxO's `value` set to each value below.

| `value` | Result |
|---|---|
| `25000000` | Ok: lovelace 34654258, fee 345742 |
| 2^64 − 1 − 10,000,000 | Ok: lovelace 18446744073709205697. This is an unbalanced withdraw, but no trap |
| 2^64 − 1 − 9,999,999 | **`RuntimeError: unreachable`** (`instanceof WebAssembly.RuntimeError`, so `isTrap` is true) |
| 2^64 − 1 | **`RuntimeError: unreachable`** |
| 2^64 | `Error`, in words: "… has an unreadable value" |

The boundary is exactly `10,000,000 + value > u64::MAX`, the classic box's denomination plus the UTxO's value: line 1392.

### 3. Debug build

I ran a core scratch test, then deleted it. Its text is in the scratchpad.

| Pool | Payer > `u64::MAX − denom` | Payer = `u64::MAX − denom` |
|---|---|---|
| Classic box | `attempt to add with overflow at seedelf-core/src/lovejoin/mod.rs:1392:32` | `Ok` |
| Token-pool box of 1.5 ₳ | `attempt to add with overflow at seedelf-core/src/lovejoin/mod.rs:1392:32` | `Ok` |

## Nothing refuses the value first

The path a data-layer row takes:

- **`isRow`** checks only `^\d+$` (private-index.ts:143-144).
- **`utxoOf`** passes `lovelace` through as `value`, unchanged, as a string (394).
- **`readIndexView` → `ownedUtxos`** checks only the register (balances.ts:489-505). The datum is the real one.
- **`readContract`** (script-spend.ts:220-245) and **`coins.seedelf`** (coin-control.ts:259-262) filter only by outpoint.
- **The worker's sort** works in BigInt (lovejoin.ts:6937-6939).

In WebAssembly:

- **`withdraw_private_in`** (wasm lovejoin.rs:2745-2799) passes over rows with tokens, rows `eval::refusal` names, and rows that aren't the wallet's.
- **`Coin::from_row`** (mod.rs:461-472) parses a `u64` with no bound. `resolve_row` does the same.
- **`withdraw_with`** does no arithmetic on the value before `stage(500_000, …)` → `into_register` (1389-1395). This is the first build.

**It is the only unchecked site in `withdraw_with` that the payer's value reaches:**
- 1338 multiplies by one box.
- 1388 and 1393 saturate.
- The rest are fees, from capped parameters and from budgets measured in the wallet.

## Callers and the loop

- **The only path to core's `withdraw_private`:**
  - the export `buildLovejoinWithdrawPrivate` (wasm lib.rs:6014-6020),
  - called only from `withdrawOne(…, { paid: "private" })` (lovejoin.ts:6923-6944).
- **Caller (a), *Bring one back now*:** `withdrawNow` (6480; handlers.ts:565-572). The user starts it, so it locks once per press.
- **Caller (b), *Bring every box back now*:**
  - Whenever `bringing` is set and not stopped, `withdrawDueNow` goes straight to `bringAllBackNow` (6172 → 6552). That happens on the alarm's runs and on the unlock's run (sw.ts:173 `runSessions(worker, true)` → runs.ts:95), before `unlock` is checked.
  - A token-pool box that `cantComeBack` (6711) is paid from the private balance, `"private"` (6732).
- **Correction 1, how it locks.** The call runs inside `wallet.withKeys` (6944).
  - `serial` (wallet.ts:577-590) catches the trap, locks through `broken()` (it clears session storage and starts a fresh instance), and throws `WalletLocked(WASM_BROKEN)`.
  - So at 6748 `isTrap` is false. The run breaks at 6750, because `locked()` is now true.
  - `bringNoted` (6755) gets no `why`, so `fails` never counts toward `BRING_FAILED_RUNS` (3).
  - `bringing` lives in the sealed `lovejoin.<network>` record (read at 7236, written at 7347-7366, in the private store in `chrome.storage.local`). `wipe()` clears only session storage (wallet.ts:698-709).
  - At the next unlock, the same build runs and the wallet locks again. **The loop holds.**
- **Correction 2, the loop lasts longer than the claim says.**
  - The private index's sealed `contract.<network>` record keeps this wallet's rows as the index gave them (contract-scan.ts:218 `settledRow`, 315 `next.rows`). A row leaves only when it's spent or a snapshot replaces the record.
  - So once a false value is settled there, every unlock reads it again, even after the data layer stops lying.
  - *Read Cardano through Koios only* avoids it while the switch is on (`readKoiosView`). Turning the switch off brings the record back.
  - Stop works only if the user reaches it in the seconds between the unlock and the build.
  - This is why the fix belongs in core.

## Data class

**LYING.**
- A real UTxO holds at most 45 × 10^15 lovelace. A real box holds at most the same, and in practice 10 ₳ or less. Their sum is at most 9 × 10^16, below 2^64.
- An overflow needs a reported value above 2^64 − 1 − the box's value. Only a lying or buggy data layer, or Koios, can report that.
- It is not USER data: no amount the user types reaches this sum.
- Before #332 the sum wrapped to a small, false figure. Now it traps.

## Fix

The claim's fix is right and minimal: `into_register` already returns `Result`. I checked it in a copy outside the tree (`scratchpad/review/ovf-verify-rest-0/fix.diff`, copy-test.log):

- **Honest payer of 5 ₳:** the same figures as HEAD. Classic box: lovelace 14654672, fee 345328. Token box: lovelace 6032722, fee 467278.
- **Payer above `u64::MAX − denom`:** `Err` in words for both pools. For example: "UTxO f4…f4#0 and the box hold more ADA than there is".
- **`lovejoin_pools_test`:** 31/31 pass, including every `withdraw_private` test.

```rust
(None, Some(s)) => total
    .checked_add(s.coin.lovelace)
    .with_context(|| {
        format!(
            "UTxO {}#{} and the box hold more ADA than there is",
            hex::encode(s.coin.utxo.tx_hash),
            s.coin.utxo.index
        )
    })?
    .saturating_sub(fee),
```

- **Wording.** Prefer "… and the box hold more ADA than there is". It is still right when the box's value is the false one.
  - The claim's "UTxO … holds more ADA than there is" is right whenever the box is honest: the UTxO alone is then above 2^64 − 45 × 10^15, far above the supply.
- **What the refusal changes.**
  - It isn't `PrivateTooSmall`, so `withdraw_private_in` stops rather than trying the next UTxO.
  - *Bring every box back now* keeps it as its `why` and stops after 3 runs.
  - *Bring one back now* shows it.
  - That is acceptable for data the ledger can't produce, and it adds no guard on top of the ledger.
- **A test to add:** `withdraw_private` with a payer of `u64::MAX` returns `Err`, not a panic.
- **Optional (not needed for the trap):** bound `Coin::from_row` by the ADA supply.
  - That refuses the value in words before anything is built.
  - It also covers the payer = 2^64 − 1 − denom case. That case doesn't trap today, but it builds an unbalanced withdraw that giveme.my or the node refuses.

## Severity (my call)

By the brief's scale a lock loop is **high**. Here it needs three things at once:
- a lying or buggy index;
- a token-pool box that can't pay its own way back;
- *Bring every box back now* running.

I'd put it at **medium**. It is the same kind of fix as the known sites. The lead decides.

## Scratch

- **In the tree:** `seedelf-core/tests/zz_review_ovf_verify_rest_0_1.rs` was run and then deleted.
- **The copy outside the tree and its build folder:** deleted.
- **Left in `scratchpad/review/ovf-verify-rest-0/`:** `locations.py`, `probe.mjs`, `fix.diff`, the test's text, and `copy-test.log`.
- No tracked file was touched. Other agents' `zz_review_*` files were left alone.
