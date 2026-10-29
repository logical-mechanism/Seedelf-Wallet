# ovf-sweep-rest: unchecked arithmetic in core (not build.rs), koios and crypto

Label `ovf-sweep-rest`. HEAD `6bca8bec`. Lens: #332 builds core, crypto and koios with overflow checks in `[profile.wasm-release]`, so a sum past its type in code those crates compile is a trap in the store module, and a trap locks the wallet (`runs.ts` 55-62, `wallet.trapped()`).

**Files read, line by line:** every `seedelf-core/src/*.rs` but `build.rs` (`eval`, `utxos`, `assets`, `transaction`, `cbor`, `note`, `orders`, `staking`, `withdraw_zero`, `address`, `constants`, `data_structures`, `references`, `lib`), all of `seedelf-core/src/lovejoin/` (`mod`, `pool`, `launch`, `box_value`, `value`, `templates`), all of `seedelf-koios/src/`, all of `seedelf-crypto/src/`. A scratch folder `review/ovf-sweep-lovejoin/` exists, so `lovejoin/` is probably that sweep's too: take the `lovejoin/` lines here as a cross-check.

**Method:** a scanner over every non-test line for `+ - * / % << >>`, compound assignments, `.sum()`, `.pow`, `div_ceil` and length arithmetic (`scratchpad/review/ovf-sweep-rest/scan.py`), then each hit read in context. Each live site was traced up to a `#[wasm_bindgen]` export and the worker's caller. The two sites below were run in scratch tests, in core and through seedelf-wasm's own entry functions. Both scratch files are deleted.

## Verdict

- **Two new sites trap on a lying index, and both callers loop.** Neither is reachable with real chain data.
  - `lovejoin/mod.rs:1392`: a private UTxO reported above the ADA supply, paying a stuck box's way back.
  - `orders.rs:901`: a Splash order reported at near 2^64 lovelace, cancelled by a stopping session.
  - Each runs in a step the alarm and the unlock run repeat: *Bring every box back now* (`withdrawDue`) and a stopping session's cancel (`sessions.runAll`). So a data layer that keeps the lie locks the wallet at every unlock.
  - Both functions are compiled in core, so the store module checks them. Neither is in v-pr332-0-trace's IR list of core functions seedelf-wasm compiles (`scratchpad/review/v-pr332-0-trace/core_fns_compiled_in_seedelf_wasm.txt`).
- **No REAL-data and no USER-data overflow found in these files.** Every token sum is checked (`Asset::add`/`sub`, `Assets::merge`, `utxos::assets_of`, `BoxValue::token_total`, 314-core#1's planner sums). Lovelace sums are over real rows (≤ the supply) or over figures from capped parameters.
- **The known site, `eval.rs:148`, is the only unchecked arithmetic in `resolve()`.** Its other arithmetic, `eval.rs:162-163`, is `2 + bool + bool` ≤ 4. One more caller the known fix also covers: `orders.rs:793` resolves the DEX order script's reference row from Koios `utxo_info` (sessions.ts:4032). That row never goes through `assets_of`, so a lying Koios listing a token there twice traps a stopping session's cancel at `eval.rs:148`, on the same loop as site 2. A `checked_add` in `resolve()` closes it with the rest.

## Sites

### 1. `seedelf-core/src/lovejoin/mod.rs:1392`, a private payer's ADA added to the box's (LYING, loops)

```rust
let into_register = |fee: u64| -> Result<u64> {
    Ok(match (payer, seedelf) {
        (Some(_), _) => paid_back,
        (None, Some(s)) => (total + s.coin.lovelace).saturating_sub(fee),   // 1392
        (None, None) => total.saturating_sub(fee),
    })
};
```

- **Data: LYING.**
  - `total` is one box's ADA: `denom × 1`, and a real box holds exactly `denom`, so it's ≤ the supply.
  - `s.coin.lovelace` is the private UTxO's `value` as the index reports it (`Coin::from_row`, mod.rs:471, a plain `parse`; the worker's `isRow` checks only `^\d+$`, private-index.ts:142-143).
  - Real rows sum to ≤ 9 × 10^16. Only a reported value above 2^64 − 1 − `denom` overflows.
- **Path:**
  - `buildLovejoinWithdrawPrivate` (wasm lib.rs:6014-6015)
  - → `lovejoin::withdraw_private_in` (wasm lovejoin.rs:2745, the call at 2774)
  - → `withdraw_private` (mod.rs:1249) → `withdraw_with` (1299)
  - → `stage` (1397-1399) → `into_register` (1389) → 1392.
  - It's the first build, before anything is measured.
- **Callers:** `withdrawOne(…, { paid: "private" })` (background/lovejoin.ts:6923-6944). It's called from:
  - *Bring one back now* on a pool's page (6480, user-started: one lock a try);
  - *Bring every box back now* for every stuck token-pool box (6711, 6722-6733). That one runs inside `withdrawDue` (6172 → `bringAllBackNow`, 6552), which `runs.ts:95` runs on every alarm and unlock run. `bringing` stays in the record through a lock: **loop**.
- **Scenario:** mainnet, data layer on.
  1. A token pool's boxes can't pay their own way back (`cantComeBack`), and the user has started *Bring every box back now*.
  2. The data layer lists one of the wallet's Seedelf UTxOs of ADA alone (its real datum, so `is_owned` passes) at `18446744073709551615`.
  3. `withdraw_private_in` reaches it as the first that pays: `into_register(500_000)` overflows, `RuntimeError: unreachable`, `isTrap` is handed on (lovejoin.ts:6748), `wallet.trapped()`, locked.
  4. The next unlock's run goes straight back to `bringAllBackNow` and locks again. The way out is Settings' Koios-only.
- **Proof** (scratch, deleted):
  - **Core, debug, classic box of 10 ₳:**

    | Payer | Result |
    |---|---|
    | 5 ₳ | `Ok(14654672)` |
    | 2^64 − 1 − 10,000,000 | `Ok(18446744073709206111)`: builds a withdraw the ledger would refuse; no trap |
    | 2^64 − 1 − 9,999,999 | `attempt to add with overflow` at `seedelf-core/src/lovejoin/mod.rs:1392` |
    | 2^64 − 1 | `attempt to add with overflow` at `seedelf-core/src/lovejoin/mod.rs:1392` |

  - **Through `seedelf_wasm::lovejoin::withdraw_private_in`** with the worker's JSON shape (box row and private row as Koios rows):
    - `"5000000"` → `Ok("14654672")`;
    - `"18446744073709551615"` → the same panic at mod.rs:1392.
- **Fix:** refuse in words. `into_register` already returns `Result`, and no UTxO holds more ADA than there is:
  ```rust
  (None, Some(s)) => total
      .checked_add(s.coin.lovelace)
      .with_context(|| format!(
          "UTxO {}#{} holds more ADA than there is",
          hex::encode(s.coin.utxo.tx_hash),
          s.coin.utxo.index
      ))?
      .saturating_sub(fee),
  ```
  Honest values are unchanged.
  - *Bring every box back now* then keeps the reason as its `why`, and stops after `BRING_FAILED_RUNS`.
  - *Bring one back now* shows it.
  - A test: `withdraw_private` with a payer of `u64::MAX` is `Err`, not a panic.
- **Confidence:** high. **Severity, my call:** low to medium. It needs a lying index and a stuck token-pool box, but its caller loops.

### 2. `seedelf-core/src/orders.rs:901`, a Splash refund plus the kept collateral (LYING, loops)

```rust
let keep = spend_collateral
    && lovelace_in
        .checked_sub(refunded_lovelace + KEEP_AT_FEE + SESSION_COLLATERAL)   // 901
        .and_then(|rest| change_outputs(c.params, c.address, rest, &kept_tokens, CANCEL_SHORT).ok())
        .is_some_and(|rest| !rest.is_empty());
```

- **Data: LYING.** `refunded_lovelace` is the Splash order row's `value` (`assets_of`, 853). A real order holds ≤ the supply. Overflow needs the reported value above 2^64 − 1 − 6 ₳ while `assets_of(spent)` (851) still fits. That holds when the session's other ADA-only UTxOs come to under 1 ₳ beside its 5 ₳ collateral, as after a swap that spent the rest.
- **Path:**
  - `buildOrderCancel` (wasm lib.rs:5671-5672) → `api::build_order_cancel` (lib.rs:790, the call at 815)
  - → `orders::cancel_orders` (681)
  - → the first `build_cancel` is short (`REFUND_SHORT`, 937, `is_short`)
  - → `build_cancel(…, spend_collateral = true)` (810-811) → 899-901.
  - `checkOrderCancels`' dry run (`check_cancels`) can't get here: its stand-in funds are 20 ₳, so `assets_of` refuses any order value that would pass at 901.
- **Callers:** sessions.ts `cancel` (3991) → `cancelOf` (4013; `buildOrderCancel` at 4046, whose catch hands the trap on at 4048). It's reached from a stopping session's step (3640, 3651: `auto.stopping`), run by `sessions.runAll` on every alarm and unlock run (runs.ts:83). `auto.stopping` stays in the record: **loop**.
- **Scenario:** mainnet, data layer on.
  1. A session was stopped with its Splash order open, and holds its 5 ₳ collateral and nothing else of ADA alone.
  2. The data layer lists the order at `18446744073704051615` (2^64 − 1 − 5.5 ₳).
  3. The first build is short, since the refund takes the order's ADA and nothing pays the fee. The second spends the collateral: `assets_of` gives O + 5 ₳ ≤ 2^64 − 1, then line 901 adds 6 ₳ to O. Trap, locked.
  4. The next unlock's run cancels again and locks again.
- **Proof** (scratch, deleted; the Splash fixture from `tests/fixtures/order_cancels.json`):
  - **Core `cancel_orders`:**

    | Order value | Funds | Result |
    |---|---|---|
    | 4.5 ₳ (honest) | none | `Ok` (fee 207980) |
    | 2^64 − 1 − 5.5 ₳ | none | `attempt to add with overflow` at `seedelf-core/src/orders.rs:901` |
    | 2^64 − 1 − 5.5 ₳ | 0.4 ₳ | `attempt to add with overflow` at `seedelf-core/src/orders.rs:901` |
    | 2^64 − 1 − 6 ₳ | none | `Ok` |

  - **Through `seedelf_wasm::api::build_order_cancel`** with the worker's JSON (session address, `funds: []`, a 5 ₳ collateral row): the same panic at orders.rs:901.
- **Fix:** check the sum inside the same chain:
  ```rust
  && refunded_lovelace
      .checked_add(KEEP_AT_FEE + SESSION_COLLATERAL)
      .and_then(|held| lovelace_in.checked_sub(held))
      .and_then(|rest| change_outputs(…).ok())
      .is_some_and(|rest| !rest.is_empty());
  ```
  When the sum passes a u64 it's above `lovelace_in` anyway (the refund is part of it), so `None`, and `keep = false` is exactly what exact arithmetic gives. Honest values are unchanged. The cancel then builds, and the ledger refuses it for the lie, with no lock.
- **Confidence:** high. **Severity, my call:** low. It needs a lying index, a Splash order and a near-empty session, but its caller loops.

## Bounded, one line each

**eval.rs**
- `eval.rs:162-163`: `2 + u64::from(bool) + u64::from(bool)` ≤ 4. With 148 (known), the only arithmetic in `resolve()`.
- `eval.rs:260`: `slot_at` is (2^64 − 1)/1000 + 4,492,800 < 2^64.

**utxos.rs**
- `utxos.rs:132`: the count breaks at `MAXIMUM_WALLET_UTXOS` (20) first.
- `utxos.rs:240/251/260/321` are `checked_add`; `288/289/298/375` are saturating.
- `utxos.rs:280`: `(len / 20) + 1` ≤ a Vec's length + 1.
- `utxos.rs:397-427` `fitting`: its only sum is `Assets::merge` (checked). It's generic over the caller's closure, so compiled in seedelf-wasm for `max_inputs_by`, but it holds no arithmetic of its own.

**assets.rs**
- `assets.rs:66-69, 91-94`: `checked_add`/`checked_sub`. `Assets::add`, `merge` and `separate` all go through them.

**transaction.rs**
- `transaction.rs:27`: `coins_per_utxo_size` ≤ 20,000 (the `from_koios` cap; the module makes `ProtocolParameters` only through `from_koios`) × (160 + an output's length, < 2^32 on wasm32) ≈ 8.6 × 10^13.
- `transaction.rs:150`: f64, and `as u64` saturates; never a panic.

**cbor.rs**
- `cbor.rs:204` is `checked_mul`.
- `cbor.rs:216`: a break byte's position + 1 ≤ len.
- `cbor.rs:241`: `*left -= 1` only on an entry ≥ 1. 0 is never pushed, and an entry that reaches 0 is popped.

**note.rs**
- `note.rs:114`: `cut` goes down from 64 to a char boundary, ≥ 61.
- `note.rs:117`: `space + 1` ≤ 64.

**orders.rs**
- `orders.rs:311-312`: the tag is held to 121..=127 or 1280..=1400 by the match.
- `orders.rs:539`: `u8 >> 4`.
- `orders.rs:851/853` go through `assets_of` (checked); `927/937/965` are checked.
- `orders.rs:1012`: the pinned `orders.json` reference sizes of one group's orders.
- `orders.rs:1019-1020, 1027-1030, 1034, 1065-1066`: budgets the wallet's own evaluator measured (`MEASURE_LIMIT`, 1.4 × 10^10 steps and 2 × 10^7 memory a transaction, ×1.01 a round, ≤ 3 rounds) × capped prices. `linear_fee` saturates, and the fee is ≤ `MAX_FEE` (`settle`'s `check_fee`).
- `orders.rs:1347`: `version - 1` on the pinned table's version, held to 1..=3 by `table()`. `integrity_hash` has no wasm caller.

**staking.rs**
- `staking.rs:383` ≤ 2.
- `staking.rs:398/422/433`: one or two certificates' deposits, each from capped parameters (≤ 5 × 10^9) or the wasm crate's `lovelace_of` (≤ 4.5 × 10^16, wasm lib.rs:192-199). `Staking` is only ever built by the wallet's own builders.
- `staking.rs:410`: ≤ 1 registration × `key_deposit` ≤ 10^7.
- `staking.rs:443-448` is checked.

**lovejoin/mod.rs**
- `mod.rs:242`: the bundled classic references' script sizes.
- `mod.rs:564-571` `price`: `linear_fee` saturates; budgets are measured locally (≤ `MEASURE_LIMIT`, ×1.01); prices are capped; the script fee is ≤ about 1.3 × 10^8.
- `mod.rs:701-718, 742-750` are checked (314-core#1).
- `mod.rs:780`: indexes into the deposit's own outputs.
- `mod.rs:837`: the constructor index is 0 or 1.
- `mod.rs:1016`: a mix's fee ≤ `MAX_FEE` (`check_fee`, 1085). `mod.rs:1450` and `1427`: a withdraw's fee is its own `price` (≤ about 10^12), plus `topped` (≤ a Seedelf output's minimum).
- `mod.rs:1047`: signer counts from key lists (1 or 2; wasm lovejoin.rs:1541-2658).
- `mod.rs:1074-1075`: the local measure, ≤ `MEASURE_LIMIT`.
- `mod.rs:1086/1110/1562/1584`: guarded by the comparison, or by the stage's `checked_sub` at the same fee.
- `mod.rs:1338` (`denom × boxes`): every caller passes one box (wasm lovejoin.rs:2564, 2661, 2774 `slice::from_ref`; pool.rs:618 and box_value.rs:281 `&[boxed]`).
- `mod.rs:1542`: the in-memory scripts' bytes + 629.
- `mod.rs:1632` (`width.pow(depth)`): **USER, held by the worker.**
  - Width is `check_width`'d to {3, 4} before every call.
  - Depth reaches it unchecked only from wasm `plan_at`/`plan_across_pools`/`chain_at` (lovejoin.rs:1110, 1238, 1479, through `*_affordable_in`). The worker's depth there is held to 1–3 by `isLovejoinDepth` (shared/preferences.ts:84, 180), or is a fixed 0. Every other path checks 0..=3 first (`check_depth`, `fresh_for`).
  - An out-of-range depth would trap at ≥ 21 (width 3) or ≥ 16 (width 4).
- `mod.rs:1716-1717, 1749-1750`: capped parameters, each term ≤ about 10^7.
- `mod.rs:1782/1788/1804`: `mixes_per_box_at` ≤ u32::MAX on wasm32 × ≤ 1.5 × 10^6 ≈ 6.4 × 10^15.
- `mod.rs:1828` (`again_funding_in`): boxes is a wasm32 usize × ≤ 3.15 × 10^7 at depth ≤ 3 (`check_mix`, wasm lovejoin.rs:1969, 2340) ≈ 1.4 × 10^17.
- `mod.rs:1887`: n ≤ left/per, so n·per ≤ left.
- `mod.rs:2025/2029`: the binary search, with mid ≥ 2.
- `mod.rs:2038/2045` (`again_affordable`, `again_funding`): no caller in core or the wasm crate (2038 would divide by zero at depth 0).
- `mod.rs:2351`: depth is held to 0..=3 two lines up; trees is a slice length, × ≤ 63.
- `mod.rs:2383/2421`: small usize.

**The rest of lovejoin/**
- `pool.rs:464`: ≤ 3 reference scripts' lengths.
- `value.rs:49` is 1 + bool; `value.rs:124` is `checked_mul`.
- `launch.rs:92/97` (`Locked`): minimum-UTxO figures from capped parameters, and `key_deposit` ≤ 10^7. It's compiled in seedelf-wasm and wraps, per v-pr332-0-trace; it's bounded either way.
- `launch.rs:501/558`: the fee is ≤ `MAX_FEE` (`settle`).
- `launch.rs:566`: `settle` returns a fee ≥ `even(linear + compute + script)`, so it's ≥ 0.
- `launch.rs:562`: the staged outputs include `self.outputs`.
- `box_value.rs:206, 374-386, 393`: /2, constant search bounds, and least ≤ `SEARCH_HIGH` (2 × 10^7).
- `templates.rs:79`: len + 1.

**koios**
- `koios.rs:936-967` `Ratio::exact`: `checked_sub`, `checked_mul`, `checked_pow`, and `%` and `/` by a non-zero.
- `koios.rs:383`: a break byte's position + 1.

**crypto**
- `derivation.rs:60/83/90/123/145`: word and phrase lengths.
- `derivation.rs:76`: `2 * phrase.len()` would need a typed phrase over 2 GiB.
- Field and group arithmetic mod r, not integers: `derivation.rs:188-192`, `lovejoin.rs:111-112, 204-211, 285-309`, `register.rs`, `schnorr.rs:134-150, 204-225`.
- `lovejoin.rs:121-122`: u8 shifts by 1 and 7.
- `schnorr.rs:145/216`: c is blake2b-224, 28 bytes.
- `schnorr.rs:198`: `32 - z_bytes.len()` underflows for a z over 32 bytes, but only through `verifyProof` (wasm lib.rs:6385), which nothing in `extension/src` calls. The slice index panicked on the same input before #332.
- `cardano.rs`: only bitwise `HARDENED |`.

**No integer arithmetic:** `address.rs`, `constants.rs`, `data_structures.rs`, `references.rs`, `withdraw_zero.rs`, `hashing.rs`, `convert.rs`, `lib.rs`.

## Not traps (for the record)

- **`mod.rs:1823` and `2038`: an `as usize` truncation on wasm32.** It applies to a spare over about 4.08 billion ₳ (count × 950,000 past u32::MAX). It wraps a box count rather than trapping, so it's outside the lens.
- **A set of inputs holding more than 2^64 − 1 of one token together is refused in words.** The places are `mod.rs:703-705` (`deposit_across`'s `kept` merge) and `orders.rs:851` (`assets_of(spent)`). The ledger would take such a set if the outputs split it. That's a refusal, not a trap, and a question for whoever owns those builders.

## CLI notes (not the store module: no wasm caller)

- `utxos.rs:478` `total_lovelace += value`: `count_lovelace_and_utxos`, `util statistics`.
- `transaction.rs:189-194` `total_computation_fee`'s `.sum()`: `util extract`.
- `koios.rs:268` and `883` i32 paging offsets: `credential_utxos`, `address_transactions`.

All three wrap in the CLI's release build. Only a bogus Koios or Ogmios answer reaches them.

## Scratch

- **Tests:** `seedelf-core/tests/zz_review_ovf-sweep-rest_1.rs` and `seedelf-web-wallet/wasm/tests/zz_review_ovf-sweep-rest_2.rs`. Both were run with `cargo test --locked -p <crate> --test …` and both are deleted.
- **Left in scratch:** `scratchpad/review/ovf-sweep-rest/scan.py`.
- No tracked file was touched. `seedelf-core/tests/zz_review_ovf_sweep_build_b_1.rs` is another agent's, and was left alone.
