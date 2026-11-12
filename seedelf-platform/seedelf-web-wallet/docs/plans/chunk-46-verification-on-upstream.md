# Chunk 46 · The proofs on IOG's own tools

This plan came in on branch `web-wallet/verification-on-upstream`. Once the work starts, it happens in `seedelf-verification/`, on a branch of its own from `main`, and in the fork clones in `../blaster-forks/`, as in [chunk 41](../archive/plans/chunk-41-blaster-fixes.md).

**Status: 🚧 steps 1 and 3 done 2026-11-08; step 2 in progress.** The owner: "a chunk about how we want to get this working in the main repo".

Every theorem today is proved over our forks of Lean-blaster and PlutusCoreBlaster ([lakefile.lean](../../../../seedelf-verification/lakefile.lean), and `Slice/lakefile.lean`). **Done means:** both lakefiles require both tools from `input-output-hk`, and every theorem still proves. Any theorem that doesn't goes in the README's *Not proved*, with its reason.

Chunks [40](../archive/plans/chunk-40-verification-upstream.md) and [41](../archive/plans/chunk-41-blaster-fixes.md) are the record: the baseline, the rules and the fork setup. The main rule: the owner runs every build, through `check.sh`'s cap. None of it is repeated here.

## Where it stands (2026-11-07)

Each patch our pins carry beyond IOG's `main`, and how it gets there:

| Patch | In our pin | Its way upstream | State |
|---|---|---|---|
| #454, a datatype's parameter names | Blaster `25c0ee0` | Lean-blaster [#455](https://github.com/input-output-hk/Lean-blaster/pull/455) | Open, and MERGEABLE since the rebase was force-pushed on 2026-11-08 (step 1), waiting on its reviewers. `main`'s line 928 still has the bug |
| The BLS12-381 operands in order | PlutusCore `68c5399` | PlutusCoreBlaster [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73) | Merged 2026-11-08 (`8f76ba5`) |
| `encodeDataOpaque` (#27's `serialise_data`) | `68c5399` | [#77](https://github.com/input-output-hk/PlutusCoreBlaster/pull/77) instead; #27 is a draft, silent since July | — |
| `xorByteStringOpaque` | `68c5399` | #77 instead; never offered | — |
| `sliceByteStringOpaque` | `Slice/`'s `96261cc` | #77 instead; never offered | — |
| `byteStringToIntegerOpaque` | upstream `main` (#71) | #77 removes it in favour of the definition | Merged 2026-11-05 |
| `Fq1.t` a `Nat` | upstream `main` (#72) | — | Merged 2026-11-03 |

- **#77 changes the plan.** It's mpetruska's "Blaster friendly bytestring and bitwise ops": opened 2026-11-05, not a draft, mergeable, and waiting on review on 2026-11-07.
  - It keeps the byte builtins' definitions and reaches bytes through three sealed primitives. Their `Spec` is proved, and a goal takes it as a premise, since Blaster doesn't use theorems.
  - It covers slice, index, cons, both integer conversions, the bitwise operations (xor among them) and `serialiseData`, and it removes #71's alias.
  - So once #77 is in, every alias we carry is redundant. The policy's rule might then prove over PlutusCoreBlaster's own slice, which would close the README's last *Not proved* row without `BitVec`.
- **What it costs us.** Our proofs name the aliases about 110 times: `byteStringToIntegerOpaque` 78, `encodeDataOpaque` 15, `sliceByteStringOpaque` 12, `xorByteStringOpaque` 6. They're spread across `Seedelf/`, `Slice/`, `Lovejoin/` (`V2/`, `AnyTx/`, `Every/`) and `Audit/`.
  - Our pins are by commit, so #77 merging breaks nothing. Moving onto it is the work.
- **The toolchains agree.** Lean-blaster `main`, CardanoLedgerApiBlaster and we are all on Lean 4.24.0.
- **Lean-blaster `main` needs Z3 5.4.0, which isn't released yet** (2026-11-07). Since #155 it sets `smt.case_split_relevant_first` on every call, and only Z3's master branch and its nightly know that option. Under 5.3.1, every goal fails with "unknown parameter 'case_split_relevant_first'" before it reaches the solver. 5.3.3's release notes don't list the option; it's under 5.4.0's.
  - Its README says "Z3 master branch for now", and its CI builds Z3 master.
  - So moving our pins to `main` moves Z3 too. Until then, `~/.local/bin/z3` stays 5.3.1 for our current pins. A test against `main` puts the nightly first on `PATH` in a subshell: Blaster runs the first `z3` on the `PATH` (`Blaster/Smt/Env.lean:82`).
- **CardanoLedgerApiBlaster hasn't moved** since 2026-10-02 (`9938562`). It still requires Blaster from `beta-lambda-cache-optimization` (`0bc1ace`). So our own `require Blaster` stays even after #455 lands, pointing at IOG's `main` instead of the fork.

## The upstream check of 2026-11-12

- **PlutusCoreBlaster #78 (merged 2026-11-09) changes what `isUnsuccessful` means.** `cekExecuteProgram` now runs `runSteps`, which ends a run cut off by the step limit in `BudgetExhausted`, and `isUnsuccessful` holds for that as well as for `Error`.
  - Our pin runs `runStepsPreservingState`, where such a run is neither success nor failure.
  - On IOG's `main`, every failure theorem would hold at too small a step limit (342 files state failure that way), and so would every returns-unit-or-error theorem. Nothing breaks while we pin by commit.
  - **Before the move:** state rejection with `isErrorState` (unchanged by #78), in the generators too. `LinesAllCek`'s `exec_*` lemmas and Lovejoin's `LogicOwnerEntry` must follow `cekExecuteProgram` onto `runSteps`.
  - An issue draft is `../blaster-forks/posts/plutuscoreblaster-78-isunsuccessful-issue.md`. Posting it is the owner's call.
- **Z3 5.4.0 is released** (5.4.1 since). Lean-blaster `main` requires 5.4.0 (#464), and both IOG CIs use the release, so no nightly is needed.
- **CardanoLedgerApiBlaster `main` (#25) and PlutusCoreBlaster `main` (#78) now require Lean-blaster at `main`,** no longer the beta.
- **Lean-blaster #471 makes `blasterProven` private.** `#print axioms` names it `_private.Blaster.Command.Tactic.0.Blaster.Tactic.blasterProven`, so `Audit/Checks/PrintAxioms` and `Audit/count.py` need that on the move.
- **#455 conflicted again** (an import line beside #471's test). It was rebased onto `0df4a46` and checked under Z3 5.4.0: it fails without the fix, and gives four Valid and one Expected Falsified with it. The owner pushed it and commented on 2026-11-12, and it's MERGEABLE.
- **Still open:** #77, PlutusCoreBlaster #80 (a CEK runner API change), #75 (an opaque `encodeData`, overlapping #77), and Lean-blaster #463 (a hang from #155, which we could hit on `main`).

## Steps

1. ✅ **#455 back to mergeable.** Rebased in `../blaster-forks/Lean-blaster` (2026-11-07) onto `main` `983f10f`:
   - the fix is `a1a2ccf` and the test `e540263`, on `fix/datatype-param-names`;
   - `local/455-test-only` is the test alone on `983f10f` (`a0e68dd`, push-guarded);
   - the comment and the PR body in `../blaster-forks/posts/` say so.

   The owner runs the check: the test should fail on the test-only branch and pass with the fix.
   - **The first run (2026-11-07), under Z3 5.3.1,** failed on both branches in the same way, on `smt.case_split_relevant_first`, before the bug: it showed nothing. Rerun it with Z3's nightly first on `PATH`.
   - **The rerun (2026-11-07), Z3 nightly 5.4.0 `ff86ba7`:** the test-only branch failed with #454's five errors (unknown sorts `@ε` and `@β`, `@isInt (@PUnit)`), and the fix gave four Valid and one Expected Falsified, in 29 s at 451 MB.
   - **Posted (2026-11-08):** the owner force-pushed (head `e540263`), PATCHed the body and commented. #455 shows MERGEABLE, waiting on its reviewers. The fork's `seedelf` branch keeps `25c0ee0`, which our pins use.
2. 🚧 **Our suite on #77, before it merges.** What we find is worth a comment on #77 either way: it tests a design they're reviewing on real scripts.
   - **Set up (2026-11-08), nothing pushed:**
     - The tools: `../blaster-forks/PlutusCoreBlaster-pr77`, branch `local/pr77-test`. That's #77's head `4aa6e2a` with #73 merged in (`cae98df`), push-guarded.
     - Our proofs: `../Seedelf-Wallet-pr77`, a worktree of `main` on its own push-guarded `local/pr77-test`. Both of its lakefiles require that PlutusCoreBlaster by path, and Blaster stays on `25c0ee0`, under Z3 5.3.1.
     - The changes: `scalarOf` calls `PlutusCore.Bitwise.byteStringToInteger`, and `Slice/`'s three slices call `sliceByteString`. No alias is left in either package.
   - **First results (2026-11-08), every trace checked for #77's path:**
     - `Seedelf.WalletRegister`: ✅ Valid.
     - `Slice.Pr77Probe`, the policy's rule at index 0 and at 255 over #77's own slice: ✅ Valid both. The module took 395 s at 1,060 MB, with its package's first build.
     - `Slice.Pr77AnyIndex`, the rule over a symbolic index from 0 to 255: ✅ Valid, in 2 s at 277 MB, with no `sorry`. #77's `consByteStringV2` builds the byte with `byteStr`, not `UInt8`, so one theorem can replace `Index0`–`Index3`'s 256.
     - **Controls,** so none of these is a vacuous Valid:
       - `Slice.Controls`, its six mutants now over #77's slice: ✅ Expected Falsified, all six.
       - `Slice.Pr77AnyIndexControls`, over the symbolic index: ✅ Expected Falsified, all three. N1 flips the answer, N2 drops the prefix check, and N3 judges the run at `idx` by the rule at `255 - idx`.
     - None of these needed `Spec`. Each property applies the same definitions on both sides, so Blaster proved them with the three primitives uninterpreted.
     - CardanoLedgerApiBlaster `9938562` built unchanged on #77.
   - **The comment** (`../blaster-forks/posts/plutuscoreblaster-77-comment.md`): posted by the owner 2026-11-08 ([#77](https://github.com/input-output-hk/PlutusCoreBlaster/pull/77#issuecomment-6718607893)).
   - **The full run (2026-11-08):**
     - **`Slice/`:** every module `ok`, with all 256 per-index theorems, the two off-byte ones, the kernel's combination of them (`Rule`) and `Controls`.
     - **Seedelf:** every module `ok` but four, each fixed in the scratch copy:
       - `PolicyLinesAll`, and `LinesAllAnyMint` through its import. `cek_rfl`'s `whnf` at default transparency stopped at #77's `@[irreducible]` `instByteViewString`: an unsolved `Decidable.rec` on the minted name's equality. Under `withTransparency .all` (`whnf` and `isDefEq`) both pass, and their theorems still depend only on `propext`, `Classical.choice` and `Quot.sound`.
       - `PolicyBurn` and `PolicyMint`, the README's *Not proved* success theorems. On `main` they fail on `BitVec`. On #77 without `Spec` they come back Falsified, since the primitives are uninterpreted. With a `PlutusCore.Bytes.Spec →` premise, all four are ✅ Valid, in about 2 s each.
     - **The four under `Spec`: no Falsified control, but the encoding has a model.** `Seedelf/Pr77SpecControls.lean` holds `Spec → False`, a burn off #0 failing, a burn off #256 succeeding, and the mint judged by #1's name. All four come back Undetermined at 60 s, since a Falsified needs Z3 to build a model of `Spec`'s quantifiers.
       - mpetruska's answer (2026-11-08): `PlutusCore.Bytes.spec` proves `Spec` in the kernel. That settles Lean's side, not Blaster's translation.
       - The translation (2026-11-08): `Seedelf/Pr77SpecModel.smt2` in the scratch worktree takes `uncons`, `cpStr` and `byteStr` as the real functions on SMT strings, alphabet `0x0`–`0x2FFFF`. Z3 finds every conjunct holds of that interpretation (each negation `unsat`, a false sanity fact `sat`). Blaster writes each byte literal as one code point (`Term.lean`, `strLitSmt`).
       - So a Valid under `Spec` isn't vacuous, and these four stand with the other Blaster results. The limit: the `.smt2` is our transcription of `Spec`, not Blaster's dump of it.
   - **Blaster reports Undetermined as a warning, even under `solve-result: 1`,** so `check.sh` says `ok` for it. The main tree's logs on 2026-11-08: 1,466 Valid, 239 Expected Falsified, 0 Undetermined. ✅ `check.sh` now fails such a module as `UNDETERM` ([#372](https://github.com/logical-mechanism/Seedelf-Wallet/pull/372)).
   - **The migration, for step 4 (Seedelf):**
     - `scalarOf`;
     - the three slices in `Slice/Common.lean` and two in `Controls.lean`;
     - `cek_rfl`'s transparency;
     - `Spec` on the four success theorems, discharged with `PlutusCore.Bytes.spec`;
     - optionally `Index0`–`Index3`'s 256 theorems as one (`Pr77AnyIndex`, with its controls).
   - **Not yet tried:** Lovejoin, whose proofs need the `encodeData` and xor aliases moved first.
   - **The follow-up:** the owner added it to the first comment with `--edit-last` (2026-11-08). A short reply to mpetruska is `../blaster-forks/posts/plutuscoreblaster-77-reply-spec.md`; the owner's call.
   - **Our slip:** the follow-up suggested documenting the seal, which #77's README and `Bytes.lean`'s header already do (`attribute [local semireducible] PlutusCore.Bytes.instByteViewString`, `with_unfolding_all`, `decide +kernel`). Either beats our `.all`-in-a-tactic at migration if it's simpler.
   - **The tools.** A local PlutusCoreBlaster branch, push-guarded as `local/455-test-only` is: #77's head, plus #73. The two share no file but `Tests/Basic.lean`'s imports. None of our aliases.
   - **Our side,** on a branch from `main`:
     - Each alias call becomes the builtin's definition.
     - Each Blaster goal that reads bytes gains `PlutusCore.Bytes.Spec` as a premise. `PlutusCore.Bytes.spec` discharges it in the kernel, so the stated theorem keeps its form.
     - Require the local branch by path only in an uncommitted scratch copy, never committed (chunk 41's rule).
   - **Cheapest first:** `Seedelf.WalletRegister` alone, then `Slice/`'s rule over the real slice at one index, then the rest.
     - Keep each under the cap: the definitions may cost Blaster more than the opaque terms did.
   - **Check first:** whether Lovejoin's kernel-checked proofs (chunk 45) lean on the aliases being opaque. A proof that rewrote over an uninterpreted xor or encodeData may need the definition's lemmas instead.
   - **If WalletRegister or the policy's rule doesn't prove on #77:** say so on #77 with the minimal case, and keep our aliases.
3. ✅ **#73** merged 2026-11-08 (`8f76ba5`), approved by mpetruska: "Nice catch, thank you!". No nudge needed.
4. ⬜ **Off the forks, as each fix lands.**
   - **#455 on `main`:** `require Blaster` from IOG at that `main` commit, in both lakefiles, then `lake update Blaster` alone.
   - **#73 and #77 on `main`:** `require PlutusCore` from IOG at that commit, in both lakefiles, with step 2's migration merged.
   - **After each one:**
     - run `./extract.sh` and the Lovejoin extracts, `./check.sh`, `./check.sh seedelf-slice`, the Lovejoin families and `audit-quick`;
     - compare against chunk 40's baseline and today's counts;
     - re-read Lean-blaster #389 and #224.
   - **Then the docs:** CLAIMS.md's "our fork" lines, and the README's *Running it*, *What a ✅ is worth* and *Not proved*.
5. **Archive this file** once both lakefiles name only IOG.

## Carried from chunks 40 and 41

- ❓ **A Rust proptest of the Schnorr path through the deployed bytes** (chunk 40, offered 2026-11-02). It would run seedelf-crypto's proofs through the wallet script with seedelf-core's `uplc` evaluator: valid proofs pass, tampered ones fail. It needs nothing from upstream. The owner's call.
- ⬜ **Two minimal reproductions, for upstream** (README, *Found along the way*):
  - a symbolic first-input index breaks `#prep_uplc`, with a `sorryAx` in the prop;
  - a symbolic `ByteString` token name took the policy past 8 GB.

  Both go through byte builtins, so try them on #77 first.
- **Watch:** Lean-blaster #153, which had no reply to our 2026-11-05 comment. The #68 comment draft stays unposted unless #455 stalls.
- ❓ **Peace Protocol as a test bed for #29's BLS12-381 axioms** (2026-11-07): the owner is deciding.

## Who does what

As in chunk 41:
- **Claude** edits, writes the posts and the owner's command blocks (each names its host, with no placeholders and no `set -e`), and pushes to the forks' own branches.
- **The owner** runs every build and makes every post to IOG's repos.

## The owner's decisions

- **2026-11-07, this chunk:** "there any updating we can do on those upstream things right now else we can do a very quick house keeping branch of proper archive or at least a chunk about how we want to get this working in the main repo".
