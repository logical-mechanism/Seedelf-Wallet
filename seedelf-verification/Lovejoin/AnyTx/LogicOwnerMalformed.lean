import Lovejoin.AnyTx.LogicProofBoundary

/-! The Owner proof decoder rejects malformed constructor shapes after any
number of structurally valid proofs. -/
namespace Lovejoin.AnyTx.LogicOwnerMalformed
open CardanoLedgerApi.IsData.Class (toTerm)
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

theorem no_fields_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data)  :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 [] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem one_field_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (first : Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 [first] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem too_many_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (a b : ByteString) (x : Data) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (.B a :: .B b :: x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem second_integer_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (first : Data) (x : Integer) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (first :: .I x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem second_bytes_list_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (first : Data) (x : List Data) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (first :: .List x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem second_map_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (first : Data) (x : List (Data × Data)) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (first :: .Map x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem second_constr_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (first : Data) (x : Integer × List Data) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (first :: .Constr x.1 x.2 :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem first_integer_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (x : Integer) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (.I x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  cases xs with
  | nil => exact one_field_errors P r ins refs sigs acct before after (.I x)
  | cons y ys =>
    cases y with
    | Constr tag fields => exact second_constr_errors P r ins refs sigs acct before after (.I x) (tag, fields) ys
    | Map value => exact second_map_errors P r ins refs sigs acct before after (.I x) value ys
    | List value => exact second_bytes_list_errors P r ins refs sigs acct before after (.I x) value ys
    | I value => exact second_integer_errors P r ins refs sigs acct before after (.I x) value ys
    | B value =>
      apply exec_error_of_ev
      cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem first_bytes_list_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (x : List Data) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (.List x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  cases xs with
  | nil => exact one_field_errors P r ins refs sigs acct before after (.List x)
  | cons y ys =>
    cases y with
    | Constr tag fields => exact second_constr_errors P r ins refs sigs acct before after (.List x) (tag, fields) ys
    | Map value => exact second_map_errors P r ins refs sigs acct before after (.List x) value ys
    | List value => exact second_bytes_list_errors P r ins refs sigs acct before after (.List x) value ys
    | I value => exact second_integer_errors P r ins refs sigs acct before after (.List x) value ys
    | B value =>
      apply exec_error_of_ev
      cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem first_map_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (x : List (Data × Data)) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (.Map x :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  cases xs with
  | nil => exact one_field_errors P r ins refs sigs acct before after (.Map x)
  | cons y ys =>
    cases y with
    | Constr tag fields => exact second_constr_errors P r ins refs sigs acct before after (.Map x) (tag, fields) ys
    | Map value => exact second_map_errors P r ins refs sigs acct before after (.Map x) value ys
    | List value => exact second_bytes_list_errors P r ins refs sigs acct before after (.Map x) value ys
    | I value => exact second_integer_errors P r ins refs sigs acct before after (.Map x) value ys
    | B value =>
      apply exec_error_of_ev
      cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem first_constr_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data) (x : Integer × List Data) (xs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr 0 (.Constr x.1 x.2 :: xs) :: after)], .Constr 2 [acct]])] n = .Error := by
  cases xs with
  | nil => exact one_field_errors P r ins refs sigs acct before after (.Constr x.1 x.2)
  | cons y ys =>
    cases y with
    | Constr tag fields => exact second_constr_errors P r ins refs sigs acct before after (.Constr x.1 x.2) (tag, fields) ys
    | Map value => exact second_map_errors P r ins refs sigs acct before after (.Constr x.1 x.2) value ys
    | List value => exact second_bytes_list_errors P r ins refs sigs acct before after (.Constr x.1 x.2) value ys
    | I value => exact second_integer_errors P r ins refs sigs acct before after (.Constr x.1 x.2) value ys
    | B value =>
      apply exec_error_of_ev
      cek_v3_using [LogicOwnerParse.owner_valid_prefix]

theorem wrong_tag_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (ByteString × ByteString)) (after : List Data)
    (tag : Integer) (fields : List Data) (hTag : tag ≠ 0) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ .Constr tag fields :: after)], .Constr 2 [acct]])] n = .Error := by
  have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hTag]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_valid_prefix]
  all_goals try rw [he]
  cek_v3

/-- Every raw proof is either the exact two-byte-string shape or reaches error,
after any valid prefix and regardless of the remaining transaction. -/
theorem invalid_proof_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (before : List (ByteString × ByteString)) (after : List Data)
    (hBad : ¬ ∃ a b, bad = proofData a b) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList before ++ bad :: after)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | I i => exact LogicProofBoundary.owner_integer_after_prefix_errors P r ins refs sigs acct before i after
  | B b => exact LogicProofBoundary.owner_bytes_after_prefix_errors P r ins refs sigs acct before b after
  | List xs => exact LogicProofBoundary.owner_list_after_prefix_errors P r ins refs sigs acct before xs after
  | Map xs => exact LogicProofBoundary.owner_map_after_prefix_errors P r ins refs sigs acct before xs after
  | Constr tag fields =>
    by_cases h : tag = 0
    · subst tag
      cases fields with
      | nil => exact no_fields_errors P r ins refs sigs acct before after
      | cons first fields =>
        cases first with
        | I i => exact first_integer_errors P r ins refs sigs acct before after i fields
        | List xs => exact first_bytes_list_errors P r ins refs sigs acct before after xs fields
        | Map xs => exact first_map_errors P r ins refs sigs acct before after xs fields
        | Constr tag fs => exact first_constr_errors P r ins refs sigs acct before after (tag, fs) fields
        | B a =>
          cases fields with
          | nil => exact one_field_errors P r ins refs sigs acct before after (.B a)
          | cons second fields =>
            cases second with
            | I i => exact second_integer_errors P r ins refs sigs acct before after (.B a) i fields
            | List xs => exact second_bytes_list_errors P r ins refs sigs acct before after (.B a) xs fields
            | Map xs => exact second_map_errors P r ins refs sigs acct before after (.B a) xs fields
            | Constr tag fs => exact second_constr_errors P r ins refs sigs acct before after (.B a) (tag, fs) fields
            | B b =>
              cases fields with
              | nil => exact False.elim (hBad ⟨a, b, rfl⟩)
              | cons x xs => exact too_many_errors P r ins refs sigs acct before after a b x xs
    · exact wrong_tag_errors P r ins refs sigs acct before after tag fields h

end Lovejoin.AnyTx.LogicOwnerMalformed

#print axioms Lovejoin.AnyTx.LogicOwnerMalformed.invalid_proof_errors
