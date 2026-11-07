import Lovejoin.Every.Base

/-! # The pool NFT's quantity in a value

`quantity_of(value, P, name)` compiles to two ordered searches (`i_243` over the policies,
`i_238` over the policy's names). Each stops at the first key that isn't below its target:
the entry if it is the target, nothing if it's past it. So on a sorted map, the ledger's own,
it's the quantity; on any other, it's what these searches find. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-- The policy search: the first key not below `pb`; its map if it is `pb`, the empty map if
it's past. A key that isn't bytes, or a found entry that isn't a map, is an error. -/
def policyEntry (pb : ByteString) : List (Data × Data) → Option (List (Data × Data))
  | [] => some []
  | (k, v) :: rest =>
    match k with
    | .B kb =>
      if PlutusCore.ByteString.lessThanEqualsByteString pb kb then
        if PlutusCore.ByteString.equalsByteString pb kb then
          match v with
          | .Map m => some m
          | _ => none
        else some []
      else policyEntry pb rest
    | _ => none

def policyAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,1,0,0,1,0,0,1]
/-- `λ i_245. …`: the closure i_243 holds. -/
def policyLoop : Term := sub (policyAt ++ [0])
/-- The search's body, for one map. -/
def policyBody : Term := sub (policyAt ++ [0, 0])

theorem policyLoop_shape : policyLoop = .Lam policyBody := rfl

set_option maxHeartbeats 0

theorem policy_search (ρ σ : Environment) (P : ByteString)
    (h0 : List.get?Internal ρ 0 = some (.VDelay (.Const (.ConstPairDataList [])) σ))
    (hP : List.get?Internal ρ 28 = some (.VCon (.ByteString P)))
    (hIte : List.get?Internal ρ 29 = some vIte) (hFst : List.get?Internal ρ 30 = some vFst)
    (hSnd : List.get?Internal ρ 31 = some vSnd) (hCL : List.get?Internal ρ 32 = some vChooseList)
    (hHead : List.get?Internal ρ 34 = some vHead) (hTail : List.get?Internal ρ 35 = some vTail)
    (xs : List (Data × Data)) :
    Ev default policyBody (.VCon (.ConstPairDataList xs) :: .VLam policyLoop ρ :: ρ)
      ((policyEntry P xs).map fun m => .VCon (.ConstPairDataList m)) := by
  induction xs with
  | nil =>
    ev_using []
  | cons x xs ih =>
    rcases x with ⟨k, v⟩
    cases k with
    | B kb =>
      simp only [policyEntry]
      cases hle : PlutusCore.ByteString.lessThanEqualsByteString P kb
      · simp only [Bool.false_eq_true, ↓reduceIte]
        ev_go [ih] [hle]
      · cases heq : PlutusCore.ByteString.equalsByteString P kb
        · simp only [Bool.false_eq_true, ↓reduceIte]
          ev_go [] [hle, heq]
        · simp only [↓reduceIte]
          cases v <;> ev_go [] [hle, heq]
    | _ => simp only [policyEntry]; ev_go [] []

/-- The name search, in the policy's map: the first key not below `nb`; its quantity if it is
`nb`, 0 if it's past. A key that isn't bytes, or a found quantity that isn't an integer, is an
error. -/
def nameEntry (nb : ByteString) : List (Data × Data) → Option Integer
  | [] => some 0
  | (k, v) :: rest =>
    match k with
    | .B kb =>
      if PlutusCore.ByteString.lessThanEqualsByteString nb kb then
        if PlutusCore.ByteString.equalsByteString nb kb then
          match v with
          | .I i => some i
          | _ => none
        else some 0
      else nameEntry nb rest
    | _ => none

def nameAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,1,0,0,0,1]
/-- `λ i_239. …`: the closure i_236 receives. -/
def nameLoop : Term := sub (nameAt ++ [0])
def nameBody : Term := sub (nameAt ++ [0, 0])

theorem nameLoop_shape : nameLoop = .Lam nameBody := rfl

theorem name_search (ρ σ : Environment) (N : ByteString)
    (h0 : List.get?Internal ρ 0 = some (.VDelay (.Const (.Integer 0)) σ))
    (hN : List.get?Internal ρ 26 = some (.VCon (.ByteString N)))
    (hIte : List.get?Internal ρ 28 = some vIte) (hFst : List.get?Internal ρ 29 = some vFst)
    (hSnd : List.get?Internal ρ 30 = some vSnd) (hCL : List.get?Internal ρ 31 = some vChooseList)
    (hHead : List.get?Internal ρ 33 = some vHead) (hTail : List.get?Internal ρ 34 = some vTail)
    (xs : List (Data × Data)) :
    Ev default nameBody (.VCon (.ConstPairDataList xs) :: .VLam nameLoop ρ :: ρ)
      ((nameEntry N xs).map fun i => .VCon (.Integer i)) := by
  induction xs with
  | nil => ev_using []
  | cons x xs ih =>
    rcases x with ⟨k, v⟩
    cases k with
    | B kb =>
      simp only [nameEntry]
      cases hle : PlutusCore.ByteString.lessThanEqualsByteString N kb
      · simp only [Bool.false_eq_true, ↓reduceIte]
        ev_go [ih] [hle]
      · cases heq : PlutusCore.ByteString.equalsByteString N kb
        · simp only [Bool.false_eq_true, ↓reduceIte]
          ev_go [] [hle, heq]
        · simp only [↓reduceIte]
          cases v <;> ev_go [] [hle, heq]
    | _ => simp only [nameEntry]; ev_go [] []

end Lovejoin.Every

/-- info: 'Lovejoin.Every.policy_search' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.policy_search

/-- info: 'Lovejoin.Every.name_search' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.name_search
