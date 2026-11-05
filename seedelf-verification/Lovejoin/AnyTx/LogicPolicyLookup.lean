import Lovejoin.AnyTx.LogicReferenceFilter

/-! The compiled carrier predicate's ordered policy-map lookup. -/
namespace Lovejoin.AnyTx.LogicPolicyLookup
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def lookupAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,1,0,0,1,0,0,1]
def lookupLoop : Term := subterm templateBody (lookupAt ++ [0])
def lookupBody : Term := subterm templateBody (lookupAt ++ [0,0])

def lookupEnv (slots : Fin 27 → CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) : Environment :=
  .VDelay (.Const (.ConstPairDataList [])) delayRest :: List.ofFn slots ++ .VCon (.ByteString P) ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def policyPairs (xs : List (ByteString × Data)) : List (Data × Data) :=
  xs.map fun p => (.B p.1, p.2)

set_option maxHeartbeats 0

/-- If every encountered policy sorts before P, lookup returns an empty map,
for an arbitrary number of entries and arbitrary associated data. -/
theorem all_before_returns_empty (slots : Fin 27 → CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data))
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs xs)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList []))) := by
  induction xs with
  | nil => cek_v3
  | cons pair xs ih =>
    rcases pair with ⟨key, value⟩
    have hKey := hBefore (key, value) (by simp)
    have hTail : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false := by
      intro pair hp
      exact hBefore pair (by simp [hp])
    have hi := ih hTail
    simp only [policyPairs, List.map_cons]
    cek_v3_using [hi]
    all_goals try rw [hKey]
    cek_v3_using [hi]

/-- Lookup stops at a policy after the target and returns no names, without
examining any later map entries. -/
theorem first_after_returns_empty (slots : Fin 27 → CekValue) (P key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c6 : CekValue) (delayRest rest : Environment)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P key = true)
    (hNe : PlutusCore.ByteString.equalsByteString P key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList ((.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList []))) := by
  cek_v3
  all_goals try rw [hLe]
  cek_v3
  all_goals try rw [hNe]
  cek_v3

/-- At the target policy, lookup returns that policy's complete name map. -/
theorem first_match_returns_names (slots : Fin 27 → CekValue) (P : ByteString)
    (names tail : List (Data × Data)) (c6 : CekValue) (delayRest rest : Environment)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P P = true) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList ((.B P, .Map names) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList names))) := by
  have hEq : PlutusCore.ByteString.equalsByteString P P = true := by simp [PlutusCore.ByteString.equalsByteString]
  cek_v3
  all_goals try rw [hLe]
  cek_v3
  all_goals try rw [hEq]
  cek_v3

/-- Earlier policies are skipped and cannot change the result of the remaining lookup. -/
theorem skip_before (slots : Fin 27 → CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data)) (tail : List (Data × Data))
    (result : Option CekValue)
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hTail : Ev default lookupBody
      (.VCon (.ConstPairDataList tail) :: .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) ::
        lookupEnv slots P c6 delayRest rest) result) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs xs ++ tail)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest) result := by
  induction xs with
  | nil => simpa [policyPairs] using hTail
  | cons pair xs ih =>
    rcases pair with ⟨key, value⟩
    have hKey := hBefore (key, value) (by simp)
    have hBeforeTail : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false := by
      intro pair hp
      exact hBefore pair (by simp [hp])
    have hi := ih hBeforeTail
    simp only [policyPairs, List.map_cons, List.cons_append]
    cek_v3_using [hi]
    all_goals try rw [hKey]
    cek_v3_using [hi]

/-- A matching policy is found after any number of earlier policies. -/
theorem match_after_prefix (slots : Fin 27 → CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) (before : List (ByteString × Data)) (names tail : List (Data × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P P = true) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs before ++ (.B P, .Map names) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList names))) := by
  apply skip_before slots P c6 delayRest rest before ((.B P, .Map names) :: tail) _ hBefore
  exact first_match_returns_names slots P names tail c6 delayRest rest hLe

theorem match_after_prefix_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 : CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) (before : List (ByteString × Data)) (names tail : List (Data × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P P = true) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs before ++ (.B P, .Map names) :: tail)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList names))) := by
  simpa using match_after_prefix (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest before names tail hBefore hLe

theorem all_before_returns_empty_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 : CekValue) (P : ByteString) (c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data))
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs xs)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList []))) := by
  simpa using all_before_returns_empty (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0)
    P c6 delayRest rest xs hBefore

/-- A policy absent between the earlier prefix and a later key has no name map. -/
theorem absent_before_later (slots : Fin 27 → CekValue) (P key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c6 : CekValue) (delayRest rest : Environment)
    (before : List (ByteString × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P key = true)
    (hNe : PlutusCore.ByteString.equalsByteString P key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs before ++ (.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots P c6 delayRest rest) :: lookupEnv slots P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList []))) := by
  apply skip_before slots P c6 delayRest rest before ((.B key, value) :: tail) _ hBefore
  exact first_after_returns_empty slots P key value tail c6 delayRest rest hLe hNe

theorem absent_before_later_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 : CekValue) (P key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c6 : CekValue) (delayRest rest : Environment)
    (before : List (ByteString × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString P key = true)
    (hNe : PlutusCore.ByteString.equalsByteString P key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (policyPairs before ++ (.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0) P c6 delayRest rest)
      (some (.VCon (.ConstPairDataList []))) := by
  simpa using absent_before_later (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26] : List CekValue).getD i.val s0)
    P key value tail c6 delayRest rest before hBefore hLe hNe

end Lovejoin.AnyTx.LogicPolicyLookup

#print axioms Lovejoin.AnyTx.LogicPolicyLookup.all_before_returns_empty

#print axioms Lovejoin.AnyTx.LogicPolicyLookup.first_after_returns_empty
#print axioms Lovejoin.AnyTx.LogicPolicyLookup.first_match_returns_names

#print axioms Lovejoin.AnyTx.LogicPolicyLookup.match_after_prefix
