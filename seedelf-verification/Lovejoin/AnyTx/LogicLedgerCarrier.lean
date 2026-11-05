import Lovejoin.AnyTx.LogicLedgerValueCover

/-! Ledger-valid reference-input coverage connected to the full validator. -/
namespace Lovejoin.AnyTx.LogicLedgerCarrier
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Lovejoin.AnyTx.LogicCarrierCover
open Lovejoin.AnyTx.LogicLedgerValueCover
open Lovejoin.Template (nftName)

/-- For every ledger-valid V3 reference-input list, a successful owner
withdrawal has exactly one carrier in the compiled-search representation. -/
theorem owner_valid_references_require_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ items : List Candidate,
      IsData.toData tx.txInfoReferenceInputs = Data.List (items.map (candidateData P nftName)) ∧
      (∀ item ∈ items, ordered P nftName item) ∧
      ∃ carrier, matching P nftName items = [carrier] := by
  obtain ⟨items, he, ho⟩ := ledger_reference_inputs_cover P nftName
    (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid
  exact ⟨items, he, ho,
    Lovejoin.AnyTx.LogicCarrierCoverSafety.owner_acceptance_requires_unique_carrier
      P tx acct items proofs ho he hSuccess⟩

/-- For every ledger-valid V3 reference-input list, a successful mix
withdrawal has exactly one carrier in the compiled-search representation. -/
theorem mix_valid_references_require_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ items : List Candidate,
      IsData.toData tx.txInfoReferenceInputs = Data.List (items.map (candidateData P nftName)) ∧
      (∀ item ∈ items, ordered P nftName item) ∧
      ∃ carrier, matching P nftName items = [carrier] := by
  obtain ⟨items, he, ho⟩ := ledger_reference_inputs_cover P nftName
    (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid
  exact ⟨items, he, ho,
    Lovejoin.AnyTx.LogicCarrierCoverSafety.mix_acceptance_requires_unique_carrier
      P tx acct items proofs ho he hSuccess⟩

/-- A retained carrier comes from a target-present candidate with quantity one. -/
theorem matching_member_present (P name : ByteString) (items : List Candidate) (data : Data)
    (h : data ∈ matching P name items) :
    ∃ item : LogicCarrierVariable.Candidate,
      Candidate.present item ∈ items ∧ item.qty = 1 ∧ data = candidateData P name (.present item) := by
  obtain ⟨item, hi, he⟩ := List.mem_filterMap.mp h
  cases item with
  | present item =>
    by_cases hQty : item.qty = 1
    · refine ⟨item, hi, hQty, ?_⟩
      simpa [carrier, hQty] using he.symm
    · simp [carrier, hQty] at he
  | absentName item => simp [carrier] at he
  | absentNameAfter item => simp [carrier] at he
  | absentPolicy ref addr datum script policies => simp [carrier] at he
  | absentPolicyAfter ref addr datum script policies nextPolicy nextValue afterPolicies => simp [carrier] at he

/-- A covered candidate in a ledger-encoded input list comes from a typed input. -/
theorem matching_candidate_has_input (P name : ByteString) (inputs : List TxInInfo)
    (items : List Candidate)
    (he : IsData.toData inputs = Data.List (items.map (candidateData P name)))
    (item : Candidate) (hi : item ∈ items) :
    ∃ input ∈ inputs, IsData.toData input = candidateData P name item := by
  rw [Lovejoin.AnyTx.BoxCover.inputs_encoding] at he
  have hm : Lovejoin.AnyTx.BoxSearch.inputList (Lovejoin.AnyTx.BoxCover.inputPairs inputs) =
      items.map (candidateData P name) := Data.List.inj he
  have hd : candidateData P name item ∈
      Lovejoin.AnyTx.BoxSearch.inputList (Lovejoin.AnyTx.BoxCover.inputPairs inputs) := by
    rw [hm]
    exact List.mem_map.mpr ⟨item, hi, rfl⟩
  simp only [Lovejoin.AnyTx.BoxSearch.inputList, Lovejoin.AnyTx.BoxCover.inputPairs,
    List.map_map, Function.comp_def] at hd
  obtain ⟨input, hin, hv⟩ := List.mem_map.mp hd
  refine ⟨input, hin, ?_⟩
  cases input
  exact hv

/-- An encoded quantity-one present candidate corresponds to an actual target
policy/name entry in the reference input's ledger value. -/
theorem present_candidate_contains_nft (P name : ByteString) (input : TxInInfo)
    (item : LogicCarrierVariable.Candidate) (hQty : item.qty = 1)
    (he : IsData.toData input = candidateData P name (.present item)) :
    ∃ names : List (Data × Data), ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B name, .I 1) : Data × Data) ∈ names := by
  cases input with
  | mk ref out =>
    cases out with
    | mk addr value datum script =>
      change Data.Constr 0 [IsData.toData ref, .Constr 0 [IsData.toData addr, .Map value,
        IsData.toData datum, IsData.toData script]] = _ at he
      simp [candidateData, LogicCarrierVariable.candidateData, LogicCarrierPredicate.quantityInput,
        Lovejoin.AnyTx.BoxSearch.inputData] at he
      refine ⟨LogicNameLookup.namePairs item.beforeNames ++ (.B name, .I item.qty) :: item.afterNames, ?_, ?_⟩
      · rw [he.2.2.1]
        simp
      · simp [hQty]

/-- Every successful typed owner withdrawal with ledger-valid reference inputs
contains a reference output with the pool NFT at quantity one. -/
theorem owner_success_requires_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names := by
  obtain ⟨items, hRefs, _, carrier, hOne⟩ :=
    owner_valid_references_require_unique_carrier P tx acct proofs hValid hSuccess
  have hc : carrier ∈ matching P nftName items := by rw [hOne]; simp
  obtain ⟨item, hi, hQty, _⟩ := matching_member_present P nftName items carrier hc
  obtain ⟨input, hin, he⟩ := matching_candidate_has_input P nftName tx.txInfoReferenceInputs items hRefs (.present item) hi
  exact ⟨input, hin, present_candidate_contains_nft P nftName input item hQty he⟩

/-- Every successful typed mix withdrawal with ledger-valid reference inputs
contains a reference output with the pool NFT at quantity one. -/
theorem mix_success_requires_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names := by
  obtain ⟨items, hRefs, _, carrier, hOne⟩ :=
    mix_valid_references_require_unique_carrier P tx acct proofs hValid hSuccess
  have hc : carrier ∈ matching P nftName items := by rw [hOne]; simp
  obtain ⟨item, hi, hQty, _⟩ := matching_member_present P nftName items carrier hc
  obtain ⟨input, hin, he⟩ := matching_candidate_has_input P nftName tx.txInfoReferenceInputs items hRefs (.present item) hi
  exact ⟨input, hin, present_candidate_contains_nft P nftName input item hQty he⟩

/-- Full ledger-model context validity includes reference-input validity. -/
theorem valid_reference_inputs_of_valid_context (ctx : ScriptContext)
    (h : CardanoLedgerApi.V3.Contexts.validScriptContext ctx = true) :
    CardanoLedgerApi.V3.Contexts.validReferenceInputs ctx = true := by
  simp only [CardanoLedgerApi.V3.Contexts.validScriptContext, Bool.and_eq_true] at h
  have ht := h.2
  simp only [CardanoLedgerApi.V3.Contexts.validTxInfo, Bool.and_eq_true, and_assoc] at ht
  exact ht.2.1

/-- In a fully ledger-valid context, successful owner execution requires a
reference output containing the pool NFT at quantity one. -/
theorem owner_valid_context_requires_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names :=
  owner_success_requires_nft_reference P tx acct proofs
    (valid_reference_inputs_of_valid_context _ hValid) hSuccess

/-- In a fully ledger-valid context, successful mix execution requires a
reference output containing the pool NFT at quantity one. -/
theorem mix_valid_context_requires_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names :=
  mix_success_requires_nft_reference P tx acct proofs
    (valid_reference_inputs_of_valid_context _ hValid) hSuccess

end Lovejoin.AnyTx.LogicLedgerCarrier

#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.owner_valid_references_require_unique_carrier
#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.mix_valid_references_require_unique_carrier

#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.owner_success_requires_nft_reference
#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.mix_success_requires_nft_reference

/--
info: 'Lovejoin.AnyTx.LogicLedgerCarrier.owner_valid_context_requires_nft_reference' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.owner_valid_context_requires_nft_reference
/--
info: 'Lovejoin.AnyTx.LogicLedgerCarrier.mix_valid_context_requires_nft_reference' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerCarrier.mix_valid_context_requires_nft_reference
