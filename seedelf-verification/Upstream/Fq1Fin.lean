import Blaster
import PlutusCore

/-! Repro for the third blocker: a symbolic BLS12-381 point.
`BLS12_381_G1_Element` is `Point Fq1`, and `Fq1` is `structure Fq1 where t : Fin fieldPrime`
(`Cryptograph/BLS12_381/Basic.lean`). `Fin n` is indexed by a `Nat`, so declaring it should
hit the same `genIndParams` throw as `BitVec` ("Inductive datatype with instance parameters
not supported"). PlutusCoreBlaster draft #29 changes `t` to a `Nat`. Each statement is false
over uninterpreted builtins, so each expects `Falsified`. -/

namespace Upstream.Fq1Fin
open PlutusCore.ByteString (ByteString)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash

-- Control: an opaque builtin over a symbolic bytestring, no point involved.
#blaster (solve-result: 1) [∀ (b : ByteString), blake2b_224 b ≠ b]

-- Symbolic points.
#blaster (solve-result: 1) [∀ (x y : BLS12_381_G1_Element), bls12_381_G1_equal x y = true]

-- A point out of a symbolic bytestring, as the wallet's `uncompress` of its datum.
#blaster (solve-result: 1) [∀ (b : ByteString),
    (match bls12_381_G1_uncompress b with | .ok p => bls12_381_G1_equal p p | .error _ => true) = true]

end Upstream.Fq1Fin
