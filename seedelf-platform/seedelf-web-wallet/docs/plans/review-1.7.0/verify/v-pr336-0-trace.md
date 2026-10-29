# v-pr336-0-trace: `pr336#0`, traced on HEAD (`6bca8bec`)

**Verdict: confirmed. Severity: low.** The mechanism is exactly as filed: two scratch tests reproduce it on HEAD.

One line of the scenario is wrong, though. "No mix can ever take those boxes" doesn't hold: the pinned Mix branch never checks an input's value. A box over the real box value can be mixed by anyone who builds the mix by hand, and that person keeps the excess. The harm is different from what the finding says, and no smaller.

## What the code does on HEAD

1. **Nothing offline pins the datum's values.**
   - `templates.rs:120-127`: `derive` uses the seed alone. The policy comes from the seed, `mix_logic` from (policy, NFT name), `mix_box` from `mix_logic`'s hash, and `fee_contract` from (policy, NFT name).
   - `pool.rs:409-416` (`derived_from`) checks only the policy and the datum's three script hashes. The datum's box ADA, token quantity and `max_fee` are whatever the row says.

2. **`confirmed()` checks the launch with the server's row.**
   - It passes the server's reference row and script rows to `launched()` (`lovejoin-pools.ts:573-577`).
   - Those rows came out of `utxoOf` (`private-index.ts:388-412`), which takes the address, value, datum and assets from the server's row.
   - `launches()` asks Koios's `tx_info` for `inputs` and `certificates` only (`koios.ts:934`, `:938`, select at `:942`). It asks for no outputs.
   - So Koios confirms that T exists, spent the seed and registered L. It never confirms the row the device keeps.

3. **It keeps the server's entries.** `launched()` builds each pool with Koios's block and place (`:542`). `confirmed()` then throws that away: it filters `found`, the server's own entries, by `id:outpoint` (`:582-583`). So the server's datum, seed, script rows and launch `{block, index}` are what's kept.

4. **Nothing corrects them later.**
   - `keep()` only adds outpoints it doesn't have yet (`:377-381`).
   - The holder look skips any outpoint already known (`:498`).
   - Nothing in the worker reads a kept pool's reference UTxO again (I grepped for `utxoInfo`).

5. **The kept datum drives what the wallet builds.**
   - The hub's value: `verifiedPool` sets `lovelace: BigInt(view.boxLovelace)` (`lovejoin.ts:2748`).
   - The Bootstrap's bounds and its builds use `read.ref` (`:2954`).
   - The deposit builder `deposit_across` takes each box's value from `protocol.box_value()`, which is the datum's (`mod.rs:687`).
   - `deposit_reference()` puts in the reference **outpoint** alone (`mod.rs:308-325`).
   - A deposit stages key inputs, reference inputs, outputs and a fee. It runs no script.

6. **The precondition is the normal case on mainnet.** The bundled head start, `src/lovejoin-pools.json`, has 0 mainnet pools. So every mainnet token pool reaches a data-layer device through `confirmed()`, with the server's row.

## Scratch tests (both run on HEAD, then deleted)

**`extension/tests/zz-review-v-pr336-0-trace-1.test.ts`.** Each case asserts what Koios's chain data says, so it fails on HEAD if the finding is real.

| Case | Result on HEAD |
|---|---|
| Baseline: the Koios-only holder look keeps the fixture's 2 ₳ at `{BLOCK, 3}` | passed |
| The list's datum `1a001e8480` is changed to `1a002dc6c0`; Koios answers the real launch | **failed**. Koios was asked one `tx_info` (`select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`). Kept: `box=3000000`, datum `d8799f1a002dc6c0…` |
| The list says the launch is at block 1, place 0; Koios says `BLOCK`, place 3 | **failed**. Kept at `{"block":1,"index":0}` |
| The same misplaced launch, then an earlier launch of the same values (`BLOCK − 10`) is kept, as a Koios look would keep it | **failed**. `known()` gave only `c5852bb7 @1`. With Koios's place it gives `[aa…, c5852bb7 (copy)]`, as STATE-2's own test does |

**`seedelf-core/tests/zz_review_v_pr336_0_trace_1.rs`** (`cargo test --locked -p seedelf-core --test zz_review_v_pr336_0_trace_1`): passed.
- The real preprod reference output, with its datum's box ADA set to 3 ₳, still verifies from the real seed. `denom` is 3,000,000, with the same id, `mix_box` and `mix_logic`.
- `deposit_from` into it gives:
  - 3 boxes of 3 ₳ at the real `mix_box`;
  - one reference input, the real outpoint;
  - 0 redeemers and 0 scripts;
  - a fee of 195,025.
- `eval::evaluate` takes the deposit with the reference resolved as the chain has it, with its 2 ₳ datum. That evaluator is the one the existing deposit test uses to stand in for the ledger.

## What's wrong in the scenario

**The finding's line:** "No mix can ever take those boxes, since the Mix branch forces outputs at exactly the datum's value. They come back only by hand."

**What the pinned contract does** (Lovejoin `8131b1d`):
- `mix_logic.ak:276` checks `expect output.value == box_value` on the **first N outputs only**.
- The inputs are gathered by their datum alone (`collect_well_formed_mix_inputs`, `:319-327`), and no input's value is checked.
- `mix_box.ak:62` checks only that the withdrawal is there.
- The Owner branch (`validate_owner`, `:111`) checks no value at all.

**So for a box of 3 ₳ in a 2 ₳ pool:**
- **Honest Seedelf wallets never draw it.** `PoolBox::from_row` and `is_row` require exactly the pool's box value (`mod.rs:397-404`, `value.rs:66-82`).
- **Anyone's hand-built mix can take it.** The mix outputs a 2 ₳ box, still owned by the same key, and its builder keeps the 1 ₳ excess. Core says so itself at `mod.rs:394-396`: "a box holding more than the box value could be mixed by anyone, who'd take the excess."
- **Whoever runs the lying server sets the size of that excess,** through the box ADA or the token quantity it lists. It can then take the excess itself.
- **After such a mix, the remaining box drops out of view on the lying device.** That device's kept datum still says 3 ₳, and nothing ever replaces it. A device with the true datum still sees the box.
- **The owner can still bring a box back by hand** before anyone mixes it, paying both fees, with its deposit tied to its way back. That part of the finding stands.
- **A lie in the other direction** (a box value under the chain's) does leave the boxes unmixable, and they come back only by hand, as the finding says.

## The launch-position half

- It is confirmed.
- `docs/architecture.md:732` already says "where its launch sits … [is] the server's word". So it was documented, and older than #336.
- Its harm is a split of who mixes with whom, not money. The device keeps putting new boxes into a later pool B, even after a Koios look finds the earliest pool A. A can even become a copy that takes no new box.
- What overstates the check is newer:
  - `lovejoin-pools.ts:557-558` says Koios finds a pool "as the holder's look would", and `privacy.md:200` says "as its own look would";
  - #336's description says "so devices can't disagree".
- Side note: the same `architecture.md:732` line still says "finished" is the server's word. That has been stale since #336.

## Why it stays low

- **It needs a compromised data layer.** As context only, not a finding of mine: as far as I traced, a private Send also takes a recipient's register from the data layer's contract rows, and the ledger doesn't pin it either.
  - `transfer.ts:6-10` and `:174`: the recipient's row comes from the contract view, which is the data layer's on mainnet.
  - core's `Payment` (`build.rs:3092-3097`) carries the register alone, with no reference input.
- So trusting the server's datums is general, and #336 claimed more for its check than it delivers.

## Fix advice

- **The finding's fix works.** `koiosAlone().utxoInfo(refs)` exists (`koios.ts:801`, 60 outpoints a request). The policy's 28 October entry would then have to name that request.
- **A cheaper alternative, with no extra request.** Widen the same `launches()` `tx_info` instead:
  - select `outputs`, with `_scripts: true` and `_assets: true`;
  - take the reference output at the listed index from Koios, or drop a pool whose server row differs (address, value, assets, datum bytes);
  - check the two script outputs' hashes the same way.
- That keeps the policy entry's wording accurate ("the transaction that started it"), and it's still the same request for every wallet.
- **Either way, keep `launched()`'s pools,** with Koios's row and its `{block, index}`, rather than the server's entries. For example, `return [...found.filter((p) => known.has(refOf(p.ref.reference))), ...standard]`.
- **The test the finding proposes would catch both halves.** My first scratch test's cases 2 to 4 are that test.
