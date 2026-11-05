import Lovejoin.AnyTx.LogicLength
import Lovejoin.AnyTx.Common

/-! The compiled unbounded well-formed mix-input collection loop. -/
namespace Lovejoin.AnyTx.LogicInputFilter
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def filterAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]
def filterLoop : Term := subterm templateBody (filterAt ++ [0])
def filterBody : Term := subterm templateBody (filterAt ++ [0,0])
def predicateAt : List Nat := filterAt ++ [0,0,0,0,2,0,0,0,0,1]
def predicateBody : Term := subterm templateBody predicateAt

theorem self_shape : subterm templateBody filterAt = .Lam filterLoop := rfl
theorem loop_shape : filterLoop = .Lam filterBody := rfl

def filterEnv (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment) : Environment :=
  List.ofFn top ++ .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: List.ofFn middle ++
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

set_option maxHeartbeats 0

theorem filter_nil (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment) :
    let env := filterEnv top middle rest
    Ev default filterBody
      (.VCon (.ConstDataList []) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList []))) := by
  dsimp only
  cek_v3

/-- A predicate result of None drops the input and continues with the tail. -/
theorem filter_skip (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (input : Data) (xs result : List Data)
    (hPred : let env := filterEnv top middle rest
      Ev default predicateBody
        (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
        (some (.VCon (.Data (.Constr 1 [])))))
    (hTail : let env := filterEnv top middle rest
      Ev default filterBody (.VCon (.ConstDataList xs) :: .VLam filterLoop env :: env)
        (some (.VCon (.ConstDataList result)))) :
    let env := filterEnv top middle rest
    Ev default filterBody (.VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList result))) := by
  dsimp only at *
  cek_v3_using [hPred, hTail]

/-- A predicate result of Some adds its decoded datum before the tail. -/
theorem filter_keep (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (input datum : Data) (xs result : List Data)
    (hPred : let env := filterEnv top middle rest
      Ev default predicateBody
        (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
        (some (.VCon (.Data (.Constr 0 [datum])))))
    (hTail : let env := filterEnv top middle rest
      Ev default filterBody (.VCon (.ConstDataList xs) :: .VLam filterLoop env :: env)
        (some (.VCon (.ConstDataList result)))) :
    let env := filterEnv top middle rest
    Ev default filterBody (.VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (datum :: result)))) := by
  dsimp only at *
  cek_v3_using [hPred, hTail]

/-- The compiled collection loop preserves the order of every selected datum,
for arbitrary input lists, provided the extracted per-input predicate returns
the stated option. Characterizing that predicate is a separate obligation. -/
theorem filter_all (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (classify : Data → Option Data)
    (hPred : ∀ (input : Data) (xs : List Data),
      let env := filterEnv top middle rest
      Ev default predicateBody
        (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
        (some (.VCon (.Data (match classify input with
          | none => .Constr 1 []
          | some datum => .Constr 0 [datum])))))
    (inputs : List Data) :
    let env := filterEnv top middle rest
    Ev default filterBody
      (.VCon (.ConstDataList inputs) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (inputs.filterMap classify)))) := by
  induction inputs with
  | nil => exact filter_nil top middle rest
  | cons input xs ih =>
    cases hc : classify input with
    | none =>
      simpa [hc] using filter_skip top middle rest input xs (xs.filterMap classify)
        (by simpa [hc] using hPred input xs) ih
    | some datum =>
      simpa [hc] using filter_keep top middle rest input datum xs (xs.filterMap classify)
        (by simpa [hc] using hPred input xs) ih

/-- A key-credential input is not collected as a mix-script box, regardless
of its value, datum, reference script or position in the input list. -/
theorem predicate_key_input (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value datum script : Data) (key : ByteString) (xs : List Data)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b)))) :
    let env := filterEnv top middle rest
    let input := Lovejoin.AnyTx.otherIn ref 0 key stake value datum script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  dsimp only
  cek_v3_using [hSelect]

/-- A script input with a different payment hash is not collected as a box. -/
theorem predicate_foreign_script (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value datum script : Data) (other mixHash : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hDifferent : other ≠ mixHash)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b)))) :
    let env := filterEnv top middle rest
    let input := Lovejoin.AnyTx.otherIn ref 1 other stake value datum script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString other mixHash = false := by
    simp [PlutusCore.ByteString.equalsByteString, hDifferent]
  dsimp only
  cek_v3_using [hSelect]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect]
  all_goals try rw [he]
  cek_v3_using [hSelect]

/-- An input at the mix script with no inline datum is not a well-formed box. -/
theorem predicate_mix_no_datum (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle rest
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 0 []) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]

/-- An input at the mix script with a integer inline datum is not a well-formed box. -/
theorem predicate_inline_integer (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (bad : PlutusCore.Integer.Integer) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.I bad]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]


/-- An input at the mix script with a bytes inline datum is not a well-formed box. -/
theorem predicate_inline_bytes (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (bad : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.B bad]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]


/-- An input at the mix script with a list inline datum is not a well-formed box. -/
theorem predicate_inline_list (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (bad : List Data) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.List bad]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]


/-- An input at the mix script with a map inline datum is not a well-formed box. -/
theorem predicate_inline_map (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (bad : List (Data × Data)) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Map bad]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]


/-- Non-constructor inline data at the mix script are not collected. -/
theorem predicate_inline_nonconstructor (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script bad : Data) (mixHash : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hBad : ∀ tag fields, bad ≠ .Constr tag fields) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [bad]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  cases bad with
  | Constr tag fields => exact False.elim (hBad tag fields rfl)
  | I bad => exact predicate_inline_integer top middle rest ref stake value script mixHash bad xs hHash hSelect hThird hEqTwo
  | B bad => exact predicate_inline_bytes top middle rest ref stake value script mixHash bad xs hHash hSelect hThird hEqTwo
  | List bad => exact predicate_inline_list top middle rest ref stake value script mixHash bad xs hHash hSelect hThird hEqTwo
  | Map bad => exact predicate_inline_map top middle rest ref stake value script mixHash bad xs hHash hSelect hThird hEqTwo

/-- An input at the mix script with a datum hash is not a well-formed box. -/
theorem predicate_mix_datum_hash (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script hash : Data) (mixHash : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hThird : ∀ a b c : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)) :
    let env := filterEnv top middle rest
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 1 [hash]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqTwo]
  cek_v3_using [hSelect, hThird]


/-- A well-formed inline box at the target script is collected as its datum. -/
theorem predicate_wellformed_box (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash a b : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    (hEq48 : top ⟨8, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV))
    (hConstr : top ⟨7, by decide⟩ = .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV))
    (hBytes : ∀ x, Ap default (top ⟨1, by decide⟩) (.VCon (.Data (.B x))) (some (.VCon (.Bool true))))
    (ha : PlutusCore.ByteString.lengthOfByteString a = 48)
    (hb : PlutusCore.ByteString.lengthOfByteString b = 48)
    (hab : a ≠ b) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 0 [.Constr 0 [.B a, .B b]])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  have hab' : PlutusCore.ByteString.equalsByteString a b = false := by
    simp [PlutusCore.ByteString.equalsByteString, hab]
  dsimp only
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]

  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [hEq48]
  all_goals try rw [hConstr]
  all_goals try rw [he]
  all_goals try rw [ha]
  all_goals try rw [hb]
  all_goals try rw [hab']
  cek_v3_using [hSelect, hThird, hBytes]

/-- Supported input shapes; the encoded reference and unrelated output fields
are arbitrary. -/
inductive InputShape where
  | key (ref stake value datum script : Data) (key : ByteString)
  | foreign (ref stake value datum script : Data) (other : ByteString)
  | noDatum (ref stake value script : Data)
  | datumHash (ref stake value script hash : Data)
  | junk (ref stake value script datum : Data)
  | box (ref stake value script : Data) (a b : ByteString)

def inputShapeData (mixHash : ByteString) : InputShape → Data
  | .key ref stake value datum script key => Lovejoin.AnyTx.otherIn ref 0 key stake value datum script
  | .foreign ref stake value datum script other => Lovejoin.AnyTx.otherIn ref 1 other stake value datum script
  | .noDatum ref stake value script => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 0 []) script
  | .datumHash ref stake value script hash => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 1 [hash]) script
  | .junk ref stake value script datum => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [datum]) script
  | .box ref stake value script a b => Lovejoin.AnyTx.boxIn ref mixHash stake value script a b

def inputShapeDatum : InputShape → Option Data
  | .box _ _ _ _ a b => some (.Constr 0 [.B a, .B b])
  | _ => none

def inputShapeValid (mixHash : ByteString) : InputShape → Prop
  | .foreign _ _ _ _ _ other => other ≠ mixHash
  | .junk _ _ _ _ datum => ∀ tag fields, datum ≠ .Constr tag fields
  | .box _ _ _ _ a b => PlutusCore.ByteString.lengthOfByteString a = 48 ∧
      PlutusCore.ByteString.lengthOfByteString b = 48 ∧ a ≠ b
  | _ => True

/-- The compiled collection loop handles arbitrary interleavings and counts
of these input shapes, retaining exactly the well-formed box datums in order.
The closure hypotheses identify the helper values used by the compiled script. -/
theorem filter_supported (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (mixHash : ByteString)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    (hEq48 : top ⟨8, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV))
    (hConstr : top ⟨7, by decide⟩ = .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV))
    (hBytes : ∀ x, Ap default (top ⟨1, by decide⟩) (.VCon (.Data (.B x))) (some (.VCon (.Bool true))))
    (inputs : List InputShape) (hValid : ∀ input ∈ inputs, inputShapeValid mixHash input) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default filterBody
      (.VCon (.ConstDataList (inputs.map (inputShapeData mixHash))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (inputs.filterMap inputShapeDatum)))) := by
  induction inputs with
  | nil => exact filter_nil top middle _
  | cons input inputs ih =>
    have hInput := hValid input (by simp)
    have hTail : ∀ x ∈ inputs, inputShapeValid mixHash x := by
      intro x hx
      exact hValid x (by simp [hx])
    have hi := ih hTail
    cases input with
    | key ref stake value datum script key =>
      simpa [inputShapeData, inputShapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 0 key stake value datum script) (inputs.map (inputShapeData mixHash))
        (inputs.filterMap inputShapeDatum)
        (predicate_key_input top middle _ ref stake value datum script key _ hSelect) hi
    | foreign ref stake value datum script other =>
      simpa [inputShapeData, inputShapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 other stake value datum script) (inputs.map (inputShapeData mixHash))
        (inputs.filterMap inputShapeDatum)
        (predicate_foreign_script top middle _ ref stake value datum script other mixHash _ hHash hInput hSelect) hi
    | noDatum ref stake value script =>
      simpa [inputShapeData, inputShapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 0 []) script) (inputs.map (inputShapeData mixHash))
        (inputs.filterMap inputShapeDatum)
        (predicate_mix_no_datum top middle _ ref stake value script mixHash _ hHash hSelect hThird hEqTwo) hi
    | datumHash ref stake value script hash =>
      simpa [inputShapeData, inputShapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 1 [hash]) script) (inputs.map (inputShapeData mixHash))
        (inputs.filterMap inputShapeDatum)
        (predicate_mix_datum_hash top middle _ ref stake value script hash mixHash _ hHash hSelect hThird hEqTwo) hi
    | junk ref stake value script datum =>
      simpa [inputShapeData, inputShapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [datum]) script) (inputs.map (inputShapeData mixHash))
        (inputs.filterMap inputShapeDatum)
        (predicate_inline_nonconstructor top middle rest ref stake value script datum mixHash _ hHash hSelect hThird hEqTwo hInput) hi
    | box ref stake value script a b =>
      obtain ⟨ha, hb, hab⟩ := hInput
      simpa [inputShapeData, inputShapeDatum] using filter_keep top middle _
        (Lovejoin.AnyTx.boxIn ref mixHash stake value script a b) (.Constr 0 [.B a, .B b])
        (inputs.map (inputShapeData mixHash)) (inputs.filterMap inputShapeDatum)
        (predicate_wellformed_box top middle rest ref stake value script mixHash a b _ hHash hSelect hThird
          hEqTwo hEqZero hEq48 hConstr hBytes ha hb hab) hi

end Lovejoin.AnyTx.LogicInputFilter

#print axioms Lovejoin.AnyTx.LogicInputFilter.filter_all
#print axioms Lovejoin.AnyTx.LogicInputFilter.predicate_key_input
#print axioms Lovejoin.AnyTx.LogicInputFilter.predicate_foreign_script
#print axioms Lovejoin.AnyTx.LogicInputFilter.predicate_mix_no_datum
#print axioms Lovejoin.AnyTx.LogicInputFilter.predicate_wellformed_box
/-- info: 'Lovejoin.AnyTx.LogicInputFilter.filter_supported' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputFilter.filter_supported
