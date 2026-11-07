import Lovejoin.AnyTx.CekCase
import Lovejoin.AnyTx.BoxSearch
import Lovejoin.Logic
import Lovejoin.Template.Scripts
import Lovejoin.Template.Launch

/-! # mix_logic in every transaction: what the modules share

`Lovejoin.Every` proves what mix_logic's withdrawal does in every transaction, kernel-checked,
with no fixed list length and no step limit. Its spec (`Spec.lean`) is the compiled code read
back into Lean, a function over `Data` whose `none` is the script's error; the CEK theorems say
the program computes it, and `Typed.lean` says what it accepts in the ledger's own terms.

This file has the program, the subterms the lemmas name (by path, BoxSearch's convention), the
builtin values the program forces at its start, and the environments the regions run in. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const BuiltinFun)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Lovejoin.AnyTx.BoxSearch (subterm)
open Lovejoin.Template (nftName)

/-- mix_logic's template, unapplied: v2's 7fb45b75…, the bytes every v2 pool runs at its own
NFT policy. -/
def body : Term := match mixLogicTemplate.script with | .Program _ b => b

/-- The subterm at a path. -/
def sub (p : List Nat) : Term := subterm body p

/-! ### Data -/

/-- `unBData`'s value, or its error. -/
def bytesOf : Data → Option ByteString
  | .B b => some b
  | _ => none

/-- `unIData`'s value, or its error. -/
def intOf : Data → Option Integer
  | .I i => some i
  | _ => none

/-! ### Values -/

/-- The builtins the program forces into its first let, as the CEK machine holds them. -/
abbrev vChooseData : CekValue :=
  .VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV))))))
abbrev vTail : CekValue := .VBuiltin .TailList [] (.One .ArgV)
abbrev vHead : CekValue := .VBuiltin .HeadList [] (.One .ArgV)
abbrev vMkCons : CekValue := .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV))
abbrev vChooseList : CekValue := .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV)))
abbrev vSnd : CekValue := .VBuiltin .SndPair [] (.One .ArgV)
abbrev vFst : CekValue := .VBuiltin .FstPair [] (.One .ArgV)
abbrev vIte : CekValue := .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV)))

/-- `equalsInteger k`, applied to its first argument. -/
abbrev vEq (k : Integer) : CekValue := .VBuiltin .EqualsInteger [.VCon (.Integer k)] (.One .ArgV)

/-- The program's first let, innermost first: `ifThenElse` (i_10) down to `chooseData` (i_3),
on top of `rest`. -/
abbrev withBuiltins (rest : Environment) : Environment :=
  vIte :: vFst :: vSnd :: vChooseList :: vMkCons :: vHead :: vTail :: vChooseData :: rest

/-- Where the main body (i_30's delay) runs: the redeemer `red` and the TxInfo `info`, the
pool's NFT `P` and name, `equalsInteger` at 0, 1 and 2, and slots the body never reads. -/
abbrev env29 (c0 c1 c3 c8 c9 c10 c11 : CekValue) (info red : Data) (P : ByteString)
    (rest : Environment) : Environment :=
  c0 :: c1 :: vEq 1 :: c3 :: .VCon (.Data red) :: .VCon (.Data info) :: vEq 0 :: vEq 2 ::
    c8 :: c9 :: c10 :: c11 :: .VCon (.ByteString nftName) :: .VCon (.ByteString P) :: withBuiltins rest

end Lovejoin.Every

namespace Lovejoin.Every
open Lean Elab Tactic
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

open Lean Meta Elab Tactic in
/-- Close a goal from the context, but an equation only if it is a slot lookup
(`List.get?Internal ρ i = some v`), and then only by a slot hypothesis. Any other equation
left open (a builtin's, say) must never be unified with a fact like `v < q = false`: deciding
that by reduction unfolds the subtraction from `q` one unit at a time. -/
elab "safe_assumption" : tactic => withMainContext do
  let g ← getMainGoal
  let tgt ← instantiateMVars (← g.getType)
  match tgt.eq? with
  | some (_, lhs, _) =>
    unless lhs.isAppOf ``List.get?Internal do throwError "safe_assumption: not a slot lookup"
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
    throwError "safe_assumption: no slot hypothesis"
  | none => evalTactic (← `(tactic| assumption))

/-- One node, with a variable's slot found by a hypothesis when the environment is abstract
(a loop's closure environment): `cek_v3_step`, but `ev_var`'s lookup by `cek_rfl` or by a slot
hypothesis, and a lemma's leftover side goal from the context (`safe_assumption`). -/
macro "ev_step" : tactic => `(tactic| first
  | (apply ev_var; first | cek_rfl | safe_assumption)
  | cek_v3_step
  | safe_assumption)

/-- Evaluate as far as the lemmas go, trying the facts `hs` first at each node. -/
syntax "ev_using " "[" term,* "]" : tactic
macro_rules
  | `(tactic| ev_using [$hs,*]) => do
    let mut tac ← `(tactic| ev_step)
    for h in hs.getElems.reverse do
      let rest ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
      tac ← `(tactic| first | apply $h | $rest)
    let body ← `(Lean.Parser.Tactic.tacticSeq| $tac:tactic)
    `(tactic| cek_repeat $body)

/-- `ev_using`, and where a node is stuck on a condition the proof has cased on, rewrite it
with the facts `rs`: by `simp only` (it fails when it rewrites nothing, so the loop stops
there), or by `rw` with one fact, which also reaches a condition already inside a
`Decidable` instance, where `simp` doesn't look. -/
syntax "ev_go " "[" term,* "]" "[" Lean.Parser.Tactic.simpLemma,* "]" : tactic
macro_rules
  | `(tactic| ev_go [$hs,*] [$rs,*]) => do
    let mut tac ← `(tactic| first | ev_step | simp only [$rs,*])
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

end Lovejoin.Every
