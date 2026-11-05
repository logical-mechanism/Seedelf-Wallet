import Lovejoin.AnyTx.BoxSearch

/-! The one-shot mint policy's compiled reference-output search loop. -/
namespace Lovejoin.AnyTx.LaunchOutputSearch
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match oneShotMintTemplate.script with | .Program _ b => b
def searchAt : List Nat :=
  [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,1,1]
def searchLoop : Term := subterm templateBody (searchAt ++ [0])
def searchBody : Term := subterm templateBody (searchAt ++ [0,0])
def predicateBody : Term := subterm templateBody (searchAt ++ [0,0,0,0,2,0,0,0,0,0,0])

theorem self_shape : subterm templateBody searchAt = .Lam searchLoop := rfl
theorem loop_shape : searchLoop = .Lam searchBody := rfl

def searchEnv (slots : Fin 20 → CekValue) (c9 c8 : CekValue) (rest : Environment) : Environment :=
  List.ofFn slots ++ .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def firstMatch (check : Data → Bool) : List Data → Data
  | [] => .Constr 1 []
  | output :: rest => if check output then .Constr 0 [output] else firstMatch check rest

/-- The search returns None exactly when every output is rejected. -/
theorem firstMatch_none_iff (check : Data → Bool) (outputs : List Data) :
    firstMatch check outputs = .Constr 1 [] ↔ ∀ output ∈ outputs, check output = false := by
  induction outputs with
  | nil => simp [firstMatch]
  | cons output outputs ih =>
    cases hc : check output <;> simp [firstMatch, hc, ih]

/-- Any found output occurs in the list and passed the supplied predicate. -/
theorem firstMatch_some (check : Data → Bool) (outputs : List Data) (found : Data)
    (h : firstMatch check outputs = .Constr 0 [found]) :
    found ∈ outputs ∧ check found = true := by
  induction outputs with
  | nil => simp [firstMatch] at h
  | cons output outputs ih =>
    cases hc : check output with
    | false =>
      have ht := ih (by simpa [firstMatch, hc] using h)
      exact ⟨List.mem_cons_of_mem _ ht.1, ht.2⟩
    | true =>
      have he : output = found := by simpa [firstMatch, hc] using h
      subst output
      exact ⟨by simp, hc⟩

set_option maxHeartbeats 0

/-- Given the result of the extracted destination predicate on each output,
the compiled loop finds the first matching output for arbitrary list lengths.
The predicate's own semantics and the whole validator remain separate. -/
theorem search_all (slots : Fin 20 → CekValue) (c9 c8 : CekValue) (rest : Environment)
    (check : Data → Bool)
    (hPred : ∀ (output : Data) (xs : List Data),
      let env := searchEnv slots c9 c8 rest
      Ev default predicateBody
        (.VCon (.Data output) :: .VCon (.ConstDataList (output :: xs)) :: .VLam searchLoop env :: env)
        (some (.VCon (.Bool (check output)))))
    (outputs : List Data) :
    let env := searchEnv slots c9 c8 rest
    Ev default searchBody (.VCon (.ConstDataList outputs) :: .VLam searchLoop env :: env)
      (some (.VCon (.Data (firstMatch check outputs)))) := by
  induction outputs with
  | nil =>
    simp only [firstMatch]
    cek_v3
  | cons output xs ih =>
    cases hc : check output with
    | false =>
      have hp := hPred output xs
      simp only [hc] at hp
      simp only [firstMatch, hc, Bool.false_eq_true, ↓reduceIte]
      cek_v3_using [hp, ih]
    | true =>
      have hp := hPred output xs
      simp only [hc] at hp
      simp only [firstMatch, hc, ↓reduceIte]
      cek_v3_using [hp]

end Lovejoin.AnyTx.LaunchOutputSearch

/-- info: 'Lovejoin.AnyTx.LaunchOutputSearch.search_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LaunchOutputSearch.search_all
