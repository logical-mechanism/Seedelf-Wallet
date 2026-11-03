import Lovejoin.Logic
import Seedelf.Steps

/-! How many steps Blaster's CEK machine takes on concrete runs of each Lovejoin
scenario, to size the `#prep_uplc` limits (see `Seedelf.Steps`). Each mix_box line
pairs with a case in `concrete/lovejoin_mix_box.sh`, which Aiken's evaluator agrees
with. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (IsData)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Seedelf.V1 (emptyTx stepsUsed g1)

def notG1 : PlutusCore.ByteString.ByteString :=
  Seedelf.V1.ofHex "a09d99e02f7200526dc55ef722cc171e7aa14fc732614c02ac58d59d7026a7eb18d8798f6928ea2b513f3a4feb0c94d1"

-- reference_holder: a spend, and another purpose
#eval s!"reference_holder, spend:     {stepsUsed referenceHolder ⟨emptyTx, Data.I 0, .SpendingScript boxRef none⟩}"
#eval s!"reference_holder, minting:   {stepsUsed referenceHolder ⟨emptyTx, Data.I 0, .MintingScript ""⟩}"
-- mix_box: another purpose, then the box's datum and the withdrawals
#eval s!"mix_box, minting purpose:    {stepsUsed mixBox ⟨emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"mix_box, well-formed, none:  {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [])}"
#eval s!"mix_box, well-formed, logic: {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"
#eval s!"mix_box, well-formed, other: {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential "o", 0)])}"
#eval s!"mix_box, a = b:              {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 g1) [])}"
#eval s!"mix_box, Constr 0 [B,B,B]:   {stepsUsed mixBox (inlineBoxCtx (.Constr 0 [.B g1, .B notG1, .B g1]) [])}"
#eval s!"mix_box, no datum:           {stepsUsed mixBox (spendBoxCtx .NoOutputDatum none [])}"
#eval s!"mix_box, by hash (F-2):      {stepsUsed mixBox (spendBoxCtx (.OutputDatumHash "h") (some (mixDatum g1 notG1)) [])}"
-- mix_logic: another purpose, then publish with its own registration and with another certificate
#eval s!"mix_logic, minting purpose:  {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"mix_logic, registration:     {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertRegStaking (.ScriptCredential mixLogicHash) none)⟩}"
#eval s!"mix_logic, unregistration:   {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertUnRegStaking (.ScriptCredential mixLogicHash) none)⟩}"

/-- The payout of the concrete Owner runs: 9 ₳ to a key. -/
def payout0 : TxOut := payout (Seedelf.V1.ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000000

def hexOf (b : ByteString) : String :=
  String.join (b.data.toList.map fun c => String.mk [Nat.digitChar (c.toNat / 16), Nat.digitChar (c.toNat % 16)])

/-- A real Owner proof for the box `(g1, x·g1)`, computed with the builtins' own
implementations: x = 0x5eed0e1f, nonce 0x1234567, the proof bound to `payout0`.
Returns `(b, t, z)`. `concrete/lovejoin_owner.sh` builds the same proof with Aiken's
evaluator and Python, and the deployed mix_logic accepts it there: b 8c6b52ee…df5de8,
t 820ad0f2…6c6c68, z 42c96978…8c1b90ba. A different z here means the two sides
serialise the transaction differently. -/
def ownerVector : Option (ByteString × ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let x : Integer := 0x5eed0e1f
  let r : Integer := 0x1234567
  let b := bls12_381_G1_compress (bls12_381_G1_scalarMul x G)
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let ctx ← ownerContext (IsData.toData ([payout0] : List TxOut)) (Data.List [IsData.toData boxRef])
  let c := Int.fmod (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t ctx).data) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (b, t, ⟨z⟩)

-- mix_logic, Owner: the vector itself, then the script and the spec on it, on another
-- payout (a lovelace more), and with z changed
#eval match ownerVector with
  | some (b, t, z) => s!"owner vector: b {hexOf b} t {hexOf t} z {hexOf z}"
  | none => "owner vector: none"
#eval match ownerVector with
  | some (b, t, z) => s!"mix_logic, owner, valid:     {stepsUsed mixLogic (ownerCtx g1 b t z payout0)}, spec {ownerAccepts g1 b t z payout0}"
  | none => "owner vector: none"
#eval match ownerVector with
  | some (b, t, z) =>
      let other := payout (Seedelf.V1.ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000001
      s!"mix_logic, owner, other payout: {stepsUsed mixLogic (ownerCtx g1 b t z other)}, spec {ownerAccepts g1 b t z other}"
  | none => "owner vector: none"
#eval match ownerVector with
  | some (b, t, _) =>
      let z' := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"
      s!"mix_logic, owner, z changed: {stepsUsed mixLogic (ownerCtx g1 b t z' payout0)}, spec {ownerAccepts g1 b t z' payout0}"
  | none => "owner vector: none"

end Lovejoin.Classic
