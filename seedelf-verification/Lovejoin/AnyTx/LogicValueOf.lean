import Lovejoin.AnyTx.LogicLedgerCarrier

/-! Relating a found compiled-search candidate to the ledger valueOf function. -/
namespace Lovejoin.AnyTx.LogicValueOf
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Lovejoin.Template (nftName)
open CardanoLedgerApi.V3
open Lovejoin.AnyTx.LogicCarrierCover
open Lovejoin.AnyTx.LogicLedgerValueCover
open CardanoLedgerApi.V1.Value (valueOf)
open Lovejoin.AnyTx.LogicPolicyLookup (policyPairs)
open Lovejoin.AnyTx.LogicNameLookup (namePairs)

private theorem before_ne (target key : ByteString)
    (h : PlutusCore.ByteString.lessThanEqualsByteString target key = false) : target ≠ key := by
  intro he
  subst key
  have hrefl : PlutusCore.ByteString.lessThanEqualsByteString target target = true := by
    change decide (target.data ≤ target.data) = true
    simp [String.le_refl]
  rw [hrefl] at h
  contradiction

/-- Earlier nonmatching names do not change the quantity returned at the target. -/
theorem find_token_after_prefix (name : ByteString) (qty : Integer)
    (before : List (ByteString × Data)) (after : List (Data × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    valueOf.find_token name (namePairs before ++ (.B name, .I qty) :: after) = qty := by
  induction before with
  | nil => simp [namePairs, valueOf.find_token]
  | cons item xs ih =>
    rcases item with ⟨key, value⟩
    have hk := before_ne name key (hBefore (key, value) (by simp))
    have ht : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false := by
      intro pair hp
      exact hBefore pair (by simp [hp])
    simpa [namePairs, valueOf.find_token, hk] using ih ht

/-- If earlier policy values are maps, ledger valueOf returns the quantity at
the policy/name pair found by the compiled ordered search. -/
theorem value_of_found (P name : ByteString) (qty : Integer)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hMaps : ∀ pair ∈ beforePolicies, ∃ names, pair.2 = Data.Map names)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    valueOf P name (policyPairs beforePolicies ++
      (.B P, .Map (namePairs beforeNames ++ (.B name, .I qty) :: afterNames)) :: afterPolicies) = qty := by
  induction beforePolicies with
  | nil =>
    simpa [policyPairs, valueOf, valueOf.visit] using find_token_after_prefix name qty beforeNames afterNames hNames
  | cons item xs ih =>
    rcases item with ⟨key, value⟩
    obtain ⟨names, hv⟩ := hMaps (key, value) (by simp)
    dsimp only at hv
    subst value
    have hk := before_ne P key (hPolicies (key, .Map names) (by simp))
    have hp : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false := by
      intro pair hx
      exact hPolicies pair (by simp [hx])
    have hm : ∀ pair ∈ xs, ∃ names, pair.2 = Data.Map names := by
      intro pair hx
      exact hMaps pair (by simp [hx])
    simpa [policyPairs, valueOf, valueOf.visit, hk] using ih hp hm

/-- For a ledger-valid output, a found candidate's quantity is exactly the
ledger model's valueOf result. -/
theorem present_candidate_value_of (P name : ByteString) (input : TxInInfo)
    (item : LogicCarrierVariable.Candidate)
    (hValid : CardanoLedgerApi.V1.Contexts.validTxOutValue input.txInInfoResolved.txOutValue = true)
    (hOrdered : ordered P name (.present item))
    (he : IsData.toData input = candidateData P name (.present item)) :
    valueOf P name input.txInInfoResolved.txOutValue = item.qty := by
  cases input with
  | mk ref out =>
    cases out with
    | mk addr value datum script =>
      change Data.Constr 0 [IsData.toData ref, .Constr 0 [IsData.toData addr, .Map value,
        IsData.toData datum, IsData.toData script]] = _ at he
      simp [candidateData, LogicCarrierVariable.candidateData, LogicCarrierPredicate.quantityInput,
        Lovejoin.AnyTx.BoxSearch.inputData] at he
      obtain ⟨hPolicies, hNames⟩ := hOrdered
      obtain ⟨lines, hv⟩ := valid_output_value_shape value hValid
      have hMaps : ∀ pair ∈ item.beforePolicies, ∃ names, pair.2 = Data.Map names := by
        intro pair hp
        have hm : ((.B pair.1, pair.2) : Data × Data) ∈ (show List (Data × Data) from value) := by
          rw [he.2.2.1]
          apply List.mem_append_left
          exact List.mem_map.mpr ⟨pair, hp, rfl⟩
        rw [hv] at hm
        obtain ⟨⟨key, names⟩, _, hEq⟩ := List.mem_map.mp hm
        exact ⟨tokenData names, (Prod.mk.inj hEq).2.symm⟩
      rw [he.2.2.1]
      exact value_of_found P name item.qty item.beforePolicies item.beforeNames
        item.afterPolicies item.afterNames hPolicies hMaps hNames

/-- A successful typed owner withdrawal with valid reference inputs has a
reference output whose ledger valueOf for the pool NFT is exactly one. -/
theorem owner_success_requires_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, valueOf P nftName input.txInInfoResolved.txOutValue = 1 := by
  obtain ⟨items, hRefs, hOrdered, carrier, hOne⟩ :=
    LogicLedgerCarrier.owner_valid_references_require_unique_carrier P tx acct proofs hValid hSuccess
  have hc : carrier ∈ matching P nftName items := by rw [hOne]; simp
  obtain ⟨item, hi, hQty, _⟩ := LogicLedgerCarrier.matching_member_present P nftName items carrier hc
  obtain ⟨input, hin, he⟩ := LogicLedgerCarrier.matching_candidate_has_input P nftName tx.txInfoReferenceInputs items hRefs (.present item) hi
  have hValue := valid_reference_inputs_values
    (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid input hin
  exact ⟨input, hin, (present_candidate_value_of P nftName input item hValue (hOrdered _ hi) he).trans hQty⟩

/-- The same necessary condition under full ledger-model context validity. -/
theorem owner_valid_context_requires_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, valueOf P nftName input.txInInfoResolved.txOutValue = 1 :=
  owner_success_requires_value_one P tx acct proofs
    (LogicLedgerCarrier.valid_reference_inputs_of_valid_context _ hValid) hSuccess

/-- A successful typed mix withdrawal with valid reference inputs has a
reference output whose ledger valueOf for the pool NFT is exactly one. -/
theorem mix_success_requires_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, valueOf P nftName input.txInInfoResolved.txOutValue = 1 := by
  obtain ⟨items, hRefs, hOrdered, carrier, hOne⟩ :=
    LogicLedgerCarrier.mix_valid_references_require_unique_carrier P tx acct proofs hValid hSuccess
  have hc : carrier ∈ matching P nftName items := by rw [hOne]; simp
  obtain ⟨item, hi, hQty, _⟩ := LogicLedgerCarrier.matching_member_present P nftName items carrier hc
  obtain ⟨input, hin, he⟩ := LogicLedgerCarrier.matching_candidate_has_input P nftName tx.txInfoReferenceInputs items hRefs (.present item) hi
  have hValue := valid_reference_inputs_values
    (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid input hin
  exact ⟨input, hin, (present_candidate_value_of P nftName input item hValue (hOrdered _ hi) he).trans hQty⟩

/-- The same necessary condition under full ledger-model context validity. -/
theorem mix_valid_context_requires_value_one (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, valueOf P nftName input.txInInfoResolved.txOutValue = 1 :=
  mix_success_requires_value_one P tx acct proofs
    (LogicLedgerCarrier.valid_reference_inputs_of_valid_context _ hValid) hSuccess

end Lovejoin.AnyTx.LogicValueOf

#print axioms Lovejoin.AnyTx.LogicValueOf.value_of_found

#print axioms Lovejoin.AnyTx.LogicValueOf.present_candidate_value_of

/--
info: 'Lovejoin.AnyTx.LogicValueOf.owner_valid_context_requires_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicValueOf.owner_valid_context_requires_value_one
/--
info: 'Lovejoin.AnyTx.LogicValueOf.mix_valid_context_requires_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicValueOf.mix_valid_context_requires_value_one
