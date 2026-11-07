import Lovejoin.Every.Fold

/-! # The value each box out must hold

i_134: the box's ADA as a value (none when it is 0), then, for a token pool with a quantity
other than 0, the token put in by the stdlib's ordered inserts (`assets.add`: the policy search
i_193, the name merge i_200). The datum's fields are as `referenceDatum` returns them. The
inserts are proved for any value, the compiled code's own. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-- i_134's value. -/
def valueAt : List Nat := mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,1]
def valueTerm : Term := sub valueAt

/-- i_193, `λ self xs`, the policy search. -/
def insertAt : List Nat := valueAt ++ [0,0,0,0,2,0,1,0,0,0,0,0,2,0,0,0,1]
def insertLoop : Term := sub (insertAt ++ [0])
def insertBody : Term := sub (insertAt ++ [0,0])

/-- i_200, `λ self ys`, the name merge. -/
def mergeAt : List Nat := insertAt ++ [0,0,0,0,2,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,1,1]
def mergeLoop : Term := sub (mergeAt ++ [0])
def mergeBody : Term := sub (mergeAt ++ [0,0])

theorem insertLoop_shape : insertLoop = .Lam insertBody := rfl
theorem mergeLoop_shape : mergeLoop = .Lam mergeBody := rfl

/-- The token's name and quantity merged into a policy's names, in key order: a new name goes
in before the first larger one, and an equal name's quantity adds, the entry dropped at zero. -/
def mergeName (nm : ByteString) (tq : Integer) : List (Data × Data) → Option (List (Data × Data))
  | [] => some [(.B nm, .I tq)]
  | (k, v) :: rest =>
    match k with
    | .B key =>
      if PlutusCore.ByteString.lessThanEqualsByteString nm key then
        if PlutusCore.ByteString.equalsByteString nm key then
          match v with
          | .I q =>
            if PlutusCore.Integer.equalsInteger q (PlutusCore.Integer.subtractInteger 0 tq) then some rest
            else some ((.B nm, .I (PlutusCore.Integer.addInteger q tq)) :: rest)
          | _ => none
        else some ((.B nm, .I tq) :: (k, v) :: rest)
      else (mergeName nm tq rest).map ((k, v) :: ·)
    | _ => none

/-- The token put into a value, by policy in key order: an equal policy's names merge, the
policy dropped when none are left. -/
def insertPolicy (pol nm : ByteString) (tq : Integer) : List (Data × Data) → Option (List (Data × Data))
  | [] => some [(.B pol, .Map [(.B nm, .I tq)])]
  | (k, v) :: rest =>
    match k with
    | .B key =>
      if PlutusCore.ByteString.lessThanEqualsByteString pol key then
        if PlutusCore.ByteString.equalsByteString pol key then
          match v with
          | .Map m =>
            match mergeName nm tq m with
            | some m' =>
              if PlutusCore.Data.equalsData (.Map []) (.Map m') then some rest
              else some ((.B pol, .Map m') :: rest)
            | none => none
          | _ => none
        else some ((.B pol, .Map [(.B nm, .I tq)]) :: (k, v) :: rest)
      else (insertPolicy pol nm tq rest).map ((k, v) :: ·)
    | _ => none

set_option maxHeartbeats 0

theorem merge_loop (σ : Environment) (nm : ByteString) (tq : Integer)
    (hTq : List.get?Internal σ 6 = some (.VCon (.Integer tq)))
    (hNm : List.get?Internal σ 7 = some (.VCon (.ByteString nm)))
    (hIte : List.get?Internal σ 43 = some vIte) (hFst : List.get?Internal σ 44 = some vFst)
    (hSnd : List.get?Internal σ 45 = some vSnd) (hCL : List.get?Internal σ 46 = some vChooseList)
    (hMk : List.get?Internal σ 47 = some vMkCons)
    (hHead : List.get?Internal σ 48 = some vHead) (hTail : List.get?Internal σ 49 = some vTail)
    (ys : List (Data × Data)) :
    Ev default mergeBody (.VCon (.ConstPairDataList ys) :: .VLam mergeLoop σ :: σ)
      ((mergeName nm tq ys).map fun m => .VCon (.ConstPairDataList m)) := by
  induction ys with
  | nil => ev_go [] []
  | cons p rest ih =>
    obtain ⟨k, v⟩ := p
    rcases k with _ | _ | _ | _ | key
    all_goals try (ev_go [] []; done)
    simp only [mergeName]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString nm key
    · simp only [Bool.false_eq_true, ↓reduceIte]
      cases hr : mergeName nm tq rest with
      | none => simp only [Option.map_none]; ev_go [ih] [hle, hr, Option.map_none]
      | some m => simp only [Option.map_some]; ev_go [ih] [hle, hr, Option.map_some]
    · simp only [↓reduceIte]
      cases heq : PlutusCore.ByteString.equalsByteString nm key
      · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [] [hle, heq]
      · simp only [↓reduceIte]
        rcases v with _ | _ | _ | q | _
        all_goals try (simp only [Option.map_none]; ev_go [] [hle, heq]; done)
        cases hz : PlutusCore.Integer.equalsInteger q (PlutusCore.Integer.subtractInteger 0 tq) <;>
          simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some] <;> ev_go [] [hle, heq, hz]

theorem insert_loop (σ : Environment) (pol nm : ByteString) (tq : Integer)
    (h192 : List.get?Internal σ 0 = some (.VCon (.ConstPairDataList [(.B nm, .I tq)])))
    (hTq : List.get?Internal σ 1 = some (.VCon (.Integer tq)))
    (hNm : List.get?Internal σ 2 = some (.VCon (.ByteString nm)))
    (hPol : List.get?Internal σ 3 = some (.VCon (.ByteString pol)))
    (hIte : List.get?Internal σ 38 = some vIte) (hFst : List.get?Internal σ 39 = some vFst)
    (hSnd : List.get?Internal σ 40 = some vSnd) (hCL : List.get?Internal σ 41 = some vChooseList)
    (hMk : List.get?Internal σ 42 = some vMkCons)
    (hHead : List.get?Internal σ 43 = some vHead) (hTail : List.get?Internal σ 44 = some vTail)
    (xs : List (Data × Data)) :
    Ev default insertBody (.VCon (.ConstPairDataList xs) :: .VLam insertLoop σ :: σ)
      ((insertPolicy pol nm tq xs).map fun v => .VCon (.ConstPairDataList v)) := by
  have hm := fun σ' => merge_loop σ' nm tq
  induction xs with
  | nil => ev_go [] []
  | cons p rest ih =>
    obtain ⟨k, v⟩ := p
    rcases k with _ | _ | _ | _ | key
    all_goals try (ev_go [] []; done)
    simp only [insertPolicy]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString pol key
    · simp only [Bool.false_eq_true, ↓reduceIte]
      cases hr : insertPolicy pol nm tq rest with
      | none => simp only [Option.map_none]; ev_go [ih] [hle, hr, Option.map_none]
      | some m => simp only [Option.map_some]; ev_go [ih] [hle, hr, Option.map_some]
    · simp only [↓reduceIte]
      cases heq : PlutusCore.ByteString.equalsByteString pol key
      · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [] [hle, heq]
      · simp only [↓reduceIte]
        rcases v with _ | m | _ | _ | _
        all_goals try (simp only [Option.map_none]; ev_go [] [hle, heq]; done)
        cases hmr : mergeName nm tq m with
        | none =>
          simp only [Option.map_none]
          ev_go [hm, values_nil_any] [hle, heq, hmr, Option.map_none]
        | some m' =>
          cases hd : PlutusCore.Data.equalsData (.Map []) (.Map m') <;>
            simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some] <;>
            ev_go [hm, values_nil_any] [mapData_eq, hle, heq, hmr, hd, Option.map_some]

/-! ### The box value -/

/-- The box's ADA, as a value: none at 0. -/
def adaPart (bl : Integer) : List (Data × Data) :=
  if PlutusCore.Integer.equalsInteger 0 bl then [] else [(.B ⟨""⟩, .Map [(.B ⟨""⟩, .I bl)])]

/-- i_134: the ADA, and the token unless its policy is empty or its quantity 0. -/
def boxValue (bl : Integer) (pol nm : ByteString) (tq : Integer) : Option (List (Data × Data)) :=
  if PlutusCore.ByteString.equalsByteString ⟨""⟩ pol then some (adaPart bl)
  else if PlutusCore.Integer.equalsInteger 0 tq then some (adaPart bl)
  else insertPolicy pol nm tq (adaPart bl)

theorem box_value (ρ : Environment) (ps : List Data) (n t bl : Integer) (pol nm : ByteString)
    (tq : Integer) (f4 : Data) (msh : ByteString) (rest : List Data) (v72 v73 : CekValue)
    (hRd : List.get?Internal ρ 3 = some (.VCon (.Data (refD t bl pol nm tq f4 msh rest))))
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 12 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h18 : List.get?Internal ρ 19 = some (vEq 0))
    (hIte : List.get?Internal ρ 27 = some vIte) (hFst : List.get?Internal ρ 28 = some vFst)
    (hSnd : List.get?Internal ρ 29 = some vSnd) (hCL : List.get?Internal ρ 30 = some vChooseList)
    (hMk : List.get?Internal ρ 31 = some vMkCons)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail) :
    Ev default valueTerm (envA ps n ρ) ((boxValue bl pol nm tq).map fun v => .VCon (.ConstPairDataList v)) := by
  have hi := fun σ => insert_loop σ pol nm tq
  simp only [boxValue]
  cases h0 : PlutusCore.Integer.equalsInteger 0 bl <;> simp only [adaPart, h0, Bool.false_eq_true, ↓reduceIte]
  all_goals
    cases hp : PlutusCore.ByteString.equalsByteString ⟨""⟩ pol <;>
      simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]
  all_goals try (ev_go [hv72, hv73] [h0, hp]; done)
  all_goals
    cases hq : PlutusCore.Integer.equalsInteger 0 tq <;>
      simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]
  all_goals try (ev_go [hv72, hv73] [h0, hp, hq]; done)
  -- What's left is a token pool whose box holds ADA too (with none, the insert is concrete).
  cases hr : insertPolicy pol nm tq [(.B ⟨""⟩, .Map [(.B ⟨""⟩, .I bl)])] with
  | none =>
    simp only [Option.map_none]
    ev_go [hv72, hv73, hi, values_nil_any]
      [mkCons_eq, mkPairData_eq, mapData_eq, bData_eq, iData_eq, h0, hp, hq, hr, Option.map_none]
  | some v =>
    simp only [Option.map_some]
    ev_go [hv72, hv73, hi, values_nil_any]
      [mkCons_eq, mkPairData_eq, mapData_eq, bData_eq, iData_eq, h0, hp, hq, hr, Option.map_some]

end Lovejoin.Every
