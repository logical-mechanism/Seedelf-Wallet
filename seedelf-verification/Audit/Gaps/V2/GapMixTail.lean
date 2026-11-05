import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool with one more output after its boxes, every field of it
symbolic: the Mix's iff with any tail, where `V2.MixAny`'s tail is one fixed change. Note
what the last theorem allows: walk_outputs' tail check is `!output_at_script`, so an
output at mix_box's payment credential with a stake part passes, and mix_box and mix_logic
take it for a box (`input_at_script` reads the payment credential alone). The builder pays
for it, as a deposit would. The runs are `V2.GapMixInsSteps`'. Written by the v2-scenario
audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixTail mixLogicTemplate gapTailArgs 20000

/-- An output at mix_box with no stake part and no reference script after the boxes fails the
Mix, whatever its value and datum: `V2.MixAnyOutputs`' `pays_no_other_box_to_mix_box`, there
for a well-formed box of the box value alone. -/
theorem gap_mixtail_pays_no_box_after :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      c = .ScriptCredential M → st = none → r = none →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_second_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_second_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

theorem gap_mixtail_needs_the_second_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

/-- Any other output after the boxes leaves the Mix's iff as it is: a fee shard's, another
change, or one at mix_box's payment credential with a stake part or a reference script. -/
theorem gap_mixtail_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum) (r : Option ByteString),
      (c ≠ .ScriptCredential M ∨ st ≠ none ∨ r ≠ none) →
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedGapMixTail.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c st v od r) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
