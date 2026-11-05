import Lovejoin.AnyTx.LogicNameLookup

/-! The compiled carrier test with general ordered policy and token-name prefixes. -/
namespace Lovejoin.AnyTx.LogicCarrierPredicate
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (inputData)
open Lovejoin.AnyTx.LogicReferenceFilter

/-- A reference input with a target policy and name, after arbitrary earlier
entries in the two ordered asset maps. -/
def quantityInput (ref addr datum script : Data) (P name : ByteString) (qty : Integer)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data)) : Data :=
  inputData ref (.Constr 0 [addr, .Map (LogicPolicyLookup.policyPairs beforePolicies ++
    (.B P, .Map (LogicNameLookup.namePairs beforeNames ++ (.B name, .I qty) :: afterNames)) :: afterPolicies), datum, script])

set_option maxHeartbeats 0

/-- The compiled carrier predicate rejects a target NFT with quantity other
than one, even after arbitrarily many earlier policies and names. -/
theorem quantity_ne_one (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (ref addr datum script : Data) (qty : Integer)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (tail : List Data)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (hQty : qty ≠ 1) :
    let item := quantityInput ref addr datum script P name qty beforePolicies beforeNames afterPolicies afterNames
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default carrierPredicate
      (.VCon (.ConstDataList tail) :: .VCon (.Data item) :: .VCon (.ConstDataList (item :: tail)) ::
        .VLam filterLoop env :: env) (some (.VCon (.Bool false))) := by
  dsimp only
  have he : PlutusCore.Integer.equalsInteger 1 qty = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hQty]
  cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.match_after_prefix_slots, hSelect]
  all_goals try assumption
  all_goals try rw [he]
  all_goals try cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.match_after_prefix_slots, hSelect]
  all_goals try assumption
  all_goals try rw [he]
  all_goals try cek_v3
  apply ap_builtin
  change (some (.VCon (.Bool (PlutusCore.Integer.equalsInteger 1 qty))) : Option CekValue) = _
  rw [he]

/-- The predicate returns exactly whether the discovered quantity equals one. -/
theorem quantity_checked (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (ref addr datum script : Data) (qty : Integer)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (tail : List Data)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true) :
    let item := quantityInput ref addr datum script P name qty beforePolicies beforeNames afterPolicies afterNames
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default carrierPredicate
      (.VCon (.ConstDataList tail) :: .VCon (.Data item) :: .VCon (.ConstDataList (item :: tail)) ::
        .VLam filterLoop env :: env) (some (.VCon (.Bool (PlutusCore.Integer.equalsInteger 1 qty)))) := by
  dsimp only
  cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.match_after_prefix_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.match_after_prefix_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3

/-- Any number of these reference inputs are filtered out when each target
quantity differs from one. Uninspected addresses, datum, scripts and map suffixes
are arbitrary. -/
theorem filter_quantities_ne_one (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer))
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    let items := refs.map fun (ref, addr, datum, script, qty) =>
      quantityInput ref addr datum script P name qty beforePolicies beforeNames afterPolicies afterNames
    Ev default filterBody
      (.VCon (.ConstDataList items) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList []))) := by
  dsimp only
  apply filter_no_carriers
  intro x hx tail
  obtain ⟨item, hi, rfl⟩ := List.mem_map.mp hx
  rcases item with ⟨ref, addr, datum, script, qty⟩
  exact quantity_ne_one top selector c72 c29 c28 c26 middle P name rest ref addr datum script qty
    beforePolicies beforeNames afterPolicies afterNames tail hSelect hPolicies hNames hP hN (hQty _ hi)

theorem filter_quantities_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies afterNames : List (Data × Data))
    (refs : List (Data × Data × Data × Data × Integer))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (hQty : ∀ item ∈ refs, item.2.2.2.2 ≠ 1) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map fun (ref, addr, datum, script, qty) => quantityInput ref addr datum script P name qty beforePolicies beforeNames afterPolicies afterNames)) ::
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
  simpa [filterEnv, top, middle, List.ofFn] using
    filter_quantities_ne_one top selector c72 c29 c28 c26 middle P name rest beforePolicies beforeNames afterPolicies afterNames refs hSelect hPolicies hNames hP hN hQty

end Lovejoin.AnyTx.LogicCarrierPredicate

#print axioms Lovejoin.AnyTx.LogicCarrierPredicate.quantity_checked

#print axioms Lovejoin.AnyTx.LogicCarrierPredicate.filter_quantities_ne_one
