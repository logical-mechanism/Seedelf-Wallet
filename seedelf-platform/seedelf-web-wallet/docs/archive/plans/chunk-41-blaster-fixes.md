# Chunk 41 · Fixing the Blaster gaps ourselves

Branch `verification`, as [chunk 40](chunk-40-verification-upstream.md). Chunk 40 waits for upstream to fix three gaps in IOG's tools. This chunk fixes them in our own forks of Lean-blaster and PlutusCoreBlaster instead, offers each fix upstream as a small PR, and pins the forks until the PRs merge, so WalletRegister can be tried without waiting.

**Archived 2026-11-07: its *Done means* is met.** WalletRegister is proved and in `check.sh`'s default list. #71 and #72 merged, and #455 and #73 are open with our pins recorded. Taking the forks out as the fixes land is [chunk 46](../../plans/chunk-46-verification-on-upstream.md). What it did is [*Where it ended*](#where-it-ended); below is the plan as it stood.

**Status on 2026-11-03: 🚧 in progress, started 2026-11-02 at the owner's call:** "Do proper forks of those repos, make those changes and get the prs going. I would monitor it and see if anyone comments on the work you did." Why: "being able to use oh we are formally verification and the first privacy wallet can be big marketing wins." (A claim stays true to what's proved: until WalletRegister lands, that's the 29 properties, not the wallet's spend check.)

| Step | Status |
|---|---|
| 0 · Forks, clones, runner | ✅ |
| 1 · Datatype parameter names | 🚧 issue [#454](https://github.com/input-output-hk/Lean-blaster/issues/454), PR [#455](https://github.com/input-output-hk/Lean-blaster/pull/455) open (2026-11-03); fix `6526c4b` + test `25c0ee0`, the test passes (four Valid, one Expected Falsified) |
| 2 · `ByteStringToInteger` alias | ✅ PR [PlutusCoreBlaster #71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71) merged 2026-11-05 (`6b4260a`), opened 2026-11-03; fix `3dd76d7` + `28910c6`, test `cfa8c53` passes (one Valid, two Expected Falsified); review round 1 `f411ef6` (four Valid, three Expected Falsified, a `#guard`); after #72 merged, `main` merged in (`b330749`) and the review's `State` equalities (`c60039c`, same results) |
| 3 · `Fin` in `Fq1` | ✅ [PlutusCoreBlaster #72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72) merged 2026-11-03 by mpetruska (squash `0c0c1b8`, the same tree as `89d8c6d`); opened after no reply on [#29](https://github.com/input-output-hk/PlutusCoreBlaster/pull/29#issuecomment-6597217930) (the owner: "seems like that pr just died"); fix `ae0a7cd` + test `f146c10` pass; review round 1 `89d8c6d` |
| 4 · WalletRegister | ✅ Valid in the script's own order (2026-11-03, 737 MB with the rebuild), in `check.sh`'s default list, README and chunk 40 updated |
| 5 · Operand order (Fix 4) | 🚧 PR [PlutusCoreBlaster #73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73) open (2026-11-03), fix + test `b60ff2a` pass (three Falsified before, three Valid after), rebased onto round 1 as `b01509a`; after #72 merged, rebased onto `main` as `5c048b0` (the same tree, so no rerun) |

### Next session, in order

0. **Review round 1, 2026-11-03: answered, waiting on mpetruska.** Replies and the round's state are in `../blaster-forks/posts/review-round-1-replies.md`.
   - **#71 (merged 2026-11-05, `6b4260a`):** the alias returns a `Nat` and the builtin applies `.ofNat`; the goals are also stated over `cekExecuteProgram`; a `#guard` checks `#0102` is 258 (`f411ef6`).
     - We kept the `haltsWithInteger`/`haltsWithBool` matches. The `State` equality the review suggested fails on `Fin` on `main`, and passes with #72 underneath (local-only `local/state-equality`, `346fe6a`). Done once #72 merged: `main` merged into #71 (`b330749`), the equalities in `c60039c` (four Valid, three Expected Falsified), replied on both threads.
     - **Open:** their main point is re-modelling `ByteString` as `ByteArray`. We agreed and asked for an issue to follow; none was open on 2026-11-07.
   - **#72 ("Nice work! Just a minor request"):** the short doc comment and `private mk ::` (`89d8c6d`). `G1.lean`'s `ToExpr Fq1` now builds through `Fq1.ofNat`, since `Fq1.mk` is private. #73 is rebased onto it (`b01509a`, force-pushed).
   - **Checked (the owner's runs):** every fork test passes on its own branch. `./check.sh` on the new pin matched the baseline: nine `ok`, WalletRegister Valid, PolicyBurn and PolicyMint on `BitVec` alone.
   - **GitHub won't let us re-request a review:** the API refuses non-collaborators. The replies notify the reviewer instead.
   - **Pins:** `seedelf` is `1e38b23` on the fork. On `lovejoin-verification`, `local/opaque-xor` is `68c5399` (that plus the xor alias) and `scalarOf` applies `.ofNat`, from `local/seedelf-repin`. Lovejoin's four calls of the alias need the same `.ofNat` when that lands. `verification` still pins `c7d8741`: re-pin it to `1e38b23` the same way.
1. ✅ **Fix 4 and WalletRegister, 2026-11-03.** Fix 4's test: three Falsified under the old patterns, three Valid with the fix. WalletRegister: ✅ Valid in the script's order. The baseline and `upstream` were unchanged. WalletRegister is now in `check.sh`'s default list.
   - **Before that, the model-order check** confirmed the cause: `wallet_register_spend_iff`, with `add`'s and `equal`'s operands in the model's order, was ✅ Valid in 1.1 s at 305 MB, and `schnorrAccepts` was true on the real proof and false with z changed.
   - **The pinned run before it (2026-11-03)** matched every expectation:
     - `lake update` recloned both packages from the forks.
     - `upstream`: ExceptParams and Fq1Fin `ok`, ByteStrings `FAILED` on its four `BitVec` cases, the Slice modules `ok`.
     - The baseline: the same eight `ok`, with PolicyBurn and PolicyMint failing on `BitVec` alone. The first build took 394 s at 1.4 GB.
     - Steps: the valid spend halts after 1281 steps, and the other signer errors after 1306.
     - WalletRegister translated for the first time and came back **Falsified** in 1 s, every input empty. The cause is the operand order (Fix 4).
2. ✅ **The Lean-blaster PR is [#455](https://github.com/input-output-hk/Lean-blaster/pull/455)**, opened by the owner on 2026-11-03 into `beta-lambda-cache-optimization`, at `25c0ee0`.
3. ✅ **The Fix 2 PR is [PlutusCoreBlaster #71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71)**, opened by Claude on 2026-11-03 at the owner's word ("go ahead with the Prs"), into `main`, at `cfa8c53`. Its text says the wallet's property now proves on our forks.
4. ✅ **Fix 3 is [#72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72) and Fix 4 is [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73)**, opened by Claude on 2026-11-03. #29 had no reply to our question (the owner: "if 29 is just idle then we may want to kind of just do it … seems like that pr just died"). #72 says we asked first and will close in #29's favour if #29 lands. #73 is stacked on it: its diff is `b60ff2a` alone once #72 merges.
5. **The #153 and #68 comments are ready, with the PR numbers in** ([#153](../../../../../seedelf-verification/Upstream/drafts/lean-blaster-153-comment.md), now about the policy's slicing, with #71 as the wallet's way around; [#68](../../../../../seedelf-verification/Upstream/drafts/plutuscoreblaster-68-comment.md), pointing at #455). The owner posts them, or says the word.
6. **WalletRegister, from step 1's result,** as Step 4 below says. If a PR's branch changes in review, rebuild `seedelf` and re-pin.

### Fix 4 · Operand order of the BLS12-381 builtins (PlutusCoreBlaster), found 2026-11-03 ✅ on the fork

- **The bug.** The CEK machine conses each argument onto a builtin's list (`V :: Vs`), so the list is last-first. The integer builtins match `[op2, op1]` and call `f op1 op2`. `bls12381G1Add`, `G1Equal`, `G2Add`, `G2Equal`, `MulMlResult` and `FinalVerify` match `[x, y]` and call `f x y`: the operands are swapped.
  - `scalarMul`, `hashToGroup` and the Miller loop are in order.
  - All six are commutative or symmetric on real values, so evaluation and conformance can't see it.
  - Over the `opaque` builtins, `add(a, b)` and `add(b, a)` are different terms. A spec in the script's order is Falsified.
- **The fix.** Swap the six patterns to `[y, x] => f x y` (or `[op2, op1]`, the house style), on a fork branch from `fix/fq1-nat`: its test needs symbolic points, which only Fix 3 allows.
- **The test.** Small textual programs, read through a match, each Valid only in order:
  - `equal(add(a, b), a)` over two G1 points, and the same over G2;
  - `finalVerify(mulMlResult(m1, m2), m1)` over two Miller loops.
- **The PR** is stacked on Fix 3's and says so. It changes no evaluation, since every operation is symmetric. Its text is `../blaster-forks/posts/plutuscoreblaster-operand-order-pr.md`; its *Testing* states step 1's expected results.
  - Open it after Fix 3's: `cd /home/logic/Documents/LogicalMechanism/blaster-forks && gh pr create -R input-output-hk/PlutusCoreBlaster --base main --head logicalmechanism:fix/bls-operand-order --title "$(cat posts/plutuscoreblaster-operand-order-pr.title)" --body-file posts/plutuscoreblaster-operand-order-pr.md`.
- **Done:** `b60ff2a` on `fix/bls-operand-order` (from `fix/fq1-nat`), with its test, merged into `seedelf` as `c7d8741` and pinned; WalletRegister is back on `schnorrAccepts` (`e46dff8f`) and Valid. Waiting: Fix 3's PR, then this one.
- **Our side.** `schnorrAcceptsAsModelled` goes, `wallet_register_spend_iff` uses `schnorrAccepts`, and the expected-Falsified case is deleted.


**The fork tests' first round (2026-11-03)** failed in the tests, not in the fixes. Each was fixed and passed on the second round:
- A doc comment (`/-- -/`) above `#blaster` doesn't parse. `#blaster` isn't a declaration, so use `--` there. The command still ran after the parse error.
- **Never compare a whole CEK `State`.** `prop a ≠ State.Halt (…)` makes Blaster declare the CEK datatype, whose `Const` holds BLS12-381 points, so it fails on `Fin` even with no point in the goal. Read the result through a match (`haltsWithInteger`), as PlutusCoreBlaster's `Tests/BlueprintVerify/BooleanCase.lean` and our `isSuccessful` do.
- Inside `namespace Tests.Cryptograph.…`, `Cryptograph.BLS12_381` resolves to the test's own parent namespace. Use `TestVectors.lean`'s namespace.
- Each PlutusCoreBlaster test then took about 40 s, at a 1.4–1.5 GB peak.

**The valid spend** in `Steps.lean` and `concrete/wallet_register.sh` is a proof from `seedelf-crypto`'s own `create_proof` (secret `0x5eed0e1f`, a 28-byte key hash), printed by a scratch crate outside the repo.
- The deployed bytes accept it, at 72,113 memory units, and refuse a changed z, another signer, and a proof bound to another key hash.
- The schnorr.ak vector (`real_fiat_shamir_transform`) isn't a proof for `valid_schnorr_proof`'s x and r: a z made from it fails.

Chunk 40's [baseline](chunk-40-verification-upstream.md#the-baseline-2026-11-02-z3-531), [practicalities and rules](chunk-40-verification-upstream.md#practicalities-and-rules) and [what each fix should flip](chunk-40-verification-upstream.md#how-to-tell-each-is-fixed) hold here. They aren't repeated.

## Scope

- **In:**
  - Bug 1, the datatype parameter names (Lean-blaster).
  - Bug 3, `Fin` in `Fq1` (PlutusCoreBlaster).
  - Bug 2's stopgap for `ByteStringToInteger` (PlutusCoreBlaster).
  - Then WalletRegister.
- **Out:**
  - **Real `BitVec`/`Char` support.** That's upstream's design work, weeks to months. It touches `feat/indexed-types`, the Lean 4.35 String series (#431–#439) and [#153](https://github.com/input-output-hk/Lean-blaster/issues/153). We don't fork it.
  - **`sliceByteString`.** A `str.substr` rewrite takes 2–4 days and collides with the 4.35 String migration and #389. An alias only helps properties that slice the same way on both sides. Only the policy's success theorems need it, so [chunk 40's step 5.2](chunk-40-verification-upstream.md#resuming) stays parked.
  - **Lovejoin.**
- **Order and size:** 1, then 3, then 2, then WalletRegister. About 3–5 days, plus the owner's builds.

## Who does what

- **Claude:** the forks and pushes to them, the edits and tests, local commits, PR and comment texts, and the owner's command blocks (each names its host, with no placeholders and no `set -e`).
- **The owner:** every post to IOG's repos (issues, PRs, comments) and every build, pasting the output back. On 2026-11-02 the permission classifier let Claude fork and push to the owner's own forks, but refused `gh issue create` on input-output-hk ("External System Writes"), as it refused Claude's `lake build` and `check.sh`. The owner can instead add a permission rule for those commands; until then they run them.
- **The owner monitors** the issues and PRs for comments. Open since 2026-11-03: Lean-blaster #455 (its CI waits on a maintainer's approval), and PlutusCoreBlaster #73. #72 merged 2026-11-03, #71 2026-11-05.

## Step 0 · Setup ✅

- **Forks on the owner's personal account,** not the `logical-mechanism` org. The owner, 2026-11-02: "having a bunch of forks on our company repo isnt look good for the optics … I usually put forks on the logicalmechanism account and not the org."
  - [logicalmechanism/Lean-blaster](https://github.com/logicalmechanism/Lean-blaster) and [logicalmechanism/PlutusCoreBlaster](https://github.com/logicalmechanism/PlutusCoreBlaster), made with `gh repo fork` (all branches).
- **Clones outside the repo,** in `../blaster-forks/` beside `Seedelf-Wallet/` (the owner: "create a folder in the parent for this work"), each with `upstream` set to input-output-hk:
  - `Lean-blaster` on `fix/datatype-param-names`, from beta `46c8479`;
  - `PlutusCoreBlaster` on `feat/opaque-bytestring-to-integer`, from main `1c23de8`.
- **`../blaster-forks/check.sh <checkout> <lake target>…`** builds in a fork under a cap (16 GB and 60 minutes by default, since a first build compiles Blaster and PlutusCore).
- **`../blaster-forks/check-lean-blaster/`** is a tiny package requiring the Lean-blaster clone by path, with our `ExceptParams.lean` linked in: the fix checked before any pin.
- **`../blaster-forks/posts/`** holds the bodies of the posts the owner makes.
- **Actions:** enable them on both forks for a PR inside the fork to run upstream's CI there (not done yet; the owner's call).

## Using the forks before the PRs merge

- **A `require` of our own** in [lakefile.lean](../../../../../seedelf-verification/lakefile.lean), above the CardanoLedgerApi one, at the fork's commit:
  ```lean
  -- Chunk 41: our forks until upstream merges the fixes. Remove each when it lands.
  require Blaster from git "https://github.com/logicalmechanism/Lean-blaster" @ "<commit>"
  require PlutusCore from git "https://github.com/logicalmechanism/PlutusCoreBlaster" @ "<commit>"
  ```
  - Claude fills in the commits when it writes this. The owner runs `lake update Blaster` (or `PlutusCore`) alone, so nothing else moves off the baseline.
  - The PlutusCoreBlaster pin is a `seedelf` branch in the fork, with both PR branches merged into it. Lean-blaster's is the fix branch's commit.
- **Check that the override took (unverified).** Lake should prefer the root's requirement to CardanoLedgerApiBlaster's, but nobody has run it. After the first pin, Claude reads `lake-manifest.json`: the package should show the fork's URL, the commit, and `"inherited": false`.
  - If it doesn't, fork CardanoLedgerApiBlaster too, point its two requires at our forks, and pin that fork instead.
- **Before a pin,** check against a clone by path, as `../blaster-forks/check-lean-blaster/` does. Never commit a path require in `seedelf-verification/`.
- **Record each pin** in the table and in the README's *Running it*. When upstream lands, revert it: delete the require, run `lake update` on that package, and re-run the baseline.

| Package | Fork commit | PR | Remove when |
|---|---|---|---|
| Blaster | `25c0ee0` (`fix/datatype-param-names`) | [#455](https://github.com/input-output-hk/Lean-blaster/pull/455) | the fix is on `beta-lambda-cache-optimization`, or wherever CardanoLedgerApiBlaster requires Blaster from |
| PlutusCore | `c7d8741` (`seedelf`: `cfa8c53`, `f146c10` and `b60ff2a` merged onto `1c23de8`); after review round 1, `seedelf` `1e38b23`, which `lovejoin-verification` pins as `local/opaque-xor` `68c5399` | [#71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71), [#72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72), [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73) | both PRs are on PlutusCoreBlaster `main` |

## Fix 1 · Datatype parameter names (Lean-blaster) 🚧

Done: the one-line change, `6526c4b` on `fix/datatype-param-names`, pushed to the fork (the comment above the line says why it isn't hash-consed). Waiting: the owner files the issue (`../blaster-forks/posts/lean-blaster-issue.md`), then Claude adds the `IssueN` test named after it, and the owner checks and opens the PR.

- **The change, on the fork's branch `fix/datatype-param-names` from `46c8479`.**
  - In `Blaster/Smt/Translate/Quantifier.lean:928` (`genIndParams`), `Optimize.forallTelescope (← hashcons indVal.type)` becomes `Optimize.forallTelescope indVal.type`. That's main's form (main `a16614e`, line 946).
  - Leave line 948 alone (`createCtorDeclaration`'s `hashcons recRule.rhs`). A rule's right-hand side names the type's own constructors, so two types' rules are never alpha-equivalent. That comes from reading the code, not from a run: say so in the PR.
- **The test.** `Tests/FixedIssues/IssueN.lean`, where N is the issue's number, so the issue is filed first.
  - It's [ExceptParams.lean](../../../../../seedelf-verification/Upstream/ExceptParams.lean)'s cases in `namespace Tests.IssueN`.
  - Give it the house header (*Issue*, *Diagnosis*, *Modifications*, as `Issue348.lean` has), and write each Falsified case as `#blaster (gen-cex: 0) (solve-result: 1)`.
  - Add `import Tests.FixedIssues.IssueN` at the end of `Tests/FixedIssues.lean`.
- **Checking it here:**
  - `./check.sh in forks/Lean-blaster Tests.FixedIssues.IssueN` should say `ok`. Its first build compiles Blaster, which took about 107 s and 1 GB for `upstream-main`.
  - Pin the fork. Then `./check.sh upstream` should say `ok Upstream.ExceptParams`: the five ❌ turn ✅, as on main. Everything else should match the baseline.
  - `./check.sh` should match the baseline exactly: eight `ok`, and PolicyBurn and PolicyMint `FAILED` on `BitVec` alone.
  - Blaster's whole suite runs in the fork's CI.
- **The PR.**
  - The owner files [the issue draft](../../../../../seedelf-verification/Upstream/drafts/lean-blaster-datatype-param-names.md), then the PR into `beta-lambda-cache-optimization`, saying "Fixes #N".
  - Claude writes the PR text in `Upstream/drafts/lean-blaster-genindparams-pr.md`, on the repo's template. It says:
    - the one line, which is main's form;
    - the regression test, and the link to the fork's CI run;
    - that line 948 was left alone, and why;
    - that [#335](https://github.com/input-output-hk/Lean-blaster/pull/335) would fix this as a side effect, with no test, so this PR can land first or close in its favour;
    - that [#155](https://github.com/input-output-hk/Lean-blaster/pull/155) would otherwise carry the bug to `main`.
  - Small fix PRs into beta have merged the same day they were opened (#288, #349, #369).
  - After that, the [#68 comment](../../../../../seedelf-verification/Upstream/drafts/plutuscoreblaster-68-comment.md) gets the issue's number and the PR's, in chunk 40's filing order.
- **If upstream says no, or fixes it another way:**
  - If they fix it in #335 or their own commit, take theirs. Remove our require once the fix is on beta, and check `Upstream.ExceptParams` again. Close our PR with thanks.
  - If #155 merges first, retarget the PR to `main`. The line is the same.
  - If they decline, keep the pin and rebase it when beta moves.

## Fix 3 · `Fin` in `Fq1` (PlutusCoreBlaster) 🚧

Done: `ae0a7cd` on `fix/fq1-nat`, pushed to the fork, with `Co-authored-by` for #29's author.
- It's #29's `Fq1` part line for line. That includes three uses the list below missed: `Fq2.sgn₀`'s two `Fin.toNat` (lines 660 and 662) and `compressG2`'s `.val` (802). It also has #29's `toNat_ofNat_381` beside the test vectors' hex printers.
- The PR's test is `Tests/Cryptograph/BLS12_381/SymbolicPoints.lean`, with two Valid cases and one Falsified and no `Except`.
- The #29 question is `../blaster-forks/posts/plutuscoreblaster-29-comment.md`, and the PR text `posts/plutuscoreblaster-fq1-pr.md`.
- `Upstream/Fq1Fin.lean` has its Valid case, `fq1_eq_of_t_eq`.
- Waiting: the owner's build and #29's answer, then the PR.

- **The repro first: [Upstream/Fq1Fin.lean](../../../../../seedelf-verification/Upstream/Fq1Fin.lean),** already in `check.sh`'s `upstream` list. Run on 2026-11-02: the point cases fail on `Fin`, and the control passes.
  - It has a control (`blake2b_224`), symbolic points, and `bls12_381_G1_uncompress` of a symbolic bytestring. Each expects Falsified.
  - Run `./check.sh Upstream.Fq1Fin` first. The point cases should fail on `Fin`, and the control should pass. If they fail on anything else, record it before fixing anything.
  - Add one Valid case beside them, such as `∀ (x y : Fq1), x.t = y.t → x = y`, so a pass isn't only the solver finding a model.
- **Ask on [#29](https://github.com/input-output-hk/PlutusCoreBlaster/pull/29) first.** Claude drafts `../blaster-forks/posts/plutuscoreblaster-29-comment.md`, and the owner posts it.
  - The question: may we send #29's `Fq1.t : Nat` part as a small PR of its own, crediting #29, or is #29 about to land?
  - Our fork carries the change meanwhile. Only the PR waits for the answer.
- **The change, on the fork's branch `fix/fq1-nat` from `1c23de8`.** About 50 lines, all taken from #29's own diff:
  - `Cryptograph/BLS12_381/Basic.lean:39`: `t : Fin fieldPrime` becomes `t : Nat`.
  - Line 61: `Fq1.ofNat` drops its proof. #29's `Fq1.ofNat_lt` keeps the bound the type used to carry.
  - The `Fin.val x.t` and `x.t.val` uses at lines 120, 121, 130, 337, 346, 349, 758, 773 and 789 become `x.t`.
  - `Tests/Cryptograph/BLS12_381/TestVectors.lean:116–141`: the hex printers' `Fin.castLE … |> BitVec.ofFin` becomes `BitVec.ofNat 381 x.t`. #29 edits this file at its old path, `Cryptograph/`; #58 moved it.
  - None of #29's other changes: not the total `binaryInversion`, not the `@[irreducible]` `Point` instances, not the axioms.
- **What it changes for proofs.** A symbolic `Fq1` can now have `t ≥ fieldPrime`. In our proofs, points come only from opaque builtins, so a universal property covers more values, never fewer.
- **The PR's test.** A file in `Tests/`, imported from `Tests/Basic.lean`, with the symbolic `Fq1` and `Point` cases.
  - It must not use `Except`: PlutusCoreBlaster's own CI uses its own Blaster pin, `bc03bb4`, which still has bug 1.
  - It fails on `Fin` before the change and passes after.
- **Checking it here:**
  - `./check.sh in forks/PlutusCoreBlaster` with that module, and then with `Tests.Cryptograph.BLS12_381.TestVectors`.
  - Pin the fork. Then `./check.sh upstream` should say `ok Upstream.Fq1Fin`, and `./check.sh` should match the baseline.
  - The fork's CI runs the rest. BLS conformance must still pass: run the `ci-conformance` workflow by hand in the fork's Actions, or ask a maintainer for `/run-conformance` on the PR.
- **The PR,** into `main`, after #29's answer.
  - It says why: Blaster rejects an indexed type, so every symbolic G1 value fails.
  - Then: the `Fq1` part of #29, credited; the test; the conformance run.
- **If upstream says no, or fixes it another way:**
  - If #29 lands, drop ours and re-pin to `main`.
  - If they would rather Blaster translated `Fin` ([#334](https://github.com/input-output-hk/Lean-blaster/pull/334), on beta), then once our Blaster pin includes it, `Upstream.Fq1Fin` should pass on stock PlutusCoreBlaster. Drop our change then.
  - If they refuse outright, keep the fork.

## Fix 2 · `ByteStringToInteger` behind an `opaque` alias (PlutusCoreBlaster) 🚧

Done: `3dd76d7` on `feat/opaque-bytestring-to-integer`, pushed to the fork: the alias as below, and the PR's test, `Tests/Bitwise/ByteStringToIntegerSymbolic.lean` (two textual programs beside it, `bstoi_one.uplc` and `bstoi_two.uplc`, checked with `aiken uplc eval`), imported from `Tests/Basic.lean`. Its Falsified case ("some bytestring converts to 258") needs the builtin's value, so it fails on `BitVec` without the alias; it uses no `Except`. The PR text is `../blaster-forks/posts/plutuscoreblaster-pr.md`. Waiting: the owner's build, then the PR.

- **The repro, if one is wanted on our side too:** the same two programs in `Upstream/`, run as the Slice modules are. The fork's test already shows it, so this is optional.
- **The change, on the fork's branch `feat/opaque-bytestring-to-integer` from `1c23de8`.** It follows [#27](https://github.com/input-output-hk/PlutusCoreBlaster/pull/27)'s pattern, in 10–15 lines.
  - In `PlutusCore/UPLC/BuiltinFunctions/Bitwise.lean`, beside the dispatch at line 43, add `opaque byteStringToIntegerOpaque (e : Bool) (s : String) : Integer := PLC.byteStringToInteger e s`, with a doc comment like #27's.
  - The dispatch calls it.
  - `PlutusCore.Bitwise.byteStringToInteger` stays a `def`, so `Bitwise/Lemmas.lean`'s two `rfl` examples (260–261) and `Tests/Bitwise` don't change.
- **Not the variant that makes `bstoi_be_loop` opaque** (`Bitwise/Basic.lean:84`). It would leave our spec as it is, but:
  - the two `rfl` examples would have to become `native_decide`;
  - its argument is a `List Char`, which Blaster still has to declare, so it probably still reaches `BitVec`. That's from the code, not a run.
  - Try it only if a reviewer asks, and on the repro first.
- **What's lost:** Blaster can no longer evaluate the builtin on concrete arguments. Compiled evaluation doesn't change: CEK runs, `#eval`, `native_decide` and conformance.
- **`IntegerToByteString`** isn't on WalletRegister's path. Do it only if reviewers want both in one PR.
  - Keep its four guards visible, and put a new `opaque` around the loop's call, returning `String`.
  - Never make `itobs_be_loop` itself opaque: `Lemmas.lean:14–70` unfold it, and `Tests/Bitwise/Tests.lean` proves it with `rfl`.
- **The PR's test:** a `#blaster` file over a UPLC program that applies `ByteStringToInteger` to a symbolic bytestring, with one Valid case and one Falsified, imported from `Tests/Basic.lean`.
- **Our side:**
  - [Wallet.lean](../../../../../seedelf-verification/Seedelf/Wallet.lean)'s `scalarOf` calls the alias, `byteStringToIntegerOpaque true b.data`, by whatever name upstream merges.
  - `Upstream/ByteStrings` stays as it is: it calls `PlutusCore.Bitwise` directly.
  - The README's *What a ✅ is worth* says the conversion is opaque too, through a fork-only alias until it merges.
- **Checking it here:**
  - `./check.sh in forks/PlutusCoreBlaster` with the test module.
  - Pin the fork. Then `./check.sh upstream` should say `ok Upstream.Bstoi`, with `Upstream.ByteStrings` unchanged (four ❌).
  - `./check.sh` should match the baseline. PolicyBurn and PolicyMint still fail, on slicing.
- **The PR.**
  - The owner files [the PlutusCoreBlaster issue](../../../../../seedelf-verification/Upstream/drafts/plutuscoreblaster-bytestring-builtins.md), with its last line changed to point at the PR, then the PR into `main`.
  - Expect discussion: #27 has had no review since July, and the precedents that merged, #30 and #67, were rewrites with kernel lemmas.
  - The text says:
    - it's #27's pattern, one file plus a test;
    - why a rewrite can't be done today: Blaster has no `Char`, no `BitVec` and no substring;
    - that it's reverted when #153 lands.
- **If upstream says no, or fixes it another way:**
  - If they say no, keep the alias in our fork as our own patch, and say so in the README. The real fix is #153.
  - If they want another form (a rewrite, another name, another place), follow theirs and move `scalarOf` with it.

## Step 4 · WalletRegister ✅

- **Follow [chunk 40's step 5.1](chunk-40-verification-upstream.md#resuming)** with both pins in place.
  - Measure first: a valid spend in `Steps.lean`, with a real proof, and the step limit above it (2500 now).
  - Then `./check.sh Seedelf.WalletRegister`.
- **Unknown:** what `#prep_uplc` costs with six symbolic bytestrings. Rule 4 in the README warns about this.
- **When it proves:**
  - add it to `check.sh`'s default list;
  - update the README's tables: *What's proved* gains it, and *Not proved* loses its row;
  - update chunk 40's status.

## Stop rules

- **If WalletRegister is `KILLED` at the cap,** split it as chunk 40 says: one direction per module, or the signer fixed to `vkh`.
  - If the split is killed too, stop. Record the peaks here and in the README's *Not proved*.
  - The PRs stand on their own either way.
- **If a fix breaks any of the 29 proved theorems, stop.** No PR goes up calling the fix safe until a minimal case in `Upstream/` explains the break.

## Done means

- **WalletRegister is proved,** it's in `check.sh`'s default list, and the README's tables are updated.
- **Each fix is merged upstream,** or its PR is open and our pin on the fork is recorded here and in the README.
- **As each fix merges,** its require comes out, the owner runs `lake update`, and the baseline is re-run. From there, chunk 40's *How to tell each is fixed* applies.
- **Then this file moves to the archive,** as the [plans README](../../plans/README.md) says.

## Where upstream stands

Chunk 40's reads, plus:

```bash
# any machine, read-only
gh api 'repos/input-output-hk/Lean-blaster/contents/Blaster/Smt/Translate/Quantifier.lean?ref=beta-lambda-cache-optimization' --jq .content | base64 -d | grep -n 'hashcons indVal.type'
gh api 'repos/input-output-hk/PlutusCoreBlaster/contents/Cryptograph/BLS12_381/Basic.lean' --jq .content | base64 -d | grep -n 't : Fin fieldPrime'
gh pr view 335 -R input-output-hk/Lean-blaster --json state,isDraft,updatedAt
gh pr view 334 -R input-output-hk/Lean-blaster --json state,isDraft,updatedAt
gh pr view 155 -R input-output-hk/Lean-blaster --json state,mergedAt
gh pr view 29 -R input-output-hk/PlutusCoreBlaster --json state,isDraft,updatedAt
```

On 2026-11-02, both greps matched (lines 928 and 39), #335, #334 and #29 were open drafts, and #155 was open.

**Checked 2026-11-06** (from chunk 45's plan; the decisions are still the owner's):

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

## The owner's decisions

- **2026-11-02, the pause:** "I would want these upstream bugs fixed then work everything out before we continue on."
- **2026-11-02, this chunk:** "check if fixing these bugs in our own forks, potentially for their own pr, is easy enough … If we can solve it then it would be worth getting an agent to work writing a chunk for that too."
- **2026-11-02, the start:** "That does seem doable though … Do proper forks of those repos, make those changes and get the prs going. I would monitor it and see if anyone comments on the work you did." Why: "being able to use oh we are formally verification and the first privacy wallet can be big marketing wins."
- **2026-11-02, where:** forks on the personal `logicalmechanism` account, not the org ("isnt look good for the optics"); the work in a folder in the parent.

## Where it ended

- **Its PR.** The work reached `main` in **#362** (`c15603d5`, 2026-11-05), through chunk 42's branch, which was cut from `verification`.
- **The fixes, on 2026-11-07:**

  | Fix | Upstream | State |
  |---|---|---|
  | 1 · Datatype parameter names | Lean-blaster [#455](https://github.com/input-output-hk/Lean-blaster/pull/455) | Open. CONFLICTING since #155 moved it to `main`, whose line 928 still has the bug. Rebased locally onto `main` `983f10f` for the owner's check and force-push ([chunk 46](../../plans/chunk-46-verification-on-upstream.md), step 1) |
  | 2 · `ByteStringToInteger` alias | PlutusCoreBlaster [#71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71) | Merged `6b4260a` (2026-11-05). [#77](https://github.com/input-output-hk/PlutusCoreBlaster/pull/77) would replace it with the definition |
  | 3 · `Fq1.t` a `Nat` | PlutusCoreBlaster [#72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72) | Merged `0c0c1b8` (2026-11-03) |
  | 4 · BLS12-381 operand order | PlutusCoreBlaster [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73) | Open and mergeable, with no review since 2026-11-03 |

- **The pins at the end:**
  - Blaster: `25c0ee0`, kept on the fork's `seedelf` branch.
  - PlutusCore: `68c5399`, the fork's `opaque-xor`. That's #71's and #72's review rounds, #73, #27's `serialise_data` and the xor alias.
  - `Slice/`'s PlutusCore: `96261cc`, the fork's `opaque-slice`.
  - The pin table above still names `c7d8741`, the `verification` branch's.
- **Carried to chunk 46:** the two open PRs, taking out each require as its fix lands, the aliases that were never offered (#77 would make them redundant), and #71's review point on modelling `ByteString` (#77 is its answer).
