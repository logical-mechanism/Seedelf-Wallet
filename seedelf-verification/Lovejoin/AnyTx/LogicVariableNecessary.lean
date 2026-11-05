import Lovejoin.AnyTx.LogicCarrierVariable
import Lovejoin.AnyTx.LogicOwnerNoCarrier

/-! A unique carrier is necessary when each candidate has independently varying
ordered asset-map prefixes and suffixes. -/
namespace Lovejoin.AnyTx.LogicVariableNecessary
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicCarrierVariable
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

/-- A non-unique carrier set rejects this owner proof list. -/
theorem owner_nonunique_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString))
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hNonunique : ¬ ∃ carrier, matchingCandidates P nftName refs = [carrier]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  cases hc : matchingCandidates P nftName refs with
  | nil =>
    apply exec_error_of_ev
    cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_empty_slots]
    all_goals try (intros; apply ap_lam; cek_v3)
    all_goals try assumption
    all_goals try cek_v3
    all_goals try assumption
  | cons first tail =>
    cases tail with
    | nil => exact False.elim (hNonunique ⟨first, hc⟩)
    | cons second tail =>
      apply exec_error_of_ev
      cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_two_or_more_slots]
      all_goals try (intros; apply ap_lam; cek_v3)
      all_goals try assumption
      all_goals try cek_v3
      all_goals try assumption

/-- A non-unique carrier set rejects this mix proof list. -/
theorem mix_nonunique_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hNonunique : ¬ ∃ carrier, matchingCandidates P nftName refs = [carrier]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  cases hc : matchingCandidates P nftName refs with
  | nil =>
    apply exec_error_of_ev
    cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_empty_slots]
    all_goals try (intros; apply ap_lam; cek_v3)
    all_goals try assumption
    all_goals try cek_v3
    all_goals try assumption
  | cons first tail =>
    cases tail with
    | nil => exact False.elim (hNonunique ⟨first, hc⟩)
    | cons second tail =>
      apply exec_error_of_ev
      cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_two_or_more_slots]
      all_goals try (intros; apply ap_lam; cek_v3)
      all_goals try assumption
      all_goals try cek_v3
      all_goals try assumption

/-- Every raw Owner proof list rejects when the carrier set is non-unique. -/
theorem owner_raw_nonunique_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hNonunique : ¬ ∃ carrier, matchingCandidates P nftName refs = [carrier]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_nonunique_errors P r ins sigs acct refs ps hPolicies hNames hNonunique
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct bad before after hb

/-- Any successful typed owner withdrawal has exactly one carrier when
each reference candidate has its own ordered asset-map layout. -/
theorem owner_acceptance_requires_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName)))
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ carrier, matchingCandidates P nftName refs = [carrier] := by
  by_cases hUnique : ∃ carrier, matchingCandidates P nftName refs = [carrier]
  · exact hUnique
  · have hNonunique := hUnique
    have hError := owner_raw_nonunique_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
      (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs hPolicies hNames hNonunique
    obtain ⟨m, hm⟩ := hError
    obtain ⟨n, hn⟩ := hSuccess
    change cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
        (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
        (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Halt (.VCon .Unit) at hn
    rw [hRefs] at hn
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)

/-- Any successful typed mix withdrawal has exactly one carrier when
each reference candidate has its own ordered asset-map layout. -/
theorem mix_acceptance_requires_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName)))
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ carrier, matchingCandidates P nftName refs = [carrier] := by
  by_cases hUnique : ∃ carrier, matchingCandidates P nftName refs = [carrier]
  · exact hUnique
  · have hNonunique := hUnique
    have hError := mix_nonunique_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
      (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs hPolicies hNames hNonunique
    obtain ⟨m, hm⟩ := hError
    obtain ⟨n, hn⟩ := hSuccess
    change cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
        (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
        (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Halt (.VCon .Unit) at hn
    rw [hRefs] at hn
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)

end Lovejoin.AnyTx.LogicVariableNecessary

/--
info: 'Lovejoin.AnyTx.LogicVariableNecessary.owner_acceptance_requires_unique_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicVariableNecessary.owner_acceptance_requires_unique_carrier
/--
info: 'Lovejoin.AnyTx.LogicVariableNecessary.mix_acceptance_requires_unique_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicVariableNecessary.mix_acceptance_requires_unique_carrier
