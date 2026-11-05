import Audit.V2.MixAnyPayer
import Blaster

/-! v2's general Mix of two in an ADA pool with a payer's input between the boxes
(`Audit.V2.MixAnyPayer`): the first box's challenge theorem and Passes, each `✅ Valid`, as
`V2.MixAnyFirst` and `V2.MixAnyPasses` state them for the two-input scenario. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2PayerBetween mixLogicTemplate auditArgsBetween 30000

/-- With a payer between the boxes, a Mix whose first box's `c`s don't xor to its `c_global` fails. -/
theorem audit_mix_any_payer_between_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (auditV2PayerBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- With a payer between the boxes, a Mix with both proofs verifying succeeds. -/
theorem audit_mix_any_payer_between_passes_with_both_proofs :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (auditV2PayerBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
