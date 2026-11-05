import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Owner withdrawal of 1 box, for any v2 pool: the boxes `(a1, b1)`
at mix_box, a payer's key input beside them, and two outputs, a Seedelf register `(g, u)`
of `amt` at the wallet contract `s` and `ch` of change to the key `kc`. The pool's NFT policy `P` and mix_box `M` are parameters too, for mix_logic's template.
Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- `n` lovelace alone. -/
def adaOwn (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

/-- The pool's `ReferenceDatum`, boxes of 10 ₳ at mix_box `M`: validate_owner reads only `M`. -/
def refDatumOwn (M : ByteString) : Data :=
  .Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputOwn (P M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumOwn M), none⟩⟩

/-- A box of 10 ₳ at mix_box `M`, its datum `(a, b)` inline. -/
def boxOwn (M : ByteString) (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, adaOwn 10000000, .OutputDatum (mixDatum a b), none⟩

/-- The boxes' references, then the payer's. -/
def ref1 : TxOutRef := ⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩
def payerRef : TxOutRef := ⟨ofHex "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", 0⟩

/-- The withdrawal's outputs: a Seedelf register `(g, u)` of `amt` at the wallet contract
`s`, then `ch` of change to `kc`. -/
def ownOutputs (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : List TxOut :=
  [⟨⟨.ScriptCredential s, none⟩, adaOwn amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩,
   ⟨⟨.PubKeyCredential kc, none⟩, adaOwn ch, .NoOutputDatum, none⟩]

/-- The withdrawal: the boxes, then `pin` lovelace at the key `kp`; box i's proof `(ti, zi)`. -/
def ownCtx (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨ref1, boxOwn M a1 b1⟩,
                              ⟨payerRef, ⟨⟨.PubKeyCredential kp, none⟩, adaOwn pin, .NoOutputDatum, none⟩⟩],
    txInfoReferenceInputs := [refInputOwn P M],
    txInfoOutputs         := ownOutputs s g u amt kc ch,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t1, .B z1]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

end Lovejoin.V2.Own1
