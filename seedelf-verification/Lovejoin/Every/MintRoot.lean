import Lovejoin.Every.MintCheck

/-! # one_shot_mint's launch, from the program's root -/

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
open Lovejoin.Template.AnyTx (purposeCtx)


set_option maxHeartbeats 0

set_option hygiene false in
/-- The search lemmas the root's proof steps through, and the fields it reads. Unhygienic: it
names the proof's own `ht`, `ho` and `hc`. -/
macro "lgo" "[" fs:Lean.Parser.Tactic.simpLemma,* "]" : tactic =>
  `(tactic| ev_go [mnth4_ap, mnth2_ap, mnth1_ap, mnth3_ap, ht, ho, hc, values_nil_any]
    [Option.map_none, Option.map_some, optData, $fs,*])


theorem launch_root (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (info red : Data)
    (P : ByteString) :
    Ev default (applyParams mbody [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (purposeCtx 0 info red [.B P])])
      [] (unitIf (launchResult seedTx seedIx rh info P)) := by
  have ht := fun σ => tokens_apply σ P
  have hsd := fun σ => seed_loop σ (.Constr 0 [.B seedTx, .I seedIx])
  rcases info with ⟨ti, _ | ⟨i0, _ | ⟨i1, _ | ⟨i2, _ | ⟨i3, _ | ⟨i4, ifs⟩⟩⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [launchResult, unitIf]; ev_go [mnth4_ap] []; done)
  rcases i4 with _ | mint | _ | _ | _
  all_goals try (simp only [launchResult, unitIf]; ev_go [mnth4_ap] []; done)
  simp only [launchResult]
  cases htk : tokensOf P mint with
  | none => simp only [unitIf]; ev_go [mnth4_ap, ht] [htk, Option.map_none]
  | some toks =>
  rcases toks with _ | ⟨⟨k, v⟩, _ | ⟨t2, toks⟩⟩
  all_goals try (simp only [unitIf]; ev_go [mnth4_ap, ht] [htk, Option.map_some]; done)
  rcases k with _ | _ | _ | _ | nm
  all_goals try (simp only [unitIf]; ev_go [mnth4_ap, ht] [htk, Option.map_some]; done)
  have ho := fun σ σ32 => out_loop σ σ32 rh P nm
  rcases i2 with _ | _ | outs | _ | _
  all_goals try (simp only [unitIf]; lgo [htk]; done)
  cases hfo : findOut rh P nm outs with
  | none => simp only [unitIf]; lgo [htk, hfo]
  | some oo =>
  cases oo with
  | none => simp only [unitIf]; lgo [htk, hfo]
  | some o =>
  obtain ⟨t, a, vo, d, rs, os, rfl⟩ := findOut_shape hfo
  have hc := fun ρ => launch_check ρ (.Constr 0 [.B seedTx, .I seedIx]) nm v
    (.Constr ti (i0 :: i1 :: .List outs :: i3 :: .Map mint :: ifs)) t a vo d rs os
  cases hr : launchCheck (.Constr 0 [.B seedTx, .I seedIx]) nm v (.Constr t (a :: vo :: d :: rs :: os))
      (.Constr ti (i0 :: i1 :: .List outs :: i3 :: .Map mint :: ifs)) with
  | none => simp only [unitIf]; lgo [htk, hfo, hr]
  | some b => cases b <;> simp only [unitIf] <;> ev_go [mnth4_ap, mnth2_ap, mnth1_ap, mnth3_ap, ht, ho, hc,
      values_nil_any] [Option.map_none, Option.map_some, optData, htk, hfo, hr]

end Lovejoin.Every
