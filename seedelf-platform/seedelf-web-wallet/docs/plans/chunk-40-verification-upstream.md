# Chunk 40 · Verification, once upstream is fixed

Branch `verification`, from `main`, pushed to origin, with no PR on purpose (the owner, 2026-11-02). It isn't a `web-wallet/…` branch because the work lives in [seedelf-verification/](../../../../seedelf-verification/README.md), not in the wallet.

**Status: ⛔ blocked on upstream.** Three gaps in IOG's tools stand between us and the wallet's core property. The first two are reproduced in [Upstream/](../../../../seedelf-verification/Upstream/), with controls; the third was found in the code. Nothing more gets built until they're fixed. In the owner's words: "I would want these upstream bugs fixed then work everything out before we continue on." This file says how to tell when they are, and what to do then.

**What the owner asked (2026-11-02):** "a verification folder and branch that we can work on further because it would be interesting to do this for lovejoin as well." On the wallet's property: "proving the wallet part of things is verified is huge."

## What's done ✅

- **29 theorems** about variant 1's deployed bytes: wallet `94bca9c0…`, policy `84967d91…`, always_false `6777ba4d…`. They're proved with IOG's Blaster, which is Lean 4 and Z3 5.3.1 over PlutusCoreBlaster's model of UPLC.
  - The [README](../../../../seedelf-verification/README.md)'s table lists them: always_false always fails; the wallet is spend-only and never locks a UTxO whose datum isn't a Register; the policy refuses other amounts, other policies' lines, and burns off a first input at #256 or -1.
  - Its *What a ✅ is worth* says what a proof means: Z3's word, IOG's model, opaque crypto builtins, scenarios, bounded runs.
- **The blockers, isolated.** `./check.sh upstream` runs a minimal case of each, beside controls that pass. `./check.sh upstream-main` runs the `Except` case against Lean-blaster main.
- **Four upstream drafts** in [Upstream/drafts/](../../../../seedelf-verification/Upstream/drafts/). None is filed: the owner files them.
- **One finding** on the deployed policy ([below](#found-along-the-way)).
- **Commits:** `83ae8c2c` (the proofs, `check.sh`, `extract.sh`, the root CLAUDE.md line), `70e798a9` (the reproductions and the drafts), `47f8e21f` (the #68 comment's pointer).

## What blocks it

1. ⛔ **A datatype's parameter names.** This is a Lean-blaster regression, filed as [#454](https://github.com/input-output-hk/Lean-blaster/issues/454) on 2026-11-02; our fix is on its way as a PR ([chunk 41](chunk-41-blaster-fixes.md)).
   - Our manifest pins Lean-blaster's `beta-lambda-cache-optimization` branch at `46c8479`, through CardanoLedgerApiBlaster `9938562`.
   - On that branch, `genIndParams` in `Blaster/Smt/Translate/Quantifier.lean` telescopes `(← hashcons indVal.type)`. So a datatype takes the parameter names of an earlier alpha-equivalent type.
   - Any goal with both `Except` and `Prod` fails, in either order ("unknown sort '@ε'"). PlutusCoreBlaster's goals translate `Data × Data` before a BLS12-381 builtin's `Except String _`.
   - Lean-blaster main at `a16614e` telescopes `indVal.type` and passes the same file.
   - Draft: [lean-blaster-datatype-param-names.md](../../../../seedelf-verification/Upstream/drafts/lean-blaster-datatype-param-names.md).
   - **It's already out there:** PlutusCoreBlaster `main` pins Blaster `bc03bb4`, which has the line, and its [#68](https://github.com/input-output-hk/PlutusCoreBlaster/pull/68) moves the pin to `8816f72`, which has it too. Lean-blaster [#155](https://github.com/input-output-hk/Lean-blaster/pull/155) (beta → `main`, under review on 2026-11-02) would bring it to `main`.
   - The line came in with `bafdd4f` (2025-12-04, the hash-consing squash). Draft [#335](https://github.com/input-output-hk/Lean-blaster/pull/335) would fix it as a side effect, but has no test for it and was idle from 2026-10-18.
2. ⛔ **`BitVec` through `Char`.**
   - A `ByteString` is a `String`, which is a `List Char`, and a `Char` is a `UInt32`, which is a `BitVec 32`.
   - `byteStringToInteger` folds `Char.toNat`, and `sliceByteString` is `take`/`drop` on the chars. Over a symbolic bytestring, either fails with "Inductive datatype with instance parameters not supported: `BitVec`".
   - The upstream issues are Lean-blaster [#153](https://github.com/input-output-hk/Lean-blaster/issues/153), [#69](https://github.com/input-output-hk/Lean-blaster/issues/69) and [#67](https://github.com/input-output-hk/Lean-blaster/issues/67). On 2026-07-29 a maintainer said BitVec/Fin support would come "very soon".
   - The stopgap's precedent is PlutusCoreBlaster [#27](https://github.com/input-output-hk/PlutusCoreBlaster/pull/27), an `opaque` alias for `serialiseData`. It was still open on 2026-11-02.
   - Drafts: [the #153 comment](../../../../seedelf-verification/Upstream/drafts/lean-blaster-153-comment.md), [the PlutusCoreBlaster issue](../../../../seedelf-verification/Upstream/drafts/plutuscoreblaster-bytestring-builtins.md), and [the #68 comment](../../../../seedelf-verification/Upstream/drafts/plutuscoreblaster-68-comment.md). The #68 comment needs the number of bug 1's issue once that's filed.
   - The "very soon" work looks like branch `feat/indexed-types` (RSoulatIOHK, last touched 2026-06-21, never a PR), which leaves out `Char` and `toNat`, the two things `byteStringToInteger` needs.
3. ⛔ **`Fin` in a BLS12-381 coordinate.** `Fq1.t : Fin fieldPrime` (`Cryptograph/BLS12_381/Basic.lean`), and `Fin n` is an indexed type: the same throw, waiting behind 1 and 2 for anything holding a symbolic G1 point. Confirmed by a run on 2026-11-02: [Upstream/Fq1Fin](../../../../seedelf-verification/Upstream/Fq1Fin.lean)'s point cases fail with "Inductive datatype with instance parameters not supported: `Fin", its control passes. PlutusCoreBlaster draft [#29](https://github.com/input-output-hk/PlutusCoreBlaster/pull/29) (BLS axiomatization, idle since 2026-09-21) changes it to `Nat` and adds BLS12-381 axioms and an ownership-verification example: read it before WalletRegister.

What they block:

| Property | Needs |
|---|---|
| **A Register UTxO moves iff the Schnorr check holds and `vkh` signed** ([WalletRegister](../../../../seedelf-verification/Seedelf/WalletRegister.lean), left out of `check.sh`'s list): the wallet's core property | 1, 2 and 3 |
| Burns of 5eed0e1f tokens succeed (`burn_at_0`, `burn_at_255` in `PolicyBurn`). A mint passes for exactly the name `generate` gives (`mint_at_0_iff`, `mint_at_255_iff` in `PolicyMint`), then for any input | 2 |

Until then, the wallet's Schnorr path rests on the Aiken tests, `seedelf-crypto`'s proptests and seedelf-core's recorded-transaction evaluations.

## The baseline (2026-11-02, Z3 5.3.1)

The owner's runs gave these results. Compare against them after a bump.

- **`./check.sh`:**
  - `ok`: Scripts, Scenario, Steps, AlwaysFalse, WalletPurpose, WalletNoLock, PolicyAmount and PolicyForeign.
  - `FAILED`: PolicyBurn, where `burn_at_0` and `burn_at_255` fail on `BitVec` and its two other theorems are ✅. PolicyMint, where both theorems fail on `BitVec`.
  - That's expected: those four are the parked success theorems.
- **`./check.sh upstream`:**
  - `FAILED Upstream.ExceptParams`, with five ❌ and every control ✅. The five: `eps_alpha_after_alpha_beta` and `except_after_prod` (`unknown sort '@ε'`), `prod_after_except` (`'@β'`), and both BetaAlpha checks after AlphaBeta (`unknown constant @isInt (@PUnit)`).
  - `FAILED Upstream.ByteStrings`, with four ❌ on `BitVec`: the `byteStringToInteger` case, `slice_known_prefix`, the `≠ "abc"` slice and `slice_length`. Its controls are ✅: `append_right_empty`, `cons_front` and both expected Falsifieds.
  - `ok`: SlicePrograms and the five Slice modules, at 271–290 MB each.
- **`./check.sh upstream-main`:** `ok BlasterMain.ExceptParams`, every case ✅. Its first build, which compiles Blaster, took 107 s and 1,042 MB.

## How to tell each is fixed

On 2026-11-02 every pin was its upstream's head: Lean-blaster beta `46c8479` and main `a16614e`, PlutusCoreBlaster main `1c23de8`, CardanoLedgerApiBlaster main `9938562`.

CardanoLedgerApiBlaster requires Blaster and PlutusCore by branch (`beta-lambda-cache-optimization` and `main`). So only our [lake-manifest.json](../../../../seedelf-verification/lake-manifest.json) pins those two, and a fix on either branch reaches us through `lake update` alone.

Any session can run these reads. None of them builds anything:

```bash
# any machine, read-only
gh api repos/input-output-hk/Lean-blaster/branches/beta-lambda-cache-optimization --jq .commit.sha
gh api 'repos/input-output-hk/Lean-blaster/commits?sha=beta-lambda-cache-optimization&path=Blaster/Smt/Translate/Quantifier.lean&per_page=5' --jq '.[] | .sha[:7] + " " + (.commit.message | split("\n")[0])'
gh api 'repos/input-output-hk/CardanoLedgerApiBlaster/commits?per_page=3' --jq '.[] | .sha[:7] + " " + (.commit.message | split("\n")[0])'
gh api repos/input-output-hk/CardanoLedgerApiBlaster/contents/lakefile.lean --jq .content | base64 -d | grep require
gh issue view 153 -R input-output-hk/Lean-blaster --comments
gh pr view 68 -R input-output-hk/PlutusCoreBlaster
gh pr view 27 -R input-output-hk/PlutusCoreBlaster
```

- **Bug 1 is fixed when** `genIndParams` on our pinned branch stops telescoping `(← hashcons indVal.type)`. It can take main's form or take the names from the recursor rule. CardanoLedgerApiBlaster moving to a Blaster without the bug counts too.
  - Then `./check.sh upstream` says `ok Upstream.ExceptParams`: the five ❌ turn ✅, as they already are on main.
  - If the beta branch merges into Lean-blaster main and CardanoLedgerApiBlaster follows it, the check is the same.
- **Bug 3 is fixed when** `Fq1.t` is no longer a `Fin` in PlutusCoreBlaster (#29 or similar), or Lean-blaster translates `Fin`. There's no repro yet: add one to `Upstream/` beside the others (a symbolic `Fq1`, or `bls12_381_G1_uncompress` of a symbolic bytestring, once bug 1 is out of the way).
- **Bug 2, fixed by `BitVec` support in Lean-blaster (#153):** `ok Upstream.ByteStrings`. Its four ❌ turn ✅, and the two `#blaster` cases show as Expected Falsified. This unblocks everything in the table above.
- **Bug 2, fixed by `opaque` aliases in PlutusCoreBlaster (the stopgap):** the `BitVec` errors go away, but less gets unblocked, and the reproduction may not show it.
  - **Only properties that use the function the same way on both sides can be proved,** because the function is uninterpreted.
    - WalletRegister qualifies once `scalarOf` ([Wallet.lean](../../../../seedelf-verification/Seedelf/Wallet.lean)) calls the same alias the builtin runs.
    - Mint names qualify if `nameWith` and `seedelfName` call the slice alias.
  - **Burns succeeding, and names over any input, need slicing's meaning,** for example "the first 4 bytes of `5eed0e1f ‖ rest`". Only `BitVec` support gives that, or a slice defined on SMT `str.substr` (point 2 of the PlutusCoreBlaster draft).
    - Under an alias, `slice_known_prefix` and `slice_length` come back Falsified instead of failing on `BitVec`. That's expected, not a regression.
  - **`ByteStrings.lean` calls `PlutusCore.Bitwise.byteStringToInteger` and `sliceByteString` directly.** If the alias sits only on the builtin's path, the reproduction stays as it is, and WalletRegister is the test.

## Resuming

The owner runs every build and pastes the output back ([Practicalities](#practicalities-and-rules)). The steps, in order:

1. ⬜ **Read upstream** with the commands above, and compare with this file's baseline.
2. ⬜ **Bump the pins.**
   - The owner runs `lake update` in `seedelf-verification/`. It moves Blaster and PlutusCore to their branches' heads in `lake-manifest.json`.
   - If CardanoLedgerApiBlaster has moved too, put its new commit in [lakefile.lean](../../../../seedelf-verification/lakefile.lean) first.
   - Some fixes land where CardanoLedgerApiBlaster doesn't pull from: a fix branch, or main while it stays on beta. Pull one in with a `require` of our own in `lakefile.lean`, at that commit. Lake prefers the root package's own requirement to an inherited one.
   - Record the new revisions here and in the README.
3. ⬜ **Match the toolchain and Z3.**
   - `lean-toolchain` must equal CardanoLedgerApiBlaster's at its new commit (4.24.0 today).
   - Z3 must be at least the version Lean-blaster's README gives under *Prerequisites* (5.3.1 today). Check with `z3 --version`.
   - The owner installs any newer Z3. Theirs is in `~/tools`, linked from `~/.local/bin/z3`.
4. ⬜ **Re-run, cheapest first:**
   - `./extract.sh`: three `ok`s, so the hex still hashes to the on-chain scripts.
   - `./check.sh upstream`.
   - `./check.sh upstream-main`: it's pinned to `a16614e`, so it shouldn't change.
   - `./check.sh`: all 29 theorems must still be ✅ before anything is un-parked. If a bump breaks them, that's a regression to report, from a minimal case in `Upstream/`, as these were.
5. **Un-park, one at a time.** Each gets its own `./check.sh <module>` run under the cap.
   1. ⛔ **WalletRegister** (needs bugs 1, 2 and 3).
      - **Measure first.** Put a valid spend's concrete run in `Steps.lean`, with a real proof from `schnorr.ak`'s or seedelf-crypto's test vectors. Set the step limit above it (2500 now). That run is also the passing run rule 3 pairs the property with.
      - **It may run out of memory.** It has six symbolic bytestrings and runs into the crypto builtins, which the README's rule 4 warns against. If it's `KILLED`, split it: one direction per module, or the signer fixed to `vkh`.
      - **Once it proves,** add it to `check.sh`'s default list and update the README's tables.
   2. ⛔ **The policy's success theorems** (needs bug 2).
      - `burn_at_0`, `burn_at_255`, `mint_at_0_iff` and `mint_at_255_iff` should turn ✅ as they stand.
      - Then make the input id and the tag symbolic, so the mint's naming holds for any input. That's where [the open question](#the-open-question) comes back.
   3. ⬜ **A symbolic first-input index.** It once hit `BitVec`, but that came from the slicing, not from `consByteString`'s byte ([refuted](#refuted-dont-repeat-these)). So retry `PolicyBurn` with the index symbolic: burns should succeed for every index from 0 to 255 and fail for every index from 256.
   4. ⬜ **Lovejoin**, in a `Lovejoin/` beside `Seedelf/`, with its own `Scripts.lean` and an `extract.sh` step that checks its hashes.
      - **Its bytes are in seedelf-core.** The token-pool templates are pinned in [templates.rs](../../../seedelf-core/src/lovejoin/templates.rs), before their parameters (Lovejoin `8131b1d`, Aiken v1.1.24). The classic pool's scripts are bundled whole in [references.rs](../../../seedelf-core/src/references.rs): `LOVEJOIN_*_MIX_BOX` and `LOVEJOIN_*_MIX_LOGIC`, which `Protocol::of` reads.
      - **Before writing its properties,** check which builtins its scripts reach over the inputs a property would leave symbolic. The BLS12-381 builtins and bytestring slicing meet the same two bugs.
6. **As each one lands,** update the README's *What's proved* and *Not proved* tables with it. When the chunk is done, this file moves to the archive, as the [plans README](README.md) says.

## Meanwhile

- ❓ **A Rust proptest of the Schnorr path, through the deployed bytes.** It would run seedelf-crypto's proofs through the wallet script with seedelf-core's `uplc` evaluator ([eval.rs](../../../seedelf-core/src/eval.rs)): random keys and registers, where valid proofs pass and tampered ones fail.
  - It needs nothing from upstream, and it samples what WalletRegister would prove.
  - Offered on 2026-11-02 and not started: the owner's call.
- **The owner files the drafts, publicly; Claude doesn't.** The order:
  1. The Lean-blaster issue goes first.
  2. Its number then goes into the #68 comment and into the PlutusCoreBlaster issue's "filed separately".
  3. Then the #153 comment and the PlutusCoreBlaster issue.

## The open question

**Why did the policy take 8 GB with wholly symbolic token names?** On 2026-11-02, with wholly symbolic names, each of the policy's modules was killed at the 8 GB cap in about 36 s.

- **A minimal symbolic slice doesn't do it.** `Upstream/Slice*` takes 271–290 MB at 1, 4, 16 and 32 bytes, the same as with no slice.
- **A known prefix with a symbolic rest hits `BitVec` first,** before memory matters. So the cause isn't isolated.
- **Once `BitVec` passes, rebuild toward the policy.** Grow the Slice programs step by step (two slices, both of `xor`'s blocks, the equality on the name) under `check.sh`, and watch the peak.
- **Two related upstream issues are open:** Lean-blaster [#138](https://github.com/input-output-hk/Lean-blaster/issues/138) (`#prep_uplc` scaling on large validators) and [#233](https://github.com/input-output-hk/Lean-blaster/issues/233) (symbolic list tails). Neither is shown to be the cause.

## Practicalities and rules

- **The owner runs every build.**
  - On 2026-11-02 the permission classifier refused Claude's `lake build`, its `check.sh`, and its download of Z3. The owner ran each one and pasted the output.
  - Claude reads and writes the files, and writes the command blocks. A block for the owner names its host and has no placeholders and no `set -e`.
- **Never build bare.** Every build goes through [check.sh](../../../../seedelf-verification/check.sh).
  - It builds each module in its own scope, capped at 8 GB (`CAP=`) and 10 minutes (`LIMIT=`), and its summary gives each module's peak memory.
  - One preparation step over a fully symbolic transaction took 52 GB before it was killed by hand.
  - A module killed at the cap loses all its messages, including the ✅ that came before.
- **Z3 5.3.1 or later.** With an older Z3, every proof that reaches the solver fails with `unknown tactic recfun-finder`, while the goals Blaster's optimizer closes still pass, so it looks half-working. PlutusCoreBlaster's README still says 4.15.2, which is wrong for this Blaster.
- **The proofs are about the deployed bytes.**
  - `extract.sh` re-derives the script hex from `5b82530` and checks it against the on-chain hashes.
  - Variant 1 is frozen ([seedelf-contracts/README.md](../../../../seedelf-contracts/README.md)). The contracts' current source and `hashes/` are a later revision that was never deployed: never verify them as if they were.
- **Writing a property:** follow the README's five rules.
  - Measure steps first: Blaster's machine counts about twice the cost model's steps.
  - Failure is `isUnsuccessful`, never `¬ isSuccessful`.
  - Pair each failure property with a run that passes.
  - Make symbolic only what the property needs.
  - Keep modules small.
- **Soundness, as it stands:**
  - Lean-blaster [#389](https://github.com/input-output-hk/Lean-blaster/issues/389): a `String` ranges over the SMT alphabet, `0x0`–`0x2FFFF`. Our bytestrings, `0`–`255`, sit inside it.
  - [#224](https://github.com/input-output-hk/Lean-blaster/issues/224): a false Valid when a theorem quantifies over types or classes. Ours don't.
  - Re-read both after a bump, and keep new theorems off types and classes.

## Refuted: don't repeat these

- **`consByteString`'s byte isn't a blocker.** `cons_front` proves on its own, and the `BitVec` a symbolic index hit came from the slicing.
- **A symbolic slice isn't the memory cost.** It's about 290 MB at every length.

## Found along the way

**A burn fails when the transaction's first input is output #256 or later.**

- **Why:** the deployed policy's `xor(burn, mint)` evaluates both blocks. So a burn also builds the mint's token name, and `consByteString` refuses an index past a byte.
- **Shown by** `burn_at_256_fails` and `concrete/policy_burns.sh`.
- **The wallet:** seedelf-core refuses such an input for a mint (`seedelf_token_name`) but not for Remove's burn.
  - Local evaluation fails before submit, so nothing is lost, and the same Seedelf burns with other inputs.
  - A 16 KB transaction fits about 400 small outputs, so #256 is reachable.
- **The owner, 2026-11-02:** a narrow edge of the wallet's input selection. No fix requested.

## The owner's decisions

- **2026-11-02, the start:** "a verification folder and branch that we can work on further because it would be interesting to do this for lovejoin as well." So `seedelf-verification/` keeps room for a `Lovejoin/`.
- **2026-11-02, why it matters:** "proving the wallet part of things is verified is huge." WalletRegister comes first once it's unblocked.
- **2026-11-02, the pause:** "Lets commit and push but no pr. I would want these upstream bugs fixed then work everything out before we continue on." The branch is pushed with no PR. Whether `verification` goes into `main`, and when, is still the owner's call.
- **2026-11-02, the drafts:** the owner files them, publicly. None was filed that day.
- **2026-11-02, the burn at #256:** no fix requested.

## Fixing it ourselves

The 2026-11-02 investigation found it within reach, about 3-5 days: bug 1 is one line plus a test; 3 is #29's `Fq1` change; 2 takes an `opaque` stopgap for `byteStringToInteger` (real `BitVec`/`Char` support is upstream's design work, weeks to months). The plan for doing it is [chunk 41](chunk-41-blaster-fixes.md).
