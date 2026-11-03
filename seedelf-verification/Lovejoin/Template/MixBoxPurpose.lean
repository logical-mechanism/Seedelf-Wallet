import Lovejoin.Template.Scripts
import Lovejoin.MixBoxPurpose
import Blaster

/-! `Lovejoin.MixBoxPurpose` on mix_box's template, for every mix_logic hash L: it's spend
only. `Lovejoin.Classic`'s scenarios, with L the program's first argument. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (boxMintingArgs boxRewardingArgs boxCertifyingArgs boxVotingArgs boxProposingArgs)

def boxMintingArgsT (L cs : ByteString) : List Term := toTerm L :: boxMintingArgs cs
def boxRewardingArgsT (L : ByteString) (c : Credential) : List Term := toTerm L :: boxRewardingArgs c
def boxCertifyingArgsT (L : ByteString) (i : Integer) (c : TxCert) : List Term := toTerm L :: boxCertifyingArgs i c
def boxVotingArgsT (L : ByteString) (v : Voter) : List Term := toTerm L :: boxVotingArgs v
def boxProposingArgsT (L : ByteString) (i : Integer) (p : ProposalProcedure) : List Term :=
  toTerm L :: boxProposingArgs i p

#prep_uplc appliedBoxMintingT mixBoxTemplate boxMintingArgsT 500
#prep_uplc appliedBoxRewardingT mixBoxTemplate boxRewardingArgsT 500
#prep_uplc appliedBoxCertifyingT mixBoxTemplate boxCertifyingArgsT 500
#prep_uplc appliedBoxVotingT mixBoxTemplate boxVotingArgsT 500
#prep_uplc appliedBoxProposingT mixBoxTemplate boxProposingArgsT 500

theorem mix_box_fails_minting : ∀ L cs, isUnsuccessful (appliedBoxMintingT.prop L cs) := by blaster
theorem mix_box_fails_rewarding : ∀ L c, isUnsuccessful (appliedBoxRewardingT.prop L c) := by blaster
theorem mix_box_fails_certifying : ∀ L i c, isUnsuccessful (appliedBoxCertifyingT.prop L i c) := by blaster
theorem mix_box_fails_voting : ∀ L v, isUnsuccessful (appliedBoxVotingT.prop L v) := by blaster
theorem mix_box_fails_proposing : ∀ L i p, isUnsuccessful (appliedBoxProposingT.prop L i p) := by blaster

end Lovejoin.Template
