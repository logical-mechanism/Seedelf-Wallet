import Lovejoin.Every.Carrier

/-! # The boxes a transaction spends

`collect_well_formed_mix_inputs`: every input, in order, whose payment credential is the pool's
mix_box script and whose datum is inline and a well-formed `MixDatum` (two 48-byte strings that
differ). Every input is any `Data`, and the list any length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-- An `Option` as the compiled code builds it: `Some x` is `Constr 0 [x]`, `None` `Constr 1 []`. -/
def optData : Option Data → Data
  | some d => .Constr 0 [d]
  | none => .Constr 1 []

/-- `is_bytes` (i_82). -/
def isB : Data → Bool
  | .B _ => true
  | _ => false

/-- `try_decode_well_formed_data`: never an error. -/
def boxDatum : Data → Option Data
  | .Constr t fs =>
    if PlutusCore.Integer.equalsInteger 0 t then
      match fs with
      | [.B a, .B b] =>
        if PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString a) then
          if PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString b) then
            if PlutusCore.ByteString.equalsByteString a b then none
            else some (.Constr 0 [.B a, .B b])
          else none
        else none
      | _ => none
    else none
  | _ => none

/-- One input: an error if it isn't laid out as an input (fields 1, then 0 and 0, a
credential), `some none` if it isn't a box, `some (some b)` for a box `b`. -/
def boxIn (msh : ByteString) : Data → Option (Option Data)
  | .Constr _ ifs =>
    match (ifs[1]? : Option Data) with
    | some (.Constr _ ofs) =>
      match (ofs[0]? : Option Data) with
      | some (.Constr _ afs) =>
        match (afs[0]? : Option Data) with
        | some (.Constr ct cfs) =>
          let atScript : Option Bool :=
            if PlutusCore.Integer.equalsInteger 1 ct then
              match (cfs[0]? : Option Data) with
              | some (.B h) => some (PlutusCore.ByteString.equalsByteString h msh)
              | _ => none
            else some false
          match atScript with
          | some true =>
            match (ofs[2]? : Option Data) with
            | some (.Constr dt dfs) =>
              if PlutusCore.Integer.equalsInteger 2 dt then
                match (dfs[0]? : Option Data) with
                | some x => some (boxDatum x)
                | none => none
              else some none
            | _ => none
          | some false => some none
          | none => none
        | _ => none
      | _ => none
    | _ => none
  | _ => none

/-- `list.filter_map` of `boxIn` over the inputs. -/
def collect (msh : ByteString) : List Data → Option (List Data)
  | [] => some []
  | x :: xs =>
    match boxIn msh x with
    | some (some b) => (collect msh xs).map (b :: ·)
    | some none => collect msh xs
    | none => none

def isBytesBody : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,1,0]
def collectAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,0,0,0,1]
/-- `λ i_86. …`: the closure i_84 holds. -/
def collectLoop : Term := sub (collectAt ++ [0])
def collectBody : Term := sub (collectAt ++ [0, 0])
/-- The filter_map's function, on the input i_87. -/
def boxPred : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,2,0,0,0,0,1]

theorem collectLoop_shape : collectLoop = .Lam collectBody := rfl

set_option maxHeartbeats 0

theorem isBytes_ap (σ : Environment) (hCD : List.get?Internal σ 31 = some vChooseData) (d : Data) :
    Ap default (.VLam isBytesBody σ) (.VCon (.Data d)) (some (.VCon (.Bool (isB d)))) := by
  apply ap_lam
  cases d <;> ev_go [] []

section Pred
variable (ρ : Environment) (msh : ByteString) (v72 v73 v82 : CekValue)
  (hM : List.get?Internal ρ 0 = some (.VCon (.ByteString msh)))
  (h82 : List.get?Internal ρ 1 = some v82)
  (hv82 : ∀ d : Data, Ap default v82 (.VCon (.Data d)) (some (.VCon (.Bool (isB d)))))
  (h76 : List.get?Internal ρ 7 = some (.VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)))
  (h75 : List.get?Internal ρ 8 = some (vEq 48))
  (h73 : List.get?Internal ρ 10 = some v73)
  (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
  (h72 : List.get?Internal ρ 11 = some v72)
  (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
  (h27 : List.get?Internal ρ 14 = some (vEq 1)) (h18 : List.get?Internal ρ 18 = some (vEq 0))
  (h17 : List.get?Internal ρ 19 = some (vEq 2))
  (hIte : List.get?Internal ρ 26 = some vIte) (hFst : List.get?Internal ρ 27 = some vFst)
  (hSnd : List.get?Internal ρ 28 = some vSnd) (hCL : List.get?Internal ρ 29 = some vChooseList)
  (hMk : List.get?Internal ρ 30 = some vMkCons)
  (hHead : List.get?Internal ρ 31 = some vHead) (hTail : List.get?Internal ρ 32 = some vTail)
  (hCD : List.get?Internal ρ 33 = some vChooseData)
include hM h82 hv82 h76 h75 h73 hv73 h72 hv72 h27 h18 h17 hIte hFst hSnd hCL hMk hHead hTail hCD

/-- The function is `boxIn`, for any input `Data`. -/
theorem box_pred (x : Data) (l : List Data) (self : CekValue) :
    Ev default boxPred (.VCon (.Data x) :: .VCon (.ConstDataList l) :: self :: ρ)
      ((boxIn msh x).map fun o => .VCon (.Data (optData o))) := by
  rcases x with ⟨t, _ | ⟨i0, _ | ⟨out, ifs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv73, hv82] []; done)
  rcases out with ⟨to, _ | ⟨addr, ofs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv73, hv82] []; done)
  rcases addr with ⟨ta, _ | ⟨cred, afs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv73, hv82] []; done)
  rcases cred with ⟨ct, cfs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv73, hv82] []; done)
  simp only [boxIn, List.getElem?_cons_succ, List.getElem?_cons_zero]
  cases h1 : PlutusCore.Integer.equalsInteger 1 ct
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some, optData]
    ev_go [hv72, hv73, hv82] [h1]
  simp only [↓reduceIte]
  rcases cfs with _ | ⟨hd, cfs⟩
  · simp only [List.getElem?_nil, Option.map_none]; ev_go [hv72, hv73, hv82] [h1]
  rcases hd with _ | _ | _ | _ | h
  all_goals try (simp only [List.getElem?_cons_zero, Option.map_none]; ev_go [hv72, hv73, hv82] [h1]; done)
  simp only [List.getElem?_cons_zero]
  cases he : PlutusCore.ByteString.equalsByteString h msh
  · simp only [Option.map_some, optData]; ev_go [hv72, hv73, hv82] [h1, he]
  rcases ofs with _ | ⟨o1, _ | ⟨d, ofs⟩⟩
  all_goals try (simp only [List.getElem?_nil, List.getElem?_cons_succ, List.getElem?_cons_zero,
    Option.map_none]; ev_go [hv72, hv73, hv82] [h1, he]; done)
  simp only [List.getElem?_cons_succ, List.getElem?_cons_zero]
  rcases d with ⟨dt, dfs⟩ | _ | _ | _ | _
  all_goals try (simp only [Option.map_none]; ev_go [hv72, hv73, hv82] [h1, he]; done)
  cases h2 : PlutusCore.Integer.equalsInteger 2 dt
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some, optData]
    ev_go [hv72, hv73, hv82] [h1, he, h2]
  simp only [↓reduceIte]
  rcases dfs with _ | ⟨y, dfs⟩
  · simp only [List.getElem?_nil, Option.map_none]; ev_go [hv72, hv73, hv82] [h1, he, h2]
  simp only [List.getElem?_cons_zero, Option.map_some]
  rcases y with ⟨yt, ys⟩ | _ | _ | _ | _
  all_goals try (simp only [boxDatum, optData]; ev_go [hv72, hv73, hv82] [h1, he, h2]; done)
  simp only [boxDatum]
  cases h0 : PlutusCore.Integer.equalsInteger 0 yt
  · simp only [Bool.false_eq_true, ↓reduceIte, optData]; ev_go [hv72, hv73, hv82] [h1, he, h2, h0]
  simp only [↓reduceIte]
  rcases ys with _ | ⟨a, _ | ⟨b, _ | ⟨c, ys⟩⟩⟩
  all_goals try (simp only [optData]; ev_go [hv72, hv73, hv82] [h1, he, h2, h0]; done)
  rcases a with _ | _ | _ | _ | a <;> rcases b with _ | _ | _ | _ | b
  all_goals try (simp only [optData]; ev_go [hv72, hv73, hv82] [h1, he, h2, h0]; done)
  cases ha : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString a)
  · simp only [Bool.false_eq_true, ↓reduceIte, optData]; ev_go [hv72, hv73, hv82] [h1, he, h2, h0, ha]
  cases hb : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString b)
  · simp only [Bool.false_eq_true, ↓reduceIte, optData]; ev_go [hv72, hv73, hv82] [h1, he, h2, h0, ha, hb]
  cases hab : PlutusCore.ByteString.equalsByteString a b <;>
    simp only [Bool.false_eq_true, ↓reduceIte, optData] <;>
    ev_go [hv72, hv73, hv82] [h1, he, h2, h0, ha, hb, hab]

/-- The loop is `collect`, for any list of any `Data`. -/
theorem collect_loop (l : List Data) :
    Ev default collectBody (.VCon (.ConstDataList l) :: .VLam collectLoop ρ :: ρ)
      ((collect msh l).map fun bs => .VCon (.ConstDataList bs)) := by
  have hp := box_pred ρ msh v72 v73 v82 hM h82 hv82 h76 h75 h73 hv73 h72 hv72 h27 h18 h17 hIte hFst
    hSnd hCL hMk hHead hTail hCD
  induction l with
  | nil => ev_go [] []
  | cons x xs ih =>
    cases hx : boxIn msh x with
    | none =>
      simp only [collect, hx, Option.map_none]
      ev_go [hp] [hx, Option.map_none]
    | some o =>
      cases o with
      | none =>
        simp only [collect, hx]
        ev_go [hp, ih] [hx, Option.map_some, optData]
      | some b =>
        cases hxs : collect msh xs with
        | none =>
          simp only [collect, hx, hxs, Option.map_none]
          ev_go [hp, ih] [hx, hxs, Option.map_none, Option.map_some, optData]
        | some bs =>
          simp only [collect, hx, hxs, Option.map_some]
          ev_go [hp, ih] [hx, hxs, Option.map_none, Option.map_some, optData]

end Pred

/-- The boxes: the pool's mix_box hash is the reference datum's sixth field, and the inputs
the TxInfo's first. -/
def boxesOf (rd info : Data) : Option (List Data) :=
  match rd with
  | .Constr _ rfs =>
    match (rfs[5]? : Option Data) with
    | some (.B msh) =>
      match info with
      | .Constr _ ifs =>
        match (ifs[0]? : Option Data) with
        | some (.List ins) => collect msh ins
        | _ => none
      | _ => none
    | _ => none
  | _ => none

/-- i_105's value. -/
def boxesTerm : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,0,0]

theorem boxes_of (ρ : Environment) (rd info : Data) (v72 v73 v74 : CekValue)
    (hRd : List.get?Internal ρ 0 = some (.VCon (.Data rd)))
    (h76 : List.get?Internal ρ 5 = some (.VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)))
    (h75 : List.get?Internal ρ 6 = some (vEq 48))
    (h74 : List.get?Internal ρ 7 = some v74)
    (hv74 : ∀ l : List Data, Ap default v74 (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)))
    (h73 : List.get?Internal ρ 8 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 9 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 12 = some (vEq 1))
    (hInfo : List.get?Internal ρ 15 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 16 = some (vEq 0)) (h17 : List.get?Internal ρ 17 = some (vEq 2))
    (hIte : List.get?Internal ρ 24 = some vIte) (hFst : List.get?Internal ρ 25 = some vFst)
    (hSnd : List.get?Internal ρ 26 = some vSnd) (hCL : List.get?Internal ρ 27 = some vChooseList)
    (hMk : List.get?Internal ρ 28 = some vMkCons)
    (hHead : List.get?Internal ρ 29 = some vHead) (hTail : List.get?Internal ρ 30 = some vTail)
    (hCD : List.get?Internal ρ 31 = some vChooseData) :
    Ev default boxesTerm ρ ((boxesOf rd info).map fun bs => .VCon (.ConstDataList bs)) := by
  have hb := isBytes_ap ρ hCD
  rcases rd with ⟨tr, rfs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv74] []; done)
  rcases rfs with _ | ⟨r0, _ | ⟨r1, _ | ⟨r2, _ | ⟨r3, _ | ⟨r4, _ | ⟨r5, rfs⟩⟩⟩⟩⟩⟩
  all_goals try (ev_go [hv74] []; done)
  rcases r5 with _ | _ | _ | _ | msh
  all_goals try (ev_go [hv74] []; done)
  rcases info with ⟨ti, _ | ⟨fi, ifs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv74, hb] []; done)
  rcases fi with _ | _ | ins | _ | _
  all_goals try (ev_go [hv74, hb] []; done)
  have hl := collect_loop
  simp only [boxesOf, List.getElem?_cons_succ, List.getElem?_cons_zero]
  ev_go [hv74, hb, collect_loop] []

end Lovejoin.Every
