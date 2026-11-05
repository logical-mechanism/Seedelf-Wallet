import Lovejoin.AnyTx.LogicInputFilter

/-! Additional malformed constructor cases for the compiled input classifier. -/
namespace Lovejoin.AnyTx.LogicInputMalformed
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicInputFilter
set_option maxHeartbeats 0

/-- Constructor-shaped inline data with a nonzero datum tag are not boxes. -/
theorem predicate_wrong_tag (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (tag : Integer) (fields xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    (hTag : tag ≠ 0) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr tag fields]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  have hTag' : PlutusCore.Integer.equalsInteger 0 tag = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hTag]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  all_goals try rw [hTag']
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  all_goals try rw [hTag']
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  all_goals try rw [hTag']
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqZero]
  all_goals try rw [hTag']
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hTag']
  cek_v3_using [hSelect, hThird]

/-- A box constructor with no fields is skipped. -/
theorem predicate_empty_fields (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 []]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqZero]
  cek_v3_using [hSelect, hThird]
  cek_v3_using [hSelect, hThird]


/-- A box constructor with one field is skipped. -/
theorem predicate_one_field (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (field : Data) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [field]]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqZero]
  cek_v3_using [hSelect, hThird]
  cek_v3_using [hSelect, hThird]


/-- A box constructor with three or more fields is skipped. -/
theorem predicate_many_fields (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (f1 f2 f3 : Data) (others : List Data) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 (f1 :: f2 :: f3 :: others)]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hHash]
  all_goals try rw [hEqTwo]
  all_goals try rw [hEqZero]
  all_goals try rw [he]
  cek_v3_using [hSelect, hThird]
  all_goals try rw [hEqZero]
  cek_v3_using [hSelect, hThird]
  cek_v3_using [hSelect, hThird]


/-- Every tag-zero datum whose field count is not two is skipped. -/
theorem predicate_wrong_arity (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (fields : List Data) (xs : List Data)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    (hArity : fields.length ≠ 2) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 fields]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  cases fields with
  | nil => exact predicate_empty_fields top middle rest ref stake value script mixHash xs hHash hSelect hThird hEqTwo hEqZero
  | cons f1 tail =>
    cases tail with
    | nil => exact predicate_one_field top middle rest ref stake value script mixHash f1 xs hHash hSelect hThird hEqTwo hEqZero
    | cons f2 tail =>
      cases tail with
      | nil => exact False.elim (hArity rfl)
      | cons f3 others => exact predicate_many_fields top middle rest ref stake value script mixHash f1 f2 f3 others xs hHash hSelect hThird hEqTwo hEqZero

theorem predicate_bad_first_length (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
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
    (ha : PlutusCore.ByteString.lengthOfByteString a ≠ 48) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  have ha' : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString a) = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm ha]
  dsimp only
  repeat' first
    | rw [hHash]
    | rw [hEqTwo]
    | rw [hEqZero]
    | rw [hEq48]
    | rw [he]
    | rw [ha']
    | apply hSelect
    | apply hThird
    | apply hBytes
    | cek_v3_step


theorem predicate_bad_second_length (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
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
    (hb : PlutusCore.ByteString.lengthOfByteString b ≠ 48) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  have hb' : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString b) = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hb]
  dsimp only
  repeat' first
    | rw [hHash]
    | rw [hEqTwo]
    | rw [hEqZero]
    | rw [hEq48]
    | rw [he]
    | rw [ha]
    | rw [hb']
    | apply hSelect
    | apply hThird
    | apply hBytes
    | cek_v3_step


theorem predicate_equal_points (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash a : ByteString) (xs : List Data)
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
    (ha : PlutusCore.ByteString.lengthOfByteString a = 48) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.boxIn ref mixHash stake value script a a
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  have heq : PlutusCore.ByteString.equalsByteString a a = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  repeat' first
    | rw [hHash]
    | rw [hEqTwo]
    | rw [hEqZero]
    | rw [hEq48]
    | rw [he]
    | rw [ha]
    | rw [heq]
    | apply hSelect
    | apply hThird
    | apply hBytes
    | cek_v3_step


/-- Box datums with two byte-string fields but invalid point lengths or equal points are skipped by the compiled classifier. -/
theorem predicate_invalid_box (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
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
    (hInvalid : PlutusCore.ByteString.lengthOfByteString a ≠ 48 ∨
      PlutusCore.ByteString.lengthOfByteString b ≠ 48 ∨ a = b) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  by_cases ha : PlutusCore.ByteString.lengthOfByteString a = 48
  · by_cases hb : PlutusCore.ByteString.lengthOfByteString b = 48
    · rcases hInvalid with bad | bad | same
      · exact False.elim (bad ha)
      · exact False.elim (bad hb)
      · subst b
        exact predicate_equal_points top middle rest ref stake value script mixHash a xs
          hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes ha
    · exact predicate_bad_second_length top middle rest ref stake value script mixHash a b xs
        hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes ha hb
  · exact predicate_bad_first_length top middle rest ref stake value script mixHash a b xs
      hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes ha

theorem predicate_nonbyte_first (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (bad b : Data) (xs : List Data)
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
    (hReject : Ap default (top ⟨1, by decide⟩) (.VCon (.Data bad)) (some (.VCon (.Bool false)))) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [bad, b]]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  repeat' first
    | rw [hHash]
    | rw [hEqTwo]
    | rw [hEqZero]
    | rw [hEq48]
    | rw [he]
    | apply hReject
    | apply hSelect
    | apply hThird
    | apply hBytes
    | cek_v3_step


theorem predicate_nonbyte_second (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (ref stake value script : Data) (mixHash : ByteString) (a : ByteString) (bad : Data) (xs : List Data)
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
    (hReject : Ap default (top ⟨1, by decide⟩) (.VCon (.Data bad)) (some (.VCon (.Bool false)))) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    let input := Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [.B a, bad]]) script
    Ev default predicateBody
      (.VCon (.Data input) :: .VCon (.ConstDataList (input :: xs)) :: .VLam filterLoop env :: env)
      (some (.VCon (.Data (.Constr 1 [])))) := by
  have he : PlutusCore.ByteString.equalsByteString mixHash mixHash = true := by
    simp [PlutusCore.ByteString.equalsByteString]
  dsimp only
  repeat' first
    | rw [hHash]
    | rw [hEqTwo]
    | rw [hEqZero]
    | rw [hEq48]
    | rw [he]
    | apply hReject
    | apply hSelect
    | apply hThird
    | apply hBytes
    | cek_v3_step


end Lovejoin.AnyTx.LogicInputMalformed

#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_wrong_tag

#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_empty_fields
#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_one_field
#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_many_fields

/-- info: 'Lovejoin.AnyTx.LogicInputMalformed.predicate_wrong_arity' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_wrong_arity

#print axioms Lovejoin.AnyTx.LogicInputMalformed.predicate_invalid_box
