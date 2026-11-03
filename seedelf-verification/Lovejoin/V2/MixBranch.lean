import Lovejoin.V2.MixSplit
import Blaster

/-! A diagnostic, not a property: box in 1's first branch, check by check, to find where
`branchHolds` and the script part (`MixFirst`'s branch theorems came back Falsified, its
challenge theorem Valid). Each theorem says the Mix fails when one of the branch's
conditions does, every field of both proofs symbolic.

The points first: box in 1's `a` and the first box out's `a'` (both constants, as no
point is in `V2/Owner`, where Valid), and the branch's `t0` (symbolic). Then `z`'s
checks, then each equation. The Falsified ones name the gap. This module goes once it's
closed; it isn't in `check.sh` or `Lovejoin.lean`. -/

namespace Lovejoin.V2
open PlutusCore.ByteString
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (q)

#prep_uplc appliedMixBranch mixLogicV2 splitArgs 15000

/-- `scalar_from_bytes`' checks: 32 bytes, below the field order. -/
def zOk (z : ByteString) : Bool :=
  lengthOfByteString z == 32 && decide (byteStringToIntegerOpaque true z.data < q)

/-- One of a branch's two equations, `z·p = t + c·pp`, as `branchHolds` has it. -/
def equationHolds (p pp t c z : ByteString) : Bool :=
  match bls12_381_G1_uncompress p, bls12_381_G1_uncompress pp, bls12_381_G1_uncompress t with
  | .ok P, .ok PP, .ok T =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod (byteStringToIntegerOpaque true z.data) q) P)
        (bls12_381_G1_add T (bls12_381_G1_scalarMul (Int.fmod (byteStringToIntegerOpaque true c.data) q) PP))
  | _, _, _ => false

theorem diag_input_point :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      (bls12_381_G1_uncompress inA1).isOk = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

theorem diag_output_point :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      (bls12_381_G1_uncompress outA1).isOk = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

theorem diag_t0_point :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      (bls12_381_G1_uncompress t011).isOk = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

theorem diag_z :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      zOk z11 = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

theorem diag_first_equation :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      equationHolds inA1 outA1 t011 c11 z11 = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

theorem diag_second_equation :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      equationHolds inB1 outB1 t111 c11 z11 = false →
        isUnsuccessful (appliedMixBranch.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 300) (verbose: 1)

end Lovejoin.V2
