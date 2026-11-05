import Lovejoin.AnyTx.LogicWrongQuantity
import Lovejoin.AnyTx.LogicCarrierFilterExact

/-! Whole-validator duplicate-carrier rejection for ordered asset-map layouts. -/
namespace Lovejoin.AnyTx.LogicDuplicateCarrier
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicCarrierFilterExact
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

/-- Two or more candidate carriers reject regardless of a structurally valid
Owner proof list and all unrelated transaction fields. -/
theorem owner_shaped_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_two_or_more_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- The same duplicate-carrier rule covers every raw Mix proof list. -/
theorem mix_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_two_or_more_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- Duplicate carriers reject every raw Owner proof list. -/
theorem owner_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_shaped_proofs_errors P r ins sigs acct beforePolicies beforeNames afterPolicies afterNames
      refs ps first second tail hPolicies hNames hP hN hMany
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins
      (.List (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) sigs acct bad before after hb

/-- Duplicate carriers reject every raw Mix proof list. -/
theorem mix_all_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  exact mix_raw_proofs_errors P r ins sigs acct beforePolicies beforeNames afterPolicies afterNames
    refs proofs first second tail hPolicies hNames hP hN hMany

/-- A typed V3 owner withdrawal with at least two carriers errors for any proofs. -/
theorem owner_typed_duplicate_carriers_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_raw_proofs_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) beforePolicies beforeNames afterPolicies afterNames
    refs proofs first second tail hPolicies hNames hMany

/-- A typed V3 mix withdrawal with at least two carriers errors for any proofs. -/
theorem mix_typed_duplicate_carriers_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data) (first second : Data) (tail : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hMany : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_all_proofs_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) beforePolicies beforeNames afterPolicies afterNames
    refs proofs first second tail hPolicies hNames hMany

end Lovejoin.AnyTx.LogicDuplicateCarrier

/--
info: 'Lovejoin.AnyTx.LogicDuplicateCarrier.owner_typed_duplicate_carriers_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicDuplicateCarrier.owner_typed_duplicate_carriers_errors
/--
info: 'Lovejoin.AnyTx.LogicDuplicateCarrier.mix_typed_duplicate_carriers_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicDuplicateCarrier.mix_typed_duplicate_carriers_errors
