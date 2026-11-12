import Seedelf.Every.Burn
import Seedelf.Every.Mint
import Seedelf.Every.Root

/-! # The policy, on any context

The policy applied to any `Data`. `policyBool` is the compiled code read back: the context's three
fields, a mint (tag 0) whose first field is the policy `B own`, a redeemer `B tag`, then the burn
and the mint checks, both run, and their xor. Every other shape is an error. -/

namespace Seedelf.Every
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-- The policy's answer to any context: `some true` accepts, `some false` and `none` don't. -/
def policyBool (ctx : Data) : Option Bool :=
  match ctx with
  | .Constr _ (info :: red :: si :: _) =>
    match si with
    | .Constr st sfs =>
      if PlutusCore.Integer.equalsInteger 0 st then
        match sfs, red with
        | .B own :: _, .B tag =>
          match burnOpt info own, mintOpt info own tag with
          | some b, some m => some ((b || m) && !(b && m))
          | _, _ => none
        | _, _ => none
      else none
    | _ => none
  | _ => none

/-- `burn_ev`, its i_16 the flatten closure in any environment. -/
theorem burn_ev' (σ : Environment) (info : Data) (own : ByteString)
    (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (h16 : List.get?Internal σ 0 = some (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 ::
      a8 :: a9 :: builtinsEnv rest)))
    (hOwn : List.get?Internal σ 2 = some (.VCon (.ByteString own)))
    (hI : List.get?Internal σ 5 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 10 = some vIte) (hSnd : List.get?Internal σ 12 = some vSnd)
    (hCL : List.get?Internal σ 13 = some vChooseList) (hHead : List.get?Internal σ 15 = some vHead)
    (hTail : List.get?Internal σ 16 = some vTail) :
    Ev default burnBody σ ((burnOpt info own).map fun b => .VCon (.Bool b)) :=
  burn_ev σ info own _ h16 (flatten_apply_any a1 a2 a3 a4 a5 a6 a7 a8 a9 rest) hOwn hI hIte hSnd hCL
    hHead hTail

/-- `mint_ev`, likewise. -/
theorem mint_ev' (σ : Environment) (info : Data) (own tag : ByteString)
    (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (h16 : List.get?Internal σ 0 = some (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 ::
      a8 :: a9 :: builtinsEnv rest)))
    (hTag : List.get?Internal σ 1 = some (.VCon (.ByteString tag)))
    (hOwn : List.get?Internal σ 2 = some (.VCon (.ByteString own)))
    (hI : List.get?Internal σ 5 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 10 = some vIte) (hSnd : List.get?Internal σ 12 = some vSnd)
    (hCL : List.get?Internal σ 13 = some vChooseList) (hHead : List.get?Internal σ 15 = some vHead)
    (hTail : List.get?Internal σ 16 = some vTail) :
    Ev default mintBody σ ((mintOpt info own tag).map fun b => .VCon (.Bool b)) :=
  mint_ev σ info own tag _ h16 (flatten_apply_any a1 a2 a3 a4 a5 a6 a7 a8 a9 rest) hTag hOwn hI hIte hSnd
    hCL hHead hTail

set_option maxHeartbeats 0

/-- **The policy on any context**: the program returns `()` exactly when `policyBool` says true,
and reaches `Error` otherwise. Kernel-checked, any mint, any inputs, no step limit. -/
theorem policy_root (ctx : Data) :
    Ev default (applyParams pBody [toTerm ctx]) [] (unitIf (policyBool ctx)) := by
  rcases ctx with ⟨ct, _ | ⟨info, _ | ⟨red, _ | ⟨si, cfs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [policyBool, unitIf]; w_go [] []; done)
  rcases si with ⟨st, sfs⟩ | _ | _ | _ | _
  all_goals try (simp only [policyBool, unitIf]; w_go [] []; done)
  cases h0 : PlutusCore.Integer.equalsInteger 0 st
  · simp only [policyBool, unitIf, h0, Bool.false_eq_true, ↓reduceIte]; w_go [] [h0]
  rcases sfs with _ | ⟨o, sfs⟩
  all_goals try (simp only [policyBool, unitIf, h0, ↓reduceIte]; w_go [] [h0]; done)
  rcases o with ⟨_, _⟩ | _ | _ | _ | own
  all_goals try (simp only [policyBool, unitIf, h0, ↓reduceIte]; w_go [] [h0]; done)
  rcases red with ⟨_, _⟩ | _ | _ | _ | tag
  all_goals try (simp only [policyBool, unitIf, h0, ↓reduceIte]; w_go [] [h0]; done)
  simp only [policyBool, h0, ↓reduceIte]
  have hb := burn_ev' (info := info) (own := own)
  have hm := mint_ev' (info := info) (own := own) (tag := tag)
  cases hbr : burnOpt info own with
  | none => simp only [unitIf]; w_go [hb] [h0, hbr, Option.map_none]
  | some b =>
  cases hmr : mintOpt info own tag with
  | none => simp only [unitIf]; w_go [hb, hm] [h0, hbr, hmr, Option.map_none, Option.map_some]
  | some m =>
    cases b <;> cases m <;> simp only [unitIf, Bool.or_self, Bool.and_self, Bool.or_false,
      Bool.and_false, Bool.not_true, Bool.not_false, Bool.or_true, Bool.and_true] <;>
      w_go [hb, hm] [h0, hbr, hmr, Option.map_some]

end Seedelf.Every
