import Lovejoin.V2.Mix3Spec
import Blaster

/-! v2's Mix at n = 3, box in 1: if its proof doesn't verify against the boxes out, the
Mix fails, whatever the fields of all three proofs are. Its four checks are four
theorems: the challenge, then each branch against its box out. With `Mix3First`,
`Mix3Second`, `Mix3Third` and `Mix3Passes`, a Mix of three succeeds iff `mixAccepts3`.
The passing run is the KAT's, in `V2.Mix3Steps`, and the step limit sits well above it.
Each runs `blaster (timeout: 540) (verbose: 1)` on its first builds. -/

namespace Lovejoin.V2.N3
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMix3First mixLogicV2 mix3Args 40000

/-- A Mix whose first box's `c`s don't xor to its `c_global` fails. -/
theorem mix3_needs_the_first_challenge :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      challengeHolds3 aIn1 bIn1 t011 t111 c11 t012 t112 c12 t013 t113 c13 = false →
        isUnsuccessful (appliedMix3First.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540) (verbose: 1)

/-- So does one whose first box's first branch doesn't hold against the first box out. -/
theorem mix3_needs_the_first_proofs_first_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn1 bIn1 aOut1 bOut1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedMix3First.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540) (verbose: 1)

/-- So does one whose first box's second branch doesn't hold against the second box out. -/
theorem mix3_needs_the_first_proofs_second_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn1 bIn1 aOut2 bOut2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedMix3First.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540) (verbose: 1)

/-- So does one whose first box's third branch doesn't hold against the third box out. -/
theorem mix3_needs_the_first_proofs_third_branch :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds aIn1 bIn1 aOut3 bOut3 t013 t113 c13 z13 = false →
        isUnsuccessful (appliedMix3First.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540) (verbose: 1)

end Lovejoin.V2.N3
