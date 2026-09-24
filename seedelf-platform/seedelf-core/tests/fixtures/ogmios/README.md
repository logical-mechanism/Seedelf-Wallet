# Recorded Ogmios answers

Real answers from preprod Ogmios, through Koios (`POST /ogmios`, `evaluateTransaction`), at epoch 315 (2026-09-24).

Each draft is a mint built by `build::mint_from` for the synthetic contract UTxOs that the 12-word test-vector phrase owns ([owned-utxos.json](../../../../seedelf-web-wallet/extension/tests/fixtures/owned-utxos.json)). Those UTxOs aren't on chain, so they were passed as `additionalUtxo`. The scripts, reference inputs and giveme.my's collateral UTxO are real.

- `mint_two_inputs.json`: a draft spending both pure-ADA UTxOs. Both scripts pass: two spends, then the mint, in Ogmios's order (by purpose, then index).
- `script_failure.json`: the same kind of draft, with proofs made by the wrong key. The wallet contract refuses spend 0 (code 3010, then 3012).
- `unknown_inputs.json`: the two-input draft without `additionalUtxo`. Ogmios can't resolve the inputs, so their redeemers are extraneous (3110).

The extension's `tests/fixtures/record-mint.mjs` records a whole mint the same way, into `mint-preprod.json`.
