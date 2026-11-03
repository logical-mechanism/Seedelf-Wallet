import Blaster

/-! Repro for Lean-blaster: a datatype declared with a sort it doesn't bind.

Inside PlutusCoreBlaster's model, a goal reaching `bls12_381_G1_uncompress`
(which returns `Except String _`) fails with
  invalid datatype declaration, unknown sort '@ε'
  for (declare-datatype @Except (par (|@α| |@β|) ((Except.error (Except.error.0 |@ε|))
                                                  (Except.ok (Except.ok.0 |@α|)))))
The parameters are `@α @β`; the fields refer to `@ε @α`, `Except`'s binder names.
`translateInductiveType` names the parameters from a telescope over
`(← hashcons indVal.type)` (`genIndParams`) and the fields from one over each
recursor rule (`createCtorDeclaration`). Expression equality ignores binder
names, so the hash-consed type is whichever alpha-equivalent one was seen
first, with its names: each datatype passes alone and fails after one with the
same type and other names. On Lean-blaster `main` (a16614e) `genIndParams`
telescopes `indVal.type` itself, and this file passes in full there
(`./check.sh upstream-main`): a regression on the beta branch. Every statement
is true in Lean and needs the solver. -/

namespace Upstream.ExceptParams

inductive AlphaBeta (α : Type) (β : Type) where
  | left : α → AlphaBeta α β
  | right : β → AlphaBeta α β

inductive EpsAlpha (ε : Type) (α : Type) where
  | left : ε → EpsAlpha ε α
  | right : α → EpsAlpha ε α

/-- Parameters named β, α: in reverse of what positional names would give. -/
inductive BetaAlpha (β : Type) (α : Type) where
  | left : β → BetaAlpha β α
  | right : α → BetaAlpha β α

inductive JustX (x : Type) where
  | mk : x → JustX x

-- Controls: parameters named as positional names would be.
theorem option_alone : ∀ (r : Option Int),
    (match r with | some n => n | none => 0) = 7 → r = some 7 := by blaster
theorem alpha_beta_alone : ∀ (r : AlphaBeta Int Int),
    (match r with | .left n => n | .right n => n) = 7 → r = .left 7 ∨ r = .right 7 := by blaster

-- Alone: fails if the names are positional.
theorem eps_alpha_alone : ∀ (r : EpsAlpha Int Int),
    (match r with | .left n => n | .right n => n) = 7 → r = .left 7 ∨ r = .right 7 := by blaster
theorem just_x_alone : ∀ (r : JustX Int),
    (match r with | .mk n => n) = 7 → r = .mk 7 := by blaster
theorem except_alone : ∀ (r : Except String Int),
    (match r with | .ok n => n | .error _ => 0) = 7 → r = .ok 7 := by blaster

-- After an alpha-equivalent type with α β binders: fails if the hash-consed type keeps the first names.
theorem eps_alpha_after_alpha_beta : ∀ (q : AlphaBeta Int Int) (r : EpsAlpha Int Int),
    (match q with | .left n => n | .right n => n) = 7 →
    (match r with | .left n => n | .right n => n) = 7 →
    (r = .left 7 ∨ r = .right 7) := by blaster
theorem except_after_alpha_beta : ∀ (q : AlphaBeta Int Int) (r : Except String Int),
    (match q with | .left n => n | .right n => n) = 7 →
    (match r with | .ok n => n | .error _ => 0) = 7 → r = .ok 7 := by blaster

-- `Except.{u,v}` and `Prod.{u,v}` share the type `Type u → Type v → Type (max u v)`, where
-- `AlphaBeta`'s is `Type → Type → Type`: PlutusCoreBlaster's goals translate `Prod` (`Data × Data`)
-- before a BLS12-381 builtin's `Except`.
theorem except_after_prod : ∀ (q : Int × Int) (r : Except String Int),
    (match q with | (a, b) => a + b) = 7 →
    (match r with | .ok n => n | .error _ => 0) = 7 → r = .ok 7 := by blaster
-- The other way round, `Prod` would get `Except`'s names.
theorem prod_after_except : ∀ (r : Except String Int) (q : Int × Int),
    (match r with | .ok n => n | .error _ => 0) = 7 →
    (match q with | (a, b) => a + b) = 7 → r = .ok 7 := by blaster

-- Reversed names declare both sorts, so nothing is rejected: are the fields' sorts swapped?
-- `left` holds the only Unit, so two lefts are equal; Blaster must prove this...
theorem beta_alpha_lefts_equal : ∀ (r s : BetaAlpha Unit Int),
    (match r with | .left _ => true | .right _ => false) = true →
    (match s with | .left _ => true | .right _ => false) = true → r = s := by blaster
-- ...and must not prove this (`right` holds an Int): expect Falsified.
#blaster (solve-result: 1) [∀ (r s : BetaAlpha Unit Int),
    (match r with | .left _ => false | .right _ => true) = true →
    (match s with | .left _ => false | .right _ => true) = true → r = s]
-- The same two after AlphaBeta has been seen.
theorem beta_alpha_lefts_equal_after_alpha_beta : ∀ (q : AlphaBeta Int Int) (r s : BetaAlpha Unit Int),
    (match q with | .left n => n | .right n => n) = 7 →
    (match r with | .left _ => true | .right _ => false) = true →
    (match s with | .left _ => true | .right _ => false) = true → r = s := by blaster
#blaster (solve-result: 1) [∀ (q : AlphaBeta Int Int) (r s : BetaAlpha Unit Int),
    (match q with | .left n => n | .right n => n) = 7 →
    (match r with | .left _ => false | .right _ => true) = true →
    (match s with | .left _ => false | .right _ => true) = true → r = s]

end Upstream.ExceptParams
