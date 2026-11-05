import Lovejoin.Template.AnyTxPurposes
import Blaster

/-! fee_contract's non-spending purposes, for any pool and arbitrary transaction,
redeemer and purpose payload. Spending is covered separately by the fee scenarios. -/

namespace Lovejoin.AnyTx.FeePurpose
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (purposeCtx)

def args (k : Integer) (P : ByteString) (info red : Data) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (purposeCtx k info red fs)]
def mintArgs := args 0
def rewardArgs := args 2
def certArgs := args 3
def voteArgs := args 4
def proposeArgs := args 5

#prep_uplc feeMint feeContractTemplate mintArgs 1000
#prep_uplc feeReward feeContractTemplate rewardArgs 1000
#prep_uplc feeCert feeContractTemplate certArgs 1000
#prep_uplc feeVote feeContractTemplate voteArgs 1000
#prep_uplc feePropose feeContractTemplate proposeArgs 1000

theorem refuses_minting : ∀ P info red fs, isUnsuccessful (feeMint.prop P info red fs) := by blaster
theorem refuses_rewarding : ∀ P info red fs, isUnsuccessful (feeReward.prop P info red fs) := by blaster
theorem refuses_certifying : ∀ P info red fs, isUnsuccessful (feeCert.prop P info red fs) := by blaster
theorem refuses_voting : ∀ P info red fs, isUnsuccessful (feeVote.prop P info red fs) := by blaster
theorem refuses_proposing : ∀ P info red fs, isUnsuccessful (feePropose.prop P info red fs) := by blaster

-- Concrete checks against the same template and the unconstrained-context builders.
#guard Lovejoin.Template.AnyTx.endWith feeContractTemplate
  [toTerm Lovejoin.Template.AnyTx.testP, toTerm nftName]
  (purposeCtx 0 (.I 7) (.I 3) [.B ""]) == "error"
#guard Lovejoin.Template.AnyTx.endWith feeContractTemplate
  [toTerm Lovejoin.Template.AnyTx.testP, toTerm nftName]
  (purposeCtx 2 (.I 7) (.I 3) [.Constr 0 [.B "key"]]) == "error"

end Lovejoin.AnyTx.FeePurpose
