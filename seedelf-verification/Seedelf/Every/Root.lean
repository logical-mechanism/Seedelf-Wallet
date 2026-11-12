import Seedelf.Every.Datum

/-! # The whole program, on any context

The wallet applied to any `Data` at all: what the ledger passes (`Constr 0 [txInfo, redeemer,
scriptInfo]`), or anything else. `walletBool` is the compiled code read back, in its order:
- the context's first three fields, then the purpose: a spend (`Constr 1 [ref, datum, …]`);
- the redeemer: `Constr 0 [B z, B gr, B vkh]`, exactly;
- the datum: `None` (or any constructor but 0) accepts; `Some(d)` with `d` exactly
  `Constr 0 [B g, B u]` is a Register's spend (`registerOpt`); any other `d` accepts.
Every other shape is an error. -/

namespace Seedelf.Every
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-- The wallet's answer to any context: `some true` accepts, `some false` and `none` don't.
Each tag is tested before its fields are read, as compiled. -/
def walletBool (ctx : Data) : Option Bool :=
  match ctx with
  | .Constr _ (info :: red :: si :: _) =>
    match si with
    | .Constr st sfs =>
      if PlutusCore.Integer.equalsInteger 1 st then
        match sfs with
        | _ :: dopt :: _ =>
          match red with
          | .Constr rt rfs =>
            if PlutusCore.Integer.equalsInteger 0 rt then
              match rfs with
              | [.B z, .B gr, .B vkh] =>
                match dopt with
                | .Constr ot ofs =>
                  if PlutusCore.Integer.equalsInteger 0 ot then someOpt info z gr vkh ofs else some true
                | _ => none
              | _ => none
            else none
          | _ => none
        | _ => none
      else none
    | _ => none
  | _ => none

/-- The program's answer to a result: `()` for true, an error otherwise. -/
def unitIf (r : Option Bool) : Option CekValue :=
  match r with
  | some true => some (.VCon .Unit)
  | _ => none

set_option maxHeartbeats 0

/-- **The wallet on any context**: the program returns `()` exactly when `walletBool` says
true, and reaches `Error` otherwise. Kernel-checked, any signatory count, no step limit. -/
theorem wallet_root (ctx : Data) :
    Ev default (applyParams body [toTerm ctx]) [] (unitIf (walletBool ctx)) := by
  -- The context: a constructor with three fields at least.
  rcases ctx with ⟨ct, _ | ⟨info, _ | ⟨red, _ | ⟨si, cfs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [walletBool, unitIf]; w_go [] []; done)
  -- The purpose: a constructor, tag 1 (a spend), with two fields at least.
  rcases si with ⟨st, sfs⟩ | _ | _ | _ | _
  all_goals try (simp only [walletBool, unitIf]; w_go [] []; done)
  cases h1 : PlutusCore.Integer.equalsInteger 1 st
  · simp only [walletBool, unitIf, h1, Bool.false_eq_true, ↓reduceIte]; w_go [] [h1]
  rcases sfs with _ | ⟨ref, _ | ⟨dopt, sfs⟩⟩
  all_goals try (simp only [walletBool, unitIf, h1, ↓reduceIte]; w_go [] [h1]; done)
  -- The redeemer: a constructor, tag 0, of exactly three bytestrings.
  rcases red with ⟨rt, rfs⟩ | _ | _ | _ | _
  all_goals try (simp only [walletBool, unitIf, h1, ↓reduceIte]; w_go [] [h1]; done)
  cases h0 : PlutusCore.Integer.equalsInteger 0 rt
  · simp only [walletBool, unitIf, h1, h0, Bool.false_eq_true, ↓reduceIte]; w_go [] [h1, h0]
  rcases rfs with _ | ⟨x, rfs⟩
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases x with ⟨_, _⟩ | _ | _ | _ | z
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases rfs with _ | ⟨x, rfs⟩
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases x with ⟨_, _⟩ | _ | _ | _ | gr
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases rfs with _ | ⟨x, rfs⟩
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases x with ⟨_, _⟩ | _ | _ | _ | vkh
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  rcases rfs with _ | ⟨_, _⟩
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  -- The datum option: a constructor; tag 0 is `Some(d)`, any other accepts.
  rcases dopt with ⟨ot, ofs⟩ | _ | _ | _ | _
  all_goals try (simp only [walletBool, unitIf, h1, h0, ↓reduceIte]; w_go [] [h1, h0]; done)
  cases h2 : PlutusCore.Integer.equalsInteger 0 ot
  · simp only [walletBool, unitIf, h1, h0, h2, Bool.false_eq_true, ↓reduceIte]; w_go [] [h1, h0, h2]
  -- `Some(d)`: the region, then its answer.
  simp only [walletBool, h1, h0, h2, ↓reduceIte]
  have hd := datum_ev (info := info) (ot := ot) (rt := rt) (ofs := ofs) (z := z) (gr := gr) (vkh := vkh)
  cases hr : someOpt info z gr vkh ofs with
  | none => simp only [unitIf]; w_go [hd] [h1, h0, h2, hr, Option.map_none]
  | some b =>
    cases b <;> simp only [unitIf] <;> w_go [hd] [h1, h0, h2, hr, Option.map_some]

end Seedelf.Every
