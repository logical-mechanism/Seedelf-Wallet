import Seedelf.PolicyAnyTxSteps
import Blaster

/-! The policy's redeemer in every transaction: anything but a `B`, the personal tag, reaches
`Error`, whatever the transaction and whatever policy id the policy runs as. Once the purpose is
a mint's, the bytes decode its policy id and then the redeemer as a `B`, before they read the
TxInfo (`aiken uplc decode`; PolicyAnyTxSteps checks it by step count), so here the TxInfo is
any `Data` and the policy id any bytes. One scenario per kind of `Data` but `B`, which with `B`
are every one:

  I _ | List _ | Map _ | Constr _ _            each with every value symbolic

500 steps: each errors after 184 (PolicyAnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The policy runs as `own`, with the redeemer `rd`, in the transaction `info`. -/
def polRedeemerArgs (rd info : Data) (own : ByteString) : List Term := [toTerm (mintIn info rd own)]

-- The builder makes a real context (README rule 3): with the tag as its redeemer it's
-- PolicyAnyTxSteps' honest mint, which returns unit.
example : polRedeemerArgs (.B polTag) polMintInfo polId = [toTerm polMint] := rfl

def polRedeemerIntArgs (i : Integer) := polRedeemerArgs (.I i)
def polRedeemerListArgs (l : List Data) := polRedeemerArgs (.List l)
def polRedeemerMapArgs (m : List (Data × Data)) := polRedeemerArgs (.Map m)
def polRedeemerConstrArgs (k : Integer) (fs : List Data) := polRedeemerArgs (.Constr k fs)

#prep_uplc appliedPolRedeemerInt seedelf polRedeemerIntArgs 500
#prep_uplc appliedPolRedeemerList seedelf polRedeemerListArgs 500
#prep_uplc appliedPolRedeemerMap seedelf polRedeemerMapArgs 500
#prep_uplc appliedPolRedeemerConstr seedelf polRedeemerConstrArgs 500

-- Their own runs at their own limit, in the honest mint's place (PolicyAnyTxSteps'
-- `polOtherRedeemers`): the tag wrapped in a list, a map or a constructor, or an integer, reaches
-- Error.
#guard endsInError (appliedPolRedeemerInt.exec 0 polMintInfo polId)
#guard endsInError (appliedPolRedeemerList.exec [.B polTag] polMintInfo polId)
#guard endsInError (appliedPolRedeemerMap.exec [(.B polTag, .I 0)] polMintInfo polId)
#guard endsInError (appliedPolRedeemerConstr.exec 0 [.B polTag] polMintInfo polId)

theorem policy_fails_redeemer_int : ∀ i info own, isUnsuccessful (appliedPolRedeemerInt.prop i info own) := by blaster
theorem policy_fails_redeemer_list : ∀ l info own, isUnsuccessful (appliedPolRedeemerList.prop l info own) := by blaster
theorem policy_fails_redeemer_map : ∀ m info own, isUnsuccessful (appliedPolRedeemerMap.prop m info own) := by blaster
theorem policy_fails_redeemer_constr : ∀ k fs info own, isUnsuccessful (appliedPolRedeemerConstr.prop k fs info own) := by blaster

-- A negative control: one step short of its Error, after 184 steps (PolicyAnyTxSteps), a run
-- with an integer redeemer is still going, and the same theorem over it comes back Falsified.
-- So the theorems above hold because the runs reach Error inside the limit.
#prep_uplc appliedPolRedeemerIntCut seedelf polRedeemerIntArgs 183
#guard stillRunning (appliedPolRedeemerIntCut.exec 0 polMintInfo polId)
#guard endsInError (cekExecuteProgram seedelf.script (polRedeemerIntArgs 0 polMintInfo polId) 184)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ i info own, isUnsuccessful (appliedPolRedeemerIntCut.prop i info own)]

end Seedelf.V1
