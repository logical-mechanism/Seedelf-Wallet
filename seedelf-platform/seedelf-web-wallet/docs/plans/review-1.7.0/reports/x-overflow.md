# x-overflow: arithmetic that now traps (#332), across #325–#338

Lens: #332 turned on `overflow-checks` for `seedelf-core`, `-crypto` and `-koios` in `[profile.wasm-release]` (Cargo.toml:51–58). A sum past its type now panics in the store module: `unreachable`, `isTrap`, the wallet locks (background/wasm.ts, runs.ts:58, sw.ts:378, handlers.ts:50). I started from every `#[wasm_bindgen]` export in `wasm/src/*.rs`, followed each call into core, crypto and koios, and listed every `+ - * << .sum() .pow()` and `as`-then-arithmetic in those crates (a scanner over every non-test line, then each site read by hand).

## Verdict

- **No value the ledger allows traps the module.** Every sum over token quantities in core is checked (`Asset::add`, `utxos::assets_of`) or bounded by `utxos::fitting`, which leaves out a UTxO whose tokens would pass 2^64 − 1 before any builder sums them; lovelace sums can't pass the ADA supply (4.5 × 10^16, 400× under 2^64); a hostile pool's box ADA and `Q` go through 314-core#1's checked sums, or through one box at a time. The reads that run without the user (balances, discovery's verify, `lovejoinOwned`, `lovejoinUsable`, a session's return, Home's pump, a restore's scan, a site's `getBalance`/`getUtxos`) reach no unchecked core sum on a chain value. So one hostile UTxO, payment to a Seedelf or a session, or hostile pool can't lock wallets in a loop.
- **One exception, proven on the store module itself:** `eval::resolve` sums a row's token quantities with a plain `+=`. A row naming one token twice can't come from the chain, but the data layer's pool list is passed to it verbatim, first thing in pool verification. A data layer that lies (the threat the pool list is built against: "each verified here again", and #336's Koios confirmation in this very release) locks every mainnet wallet that reads Lovejoin pools, in a loop. Finding 1.
- seedelf-wasm's own sums wrap rather than trap; none can wrap on a ledger value, but the docs say they're "checked by hand", and most aren't. Finding 2.

## Finding 1 (medium): a pool row the data layer lists with its NFT twice traps every pool list refresh

`seedelf-core/src/eval.rs:148–152`, in `resolve()`, which every `resolve_row` and `resolve_reference` goes through:

```rust
*tokens
    .entry(hex::decode(&asset.policy_id)?)
    .or_default()
    .entry(hex::decode(&asset.asset_name)?)
    .or_default() += quantity;
```

The same row is refused in words everywhere else: `utxos::assets_of` gives `Err("Can't Add Assets: Can't Add Asset To Assets: Asset addition overflow")`, `cip30::Amount::add_token` checks too. Before #332 the store build wrapped it: `u64::MAX + 2` is 1, so a doubled NFT read as one and the pool verified. Since #332 it traps.

**Path:** `refresh` (lovejoin-pools.ts:404) → `utxoOf(p.reference, …)` (443), assets verbatim (private-index.ts:401; `isRow`, 148–152, checks shape only) → `verified` → `lovejoinVerifyPool` (459) → `protocol_of` → `resolve_row(&pool.reference)` (wasm/src/lovejoin.rs:114, before `candidate`'s checks), and the script rows through `resolve_reference` (166). `tried` (246–252), `serviceDeps.pools` (597–600) and `readSet`'s `kept` (lovejoin.ts:2705–2706) all hand the trap on, so it locks under a page's request and under the alarm's runs alike.

**Scenario:** mainnet, data layer on (the default). Its `lovejoin/pools` answer lists a pool whose `reference.assets` is `[[P, "6c6f76656a6f696e", "18446744073709551615", 0], [P, "6c6f76656a6f696e", "2", 0]]`. The Lovejoin page's status, a swap review's room read, a run with a chain open, or a restore's copies read refreshes the list → `RuntimeError: unreachable` → locked. A device that kept a list before asks again after `REFRESH_MS` (5 min) or a worker restart, and locks again. A new or restored device, with no `listed` in its record, asks again at every pool read (lovejoin-pools.ts:415, which reads a record without `listed` as Remove wallet's), so opening Lovejoin locks it every time. The way out is Settings' Koios-only, which nothing points to.

**Proof** (scratch tests, deleted; copies at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/x-overflow/`):

- core, debug (checked as wasm-release now is): `eval::resolve_row` → `("attempt to add with overflow", "seedelf-core/src/eval.rs:148")`; `utxos::assets_of` on the same row → `Err`.
- seedelf-wasm, `lovejoin::verify_pool` on the pool as `refresh` builds it → panic at `seedelf-core/src/eval.rs:148`; the NFT listed once verifies; listed twice as 1 + 1 → `Err("It doesn't hold one Lovejoin NFT and ADA alone")`.
- extension, Vitest with the store module (`wasm/pkg`) through `PoolDiscovery` and `serviceDeps(...).pools` over a fake data layer:
  - `kept device, refresh: RuntimeError: unreachable isTrap: true`
  - `within REFRESH_MS: no trap`, then `after REFRESH_MS: RuntimeError: unreachable isTrap: true`
  - `fresh device, read 1, 2, 3: RuntimeError: unreachable isTrap: true` (asked 1, 2, 3 times)

**Fix:** in `resolve()`, `checked_add`, and refuse in words ("UTxO …#… holds more of a token than an output can"). `protocol_of` then fails, and `tried` leaves the pool out as it does any pool that doesn't verify. That one change covers every caller of `resolve_row`/`resolve_reference`. It isn't a guard on the user: the ledger can't make such a row.

**Test:** `resolve_row` of a row naming one token twice (2^64 − 1 and 2) is `Err`, not a panic. And, with the real module, `PoolDiscovery.refresh` over such a list resolves, keeps no pool and never traps. Both fail today.

Same class, lower stakes: `apart`'s lovelace sums (build.rs:2669, 2677, 2722) are unchecked too. Only an index reporting the user's contract UTxOs at a combined value past 2^64 lovelace reaches them, and only in a private send the user starts (one lock, not a loop).

## Finding 2 (low, docs): "its sums on amounts are checked by hand" isn't so

seedelf-platform/CLAUDE.md:94 and post-release-roadmap.md:387 say seedelf-wasm's sums on amounts are "checked by hand (`checked_add`)". Only `cip30.rs`'s `Amount` (136–152) and `chain_from_account_at`'s `needed` (lovejoin.rs:2160) are. The rest are plain `+`/`.sum()` and wrap silently in the store build:

- `Holdings::spare` (lovejoin.rs:847–848)
- `total +=` (2127, 2178)
- `owned_in`'s `boxes.len() as u64 * protocol.denom` (2490)
- `fees +=` (1866, 1871, 2272, 2413)
- `holding_enough` (lib.rs:3632–3635)
- `Worth::apart`'s total (3766)

Each sums lovelace, which the ADA supply bounds, or real boxes, so none wraps on a ledger value; token sums there are u128 or saturating. Behaviour is fine. The doc claims a property the code lacks, and the next u64 sum on token quantities in this crate (2^64 − 1 per output, three from anyone) would wrap silently while the doc says it can't. **Fix:** say "where a sum can pass a u64: `checked_add`; lovelace sums are bounded by the supply; token sums are u128 or checked".

## Every site, by what feeds it

**Chain values anyone can make** (token quantities, lovelace, pool datums), none past its type on a ledger value:

| Site | Op | Why it holds |
|---|---|---|
| assets.rs:66, 91; utxos.rs:240–262, 321 | `checked_add`/`checked_sub` | error, not trap |
| utxos.rs:392–433 `fitting` | merge (checked) | leaves out what would overflow (three 2^63 − 1 UTxOs) |
| build.rs:886–893 `held` `.sum()` | picked token over `fitting`'s eligible | bounded by `fitting` |
| build.rs:2934–2939 `quantity_in`, 2950 `holding` | `.sum()` | one entry a token in a chain row; over `fitting`'s set |
| build.rs:2669/2677/2722 `apart` | lovelace `.sum()`, `+` | ≤ supply (index lies: finding 1, note) |
| build.rs:1067, 3161 | `paid` / `paid_out` `.sum()` | user amounts, capped at 4.5 × 10^16, ≤ 20 recipients |
| eval.rs:148 | `+=` | **finding 1** |
| lovejoin/mod.rs:701–748, 1774–1798; value.rs:124 | checked | 314-core#1 |
| lovejoin/mod.rs:1338 `denom * n` | unchecked | n = 1 on every wasm path; real boxes ≤ supply |
| lovejoin/mod.rs:1392 `total + coin` | unchecked | real lovelace |
| lovejoin/pool.rs:464 | script sizes `.sum()` | ≤ 3 scripts |
| orders.rs:901 | order lovelace + consts | real lovelace; `assets_of` checked first (851) |

Hostile pool datums, run through what reads them (native, overflow-checked): box ADA 2^64 − 1, 2^63, fee cap 2^64 − 2, and `Q` 2^64 − 1. `verify_pool`, `usable` (and back-only), `owned_in` and `bootstrap_most_in` all answer; `funding_at` refuses in words. No panic.

**Koios / data-layer answers:**

- **Parameters:** bounded at parse by `ProtocolParameters::from_koios` (koios.rs `MAX_*`), so none overflows:
  - `linear_fee` saturates.
  - transaction.rs:27 is ≤ 20,000 × size.
  - `computation_fee` is an f64 with a saturating cast.
  - `reference_script_fee` is u128 with bytes ≤ 204,800.
  - mod.rs:1716 and 1749 come to about 3 × 10^7.
- **Ogmios budgets from Koios:** reach only `finish_account_mint`, which has one mint budget and no fold (compute ≤ 1.07 × 10^19, still under 2^64), and `declared_covers`, which only compares. Every budget fold (build.rs:1992, orders.rs:1019 and 1065, mod.rs:1074, `with_margin` at 1299) is over the wallet's own uplc measure, ≤ `MEASURE_LIMIT`.
- **Staking:** deposits and rewards pass through `lovelace_of` (≤ 4.5 × 10^16), and the key deposit is ≤ 10^7.

**Internal:**

- `mixes_per_box_at`'s `width.pow(depth)` (mod.rs:1632) would trap at depth ≥ 21 (width 3) or ≥ 16 (width 4), since wasm32's usize is 32 bits.
  - `fresh_for` and `check_depth` hold chains and funding to ≤ 3; `plan_at` and `plan_across_pools` don't.
  - The worker sends only `isLovejoinDepth` values (1–3), so it's unreachable.
- `fee * 3 / 2` (build.rs:1146, 2199, 3742; launch.rs:501; mod.rs:1016, 1450): the fee is ≤ `MAX_FEE` or is a withdraw's own measure.

**crypto:** field and group arithmetic only. `schnorr::prove`'s `32 - z_bytes.len()` (198) underflows for a z over 32 bytes, but only through `verifyProof`, which the extension never calls, and the slice index panicked there before #332 anyway. **koios:** `Ratio::exact` is checked, and the paging `+=` is CLI-only.

**The read paths' calls into core**, none of which does integer arithmetic on outside values:

- `decodeTx` and `inspectDappTx`/`inspectSessionTx` call `wallet_contract`, `get_config`, `drep_id`, `pool_id`, `is_payable` and `tx_id`.
- `isOwned` is curve arithmetic only.
- `ogmiosUtxos` builds JSON maps.
- `cip30Value`/`cip30Utxos` use the checked `Amount`.

## CLI notes

The CLI keeps `release` arithmetic (no checks), as #332 intends. `util extract`'s `total_computation_fee` (transaction.rs:193) and `util statistics`' `count_lovelace_and_utxos` (utxos.rs:478) are unchecked. Only a bogus Ogmios answer wraps the first, and the node then refuses an underpriced fee. The second is bounded by the supply.

## Not checked

- I didn't rebuild the module; `wasm/pkg` (built 15:57) carries the overflow panic strings and core's paths.
- I didn't audit uplc or pallas internals, which keep release arithmetic.
- I didn't trace each generic core function instantiated from seedelf-wasm: `Sum` there follows seedelf-wasm's unchecked setting, so the analysis assumes it checked, the stricter case.
- Of seedelf-data I read only the asset aggregation (one `ma_tx_out` row per asset per output): an honest data layer can't produce finding 1's row.
- TypeScript Number precision isn't this lens.
