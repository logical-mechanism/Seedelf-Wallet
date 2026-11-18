# r2verif#5: verification

From lane R2verif, graded low by its finder.

## Trace: confirmed, low

The finding holds. README.md:95's new Controls bullet (40883a55) says the every-transaction families have #194 negative controls "each over the family's own builder". The only exceptions it names are Signers' other lengths, the Mix families and Owner3/Owner4.

In Blaster at the pin, every `by blaster` and `#blaster` is its own SMT query: a fresh TranslateEnv, its own Z3 process, and declarations for that goal's prepared term only. So a control probes the background of the one `#prep_uplc` builder it names, and nothing else. What the controls actually reach:
- the wallet families: 8 of 50 builders (Purpose 1 of 5, NoLock 1 of 18, Redeemer 1 of 22), which leaves 42 of those three families' 45 ✅ unprobed;
- the controlled Lovejoin families: 11 of 32 builders;
- Template.AnyTxPurposes: none of its 16 builders. It carries 17 ✅ (not 15), it's in check.sh's lovejoin-any-tx, and the bullet doesn't list it as an exception.

Corrections:
- AnyTxPurposes carries 17 ✅. Two of its theorems split `by` and `blaster` across lines, which a grep for `by blaster` misses. 17 matches chunk 42's record.
- Drop the fee_contract sentence. fee_contract is out of the chunk, and the root README already puts it outside the claim (README:101 and *Not proved*).
- One more member of the class: the bullet's policy "cut" controls are builders prepared on their own (e.g. appliedPolSpendingCut at 155 steps). They reach none of the policy families' 40 theorem builders. Their own comment says they show each run ends inside the step limit.

Grade: low.
- Who: nobody.
- Cost: nothing today. CLAIMS cites the kernel for every contract, and AnyTxPurposes' statements are re-proved in the kernel (PurposesKernel, LogicPublishKernel, BoxPurposesAll).
- What's overstated is how far the #194 probe reaches. That matters at the next re-run (chunk 46's re-pin, chunk 49 step 5(b)), where a vacuous ✅ over an unprobed builder would stay green.

**Evidence:**

All paths are under FIXTREE/seedelf-verification at HEAD f88560c4. Nothing under seedelf-verification is modified in the working copy (`git status --short seedelf-verification` is empty), and every read came from `git show HEAD:` or a `git archive HEAD` export.

**1. The claim.** README.md:95 reads: "A contradictory background in the solver (#194) would make every ✅ over it say nothing. So the every-transaction families have negative controls … `AnyTxControls` and `WalletAnyTxControls` …, `Signers/`' `Control4`, `Control64` and `Control127`, and Lovejoin's `AnyTx/FalsifiedBox` and `FalsifiedOwner`, each over the family's own builder; `Control128`, over 128's builder prepared again; a run cut a step short in each policy module; and `Slice/`'s `Controls`. Of `Signers/`' 125 lengths, those four have one. Lovejoin's Mix families and its three- and four-box Owners have none yet."
- Rule 8 (README.md:216) puts a control's reach per builder: "every statement over that builder would come back Valid".

**2. Why a control reaches only the builder it names.** Blaster at the pin (.lake/packages/Blaster, 25c0ee0):
- Command/Tactic.lean:49-53 and Smt/Translate.lean:98-101 start each tactic call and each `#blaster` with `{(default : TranslateEnv) …}`.
- Translate.main (Smt/Translate.lean:51-76):
  - optimizes that one goal;
  - spawns its own Z3 (`setBlasterProcess`, :64, which calls Env.lean:704-708, which calls `createBlasterProcess` at :105);
  - translates only that goal's term, asserts its negation, checks sat;
  - exits the solver (`exitSmt`, :72).
- Nothing crosses from one goal to the next. Each `#prep_uplc NAME` is its own prepared term, so a builder's background is what its term reaches.
- The controls' docstrings give the opposite reasoning, "so the solver meets the same script as the theorems do" (AnyTxControls.lean:10-11, WalletAnyTxControls.lean:8-9, FalsifiedBox.lean:13-14, FalsifiedOwner.lean:10-11). The script is the same; the query isn't.

**3. What each control names:**
- AnyTxControls.lean:21-31: appliedAlwaysFalseAnyContext, appliedAnyTxMinting, appliedAnyTxNoDatum, appliedAnyRedeemerThirdI.
- WalletAnyTxControls.lean:23-44: appliedAnyTxRegister, Register0, Register2, Register3.
- FalsifiedBox.lean:28-115: boxNone, boxMissing, boxSuffixAfter, boxInlineAny, emptyOwner, refAbsent, launchSeedAny.
- FalsifiedOwner.lean:26-74: ownerOne, twoOwners, soloOwner, ownerOtherInputs.
- The policy's controls are prepared on their own, e.g. PolicyPurposeAnyTx.lean:61-65 `#prep_uplc appliedPolSpendingCut seedelf polSpendingArgs 155`. Its comment at :58-60 says it shows "the runs reach Error inside the limit".

**4. The scan** (r2verif5_scan.py, quoted under test_result). It counts each check with tally.py's own `strip()` and `expected()`, and its per-check split matches tally's count in all 1014 modules. All 787 builder names are unique, so `.prop` names resolve without ambiguity. Results:
- Wallet: 50 builders, 8 named.
- Lovejoin's controlled families: 32 builders, 11 named.
- AnyTxPurposes: 16 builders, 17 ✅, 0 named. It isn't in the bullet and no exception covers it.
- The only builders with a Nat-typed argument (NoLock's and Redeemer's ConstrPos and ConstrNeg) are all unprobed. Nat is the sort whose off-domain values #194's unguarded definitions range over.

**5. Nothing else probes these builders:**
- Audit/diag/list-all.txt has 304 lines and names no every-transaction theorem, and no diag file imports such a module.
- tally.py checks counts per module: the fixture family with one control reads `0 not ok`.

**6. The fixture run** (step 4 of the test, the copy's own scan-diag.py on dumps in Blaster's form, using its encoding: unguarded `@lambda…_def_cstr` at Application.lean:1219-1224 and a guarded `@apply…_ext_fun` at Quantifier.lean:755). When builder B's background is contradictory:
- B's ✅ on a false statement replays as full=unsat with bg=unsat: vacuous.
- The family's one control, over A, is full=sat, i.e. Falsified as it must be, so the build passes.
- A control over B would be full=unsat, i.e. Valid, which logs ❌ Unexpected Valid and fails the build.

**7. Nothing rests on these modules:**
- CLAIMS.md:13-21 cites only kernel theorems; :23 calls the Wallet*AnyTx modules "Blaster cross-checks"; :27 says every claim is kernel-checked.
- AnyTxPurposes' statements are re-proved by `cek_v3` in PurposesKernel.lean:19-141 and LogicPublishKernel.lean:18-61, and mix_box's purposes in BoxPurposesAll.

**8. Caveat, cutting both ways.** Which ✅ reach Z3 at all has never been measured: the audit's blaster-unguarded-axioms-unmeasured item says so, and no diag run is recorded. The optimizer can close a goal as True or False with no Z3 (Env.lean:25-29 `toResult`; Translate.lean:74-76). A control decided that way still logs "✅ Expected Falsified" (Env.lean:61-66) and probes nothing.

**Since:** 40883a55 (README bullet and rule 8).

**Known:** Not known.

Searched docs/backlog.md, archive/plans/, the chunk-46 and chunk-49 plans, review-51's INDEX.md, owner-calls.md, FIX.md, fix-branches.md and fixes/, and verify/ (v4a-1, v4b-1). Terms: 'own builder', 'one builder', 'each builder', 'every builder', 'per builder', 'AnyTxPurposes', 'rule 8', '#194', 'Expected Falsified', 'negative control'. Also searched Audit/review/findings.json and the README's *Not proved* for controls. SECURITY.md was checked too: the #194 bug itself belongs to a third-party dependency, but the controls and their docs are our own suite.

Hits, and why none settles it:
- v4a-1 and v4b-1: the findings whose fix (40883a55) wrote this bullet. v4a-1 fix note 2 already says a control probes a theorem's background only when it shares that theorem's .prop.
- Chunk 42's record: AnyTxPurposes `ok`, 17 ✅.
- Audit finding blaster-unguarded-axioms-unmeasured: the #194 class, "closed by Audit/diag". Diag's 304-line list names no every-transaction theorem.
- Chunk-49 call 6 (❓, keep or retire the Blaster Seedelf modules): bears on timing only.
- Nothing on the bullet itself, which this round added.

**Fix notes:**

**Class.** The #194 controls' coverage is stated per family or module, but Blaster's probe works per query, that is, per prepared builder. Members:
- README.md:95 (this bullet);
- README.md:216, rule 8 ("Give each family a control … over the family's own builder");
- Lovejoin/AnyTx/README.md:251-255;
- the four control modules' docstrings ("so the solver meets the same script as the theorems do": AnyTxControls.lean:10-12, WalletAnyTxControls.lean:8-10, FalsifiedBox.lean:13-16, FalsifiedOwner.lean:9-12);
- the bullet's "a run cut a step short in each policy module": those builders are prepared on their own (e.g. PolicyPurposeAnyTx.lean:61) and reach none of the policy's 40 theorem builders;
- tally.py, which checks control counts per module and can't see an unprobed builder.

**1. Docs only (no build, no owner call).** Say what's probed, counted the way the bullet already counts Signers'. For example: "the wallet's controls reach 8 of its 50 builders: one each of Purpose's 5, NoLock's 18 datum shapes and Redeemer's 22, and every Register builder; Lovejoin's reach 11 of their families' 32; Template.AnyTxPurposes' 16 have none (its statements are kernel-checked in PurposesKernel and LogicPublishKernel, mix_box's in BoxPurposesAll); the policy's cut runs show each run ends inside its limit, not that the theorems' backgrounds are consistent."
- Add AnyTxPurposes to the exceptions in both READMEs.
- Reword rule 8 to "each builder".
- Fix the four docstrings: "the same prepared builder as that theorem; the family's other builders are other queries".
- Leave fee_contract out: it's out of the chunk and outside the claim already.

**2. Measure first, if the owner wants the reach itself (their Lean run).** Add the every-transaction theorems to Audit/diag's lists (v4a-1 fix note 1; today none of the 304 lines names one) and run scan-diag. Its `.bg` replay checks each theorem's own background directly. Its OPT-ONLY column shows which ✅ never reach Z3; those need no control.

**3. Then per-builder controls where a ✅ reaches Z3.**
- NoLock's 17 and Redeemer's 21 unprobed builders, and Purpose's 4: one mechanical flipped line each (`returnsUnit` and `isUnsuccessful` swapped).
- AnyTxPurposes' 15 failure theorems flip the same way; its publish iff gets the condition reversed.
- Lovejoin's 21 unprobed builders.
- One caution: a control the optimizer decides alone logs "✅ Expected Falsified" (Env.lean:61-66, Translate.lean:74-76) yet probes nothing. The diag's verdict column says which controls reach Z3.

**Timing and owner.** This matters at the next re-run (chunk 46's re-pin, chunk 49 step 5(b)). It's moot for the Seedelf modules if chunk 49's call 6 retires them. No refusal, privacy default or screen changes. New controls need the owner's `./check.sh` build.

**Test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_5-trace/r2verif5_test.sh`

Result: Ran with `systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 timeout 10m bash r2verif5_test.sh`. No Lean or lake was built. Full output: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_5-trace/r2verif5_test.out (tmpfs, not kept). Excerpts:

== 1. HEAD f88560c4; README.md:95 is the Controls bullet.
== 2.
every module's Valid/Falsified count matches tally.py's expected() (1014 modules)
module                     builders with a ✅  probed   ✅  ✅ unprobed  probed builder(s)
Seedelf.AlwaysFalseAnyTx          1      1    1    0  appliedAlwaysFalseAnyContext
Seedelf.WalletPurposeAnyTx        5      1    5    4  appliedAnyTxMinting
Seedelf.WalletNoLockAnyTx        18      1   18   17  appliedAnyTxNoDatum   (Nat-typed builder args: probed 0, unprobed 2: appliedAnyTxConstrPos, appliedAnyTxConstrNeg)
Seedelf.WalletRedeemerAnyTx      22      1   22   21  appliedAnyRedeemerThirdI   (Nat-typed builder args: probed 0, unprobed 2: appliedAnyRedeemerConstrPos, appliedAnyRedeemerConstrNeg)
Seedelf.WalletAnyTx               2      2    5    0
Seedelf.WalletAnyTxTwo            1      1    4    0
Seedelf.WalletAnyTxThree          1      1    4    0
Seedelf.Policy{Purpose,Redeemer,Lines,LinesFour,LinesFive}AnyTx   5/4/7/8/16 builders, 0 probed (the cut controls are their own builders)
Lovejoin.Template.AnyTxPurposes  16      0   17   17  -
Lovejoin.AnyTx.LogicEmpty         3      1    3    2  emptyOwner
Lovejoin.AnyTx.BoxGate            3      1    5    3  boxNone
Lovejoin.AnyTx.BoxBoundary        3      1    4    3  boxMissing
Lovejoin.AnyTx.BoxSuffix          3      1    3    2  boxSuffixAfter
Lovejoin.AnyTx.OwnerLayouts       2      1    4    2  soloOwner
Lovejoin.AnyTx.OwnerTwo           2      1    4    1  twoOwners
Lovejoin.AnyTx.Reference          8      1   11   10  refAbsent
Lovejoin.AnyTx.Launch             5      1    6    4  launchSeedAny
(OwnerOne, BoxDatum, OwnerOtherInputs: 1 of 1 each)
TOTAL                           176     19  298  263
Signers/: 125 builders with a ✅, 3 named by a control (appliedSig127, appliedSig4, appliedSig64); Control128 prepares its own
README.md:95 … Modules with a ✅ and no control over any of their builders:
  Lovejoin.Template.AnyTxPurposes  16 builders  17 ✅   NOT NAMED, NO EXCEPTION
  Lovejoin.AnyTx.FeePurpose / FeeSpend / FeeRecovery / FeeMix   NOT NAMED, NO EXCEPTION  (fee_contract: out of the chunk)
  Owner3, Owner4: exception "three- and four-box Owners"; the 12 Mix modules: exception "Lovejoin's Mix families"; the 5 policy modules: "a run cut a step short"
== 3.
-- tally.py (the copy's) on the fixture:
== fx/Fx: 2 modules, 2 Valid, 1 Expected Falsified, 0 not ok
Fx.Family    2 builders  1 probed  2 ✅  1 unprobed  fxA
== 4. scan-diag.py (the copy's):
Z3       D900_thm_a_over_fxA  lam=0 rec=0 recNat=0 ext=0 coe=0 sorts=0  full=unsat bg=sat prem=sat
Z3       D901_thm_b_over_fxB  lam=2 rec=0 recNat=0 ext=1 coe=0 sorts=1  full=unsat bg=unsat prem=unsat  <-- LOOK
Z3       D902_control_over_fxA  lam=0 rec=0 recNat=0 ext=0 coe=0 sorts=0  full=sat bg=sat prem=sat  <-- LOOK
Z3       D903_control_over_fxB_fix  lam=2 rec=0 recNat=0 ext=1 coe=0 sorts=1  full=unsat bg=unsat prem=unsat  <-- LOOK
4 theorems; 0 closed by the optimizer alone; 4 needed Z3; 0 failed; 3 flagged; 0 inconclusive

How to read step 4:
- D901: builder fxB's ✅ on a false statement (fxB x = 42) is vacuous, bg=unsat.
- D902: the family's one control, over fxA, is full=sat, i.e. Falsified as required, so the build passes. scan-diag flags it only because it treats every row as a ✅.
- D903: a control over fxB would be full=unsat, i.e. Valid, which logs ❌ Unexpected Valid and fails the build.

The finding's counts all reproduce: 8 of 50 wallet builders, 11 of 32 Lovejoin, AnyTxPurposes 0 of 16. One correction: AnyTxPurposes carries 17 ✅, not 15.

```
===== /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_5-trace/r2verif5_test.sh =====
#!/usr/bin/env bash
# r2verif#5: how far the every-transaction controls reach. No Lean is built: the copy's own
# tally.py and Audit/diag/scan-diag.py read fixture traces and dumps written here, and
# r2verif5_scan.py reads HEAD's sources with tally.py's own counting.
#   bash r2verif5_test.sh            (under systemd-run's memory cap and a timeout)
SCR=$(cd "$(dirname "$0")" && pwd)
FIX=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes
cd "$SCR" || exit 1

echo "== 1. HEAD's seedelf-verification, exported (the committed code, not the working copy)"
rm -rf src && mkdir -p src
git -C "$FIX" archive HEAD seedelf-verification | tar -x -C src --exclude='seedelf-verification/.lake'
echo "HEAD $(git -C "$FIX" rev-parse --short HEAD); README.md:95 is:"
sed -n '95p' src/seedelf-verification/README.md | cut -c1-400

echo; echo "== 2. Builders, their ✅ and the controls that name them (check.sh's families)"
python3 -I r2verif5_scan.py src/seedelf-verification

echo; echo "== 3. A fixture family as the tree builds one: two builders, one control over the first"
rm -rf fx && mkdir -p fx/Fx fx/.lake/build/lib/lean/Fx
cat > fx/Fx/Family.lean <<'EOF'
import Blaster
/-! Fixture (never built): one script, two builders, a theorem over each. -/
namespace Fx
#prep_uplc fxA script argsA 10
#prep_uplc fxB script argsB 10
theorem thm_a : ∀ x, isUnsuccessful (fxA.prop x) := by blaster
theorem thm_b : ∀ x, isUnsuccessful (fxB.prop x) := by blaster
end Fx
EOF
cat > fx/Fx/FamilyControls.lean <<'EOF'
import Fx.Family
import Blaster
/-! Fixture: the family's control, "over the family's own builder" (fxA), as the tree's are. -/
namespace Fx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ x, returnsUnit (fxA.prop x)]
end Fx
EOF
sleep 1
# What Blaster logs for them (Env.lean logResult): thm_b's ✅ reads the same whether its
# background is sound or contradictory.
cat > fx/.lake/build/lib/lean/Fx/Family.trace <<'EOF'
{"log": [{"level": "information", "message": "✅ Valid"},
         {"level": "warning", "message": "declaration uses 'blasterProven' (SMT-verified, no proof term)"},
         {"level": "information", "message": "✅ Valid"},
         {"level": "warning", "message": "declaration uses 'blasterProven' (SMT-verified, no proof term)"}]}
EOF
cat > fx/.lake/build/lib/lean/Fx/FamilyControls.trace <<'EOF'
{"log": [{"level": "information", "message": "✅ Expected Falsified"}]}
EOF
echo "-- tally.py (the copy's) on the fixture:"
python3 -I src/seedelf-verification/tally.py fx/Fx
echo "-- the scan on the fixture:"
python3 -I r2verif5_scan.py fx --families fixture --tally src/seedelf-verification/tally.py

echo; echo "== 4. Each goal is its own query (Translate.main: fresh env, own z3). The fixture's four"
echo "   queries, in Blaster's dump form, replayed by the copy's scan-diag.py:"
rm -rf fxdiag && mkdir -p fxdiag/out
prelude='(set-option :print-success true)
(set-option :produce-models true)
(set-option :smt.pull-nested-quantifiers true)
(set-option :smt.mbqi true)
(set-option :auto_config false)
(set-simplifier recfun-finder)
(set-option :smt.macro_finder true)
(set-option :smt.qi.persist_instances true)
(set-option :smt.arith.nl.grobner_expand_terms false)
(set-option :smt.arith.nl.reduce_pseudo_linear false)
(set-option :smt.arith.nl.grobner_exp_delay false)
(define-sort Nat () Int)
(define-fun @isNat ((@x Nat)) Bool (<= 0 @x))
(define-fun @natSub ((@x Nat) (@y Nat)) Nat (ite (< @x @y) 0 (- @x @y)))'
# builder A's background: what its prepared term reaches, here no lambda
bgA='(define-fun @fxA ((@x Nat)) Nat (+ @x 1))'
# builder B's background: the same script, plus two lambdas only B's term reaches. Each
# definition is unguarded over Int (Application.lean:1219-1224); extensionality is guarded by
# @isNat (Quantifier.lean:755). λn, n and λn, n - 0 agree on every Nat and differ at -1: #194.
bgB='(declare-sort @ArrowT2 2)
(declare-fun @apply2 ((@ArrowT2 Nat Nat) Nat) Nat)
(declare-const @lambda1 (@ArrowT2 Nat Nat))
(assert (forall (($1 Nat)) (! (= (@apply2 @lambda1 $1) $1) :pattern ((@apply2 @lambda1 $1)) :qid @lambda1_def_cstr)))
(declare-const @lambda2 (@ArrowT2 Nat Nat))
(assert (forall (($1 Nat)) (! (= (@apply2 @lambda2 $1) (@natSub $1 0)) :pattern ((@apply2 @lambda2 $1)) :qid @lambda2_def_cstr)))
(assert (forall ((@f (@ArrowT2 Nat Nat)) (@g (@ArrowT2 Nat Nat))) (! (=> (forall (($2 Nat)) (=> (@isNat $2) (= (@apply2 @f $2) (@apply2 @g $2)))) (= @f @g)) :qid @apply2_ext_fun)))
(define-fun @fxB ((@x Nat)) Nat (@apply2 @lambda1 @x))'
dump() {  # name, background, negated goal
  printf 'Smt Query:\n%s\n%s\n(declare-const $0 Nat)\n%s\n/tmp/fx.lean:4:0: warning: ⚠️ Undetermined\nrc=0\n' \
    "$prelude" "$2" "$3" > "fxdiag/out/$1.txt"
}
dump D900_thm_a_over_fxA        "$bgA" '(assert (not (=> (@isNat $0) (< 0 (@fxA $0)))))'
dump D901_thm_b_over_fxB        "$bgB" '(assert (not (=> (@isNat $0) (= (@fxB $0) 42))))'
dump D902_control_over_fxA      "$bgA" '(assert (not (=> (@isNat $0) (= (@fxA $0) 0))))'
dump D903_control_over_fxB_fix  "$bgB" '(assert (not (=> (@isNat $0) (= (@fxB $0) (+ $0 1)))))'
python3 -I src/seedelf-verification/Audit/diag/scan-diag.py fxdiag/out --timeout 30
echo
echo "Reading: D900 is thm_a's sound ✅ (full=unsat, bg=sat). D901 is thm_b's ✅ on a false"
echo "statement (fxB x = 42): full=unsat only because bg=unsat, the vacuous ✅ #194 makes."
echo "D902 is the family's one control, over fxA: full=sat is Falsified, what it must give, so"
echo "the build passes (scan-diag, made for ✅, flags any full=sat). D903 is a control over fxB:"
echo "full=unsat is Valid, which under solve-result 1 logs ❌ Unexpected Valid and fails the build."

===== /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_5-trace/r2verif5_scan.py =====
"""r2verif#5: which builders the every-transaction controls reach.

    python3 -I r2verif5_scan.py <seedelf-verification copy> [--families check|fixture]

Reads a copy of seedelf-verification (git archive of FIXTREE HEAD), never a tree. Counts each
module's Blaster checks with tally.py's own strip() and expected() (exec'd from the copy's
tally.py, its main loop left out), then pins each check to the #prep_uplc builders whose `.prop`
it names: a theorem proved `by blaster` is a Valid check, a `#blaster (solve-result: 1)` block a
control. Each Blaster goal is its own SMT query (Translate.main: a fresh TranslateEnv and Z3
process per goal), so a control probes the background of the builders it names and no other.
The families are check.sh's own arrays (any_tx, any_tx_v2), parsed from the copy's check.sh."""
import ast, glob, os, re, sys

SV = os.path.abspath(sys.argv[1])
mode = sys.argv[sys.argv.index('--families') + 1] if '--families' in sys.argv else 'check'
TALLY = sys.argv[sys.argv.index('--tally') + 1] if '--tally' in sys.argv else os.path.join(SV, 'tally.py')

# tally.py's own counting functions, nothing else of it
tsrc = open(TALLY, encoding='utf-8').read()
body = [n for n in ast.parse(tsrc).body
        if isinstance(n, (ast.Import, ast.ImportFrom))
        or (isinstance(n, ast.FunctionDef) and n.name in ('strip', 'expected'))]
ns = {}
exec(compile(ast.Module(body=body, type_ignores=[]), 'tally.py', 'exec'), ns)
strip, expected = ns['strip'], ns['expected']

IMPORT = r"(?<![\w.])import\s+([A-Za-z_][\w.]*)"
CHECK = r"#blaster((?:\s*\([^()]*\))*)"


def mod_of(path):
    return os.path.relpath(path, SV)[:-len('.lean')].replace(os.sep, '.')


srcs = {}
for p in glob.glob(os.path.join(SV, '**', '*.lean'), recursive=True):
    if '/.lake/' in p:
        continue
    srcs[mod_of(p)] = strip(open(p, encoding='utf-8').read())


def closure(mod, seen=None):
    seen = set() if seen is None else seen
    for imp in re.findall(IMPORT, srcs.get(mod, '')):
        if imp in srcs and imp not in seen:
            seen.add(imp); closure(imp, seen)
    return seen


def bracket(code, i):
    """The text of the [...] that opens at code[i] == '['."""
    depth = 0
    for j in range(i, len(code)):
        if code[j] == '[':
            depth += 1
        elif code[j] == ']':
            depth -= 1
            if depth == 0:
                return code[i + 1:j]
    return code[i + 1:]


def checks(code):
    """[(kind, statement text)], kind 'valid' or 'control', one per Blaster check."""
    out = []
    for m in re.finditer(CHECK, code):
        r = re.search(r"solve-result:\s*(\d)", m.group(1))
        k = int(r.group(1)) if r else 0
        j = m.end()
        while j < len(code) and code[j].isspace():
            j += 1
        stmt = bracket(code, j) if j < len(code) and code[j] == '[' else ''
        if k in (0, 1):
            out.append(('valid' if k == 0 else 'control', stmt))
    rest = re.sub(CHECK, '', code)
    for m in re.finditer(r"\bblaster\b", rest):
        start = max(rest.rfind('theorem ', 0, m.start()), rest.rfind('example', 0, m.start()),
                    rest.rfind('lemma ', 0, m.start()))
        out.append(('valid', rest[start:m.start()] if start >= 0 else ''))
    return out


builders = {}   # name -> [module, ...]
binders = {}    # (module, name) -> the args function's signature has a Nat binder
for mod, code in srcs.items():
    for m in re.finditer(r"#prep_uplc\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)", code):
        builders.setdefault(m.group(1), []).append(mod)
        d = re.search(r"\bdef\s+" + re.escape(m.group(3)) + r"\b([^=]*):=", code)
        binders[(mod, m.group(1))] = bool(d and re.search(r":\s*Nat\s*\)", d.group(1)))


def resolve(name, mod):
    """The module defining builder `name` that `mod` sees: itself or one it imports."""
    cands = builders.get(name, [])
    if mod in cands:
        return mod
    seen = closure(mod)
    vis = [c for c in cands if c in seen]
    return vis[0] if len(vis) == 1 else (None if not vis else ('AMBIGUOUS', tuple(vis)))


valid_over, control_over = {}, {}   # (module, builder) -> count
mismatch = []
for mod, code in srcs.items():
    cs = checks(code)
    ev, ef = expected(code)
    nv = sum(k == 'valid' for k, _ in cs); nc = sum(k == 'control' for k, _ in cs)
    if (nv, nc) != (ev, ef):
        mismatch.append(f"{mod}: tally.py expects {ev} Valid/{ef} Falsified, this scan found {nv}/{nc}")
    for kind, stmt in cs:
        for b in sorted(set(re.findall(r"\b([A-Za-z_][\w']*)\.prop\b", stmt))):
            where = resolve(b, mod)
            if where is None or isinstance(where, tuple):
                continue
            tgt = valid_over if kind == 'valid' else control_over
            tgt[(where, b)] = tgt.get((where, b), 0) + 1

if mismatch:
    print('COUNT MISMATCH with tally.py:'); [print('  ', l) for l in mismatch]
else:
    print(f"every module's Valid/Falsified count matches tally.py's expected() ({len(srcs)} modules)")


def family_list():
    if mode == 'fixture':
        return sorted(m for m in srcs if m.startswith('Fx.'))
    sh = open(os.path.join(SV, 'check.sh'), encoding='utf-8').read()
    mods = []
    for arr in ('any_tx', 'policy_any_tx', 'any_tx_v2'):
        m = re.search(r"^" + arr + r"=\((.*?)\)", sh, re.M | re.S)
        mods += [x for x in m.group(1).split() if not x.startswith('"')]
    return mods


def row(mod):
    bs = [b for (m, b) in valid_over if m == mod]
    probed = [b for b in bs if (mod, b) in control_over]
    v_all = sum(valid_over[(mod, b)] for b in bs)
    v_unprobed = sum(valid_over[(mod, b)] for b in bs if b not in probed)
    nat_unprobed = [b for b in bs if b not in probed and binders.get((mod, b))]
    nat_probed = [b for b in probed if binders.get((mod, b))]
    return bs, probed, v_all, v_unprobed, nat_unprobed, nat_probed


print(f"\n{'module':38} {'builders with a ✅':>17} {'probed':>6} {'✅':>4} {'✅ unprobed':>11}  probed builder(s)")
tot = [0, 0, 0, 0]
zero = []
for mod in family_list():
    if mod not in srcs:
        continue
    bs, probed, v_all, v_un, nat_un, nat_pr = row(mod)
    if not bs:
        continue
    tot[0] += len(bs); tot[1] += len(probed); tot[2] += v_all; tot[3] += v_un
    if not probed:
        zero.append((mod, len(bs), v_all))
    extra = f"   (Nat-typed builder args: probed {len(nat_pr)}, unprobed {len(nat_un)}: {', '.join(nat_un)})" if nat_un else ''
    print(f"{mod:38} {len(bs):>17} {len(probed):>6} {v_all:>4} {v_un:>11}  {', '.join(probed) or '-'}{extra}")
print(f"{'TOTAL':38} {tot[0]:>17} {tot[1]:>6} {tot[2]:>4} {tot[3]:>11}")

if mode == 'check':
    sig = sorted((m, b) for (m, b) in valid_over if m.startswith('Seedelf.Signers.Signers'))
    sp = [x for x in sig if x in control_over]
    print(f"\nSigners/: {len(sig)} builders with a ✅, {len(sp)} named by a control "
          f"({', '.join(b for _, b in sp)}); Control128 prepares its own")
    readme = open(os.path.join(SV, 'README.md'), encoding='utf-8').read().split('\n')
    k = next(i for i, l in enumerate(readme) if l.startswith('- **Controls.**'))
    bullet = readme[k]
    print(f"\nREADME.md:{k + 1} is the Controls bullet. Modules with a ✅ and no control over any of "
          "their builders, and whether the bullet names them or an exception covers them:")
    exceptions = {  # the bullet's own words, mapped by hand
        "Lovejoin's Mix families": lambda m: m.startswith('Lovejoin.AnyTx.Mix'),
        "three- and four-box Owners": lambda m: m in ('Lovejoin.AnyTx.Owner3', 'Lovejoin.AnyTx.Owner4'),
        "a run cut a step short in each policy module": lambda m: m.startswith('Seedelf.Policy'),
    }
    for mod, nb, nv in zero:
        short = mod.split('.')[-1]
        named = short in bullet
        cover = [w for w, f in exceptions.items() if f(mod)]
        verdict = 'named' if named else (f"exception: {cover[0]}" if cover else 'NOT NAMED, NO EXCEPTION')
        print(f"  {mod:38} {nb:>3} builders {nv:>3} ✅   {verdict}")
```
