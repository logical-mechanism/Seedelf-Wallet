import Lovejoin.AnyTx.LogicProofBoundary

/-! Mix proofs with malformed branches after arbitrary valid prefixes. -/
namespace Lovejoin.AnyTx.LogicMixBoundary
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
open Lovejoin.AnyTx.LogicMixParse (Branch branchList fullProofList)
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

theorem integer_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List Branch)) (branches : List Branch) (bad : Integer)
    (laterBranches laterProofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ .I bad :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]

theorem bytes_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List Branch)) (branches : List Branch) (bad : ByteString)
    (laterBranches laterProofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ .B bad :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]

theorem list_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List Branch)) (branches : List Branch) (bad : List Data)
    (laterBranches laterProofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ .List bad :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]

theorem map_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List Branch)) (branches : List Branch) (bad : List (Data × Data))
    (laterBranches laterProofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ .Map bad :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]

/-- Any non-constructor branch fails after valid proof and branch prefixes. -/
theorem nonconstructor_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (before : List (List Branch)) (branches : List Branch) (laterBranches laterProofs : List Data)
    (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ bad :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (h tag fields rfl)
  | Map value => exact map_branch_errors P r ins refs sigs acct before branches value laterBranches laterProofs
  | List value => exact list_branch_errors P r ins refs sigs acct before branches value laterBranches laterProofs
  | I value => exact integer_branch_errors P r ins refs sigs acct before branches value laterBranches laterProofs
  | B value => exact bytes_branch_errors P r ins refs sigs acct before branches value laterBranches laterProofs

/-- Non-constructor branches fail for every typed withdrawal transaction, after
any valid proof and branch prefixes and with arbitrary suffixes. -/
theorem typed_nonconstructor_branch_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (before : List (List Branch)) (branches : List Branch) (bad : Data)
    (laterBranches laterProofs : List Data) (h : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List (fullProofList before ++
          .Constr 0 [.List (branchList branches ++ bad :: laterBranches)] :: laterProofs)],
          .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  exact nonconstructor_branch_errors P (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad before branches laterBranches laterProofs h

/-- A fieldless branch fails after arbitrary valid proof and branch prefixes. -/
theorem empty_constructor_branch_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before : List (List Branch)) (branches : List Branch) (tag : Integer)
    (laterBranches laterProofs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (fullProofList before ++ .Constr 0 [.List (branchList branches ++ .Constr tag [] :: laterBranches)] :: laterProofs)],
        .Constr 2 [acct]])] n = .Error := by
  by_cases h : tag = 0
  · subst tag
    apply exec_error_of_ev
    cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]
  · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
      simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
    apply exec_error_of_ev
    cek_v3_using [LogicMixParse.mix_valid_prefix, LogicMixParse.mix_branch_valid_prefix]
    all_goals try rw [he]
    cek_v3

end Lovejoin.AnyTx.LogicMixBoundary

#print axioms Lovejoin.AnyTx.LogicMixBoundary.nonconstructor_branch_errors

/--
info: 'Lovejoin.AnyTx.LogicMixBoundary.typed_nonconstructor_branch_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicMixBoundary.typed_nonconstructor_branch_errors
