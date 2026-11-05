import PlutusCore.UPLC.CekMachine.Lemmas

/-! # The CEK machine, a term at a time

Big-step facts about PlutusCoreBlaster's small-step CEK machine (`step`, `stepN`), each holding
on top of any stack. `step` only ever looks at the top frame, so a term evaluated on a stack `κ`
comes back to `κ` with its value, or errors, whatever `κ` holds. A run then composes along the
term's syntax, a lemma per node, and the machine's intermediate states are never written down:
each lemma's stack is free, and unification finds the environments and values.

`Ev sv t ρ r` says `t`, in the environment `ρ`, comes back with `r` on every stack: `some v`
returns `v` to it, `none` reaches `Error`. The other predicates are the continuations a node
leaves behind (an application's argument, the function's call, a force), so `cek` below is
deterministic: no node needs a guess about how its children end.

Kernel-checked, no Blaster. -/

namespace Seedelf.V1.LinesAll

open PlutusCore.Default (BuiltinSemanticsVariant)
open PlutusCore.UPLC.Term (Term Const BuiltinFun Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.Builtins (ExpectedBuiltinArg ExpectedBuiltinArgs expectedArgs)
open PlutusCore.UPLC.BuiltinFunctions.Evaluate (evaluateBuiltinFunction)
open PlutusCore.UPLC.CekMachine

/-- `s` reaches `s'` in some number of steps. -/
def Reaches (sv : BuiltinSemanticsVariant) (s s' : State) : Prop := ∃ k, stepN sv s k = s'

namespace Reaches

theorem refl (sv : BuiltinSemanticsVariant) (s : State) : Reaches sv s s := ⟨0, rfl⟩

theorem trans {sv : BuiltinSemanticsVariant} {a b c : State} (h₁ : Reaches sv a b)
    (h₂ : Reaches sv b c) : Reaches sv a c := by
  obtain ⟨k₁, e₁⟩ := h₁
  obtain ⟨k₂, e₂⟩ := h₂
  exact ⟨k₁ + k₂, by rw [stepN_add, e₁, e₂]⟩

/-- One step. -/
theorem single {sv : BuiltinSemanticsVariant} {a b : State} (h : step sv a = b) : Reaches sv a b :=
  ⟨1, h⟩

end Reaches

/-- Where an evaluation ends on the stack `κ`: its value returned to `κ`, or the error. -/
def Out (κ : Stack) : Option CekValue → State
  | none => .Error
  | some v => .Return κ v

/-- `t`, in `ρ`, comes back with `r` on every stack. -/
structure Ev (sv : BuiltinSemanticsVariant) (t : Term) (ρ : Environment) (r : Option CekValue) :
    Prop where
  run : ∀ κ, Reaches sv (.Eval κ ρ t) (Out κ r)

/-- An application's function came back with `rf`; its argument `N`, in `ρ`, comes next, and the
application comes back with `r`. -/
structure ArgK (sv : BuiltinSemanticsVariant) (N : Term) (ρ : Environment)
    (rf r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (.LeftApplicationToTerm N ρ :: κ) rf) (Out κ r)

/-- The function `f`'s argument came back with `rw`; the application comes back with `r`. -/
structure FunK (sv : BuiltinSemanticsVariant) (f : CekValue) (rw r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (.RightApplicationOfValue f :: κ) rw) (Out κ r)

/-- `f` applied to `w` comes back with `r`. -/
structure Ap (sv : BuiltinSemanticsVariant) (f w : CekValue) (r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (.Return (.RightApplicationOfValue f :: κ) w) (Out κ r)

/-- A forced term came back with `rf`; the force comes back with `r`. -/
structure ForceK (sv : BuiltinSemanticsVariant) (rf r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (Out (.ForceFrame :: κ) rf) (Out κ r)

/-- Forcing `f` comes back with `r`. -/
structure Fo (sv : BuiltinSemanticsVariant) (f : CekValue) (r : Option CekValue) : Prop where
  run : ∀ κ, Reaches sv (.Return (.ForceFrame :: κ) f) (Out κ r)

section Lemmas
variable {sv : BuiltinSemanticsVariant}

theorem ev_var {i : Nat} {ρ : Environment} {v : CekValue} (h : List.get?Internal ρ i = some v) :
    Ev sv (.Var i) ρ (some v) :=
  ⟨fun κ => .single (by simp only [step, h, Out])⟩

theorem ev_const {c : Const} {ρ : Environment} : Ev sv (.Const c) ρ (some (.VCon c)) :=
  ⟨fun _ => .single rfl⟩

theorem ev_lam {M : Term} {ρ : Environment} : Ev sv (.Lam M) ρ (some (.VLam M ρ)) :=
  ⟨fun _ => .single rfl⟩

theorem ev_delay {M : Term} {ρ : Environment} : Ev sv (.Delay M) ρ (some (.VDelay M ρ)) :=
  ⟨fun _ => .single rfl⟩

theorem ev_builtin {b : BuiltinFun} {ρ : Environment} :
    Ev sv (.Builtin b) ρ (some (.VBuiltin b [] (expectedArgs b))) :=
  ⟨fun _ => .single rfl⟩

theorem ev_error {ρ : Environment} : Ev sv .Error ρ none :=
  ⟨fun _ => .single rfl⟩

theorem ev_apply {M N : Term} {ρ : Environment} {rf r : Option CekValue} (hM : Ev sv M ρ rf)
    (hK : ArgK sv N ρ rf r) : Ev sv (.Apply M N) ρ r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.LeftApplicationToTerm N ρ :: κ) ρ M) rfl).trans
    ((hM.run _).trans (hK.run κ))⟩

theorem ev_force {M : Term} {ρ : Environment} {rf r : Option CekValue} (hM : Ev sv M ρ rf)
    (hK : ForceK sv rf r) : Ev sv (.Force M) ρ r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.ForceFrame :: κ) ρ M) rfl).trans
    ((hM.run _).trans (hK.run κ))⟩

theorem argk_none {N : Term} {ρ : Environment} : ArgK sv N ρ none none :=
  ⟨fun _ => .refl _ _⟩

theorem argk_some {N : Term} {ρ : Environment} {f : CekValue} {rw r : Option CekValue}
    (hN : Ev sv N ρ rw) (hK : FunK sv f rw r) : ArgK sv N ρ (some f) r :=
  ⟨fun κ => (Reaches.single (b := .Eval (.RightApplicationOfValue f :: κ) ρ N) rfl).trans
    ((hN.run _).trans (hK.run κ))⟩

theorem funk_none {f : CekValue} : FunK sv f none none :=
  ⟨fun _ => .refl _ _⟩

theorem funk_some {f w : CekValue} {r : Option CekValue} (h : Ap sv f w r) : FunK sv f (some w) r :=
  ⟨h.run⟩

theorem ap_lam {M : Term} {ρ : Environment} {w : CekValue} {r : Option CekValue}
    (h : Ev sv M (w :: ρ) r) : Ap sv (.VLam M ρ) w r :=
  ⟨fun κ => (Reaches.single (b := .Eval κ (w :: ρ) M) rfl).trans (h.run κ)⟩

theorem ap_partial {b : BuiltinFun} {Vs : List CekValue} {η : ExpectedBuiltinArgs} {w : CekValue} :
    Ap sv (.VBuiltin b Vs (.More .ArgV η)) w (some (.VBuiltin b (w :: Vs) η)) :=
  ⟨fun _ => .single rfl⟩

theorem evalBuiltin_out (κ : Stack) (b : BuiltinFun) (Vs : List CekValue) :
    evalBuiltin sv κ b Vs = Out κ (evaluateBuiltinFunction sv b Vs) := by
  unfold evalBuiltin
  cases evaluateBuiltinFunction sv b Vs <;> rfl

theorem ap_builtin {b : BuiltinFun} {Vs : List CekValue} {w : CekValue} {r : Option CekValue}
    (h : evaluateBuiltinFunction sv b (w :: Vs) = r) : Ap sv (.VBuiltin b Vs (.One .ArgV)) w r :=
  ⟨fun κ => .single (show evalBuiltin sv κ b (w :: Vs) = _ by rw [evalBuiltin_out, h])⟩

theorem forcek_none : ForceK sv none none :=
  ⟨fun _ => .refl _ _⟩

theorem forcek_some {f : CekValue} {r : Option CekValue} (h : Fo sv f r) : ForceK sv (some f) r :=
  ⟨h.run⟩

theorem fo_delay {M : Term} {ρ : Environment} {r : Option CekValue} (h : Ev sv M ρ r) :
    Fo sv (.VDelay M ρ) r :=
  ⟨fun κ => (Reaches.single (b := .Eval κ ρ M) rfl).trans (h.run κ)⟩

theorem fo_partial {b : BuiltinFun} {Vs : List CekValue} {η : ExpectedBuiltinArgs} :
    Fo sv (.VBuiltin b Vs (.More .ArgQ η)) (some (.VBuiltin b Vs η)) :=
  ⟨fun _ => .single rfl⟩

theorem fo_builtin {b : BuiltinFun} {Vs : List CekValue} {r : Option CekValue}
    (h : evaluateBuiltinFunction sv b Vs = r) : Fo sv (.VBuiltin b Vs (.One .ArgQ)) r :=
  ⟨fun κ => .single (show evalBuiltin sv κ b Vs = _ by rw [evalBuiltin_out, h])⟩

end Lemmas

/-! ## Programs -/

/-- A program whose applied body errors on the empty stack reaches `Error` for some fuel. -/
theorem exec_error_of_ev {v : PlutusCore.UPLC.Term.Version} {body : Term}
    {args : List Term} (h : Ev default (applyParams body args) [] none) :
    ∃ n, cekExecuteProgram (.Program v body) args n = .Error := by
  obtain ⟨n, hn⟩ := h.run []
  exact ⟨n, (runStepsPreservingState_eq_stepN _ _ _).trans hn⟩

/-- A program whose applied body returns `V` on the empty stack halts with `V`, one step later. -/
theorem exec_halt_of_ev {v : PlutusCore.UPLC.Term.Version} {body : Term}
    {args : List Term} {V : CekValue} (h : Ev default (applyParams body args) [] (some V)) :
    ∃ n, cekExecuteProgram (.Program v body) args n = .Halt V := by
  obtain ⟨n, hn⟩ := h.run []
  refine ⟨n + 1, (runStepsPreservingState_eq_stepN _ _ _).trans ?_⟩
  show stepN default (.Eval [] [] (applyParams body args)) (n + 1) = _
  rw [stepN_add, hn]
  rfl

/-- A run that reaches `Error` never halts, at any index. -/
theorem stepN_ne_halt_of_error {sv : BuiltinSemanticsVariant} {s : State} {n₀ : Nat}
    (h : stepN sv s n₀ = .Error) (n : Nat) (V : CekValue) : stepN sv s n ≠ .Halt V := by
  intro hV
  rcases Nat.le_total n n₀ with hle | hle
  · obtain ⟨m, rfl⟩ := Nat.exists_eq_add_of_le hle
    rw [stepN_fix sv s n (Or.inl ⟨V, hV⟩) m, hV] at h
    cases h
  · obtain ⟨m, rfl⟩ := Nat.exists_eq_add_of_le hle
    rw [stepN_fix sv s n₀ (Or.inr h) m, h] at hV
    cases hV

/-- A program that reaches `Error` for some fuel halts for none. -/
theorem exec_never_halts {p : Program} {args : List Term} {n₀ : Nat}
    (h : cekExecuteProgram p args n₀ = .Error) (n : Nat) (V : CekValue) :
    cekExecuteProgram p args n ≠ .Halt V := by
  cases p with
  | Program v body =>
    have e : ∀ k, cekExecuteProgram (.Program v body) args k =
        stepN default (initialState (applyParams body args)) k :=
      fun k => runStepsPreservingState_eq_stepN _ _ _
    rw [e] at h
    rw [e]
    exact stepN_ne_halt_of_error h n V

/-! ## The evaluator

`cek` applies the lemma for the goal's head until none applies: the term's constructor for an
`Ev` goal, the value's shape for an `Ap` or `Fo` goal, and `some`/`none` for a continuation.
Goals come in evaluation order, so a continuation's `rf` is known before it is looked at.
`cek_rfl` closes a lookup's or a builtin's equation by reducing its left side to weak head
normal form, so the values it finds are the reduced ones; the kernel rechecks each. -/

open Lean Meta Elab Tactic in
/-- Close `lhs = rhs` by reducing `lhs` to weak head normal form and unifying it with `rhs`. -/
elab "cek_rfl" : tactic => do
  let g ← getMainGoal
  let tgt ← instantiateMVars (← g.getType)
  let some (_, lhs, rhs) := tgt.eq? | throwError "cek_rfl: not an equation{indentExpr tgt}"
  let lhs' ← whnf lhs
  unless ← isDefEq lhs' rhs do
    throwError "cek_rfl: the left side reduces to{indentExpr lhs'}\nnot{indentExpr rhs}"
  g.assign (← mkEqRefl lhs')
  replaceMainGoal []

/-- One node: the lemma for the goal's head. -/
macro "cek_step" : tactic => `(tactic| first
  | apply ev_apply
  | apply ev_force
  | (apply ev_var; cek_rfl)
  | apply ev_lam
  | apply ev_delay
  | apply ev_const
  | apply ev_builtin
  | apply ev_error
  | apply argk_some
  | apply argk_none
  | apply funk_some
  | apply funk_none
  | apply ap_lam
  | apply ap_partial
  | (apply ap_builtin; cek_rfl)
  | apply forcek_some
  | apply forcek_none
  | apply fo_delay
  | apply fo_partial
  | (apply fo_builtin; cek_rfl))

open Lean Elab Tactic in
/-- Run `t` on the main goal until it fails or no goal is left. A loop, where `repeat` recurses
once per node. -/
elab "cek_repeat " t:tacticSeq : tactic => do
  repeat
    if (← getUnsolvedGoals).isEmpty then break
    let s ← saveState
    try
      evalTactic t
    catch _ =>
      s.restore
      break

/-- Evaluate as far as the lemmas go. -/
macro "cek" : tactic => `(tactic| cek_repeat cek_step)

/-- Evaluate, trying the facts `hs` first at each node: a loop's induction hypothesis, or a
lemma about a loop. -/
syntax "cek_using " "[" term,* "]" : tactic
macro_rules
  | `(tactic| cek_using [$hs,*]) => do
    let mut tac ← `(tactic| cek_step)
    for h in hs.getElems.reverse do
      let rest ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | apply $h | $rest)
    let body ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
    `(tactic| cek_repeat $body)

end Seedelf.V1.LinesAll
