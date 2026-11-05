import Lovejoin.AnyTx.LogicNoReferenceMany

/-! Complete Mix proof-data coverage when no NFT carrier is present. -/
namespace Lovejoin.AnyTx.LogicMixNoCarrier
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicReferenceFilter (PlainReference plainReferenceData)
open Lovejoin.Template (nftName)

/-- Every raw Mix proof list fails when typed reference inputs contain only
empty or ADA-only values and the NFT policy sorts after ADA. -/
theorem mix_typed_no_carrier_any_proofs_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (refs : List PlainReference)
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map plainReferenceData))
    (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact LogicNoReferenceMany.mix_raw_proofs_plain_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) hAfterAda refs proofs

/-- Without reference inputs, every raw Mix proof list fails for any policy. -/
theorem mix_typed_no_references_any_proofs_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (hRefs : tx.txInfoReferenceInputs = []) (proofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  have he : IsData.toData tx.txInfoReferenceInputs = Data.List [] := by rw [hRefs]; rfl
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [he]
  exact LogicNoReferenceMany.mix_raw_proofs_empty_values_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct) [] proofs

end Lovejoin.AnyTx.LogicMixNoCarrier

/--
info: 'Lovejoin.AnyTx.LogicMixNoCarrier.mix_typed_no_carrier_any_proofs_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicMixNoCarrier.mix_typed_no_carrier_any_proofs_errors
/--
info: 'Lovejoin.AnyTx.LogicMixNoCarrier.mix_typed_no_references_any_proofs_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicMixNoCarrier.mix_typed_no_references_any_proofs_errors
