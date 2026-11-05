import Lovejoin.AnyTx.LogicOwnerNoCarrier
import Lovejoin.AnyTx.LogicCarrierPredicate

/-! Whole-validator missing-carrier rules for arbitrary NFT quantities and asset prefixes. -/
namespace Lovejoin.AnyTx.LogicWrongQuantity
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
open Lovejoin.AnyTx.LogicCarrierPredicate
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

/-- Inputs whose target NFT quantity is not one cannot supply a carrier, for
arbitrarily many reference inputs and ordered policy/name prefixes. -/
theorem owner_shaped_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List (ByteString × ByteString))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
          beforePolicies beforeNames afterPolicies afterNames)) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_quantities_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- The same rule holds for every raw Mix proof list. -/
theorem mix_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
          beforePolicies beforeNames afterPolicies afterNames)) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_quantities_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption

/-- The wrong-quantity boundary for every raw Owner proof list, including malformed proofs. -/
theorem owner_raw_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
          beforePolicies beforeNames afterPolicies afterNames)) sigs,
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
      refs ps hPolicies hNames hP hN hQty
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins
      (.List (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
        beforePolicies beforeNames afterPolicies afterNames)) sigs acct bad before after hb

/-- The Mix wrong-quantity boundary needs no separate reflexivity assumptions. -/
theorem mix_all_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
          beforePolicies beforeNames afterPolicies afterNames)) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  exact mix_raw_proofs_errors P r ins sigs acct beforePolicies beforeNames afterPolicies afterNames
    refs proofs hPolicies hNames hP hN hQty

/-- Typed V3 owner withdrawals reject every proof list when all reference
candidates have a target quantity different from one. -/
theorem owner_typed_wrong_quantities_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
        beforePolicies beforeNames afterPolicies afterNames)) :
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
    refs proofs hPolicies hNames hQty

/-- Typed V3 mix withdrawals reject every proof list when all reference
candidates have a target quantity different from one. -/
theorem mix_typed_wrong_quantities_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer)) (proofs : List Data)
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List
      (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P nftName qty
        beforePolicies beforeNames afterPolicies afterNames)) :
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
    refs proofs hPolicies hNames hQty

end Lovejoin.AnyTx.LogicWrongQuantity

#print axioms Lovejoin.AnyTx.LogicWrongQuantity.owner_raw_proofs_errors
#print axioms Lovejoin.AnyTx.LogicWrongQuantity.mix_all_proofs_errors

/--
info: 'Lovejoin.AnyTx.LogicWrongQuantity.owner_typed_wrong_quantities_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicWrongQuantity.owner_typed_wrong_quantities_errors
/--
info: 'Lovejoin.AnyTx.LogicWrongQuantity.mix_typed_wrong_quantities_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicWrongQuantity.mix_typed_wrong_quantities_errors
