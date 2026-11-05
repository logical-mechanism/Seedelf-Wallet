import Lovejoin.AnyTx.Common
import Blaster

/-! mix_logic with one key input, no boxes and the pool carrier as its sole reference
input. Both Owner and Mix must fail. The other TxInfo fields are arbitrary. -/

namespace Lovejoin.AnyTx.LogicEmpty
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx

def args (branch : Integer) (P M key : ByteString) (f : TxRest)
    (sigs acct ref stake value datum script : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [
    withInputs f (.List [otherIn ref 0 key stake value datum script])
      (.List [carrierRef (refAt 2) (.Constr 0 [.Constr 1 [.B testL], .Constr 1 []])
        (.Map [(.B "", .I 2000000)]) (.Constr 1 [])
        P M 10000000 "" "" 0 800000 testL testL]) sigs,
    .Constr branch [.List []], .Constr 2 [acct]])]

def ownerArgs := args 0
def mixArgs := args 1

/-- One potential box and an empty proof list; Mix still needs a second box. -/
def oneBoxArgs (P M a b : ByteString) (f : TxRest)
    (sigs acct ref stake value script : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [
    withInputs f (.List [boxIn ref M stake value script a b])
      (.List [carrierRef (refAt 2) (.Constr 0 [.Constr 1 [.B testL], .Constr 1 []])
        (.Map [(.B "", .I 2000000)]) (.Constr 1 []) P M 10000000 "" "" 0 800000 testL testL]) sigs,
    .Constr 1 [.List []], .Constr 2 [acct]])]

#prep_uplc emptyOwner mixLogicTemplate ownerArgs 5000
#prep_uplc emptyMix mixLogicTemplate mixArgs 5000
#prep_uplc oneBoxMix mixLogicTemplate oneBoxArgs 5000

theorem owner_without_boxes (P M key : ByteString) (f : TxRest)
    (sigs acct ref stake value datum script : Data) :
    isUnsuccessful (emptyOwner.prop P M key f sigs acct ref stake value datum script) := by blaster

theorem mix_without_boxes (P M key : ByteString) (f : TxRest)
    (sigs acct ref stake value datum script : Data) :
    isUnsuccessful (emptyMix.prop P M key f sigs acct ref stake value datum script) := by blaster

/-- Mix rejects a transaction containing at most one well-formed input box. -/
theorem mix_needs_two_boxes (P M a b : ByteString) (f : TxRest)
    (sigs acct ref stake value script : Data) :
    isUnsuccessful (oneBoxMix.prop P M a b f sigs acct ref stake value script) := by blaster

end Lovejoin.AnyTx.LogicEmpty
