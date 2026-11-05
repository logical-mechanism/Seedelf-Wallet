import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool, reading two reference-script UTxOs beside the pool's
reference input, as every Mix the wallet builds does: the Mix's iff unchanged, its six
checks and the converse. `V2.MixAny`'s only reference input is the pool's, and
read_reference_datum walks them all. The passing run is `V2.GapMixInsSteps`'. Written by
the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixRefs mixLogicTemplate gapRefsArgs 20000

theorem gap_mixrefs_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_needs_the_second_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_needs_the_second_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_needs_the_second_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

theorem gap_mixrefs_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedGapMixRefs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 v1 v2 h1 h2) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
