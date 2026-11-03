import Lovejoin.V2.Mix3Spec
import Blaster

/-! v2's Mix at n = 3, its last part: with all three boxes' proofs verifying, the Mix
succeeds. With `Mix3First`, `Mix3Second` and `Mix3Third`, a Mix of three succeeds iff
`mixAccepts3`. -/

namespace Lovejoin.V2.N3
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMix3Passes mixLogicV2 mix3Args 40000

/-- A Mix of three whose proofs all verify succeeds. -/
theorem mix3_passes_with_every_proof :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      mixAccepts3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 = true →
        isSuccessful (appliedMix3Passes.prop t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540) (verbose: 1)

end Lovejoin.V2.N3
