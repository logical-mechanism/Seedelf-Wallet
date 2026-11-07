# Lovejoin in every transaction

Kernel-checked proofs of exactly when Lovejoin v2's mix_logic and one_shot_mint accept, in every transaction: no Blaster, no step limit, every list any length. What they state is in [`Lovejoin/AnyTx/README.md`](../AnyTx/README.md) (*Complete mix_logic and one_shot_mint behavior*), and what that lets us claim in [CLAIMS.md](../../CLAIMS.md). This page is for changing a proof: read it whole, then `Base.lean` (the tactics) and one finished region (`Carrier.lean`). How it was built, and the owner's calls, are [chunk 45](../../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-45-lovejoin-every-tx.md)'s record.

## Building

- **`./check.sh lovejoin-every`**, from `seedelf-verification/`: the 51 modules the proofs import from outside this folder, in import order, then the 25 here, each in its own scope at 16 GB and 30 minutes. One scope building several modules at once can pass 16 GB, which is why the imports are listed too. One of them, `Lovejoin.Template.AnyTxPurposes`, runs Blaster, so Z3 must be on `PATH` ([the README](../../README.md)'s *Running it*).
- **One module:** `./check.sh Lovejoin.Every.<M> …` gets the same 16 GB and 30 minutes. Build what it imports first, as the family does, or its scope builds that too. The default 8 GB kills six of the 25: Carrier, Collect (12.8 GB, the most), Walk, Withdraw, MintCheck and MintRoot.
- **Iterating on one file:** run `lake env lean <file>` inside the same capped `systemd-run` scope `check.sh` uses, and read the scope's `memory.peak`. Its imports must be built first.
- **A clean build** has no `sorry`, and the axiom guards (`#guard_msgs in #print axioms`, in `Lookup`, `Carrier`, `Typed`, `MintTyped` and `Readable`) see `[propext, Classical.choice, Quot.sound]` alone. The `CekMachine.lean:309: declaration uses 'sorry'` warning is PlutusCoreBlaster's own, and nothing here depends on it.

## The method

1. **The spec is the compiled code, read back.** Decode the template and print it as pseudo-code with Lean subterm paths (*The tools*). Write each region as a Lean function over raw `Data`, where `none` is the script's error. Mirror the compiled order:
   - strict lets stay strict;
   - `if`s nest as compiled;
   - Option binds run in evaluation order.
2. **One theorem per region:** `Ev default <subterm> ρ ((spec …).map toCekValue)`, which gives both directions. `ρ` is abstract, with one hypothesis per slot the region reads (`List.get?Internal ρ k = some v`). A closure it calls is given by its behaviour, e.g. `(hv73 : ∀ l, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map …))`. Loops are by induction on the list. The closure env of a self-applied loop is `.VCon list :: .VLam loop ρ :: ρ`.
3. **Compose with `ev_go [lemmas] [facts]`** (`Base.lean`). It applies a lemma where one fits, closes slot goals by `cek_rfl` or `safe_assumption`, and rewrites a symbolic condition by the fact the proof cased on: `simp only`, then `rw` with each fact (`rw` also reaches conditions inside `instDecidableEqBool`, where `simp` doesn't look). `bsimp` (`MixPred.lean`) reduces a spec's binds after each split; without it `cases` can't reach a term under a bind's binder. `rsimp h` (`Mix.lean`) takes `refFields` apart.
4. **Proof pattern per region:**
   - `rcases` the data in compiled evaluation order, then `all_goals try (ev_go [...] []; done)` to close the error branches;
   - `simp only [spec, List.getElem?_cons_succ, List.getElem?_cons_zero]` once the shape is known;
   - `cases h : <condition>` for each symbolic Bool, `Except` or `Option`, then `ev_go [...] [h, …]`.
5. **The source's terms are pure Lean** about the spec functions, with no CEK step (`Readable*.lean`): each Aiken function restated over the ledger's typed `TxInfo`, and proved equal to the raw function on `IsData.toData` of the typed value. The ledger's own guarantees (sorted values, unique references) are hypotheses where they're used; the crypto stays opaque.

## Pitfalls already paid for

Don't relearn them.

**In the CEK regions:**
- **Case-split in evaluation order.** Example: a box `Constr _ [a]` evaluates `unBData a` before it finds field 1 missing. With `a` symbolic that branch can't close, and the leftover goal hijacks every following `rcases`. Split field 0, then its kind, then field 1. (`owner_pred` cost an hour on this.)
- **Never let `lessThanInteger v q` reach whnf** with `v` symbolic and `q` the 255-bit field order: deciding it unfolds `Nat.sub` from `q` one unit at a time, until maximum recursion. Use `ap_lessThan _ _ _ h` (`Shared.lean`). It evaluates the builtin straight to the cased Bool.
- **No `let` in a spec around a cased term.** `scalarOf`'s `let v` hid `lessThanInteger v q` from `cases`, so unification evaluated it.
- **`safe_assumption` only closes slot equations with slot hypotheses.** Plain `assumption` once unified a builtin's `evaluateBuiltinFunction … = r` goal with a fact like `v < q = false`, which recursed.
- **Instantiate a lemma's data arguments before `ev_go` when they can't come from the goal.** In tail position the goal's result is a continuation metavariable, so the data arguments go undetermined, and their slot goals then fail ("unknown free variable", or simply stuck). Use `have hob := fun ρ σ78 => owner_branch ρ σ78 rd info red boxes`, or `have hp := owner_pred_all (<explicit env>) ctx …`.
- **A recursive call in tail position** needs `values_nil_any` in the lemma list (`ValuesK [] r r` for a symbolic `r`).
- **A walk in tail position must return its result in the goal's own form:** `proofs_walk` rewrites `if a && b` into nested `if`s (`ite_and`) instead of splitting on `a`.
- **The builtin's own forms:** `listData xs` is `PlutusCore.Data.listData xs`, so add `listData_eq` to the facts. `serialiseData` goes through `encodeDataOpaque`, so case on that.
- **Constants come from the program** (`prefix01` by `match sub prefixAt with …`, with an `rfl` shape theorem). `q` is `Lovejoin.Classic.q` and unifies with the program's literal. A program constant such as `Constr 1 []` or `integerToByteString(True, 1, n)` holds `Int.ofNat 1`, which `rw` won't match against a spec's `1`: write `Int.ofNat 1` in the spec. A bytestring constant a fact must rewrite (`zero32`, `prefix03`) is a reducible `abbrev` of the literal, with an `rfl` shape theorem against the program.
- **Paths:** never type one by hand. Generate them with `tools/lpath.py` from the tool's printed strings. `rcases` bracket counts were wrong twice: count one `⟩` per `⟨`.
- `#import_uplc` names are global (`mixLogicTemplate`, not `Lovejoin.Template.mixLogicTemplate`). `nftName` is in `Lovejoin.Template.Launch`.

**In the launch (`Mint*.lean`):**
- `pseudo.py` prints a `!` or `delay` line with its *child's* path, so a region lemma's term is that path minus one digit (`PATH(n, -1)`) for a force, and the printed path itself for a delay's body.
- Integer constants in the program are plain numerals; only integers inside a `Data` literal are `Int.ofNat`.
- `cases h : c` can't reach `c` inside an unreduced `match` alternative (its variables are the pattern's): `dsimp only` first.
- `ite_true` needs the `instDecidableTrue` instance; `if_pos trivial` takes any.
- A macro naming the proof's own hypotheses needs `set_option hygiene false in`.
- A theorem whose leaves each re-evaluate a long prefix runs out of memory: cut a region lemma where the prefix ends, and one module per heavy lemma.

**In the source's terms (`Readable*.lean`):**
- `omega` and `simp`'s arithmetic don't see through `Integer`'s instances: state a bound as `Int` with `show`, or close by `Int.not_lt`.
- `cases h : e` can't replace `e` under an unreduced match or a binder: `dsimp only` first, or collapse the binder.
- `simp [h] at h'` misses when simp normalizes `h'` first: `rw`.

## The tools

In `tools/`. They print views and paths, and decide nothing a theorem relies on: Lean refuses a wrong path.

```bash
# from seedelf-verification/; any scratch path works for the decoded file
aiken uplc decode --hex --cbor Lovejoin/Template/Scripts/mix_logic.hex > /tmp/ml.uplc
python3 -I Lovejoin/Every/tools/pseudo.py /tmp/ml.uplc '[]' 'i_0=POLICY,i_1=NAME,i_2=CTX,i_3=chooseData,i_4=tailList,i_5=headList,i_6=mkCons,i_7=chooseList,i_8=sndPair,i_9=fstPair,i_10=ifThenElse,i_11=policyB,i_12=nameB' > /tmp/pseudo.txt
python3 -I Lovejoin/Every/tools/scope.py /tmp/ml.uplc @<path digits>   # scope (slot → binder) and the free slots of that subterm
python3 -I -c "import sys; sys.path.insert(0,'Lovejoin/Every/tools'); from lpath import lean; print(lean('<digits>'))"
```

- `pseudo.py` prints lets, ifs and calls. Each `@digits` is the Lean `subterm` path of the term after it, with `(n)` for n ≥ 10. A `λ x y -> @p` line gives the path of the body after the lambdas. Binders keep aiken's names (`i_N` = level N).
- `pp.py <pseudo> <base> <lines…>` prints pseudo lines' paths relative to a prefix, as Lean lists.
- `fillpaths.py <pseudo> <template> <out>` replaces `PATH(line)`, `PATH(line, +digits)` and `PATH(line, -k)` in a template with Lean lists. The Mint modules were written that way; their templates aren't kept, since the `.lean` files are the source now.
- `uplc_tree.py` parses the decoded text, which the others read through it, and `freevars.py` prints a subterm's free variables.
- one_shot_mint is decoded the same way, from `Lovejoin/Template/Scripts/one_shot_mint.hex`.
- Prefixes the modules' paths use: `B = 000100000000000000000001000000010100001` (i_30's delay; `mainBody = sub (B ++ [0])`) and `M = B ++ 0100000000000` (the main body after its first lets).

## The modules

| Module | Theorem | What it says |
|---|---|---|
| Lookup | `policy_search`, `name_search` | `quantity_of`'s two ordered searches (`policyEntry`, `nameEntry`), any map |
| Carrier | `nth1_ap`, `nth2_ap`, `nth5_ap` | i_73, i_72, i_74: `l[k]?` |
| Carrier | `carrier_cond`, `carrier_filter` | `holdsNft` for any input `Data`; `carriers` for any list |
| Carrier | `carrier_datum`, `reference_datum` | i_81: `referenceDatum P N info`: exactly one carrier, its inline datum `Constr 0 [I,B,B,I,I,B,B,B]` |
| Collect | `isBytes_ap`, `box_pred`, `collect_loop`, `boxes_of` | i_105: `boxesOf rd info` = `collect msh ins` (payment credential `Script msh`, inline well-formed `MixDatum`) |
| Shared | `len_loop` | i_77: `countOf` |
| Shared | `pairs_loop`, `pairs_apply` | i_78 with any predicate given by its behaviour: `pairsAll` |
| Shared | `scalar_ap`, `scalarMod_ap` | i_106 `scalarOf`, i_80 `scalarMod` |
| Shared | `ap_lessThan`, `ap_lessThanEquals` | the cased-comparison steps |
| Owner | `refs_loop`, `owner_hash` | i_115 `inputRefs`; the transaction hash `ownerHash rd info` |
| Owner | `owner_pred`, `owner_pred_all` | each box's Schnorr check `ownerPred ctx box proof`; any bad encoding or scalar is an error |
| Owner | `owner_branch` | the Owner branch region (`sub (M ++ 10000010)`) = `ownerResult rd info red boxes` |
| Main | `len_ap` | i_107 |
| Main | `main_owner` | **from the main body's entry (`env29 …`) with `red = Constr 0 fs`: `ownerMain P info red`** (reference datum, then boxes, then Owner), any `info : Data` |
| Fold | `fold_loop`, `fold_apply`, `cat_ev`, `xor_ev` | i_131 `foldOpt` with a step given by behaviour; the statements'/branches' step `catStep` (f1 and f2 are the same term, `catBody'_eq`) and the challenges' `xorStep` |
| Value | `merge_loop`, `insert_loop`, `box_value` | i_200 `mergeName`, i_193 `insertPolicy`, i_134 `boxValue bl pol nm tq` (ADA part, then the token unless the policy is empty or the quantity 0) |
| Walk | `atScript_shape`, `at_script` | i_133 `atScript msh out`; an output at the script has four fields |
| Walk | `walk_loop`, `walk_entry` | i_173 `walk` (box outs: `prefixOut`, the strict `stmtDatum` decode, points recompressed; the rest not at the script), i_135 `walkFrom msh val info n` |
| MixPred | `nth3_ap`, `pair_cond`, `par_loop` | i_130; one branch's two Σ-protocol equations `branchOk A B st br`; i_153 = `pairsAll (branchOk A B)` |
| MixPred | `mix_pred` | the predicate `mixPred pre ctx sts box proof`: ≥ 2 statements, the Fiat-Shamir hash vs the xor of challenges, the points, every branch (`zero32_shape`) |
| Mix | `rev_loop`, `apleft_i2b`, `mix_branch` | i_165 `reverseAux`; `integerToByteString` kept as the builtin's own result (`i2b`); the Mix branch region (`sub mixAt`) = `mixResult rd info red boxes` (`prefix03_shape`) |
| Mix | `referenceDatum_shape`, `main_mix` | **from the main body's entry with `red = Constr tr fs`, `tr ≠ 0`: `mixMain P info red`**, any `info : Data` |
| Withdraw | `owner_walk`, `branches_walk`, `proofs_walk` | the redeemer's shape walks through the fixpoint combinator i_28 (`comboX`): `allOwnerProofs` (each `Constr 0 [B, B]`), `allMixProofs` (each `Constr 0 [List branches]`, each branch `Constr 0 [B, B, B, B]`) |
| Withdraw | `withdraw_root` | **the whole program** applied to `P`, `nftName` and `purposeCtx 2 info red [cred]`, for any `info red cred : Data`: `unitIf (withdrawResult P info red)` (tag 0 Owner, tag 1 Mix, else an error) |
| Typed | `withdraw_iff`, `every_context_iff` | **mix_logic for every typed V3 `ScriptContext`:** `()` exactly when `logicPasses P ctx` (a withdrawal by `withdrawResult`, a certificate by `isRegistrationData`, nothing else), with `#guard_msgs` on its axioms |
| Mint | `tokens_loop`/`tokens_apply`, `qty_loop`, `seed_loop`, `out_cond`, `out_loop`, `findOut_shape`, `mnth*_ap` | one_shot_mint's loops: the policy search `tokensOf`, the name search `qtyOf`, the seed search `seedIn`, the output search `findOut` (`outCond`: script `rh`, no stake part, no reference script, exactly one of `(P, nm)`) |
| MintSpec | `launchResult`, `launchCheck`, `launchConds`, `launchDatumOk`, `outDatum`, `lovejoinName_eq` | the launch's spec; the found output's datum decodes by Carrier's `refFields` |
| MintConds, MintCheck | `conds_region`, `launch_check` | the regions after the datum decodes and after the output is found (split so no module passes 16 GB) |
| MintRoot | `launch_root` | **the whole one_shot_mint program** on `purposeCtx 0 info red [B P]`, any `info red : Data`: `unitIf (launchResult …)` |
| MintTyped | `launch_iff`, `mint_every_context_iff` | **one_shot_mint for every typed V3 `ScriptContext`:** `()` exactly when `mintPasses` (a mint by `launchResult`, nothing else), axioms guarded |
| ReadableBase | `inputs_data`, `outputs_data`, `countOf_eq`, `AllPairs`, `pairsAll_map`, `valid_value_shape`, `valid_mint_shape`, `policy_search`, `name_search` | typed lists as `IsData` encodes them; `pairs_match_and_all` as `AllPairs`; on a value or mint the ledger accepts, the ordered searches are `tokensUnder` and `valueOf` |
| ReadableOwner | `referenceDatum_typed`, `boxesOf_typed`, `ownerPred_typed`, `ownerResult_typed` | `read_reference_datum` (`readReferenceDatum`, a `RefDatum`), `collect_well_formed_mix_inputs`, each Owner proof as `Lovejoin.Classic.schnorrVerifies` (`prefix01_eq`), `validate_owner` (`validateOwner`) |
| ReadableMix | `boxValue_typed`, `walk_typed`, `walkOutputs_eq`, `branchOk_typed`, `mixPred_typed`, `mixResult_typed` | `box_value`, `output_at_script`, `walk_outputs` (and read whole: take/drop), `verify_pre` with `xor32`, `validate_mix` (`validateMix`) |
| ReadableLaunch | `outCond_typed`, `findOut_typed`, `seedIn_typed`, `launchDatumOk_typed`, `launchResult_typed` | `output_at_reference_holder`, the seed's `list.any`, `datum_sane` and `token_sane`, one_shot_mint's `mint` (`launchOk`) |
| Readable | `withdrawResult_typed`, `mix_logic_accepts_iff(_valid)`, `one_shot_mint_accepts_iff(_valid)` | **both scripts for every typed V3 context, in the source's terms:** `mixLogicAccepts` (`withdrawOk`: the redeemer `Owner` or `Mix`, then `validateOwner` or `validateMix`; a `RegisterCredential`; nothing else) and `oneShotMintAccepts` (`launchOk`; nothing else), under the ledger's value rules, axioms guarded. The `_valid` forms, under the model's whole `validScriptContext`, are narrower: its `isBalanced` ignores deposits and withdrawals, so they miss every real publish and every non-zero withdrawal. Cite the others |
