import Seedelf.PolicyAnyTxSteps
import Blaster

/-! The policy in every transaction: mint only. The bytes test the purpose's tag before they read
the redeemer or the transaction (`aiken uplc decode`; PolicyAnyTxSteps checks it by step count):
0 goes on to the mint handler, any other tag to `Error`, the source's `else(_) { fail }`. So here
the whole TxInfo is one `Data` and so is the redeemer, and each purpose's payload is any list of
`Data`. One scenario per other V3 purpose, as WalletPurposeAnyTx is for the wallet. 500 steps:
each errors after 156 (PolicyAnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A context in the transaction `info` with the redeemer `redeemer` and the purpose
`Constr k fs`. -/
def polPurposeArgs (k : Integer) (info redeemer : Data) (fs : List Data) : List Term :=
  [toTerm (Data.Constr 0 [info, redeemer, .Constr k fs])]

-- The V3 purposes but minting (Constr 0), by their tags.
def polSpendingArgs := polPurposeArgs 1
def polRewardingArgs := polPurposeArgs 2
def polCertifyingArgs := polPurposeArgs 3
def polVotingArgs := polPurposeArgs 4
def polProposingArgs := polPurposeArgs 5

#prep_uplc appliedPolSpending seedelf polSpendingArgs 500
#prep_uplc appliedPolRewarding seedelf polRewardingArgs 500
#prep_uplc appliedPolCertifying seedelf polCertifyingArgs 500
#prep_uplc appliedPolVoting seedelf polVotingArgs 500
#prep_uplc appliedPolProposing seedelf polProposingArgs 500

-- The builder makes a real context (README rule 3): at the minting tag it's `mintIn`, so with
-- the honest mint's TxInfo and tag it's PolicyAnyTxSteps' honest mint, which returns unit.
example (info redeemer : Data) (own : ByteString) :
    polPurposeArgs 0 info redeemer [.B own] = [toTerm (mintIn info redeemer own)] := rfl
example : polPurposeArgs 0 polMintInfo (.B polTag) [.B polId] = [toTerm polMint] := rfl

-- Their own runs at their own limit: each other purpose in the ledger's shape
-- (PolicyAnyTxSteps' `polOtherPurposes`), with the honest mint's TxInfo and tag, reaches Error.
#guard endsInError (appliedPolSpending.exec polMintInfo (.B polTag) [spentRef, registerDatum])
#guard endsInError (appliedPolRewarding.exec polMintInfo (.B polTag) [.Constr 1 [.B "w"]])
#guard endsInError (appliedPolCertifying.exec polMintInfo (.B polTag) [.I 0, .Constr 0 [.Constr 1 [.B "w"], .Constr 1 []]])
#guard endsInError (appliedPolVoting.exec polMintInfo (.B polTag) [.Constr 2 [.B "pool"]])
#guard endsInError (appliedPolProposing.exec polMintInfo (.B polTag) [.I 0, .Constr 0 [.I 100000000000, .Constr 0 [.B "k"], .Constr 6 []]])

theorem policy_fails_spending_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedPolSpending.prop info redeemer fs) := by blaster
theorem policy_fails_rewarding_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedPolRewarding.prop info redeemer fs) := by blaster
theorem policy_fails_certifying_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedPolCertifying.prop info redeemer fs) := by blaster
theorem policy_fails_voting_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedPolVoting.prop info redeemer fs) := by blaster
theorem policy_fails_proposing_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedPolProposing.prop info redeemer fs) := by blaster

-- A negative control: one step short of its Error, after 156 steps (PolicyAnyTxSteps), a run
-- with the spending purpose is still going, and the same theorem over it comes back Falsified.
-- So the theorems above hold because the runs reach Error inside the limit.
#prep_uplc appliedPolSpendingCut seedelf polSpendingArgs 155
#guard stillRunning (appliedPolSpendingCut.exec polMintInfo (.B polTag) [spentRef, registerDatum])
#guard endsInError (cekExecuteProgram seedelf.script (polSpendingArgs polMintInfo (.B polTag) [spentRef, registerDatum]) 156)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ info redeemer fs, isUnsuccessful (appliedPolSpendingCut.prop info redeemer fs)]

end Seedelf.V1
