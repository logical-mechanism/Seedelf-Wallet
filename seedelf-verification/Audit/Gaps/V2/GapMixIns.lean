import Lovejoin.V2.MixAnySpec

/-! v2's Mix of two for any ADA pool (`V2.MixAny`), with what a real Mix carries beside its
boxes: the builders for the `V2.GapMix*` modules. `V2.MixAny`'s inputs are exactly the
two boxes, but every Mix the wallet builds has a payer's key input too (seedelf-core's
`lovejoin` module: "A key account pays the fee"), a fee shard comes in beside the boxes of
any Mix that draws on one, and anyone may add an input. mix_logic walks every input
(`collect_well_formed_mix_inputs`), so each is a scenario of its own: an input that isn't
a box before, between and after the boxes (`gapOther*`), an input with a datum between
them (`gapDatumBetween*`), a third well-formed box with only two proofs (`gapThird*`), and
redeemers with a proof or a branch too many or too few. With the scenario's own inputs,
`mixCtxIns` is `mixCtxAny` (`mixCtxIns_is_the_mix`). Written by the v2-scenario audit's
`gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- The scenario's boxes in, at `a0a0…#0` and `a1a1…#0`, as `mixCtxAny` has them. -/
def gapBoxIn1 (M : ByteString) (bl : Integer) (a b : ByteString) : TxInInfo :=
  ⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxAny M bl a b⟩

def gapBoxIn2 (M : ByteString) (bl : Integer) (a b : ByteString) : TxInInfo :=
  ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxAny M bl a b⟩

/-- `mixCtxAny`'s Mix with its inputs given. -/
def mixCtxIns (P M : ByteString) (bl : Integer) (ins : List TxInInfo) (oa1 ob1 oa2 ob2 : ByteString)
    (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := ins,
    txInfoReferenceInputs := [refInputAny P bl M],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- With the scenario's two boxes in, it's the scenario's Mix. -/
theorem mixCtxIns_is_the_mix (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) :
    mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer =
      mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 redeemer := rfl

/-- References in the ledger's order around the boxes': before both, between them, after both. -/
def gapRefBefore : TxOutRef := ⟨ofHex "0000000000000000000000000000000000000000000000000000000000000000", 0⟩
def gapRefBetween : TxOutRef := ⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 1⟩
def gapRefAfter : TxOutRef := ⟨ofHex "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", 0⟩

/-- An input that isn't a box: at `c`, holding `xv` lovelace, with no datum. A payer's key
input when `c` is a key's, any script's UTxO, or one parked at mix_box with no datum when
`c` is `M`'s (anyone may sweep that one, Rule 2). -/
def gapOtherIn (ref : TxOutRef) (c : Credential) (xv : Integer) : TxInInfo :=
  ⟨ref, ⟨⟨c, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I xv)])], .NoOutputDatum, none⟩⟩

/-- An input at `c` holding the box value, its datum `(xa, xb)` inline: a third box when `c`
is `M`'s and `(xa, xb)` is well-formed; otherwise an input the Mix skips. -/
def gapDatumIn (ref : TxOutRef) (c : Credential) (bl : Integer) (xa xb : ByteString) : TxInInfo :=
  ⟨ref, ⟨⟨c, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I bl)])], .OutputDatum (mixDatum xa xb), none⟩⟩

/-- The Mix with an input that isn't a box before its boxes: at `c`, `xv` lovelace, no datum. -/
def gapOtherBeforeCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (c : Credential) (xv : Integer)
    (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapOtherIn gapRefBefore c xv, gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer

def gapOtherBeforeArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xv : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapOtherBeforeCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 c xv (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with a third box at mix_box before its two, `(xa, xb)` inline, and still two proofs. -/
def gapThirdBeforeCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb : ByteString) (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapDatumIn gapRefBefore (.ScriptCredential M) bl xa xb, gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer

def gapThirdBeforeArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapThirdBeforeCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with an input that isn't a box between its boxes: at `c`, `xv` lovelace, no datum. -/
def gapOtherBetweenCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (c : Credential) (xv : Integer)
    (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapOtherIn gapRefBetween c xv, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer

def gapOtherBetweenArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xv : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapOtherBetweenCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 c xv (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with a third box at mix_box between its two, `(xa, xb)` inline, and still two proofs. -/
def gapThirdBetweenCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb : ByteString) (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapDatumIn gapRefBetween (.ScriptCredential M) bl xa xb, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer

def gapThirdBetweenArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapThirdBetweenCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with an input that isn't a box after its boxes: at `c`, `xv` lovelace, no datum. -/
def gapOtherAfterCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (c : Credential) (xv : Integer)
    (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2, gapOtherIn gapRefAfter c xv] oa1 ob1 oa2 ob2 redeemer

def gapOtherAfterArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xv : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapOtherAfterCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 c xv (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with a third box at mix_box after its two, `(xa, xb)` inline, and still two proofs. -/
def gapThirdAfterCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb : ByteString) (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2, gapDatumIn gapRefAfter (.ScriptCredential M) bl xa xb] oa1 ob1 oa2 ob2 redeemer

def gapThirdAfterArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapThirdAfterCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 xa xb (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with an input at `c` between its boxes, its datum `(xa, xb)` inline. -/
def gapDatumBetweenCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (c : Credential) (xa xb : ByteString)
    (redeemer : Data) : ScriptContext :=
  mixCtxIns P M bl [gapBoxIn1 M bl a1 b1, gapDatumIn gapRefBetween c bl xa xb, gapBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer

def gapDatumBetweenArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapDatumBetweenCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 c xa xb (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- `Mix { proofs }` with three proofs for the two boxes, the third `(t03j, t13j, c3j, z3j)`. -/
def gapThreeProofs (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t031 t131 c31 z31 t032 t132 c32 z32 : ByteString) : Data :=
  mixRedeemer [[branch t011 t111 c11 z11, branch t012 t112 c12 z12],
               [branch t021 t121 c21 z21, branch t022 t122 c22 z22],
               [branch t031 t131 c31 z31, branch t032 t132 c32 z32]]

def gapThreeProofsArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (t031 t131 c31 z31 t032 t132 c32 z32 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2
    (gapThreeProofs t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t031 t131 c31 z31 t032 t132 c32 z32))]

/-- `Mix { proofs }` with box 1's proof alone. -/
def gapOneProof (t011 t111 c11 z11 t012 t112 c12 z12 : ByteString) : Data :=
  mixRedeemer [[branch t011 t111 c11 z11, branch t012 t112 c12 z12]]

def gapOneProofArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 (gapOneProof t011 t111 c11 z11 t012 t112 c12 z12))]

/-- `Mix { proofs }` whose first proof has a third branch `(t013, t113, c13, z13)`. -/
def gapThreeBranches (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t013 t113 c13 z13 : ByteString) : Data :=
  mixRedeemer [[branch t011 t111 c11 z11, branch t012 t112 c12 z12, branch t013 t113 c13 z13],
               [branch t021 t121 c21 z21, branch t022 t122 c22 z22]]

def gapThreeBranchesArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (t013 t113 c13 z13 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 (gapThreeBranches t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t013 t113 c13 z13))]

/-- `Mix { proofs }` whose first proof has one branch. -/
def gapOneBranch (t011 t111 c11 z11 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Data :=
  mixRedeemer [[branch t011 t111 c11 z11], [branch t021 t121 c21 z21, branch t022 t122 c22 z22]]

def gapOneBranchArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 (gapOneBranch t011 t111 c11 z11 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- A reference-script UTxO, as a real Mix reads mix_logic's and mix_box's: at a key, `v`
lovelace, no datum, the script `h`. read_reference_datum walks every reference input. -/
def gapRefScript (ref : TxOutRef) (v : Integer) (h : ByteString) : TxInInfo :=
  ⟨ref, ⟨⟨.PubKeyCredential (ofHex "22222222222222222222222222222222222222222222222222222222"), none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I v)])], .NoOutputDatum, some h⟩⟩

/-- `mixCtxAny`'s Mix with the pool's reference input between two reference-script UTxOs. -/
def gapRefsCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString)
    (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2],
    txInfoReferenceInputs := [gapRefScript ⟨ofHex "0101010101010101010101010101010101010101010101010101010101010101", 0⟩ v1 h1, refInputAny P bl M,
                              gapRefScript ⟨ofHex "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", 0⟩ v2 h2],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

def gapRefsArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (v1 v2 : Integer) (h1 h2 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapRefsCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 v1 v2 h1 h2 (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- `mixCtxAny`'s Mix with one more output after its boxes, before its change: at `c` with
stake `st`, `v` lovelace, datum `od` and reference script `r`, every field symbolic. A
fee shard's output, a second change, or a box: walk_outputs refuses only an output at
mix_box with no stake part and no reference script there. -/
def gapTailCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (c : Credential) (st : Option StakingCredential)
    (v : Integer) (od : OutputDatum) (r : Option ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [gapBoxIn1 M bl a1 b1, gapBoxIn2 M bl a2 b2],
    txInfoReferenceInputs := [refInputAny P bl M],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2,
                              ⟨⟨c, st⟩, [(Data.B "", Data.Map [(Data.B "", Data.I v)])], od, r⟩, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

def gapTailArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (st : Option StakingCredential) (v : Integer) (od : OutputDatum)
    (r : Option ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (gapTailCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 c st v od r (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2.Any
