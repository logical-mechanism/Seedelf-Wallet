# Chunk 42 · Lovejoin, verified (local only)

Branch `lovejoin-verification`, from `verification` at `63cdb465`. **Local only:** it's never pushed, and its push remote points nowhere (`branch.lovejoin-verification.pushRemote = no-push-local-only`), so a plain `git push` fails. The owner, 2026-11-03: "A lot of the seedelf web wallet depends on lovejoin working as well. Trickier and if something is found wrong then it would be bad for us to push it into this branch so maybe a local only branch until we prove it good?"

The work goes in `seedelf-verification/Lovejoin/`, beside `Seedelf/`, on the same pinned forks (chunk 41). The README's rules for writing a property hold here.

| Step | Status |
|---|---|
| 1 · Setup, reference_holder and mix_box | ✅ 30 theorems (2026-11-03), every module in seconds, at most 525 MB |
| 2 · mix_logic's easy parts | ✅ 6 theorems (2026-11-03) |
| 3 · `serialise_data` behind an `opaque` alias | ✅ #27's commit on the fork (`0a25f13`, Rob van Leeuwen's), in `seedelf` at `7fc0aa3`, pinned on this branch; the Seedelf baseline unchanged |
| 4 · mix_logic, Owner | ✅ `owner_withdraws_iff_proof` (2026-11-03): the Lean vector's z is Aiken's, and a real proof halts after 3099 steps. Withdrawals of 1 to 3 boxes, every field symbolic (`OwnClassic*`, 9, on 68c5399): 1.8.0's returns |
| 5 · mix_logic, Mix | ⬜ on v2 instead (step 8): the wallet moves to v2 alone, and the classic pool keeps only its Owner |
| 6 · fee_contract and one_shot_mint | ✅ on their templates, for every pool (step 8): `OneShotMint` (5) and `FeeContract` (5) (2026-11-03) |
| 7 · The token-pool templates | ✅ on v2 instead (step 8): the Mix for any token pool at n = 2 to 4. 8131b1d's only mainnet pool (5 ₳) is empty |
| 8 · v2: the templates with xor32's fix | ✅ (2026-11-03, PlutusCoreBlaster 68c5399), 230 theorems. On the test launch: `MixChallenges` (1), `MixOutputs` (4), `MixDatums` (3), `Owner` (1), the Mix iff at n = 2 (7) and n = 3 (13), and the templates for every pool (mix_box 29, one_shot_mint 5, fee_contract 5): 68. On mix_logic's template, so for every pool: the Mix for any ADA or token pool at n = 2 to 4 (82), what it must pay (66), and Owner withdrawals of 1 to 4 boxes (`OwnAny*`, 14) |
| 9 · The wallet on v2 alone | ⬜ waits on step 8 and a v2 launch |
| 10 · Every transaction (the owner's bar, 2026-11-04) | In part. Seedelf ✅ all three scripts (2026-11-05): the wallet with none to 128 signatories, always_false, the policy in every context, and kernel-checked covers (seedelf-verification's README). v2 ✅: every script's other purposes, mix_logic's publish and reference_holder, 17 (`./check.sh lovejoin-any-tx`). ⬜ the Mix, Owner withdrawals and mix_box's spend: the owner's to write |

### Next session, in order

1. **The PR,** on the owner's call (disclosure). v2's verification is done: 276 ✅ on 68c5399. The contract is final: `precompute_statements` stays (the owner, 2026-11-03).
2. **Then publishing the proofs,** so others can re-run them: the xor alias (`local/opaque-xor`) onto the public PlutusCoreBlaster fork and the pin back to GitHub, then this branch into `verification`. Each waits on the PR.
3. **Then the v2 launch** (the new 5 ₳ pool): the template theorems already hold for it.
4. **Then step 9**, the wallet on v2 alone (1.8.0).

**Every transaction (2026-11-04):** the same properties, with every field a script doesn't read left as any `Data` (Seedelf's `AnyTx.lean`, and `AnyTxCover`'s `rfl`s for every V3 spend).
- `./check.sh seedelf-any-tx`: 10 `ok`, 59 ✅, the longest run 1446 steps (a key missed among three signatories), at most 540 MB.
  - The wallet's core property holds with none to three signatories.
  - Its other purposes fail, any redeemer but a proof fails, and WalletNoLock's 18 datum shapes move with a proof.
  - always_false fails on any argument at all.
- **Seedelf's rest (2026-11-05), so every Seedelf script in every transaction.** `./check.sh` 158 `ok` (PolicyBurn and PolicyMint fail on `BitVec` alone, as before) and `./check.sh seedelf-slice` 10 `ok`. Every trace was recounted against its source: 377 ✅ and 7 controls Falsified, plus Slice's 258 ✅ and 6. No trace logs a `sorry`.
  - **Signers:** 4 to 128 signatories (`gen-seedelf-signers.py`, 250 ✅, the slowest 4 s at 355 MB). A 16,384-byte transaction holds at most 125.
  - **The policy, with no slice involved:** mint-only, a redeemer that isn't a `B` fails, and mints of no lines or 2 to 5 lines fail (40 ✅).
  - **Every length, kernel-checked, no Z3:** `PolicyLinesAll` and `LinesAllAnyMint` prove any mint that doesn't flatten to exactly one line fails. They work by induction over the mint on a CEK evaluator (`LinesAllCek`). The chain's budget allows about 3,000 lines.
  - **The one-line rule, both directions:** in `Slice/`, a package of its own over PlutusCoreBlaster's local-only `local/opaque-slice` (96261cc, an `opaque` `SliceByteString`). It's 256 per-index theorems and 2 off a byte, assembled in the kernel. Its spec was checked against Aiken on 9 contexts.
  - **Covers:** `AnyTxShapes` and `PolicyShapes` show the scenarios are every V3 context. The policy's cover assumes CardanoLedgerApiBlaster's input and mint rules.
- `./check.sh lovejoin-any-tx`: `Template.AnyTxPurposes` `ok`, 17 ✅, every parameter symbolic, so for every pool on v2's templates.
  - mix_logic publishes exactly a registration and fails its other purposes.
  - mix_box is spend only, and one_shot_mint mint only.
  - reference_holder fails on every context.
  - The first build failed on two `open` lines that named `#import_uplc` programs by namespace; those names are global (step 8's second build).
- **Not lifted: the Mix, Owner withdrawals and mix_box's spend.** A safety classifier stopped Claude's generator for them, so Claude sessions don't write them: they're the owner's. `Lovejoin/AnyTx/Common.lean`, written before the stop, is unused, untracked and outside `check.sh`.

**What a Mix must pay, for every pool (2026-11-03, 68c5399):** `./check.sh lovejoin-v2-outputs` 24 `ok`, 66 theorems, the slowest module 61 s at 704 MB (`MixTok4Outputs`), the most memory 816 MB (`MixTok4Datums`). Each `…OutSteps`: `honest` halts after the general Mix's own KAT count (11497, 19204 and 29007 for ADA at n = 2 to 4; 11798, 19505 and 29308 for tokens), and each of the eight changed outputs errors, long before the proofs are read.

**What the claim can say (2026-11-03):** the wallet's on-chain contracts, Seedelf's and Lovejoin v2's, are formally verified on their compiled bytes. Its limits:
- **Blaster's proofs are Z3's:** each theorem is SMT-verified (`blasterProven`), not a Lean proof term.
- **The crypto is opaque:** the scripts check exactly the right equations, not that the equations are hard to forge.
- **Up to 4 boxes:** Mixes and withdrawals of up to 4 boxes (3 for the classic pool's withdrawals).
- **Transaction layouts (2026-11-04):**
  - In every transaction: all three of Seedelf's scripts (the wallet's Register spends with up to 128 signatories, past the chain's 125; the policy's one-line rule over the opaque slice), and v2's other purposes and reference_holder.
  - For every value, but only in their scenarios' layouts: the Mix, Owner withdrawals and mix_box's spend.
- **For Lovejoin, from 1.8.0:** the classic pool's Mix isn't verified (step 5), and the wallet mixes there until 1.8.0 moves it to v2.
- **The wallet's own code isn't covered.** `V2/MixOutputs` and `V2/MixDatums` hold at the test launch with two boxes alone, and the general Mix's scenario fixes every box out as it should be, so it couldn't say what a wrong one does. `gen-lovejoin-mix-outputs.py` takes them to mix_logic's template, for the six families of the general Mix (ADA and token pools, n = 2 to 4), with the pool's parameters, every box's points and every proof field symbolic. It's walk_outputs, so a Mix fails if:
- one of its first n outputs is anywhere but mix_box, or has a stake credential or a reference script (`…Outputs`);
- one holds other than exactly the box value (its lovelace, or a token pool's token quantity), or holds any other token beside it;
- it has fewer than n outputs, or a later output is another box at mix_box;
- one's datum isn't two unequal 48-byte points, or isn't inline (`…Datums`).
- **The builder** (`…Out`'s `mixCtxOuts`) is the scenario's Mix with its outputs given, and with the scenario's outputs it is the scenario's (`mixCtxOuts_is_the_mix`, by `rfl`). So each theorem changes one thing in the Mix whose iff the family proves.
- **`MixChallenges` needs no lift:** the general Mix's spec has xor32 return `none` for a `c` of any other length, so a box with one fails its challenge theorem, for every pool and n = 2 to 4.

**v2's general Mix (2026-11-03, 68c5399):** `./check.sh lovejoin-v2-pools` 42 `ok`: 82 theorems on mix_logic's template, ADA pools at n = 2, 3 and 4 and token pools at n = 2, 3 and 4. Every pool parameter, box point and proof field is symbolic. The slowest module was 13 s at 740 MB (token pools at n = 4). Each family's `Steps`: the KAT halts (11497, 19204 and 29007 steps for ADA at n = 2 to 4; 11798, 19505 and 29308 for tokens) with the spec `true`. Its first box's or last box's z changed errors with the spec `false`, and so does n = 2's ADA KAT in a 5 ₳ pool.

**Owner withdrawals of several boxes (2026-11-03, 68c5399):** `./check.sh lovejoin-owner` 35 `ok`, 23 theorems, the slowest module 9 s at 458 MB. The wallet withdraws one box a transaction (seedelf-wasm's `withdraw_in`), but a withdrawal's safety is about what anyone can build.
- **The scenario** (`gen-lovejoin-owner.py`): n boxes with every point and proof symbolic, a payer's key input beside them, and two outputs, a Seedelf register at a wallet contract and then change, every field symbolic.
- **Which code:** v2 through mix_logic's template (`OwnAny1*` to `OwnAny4*`, any pool), and the deployed classic pool (`OwnClassic1*` to `OwnClassic3*`, 1.8.0's returns).
- **The theorems:** for each box, a well-formed box whose proof doesn't verify against the transaction fails the withdrawal (`…Boxes`), and with every proof verifying it succeeds (`…Passes`).
- **`Steps`:** honest proofs (box i `(g1, x·g1)`, x = 0x5eed0e1f + i) halt with the spec `true` in all seven (v2: 3415, 4846, 6277 and 7708 steps for 1 to 4 boxes; classic: 3319, 4754 and 6189). z1 changed, the change a lovelace more, and two boxes' proofs swapped each error with the spec `false`, all at the same step within a family: each breaks box 1's proof, the change by moving the outputs it's bound to.

**Everything on 68c5399 (2026-11-03):** `./check.sh lovejoin` 10 `ok`, `./check.sh lovejoin-v2` 29 `ok`, 105 ✅: the classic pool's 37 and v2's 68. Every `Steps` line as before. `V2/Mix3Steps`: the KAT halts after 19204 steps, `mixAccepts3` is `true`, and z11 or z33 changed errors (after 11486 and 18882 steps) with the spec `false`. The n = 3 theorems each solved in 0.02 s, at most 412 MB; `(verbose: 1)` is out.

**Step 8's Mix iff at n = 2, on 68c5399 (2026-11-03):** `MixFirst`' 3, `MixSecond`'s 3 and `MixPasses`' 1 ✅, each solve 0.02 s and each module under 10 s at 366 MB, after the dependencies' rebuild (93 s). `V2/Steps` unchanged on the new pin. The three tie-in lemmas elaborated. So a Mix of two moves boxes iff each box's sigma-OR proof verifies against the boxes it pays, with every field of both proofs symbolic. `(verbose: 1)` is out.

**`V2/MixBranch`, the diagnostic (2026-11-03):** every uncompression (a constant input point, a constant output point, a symbolic `t0`) and `z`'s checks ✅; both equations ❌. The compiled UPLC (`aiken uplc decode`) shows why. `DHTupleStatementPt` is Data-encoded, so walk_outputs stores each box out's point as `bData(compress(uncompress a'))`, and each branch uncompresses it again. The script's statement point is `uncompress(compress(uncompress a'))`, the spec's was `uncompress a'`, and the solver can't equate them over opaque builtins. `branchHolds` now takes the script's form, and `MixBranch` is deleted.
- **A side finding, about cost, not safety:** `precompute_statements`' comment says it saves N²−N uncompressions a Mix, but the record's encoding undoes that. Each box out's point is uncompressed, compressed, then uncompressed again in every branch: 2N + 2N² uncompressions and 2N compressions, where the comment counts 2N. While v2 isn't launched, changing it costs no migration, but it changes mix_logic's hash and its proofs re-run.
  - **The owner's call (2026-11-03): keep it.** N = 4 is the chain's limit "for a while if not forever", and it fits: the width test measured a four-box Mix of the token pool's test launch at 9.889B of 10B steps (2026-10-16), and xor32's fix adds 10.8M at N = 4, so about 9.90B.

**`MixFirst`'s second build (2026-11-03):** `mix_needs_the_first_challenge` ✅ in 0.02 s, so the literal `zero32` closed that gap. `V2/Steps`' all-zero run errors after 7869 steps, spec `false`. Both branch theorems ❌ Falsified in under a second, so `branchHolds` and the script's branch still differ somewhere. Each equation has the Owner's shape (Valid on v2), and the stdlib's `from_int` (`n % field_prime`), `scale`, `add` and `equal` match the spec. What the Owner never had is a constant point: there `a` and `b` are symbolic, while every Mix point is the KAT's. `V2/MixBranch` (a diagnostic, run by name) takes box in 1's first branch condition by condition: a constant point, a symbolic one, `z`'s checks, each equation. `MixSecond` didn't finish in its first minutes, likely its own copy of the gap; it waits on this.

**`MixFirst`'s first build (2026-11-03):** ❌ Falsified in 0.6 s (Optimization 1.55 s), every field 32 zero bytes. With the real builtins that fails, since a 32-byte string isn't a G1 point (`V2/Steps` now runs it): the solver passed it by its choice of the opaque functions. The likely cause: the spec's `zero32` was `ofHex "00…"`, a recursive parser, where the script has a literal constant, so the xor folds started from different terms. Every other `ofHex` term is the scenario's, on both sides. `zero32` is a literal now, and each half is three theorems, so a second gap would name its check. The 85 ✅ stand: a term the solver can't reduce only gives it more freedom, which can make a false Falsified, never a false Valid.

**Step 8's third build (2026-11-03):** 18 `ok`, 1 `TIMEOUT`, every `ok` module in seconds, at most 523 MB.
- `V2/Steps`: the KAT halts after 11497 steps, `mixAccepts` is `true` on it, and with z11 changed the script errors and the spec says `false`. v2's Owner: valid `halt after 3195`, spec `true`; the other payout and z changed `error`, spec `false`.
- `Template/Steps`: at the classic L, each mix_box line is `Lovejoin.Steps`' own, step for step, since the deployed script is the template applied. At v2's L, v2's withdrawal halts (1060) and the classic one's errors (1089). The 5 ₳ pool's own launch halts (1941); minting two or without the seed errors. A Mix's fee halts (4393), a lovelace short errors, replenished halts (2933).
- New ✅: v2's `owner_withdraws_iff_proof`, the template's 29 mix_box theorems, `OneShotMint`'s 5 and `FeeContract`'s 5. The classic mix_box modules, rebuilt under the xor alias, stayed ✅.
- `MixProofs`, the Mix iff as one theorem, ran past 30 minutes at 503 MB, its memory flat. The parts' timed phases will say whether Lean or Z3 took the time. It's now three theorems (`V2/MixSplit`), and `MixProofs.lean` is gone.

**Step 8's second build (2026-11-03):** `MixOutputs`' 4 and `MixDatums`' 3 Valid, in 10 s and 7 s at most 356 MB. `V2/Logic` failed on `import Lovejoin.Scripts`: `#import_uplc` and `#prep_uplc` names are global, whatever the namespace, so v2's `mixLogic` met the classic pool's (and `appliedAmount` Seedelf's policy one). Now `mixLogicV2` and `appliedBoxValue`; no bare `mixLogic` is left in `V2/`.

**Step 8's first build (2026-11-03):** four `ok`. The KAT's Mix halts after 11497 steps, and with its first box a lovelace over errors after 4802. `mix_refuses_a_challenge_not_32_bytes` is Valid in 3 s, peaking at 340 MB. The step 4 run in the same session: ten `ok`, 37 ✅.

**Step 4's first build (2026-11-03)** failed on a name. `toData` is a class method, `IsData.toData`, so `open CardanoLedgerApi.IsData.Class (toData)` can't name it. Fixed by opening `(IsData)`. The second build was ✅.

**Where everything is, for a new session:**
- This branch, `lovejoin-verification`, is local only; see the memory file `lovejoin-verification-local-only.md`. The working copy is on it.
- The chunk 41 forks are under `../blaster-forks/`. This branch pins the PlutusCoreBlaster clone's `local/opaque-xor` by local path: 68c5399 since the merge of `local/seedelf-repin` (fork `seedelf` 1e38b23, with the #71 and #72 review rounds, plus the xor alias), 96a36cb before; `verification` pins `c7d8741`.
- v2's sources are in `../lovejoin-v2` (5cc3631), local only.
- The open upstream PRs are Lean-blaster #455 and PlutusCoreBlaster #71, #72 and #73 (chunk 41).
- Lovejoin's sources are in `../lovejoin`, for reading: `git show c1239fb:contracts/…` for the classic pool, and `8131b1d` for the templates.

**Steps 2 and 3's run (2026-11-03):** eight `ok`, 36 ✅. mix_logic errors after 216 steps on minting, and on publish halts after 290 for its registration and errors after 290 for an unregistration. The Seedelf baseline was unchanged with #27's alias pinned.

**Step 1's run (2026-11-03):** seven `ok`, 30 ✅.
- reference_holder errors after 178 steps on a spend, 130 on minting.
- mix_box, by datum:
  - well-formed with no withdrawal errors after 1029; with mix_logic's withdrawal it halts after 1060; with another's it errors after 1089;
  - `a = b` halts after 889, three fields after 676;
  - no datum, and by hash, halt after 447.
- Each matches `concrete/lovejoin_mix_box.sh`.

## When a property comes back Falsified

- **First, run the counterexample concretely**, with Aiken's evaluator on the deployed bytes, as `concrete/` does.
- **If Aiken agrees, it may be a flaw in a live pool.**
  - Stop, and tell the owner only.
  - Nothing that hints at it gets pushed or posted: no fork branch, no upstream comment, no PR text.
  - The owner decides on disclosure; Lovejoin has its own `SECURITY.md`.
  - The pool's scripts are frozen, so a fix is a new pool beside it.
- **If Aiken disagrees, it's a gap in our spec or in the tools,** as WalletRegister's operand order was in chunk 41. Fix that, the same way.
- **Tool fixes that say nothing about Lovejoin can go public,** for example #27's `serialise_data` alias on our forks and upstream. A fix that a finding motivated waits with the finding.
- **This branch merges into `verification`** (public) only when the owner says the results are good to publish.

## Targets

1. **The classic mainnet pool, first.** It's the live ADA pool, 10 ₳ a box.
   - Its bytes are Lovejoin `c1239fb`'s `artifacts/mainnet/`, from the 2026-09-26 deployment (Aiken v1.1.24), fully applied.
   - `extract-lovejoin.sh` checks each against the hash seedelf-core pins (`lovejoin::Protocol::of`, mainnet). It checks mix_box and mix_logic against the reference scripts seedelf-core holds as they sit on chain (`references.rs`), the bytes the wallet spends against.
   - All five matched on 2026-11-03: mix_box `c145c10f…`, mix_logic `0dad3046…`, fee_contract `a072c7e8…`, one_shot_mint `f5592689…` (the NFT policy), reference_holder `288fea77…`.
2. **The token-pool templates later:** Lovejoin `8131b1d`, seedelf-core's `templates.rs`.
   - They differ from the classic pool's sources (2,226 lines across 12 files), so they're a second target, not a re-run.
   - They're templates, so the theorems take a launched pool's parameters: the 5 ₳ pool's, or the wallet's own launch.
   - Commit `8131b1d` was fetched into `../lovejoin` on 2026-11-03 to read it. That checkout stays on its own branch.
3. **The preprod pool isn't a target:** its scripts are recompiled and hash differently.

## Step 1 · Setup, reference_holder and mix_box ✅

- **Done:**
  - `extract-lovejoin.sh`: all five scripts `ok`, as above.
  - `concrete/lovejoin_mix_box.sh`: ten one-input spends through Aiken's evaluator, all as the source says:
    - a well-formed inline box moves only with mix_logic's withdrawal; another credential's doesn't count;
    - `a = b`, a 47-byte `a`, the wrong constructor, three fields, `I 7`, no datum, and a well-formed datum stored by hash (audit finding F-2) all move with no withdrawal.
  - `Lovejoin/`: `Scripts` (the imports), `Box` (the scenario: one box, the transaction's only input), `Steps` (the concrete runs), and four property modules:
    - **ReferenceHolder** (1): reference_holder fails for any purpose and redeemer.
    - **MixBoxPurpose** (5): mix_box is spend only.
    - **MixBoxGate** (5): with no withdrawal, a box moves iff its datum isn't a well-formed `MixDatum` (`Constr 0 [B a, B b]`, both 48 bytes, `a ≠ b`). A well-formed box moves with mix_logic's withdrawal of any amount, and not with another script's or a key's.
    - **MixBoxNoLock** (19): every other datum shape moves with no withdrawal, as `Seedelf.WalletNoLock`'s shapes cover. That includes a box stored by hash whatever its witness says (F-2), and holds for any redeemer.
- **Not covered:** a transaction with more inputs than the box, or more withdrawals than one. Both are lists the script walks (`list.find`, `pairs.has_key`). One box and one withdrawal, symbolic everywhere else, is the scenario.

## Step 2 · mix_logic's easy parts ✅

- Its purposes: spend, mint, vote and propose fail. Publish succeeds only for a `RegisterCredential` certificate, for any credential, and fails for every other certificate.
- The scenario reads the reference input: `read_reference_datum` looks for the pool's NFT among the reference inputs. Fix one reference input holding it, with the deployed `ReferenceDatum`: denomination 10 ₳, 1 ₳ maximum fee per mix, and the three hashes.

## Step 3 · `serialise_data` behind an `opaque` alias ✅

- **Done:** #27's commit, cherry-picked from SundaeSwap's fork as `0a25f13` (its author kept), on our fork's `feat/opaque-serialise-data` from `main` `1c23de8`. It's merged into `seedelf` as `7fc0aa3`, which this branch pins. `verification` still pins `c7d8741`.
- **mix_logic hashes `serialise_data`** of the outputs and the input refs (Owner), and of the box value (Mix). PlutusCoreBlaster's encoder can't be translated (Lean-blaster #152, #153).
- **PlutusCoreBlaster #27 (Luivatra, a draft since July) is the fix:** `encodeDataOpaque` at the builtin's dispatch.
  - Take it onto our fork's `seedelf` branch, credited, as #72 took #29's part.
  - It says nothing about Lovejoin, so it can go on the public fork. #27 itself is the PR, so no new one.
- **A spec that hashes the same serialisation** calls the same alias, as `scalarOf` does (README rule 7).

## Step 4 · mix_logic, Owner ✅

- **Done:** `concrete/lovejoin_owner.sh` builds an Owner proof outside Lean, with Aiken's evaluator for the curve points and `serialise_data` and Python for the hashes. The box is `(g1, x·g1)` with x = 0x5eed0e1f, the nonce is 0x1234567, and the proof is bound to a 9 ₳ payout. The deployed mix_logic returns unit for it, and crashes for the same proof with the payout a lovelace more, or with z changed.
- `Lovejoin/Logic.lean` holds the scenario: the reference input as it sits on chain (decoded from seedelf-core's `LOVEJOIN_MAINNET_REFERENCE`), the box, one payout. It also holds the spec, `ownerAccepts`, line for line with `validate_owner` and `schnorr.verify`: the aliases, `Int.fmod` for `scalar.from_int`, and the G1 operations in the script's order.
- `Lovejoin/Owner.lean`: `owner_withdraws_iff_proof`, with the box's bytes, the proof and the payout's key and amount symbolic.

- **The property, with n = 1:** a withdrawal under `Owner` succeeds iff the box's Schnorr proof verifies against `ctx = blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_script_hash)`. So an owner's proof is bound to the transaction's outputs and inputs, and can't be replayed to redirect them.
- **Measure first:** a real Owner spend from Lovejoin's own vectors (`schnorr_kat.test.ak`, `mix_kat.test.ak`), through Aiken and then `Steps`.
- **Read `schnorr.ak` and `bls.ak` before writing the spec.** `point_from_bytes` uses `bytearray_to_integer` (our alias) and the G1 operations, whose operand order the spec must follow (README rule 7).

## Step 5 · mix_logic, Mix ⬜

- **(a) No value leaves the pool in a mix,** for n = 2:
  - if a Mix succeeds, its first n outputs are each at mix_box, with no stake credential or reference script, exactly the box value, and a well-formed inline `MixDatum`.
  - That's one direction, so the sigma-OR proofs can stay symbolic and unread.
- **(b) The iff:** success iff (a) holds and every input's sigma-OR proof verifies over the n statements.
- **Expect cost.** That's n² DH-tuple checks over opaque builtins. If (b) is `KILLED`, split it by input, as chunk 40's stop rules say.
- **Possible blocker:** `hash.ak`'s Fiat-Shamir header calls `from_int_big_endian` on n. With n fixed it may evaluate away. If it reaches `BitVec`, it needs an `IntegerToByteString` alias, which chunk 41 deferred.

## Step 6 · fee_contract and one_shot_mint ✅ (on their templates, step 8)

- **fee_contract:** what `PayMixFee` and `Replenish` allow. Read it first.
- **one_shot_mint:** the NFT mints once, only with the seed spent, and lands at reference_holder with a well-formed `ReferenceDatum`. On mainnet the seed (`ba815aa5…#2`) is spent, so the policy can never mint again, a ledger fact beside the theorem.

## Step 7 · The token-pool templates ✅ (on v2, step 8)

- **Done on v2 instead:** the Mix for any token pool at n = 2 to 4 (`V2/MixTok*`), through mix_logic's template. 8131b1d's only mainnet pool (5 ₳) is empty, and the wallet moves to v2 alone.
- **The plan was:** the same properties over `8131b1d`'s scripts, applied to a launched pool's parameters, after listing what changed from `c1239fb` and which theorems carry over.

## Step 8 · v2: the templates with xor32's fix ✅

- **The fix is the owner's:** xor32 checks both operands are 32 bytes before `xor_bytearray(False, …)`, which truncates rather than fails. It's committed as 5cc3631 on 8131b1d, with the owner's eight boundary tests, in `../lovejoin-v2` (branch `local/xor32-length-check`).
  - That clone was made from `../lovejoin`, and its push URL is `no-push-local-only`.
  - Lovejoin's repo is public, so the commit itself would be the disclosure.
  - `../lovejoin` is back on its own branch with a clean tree: its untracked regression test and this folder's patch, which carried it, are deleted (the owner, 2026-11-03), and the fix lives only in v2. This work never builds or runs a forged-challenge vector.
- **Tested:** Lovejoin's 3724 checks pass unchanged, plus the 8 boundary tests (3732). A mix costs about 0.1% more CPU: N=3 +6.1M of 5.7B steps, N=4 +10.8M of 9.7B.
- **Hashes:** only mix_logic's unapplied bytes change, 62befd1e… to 7fb45b75…. one_shot_mint, mix_box, fee_contract and reference_holder build byte for byte as 8131b1d's (`templates_are_frozen`'s hashes). A v2 pool still has its own P (its seed), L and M (mix_box applied to L).
- **PlutusCoreBlaster can't read xor over a symbolic bytestring:** `byteStringOp` slices with `String.dropRight` and maps through `UInt8`. The fix is an opaque alias at the builtin, as chunk 41's `byteStringToInteger` was: `local/opaque-xor` 96a36cb, from `seedelf` 7fc0aa3, push remote `no-push-local-only`.
  - It stays local, since this finding motivated it. It goes to the public fork, and the pin back to GitHub, when the owner publishes.
- **The scenario** (`Lovejoin/V2/Mix.lean`) is Lovejoin's KAT `mix_real_proofs_ada_pool_n2_passes` as a full ScriptContext: its test launch (NFT policy `abab…`), its two boxes in and out, and its real proofs. `extract-lovejoin-v2.sh` applies mix_logic to that launch (60294352…).
- **Proved:** `mix_refuses_a_challenge_not_32_bytes` ✅. With the KAT's four `c`s symbolic, a `c` of any other length, in any branch, fails the Mix. The rest of the proof stays the KAT's (rule 4).
- **Proved too (the second build):**
  - `V2/MixOutputs`: no value leaves the pool. A box out anywhere but mix_box, with a stake credential or a reference script, with other lovelace than the box value, or with a token, fails the Mix (4 theorems).
  - `V2/MixDatums`: a box out's datum must be inline and well-formed, so every box paid out can be withdrawn (3 theorems).
- **Proved in the third build:** `V2/Owner`, step 4's iff on v2. validate_owner and its libraries are the classic pool's line for line, so the spec is `Lovejoin.Classic`'s, with v2's mix_box hash.
- **Proved on 68c5399:** the Mix iff, in three parts (`V2/MixSplit`). The KAT's transaction, with every field of both proofs symbolic, fails if box in 1's proof doesn't verify (`MixFirst`), fails if box in 2's doesn't (`MixSecond`), and succeeds with both (`MixPasses`). The spec is `mixAccepts` (`V2/MixSpec`, line for line with `verify_pre`). As one iff (`MixProofs`), it ran past 30 minutes.
- **The other templates, for every pool (✅ in the third build):** mix_box, one_shot_mint and fee_contract are byte for byte 8131b1d's, and each deployed script is its template applied to the pool's parameters: `extract-lovejoin-v2.sh` checks the classic pool's mix_box and the 5 ₳ pool's policy and fee_contract. So `Lovejoin/Template/` takes the parameters as symbolic arguments, and its theorems hold for every pool on them, a v2 launch's included.
  - mix_box (L symbolic): `Lovejoin.Classic`'s 29 on the template (`MixBoxPurpose`, `MixBoxGate`, `MixBoxNoLock`).
  - one_shot_mint (the seed, reference_holder and P symbolic): a mint needs the seed spent and exactly one token named `lovejoin`, at reference_holder with no stake part or reference script, under a sane `ReferenceDatum` (`OneShotMint`, 5). With the ledger's spend-once rule, a pool's NFT exists once. mix_logic's reference lookup relies on that.
  - fee_contract (P, the cap and the amounts symbolic): a shard loses exactly the fee, at most the cap, only for a Mix of three boxes or more, and replenished only grows (`FeeContract`, 5).
- **Proved on 68c5399:** the Mix at n = 3 (`V2/Mix3*`): the KAT `mix_real_proofs_ada_pool_n3_passes`, generated from `mix_kat.test.ak` by a script and checked value for value (51 hex strings). The spec is n = 2's unrolled for three, so each box's four checks are four theorems, and `Mix3Passes` the converse.
- **Proved on 68c5399, on mix_logic's template:** the Mix for any ADA or token pool at n = 2 to 4 (`V2/MixAny*`, `V2/MixTok*`, 82, written by `gen-lovejoin-mix.py`), and Owner withdrawals of 1 to 4 boxes (`V2/OwnAny*`, 14, by `gen-lovejoin-owner.py`). With the pool's parameters symbolic, they hold for a real launch with no re-run.
- **Proved on 68c5399, on mix_logic's template:** what that Mix must pay, for the same families (`V2/Mix*Out*`, `…Outputs`, `…Datums`, 66, by `gen-lovejoin-mix-outputs.py`): `MixOutputs` and `MixDatums` for every pool at n = 2 to 4.
- **Not covered:** a Mix of more than 4 boxes (validate_mix takes up to 255, the wallet makes 3 or 4) and Owner withdrawals of more than 4 boxes (3 on the classic pool). Each is the same check repeated per box, but no theorem says so for every n.

## Step 9 · The wallet on v2 alone ⬜

The owner, 2026-11-03: "if we did fix this and its formally verified then we could update lovejoin to only use this new contract since I think we almost already cleared out the old pools".

- **The old pools are nearly empty** (Koios, 2026-11-03): the classic pool's mix_box holds 3 boxes (30 ₳), and the 5 ₳ pool's (8131b1d, mainnet's only token pool) holds none. So there's no migration feature to build.
- **The old pools keep their Owner withdrawal alone,** so any box still in them comes home. The classic pool's is proved (step 4). The wallet stops depositing into or mixing in them.
- **Before the switch, on v2:** the Mix iff (step 5's (b)), the Mix's outputs (`MixOutputs`, `MixDatums`) and the Owner iff, all Valid. mix_box's source is the classic pool's, unchanged (step 1's gate), but its bytes take v2's L, so the gate is re-run on them.
- **Then a v2 launch on chain** (the owner's). Every v2 theorem is re-run on its parameters, not the test launch's.
- **Then the wallet:** seedelf-core gets v2 templates beside 8131b1d's (`templates.rs`'s own rule), and so does the data layer's copy, with the shared vectors re-recorded. Launches use v2 only, and pools on 8131b1d's templates are shown only for their withdrawals.
- **Disclosure is still the owner's call:** what the release and Lovejoin's own repo say, and when.

## The owner's decisions

- **2026-11-03, the start:** "is it possible to do it for lovejoin … maybe a local only branch until we prove it good?"
- **2026-11-03, the fix:** xor32 checks both lengths (`expect` on `left` and `right`), "then continue with the formal verification on that new code base", then the move (step 9).
- **2026-11-03, the old pools:** once the fix is verified, Lovejoin in the wallet uses only the new contracts; the old pools are almost cleared out (step 9).
- **2026-11-03, the priority:** "number one goal right now is to make lovejoin formally verified and secure!"
- **2026-11-03, the game plan:**
  - Verify v2, then open the PR on Lovejoin's repo.
  - Seedelf Wallet 1.8.0 allows no mixing into the old pools and returns every box in them as soon as it can. The UI hides the old pools, shown for withdrawal alone, and the release integrates v2.
  - Once v2 is merged, the owner launches a new 5 ₳ pool and keeps it as the only pool for now. The old pools hold about 30 ₳, so little money moves.
  - Then a wallet with both Seedelf and Lovejoin formally verified, "great for security and a great marketing tool too". But "first thing first, get lovejoin safe asap".
  - What v2's verification needs before the PR, in order:
    1. The Mix for any boxes and any v2 ADA pool (`V2/MixAny*`, mix_logic's template).
    2. The same at n = 3.
    3. Owner withdrawals of several boxes, v2 and the classic pool (1.8.0's returns).
    4. N = 4 and token pools later, since the new pool is an ADA pool.
  - **2026-11-03, tokens and N = 4 now:** "Just get it done now so we dont have to make any new contract changes down the line." All four are proved (210 ✅).
  - **2026-11-03, the cost:** `precompute_statements` stays as it is. "So at N=4 which is the chain limit for a while if not forever, can be proven to be safe then we are good to go."
