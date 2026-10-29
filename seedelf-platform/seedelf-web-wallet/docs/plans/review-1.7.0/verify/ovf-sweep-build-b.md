# ovf-sweep-build-b: `seedelf-core/src/build.rs` lines 1800 to the end

Lens: #332 checks overflow in core in `[profile.wasm-release]`, so an overflow is a trap and the wallet locks. I read every line from 1800 to 3918 (HEAD `6bca8bec`). Every `+ - * / %`, compound assignment, `.sum()` and cast was listed by script and then read in context. Each was traced to the `#[wasm_bindgen]` exports that reach it and checked against REAL, LYING and USER data, as the task defines them.

## Verdict

**No new site.** Apart from the already-known `apart()` sums, every arithmetic site in this range is bounded by construction or reached only by refused data. Four scratch probes (debug build, so overflow-checked as the store module is) back the claims that weren't obvious. All were deleted afterwards.

One **latent** site (a hazard, not a defect) is worth knowing: `ScriptSpend::settle`'s budget fold (1991–1993) traps on outside Ogmios budgets. No export passes it any today.

## The known sites in this range, confirmed

- **`apart()`, 2669, 2677 and 2722, are the only unchecked arithmetic in `apart()` and its closures.** 2677 is two operations: the `extra` `.sum::<u64>()` and the `base_lovelace +`. Its helpers do no unbounded arithmetic: `one_more` has only `token_tries += 1`, which stops at `MAX_TOKEN_SINGLES` = 12, and `grow` has none. `select_script_inputs`' blind path has no sum at all.
  - **Callers**, all actions the user starts: `buildMint` (stealth mint), `buildTransferParts` (private Send), `buildWithdraw`/`buildWithdrawParts` (Make public, and a session's funding or top-up through `sessions.ts` `buildFunding`, started from the UI or a site's `siteOutBuild`), and `buildLovejoinLaunch`. None is the alarm's run.
  - **Data:** LYING only, since real lovelace stays under the supply.
  - **Smallest fix:** u128. The three totals are only compared (`lovelace <= floor`) or used as sort keys.
- **`holding()`, ~2950 (`have`'s first `.sum()`) is the only unchecked operation in `holding()`.** 2961 is `saturating_add`. `quantity_in`'s `.sum()` (2933–2939) is its own function.
  - **I could not make 2950 overflow, and I believe it is bounded.** Both callers (2558, 2911) hand `holding()` only `fitting()`'s `taken` set. `fitting` runs `assets_of` on each row first (checked: a row whose token entries overflow is an error before anything else reads it). It then merges the rows it takes with checked adds, so each token's total over everything `holding` sees fits a u64. `picked` is a subset of that set.
  - Probe: rows r1 and r2 each hold `A: 1, B: u64::MAX`, and the spend needs `A: 2, B: 1`. `max_inputs` and `transfer_apart` both answer `Err("The Seedelf balance holds only 1 of the token …41, not 2")` with no panic, because `fitting` left r2 out.
  - Optional hardening if wanted: fold with `saturating_add`, as 2961 already does. `have` is only compared and printed.

## Every site in the range

| Line | Code | Why it can't overflow |
|---|---|---|
| 1923 | `change_minimum(&kept)? + rest_minimum(rest)?` | Two min-UTxO sums: (160 + output CBOR) × `coins_per_utxo_size` (≤ 20,000, capped in `from_koios`), one output per 20 tokens. Even a million tokens in memory sum to about 10^12. |
| 1929 | `fee - fee % 2` | `fee % 2 ≤ fee` |
| 1974 | `self.inputs.len() + 1` | A Vec's length plus one |
| 1991–1993 | Budget fold `a.mem + b.mem`, `a.steps + b.steps` | **Latent, see below.** Every export reaches it with the wallet's own uplc measure (eval.rs `MEASURE_LIMIT`, for the whole transaction, +1%) or `Budgets::guess` |
| 1999–2002 | `compute` `.sum()` | Runs after the `MAX_TX_BUDGET` check at 1995 |
| 2008, 2014 | `script_bytes +=` | Config sizes plus `reference_script_bytes`, a saturating sum of decoded bytes, so bounded by memory. `reference_script_fee` then refuses anything over 204,800 bytes, in words |
| 2022 | `even(linear_fee + compute + script_reference)` | `settle` prices only a size ≤ `MAX_TX_SIZE` (≤ 1.84e7 at the caps). `compute` is local. `script_reference` ≤ about 6.3e7 |
| 2031 | staged outputs − `self.outputs.len()` − `rest_outputs` (usize) | `stage` stages exactly `self.outputs`, then one rest output per `token_chunks` chunk (`deposit_outputs`/`pay_address`), then the change |
| 2035, 3702 | `fee - compute - script_reference` | `settle` returns a fee ≥ `price(size)` ≥ `compute + script_reference` |
| 2199; 2192 → 1146 | `fee * 3 / 2` (account collateral; `collateral_output`) | Every fee staged is `FIRST_DRAFT_FEE`, a price `check_fee` capped at `MAX_FEE` (1e7), or `most_fee`. `measuring_draft` uses `most_fee` only when staging at such a fee was short (every `NotEnough` in `stage`/`split`/`remainder` is "left − fee < what must stay"), so `most_fee` < that fee + one least change (< 1.7e7 at the caps) |
| 2620 | `token_tries += 1` | Stops at 12 |
| 2669, 2677, 2722 | `apart()` lovelace sums | **Known** (LYING) |
| 2922 | `at_most - taken.len()` | Runs after `taken.len() > at_most` bails |
| 2924 | `available.len() - taken.len()` | `taken` ⊆ `fitting`'s output ⊆ `available`: `holding` and `rest` take each row at most once |
| 2933–2939 | `quantity_in` `.sum()` | Reads only rows that passed `fitting`'s per-row `assets_of`, and counts a subset of the entries that checked sum counted. Probe: a row listing `T` twice (u64::MAX and 2) is `Err("Can't Add Assets: … Asset addition overflow")` before `quantity_in` runs |
| 2950 | `holding` `have` `.sum()` | **Listed as known; bounded** (above) |
| 3161 | `paid_out` `.sum()` | USER amounts: `lovelace_of` caps each at 45e15, `check_recipients` caps them at 20, and there is at most one extra (collateral) payment, so ≤ 9.5e17. Only `transfer_apart`/`sweep_many_apart` call it, fed by `transfer_plan`/`amounts_of` |
| 3260 | `lovelace / 1_000_000`, `% 1_000_000` | Division by a constant |
| 3305–3309 | `minimum_address_payment` `.sum()` | As 1923 |
| 3352 | `chunks.len() - 1` | `token_chunks` never returns an empty list (no tokens gives one empty chunk) |
| 3361 | `remaining -= amount` | `lovelace ≥ minimum` (the same per-chunk minimums) is checked first, and the last chunk takes exactly what remains |
| 3683 | `computation_fee` | An f64 with `ceil() as u64`: saturates, never panics |
| 3688–3689 | `seedelf_contract_size + reference_script_bytes(..)` | A constant plus a sum bounded by memory |
| 3694 | `even(linear_fee + compute + script_reference)` with Koios's budget (`finishAccountMint`) | One mint budget and no fold. At the price caps (0.577, 0.000721), `computation_fee(u64::MAX, u64::MAX)` ≈ 1.0657e19, plus ≤ 8.2e7, so under 2^64 by about 7.8e18. `check_fee` then refuses it in words |
| 3698 | `outputs.len() - 1` | `stage` always stages the Seedelf output first |
| 3742 | `fee * 3 / 2` | `stage` only ever gets `FIRST_DRAFT_FEE` or a fee `check_fee` has capped (≤ 1e7) |
| 1966, 2225, 2275; 2098 | `as u64`; `unsigned_abs` | Can't overflow |

The checked arithmetic in the range also holds: `remainder` (2108–2114), `split` (2058), `AccountMint::change` (3719–3721), the try_fold merges (3145, 3434) and the per-row `assets_of`.

## Probes (scratch file deleted)

`seedelf-core/tests/zz_review_ovf_sweep_build_b_1.rs`, debug, so overflow-checked:

1. **The account mint with a lying Ogmios budget** (memory and cpu u64::MAX), parameters at every `from_koios` cap, an honest account (100 ₳) and a lying one (≈ u64::MAX lovelace).
   - Result: `Err("This transaction's fee would be 10657071433010.304410 ADA, over the wallet's limit of 10.000000 ADA …")`, no panic. So 3694 and 3742 hold.
2. **`holding`'s `have`** (above): an error in words, no panic.
3. **A row listing one token twice past u64** through `max_inputs`: refused by `assets_of` in words. `quantity_in` never reads it.
4. **Lying lovelace through Max spends measured in the wallet** (`transfer_most` and `sweep_all` → `measure_locally`), with one row of u64::MAX − 615, two rows of 2^63, and one row of u64::MAX holding a token.
   - Results: `Ok`, `Err("Lovelace sum overflow")` and `Ok`. No panic anywhere in `draft`, `most_fee`, `settle`, `split` or `stage`.
5. **`ScriptSpend::finalize` with two outside spend budgets** whose memory sums past u64: `panicked at seedelf-core/src/build.rs:1992:22: attempt to add with overflow`. This is the latent site below.

## Latent (unreachable today): `ScriptSpend::settle`'s budget fold

- **Where:** `build.rs:1989–1994`, the fold `mem: a.mem + b.mem, steps: a.steps + b.steps`. It runs before the `MAX_TX_BUDGET` check.
- **What reaches it:**
  - `Budgets::from_ogmios` caps nothing.
  - Ogmios's own budgets reach `ScriptSpend::finalize` only through seedelf-wasm's `api::finish_mint`, `finish_transfer`, `finish_withdraw` and `finish_remove` (lib.rs:2436, 3139, 3533, 4843). These are `pub` in `mod api` and called only from `wasm/tests/api_test.rs`.
  - No `#[wasm_bindgen]` export calls them. The extension uses `buildMint`, `buildTransferParts`, `buildWithdraw(Parts)` and `buildRemove`, all measured in the wallet.
  - The one export that finishes with Ogmios's answer, `finishAccountMint`, goes through `AccountMint::settle`, which has no fold.
- **Hazard:** re-export a draft→Ogmios→finish flow for script spends, and a lying Koios traps it.
- **Optional hardening:** `saturating_add` in the fold. The total is only compared against `MAX_TX_BUDGET` and then refused as `TooMany`, which also bounds `compute`'s `.sum()`. Behaviour stays the same for honest budgets.

## Notes for neighbouring sweeps

- **eval.rs:148 (known) is also reached through this range.** `measure_locally` (build.rs:1846–1853) passes every input row to `eval::resolve_row` before any checked sum. (`remainder`'s `assets_of` runs later, in `measuring_draft`.)
  - Protected paths:
    - selection paths, by `fitting`;
    - a part's carried inputs, picked by `max_inputs_by` → `fitting`;
    - the session return (`plan_return` → `Draft::with` → `utxo_assets` per row, and `utxo_assets(merge).ok()`), so the alarm's returns error in words.
  - **Unprotected: `buildRemove`.** `remove_spend` checks only ownership and `seedelf_in`, so a lying row listing a second token twice traps there. It is user-started, one lock per attempt.
  - The known fix (`checked_add` in `resolve()`) covers it.
- **#332's F1 applies to `max_inputs_by<K>`.** Instantiated from seedelf-wasm (lib.rs:3923, `worth.of_utxo`), it compiles in seedelf-wasm, unchecked, so its arithmetic and its `fitting` instance wrap rather than trap. Everything in it is bounded anyway. `select_script_inputs`/`apart` are `pub(crate)`, instantiated only in core, so the known `apart()` sums do trap.

## Not checked

- Arithmetic outside the range that the range calls: `settle`/`value_size` (≤1800), `deposit_outputs`, `with_margin` (1299), staking.rs, transaction.rs and eval.rs. I read these only as far as the bounds above needed.
- Pallas's and uplc's own arithmetic, which keeps release arithmetic.
- I didn't build the store module; the probes are native debug builds.
