import Lovejoin.AnyTx.LogicPolicyLookup

/-! The compiled carrier predicate's ordered NFT-name lookup. -/
namespace Lovejoin.AnyTx.LogicNameLookup
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def lookupAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,1,0,0,0,1]
def lookupLoop : Term := subterm templateBody (lookupAt ++ [0])
def lookupBody : Term := subterm templateBody (lookupAt ++ [0,0])

def lookupEnv (slots : Fin 25 → CekValue) (name : ByteString) (c11 c6 : CekValue)
    (delayRest rest : Environment) : Environment :=
  .VDelay (.Const (.Integer 0)) delayRest :: List.ofFn slots ++ .VCon (.ByteString name) :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def namePairs (xs : List (ByteString × Data)) : List (Data × Data) :=
  xs.map fun p => (.B p.1, p.2)
set_option maxHeartbeats 0

/-- Name entries that sort before the target are skipped. -/
theorem skip_before (slots : Fin 25 → CekValue) (name : ByteString) (c11 c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data)) (tail : List (Data × Data))
    (result : Option CekValue)
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hTail : Ev default lookupBody
      (.VCon (.ConstPairDataList tail) :: .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) ::
        lookupEnv slots name c11 c6 delayRest rest) result) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs xs ++ tail)) ::
        .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) :: lookupEnv slots name c11 c6 delayRest rest) result := by
  induction xs with
  | nil => simpa [namePairs] using hTail
  | cons pair xs ih =>
    rcases pair with ⟨key, value⟩
    have hKey := hBefore (key, value) (by simp)
    have hTailBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false := by
      intro pair hp
      exact hBefore pair (by simp [hp])
    have hi := ih hTailBefore
    simp only [namePairs, List.map_cons, List.cons_append]
    cek_v3_using [hi]
    all_goals try rw [hKey]
    cek_v3_using [hi]

/-- The target name returns its integer quantity, including zero or quantities
other than one. -/
theorem match_after_prefix (slots : Fin 25 → CekValue) (name : ByteString) (qty : Integer)
    (c11 c6 : CekValue) (delayRest rest : Environment) (before : List (ByteString × Data))
    (tail : List (Data × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString name name = true) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs before ++ (.B name, .I qty) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) :: lookupEnv slots name c11 c6 delayRest rest)
      (some (.VCon (.Integer qty))) := by
  apply skip_before slots name c11 c6 delayRest rest before ((.B name, .I qty) :: tail) _ hBefore
  have hEq : PlutusCore.ByteString.equalsByteString name name = true := by simp [PlutusCore.ByteString.equalsByteString]
  cek_v3
  all_goals try rw [hLe]
  cek_v3
  all_goals try rw [hEq]
  cek_v3

/-- No matching name in a list of earlier names returns quantity zero. -/
theorem all_before_returns_zero (slots : Fin 25 → CekValue) (name : ByteString) (c11 c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data))
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs xs)) ::
        .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) :: lookupEnv slots name c11 c6 delayRest rest)
      (some (.VCon (.Integer 0))) := by
  have h := skip_before slots name c11 c6 delayRest rest xs [] (some (.VCon (.Integer 0))) hBefore (by cek_v3)
  simpa using h

theorem match_after_prefix_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 : CekValue) (name : ByteString) (qty : Integer)
    (c11 c6 : CekValue) (delayRest rest : Environment) (before : List (ByteString × Data))
    (tail : List (Data × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString name name = true) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs before ++ (.B name, .I qty) :: tail)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest)
      (some (.VCon (.Integer qty))) := by
  simpa using match_after_prefix (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name qty c11 c6 delayRest rest before tail hBefore hLe

theorem all_before_returns_zero_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 : CekValue) (name : ByteString) (c11 c6 : CekValue)
    (delayRest rest : Environment) (xs : List (ByteString × Data))
    (hBefore : ∀ pair ∈ xs, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs xs)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest)
      (some (.VCon (.Integer 0))) := by
  simpa using all_before_returns_zero (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0)
    name c11 c6 delayRest rest xs hBefore

/-- A later nonmatching name terminates lookup with quantity zero; its value
and all entries after it are ignored. -/
theorem first_after_returns_zero (slots : Fin 25 → CekValue) (name key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c11 c6 : CekValue) (delayRest rest : Environment)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString name key = true)
    (hNe : PlutusCore.ByteString.equalsByteString name key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList ((.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) :: lookupEnv slots name c11 c6 delayRest rest)
      (some (.VCon (.Integer 0))) := by
  cek_v3
  all_goals try rw [hLe]
  cek_v3
  all_goals try rw [hNe]
  cek_v3

/-- A target name absent between the earlier prefix and a later key has quantity zero. -/
theorem absent_before_later (slots : Fin 25 → CekValue) (name key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c11 c6 : CekValue) (delayRest rest : Environment)
    (before : List (ByteString × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString name key = true)
    (hNe : PlutusCore.ByteString.equalsByteString name key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs before ++ (.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv slots name c11 c6 delayRest rest) :: lookupEnv slots name c11 c6 delayRest rest)
      (some (.VCon (.Integer 0))) := by
  apply skip_before slots name c11 c6 delayRest rest before ((.B key, value) :: tail) _ hBefore
  exact first_after_returns_zero slots name key value tail c11 c6 delayRest rest hLe hNe

theorem absent_before_later_slots (s0 s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 : CekValue) (name key : ByteString)
    (value : Data) (tail : List (Data × Data)) (c11 c6 : CekValue) (delayRest rest : Environment)
    (before : List (ByteString × Data))
    (hBefore : ∀ pair ∈ before, PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hLe : PlutusCore.ByteString.lessThanEqualsByteString name key = true)
    (hNe : PlutusCore.ByteString.equalsByteString name key = false) :
    Ev default lookupBody
      (.VCon (.ConstPairDataList (namePairs before ++ (.B key, value) :: tail)) ::
        .VLam lookupLoop (lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest) :: lookupEnv (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0) name c11 c6 delayRest rest)
      (some (.VCon (.Integer 0))) := by
  simpa using absent_before_later (fun i => ([s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24] : List CekValue).getD i.val s0)
    name key value tail c11 c6 delayRest rest before hBefore hLe hNe

end Lovejoin.AnyTx.LogicNameLookup

#print axioms Lovejoin.AnyTx.LogicNameLookup.match_after_prefix
#print axioms Lovejoin.AnyTx.LogicNameLookup.all_before_returns_zero
