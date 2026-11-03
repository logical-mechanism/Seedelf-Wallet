import Lovejoin.V2.MixTok2Spec

/-! v2's Mix of 2, for any v2 token pool, with its outputs given: the builders for
`V2.MixTok2Outputs` and `V2.MixTok2Datums`. With the scenario's outputs, `mixCtxOuts` is
`mixCtxPool` (`mixCtxOuts_is_the_mix`), so each theorem changes one thing in the Mix whose
iff the `V2.MixTok2` modules prove, and keeps the pool's parameters, every box's points and
every proof field symbolic. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Tok2
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- An output at `c` with stake `s`, holding `v`, its datum `d` and reference script `r`. -/
def outWith (c : Credential) (s : Option StakingCredential) (v : Value) (d : OutputDatum) (r : Option ByteString) : TxOut :=
  ⟨⟨c, s⟩, v, d, r⟩

/-- The box value as a box out holds it. -/
def boxPairs (bl : Integer) (tp tn : ByteString) (tq : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B tp, Data.Map [(Data.B tn, Data.I tq)])]

/-- A datum that isn't inline: none, or by hash. -/
def notInline : OutputDatum → Bool
  | .OutputDatum _ => false
  | _ => true

/-- `mixCtxPool`'s Mix with its outputs given. -/
def mixCtxOuts (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 : ByteString) (outs : List TxOut) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl tp tn tq a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl tp tn tq a2 b2⟩],
    txInfoReferenceInputs := [refInputPool P bl tp tn tq M],
    txInfoOutputs         := outs,
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- With the scenario's outputs, it's the scenario's Mix. -/
theorem mixCtxOuts_is_the_mix (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) :
    mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, change] redeemer = mixCtxPool P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 redeemer := rfl

/-- The Mix with box out j at `cj`, stake `sj` and reference script `rj`. -/
def addressArgs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString)
    (c1 c2 : Credential) (s1 s2 : Option StakingCredential)
    (r1 r2 : Option ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [outWith c1 s1 (boxPairs bl tp tn tq) (.OutputDatum (mixDatum oa1 ob1)) r1, outWith c2 s2 (boxPairs bl tp tn tq) (.OutputDatum (mixDatum oa2 ob2)) r2, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with box out j holding `lj` lovelace and `qj` of the pool's token. -/
def valueArgs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 q1 q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l1)]), (Data.B tp, Data.Map [(Data.B tn, Data.I q1)])] (.OutputDatum (mixDatum oa1 ob1)) none, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l2)]), (Data.B tp, Data.Map [(Data.B tn, Data.I q2)])] (.OutputDatum (mixDatum oa2 ob2)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with its first box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B tp, Data.Map [(Data.B tn, Data.I tq)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl tp tn tq oa2 ob2, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with its second box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B tp, Data.Map [(Data.B tn, Data.I tq)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa2 ob2)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with only its first box out, and no other output. -/
def fewerArgs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [boxPool M bl tp tn tq oa1 ob1]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with another box at mix_box, `(xa, xb)`, after its 2 boxes out. -/
def tailArgs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq xa xb, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with its first box out's datum `od`. -/
def inlineArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl tp tn tq) od none, boxPool M bl tp tn tq oa2 ob2, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with its second box out's datum `od`. -/
def inlineArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl tp tn tq) od none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2.Tok2
