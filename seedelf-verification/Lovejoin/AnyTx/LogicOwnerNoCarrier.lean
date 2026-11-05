import Lovejoin.AnyTx.LogicOwnerMalformed
import Lovejoin.AnyTx.LogicNoReferenceMany

/-! Complete Owner proof-list coverage for missing-carrier transactions. -/
namespace Lovejoin.AnyTx.LogicOwnerNoCarrier
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicOwnerParse (proofList)
open Lovejoin.AnyTx.LogicReferenceFilter (PlainReference plainReferenceData)
open Lovejoin.Template (nftName)

/-- Every proof list is fully well-shaped or has a first malformed proof after a
well-shaped prefix; both the prefix and the suffix may have arbitrary length. -/
theorem proof_list_cover (proofs : List Data) :
    (∃ ps : List (ByteString × ByteString), proofs = proofList ps) ∨
    ∃ (before : List (ByteString × ByteString)) (bad : Data) (after : List Data),
      proofs = proofList before ++ bad :: after ∧ ¬ ∃ a b, bad = proofData a b := by
  induction proofs with
  | nil => exact Or.inl ⟨[], rfl⟩
  | cons proof rest ih =>
    by_cases h : ∃ a b, proof = proofData a b
    · obtain ⟨a, b, hp⟩ := h
      subst proof
      rcases ih with ⟨ps, hps⟩ | ⟨before, bad, after, he, hb⟩
      · exact Or.inl ⟨(a, b) :: ps, by simp [proofList, hps]⟩
      · exact Or.inr ⟨(a, b) :: before, bad, after, by simp [proofList, he], hb⟩
    · exact Or.inr ⟨[], proof, rest, rfl, h⟩

/-- For every raw Owner proof list, the compiled validator errors if all reference
inputs are empty-value or ADA-only and the policy sorts after the ADA policy. -/
theorem owner_no_carrier_any_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (refs : List PlainReference) (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map plainReferenceData)) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact LogicNoReferenceMany.owner_any_proofs_plain_values_errors P r ins sigs acct hAfterAda refs ps
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map plainReferenceData)) sigs acct bad before after hb

/-- The same missing-carrier rule for typed V3 withdrawal contexts. -/
theorem owner_typed_no_carrier_any_proofs_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (refs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map plainReferenceData))
    (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_no_carrier_any_proofs_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda refs proofs

/-- Without reference inputs, every Owner proof list fails for every pool policy,
including the empty policy. -/
theorem owner_no_references_any_proofs_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins (.List []) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact LogicNoReferenceMany.owner_any_proofs_empty_values_errors P r ins sigs acct [] ps
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List []) sigs acct bad before after hb

/-- Every typed V3 Owner withdrawal without reference inputs fails, for every raw
proof list and policy. -/
theorem owner_typed_no_references_any_proofs_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hRefs : tx.txInfoReferenceInputs = []) (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  have he : IsData.toData tx.txInfoReferenceInputs = Data.List [] := by rw [hRefs]; rfl
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [he]
  exact owner_no_references_any_proofs_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) proofs

end Lovejoin.AnyTx.LogicOwnerNoCarrier

#print axioms Lovejoin.AnyTx.LogicOwnerNoCarrier.proof_list_cover
/--
info: 'Lovejoin.AnyTx.LogicOwnerNoCarrier.owner_typed_no_carrier_any_proofs_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerNoCarrier.owner_typed_no_carrier_any_proofs_errors

/--
info: 'Lovejoin.AnyTx.LogicOwnerNoCarrier.owner_typed_no_references_any_proofs_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerNoCarrier.owner_typed_no_references_any_proofs_errors
