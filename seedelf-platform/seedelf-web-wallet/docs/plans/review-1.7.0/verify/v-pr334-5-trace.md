# v-pr334-5-trace: verifying pr334#5

**Verdict: confirmed, nit.** The sentence is on HEAD as quoted. It names neither Dijkstra parameter and doesn't say "new", while the run's own write-up does both. Core does price Conway's reference-script fee, and it knows nothing of Dijkstra's two. One correction: the sentence comes from **#338**, not #334.

## Where it came from

- HEAD `6bca8bec`, `docs/post-release-roadmap.md:409`: "Dijkstra's fees on reference inputs are 0 on Musashi, and core's fee doesn't count them yet."
- `git blame -L 405,409`: every line of the finished entry is `62be5bc4` ("docs(web-wallet): 1.7.0's item 8, the Leios run on Musashi, done"), which is PR #338. #334's diff (`git diff ae610284^1 ae610284`) adds only the item's plan text (the list line, plus *Headless only*, *Mainnet and preprod untouched*, *What's known* and *Likely the owner's*). It says nothing about fees.

## The checks

- **The two parameters aren't named.** The run's write-up (`seedelf-leios/README.md` on the unmerged `web-wallet/leios-musashi`, read with `git show` only) says at line 48: "Dijkstra's new fees on reference inputs (`refInputsCostPerDatumByte`, `refInputsCostPerMultiAssetPolicy`) are 0 there." At line 151 it adds: "if Dijkstra's fees on reference inputs ever leave 0, every mix pays for the pool datum it reads, and core's fee doesn't count that yet. Watch `refInputsCostPerDatumByte` and `refInputsCostPerMultiAssetPolicy`." The roadmap's summary dropped both "new" and the names.
- **The parameters are as the finding says.** `seedelf-leios/musashi/protocol-parameters.json` on that branch has `refInputsCostPerDatumByte` 0, `refInputsCostPerMultiAssetPolicy` 0 and `minFeeRefScriptCostPerByte` 15. "Fees on reference inputs are 0 on Musashi" is true only of the two new parameters, not of the reference-script fee.
- **Core prices Conway's reference-script fee:**
  - `seedelf-core/src/build.rs:70` has `reference_script_fee`. Its comment at 64-65 reads "Conway's fee for `bytes` of reference scripts, which the ledger adds for every script on a spent or reference input". So core's own words tie its existing fee to reference inputs, which makes the confusion easier.
  - It's wired into every script spend at `build.rs:2003-2023` ("The Seedelf scripts, read from reference inputs, and any reference script on a spent input, which Conway charges for too."). Also the account mint (`build.rs:3686`), Lovejoin (`lovejoin/mod.rs:1080`, `:1543`), the launch (`lovejoin/launch.rs:554`), orders (`orders.rs:1013`) and the WebAssembly (`wasm/src/lib.rs:1139`).
  - The price is required from Koios: `seedelf-koios/src/koios.rs:1042-1043` fails with `Missing {per_byte}`.
  - Tests pin it: `seedelf-core/tests/build_test.rs:216-232` holds a Seedelf spend's fee to the ledger's minimum, reference-script fee included. `:651-690` holds the tiers to the ledger's `tierRefScriptFee`.
- **"Core's fee doesn't count them yet" is accurate.** I grepped `refInputs|ref_inputs_cost|CostPerDatumByte|per_datum_byte|MultiAssetPolicy|multi_asset_policy` over `seedelf-core/src`, `seedelf-koios/src`, `seedelf-crypto/src`, `wasm/src` and `extension/src`. It found nothing (exit 1).

## Scratch test

`extension/tests/zz-review-v-pr334-5-trace-1.test.ts`, run alone and then deleted. It has two checks:

1. The sentence is on HEAD, under "**What Leios would change in the wallet:**". This **passed**.
2. The sentence names both parameters and says "new". This **failed on HEAD**: `expected { named: false, markedNew: false } to deeply equal { named: true, markedNew: true }`.

## How likely the misreading is

The scenario is narrower than the finding states. Two cues put the sentence in Dijkstra, not today's mainnet: the "Dijkstra's" qualifier and the heading "What Leios would change in the wallet". The realistic confusion is about *which* fee is meant. A reader who maps "fees on reference inputs" to Conway's reference-script fee reads "core's fee doesn't count them" as a claim that core misses a fee it already counts. Core's own comment at `build.rs:64-65` invites that mapping. The cost is a wasted look, with nothing for users, so it stays a nit.

## Fix

The finding's fix is right. It restores the write-up's own words (README:48):

> Dijkstra's new fees on reference inputs (`refInputsCostPerDatumByte`, `refInputsCostPerMultiAssetPolicy`) are 0 on Musashi, and core's fee doesn't count them yet.

Two optional additions:

- README:151's consequence, "if they leave 0, every mix pays for the pool datum it reads", which is what makes the note actionable.
- An aside, outside this finding and this release: Musashi's parameters also carry `refScriptCostStride` 25600 and `refScriptCostMultiplier` 1.2. Conway fixes both, and core hardcodes them (`build.rs:62`, `:83-90`). They're equal on Musashi, so nothing is mispriced there. Neither the roadmap nor the run's write-up lists them as something core would need to read under Dijkstra.

Credit the fix to #338's text. It's a docs-only edit, with no code or tests affected.
