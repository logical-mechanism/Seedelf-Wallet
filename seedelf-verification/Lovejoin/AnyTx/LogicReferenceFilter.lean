import Lovejoin.AnyTx.LogicInputRefs

/-! The shared reference-carrier filter from the compiled mix_logic validator. -/
namespace Lovejoin.AnyTx.LogicReferenceFilter
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm inputData)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
/-- The exact selector passed into the reference filter, from the compiled term. -/
def selectorAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,1]
def selectorBody : Term := subterm templateBody (selectorAt ++ [0])
def selectorEnv (slots : Fin 19 → CekValue) (rest : Environment) : Environment :=
  List.ofFn slots ++ .VBuiltin .HeadList [] (.One .ArgV) ::
  .VBuiltin .TailList [] (.One .ArgV) :: rest

def selectorValue (slots : Fin 19 → CekValue) (rest : Environment) : CekValue :=
  .VLam selectorBody (selectorEnv slots rest)

def filterAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1]
def filterLoop : Term := subterm templateBody (filterAt ++ [0])
def filterBody : Term := subterm templateBody (filterAt ++ [0,0])
def filterEnv (top : Fin 7 → CekValue) (selector pred : CekValue) (c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 c11 : CekValue) (rest : Environment) : Environment :=
  List.ofFn top ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: List.ofFn middle ++ c12 :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def emptyValueInput (ref addr datum script : Data) : Data :=
  inputData ref (.Constr 0 [addr, .Map [], datum, script])

set_option maxHeartbeats 0

theorem filter_empty_values (top : Fin 7 → CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 c11 : CekValue) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (xs : List (Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) ::
        .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest) ::
        filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest)
      (some (.VCon (.ConstDataList []))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    rcases x with ⟨ref, addr, datum, script⟩
    simp only [List.map_cons]
    cek_v3_using [ih, hSelect, hPred]

/-- The compiled selector reads the second list field. -/
theorem selector_second (slots : Fin 19 → CekValue) (rest : Environment)
    (a b : Data) (others : List Data) :
    Ap default (selectorValue slots rest) (.VCon (.ConstDataList (a :: b :: others)))
      (some (.VCon (.Data b))) := by
  apply ap_lam
  cek_v3

/-- The compiled equality predicate rejects NFT quantity zero. -/
theorem quantity_zero :
    Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      (.VCon (.Integer 0)) (some (.VCon (.Bool false))) := by
  cek_v3

/-- The real selector and NFT quantity check filter any number of empty-value inputs. -/
theorem filter_empty_values_compiled (top : Fin 7 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (selectorRest : Environment) (c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 c11 : CekValue) (rest : Environment)
    (xs : List (Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) ::
        .VLam filterLoop (filterEnv top (selectorValue selectorSlots selectorRest)
          (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV)) c72 c29 c28 c26 middle c12 c11 rest) ::
        filterEnv top (selectorValue selectorSlots selectorRest)
          (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV)) c72 c29 c28 c26 middle c12 c11 rest)
      (some (.VCon (.ConstDataList []))) := by
  apply filter_empty_values
  · exact selector_second selectorSlots selectorRest
  · exact quantity_zero

/-- A reference input with only an ADA-policy entry. -/
def adaInput (ref addr ada datum script : Data) : Data :=
  inputData ref (.Constr 0 [addr, .Map [(.B "", ada)], datum, script])

/-- With a policy ordered after ADA's empty policy, the compiled reference loop
filters arbitrary numbers of ADA-only inputs without counting an NFT carrier. -/
theorem filter_ada_values (top : Fin 7 → CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 : CekValue) (P : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List (Data × Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, ada, datum, script) => adaInput ref addr ada datum script)) ::
        .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest) ::
        filterEnv top selector pred c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest)
      (some (.VCon (.ConstDataList []))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    rcases x with ⟨ref, addr, ada, datum, script⟩
    simp only [List.map_cons]
    cek_v3_using [ih, hSelect, hPred]
    all_goals try rw [hAfterAda]
    cek_v3_using [ih, hSelect, hPred]

/-- The ADA-only filtering rule with the compiled selector and quantity check. -/
theorem filter_ada_values_compiled (top : Fin 7 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (selectorRest : Environment) (c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 : CekValue) (P : ByteString) (rest : Environment)
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List (Data × Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, ada, datum, script) => adaInput ref addr ada datum script)) ::
        .VLam filterLoop (filterEnv top (selectorValue selectorSlots selectorRest)
          (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV)) c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest) ::
        filterEnv top (selectorValue selectorSlots selectorRest)
          (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV)) c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest)
      (some (.VCon (.ConstDataList []))) := by
  apply filter_ada_values
  · exact selector_second selectorSlots selectorRest
  · exact quantity_zero
  · exact hAfterAda

/-- Reference inputs without the NFT, in either empty-value or ADA-only form. -/
inductive PlainReference where
  | empty (ref addr datum script : Data)
  | ada (ref addr ada datum script : Data)

def plainReferenceData : PlainReference → Data
  | .empty ref addr datum script => emptyValueInput ref addr datum script
  | .ada ref addr ada datum script => adaInput ref addr ada datum script

/-- Arbitrarily interleaved empty and ADA-only inputs do not contain a carrier. -/
theorem filter_plain_values (top : Fin 7 → CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 : CekValue) (P : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map plainReferenceData)) ::
        .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest) ::
        filterEnv top selector pred c72 c29 c28 c26 middle c12 (.VCon (.ByteString P)) rest)
      (some (.VCon (.ConstDataList []))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    cases x with
    | empty ref addr datum script =>
      simp only [List.map_cons, plainReferenceData]
      cek_v3_using [ih, hSelect, hPred]
    | ada ref addr ada datum script =>
      simp only [List.map_cons, plainReferenceData]
      cek_v3_using [ih, hSelect, hPred]
      all_goals try rw [hAfterAda]
      cek_v3_using [ih, hSelect, hPred]

/-- Explicit closure slots make the filter rule applicable while symbolically
executing the complete validator. -/
theorem filter_empty_values_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (c12 c11 : CekValue) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (xs : List (Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, datum, script) => emptyValueInput ref addr datum script)) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: c11 :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: c11 :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList []))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn] using
    filter_empty_values top selector pred c72 c29 c28 c26 middle c12 c11 rest hSelect hPred xs

/-- Explicit closure slots make the ADA filter rule applicable while symbolically
executing the complete validator. -/
theorem filter_ada_values_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (c12 : CekValue) (P : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List (Data × Data × Data × Data × Data)) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map fun (ref, addr, ada, datum, script) => adaInput ref addr ada datum script)) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList []))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn] using
    filter_ada_values top selector pred c72 c29 c28 c26 middle c12 P rest hSelect hPred hAfterAda xs

/-- Explicit closure slots make the mixed-input filter rule applicable while symbolically
executing the complete validator. -/
theorem filter_plain_values_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (c12 : CekValue) (P : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPred : Ap default pred (.VCon (.Integer 0)) (some (.VCon (.Bool false))))
    (hAfterAda : PlutusCore.ByteString.lessThanEqualsByteString P "" = false)
    (xs : List PlainReference) :
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map plainReferenceData)) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: pred :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          c12 :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList []))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn] using
    filter_plain_values top selector pred c72 c29 c28 c26 middle c12 P rest hSelect hPred hAfterAda xs

/-- The carrier predicate evaluated for one reference input, extracted from the
compiled filter body. -/
def carrierPredicateAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0]
def carrierPredicate : Term := subterm templateBody carrierPredicateAt

/-- If the compiled predicate rejects every reference input, the compiled filter
returns no carriers for a list of any length. The predicate premises are per input
and quantify over its surrounding tail. -/
theorem filter_no_carriers (top : Fin 7 → CekValue) (selector pred c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (c12 c11 : CekValue) (rest : Environment) (xs : List Data)
    (hPred : ∀ x ∈ xs, ∀ tail : List Data,
      Ev default carrierPredicate
        (.VCon (.ConstDataList tail) :: .VCon (.Data x) :: .VCon (.ConstDataList (x :: tail)) ::
          .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest) ::
          filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest)
        (some (.VCon (.Bool false)))) :
    Ev default filterBody
      (.VCon (.ConstDataList xs) ::
        .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest) ::
        filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest)
      (some (.VCon (.ConstDataList []))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    have hx := hPred x (by simp) xs
    have ht : ∀ y ∈ xs, ∀ tail : List Data,
      Ev default carrierPredicate
        (.VCon (.ConstDataList tail) :: .VCon (.Data y) :: .VCon (.ConstDataList (y :: tail)) ::
          .VLam filterLoop (filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest) ::
          filterEnv top selector pred c72 c29 c28 c26 middle c12 c11 rest)
        (some (.VCon (.Bool false))) := by
      intro y hy tail
      exact hPred y (by simp [hy]) tail
    have hi := ih ht
    cek_v3_using [hx, hi]

end Lovejoin.AnyTx.LogicReferenceFilter

#print axioms Lovejoin.AnyTx.LogicReferenceFilter.filter_empty_values_compiled

/--
info: 'Lovejoin.AnyTx.LogicReferenceFilter.filter_ada_values_compiled' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicReferenceFilter.filter_ada_values_compiled

#print axioms Lovejoin.AnyTx.LogicReferenceFilter.filter_no_carriers
