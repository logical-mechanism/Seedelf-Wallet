# ovf-sweep-build-a: build.rs lines 1–1800 under #332's overflow checks

Scope: `seedelf-platform/seedelf-core/src/build.rs` lines 1–1809 on HEAD `6bca8bec`, read line by line, plus a scanner over every non-comment line for `+ - * / % << .sum .product .pow abs as`. Each hit is read by hand, and its inputs are traced to the WebAssembly exports and to every caller in core.

## Verdict

- **Nothing new to report in lines 1–1800.** Every integer operation in this range falls into one of these:
  - checked or saturating;
  - u128 with a proven bound;
  - guarded by the comparison just before it;
  - bounded by construction;
  - bounded by every caller.

  No REAL, LYING or USER value traps the module here.
- **The known site, `held` (888–893), is the only unchecked arithmetic in its function** (`account_payment`, 844–956). The only other sum there is line 864, which is `saturating_add`.
- **On HEAD, `held` can't overflow on any data.**
  - It sums over `eligible`, which `fitting` (utxos.rs:392–433) built so that every token's merged total fits a u64.
  - A LYING row naming the token twice makes `fitting`'s own `assets_of` (utxos.rs:401) fail first, in words.
  - Hex-case variants of one policy merge in `fitting` (it compares decoded bytes), while `held` compares strings exactly, so `held` ≤ `fitting`'s total.
  - Every scratch test below passed.
  - A fix there (u128 or `checked_add`) is harmless belt-and-braces, not a must-fix.
- **Three helpers aren't checked inside themselves:** `even` (1138), `collateral_output` (1146) and `Budgets::with_margin` (1299).
  - Each panics at its own line in a debug test when called directly with an extreme value.
  - No caller passes such a value (see *Latent* below). They're not findings.

## Sites

None.

## Bounded, line by line

| Line | Code | Why it can't overflow |
|---|---|---|
| 49–54 | `linear_fee` | `saturating_mul`, `saturating_add` |
| 84–93 | `reference_script_fee`, u128 | Bails above 204,800 bytes (71), so there are at most 8 tiers. `scaled` is under 2^38, times a u64 numerator is under 2^102, and the denominator × 5^8 is under 2^83. The result goes through `u64::try_from` with an error. Tested at 0…204,800 and u64::MAX bytes with numerator u64::MAX: no panic. |
| 159–160 | `TooLarge::fewer` | `saturating_mul`, `/ size.max(1)`, `saturating_sub`. An `as usize` cast truncates and never panics. The clamp's min ≤ max. |
| 206–211 | `value_size` `size +=` | Header sizes ≤ 9, plus name byte lengths: bounded by memory. |
| 278 | `fee - needed` | Guarded by `needed <= fee` on the same line. |
| 289 | `signers.max(1) + staking.signers()` (usize) | `signers` counts distinct input keys or is a constant 1/2, and `Staking::signers()` ≤ 2. |
| 373, 435 | `chunks.len() - 1` | Never empty: an empty `vec![Assets::new()]`, or `split(20)` of a non-empty list. `MAXIMUM_TOKENS_PER_UTXO` is 20 (constants.rs:95), so `chunks(0)` can't happen. |
| 385, 444 | `remaining -= amount` | Guarded by `remaining < amount` → bail on the line before. |
| 406–411 | `minimum_deposit` `.sum()` | Each term is `(OVERHEAD + cbor_len) × coins_per_utxo_size`, with `coins_per_utxo_size` ≤ 20,000 (koios.rs:989) and cbor bounded by memory. 2,000 tokens of u64::MAX come to 280,581,000. |
| 468–473 | `minimum_change` `.sum()` | Same as 406. |
| 568, 1020 | `price` closures | `saturating_add` |
| 864 | picked totals | `saturating_add` |
| 888–893 | `held` `.sum()` (known) | Bounded by `fitting`, as in the verdict. Tested: two REAL rows of u64::MAX each → Ok (Max leaves one out). A doubled LYING row → `Err("Can't Add Assets: … Asset addition overflow")`. Case variants → Ok. |
| 940 | `0..=rest.len()` | A range, no arithmetic. |
| 978 | `asked_in` | `fold(0, u64::saturating_add)` |
| 1002 | `a.amount - asked(a)` | Guarded by `.filter(a.amount > asked(a))` (1000). |
| 1024–1027, 1038–1042 | Max's `all`, `change` | `checked_sub` chains |
| 1053 | `outputs += 1` (usize) | Counts outputs built in memory. |
| 1067 | `paid.iter().sum()` | For Max, `paid` is one element. Otherwise it's the last `each` whose `try_fold(total, checked_sub)` succeeded: an `Err` returns before the `(paid, change) =` assignment, and `settle` returning `Ok` means the last draft succeeded. So the sum ≤ `total` ≤ u64::MAX. Tested: USER amounts 2 × (2^63) → `Err(SEND_SHORT)`. A LYING u64::MAX-lovelace UTxO paying 2^64 − 10^7 − 2 → Ok. No panic. |
| 1138 | `even`: `fee + fee % 2` | Overflows only at `fee == u64::MAX`; no caller gets there. See *Latent*. |
| 1146 | `collateral_output`: `fee * 3 / 2` | Overflows only for `fee > u64::MAX / 3`; every caller's fee is at most `MAX_FEE` plus one change output's minimum (under 20 ₳ even at `from_koios`'s caps). See *Latent*. |
| 1160 | `witness.len() - 128` | Guarded by `.filter(w.len() >= 128)` (1157). |
| 1274 | `0..mints as u64` | A range. |
| 1299 | `with_margin`: `x + (x * percent).div_ceil(100)` | Only ever called with `percent` 1, on budgets the wallet measured itself, which are ≤ `MEASURE_LIMIT` (eval.rs:38). See *Latent*. |
| 1693–1697 | `ScriptSpend::output` | `checked_add` with an error. `Assets::merge` is checked (assets.rs:66). |
| 554–584 | `external_sweep` (all of it) | `assets_of` is checked, `checked_lovelace` is `checked_sub`, the price saturates, `deposit_outputs` is guarded. This builder is a background path: a session's return sweep (lib.rs:1500 `session_return` → `planned_return`; lovejoin.rs:494, 1827). None of it traps on anything sent to a session. |

## Latent: unchecked inside, bounded by every caller

Each of these panics at its own line in a debug test called directly:

- `even(u64::MAX)` panics with "attempt to add with overflow" at build.rs:1138.
- `collateral_output(_, u64::MAX / 3 + 1)` panics with "multiply with overflow" at 1146:22.
- `with_margin(1)` on a memory budget of u64::MAX panics with "add with overflow" at 1299:39.

At the values callers pass, all three are fine.

**`even`'s callers:**

- build.rs:2022 (`ScriptSpend::settle`): `settle` refuses a draft over 16,384 bytes before pricing it, so `linear_fee` ≤ 18.4 M. `compute` comes after the total check at 1995 (≤ `MAX_TX_BUDGET`), so it's ≤ about 16.7 M. `script_reference` ≤ 63.4 M.
- orders.rs:1034 and launch.rs:558 have the same shape, over the wallet's own measure.
- lovejoin/mod.rs:1091: `check_fee` runs first, so the value is ≤ `MAX_FEE`.
- lovejoin/mod.rs:1599: `price` of the wallet's own measure plus a 1% margin.
- build.rs:3694 (`finish_account_mint`, the one fed Koios's Ogmios budgets, through `finishAccountMint`): even with u64::MAX on both axes, `computation_fee` ≤ 1.0657 × 10^19 under `from_koios`'s price caps. The sum stays under u64::MAX, `even(1.0657e19 + 1)` was tested fine, and `check_fee` then refuses it in words.

**`collateral_output`'s callers:**

- build.rs:2192 (`ScriptSpend::stage`):
  - From `settle`, the fee is `FIRST_DRAFT_FEE` or a value `check_fee` passed (≤ `MAX_FEE`).
  - From `draft()`, it's the estimate's settled fee.
  - From `measuring_draft` (1896), it's `most_fee`. That path runs only when the draft is short (`NotEnough`), and a draft is short only when the remainder at the draft's fee is under the change and rest minimums:
    - With a rest or tokens kept, `most_fee` = remainder − those minimums, which is under the draft's fee (≤ `MAX_FEE`).
    - With neither, it's the whole remainder, under the draft's fee plus one ADA-only change output's minimum: about 1.4 ₳ today, about 7 ₳ at `coins_per_utxo_size`'s cap.
    - So it's under 20 ₳ in every case, even when a LYING index reports a UTxO of u64::MAX lovelace (then the draft isn't short at all).
  - The same bound covers the account branch's own `fee * 3 / 2` at 2199, which is outside my range.
- lovejoin/mod.rs:1023: the mix loop's fee, from `check_fee` or the draft's.
- lovejoin/mod.rs:1457: the withdraw loop's fee, 500,000 or `even(price)` of its own measure.

**`with_margin`'s callers:** build.rs:1872–1873, launch.rs:608–609 and lovejoin/mod.rs:1601. Each is over `eval::evaluate`'s answer, which uplc caps at `MEASURE_LIMIT`, (14 × 10^9 steps, 2 × 10^7 memory). No Koios budget reaches it.

**Optional hardening (owner's call, not a finding).**

- The one that fits the code as written is `fee.checked_mul(3)` in `collateral_output`, since it already answers a too-large fee with an error in words. It would refuse only what is already refused.
- `with_margin` and `even` would need `saturating_*`.

None of the three is reachable today.

## The paths in, for the record

- `account_payment` / `build_account_payment` are reached three ways, each from a review the user starts (no background loop):
  - `build_move_in` (lib.rs:6162 → `api::move_in` 532 → `build::move_in` 554), from background/move-in.ts:103.
  - `build_account_send` (6178 → `account_send` 1668 → `account_send_many` 1695), from send.ts:141.
  - `build_staking` (6191 → `stake` 1882 and `drep_transaction` 1956 → `account_staking` 1924, 2010), from staking.ts:556.
- `external_sweep`: the session returns above, which the alarm's runs and Home reach.
- `collateral_signature` and `add_witnesses`: `finish_lovejoin_withdraw` (lovejoin.rs:2886–2892, export at lib.rs:6038) and lib.rs:4963–4969. Only the guarded subtraction at 1160.
- `minimum_deposit`: lib.rs:2975, 3722 and 4764.
- `ScriptSpend::new` … `draft` (1536–1803): every Seedelf spend. The only arithmetic in range is `output`'s checked sums.
- The Ogmios-finished `ScriptSpend::finalize` paths (lib.rs:2440, 3147, 3544, 4850, behind `finishing`) aren't `#[wasm_bindgen]` exports. Only `finish_account_mint` and `finish_lovejoin_withdraw` are, so Koios budgets reach no `ScriptSpend` fold.

## Tests (deleted)

`seedelf-core/tests/zz_review_ovf_build_a_1.rs`, debug profile (overflow-checked, as wasm-release now builds core). It ran 9 tests and all passed:

- `held_two_max_rows`: Ok.
- `held_two_max_rows_max`: Ok, left_out 1.
- `held_doubled_row`: `Err: Can't Add Assets: Can't Add Asset To Assets: Asset addition overflow`.
- `held_case_variants`: Ok.
- `paid_sum_user_amounts`: `Err: Not enough ADA in the Cardano account for this payment, its fee and the change`.
- `paid_sum_lying_lovelace`: Ok, lovelace 18446744073699551614.
- `minimums_many_tokens` (2,000 tokens of u64::MAX): Ok, 280,581,000.
- `reference_script_fee_extremes`: Ok up to 204,800 bytes (63,356,485 at the cap), refused above it in words.
- `latent_helpers`: the three panics quoted above. At bounded values (`MEASURE_LIMIT`, `MAX_FEE`, 1.0657e19 + 1) none panics.

## Not checked

- transaction.rs:27, `(OVERHEAD_COST + cbor_len) * coins_per_utxo_size`, which feeds 406 and 468. It's another file; by my reading it's bounded by memory × 20,000.
- Lines 1810 onward (another sweep's): 1923, 1992, 2008, 2014, 2022, 2031, 2035 and the rest.
- Pallas internals, which keep release arithmetic.
- I didn't rebuild the module, and I ran nothing against the store build.
