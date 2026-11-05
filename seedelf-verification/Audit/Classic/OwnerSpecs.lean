import Lovejoin.Logic

/-! Mutants of `Lovejoin.Classic.ownerAccepts`, the spec `owner_withdraws_iff_proof` pairs with
mix_logic's Owner withdrawal of one box. Each is `Lovejoin/Logic.lean`'s code with exactly one
change, named in its docstring; everything else (the aliases, `Int.fmod`, the operand order) is
copied as is, so a difference the solver finds is that one change. No checks here.

`ownerAcceptsNoRefs` and `ownerAcceptsNoOutputs` are also exactly what the two mutant scripts
in `Audit.Classic.MutantScripts` compute: neither serialises what it leaves out. -/

namespace Audit.Classic
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Lovejoin.Classic (ownerContext wellFormed serialised schnorrVerifies fsHashSchnorr q boxRef mixBoxHash
  mixLogicHash)

/-- [A-S1] `ownerAccepts` without `wellFormed a b`. -/
def ownerAcceptsNoWF (a b t z : ByteString) (out : TxOut) : Bool :=
  match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- `ctx` without the outputs: `blake2b_256(#"" ‖ serialise(input refs) ‖ mix_script_hash)`. -/
def ownerContextNoOutputs (refs : Data) : Option ByteString :=
  match serialised refs with
  | some r => some (blake2b_256 (appendByteString (appendByteString "" r) mixBoxHash))
  | none => none

/-- [A-S2] `ownerAccepts` over `ownerContextNoOutputs`: the payout isn't hashed. -/
def ownerAcceptsNoOutputs (a b t z : ByteString) (_out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContextNoOutputs (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

/-- `ctx` without the input refs (audit finding F-4's binding):
`blake2b_256(serialise(outputs) ‖ mix_script_hash)`. -/
def ownerContextNoRefs (outputs : Data) : Option ByteString :=
  match serialised outputs with
  | some o => some (blake2b_256 (appendByteString o mixBoxHash))
  | none => none

/-- [A-S3] `ownerAccepts` over `ownerContextNoRefs`. -/
def ownerAcceptsNoRefs (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContextNoRefs (IsData.toData ([out] : List TxOut)) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

/-- `ctx` with mix_logic's hash where the script appends mix_box's (the `ReferenceDatum`'s
`mix_script_hash`). -/
def ownerContextLogicHash (outputs refs : Data) : Option ByteString :=
  match serialised outputs, serialised refs with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixLogicHash))
  | _, _ => none

/-- [A-S4] `ownerAccepts` over `ownerContextLogicHash`. -/
def ownerAcceptsLogicHash (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContextLogicHash (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

/-- schnorr.ak's `verify` without z's range check (`expect v < scalar_order`). -/
def schnorrNoRange (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok U, .ok T =>
      let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
      if lengthOfByteString z == 32 then
        let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr base u t ctx).data)) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B)
          (bls12_381_G1_add T (bls12_381_G1_scalarMul c U))
      else false
  | _, _, _ => false

/-- schnorr.ak's `verify` without z's length check (`expect bytearray.length(bytes) == 32`). -/
def schnorrNoLength (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok U, .ok T =>
      let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
      if decide (zi < q) then
        let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr base u t ctx).data)) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B)
          (bls12_381_G1_add T (bls12_381_G1_scalarMul c U))
      else false
  | _, _, _ => false

/-- schnorr.ak's `verify` with the commitment left out of the equation: `z·base = c·u`. -/
def schnorrNoT (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok U, .ok _ =>
      let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
      if lengthOfByteString z == 32 && decide (zi < q) then
        let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr base u t ctx).data)) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B) (bls12_381_G1_scalarMul c U)
      else false
  | _, _, _ => false

/-- hash.ak's `fs_hash_schnorr` with `g` and `u` swapped in the preimage. -/
def fsHashSchnorrSwapped (g u t ctx : ByteString) : ByteString :=
  blake2b_256 (appendByteString (appendByteString (appendByteString (appendByteString
    (appendByteString ("lovejoin/sigmajoin/v1/" : ByteString) "\x01") u) g) t) ctx)

/-- schnorr.ak's `verify` over `fsHashSchnorrSwapped`. -/
def schnorrSwapped (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok U, .ok T =>
      let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
      if lengthOfByteString z == 32 && decide (zi < q) then
        let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorrSwapped base u t ctx).data)) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B)
          (bls12_381_G1_add T (bls12_381_G1_scalarMul c U))
      else false
  | _, _, _ => false

/-- [A-S5] `ownerAccepts` over `schnorrNoRange`. -/
def ownerAcceptsNoRange (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrNoRange a b t z ctx
    | none => false

/-- [A-S6] `ownerAccepts` over `schnorrNoLength`. -/
def ownerAcceptsNoLength (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrNoLength a b t z ctx
    | none => false

/-- [A-S7] `ownerAccepts` over `schnorrNoT`. -/
def ownerAcceptsNoT (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrNoT a b t z ctx
    | none => false

/-- [A-S8] `ownerAccepts` over `schnorrSwapped`. -/
def ownerAcceptsSwapped (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrSwapped a b t z ctx
    | none => false

end Audit.Classic
