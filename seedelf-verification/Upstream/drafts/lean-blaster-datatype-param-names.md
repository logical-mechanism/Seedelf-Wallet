<!-- New issue on https://github.com/input-output-hk/Lean-blaster -->

# [Bug]: regression on `beta-lambda-cache-optimization`: a datatype is declared with another type's parameter names, so any goal with both `Except` and `Prod` fails

## Description

On `beta-lambda-cache-optimization`, a goal that mentions both `Except` and `Prod` can't be translated, in either order:

```lean
import Blaster

-- ❌ invalid datatype declaration, unknown sort '@ε'
theorem except_after_prod : ∀ (q : Int × Int) (r : Except String Int),
    (match q with | (a, b) => a + b) = 7 →
    (match r with | .ok n => n | .error _ => 0) = 7 → r = .ok 7 := by blaster

-- ❌ invalid datatype declaration, unknown sort '@β'
theorem prod_after_except : ∀ (r : Except String Int) (q : Int × Int),
    (match r with | .ok n => n | .error _ => 0) = 7 →
    (match q with | (a, b) => a + b) = 7 → r = .ok 7 := by blaster
```

The same `Except` goal without the `Prod` passes, and both pass on `main`.

`translateInductiveType` names a datatype's SMT parameters from a telescope over `(← hashcons indVal.type)` (`genIndParams`), and its constructor fields from a telescope over each recursor rule (`createCtorDeclaration`). Expression equality ignores binder names, so the hash-consed type is whichever alpha-equivalent type the goal met first, with *its* binder names. `Except.{u,v}` and `Prod.{u,v}` share the type `Type u → Type v → Type (max u v)`: whichever comes second is declared with the other's parameter names (`α β` vs `ε α`) and fields over its own. On `main` (`a16614e`), `genIndParams` telescopes `indVal.type` itself, and the same file passes in full.

When the names are the same in another order, both sorts are bound but the fields' sorts come out swapped:

```lean
inductive AlphaBeta (α : Type) (β : Type) where
  | left : α → AlphaBeta α β
  | right : β → AlphaBeta α β

inductive BetaAlpha (β : Type) (α : Type) where
  | left : β → BetaAlpha β α
  | right : α → BetaAlpha β α

-- ✅ Valid (left holds the only Unit)
theorem beta_alpha_lefts_equal : ∀ (r s : BetaAlpha Unit Int),
    (match r with | .left _ => true | .right _ => false) = true →
    (match s with | .left _ => true | .right _ => false) = true → r = s := by blaster

-- ❌ unknown constant @isInt (@PUnit): BetaAlpha's fields were declared over AlphaBeta's order
theorem beta_alpha_lefts_equal_after_alpha_beta : ∀ (q : AlphaBeta Int Int) (r s : BetaAlpha Unit Int),
    (match q with | .left n => n | .right n => n) = 7 →
    (match r with | .left _ => true | .right _ => false) = true →
    (match s with | .left _ => true | .right _ => false) = true → r = s := by blaster
```

Here it surfaced as an SMT sort error in the instance predicate; we haven't produced a wrong verdict from it, but the declaration is wrong.

## Steps to Reproduce

The four theorems above, with `lake env lean` in a package on `beta-lambda-cache-optimization` @ `46c8479`. Controls that pass on both revisions: each of `Option Int`, `AlphaBeta Int Int`, an `EpsAlpha (ε α)` copy of `AlphaBeta`, a one-parameter `JustX (x)`, and `Except String Int`, alone. `EpsAlpha` after `AlphaBeta` fails like `Except` after `Prod`; `Except` after `AlphaBeta` passes (different universes, so not alpha-equivalent).

## Actual Behavior

```
error: Unexpected smt error: (error "line 18 column 18: invalid datatype declaration, unknown sort '@ε'")
 for (declare-datatype @Except (par ( |@α| |@β|) ( (Except.error  (Except.error.0 |@ε|))
 (Except.ok  (Except.ok.0 |@α|))
)))

error: Unexpected smt error: (error "line 21 column 18: invalid datatype declaration, unknown sort '@β'")
 for (declare-datatype @Prod (par ( |@ε| |@α|) ( (Prod.mk  (Prod.mk.0 |@α|) (Prod.mk.1 |@β|))
)))

error: Unexpected smt error: (error "line 26 column 219: unknown constant @isInt (@PUnit)
 for (define-fun @isUpstream.ExceptParams.BetaAlpha._uniq.5244 ((@x (@Upstream.ExceptParams.BetaAlpha  @PUnit Int))) Bool (ite (is-Upstream.ExceptParams.BetaAlpha.right @x) (@isInt (Upstream.ExceptParams.BetaAlpha.right.0 @x)) (ite (is-Upstream.ExceptParams.BetaAlpha.left @x) (@isPUnit (Upstream.ExceptParams.BetaAlpha.left.0 @x)) true)
)
)
```

## Expected Behavior

`Valid` for all four, as on `main` (`a16614e`), where the same file gives `Valid` for every theorem and the expected `Falsified` for the false variants.

## Impact

PlutusCoreBlaster's BLS12-381 builtins (`bls12_381_G1_uncompress` and friends) return `Except String _`, and goals over its CEK model translate `Prod` (`Data × Data`) first, so no property of a validator that reaches a BLS12-381 builtin over a symbolic input can be checked. We hit it proving [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet)'s wallet validator as deployed on mainnet (script hash `94bca9c0…`, a Schnorr proof over BLS12-381), with exactly the `@Except` error above. Every PlutusCoreBlaster user meets it today: PlutusCoreBlaster `main` pins `bc03bb4`, which has the line, PlutusCoreBlaster #68 moves that pin to `8816f72`, which has it too, and CardanoLedgerApiBlaster requires the beta branch. #155 (beta → `main`) would bring it to `main`.

Draft #335 would fix it as a side effect (it takes the names from the first constructor's type), but it has no test for this case and comes with the match-translation changes; the one-line fix below, with this repro as its regression test, could land on its own first.

## Suggested fix

In `genIndParams`, telescope `indVal.type` itself, as `main` does, or take the parameter names from the recursor rule's telescope so the parameters and the fields agree. Hash-consing elsewhere is fine; only the binder names leak.

## Lean Version

4.24.0

## Z3 Version

5.3.1

## Additional Context

- Fails: Lean-blaster `46c8479cec1c3e45775ffb873397783a459fa9cc` (`beta-lambda-cache-optimization`), as CardanoLedgerApiBlaster `9938562` resolves it. The line was added in `bafdd4f` (the hash-consing squash); PlutusCoreBlaster's pins `bc03bb4` and `8816f72` have it.
- Passes: Lean-blaster `a16614e5e44a693664043552f259235f15f1c884` (`main`), same file, same Lean and Z3.
- Linux x86_64.
