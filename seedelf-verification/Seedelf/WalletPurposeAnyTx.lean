import Seedelf.Wallet
import Seedelf.AnyTx
import Seedelf.AnyTxSteps
import Blaster

/-! WalletPurpose in every transaction: spend only. The purpose is tested first, before the
redeemer or the transaction is read (`aiken uplc decode`), so here the whole TxInfo is one `Data`
and so is the redeemer, and each purpose's payload is any list of `Data`. One scenario per
other V3 purpose, as in WalletPurpose; 500 steps, as there (a minting run reaches `Error` after
163, Steps.lean). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A context in the transaction `info` with the redeemer `redeemer` and the purpose
`Constr k fs`. -/
def anyTxPurposeArgs (k : Integer) (info redeemer : Data) (fs : List Data) : List Term :=
  [toTerm (Data.Constr 0 [info, redeemer, .Constr k fs])]

-- The V3 purposes but spending (Constr 1), by their tags.
def anyTxMintingArgs := anyTxPurposeArgs 0
def anyTxRewardingArgs := anyTxPurposeArgs 2
def anyTxCertifyingArgs := anyTxPurposeArgs 3
def anyTxVotingArgs := anyTxPurposeArgs 4
def anyTxProposingArgs := anyTxPurposeArgs 5

#prep_uplc appliedAnyTxMinting wallet anyTxMintingArgs 500
#prep_uplc appliedAnyTxRewarding wallet anyTxRewardingArgs 500
#prep_uplc appliedAnyTxCertifying wallet anyTxCertifyingArgs 500
#prep_uplc appliedAnyTxVoting wallet anyTxVotingArgs 500
#prep_uplc appliedAnyTxProposing wallet anyTxProposingArgs 500

-- The builder makes a real context (README rule 3): at the spending tag it's AnyTxSteps' passing
-- spend of a UTxO with no datum.
example : anyTxPurposeArgs 1 (.I 7) (proofWith z0) [spentRef, datumNone] =
    [toTerm (spendIn (.I 7) (proofWith z0) spentRef datumNone)] := rfl
#guard endsInError (appliedAnyTxMinting.exec (busyTx.info [.B vkh0]) (proofWith z0) [.B ""])
#guard endsInError (appliedAnyTxProposing.exec (.I 7) (.I 0) [.I 0, .I 0])

theorem wallet_fails_minting_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedAnyTxMinting.prop info redeemer fs) := by blaster
theorem wallet_fails_rewarding_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedAnyTxRewarding.prop info redeemer fs) := by blaster
theorem wallet_fails_certifying_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedAnyTxCertifying.prop info redeemer fs) := by blaster
theorem wallet_fails_voting_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedAnyTxVoting.prop info redeemer fs) := by blaster
theorem wallet_fails_proposing_any_tx : ∀ info redeemer fs, isUnsuccessful (appliedAnyTxProposing.prop info redeemer fs) := by blaster

end Seedelf.V1
