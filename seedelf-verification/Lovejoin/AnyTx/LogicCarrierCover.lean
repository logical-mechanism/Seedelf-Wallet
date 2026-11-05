import Lovejoin.AnyTx.LogicCarrierVariable
import Lovejoin.AnyTx.LogicAbsentName
import Lovejoin.AnyTx.LogicAbsentNameAfter
import Lovejoin.AnyTx.LogicAbsentPolicy
import Lovejoin.AnyTx.LogicAbsentPolicyAfter

/-! Exact filtering across interleaved map shapes, according to the compiled search. -/
namespace Lovejoin.AnyTx.LogicCarrierCover
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicReferenceFilter

/-- A reference candidate either has a found target entry or a search that stops
without a match. Entries after a terminating key are arbitrary and may be unsorted. -/
inductive Candidate where
  | present (item : LogicCarrierVariable.Candidate)
  | absentName (item : LogicAbsentName.Candidate)
  | absentNameAfter (item : LogicAbsentNameAfter.Candidate)
  | absentPolicy (ref addr datum script : Data) (policies : List (ByteString × Data))
  | absentPolicyAfter (ref addr datum script : Data) (policies : List (ByteString × Data))
      (nextPolicy : ByteString) (nextValue : Data) (afterPolicies : List (Data × Data))

def candidateData (P name : ByteString) : Candidate → Data
  | .present item => LogicCarrierVariable.candidateData P name item
  | .absentName item => LogicAbsentName.candidateData P item
  | .absentNameAfter item => LogicAbsentNameAfter.candidateData P item
  | .absentPolicy ref addr datum script policies =>
    LogicAbsentPolicy.absentPolicyInput ref addr datum script policies
  | .absentPolicyAfter ref addr datum script policies nextPolicy nextValue afterPolicies =>
    LogicAbsentPolicyAfter.absentPolicyInput ref addr datum script policies nextPolicy nextValue afterPolicies

def carrier (item : Candidate) : Bool :=
  match item with
  | .present p => decide (p.qty = 1)
  | _ => false

def matching (P name : ByteString) (xs : List Candidate) : List Data :=
  xs.filterMap fun item => if carrier item then some (candidateData P name item) else none

def ordered (P name : ByteString) : Candidate → Prop
  | .present item =>
    (∀ pair ∈ item.beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) ∧
    (∀ pair ∈ item.beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
  | .absentName item =>
    (∀ pair ∈ item.beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) ∧
    (∀ pair ∈ item.beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
  | .absentNameAfter item =>
    (∀ pair ∈ item.beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) ∧
    (∀ pair ∈ item.beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) ∧
    PlutusCore.ByteString.lessThanEqualsByteString name item.nextName = true ∧
    PlutusCore.ByteString.equalsByteString name item.nextName = false
  | .absentPolicy _ _ _ _ policies =>
    ∀ pair ∈ policies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false
  | .absentPolicyAfter _ _ _ _ policies nextPolicy _ _ =>
    (∀ pair ∈ policies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) ∧
    PlutusCore.ByteString.lessThanEqualsByteString P nextPolicy = true ∧
    PlutusCore.ByteString.equalsByteString P nextPolicy = false

set_option maxHeartbeats 0

/-- The compiled filter keeps exactly the quantity-one carriers in order, across
arbitrary interleavings of these search shapes. The unchecked tails may be unsorted. -/
theorem filter_exact (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (xs : List Candidate) (hOrdered : ∀ item ∈ xs, ordered P name item) :
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map (candidateData P name))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (matching P name xs)))) := by
  dsimp only
  induction xs with
  | nil => cek_v3
  | cons item xs ih =>
    have hItem := hOrdered item (by simp)
    have hTail : ∀ x ∈ xs, ordered P name x := by
      intro x hx
      exact hOrdered x (by simp [hx])
    have hi := ih hTail
    cases item with
    | present item =>
      obtain ⟨hp, hn⟩ := hItem
      rcases item with ⟨ref, addr, datum, script, qty, beforePolicies, beforeNames, afterPolicies, afterNames⟩
      by_cases hQty : qty = 1
      · subst qty
        have hPred := LogicCarrierPredicate.quantity_checked top selector c72 c29 c28 c26 middle P name rest ref addr datum script 1
          beforePolicies beforeNames afterPolicies afterNames (xs.map (candidateData P name)) hSelect hp hn hP hN
        simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData, LogicCarrierVariable.candidateData]
        cek_v3_using [hPred, hi]
      · have hPred := LogicCarrierPredicate.quantity_ne_one top selector c72 c29 c28 c26 middle P name rest ref addr datum script qty
          beforePolicies beforeNames afterPolicies afterNames (xs.map (candidateData P name)) hSelect hp hn hP hN hQty
        simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData, LogicCarrierVariable.candidateData, decide_eq_false hQty]
        cek_v3_using [hPred, hi]
    | absentName item =>
      obtain ⟨hp, hn⟩ := hItem
      have hPred := LogicAbsentName.predicate_rejects top selector c72 c29 c28 c26 middle P name rest
        item.ref item.addr item.datum item.script item.beforePolicies item.beforeNames item.afterPolicies
        (xs.map (candidateData P name)) hSelect hp hn hP
      simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData, LogicAbsentName.candidateData]
      cek_v3_using [hPred, hi]
    | absentNameAfter item =>
      obtain ⟨hp, hn, ha, he⟩ := hItem
      have hPred := LogicAbsentNameAfter.predicate_rejects top selector c72 c29 c28 c26 middle P name rest
        item.ref item.addr item.datum item.script item.beforePolicies item.beforeNames item.afterPolicies
        item.nextName item.nextValue item.afterNames (xs.map (candidateData P name)) hSelect hp hn ha he hP
      simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData, LogicAbsentNameAfter.candidateData]
      cek_v3_using [hPred, hi]
    | absentPolicy ref addr datum script policies =>
      have hPred := LogicAbsentPolicy.predicate_rejects top selector c72 c29 c28 c26 middle P name rest
        ref addr datum script policies (xs.map (candidateData P name)) hSelect hItem
      simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData]
      cek_v3_using [hPred, hi]
    | absentPolicyAfter ref addr datum script policies nextPolicy nextValue afterPolicies =>
      obtain ⟨hp, ha, he⟩ := hItem
      have hPred := LogicAbsentPolicyAfter.predicate_rejects top selector c72 c29 c28 c26 middle P name rest
        ref addr datum script policies nextPolicy nextValue afterPolicies (xs.map (candidateData P name)) hSelect hp ha he
      simp only [List.map_cons, matching, List.filterMap_cons, carrier, candidateData]
      cek_v3_using [hPred, hi]

theorem filter_two_or_more_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hOrdered : ∀ item ∈ refs, ordered P name item)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (first second : Data) (tail : List Data)
    (hMany : matching P name refs = first :: second :: tail) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P name))) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList (first :: second :: tail)))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn, hMany] using
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hOrdered


theorem filter_empty_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hOrdered : ∀ item ∈ refs, ordered P name item)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (hNone : matching P name refs = []) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P name))) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList []))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn, hNone] using
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hOrdered

/-- The compiled reference filter returns its single matching carrier. -/
theorem filter_singleton_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hOrdered : ∀ item ∈ refs, ordered P name item)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (carrier : Data) (hSingle : matching P name refs = [carrier]) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P name))) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList [carrier]))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn, hSingle] using
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hOrdered


end Lovejoin.AnyTx.LogicCarrierCover

#print axioms Lovejoin.AnyTx.LogicCarrierCover.filter_exact

#print axioms Lovejoin.AnyTx.LogicCarrierCover.filter_singleton_slots
