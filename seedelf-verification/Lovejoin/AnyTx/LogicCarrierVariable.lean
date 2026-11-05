import Lovejoin.AnyTx.LogicCarrierFilterExact

/-! The compiled carrier filter with independently varying asset maps. -/
namespace Lovejoin.AnyTx.LogicCarrierVariable
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicReferenceFilter
open Lovejoin.AnyTx.LogicCarrierPredicate (quantityInput quantity_checked quantity_ne_one)

/-- Every candidate has its own ordered policy and name prefixes and arbitrary suffixes. -/
structure Candidate where
  ref : Data
  addr : Data
  datum : Data
  script : Data
  qty : Integer
  beforePolicies : List (ByteString × Data)
  beforeNames : List (ByteString × Data)
  afterPolicies : List (Data × Data)
  afterNames : List (Data × Data)

def candidateData (P name : ByteString) (item : Candidate) : Data :=
  quantityInput item.ref item.addr item.datum item.script P name item.qty
    item.beforePolicies item.beforeNames item.afterPolicies item.afterNames

def matchingCandidates (P name : ByteString) (xs : List Candidate) : List Data :=
  xs.filterMap fun item => if item.qty = 1 then some (candidateData P name item) else none

set_option maxHeartbeats 0

/-- The compiled filter retains exactly the candidates with quantity one, even
when every candidate has a different ordered asset-map layout. -/
theorem filter_exact (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (xs : List Candidate)
    (hPolicies : ∀ item ∈ xs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ xs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map (candidateData P name))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (matchingCandidates P name xs)))) := by
  dsimp only
  induction xs with
  | nil => cek_v3
  | cons item xs ih =>
    have hPi := hPolicies item (by simp)
    have hNi := hNames item (by simp)
    have hPt : ∀ x ∈ xs, ∀ pair ∈ x.beforePolicies,
        PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false := by
      intro x hx pair hp
      exact hPolicies x (by simp [hx]) pair hp
    have hNt : ∀ x ∈ xs, ∀ pair ∈ x.beforeNames,
        PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false := by
      intro x hx pair hp
      exact hNames x (by simp [hx]) pair hp
    have hi := ih hPt hNt
    rcases item with ⟨ref, addr, datum, script, qty, beforePolicies, beforeNames, afterPolicies, afterNames⟩
    by_cases hQty : qty = 1
    · subst qty
      have hPred := quantity_checked top selector c72 c29 c28 c26 middle P name rest ref addr datum script 1
        beforePolicies beforeNames afterPolicies afterNames (xs.map (candidateData P name))
        hSelect hPi hNi hP hN
      simp only [List.map_cons, matchingCandidates, List.filterMap_cons, candidateData]
      cek_v3_using [hPred, hi]
    · have hPred := quantity_ne_one top selector c72 c29 c28 c26 middle P name rest ref addr datum script qty
        beforePolicies beforeNames afterPolicies afterNames (xs.map (candidateData P name))
        hSelect hPi hNi hP hN hQty
      simp only [List.map_cons, matchingCandidates, List.filterMap_cons, candidateData, if_neg hQty]
      cek_v3_using [hPred, hi]

theorem filter_two_or_more_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (first second : Data) (tail : List Data)
    (hMany : matchingCandidates P name refs = first :: second :: tail) :
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
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hPolicies hNames


theorem filter_empty_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (hNone : matchingCandidates P name refs = []) :
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
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hPolicies hNames

end Lovejoin.AnyTx.LogicCarrierVariable

#print axioms Lovejoin.AnyTx.LogicCarrierVariable.filter_exact
