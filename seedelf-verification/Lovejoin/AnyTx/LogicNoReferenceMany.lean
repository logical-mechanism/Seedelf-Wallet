import Lovejoin.AnyTx.LogicReferenceFilter
import Lovejoin.AnyTx.LogicNoReference
import Lovejoin.AnyTx.LogicOwnerParse
import Lovejoin.AnyTx.LogicMixParse

/-! Missing NFT carrier for arbitrarily many reference inputs. -/
namespace Lovejoin.AnyTx.LogicNoReferenceMany
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicReferenceFilter
open Lovejoin.AnyTx.LogicOwnerParse
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

theorem owner_empty_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (xs : List (Data × Data × Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) sigs,
        .Constr 0 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_empty_values_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem mix_empty_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (xs : List (Data × Data × Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) sigs,
        .Constr 1 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_empty_values_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem owner_ada_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List (Data × Data × Data × Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, ada, datum, script) => adaInput ref addr ada datum script)) sigs,
        .Constr 0 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_ada_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem mix_ada_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List (Data × Data × Data × Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, ada, datum, script) => adaInput ref addr ada datum script)) sigs,
        .Constr 1 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_ada_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem owner_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 0 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem mix_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 1 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

/-- The same missing-carrier rule for typed transactions whose reference inputs
encode to the given interleaved list. -/
theorem owner_typed_plain_values_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (xs.map plainReferenceData)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List []], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List []], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_plain_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda xs

/-- The same missing-carrier rule for typed transactions whose reference inputs
encode to the given interleaved list. -/
theorem mix_typed_plain_values_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (xs.map plainReferenceData)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List []], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List []], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_plain_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda xs

theorem owner_one_proof_plain_values_errors (P t z : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 0 [.List [proofData t z]], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem owner_two_proofs_plain_values_errors (P t1 z1 t2 z2 : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 0 [.List [proofData t1 z1, proofData t2 z2]], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

/-- No number of well-shaped Owner proofs can make non-carrier references authorize a withdrawal. -/
theorem owner_any_proofs_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) (proofs : List (ByteString × ByteString)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 0 [.List (proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [owner_proof_list_validates, filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

/-- Any number of Mix proofs with empty branch lists fail without a reference carrier. -/
theorem mix_empty_branch_proofs_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) (n : Nat) :
    ∃ steps, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 1 [.List (LogicMixParse.proofList n)], .Constr 2 [acct]])] steps = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_empty_branches_validate, filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem mix_any_proofs_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) (proofs : List (List LogicMixParse.Branch)) :
    ∃ steps, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList proofs)], .Constr 2 [acct]])] steps = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_full_proof_list_validates, filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem owner_any_proofs_empty_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (xs : List (Data × Data × Data × Data)) (proofs : List (ByteString × ByteString)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) sigs,
        .Constr 0 [.List (proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [owner_proof_list_validates, filter_empty_values_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

/-- Arbitrary structurally formed owner proofs still fail when typed reference
inputs contain only empty or ADA-only values. -/
theorem owner_typed_any_proofs_plain_values_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (xs.map plainReferenceData))
    (proofs : List (ByteString × ByteString)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_any_proofs_plain_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda xs proofs

/-- Arbitrary structurally formed mix proofs still fail when typed reference
inputs contain only empty or ADA-only values. -/
theorem mix_typed_any_proofs_plain_values_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (xs.map plainReferenceData))
    (proofs : List (List LogicMixParse.Branch)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List (LogicMixParse.fullProofList proofs)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List (LogicMixParse.fullProofList proofs)], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_any_proofs_plain_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda xs proofs

theorem mix_raw_proofs_plain_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) (proofs : List Data) :
    ∃ steps, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map plainReferenceData)) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] steps = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_plain_values_slots, hAfterAda]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

theorem mix_raw_proofs_empty_values_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (xs : List (Data × Data × Data × Data)) (proofs : List Data) :
    ∃ steps, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] steps = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_empty_values_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try cek_v3
  all_goals try assumption

end Lovejoin.AnyTx.LogicNoReferenceMany

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.owner_ada_values_errors
#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_ada_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.owner_plain_values_errors
#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_plain_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.owner_typed_plain_values_errors
#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_typed_plain_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.owner_any_proofs_plain_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_empty_branch_proofs_plain_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_any_proofs_plain_values_errors

/--
info: 'Lovejoin.AnyTx.LogicNoReferenceMany.mix_typed_any_proofs_plain_values_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_typed_any_proofs_plain_values_errors

#print axioms Lovejoin.AnyTx.LogicNoReferenceMany.mix_raw_proofs_plain_values_errors
