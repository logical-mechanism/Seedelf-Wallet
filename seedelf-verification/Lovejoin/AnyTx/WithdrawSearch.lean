import Lovejoin.AnyTx.BoxSearch

/-! Kernel-checked induction over mix_box's compiled withdrawal-key search loop.
The target and every key/value are arbitrary Data; no bound on list length. -/
namespace Lovejoin.AnyTx.WithdrawSearch
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm templateBody)

def searchAt : List Nat :=
  [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1]

def searchSelf : Term := subterm templateBody searchAt
def searchLoop : Term := subterm templateBody (searchAt ++ [0])
def searchBody : Term := subterm templateBody (searchAt ++ [0,0])
theorem searchSelf_shape : searchSelf = .Lam searchLoop := rfl
theorem searchLoop_shape : searchLoop = .Lam searchBody := rfl

/-- Lexical environment immediately outside the recursive lambda; c-values are slots
that this loop does not read. -/
def searchEnv (target : Data)
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue)
    (rest : Environment) : Environment :=
  .VCon (.Data target) :: c27 :: c26 :: c25 :: c24 :: c23 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 :: c10 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) :: .VBuiltin .HeadList [] (.One .ArgV) ::
  .VBuiltin .TailList [] (.One .ArgV) :: c2 :: c1 :: c0 :: rest

def hasKey (target : Data) : List (Data × Data) → Bool
  | [] => false
  | (key, _) :: xs => if target = key then true else hasKey target xs

set_option maxHeartbeats 0

theorem search_empty (target : Data)
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue) (rest : Environment) :
    Ev default searchBody
      (.VCon (.ConstPairDataList []) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
      (some (.VCon (.Bool false))) := by cek_v3

theorem search_head (target value : Data) (xs : List (Data × Data))
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue) (rest : Environment) :
    Ev default searchBody
      (.VCon (.ConstPairDataList ((target, value) :: xs)) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
      (some (.VCon (.Bool true))) := by
  have eqt : PlutusCore.Data.equalsData target target = true := by simp [PlutusCore.Data.equalsData]
  cek_v3
  all_goals try simp only [PlutusCore.Pair.fstPair]
  all_goals try rw [eqt]
  cek_v3

theorem search_miss (target key value : Data) (xs : List (Data × Data))
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue) (rest : Environment)
    (h : target ≠ key)
    (ih : Ev default searchBody
      (.VCon (.ConstPairDataList xs) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
      (some (.VCon (.Bool (hasKey target xs))))) :
    Ev default searchBody
      (.VCon (.ConstPairDataList ((key, value) :: xs)) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
      (some (.VCon (.Bool (hasKey target xs)))) := by
  have eqf : PlutusCore.Data.equalsData target key = false := by simp [PlutusCore.Data.equalsData, h]
  cek_v3
  all_goals try simp only [PlutusCore.Pair.fstPair]
  all_goals try rw [eqf]
  cek_v3_using [ih]

theorem search_all (target : Data)
    (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue)
    (rest : Environment) (xs : List (Data × Data)) :
    Ev default searchBody
      (.VCon (.ConstPairDataList xs) ::
        .VLam searchLoop (searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
        searchEnv target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
      (some (.VCon (.Bool (hasKey target xs)))) := by
  induction xs with
  | nil => exact search_empty target c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest
  | cons x xs ih =>
    rcases x with ⟨key, value⟩
    by_cases h : target = key
    · subst key
      simpa [hasKey] using search_head target value xs c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest
    · simpa [hasKey, h] using search_miss target key value xs c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest h ih

/-- The loop's Boolean is exactly membership of the key, regardless of amount. -/
theorem hasKey_iff (target : Data) (xs : List (Data × Data)) :
    hasKey target xs = true ↔ ∃ value, (target, value) ∈ xs := by
  induction xs with
  | nil => simp [hasKey]
  | cons x xs ih =>
    rcases x with ⟨key, value⟩
    by_cases h : target = key
    · subst key
      simp [hasKey]
    · simp [hasKey, h, ih]

end Lovejoin.AnyTx.WithdrawSearch

#print axioms Lovejoin.AnyTx.WithdrawSearch.search_all
