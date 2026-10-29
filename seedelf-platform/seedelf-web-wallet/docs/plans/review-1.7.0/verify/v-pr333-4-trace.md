# v-pr333-4-trace: pr333#4, core's dear-byte token-pool case uses a pool the ledger's minimum refuses

**Verdict: confirmed. Severity: nit (tests and docs).** Checked on HEAD `6bca8bec`. #338 is docs only and doesn't touch these lines. Both lines came in with #333 (`fe900cea`).

## What the code does

- **The test**, `seedelf-core/tests/lovejoin_pools_test.rs:1813-1814`:
  - `assert_eq!(lovejoin::bootstrap_most(&dear, &lj, true, 64).unwrap(), 64);`
  - `assert!(bootstraps(&dear, &lj, true, 64).is_some());`
  - `dear` is `coins_per_utxo_size * 3 / 2`, which is 6,465.
  - `lj` is `lj_pool()`: Lovejoin's preprod LJTEST pool, seed `5c6f327e…#2`, with 2 ₳ in each box.
- **The builder doesn't check the box minimum.** `deposit_across` (`lovejoin/mod.rs:657-800`) outputs each box with `BoxValue::output`, which is `Output::new(address, self.lovelace)` (`value.rs:104-117`). Nothing compares that to `calculate_min_required_utxo`. The box minimum is checked only in `usable` → `measured` (`pool.rs:597-602`, `if minimum && pool.denom < box_minimum { return Err(Unusable::BelowMinimum …) }`). `bootstrap_most` never calls it. So `bootstrap_most` and the test's `bootstraps` build a deposit whatever the box's minimum is.
- **The worker refuses the pool before it asks for a cap.**
  - `privateBootstrapMost` (`background/lovejoin.ts:2947-2957`) calls `await this.takesNewBoxes(network, read, params)` before `lovejoinBootstrapMost`.
  - `takesNewBoxes` (`:3944-3949`) goes through `usableNow` (`:3911-3933`). For WebAssembly's `belowMinimum`, `usableNow` sets `why`, and `takesNewBoxes` then throws `lj.unusable.warn.belowMinimum`.
  - WebAssembly's `usable` (`wasm/src/lovejoin.rs:783-805`) calls `lovejoin::usable` and maps `BelowMinimum` to `"belowMinimum"`.

## Scratch runs (both deleted)

**Rust:** `seedelf-core/tests/zz_review_v-pr333-4-trace_1.rs`, a copy of the test's helpers. It passed on HEAD:

```
usable(today, LJTEST) = Ok(Usable { box_minimum: 1547290, withdraw_fee: 410676, back: 1589324 })
usable(dear, LJTEST) = Err(BelowMinimum { has: 2000000, needs: 2320935 })
  in words: A box holds 2000000 lovelace, under the 2320935 the ledger asks of it now
bootstrap_most(dear, LJTEST, 64) = 64
dear LJTEST, 64 boxes: deposit fee 727601, 2401794 back; box 0 holds 2000000 of a ledger minimum 2320935; 64 of 64 boxes below the minimum
fixed 1.5 ₳, dear, LJTEST 2 ₳: cap 51
usable(dear, LJTEST at 4.5 ₳) = Ok(Usable { box_minimum: 2320935, withdraw_fee: 410676, back: 4089324 })
bootstrap_most(dear, 4.5 ₳ pool, 64) = 64
dear 4.5 ₳ pool, 64 boxes: deposit fee 727601, 2401794 back (Seedelf least 2185170, over by 216624); box min 2320935 vs 4500000; 0 below
fixed 1.5 ₳, dear, 4.5 ₳ token pool: cap 51
```

- The test's dear token case builds a deposit in which all 64 boxes hold 2,000,000 against the ledger's minimum of (160 + output bytes) × 6,465 = 2,320,935. The node refuses such an output (`BabbageOutputTooSmallUTxO`).
- "51 of LJTEST" is what the old fixed-reserve builder would have counted. No wallet reaches it, since the pool takes no new box at that price.

**TS:** `extension/tests/zz-review-v-pr333-4-trace-1.test.ts`, with the real WebAssembly and the TS tests' LJTEST fixture (the same seed). It passed:

- Today: `privateBootstrapMost("preprod", TOKEN)` is 64.
- At `coins_per_utxo_size: "6465"`: `privateBootstrapMost` and `privateBootstrapBounds` for `TOKEN` both reject with `lj.unusable.warn.belowMinimum`.
- The classic pool at 6,465: `{ most: 96, back: "1800000" }`.

So the wallet never shows or funds 64 (or 51) LJTEST boxes at 6,465. The existing `lovejoin-release-rules.test.ts:207-221` shows the same refusal at 12,930.

## Exactly what's wrong

1. **The test's token half models a state that can't happen.** The doc at `lovejoin_pools_test.rs:1728` says "one deposit's most goes, in the classic pool and a token pool, … and at a dearer byte too". At the dearer byte, the token pool's deposit doesn't go: the ledger refuses it and the worker never offers it.
   - The guard itself still works: with the fixed reserve put back, the LJTEST line reads 51 and fails. The classic line fails too, at 68.
   - What's wrong is the fixture, not the test's teeth.
2. **Three places cite "51 of LJTEST" as if it were reachable:** the doc at `mod.rs:1741-1743`, the test comment at `:1793` ("68 classic boxes, 51 of LJTEST"), and #333's table ("96 / 64, was 68 / 51"). Each says a fixed 1.5 ₳ "held a Bootstrap to … 51 of LJTEST" at 6,465, but LJTEST takes no new box at that price.
   - "Impossible" in the finding is a little strong: the old builder does compute 51. The figure is unreachable, not miscomputed.
3. **The TS comment's pointer is wrong.** `extension/tests/lovejoin-flows.test.ts:504-505` says "core's test has a token pool's too: this fixture's token box is below the network's least at that price, so it takes no new box at all". Core's pool is the same pool (seed `5c6f327e…#2` in both `LJ_SEED` and `wasm/tests/fixtures/lovejoin-token-pool-preprod.json`). Core's dear token case therefore has the same defect the TS comment avoids.

## Minor differences from the finding

- The finding says the 4.5 ₳ chain at 64 "builds with 0.187 ₳ over". My copy of the test's `bootstraps` gives 0.217 ₳ over the sweep's Seedelf least: the sweep's output is 2,401,794 against a least of 2,185,170. The finding may have measured the chain another way. Either way it builds, so the conclusion is the same.
- The fix keeps the test's point. The 4.5 ₳ pool is `usable` at 6,465. It caps at 64 with the priced reserve and at 51 with a fixed 1.5 ₳, the same counts as the 2 ₳ pool, because the two box values have the same encoded size.

## Fix

- In the dear case at `:1813-1814`, use `let lj45 = Protocol { denom: 4_500_000, ..lj_pool() };`.
  - Optionally add `assert!(lovejoin::usable(&dear, &lj45, true).is_ok())`, so the fixture can't slip below the minimum unseen.
  - Optionally add `assert!(matches!(lovejoin::usable(&dear, &lj, true), Err(lovejoin::Unusable::BelowMinimum { .. })))`, to record why LJTEST itself isn't used.
- Fix the wording:
  - `mod.rs:1742` and test `:1793`: "68 classic boxes, and 51 of a token pool like LJTEST's with boxes that meet the minimum (LJTEST's own 2 ₳ box takes no new box at 6,465)", or drop the token figure.
  - `lovejoin-flows.test.ts:504-505`: core's token case is a 4.5 ₳ copy of the same pool.
- #333's description is merged history. Correct it only if the owner wants the record changed.

Confidence: high.
