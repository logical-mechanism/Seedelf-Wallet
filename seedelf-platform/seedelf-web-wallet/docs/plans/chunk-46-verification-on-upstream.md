# Chunk 46 · The proofs on IOG's own tools

This plan came in on branch `web-wallet/verification-on-upstream`. Once the work starts, it happens in `seedelf-verification/`, on a branch of its own from `main`, and in the fork clones in `../blaster-forks/`, as in [chunk 41](../archive/plans/chunk-41-blaster-fixes.md).

**Status: ⬜ planned 2026-11-07, step 1 waiting on the owner.** The owner: "a chunk about how we want to get this working in the main repo".

Every theorem today is proved over our forks of Lean-blaster and PlutusCoreBlaster ([lakefile.lean](../../../../seedelf-verification/lakefile.lean), and `Slice/lakefile.lean`). **Done means:** both lakefiles require both tools from `input-output-hk`, and every theorem still proves. Any theorem that doesn't goes in the README's *Not proved*, with its reason.

Chunks [40](../archive/plans/chunk-40-verification-upstream.md) and [41](../archive/plans/chunk-41-blaster-fixes.md) are the record: the baseline, the rules and the fork setup. The main rule: the owner runs every build, through `check.sh`'s cap. None of it is repeated here.

## Where it stands (2026-11-07)

Each patch our pins carry beyond IOG's `main`, and how it gets there:

| Patch | In our pin | Its way upstream | State |
|---|---|---|---|
| #454, a datatype's parameter names | Blaster `25c0ee0` | Lean-blaster [#455](https://github.com/input-output-hk/Lean-blaster/pull/455) | Open. CONFLICTING since #155 moved it to `main`, whose line 928 still has the bug. Rebased locally (step 1) |
| The BLS12-381 operands in order | PlutusCore `68c5399` | PlutusCoreBlaster [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73) | Open and mergeable, with no review since 2026-11-03 |
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

## Steps

1. 🚧 **#455 back to mergeable.** Rebased in `../blaster-forks/Lean-blaster` (2026-11-07) onto `main` `983f10f`:
   - the fix is `a1a2ccf` and the test `e540263`, on `fix/datatype-param-names`;
   - `local/455-test-only` is the test alone on `983f10f` (`a0e68dd`, push-guarded);
   - the comment and the PR body in `../blaster-forks/posts/` say so.

   The owner runs the check: the test should fail on the test-only branch and pass with the fix.
   - **The first run (2026-11-07), under Z3 5.3.1,** failed on both branches in the same way, on `smt.case_split_relevant_first`, before the bug: it showed nothing. Rerun it with Z3's nightly first on `PATH`.
   - **The rerun (2026-11-07), Z3 nightly 5.4.0 `ff86ba7`:** the test-only branch failed with #454's five errors (unknown sorts `@ε` and `@β`, `@isInt (@PUnit)`), and the fix gave four Valid and one Expected Falsified, in 29 s at 451 MB. Ready for the force-push and the posts. Then the owner force-pushes, PATCHes the body and posts the comment (the classifier refused Claude's force-push in chunk 41). The fork's `seedelf` branch keeps `25c0ee0`, which our pins use.
2. ⬜ **Our suite on #77, before it merges.** What we find is worth a comment on #77 either way: it tests a design they're reviewing on real scripts.
   - **The tools.** A local PlutusCoreBlaster branch, push-guarded as `local/455-test-only` is: #77's head, plus #73. The two share no file but `Tests/Basic.lean`'s imports. None of our aliases.
   - **Our side,** on a branch from `main`:
     - Each alias call becomes the builtin's definition.
     - Each Blaster goal that reads bytes gains `PlutusCore.Bytes.Spec` as a premise. `PlutusCore.Bytes.spec` discharges it in the kernel, so the stated theorem keeps its form.
     - Require the local branch by path only in an uncommitted scratch copy, never committed (chunk 41's rule).
   - **Cheapest first:** `Seedelf.WalletRegister` alone, then `Slice/`'s rule over the real slice at one index, then the rest.
     - Keep each under the cap: the definitions may cost Blaster more than the opaque terms did.
   - **Check first:** whether Lovejoin's kernel-checked proofs (chunk 45) lean on the aliases being opaque. A proof that rewrote over an uninterpreted xor or encodeData may need the definition's lemmas instead.
   - **If WalletRegister or the policy's rule doesn't prove on #77:** say so on #77 with the minimal case, and keep our aliases.
3. ⬜ **#73.** If it's still unreviewed once #77's discussion settles, the owner posts one nudge, noting that it's independent of #77.
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
