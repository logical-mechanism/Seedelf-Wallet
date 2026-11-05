import Lovejoin.AnyTx.Common
import Lovejoin.AnyTx.CekCase
import Seedelf.AnyTxCover

/-! Whole-validator failures for malformed leading withdrawal proofs. -/
namespace Lovejoin.AnyTx.LogicRedeemerFailures
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
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

theorem owner_integer_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (.I bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mix_integer_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (.I bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem owner_bytes_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : ByteString) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (.B bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem owner_list_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : List Data) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (.List bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem owner_map_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : List (Data × Data)) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (.Map bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Any non-constructor first proof fails before any later proofs are inspected. -/
theorem owner_nonconstructor_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (rest : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (h tag fields rfl)
  | Map bad => exact owner_map_proof_errors P r ins refs sigs acct bad rest
  | List bad => exact owner_list_proof_errors P r ins refs sigs acct bad rest
  | I bad => exact owner_integer_proof_errors P r ins refs sigs acct bad rest
  | B bad => exact owner_bytes_proof_errors P r ins refs sigs acct bad rest

/-- The same boundary for every typed V3 transaction and withdrawal credential. -/
theorem owner_typed_nonconstructor_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (bad : Data) (rest : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List (bad :: rest)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact owner_nonconstructor_proof_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad rest h

theorem mix_bytes_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : ByteString) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (.B bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mix_list_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : List Data) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (.List bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem mix_map_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (bad : List (Data × Data)) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (.Map bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Any non-constructor first proof fails before any later proofs are inspected. -/
theorem mix_nonconstructor_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (rest : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (bad :: rest)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (h tag fields rfl)
  | Map bad => exact mix_map_proof_errors P r ins refs sigs acct bad rest
  | List bad => exact mix_list_proof_errors P r ins refs sigs acct bad rest
  | I bad => exact mix_integer_proof_errors P r ins refs sigs acct bad rest
  | B bad => exact mix_bytes_proof_errors P r ins refs sigs acct bad rest

/-- The same boundary for every typed V3 transaction and withdrawal credential. -/
theorem mix_typed_nonconstructor_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (bad : Data) (rest : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List (bad :: rest)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact mix_nonconstructor_proof_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad rest h

/-- A constructor proof with no fields cannot be decoded. -/
theorem owner_empty_constructor_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (tag : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (.Constr tag [] :: rest)], .Constr 2 [acct]])] n = .Error := by
  by_cases h : tag = 0
  · subst tag
    apply exec_error_of_ev
    cek_v3
  · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
      simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
    apply exec_error_of_ev
    cek_v3
    all_goals try rw [he]
    cek_v3

/-- A constructor proof with no fields cannot be decoded. -/
theorem mix_empty_constructor_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (tag : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (.Constr tag [] :: rest)], .Constr 2 [acct]])] n = .Error := by
  by_cases h : tag = 0
  · subst tag
    apply exec_error_of_ev
    cek_v3
  · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
      simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
    apply exec_error_of_ev
    cek_v3
    all_goals try rw [he]
    cek_v3

/-- A typed withdrawal with a fieldless leading owner proof errors. -/
theorem owner_typed_empty_constructor_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (tag : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List (.Constr tag [] :: rest)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact owner_empty_constructor_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) tag rest

/-- A typed withdrawal with a fieldless leading mix proof errors. -/
theorem mix_typed_empty_constructor_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (tag : Integer) (rest : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List (.Constr tag [] :: rest)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact mix_empty_constructor_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) tag rest

end Lovejoin.AnyTx.LogicRedeemerFailures

/--
info: 'Lovejoin.AnyTx.LogicRedeemerFailures.owner_typed_nonconstructor_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicRedeemerFailures.owner_typed_nonconstructor_errors
/--
info: 'Lovejoin.AnyTx.LogicRedeemerFailures.mix_typed_nonconstructor_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicRedeemerFailures.mix_typed_nonconstructor_errors
