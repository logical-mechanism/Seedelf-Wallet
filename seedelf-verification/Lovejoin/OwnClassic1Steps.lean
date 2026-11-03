import Lovejoin.OwnClassic1Spec
import Lovejoin.Steps

/-! The classic pool's Owner withdrawal of 1, concretely, on the classic pool's own bytes:
honest proofs, made with the builtins' own implementations (box i is `(g1, x·g1)`,
x = 0x5eed0e1f + i, nonce 0x1234567 + i, every proof bound to this transaction), must
halt with the spec `true`. That's the passing run the theorems pair with, and its step
count sizes their limit, 10000. With box 1's `z` changed, the change a lovelace more (the
same proofs, so they're bound to other outputs), it
must error and the spec say `false`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Lovejoin.Classic (fsHashSchnorr q)
open Seedelf.V1 (g1 ofHex)
open Seedelf.V1 (stepsUsed)

def kP : ByteString := ofHex "11111111111111111111111111111111111111111111111111111111"
def kS : ByteString := ofHex "22222222222222222222222222222222222222222222222222222222"
def kC : ByteString := ofHex "33333333333333333333333333333333333333333333333333333333"
/-- The Seedelf register's points: any two 48-byte strings (validate_owner only hashes them). -/
def kG : ByteString := g1
def kU : ByteString := ofHex "a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"
def zOneOwn : ByteString := ofHex "0000000000000000000000000000000000000000000000000000000000000001"

/-- The Schnorr proof `(t, z)` for the box `(g1, x·g1)` with nonce `r`, bound to `ctx`. -/
def prove (x r : Integer) (b ctx : ByteString) : Option (ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t ctx).data)) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (t, ⟨z⟩)

/-- The boxes' points and honest proofs, box by box. -/
def honest : Option (List ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let b1 := bls12_381_G1_compress (bls12_381_G1_scalarMul (0x5eed0e1f + 1) G)
  let ctx ← ctxOwn kS kG kU 20000000 kC 1000000
  let (t1, z1) ← prove (0x5eed0e1f + 1) (0x1234567 + 1) b1 ctx
  pure [b1, t1, z1]

#eval match honest with
  | some [b1, t1, z1] => s!"own_classic1, honest:          {stepsUsed mixLogic (ownCtx g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000) 60000}, spec {ownerAcceptsOwn g1 b1 t1 z1 kS kG kU 20000000 kC 1000000}"
  | _ => "own_classic1: no honest proofs"

#eval match honest with
  | some [b1, t1, z1] => s!"own_classic1, z1 changed:      {stepsUsed mixLogic (ownCtx g1 b1 t1 zOneOwn kP 3000000 kS kG kU 20000000 kC 1000000) 60000}, spec {ownerAcceptsOwn g1 b1 t1 zOneOwn kS kG kU 20000000 kC 1000000}"
  | _ => "own_classic1: no honest proofs"

#eval match honest with
  | some [b1, t1, z1] => s!"own_classic1, change + 1:      {stepsUsed mixLogic (ownCtx g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000001) 60000}, spec {ownerAcceptsOwn g1 b1 t1 z1 kS kG kU 20000000 kC 1000001}"
  | _ => "own_classic1: no honest proofs"

end Lovejoin.Classic.Own1
