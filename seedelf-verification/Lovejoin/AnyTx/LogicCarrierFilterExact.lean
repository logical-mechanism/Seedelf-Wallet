import Lovejoin.AnyTx.LogicCarrierPredicate

/-! Exact carrier filter over ordered asset-map prefixes and arbitrary quantities. -/
namespace Lovejoin.AnyTx.LogicCarrierFilterExact
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicReferenceFilter
open Lovejoin.AnyTx.LogicCarrierPredicate

abbrev Candidate := Data × Data × Data × Data × Integer

def candidateData (P name : ByteString) (beforePolicies beforeNames : List (ByteString × Data))
    (afterPolicies afterNames : List (Data × Data)) (item : Candidate) : Data :=
  quantityInput item.1 item.2.1 item.2.2.1 item.2.2.2.1 P name item.2.2.2.2
    beforePolicies beforeNames afterPolicies afterNames

def matchingCandidates (P name : ByteString) (beforePolicies beforeNames : List (ByteString × Data))
    (afterPolicies afterNames : List (Data × Data)) (xs : List Candidate) : List Data :=
  xs.filterMap fun item => if item.2.2.2.2 = 1 then
    some (candidateData P name beforePolicies beforeNames afterPolicies afterNames item) else none

set_option maxHeartbeats 0

/-- The compiled filter retains exactly candidates with target quantity one,
in their original order. -/
theorem filter_exact (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (xs : List Candidate) :
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default filterBody
      (.VCon (.ConstDataList (xs.map (candidateData P name beforePolicies beforeNames afterPolicies afterNames))) ::
        .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (matchingCandidates P name beforePolicies beforeNames afterPolicies afterNames xs)))) := by
  dsimp only
  induction xs with
  | nil => cek_v3
  | cons item xs ih =>
    rcases item with ⟨ref, addr, datum, script, qty⟩
    by_cases hQty : qty = 1
    · subst qty
      have hPred := quantity_checked top selector c72 c29 c28 c26 middle P name rest ref addr datum script 1
        beforePolicies beforeNames afterPolicies afterNames
        (xs.map (candidateData P name beforePolicies beforeNames afterPolicies afterNames))
        hSelect hPolicies hNames hP hN
      simp only [List.map_cons, matchingCandidates, List.filterMap_cons, candidateData]
      cek_v3_using [hPred, ih]
    · have hPred := quantity_ne_one top selector c72 c29 c28 c26 middle P name rest ref addr datum script qty
        beforePolicies beforeNames afterPolicies afterNames
        (xs.map (candidateData P name beforePolicies beforeNames afterPolicies afterNames))
        hSelect hPolicies hNames hP hN hQty
      simp only [List.map_cons, matchingCandidates, List.filterMap_cons, candidateData, if_neg hQty]
      cek_v3_using [hPred, ih]

theorem filter_two_or_more_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (first second : Data) (tail : List Data)
    (hMany : matchingCandidates P name beforePolicies beforeNames afterPolicies afterNames refs = first :: second :: tail) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P name beforePolicies beforeNames afterPolicies afterNames))) ::
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
    filter_exact top selector c72 c29 c28 c26 middle P name rest beforePolicies beforeNames afterPolicies afterNames hSelect hPolicies hNames hP hN refs

end Lovejoin.AnyTx.LogicCarrierFilterExact

#print axioms Lovejoin.AnyTx.LogicCarrierFilterExact.filter_exact

#print axioms Lovejoin.AnyTx.LogicCarrierFilterExact.filter_two_or_more_slots
