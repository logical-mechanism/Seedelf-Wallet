import Lovejoin.V2.MixTok3Out

/-! What a box out must hold in a Mix of 3, for any v2 token pool: the builders for
`V2.MixTok3Values1` to `3`. `V2.MixTok3Outputs`' `valueArgs` varies a box out's lovelace and
the quantity of the pool's own `(tp, tn)`, and its `tokenArgs` append a token after the pool's.
Here box out j holds another token in the pool's place or none, two policies' tokens, or two
names under one policy, each field symbolic. Every other output is the scenario's, so each
`mixCtxOuts` is the scenario's Mix with one box out changed (`mixCtxOuts_is_the_mix`). Written by
`gen-lovejoin-mix-values.py`. -/

namespace Lovejoin.V2.Tok3
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Template (nftName)

/-- The Mix with its first box out holding `l` lovelace and `q` of `(p, nm)`: the pool's token swapped, renamed or
re-quantified, or the lovelace changed. -/
def swapArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its first box out holding `l` lovelace alone. -/
def bareArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its first box out holding `l` lovelace, `q1` of `(p1, n1)` and `q2` of `(p2, n2)`. -/
def twoTokensArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p1 n1 : ByteString) (q1 : Integer) (p2 n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p1, Data.Map [(Data.B n1, Data.I q1)]), (Data.B p2, Data.Map [(Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its first box out holding `l` lovelace and `q1` of `(p, n1)` and `q2` of `(p, n2)`. -/
def twoNamesArgs1 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p n1 : ByteString) (q1 : Integer) (n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its second box out holding `l` lovelace and `q` of `(p, nm)`: the pool's token swapped, renamed or
re-quantified, or the lovelace changed. -/
def swapArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa2 ob2)) none, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its second box out holding `l` lovelace alone. -/
def bareArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)])] (.OutputDatum (mixDatum oa2 ob2)) none, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its second box out holding `l` lovelace, `q1` of `(p1, n1)` and `q2` of `(p2, n2)`. -/
def twoTokensArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p1 n1 : ByteString) (q1 : Integer) (p2 n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p1, Data.Map [(Data.B n1, Data.I q1)]), (Data.B p2, Data.Map [(Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa2 ob2)) none, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its second box out holding `l` lovelace and `q1` of `(p, n1)` and `q2` of `(p, n2)`. -/
def twoNamesArgs2 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p n1 : ByteString) (q1 : Integer) (n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa2 ob2)) none, boxPool M bl tp tn tq oa3 ob3, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its third box out holding `l` lovelace and `q` of `(p, nm)`: the pool's token swapped, renamed or
re-quantified, or the lovelace changed. -/
def swapArgs3 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa3 ob3)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its third box out holding `l` lovelace alone. -/
def bareArgs3 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)])] (.OutputDatum (mixDatum oa3 ob3)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its third box out holding `l` lovelace, `q1` of `(p1, n1)` and `q2` of `(p2, n2)`. -/
def twoTokensArgs3 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p1 n1 : ByteString) (q1 : Integer) (p2 n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p1, Data.Map [(Data.B n1, Data.I q1)]), (Data.B p2, Data.Map [(Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa3 ob3)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

/-- The Mix with its third box out holding `l` lovelace and `q1` of `(p, n1)` and `q2` of `(p, n2)`. -/
def twoNamesArgs3 (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p n1 : ByteString) (q1 : Integer) (n2 : ByteString) (q2 : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl tp tn tq a1 b1 a2 b2 a3 b3
    [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2)])] (.OutputDatum (mixDatum oa3 ob3)) none, change]
    (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

end Lovejoin.V2.Tok3
