import Lovejoin.AnyTx.LogicLength

/-! The compiled pairwise proof-checking loop shared by Owner and Mix. -/
namespace Lovejoin.AnyTx.LogicProofPairs
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b

/-- The third recursive lambda of the actual generic pair-checker. -/
def pairAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,6,0,0,0,1]
def pairSelf : Term := subterm templateBody pairAt
def pairLoop : Term := subterm templateBody (pairAt ++ [0])
def pairLoopTwo : Term := subterm templateBody (pairAt ++ [0,0])
def pairBody : Term := subterm templateBody (pairAt ++ [0,0,0])
def wrapperAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,6]
def wrapperBody : Term := subterm templateBody (wrapperAt ++ [0,0,0])

theorem self_shape : pairSelf = .Lam pairLoop := rfl
theorem loop_shape : pairLoop = .Lam pairLoopTwo := rfl
theorem loop_two_shape : pairLoopTwo = .Lam pairBody := rfl

/-- The verifier closure, unused entries and list-control builtins in scope. -/
def pairEnv (pred : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 : CekValue)
    (c9 c8 c3 c2 c1 c0 : CekValue) (rest : Environment) : Environment :=
  pred :: c61 :: c60 :: c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
  c3 :: c2 :: c1 :: c0 :: rest

def allPairs (pred : Data → Data → Bool) : List Data → List Data → Bool
  | [], [] => true
  | a :: as, b :: bs => pred a b && allPairs pred as bs
  | _, _ => false

/-- Pair checking with an explicit error result, including verifier errors. -/
def allPairsPartial (check : Data → Data → Option Bool) : List Data → List Data → Option Bool
  | [], [] => some true
  | a :: as, b :: bs =>
    match check a b with
    | none => none
    | some false => some false
    | some true => allPairsPartial check as bs
  | _, _ => some false

/-- The pairwise boolean enforces equal lengths and every aligned check. -/
theorem allPairs_true_iff (check : Data → Data → Bool) (xs ys : List Data) :
    allPairs check xs ys = true ↔
      xs.length = ys.length ∧ ∀ pair ∈ xs.zip ys, check pair.1 pair.2 = true := by
  induction xs generalizing ys with
  | nil => cases ys <;> simp [allPairs, List.zip]
  | cons a as ih =>
    cases ys with
    | nil => simp [allPairs, List.zip]
    | cons b bs => simp [allPairs, List.zip, ih, and_assoc, and_left_comm, and_comm]

set_option maxHeartbeats 0

theorem pair_nil_nil (pred : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList []) :: .VCon (.ConstDataList []) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool true))) := by
  dsimp only
  cek_v3

theorem pair_nil_cons (pred : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (b : Data) (bs : List Data) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList (b :: bs)) :: .VCon (.ConstDataList []) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool false))) := by
  dsimp only
  cek_v3

theorem pair_cons_nil (pred : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (a : Data) (as : List Data) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList []) :: .VCon (.ConstDataList (a :: as)) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool false))) := by
  dsimp only
  cek_v3

/-- A successful pair check recurses on the remaining two lists. -/
theorem pair_cons_true (pred next : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (a b : Data) (as bs : List Data) (result : Bool)
    (hFirst : Ap default pred (.VCon (.Data a)) (some next))
    (hSecond : Ap default next (.VCon (.Data b)) (some (.VCon (.Bool true))))
    (hTail : let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
      Ev default pairBody
        (.VCon (.ConstDataList bs) :: .VCon (.ConstDataList as) :: .VLam pairLoop env :: env)
        (some (.VCon (.Bool result)))) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList (b :: bs)) :: .VCon (.ConstDataList (a :: as)) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool result))) := by
  dsimp only at *
  cek_v3_using [hFirst, hSecond, hTail]

/-- A failed pair check stops the loop and returns false. -/
theorem pair_cons_false (pred next : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (a b : Data) (as bs : List Data)
    (hFirst : Ap default pred (.VCon (.Data a)) (some next))
    (hSecond : Ap default next (.VCon (.Data b)) (some (.VCon (.Bool false)))) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList (b :: bs)) :: .VCon (.ConstDataList (a :: as)) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool false))) := by
  dsimp only
  cek_v3_using [hFirst, hSecond]

/-- A verifier error propagates as an error from the pair loop. -/
theorem pair_cons_error (pred next : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (a b : Data) (as bs : List Data)
    (hFirst : Ap default pred (.VCon (.Data a)) (some next))
    (hSecond : Ap default next (.VCon (.Data b)) none) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList (b :: bs)) :: .VCon (.ConstDataList (a :: as)) :: .VLam pairLoop env :: env)
      none := by
  dsimp only
  cek_v3_using [hFirst, hSecond]

theorem pair_cons_true_tail_error (pred next : CekValue) (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (a b : Data) (as bs : List Data)
    (hFirst : Ap default pred (.VCon (.Data a)) (some next))
    (hSecond : Ap default next (.VCon (.Data b)) (some (.VCon (.Bool true))))
    (hTail : let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
      Ev default pairBody
        (.VCon (.ConstDataList bs) :: .VCon (.ConstDataList as) :: .VLam pairLoop env :: env) none) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList (b :: bs)) :: .VCon (.ConstDataList (a :: as)) :: .VLam pairLoop env :: env) none := by
  dsimp only at *
  cek_v3_using [hFirst, hSecond, hTail]

/-- For any two lists and any terminating boolean verifier, the compiled loop
returns true exactly when the lists have equal length and every aligned pair
passes that verifier. The hypotheses describe the supplied verifier closure;
they do not yet identify it with Owner or Mix's cryptographic checks. -/
theorem pair_all (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Bool)
    (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (hSecond : ∀ a b, Ap default (next a) (.VCon (.Data b)) (some (.VCon (.Bool (check a b)))))
    (xs ys : List Data) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) :: .VLam pairLoop env :: env)
      (some (.VCon (.Bool (allPairs check xs ys)))) := by
  induction xs generalizing ys with
  | nil =>
    cases ys with
    | nil => exact pair_nil_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    | cons b bs => exact pair_nil_cons pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest b bs
  | cons a as ih =>
    cases ys with
    | nil => exact pair_cons_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a as
    | cons b bs =>
      cases hc : check a b with
      | false =>
        simpa [allPairs, hc] using pair_cons_false pred (next a)
          c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
          (hFirst a) (by simpa [hc] using hSecond a b)
      | true =>
        simpa [allPairs, hc] using pair_cons_true pred (next a)
          c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
          (allPairs check as bs) (hFirst a) (by simpa [hc] using hSecond a b) (ih bs)

/-- The compiled wrapper passes its two lists and verifier into the recursive
pair checker. This establishes the same unbounded rule at its call boundary. -/
theorem wrapper_all (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Bool)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (hSecond : ∀ a b, Ap default (next a) (.VCon (.Data b)) (some (.VCon (.Bool (check a b)))))
    (xs ys : List Data) :
    Ev default wrapperBody
      (pred :: .VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) ::
        c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
        .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
        .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
        .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
        .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
        c3 :: c2 :: c1 :: c0 :: rest)
      (some (.VCon (.Bool (allPairs check xs ys)))) := by
  have hLoop := pair_all pred next check (.VCon (.ConstDataList ys)) (.VCon (.ConstDataList xs))
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest hFirst hSecond xs ys
  cek_v3_using [hLoop]

/-- Unbounded pair checking also preserves verifier errors, without assuming
that invalid points or malformed proofs return a boolean. -/
theorem pair_all_partial (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Option Bool)
    (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (hSecond : ∀ a b, Ap default (next a) (.VCon (.Data b))
      ((check a b).map fun result => .VCon (.Bool result)))
    (xs ys : List Data) :
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) :: .VLam pairLoop env :: env)
      ((allPairsPartial check xs ys).map fun result => .VCon (.Bool result)) := by
  induction xs generalizing ys with
  | nil =>
    cases ys with
    | nil => exact pair_nil_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    | cons b bs => exact pair_nil_cons pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest b bs
  | cons a as ih =>
    cases ys with
    | nil => exact pair_cons_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a as
    | cons b bs =>
      cases hc : check a b with
      | none =>
        simpa [allPairsPartial, hc] using pair_cons_error pred (next a)
          c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
          (hFirst a) (by simpa [hc] using hSecond a b)
      | some flag =>
        cases flag with
        | false =>
          simpa [allPairsPartial, hc] using pair_cons_false pred (next a)
            c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
            (hFirst a) (by simpa [hc] using hSecond a b)
        | true =>
          cases ht : allPairsPartial check as bs with
          | none =>
            simpa [allPairsPartial, hc, ht] using pair_cons_true_tail_error pred (next a)
              c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
              (hFirst a) (by simpa [hc] using hSecond a b) (by simpa [ht] using ih bs)
          | some result =>
            simpa [allPairsPartial, hc, ht] using pair_cons_true pred (next a)
              c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
              result (hFirst a) (by simpa [hc] using hSecond a b) (by simpa [ht] using ih bs)

/-- The pair loop only needs a verifier result for aligned pairs that actually
occur; other inputs may be malformed or outside the verifier's domain. -/
theorem pair_all_aligned (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Option Bool)
    (c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (xs ys : List Data) :
    (∀ a b, (a, b) ∈ xs.zip ys → Ap default (next a) (.VCon (.Data b))
      ((check a b).map fun result => .VCon (.Bool result))) →
    let env := pairEnv pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    Ev default pairBody
      (.VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) :: .VLam pairLoop env :: env)
      ((allPairsPartial check xs ys).map fun result => .VCon (.Bool result)) := by
  induction xs generalizing ys with
  | nil =>
    intro _
    cases ys with
    | nil => exact pair_nil_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
    | cons b bs => exact pair_nil_cons pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest b bs
  | cons a as ih =>
    intro hSecond
    cases ys with
    | nil => exact pair_cons_nil pred c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a as
    | cons b bs =>
      have hh := hSecond a b (by simp)
      have hTail : ∀ x y, (x, y) ∈ as.zip bs → Ap default (next x) (.VCon (.Data y))
          ((check x y).map fun result => .VCon (.Bool result)) := by
        intro x y h
        exact hSecond x y (by simp [h])
      cases hc : check a b with
      | none =>
        simpa [allPairsPartial, hc] using pair_cons_error pred (next a)
          c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
          (hFirst a) (by simpa [hc] using hh)
      | some flag =>
        cases flag with
        | false =>
          simpa [allPairsPartial, hc] using pair_cons_false pred (next a)
            c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
            (hFirst a) (by simpa [hc] using hh)
        | true =>
          cases ht : allPairsPartial check as bs with
          | none =>
            simpa [allPairsPartial, hc, ht] using pair_cons_true_tail_error pred (next a)
              c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
              (hFirst a) (by simpa [hc] using hh) (by simpa [ht] using ih bs hTail)
          | some result =>
            simpa [allPairsPartial, hc, ht] using pair_cons_true pred (next a)
              c61 c60 c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest a b as bs
              result (hFirst a) (by simpa [hc] using hh) (by simpa [ht] using ih bs hTail)

/-- Partial-verifier version of the compiled call boundary. -/
theorem wrapper_all_partial (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Option Bool)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (hSecond : ∀ a b, Ap default (next a) (.VCon (.Data b))
      ((check a b).map fun result => .VCon (.Bool result)))
    (xs ys : List Data) :
    Ev default wrapperBody
      (pred :: .VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) ::
        c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
        .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
        .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
        .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
        .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
        c3 :: c2 :: c1 :: c0 :: rest)
      ((allPairsPartial check xs ys).map fun result => .VCon (.Bool result)) := by
  have hLoop := pair_all_partial pred next check (.VCon (.ConstDataList ys)) (.VCon (.ConstDataList xs))
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest hFirst hSecond xs ys
  cek_v3_using [hLoop]
  cases allPairsPartial check xs ys with
  | none => exact values_none
  | some flag => exact values_nil

/-- The compiled call boundary, assuming verifier results only for actual
aligned inputs and proofs. -/
theorem wrapper_all_aligned (pred : CekValue) (next : Data → CekValue) (check : Data → Data → Option Bool)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment)
    (hFirst : ∀ a, Ap default pred (.VCon (.Data a)) (some (next a)))
    (xs ys : List Data)
    (hSecond : ∀ a b, (a, b) ∈ xs.zip ys → Ap default (next a) (.VCon (.Data b))
      ((check a b).map fun result => .VCon (.Bool result))) :
    Ev default wrapperBody
      (pred :: .VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) ::
        c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
        .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
        .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
        .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
        .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
        c3 :: c2 :: c1 :: c0 :: rest)
      ((allPairsPartial check xs ys).map fun result => .VCon (.Bool result)) := by
  have hLoop := pair_all_aligned pred next check (.VCon (.ConstDataList ys)) (.VCon (.ConstDataList xs))
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest hFirst xs ys hSecond
  cek_v3_using [hLoop]
  cases allPairsPartial check xs ys with
  | none => exact values_none
  | some flag => exact values_nil

/-- Successful pair checking means equal lengths and success of every
corresponding verifier call, including calls that can error. -/
theorem allPairsPartial_true_iff (check : Data → Data → Option Bool) (xs ys : List Data) :
    allPairsPartial check xs ys = some true ↔
      xs.length = ys.length ∧ ∀ pair ∈ xs.zip ys, check pair.1 pair.2 = some true := by
  induction xs generalizing ys with
  | nil => cases ys <;> simp [allPairsPartial, List.zip]
  | cons a as ih =>
    cases ys with
    | nil => simp [allPairsPartial, List.zip]
    | cons b bs =>
      cases h : check a b with
      | none => simp [allPairsPartial, List.zip, h]
      | some flag => cases flag <;> simp [allPairsPartial, List.zip, h, ih, and_assoc, and_left_comm, and_comm]

/-- Determinism prevents a CEK computation from both returning false and true. -/
theorem ev_bool_unique (body : Term) (env : Environment) (a b : Bool)
    (ha : Ev default body env (some (.VCon (.Bool a))))
    (hb : Ev default body env (some (.VCon (.Bool b)))) : a = b := by
  obtain ⟨na, hna⟩ := ha.run []
  obtain ⟨nb, hnb⟩ := hb.run []
  have hA : stepN default (.Eval [] env body) (na + 1) = .Halt (.VCon (.Bool a)) := by
    rw [stepN_add, hna]
    rfl
  have hB : stepN default (.Eval [] env body) (nb + 1) = .Halt (.VCon (.Bool b)) := by
    rw [stepN_add, hnb]
    rfl
  rcases Nat.le_total (na + 1) (nb + 1) with hle | hle
  · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
    rw [hk, stepN_fix default _ _ (Or.inl ⟨_, hA⟩), hA] at hB
    cases hB
    rfl
  · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
    rw [hk, stepN_fix default _ _ (Or.inl ⟨_, hB⟩), hB] at hA
    cases hA
    rfl

/-- When a partial modeled computation and the actual execution both finish,
an actual true result forces the modeled result to be true. -/
theorem ev_true_of_model (body : Term) (env : Environment) (result : Option Bool)
    (hModel : Ev default body env (result.map fun b => .VCon (.Bool b)))
    (hTrue : Ev default body env (some (.VCon (.Bool true)))) : result = some true := by
  cases result with
  | none =>
    obtain ⟨n, hn⟩ := hModel.run []
    obtain ⟨m, hm⟩ := hTrue.run []
    have ht : stepN default (.Eval [] env body) (m + 1) = .Halt (.VCon (.Bool true)) := by
      rw [stepN_add, hm]
      rfl
    exact False.elim ((stepN_ne_halt_of_error hn (m + 1) (.VCon (.Bool true))) ht)
  | some value =>
    have he := ev_bool_unique body env value true hModel hTrue
    cases he
    rfl

end Lovejoin.AnyTx.LogicProofPairs

/-- info: 'Lovejoin.AnyTx.LogicProofPairs.pair_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofPairs.pair_all
/-- info: 'Lovejoin.AnyTx.LogicProofPairs.wrapper_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofPairs.wrapper_all
/-- info: 'Lovejoin.AnyTx.LogicProofPairs.pair_all_partial' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofPairs.pair_all_partial
/-- info: 'Lovejoin.AnyTx.LogicProofPairs.wrapper_all_partial' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicProofPairs.wrapper_all_partial
