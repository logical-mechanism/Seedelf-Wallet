import Seedelf.Every.PolicyBase

/-! # The policy's mint check (`let i_24 …`)

The TxInfo's inputs (field 0, read first), its mint flattened to exactly one line
`[B pid, B tkn, I amt, …]`, the first input's reference `Constr _ [B txid, I idx, …]` (the index
read before the id), `consByteString idx txid` (an error past a byte); then pid = own,
tkn = `tokenName tag (idx ⊳ txid)` and amt = 1. The case splits follow that order. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString sliceByteString equalsByteString consByteStringV2)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

set_option maxHeartbeats 0

set_option hygiene false in
/-- Close an error branch: the spec's `none`, and the run to its error. -/
macro "mclose" : tactic =>
  `(tactic| (simp only [mintOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done))

/-- The mint check over levels i_16 to i_0 (σ): i_16 the flatten, i_15 the tag, i_14 the policy,
i_11 the TxInfo. -/
theorem mint_ev (σ : Environment) (info : Data) (own tag : ByteString) (v16 : CekValue)
    (h16 : List.get?Internal σ 0 = some v16)
    (hfl : ∀ ps, Ap default v16 (.VCon (.ConstPairDataList ps))
      ((flatPairs ps).map fun L => .VCon (.ConstDataList L)))
    (hTag : List.get?Internal σ 1 = some (.VCon (.ByteString tag)))
    (hOwn : List.get?Internal σ 2 = some (.VCon (.ByteString own)))
    (hI : List.get?Internal σ 5 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 10 = some vIte) (hSnd : List.get?Internal σ 12 = some vSnd)
    (hCL : List.get?Internal σ 13 = some vChooseList) (hHead : List.get?Internal σ 15 = some vHead)
    (hTail : List.get?Internal σ 16 = some vTail) :
    Ev default mintBody σ ((mintOpt info own tag).map fun b => .VCon (.Bool b)) := by
  -- The inputs, field 0, are read first.
  rcases info with ⟨ti, _ | ⟨f0, fs⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [mintOpt, Option.map_none]; w_go [] []; done)
  rcases f0 with ⟨_, _⟩ | _ | ins | _ | _
  all_goals try (simp only [mintOpt, Option.map_none]; w_go [] []; done)
  -- The mint, field 4, flattened.
  rcases fs with _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨mint, fs⟩⟩⟩⟩
  all_goals try (simp only [mintOpt, lineFields, Option.map_none]; w_go [hfl] []; done)
  rcases mint with ⟨_, _⟩ | ps | _ | _ | _
  all_goals try (simp only [mintOpt, lineFields, Option.map_none]; w_go [hfl] []; done)
  cases hf : flatPairs ps with
  | none => simp only [mintOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_none]
  | some L =>
  rcases L with _ | ⟨x, _ | ⟨y, L⟩⟩
  · mclose
  rotate_left
  · -- Two lines or more.
    rcases x with ⟨_, _⟩ | _ | l | _ | _ <;> mclose
  -- One line: its name, then its amount.
  rcases x with ⟨_, _⟩ | _ | l | _ | _
  all_goals try mclose
  rcases l with _ | ⟨p, _ | ⟨t, rest⟩⟩
  all_goals try mclose
  rcases t with ⟨_, _⟩ | _ | _ | _ | tkn
  all_goals try mclose
  rcases rest with _ | ⟨a, l⟩
  all_goals try mclose
  rcases a with ⟨_, _⟩ | _ | _ | amt | _
  all_goals try mclose
  -- The first input's reference: its index, then its id.
  rcases ins with _ | ⟨inp, ins⟩
  all_goals try mclose
  rcases inp with ⟨_, ifs⟩ | _ | _ | _ | _
  all_goals try mclose
  rcases ifs with _ | ⟨oref, ifs⟩
  all_goals try mclose
  rcases oref with ⟨_, ofs⟩ | _ | _ | _ | _
  all_goals try mclose
  rcases ofs with _ | ⟨txD, _ | ⟨ixD, ofs⟩⟩
  all_goals try mclose
  rcases ixD with ⟨_, _⟩ | _ | _ | idx | _
  all_goals try mclose
  rcases txD with ⟨_, _⟩ | _ | _ | _ | txid
  all_goals try mclose
  -- `consByteString idx txid`.
  cases hc : consByteStringV2 idx txid with
  | error e =>
    have hce := ap_cons_err idx txid e hc
    rcases p with ⟨_, _⟩ | _ | _ | _ | pid <;>
      simp only [mintOpt, lineFields, hf, hc, Option.map_none] <;> w_go [hfl, hce] [hf, Option.map_some]
  | ok c =>
  have hco := ap_cons_ok idx txid c hc
  -- The line's policy, at its comparison.
  rcases p with ⟨_, _⟩ | _ | _ | _ | pid
  all_goals try (simp only [mintOpt, lineFields, hf, hc, Option.map_none]; w_go [hfl, hco] [hf, Option.map_some]; done)
  simp only [mintOpt, lineFields, hf, hc]
  cases hp : equalsByteString own pid
  · have h1 := ap_eqBS _ _ _ hp
    simp only [Bool.false_eq_true, ↓reduceIte]
    w_go [hfl, hco, h1] [hf, Option.map_some]
  cases hn : equalsByteString (tokenName tag c) tkn
  · have h1 := ap_eqBS _ _ _ hp
    have h2 := ap_eqBS _ _ _ hn
    simp only [Bool.false_eq_true, ↓reduceIte]
    w_go [hfl, hco, h1, h2] [hf, Option.map_some]
  have h1 := ap_eqBS _ _ _ hp
  have h2 := ap_eqBS _ _ _ hn
  have h3 := ap_eqInt 1 amt _ rfl
  simp only [↓reduceIte]
  w_go [hfl, hco, h1, h2, h3] [hf, Option.map_some]

end Seedelf.Every
