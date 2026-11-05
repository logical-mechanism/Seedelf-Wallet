import Seedelf.Wallet
import Blaster

/-! Spend only. One scenario per other purpose: a symbolic `ScriptInfo` would
keep the spending branch in the symbolic run, and that branch reaches the
crypto builtins (`Except` and `BitVec`, which this Blaster can't translate).
A minting run reaches `Error` after 163 steps (Steps.lean). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def purposeArgs (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, Data.Constr 0 [Data.B "", Data.B "", Data.B ""], info⟩ : ScriptContext)]

def mintingArgs (cs : ByteString) := purposeArgs (.MintingScript cs)
def rewardingArgs (c : Credential) := purposeArgs (.RewardingScript c)
def certifyingArgs (i : Integer) (c : TxCert) := purposeArgs (.CertifyingScript i c)
def votingArgs (v : Voter) := purposeArgs (.VotingScript v)
def proposingArgs (i : Integer) (p : ProposalProcedure) := purposeArgs (.ProposingScript i p)

#prep_uplc appliedMinting wallet mintingArgs 500
#prep_uplc appliedRewarding wallet rewardingArgs 500
#prep_uplc appliedCertifying wallet certifyingArgs 500
#prep_uplc appliedVoting wallet votingArgs 500
#prep_uplc appliedProposing wallet proposingArgs 500

theorem wallet_fails_minting : ∀ cs, isUnsuccessful (appliedMinting.prop cs) := by blaster
theorem wallet_fails_rewarding : ∀ c, isUnsuccessful (appliedRewarding.prop c) := by blaster
theorem wallet_fails_certifying : ∀ i c, isUnsuccessful (appliedCertifying.prop i c) := by blaster
theorem wallet_fails_voting : ∀ v, isUnsuccessful (appliedVoting.prop v) := by blaster
theorem wallet_fails_proposing : ∀ i p, isUnsuccessful (appliedProposing.prop i p) := by blaster

end Seedelf.V1
