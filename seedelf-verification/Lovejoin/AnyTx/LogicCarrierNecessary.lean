import Lovejoin.AnyTx.LogicDuplicateCarrier

/-! Uniqueness of the NFT carrier is necessary for withdrawal acceptance in the
ordered asset-map family covered by the compiled lookup proofs. -/
namespace Lovejoin.AnyTx.LogicCarrierNecessary
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll (exec_never_halts)
open Lovejoin.AnyTx.LogicCarrierFilterExact
open Lovejoin.Template (nftName)

/-- If filtering produces no carriers, every target quantity differs from one. -/
theorem no_matches_have_wrong_quantity (P name : ByteString)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate)
    (hNone : matchingCandidates P name beforePolicies beforeNames afterPolicies afterNames refs = []) :
    ∀ item ∈ refs, item.2.2.2.2 ≠ 1 := by
  intro item hi hQty
  have hm : candidateData P name beforePolicies beforeNames afterPolicies afterNames item ∈
      matchingCandidates P name beforePolicies beforeNames afterPolicies afterNames refs := by
    apply List.mem_filterMap.mpr
    exact ⟨item, hi, by simp [hQty]⟩
  rw [hNone] at hm
  cases hm

/-- Any successful owner withdrawal has exactly one candidate carrier, within
this ordered asset-map family. -/
theorem owner_acceptance_requires_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames)))
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ carrier, matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = [carrier] := by
  cases hc : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs with
  | nil =>
    have hQty := no_matches_have_wrong_quantity P nftName beforePolicies beforeNames afterPolicies afterNames refs hc
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.LogicWrongQuantity.owner_typed_wrong_quantities_errors P tx acct
      beforePolicies beforeNames afterPolicies afterNames refs proofs hPolicies hNames hQty hRefs
    obtain ⟨n, hn⟩ := hSuccess
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
  | cons first tail =>
    cases tail with
    | nil => exact ⟨first, rfl⟩
    | cons second tail =>
      obtain ⟨m, hm⟩ := Lovejoin.AnyTx.LogicDuplicateCarrier.owner_typed_duplicate_carriers_errors P tx acct
        beforePolicies beforeNames afterPolicies afterNames refs proofs first second tail hPolicies hNames hc hRefs
      obtain ⟨n, hn⟩ := hSuccess
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)

/-- Any successful mix withdrawal has exactly one candidate carrier, within
this ordered asset-map family. -/
theorem mix_acceptance_requires_unique_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List Candidate) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map (candidateData P nftName beforePolicies beforeNames afterPolicies afterNames)))
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ carrier, matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs = [carrier] := by
  cases hc : matchingCandidates P nftName beforePolicies beforeNames afterPolicies afterNames refs with
  | nil =>
    have hQty := no_matches_have_wrong_quantity P nftName beforePolicies beforeNames afterPolicies afterNames refs hc
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.LogicWrongQuantity.mix_typed_wrong_quantities_errors P tx acct
      beforePolicies beforeNames afterPolicies afterNames refs proofs hPolicies hNames hQty hRefs
    obtain ⟨n, hn⟩ := hSuccess
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
  | cons first tail =>
    cases tail with
    | nil => exact ⟨first, rfl⟩
    | cons second tail =>
      obtain ⟨m, hm⟩ := Lovejoin.AnyTx.LogicDuplicateCarrier.mix_typed_duplicate_carriers_errors P tx acct
        beforePolicies beforeNames afterPolicies afterNames refs proofs first second tail hPolicies hNames hc hRefs
      obtain ⟨n, hn⟩ := hSuccess
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)

end Lovejoin.AnyTx.LogicCarrierNecessary

/--
info: 'Lovejoin.AnyTx.LogicCarrierNecessary.owner_acceptance_requires_unique_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicCarrierNecessary.owner_acceptance_requires_unique_carrier
/--
info: 'Lovejoin.AnyTx.LogicCarrierNecessary.mix_acceptance_requires_unique_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicCarrierNecessary.mix_acceptance_requires_unique_carrier
