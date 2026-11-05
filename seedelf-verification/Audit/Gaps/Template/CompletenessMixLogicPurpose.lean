import Lovejoin.Template.Scripts
import Lovejoin.Template.Launch
import Lovejoin.Template.Steps
import Lovejoin.MixLogicPurpose
import Blaster

/-! Audit draft (completeness critic, 2026-11-03), not compiled. Owner-run only: built in place
as `Audit.Gaps.Template.CompletenessMixLogicPurpose`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.CompletenessMixLogicPurpose`.

Part 1, the gap: `Lovejoin.MixLogicPurpose` on mix_logic's template (v2, 7fb45b75…), for
every pool's NFT policy P. The classic module covers only the classic applied bytes
0dad3046…; no module runs v2's mix_logic outside its withdrawal, so nothing on v2's bytes
says an UnregisterCredential (which the source says "would brick the protocol") fails.
Each scenario is `Lovejoin.Classic`'s, with P and the NFT's name applied first, as
`Lovejoin.V2.Any.anyArgs` applies them.

Part 2, completeness only: fee_contract's template (3698bbfd…) is spend only and
one_shot_mint's (6878ed6f…) is mint only, as `Template.MixBoxPurpose` shows for mix_box.
Both sources end in `else(_) { fail }`; no theorem says so on the bytes.

Expected: 16 `✅ Valid`, then three `#eval` lines: minting `error after …`,
registration `halt after n`, unregistration `error after m`, with n and m near
`Lovejoin.Steps`' classic 290 (lines 36-37). -/

namespace Lovejoin.Template.CompletenessPurpose
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName stepsWith)
open Lovejoin.Classic (logicArgs logicSpendingArgs logicMintingArgs logicVotingArgs
  logicProposingArgs logicPublishArgs isRegistration)

/-! ### Part 1: v2's mix_logic outside its withdrawal -/

def cmpSpendingArgs (P : ByteString) (r : Data) (ref : TxOutRef) (d : Option Data) : List Term :=
  toTerm P :: toTerm nftName :: logicSpendingArgs r ref d
def cmpMintingArgs (P : ByteString) (r : Data) (cs : ByteString) : List Term :=
  toTerm P :: toTerm nftName :: logicMintingArgs r cs
def cmpVotingArgs (P : ByteString) (r : Data) (v : Voter) : List Term :=
  toTerm P :: toTerm nftName :: logicVotingArgs r v
def cmpProposingArgs (P : ByteString) (r : Data) (i : Integer) (p : ProposalProcedure) : List Term :=
  toTerm P :: toTerm nftName :: logicProposingArgs r i p
def cmpPublishArgs (P : ByteString) (r : Data) (i : Integer) (c : TxCert) : List Term :=
  toTerm P :: toTerm nftName :: logicPublishArgs r i c

#prep_uplc cmpLogicSpendingT mixLogicTemplate cmpSpendingArgs 1000
#prep_uplc cmpLogicMintingT mixLogicTemplate cmpMintingArgs 1000
#prep_uplc cmpLogicVotingT mixLogicTemplate cmpVotingArgs 1000
#prep_uplc cmpLogicProposingT mixLogicTemplate cmpProposingArgs 1000
#prep_uplc cmpLogicPublishT mixLogicTemplate cmpPublishArgs 1000

theorem v2_mix_logic_fails_spending : ∀ P r ref d,
    isUnsuccessful (cmpLogicSpendingT.prop P r ref d) := by blaster
theorem v2_mix_logic_fails_minting : ∀ P r cs,
    isUnsuccessful (cmpLogicMintingT.prop P r cs) := by blaster
theorem v2_mix_logic_fails_voting : ∀ P r v,
    isUnsuccessful (cmpLogicVotingT.prop P r v) := by blaster
theorem v2_mix_logic_fails_proposing : ∀ P r i p,
    isUnsuccessful (cmpLogicProposingT.prop P r i p) := by blaster

/-- Publish succeeds iff the certificate is a registration (any credential, any deposit). -/
theorem v2_mix_logic_publishes_iff_registration : ∀ P r i c,
    isSuccessful (cmpLogicPublishT.prop P r i c) ↔ isRegistration c := by blaster

/-- Every other certificate (unregistration, delegation, …) reaches `Error`. -/
theorem v2_mix_logic_refuses_other_certificates : ∀ P r i c,
    ¬ isRegistration c → isUnsuccessful (cmpLogicPublishT.prop P r i c) := by blaster

/-! ### Part 2: fee_contract and one_shot_mint outside their own handler -/

def feeT (P : ByteString) (r : Data) (info : ScriptInfo) : List Term :=
  toTerm P :: toTerm nftName :: logicArgs r info
def cmpFeeMinting (P : ByteString) (r : Data) (cs : ByteString) : List Term := feeT P r (.MintingScript cs)
def cmpFeeRewarding (P : ByteString) (r : Data) (c : Credential) : List Term := feeT P r (.RewardingScript c)
def cmpFeeCertifying (P : ByteString) (r : Data) (i : Integer) (c : TxCert) : List Term :=
  feeT P r (.CertifyingScript i c)
def cmpFeeVoting (P : ByteString) (r : Data) (v : Voter) : List Term := feeT P r (.VotingScript v)
def cmpFeeProposing (P : ByteString) (r : Data) (i : Integer) (p : ProposalProcedure) : List Term :=
  feeT P r (.ProposingScript i p)

#prep_uplc cmpFeeMintingT feeContractTemplate cmpFeeMinting 1000
#prep_uplc cmpFeeRewardingT feeContractTemplate cmpFeeRewarding 1000
#prep_uplc cmpFeeCertifyingT feeContractTemplate cmpFeeCertifying 1000
#prep_uplc cmpFeeVotingT feeContractTemplate cmpFeeVoting 1000
#prep_uplc cmpFeeProposingT feeContractTemplate cmpFeeProposing 1000

theorem fee_contract_fails_minting : ∀ P r cs, isUnsuccessful (cmpFeeMintingT.prop P r cs) := by blaster
theorem fee_contract_fails_rewarding : ∀ P r c, isUnsuccessful (cmpFeeRewardingT.prop P r c) := by blaster
theorem fee_contract_fails_certifying : ∀ P r i c, isUnsuccessful (cmpFeeCertifyingT.prop P r i c) := by blaster
theorem fee_contract_fails_voting : ∀ P r v, isUnsuccessful (cmpFeeVotingT.prop P r v) := by blaster
theorem fee_contract_fails_proposing : ∀ P r i p, isUnsuccessful (cmpFeeProposingT.prop P r i p) := by blaster

def osmT (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (info : ScriptInfo) : List Term :=
  toTerm s :: toTerm i :: toTerm rh :: logicArgs r info
def cmpOsmSpending (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (ref : TxOutRef) (d : Option Data) :
    List Term := osmT s i rh r (.SpendingScript ref d)
def cmpOsmRewarding (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (c : Credential) : List Term :=
  osmT s i rh r (.RewardingScript c)
def cmpOsmCertifying (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (j : Integer) (c : TxCert) :
    List Term := osmT s i rh r (.CertifyingScript j c)
def cmpOsmVoting (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (v : Voter) : List Term :=
  osmT s i rh r (.VotingScript v)
def cmpOsmProposing (s : ByteString) (i : Integer) (rh : ByteString) (r : Data) (j : Integer) (p : ProposalProcedure) :
    List Term := osmT s i rh r (.ProposingScript j p)

#prep_uplc cmpOsmSpendingT oneShotMintTemplate cmpOsmSpending 1000
#prep_uplc cmpOsmRewardingT oneShotMintTemplate cmpOsmRewarding 1000
#prep_uplc cmpOsmCertifyingT oneShotMintTemplate cmpOsmCertifying 1000
#prep_uplc cmpOsmVotingT oneShotMintTemplate cmpOsmVoting 1000
#prep_uplc cmpOsmProposingT oneShotMintTemplate cmpOsmProposing 1000

theorem one_shot_mint_fails_spending : ∀ s i rh r ref d,
    isUnsuccessful (cmpOsmSpendingT.prop s i rh r ref d) := by blaster
theorem one_shot_mint_fails_rewarding : ∀ s i rh r c,
    isUnsuccessful (cmpOsmRewardingT.prop s i rh r c) := by blaster
theorem one_shot_mint_fails_certifying : ∀ s i rh r j c,
    isUnsuccessful (cmpOsmCertifyingT.prop s i rh r j c) := by blaster
theorem one_shot_mint_fails_voting : ∀ s i rh r v,
    isUnsuccessful (cmpOsmVotingT.prop s i rh r v) := by blaster
theorem one_shot_mint_fails_proposing : ∀ s i rh r j p,
    isUnsuccessful (cmpOsmProposingT.prop s i rh r j p) := by blaster

/-! ### Concrete runs at the v2 test launch (P = abab…, L = 60294352…), as Lovejoin.Steps:35-37 -/

def cmpTestP : ByteString := Seedelf.V1.ofHex "abababababababababababababababababababababababababababab"
def cmpTestL : ByteString := Seedelf.V1.ofHex "60294352f5eaeb0ca3e0f3de623707fee54c0fdd66b343f3203fcbd7"
def cmpAtTest : List Term := [toTerm cmpTestP, toTerm nftName]

#eval s!"v2 template, minting purpose:  {stepsWith mixLogicTemplate cmpAtTest ⟨Seedelf.V1.emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"v2 template, registration:     {stepsWith mixLogicTemplate cmpAtTest ⟨Seedelf.V1.emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertRegStaking (.ScriptCredential cmpTestL) none)⟩}"
#eval s!"v2 template, unregistration:   {stepsWith mixLogicTemplate cmpAtTest ⟨Seedelf.V1.emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertUnRegStaking (.ScriptCredential cmpTestL) none)⟩}"

end Lovejoin.Template.CompletenessPurpose
