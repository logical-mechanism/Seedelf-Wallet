import Lovejoin.Logic

/-! The classic pool's Owner withdrawal of 2 boxes, for the classic pool: the boxes `(a1, b1)` to `(a2, b2)`
at mix_box, a payer's key input beside them, and two outputs, a Seedelf register `(g, u)`
of `amt` at the wallet contract `s` and `ch` of change to the key `kc`. The classic pool's own bytes, reference input and mix_box.
Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)

/-- `n` lovelace alone. -/
def adaOwn (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

/-- A box of 10 ₳ at mix_box, its datum `(a, b)` inline. -/
def boxOwn (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential mixBoxHash, none⟩, adaOwn 10000000, .OutputDatum (mixDatum a b), none⟩

/-- The boxes' references, then the payer's. -/
def ref1 : TxOutRef := ⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩
def ref2 : TxOutRef := ⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩
def payerRef : TxOutRef := ⟨ofHex "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", 0⟩

/-- The withdrawal's outputs: a Seedelf register `(g, u)` of `amt` at the wallet contract
`s`, then `ch` of change to `kc`. -/
def ownOutputs (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : List TxOut :=
  [⟨⟨.ScriptCredential s, none⟩, adaOwn amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩,
   ⟨⟨.PubKeyCredential kc, none⟩, adaOwn ch, .NoOutputDatum, none⟩]

/-- The withdrawal: the boxes, then `pin` lovelace at the key `kp`; box i's proof `(ti, zi)`. -/
def ownCtx (a1 b1 a2 b2 t1 z1 t2 z2 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨ref1, boxOwn a1 b1⟩,
                              ⟨ref2, boxOwn a2 b2⟩,
                              ⟨payerRef, ⟨⟨.PubKeyCredential kp, none⟩, adaOwn pin, .NoOutputDatum, none⟩⟩],
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := ownOutputs s g u amt kc ch,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t1, .B z1], .Constr 0 [.B t2, .B z2]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

end Lovejoin.Classic.Own2
