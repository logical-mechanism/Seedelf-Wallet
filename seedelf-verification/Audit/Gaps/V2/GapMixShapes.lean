import Lovejoin.V2.MixAnyOut

/-! A box out's datum, in a Mix of two for any ADA pool: the builders for `V2.GapMixShapes1`
to `4`. `V2.MixAnyDatums` covers a box out whose datum is `Constr 0 [B oa, B ob]` with the
wrong bytes, and one not inline; nothing covers an inline datum of any other shape. mix_box
treats every such box as outside the pool, so anyone could sweep it (Rule 2): a Mix that
paid one would hand a box to anyone. These are `Lovejoin.MixBoxNoLock`'s seventeen inline
shapes, which with `Constr 0 [B _, B _]` cover every datum, as box out 1's or box out 2's.
Then an ADA pool's box out holding any token, its lovelace symbolic too. Written by the
v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Template (nftName)

def gapShapeBytesArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (s : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.B s)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeIntArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.I i)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeListArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.List l)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeMapArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Map m)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeConstrPosArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr (Int.ofNat (n + 1)) fs)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeConstrNegArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr (Int.negSucc n) fs)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields0Args1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields1Args1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [x])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields3Args1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x y w : Data) (rest : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 (x :: y :: w :: rest))) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstConstrArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (k : Integer) (fs : List Data) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.Constr k fs, y])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstMapArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.Map m, y])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstListArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.List l, y])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstIArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.I i, y])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondConstrArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (k : Integer) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .Constr k fs])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondMapArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (m : List (Data × Data)) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .Map m])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondListArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (l : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .List l])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondIArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (i : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .I i])) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with box out 1 holding `l` lovelace and `q` of `(p, nm)`, all symbolic: an ADA
pool's box out holds no token, whatever its lovelace. -/
def gapAnyTwoPairsArgs1 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa1 ob1)) none, boxAny M bl oa2 ob2, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeBytesArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (s : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.B s)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeIntArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.I i)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeListArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.List l)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeMapArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Map m)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeConstrPosArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr (Int.ofNat (n + 1)) fs)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeConstrNegArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr (Int.negSucc n) fs)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields0Args2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields1Args2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [x])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFields3Args2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x y w : Data) (rest : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 (x :: y :: w :: rest))) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstConstrArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (k : Integer) (fs : List Data) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.Constr k fs, y])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstMapArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.Map m, y])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstListArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.List l, y])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeFirstIArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer) (y : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.I i, y])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondConstrArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (k : Integer) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .Constr k fs])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondMapArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (m : List (Data × Data)) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .Map m])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondListArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (l : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .List l])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

def gapShapeSecondIArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (i : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none (boxPairs bl) (.OutputDatum (.Constr 0 [.B a, .I i])) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- The Mix with box out 2 holding `l` lovelace and `q` of `(p, nm)`, all symbolic: an ADA
pool's box out holds no token, whatever its lovelace. -/
def gapAnyTwoPairsArgs2 (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxOuts P M bl a1 b1 a2 b2
    [boxAny M bl oa1 ob1, outWith (.ScriptCredential M) none [(Data.B "", Data.Map [(Data.B "", Data.I l)]), (Data.B p, Data.Map [(Data.B nm, Data.I q)])] (.OutputDatum (mixDatum oa2 ob2)) none, change]
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2.Any
