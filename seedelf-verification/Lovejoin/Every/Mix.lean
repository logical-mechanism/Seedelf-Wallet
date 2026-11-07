import Lovejoin.Every.Value
import Lovejoin.Every.Walk
import Lovejoin.Every.MixPred

/-! # The Mix withdrawal

`validate_mix`: at least two boxes and as many proofs; the box value (`Value.lean`); the outputs
walked for that many box outs (`Walk.lean`); then, with `ctx = blake2b_256(the datums' bytes ‖
the values' bytes ‖ mix_script_hash)` and the statements in output order, each box's Mix proof
(`MixPred.lean`), at most 255 boxes. Every input, output and proof any `Data`, every list any
length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)

set_option maxHeartbeats 0

/-! ### The statements' order -/

/-- i_165, `λ self l acc`, the statements reversed onto `acc`. -/
def revAt : List Nat := mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,1]
def revLoop : Term := sub (revAt ++ [0])
def revBody : Term := sub (revAt ++ [0,0,0])

theorem revLoop_shape : revLoop = .Lam (.Lam revBody) := rfl

theorem rev_loop (σ : Environment) (hCL : List.get?Internal σ 39 = some vChooseList)
    (hMk : List.get?Internal σ 40 = some vMkCons)
    (hHead : List.get?Internal σ 41 = some vHead) (hTail : List.get?Internal σ 42 = some vTail)
    (l acc : List Data) :
    Ev default revBody (.VCon (.ConstDataList acc) :: .VCon (.ConstDataList l) :: .VLam revLoop σ :: σ)
      (some (.VCon (.ConstDataList (l.reverseAux acc)))) := by
  induction l generalizing acc with
  | nil => simp only [List.reverseAux]; ev_go [] []
  | cons x xs ih => simp only [List.reverseAux]; ev_go [ih, values_nil_any] []

/-! ### The box count's byte -/

/-- `integerToByteString(True, 1, n)`, the builtin's own result. -/
def i2b (n : Integer) : Option ByteString :=
  match PlutusCore.Bitwise.integerToByteString true (Int.ofNat 1) n with
  | .ok r => some ⟨r⟩
  | .error _ => none

/-- The builtin at a symbolic `n`, without reducing it (its checks on `n` would get stuck). -/
theorem apleft_i2b (n : Integer) :
    ApLeft default (.VBuiltin .IntegerToByteString [.VCon (.Integer (Int.ofNat 1)), .VCon (.Bool true)] (.One .ArgV))
      (.VCon (.Integer n)) ((i2b n).map fun b => .VCon (.ByteString b)) := by
  apply apleft_builtin
  show PlutusCore.UPLC.BuiltinFunctions.Utils.tryCatchSome
    (PlutusCore.Bitwise.integerToByteString true (Int.ofNat 1) n)
    (fun r : String => (CekValue.VCon (Const.ByteString ⟨r⟩) : CekValue)) = _
  simp only [i2b]
  cases PlutusCore.Bitwise.integerToByteString true (Int.ofNat 1) n <;> rfl

def prefixAt03 : List Nat := mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1]
/-- `domain_tag_v1 ‖ statement_id_mix`, the bytes of "lovejoin/sigmajoin/v1/" and 0x03, as the
program holds them (`prefix03_shape`). -/
abbrev prefix03 : ByteString := ⟨"lovejoin/sigmajoin/v1/\x03"⟩

theorem prefix03_shape : sub prefixAt03 = .Const (.ByteString prefix03) := rfl

/-! ### The branch -/

/-- `validate_mix(self, reference_datum, mix_inputs, proofs)`, for the reference datum as
`referenceDatum` returns it: the redeemer's one field is the proof list. -/
def mixResult (rd info red : Data) (boxes : List Data) : Option Bool :=
  match rd, red with
  | .Constr _ (.I bl :: .B pol :: .B nm :: .I tq :: _ :: .B msh :: _), .Constr _ (.List ps :: _) =>
    if PlutusCore.Integer.lessThanEqualsInteger 2 (countOf boxes) then
      if PlutusCore.Integer.equalsInteger (countOf ps) (countOf boxes) then
        match boxValue bl pol nm tq with
        | some val =>
          match walkFrom msh val info (countOf boxes) with
          | some (sts, ds, vs) =>
            if PlutusCore.Integer.lessThanEqualsInteger (countOf boxes) 255 then
              match i2b (countOf boxes) with
              | some nb =>
                pairsAll (mixPred (appendByteString prefix03 nb)
                  (blake2b_256 (appendByteString (appendByteString ds vs) msh)) (sts.reverseAux [])) boxes ps
              | none => none
            else none
          | none => none
        | none => none
      else none
    else none
  | _, _ => none

/-- The Mix branch of the main body (a redeemer of a tag other than 0). -/
def mixBranch : Term := sub mixAt

theorem mix_branch (ρ σ78 : Environment) (t bl : Integer) (pol nm : ByteString) (tq : Integer) (f4 : Data)
    (msh : ByteString) (rest : List Data) (info red : Data) (boxes : List Data)
    (v72 v73 v74 v80 v106 v107 : CekValue)
    (h107 : List.get?Internal ρ 0 = some v107)
    (hv107 : ∀ l : List Data, Ap default v107 (.VCon (.ConstDataList l)) (some (.VCon (.Integer (countOf l)))))
    (h106 : List.get?Internal ρ 1 = some v106)
    (hv106 : ∀ z : ByteString, Ap default v106 (.VCon (.ByteString z)) ((scalarOf z).map fun s => .VCon (.Integer s)))
    (hBoxes : List.get?Internal ρ 2 = some (.VCon (.ConstDataList boxes)))
    (hRd : List.get?Internal ρ 3 = some (.VCon (.Data (refD t bl pol nm tq f4 msh rest))))
    (h80 : List.get?Internal ρ 4 = some v80)
    (hv80 : ∀ c : ByteString, Ap default v80 (.VCon (.ByteString c)) (some (.VCon (.Integer (scalarMod c)))))
    (h79 : List.get?Internal ρ 5 = some (vEq 32))
    (h78 : List.get?Internal ρ 6 = some (.VLam (.Lam (.Lam pairsEntry)) σ78))
    (h78Ite : List.get?Internal σ78 14 = some vIte) (h78CL : List.get?Internal σ78 17 = some vChooseList)
    (h78Mk : List.get?Internal σ78 18 = some vMkCons)
    (h78Head : List.get?Internal σ78 19 = some vHead) (h78Tail : List.get?Internal σ78 20 = some vTail)
    (h76 : List.get?Internal ρ 8 = some (.VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)))
    (h75 : List.get?Internal ρ 9 = some (vEq 48))
    (h74 : List.get?Internal ρ 10 = some v74)
    (hv74 : ∀ l : List Data, Ap default v74 (.VCon (.ConstDataList l)) (l[5]?.map fun d => .VCon (.Data d)))
    (h73 : List.get?Internal ρ 11 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h72 : List.get?Internal ρ 12 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h27 : List.get?Internal ρ 15 = some (vEq 1))
    (hRed : List.get?Internal ρ 17 = some (.VCon (.Data red)))
    (hInfo : List.get?Internal ρ 18 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 19 = some (vEq 0)) (h17 : List.get?Internal ρ 20 = some (vEq 2))
    (hIte : List.get?Internal ρ 27 = some vIte) (hFst : List.get?Internal ρ 28 = some vFst)
    (hSnd : List.get?Internal ρ 29 = some vSnd) (hCL : List.get?Internal ρ 30 = some vChooseList)
    (hMk : List.get?Internal ρ 31 = some vMkCons)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail) :
    Ev default mixBranch ρ
      ((mixResult (refD t bl pol nm tq f4 msh rest) info red boxes).map fun b => .VCon (.Bool b)) := by
  rcases red with ⟨tr, _ | ⟨pl, rfs⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv107] []; done)
  rcases pl with _ | _ | ps | _ | _
  all_goals try (ev_go [hv107] []; done)
  simp only [mixResult]
  cases h2 : PlutusCore.Integer.lessThanEqualsInteger 2 (countOf boxes)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h2] []
  cases hn : PlutusCore.Integer.equalsInteger (countOf ps) (countOf boxes)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h2] [hn]
  simp only [↓reduceIte]
  have hbv := box_value ρ ps (countOf boxes) t bl pol nm tq f4 msh rest v72 v73 hRd h73 hv73 h72 hv72 h18
    hIte hFst hSnd hCL hMk hHead hTail
  cases hv : boxValue bl pol nm tq with
  | none =>
    simp only [Option.map_none]
    ev_go [hv107, ap_lessThanEquals _ _ _ h2, hbv] [hn, hv, Option.map_none]
  | some val =>
    have hw := walk_entry ρ ps (countOf boxes) t bl pol nm tq f4 msh rest val info v72 v73 v74 hRd h76 h75
      h74 hv74 h73 hv73 h72 hv72 h27 hInfo h18 h17 hIte hFst hSnd hCL hMk hHead hTail
    cases hwf : walkFrom msh val info (countOf boxes) with
    | none =>
      simp only [Option.map_none]
      ev_go [hv107, ap_lessThanEquals _ _ _ h2, hbv, hw] [hn, hv, hwf, Option.map_none, Option.map_some]
    | some r =>
      obtain ⟨sts, ds, vs⟩ := r
      have hr := fun σ => rev_loop σ
      cases h255 : PlutusCore.Integer.lessThanEqualsInteger (countOf boxes) 255
      · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
        ev_go [hv107, ap_lessThanEquals _ _ _ h2, hbv, hw, hv74, hr, ap_lessThanEquals _ _ _ h255, values_nil_any]
          [walkResult, hn, hv, hwf, Option.map_some]
      simp only [↓reduceIte]
      cases hi : i2b (countOf boxes) with
      | none =>
        simp only [Option.map_none]
        ev_go [hv107, ap_lessThanEquals _ _ _ h2, hbv, hw, hv74, hr, ap_lessThanEquals _ _ _ h255,
          apleft_i2b, values_nil_any] [walkResult, hn, hv, hwf, hi, Option.map_some, Option.map_none]
      | some nb =>
        have hp := mix_pred
          (.VCon (.ByteString (appendByteString prefix03 nb)) :: .VCon (.ConstDataList (sts.reverseAux [])) ::
            .VCon (.ByteString (blake2b_256 (appendByteString (appendByteString ds vs) msh))) ::
            .VCon (.ConstDataList [.B ds, .B vs]) :: walkResult (sts, ds, vs) ::
            .VCon (.ConstPairDataList val) :: envA ps (countOf boxes) ρ)
          ρ (appendByteString prefix03 nb) (blake2b_256 (appendByteString (appendByteString ds vs) msh))
          (sts.reverseAux []) v72 v73 v80 v106 (.VLam nth3Fn ρ) rfl rfl rfl rfl hCL hHead hTail rfl
          (nth3_ap ρ hHead hTail) h106 hv106 h80 hv80 h79 h73 hv73 h72 hv72 hIte hSnd hCL hMk hHead hTail
        ev_go [hv107, ap_lessThanEquals _ _ _ h2, hbv, hw, hv74, hr, ap_lessThanEquals _ _ _ h255,
          apleft_i2b, pairs_apply, hp, values_nil_any] [walkResult, hn, hv, hwf, hi, Option.map_some]

/-! ### From the main body -/

/-- Take `refFields` apart at `h`, one field's kind at a time; every other kind is `none`. -/
macro "rsimp " h:ident : tactic => `(tactic| try simp only [bytesOf, intOf, Option.bind_eq_bind,
  Option.bind_some, Option.bind_none, reduceCtorEq, Option.some.injEq] at $h:ident)

theorem refFields_some {x rd : Data} {xs : List Data} (h : refFields x xs = some rd) :
    rd = x ∧ ∃ bl pol nm tq f4 msh rest, xs = .I bl :: .B pol :: .B nm :: .I tq :: f4 :: .B msh :: rest := by
  rcases xs with _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨f4, _ | ⟨f5, _ | ⟨f6, _ | ⟨f7, more⟩⟩⟩⟩⟩⟩⟩⟩
  all_goals try (simp [refFields] at h; done)
  simp only [refFields] at h
  cases f7 <;> rsimp h
  cases f0 <;> rsimp h
  cases f1 <;> rsimp h
  cases f2 <;> rsimp h
  cases f3 <;> rsimp h
  cases f4 <;> rsimp h
  cases f5 <;> rsimp h
  cases f6 <;> rsimp h
  cases more <;> rsimp h
  exact ⟨h.symm, _, _, _, _, _, _, _, rfl⟩

theorem carrierDatum_some {c rd : Data} (h : carrierDatum c = some rd) :
    ∃ t bl pol nm tq f4 msh rest, rd = refD t bl pol nm tq f4 msh rest := by
  rcases c with ⟨t, _ | ⟨c0, _ | ⟨out, cfs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp [carrierDatum] at h; done)
  rcases out with ⟨t1, _ | ⟨o0, _ | ⟨o1, _ | ⟨d, ofs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp [carrierDatum] at h; done)
  rcases d with ⟨dt, _ | ⟨x, dfs⟩⟩ | _ | _ | _ | _
  all_goals try (simp [carrierDatum] at h; done)
  rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
  all_goals try (simp [carrierDatum] at h; done)
  cases h2 : PlutusCore.Integer.equalsInteger 2 dt <;>
    cases h0 : PlutusCore.Integer.equalsInteger 0 xt <;>
    simp only [carrierDatum, h2, h0, List.getElem?_cons_succ, List.getElem?_cons_zero, Bool.false_eq_true,
      ↓reduceIte, reduceCtorEq] at h
  obtain ⟨rfl, bl, pol, nm, tq, f4, msh, rest, rfl⟩ := refFields_some h
  exact ⟨_, _, _, _, _, _, _, _, rfl⟩

/-- What `referenceDatum` returns is laid out as the Mix reads it. -/
theorem referenceDatum_shape {pb nb : ByteString} {info rd : Data} (h : referenceDatum pb nb info = some rd) :
    ∃ t bl pol nm tq f4 msh rest, rd = refD t bl pol nm tq f4 msh rest := by
  rcases info with ⟨ti, _ | ⟨f0, _ | ⟨fr, ifs⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp [referenceDatum] at h; done)
  rcases fr with _ | _ | refs | _ | _
  all_goals try (simp [referenceDatum] at h; done)
  cases hcs : carriers pb nb refs with
  | none => simp [referenceDatum, hcs] at h
  | some cs =>
    rcases cs with _ | ⟨c, _ | ⟨c', cs⟩⟩ <;> simp [referenceDatum, hcs] at h
    exact carrierDatum_some h

/-- A Mix withdrawal past the redeemer's checks: the reference datum, the boxes, then
`validate_mix`. -/
def mixMain (P : ByteString) (info red : Data) : Option Bool :=
  match referenceDatum P nftName info with
  | some rd =>
    match boxesOf rd info with
    | some boxes => mixResult rd info red boxes
    | none => none
  | none => none

theorem main_mix (P : ByteString) (info : Data) (tr : Integer) (fs : List Data)
    (htr : PlutusCore.Integer.equalsInteger 0 tr = false) (c0 c1 c3 c8 c9 c10 c11 : CekValue)
    (rest : Environment) :
    Ev default mainBody (env29 c0 c1 c3 c8 c9 c10 c11 info (.Constr tr fs) P rest)
      ((mixMain P info (.Constr tr fs)).map fun b => .VCon (.Bool b)) := by
  simp only [mixMain]
  cases hrd : referenceDatum P nftName info with
  | none =>
    ev_go [reference_datum, nth1_ap, nth2_ap] [hrd, Option.map_none]
  | some rd =>
    cases hb : boxesOf rd info with
    | none =>
      ev_go [reference_datum, boxes_of, nth1_ap, nth2_ap, nth5_ap] [hrd, hb, Option.map_none, Option.map_some]
    | some boxes =>
      obtain ⟨t, bl, pol, nm, tq, f4, msh, rest', rfl⟩ := referenceDatum_shape hrd
      have hmb := fun ρ σ78 => mix_branch ρ σ78 t bl pol nm tq f4 msh rest' info (.Constr tr fs) boxes
      ev_go [reference_datum, boxes_of, hmb, nth1_ap, nth2_ap, nth5_ap, scalar_ap, scalarMod_ap,
        len_ap, values_nil_any] [htr, hrd, hb, Option.map_none, Option.map_some]

end Lovejoin.Every
