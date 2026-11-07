import Lovejoin.Every.Lookup

/-! # The pool's reference datum

`read_reference_datum`: the reference inputs holding exactly one of the pool's NFT, by the
searches in `Lookup.lean`, must be exactly one, and its output's datum must be inline and a
`ReferenceDatum`, `Constr 0` of eight fields typed `I, B, B, I, I, B, B, B`. Every reference
input is any `Data`, and the list any length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-! ### The field accessors -/

/-- `λ i_55. headList(tailList(tailList(i_55)))`: a list's third element (i_72). -/
def nth2Body : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0]
/-- `λ i_56. headList(tailList(i_56))`: a list's second element (i_73). -/
def nth1Body : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,1,0]
/-- `λ i_57. headList(tailList⁵(i_57))`: a list's sixth element (i_74). -/
def nth5Body : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,2,0]

set_option maxHeartbeats 0

/-- Each accessor is the list's element there, or an error if the list is shorter. -/
theorem nth1_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam nth1Body σ) (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, l⟩⟩ <;> ev_go [] []

theorem nth2_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam nth2Body σ) (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, l⟩⟩⟩ <;> ev_go [] []

theorem nth5_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam nth5Body σ) (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, _ | ⟨d, _ | ⟨e, _ | ⟨f, l⟩⟩⟩⟩⟩⟩ <;> ev_go [] []

/-! ### Which reference inputs carry the NFT -/

/-- `quantity_of(input.output.value, pb, nb) == 1`, as the searches read the value: the input's
second field (its output), that one's second (its value), a map. -/
def holdsNft (pb nb : ByteString) : Data → Option Bool
  | .Constr _ fs =>
    match (fs[1]? : Option Data) with
    | some (.Constr _ ofs) =>
      match (ofs[1]? : Option Data) with
      | some (.Map m) =>
        match policyEntry pb m with
        | some inner => (nameEntry nb inner).map fun q => PlutusCore.Integer.equalsInteger 1 q
        | none => none
      | _ => none
    | _ => none
  | _ => none

/-- `list.filter(self.reference_inputs, holds_reference_nft)`, an error if any input's search is. -/
def carriers (pb nb : ByteString) : List Data → Option (List Data)
  | [] => some []
  | x :: xs =>
    match holdsNft pb nb x with
    | some true => (carriers pb nb xs).map (x :: ·)
    | some false => carriers pb nb xs
    | none => none

def filterAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1,1,1]
/-- `λ i_232. …`: the closure i_230 holds. -/
def filterLoop : Term := sub (filterAt ++ [0])
def filterBody : Term := sub (filterAt ++ [0, 0])
/-- The filter's condition for the input i_233. -/
def carrierCond : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0]

theorem filterLoop_shape : filterLoop = .Lam filterBody := rfl

section Filter
variable (ρ : Environment) (P N : ByteString) (v73 : CekValue)
  (h73 : List.get?Internal ρ 7 = some v73)
  (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
  (h27 : List.get?Internal ρ 11 = some (vEq 1))
  (hN : List.get?Internal ρ 21 = some (.VCon (.ByteString N)))
  (hP : List.get?Internal ρ 22 = some (.VCon (.ByteString P)))
  (hIte : List.get?Internal ρ 23 = some vIte) (hFst : List.get?Internal ρ 24 = some vFst)
  (hSnd : List.get?Internal ρ 25 = some vSnd) (hCL : List.get?Internal ρ 26 = some vChooseList)
  (hMk : List.get?Internal ρ 27 = some vMkCons)
  (hHead : List.get?Internal ρ 28 = some vHead) (hTail : List.get?Internal ρ 29 = some vTail)
include h73 hv73 h27 hN hP hIte hFst hSnd hCL hHead hTail

/-- The condition is the input's `holdsNft`, for any input `Data`. -/
theorem carrier_cond (input : Data) (tl l : List Data) (self : CekValue) :
    Ev default carrierCond
      (.VCon (.ConstDataList tl) :: .VCon (.Data input) :: .VCon (.ConstDataList l) :: self :: ρ)
      ((holdsNft P N input).map fun b => .VCon (.Bool b)) := by
  rcases input with ⟨t, fs⟩ | _ | _ | _ | _
  · rcases fs with _ | ⟨f0, _ | ⟨out, fs⟩⟩
    · ev_go [hv73] []
    · ev_go [hv73] []
    · rcases out with ⟨t1, ofs⟩ | _ | _ | _ | _
      · rcases ofs with _ | ⟨o0, _ | ⟨v, ofs⟩⟩
        · ev_go [hv73] []
        · ev_go [hv73] []
        · rcases v with _ | m | _ | _ | _
          · ev_go [hv73] []
          · cases hpe : policyEntry P m with
            | none =>
              simp only [holdsNft, List.getElem?_cons_succ, List.getElem?_cons_zero, hpe, Option.map_none]
              ev_go [hv73, policy_search, name_search] [hpe, Option.map_none]
            | some inner =>
              cases hne : nameEntry N inner with
              | none =>
                simp only [holdsNft, List.getElem?_cons_succ, List.getElem?_cons_zero, hpe, hne, Option.map_none]
                ev_go [hv73, policy_search, name_search] [hpe, hne, Option.map_none, Option.map_some]
              | some q =>
                simp only [holdsNft, List.getElem?_cons_succ, List.getElem?_cons_zero, hpe, hne, Option.map_some]
                ev_go [hv73, policy_search, name_search] [hpe, hne, Option.map_none, Option.map_some]
          · ev_go [hv73] []
          · ev_go [hv73] []
          · ev_go [hv73] []
      all_goals ev_go [hv73] []
  all_goals ev_go [hv73] []

include hMk in
/-- The filter is `carriers`, for any list of any `Data`. -/
theorem carrier_filter (l : List Data) :
    Ev default filterBody (.VCon (.ConstDataList l) :: .VLam filterLoop ρ :: ρ)
      ((carriers P N l).map fun cs => .VCon (.ConstDataList cs)) := by
  have hc := carrier_cond ρ P N v73 h73 hv73 h27 hN hP hIte hFst hSnd hCL hHead hTail
  induction l with
  | nil => ev_go [] []
  | cons x xs ih =>
    cases hx : holdsNft P N x with
    | none =>
      simp only [carriers, hx, Option.map_none]
      ev_go [hc] [hx, Option.map_none]
    | some b =>
      cases b with
      | false =>
        simp only [carriers, hx]
        ev_go [hc, ih] [hx, Option.map_some]
      | true =>
        cases hxs : carriers P N xs with
        | none =>
          simp only [carriers, hx, hxs, Option.map_none]
          ev_go [hc, ih] [hx, hxs, Option.map_none, Option.map_some]
        | some cs =>
          simp only [carriers, hx, hxs, Option.map_some]
          ev_go [hc, ih] [hx, hxs, Option.map_none, Option.map_some]

end Filter

/-! ### The carrier's datum -/

/-- The eight fields' kinds, in the order the compiled code takes them apart (the last first),
and no ninth. -/
def refFields (x : Data) : List Data → Option Data
  | f0 :: f1 :: f2 :: f3 :: f4 :: f5 :: f6 :: f7 :: rest => do
    let _ ← bytesOf f7
    let _ ← intOf f0
    let _ ← bytesOf f1
    let _ ← bytesOf f2
    let _ ← intOf f3
    let _ ← intOf f4
    let _ ← bytesOf f5
    let _ ← bytesOf f6
    match rest with
    | [] => some x
    | _ => none
  | _ => none

/-- The one carrier's output datum: inline, `Constr 0` of the eight fields. -/
def carrierDatum : Data → Option Data
  | .Constr _ cfs =>
    match (cfs[1]? : Option Data) with
    | some (.Constr _ ofs) =>
      match (ofs[2]? : Option Data) with
      | some (.Constr dt dfs) =>
        if PlutusCore.Integer.equalsInteger 2 dt then
          match (dfs[0]? : Option Data) with
          | some (.Constr xt xs) =>
            if PlutusCore.Integer.equalsInteger 0 xt then refFields (.Constr xt xs) xs else none
          | _ => none
        else none
      | _ => none
    | _ => none
  | _ => none

/-- The check run on the filter's result `[c]`. -/
def datumCheck : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1,0,0,0,0,1,0]

theorem carrier_datum (ρ : Environment) (v72 : CekValue)
    (h72 : List.get?Internal ρ 8 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h18 : List.get?Internal ρ 15 = some (vEq 0)) (h17 : List.get?Internal ρ 16 = some (vEq 2))
    (hIte : List.get?Internal ρ 23 = some vIte) (hFst : List.get?Internal ρ 24 = some vFst)
    (hSnd : List.get?Internal ρ 25 = some vSnd) (hCL : List.get?Internal ρ 26 = some vChooseList)
    (hHead : List.get?Internal ρ 28 = some vHead) (hTail : List.get?Internal ρ 29 = some vTail)
    (c : Data) :
    Ev default datumCheck (.VCon (.ConstDataList [c]) :: ρ) ((carrierDatum c).map fun d => .VCon (.Data d)) := by
  rcases c with ⟨t, _ | ⟨c0, _ | ⟨out, cfs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72] []; done)
  rcases out with ⟨t1, _ | ⟨o0, _ | ⟨o1, _ | ⟨d, ofs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72] []; done)
  rcases d with ⟨dt, _ | ⟨x, dfs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72] []; done)
  · cases h2 : PlutusCore.Integer.equalsInteger 2 dt <;>
      simp only [carrierDatum, h2, List.getElem?_cons_succ, List.getElem?_cons_zero, ↓reduceIte,
        Bool.false_eq_true, Option.map_none] <;> ev_go [hv72] [h2]
  · cases h2 : PlutusCore.Integer.equalsInteger 2 dt
    · simp only [carrierDatum, h2, List.getElem?_cons_succ, List.getElem?_cons_zero, ↓reduceIte,
        Bool.false_eq_true, Option.map_none]
      ev_go [hv72] [h2]
    · rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
      all_goals try (simp only [carrierDatum, h2, List.getElem?_cons_succ, List.getElem?_cons_zero,
        ↓reduceIte, Option.map_none]; ev_go [hv72] [h2]; done)
      cases h0 : PlutusCore.Integer.equalsInteger 0 xt
      · simp only [carrierDatum, h2, h0, List.getElem?_cons_succ, List.getElem?_cons_zero, ↓reduceIte,
          Bool.false_eq_true, Option.map_none]
        ev_go [hv72] [h2, h0]
      · simp only [carrierDatum, h2, h0, List.getElem?_cons_succ, List.getElem?_cons_zero, ↓reduceIte]
        rcases xs with _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨f4, _ | ⟨f5, _ | ⟨f6, _ | ⟨f7, rest⟩⟩⟩⟩⟩⟩⟩⟩
        all_goals try (ev_go [hv72] [h2, h0]; done)
        all_goals (cases f7 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f0 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f1 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f2 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f3 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f4 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f5 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (cases f6 <;> try (ev_go [hv72] [h2, h0]; done))
        all_goals (rcases rest with _ | ⟨r, rest⟩ <;> ev_go [hv72] [h2, h0])

/-- `read_reference_datum`: the TxInfo's second field, its reference inputs, has exactly one
input carrying the NFT, and that input's datum checks out. -/
def referenceDatum (pb nb : ByteString) : Data → Option Data
  | .Constr _ ifs =>
    match (ifs[1]? : Option Data) with
    | some (.List refs) =>
      match carriers pb nb refs with
      | some [c] => carrierDatum c
      | _ => none
    | _ => none
  | _ => none

/-- i_81's value. -/
def refDatumTerm : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,1]

theorem reference_datum (ρ : Environment) (P N : ByteString) (info : Data) (v72 v73 : CekValue)
    (h73 : List.get?Internal ρ 7 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 8 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 11 = some (vEq 1))
    (hInfo : List.get?Internal ρ 14 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 15 = some (vEq 0)) (h17 : List.get?Internal ρ 16 = some (vEq 2))
    (hN : List.get?Internal ρ 21 = some (.VCon (.ByteString N)))
    (hP : List.get?Internal ρ 22 = some (.VCon (.ByteString P)))
    (hIte : List.get?Internal ρ 23 = some vIte) (hFst : List.get?Internal ρ 24 = some vFst)
    (hSnd : List.get?Internal ρ 25 = some vSnd) (hCL : List.get?Internal ρ 26 = some vChooseList)
    (hMk : List.get?Internal ρ 27 = some vMkCons)
    (hHead : List.get?Internal ρ 28 = some vHead) (hTail : List.get?Internal ρ 29 = some vTail) :
    Ev default refDatumTerm ρ ((referenceDatum P N info).map fun d => .VCon (.Data d)) := by
  have hf := carrier_filter ρ P N v73 h73 hv73 h27 hN hP hIte hFst hSnd hCL hMk hHead hTail
  have hd := carrier_datum ρ v72 h72 hv72 h18 h17 hIte hFst hSnd hCL hHead hTail
  rcases info with ⟨ti, _ | ⟨f0, _ | ⟨fr, ifs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  rcases fr with _ | _ | refs | _ | _
  all_goals try (ev_go [hv73] []; done)
  cases hcs : carriers P N refs with
  | none =>
    simp only [referenceDatum, List.getElem?_cons_succ, List.getElem?_cons_zero, hcs, Option.map_none]
    ev_go [hv73, hf] [hcs, Option.map_none]
  | some cs =>
    rcases cs with _ | ⟨c, _ | ⟨d, cs⟩⟩ <;>
      simp only [referenceDatum, List.getElem?_cons_succ, List.getElem?_cons_zero, hcs, Option.map_none] <;>
      ev_go [hv73, hf, hd] [hcs, Option.map_some]

end Lovejoin.Every

/-- info: 'Lovejoin.Every.reference_datum' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.reference_datum
