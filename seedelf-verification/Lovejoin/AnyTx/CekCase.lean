import Seedelf.LinesAllCek

/-! Kernel-checked big-step rules for CEK constructor and case terms. These extend
`Seedelf.LinesAllCek`'s rules for the Plutus V3 instructions used by Lovejoin.
They describe unbounded reachability, not a fixed evaluator step limit. -/
namespace Lovejoin.AnyTx.CekCase
open PlutusCore.Default (BuiltinSemanticsVariant)
open PlutusCore.UPLC.Term (Term Const BuiltinFun)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.Builtins (ExpectedBuiltinArgs expectedArgs)
open PlutusCore.UPLC.BuiltinFunctions.Evaluate (evaluateBuiltinFunction)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-- Continuation after one constructor argument has been evaluated. -/
structure ConstrK (sv : BuiltinSemanticsVariant) (tag : Nat) (done : List CekValue)
    (remaining : List Term) (ρ : Environment) (rv r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (.ConstructorArgument tag done remaining ρ :: κ) rv) (Out κ r)

/-- Continuation after the case scrutinee has been evaluated. -/
structure CaseK (sv : BuiltinSemanticsVariant) (branches : List Term) (ρ : Environment)
    (rv r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (.CaseScrutinee branches ρ :: κ) rv) (Out κ r)

/-- Stack of arguments for a case branch, as constructed by the CEK machine. -/
def valueFrames : List CekValue → Stack → Stack
  | [], κ => κ
  | x :: xs, κ => .LeftApplicationToValue x :: valueFrames xs κ

/-- Apply a list of already-evaluated values to a value on any continuation. -/
structure ValuesK (sv : BuiltinSemanticsVariant) (values : List CekValue)
    (rv r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (valueFrames values κ) rv) (Out κ r)

/-- A left application of an already-evaluated argument. -/
structure ApLeft (sv : BuiltinSemanticsVariant) (f w : CekValue) (r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (.Return (.LeftApplicationToValue w :: κ) f) (Out κ r)

section
variable {sv : BuiltinSemanticsVariant}

theorem constrk_none {tag : Nat} {done : List CekValue} {remaining : List Term} {ρ : Environment} :
    ConstrK sv tag done remaining ρ none none := ⟨fun _ => .refl _ _⟩

theorem constrk_last {tag : Nat} {done : List CekValue} {ρ : Environment} {v : CekValue} :
    ConstrK sv tag done [] ρ (some v) (some (.VConstr tag (List.reverse (v :: done)))) :=
  ⟨fun _ => .single rfl⟩

theorem constrk_next {tag : Nat} {done : List CekValue} {M : Term} {Ms : List Term} {ρ : Environment}
    {v : CekValue} {rv r : Option CekValue} (hM : Ev sv M ρ rv)
    (hK : ConstrK sv tag (v :: done) Ms ρ rv r) :
    ConstrK sv tag done (M :: Ms) ρ (some v) r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.ConstructorArgument tag (v :: done) Ms ρ :: κ) ρ M) rfl).trans
    ((hM.run _).trans (hK.run κ))⟩

theorem ev_constr_nil {tag : Nat} {ρ : Environment} : Ev sv (.Constr tag []) ρ (some (.VConstr tag [])) :=
  ⟨fun _ => .single rfl⟩

theorem ev_constr_cons {tag : Nat} {M : Term} {Ms : List Term} {ρ : Environment}
    {rv r : Option CekValue} (hM : Ev sv M ρ rv) (hK : ConstrK sv tag [] Ms ρ rv r) :
    Ev sv (.Constr tag (M :: Ms)) ρ r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.ConstructorArgument tag [] Ms ρ :: κ) ρ M) rfl).trans
    ((hM.run _).trans (hK.run κ))⟩

theorem casek_none {branches : List Term} {ρ : Environment} : CaseK sv branches ρ none none :=
  ⟨fun _ => .refl _ _⟩

theorem ev_case {N : Term} {branches : List Term} {ρ : Environment} {rv r : Option CekValue}
    (hN : Ev sv N ρ rv) (hK : CaseK sv branches ρ rv r) : Ev sv (.Case N branches) ρ r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.CaseScrutinee branches ρ :: κ) ρ N) rfl).trans
    ((hN.run _).trans (hK.run κ))⟩

theorem values_nil {v : CekValue} : ValuesK sv [] (some v) (some v) := ⟨fun _ => .refl _ _⟩
theorem values_none {values : List CekValue} : ValuesK sv values none none := ⟨fun _ => .refl _ _⟩

theorem values_cons {v w : CekValue} {vs : List CekValue} {rw r : Option CekValue}
    (h : ApLeft sv v w rw) (ht : ValuesK sv vs rw r) : ValuesK sv (w :: vs) (some v) r :=
  ⟨fun κ => (h.run (valueFrames vs κ)).trans (ht.run κ)⟩

theorem apleft_lam {M : Term} {ρ : Environment} {w : CekValue} {r : Option CekValue}
    (h : Ev sv M (w :: ρ) r) : ApLeft sv (.VLam M ρ) w r :=
  ⟨fun κ => (Reaches.single (b := .Eval κ (w :: ρ) M) rfl).trans (h.run κ)⟩

theorem apleft_partial {b : BuiltinFun} {Vs : List CekValue} {η : ExpectedBuiltinArgs} {w : CekValue} :
    ApLeft sv (.VBuiltin b Vs (.More .ArgV η)) w (some (.VBuiltin b (w :: Vs) η)) :=
  ⟨fun _ => .single rfl⟩

theorem apleft_builtin {b : BuiltinFun} {Vs : List CekValue} {w : CekValue} {r : Option CekValue}
    (h : evaluateBuiltinFunction sv b (w :: Vs) = r) : ApLeft sv (.VBuiltin b Vs (.One .ArgV)) w r :=
  ⟨fun κ => .single (show evalBuiltin sv κ b (w :: Vs) = _ by rw [evalBuiltin_out, h])⟩

theorem casek_constr {branches : List Term} {ρ : Environment} {tag : Nat} {values : List CekValue}
    {branch : Term} {rv r : Option CekValue} (hfind : List.get?Internal branches tag = some branch)
    (hbranch : Ev sv branch ρ rv) (hvalues : ValuesK sv values rv r) :
    CaseK sv branches ρ (some (.VConstr tag values)) r := by
  constructor
  intro κ
  have step1 : step sv (.Return (.CaseScrutinee branches ρ :: κ) (.VConstr tag values)) =
      .Eval (valueFrames values κ) ρ branch := by
    simp only [step, hfind]
    have hframes : step.folding values κ = valueFrames values κ := by
      clear hvalues
      induction values with
      | nil => rfl
      | cons x xs ih => simp only [valueFrames, step.folding, ih]
    rw [hframes]
  exact (Reaches.single step1).trans ((hbranch.run _).trans (hvalues.run κ))

end
end Lovejoin.AnyTx.CekCase

namespace Lovejoin.AnyTx.CekCase
open Lean Elab Tactic
open Seedelf.V1.LinesAll

/-- One big-step reduction, including V3 constructors and cases. -/
macro "cek_v3_step" : tactic => `(tactic| first
  | apply ev_case
  | apply ev_constr_nil
  | apply ev_constr_cons
  | apply constrk_none
  | apply constrk_last
  | apply constrk_next
  | apply casek_none
  | apply casek_constr
  | apply values_nil
  | apply values_none
  | apply values_cons
  | apply apleft_lam
  | apply apleft_partial
  | (apply apleft_builtin; cek_rfl)
  | cek_rfl
  | cek_step)

/-- Evaluate using both the Seedelf and V3 CEK rules. -/
macro "cek_v3" : tactic => `(tactic| cek_repeat cek_v3_step)

syntax "cek_v3_using " "[" term,* "]" : tactic
macro_rules
  | `(tactic| cek_v3_using [$hs,*]) => do
    let mut tac ← `(tactic| cek_v3_step)
    for h in hs.getElems.reverse do
      let rest ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | apply $h | $rest)
    let body ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
    `(tactic| cek_repeat $body)

end Lovejoin.AnyTx.CekCase
