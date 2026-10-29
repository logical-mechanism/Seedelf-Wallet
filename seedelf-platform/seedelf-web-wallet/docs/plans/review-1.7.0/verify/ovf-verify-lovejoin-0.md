# Verify: `withdraw-private-into-register-1392`

Label `ovf-verify-lovejoin-0`. HEAD `6bca8bec`.

The claim is that `seedelf-core/src/lovejoin/mod.rs:1392` traps the store module:

```rust
(None, Some(s)) => (total + s.coin.lovelace).saturating_sub(fee),
```

I tried to refute it. It holds:

- the site is reachable on LYING data from `buildLovejoinWithdrawPrivate`;
- nothing on the path refuses that data first;
- *Bring every box back now* repeats the trap at every unlock;
- the proposed fix is right and minimal.

Three details of the claim are wrong. The first matters for the regression test: **the claim's example value doesn't trap.**

## Verdict

- **Confirmed: the site traps the store module.**
  - `seedelf-core` has `overflow-checks = true` in `[profile.wasm-release]` (`Cargo.toml:50-51`).
  - `wasm/build.sh:61` builds the module with `--profile wasm-release`.
  - Line 1392 dates from `e674be626` (2026-10-19), before #332, and #332 didn't touch it. In 1.6.0's module the sum wrapped.
- **Data: LYING.** It isn't REAL:
  - A real box holds exactly its `denom` (`PoolBox::from_row`, `is_row`).
  - A real UTxO holds at most the ADA supply, so the sum stays under 9e16.
  - Nothing the user types reaches this sum (not USER).
- **Loop: yes**, through *Bring every box back now*. A second caller is user-started: one lock per press.
- **Fix: right and minimal.** Verified in a copy outside the tree:
  - no panic for any value;
  - honest figures unchanged;
  - fmt, clippy and both suites clean.
- **Severity:** the brief's high (a lock loop), against a lying or buggy index only.

## Corrections to the claim

### 1. The scenario's example value doesn't trap

- The overflow needs `lovelace > u64::MAX − denom`.
- A box that can't pay its own way back has a small `denom`, below the withdraw's fee plus its output's minimum. The tests' stuck pool is 1.5 ₳.
- Against that box, `u64::MAX − 5 ₳` doesn't overflow. `withdraw_private_in` builds and returns a transaction, which then goes to giveme.my and the node, and they refuse it.
- A trap needs a value in the top `denom` lovelace of the u64 range. `u64::MAX` is one, and it is also what a buggy index's `-1` cast to unsigned would print.
- The claim's reproduction must have used a box over 5 ₳. I reproduce the panic with a 9 ₳ box, but the worker never sends such a box down this path: it pays from the private balance only when `stuck`.
- **A regression test must use `u64::MAX`, or `u64::MAX − denom + 1`, against a stuck box.** With `u64::MAX − 5 ₳` it passes before the fix too.

### 2. How the loop escapes `BRING_FAILED_RUNS`

The claim says the trap is rethrown by `isTrap` before `bringNoted` counts a failure. That isn't the branch that runs:

1. The trap happens inside `wallet.withKeys`.
2. Its `serial` (`wallet.ts:582-584`) catches the trap, calls `broken()` (lock, wipe session storage, fresh module) and throws `WalletLocked(WASM_BROKEN())`.
3. `withdrawOne` rethrows that, since it isn't `NO_PRIVATE_PAYS` (6946).
4. In `bringAllBackNow`, `isTrap(e)` (`lovejoin.ts:6748`) is false.
5. `locked()` (6579) is true, because `unlockedAt()` throws once locked. The loop breaks at 6750, before `why` is set (6751).
6. `bringNoted` (6755) then can't write anyway. The schedule is in `PrivateStore`, which needs `withStoreKey` (`wallet.ts:551`), and that throws while locked.
7. The rejection ends at `runs.ts`'s `unlessTrap(undefined)`.

Nothing is recorded, `bringing` stands, and no failure is counted. The conclusion is the same; only the branch differs.

### 3. The worker's sort has a middle key

The claim says lovejoin-made first, then ascending value. `lovejoin.ts:6937-6938` sorts:

1. lovejoin-made first;
2. then UTxOs that don't tie another public account;
3. then ascending value.

The lying UTxO traps when it's the first in that order that isn't passed over. Rows passed over are those holding a token, someone else's, those with a reference script, and `PrivateTooSmall` ones. A lying index can make that so by inflating every UTxO, or the first one. With an honest UTxO that pays ahead of it, nothing traps (scratch case 7).

## Path from the export

1. **`build_lovejoin_withdraw_private`** (`wasm/src/lib.rs:6015`) calls **`withdraw_private_in`** (`wasm/src/lovejoin.rs:2745`).
   - For each row of `request.utxos`, it passes over tokens, `eval::refusal`, and rows it doesn't own. Ownership reads only the register's points.
   - Then `Coin::from_row(utxo)?` (`mod.rs:461`) runs `eval::resolve_row` → `resolve`, which parses `value` as a u64 and CBOR-encodes it (`eval.rs:131`), with no bound. It parses `value` again at `mod.rs:471`.
2. That calls **`lovejoin::withdraw_private`** (`mod.rs:1249`), then **`withdraw_with`**.
   - `total` is `denom × 1` (1338), and `paid_back` and `topped` are 0 for a Seedelf payer.
   - Nothing reads the coin's lovelace until the first `stage(500_000, …)`, whose `into_register(fee)` runs line 1392.
3. **Nothing refuses the value earlier:**
   - The private index's `isRow` checks only `/^\d+$/` (`private-index.ts:144`). The Koios path doesn't check the value at all.
   - The worker's balance reads sum in TypeScript BigInt (`chain.ts:171`, `sumValue`). `ownedUtxos` (`balances.ts:489`) reads only the datum.
   - The worker's sort uses BigInt.
   - Only a value past u64 is refused, in words ("has an unreadable value").

## Callers

### Background: a loop

- `bringAllBackNow` sends `paid: "private"` for a stuck token-pool box (`lovejoin.ts:6711`, 6732), through `withdrawOne`, to the build at 6944.
- It starts from the button (`handlers.ts:583-585`, `unawaited`).
- It runs again on every alarm run, and at each unlock:
  - `changed` calls `runSessions(worker, true)` (`sw.ts:173`);
  - `withdrawDueNow` takes `bringing` before anything else (`lovejoin.ts:6171-6172`).
- `bringing` lives in the sealed local store, so it survives the lock (correction 2).
- `lockedBy = "trap"` only changes the Unlock screen's message. Nothing breaks the loop while the index keeps lying.

### User-started: one lock per press

- `lovejoin-withdraw-now` with `paid: "private"` (`handlers.ts:565-571`) goes through `withdrawNow` to `withdrawOne`.
- The page offers it only for a pool whose boxes can't pay their own way back.

## The fix

The claim's fix, as applied in the copy (rustfmt-clean):

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

- **Honest values are unchanged.** `checked_add` is `Some` whenever the old sum fit. The honest cases' fee and lovelace are the same before and after.
- **Lying values are refused in words.**
  - `withdraw_private_in` returns the error. It isn't `PrivateTooSmall`, so the loop stops there.
  - The page shows the error.
  - *Bring every box back now* keeps it as `why`, and stops after `BRING_FAILED_RUNS` (3).
- **It adds no guard over the ledger.** It refuses only data the ledger can't produce. The wording follows core's `MORE_THAN_THERE_IS` and names the UTxO.
- **In the copy** (`scratchpad/review/ovf-verify-lovejoin-0/`):
  - `cargo fmt -p seedelf-core -- --check` is clean;
  - `seedelf-core`'s `lovejoin_pools_test` passes 31/31;
  - `seedelf-wasm`'s `lovejoin_flows_test` passes 14/14;
  - `cargo clippy -p seedelf-core --lib -- -D warnings` is clean;
  - the scratch test passes, with no panic in any case.
- **Optional, not needed:** pass such a row over in `withdraw_private_in` (`continue`, as for a row it can't take) against the wasm crate's existing `api::MAX_SUPPLY_LOVELACE`. It would then try the next UTxO instead of stopping. That's a judgement call; the claim's fix is enough.

## Scratch evidence

Each case drives `withdraw_private_in`, the body of the export, with:

- `lovejoin_flows_test.rs`'s stuck pool, `pool_ref_worth(1_500_000)`, whose box alone gives `CantPayBack`;
- the wallet's box;
- private rows whose `value` is what the index says.

| Case | HEAD | With the fix |
|---|---|---|
| Honest 5 ₳ | OK, fee 352,796 | Same |
| `u64::MAX − 5 ₳` (the claim's example) | OK: builds, no trap | Same |
| `u64::MAX − denom` (the sum is exactly `u64::MAX`) | OK | Same |
| `u64::MAX − denom + 1` | Panic at `mod.rs:1392:32`, "attempt to add with overflow" | ERR "UTxO e1…#1 and the box hold more ADA than there is" |
| `u64::MAX` | Panic at `mod.rs:1392:32` | ERR, same words |
| `2^64` | ERR "has an unreadable value" | Same |
| Honest 3 ₳ first, `u64::MAX` second | OK, spends the honest one | Same |
| `u64::MAX` first, honest second | Panic at `mod.rs:1392:32` | ERR, and it stops: the second isn't tried |
| `u64::MAX − 5 ₳` against a 9 ₳ box (not stuck) | Panic at `mod.rs:1392:32` | ERR |

- The in-tree file `seedelf-web-wallet/wasm/tests/zz_review_ovf_verify_lovejoin_0_1.rs` ran with `cargo test --locked -p seedelf-wasm`, and is deleted.
- The fix ran in the copy only.
