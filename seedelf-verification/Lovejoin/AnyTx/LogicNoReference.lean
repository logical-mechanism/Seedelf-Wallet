import Lovejoin.AnyTx.Common
import Lovejoin.AnyTx.CekCase
import Seedelf.AnyTxCover

/-! Whole-validator boundary shared by both withdrawal branches. -/
namespace Lovejoin.AnyTx.LogicNoReference
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

/-- With no reference inputs, an empty Owner redeemer and all other transaction
fields lead the compiled mix_logic validator to Error. -/
theorem owner_no_reference_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins (.List []) sigs, .Constr 0 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- The same whole-validator failure for an empty Mix redeemer. -/
theorem mix_no_reference_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins (.List []) sigs, .Constr 1 [.List []], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- A single well-shaped Owner proof still cannot authorize a withdrawal without a reference input. -/
theorem owner_one_proof_no_reference_errors (P t z : ByteString) (r : TxRest) (ins sigs acct : Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins (.List []) sigs,
        .Constr 0 [.List [proofData t z]], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Two well-shaped Owner proofs also fail independently of all normal inputs. -/
theorem owner_two_proofs_no_reference_errors (P t1 z1 t2 z2 : ByteString) (r : TxRest) (ins sigs acct : Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins (.List []) sigs,
        .Constr 0 [.List [proofData t1 z1, proofData t2 z2]], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Every typed withdrawal with no reference inputs and an empty owner proof list errors. -/
theorem owner_typed_no_reference_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (h : tx.txInfoReferenceInputs = []) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List []], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  have he : IsData.toData tx.txInfoReferenceInputs = Data.List [] := by rw [h]; rfl
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List []], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [he]
  exact owner_no_reference_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct)

/-- Every typed withdrawal with no reference inputs and an empty mix proof list errors. -/
theorem mix_typed_no_reference_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (h : tx.txInfoReferenceInputs = []) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List []], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  have he : IsData.toData tx.txInfoReferenceInputs = Data.List [] := by rw [h]; rfl
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List []], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [he]
  exact mix_no_reference_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct)

end Lovejoin.AnyTx.LogicNoReference

/-- info: 'Lovejoin.AnyTx.LogicNoReference.owner_no_reference_errors' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicNoReference.owner_no_reference_errors
/-- info: 'Lovejoin.AnyTx.LogicNoReference.mix_no_reference_errors' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicNoReference.mix_no_reference_errors
