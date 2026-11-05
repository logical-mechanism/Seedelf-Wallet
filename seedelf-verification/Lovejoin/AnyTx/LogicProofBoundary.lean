import Lovejoin.AnyTx.LogicOwnerParse
import Lovejoin.AnyTx.LogicMixParse
import Seedelf.AnyTxCover

/-! Whole-validator rejection of malformed proofs after arbitrary valid prefixes. -/
namespace Lovejoin.AnyTx.LogicProofBoundary
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

theorem owner_integer_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (bad : Integer) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .I bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem mix_integer_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List LogicMixParse.Branch)) (bad : Integer) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList before ++ .I bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix]

theorem owner_bytes_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (bad : ByteString) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .B bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem owner_list_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (bad : List Data) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .List bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem owner_map_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (bad : List (Data × Data)) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Map bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

/-- A non-constructor proof fails after any structurally valid prefix. -/
theorem owner_nonconstructor_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ bad :: after)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (h tag fields rfl)
  | Map bad => exact owner_map_after_prefix_errors P r ins refs sigs acct before bad after
  | List bad => exact owner_list_after_prefix_errors P r ins refs sigs acct before bad after
  | I bad => exact owner_integer_after_prefix_errors P r ins refs sigs acct before bad after
  | B bad => exact owner_bytes_after_prefix_errors P r ins refs sigs acct before bad after

/-- The same rejection for every typed V3 transaction and arbitrary suffix. -/
theorem owner_typed_nonconstructor_after_prefix_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (before : List (ByteString × ByteString)) (bad : Data) (after : List Data)
    (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List (LogicOwnerParse.proofList before ++ bad :: after)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact owner_nonconstructor_after_prefix_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad before after h

theorem mix_bytes_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List LogicMixParse.Branch)) (bad : ByteString) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList before ++ .B bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix]

theorem mix_list_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List LogicMixParse.Branch)) (bad : List Data) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList before ++ .List bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix]

theorem mix_map_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List LogicMixParse.Branch)) (bad : List (Data × Data)) (after : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList before ++ .Map bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix]

/-- A non-constructor proof fails after any structurally valid prefix. -/
theorem mix_nonconstructor_after_prefix_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (before : List (List LogicMixParse.Branch)) (after : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (LogicMixParse.fullProofList before ++ bad :: after)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (h tag fields rfl)
  | Map bad => exact mix_map_after_prefix_errors P r ins refs sigs acct before bad after
  | List bad => exact mix_list_after_prefix_errors P r ins refs sigs acct before bad after
  | I bad => exact mix_integer_after_prefix_errors P r ins refs sigs acct before bad after
  | B bad => exact mix_bytes_after_prefix_errors P r ins refs sigs acct before bad after

/-- The same rejection for every typed V3 transaction and arbitrary suffix. -/
theorem mix_typed_nonconstructor_after_prefix_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (before : List (List LogicMixParse.Branch)) (bad : Data) (after : List Data)
    (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List (LogicMixParse.fullProofList before ++ bad :: after)], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact mix_nonconstructor_after_prefix_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad before after h

end Lovejoin.AnyTx.LogicProofBoundary

/--
info: 'Lovejoin.AnyTx.LogicProofBoundary.owner_typed_nonconstructor_after_prefix_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofBoundary.owner_typed_nonconstructor_after_prefix_errors
/--
info: 'Lovejoin.AnyTx.LogicProofBoundary.mix_typed_nonconstructor_after_prefix_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofBoundary.mix_typed_nonconstructor_after_prefix_errors
