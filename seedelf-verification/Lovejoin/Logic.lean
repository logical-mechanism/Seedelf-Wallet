import Lovejoin.Box

/-! mix_logic (0dad3046…): its withdrawal's scenarios and specs. The transaction reads
the pool's reference UTxO as seedelf-core holds it on chain (f89cb43a…#0: 1,521,430
lovelace and the `lovejoin` NFT at reference_holder, with the inline `ReferenceDatum`
`Constr 0 [10 ₳, 1 ₳, mix_box, mix_logic, fee_contract]`), spends one box, and pays one
output. The withdrawal is mix_logic's own, of 0.

The specs call the builtins as the script does (README rule 7): `serialise_data` and
`byteStringToInteger` through the aliases their builtins run, the hashes and BLS12-381
operations opaque, and `scalar.from_int` as `modInteger`, which is `Int.fmod`. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.BuiltinFunctions.Data (encodeDataOpaque)
open Seedelf.V1 (emptyTx ofHex)

def referenceHolderHash : ByteString := ofHex "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4"
def feeHash : ByteString := ofHex "a072c7e839ab9ddf24344d0b2f70f56971f187fee8089f5f64212406"
def nftPolicy : ByteString := ofHex "f5592689c7ab35553a3234a54c0ee118090a5762c696819a53a5a826"

/-- The deployed `ReferenceDatum`. -/
def referenceDatum : Data :=
  .Constr 0 [.I 10000000, .I 1000000, .B mixBoxHash, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO, as it sits on chain. -/
def referenceInput : TxInInfo :=
  ⟨⟨ofHex "f89cb43a55eed378fe90fe954a9d86566280e6416d97f9008937ab492b37175c", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 1521430)]), (Data.B nftPolicy, Data.Map [(Data.B "lovejoin", Data.I 1)])],
    .OutputDatum referenceDatum, none⟩⟩

/-- One output, paying `amt` lovelace to the key `pkh`. -/
def payout (pkh : ByteString) (amt : Integer) : TxOut :=
  ⟨⟨.PubKeyCredential pkh, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I amt)])], .NoOutputDatum, none⟩

/-- An Owner withdrawal: the box `(a, b)` at `boxRef` spent, one proof `(t, z)`, `out` paid. -/
def ownerCtx (a b t z : ByteString) (out : TxOut) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨boxRef, box (.OutputDatum (mixDatum a b))⟩],
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := [out],
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- BLS12-381's scalar field order, stdlib's `field_prime`. -/
def q : Integer := 52435875175126190479447740508185965837690552500527637822603658699938581184513

/-- `try_decode_well_formed_data`'s byte conditions. -/
def wellFormed (a b : ByteString) : Bool :=
  lengthOfByteString a == 48 && lengthOfByteString b == 48 && a != b

/-- `serialise_data`, as the builtin runs it. -/
def serialised (d : Data) : Option ByteString := (fun s => (⟨s⟩ : ByteString)) <$> encodeDataOpaque d

/-- validate_owner's `ctx`: `blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_script_hash)`. -/
def ownerContext (outputs refs : Data) : Option ByteString :=
  match serialised outputs, serialised refs with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

/-- hash.ak's `fs_hash_schnorr`: `blake2b_256(domain_tag_v1 ‖ #01 ‖ g ‖ u ‖ t ‖ ctx)`. -/
def fsHashSchnorr (g u t ctx : ByteString) : ByteString :=
  blake2b_256 (appendByteString (appendByteString (appendByteString (appendByteString
    (appendByteString ("lovejoin/sigmajoin/v1/" : ByteString) "\x01") g) u) t) ctx)

/-- schnorr.ak's `verify`: `z·base = t + c·u`, with `z` 32 bytes below the field order and
`c` the Fiat-Shamir hash reduced into the field, both as `scalar.from_int` takes them. -/
def schnorrVerifies (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok U, .ok T =>
      let zi := byteStringToIntegerOpaque true z.data
      if lengthOfByteString z == 32 && decide (zi < q) then
        let c := Int.fmod (byteStringToIntegerOpaque true (fsHashSchnorr base u t ctx).data) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B)
          (bls12_381_G1_add T (bls12_381_G1_scalarMul c U))
      else false
  | _, _, _ => false

/-- validate_owner with one box: well-formed, and its proof verifies against this
transaction's outputs and inputs. The outputs are serialised as `txInfoOutputs` is
encoded (its own `IsData` instance); the input refs as the script lists them. -/
def ownerAccepts (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (toData ([out] : List TxOut)) (Data.List [toData boxRef]) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

end Lovejoin.Classic
