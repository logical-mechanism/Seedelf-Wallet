import Lovejoin.AnyTx.CekCase
import Lovejoin.Template.AnyTxPurposes

/-! Kernel-checked compiled purpose dispatch, with arbitrary transaction fields and
purpose payloads. The spending, rewarding and minting handlers are covered separately. -/
namespace Lovejoin.AnyTx.PurposesKernel
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (purposeCtx)
set_option maxHeartbeats 0

theorem logic_minting_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 0 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem logic_spending_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 1 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem logic_voting_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 4 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem logic_proposing_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 5 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem fee_minting_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram feeContractTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 0 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem fee_rewarding_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram feeContractTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 2 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem fee_certifying_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram feeContractTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem fee_voting_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram feeContractTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 4 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem fee_proposing_errors (P : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram feeContractTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 5 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mint_spending_errors (seed : ByteString) (idx : Integer) (rh : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seed, toTerm idx, toTerm rh, toTerm (purposeCtx 1 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mint_rewarding_errors (seed : ByteString) (idx : Integer) (rh : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seed, toTerm idx, toTerm rh, toTerm (purposeCtx 2 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mint_certifying_errors (seed : ByteString) (idx : Integer) (rh : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seed, toTerm idx, toTerm rh, toTerm (purposeCtx 3 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mint_voting_errors (seed : ByteString) (idx : Integer) (rh : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seed, toTerm idx, toTerm rh, toTerm (purposeCtx 4 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mint_proposing_errors (seed : ByteString) (idx : Integer) (rh : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seed, toTerm idx, toTerm rh, toTerm (purposeCtx 5 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- The reference holder rejects any spending context. -/
theorem reference_holder_spending_errors (info red ref datum : Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 1 info red [ref, datum])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem reference_holder_minting_errors (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 0 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem reference_holder_rewarding_errors (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 2 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem reference_holder_certifying_errors (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 3 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem reference_holder_voting_errors (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 4 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem reference_holder_proposing_errors (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (purposeCtx 5 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Every typed V3 reference-holder context reaches Error. -/
theorem reference_holder_every_context_errors (ctx : ScriptContext) :
    ∃ n, cekExecuteProgram referenceHolder.script [toTerm (IsData.toData ctx)] n = .Error := by
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | MintingScript cs => exact reference_holder_minting_errors (IsData.toData tx) red [IsData.toData cs]
  | SpendingScript ref datum => exact reference_holder_spending_errors (IsData.toData tx) red (IsData.toData ref) (IsData.toData datum)
  | RewardingScript cred => exact reference_holder_rewarding_errors (IsData.toData tx) red [IsData.toData cred]
  | CertifyingScript idx cert => exact reference_holder_certifying_errors (IsData.toData tx) red [IsData.toData idx, IsData.toData cert]
  | VotingScript voter => exact reference_holder_voting_errors (IsData.toData tx) red [IsData.toData voter]
  | ProposingScript idx proposal => exact reference_holder_proposing_errors (IsData.toData tx) red [IsData.toData idx, IsData.toData proposal]

end Lovejoin.AnyTx.PurposesKernel

#print axioms Lovejoin.AnyTx.PurposesKernel.reference_holder_spending_errors

/--
info: 'Lovejoin.AnyTx.PurposesKernel.reference_holder_every_context_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.PurposesKernel.reference_holder_every_context_errors
