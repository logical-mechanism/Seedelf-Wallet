import Lovejoin.AnyTx.LogicMixParse

/-! Whole-validator consequences for the outer structure of Mix proofs. -/
namespace Lovejoin.AnyTx.LogicMixShape
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.CekValue (CekValue)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

theorem integer_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : Integer) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .I bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem bytes_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : ByteString) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .B bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem list_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .List bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem map_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : List (Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Map bad :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem empty_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data)  :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 [] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem many_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (first second : Data) (tail : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 (first :: second :: tail) :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem field_integer_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : Integer) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 [.I bad] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem field_bytes_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : ByteString) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 [.B bad] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem field_map_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (bad : List (Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 [.Map bad] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem field_constr_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (tag : Integer) (fields : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr 0 [.Constr tag fields] :: after)], .Constr 2 [acct]])] n = .Error := by
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]

theorem wrong_tag_errors (P : ByteString) (r : TxRest) (ins refs sigs acct : Data)
    (before after : List Data) (tag : Integer) (fields : List Data) (hTag : tag ≠ 0) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ .Constr tag fields :: after)], .Constr 2 [acct]])] n = .Error := by
  have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hTag]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_prefix_errors]
  all_goals try rw [he]
  cek_v3

/-- A malformed outer proof fails even after an arbitrary raw proof prefix. -/
theorem invalid_outer_errors (P : ByteString) (r : TxRest) (ins refs sigs acct bad : Data)
    (before after : List Data) (hBad : ¬ ∃ branches, bad = .Constr 0 [.List branches]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins refs sigs,
        .Constr 1 [.List (before ++ bad :: after)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | I bad => exact integer_errors P r ins refs sigs acct before after bad
  | B bad => exact bytes_errors P r ins refs sigs acct before after bad
  | List bad => exact list_errors P r ins refs sigs acct before after bad
  | Map bad => exact map_errors P r ins refs sigs acct before after bad
  | Constr tag fields =>
    by_cases ht : tag = 0
    · subst tag
      cases fields with
      | nil => exact empty_errors P r ins refs sigs acct before after
      | cons first tail =>
        cases tail with
        | cons second tail => exact many_errors P r ins refs sigs acct before after first second tail
        | nil =>
          cases first with
          | I bad => exact field_integer_errors P r ins refs sigs acct before after bad
          | B bad => exact field_bytes_errors P r ins refs sigs acct before after bad
          | Map bad => exact field_map_errors P r ins refs sigs acct before after bad
          | Constr tag fields => exact field_constr_errors P r ins refs sigs acct before after tag fields
          | List branches => exact False.elim (hBad ⟨branches, rfl⟩)
    · exact wrong_tag_errors P r ins refs sigs acct before after tag fields ht

/-- Successful Mix execution requires every outer proof to be a constructor
containing one branch list. Branch fields and cryptographic verification are
separate obligations. -/
theorem acceptance_requires_outer_proof_shape (P : ByteString) (tx : TxInfo)
    (acct : Credential) (proofs : List Data)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∀ proof ∈ proofs, ∃ branches, proof = .Constr 0 [.List branches] := by
  classical
  intro proof hp
  by_cases h : ∃ branches, proof = .Constr 0 [.List branches]
  · exact h
  · obtain ⟨before, after, he⟩ := List.append_of_mem hp
    have herr := invalid_outer_errors P (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories) (IsData.toData acct) proof before after h
    obtain ⟨m, hm⟩ := herr
    obtain ⟨n, hs⟩ := hSuccess
    change cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
        (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
        (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])]
      n = .Halt (.VCon .Unit) at hs
    rw [he] at hs
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hs)

end Lovejoin.AnyTx.LogicMixShape

/--
info: 'Lovejoin.AnyTx.LogicMixShape.acceptance_requires_outer_proof_shape' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicMixShape.acceptance_requires_outer_proof_shape
