import Lovejoin.V2.MixSplit
import Blaster

/-! v2's Mix, its first half (`MixSplit`): if box in 1's proof doesn't verify against the
boxes out, the Mix fails, whatever the fields of both proofs are. Its three checks are
three theorems, so a Falsified one names its check: the challenge (the `c`s xor to
`c_global`), then each branch against its box out. `firstAccepts_parts` ties them to
`firstAccepts`. The passing run is the KAT's, in `V2.Steps`. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixFirst mixLogicV2 splitArgs 15000

/-- A Mix whose first box's `c`s don't xor to its `c_global` fails. -/
theorem mix_needs_the_first_challenge :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      firstChallengeHolds t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedMixFirst.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200)

/-- So does one whose first box's first branch doesn't hold against the first box out. -/
theorem mix_needs_the_first_proofs_first_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds inA1 inB1 outA1 outB1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedMixFirst.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200)

/-- Or its second branch, against the second box out. -/
theorem mix_needs_the_first_proofs_second_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds inA1 inB1 outA2 outB2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedMixFirst.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200)

/-- `firstAccepts` is those three checks. -/
theorem firstAccepts_parts (t011 t111 c11 z11 t012 t112 c12 z12 : ByteString) :
    firstAccepts t011 t111 c11 z11 t012 t112 c12 z12 =
      (firstChallengeHolds t011 t111 c11 t012 t112 c12 &&
        branchHolds inA1 inB1 outA1 outB1 t011 t111 c11 z11 &&
        branchHolds inA1 inB1 outA2 outB2 t012 t112 c12 z12) := by
  unfold firstAccepts firstChallengeHolds verifyPre
  cases mixContext <;> cases xorOfChallenges c11 c12 <;> rfl

end Lovejoin.V2
