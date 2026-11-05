import Lovejoin.AnyTx.CekCase
import Lovejoin.Template.Scripts

/-! The own-input search loop from mix_box's compiled template. The loop is located
by a path in the imported UPLC term; it is not a reimplementation of the source. -/
namespace Lovejoin.AnyTx.BoxSearch
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.Builtins (ExpectedBuiltinArgs)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-- Navigate the decoded term; for case, 0 is the scrutinee and n+1 is branch n. -/
def subterm (t : Term) (path : List Nat) : Term :=
  match path, t with
  | [], t => t
  | _ :: ps, .Lam b => subterm b ps
  | _ :: ps, .Delay b => subterm b ps
  | _ :: ps, .Force b => subterm b ps
  | 0 :: ps, .Apply f _ => subterm f ps
  | _ :: ps, .Apply _ a => subterm a ps
  | 0 :: ps, .Case scrut _ => subterm scrut ps
  | (n+1) :: ps, .Case _ branches => subterm (branches[n]?.getD .Error) ps
  | n :: ps, .Constr _ fields => subterm (fields[n]?.getD .Error) ps
  | _ :: _, t => t
termination_by structural path

def templateBody : Term := match mixBoxTemplate.script with | .Program _ b => b

def searchAt : List Nat :=
  [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1]

/-- `(lam self (lam inputs ...))`. -/
def searchSelf : Term := subterm templateBody searchAt
/-- `(lam inputs ...)`, the recursive closure's body. -/
def searchLoop : Term := subterm templateBody (searchAt ++ [0])
/-- The body evaluated for one input list. -/
def searchBody : Term := subterm templateBody (searchAt ++ [0,0])

theorem searchSelf_shape : searchSelf = .Lam searchLoop := rfl
theorem searchLoop_shape : searchLoop = .Lam searchBody := rfl

/-- Values in scope before the recursive function: the target reference, arbitrary
unused slots, and the seven forced builtins the loop reads. -/
def searchEnv (target : Data) (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue)
    (rest : Environment) : Environment :=
  .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV) :: .VCon (.Data target) ::
  c16 :: c15 :: c14 :: c13 :: c12 :: c11 :: c10 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) :: .VBuiltin .HeadList [] (.One .ArgV) ::
  .VBuiltin .TailList [] (.One .ArgV) :: c2 :: c1 :: c0 :: rest

/-- Each input has a reference and a resolved output, both arbitrary Data. -/
def inputData (r o : Data) : Data := .Constr 0 [r, o]

def inputList (xs : List (Data × Data)) : List Data := xs.map fun x => inputData x.1 x.2

set_option maxHeartbeats 0

/-- The empty input list returns the encoded `None`. -/
theorem search_empty (target : Data) (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment) :
    Ev default searchBody
      (.VCon (.ConstDataList []) :: .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  cek_v3

/-- First input with the target reference, as the validator encodes the option. -/
def searchResult (target : Data) : List (Data × Data) → Data
  | [] => .Constr 1 []
  | (ref, out) :: xs =>
    if ref = target then .Constr 0 [inputData ref out] else searchResult target xs


/-- If the first input matches, the search returns that input. -/
theorem search_head (target out : Data) (xs : List (Data × Data))
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment) :
    Ev default searchBody
      (.VCon (.ConstDataList (inputData target out :: inputList xs)) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (.Constr 0 [inputData target out])))) := by
  have eqt : PlutusCore.Data.equalsData target target = true := by simp [PlutusCore.Data.equalsData]
  cek_v3
  all_goals try rw [eqt]
  cek_v3

/-- A nonmatching input is skipped; the recursive result is preserved. -/
theorem search_miss (target ref out : Data) (xs : List (Data × Data))
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment)
    (h : ref ≠ target)
    (ih : Ev default searchBody
      (.VCon (.ConstDataList (inputList xs)) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (searchResult target xs))))) :
    Ev default searchBody
      (.VCon (.ConstDataList (inputData ref out :: inputList xs)) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (searchResult target xs)))) := by
  have eqf : PlutusCore.Data.equalsData ref target = false := by simp [PlutusCore.Data.equalsData, h]
  cek_v3
  all_goals try rw [eqf]
  cek_v3_using [ih]

/-- The compiled search returns the first matching input, for every list length. -/
theorem search_all (target : Data) (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue)
    (rest : Environment) (xs : List (Data × Data)) :
    Ev default searchBody
      (.VCon (.ConstDataList (inputList xs)) :: .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (searchResult target xs)))) := by
  induction xs with
  | nil => exact search_empty target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
  | cons x xs ih =>
    rcases x with ⟨ref, out⟩
    by_cases h : ref = target
    · subst ref
      simpa [searchResult, inputList] using search_head target out xs c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    · simpa [searchResult, inputList, h] using search_miss target ref out xs c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest h ih

/-- With no earlier match, the first matching input is the displayed one. -/
theorem searchResult_split (target out : Data) (before after : List (Data × Data))
    (h : ∀ pair ∈ before, pair.1 ≠ target) :
    searchResult target (before ++ (target, out) :: after) = .Constr 0 [inputData target out] := by
  induction before with
  | nil => simp [searchResult]
  | cons x xs ih =>
    rcases x with ⟨ref, value⟩
    have hhead : ref ≠ target := h (ref, value) (by simp)
    have htail : ∀ pair ∈ xs, pair.1 ≠ target := by
      intro pair hp
      exact h pair (by simp [hp])
    simp [searchResult, hhead, ih htail]

/-- The compiled search returns the displayed match after an arbitrary nonmatching prefix. -/
theorem search_matched (target out : Data) (before after : List (Data × Data))
    (h : ∀ pair ∈ before, pair.1 ≠ target)
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment) :
    Ev default searchBody
      (.VCon (.ConstDataList (inputList (before ++ (target, out) :: after))) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
      (some (.VCon (.Data (.Constr 0 [inputData target out])))) := by
  simpa [searchResult_split target out before after h] using
    search_all target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest (before ++ (target, out) :: after)

end Lovejoin.AnyTx.BoxSearch

#print axioms Lovejoin.AnyTx.BoxSearch.search_all
