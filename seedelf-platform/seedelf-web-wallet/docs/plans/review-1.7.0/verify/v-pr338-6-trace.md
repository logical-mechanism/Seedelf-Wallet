# v-pr338-6-trace: pr338#6, "The entry's fee note misses that Dijkstra makes the reference-script fee's stride and multiplier protocol parameters, which core hardcodes"

**Verdict: confirmed. Severity: nit.**

Every fact in the finding holds, on HEAD and in the upstream ledger. Two limits:

- **The scenario is narrower than "every script spend".** Only a cut stride or a raised multiplier underprices, and only for a transaction with more reference-script bytes than the stride. A multiplier change on its own never moves the fee of any Seedelf, Lovejoin or DEX-cancel transaction the wallet builds.
- **The fix misses a third constant of the same kind:** `MAX_REFERENCE_SCRIPT_BYTES`, the ledger's `maxRefScriptSizePerTx`.

Nothing changes for 1.7.0: mainnet and preprod are Conway, where the stride and multiplier are fixed by the ledger and core matches them. PR #338 is docs only (one file, 6 lines in and 6 out), as the user said. The Musashi branch (`web-wallet/leios-musashi`, `33949ac5`) is out of scope; I read it only with `git show`, as evidence of Musashi's parameters.

## What the entry says (HEAD `docs/post-release-roadmap.md:409`)

> **What Leios would change in the wallet:** … Dijkstra's fees on reference inputs are 0 on Musashi, and core's fee doesn't count them yet.

"Fees on reference inputs" means `refInputsCostPerDatumByte` and `refInputsCostPerMultiAssetPolicy`, both 0 on Musashi. The sentence can't be read as covering the stride or the multiplier: they are 25,600 and 1.2, not 0.

Nothing else on HEAD mentions them either. `git grep -i 'stride|refScriptCost|maxRefScriptSize'` over the docs, CLAUDE.md files and core finds only build.rs's own comments.

The run itself never looked at them:
- the branch README notes only the reference-input fees (`seedelf-leios/README.md:48`, `:151`);
- `params_check`'s printed watch list (`seedelf-leios/src/live.rs:352-367`) leaves out `refScriptCostStride`, `refScriptCostMultiplier` and `maxRefScriptSizePerTx`.

## The facts, checked

- **Musashi's parameters.** `seedelf-leios/musashi/protocol-parameters.json` is the node's own `query protocol-parameters`, saved by `params_check` (`live.rs:341-343`). It has:
  - `refScriptCostStride` 25600 and `refScriptCostMultiplier` 1.2;
  - `maxRefScriptSizePerTx` 204800;
  - `refInputsCostPerDatumByte` 0 and `refInputsCostPerMultiAssetPolicy` 0;
  - `protocolVersion` 12.0.

  `musashi/dijkstra-genesis.json` sets the stride, the multiplier and `maxRefScriptSizePerTx`. `musashi/conway-genesis.json` has only `minFeeRefScriptCostPerByte`.
- **Upstream cardano-ledger (master), read-only GETs.**
  - `eras/dijkstra/impl/src/Cardano/Ledger/Dijkstra/PParams.hs` defines `dppRefScriptCostStride :: !(THKD ('PPGroups 'NetworkGroup 'SecurityGroup) f (NonZero Word32))`, `dppRefScriptCostMultiplier :: !(THKD ('PPGroups 'NetworkGroup 'SecurityGroup) f PositiveInterval)` and `dppMaxRefScriptSizePerTx :: !(THKD ('PPGroups 'NetworkGroup 'SecurityGroup) f Word32)`. All three are governance-updatable.
  - `Dijkstra/Tx.hs` sets `getMinFeeTx = getConwayMinFeeTx`.
  - `Conway/Tx.hs`'s `getConwayMinFeeTx` calls `tierRefScriptFee (unboundRational $ pp ^. ppRefScriptCostMultiplierG) (fromIntegral @Word32 @Int . unNonZero $ pp ^. ppRefScriptCostStrideG) refScriptCostPerByte refScriptsSize`.
  - So under Dijkstra, the fee follows whatever values governance sets.
- **Core on HEAD.**
  - `seedelf-core/src/build.rs:61-62`: "How many bytes of reference script each of Conway's price tiers holds." `const REFERENCE_SCRIPT_TIER: u64 = 25_600;`.
  - `build.rs:88`: `.map(|k| tier * 6u128.pow(k) * 5u128.pow(tiers - k))`.
  - `build.rs:59`: `pub const MAX_REFERENCE_SCRIPT_BYTES: u64 = 204_800;`, also used by the wasm crate's `fits()` (`wasm/src/lib.rs:1127`).
  - `ProtocolParameters` (`seedelf-koios/src/koios.rs:894-918`) has no field that could carry a stride, a multiplier or a size limit; for reference scripts it has only `min_fee_ref_script_cost_per_byte`.
- **"Equal today" holds live.** The harness priced every mended transaction with core's own `reference_script_fee` (`seedelf-leios/src/dijkstra.rs:33`, `:134`), and the entry says they ran on Musashi (`:406`).
- **Conway, today's mainnet and preprod.** The stride and multiplier aren't parameters there. Mainnet's `epoch_params` fixture (`seedelf-core/tests/fixtures/epoch_params_mainnet.json`) carries only `min_fee_ref_script_cost_per_byte`. Core matches the ledger, and `build_test.rs:650` (`reference_scripts_are_priced_in_conways_tiers`) covers it.

## The scratch test

`seedelf-core/tests/zz_review_v-pr338-6-trace_1.rs` was run once with `cargo test --locked -p seedelf-core --test zz_review_v-pr338-6-trace_1 -- --nocapture`, then deleted. It models the ledger's `tierRefScriptFee` exactly, in reduced u128 fractions, with the stride and multiplier as inputs. The price is 15. Result: 5 passed, 2 failed.

| Test | Result | What it shows |
|---|---|---|
| `equal_at_musashis_values_today` | ok | Core equals the ledger at 25,600 and 1.2, from 0 to 204,800 bytes |
| `a_multiplier_alone_never_moves_the_wallets_own_fees` | ok | Multipliers 1.2, 1.5, 2 and 10 leave the fee unchanged at 629, 1,038, 1,148, 2,659, 3,790 and 25,599 bytes |
| `a_raised_stride_or_lowered_multiplier_only_overpays` | ok | A stride of 51,200 or a multiplier of 1.1: core ≥ ledger at 30,000, 60,000 and 204,800 bytes |
| `a_plausible_stride_cut_spares_the_wallets_own_fees` | ok | Strides of 4,096, 10,240 and 12,800 leave the wallet's own sizes flat |
| `a_cut_stride_prices_a_lovejoin_mix_short` | **FAILED** (as the finding predicts) | Stride 2,048, 3,790 bytes: core 56,850, ledger 62,076, **5,226 lovelace short** |
| `a_raised_multiplier_prices_past_one_stride_short` | **FAILED** (as the finding predicts) | Multiplier 1.5, 60,000 bytes: core 1,034,880, ledger 1,257,000, **222,120 short** |
| `the_size_limit_is_conways_constant_too` | ok | `MAX_REFERENCE_SCRIPT_BYTES` is 204,800 and refuses 204,801 whatever the parameters say |

A shortfall like that is refused with `FeeTooSmallUTxO`, since `settle` prices the fee exactly. Step 3 of the scenario is right whenever the change underprices.

## Where the scenario is narrower

- **Direction.** Only a cut stride or a raised multiplier underprices. A raised stride or a lowered multiplier just overpays slightly.
- **Size.** The wallet's own transactions carry little reference script:

  | Transaction | Reference-script bytes | Source |
  |---|---|---|
  | Seedelf wallet script / Seedelf mint | 629 / 519 | `constants.rs:61-62` |
  | A spend and a mint together | 629 + 519 = 1,148 | `build_test.rs:663` |
  | Two rows with the 519-byte script (the sum's test) | 1,038 | `utxos_test.rs:438` |
  | Mainnet Lovejoin mix | 629 + 3,161 = 3,790 | `lovejoin_mainnet_test.rs:269` |
  | DEX order script | 2,659 at most each | `seedelf-core/src/orders.json`, `referenceSize` |

  All of them are under one 25,600-byte stride, so:
  - a multiplier change alone never moves their fee;
  - a stride cut bites only once it goes below their size, about 1 to 4 KB, which is far below any plausible governance change;
  - a multiplier rise bites only past one stride. Among the wallet's transactions, that means an account spend of UTxOs that carry reference scripts: `build.rs:567` and `:1015` count the spent inputs' scripts.
- **Timing.** Under Dijkstra the wallet's script transactions are refused anyway until core changes (redeemers as a list, `:406`). So this scenario can't arise before the change that this entry is the to-do list for. That is why the omission is a gap in that list, a nit, and not a defect in 1.7.0.

## Fix

The finding's fix is right, but should name the size limit too. It has the same status: a Dijkstra parameter, set to Conway's value on Musashi, and a constant in core (`build.rs:59`).

A short wording for the end of `:409`:

> Dijkstra's fees on reference inputs are 0 on Musashi, and core's fee doesn't count them yet. The reference-script fee's stride and multiplier, and a transaction's limit on reference-script bytes, are Dijkstra parameters too: at Conway's values on Musashi, constants in core.

Optional, outside this review: the branch README's "Fees" watch line (`seedelf-leios/README.md:151`) could name the same three, `refScriptCostStride`, `refScriptCostMultiplier` and `maxRefScriptSizePerTx`.

No `cli_notes`: core is shared with the web wallet.
