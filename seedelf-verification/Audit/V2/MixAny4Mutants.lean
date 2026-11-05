import Lovejoin.V2.MixAny4Box1
import Lovejoin.V2.MixAny4Box4
import Lovejoin.V2.MixAny4Passes
import Audit.V2.Common
import Blaster

/-! Mutants of v2's general Mix of four in an ADA pool, as `Audit.V2.MixAnyMutants` has them
at n = 2. Six `✅ Expected Falsified`; a Valid one fails the build.

1. Passes with box in 4's fourth branch dropped from the spec, and 2. box in 3's second.
3. Box 1's third branch checked against box out 4 instead of 3.
4. Box 1's first-branch theorem over `auditBranchHoldsT1`.
5. Box 1's theorem with the hypothesis `z11 ≠ z44`, and 6. box 4's with `oa1 ≠ oa4`.

Each is asked at one instance, as `Audit.V2.MixAny4Vacuity`'s are: the boxes in share their
points `(a, b)` and their branches, `(t0j, t1j, cj, zj)` for box out j. In 1 and 2 the dropped
branch keeps its own `z`: with box 1's, the other boxes' copies of that branch would put it
back in the weakened spec. Over every input each timed out (⚠️ Undetermined, 2026-11-03).
`Audit.V2.MixAny4Guards` refutes the general forms of 3 to 6 on the real builtins: the KAT's
four distinct boxes halt in its `.exec` run, and each changed hypothesis holds of them. -/

namespace Lovejoin.V2.Any4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

set_option linter.unusedVariables false in
/-- `mixAcceptsPool` without box in 4's fourth branch. -/
def auditMixAcceptsPoolNo44 (M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) : Bool :=
  inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a2 b2 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a3 b3 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 &&
    (challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a4 b4 t041 t141 c41 t042 t142 c42 t043 t143 c43 t044 t144 c44 &&
      branchHolds a4 b4 oa1 ob1 t041 t141 c41 z41 &&
      branchHolds a4 b4 oa2 ob2 t042 t142 c42 z42 &&
      branchHolds a4 b4 oa3 ob3 t043 t143 c43 z43)

set_option linter.unusedVariables false in
/-- `mixAcceptsPool` without box in 3's second branch. -/
def auditMixAcceptsPoolNo32 (M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) : Bool :=
  inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a2 b2 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 &&
    (challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a3 b3 t031 t131 c31 t032 t132 c32 t033 t133 c33 t034 t134 c34 &&
      branchHolds a3 b3 oa1 ob1 t031 t131 c31 z31 &&
      branchHolds a3 b3 oa3 ob3 t033 t133 c33 z33 &&
      branchHolds a3 b3 oa4 ob4 t034 t134 c34 z34) &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 a4 b4 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44

-- 1. Passes, box in 4's fourth branch dropped from the spec; it keeps its own z44.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 z44 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a b = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
    auditMixAcceptsPoolNo44 M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z44 = true →
      isSuccessful (appliedMixAny4Passes.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z44)]

-- 2. Passes, box in 3's second branch dropped from the spec; it keeps its own z32.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 z32 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a b = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
    auditMixAcceptsPoolNo32 M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z32 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 = true →
      isSuccessful (appliedMixAny4Passes.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z32 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 3. Box 1's third branch checked against box out 4.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    branchHolds a b oa4 ob4 t03 t13 c3 z3 = false →
      isUnsuccessful (appliedMixAny4Box1.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 4. Box 1's first branch over a wrong equation (T1 for T0).
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    auditBranchHoldsT1 a b oa1 ob1 t01 t11 c1 z1 = false →
      isUnsuccessful (appliedMixAny4Box1.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 5. An unrelated hypothesis: z11 ≠ z44, here z1 ≠ z4.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    z1 ≠ z4 →
      isUnsuccessful (appliedMixAny4Box1.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 6. An unrelated hypothesis: oa1 ≠ oa4.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    oa1 ≠ oa4 →
      isUnsuccessful (appliedMixAny4Box4.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

end Lovejoin.V2.Any4
