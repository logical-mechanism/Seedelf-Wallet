import Seedelf.Wallet
import Lovejoin.AnyTx.CekCase

/-! # The wallet in every transaction: what the modules share

`Seedelf.Every` proves what the wallet (94bca9c0…) accepts in every transaction, kernel-checked:
no Blaster, no step limit, any number of signatories. The method is chunk 45's for Lovejoin
(`Lovejoin/Every/README.md`): the spec is the compiled code read back as a Lean function over
`Data`, whose `none` is the script's error, and one `Ev` theorem per region says the program
computes it.

This file has the program, the subterms the lemmas name (by path, as `aiken uplc decode` and
`Lovejoin/Every/tools/pseudo.py` print them), the builtin values the program forces at its start,
and the tactics. The tactics are Lovejoin.Every.Base's, under their own names (`w_go` for `ev_go`),
so a module may import both. Only `Lovejoin.AnyTx.CekCase` is shared: it imports nothing of
Lovejoin's scripts. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const BuiltinFun)
open PlutusCore.UPLC.CekValue (CekValue Environment)

/-- The wallet as deployed, its seed `acabcafe` applied: variant 1's 94bca9c0…. -/
def body : Term := match wallet.script with | .Program _ b => b

/-- Navigate the decoded term; for case, 0 is the scrutinee and n+1 is branch n
(Lovejoin.AnyTx.BoxSearch's `subterm`, which imports a Lovejoin script). -/
def subterm (t : Term) (path : List Nat) : Term :=
  match path, t with
  | [], t => t
  | _ :: ps, .Lam b => subterm b ps
  | _ :: ps, .Delay b => subterm b ps
  | _ :: ps, .Force b => subterm b ps
  | 0 :: ps, .Apply f _ => subterm f ps
  | _ :: ps, .Apply _ a => subterm a ps
  | 0 :: ps, .Case scrut _ => subterm scrut ps
  | (n+1) :: ps, .Case _ branches => subterm (branches[n]?.getD .Error) ps
  | n :: ps, .Constr _ fields => subterm (fields[n]?.getD .Error) ps
  | _ :: _, t => t
termination_by structural path

/-- The subterm at a path. -/
def sub (p : List Nat) : Term := subterm body p

/-! ### Data -/

/-- `unBData`'s value, or its error. -/
def bytesOf : Data → Option ByteString
  | .B b => some b
  | _ => none

/-- `sndPair (unConstrData d)`: a constructor's fields, whatever its tag, or the error. -/
def fieldsOf : Data → Option (List Data)
  | .Constr _ fs => some fs
  | _ => none

/-- `unListData`'s value, or its error. -/
def listOf : Data → Option (List Data)
  | .List l => some l
  | _ => none

/-! ### Values -/

/-- The builtins the program forces into its first lets, as the CEK machine holds them. -/
abbrev vChooseData : CekValue :=
  .VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV))))))
abbrev vTail : CekValue := .VBuiltin .TailList [] (.One .ArgV)
abbrev vHead : CekValue := .VBuiltin .HeadList [] (.One .ArgV)
abbrev vMkCons : CekValue := .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV))
abbrev vChooseList : CekValue := .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV)))
abbrev vSnd : CekValue := .VBuiltin .SndPair [] (.One .ArgV)
abbrev vFst : CekValue := .VBuiltin .FstPair [] (.One .ArgV)
abbrev vIte : CekValue := .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV)))

/-- `equalsInteger k`, applied to its first argument (i_18 is `equalsInteger 0`). -/
abbrev vEq (k : Integer) : CekValue := .VBuiltin .EqualsInteger [.VCon (.Integer k)] (.One .ArgV)

/-! ### Paths

Each is a binder's body as `pseudo.py` prints it. Levels `i_N` are aiken's names. -/

/-- The Register check (a delay's body): the datum is `Constr 0 [B g, B u]`, exactly. It runs
over levels i_0 to i_32. -/
def regAt : List Nat :=
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,
   1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,
   0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0]

end Seedelf.Every

namespace Seedelf.Every
open Lean Elab Tactic
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

open Lean Meta Elab Tactic in
/-- Close a goal from the context, but an equation only if it is a slot lookup
(`List.get?Internal ρ i = some v`), and then only by a slot hypothesis (Lovejoin.Every.Base's
`safe_assumption`: an equation like `v < q = false` must never be unified with a builtin's). -/
elab "w_safe" : tactic => withMainContext do
  let g ← getMainGoal
  let tgt ← instantiateMVars (← g.getType)
  match tgt.eq? with
  | some (_, lhs, _) =>
    unless lhs.isAppOf ``List.get?Internal do throwError "w_safe: not a slot lookup"
    for ldecl in ← getLCtx do
      if ldecl.isImplementationDetail then continue
      let ty ← instantiateMVars ldecl.type
      let some (_, l2, _) := ty.eq? | continue
      unless l2.isAppOf ``List.get?Internal do continue
      let s ← saveState
      if ← isDefEq tgt ty then
        g.assign ldecl.toExpr
        replaceMainGoal []
        return
      s.restore
    throwError "w_safe: no slot hypothesis"
  | none => evalTactic (← `(tactic| assumption))

/-- One node: `cek_v3_step`, with a variable's slot found by `cek_rfl` or by a slot hypothesis. -/
macro "w_step" : tactic => `(tactic| first
  | (apply ev_var; first | cek_rfl | w_safe)
  | cek_v3_step
  | w_safe)

/-- Evaluate as far as the lemmas go, trying the facts `hs` first at each node. -/
syntax "w_using " "[" term,* "]" : tactic
macro_rules
  | `(tactic| w_using [$hs,*]) => do
    let mut tac ← `(tactic| w_step)
    for h in hs.getElems.reverse do
      let rest ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | apply $h | $rest)
    let body ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
    `(tactic| cek_repeat $body)

/-- `w_using`, and where a node is stuck on a condition the proof has cased on, rewrite it with
the facts `rs`, by `simp only` or by `rw` with one fact (Lovejoin.Every.Base's `ev_go`). -/
syntax "w_go " "[" term,* "]" "[" Lean.Parser.Tactic.simpLemma,* "]" : tactic
macro_rules
  | `(tactic| w_go [$hs,*] [$rs,*]) => do
    let mut tac ← `(tactic| first | w_step | simp only [$rs,*])
    for r in rs.getElems do
      let t : Lean.TSyntax `term := ⟨r.raw[2]⟩
      let seq ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | $seq | rw [$t:term])
    for h in hs.getElems.reverse do
      let rest ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | apply $h | $rest)
    let body ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
    `(tactic| cek_repeat $body)

/-- A continuation that only returns: whatever came back, `none` included. -/
theorem values_nil_any {sv : PlutusCore.Default.BuiltinSemanticsVariant}
    (r : Option PlutusCore.UPLC.CekValue.CekValue) :
    ValuesK sv [] r r := ⟨fun _ => .refl _ _⟩

/-- `lessThanInteger` at a result the proof has cased on: the machine would otherwise decide
`v < q` by reduction, which unfolds the subtraction from `q` one unit at a time. -/
theorem ap_lessThan (v w : PlutusCore.Integer.Integer) (b : Bool)
    (h : PlutusCore.Integer.lessThanInteger v w = b) :
    Ap default (.VBuiltin .LessThanInteger [.VCon (.Integer v)] (.One .ArgV)) (.VCon (.Integer w))
      (some (.VCon (.Bool b))) := by
  subst h
  exact ap_builtin rfl

/-- `lessThanEqualsInteger` at a result the proof has cased on. -/
theorem ap_lessThanEquals (v w : PlutusCore.Integer.Integer) (b : Bool)
    (h : PlutusCore.Integer.lessThanEqualsInteger v w = b) :
    Ap default (.VBuiltin .LessThanEqualsInteger [.VCon (.Integer v)] (.One .ArgV)) (.VCon (.Integer w))
      (some (.VCon (.Bool b))) := by
  subst h
  exact ap_builtin rfl

end Seedelf.Every
