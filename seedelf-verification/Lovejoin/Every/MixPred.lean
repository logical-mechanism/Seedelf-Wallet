import Lovejoin.Every.Fold

/-! # Each box's Mix proof

The Mix predicate, run on each box in with its proof: the box's two points; at least two
statements; the Fiat-Shamir check, `blake2b_256(pre ‖ a ‖ b ‖ each statement's points ‖ each
branch's commitments ‖ ctx)` equal to the xor of the branches' challenges (xor32's fix); then
every branch's two Σ-protocol equations against its statement, the statements and branches
paired off in order (i_153). A bad encoding, scalar or point is an error. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

set_option maxHeartbeats 0

/-- Reduce a spec's binds once a field's shape is known; nothing if there is nothing to do. -/
macro "bsimp" : tactic => `(tactic| try simp only [fieldsOf, bytesOf, listOf, List.getElem?_cons_succ,
  List.getElem?_cons_zero, List.getElem?_nil, Option.bind_eq_bind, Option.bind_some, Option.bind_none,
  Except.toOption, Option.map_none, Option.map_some])

/-- i_130, `nth3`, is the list's fourth element, or an error if it is shorter. -/
theorem nth3_ap (ρ : Environment) (hHead : List.get?Internal ρ 32 = some vHead)
    (hTail : List.get?Internal ρ 33 = some vTail) (l : List Data) :
    Ap default (.VLam nth3Fn ρ) (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)) := by
  apply ap_lam
  rcases l with _ | ⟨a, _ | ⟨b, _ | ⟨c, _ | ⟨d, l⟩⟩⟩⟩ <;> ev_go [] []

/-! ### One branch -/

/-- A branch `[t0, t1, c, z]` against its statement `[a, b, A', B']`: the scalars, the points,
then `z·A = t0 + c·A'` and `z·B = t1 + c·B'`. -/
def branchOk (A B : BLS12_381_G1_Element) (st br : Data) : Option Bool := do
  let bfs ← fieldsOf br
  let z ← (bfs[3]? : Option Data) >>= bytesOf
  let zs ← scalarOf z
  let c ← (bfs[2]? : Option Data) >>= bytesOf
  let t0 ← (bfs[0]? : Option Data) >>= bytesOf
  let T0 ← (bls12_381_G1_uncompress t0).toOption
  let sfs ← fieldsOf st
  let p2 ← (sfs[2]? : Option Data) >>= bytesOf
  let P2 ← (bls12_381_G1_uncompress p2).toOption
  if bls12_381_G1_equal (bls12_381_G1_scalarMul zs A)
      (bls12_381_G1_add T0 (bls12_381_G1_scalarMul (scalarMod c) P2)) then
    let t1 ← (bfs[1]? : Option Data) >>= bytesOf
    let T1 ← (bls12_381_G1_uncompress t1).toOption
    let p3 ← (sfs[3]? : Option Data) >>= bytesOf
    let P3 ← (bls12_381_G1_uncompress p3).toOption
    pure (bls12_381_G1_equal (bls12_381_G1_scalarMul zs B)
      (bls12_381_G1_add T1 (bls12_381_G1_scalarMul (scalarMod c) P3)))
  else pure false

/-- i_153, `λ self stmts branches`. -/
def parAt : List Nat := predAt ++ [0,0,2,0,0,0,1,0,0,0,0,0,1]
def parLoop : Term := sub (parAt ++ [0])
def parBody : Term := sub (parAt ++ [0,0,0])
/-- The condition each statement and branch are checked by. -/
def pairCond : Term := sub (parAt ++ [0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,2,0,0,0,0,0,0])

theorem parLoop_shape : parLoop = .Lam (.Lam parBody) := rfl

theorem pair_cond (σ : Environment) (A B : BLS12_381_G1_Element) (v72 v73 v80 v106 v130 : CekValue)
    (hB : List.get?Internal σ 6 = some (.VCon (.Bls12_381_G1_element B)))
    (hA : List.get?Internal σ 7 = some (.VCon (.Bls12_381_G1_element A)))
    (h130 : List.get?Internal σ 21 = some v130)
    (hv130 : ∀ l : List Data, Ap default v130 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h106 : List.get?Internal σ 25 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (h80 : List.get?Internal σ 28 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h73 : List.get?Internal σ 35 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal σ 36 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hIte : List.get?Internal σ 51 = some vIte) (hSnd : List.get?Internal σ 53 = some vSnd)
    (hHead : List.get?Internal σ 56 = some vHead)
    (st br : Data) (brs : List Data) :
    Ev default pairCond (.VCon (.Data st) :: .VCon (.ConstDataList (br :: brs)) :: σ)
      ((branchOk A B st br).map fun b => .VCon (.Bool b)) := by
  rcases br with ⟨tb, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, bfs⟩⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv73, hv80, hv106, hv130] []; done)
  rcases f3 with _ | _ | _ | _ | z
  all_goals try (ev_go [hv72, hv73, hv80, hv106, hv130] []; done)
  simp only [branchOk]
  bsimp
  cases hz : scalarOf z with
  | none => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, Option.map_none]
  | some zs =>
    bsimp
    rcases f2 with _ | _ | _ | _ | c
    all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, Option.map_some]; done)
    rcases f0 with _ | _ | _ | _ | t0
    all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, Option.map_some]; done)
    bsimp
    cases hT0 : bls12_381_G1_uncompress t0 with
    | error e => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, Option.map_some]
    | ok T0 =>
      bsimp
      rcases st with ⟨ts, _ | ⟨s0, _ | ⟨s1, _ | ⟨s2, sfs⟩⟩⟩⟩ | _ | _ | _ | _
      all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, Option.map_some]; done)
      rcases s2 with _ | _ | _ | _ | p2
      all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, Option.map_some]; done)
      bsimp
      cases hP2 : bls12_381_G1_uncompress p2 with
      | error e => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, Option.map_some]
      | ok P2 =>
        bsimp
        cases he : bls12_381_G1_equal (bls12_381_G1_scalarMul zs A)
            (bls12_381_G1_add T0 (bls12_381_G1_scalarMul (scalarMod c) P2))
        · simp only [Bool.false_eq_true, ↓reduceIte]
          bsimp
          ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, Option.map_some]
        simp only [↓reduceIte]
        rcases f1 with _ | _ | _ | _ | t1
        all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, Option.map_some]; done)
        bsimp
        cases hT1 : bls12_381_G1_uncompress t1 with
        | error e => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, hT1, Option.map_some]
        | ok T1 =>
          bsimp
          rcases sfs with _ | ⟨s3, sfs⟩
          · bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, hT1, Option.map_some]
          rcases s3 with _ | _ | _ | _ | p3
          all_goals try (bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, hT1, Option.map_some]; done)
          bsimp
          cases hP3 : bls12_381_G1_uncompress p3 with
          | error e => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, hT1, hP3, Option.map_some]
          | ok P3 => bsimp; ev_go [hv72, hv73, hv80, hv106, hv130] [hz, hT0, hP2, he, hT1, hP3, Option.map_some]

/-- The loop is `pairsAll (branchOk A B)`, for any two lists. -/
theorem par_loop (σ : Environment) (A B : BLS12_381_G1_Element) (v72 v73 v80 v106 v130 : CekValue)
    (hB : List.get?Internal σ 0 = some (.VCon (.Bls12_381_G1_element B)))
    (hA : List.get?Internal σ 1 = some (.VCon (.Bls12_381_G1_element A)))
    (h130 : List.get?Internal σ 15 = some v130)
    (hv130 : ∀ l : List Data, Ap default v130 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h106 : List.get?Internal σ 19 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (h80 : List.get?Internal σ 22 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h73 : List.get?Internal σ 29 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal σ 30 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hIte : List.get?Internal σ 45 = some vIte) (hSnd : List.get?Internal σ 47 = some vSnd)
    (hCL : List.get?Internal σ 48 = some vChooseList) (hMk : List.get?Internal σ 49 = some vMkCons)
    (hHead : List.get?Internal σ 50 = some vHead) (hTail : List.get?Internal σ 51 = some vTail)
    (sts brs : List Data) :
    Ev default parBody (.VCon (.ConstDataList brs) :: .VCon (.ConstDataList sts) :: .VLam parLoop σ :: σ)
      ((pairsAll (branchOk A B) sts brs).map fun b => .VCon (.Bool b)) := by
  have hc := fun σ' => pair_cond σ' A B v72 v73 v80 v106 v130
  induction sts generalizing brs with
  | nil => cases brs <;> ev_go [listData_eq] [listData_eq]
  | cons st sts ih =>
    cases brs with
    | nil => ev_go [listData_eq] [listData_eq]
    | cons br brs =>
      cases hp : branchOk A B st br with
      | none =>
        simp only [pairsAll, hp, Option.map_none]
        ev_go [hc, hv72, hv73, hv80, hv106, hv130] [listData_eq, hp, Option.map_none]
      | some b =>
        cases b with
        | false =>
          simp only [pairsAll, hp, Option.map_some]
          ev_go [hc, hv72, hv73, hv80, hv106, hv130] [listData_eq, hp, Option.map_some]
        | true =>
          simp only [pairsAll, hp]
          ev_go [hc, hv72, hv73, hv80, hv106, hv130, ih, values_nil_any] [listData_eq, hp, Option.map_some]

/-! ### The predicate -/

def zeroAt : List Nat := predAt ++ [0,0,2,0,0,0,0,1,0,1]
/-- The xor's start, 32 zero bytes, as the program holds it (`zero32_shape`). Reducible, so a
fact about it rewrites the program's own literal. -/
abbrev zero32 : ByteString := ⟨"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"⟩

theorem zero32_shape : sub zeroAt = .Const (.ByteString zero32) := rfl

/-- At least two statements, the Fiat-Shamir check, the box's points, then every branch. -/
def mixCheck (pre ctx : ByteString) (sts : List Data) (a b : ByteString) (proof : Data) : Option Bool :=
  match sts with
  | _ :: _ :: _ => do
    let pfs ← fieldsOf proof
    let brs ← (pfs[0]? : Option Data) >>= listOf
    let h1 ← foldOpt catStep sts (appendByteString (appendByteString pre a) b)
    let h2 ← foldOpt catStep brs h1
    let cx ← foldOpt xorStep brs zero32
    if PlutusCore.ByteString.equalsByteString (blake2b_256 (appendByteString h2 ctx)) cx then
      let A ← (bls12_381_G1_uncompress a).toOption
      let B ← (bls12_381_G1_uncompress b).toOption
      pairsAll (branchOk A B) sts brs
    else none
  | _ => none

/-- The Mix predicate for the box `Constr _ [B a, B b, …]` and its proof `Constr _ [List
branches, …]`, with `pre` the Mix prefix and the box count, `ctx` the transaction hash, and
`sts` the statements in output order. -/
def mixPred (pre ctx : ByteString) (sts : List Data) (box proof : Data) : Option Bool := do
  let bfs ← fieldsOf box
  let a ← (bfs[0]? : Option Data) >>= bytesOf
  let b ← (bfs[1]? : Option Data) >>= bytesOf
  mixCheck pre ctx sts a b proof

/-- `λ box proof. …`'s body. -/
def mixPredBody : Term :=
  sub (mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,2,0,0])

theorem mix_pred (σ ρf : Environment) (pre ctx : ByteString) (sts : List Data)
    (v72 v73 v80 v106 v130 : CekValue)
    (hPre : List.get?Internal σ 0 = some (.VCon (.ByteString pre)))
    (hSts : List.get?Internal σ 1 = some (.VCon (.ConstDataList sts)))
    (hCtx : List.get?Internal σ 2 = some (.VCon (.ByteString ctx)))
    (h131 : List.get?Internal σ 8 = some (.VLam foldFn ρf))
    (hfCL : List.get?Internal ρf 30 = some vChooseList)
    (hfHead : List.get?Internal ρf 32 = some vHead) (hfTail : List.get?Internal ρf 33 = some vTail)
    (h130 : List.get?Internal σ 9 = some v130)
    (hv130 : ∀ l : List Data, Ap default v130 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h106 : List.get?Internal σ 13 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (h80 : List.get?Internal σ 16 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h79 : List.get?Internal σ 17 = some (vEq 32))
    (h73 : List.get?Internal σ 23 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal σ 24 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hIte : List.get?Internal σ 39 = some vIte) (hSnd : List.get?Internal σ 41 = some vSnd)
    (hCL : List.get?Internal σ 42 = some vChooseList) (hMk : List.get?Internal σ 43 = some vMkCons)
    (hHead : List.get?Internal σ 44 = some vHead) (hTail : List.get?Internal σ 45 = some vTail)
    (box proof : Data) :
    Ev default mixPredBody (.VCon (.Data proof) :: .VCon (.Data box) :: σ)
      ((mixPred pre ctx sts box proof).map fun b => .VCon (.Bool b)) := by
  rcases box with ⟨tb, bfs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  rcases bfs with _ | ⟨a, bfs⟩
  all_goals try (ev_go [hv73] []; done)
  rcases a with _ | _ | _ | _ | a
  all_goals try (ev_go [hv73] []; done)
  rcases bfs with _ | ⟨b, bfs⟩
  all_goals try (ev_go [hv73] []; done)
  rcases b with _ | _ | _ | _ | b
  all_goals try (ev_go [hv73] []; done)
  simp only [mixPred]
  bsimp
  rcases sts with _ | ⟨s0, _ | ⟨s1, sts⟩⟩
  all_goals try (simp only [mixCheck, Option.map_none]; ev_go [hv73] []; done)
  -- The three folds' steps, in the environment the predicate makes them in.
  have hcat := cat_ev (.VCon (.ByteString b) :: .VCon (.ByteString a) :: .VCon (.Data proof) ::
    .VCon (.Data (.Constr tb (.B a :: .B b :: bfs))) :: σ) v73 h73 hv73 hSnd hHead
  have hxor := xor_ev (.VCon (.ByteString b) :: .VCon (.ByteString a) :: .VCon (.Data proof) ::
    .VCon (.Data (.Constr tb (.B a :: .B b :: bfs))) :: σ) v72 h79 h72 hv72 hIte hSnd
  simp only [mixCheck]
  rcases proof with ⟨tp, _ | ⟨pl, pfs⟩⟩ | _ | _ | _ | _
  all_goals try (bsimp; ev_go [hv73] []; done)
  rcases pl with _ | _ | brs | _ | _
  all_goals try (bsimp; ev_go [hv73] []; done)
  bsimp
  cases h1 : foldOpt catStep (s0 :: s1 :: sts) (appendByteString (appendByteString pre a) b) with
  | none =>
    bsimp
    ev_go [hv73, fold_apply, hcat, values_nil_any] [h1, Option.map_none]
  | some h1v =>
    bsimp
    cases h2 : foldOpt catStep brs h1v with
    | none =>
      bsimp
      ev_go [hv73, fold_apply, hcat, values_nil_any] [h1, h2, Option.map_none, Option.map_some]
    | some h2v =>
      bsimp
      cases hx : foldOpt xorStep brs zero32 with
      | none =>
        bsimp
        ev_go [hv73, fold_apply, hcat, hxor, values_nil_any] [h1, h2, hx, Option.map_none, Option.map_some]
      | some cx =>
        bsimp
        cases he : PlutusCore.ByteString.equalsByteString (blake2b_256 (appendByteString h2v ctx)) cx
        · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
          ev_go [hv73, fold_apply, hcat, hxor, values_nil_any] [h1, h2, hx, he, Option.map_some]
        simp only [↓reduceIte]
        cases hA : bls12_381_G1_uncompress a with
        | error e =>
          bsimp
          ev_go [hv73, fold_apply, hcat, hxor, values_nil_any] [h1, h2, hx, he, hA, Option.map_some]
        | ok A =>
          bsimp
          cases hB : bls12_381_G1_uncompress b with
          | error e =>
            bsimp
            ev_go [hv73, fold_apply, hcat, hxor, values_nil_any] [h1, h2, hx, he, hA, hB, Option.map_some]
          | ok B =>
            bsimp
            have hpar := fun σ' => par_loop σ' A B v72 v73 v80 v106 v130
            ev_go [hv73, fold_apply, hcat, hxor, hpar, hv72, hv80, hv106, hv130, values_nil_any]
              [listData_eq, h1, h2, hx, he, hA, hB, Option.map_some]

end Lovejoin.Every
