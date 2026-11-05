import Lovejoin.V2.MixTok2Spec
import Audit.V2.Common
import Blaster

/-! Wrong-script control for v2's general Mix of two in a token pool: mutant M1 on the same
arguments. Box 2's second-branch theorem is Falsified (one `✅ Expected Falsified`) and
Passes stays Valid (one theorem, `✅ Valid`). -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OneEqTok2 auditV2MixLogicOneEq argsPool 25000

-- M1: box 2's second-branch theorem.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
      isUnsuccessful (auditV2OneEqTok2.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

/-- M1 still passes every token Mix of two the template passes. -/
theorem audit_mixtok2_one_equation_passes :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (auditV2OneEqTok2.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok2
