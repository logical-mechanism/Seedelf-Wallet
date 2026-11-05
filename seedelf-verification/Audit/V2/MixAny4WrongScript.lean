import Lovejoin.V2.MixAny4Spec
import Audit.V2.Common
import Blaster

/-! Wrong-script control for v2's general Mix of four in an ADA pool: mutant M1 (each branch
checks `z·a = t0 + c·a'` alone) on the same arguments. Box 4's fourth-branch theorem is
Falsified (one `✅ Expected Falsified`) and Passes stays Valid (one theorem, `✅ Valid`).

The control is asked at one instance, as `Audit.V2.MixAny4Vacuity`'s are: the boxes in share
their points and branches. M1 checks no branch's second equation, so the instance keeps the
control falsifiable. Over every input it timed out (⚠️ Undetermined, 2026-11-03). -/

namespace Lovejoin.V2.Any4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OneEqAny4 auditV2MixLogicOneEq argsPool 60000

-- M1: box 4's fourth-branch theorem.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    branchHolds a b oa4 ob4 t04 t14 c4 z4 = false →
      isUnsuccessful (auditV2OneEqAny4.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

/-- M1 still passes every Mix of four the template passes. -/
theorem audit_mixany4_one_equation_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
      mixAcceptsPool M bl a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 = true →
        isSuccessful (auditV2OneEqAny4.prop P M bl a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any4
