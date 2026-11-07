# Review 1.8.1 · fidelity: #368's readable statements against the Aiken source

**Reviewer:** fidelity. **Tree:** `web-wallet/release-1.8.1` at `2a8060d3` (#368 merged as `d190f717`). **Source:** Lovejoin `29573c5` (`contracts/validators/mix_logic.ak`, `one_shot_mint.ak`, `contracts/lib/lovejoin/*.ak`), read through git, and stdlib v4.0.0 (what its `aiken.lock` pins), read from `seedelf-contracts/build/packages`.

## Verdict

No fidelity defect. Each readable definition reads the way its Aiken function does: argument order, list order, each comparison's direction and strictness, which fields it reads, and byte versus integer equality. Wherever the source fails or returns False, the definition doesn't hold, which is all an iff on "returns `()`" needs. The two headline theorems take ledger value rules as their only hypotheses, and each rule holds in every transaction the ledger accepts. The lead's capped build checks all 25 modules: no `sorry`, and no warnings in the five Readable modules.

The chunk-45 read missed nothing in the theorems themselves. What it missed is in the docs around them: three findings, two low and one nit.

## Findings

### fidelity#1 · low · `seedelf-verification/README.md:68`: the readable theorems are called iffs "over every typed V3 context", but they carry value hypotheses

**Evidence.** README.md:68 reads: "mix_logic (`Lovejoin.Every.Readable.mix_logic_accepts_iff`: …) and one_shot_mint (`Lovejoin.Every.Readable.one_shot_mint_accepts_iff`: the launch). Each is an iff over every typed V3 context, any list length, no step limit, Lean's own axioms alone." The theorems it names:

```lean
-- Readable.lean:224
theorem mix_logic_accepts_iff (P : ByteString) (ctx : ScriptContext)
    (hv : ∀ i ∈ ctx.scriptContextTxInfo.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) : …
-- Readable.lean:257
theorem one_shot_mint_accepts_iff (seedTx : ByteString) (seedIx : Integer) (rh : ByteString)
    (ctx : ScriptContext)
    (hmint : CardanoLedgerApi.V3.Contexts.validMintValue ctx.scriptContextTxInfo.txInfoMint = true)
    (houts : ∀ o ∈ ctx.scriptContextTxInfo.txInfoOutputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true) : …
```

The same sentence's "Each" also covers `reference_holder_every_context_errors`, which is an error theorem, not an iff.

In the model the hypotheses do real work: without `hv`, the readable iff is false. Take an honest Owner withdrawal whose only reference input carries the NFT in a value with its policies out of order: `[("", [("", 2 ₳)]), (Z, [("x", 1)]), (P, [("lovejoin", 1)])]`, with `P < Z`. `readReferenceDatum` finds the carrier, since `valueOf` searches the whole list, so `mixLogicAccepts` holds. The program's `policyEntry P` (Lookup.lean) stops at `Z` (`P ≤ Z`, `P ≠ Z`) with no tokens, finds no carrier, and errors.

**Failure.** A reader who checks README.md against the theorems finds hypotheses the README says aren't there. No real transaction is affected: every UTxO and every V3 mint the ledger produces meets these rules. CLAIMS.md (*The ledger's rules, where they're used*) and `Lovejoin/AnyTx/README.md:46–47, 59–60` both state them. By the letter of the scale (a README overstating a theorem), this could count as medium. In effect it's wording.

**Fix** (wording, no test): "Each characterizes its script in every typed V3 context, any list length, no step limit, Lean's own axioms alone: reference_holder errors in all of them; mix_box's is an iff with no hypothesis; mix_logic's assumes the reference inputs' values are ones the ledger accepts, and one_shot_mint's assumes the same of the mint and the outputs (CLAIMS.md, *Where it stops*)."

### fidelity#2 · low · `seedelf-verification/README.md:36–41`: the standard-suite command never builds `lovejoin-every`

**Evidence.** README.md:36–41 reads: "To check the standard Lovejoin and Seedelf proof suites, including the separate Slice package, from this directory: `./check.sh lovejoin && ./check.sh lovejoin-v2 && ./check.sh lovejoin-any-tx && ./check.sh seedelf-slice && ./check.sh`". check.sh puts the 25 `Lovejoin.Every.*` modules in `every=(…)`, which only `[ "${mods[0]}" = lovejoin-every ]` selects (check.sh:153). None of those five families lists them, and `Lovejoin.lean` doesn't import them. #368 added the family to check.sh's header and to `Lovejoin/AnyTx/README.md:68`, but left this command as it was (`git diff 9103df62 d190f717 -- seedelf-verification/README.md`).

**Failure.** Someone who re-checks the folder by its README sees every family `ok` without ever building `Readable.mix_logic_accepts_iff` or `Readable.one_shot_mint_accepts_iff`. Those are two of CLAIMS.md's seven rows, and the two the Lovejoin half of "formally verified" rests on.

**Fix** (no test): append `&& ./check.sh lovejoin-every` to the command, and note that the family defaults to 16 GB and 30 minutes a module (check.sh:25).

### fidelity#3 · nit · `seedelf-verification/Lovejoin/Every/Readable.lean:303–309`: the axiom guards sit on the `_valid` corollaries, not on the theorems CLAIMS.md cites

**Evidence.** The two `#guard_msgs in #print axioms` lines name `mix_logic_accepts_iff_valid` and `one_shot_mint_accepts_iff_valid`. Nothing guards `mix_logic_accepts_iff` or `one_shot_mint_accepts_iff` directly, yet those are what CLAIMS.md:15–16 cites, and the docs say to cite them instead of the `_valid` forms. Today the guards reach them anyway: each `_valid` proof applies its headline theorem, so its axiom list includes theirs.

**Failure.** None today. But if a `_valid` form stops going through its headline theorem, or is dropped as the docs suggest, a `sorry` behind a cited theorem becomes only a warning, and `check.sh` still reports `ok`.

**Fix** (the guard is the test): add `#guard_msgs in #print axioms` for `Lovejoin.Every.Readable.mix_logic_accepts_iff` and `Lovejoin.Every.Readable.one_shot_mint_accepts_iff`, each expecting `[propext, Classical.choice, Quot.sound]`.

## Checked that held

Function by function, each Lean definition against the source at `29573c5`, and against stdlib v4.0.0 where the source calls it:

- **read_reference_datum → `readReferenceDatum`.** `list.filter` over `self.reference_inputs` by `quantity_of(value, P, N) == 1` (`holdsReferenceNft`). Stdlib's `quantity_of` is `tokens` then `dict.get_or_else`, both the ordered `do_get`, so reading it as `valueOf` needs the sorted value that `hv` gives. `expect [Input { output, .. }]` means exactly one carrier, then `expect InlineDatum`. `expect parsed: ReferenceDatum` is `RefDatum.ofData`: constructor 0 with exactly eight fields `I, B, B, I, I, B, B, B`, in types.ak's order. No byte lengths are checked, since the types are aliases.
- **collect_well_formed_mix_inputs → `collectWellFormedMixInputs`.** `filter_map` in the context's input order. No sorting is assumed: the theorem holds for every order. `input_at_script` reads only the payment credential and ignores the stake part and reference script, as mixbox.ak says. Only inline datums count. `try_decode_well_formed_data` wants constructor 0 with exactly two `B` fields, both 48 bytes, and `a != b` by bytes.
- **validate_owner → `validateOwner`.** `n >= 1` is `≠ []`, and `length(proofs) == n` sits inside `AllPairs`. `ctx = blake2b_256(serialise(outputs) ‖ serialise(each input's output_reference) ‖ mix_script_hash)`, over every output and every input, concatenated left to right. `pairs_match_and_all` is `AllPairs`: same length, every pair passes.
- **schnorr.verify → `Lovejoin.Classic.schnorrVerifies m.a m.b t z ctx`.** The base is `a` and u is `b`. Base, u and t are uncompressed, and a bad encoding is an error. `z` must be 32 bytes and strictly `< q`, then goes through `scalar.from_int` (`int % field`, `Int.fmod`). `c` is the big-endian integer of `fs_hash_schnorr(base, u, t, ctx)`, reduced; the hash input is `DOMAIN ‖ 0x01 ‖ g ‖ u ‖ t ‖ ctx`, with `prefix01` tied to the program by `rfl`. The check is `[z]·base == t + [c]·u`, with `g1.scale` as `scalar_mul(int, point)` and `add(t, ·)`.
- **box_value → `RefDatum.boxValue`.** Stdlib's `from_asset` returns `zero` at 0, so there's no ADA entry at `box_lovelace = 0`. `add` returns `self` at quantity 0. The ADA-pool branch (`token_policy == #""`) ignores name and quantity. The token entry goes after ADA, since `#""` sorts first.
- **walk_outputs → `walkOutputs`, and `walkOutputs_eq`.**
  - Prefix steps run while `prefix_remaining > 0`, strictly. Each output must pass `output_at_script`: `Script(msh)`, stake `None`, reference script `None`.
  - `output.value == box_value` is structural equality, so no sortedness is assumed. The datum must be `InlineDatum`, and `decode_mix_datum_strict` accepts exactly `try_decode_well_formed_data`'s set (`stmtDatum_typed`). Both points are uncompressed (else an error), and the statement keeps the datum's own bytes.
  - The accumulators are `datums_acc ‖ serialise(inline datum)` and `values_acc ‖ box_value_bytes`. Tail steps `expect !output_at_script`, and the walk ends on `prefix_remaining == 0`.
- **verify_pre → `verifyPre`, `branchHolds`.**
  - `[_, _, ..]` means at least two statements. The hash input is `const_prefix ‖ a ‖ b`, then each statement's `ap ‖ bp` in output order, each branch's `t0 ‖ t1`, then `ctx`.
  - The xor fold starts from `zero32` (32 zero bytes) and runs `xor32(acc, br.c)`, accumulator on the left, both 32 bytes. The comparison is by bytes. `a` and `b` are uncompressed, and `parallel_all` is `AllPairs`.
  - Per branch: `t0` and `t1` are uncompressed, `z` goes through `scalar_from_bytes` and `c` through `scalar_from_bytes_mod`. The checks are `[z]·A == T0 + [c]·A'` and `[z]·B == T1 + [c]·B'`, with `A`, `B` the input box's points and `A'`, `B'` the output statement's, read back as `uncompress(compress(·))` (the module doc says so).
- **validate_mix → `validateMix`.**
  - `n >= 2` and `length(proofs) == n`. `serialise_data(box_value)` runs once, and the walk runs with `n`. The statements are reversed back to output order.
  - `ctx = blake2b_256(datums ‖ values ‖ msh)`, which binds only the first n outputs. `n <= 255` is non-strict.
  - The header is `DOMAIN ‖ 0x03 ‖ integer_to_bytearray(True, 1, n)`: `prefix03` is tied to the program by `rfl`, and `i2b` is the builtin's own. Then `AllPairs`.
- **output_at_reference_holder → `outputAtReferenceHolder`.** `Script(rh)` (a key credential is False), stake `None`, reference script `None`, and `quantity_of == 1`, which is `valueOf` under `houts`.
- **datum_sane, token_sane → `datumSane`.** `0 < bl`, `0 < fee`, `fee < bl`. ADA branch: name `#""` and quantity 0. Token branch: policy 28 bytes, name `<= 32` bytes, `0 < q <= 2^64 − 1`.
- **one_shot_mint's mint → `launchOk`.**
  - The seed is found by `OutputReference` Data equality over any input (`list.any`).
  - `assets.tokens(self.mint, P)` is the ordered `do_get`, which is `tokensUnder` under `hmint`. There must be exactly one `(name, qty)`.
  - The target is `list.find`'s first output that passes the holder test for the minted name. Its datum must be `InlineDatum` and a typed `ReferenceDatum`.
  - The name must equal `"lovejoin"` by bytes (`lovejoinName`, tied by `rfl` and `= nftName`), and `qty == 1` as an integer. The redeemer is ignored.
  - The compiled code checks the seed and the datum's ranges where the final `and` uses them, not where the source binds them. `launchDatumOk` can't fail, so the iff is unaffected.
- **mix_logic's handlers → `mixLogicAccepts`.**
  - `withdraw` runs for `RewardingScript` and ignores the account. The redeemer cast takes exactly `Owner` (`Constr 0 [List]` of `Constr 0 [B, B]`) or `Mix` (`Constr 1 [List]` of `Constr 0 [List]` of `Constr 0 [B, B, B, B]`), which is `withdrawOk`'s `∃ r, red = r.toData`.
  - `publish` reads only the certificate's tag, so it accepts any `TxCertRegStaking`, with any credential and any deposit field.
  - `else` (minting, spending, voting, proposing) never returns unit (`PurposesKernel`). For one_shot_mint, `mint` runs for `MintingScript P`, and `else` never returns unit.
- **The headline theorems' hypotheses.**
  - mix_logic_accepts_iff has one: `hv`, V1's `validTxOutValue` on every reference input's value. one_shot_mint_accepts_iff has two: `hmint`, V3's `validMintValue`, and `houts`, `validTxOutValue` on every output.
  - Nothing else restricts them. The CEK-level `every_context_iff` and `mint_every_context_iff` have no hypotheses. The typed model covers all six V3 purposes (`ScriptInfo`), all eleven certificates (`TxCert`) and all seven governance actions (`GovernanceAction`). `P`, the seed and `rh` are all quantified.
  - Each rule holds in every transaction the ledger accepts. A V3 output value is ADA first and positive (min-UTxO), then policies and names strictly ascending in byte order. The ledger keeps them in ordered maps, which Aiken's own `dict.get` relies on. Every quantity is positive.
  - A V3 mint has no ADA entry and is ascending and nonzero. Stdlib's own `expect_lovelace_of` doc says there's "never any lovelace in assets from mint".
  - Reference inputs are UTxOs already on chain, so they met the same rules when they were made.
- **The fixed name.** The theorems fix mix_logic's name parameter to `nftName` = `"lovejoin"`. one_shot_mint pins that name, and core applies `mix_logic(P, NFT_NAME)` with `NFT_NAME = b"lovejoin"` (`seedelf-core/src/lovejoin/templates.rs:76, 195`). So CLAIMS.md's "at any pool's parameters" holds for every pool Seedelf derives.
- **The `_valid` forms' caveat.** The model's `isBalanced` (`V3/Contexts.lean:1209`) is `lovelace(spent) = lovelace(produced) + fee` plus the mint, with no deposit, refund, withdrawal or donation term, as Readable.lean and the AnyTx README say.
- **The bytes and parameters.** The templates' unapplied hashes match core's pins (mix_logic `7fb45b75…`, one_shot_mint `6878ed6f…`, mix_box `2365a62d…`). `toTerm x = Const (Data (toData x))` applies a parameter the way `aiken blueprint apply` does.
- **The build.** The lead's log ends `== summary` with all 25 modules `ok`. There's no `sorry`, and the five Readable modules print no warnings.
- **Across #367.**
  - `withdrawOk` never reads `txInfoWdrl`, so withdrawing a non-zero balance changes nothing mix_logic checks, and the headline theorems (not the `_valid` forms) cover those transactions.
  - core's withdraw builder puts the taken balance in the register's output before it proves: it stages, proves on the staged bytes, then stages again with the proofs, and the withdrawal patch only touches the body's withdrawals. So the Owner `ctx` it proves against is the one the script hashes.
  - A Mix's `ctx` binds only the first n outputs, so where a Mix puts the balance doesn't touch its proofs.
- **The chunk-45 read's own notes.** All are in the files as merged: the name, `output_at_script`'s whole test, `find?`'s skip, `xor32`'s lengths, "returns `()` iff", and the `_valid` narrowness.

No repro test was written, and none is in the tree. Every equivalence above is kernel-checked, and fidelity#1's counterexample is read straight off the definitions (`policyEntry` against `valueOf`).
