import Lovejoin.V2.MixSplit
import Blaster

/-! v2's Mix, its last part (`MixSplit`): with both boxes' proofs verifying, the Mix
succeeds. Then `mixAccepts_halves`, which ties the halves to `mixAccepts`: with
`MixFirst` and `MixSecond`, a Mix succeeds iff `mixAccepts`. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixPasses mixLogicV2 splitArgs 15000

/-- A Mix whose proofs both verify succeeds. -/
theorem mix_passes_with_both_proofs :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      mixAccepts t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedMixPasses.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 1200) (verbose: 1)

/-- `mixAccepts` is box in 1's check and box in 2's. -/
theorem mixAccepts_halves
    (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) :
    mixAccepts t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 =
      (firstAccepts t011 t111 c11 z11 t012 t112 c12 z12 && secondAccepts t021 t121 c21 z21 t022 t122 c22 z22) := by
  unfold mixAccepts firstAccepts secondAccepts
  cases mixContext <;> rfl

end Lovejoin.V2
