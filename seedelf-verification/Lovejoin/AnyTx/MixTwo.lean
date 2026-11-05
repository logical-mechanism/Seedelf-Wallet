import Lovejoin.AnyTx.OwnerTwo
import Lovejoin.V2.MixAnySpec
import Blaster

/-! Two-box ADA Mix with a key input, two box outputs and a key output. Input
references, input values and unused fields, the trailing key output's value, datum,
stake part and reference script, plus all other transaction fields, are arbitrary.
The carrier is the sole reference input. This is a layout family, not all Mixes. -/
namespace Lovejoin.AnyTx.MixTwo
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)
open Lovejoin.V2 (proofsRedeemer branchHolds)
open Lovejoin.V2.Any (challengeHoldsAny mixAcceptsAny)

structure Proof where
  t011 : ByteString
  t111 : ByteString
  c11 : ByteString
  z11 : ByteString
  t012 : ByteString
  t112 : ByteString
  c12 : ByteString
  z12 : ByteString
  t021 : ByteString
  t121 : ByteString
  c21 : ByteString
  z21 : ByteString
  t022 : ByteString
  t122 : ByteString
  c22 : ByteString
  z22 : ByteString

structure Tail where
  key : ByteString
  stake : Data
  value : Data
  datum : Data
  script : Data

def boxOut (M : ByteString) (bl : Integer) (a b : ByteString) : Data :=
  .Constr 0 [.Constr 0 [.Constr 1 [.B M], .Constr 1 []],
    .Map [(.B "", .Map [(.B "", .I bl)])], .Constr 2 [.Constr 0 [.B a, .B b]], .Constr 1 []]

def keyOut (o : Tail) : Data :=
  .Constr 0 [.Constr 0 [.Constr 0 [.B o.key], o.stake], o.value, o.datum, o.script]

def argsWithOutputs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 key : ByteString)
    (f : Fields) (b : BoxFields) (outs : List Data) (p : Proof) : List Term :=
  let tx := { f.tx with outputs := .List outs }
  let ins := .List [boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a1 b1,
    boxIn b.ref M b.stake b.value b.script a2 b2,
    otherIn f.keyRef 0 key f.keyStake f.keyValue f.keyDatum f.keyScript]
  let refs := .List [carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript
    P M bl "" "" 0 800000 testL testL]
  let red := proofsRedeemer p.t011 p.t111 p.c11 p.z11 p.t012 p.t112 p.c12 p.z12
    p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22
  [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs tx ins refs f.sigs, red, .Constr 2 [f.acct]])]

/-- The honest output layout, as used by the Mix proof theorems. -/
def args (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) : List Term :=
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    [boxOut M bl oa1 ob1, boxOut M bl oa2 ob2, keyOut o] p

#prep_uplc mixTwo mixLogicTemplate args 30000

theorem first_challenge (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 p.t011 p.t111 p.c11 p.t012 p.t112 p.c12 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem first_branch (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    branchHolds a1 b1 oa1 ob1 p.t011 p.t111 p.c11 p.z11 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem first_other_branch (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    branchHolds a1 b1 oa2 ob2 p.t012 p.t112 p.c12 p.z12 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem second_challenge (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 p.t021 p.t121 p.c21 p.t022 p.t122 p.c22 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem second_branch (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    branchHolds a2 b2 oa2 ob2 p.t022 p.t122 p.c22 p.z22 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem second_other_branch (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    branchHolds a2 b2 oa1 ob1 p.t021 p.t121 p.c21 p.z21 = false →
    isUnsuccessful (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

theorem valid_mix (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    P ≠ "" → bl ≠ 0 → wellFormed a1 b1 = true → wellFormed a2 b2 = true →
    wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 = true →
    returnsUnit (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) := by blaster (timeout: 540)

end Lovejoin.AnyTx.MixTwo
