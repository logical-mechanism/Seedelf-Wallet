import Lovejoin.AnyTx.LogicSortedValue

/-! Bridge from compiled carrier-search uniqueness to actual ledger NFT entries. -/
namespace Lovejoin.AnyTx.LogicLedgerUniqueness
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Lovejoin.AnyTx.LogicCarrierCover
open Lovejoin.AnyTx.LogicLedgerValueCover
open Lovejoin.AnyTx.LogicLedgerCarrier
open Lovejoin.Template (nftName)
open Classical

/-- The input's ledger value contains the target NFT entry with quantity one. -/
def hasNft (P name : ByteString) (input : TxInInfo) : Prop :=
  ∃ names : List (Data × Data),
    ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
    ((.B name, .I 1) : Data × Data) ∈ names

/-- A token lookup returning one must have found its exact entry. -/
theorem find_token_one_member (name : ByteString) (entries : List (Data × Data))
    (h : CardanoLedgerApi.V1.Value.valueOf.find_token name entries = 1) :
    ((.B name, .I 1) : Data × Data) ∈ entries := by
  induction entries with
  | nil => simp [CardanoLedgerApi.V1.Value.valueOf.find_token] at h
  | cons entry rest ih =>
    obtain ⟨key, value⟩ := entry
    simp only [CardanoLedgerApi.V1.Value.valueOf.find_token] at h
    split at h
    next he =>
      subst key
      cases value <;> simp_all
    next _ => exact List.mem_cons_of_mem _ (ih h)

/-- `valueOf = 1` witnesses a concrete policy and token entry. -/
theorem value_of_one_member (P name : ByteString) (value : CardanoLedgerApi.V1.Value)
    (h : CardanoLedgerApi.V1.Value.valueOf P name value = 1) :
    ∃ names : List (Data × Data), ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from value) ∧
      ((.B name, .I 1) : Data × Data) ∈ names := by
  change CardanoLedgerApi.V1.Value.valueOf.visit P name value = 1 at h
  change List (Data × Data) at value
  induction value with
  | nil => simp [CardanoLedgerApi.V1.Value.valueOf.visit] at h
  | cons entry rest ih =>
    obtain ⟨key, item⟩ := entry
    cases item <;> simp only [CardanoLedgerApi.V1.Value.valueOf.visit] at h
    all_goals try (simp at h; done)
    rename_i names
    split at h
    next he =>
      have hk : key = .B P := (beq_iff_eq.mp he).symm
      subst key
      exact ⟨names, by simp, find_token_one_member name names h⟩
    next _ =>
      obtain ⟨names, hp, hn⟩ := ih h
      exact ⟨names, List.mem_cons_of_mem _ hp, hn⟩

/-- On a valid output, an NFT entry and ledger valueOf one are equivalent. -/
theorem has_nft_iff_value_one (P name : ByteString) (input : TxInInfo)
    (hValid : CardanoLedgerApi.V1.Contexts.validTxOutValue input.txInInfoResolved.txOutValue = true) :
    hasNft P name input ↔ CardanoLedgerApi.V1.Value.valueOf P name input.txInInfoResolved.txOutValue = 1 := by
  constructor
  · rintro ⟨names, hp, hn⟩
    exact LogicSortedValue.valid_output_membership_value_of input.txInInfoResolved.txOutValue
      P name names 1 hValid hp hn
  · exact value_of_one_member P name input.txInInfoResolved.txOutValue

/-- Every valid input has a search representation whose carrier flag agrees with
actual ledger NFT membership. -/
theorem valid_input_exact_cover (P name : ByteString) (input : TxInInfo)
    (hValid : CardanoLedgerApi.V1.Contexts.validTxOutValue input.txInInfoResolved.txOutValue = true) :
    ∃ item : Candidate, IsData.toData input = candidateData P name item ∧ ordered P name item ∧
      (carrier item = true ↔ hasNft P name input) := by
  classical
  by_cases hNft : hasNft P name input
  · have hFound := hNft
    obtain ⟨names, hp, hn⟩ := hNft
    obtain ⟨beforePolicies, beforeNames, afterPolicies, afterNames, hv, hPolicies, hNames⟩ :=
      LogicSortedValue.valid_nft_search_shape input.txInInfoResolved.txOutValue P name names hValid hp hn
    cases input with
    | mk ref out =>
      cases out with
      | mk addr value datum script =>
        let entry : LogicCarrierVariable.Candidate := ⟨IsData.toData ref, IsData.toData addr,
          IsData.toData datum, IsData.toData script, 1, beforePolicies, beforeNames, afterPolicies, afterNames⟩
        refine ⟨.present entry, ?_, ⟨hPolicies, hNames⟩, ?_⟩
        · change Data.Constr 0 [IsData.toData ref, .Constr 0 [IsData.toData addr, .Map value,
            IsData.toData datum, IsData.toData script]] = _
          simp [candidateData, LogicCarrierVariable.candidateData, LogicCarrierPredicate.quantityInput,
            Lovejoin.AnyTx.BoxSearch.inputData, entry]
          exact hv
        · constructor
          · intro _; exact hFound
          · intro _; rfl
  · obtain ⟨item, he, ho⟩ := valid_reference_input_cover P name input hValid
    refine ⟨item, he, ho, ?_⟩
    constructor
    · intro hc
      have hm : candidateData P name item ∈ matching P name [item] := by simp [matching, hc]
      obtain ⟨entry, hin, hQty, _⟩ := matching_member_present P name [item] (candidateData P name item) hm
      simp only [List.mem_singleton] at hin
      subst item
      exact False.elim (hNft (present_candidate_contains_nft P name input entry hQty he))
    · intro hc
      exact False.elim (hNft hc)

theorem valid_inputs_exact_cover (P name : ByteString) (inputs : List TxInInfo)
    (h : ∀ input ∈ inputs, CardanoLedgerApi.V1.Contexts.validTxOutValue input.txInInfoResolved.txOutValue = true) :
    ∃ items : List Candidate,
      IsData.toData inputs = Data.List (items.map (candidateData P name)) ∧
      (∀ item ∈ items, ordered P name item) ∧
      matching P name items = (inputs.filter fun input => decide (hasNft P name input)).map IsData.toData := by
  classical
  have hShape : ∃ items : List Candidate,
      inputs.map IsData.toData = items.map (candidateData P name) ∧
      (∀ item ∈ items, ordered P name item) ∧
      matching P name items = (inputs.filter fun input => decide (hasNft P name input)).map IsData.toData := by
    induction inputs with
    | nil => exact ⟨[], rfl, by simp, rfl⟩
    | cons input inputs ih =>
      obtain ⟨item, he, ho, hc⟩ := valid_input_exact_cover P name input (h input (by simp))
      have ht : ∀ input ∈ inputs, CardanoLedgerApi.V1.Contexts.validTxOutValue input.txInInfoResolved.txOutValue = true := by
        intro input hi
        exact h input (by simp [hi])
      obtain ⟨items, hs, hitems, hm⟩ := ih ht
      refine ⟨item :: items, ?_, ?_, ?_⟩
      · simp only [List.map_cons, he, hs]
      · intro x hx
        simp only [List.mem_cons] at hx
        rcases hx with rfl | hx
        · exact ho
        · exact hitems x hx
      · by_cases hn : hasNft P name input
        · have hf : carrier item = true := hc.mpr hn
          simp [matching, hf, hn, he, ← hm]
        · have hf : carrier item = false := by
            cases hflag : carrier item with
            | false => rfl
            | true => exact False.elim (hn (hc.mp hflag))
          simp [matching, hf, hn, ← hm]
  obtain ⟨items, hi, ho, hm⟩ := hShape
  refine ⟨items, ?_, ho, hm⟩
  rw [Lovejoin.AnyTx.BoxCover.inputs_encoding]
  congr 1
  rw [← hi]
  simp only [Lovejoin.AnyTx.BoxSearch.inputList, Lovejoin.AnyTx.BoxCover.inputPairs,
    List.map_map, Function.comp_def]
  apply List.map_congr_left
  intro input _
  cases input
  rfl

/-- A singleton encoded filter contains exactly one actual matching input. -/
theorem singleton_filter_unique (P name : ByteString) (inputs : List TxInInfo) (data : Data)
    (h : (inputs.filter fun input => decide (hasNft P name input)).map IsData.toData = [data]) :
    ∃ input, input ∈ inputs ∧ hasNft P name input ∧
      ∀ other ∈ inputs, hasNft P name other → other = input := by
  classical
  cases hf : inputs.filter (fun input => decide (hasNft P name input)) with
  | nil => simp [hf] at h
  | cons first tail =>
    cases tail with
    | nil =>
      have hfirst : first ∈ inputs ∧ hasNft P name first := by
        have hm : first ∈ inputs.filter (fun input => decide (hasNft P name input)) := by rw [hf]; simp
        simpa using List.mem_filter.mp hm
      refine ⟨first, hfirst.1, hfirst.2, ?_⟩
      intro other hin hn
      have hm : other ∈ inputs.filter (fun input => decide (hasNft P name input)) := by
        apply List.mem_filter.mpr
        exact ⟨hin, by simp [hn]⟩
      rw [hf] at hm
      simpa using hm
    | cons second tail => simp [hf] at h

/-- Successful owner execution with ledger-valid references has exactly one
reference input containing the pool NFT at quantity one. -/
theorem owner_requires_unique_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ hasNft P nftName input ∧
      ∀ other ∈ tx.txInfoReferenceInputs, hasNft P nftName other → other = input := by
  obtain ⟨items, he, ho, hm⟩ := valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (valid_reference_inputs_values (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  obtain ⟨data, hd⟩ := LogicCarrierCoverSafety.owner_acceptance_requires_unique_carrier
    P tx acct items proofs ho he hSuccess
  exact singleton_filter_unique P nftName tx.txInfoReferenceInputs data (hm.symm.trans hd)

/-- Successful mix execution with ledger-valid references has exactly one
reference input containing the pool NFT at quantity one. -/
theorem mix_requires_unique_nft_reference (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ hasNft P nftName input ∧
      ∀ other ∈ tx.txInfoReferenceInputs, hasNft P nftName other → other = input := by
  obtain ⟨items, he, ho, hm⟩ := valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (valid_reference_inputs_values (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  obtain ⟨data, hd⟩ := LogicCarrierCoverSafety.mix_acceptance_requires_unique_carrier
    P tx acct items proofs ho he hSuccess
  exact singleton_filter_unique P nftName tx.txInfoReferenceInputs data (hm.symm.trans hd)

/-- For successful owner execution, exactly one valid reference input has
ledger valueOf one for the pool NFT. -/
theorem owner_requires_unique_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧
      CardanoLedgerApi.V1.Value.valueOf P nftName input.txInInfoResolved.txOutValue = 1 ∧
      ∀ other ∈ tx.txInfoReferenceInputs,
        CardanoLedgerApi.V1.Value.valueOf P nftName other.txInInfoResolved.txOutValue = 1 → other = input := by
  have hv := valid_reference_inputs_values
    (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid
  obtain ⟨input, hi, hn, hu⟩ := owner_requires_unique_nft_reference P tx acct proofs hValid hSuccess
  refine ⟨input, hi, (has_nft_iff_value_one P nftName input (hv input hi)).mp hn, ?_⟩
  intro other ho hvalue
  exact hu other ho ((has_nft_iff_value_one P nftName other (hv other ho)).mpr hvalue)

/-- For successful mix execution, exactly one valid reference input has
ledger valueOf one for the pool NFT. -/
theorem mix_requires_unique_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧
      CardanoLedgerApi.V1.Value.valueOf P nftName input.txInInfoResolved.txOutValue = 1 ∧
      ∀ other ∈ tx.txInfoReferenceInputs,
        CardanoLedgerApi.V1.Value.valueOf P nftName other.txInInfoResolved.txOutValue = 1 → other = input := by
  have hv := valid_reference_inputs_values
    (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid
  obtain ⟨input, hi, hn, hu⟩ := mix_requires_unique_nft_reference P tx acct proofs hValid hSuccess
  refine ⟨input, hi, (has_nft_iff_value_one P nftName input (hv input hi)).mp hn, ?_⟩
  intro other ho hvalue
  exact hu other ho ((has_nft_iff_value_one P nftName other (hv other ho)).mpr hvalue)

end Lovejoin.AnyTx.LogicLedgerUniqueness

/--
info: 'Lovejoin.AnyTx.LogicLedgerUniqueness.owner_requires_unique_nft_reference' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerUniqueness.owner_requires_unique_nft_reference
/--
info: 'Lovejoin.AnyTx.LogicLedgerUniqueness.mix_requires_unique_nft_reference' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerUniqueness.mix_requires_unique_nft_reference

/--
info: 'Lovejoin.AnyTx.LogicLedgerUniqueness.owner_requires_unique_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerUniqueness.owner_requires_unique_value_one
/--
info: 'Lovejoin.AnyTx.LogicLedgerUniqueness.mix_requires_unique_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerUniqueness.mix_requires_unique_value_one
