import Lovejoin.AnyTx.MixTokenTwo
import Lovejoin.AnyTx.MixOutputs
import Blaster

/-! A two-box token Mix must pay the exact token-pool value to both prefix outputs.
Input references and the non-box fields are arbitrary as in `MixTokenTwo`. -/
namespace Lovejoin.AnyTx.MixTokenOutputs
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)
open Lovejoin.AnyTx.MixTwo (Proof Tail keyOut)
open Lovejoin.AnyTx.MixOutputs (output replaceOne)
open Lovejoin.AnyTx.MixTokenTwo (argsWithOutputs boxOut)
open Lovejoin.V2.Tok2 (boxValuePool)

def valueArgs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields)
    (o : Tail) (p : Proof) (bad : Data) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 1 [.B M]) (.Constr 1 []) bad datum (.Constr 1 [])
  argsWithOutputs P M bl tp tn tq a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl tp tn tq oa1 ob1) (boxOut M bl tp tn tq oa2 ob2) (keyOut o)) p

#prep_uplc mixTokenBadValue mixLogicTemplate valueArgs 35000

theorem wrong_token_value (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields)
    (o : Tail) (p : Proof) (bad : Data) (first : Bool) :
    bad ≠ boxValuePool bl tp tn tq →
    isUnsuccessful (mixTokenBadValue.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p bad first) := by
  blaster (timeout: 540)

end Lovejoin.AnyTx.MixTokenOutputs
