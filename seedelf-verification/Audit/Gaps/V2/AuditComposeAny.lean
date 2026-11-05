import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses

/-! Audit scratch (v2-mix-spec), not part of the suite: v2's general Mix of two in any ADA
pool, its iff as ONE Lean theorem, assembled from `MixAnyFirst`'s, `MixAnySecond`'s and
`MixAnyPasses`' parts. No `blaster` runs here: the assembly is checked by Lean's kernel, and
the parts' own `blasterProven` is all it inherits.

The parts are stated over three different constants (`appliedMixAnyFirst.prop`, `…Second`,
`…Passes`), each `#prep_uplc`'s optimization of the same program, arguments and step limit
(`mixLogicTemplate anyArgs 20000`). `first_is_passes` and `second_is_passes` ask whether
those are one function by `rfl`. If they elaborate, `mix_any_iff` holds; if `rfl` fails, the
three `prop`s differ as terms and the iff exists only on paper until the family shares one
`#prep_uplc`. -/

namespace Lovejoin.V2.Any.AuditCompose
open Lovejoin.V2
open Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

theorem first_is_passes : appliedMixAnyFirst.prop = appliedMixAnyPasses.prop := rfl
theorem second_is_passes : appliedMixAnySecond.prop = appliedMixAnyPasses.prop := rfl

/-- A run can't both halt and error. -/
theorem not_both (s : PlutusCore.UPLC.CekMachine.State) (h : isSuccessful s) (e : isUnsuccessful s) : False := by
  cases s
  all_goals first
    | exact (h : False).elim
    | exact (e : False).elim

/-- Success implies the spec, for every pool and every field (no side condition). -/
theorem mix_any_success_needs_spec
    (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString)
    (hs : isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)) :
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true := by
  cases hm : mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 with
  | true => rfl
  | false =>
    exfalso
    unfold mixAcceptsAny inputAcceptsAny at hm
    rw [Bool.and_eq_false_iff] at hm
    rcases hm with h1 | h2
    · rw [Bool.and_eq_false_iff, Bool.and_eq_false_iff] at h1
      rcases h1 with (hc | hb) | hb
      · have e := mix_any_needs_the_first_challenge P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hc
        rw [first_is_passes] at e
        exact not_both _ hs e
      · have e := mix_any_needs_the_first_proofs_first_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hb
        rw [first_is_passes] at e
        exact not_both _ hs e
      · have e := mix_any_needs_the_first_proofs_second_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hb
        rw [first_is_passes] at e
        exact not_both _ hs e
    · rw [Bool.and_eq_false_iff, Bool.and_eq_false_iff] at h2
      rcases h2 with (hc | hb) | hb
      · have e := mix_any_needs_the_second_challenge P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hc
        rw [second_is_passes] at e
        exact not_both _ hs e
      · have e := mix_any_needs_the_second_proofs_first_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hb
        rw [second_is_passes] at e
        exact not_both _ hs e
      · have e := mix_any_needs_the_second_proofs_second_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hb
        rw [second_is_passes] at e
        exact not_both _ hs e

/-- The iff, under `MixAnyPasses`' side conditions, over one constant. -/
theorem mix_any_iff
    (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString)
    (hP : P ≠ "") (hbl : bl ≠ 0)
    (w1 : wellFormed a1 b1 = true) (w2 : wellFormed a2 b2 = true)
    (w3 : wellFormed oa1 ob1 = true) (w4 : wellFormed oa2 ob2 = true) :
    isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ↔
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true :=
  ⟨mix_any_success_needs_spec P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22,
   mix_any_passes_with_both_proofs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 hP hbl w1 w2 w3 w4⟩

#print axioms mix_any_iff

end Lovejoin.V2.Any.AuditCompose
