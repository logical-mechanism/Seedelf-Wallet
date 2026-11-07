import Lovejoin.Every.Collect

/-! # The helpers the withdrawals share

The list length (i_77, applied to itself as i_107), the pairwise check both withdrawals end in
(`pairs_match_and_all`, i_78), and the two scalar decoders (`scalar_from_bytes`, i_106, and
`scalar_from_bytes_mod`, i_80). -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-! ### Length -/

/-- `list.length`, as the compiled code adds it up. -/
def countOf : List Data → Integer
  | [] => 0
  | _ :: xs => PlutusCore.Integer.addInteger 1 (countOf xs)

def lenLoop : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,5,0]
def lenBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,5,0,0]

theorem lenLoop_shape : lenLoop = .Lam lenBody := rfl

set_option maxHeartbeats 0

theorem len_loop (σ : Environment) (hCL : List.get?Internal σ 17 = some vChooseList)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ev default lenBody (.VCon (.ConstDataList l) :: .VLam lenLoop σ :: σ)
      (some (.VCon (.Integer (countOf l)))) := by
  induction l with
  | nil => ev_go [] []
  | cons x xs ih => ev_go [ih] []

/-! ### Pairwise -/

/-- `pairs_match_and_all`: lists of the same length whose pairs all pass; the first failure
stops it, and an error in `f` is the script's. -/
def pairsAll (f : Data → Data → Option Bool) : List Data → List Data → Option Bool
  | [], [] => some true
  | [], _ :: _ => some false
  | _ :: _, [] => some false
  | x :: xs, y :: ys =>
    match f x y with
    | some true => pairsAll f xs ys
    | some false => some false
    | none => none

/-- `λ i_65 i_66. …`, the recursive closure i_63 holds once applied to itself. -/
def pairsLoop : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,6,0,0,0,1,
   0]
def pairsBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,6,0,0,0,1,
   0,0,0]

theorem pairsLoop_shape : pairsLoop = .Lam (.Lam pairsBody) := rfl

/-- The loop, for any two lists and a predicate `λ x y. …` given by what it returns. -/
theorem pairs_loop (σ σp : Environment) (predBody : Term) (f : Data → Data → Option Bool)
    (hPred : List.get?Internal σ 0 = some (.VLam (.Lam predBody) σp))
    (hf : ∀ x y : Data, Ev default predBody (.VCon (.Data y) :: .VCon (.Data x) :: σp)
      ((f x y).map fun b => .VCon (.Bool b)))
    (hIte : List.get?Internal σ 17 = some vIte) (hCL : List.get?Internal σ 20 = some vChooseList)
    (hMk : List.get?Internal σ 21 = some vMkCons)
    (hHead : List.get?Internal σ 22 = some vHead) (hTail : List.get?Internal σ 23 = some vTail)
    (xs ys : List Data) :
    Ev default pairsBody
      (.VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) :: .VLam pairsLoop σ :: σ)
      ((pairsAll f xs ys).map fun b => .VCon (.Bool b)) := by
  induction xs generalizing ys with
  | nil => cases ys <;> ev_go [] []
  | cons x xs ih =>
    cases ys with
    | nil => ev_go [] []
    | cons y ys =>
      cases hxy : f x y with
      | none =>
        simp only [pairsAll, hxy, Option.map_none]
        ev_go [hf] [hxy, Option.map_none]
      | some b =>
        cases b with
        | false =>
          simp only [pairsAll, hxy, Option.map_some]
          ev_go [hf] [hxy, Option.map_some]
        | true =>
          simp only [pairsAll, hxy]
          ev_go [hf, ih, values_nil_any] [hxy, Option.map_some]

/-- `pairs_match_and_all(xs, ys, pred)`'s body (i_78), which builds the loop and runs it. -/
def pairsEntry : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,6,0,0,0]

theorem pairs_apply (σ σp : Environment) (predBody : Term) (f : Data → Data → Option Bool)
    (hf : ∀ x y : Data, Ev default predBody (.VCon (.Data y) :: .VCon (.Data x) :: σp)
      ((f x y).map fun b => .VCon (.Bool b)))
    (hIte : List.get?Internal σ 14 = some vIte) (hCL : List.get?Internal σ 17 = some vChooseList)
    (hMk : List.get?Internal σ 18 = some vMkCons)
    (hHead : List.get?Internal σ 19 = some vHead) (hTail : List.get?Internal σ 20 = some vTail)
    (xs ys : List Data) :
    Ev default pairsEntry
      (.VLam (.Lam predBody) σp :: .VCon (.ConstDataList ys) :: .VCon (.ConstDataList xs) :: σ)
      ((pairsAll f xs ys).map fun b => .VCon (.Bool b)) := by
  ev_go [pairs_loop, hf, values_nil_any] []

/-- `lessThanEqualsInteger` at a result the proof has cased on. -/
theorem ap_lessThanEquals (v w : Integer) (b : Bool) (h : PlutusCore.Integer.lessThanEqualsInteger v w = b) :
    Ap default (.VBuiltin .LessThanEqualsInteger [.VCon (.Integer v)] (.One .ArgV)) (.VCon (.Integer w))
      (some (.VCon (.Bool b))) := by
  subst h
  exact ap_builtin rfl

/-! ### Scalars -/

/-- BLS12-381's scalar field order, as the program holds it. -/
abbrev q : Integer := Lovejoin.Classic.q

/-- `scalar_from_bytes` (i_106): 32 bytes, as a big-endian integer below `q`, reduced; else an
error. -/
def scalarOf (z : ByteString) : Option Integer :=
  if PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString z) then
    if PlutusCore.Integer.lessThanInteger (.ofNat (byteStringToIntegerOpaque true z.data)) q then
      some (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q)
    else none
  else none

/-- `scalar_from_bytes_mod` (i_80): any bytes, reduced. -/
def scalarMod (c : ByteString) : Integer := Int.fmod (.ofNat (byteStringToIntegerOpaque true c.data)) q

def scalarBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,0,1,0]
def scalarModBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,8,0]

/-- `lessThanInteger` at a result the proof has cased on. The machine would otherwise hand a
symbolic `v < q` to `ifThenElse`, and deciding that by reduction unfolds the subtraction from
`q` one unit at a time. -/
theorem ap_lessThan (v w : Integer) (b : Bool) (h : PlutusCore.Integer.lessThanInteger v w = b) :
    Ap default (.VBuiltin .LessThanInteger [.VCon (.Integer v)] (.One .ArgV)) (.VCon (.Integer w))
      (some (.VCon (.Bool b))) := by
  subst h
  exact ap_builtin rfl

theorem scalar_ap (σ : Environment) (h79 : List.get?Internal σ 2 = some (vEq 32))
    (hIte : List.get?Internal σ 24 = some vIte) (z : ByteString) :
    Ap default (.VLam scalarBody σ) (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)) := by
  apply ap_lam
  simp only [scalarOf]
  cases h32 : PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString z)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    ev_go [] [h32]
  · cases hlt : PlutusCore.Integer.lessThanInteger (.ofNat (byteStringToIntegerOpaque true z.data)) q
    · have hL := ap_lessThan _ _ _ hlt
      clear hlt
      ev_go [hL] [h32]
    · have hL := ap_lessThan _ _ _ hlt
      clear hlt
      ev_go [hL] [h32]

theorem scalarMod_ap (σ : Environment) (c : ByteString) :
    Ap default (.VLam scalarModBody σ) (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))) := by
  apply ap_lam
  ev_using []

end Lovejoin.Every
