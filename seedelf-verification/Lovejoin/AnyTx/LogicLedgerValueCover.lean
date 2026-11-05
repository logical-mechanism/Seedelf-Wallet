import Lovejoin.AnyTx.LogicCarrierCoverSafety

/-! Coverage of ledger-shaped asset maps by the compiled carrier-filter cases. -/
namespace Lovejoin.AnyTx.LogicLedgerValueCover
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open Lovejoin.AnyTx.LogicCarrierCover

def tokenData (xs : List (ByteString × Integer)) : List (Data × Data) :=
  xs.map fun p => (.B p.1, .I p.2)

def policyData (xs : List (ByteString × List (ByteString × Integer))) : List (Data × Data) :=
  xs.map fun p => (.B p.1, .Map (tokenData p.2))

/-- The compiled ordered search divides any byte-keyed list into entries it skips
and the first entry at which it stops. The tail need not be ordered. -/
theorem search_cut (target : ByteString) (xs : List (ByteString × α)) :
    ∃ before after, xs = before ++ after ∧
      (∀ p ∈ before, PlutusCore.ByteString.lessThanEqualsByteString target p.1 = false) ∧
      (after = [] ∨ ∃ k v tail, after = (k, v) :: tail ∧
        PlutusCore.ByteString.lessThanEqualsByteString target k = true) := by
  induction xs with
  | nil => exact ⟨[], [], rfl, by simp, Or.inl rfl⟩
  | cons item xs ih =>
    rcases item with ⟨key, value⟩
    cases h : PlutusCore.ByteString.lessThanEqualsByteString target key with
    | true => exact ⟨[], (key, value) :: xs, rfl, by simp, Or.inr ⟨key, value, xs, rfl, h⟩⟩
    | false =>
      obtain ⟨before, after, he, hb, ha⟩ := ih
      refine ⟨(key, value) :: before, after, ?_, ?_, ha⟩
      · simp [he]
      · intro pair hp
        simp only [List.mem_cons] at hp
        rcases hp with rfl | hp
        · exact h
        · exact hb pair hp

/-- Equality in the compiled byte-string test is ordinary byte-string equality. -/
theorem bytes_eq_of_builtin (a b : ByteString)
    (h : PlutusCore.ByteString.equalsByteString a b = true) : a = b := by
  simpa [PlutusCore.ByteString.equalsByteString] using h

def policyBefore (xs : List (ByteString × List (ByteString × Integer))) : List (ByteString × Data) :=
  xs.map fun p => (p.1, .Map (tokenData p.2))

def nameBefore (xs : List (ByteString × Integer)) : List (ByteString × Data) :=
  xs.map fun p => (p.1, .I p.2)

theorem policy_before_order (P : ByteString) (xs : List (ByteString × List (ByteString × Integer)))
    (h : ∀ p ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P p.1 = false) :
    ∀ p ∈ policyBefore xs, PlutusCore.ByteString.lessThanEqualsByteString P p.1 = false := by
  intro p hp
  obtain ⟨⟨key, names⟩, hin, rfl⟩ := List.mem_map.mp hp
  exact h (key, names) hin

theorem name_before_order (name : ByteString) (xs : List (ByteString × Integer))
    (h : ∀ p ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name p.1 = false) :
    ∀ p ∈ nameBefore xs, PlutusCore.ByteString.lessThanEqualsByteString name p.1 = false := by
  intro p hp
  obtain ⟨⟨key, qty⟩, hin, rfl⟩ := List.mem_map.mp hp
  exact h (key, qty) hin

/-- Any byte-keyed policy/name maps in which the target policy occurs have one
of the carrier-filter's present or absent-name shapes. -/
theorem cover_present_policy (P name : ByteString) (ref addr datum script : Data)
    (beforePolicies afterPolicies : List (ByteString × List (ByteString × Integer)))
    (names : List (ByteString × Integer))
    (hBefore : ∀ p ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P p.1 = false) :
    ∃ item : Candidate,
      candidateData P name item = Lovejoin.AnyTx.BoxSearch.inputData ref
        (.Constr 0 [addr, .Map (policyData beforePolicies ++ (.B P, .Map (tokenData names)) :: policyData afterPolicies), datum, script]) ∧
      ordered P name item := by
  obtain ⟨before, after, he, hb, hs⟩ := search_cut name names
  rcases hs with hn | ⟨next, qty, tail, ht, hLe⟩
  · subst after
    let item : LogicAbsentName.Candidate := ⟨ref, addr, datum, script, policyBefore beforePolicies,
      nameBefore before, policyData afterPolicies⟩
    refine ⟨.absentName item, ?_, ?_⟩
    · simp [candidateData, LogicAbsentName.candidateData, LogicAbsentName.absentNameInput,
        item, policyBefore, nameBefore, policyData, tokenData, LogicPolicyLookup.policyPairs,
        LogicNameLookup.namePairs, List.map_map, Function.comp_def, he]
    · exact ⟨policy_before_order P beforePolicies hBefore, name_before_order name before hb⟩
  · subst after
    cases hEq : PlutusCore.ByteString.equalsByteString name next with
    | true =>
      have hn : name = next := bytes_eq_of_builtin name next hEq
      subst next
      let item : LogicCarrierVariable.Candidate := ⟨ref, addr, datum, script, qty,
        policyBefore beforePolicies, nameBefore before, policyData afterPolicies, tokenData tail⟩
      refine ⟨.present item, ?_, ?_⟩
      · simp [candidateData, LogicCarrierVariable.candidateData, LogicCarrierPredicate.quantityInput,
          item, policyBefore, nameBefore, policyData, tokenData, LogicPolicyLookup.policyPairs,
          LogicNameLookup.namePairs, List.map_map, Function.comp_def, he]
      · exact ⟨policy_before_order P beforePolicies hBefore, name_before_order name before hb⟩
    | false =>
      let item : LogicAbsentNameAfter.Candidate := ⟨ref, addr, datum, script, policyBefore beforePolicies,
        nameBefore before, policyData afterPolicies, next, .I qty, tokenData tail⟩
      refine ⟨.absentNameAfter item, ?_, ?_⟩
      · simp [candidateData, LogicAbsentNameAfter.candidateData, LogicAbsentNameAfter.absentNameInput,
          item, policyBefore, nameBefore, policyData, tokenData, LogicPolicyLookup.policyPairs,
          LogicNameLookup.namePairs, List.map_map, Function.comp_def, he]
      · exact ⟨policy_before_order P beforePolicies hBefore, name_before_order name before hb, hLe, hEq⟩

/-- Every byte-keyed asset map with byte-keyed integer quantities fits the
compiled carrier-filter cover, without assuming that the map is sorted. -/
theorem cover_asset_map (P name : ByteString) (ref addr datum script : Data)
    (policies : List (ByteString × List (ByteString × Integer))) :
    ∃ item : Candidate,
      candidateData P name item = Lovejoin.AnyTx.BoxSearch.inputData ref
        (.Constr 0 [addr, .Map (policyData policies), datum, script]) ∧ ordered P name item := by
  obtain ⟨before, after, he, hb, hs⟩ := search_cut P policies
  rcases hs with hn | ⟨next, names, tail, ht, hLe⟩
  · subst after
    refine ⟨.absentPolicy ref addr datum script (policyBefore before), ?_, ?_⟩
    · simp [candidateData, LogicAbsentPolicy.absentPolicyInput, policyBefore, policyData, tokenData,
        LogicPolicyLookup.policyPairs, List.map_map, Function.comp_def, he]
    · exact policy_before_order P before hb
  · subst after
    cases hEq : PlutusCore.ByteString.equalsByteString P next with
    | true =>
      have hp : P = next := bytes_eq_of_builtin P next hEq
      subst next
      obtain ⟨item, hi, ho⟩ := cover_present_policy P name ref addr datum script before tail names hb
      refine ⟨item, ?_, ho⟩
      simpa [policyData, List.map_append, he] using hi
    | false =>
      refine ⟨.absentPolicyAfter ref addr datum script (policyBefore before) next (.Map (tokenData names)) (policyData tail), ?_, ?_⟩
      · simp [candidateData, LogicAbsentPolicyAfter.absentPolicyInput, policyBefore, policyData,
          LogicPolicyLookup.policyPairs, List.map_map, Function.comp_def, he]
      · exact ⟨policy_before_order P before hb, hLe, hEq⟩

open CardanoLedgerApi.V1.Contexts (validTxOutValue)
open CardanoLedgerApi.V1.Contexts.validTxOutValue (validTokens validCurrencySymbol)

private theorem names_of_valid : ∀ (tns : List (Data × Data)) (prev : ByteString),
    validTokens tns prev = true → ∃ ts : List (ByteString × Integer), tns = tokenData ts := by
  intro tns
  induction tns with
  | nil => intro _ _; exact ⟨[], rfl⟩
  | cons p xs ih =>
    intro prev h
    obtain ⟨a, b⟩ := p
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validTokens] at h; done)
    simp only [validTokens, Bool.and_eq_true] at h
    obtain ⟨ts, ht⟩ := ih tn h.2
    exact ⟨(tn, n) :: ts, by simp [tokenData, ht]⟩

private theorem policies_of_valid : ∀ (v : List (Data × Data)) (prev : ByteString),
    validCurrencySymbol v prev = true →
    ∃ lines : List (ByteString × List (ByteString × Integer)), v = policyData lines := by
  intro v
  induction v with
  | nil => intro _ _; exact ⟨[], rfl⟩
  | cons p xs ih =>
    intro prev h
    obtain ⟨a, b⟩ := p
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true] at h
    obtain ⟨ts, ht⟩ := names_of_valid tokens tn h.1.2
    obtain ⟨lines, hv⟩ := ih cs h.2
    exact ⟨(cs, (tn, n) :: ts) :: lines, by simp [policyData, tokenData, ht, hv]⟩

/-- The ledger model's valid output-value predicate implies the byte-keyed,
integer-quantity map shape used by `cover_asset_map`. -/
theorem valid_output_value_shape (v : CardanoLedgerApi.V1.Value)
    (h : validTxOutValue v = true) :
    ∃ lines : List (ByteString × List (ByteString × Integer)), v = policyData lines := by
  cases v with
  | nil => simp [validTxOutValue] at h
  | cons p xs =>
    obtain ⟨a, b⟩ := p
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validTxOutValue] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validTxOutValue] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, names⟩
    · simp [validTxOutValue] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTxOutValue] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validTxOutValue] at h; done)
    simp only [validTxOutValue] at h
    split at h
    next n0 n' xs' =>
      simp only [Bool.and_eq_true] at h
      simp_all only [List.cons.injEq, Prod.mk.injEq, Data.B.injEq, Data.Map.injEq, Data.I.injEq]
      obtain ⟨lines, hv⟩ := policies_of_valid n' "" h.2
      refine ⟨("", [("", n0)]) :: lines, ?_⟩
      simp [policyData, tokenData, hv]
    next => contradiction

/-- Every typed reference input with a ledger-valid output value has a covered
compiled-search representation. -/
theorem valid_reference_input_cover (P name : ByteString) (input : TxInInfo)
    (h : validTxOutValue input.txInInfoResolved.txOutValue = true) :
    ∃ item : Candidate, IsData.toData input = candidateData P name item ∧ ordered P name item := by
  obtain ⟨lines, hv⟩ := valid_output_value_shape input.txInInfoResolved.txOutValue h
  cases input with
  | mk ref out =>
    cases out with
    | mk addr value datum script =>
      dsimp only at hv
      subst value
      obtain ⟨item, he, ho⟩ := cover_asset_map P name (IsData.toData ref) (IsData.toData addr)
        (IsData.toData datum) (IsData.toData script) lines
      exact ⟨item, he.symm, ho⟩

/-- Lists of individually valid reference inputs are entirely covered. -/
theorem valid_reference_inputs_cover (P name : ByteString) (inputs : List TxInInfo)
    (h : ∀ input ∈ inputs, validTxOutValue input.txInInfoResolved.txOutValue = true) :
    ∃ items : List Candidate,
      IsData.toData inputs = Data.List (items.map (candidateData P name)) ∧
      ∀ item ∈ items, ordered P name item := by
  have hShape : ∃ items : List Candidate,
      inputs.map IsData.toData = items.map (candidateData P name) ∧
      ∀ item ∈ items, ordered P name item := by
    induction inputs with
    | nil => exact ⟨[], rfl, by simp⟩
    | cons input inputs ih =>
      obtain ⟨item, he, ho⟩ := valid_reference_input_cover P name input (h input (by simp))
      have ht : ∀ input ∈ inputs, validTxOutValue input.txInInfoResolved.txOutValue = true := by
        intro input hi
        exact h input (by simp [hi])
      obtain ⟨items, hs, hitems⟩ := ih ht
      refine ⟨item :: items, ?_, ?_⟩
      · simp only [List.map_cons, he, hs]
      · intro x hx
        simp only [List.mem_cons] at hx
        rcases hx with rfl | hx
        · exact ho
        · exact hitems x hx
  obtain ⟨items, hi, ho⟩ := hShape
  refine ⟨items, ?_, ho⟩
  rw [Lovejoin.AnyTx.BoxCover.inputs_encoding]
  congr 1
  rw [← hi]
  simp only [Lovejoin.AnyTx.BoxSearch.inputList, Lovejoin.AnyTx.BoxCover.inputPairs,
    List.map_map, Function.comp_def]
  apply List.map_congr_left
  intro input _
  cases input
  rfl

private theorem valid_reference_visit_values : ∀ (inputs : List TxInInfo) (prev : TxOutRef),
    CardanoLedgerApi.V3.Contexts.validReferenceInputs.visit inputs prev = true →
    ∀ input ∈ inputs, validTxOutValue input.txInInfoResolved.txOutValue = true := by
  intro inputs
  induction inputs with
  | nil => simp
  | cons input inputs ih =>
    intro prev h x hx
    simp only [CardanoLedgerApi.V3.Contexts.validReferenceInputs.visit, Bool.and_eq_true] at h
    simp only [List.mem_cons] at hx
    rcases hx with rfl | hx
    · exact h.1.2
    · exact ih input.txInInfoOutRef h.2 x hx

/-- The ledger model's reference-input validity entails validity of every value. -/
theorem valid_reference_inputs_values (ctx : ScriptContext)
    (h : CardanoLedgerApi.V3.Contexts.validReferenceInputs ctx = true) :
    ∀ input ∈ ctx.scriptContextTxInfo.txInfoReferenceInputs,
      validTxOutValue input.txInInfoResolved.txOutValue = true := by
  cases hs : ctx.scriptContextTxInfo.txInfoReferenceInputs with
  | nil => simp [hs]
  | cons input inputs =>
    have hh : validTxOutValue input.txInInfoResolved.txOutValue = true ∧
        CardanoLedgerApi.V3.Contexts.validReferenceInputs.visit inputs input.txInInfoOutRef = true := by
      simpa [CardanoLedgerApi.V3.Contexts.validReferenceInputs, hs, Bool.and_eq_true] using h
    intro x hx
    simp only [List.mem_cons] at hx
    rcases hx with rfl | hx
    · exact hh.1
    · exact valid_reference_visit_values inputs input.txInInfoOutRef hh.2 x hx

/-- Every ledger-valid V3 reference-input list is covered by the compiled
carrier-filter model. -/
theorem ledger_reference_inputs_cover (P name : ByteString) (ctx : ScriptContext)
    (h : CardanoLedgerApi.V3.Contexts.validReferenceInputs ctx = true) :
    ∃ items : List Candidate,
      IsData.toData ctx.scriptContextTxInfo.txInfoReferenceInputs = Data.List (items.map (candidateData P name)) ∧
      ∀ item ∈ items, ordered P name item :=
  valid_reference_inputs_cover P name ctx.scriptContextTxInfo.txInfoReferenceInputs
    (valid_reference_inputs_values ctx h)

end Lovejoin.AnyTx.LogicLedgerValueCover

#print axioms Lovejoin.AnyTx.LogicLedgerValueCover.cover_asset_map

#print axioms Lovejoin.AnyTx.LogicLedgerValueCover.valid_output_value_shape

#print axioms Lovejoin.AnyTx.LogicLedgerValueCover.valid_reference_inputs_cover

#print axioms Lovejoin.AnyTx.LogicLedgerValueCover.ledger_reference_inputs_cover
