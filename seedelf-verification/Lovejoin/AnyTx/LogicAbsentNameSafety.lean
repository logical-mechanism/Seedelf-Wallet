import Lovejoin.AnyTx.LogicAbsentName
import Lovejoin.AnyTx.LogicOwnerNoCarrier

/-! Whole-validator rejection when reference inputs lack the target asset name. -/
namespace Lovejoin.AnyTx.LogicAbsentNameSafety
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicAbsentName
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

/-- Every structurally valid Owner proof list is rejected when all reference
inputs lack the target NFT name in their ordered maps. -/
theorem owner_shaped_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString))
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_none_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- Every raw Mix proof list is rejected under the same reference-input condition. -/
theorem mix_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P))) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_none_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- The Owner result also covers arbitrary malformed proof data. -/
theorem owner_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_shaped_proofs_errors P r ins sigs acct refs ps hPolicies hNames
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P)))
      sigs acct bad before after hb

/-- Every typed owner withdrawal fails if no reference candidate contains
the target name in the ordered map family. -/
theorem owner_typed_absent_name_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_raw_proofs_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs hPolicies hNames

/-- Every typed mix withdrawal fails if no reference candidate contains
the target name in the ordered map family. -/
theorem mix_typed_absent_name_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_raw_proofs_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs hPolicies hNames

end Lovejoin.AnyTx.LogicAbsentNameSafety

#print axioms Lovejoin.AnyTx.LogicAbsentNameSafety.owner_typed_absent_name_errors
#print axioms Lovejoin.AnyTx.LogicAbsentNameSafety.mix_typed_absent_name_errors
