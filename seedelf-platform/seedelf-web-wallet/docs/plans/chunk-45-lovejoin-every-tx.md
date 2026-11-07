# Chunk 45 · Lovejoin in every transaction

**Done** (2026-11-07): mix_logic and one_shot_mint in every transaction, kernel-checked, stated in the Aiken source's terms. The claim is in `seedelf-verification/CLAIMS.md` (the owner's call), and the chunk lands as one PR to main. To change a proof, read this whole file first, then `seedelf-verification/Lovejoin/Every/Base.lean` (the tactics) and one finished region (`Carrier.lean`).

## Where things are

- **Worktree** `../Seedelf-Wallet-chunk45`, beside the main checkout, branch `web-wallet/lovejoin-every-tx`, cut from `origin/main` `9103df62` (#367 merged). The main checkout is the owner's; don't switch its branch.
- **Nothing is committed or pushed.** New files: `seedelf-verification/Lovejoin/Every/*.lean` (25 modules: 20 CEK, 5 `Readable*`), `Lovejoin/Every/tools/*.py`, this file. Changed: `check.sh` (the `lovejoin-every` family), `seedelf-verification/README.md`, `Lovejoin/AnyTx/README.md`, chunk 42's plan (its step 10). Ask the owner before committing.
- **Last full run (2026-11-07):** `./check.sh lovejoin-every` from an empty build, 20 `ok`, about 11 minutes, no `sorry`; the heaviest module Collect at 12.8 GB. Then the five `Readable*` modules, built on it: seconds each, under 400 MB, no warnings. After the review's wording fixes, the family again: 25 `ok`, with Typed, MintTyped and the Mint modules rebuilt (MintCheck peaks at 8.4 GB).
- **Path tools:** `tools/pp.py <pseudo> <base> <lines…>` prints pseudo lines' paths relative to a prefix. `tools/fillpaths.py <pseudo> <template> <out>` replaces `PATH(line)`, `PATH(line, +digits)` and `PATH(line, -k)` in a template with Lean lists; the Mint modules were written that way (their templates aren't kept: the `.lean` files are the source now).
- **`.lake` was copied** from the main checkout, so nothing rebuilds the dependencies.
- **Build:** from `seedelf-verification/` in the worktree, `CAP=16G LIMIT=30m ./check.sh Lovejoin.Every.<M> …` one module at a time (the owner's limits, 2026-11-06). The default 8 GB cap kills them: Carrier peaks at 8.4 GB, Collect 12.8 GB, Walk 8.6 GB, MixPred 6.7 GB; one scope building several modules in parallel passes 16 GB.
- **Iterating on one file:** run `lake env lean <file>` inside the same capped `systemd-run` scope `check.sh` uses, and read the scope's `memory.peak`. Its imports must be built first. The whole chain builds clean: no `sorry`, axioms `[propext, Classical.choice, Quot.sound]`. The upstream `CekMachine.lean:309: declaration uses 'sorry'` warning is PlutusCoreBlaster's own and nothing here depends on it.

## The goal and the owner's words

The owner, 2026-11-06, after 1.8.0 shipped (old pools empty, the 5 ₳ v2 pool live):
- "what we need is that market push where we can say our contracts are formally verified."
- "I want you to finish lovejoin. The old is out the new is in and we need that final push to make it formally verified and not just pretty much is status it currently is in."

The bar (memory `formal-verification-bar`): every action's rule, both directions, in every transaction. The scope is variant 1's Seedelf scripts (done, PR #362) and Lovejoin v2's contracts, with fee_contract out (unused). Before this chunk, `Lovejoin/AnyTx/README.md` had these kernel-checked for every V3 context:
- mix_box;
- reference_holder;
- every unsupported purpose;
- mix_logic's publish.

That left two:
- **mix_logic's withdrawal** (Owner and Mix) was still scenario families.
- **one_shot_mint's launch** was still open.

The classifier stopped this work three times on 2026-11-05. This session it stopped nothing (one transient "no verdict" error, retried fine).

## The method (kernel-checked, no Blaster, no step limit, every list any length)

1. **The spec is the compiled code, read back.** Decode the template and print it as pseudo-code with Lean subterm paths (tools below). Write each region as a Lean function over raw `Data`, where `none` is the script's error. Mirror the compiled order:
   - strict lets stay strict;
   - `if`s nest as compiled;
   - Option binds run in evaluation order.
2. **One theorem per region:** `Ev default <subterm> ρ ((spec …).map toCekValue)`, which gives both directions. `ρ` is abstract, with one hypothesis per slot the region reads (`List.get?Internal ρ k = some v`). A closure it calls is given by its behaviour, e.g. `(hv73 : ∀ l, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map …))`. Loops are by induction on the list. The closure env of a self-applied loop is `.VCon list :: .VLam loop ρ :: ρ`.
3. **Compose with `ev_go [lemmas] [facts]`** (Base.lean). It applies a lemma where one fits, closes slot goals by `cek_rfl` or `safe_assumption`, and rewrites a symbolic condition by the fact the proof cased on: `simp only`, then `rw` with each fact (`rw` also reaches conditions inside `instDecidableEqBool`, where `simp` doesn't look).
4. **Proof pattern per region:**
   - `rcases` the data in compiled evaluation order, then `all_goals try (ev_go [...] []; done)` to close the error branches;
   - `simp only [spec, List.getElem?_cons_succ, List.getElem?_cons_zero]` once the shape is known;
   - `cases h : <condition>` for each symbolic Bool, `Except` or `Option`, then `ev_go [...] [h, …]`.

### Pitfalls already paid for (don't relearn them)

- **Case-split in evaluation order.** Example: a box `Constr _ [a]` evaluates `unBData a` before it finds field 1 missing. With `a` symbolic that branch can't close, and the leftover goal hijacks every following `rcases`. Split field 0, then its kind, then field 1. (`owner_pred` cost an hour on this.)
- **Never let `lessThanInteger v q` reach whnf** with `v` symbolic and `q` the 255-bit field order: deciding it unfolds `Nat.sub` from `q` one unit at a time, until maximum recursion. Use `ap_lessThan _ _ _ h` (Shared.lean). It evaluates the builtin straight to the cased Bool.
- **No `let` in a spec around a cased term.** `scalarOf`'s `let v` hid `lessThanInteger v q` from `cases`, so unification evaluated it.
- **`safe_assumption` only closes slot equations with slot hypotheses.** Plain `assumption` once unified a builtin's `evaluateBuiltinFunction … = r` goal with a fact like `v < q = false`, which recursed.
- **Instantiate a lemma's data arguments before `ev_go` when they can't come from the goal.** In tail position the goal's result is a continuation metavariable, so the data arguments go undetermined, and their slot goals then fail ("unknown free variable", or simply stuck). Use `have hob := fun ρ σ78 => owner_branch ρ σ78 rd info red boxes`, or `have hp := owner_pred_all (<explicit env>) ctx …`.
- **A recursive call in tail position** needs `values_nil_any` in the lemma list (`ValuesK [] r r` for a symbolic `r`).
- **The builtin's own forms:** `listData xs` is `PlutusCore.Data.listData xs`, so add `listData_eq` to the facts. `serialiseData` goes through `encodeDataOpaque`, so case on that.
- **Constants come from the program** (`prefix01` by `match sub prefixAt with …`, with an `rfl` shape theorem). `q` is `Lovejoin.Classic.q` and unifies with the program's literal.
- **Paths:** never type one by hand. Generate them with `tools/lpath.py` from the tool's printed strings. `rcases` bracket counts were wrong twice: count one `⟩` per `⟨`.
- `#import_uplc` names are global (`mixLogicTemplate`, not `Lovejoin.Template.mixLogicTemplate`). `nftName` is in `Lovejoin.Template.Launch`.

### The tools (`seedelf-verification/Lovejoin/Every/tools/`)

```bash
# from seedelf-verification/ in the worktree; any scratch path works for the decoded file
aiken uplc decode --hex --cbor Lovejoin/Template/Scripts/mix_logic.hex > /tmp/ml.uplc
python3 -I Lovejoin/Every/tools/pseudo.py /tmp/ml.uplc '[]' 'i_0=POLICY,i_1=NAME,i_2=CTX,i_3=chooseData,i_4=tailList,i_5=headList,i_6=mkCons,i_7=chooseList,i_8=sndPair,i_9=fstPair,i_10=ifThenElse,i_11=policyB,i_12=nameB' > /tmp/pseudo.txt
python3 -I Lovejoin/Every/tools/scope.py /tmp/ml.uplc @<path digits>   # scope (slot → binder) and the free slots of that subterm
python3 -I -c "import sys; sys.path.insert(0,'Lovejoin/Every/tools'); from lpath import lean; print(lean('<digits>'))"
```

- `pseudo.py` prints lets, ifs and calls. Each `@digits` is the Lean `subterm` path of the term after it, with `(n)` for n ≥ 10. A `λ x y -> @p` line gives the path of the body after the lambdas.
- Binders keep aiken's names (`i_N` = level N).
- Prefixes used below: `B = 000100000000000000000001000000010100001` (i_30's delay; `mainBody = sub (B ++ [0])`) and `M = B ++ 0100000000000` (the main body after its first lets).

## What's proved (all in `Lovejoin/Every/`)

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

So both scripts that lacked it are proved in every transaction: mix_logic (every purpose, both withdrawals, the redeemer's checks, the root) and one_shot_mint (the launch, every other purpose), first over raw `Data`, then in the Aiken source's terms. With mix_box and reference_holder from before, that is all of Lovejoin v2 in scope (fee_contract out). What's left is landing it.

**Launch pitfalls paid for:** pseudo.py prints a `!` or `delay` line with its *child's* path, so a region lemma's term is that path minus one digit (`PATH(n, -1)`) for a force, and the printed path itself for a delay's body. Integer constants in the program are plain numerals; only integers inside a `Data` literal are `Int.ofNat`. `cases h : c` can't reach `c` inside an unreduced `match` alternative (its variables are the pattern's): `dsimp only` first. `ite_true` needs the `instDecidableTrue` instance; `if_pos trivial` takes any. A macro naming the proof's own hypotheses needs `set_option hygiene false in`. A theorem whose leaves each re-evaluate a long prefix runs out of memory: cut a region lemma where the prefix ends, and one module per heavy lemma.

**Tactics added this session:** `bsimp` (MixPred) reduces a spec's binds after each split; without it `cases` can't reach a term under a bind's binder. `rsimp h` (Mix) takes `refFields` apart. **Two more pitfalls:** a program constant such as `Constr 1 []` or `integerToByteString(True, 1, n)` holds `Int.ofNat 1`, which `rw` won't match against a spec's `1`: write `Int.ofNat 1` in the spec. A bytestring constant a fact must rewrite (`zero32`, `prefix03`) is a reducible `abbrev` of the literal, with an `rfl` shape theorem against the program.

## What's left, in order

### 1. The Mix branch: DONE (see the table; the notes below were the map)

Already read from the bytes (regenerate `pseudo.txt`, Mix starts at `let i_128`). ρZ slots: 0 i_107, 1 i_106, 2 i_105 (boxes), 3 i_81 (rd), 4 i_80, 6 i_78, 10 i_74, 11 i_73, 12 i_72, 17 i_20 (red), 18 i_19 (info), then the builtins.

- **Lets:**
  - i_128: the proofs, `unListData(head(fields red))`.
  - i_129: `λ name qty. [(B name, I qty)]`.
  - i_130: nth3.
  - i_131: `foldl(list, init, f)`, its loop i_124 calling `f(head, acc)` (`APPLY i_124 (i_124, list, init)`).
  - i_132: `n = i_107(boxes)`.
  - i_133: `output_at_script(out, msh)`: the payment credential `head(fields(head(fields out)))` has tag 1 and its hash is msh, then `equalsData(Constr 1 [], nth1(fields address))` (no stake part), then `equalsData(Constr 1 [], nth3(fields out))` (no reference script). Anything else is False.
- **Checks:** `lessThanEqualsInteger(2, n)`, then `equalsInteger(len proofs, n)`; otherwise an error.
- **i_134, the box value:**
  - i_188 is `[]` if `bl == 0`, else `[(B "", Map(i_129("", bl)))]`, with `bl = unI(head(fields rd))`.
  - If `equalsByteString("", unB(nth1 rd))`, the value is i_188.
  - Otherwise take `pol = unB(nth1)`, `nm = unB(nth2)`, `tq = unI(nth3)` of rd's fields. If `tq == 0` it's i_188. Otherwise it's the ordered insert loop i_193 over i_188: compare `lessThanEqualsByteString(pol, key)`, and on an equal key do the inner merge i_200 (drop the entry when the sum is zero, then a `Map []` check). Paths are in pseudo lines ~545–600.
  - Mirror it exactly. Say what it equals for `pol ≠ ""` in the typed step, not here.
- **i_135, `walk_outputs`:** `CALL (λ i_169 msh i_170 bvBytes. CALL (λ i_171 i_172. APPLY i_171 (i_171, i_172, n, [], "", "")) walkClosure outputs) (unB(nth5(fields rd))) (serialiseData(mapData i_134))`, with outputs `unListData(nth2(fields info))`. The walk is `λ self outs k stmts datums values`:
  - **Empty list:** `k == 0` (i_18) → `[listData stmts, bData datums, bData values]`, else ERROR.
  - **Prefix step** (`lessThanInteger(0, k)`, case it): i_133(out) holds, `equalsData(nth1(fields out), mapData boxValue)`, the datum `nth2(fields out)` has tag 2, and `x = head(fields datum)`. Then the strict decode of x:
    - tag 0;
    - at least 2 fields, with `unB(field1)` evaluated **before** `unB(field0)`;
    - exactly 2;
    - `len a == 48`, `len b == 48`, `a ≠ b`;
    - anything else is ERROR. It returns x.
    - Then recurse with `k − 1` (`addInteger(-1, k)`), consing `Constr 0 [f0, f1, B(compress(uncompress a)), B(compress(uncompress b))]` and appending `serialiseData x` and bvBytes.
  - **Tail step** (`0 < k` false): `!(i_133 out)` → recurse with 0, else ERROR.
- **ctx and statements:** i_136 = `tail i_135`. Then `CALL (λ i_137 ctx i_138 stmts. …) (blake2b_256(unB(head i_136) ‖ unB(head(tail i_136)) ‖ msh)) (reverse i_165 of unListData(head i_135))`.
  - Body: `lessThanEqualsInteger(n, 255)`, then `i_139 = PREFIX03 ‖ integerToByteString(True, 1, n)`, then `APPLY i_78 (boxes, proofs, mixPred)`; else ERROR.
  - PREFIX03 path: `000100000000000000000001000000010100001010000000000010000020100000000010001000000000000010101`.
  - `integerToByteString` on a symbolic n: keep it as the builtin's own term (`tryCatchSome …`) and case on its result; it never needs evaluating.
- **mixPred** `(box, proof)`: `CALL (λ a b. body) (unB(head(fields box))) (unB(nth1(fields box)))`. The body is `chooseList(tailList stmts, delay ERROR, delay(…))`, so at least two statements:
  - `if equalsByteString(blake2b_256(foldl(branches, foldl(stmts, i_139 ‖ a ‖ b, f1), f2) ‖ ctx), foldl(branches, zero32, fx))`, with branches `unListData(head(fields proof))`;
  - then `CALL (λ A B. parallel_all i_153 (stmts, branches)) (uncompress a) (uncompress b)`;
  - else ERROR.
  - `f1(s, acc) = acc ‖ unB(s.f0) ‖ unB(s.f1)` and `f2(br, acc) = acc ‖ unB(br.f0) ‖ unB(br.f1)`.
  - `fx(br, acc)`: `c = unB(nth2(fields br))` first, then `eq32(len acc)`, then `eq32(len c)`, then `xorByteString(False, acc, c)`; else ERROR. This is xor32's fix; the xor is the fork's opaque alias.
  - zero32 path: `00010000000000000000000100000001010000101000000000001000002010000000001000100000000000001000020000000020000101`.
- **parallel_all i_153** `(self, stmts, branches)`: the same list-pair shape as i_63 (pairs). Per pair:
  - `z = i_106(unB(nth3(fields br)))` and `c = i_80(unB(nth2(fields br)))`;
  - then `G1_equal(scalarMul(z, A), add(uncompress(unB(br.f0)), scalarMul(c, uncompress(unB(nth2(fields stmt))))))` `&&` the same with B, `br.f1` and `nth3(fields stmt)`;
  - a statement's fields are `[ap, bp, ap_pt, bp_pt]`.
- **Plan:** a generic `foldl` lemma, with `f` given by behaviour `∀ x acc, Ev fBody (acc :: x :: σf) (F x acc)`, used for f1, f2 and fx. Then `walk_loop`, `reverse_loop`, `box_value`, `mix_pred`, `parallel_loop` (as `pairs_loop`), then `mix_branch`. Then `main_mix` beside `main_owner` (red = `Constr 1 fs`), and one `main_body` theorem for any red.

### 2. The plumbing above the main body: DONE (`Withdraw.lean`, `Typed.lean`)

A walk in tail position must return its result in the goal's own form: `proofs_walk` rewrites `if a && b` into nested `if`s (`ite_and`) instead of splitting on `a`.

- **The root:**
  - `λ P N CTX`, then LET10 (the forced builtins, `unBData P`, `unBData N`; theorems use `toTerm P`, `toTerm nftName`), then `force(ite(MAIN, delay unit, delay ERROR))`.
  - CTX fields: i_13 = fields, i_14 = tail, i_15 = si (`head(tail i_14)`), i_16 = tag si, i_19 = info, i_20 = red.
- **Dispatch on `tag si`:**
  - **2 (withdraw):** i_26 = `head(fields si)` (strict), i_27 = eq1, i_28 = the foldr-with-continuation combinator, i_29 = `tag red` (red must be a `Constr`), `i_30 = delay mainBody`. Then:
    - **tag 0, the Owner check:** `fields red` has exactly one field. Step over the proof list: an empty list forces i_30. Otherwise each proof has tag 0 (else ERROR), at least 2 fields, `unB(f1)` then `unB(f0)` evaluated, exactly 2, and the step continues on the tail.
    - **tag 1, the Mix check:** exactly one field. Each proof has tag 0 and exactly 1 field, a list of branches. Each branch has tag 0, at least 4 fields, unB of f3 then f0, f1, f2, exactly 4.
    - **any other tag:** ERROR.
  - **3 (publish):** `unI(head(fields si))` strict, then `tag(head(tail(fields si))) == 0`. The owner's `LogicPublishKernel.publish_iff_registration` covers it.
  - **anything else:** ERROR (`PurposesKernel`).
- **env29's free slots** are then c0 = i_29, c1 = i_28, c3 = i_26, c8..c11 = i_16, i_15, i_14, i_13, rest = `[CTX, N, P]`. `main_owner` is generic in them.

### 3. The typed statement: DONE (`Typed.lean`, `MintTyped.lean`, `Readable*.lean`)

- **The raw half:** `every_context_iff` (mix_logic, `Typed.lean`) and `mint_every_context_iff` (one_shot_mint, `MintTyped.lean`), both iffs over every typed `ScriptContext`. Their conditions are the raw specs: `withdrawResult` and `launchResult`, functions over `Data`.
- **The readable half** (2026-11-07, the table above): `Readable.mix_logic_accepts_iff` and `one_shot_mint_accepts_iff`, built in this order. An independent read of the definitions against the Aiken source (29573c5's, byte-identical to `lovejoin-v2` 5cc3631 but for `sigma_or.ak`'s test formatting) found every handler accepting exactly what the source does. Its notes were all wording, fixed: the name parameter is `lovejoin`; "at the script" means `output_at_script`'s whole test; `find?` skips a holder output that fails the test; `xor32`'s lengths; the theorems say "returns `()` iff", not "errors otherwise"; and the `_valid` forms' narrowness, above. Pure Lean about the spec functions, no CEK step. One thing the restatement shows that the source hides: the compiled code stores a Mix statement's points compressed, so `branchHolds` reads them back as `uncompress(compress(·))`. **Pitfalls paid for:** `omega` and `simp`'s arithmetic don't see through `Integer`'s instances (state a bound as `Int` with `show`, or close by `Int.not_lt`); `cases h : e` can't replace `e` under an unreduced match or a binder (`dsimp only` first, or collapse the binder); `simp [h] at h'` misses when simp normalizes `h'` first (`rw`).
- **The plan it followed:** readable statements a reviewer can hold against the Aiken source, each proved to imply and be implied by the raw spec on `IsData.toData` contexts. Don't touch the CEK proofs: this is pure Lean about the spec functions, so it's cheap to build. Put it in new modules (`Readable*.lean`), and add them to `lovejoin-every`. In order of what a reader most needs:
  1. **The Owner:** `withdrawResult` at tag 0 holds iff there is at least one box, there are as many proofs as boxes, and each proof `[t, z]` passes Classic's `schnorrVerifies` for its box `(a, b)` against `ctx` (`ownerPred` once the program's `prefix01` is fsHash's constant).
  2. **The boxes and the reference datum, typed:**
     - the boxes are the inputs paid to `ScriptCredential msh` with an inline `MixDatum` of two different 48-byte points;
     - the reference datum is the one reference input holding exactly one `(P, nftName)`.
     - Reuse the owner's `LogicSortedValue` and `LogicValueOf`: on a sorted value, the ordered searches (`policyEntry`, `nameEntry`) are `valueOf`.
  3. **The box value:** `boxValue` is `[("", [("", bl)]), (pol, [(nm, tq)])]` for `pol ≠ ""` and `tq ≠ 0` (an ADA-only box when `pol = ""` or `tq = 0`, and no ADA entry when `bl = 0`). `insertPolicy` on a one-entry list with `pol ≠ ""` is a two-case lemma.
  4. **The Mix:**
     - the first `n` outputs pay exactly the box value to `msh` with no stake part and no reference script, each with an inline `MixDatum`, and the rest aren't at `msh`;
     - `ctx = blake2b_256(datums ‖ values ‖ msh)`;
     - each box's predicate is the Fiat-Shamir check and every branch's two equations.
     - State the statements as the outputs' points recompressed (`compress (uncompress a)`), as the program has it: no crypto fact is assumed.
  5. **The launch:** `launchResult` holds iff the mint under `P` is exactly `{lovejoin: 1}`, an output to `rh` holds exactly one of it with an inline reference datum in range (`launchDatumOk` read as plain inequalities), and the seed is among the inputs.
- **What stays a caveat, not a lemma:** the ledger's own guarantees (sorted values, unique references) are hypotheses where used, as `LogicLedgerUniqueness` does. The crypto stays opaque.
- **Then:** update both READMEs' wording from "the raw spec" to the readable statements (done), and decide the claim with the owner.

### 4. one_shot_mint's launch: DONE (`Mint*.lean`)

Decode `Lovejoin/Template/Scripts/one_shot_mint.hex` with the same tools and use the same method. The owner's `LaunchSeedSearch` and `LaunchOutputSearch` are loop lemmas in the old style: reuse their facts or rewrite them in this style. A whole-launch Blaster attempt passed 16 GB; this method has no such cost.

### 5. Land it: DONE

- Done: `#guard_msgs` axiom checks on the top theorems (`Typed.lean`, `MintTyped.lean`, `Readable.lean`); the `lovejoin-every` family in `check.sh` (defaults to 16 GB, 30 min); `seedelf-verification/README.md` (*What's proved*, *Next*) and `Lovejoin/AnyTx/README.md` (the results in the source's terms, what the restatement shows, the limits); chunk 42's status line.
- The owner's call (2026-11-07): the claim goes in a short doc in the verification folder, `seedelf-verification/CLAIMS.md`, linked from its README; then commit, push and a PR to main. Nothing outside `seedelf-verification/` claims verification yet.

**The claim, drafted** (true as written; the caveats stay in the docs):

- *Short (X):* "Seedelf's contracts, and the Lovejoin v2 contracts it uses, are formally verified: machine-checked proofs, on the deployed bytes, of exactly when each one accepts, in every transaction."
- *Docs line:* "Formally verified: for every transaction, Lean proofs state exactly when each Seedelf contract, and each Lovejoin v2 contract Seedelf uses, accepts, on its compiled bytes, with no limit on inputs, outputs or proofs. Lovejoin's are checked by Lean's kernel; Seedelf's core properties by Blaster (Z3), with kernel-checked covers. The proofs use IOG's model of the Plutus machine, treat the cryptography as opaque (they prove what the scripts check, not that the cryptography can't be broken), and assume the ledger's own rules only where stated. This is not an audit."

Two phrases carry weight. *Every transaction*: Seedelf's wallet is proved for up to 128 signatories, where the size limit allows 125; everything else has no bound. *The Lovejoin v2 contracts it uses*: mix_box, mix_logic, reference_holder and one_shot_mint; fee_contract (unused) and the older pools' scripts are out, so "Lovejoin's contracts" alone would overclaim.

The original list:

- Add `#print axioms` guards on the top theorems, and a `lovejoin-every` family in `check.sh`.
- Update `seedelf-verification/README.md` (*What's proved*, *What a ✅ is worth*), `Lovejoin/AnyTx/README.md`, and chunk 42's status.
- Write the claim for the owner: true and short (memory `marketing-hype-docs-honest`). The docs keep the caveats:
  - IOG's CEK model;
  - opaque crypto, `serialise_data`, `bytestring_to_integer` and xor through our fork's aliases;
  - the ledger's own checks, such as sorted values, assumed only where stated.
- Then ask the owner about committing, the PR, and where the claim goes (READMEs, store listing, SECURITY.md, X).

## Upstream, checked 2026-11-06 (decisions still the owner's)

- **PlutusCoreBlaster:**
  - **#71 merged 2026-11-05** (`6b4260a`), so ByteStringToInteger is opaque upstream.
  - **#72 merged.**
  - **#73** (operand order) is mergeable and waiting on review.
  - **#27** (`serialise_data`, Luivatra's draft) has been silent since July.
  - **Our pin's library** (`68c5399`) differs from upstream `main` only by #73, #27 and the xor alias. The xor alias was never PR'd, and its commit `96a36cb` conflicts with `main` until rebased. `Slice/`'s alias (`96261cc`) was never PR'd either.
- **Lean-blaster #455** shows CONFLICTING since #155 moved it to `main`. The local rebase `42caa53` (on `1fe209e`) merges cleanly into today's `main` (`983f10f`), which still has the bug. It needs the owner's force-push plus `blaster-forks/posts/lean-blaster-455-retarget-comment.md`.
- **#153** has no reply to our 2026-11-05 comment.
- **Offered to the owner, no answer yet:**
  - the posts (the #455 push and comment, a #73 nudge, PRs for the xor and slice aliases, a #27 comment);
  - re-pinning PlutusCoreBlaster to upstream `main` plus the three open patches, with the owner running the suite once;
  - Lean-blaster to `main` once #455 merges.
