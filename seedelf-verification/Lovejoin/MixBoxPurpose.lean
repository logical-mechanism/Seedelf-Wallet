import Lovejoin.Box
import Blaster

/-! mix_box is spend only. One scenario per other purpose, as `Seedelf.WalletPurpose`
does: a symbolic `ScriptInfo` would keep the spending branch in the symbolic run. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (emptyTx)

def boxPurposeArgs (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, Data.Constr 0 [], info⟩ : ScriptContext)]

def boxMintingArgs (cs : ByteString) := boxPurposeArgs (.MintingScript cs)
def boxRewardingArgs (c : Credential) := boxPurposeArgs (.RewardingScript c)
def boxCertifyingArgs (i : Integer) (c : TxCert) := boxPurposeArgs (.CertifyingScript i c)
def boxVotingArgs (v : Voter) := boxPurposeArgs (.VotingScript v)
def boxProposingArgs (i : Integer) (p : ProposalProcedure) := boxPurposeArgs (.ProposingScript i p)

#prep_uplc appliedBoxMinting mixBox boxMintingArgs 500
#prep_uplc appliedBoxRewarding mixBox boxRewardingArgs 500
#prep_uplc appliedBoxCertifying mixBox boxCertifyingArgs 500
#prep_uplc appliedBoxVoting mixBox boxVotingArgs 500
#prep_uplc appliedBoxProposing mixBox boxProposingArgs 500

theorem mix_box_fails_minting : ∀ cs, isUnsuccessful (appliedBoxMinting.prop cs) := by blaster
theorem mix_box_fails_rewarding : ∀ c, isUnsuccessful (appliedBoxRewarding.prop c) := by blaster
theorem mix_box_fails_certifying : ∀ i c, isUnsuccessful (appliedBoxCertifying.prop i c) := by blaster
theorem mix_box_fails_voting : ∀ v, isUnsuccessful (appliedBoxVoting.prop v) := by blaster
theorem mix_box_fails_proposing : ∀ i p, isUnsuccessful (appliedBoxProposing.prop i p) := by blaster

end Lovejoin.Classic
