import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool, with an input between the boxes whose datum `(xa, xb)` is inline but which isn't a box (at another credential, or at mix_box malformed): each of `V2.MixAnyFirst`'s and
`V2.MixAnySecond`'s six checks, unchanged. If either box's proof fails any of them, the Mix
fails, whatever the pool, the boxes, the proofs and that input are. With
`V2.GapMixDatumBetweenPasses`, the Mix's iff holds with that input there. The passing run is
`V2.GapMixInsSteps`'. Written by the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixDatumBetween mixLogicTemplate gapDatumBetweenArgs 20000

theorem gap_mixdatumbetween_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

theorem gap_mixdatumbetween_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

theorem gap_mixdatumbetween_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

theorem gap_mixdatumbetween_needs_the_second_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

theorem gap_mixdatumbetween_needs_the_second_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

theorem gap_mixdatumbetween_needs_the_second_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedGapMixDatumBetween.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
