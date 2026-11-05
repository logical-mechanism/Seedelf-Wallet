import Lovejoin.AnyTx.LogicOwnerContextPairing

/-! The compiled Owner branch's nonempty and proof-count gates. -/
namespace Lovejoin.AnyTx.LogicOwnerConditions
open PlutusCore.Data (Data)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def conditionAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0]
def conditionBody : Term := subterm templateBody (conditionAt ++ [0,0])
def prologueBody : Term := subterm templateBody conditionAt.dropLast.dropLast

set_option maxHeartbeats 0

/-- Separate the two values pushed by the Owner prologue. -/
theorem split_slots (slots : Fin 31 → CekValue) (rest : Environment)
    (boxes proofs : List Data)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs)) :
    LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) ::
        (LogicInputRefs.refsEnv slots rest).drop 2 := by
  simp only [LogicInputRefs.refsEnv]
  rw [List.ofFn_succ, List.ofFn_succ]
  simp only [List.cons_append, List.drop_cons, List.drop_zero, List.cons.injEq]
  exact ⟨hN, hProofs, rfl⟩

/-- When the nonempty and proof-count checks pass, the compiled Owner branch
continues into the hash-and-pair computation. -/
theorem conditions_pass (slots : Fin 31 → CekValue) (rest : Environment)
    (proofs : List Data) (n : Integer) (lengthFn : CekValue) (result : Option CekValue)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer n))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLength : Ap default lengthFn (.VCon (.ConstDataList proofs)) (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hNonempty : (1 : Integer) ≤ n)
    (hSize : (Int.ofNat proofs.length : Integer) = n)
    (hNext : Ev default LogicOwnerContextPairing.beforeFinishBody (LogicInputRefs.refsEnv slots rest) result) :
    Ev default conditionBody (LogicInputRefs.refsEnv slots rest) result := by
  have hMin : PlutusCore.Integer.lessThanEqualsInteger 1 n = true := by
    change decide ((1 : Integer) ≤ n) = true
    exact decide_eq_true hNonempty
  have hEq : PlutusCore.Integer.equalsInteger (.ofNat proofs.length) n = true := by
    change decide ((Int.ofNat proofs.length : Integer) = n) = true
    exact decide_eq_true hSize
  repeat' first
    | rw [hN]
    | rw [hProofs]
    | rw [hLengthFn]
    | rw [hIf]
    | rw [hMin]
    | rw [hEq]
    | apply hLength
    | apply hNext
    | cek_v3_step

/-- The Owner branch rejects zero collected boxes. -/
theorem no_boxes_errors (slots : Fin 31 → CekValue) (rest : Environment)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer 0))
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV)))) :
    Ev default conditionBody (LogicInputRefs.refsEnv slots rest) none := by
  repeat' first
    | rw [hN]
    | rw [hIf]
    | cek_v3_step

/-- With boxes present, the Owner branch rejects a mismatched proof count. -/
theorem wrong_count_errors (slots : Fin 31 → CekValue) (rest : Environment)
    (proofs : List Data) (n : Integer) (lengthFn : CekValue)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer n))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLength : Ap default lengthFn (.VCon (.ConstDataList proofs)) (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hNonempty : (1 : Integer) ≤ n)
    (hSize : (Int.ofNat proofs.length : Integer) ≠ n) :
    Ev default conditionBody (LogicInputRefs.refsEnv slots rest) none := by
  have hMin : PlutusCore.Integer.lessThanEqualsInteger 1 n = true := by
    change decide ((1 : Integer) ≤ n) = true
    exact decide_eq_true hNonempty
  have hEq : PlutusCore.Integer.equalsInteger (.ofNat proofs.length) n = false := by
    change decide ((Int.ofNat proofs.length : Integer) = n) = false
    exact decide_eq_false hSize
  repeat' first
    | rw [hN]
    | rw [hProofs]
    | rw [hLengthFn]
    | rw [hIf]
    | rw [hMin]
    | rw [hEq]
    | apply hLength
    | cek_v3_step

/-- Any true result from the Owner count gates requires at least one box and
exactly one proof per collected box. -/
theorem conditions_true_require_counts (slots : Fin 31 → CekValue) (rest : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLength : Ap default lengthFn (.VCon (.ConstDataList proofs)) (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hTrue : Ev default conditionBody (LogicInputRefs.refsEnv slots rest) (some (.VCon (.Bool true)))) :
    0 < boxes.length ∧ proofs.length = boxes.length := by
  have hPositive : 0 < boxes.length := by
    by_cases hZero : boxes.length = 0
    · have hZeroSlot : slots ⟨0, by decide⟩ = .VCon (.Integer 0) := by simpa [hZero] using hN
      have hError := no_boxes_errors slots rest hZeroSlot hIf
      have hImpossible := LogicProofPairs.ev_true_of_model conditionBody (LogicInputRefs.refsEnv slots rest) none hError hTrue
      cases hImpossible
    · exact Nat.pos_iff_ne_zero.mpr hZero
  have hNonempty : (1 : Integer) ≤ .ofNat boxes.length := Int.ofNat_le.mpr hPositive
  have hCount : proofs.length = boxes.length := by
    by_cases hEqual : proofs.length = boxes.length
    · exact hEqual
    · have hMismatch : (Int.ofNat proofs.length : Integer) ≠ .ofNat boxes.length := by
        intro he
        exact hEqual (Int.ofNat_inj.mp he)
      have hError := wrong_count_errors slots rest proofs (.ofNat boxes.length) lengthFn
        hN hProofs hLengthFn hIf hLength hNonempty hMismatch
      have hImpossible := LogicProofPairs.ev_true_of_model conditionBody (LogicInputRefs.refsEnv slots rest) none hError hTrue
      cases hImpossible
  exact ⟨hPositive, hCount⟩

/-- The compiled length closure counts arbitrary proof or box lists. -/
theorem length_closure (c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 : CekValue)
    (rest : Environment) (xs : List Data) :
    let env := LogicLength.lengthEnv c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 rest
    Ap default (.VLam LogicLength.lengthBody (.VLam LogicLength.lengthLoop env :: env))
      (.VCon (.ConstDataList xs)) (some (.VCon (.Integer (.ofNat xs.length)))) := by
  dsimp only
  apply ap_lam
  exact LogicLength.length_all c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 rest xs

/-- The compiled Owner prologue reads the proof list and counts the selected
boxes before entering the nonempty and proof-count gates. -/
theorem prologue_pass (slots : Fin 31 → CekValue) (rest outer : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue) (result : Option CekValue)
    (hSplit : LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) :: outer)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hBoxes : slots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : slots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hNonempty : (1 : Integer) ≤ .ofNat boxes.length)
    (hSize : proofs.length = boxes.length)
    (hNext : Ev default LogicOwnerContextPairing.beforeFinishBody (LogicInputRefs.refsEnv slots rest) result) :
    Ev default prologueBody outer result := by
  have hOuter : outer = (LogicInputRefs.refsEnv slots rest).drop 2 := by
    rw [hSplit]
    rfl
  subst outer
  have hSizeInt : (Int.ofNat proofs.length : Integer) = .ofNat boxes.length := by rw [hSize]
  have hConditions := conditions_pass slots rest proofs (.ofNat boxes.length) lengthFn result
    hN hProofs hLengthFn hIf hLengthProofs hNonempty hSizeInt hNext
  rw [hSplit] at hConditions
  repeat' first
    | rw [hLengthFn]
    | rw [hBoxes]
    | rw [hRedeemer]
    | apply hLengthBoxes
    | apply hConditions
    | cek_v3_step

/-- Propagate any result of the compiled count gates through their enclosing
prologue after reading the proof list and counting boxes. -/
theorem prologue_enter (slots : Fin 31 → CekValue) (rest outer : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue) (result : Option CekValue)
    (hSplit : LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) :: outer)
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hBoxes : slots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : slots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hConditions : Ev default conditionBody (LogicInputRefs.refsEnv slots rest) result) :
    Ev default prologueBody outer result := by
  have hOuter : outer = (LogicInputRefs.refsEnv slots rest).drop 2 := by
    rw [hSplit]
    rfl
  subst outer
  rw [hSplit] at hConditions
  repeat' first
    | rw [hLengthFn]
    | rw [hBoxes]
    | rw [hRedeemer]
    | apply hLengthBoxes
    | apply hConditions
    | cek_v3_step

/-- A true Owner prologue result requires at least one collected box and one
proof per box, even without assuming the count checks passed. -/
theorem prologue_true_requires_counts (slots : Fin 31 → CekValue) (rest outer : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue)
    (hSplit : LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) :: outer)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hBoxes : slots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : slots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hTrue : Ev default prologueBody outer (some (.VCon (.Bool true)))) :
    0 < boxes.length ∧ proofs.length = boxes.length := by
  have hPositive : 0 < boxes.length := by
    by_cases hZero : boxes.length = 0
    · have hZeroSlot : slots ⟨0, by decide⟩ = .VCon (.Integer 0) := by simpa [hZero] using hN
      have hError := no_boxes_errors slots rest hZeroSlot hIf
      have hOuterError := prologue_enter slots rest outer boxes proofs lengthFn none hSplit hLengthFn hBoxes
        hRedeemer hLengthBoxes hError
      have hImpossible := LogicProofPairs.ev_true_of_model prologueBody outer none hOuterError hTrue
      cases hImpossible
    · exact Nat.pos_iff_ne_zero.mpr hZero
  have hNonempty : (1 : Integer) ≤ .ofNat boxes.length := Int.ofNat_le.mpr hPositive
  have hCount : proofs.length = boxes.length := by
    by_cases hEqual : proofs.length = boxes.length
    · exact hEqual
    · have hMismatch : (Int.ofNat proofs.length : Integer) ≠ .ofNat boxes.length := by
        intro he
        exact hEqual (Int.ofNat_inj.mp he)
      have hError := wrong_count_errors slots rest proofs (.ofNat boxes.length) lengthFn
        hN hProofs hLengthFn hIf hLengthProofs hNonempty hMismatch
      have hOuterError := prologue_enter slots rest outer boxes proofs lengthFn none hSplit hLengthFn hBoxes
        hRedeemer hLengthBoxes hError
      have hImpossible := LogicProofPairs.ev_true_of_model prologueBody outer none hOuterError hTrue
      cases hImpossible
  exact ⟨hPositive, hCount⟩

/-- At the compiled Owner prologue, a true result requires every aligned proof
to satisfy the Schnorr model, when the adjoining hash-and-pair boundary has
been established. -/
theorem prologue_true_requires_schnorr (slots : Fin 31 → CekValue) (rest outer : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue) (ctx : PlutusCore.ByteString.ByteString)
    (hSplit : LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) :: outer)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hBoxes : slots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : slots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hNext : Ev default LogicOwnerContextPairing.beforeFinishBody (LogicInputRefs.refsEnv slots rest)
      ((LogicProofPairs.allPairsPartial (LogicOwnerPairing.ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)))
    (hTrue : Ev default prologueBody outer (some (.VCon (.Bool true)))) :
    boxes.length = proofs.length ∧
      ∀ a b t z : PlutusCore.ByteString.ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hCounts := prologue_true_requires_counts slots rest outer boxes proofs lengthFn hSplit hN hProofs
    hLengthFn hBoxes hRedeemer hIf hLengthBoxes hLengthProofs hTrue
  have hNonempty : (1 : Integer) ≤ .ofNat boxes.length := Int.ofNat_le.mpr hCounts.1
  have hModel := prologue_pass slots rest outer boxes proofs lengthFn _ hSplit hN hProofs hLengthFn
    hBoxes hRedeemer hIf hLengthBoxes hLengthProofs hNonempty hCounts.2 hNext
  exact LogicOwnerContextPairing.true_requires_schnorr_pairs prologueBody outer ctx boxes proofs hModel hTrue

end Lovejoin.AnyTx.LogicOwnerConditions

#print axioms Lovejoin.AnyTx.LogicOwnerConditions.conditions_pass
#print axioms Lovejoin.AnyTx.LogicOwnerConditions.no_boxes_errors
#print axioms Lovejoin.AnyTx.LogicOwnerConditions.wrong_count_errors
#print axioms Lovejoin.AnyTx.LogicOwnerConditions.conditions_true_require_counts
#print axioms Lovejoin.AnyTx.LogicOwnerConditions.prologue_true_requires_counts
#print axioms Lovejoin.AnyTx.LogicOwnerConditions.prologue_true_requires_schnorr
