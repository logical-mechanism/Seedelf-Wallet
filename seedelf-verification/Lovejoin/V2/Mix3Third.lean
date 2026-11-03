import Lovejoin.V2.Mix3Spec
import Blaster

/-! v2's Mix at n = 3, box in 3: if its proof doesn't verify against the boxes out, the
Mix fails, whatever the fields of all three proofs are. Its four checks are four
theorems: the challenge, then each branch against its box out. With `Mix3First`,
`Mix3Second`, `Mix3Third` and `Mix3Passes`, a Mix of three succeeds iff `mixAccepts3`.
The passing run is the KAT's, in `V2.Mix3Steps`: 19204 steps, under the limit of 40000.
Each theorem solved in 0.02 s on 68c5399. -/

namespace Lovejoin.V2.N3
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMix3Third mixLogicV2 mix3Args 40000

/-- A Mix whose third box's `c`s don't xor to its `c_global` fails. -/
theorem mix3_needs_the_third_challenge :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      challengeHolds3 aIn3 bIn3 t031 t131 c31 t032 t132 c32 t033 t133 c33 = false →
        isUnsuccessful (appliedMix3Third.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's first branch doesn't hold against the first box out. -/
theorem mix3_needs_the_third_proofs_first_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn3 bIn3 aOut1 bOut1 t031 t131 c31 z31 = false →
        isUnsuccessful (appliedMix3Third.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's second branch doesn't hold against the second box out. -/
theorem mix3_needs_the_third_proofs_second_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn3 bIn3 aOut2 bOut2 t032 t132 c32 z32 = false →
        isUnsuccessful (appliedMix3Third.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's third branch doesn't hold against the third box out. -/
theorem mix3_needs_the_third_proofs_third_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn3 bIn3 aOut3 bOut3 t033 t133 c33 z33 = false →
        isUnsuccessful (appliedMix3Third.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

end Lovejoin.V2.N3
