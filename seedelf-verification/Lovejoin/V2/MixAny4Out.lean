import Lovejoin.V2.MixAny4Spec

/-! v2's Mix of 4, for any v2 ADA pool, with its outputs given: the builders for
`V2.MixAny4Outputs` and `V2.MixAny4Datums`. With the scenario's outputs, `mixCtxOuts` is
`mixCtxPool` (`mixCtxOuts_is_the_mix`), so each theorem changes one thing in the Mix whose
iff the `V2.MixAny4` modules prove, and keeps the pool's parameters, every box's points and
every proof field symbolic. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Any4
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
def boxPairs (bl : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I bl)])]

/-- A datum that isn't inline: none, or by hash. -/
def notInline : OutputDatum → Bool
  | .OutputDatum _ => false
  | _ => true

/-- `mixCtxPool`'s Mix with its outputs given. -/
def mixCtxOuts (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 : ByteString) (outs : List TxOut) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl a2 b2⟩,
                              ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, boxPool M bl a3 b3⟩,
                              ⟨⟨ofHex "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", 0⟩, boxPool M bl a4 b4⟩],
    txInfoReferenceInputs := [refInputPool P bl M],
    txInfoOutputs         := outs,
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- With the scenario's outputs, it's the scenario's Mix. -/
theorem mixCtxOuts_is_the_mix (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 : ByteString) (redeemer : Data) :
    mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4 [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change] redeemer = mixCtxPool P M bl a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 redeemer := rfl

/-- The Mix with box out j at `cj`, stake `sj` and reference script `rj`. -/
def addressArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString)
    (c1 c2 c3 c4 : Credential) (s1 s2 s3 s4 : Option StakingCredential)
    (r1 r2 r3 r4 : Option ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [outWith c1 s1 (boxPairs bl) (.OutputDatum (mixDatum oa1 ob1)) r1, outWith c2 s2 (boxPairs bl) (.OutputDatum (mixDatum oa2 ob2)) r2, outWith c3 s3 (boxPairs bl) (.OutputDatum (mixDatum oa3 ob3)) r3, outWith c4 s4 (boxPairs bl) (.OutputDatum (mixDatum oa4 ob4)) r4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with box out j holding `lj` lovelace. -/
def valueArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (l1 l2 l3 l4 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l1)])] (.OutputDatum (mixDatum oa1 ob1)) none, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l2)])] (.OutputDatum (mixDatum oa2 ob2)) none, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l3)])] (.OutputDatum (mixDatum oa3 ob3)) none, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l4)])] (.OutputDatum (mixDatum oa4 ob4)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its first box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its second box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa2 ob2)) none, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its third box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs3 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa3 ob3)) none, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its fourth box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs4 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa4 ob4)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with only its first 3 boxes out, and no other output. -/
def fewerArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with another box at mix_box, `(xa, xb)`, after its 4 boxes out. -/
def tailArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (xa xb : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, boxPool M bl xa xb, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its first box out's datum `od`. -/
def inlineArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [outWith (.ScriptCredential M) none (boxPairs bl) od none, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its second box out's datum `od`. -/
def inlineArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) od none, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its third box out's datum `od`. -/
def inlineArgs3 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, outWith (.ScriptCredential M) none (boxPairs bl) od none, boxPool M bl oa4 ob4, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

/-- The Mix with its fourth box out's datum `od`. -/
def inlineArgs4 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) (od : OutputDatum) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2 a3 b3 a4 b4
    [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, outWith (.ScriptCredential M) none (boxPairs bl) od none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44))]

end Lovejoin.V2.Any4
