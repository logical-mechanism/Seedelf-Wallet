import Lovejoin.Every.Shared

/-! # The Owner withdrawal

`validate_owner`: at least one box, as many proofs as boxes, and each box's Schnorr proof
verifies against `ctx = blake2b_256(serialise(outputs) ‖ serialise(each input's reference) ‖
mix_script_hash)`. Every input and output any `Data`, every list any length. -/

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

/-- `unConstrData`'s fields, or its error. -/
def fieldsOf : Data → Option (List Data)
  | .Constr _ fs => some fs
  | _ => none

/-- `unListData`'s list, or its error. -/
def listOf : Data → Option (List Data)
  | .List xs => some xs
  | _ => none

/-! ### The transaction hash -/

/-- Each input's first field, its output reference (i_115). -/
def inputRefs : List Data → Option (List Data)
  | [] => some []
  | x :: xs =>
    match x with
    | .Constr _ (r :: _) => (inputRefs xs).map (r :: ·)
    | _ => none

def refsAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,1,1,0,1,1,1,1,1]
def refsLoop : Term := sub (refsAt ++ [0])
def refsBody : Term := sub (refsAt ++ [0, 0])

theorem refsLoop_shape : refsLoop = .Lam refsBody := rfl

set_option maxHeartbeats 0

theorem refs_loop (σ : Environment)
    (hSnd : List.get?Internal σ 31 = some vSnd) (hCL : List.get?Internal σ 32 = some vChooseList)
    (hMk : List.get?Internal σ 33 = some vMkCons)
    (hHead : List.get?Internal σ 34 = some vHead) (hTail : List.get?Internal σ 35 = some vTail)
    (l : List Data) :
    Ev default refsBody (.VCon (.ConstDataList l) :: .VLam refsLoop σ :: σ)
      ((inputRefs l).map fun rs => .VCon (.ConstDataList rs)) := by
  induction l with
  | nil => ev_go [] []
  | cons x xs ih =>
    rcases x with ⟨t, _ | ⟨r, fs⟩⟩ | _ | _ | _ | _
    all_goals try (ev_go [] []; done)
    cases hxs : inputRefs xs with
    | none => simp only [inputRefs, hxs, Option.map_none]; ev_go [ih] [hxs, Option.map_none]
    | some rs => simp only [inputRefs, hxs, Option.map_some]; ev_go [ih] [hxs, Option.map_some]

/-- `ctx`: the outputs (the TxInfo's third field) and the inputs' references, serialised by
the builtin, then the reference datum's mix_box hash. -/
def ownerHash (rd info : Data) : Option ByteString := do
  let ifs ← fieldsOf info
  let outs ← (ifs[2]? : Option Data)
  let so ← Lovejoin.Classic.serialised outs
  let ins ← (ifs[0]? : Option Data) >>= listOf
  let rs ← inputRefs ins
  let sr ← Lovejoin.Classic.serialised (.List rs)
  let rfs ← fieldsOf rd
  let msh ← (rfs[5]? : Option Data) >>= bytesOf
  pure (blake2b_256 (appendByteString (appendByteString so sr) msh))

def hashTerm : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,1]

/-- `listData`'s value, as the builtin builds it. -/
theorem listData_eq (xs : List Data) : PlutusCore.Data.listData xs = .List xs := rfl

open PlutusCore.UPLC.BuiltinFunctions.Data (encodeDataOpaque) in
theorem owner_hash (ρ : Environment) (rd info : Data) (v72 v74 : CekValue)
    (hRd : List.get?Internal ρ 5 = some (.VCon (.Data rd)))
    (h74 : List.get?Internal ρ 12 = some v74)
    (hv74 : ∀ l : List Data, Ap default v74 (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 14 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hInfo : List.get?Internal ρ 20 = some (.VCon (.Data info)))
    (hSnd : List.get?Internal ρ 31 = some vSnd) (hCL : List.get?Internal ρ 32 = some vChooseList)
    (hMk : List.get?Internal ρ 33 = some vMkCons)
    (hHead : List.get?Internal ρ 34 = some vHead) (hTail : List.get?Internal ρ 35 = some vTail) :
    Ev default hashTerm ρ ((ownerHash rd info).map fun h => .VCon (.ByteString h)) := by
  have hr := refs_loop ρ hSnd hCL hMk hHead hTail
  rcases info with ⟨ti, _ | ⟨f0, _ | ⟨f1, _ | ⟨outs, ifs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72, hv74, hr] []; done)
  simp only [ownerHash, fieldsOf, Lovejoin.Classic.serialised, List.getElem?_cons_succ,
    List.getElem?_cons_zero]
  cases hso : encodeDataOpaque outs with
  | none => simp; ev_go [hv72, hv74, hr] [hso]
  | some so =>
    rcases f0 with _ | _ | ins | _ | _
    all_goals try (simp [listOf]; ev_go [hv72, hv74, hr] [hso]; done)
    cases hrs : inputRefs ins with
    | none => simp [listOf, hrs]; ev_go [hv72, hv74, hr] [hso, hrs, Option.map_none]
    | some rs =>
      cases hsr : encodeDataOpaque (.List rs) with
      | none => simp [listOf, hrs, hsr]; ev_go [hv72, hv74, hr] [listData_eq, hso, hrs, hsr, Option.map_some]
      | some sr =>
        rcases rd with ⟨tr, _ | ⟨r0, _ | ⟨r1, _ | ⟨r2, _ | ⟨r3, _ | ⟨r4, _ | ⟨r5, rfs⟩⟩⟩⟩⟩⟩⟩ | _ | _ | _ | _
        all_goals try (simp [listOf, hrs, hsr]; ev_go [hv72, hv74, hr] [listData_eq, hso, hrs, hsr, Option.map_some]; done)
        rcases r5 with _ | _ | _ | _ | msh
        all_goals (simp [listOf, hrs, hsr, bytesOf]; ev_go [hv72, hv74, hr] [listData_eq, hso, hrs, hsr, Option.map_some])

/-! ### Each box's proof -/

def prefixAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,2,0,0,0,0,0,0,1,1,0,1,1,1,0,1,0,1,
   0,1,0,1]
/-- `domain_tag_v1 ‖ statement_id_prove_dlog`, the constant the program holds: the bytes of
"lovejoin/sigmajoin/v1/" and 0x01. -/
def prefix01 : ByteString :=
  match sub prefixAt with
  | .Const (.ByteString b) => b
  | _ => default

theorem prefix01_shape : sub prefixAt = .Const (.ByteString prefix01) := rfl

/-- `schnorr.verify(a, b, proof, ctx)` for the box `Constr _ [B a, B b, …]` and the proof
`Constr _ [B t, B z, …]`, in the compiled order; a bad encoding or scalar is an error. -/
def ownerPred (ctx : ByteString) (box proof : Data) : Option Bool := do
  let bfs ← fieldsOf box
  let a ← (bfs[0]? : Option Data) >>= bytesOf
  let b ← (bfs[1]? : Option Data) >>= bytesOf
  let pfs ← fieldsOf proof
  let z ← (pfs[1]? : Option Data) >>= bytesOf
  let zs ← scalarOf z
  let A ← (bls12_381_G1_uncompress a).toOption
  let t ← (pfs[0]? : Option Data) >>= bytesOf
  let T ← (bls12_381_G1_uncompress t).toOption
  let B ← (bls12_381_G1_uncompress b).toOption
  pure (bls12_381_G1_equal (bls12_381_G1_scalarMul zs A)
    (bls12_381_G1_add T (bls12_381_G1_scalarMul (scalarMod (blake2b_256 (appendByteString
      (appendByteString (appendByteString (appendByteString prefix01 a) b) t) ctx))) B)))

/-- `λ i_111 i_112. …`'s body. -/
def ownerPredBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,2,0,0]

theorem owner_pred (σ : Environment) (ctx : ByteString) (v73 v80 v106 : CekValue)
    (hCtx : List.get?Internal σ 0 = some (.VCon (.ByteString ctx)))
    (h106 : List.get?Internal σ 4 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (h80 : List.get?Internal σ 7 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h73 : List.get?Internal σ 14 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (hSnd : List.get?Internal σ 32 = some vSnd) (hHead : List.get?Internal σ 35 = some vHead)
    (box proof : Data) :
    Ev default ownerPredBody (.VCon (.Data proof) :: .VCon (.Data box) :: σ)
      ((ownerPred ctx box proof).map fun b => .VCon (.Bool b)) := by
  rcases box with ⟨tb, _ | ⟨a, bfs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  rcases a with _ | _ | _ | _ | a
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  rcases bfs with _ | ⟨b, bfs⟩
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  rcases b with _ | _ | _ | _ | b
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  rcases proof with ⟨tp, _ | ⟨t, _ | ⟨z, pfs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  rcases z with _ | _ | _ | _ | z
  all_goals try (ev_go [hv73, hv80, hv106] []; done)
  simp only [ownerPred, fieldsOf, bytesOf, List.getElem?_cons_succ, List.getElem?_cons_zero,
    Option.bind_eq_bind, Option.some_bind]
  cases hz : scalarOf z with
  | none => simp only [Option.none_bind, Option.map_none]; ev_go [hv73, hv80, hv106] [hz, Option.map_none]
  | some zs =>
    simp only [Option.some_bind]
    cases hA : bls12_381_G1_uncompress a with
    | error e => simp [Except.toOption]; ev_go [hv73, hv80, hv106] [hz, hA, Option.map_some]
    | ok A =>
      simp only [Except.toOption, Option.some_bind]
      rcases t with _ | _ | _ | _ | t
      all_goals try (simp; ev_go [hv73, hv80, hv106] [hz, hA, Option.map_some]; done)
      simp only [Option.some_bind]
      cases hT : bls12_381_G1_uncompress t with
      | error e => simp [Except.toOption]; ev_go [hv73, hv80, hv106] [hz, hA, hT, Option.map_some]
      | ok T =>
        simp only [Except.toOption, Option.some_bind]
        cases hB : bls12_381_G1_uncompress b with
        | error e => simp [Except.toOption]; ev_go [hv73, hv80, hv106] [hz, hA, hT, hB, Option.map_some]
        | ok B =>
          simp only [Except.toOption, Option.some_bind, Option.map_some]
          ev_go [hv73, hv80, hv106] [hz, hA, hT, hB, Option.map_some]

/-- `owner_pred` for every box and proof at once, as the pairwise loop asks for it. -/
theorem owner_pred_all (σ : Environment) (ctx : ByteString) (v73 v80 v106 : CekValue)
    (hCtx : List.get?Internal σ 0 = some (.VCon (.ByteString ctx)))
    (h106 : List.get?Internal σ 4 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (h80 : List.get?Internal σ 7 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h73 : List.get?Internal σ 14 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (hSnd : List.get?Internal σ 32 = some vSnd) (hHead : List.get?Internal σ 35 = some vHead) :
    ∀ box proof : Data, Ev default ownerPredBody (.VCon (.Data proof) :: .VCon (.Data box) :: σ)
      ((ownerPred ctx box proof).map fun b => .VCon (.Bool b)) :=
  fun box proof => owner_pred σ ctx v73 v80 v106 hCtx h106 hv106 h80 hv80 h73 hv73 hSnd hHead box proof

/-! ### The branch -/

/-- `validate_owner(self, reference_datum, mix_inputs, proofs)`: the redeemer's one field is
the proof list. -/
def ownerResult (rd info red : Data) (boxes : List Data) : Option Bool :=
  match red with
  | .Constr _ (pl :: _) =>
    match pl with
    | .List ps =>
      if PlutusCore.Integer.lessThanEqualsInteger 1 (countOf boxes) then
        if PlutusCore.Integer.equalsInteger (countOf ps) (countOf boxes) then
          match ownerHash rd info with
          | some ctx => pairsAll (ownerPred ctx) boxes ps
          | none => none
        else none
      else none
    | _ => none
  | _ => none

/-- The Owner branch of the main body (a redeemer of tag 0). -/
def ownerBranch : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,1,0]

theorem owner_branch (ρ σ78 : Environment) (rd info red : Data) (boxes : List Data)
    (v72 v73 v74 v80 v106 v107 : CekValue)
    (h107 : List.get?Internal ρ 0 = some v107)
    (hv107 : ∀ l : List Data, Ap default v107 (.VCon (.ConstDataList l)) (some (.VCon (.Integer (countOf l)))))
    (h106 : List.get?Internal ρ 1 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (hBoxes : List.get?Internal ρ 2 = some (.VCon (.ConstDataList boxes)))
    (hRd : List.get?Internal ρ 3 = some (.VCon (.Data rd)))
    (h80 : List.get?Internal ρ 4 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h78 : List.get?Internal ρ 6 = some (.VLam (.Lam (.Lam pairsEntry)) σ78))
    (h78Ite : List.get?Internal σ78 14 = some vIte) (h78CL : List.get?Internal σ78 17 = some vChooseList)
    (h78Mk : List.get?Internal σ78 18 = some vMkCons)
    (h78Head : List.get?Internal σ78 19 = some vHead) (h78Tail : List.get?Internal σ78 20 = some vTail)
    (h74 : List.get?Internal ρ 10 = some v74)
    (hv74 : ∀ l : List Data, Ap default v74 (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)))
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 12 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hRed : List.get?Internal ρ 17 = some (.VCon (.Data red)))
    (hInfo : List.get?Internal ρ 18 = some (.VCon (.Data info)))
    (hIte : List.get?Internal ρ 27 = some vIte) (hSnd : List.get?Internal ρ 29 = some vSnd)
    (hCL : List.get?Internal ρ 30 = some vChooseList) (hMk : List.get?Internal ρ 31 = some vMkCons)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail) :
    Ev default ownerBranch ρ ((ownerResult rd info red boxes).map fun b => .VCon (.Bool b)) := by
  rcases red with ⟨tr, _ | ⟨pl, rfs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv107] []; done)
  rcases pl with _ | _ | ps | _ | _
  all_goals try (ev_go [hv107] []; done)
  simp only [ownerResult]
  cases h1 : PlutusCore.Integer.lessThanEqualsInteger 1 (countOf boxes)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h1] []
  cases h2 : PlutusCore.Integer.equalsInteger (countOf ps) (countOf boxes)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h1] [h2]
  simp only [↓reduceIte]
  cases hh : ownerHash rd info with
  | none =>
    simp only [Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h1, owner_hash] [h2, hh, Option.map_none]
  | some ctx =>
    have hp := owner_pred_all
      (.VCon (.ByteString ctx) :: .VCon (.Integer (countOf boxes)) :: .VCon (.ConstDataList ps) :: ρ)
      ctx v73 v80 v106 rfl h106 hv106 h80 hv80 h73 hv73 hSnd hHead
    ev_go [hv107, ap_lessThanEquals _ _ _ h1, owner_hash, pairs_apply, hp, values_nil_any]
      [h2, hh, Option.map_some]

end Lovejoin.Every
