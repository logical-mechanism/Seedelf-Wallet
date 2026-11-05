import Lovejoin.Logic
import Seedelf.Steps

/-! Audit (lovejoin-classic), not part of the suite: the classic pool's Owner withdrawal of
one box in the shape seedelf-core's `withdraw` (`Paying::Boxes`, the wallet's default) gives
it. The box is the only input. The reference inputs are the three the wallet sends
(`Protocol::of`, mainnet), in the ledger's order: mix_logic's and mix_box's reference-script
UTxOs at reference_holder, without the NFT, then the pool's reference UTxO. The one output is
the register `(g, u)` of `amt` at the wallet contract `s`. -/

namespace Lovejoin.Classic.AuditW1
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Seedelf.V1 (emptyTx ofHex g1 stepsUsed)

/-- `n` lovelace alone. -/
def adaW (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

/-- A reference-script UTxO at reference_holder: ADA and a script, no NFT. -/
def scriptRefW (txid : String) (h : ByteString) : TxInInfo :=
  ⟨⟨ofHex txid, 0⟩, ⟨⟨.ScriptCredential referenceHolderHash, none⟩, adaW 13000000, .NoOutputDatum, some h⟩⟩

/-- The reference inputs the wallet sends, in the ledger's order (2452… < 7d21… < f89c…). -/
def refInputsW : List TxInInfo :=
  [scriptRefW "2452c3e6886e6d946837bfea730a76dad43aefff267b5bbffd0232a2af68c7b6" mixLogicHash,
   scriptRefW "7d21335ffea6d3e8144ecb55f62f045f3fecd1414c932c62d7edd2886a57416a" mixBoxHash,
   referenceInput]

def refW : TxOutRef := ⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩

/-- A box of 10 ₳ at mix_box, its datum `(a, b)` inline. -/
def boxW (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential mixBoxHash, none⟩, adaW 10000000, .OutputDatum (mixDatum a b), none⟩

/-- The one output: the register `(g, u)` of `amt` at the wallet contract `s`. -/
def outputsW (s g u : ByteString) (amt : Integer) : List TxOut :=
  [⟨⟨.ScriptCredential s, none⟩, adaW amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩]

def ctxW (a b t z s g u : ByteString) (amt : Integer) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨refW, boxW a b⟩],
    txInfoReferenceInputs := refInputsW,
    txInfoOutputs         := outputsW s g u amt,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- validate_owner's `ctx` over this transaction: its one output and its one input's ref. -/
def ownerCtxW (s g u : ByteString) (amt : Integer) : Option ByteString :=
  match serialised (IsData.toData (outputsW s g u amt)), serialised (Data.List [IsData.toData refW]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

/-- The box's proof verifies against this transaction's `ctx`. -/
def proofHoldsW (s g u : ByteString) (amt : Integer) (a b t z : ByteString) : Bool :=
  match ownerCtxW s g u amt with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

def argsW (a b t z s g u : ByteString) (amt : Integer) : List Term :=
  [toTerm (ctxW a b t z s g u amt)]

/-! The concrete runs: an honest proof for the box `(g1, x·g1)`, x = 0x5eed0e1f + 1, nonce
0x1234567 + 1, bound to a 9.6 ₳ register; then the same proof with the register a lovelace
more. They size the theorems' limit (10000) and pair them with a passing run. -/

def kS : ByteString := ofHex "22222222222222222222222222222222222222222222222222222222"
def kU : ByteString := ofHex "a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"

def proveW (x r : Integer) (b ctx : ByteString) : Option (ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t ctx).data)) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (t, ⟨z⟩)

def honestW : Option (List ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let b1 := bls12_381_G1_compress (bls12_381_G1_scalarMul (0x5eed0e1f + 1) G)
  let ctx ← ownerCtxW kS g1 kU 9600000
  let (t1, z1) ← proveW (0x5eed0e1f + 1) (0x1234567 + 1) b1 ctx
  pure [b1, t1, z1]

#eval match honestW with
  | some [b1, t1, z1] => s!"audit wallet-shaped, honest:  {stepsUsed mixLogic (ctxW g1 b1 t1 z1 kS g1 kU 9600000) 60000}, spec {wellFormed g1 b1 && proofHoldsW kS g1 kU 9600000 g1 b1 t1 z1}"
  | _ => "audit wallet-shaped: no honest proof"

#eval match honestW with
  | some [b1, t1, z1] => s!"audit wallet-shaped, amt + 1: {stepsUsed mixLogic (ctxW g1 b1 t1 z1 kS g1 kU 9600001) 60000}, spec {wellFormed g1 b1 && proofHoldsW kS g1 kU 9600001 g1 b1 t1 z1}"
  | _ => "audit wallet-shaped: no honest proof"

end Lovejoin.Classic.AuditW1
