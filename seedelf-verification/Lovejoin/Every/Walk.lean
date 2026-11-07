import Lovejoin.Every.Fold

/-! # The Mix's outputs

i_135 walks the TxInfo's outputs in order. The first `n` must each be a box out: at the pool's
mix_box script with no stake part and no reference script, holding exactly the box value, with
an inline datum that is a well-formed `MixDatum`. Each gives a statement and appends its
datum's bytes and the value's bytes. The rest must not be at the script. Every output any
`Data`, the list any length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.BuiltinFunctions.Data (encodeDataOpaque)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-! ### At the script -/

/-- `output_at_script(out, msh)` (i_133): the payment credential is the script `msh`, no stake
part (`None`, `Constr 1 []`, as the program holds it), and no reference script (`None`); a bad
layout is an error. -/
def atScript (msh : ByteString) : Data → Option Bool
  | .Constr _ (addr :: ofs) =>
    match addr with
    | .Constr _ (cred :: afs) =>
      match cred with
      | .Constr ct cfs =>
        if PlutusCore.Integer.equalsInteger 1 ct then
          match cfs with
          | .B h :: _ =>
            if PlutusCore.ByteString.equalsByteString h msh then
              match afs with
              | st :: _ =>
                if PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) st then
                  match ofs with
                  | _ :: _ :: rs :: _ => some (PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) rs)
                  | _ => none
                else some false
              | [] => none
            else some false
          | _ => none
        else some false
      | _ => none
    | _ => none
  | _ => none

/-- An output at the script has the four fields the walk reads. -/
theorem atScript_shape {msh : ByteString} {out : Data} (h : atScript msh out = some true) :
    ∃ t a o1 o2 o3 os, out = .Constr t (a :: o1 :: o2 :: o3 :: os) := by
  rcases out with ⟨t, _ | ⟨a, _ | ⟨o1, _ | ⟨o2, _ | ⟨o3, os⟩⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals first
    | exact ⟨_, _, _, _, _, _, rfl⟩
    | (exfalso; revert h; simp only [atScript]; repeat' split
       all_goals simp_all)

def atBody : Term := sub (mixAt ++ [1,0,0,0,0,0,1,0,0])

set_option maxHeartbeats 0

theorem at_script (ρ : Environment) (ps : List Data) (n : Integer) (v73 : CekValue)
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 15 = some (vEq 1))
    (hIte : List.get?Internal ρ 27 = some vIte) (hFst : List.get?Internal ρ 28 = some vFst)
    (hSnd : List.get?Internal ρ 29 = some vSnd)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail)
    (msh : ByteString) (out : Data) :
    Ev default atBody (.VCon (.ByteString msh) :: .VCon (.Data out) :: envL ps n ρ)
      ((atScript msh out).map fun b => .VCon (.Bool b)) := by
  rcases out with ⟨t, _ | ⟨addr, ofs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  rcases addr with ⟨ta, _ | ⟨cred, afs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  rcases cred with ⟨ct, cfs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  simp only [atScript]
  cases h1 : PlutusCore.Integer.equalsInteger 1 ct
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv73] [h1]
  simp only [↓reduceIte]
  rcases cfs with _ | ⟨hd, cfs⟩
  · simp only [Option.map_none]; ev_go [hv73] [h1]
  rcases hd with _ | _ | _ | _ | h
  all_goals try (simp only [Option.map_none]; ev_go [hv73] [h1]; done)
  cases he : PlutusCore.ByteString.equalsByteString h msh
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv73] [h1, he]
  simp only [↓reduceIte]
  rcases afs with _ | ⟨st, afs⟩
  · simp only [Option.map_none]; ev_go [hv73] [h1, he]
  cases hs : PlutusCore.Data.equalsData (.Constr (Int.ofNat 1) []) st
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]; ev_go [hv73] [h1, he, hs]
  simp only [↓reduceIte]
  rcases ofs with _ | ⟨o1, _ | ⟨o2, _ | ⟨rs, ofs⟩⟩⟩
  all_goals (simp only [Option.map_none, Option.map_some]; ev_go [hv73] [h1, he, hs])

/-! ### The walk -/

/-- The datum a box out carries, decoded strictly: `Constr 0 [B a, B b]`, both 48 bytes and
different (i_183); anything else is an error. -/
def stmtDatum : Data → Option (ByteString × ByteString)
  | .Constr xt (f0 :: f1 :: more) =>
    if PlutusCore.Integer.equalsInteger 0 xt then
      match f0, f1, more with
      | .B a, .B b, [] =>
        if PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString a) then
          if PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString b) then
            if PlutusCore.ByteString.equalsByteString a b then none else some (a, b)
          else none
        else none
      | _, _, _ => none
    else none
  | _ => none

/-- A box out: at the script, its value field exactly `vmap`, its datum inline, and the datum
well formed with points that decompress. Its statement `[a, b, compress A, compress B]` and its
datum. -/
def prefixOut (msh : ByteString) (vmap out : Data) : Option (Data × Data) :=
  match atScript msh out with
  | some true =>
    match out with
    | .Constr _ ofs =>
      match (ofs[1]? : Option Data) with
      | some v =>
        if PlutusCore.Data.equalsData v vmap then
          match (ofs[2]? : Option Data) with
          | some (.Constr dt (x :: _)) =>
            if PlutusCore.Integer.equalsInteger 2 dt then
              match stmtDatum x with
              | some (a, b) =>
                match bls12_381_G1_uncompress a, bls12_381_G1_uncompress b with
                | .ok A, .ok B =>
                  some (.Constr 0 [.B a, .B b, .B (bls12_381_G1_compress A), .B (bls12_381_G1_compress B)], x)
                | _, _ => none
              | none => none
            else none
          | _ => none
        else none
      | none => none
    | _ => none
  | _ => none

/-- The walk (i_173): `k` box outs still to come; the statements so far (last first), the
datums' bytes and the values' bytes. -/
def walk (msh bv : ByteString) (vmap : Data) :
    List Data → Integer → List Data → ByteString → ByteString → Option (List Data × ByteString × ByteString)
  | [], k, sts, ds, vs => if PlutusCore.Integer.equalsInteger 0 k then some (sts, ds, vs) else none
  | out :: outs, k, sts, ds, vs =>
    if PlutusCore.Integer.lessThanInteger 0 k then
      match prefixOut msh vmap out with
      | some (st, x) =>
        match encodeDataOpaque x with
        | some sx =>
          walk msh bv vmap outs (PlutusCore.Integer.addInteger (-1) k) (st :: sts)
            (appendByteString ds ⟨sx⟩) (appendByteString vs bv)
        | none => none
      | none => none
    else
      match atScript msh out with
      | some false => walk msh bv vmap outs 0 sts ds vs
      | _ => none

/-- The walk's three results, as the compiled code returns them. -/
def walkResult (r : List Data × ByteString × ByteString) : CekValue :=
  .VCon (.ConstDataList [.List r.1, .B r.2.1, .B r.2.2])

/-- i_135's value. -/
def walkEntry : Term := sub (mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1])
/-- The walk's closure, `λ self outs k stmts datums values`. -/
def walkAt : List Nat := mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1]
def walkLoop : Term := sub (walkAt ++ [0])
def walkBody : Term := sub (walkAt ++ [0,0,0,0,0,0])

theorem walkLoop_shape : walkLoop = .Lam (.Lam (.Lam (.Lam (.Lam walkBody)))) := rfl

/-- Where the walk's closure lives: the value's bytes, the mix_box hash, the box value. -/
abbrev envW (bv msh : ByteString) (val : List (Data × Data)) (ps : List Data) (n : Integer)
    (ρ : Environment) : Environment :=
  .VCon (.ByteString bv) :: .VCon (.ByteString msh) :: .VCon (.ConstPairDataList val) :: envA ps n ρ

theorem walk_loop (ρ : Environment) (ps : List Data) (n : Integer) (val : List (Data × Data))
    (msh bv : ByteString) (v72 v73 : CekValue)
    (h76 : List.get?Internal ρ 8 = some (.VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)))
    (h75 : List.get?Internal ρ 9 = some (vEq 48))
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 12 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 15 = some (vEq 1))
    (h18 : List.get?Internal ρ 19 = some (vEq 0)) (h17 : List.get?Internal ρ 20 = some (vEq 2))
    (hIte : List.get?Internal ρ 27 = some vIte) (hFst : List.get?Internal ρ 28 = some vFst)
    (hSnd : List.get?Internal ρ 29 = some vSnd) (hCL : List.get?Internal ρ 30 = some vChooseList)
    (hMk : List.get?Internal ρ 31 = some vMkCons)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail)
    (outs : List Data) (k : Integer) (sts : List Data) (ds vs : ByteString) :
    Ev default walkBody
      (.VCon (.ByteString vs) :: .VCon (.ByteString ds) :: .VCon (.ConstDataList sts) :: .VCon (.Integer k) ::
        .VCon (.ConstDataList outs) :: .VLam walkLoop (envW bv msh val ps n ρ) :: envW bv msh val ps n ρ)
      ((walk msh bv (.Map val) outs k sts ds vs).map walkResult) := by
  have ha := at_script ρ ps n v73 h73 hv73 h27 hIte hFst hSnd hHead hTail
  induction outs generalizing k sts ds vs with
  | nil =>
    cases h0 : PlutusCore.Integer.equalsInteger 0 k <;>
      simp only [walk, h0, Bool.false_eq_true, ↓reduceIte, Option.map_none, Option.map_some, walkResult] <;>
      ev_go [] [h0]
  | cons out outs ih =>
    simp only [walk]
    cases hk : PlutusCore.Integer.lessThanInteger 0 k
    · have hL := ap_lessThan _ _ _ hk
      clear hk
      simp only [Bool.false_eq_true, ↓reduceIte]
      cases hs : atScript msh out with
      | none => simp only [Option.map_none]; ev_go [hL, ha, hv72, hv73] [hs, Option.map_none]
      | some b =>
        cases b with
        | true => simp only [Option.map_none]; ev_go [hL, ha, hv72, hv73] [hs, Option.map_some]
        | false => ev_go [hL, ha, hv72, hv73, ih, values_nil_any] [hs, Option.map_some]
    · have hL := ap_lessThan _ _ _ hk
      clear hk
      simp only [↓reduceIte, prefixOut]
      cases hs : atScript msh out with
      | none => simp only [Option.map_none]; ev_go [hL, ha, hv72, hv73] [hs, Option.map_none]
      | some b =>
        cases b with
        | false => simp only [Option.map_none]; ev_go [hL, ha, hv72, hv73] [hs, Option.map_some]
        | true =>
          obtain ⟨t, a0, o1, o2, o3, os, rfl⟩ := atScript_shape hs
          simp only [List.getElem?_cons_succ, List.getElem?_cons_zero]
          cases he : PlutusCore.Data.equalsData o1 (.Map val)
          · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
            ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, Option.map_some]
          simp only [↓reduceIte]
          rcases o2 with ⟨dt, dfs⟩ | _ | _ | _ | _
          all_goals try (simp only [Option.map_none]
                         ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, Option.map_some]; done)
          cases h2 : PlutusCore.Integer.equalsInteger 2 dt
          · rcases dfs with _ | ⟨x, dfs⟩ <;> (try simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]) <;>
              ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, Option.map_some]
          rcases dfs with _ | ⟨x, dfs⟩
          · simp only [Option.map_none]
            ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, Option.map_some]
          simp only [↓reduceIte]
          rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
          all_goals try (simp only [stmtDatum, Option.map_none]
                         ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, Option.map_some]; done)
          cases h0 : PlutusCore.Integer.equalsInteger 0 xt
          · rcases xs with _ | ⟨f0, _ | ⟨f1, more⟩⟩ <;>
              simp only [stmtDatum, h0, Bool.false_eq_true, ↓reduceIte, Option.map_none] <;>
              ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, Option.map_some]
          rcases xs with _ | ⟨f0, _ | ⟨f1, more⟩⟩
          all_goals try (simp only [stmtDatum, Option.map_none]
                         ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, Option.map_some]; done)
          rcases f1 with _ | _ | _ | _ | b
          all_goals try (simp only [stmtDatum, h0, ↓reduceIte, Option.map_none]
                         ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, Option.map_some]; done)
          rcases f0 with _ | _ | _ | _ | a
          all_goals try (simp only [stmtDatum, h0, ↓reduceIte, Option.map_none]
                         ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, Option.map_some]; done)
          rcases more with _ | ⟨m, more⟩
          · simp only [stmtDatum, h0, ↓reduceIte]
            cases ha48 : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString a)
            · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
              ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, ha48, Option.map_some]
            cases hb48 : PlutusCore.Integer.equalsInteger 48 (PlutusCore.ByteString.lengthOfByteString b)
            · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
              ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, ha48, hb48, Option.map_some]
            cases hab : PlutusCore.ByteString.equalsByteString a b
            · simp only [Bool.false_eq_true, ↓reduceIte]
              cases hA : bls12_381_G1_uncompress a with
              | error e =>
                simp only [Option.map_none]
                ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, ha48, hb48, hab, hA, Option.map_some]
              | ok A =>
                cases hB : bls12_381_G1_uncompress b with
                | error e =>
                  simp only [Option.map_none]
                  ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, ha48, hb48, hab, hA, hB, Option.map_some]
                | ok B =>
                  cases hx : encodeDataOpaque (.Constr xt [.B a, .B b]) with
                  | none =>
                    simp only [h2, ↓reduceIte, hx, Option.map_none]
                    ev_go [hL, ha, hv72, hv73]
                      [mapData_eq, hs, he, h2, h0, ha48, hb48, hab, hA, hB, hx, Option.map_some]
                  | some sx =>
                    simp only [h2, ↓reduceIte, hx]
                    ev_go [hL, ha, hv72, hv73, ih, values_nil_any]
                      [mapData_eq, hs, he, h2, h0, ha48, hb48, hab, hA, hB, hx, Option.map_some]
            · simp only [↓reduceIte, Option.map_none]
              ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, ha48, hb48, hab, Option.map_some]
          · simp only [stmtDatum, h0, ↓reduceIte, Option.map_none]
            ev_go [hL, ha, hv72, hv73] [mapData_eq, hs, he, h2, h0, Option.map_some]

/-! ### The walk's entry -/

/-- i_135: the outputs (the TxInfo's third field) walked for `n` box outs, with the box value's
bytes. -/
def walkFrom (msh : ByteString) (val : List (Data × Data)) (info : Data) (n : Integer) :
    Option (List Data × ByteString × ByteString) :=
  match encodeDataOpaque (.Map val) with
  | some bv =>
    match info with
    | .Constr _ ifs =>
      match (ifs[2]? : Option Data) with
      | some (.List outs) => walk msh ⟨bv⟩ (.Map val) outs n [] ⟨""⟩ ⟨""⟩
      | _ => none
    | _ => none
  | none => none

theorem walk_entry (ρ : Environment) (ps : List Data) (n t bl : Integer) (pol nm : ByteString)
    (tq : Integer) (f4 : Data) (msh : ByteString) (rest : List Data) (val : List (Data × Data))
    (info : Data) (v72 v73 v74 : CekValue)
    (hRd : List.get?Internal ρ 3 = some (.VCon (.Data (refD t bl pol nm tq f4 msh rest))))
    (h76 : List.get?Internal ρ 8 = some (.VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)))
    (h75 : List.get?Internal ρ 9 = some (vEq 48))
    (h74 : List.get?Internal ρ 10 = some v74)
    (hv74 : ∀ l : List Data, Ap default v74 (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)))
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 12 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 15 = some (vEq 1))
    (hInfo : List.get?Internal ρ 18 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 19 = some (vEq 0)) (h17 : List.get?Internal ρ 20 = some (vEq 2))
    (hIte : List.get?Internal ρ 27 = some vIte) (hFst : List.get?Internal ρ 28 = some vFst)
    (hSnd : List.get?Internal ρ 29 = some vSnd) (hCL : List.get?Internal ρ 30 = some vChooseList)
    (hMk : List.get?Internal ρ 31 = some vMkCons)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail) :
    Ev default walkEntry (.VCon (.ConstPairDataList val) :: envA ps n ρ)
      ((walkFrom msh val info n).map walkResult) := by
  simp only [walkFrom]
  cases hbv : encodeDataOpaque (.Map val) with
  | none => simp only [Option.map_none]; ev_go [hv74] [mapData_eq, hbv]
  | some bv =>
    have hw := walk_loop ρ ps n val msh ⟨bv⟩ v72 v73 h76 h75 h73 hv73 h72 hv72 h27 h18 h17 hIte hFst
      hSnd hCL hMk hHead hTail
    rcases info with ⟨ti, _ | ⟨f0, _ | ⟨f1, _ | ⟨outs, ifs⟩⟩⟩⟩ | _ | _ | _ | _
    all_goals try (ev_go [hv72, hv74] [mapData_eq, hbv]; done)
    rcases outs with _ | _ | outs | _ | _
    all_goals try (ev_go [hv72, hv74] [mapData_eq, hbv]; done)
    simp only [List.getElem?_cons_succ, List.getElem?_cons_zero]
    ev_go [hv72, hv74, hw, values_nil_any] [mapData_eq, hbv]

end Lovejoin.Every
