import Lovejoin.AnyTx.LogicCarrierPredicate

/-! The compiled carrier predicate when the target asset name is absent. -/
namespace Lovejoin.AnyTx.LogicAbsentName
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (inputData)
open Lovejoin.AnyTx.LogicReferenceFilter

def absentNameInput (ref addr datum script : Data) (P : ByteString)
    (beforePolicies beforeNames : List (ByteString × Data)) (afterPolicies : List (Data × Data)) : Data :=
  inputData ref (.Constr 0 [addr, .Map (LogicPolicyLookup.policyPairs beforePolicies ++
    (.B P, .Map (LogicNameLookup.namePairs beforeNames)) :: afterPolicies), datum, script])

set_option maxHeartbeats 0

/-- If all names under P sort before the target name, the carrier test rejects
this input, regardless of the number of earlier policies and names. -/
theorem predicate_rejects (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (ref addr datum script : Data) (beforePolicies beforeNames : List (ByteString × Data))
    (afterPolicies : List (Data × Data)) (tail : List Data)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ pair ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true) :
    let item := absentNameInput ref addr datum script P beforePolicies beforeNames afterPolicies
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default carrierPredicate
      (.VCon (.ConstDataList tail) :: .VCon (.Data item) :: .VCon (.ConstDataList (item :: tail)) ::
        .VLam filterLoop env :: env) (some (.VCon (.Bool false))) := by
  dsimp only
  cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.all_before_returns_zero_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3_using [LogicPolicyLookup.match_after_prefix_slots, LogicNameLookup.all_before_returns_zero_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3

/-- Each input may have independently varying earlier policy and asset-name entries. -/
structure Candidate where
  ref : Data
  addr : Data
  datum : Data
  script : Data
  beforePolicies : List (ByteString × Data)
  beforeNames : List (ByteString × Data)
  afterPolicies : List (Data × Data)

def candidateData (P : ByteString) (c : Candidate) : Data :=
  absentNameInput c.ref c.addr c.datum c.script P c.beforePolicies c.beforeNames c.afterPolicies

/-- Filtering any number of absent-name inputs returns no carriers. -/
theorem filter_none (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (xs : List Candidate)
    (hPolicies : ∀ item ∈ xs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ xs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default filterBody (.VCon (.ConstDataList (xs.map (candidateData P))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList []))) := by
  dsimp only
  apply filter_no_carriers
  intro x hx tail
  obtain ⟨item, hi, rfl⟩ := List.mem_map.mp hx
  exact predicate_rejects top selector c72 c29 c28 c26 middle P name rest
    item.ref item.addr item.datum item.script item.beforePolicies item.beforeNames item.afterPolicies tail
    hSelect (hPolicies item hi) (hNames item hi) hP

theorem filter_none_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P))) ::
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
    filter_none top selector c72 c29 c28 c26 middle P name rest hSelect hP refs hPolicies hNames

end Lovejoin.AnyTx.LogicAbsentName

#print axioms Lovejoin.AnyTx.LogicAbsentName.predicate_rejects

#print axioms Lovejoin.AnyTx.LogicAbsentName.filter_none
