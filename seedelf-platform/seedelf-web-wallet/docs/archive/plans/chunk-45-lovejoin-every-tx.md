# Chunk 45 · Lovejoin in every transaction

**Done** (2026-11-06): mix_logic and one_shot_mint in every transaction, kernel-checked, stated in the Aiken source's terms. The claim is in `seedelf-verification/CLAIMS.md` (the owner's call), and the chunk landed as one PR to main, #368 (*What its PR did*, at the end). What still holds is in `seedelf-verification/Lovejoin/Every/README.md`: how to build and change the proofs, the method, the pitfalls, the tools and every module's theorems. Read it before changing a proof.

## Where things are

- **The proofs:** `seedelf-verification/Lovejoin/Every/` (25 modules: 20 CEK, 5 `Readable*`), its `tools/*.py` and its README, built by `./check.sh lovejoin-every`. `Lovejoin/AnyTx/README.md` says what they state, and `CLAIMS.md` what we claim.
- **Built in** the worktree `../Seedelf-Wallet-chunk45`, branch `web-wallet/lovejoin-every-tx`, cut from `origin/main` `9103df62` (#367 merged), with `.lake` copied from the main checkout, so nothing rebuilt the dependencies.
- **Last full run (2026-11-06):** `./check.sh lovejoin-every` on that `.lake`, with everything the family imports already built: 20 `ok`, about 11 minutes, no `sorry`; the heaviest module Collect at 12.8 GB. Then the five `Readable*` modules, built on it: seconds each, under 400 MB, no warnings. After the review's wording fixes, the family again: 25 `ok`, with Typed, MintTyped and the Mint modules rebuilt (MintCheck peaks at 8.4 GB).
- **The limits** were the owner's (2026-11-06): 16 GB and 30 minutes a module, one module at a time. Six of the 25 pass the default 8 GB.

## The goal and the owner's words

The owner, 2026-11-06, with the old pools empty and the 5 ₳ v2 pool live:
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

## The method, the pitfalls, the tools and the modules

In `seedelf-verification/Lovejoin/Every/README.md` since 1.8.1's release review, where they stay true as the proofs change: *The method* (the spec as the compiled code read back, one theorem per region, `ev_go`), *Pitfalls already paid for* (the CEK regions', the launch's and the readable layer's), *The tools* (`pseudo.py`, `scope.py`, `lpath.py`, `pp.py`, `fillpaths.py`) and *The modules*, every module's theorems.

So both scripts that lacked it are proved in every transaction: mix_logic (every purpose, both withdrawals, the redeemer's checks, the root) and one_shot_mint (the launch, every other purpose), first over raw `Data`, then in the Aiken source's terms. With mix_box and reference_holder from before, that is all of Lovejoin v2 in scope (fee_contract out).

## The steps, in order (all done)

### 1. The Mix branch: DONE (the README's *The modules*; the notes below were the map)

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
- **The readable half** (2026-11-06, the README's *The modules*): `Readable.mix_logic_accepts_iff` and `one_shot_mint_accepts_iff`, built in this order. An independent read of the definitions against the Aiken source (29573c5's, byte-identical to `lovejoin-v2` 5cc3631 but for `sigma_or.ak`'s test formatting) found every handler accepting exactly what the source does. Its notes were all wording, fixed: the name parameter is `lovejoin`; "at the script" means `output_at_script`'s whole test; `find?` skips a holder output that fails the test; `xor32`'s lengths; the theorems say "returns `()` iff", not "errors otherwise"; and the `_valid` forms' narrowness, above. Pure Lean about the spec functions, no CEK step. One thing the restatement shows that the source hides: the compiled code stores a Mix statement's points compressed, so `branchHolds` reads them back as `uncompress(compress(·))`.
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
- The owner's call (2026-11-06): the claim goes in a short doc in the verification folder, `seedelf-verification/CLAIMS.md`, linked from its README; then commit, push and a PR to main. Nothing outside `seedelf-verification/` claims verification yet.

**The claim, drafted** (true as written; the caveats stay in the docs):

- *Short (X):* "Seedelf's contracts, and the Lovejoin v2 contracts it uses, are formally verified: machine-checked proofs, on the deployed bytes, of exactly when each one accepts, in every transaction."
- *Docs line:* "Formally verified: for every transaction, Lean proofs state exactly when each Seedelf contract, and each Lovejoin v2 contract Seedelf uses, accepts, on its compiled bytes, with no limit on inputs, outputs or proofs. Lovejoin's are checked by Lean's kernel; Seedelf's core properties by Blaster (Z3), with kernel-checked covers. The proofs use IOG's model of the Plutus machine, treat the cryptography as opaque (they prove what the scripts check, not that the cryptography can't be broken), and assume the ledger's own rules only where stated. This is not an audit."

Two phrases carry weight. *Every transaction*: Seedelf's wallet is proved for up to 128 signatories, where the size limit allows 125; everything else has no bound. *The Lovejoin v2 contracts it uses*: mix_box, mix_logic, reference_holder and one_shot_mint; fee_contract (unused) and the older pools' scripts are out, so "Lovejoin's contracts" alone would overclaim.

The original list, all done:

- Add `#print axioms` guards on the top theorems, and a `lovejoin-every` family in `check.sh`.
- Update `seedelf-verification/README.md` (*What's proved*, *What a ✅ is worth*), `Lovejoin/AnyTx/README.md`, and chunk 42's status.
- Write the claim for the owner: true and short (memory `marketing-hype-docs-honest`). The docs keep the caveats:
  - IOG's CEK model;
  - opaque crypto, `serialise_data`, `bytestring_to_integer` and xor through our fork's aliases;
  - the ledger's own checks, such as sorted values, assumed only where stated.
- Then ask the owner about committing, the PR, and where the claim goes (READMEs, store listing, SECURITY.md, X).

## Upstream

The upstream checks of 2026-11-06 (PlutusCoreBlaster's #71 and #72 merged, #73 and #27 open, the aliases never offered, Lean-blaster #455 conflicting, and what was offered to the owner) are in chunk 41's plan, *Where upstream stands*. The decisions are still the owner's.

## What its PR did

**#368** (`web-wallet/lovejoin-every-tx`, into `main`, merged as `d190f717`):

- **The proofs** (`32f80205`): the 25 `Lovejoin/Every/` modules, mix_logic's withdrawals and one_shot_mint's launch over raw `Data`, then over every typed V3 context, then in the Aiken source's terms (`Readable*`), with their axiom guards; the path tools; the `lovejoin-every` family in `check.sh`.
- **The claim** (`e6897cde`): `seedelf-verification/CLAIMS.md`, the two READMEs citing the readable theorems and saying the `_valid` forms are narrower, this plan as its record, and chunk 42's step 10.

1.8.1's release review then fixed the docs (CLAIMS.md's *Where it stops*, the READMEs) and `check.sh` (an Every module named alone gets the family's caps, and the family builds the 51 modules it imports from elsewhere first), guarded the two cited theorems' axioms by name, moved what still holds into `Lovejoin/Every/README.md` and the upstream checks into chunk 41's plan, and archived this file.
