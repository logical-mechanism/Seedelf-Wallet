import Lovejoin.V2.MixSplit
import Blaster

/-! v2's Mix, its second half (`MixSplit`): if box in 2's proof doesn't verify against the
boxes out, the Mix fails, whatever the fields of both proofs are. Its three checks are
three theorems, as in `MixFirst`, and `secondAccepts_parts` ties them to
`secondAccepts`. The passing run is the KAT's, in `V2.Steps`. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixSecond mixLogicV2 splitArgs 15000

/-- A Mix whose second box's `c`s don't xor to its `c_global` fails. -/
theorem mix_needs_the_second_challenge :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      secondChallengeHolds t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedMixSecond.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200) (verbose: 1)

/-- So does one whose second box's first branch doesn't hold against the first box out. -/
theorem mix_needs_the_second_proofs_first_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds inA2 inB2 outA1 outB1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedMixSecond.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200) (verbose: 1)

/-- Or its second branch, against the second box out. -/
theorem mix_needs_the_second_proofs_second_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds inA2 inB2 outA2 outB2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedMixSecond.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200) (verbose: 1)

/-- `secondAccepts` is those three checks. -/
theorem secondAccepts_parts (t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) :
    secondAccepts t021 t121 c21 z21 t022 t122 c22 z22 =
      (secondChallengeHolds t021 t121 c21 t022 t122 c22 &&
        branchHolds inA2 inB2 outA1 outB1 t021 t121 c21 z21 &&
        branchHolds inA2 inB2 outA2 outB2 t022 t122 c22 z22) := by
  unfold secondAccepts secondChallengeHolds verifyPre
  cases mixContext <;> cases xorOfChallenges c21 c22 <;> rfl

end Lovejoin.V2
