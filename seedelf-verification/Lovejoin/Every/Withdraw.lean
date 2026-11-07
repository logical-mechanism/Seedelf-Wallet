import Lovejoin.Every.Mix
import Lovejoin.Template.AnyTxPurposes

/-! # The withdrawal, from the program's root

mix_logic applied to the pool's NFT policy and name and a context whose purpose is a withdrawal
(`Constr 2 [cred]`). The redeemer's tag picks the action and its shape is checked before the main
body runs: an Owner redeemer is `Constr 0 [List proofs]`, each proof `Constr 0 [B, B]`; a Mix
redeemer is `Constr 1 [List proofs]`, each proof `Constr 0 [List branches]`, each branch
`Constr 0 [B, B, B, B]`; any other tag is an error. The walks over the proofs and branches run
through the program's fixpoint combinator (i_28). Every field any `Data`, every list any
length. -/

namespace Lovejoin.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (purposeCtx)

set_option maxHeartbeats 0

/-! ### The redeemer's shapes, in the order the compiled code reads them -/

/-- An Owner proof: `Constr 0 [B t, B z]` (z's bytes read first). -/
def ownerProof : Data → Bool
  | .Constr tp pfs =>
    if PlutusCore.Integer.equalsInteger 0 tp then
      match pfs with
      | f0 :: f1 :: rest =>
        match f1, f0, rest with
        | .B _, .B _, [] => true
        | _, _, _ => false
      | _ => false
    else false
  | _ => false

def allOwnerProofs : List Data → Bool
  | [] => true
  | p :: ps => ownerProof p && allOwnerProofs ps

/-- A Mix branch: `Constr 0 [B t0, B t1, B c, B z]` (z's bytes read first). -/
def mixBranchOk : Data → Bool
  | .Constr tb bfs =>
    if PlutusCore.Integer.equalsInteger 0 tb then
      match bfs with
      | f0 :: f1 :: f2 :: f3 :: rest =>
        match f3, f0, f1, f2, rest with
        | .B _, .B _, .B _, .B _, [] => true
        | _, _, _, _, _ => false
      | _ => false
    else false
  | _ => false

def allMixBranches : List Data → Bool
  | [] => true
  | b :: bs => mixBranchOk b && allMixBranches bs

/-- A Mix proof: `Constr 0 [List branches]`, every branch well formed. -/
def mixProof : Data → Bool
  | .Constr tp pfs =>
    if PlutusCore.Integer.equalsInteger 0 tp then
      match pfs with
      | [.List brs] => allMixBranches brs
      | _ => false
    else false
  | _ => false

def allMixProofs : List Data → Bool
  | [] => true
  | p :: ps => mixProof p && allMixProofs ps

/-! ### The walks -/

def comboAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,2]
/-- i_28, `λ list step. fix (λ rec l. step(l, rec)) list`, under its first lambda. -/
def comboFn : Term := sub (comboAt ++ [0])
/-- `step(l, rec)`, the body of the fixpoint's `λ self l`. -/
def comboX : Term := sub (comboAt ++ [0,0,1,0,0])

/-- The Owner check's step `λ l rec`. -/
def ownerStep : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,0,
    0,0,1,0,1,0,0]
/-- The Mix check's step over the proofs. -/
def mixOuterStep : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,2,0,0,0,
    1,0,0,0,0,0,1,0,1,0,0]
/-- The Mix check's step over one proof's branches. -/
def mixInnerStep : Term :=
  sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,2,0,0,0,
    1,0,0,0,0,0,1,0,1,0,0,0,0,2,0,0,0,0,0,1,0,0,0,0,0,1,0,1,0,0]

/-- `a && b` as the walks run it: the first, then the second. -/
theorem ite_and {α : Type} (a b : Bool) (x y : α) :
    (if (a && b) = true then x else y) = (if a = true then (if b = true then x else y) else y) := by
  cases a <;> rfl

theorem owner_walk (σ σs : Environment) (v30 : CekValue) (R : Option CekValue)
    (hStep : List.get?Internal σ 0 = some (.VLam (.Lam ownerStep) σs))
    (h30 : List.get?Internal σs 1 = some v30) (hR : Fo default v30 R)
    (h18 : List.get?Internal σs 8 = some (vEq 0))
    (hIte : List.get?Internal σs 16 = some vIte) (hFst : List.get?Internal σs 17 = some vFst)
    (hSnd : List.get?Internal σs 18 = some vSnd) (hCL : List.get?Internal σs 19 = some vChooseList)
    (hHead : List.get?Internal σs 21 = some vHead) (hTail : List.get?Internal σs 22 = some vTail)
    (ps : List Data) :
    Ev default comboX (.VCon (.ConstDataList ps) :: .VLam (.Lam comboX) σ :: σ)
      (if allOwnerProofs ps then R else none) := by
  induction ps with
  | nil => simp only [allOwnerProofs, ↓reduceIte]; ev_go [hR] []
  | cons p ps ih =>
    rcases p with ⟨tp, pfs⟩ | _ | _ | _ | _
    all_goals try (simp only [allOwnerProofs, ownerProof, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] []; done)
    cases h0 : PlutusCore.Integer.equalsInteger 0 tp
    · simp only [allOwnerProofs, ownerProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
      ev_go [] [h0]
    rcases pfs with _ | ⟨f0, _ | ⟨f1, rest⟩⟩
    all_goals try (simp only [allOwnerProofs, ownerProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f1 with _ | _ | _ | _ | b
    all_goals try (simp only [allOwnerProofs, ownerProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f0 with _ | _ | _ | _ | a
    all_goals try (simp only [allOwnerProofs, ownerProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases rest with _ | ⟨r, rest⟩
    · simp only [allOwnerProofs, ownerProof, h0, Bool.true_and, ↓reduceIte]
      ev_go [ih, values_nil_any] [h0]
    · simp only [allOwnerProofs, ownerProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
      ev_go [] [h0]

theorem branches_walk (σ σs : Environment) (outerRec : CekValue) (p0 : Data) (tl : List Data)
    (K : Option CekValue)
    (hStep : List.get?Internal σ 0 = some (.VLam (.Lam mixInnerStep) σs))
    (h41 : List.get?Internal σs 2 = some outerRec)
    (h40 : List.get?Internal σs 3 = some (.VCon (.ConstDataList (p0 :: tl))))
    (hK : Ap default outerRec (.VCon (.ConstDataList tl)) K)
    (h18 : List.get?Internal σs 12 = some (vEq 0))
    (hIte : List.get?Internal σs 20 = some vIte) (hFst : List.get?Internal σs 21 = some vFst)
    (hSnd : List.get?Internal σs 22 = some vSnd) (hCL : List.get?Internal σs 23 = some vChooseList)
    (hHead : List.get?Internal σs 25 = some vHead) (hTail : List.get?Internal σs 26 = some vTail)
    (brs : List Data) :
    Ev default comboX (.VCon (.ConstDataList brs) :: .VLam (.Lam comboX) σ :: σ)
      (if allMixBranches brs then K else none) := by
  induction brs with
  | nil => simp only [allMixBranches, ↓reduceIte]; ev_go [hK] []
  | cons b bs ih =>
    rcases b with ⟨tb, bfs⟩ | _ | _ | _ | _
    all_goals try (simp only [allMixBranches, mixBranchOk, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] []; done)
    cases h0 : PlutusCore.Integer.equalsInteger 0 tb
    · simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
      ev_go [] [h0]
    rcases bfs with _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, rest⟩⟩⟩⟩
    all_goals try (simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f3 with _ | _ | _ | _ | z
    all_goals try (simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f0 with _ | _ | _ | _ | t0
    all_goals try (simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f1 with _ | _ | _ | _ | t1
    all_goals try (simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases f2 with _ | _ | _ | _ | c
    all_goals try (simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases rest with _ | ⟨r, rest⟩
    · simp only [allMixBranches, mixBranchOk, h0, Bool.true_and, ↓reduceIte]
      ev_go [ih, values_nil_any] [h0]
    · simp only [allMixBranches, mixBranchOk, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
      ev_go [] [h0]

theorem proofs_walk (σ σs σ28 : Environment) (v30 : CekValue) (R : Option CekValue)
    (hStep : List.get?Internal σ 0 = some (.VLam (.Lam mixOuterStep) σs))
    (h30 : List.get?Internal σs 1 = some v30) (hR : Fo default v30 R)
    (h28 : List.get?Internal σs 3 = some (.VLam comboFn σ28))
    (h18 : List.get?Internal σs 8 = some (vEq 0))
    (hIte : List.get?Internal σs 16 = some vIte) (hFst : List.get?Internal σs 17 = some vFst)
    (hSnd : List.get?Internal σs 18 = some vSnd) (hCL : List.get?Internal σs 19 = some vChooseList)
    (hHead : List.get?Internal σs 21 = some vHead) (hTail : List.get?Internal σs 22 = some vTail)
    (ps : List Data) :
    Ev default comboX (.VCon (.ConstDataList ps) :: .VLam (.Lam comboX) σ :: σ)
      (if allMixProofs ps then R else none) := by
  induction ps with
  | nil => simp only [allMixProofs, ↓reduceIte]; ev_go [hR] []
  | cons p ps ih =>
    rcases p with ⟨tp, pfs⟩ | _ | _ | _ | _
    all_goals try (simp only [allMixProofs, mixProof, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] []; done)
    cases h0 : PlutusCore.Integer.equalsInteger 0 tp
    · simp only [allMixProofs, mixProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
      ev_go [] [h0]
    rcases pfs with _ | ⟨x, _ | ⟨y, rest⟩⟩
    all_goals try (simp only [allMixProofs, mixProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    rcases x with _ | _ | brs | _ | _
    all_goals try (simp only [allMixProofs, mixProof, h0, Bool.false_and, Bool.false_eq_true, ↓reduceIte]
                   ev_go [] [h0]; done)
    -- The branches' walk ends in the proofs' walk on the rest.
    have hK := ap_lam (ρ := .VLam (.Lam comboX) σ :: σ) (M := comboX) (ih)
    have hb := fun σ' σs' => branches_walk σ' σs' _ (.Constr tp [.List brs]) ps _ (hK := hK)
    simp only [allMixProofs, mixProof, h0, ↓reduceIte]
    rw [ite_and]
    ev_go [hb, values_nil_any] [h0]

/-! ### The root -/

/-- The withdrawal: the redeemer's tag and shape, then the main body. -/
def withdrawResult (P : ByteString) (info red : Data) : Option Bool :=
  match red with
  | .Constr tr [.List ps] =>
    if PlutusCore.Integer.equalsInteger 0 tr then
      if allOwnerProofs ps then ownerMain P info red else none
    else if PlutusCore.Integer.equalsInteger 1 tr then
      if allMixProofs ps then mixMain P info red else none
    else none
  | _ => none

/-- The program's answer to a result: `()` for true, an error otherwise. -/
def unitIf (r : Option Bool) : Option CekValue :=
  match r with
  | some true => some (.VCon .Unit)
  | _ => none

theorem withdraw_root (P : ByteString) (info red cred : Data) :
    Ev default (applyParams body [toTerm P, toTerm nftName, toTerm (purposeCtx 2 info red [cred])]) []
      (unitIf (withdrawResult P info red)) := by
  rcases red with ⟨tr, rfs⟩ | _ | _ | _ | _
  all_goals try (simp only [withdrawResult, unitIf]; ev_go [] []; done)
  cases h0 : PlutusCore.Integer.equalsInteger 0 tr
  · cases h1 : PlutusCore.Integer.equalsInteger 1 tr
    · -- Neither tag: an error, whatever the fields.
      have hn : withdrawResult P info (.Constr tr rfs) = none := by
        unfold withdrawResult; split <;> simp_all
      rw [hn]
      simp only [unitIf]
      ev_go [] [h0, h1]
    · -- Mix.
      rcases rfs with _ | ⟨x, _ | ⟨y, rfs⟩⟩
      all_goals try (simp only [withdrawResult, unitIf]; ev_go [] [h0, h1]; done)
      rcases x with _ | _ | ps | _ | _
      all_goals try (simp only [withdrawResult, unitIf]; ev_go [] [h0, h1]; done)
      simp only [withdrawResult, h0, h1, Bool.false_eq_true, ↓reduceIte]
      have hm := fun c0 c1 c3 c8 c9 c10 c11 rest => main_mix P info tr [.List ps] h0 c0 c1 c3 c8 c9 c10 c11 rest
      have hw := fun σ σs σ28 v30 => proofs_walk σ σs σ28 v30
        ((mixMain P info (.Constr tr [.List ps])).map fun b => .VCon (.Bool b))
      cases hp : allMixProofs ps
      · simp only [Bool.false_eq_true, ↓reduceIte, unitIf]
        ev_go [hw, hm, values_nil_any] [h0, h1, hp]
      · simp only [↓reduceIte]
        cases hr : mixMain P info (.Constr tr [.List ps]) with
        | none => simp only [unitIf]; ev_go [hw, hm, values_nil_any] [h0, h1, hp, hr, Option.map_none]
        | some b =>
          cases b <;> simp only [unitIf] <;> ev_go [hw, hm, values_nil_any] [h0, h1, hp, hr, Option.map_some]
  · -- Owner: the tag is 0.
    have ht : tr = 0 := by
      simp only [PlutusCore.Integer.equalsInteger, beq_iff_eq] at h0
      exact h0.symm
    subst ht
    rcases rfs with _ | ⟨x, _ | ⟨y, rfs⟩⟩
    all_goals try (simp only [withdrawResult, unitIf]; ev_go [] []; done)
    rcases x with _ | _ | ps | _ | _
    all_goals try (simp only [withdrawResult, unitIf]; ev_go [] []; done)
    simp only [withdrawResult, h0, ↓reduceIte]
    have hm := fun c0 c1 c3 c8 c9 c10 c11 rest => main_owner P info [.List ps] c0 c1 c3 c8 c9 c10 c11 rest
    have hw := fun σ σs v30 => owner_walk σ σs v30
      ((ownerMain P info (.Constr 0 [.List ps])).map fun b => .VCon (.Bool b))
    cases hp : allOwnerProofs ps
    · simp only [Bool.false_eq_true, ↓reduceIte, unitIf]
      ev_go [hw, hm, values_nil_any] [hp]
    · simp only [↓reduceIte]
      cases hr : ownerMain P info (.Constr 0 [.List ps]) with
      | none => simp only [unitIf]; ev_go [hw, hm, values_nil_any] [hp, hr, Option.map_none]
      | some b =>
        cases b <;> simp only [unitIf] <;> ev_go [hw, hm, values_nil_any] [hp, hr, Option.map_some]

end Lovejoin.Every
