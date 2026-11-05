import Lovejoin.AnyTx.BoxSearch
import Lovejoin.AnyTx.Common

/-! Whole-validator search results for any input list length. Missing own input fails
closed, while non-inline datums are recoverable. Every withdrawal and every other
transaction field is arbitrary Data. -/
namespace Lovejoin.AnyTx.BoxAll
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.Term (Const)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch

theorem searchResult_missing (target : Data) (xs : List (Data × Data))
    (h : ∀ pair ∈ xs, pair.1 ≠ target) : searchResult target xs = .Constr 1 [] := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    rcases x with ⟨ref, out⟩
    have hhead : ref ≠ target := h (ref, out) (by simp)
    have htail : ∀ pair ∈ xs, pair.1 ≠ target := by
      intro pair hp
      exact h pair (by simp [hp])
    simp [searchResult, hhead, ih htail]

set_option maxHeartbeats 0

/-- With no matching input reference, the full compiled mix_box reaches Error, for
any input count and arbitrary remaining transaction fields. -/
theorem missing_input_errors (L : ByteString) (r : TxRest) (sigs red ref rd wdrl : Data)
    (xs : List (Data × Data)) (h : ∀ pair ∈ xs, pair.1 ≠ ref) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r (.List (inputList xs)) wdrl sigs red ref rd)] n = .Error := by
  have hn := searchResult_missing ref xs h
  have hSearch : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList xs)) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 1 [])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    simpa [hn] using search_all ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest xs
  apply exec_error_of_ev
  cek_v3_using [hSearch]

/-- A no datum input can be recovered after any number of earlier inputs. -/
theorem no_datum_recovers (L : ByteString) (r : TxRest) (sigs red ref rd wdrl addr value script : Data)
    (before after : List (Data × Data)) (h : ∀ pair ∈ before, pair.1 ≠ ref) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 0 [], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 0 [], script]
  have hn : searchResult ref (before ++ (ref, out) :: after) = .Constr 0 [inputData ref out] :=
    searchResult_split ref out before after h
  have hSearch : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    simpa [hn] using search_all ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest (before ++ (ref, out) :: after)
  dsimp only [out] at hSearch
  apply exec_halt_of_ev
  cek_v3_using [hSearch]

/-- A datum hash input can be recovered after any number of earlier inputs. -/
theorem datum_hash_recovers (L : ByteString) (r : TxRest) (sigs red ref rd wdrl addr value script : Data) (hash : Data)
    (before after : List (Data × Data)) (h : ∀ pair ∈ before, pair.1 ≠ ref) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 1 [hash], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 1 [hash], script]
  have hn : searchResult ref (before ++ (ref, out) :: after) = .Constr 0 [inputData ref out] :=
    searchResult_split ref out before after h
  have hSearch : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    simpa [hn] using search_all ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest (before ++ (ref, out) :: after)
  dsimp only [out] at hSearch
  apply exec_halt_of_ev
  cek_v3_using [hSearch]


end Lovejoin.AnyTx.BoxAll

#print axioms Lovejoin.AnyTx.BoxAll.missing_input_errors
#print axioms Lovejoin.AnyTx.BoxAll.no_datum_recovers
#print axioms Lovejoin.AnyTx.BoxAll.datum_hash_recovers
