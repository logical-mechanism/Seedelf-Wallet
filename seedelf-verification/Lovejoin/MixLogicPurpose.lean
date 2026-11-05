import Lovejoin.Box
import Blaster

/-! mix_logic (0dad3046…) outside its withdrawal. It never spends, mints, votes or
proposes, and the only certificate it publishes is its own stake credential's
registration, which the withdraw-zero pattern needs once per pool. The withdrawal
itself, where Owner and Mix are checked, is in its own modules. One scenario per
purpose, as `MixBoxPurpose` does; within publish the certificate is symbolic. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (emptyTx)

def logicArgs (redeemer : Data) (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, redeemer, info⟩ : ScriptContext)]

def logicSpendingArgs (r : Data) (ref : TxOutRef) (d : Option Data) := logicArgs r (.SpendingScript ref d)
def logicMintingArgs (r : Data) (cs : ByteString) := logicArgs r (.MintingScript cs)
def logicVotingArgs (r : Data) (v : Voter) := logicArgs r (.VotingScript v)
def logicProposingArgs (r : Data) (i : Integer) (p : ProposalProcedure) := logicArgs r (.ProposingScript i p)
def logicPublishArgs (r : Data) (i : Integer) (c : TxCert) := logicArgs r (.CertifyingScript i c)

#prep_uplc appliedLogicSpending mixLogic logicSpendingArgs 500
#prep_uplc appliedLogicMinting mixLogic logicMintingArgs 500
#prep_uplc appliedLogicVoting mixLogic logicVotingArgs 500
#prep_uplc appliedLogicProposing mixLogic logicProposingArgs 500
#prep_uplc appliedLogicPublish mixLogic logicPublishArgs 500

/-- A stake credential's registration, with or without its deposit: Aiken's
`RegisterCredential`. -/
def isRegistration : TxCert → Prop
  | .TxCertRegStaking .. => True
  | _ => False

theorem mix_logic_fails_spending : ∀ r ref d, isUnsuccessful (appliedLogicSpending.prop r ref d) := by blaster
theorem mix_logic_fails_minting : ∀ r cs, isUnsuccessful (appliedLogicMinting.prop r cs) := by blaster
theorem mix_logic_fails_voting : ∀ r v, isUnsuccessful (appliedLogicVoting.prop r v) := by blaster
theorem mix_logic_fails_proposing : ∀ r i p, isUnsuccessful (appliedLogicProposing.prop r i p) := by blaster

/-- It publishes a certificate iff it's a registration, any credential's, any deposit. -/
theorem mix_logic_publishes_iff_registration : ∀ r i c,
    isSuccessful (appliedLogicPublish.prop r i c) ↔ isRegistration c := by blaster

/-- Any other certificate reaches `Error`. -/
theorem mix_logic_refuses_other_certificates : ∀ r i c,
    ¬ isRegistration c → isUnsuccessful (appliedLogicPublish.prop r i c) := by blaster

end Lovejoin.Classic
