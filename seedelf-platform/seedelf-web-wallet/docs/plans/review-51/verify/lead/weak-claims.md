# The critic's two unchecked claims, checked (the lead, 2026-11-18)

The completeness critic listed nine weak claims ([critic.md](../../lanes/critic.md)). Seven were taken up by the gap round or by a verifier. Two weren't, and either would have been critical if it was wrong. Both were checked offline, on the fix branch at `02f73991`.

## 1. Conway refuses duplicate keys (W2's claim, from memory)

W2 wrote that Conway refuses a repeated body key and duplicate map keys from protocol 9, so the sign window's figures hold, though Pallas reads a repeated body key last-wins and `cip30::of_value` sums duplicate multiasset entries. W2 couldn't fetch the ledger's decoder to check. If the claim were wrong, a site's `{A: 100, A: 1}` would show as 101 in the window and land as something else.

**The check:** four Conway transactions decoded by the ledger's own decoder, through `cardano-cli 11.0.0.0` (git rev `97036a66`), `debug transaction view`. The files are in this folder.

| Transaction | The ledger's decoder |
|---|---|
| `ok.json`: one input, one output of 2 ₳ and 100 of one token | decodes |
| `dup_asset.json`: the output's token map names one asset twice (100, then 1) | refused: "Final number of elements: 1 does not match the total count that was decoded: 2" |
| `dup_policy.json`: the output's value names one policy twice | refused, the same words |
| `dup_body_key.json`: the body names the fee twice | refused: "Duplicate key: 2 while decoding type TxBodyRaw" |

**Verdict:** W2's claim holds. None of these shapes reaches the chain, so the window's sum can't misstate a transaction that lands. A signature over such a body is over its exact bytes, so re-encoding it (as a canonical body without the duplicate) changes its hash and the signature no longer matches.

## 2. Data just under the 128-level guard, inside the module's own stack

The critic noted that `wasm/tests/deep.test.mjs` runs 100,000 levels, which the guard refuses at once. No WebAssembly test ran data the guard *accepts* through the recursive consumers, Pallas's decoder, `decode_tx`'s `plutus_tree` and serde_json, inside the module's 1 MiB stack. 1.6.0's 314-wasm#0 trap showed that stack is the limit that bites, and a trap locks the wallet.

**The check:** [deep127-probe.mjs](deep127-probe.mjs) builds a site's transaction holding one datum nested n levels, in the witness set and as an output's inline datum (tag 24's bytes), for n = 1 up to the first n the guard refuses. It sends each through `decodeTx` (the sign window's view) and `inspectDappTx` (the connector's reading), and after every call checks that the module still decodes a real transaction (the Minswap swap fixture). Six datum shapes, plus a native script in the witness set.

| Shape | Deepest the guard accepts (witness set / inline) | Both calls there |
|---|---|---|
| definite list `81…00` | 125 / 120 | read, module whole |
| indefinite list `9f…ff` | 125 / 120 | read, module whole |
| map `a1 00 …` | 125 / 120 | read, module whole |
| constructor 0, tag 121 | 62 / 60 | read, module whole |
| constructor 0, indefinite fields | 62 / 60 | read, module whole |
| constructor 0, tag 102's general form | 41 / 40 | read, module whole |
| native script `all [all [… sig]]` | 62 / — | read, module whole |

**Verdict:** no trap at any depth the guard accepts, for every shape tried, on either path a site's transaction takes. Node's stack limit is V8's default, as in Chrome's service worker. Other readers of a stranger's rows (the balance, Lovejoin's pool, a DEX order) are covered above the guard by `deep.test.mjs` and weren't re-run under it here.
