import Blaster
import PlutusCore

/-! Repro for the third blocker: a symbolic BLS12-381 point.
`BLS12_381_G1_Element` is `Point Fq1`, and `Fq1` is `structure Fq1 where t : Fin fieldPrime`
(`Cryptograph/BLS12_381/Basic.lean`). `Fin n` is indexed by a `Nat`, so declaring it hits the
same `genIndParams` throw as `BitVec` ("Inductive datatype with instance parameters not
supported"): on 2026-11-02 the point cases failed on `Fin` and the control passed.
PlutusCoreBlaster draft #29 changes `t` to a `Nat`, as does our fork's `fix/fq1-nat` (chunk
41). The `#blaster` cases are false over uninterpreted builtins, so each expects `Falsified`;
the theorem is Valid, so a pass isn't only the solver finding a model. -/

namespace Upstream.Fq1Fin
open PlutusCore.ByteString (ByteString)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash

-- Control: an opaque builtin over a symbolic bytestring, no point involved.
#blaster (solve-result: 1) [∀ (b : ByteString), blake2b_224 b ≠ b]

-- Symbolic points.
theorem fq1_eq_of_t_eq : ∀ (x y : Cryptograph.BLS12_381.Fq1), x.t = y.t → x = y := by blaster
#blaster (solve-result: 1) [∀ (x y : BLS12_381_G1_Element), bls12_381_G1_equal x y = true]

-- A point out of a symbolic bytestring, as the wallet's `uncompress` of its datum.
#blaster (solve-result: 1) [∀ (b : ByteString),
    (match bls12_381_G1_uncompress b with | .ok p => bls12_381_G1_equal p p | .error _ => true) = true]

end Upstream.Fq1Fin
