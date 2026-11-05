import Seedelf.Steps
import Blaster

/-! Audit gap (gap-v2-mix-logic-purposes-unproved, 2026-11-03): `./check.sh audit-seedelf`.

The Seedelf policy (84967d91…) is mint only, as `WalletPurpose` shows the wallet is spend
only. Its bytes (`aiken uplc decode`) take the ScriptInfo's tag first: 0 goes to the mint
handler, every other tag to `Error`, the source's `else(_) { fail }`; the redeemer and the
transaction aren't read before that. No module said so. One scenario per other purpose,
the redeemer symbolic.

Expected: 5 `✅ Valid`, then one `#eval` line, `policy, spending purpose: error after n`,
with n near the wallet's 163 for its minting purpose (Steps.lean:48), far under 500. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def policyPurposeArgs (r : Data) (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, r, info⟩ : ScriptContext)]

def policySpendingArgs (r : Data) (ref : TxOutRef) (d : Option Data) := policyPurposeArgs r (.SpendingScript ref d)
def policyRewardingArgs (r : Data) (c : Credential) := policyPurposeArgs r (.RewardingScript c)
def policyCertifyingArgs (r : Data) (i : Integer) (c : TxCert) := policyPurposeArgs r (.CertifyingScript i c)
def policyVotingArgs (r : Data) (v : Voter) := policyPurposeArgs r (.VotingScript v)
def policyProposingArgs (r : Data) (i : Integer) (p : ProposalProcedure) := policyPurposeArgs r (.ProposingScript i p)

#prep_uplc policyPurposeSpending seedelf policySpendingArgs 500
#prep_uplc policyPurposeRewarding seedelf policyRewardingArgs 500
#prep_uplc policyPurposeCertifying seedelf policyCertifyingArgs 500
#prep_uplc policyPurposeVoting seedelf policyVotingArgs 500
#prep_uplc policyPurposeProposing seedelf policyProposingArgs 500

theorem policy_fails_spending : ∀ r ref d, isUnsuccessful (policyPurposeSpending.prop r ref d) := by blaster
theorem policy_fails_rewarding : ∀ r c, isUnsuccessful (policyPurposeRewarding.prop r c) := by blaster
theorem policy_fails_certifying : ∀ r i c, isUnsuccessful (policyPurposeCertifying.prop r i c) := by blaster
theorem policy_fails_voting : ∀ r v, isUnsuccessful (policyPurposeVoting.prop r v) := by blaster
theorem policy_fails_proposing : ∀ r i p, isUnsuccessful (policyPurposeProposing.prop r i p) := by blaster

-- The limit's measure, as Steps.lean:48 is the wallet's.
#eval s!"policy, spending purpose:   {stepsUsed seedelf ⟨emptyTx, Data.B "", .SpendingScript ⟨"", 0⟩ none⟩}"

end Seedelf.V1
