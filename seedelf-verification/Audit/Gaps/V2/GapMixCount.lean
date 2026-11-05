import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool: what `V2.MixAny`'s fixed inputs can't say. Every
well-formed box among the inputs is one of the Mix's, so a third with only two proofs fails
wherever it sits: no box leaves without a proof of its own. The runs are `V2.GapMixInsSteps`'. Written by the v2-scenario audit's
`gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixThirdBefore mixLogicTemplate gapThirdBeforeArgs 20000
#prep_uplc appliedGapMixThirdBetween mixLogicTemplate gapThirdBetweenArgs 20000
#prep_uplc appliedGapMixThirdAfter mixLogicTemplate gapThirdAfterArgs 20000

/-- A third well-formed box before the two, with two proofs, fails: no box leaves uncounted. -/
theorem gap_mix_counts_a_third_box_before :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed xa xb = true →
        isUnsuccessful (appliedGapMixThirdBefore.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 xa xb) := by
  blaster (timeout: 540)

/-- A third well-formed box between the two, with two proofs, fails: no box leaves uncounted. -/
theorem gap_mix_counts_a_third_box_between :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed xa xb = true →
        isUnsuccessful (appliedGapMixThirdBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 xa xb) := by
  blaster (timeout: 540)

/-- A third well-formed box after the two, with two proofs, fails: no box leaves uncounted. -/
theorem gap_mix_counts_a_third_box_after :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed xa xb = true →
        isUnsuccessful (appliedGapMixThirdAfter.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 xa xb) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
