import Lovejoin.Every.Typed

/-! # one_shot_mint's launch, its loops

one_shot_mint (6878ed6f…) mints a pool's NFT once: under a minting purpose, exactly one token
under its own policy, named `lovejoin`, quantity 1, paid to the reference holder with an inline
reference datum, the seed input spent. This file has the loops its check runs: the policy
search in a value (i_32), the name search under it, the output search (i_66) and the seed
search (i_62). Every list any length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

/-- one_shot_mint's template, unapplied. -/
def mbody : Term := match oneShotMintTemplate.script with | .Program _ b => b

/-- The subterm at a path. -/
def msub (p : List Nat) : Term := subterm mbody p

set_option maxHeartbeats 0

/-! ### The policy search -/

/-- `tokens(value, policy)`: the policy's names, by the ordered search; none found is `[]`. -/
def tokensOf (pol : ByteString) : List (Data × Data) → Option (List (Data × Data))
  | [] => some []
  | (k, v) :: rest =>
    match k with
    | .B key =>
      if PlutusCore.ByteString.lessThanEqualsByteString pol key then
        if PlutusCore.ByteString.equalsByteString pol key then
          match v with
          | .Map m => some m
          | _ => none
        else some []
      else tokensOf pol rest
    | _ => none

/-- i_32, `λ value policy`, under its first lambda, and its body. -/
def tokensFn : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,3,0]
def tokensEntry : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,3,0,0]
def tokensLoop : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,3,0,0,0,0,1,0]
def tokensBody : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,3,0,0,0,0,1,0,0]

theorem tokens_loop (σ σ23 : Environment) (pol : ByteString)
    (h23 : List.get?Internal σ 0 = some (.VDelay (.Const (.ConstPairDataList [])) σ23))
    (hPol : List.get?Internal σ 1 = some (.VCon (.ByteString pol)))
    (hIte : List.get?Internal σ 12 = some vIte) (hFst : List.get?Internal σ 13 = some vFst)
    (hSnd : List.get?Internal σ 14 = some vSnd) (hCL : List.get?Internal σ 15 = some vChooseList)
    (hHead : List.get?Internal σ 17 = some vHead) (hTail : List.get?Internal σ 18 = some vTail)
    (l : List (Data × Data)) :
    Ev default tokensBody (.VCon (.ConstPairDataList l) :: .VLam tokensLoop σ :: σ)
      ((tokensOf pol l).map fun m => .VCon (.ConstPairDataList m)) := by
  induction l with
  | nil => ev_go [] []
  | cons p rest ih =>
    obtain ⟨k, v⟩ := p
    rcases k with _ | _ | _ | _ | key
    all_goals try (ev_go [] []; done)
    simp only [tokensOf]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString pol key
    · simp only [Bool.false_eq_true, ↓reduceIte]
      ev_go [ih, values_nil_any] [hle]
    · simp only [↓reduceIte]
      cases heq : PlutusCore.ByteString.equalsByteString pol key
      · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [] [hle, heq]
      · simp only [↓reduceIte]
        rcases v with _ | m | _ | _ | _ <;> ev_go [] [hle, heq]

theorem tokens_apply (σ : Environment) (pol : ByteString)
    (hIte : List.get?Internal σ 9 = some vIte) (hFst : List.get?Internal σ 10 = some vFst)
    (hSnd : List.get?Internal σ 11 = some vSnd) (hCL : List.get?Internal σ 12 = some vChooseList)
    (hHead : List.get?Internal σ 14 = some vHead) (hTail : List.get?Internal σ 15 = some vTail)
    (m : List (Data × Data)) :
    Ev default tokensEntry (.VCon (.ByteString pol) :: .VCon (.ConstPairDataList m) :: σ)
      ((tokensOf pol m).map fun t => .VCon (.ConstPairDataList t)) := by
  have hl := fun σ' σ23 => tokens_loop σ' σ23 pol
  ev_go [hl, values_nil_any] []

/-! ### The name search -/

/-- The name's quantity among a policy's names, by the ordered search; none is 0. -/
def qtyOf (nm : ByteString) : List (Data × Data) → Option Integer
  | [] => some 0
  | (k, v) :: rest =>
    match k with
    | .B key =>
      if PlutusCore.ByteString.lessThanEqualsByteString nm key then
        if PlutusCore.ByteString.equalsByteString nm key then
          match v with
          | .I q => some q
          | _ => none
        else some 0
      else qtyOf nm rest
    | _ => none

def qtyLoop : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,0,0,1,0]
def qtyBody : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,1,1,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,0,0,1,0,0]

theorem qty_loop (σ σ71 : Environment) (nm : ByteString)
    (h71 : List.get?Internal σ 0 = some (.VDelay (.Const (.Integer 0)) σ71))
    (hNm : List.get?Internal σ 5 = some (.VCon (.ByteString nm)))
    (hIte : List.get?Internal σ 25 = some vIte) (hFst : List.get?Internal σ 26 = some vFst)
    (hSnd : List.get?Internal σ 27 = some vSnd) (hCL : List.get?Internal σ 28 = some vChooseList)
    (hHead : List.get?Internal σ 30 = some vHead) (hTail : List.get?Internal σ 31 = some vTail)
    (l : List (Data × Data)) :
    Ev default qtyBody (.VCon (.ConstPairDataList l) :: .VLam qtyLoop σ :: σ)
      ((qtyOf nm l).map fun q => .VCon (.Integer q)) := by
  induction l with
  | nil => ev_go [] []
  | cons p rest ih =>
    obtain ⟨k, v⟩ := p
    rcases k with _ | _ | _ | _ | key
    all_goals try (ev_go [] []; done)
    simp only [qtyOf]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString nm key
    · simp only [Bool.false_eq_true, ↓reduceIte]
      ev_go [ih, values_nil_any] [hle]
    · simp only [↓reduceIte]
      cases heq : PlutusCore.ByteString.equalsByteString nm key
      · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [] [hle, heq]
      · simp only [↓reduceIte]
        rcases v with _ | _ | _ | q | _ <;> ev_go [] [hle, heq]

/-! ### The seed search -/

/-- Whether an input spends `seed`: each input's reference compared in order. -/
def seedIn (seed : Data) : List Data → Option Bool
  | [] => some false
  | x :: xs =>
    match x with
    | .Constr _ (r :: _) => if PlutusCore.Data.equalsData r seed then some true else seedIn seed xs
    | _ => none

def seedLoop : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,
    0,0,0,0,0,1,0,0,0,0,1,0]
def seedBody : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,
    0,0,0,0,0,1,0,0,0,0,1,0,0]

theorem seed_loop (σ : Environment) (seed : Data)
    (hSeed : List.get?Internal σ 28 = some (.VCon (.Data seed)))
    (hIte : List.get?Internal σ 39 = some vIte) (hSnd : List.get?Internal σ 41 = some vSnd)
    (hCL : List.get?Internal σ 42 = some vChooseList)
    (hHead : List.get?Internal σ 44 = some vHead) (hTail : List.get?Internal σ 45 = some vTail)
    (l : List Data) :
    Ev default seedBody (.VCon (.ConstDataList l) :: .VLam seedLoop σ :: σ)
      ((seedIn seed l).map fun b => .VCon (.Bool b)) := by
  induction l with
  | nil => ev_go [] []
  | cons x xs ih =>
    rcases x with ⟨t, _ | ⟨r, fs⟩⟩ | _ | _ | _ | _
    all_goals try (ev_go [] []; done)
    simp only [seedIn]
    cases he : PlutusCore.Data.equalsData r seed
    · simp only [Bool.false_eq_true, ↓reduceIte]; ev_go [ih, values_nil_any] [he]
    · simp only [↓reduceIte, Option.map_some]; ev_go [] [he]

/-! ### The fields the check reads -/

/-- i_31, i_38, i_39 and i_40: a list's fifth, third, second and fourth elements. -/
def mnth4Body : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,2,0]
def mnth2Body : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,1,0]
def mnth1Body : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,2,0]
def mnth3Body : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,3,0]

theorem mnth4_ap (σ : Environment) (hHead : List.get?Internal σ 14 = some vHead)
    (hTail : List.get?Internal σ 15 = some vTail) (l : List Data) :
    Ap default (.VLam mnth4Body σ) (.VCon (.ConstDataList l)) (l[4]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, _ | ⟨d, _ | ⟨e, l⟩⟩⟩⟩⟩ <;> ev_go [] []

theorem mnth2_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam mnth2Body σ) (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, l⟩⟩⟩ <;> ev_go [] []

theorem mnth1_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam mnth1Body σ) (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, l⟩⟩ <;> ev_go [] []

theorem mnth3_ap (σ : Environment) (hHead : List.get?Internal σ 19 = some vHead)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam mnth3Body σ) (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, _ | ⟨d, l⟩⟩⟩⟩ <;> ev_go [] []

/-! ### The output search -/

/-- An output to the reference holder: its payment credential the script `rh`, no stake part,
no reference script, and exactly one of the pool's NFT `(P, nm)` in its value. -/
def outCond (rh P nm : ByteString) : Data → Option Bool
  | .Constr _ (addr :: ofs) =>
    match addr with
    | .Constr _ (cred :: afs) =>
      match cred with
      | .Constr ct cfs =>
        if PlutusCore.Integer.equalsInteger 1 ct then
          match cfs with
          | .B h :: _ =>
            if PlutusCore.ByteString.equalsByteString h rh then
              match afs with
              | st :: _ =>
                if PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) st then
                  match ofs with
                  | v :: _ :: rs :: _ =>
                    if PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) rs then
                      match v with
                      | .Map vm =>
                        match tokensOf P vm with
                        | some toks => (qtyOf nm toks).map (PlutusCore.Integer.equalsInteger 1)
                        | none => none
                      | _ => none
                    else some false
                  | _ => none
                else some false
              | [] => none
            else some false
          | _ => none
        else some false
      | _ => none
    | _ => none
  | _ => none

/-- The first output to the reference holder, if any (i_43). -/
def findOut (rh P nm : ByteString) : List Data → Option (Option Data)
  | [] => some none
  | o :: os =>
    match outCond rh P nm o with
    | some true => some (some o)
    | some false => findOut rh P nm os
    | none => none

def outLoop : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,1,1,0]
def outBody : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,1,1,0,0]
/-- The search's condition on the output `o`. -/
def outCondTerm : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,1,1,0,0,0,0,2,0,0,0,0,0,0]

theorem out_cond (ρ σ32 : Environment) (rh P nm : ByteString) (v39 v40 : CekValue)
    (hNm : List.get?Internal ρ 2 = some (.VCon (.ByteString nm)))
    (h41 : List.get?Internal ρ 3 = some (vEq 1))
    (h40 : List.get?Internal ρ 4 = some v40)
    (hv40 : ∀ l : List Data, Ap default v40 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h39 : List.get?Internal ρ 5 = some v39)
    (hv39 : ∀ l : List Data, Ap default v39 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h32 : List.get?Internal ρ 9 = some (.VLam tokensFn σ32))
    (h32Ite : List.get?Internal σ32 9 = some vIte) (h32Fst : List.get?Internal σ32 10 = some vFst)
    (h32Snd : List.get?Internal σ32 11 = some vSnd) (h32CL : List.get?Internal σ32 12 = some vChooseList)
    (h32Head : List.get?Internal σ32 14 = some vHead) (h32Tail : List.get?Internal σ32 15 = some vTail)
    (hP : List.get?Internal ρ 12 = some (.VCon (.ByteString P)))
    (hRh : List.get?Internal ρ 19 = some (.VCon (.ByteString rh)))
    (hIte : List.get?Internal ρ 22 = some vIte) (hFst : List.get?Internal ρ 23 = some vFst)
    (hSnd : List.get?Internal ρ 24 = some vSnd) (hCL : List.get?Internal ρ 25 = some vChooseList)
    (hMk : List.get?Internal ρ 26 = some vMkCons)
    (hHead : List.get?Internal ρ 27 = some vHead) (hTail : List.get?Internal ρ 28 = some vTail)
    (o : Data) :
    Ev default outCondTerm (.VCon (.Data o) :: ρ) ((outCond rh P nm o).map fun b => .VCon (.Bool b)) := by
  have ht := tokens_apply σ32 P h32Ite h32Fst h32Snd h32CL h32Head h32Tail
  have hq := fun σ' σ71 => qty_loop σ' σ71 nm
  rcases o with ⟨t, _ | ⟨addr, ofs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv39, hv40] []; done)
  rcases addr with ⟨ta, _ | ⟨cred, afs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv39, hv40] []; done)
  rcases cred with ⟨ct, cfs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv39, hv40] []; done)
  simp only [outCond]
  cases h1 : PlutusCore.Integer.equalsInteger 1 ct
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv39, hv40] [h1]
  simp only [↓reduceIte]
  rcases cfs with _ | ⟨hd, cfs⟩
  · simp only [Option.map_none]; ev_go [hv39, hv40] [h1]
  rcases hd with _ | _ | _ | _ | h
  all_goals try (simp only [Option.map_none]; ev_go [hv39, hv40] [h1]; done)
  cases he : PlutusCore.ByteString.equalsByteString h rh
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv39, hv40] [h1, he]
  simp only [↓reduceIte]
  rcases afs with _ | ⟨st, afs⟩
  · simp only [Option.map_none]; ev_go [hv39, hv40] [h1, he]
  cases hs : PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) st
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv39, hv40] [h1, he, hs]
  simp only [↓reduceIte]
  rcases ofs with _ | ⟨v, _ | ⟨d, _ | ⟨rs, ofs⟩⟩⟩
  all_goals try (simp only [Option.map_none]; ev_go [hv39, hv40] [h1, he, hs]; done)
  cases hr : PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) rs
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv39, hv40] [h1, he, hs, hr]
  simp only [↓reduceIte]
  rcases v with _ | vm | _ | _ | _
  all_goals try (simp only [Option.map_none]; ev_go [hv39, hv40] [h1, he, hs, hr]; done)
  cases htk : tokensOf P vm with
  | none => simp only [Option.map_none]; ev_go [hv39, hv40, ht] [h1, he, hs, hr, htk, Option.map_none]
  | some toks =>
    cases hqt : qtyOf nm toks with
    | none =>
      simp only [Option.map_none]
      ev_go [hv39, hv40, ht, hq, values_nil_any] [h1, he, hs, hr, htk, hqt, Option.map_none, Option.map_some]
    | some q =>
      simp only [Option.map_some]
      ev_go [hv39, hv40, ht, hq, values_nil_any] [h1, he, hs, hr, htk, hqt, Option.map_some]

theorem out_loop (σ σ32 : Environment) (rh P nm : ByteString) (v39 v40 : CekValue)
    (hNm : List.get?Internal σ 0 = some (.VCon (.ByteString nm)))
    (h41 : List.get?Internal σ 1 = some (vEq 1))
    (h40 : List.get?Internal σ 2 = some v40)
    (hv40 : ∀ l : List Data, Ap default v40 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h39 : List.get?Internal σ 3 = some v39)
    (hv39 : ∀ l : List Data, Ap default v39 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h32 : List.get?Internal σ 7 = some (.VLam tokensFn σ32))
    (h32Ite : List.get?Internal σ32 9 = some vIte) (h32Fst : List.get?Internal σ32 10 = some vFst)
    (h32Snd : List.get?Internal σ32 11 = some vSnd) (h32CL : List.get?Internal σ32 12 = some vChooseList)
    (h32Head : List.get?Internal σ32 14 = some vHead) (h32Tail : List.get?Internal σ32 15 = some vTail)
    (hP : List.get?Internal σ 10 = some (.VCon (.ByteString P)))
    (hRh : List.get?Internal σ 17 = some (.VCon (.ByteString rh)))
    (hIte : List.get?Internal σ 20 = some vIte) (hFst : List.get?Internal σ 21 = some vFst)
    (hSnd : List.get?Internal σ 22 = some vSnd) (hCL : List.get?Internal σ 23 = some vChooseList)
    (hMk : List.get?Internal σ 24 = some vMkCons)
    (hHead : List.get?Internal σ 25 = some vHead) (hTail : List.get?Internal σ 26 = some vTail)
    (outs : List Data) :
    Ev default outBody (.VCon (.ConstDataList outs) :: .VLam outLoop σ :: σ)
      ((findOut rh P nm outs).map fun o => .VCon (.Data (optData o))) := by
  induction outs with
  | nil => ev_go [] []
  | cons o os ih =>
    have hc := out_cond (.VCon (.ConstDataList (o :: os)) :: .VLam outLoop σ :: σ) σ32 rh P nm v39 v40
      hNm h41 h40 hv40 h39 hv39 h32 h32Ite h32Fst h32Snd h32CL h32Head h32Tail hP hRh hIte hFst hSnd hCL
      hMk hHead hTail o
    cases hco : outCond rh P nm o with
    | none => simp only [findOut, hco, Option.map_none]; ev_go [hc] [hco, Option.map_none]
    | some b =>
      cases b with
      | false => simp only [findOut, hco]; ev_go [hc, ih, values_nil_any] [hco, Option.map_some]
      | true => simp only [findOut, hco, Option.map_some]; ev_go [hc] [hco, Option.map_some]

/-- The output found has its value, datum and reference script fields. -/
theorem findOut_shape {rh P nm : ByteString} {outs : List Data} {o : Data}
    (h : findOut rh P nm outs = some (some o)) :
    ∃ t a v d rs os, o = .Constr t (a :: v :: d :: rs :: os) := by
  induction outs with
  | nil => simp [findOut] at h
  | cons x xs ih =>
    simp only [findOut] at h
    split at h
    · rename_i hx
      obtain rfl : x = o := by simpa using h
      rcases x with ⟨t, _ | ⟨a, _ | ⟨v, _ | ⟨d, _ | ⟨rs, os⟩⟩⟩⟩⟩ | _ | _ | _ | _
      all_goals first
        | exact ⟨_, _, _, _, _, _, rfl⟩
        | (exfalso; revert hx; simp only [outCond]; repeat' split
           all_goals simp_all)
    · exact ih h
    · contradiction

end Lovejoin.Every
