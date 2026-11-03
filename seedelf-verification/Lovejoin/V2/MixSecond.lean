import Lovejoin.V2.MixSplit
import Blaster

/-! v2's Mix, its second half (`MixSplit`): if box in 2's proof doesn't verify against the
boxes out, the Mix fails, whatever the fields of both proofs are. The passing run is the
KAT's, in `V2.Steps`. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixSecond mixLogicV2 splitArgs 15000

/-- A Mix whose second box's proof doesn't verify fails. -/
theorem mix_needs_the_second_proof :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      secondAccepts t021 t121 c21 z21 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedMixSecond.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200) (verbose: 1)

end Lovejoin.V2
