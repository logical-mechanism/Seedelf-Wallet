import Lovejoin.V2.MixFirst
import Lovejoin.V2.MixSecond
import Lovejoin.V2.MixPasses

/-! Audit (statements), for the owner to run: `MixSplit` says its three parts and the tie-in
lemmas "together are the iff", but no Lean theorem states it, and the parts run three
separate `#prep_uplc`s (`appliedMixFirst`, `appliedMixSecond`, `appliedMixPasses`). Here the
kernel checks that the three preps are one term (`rfl`) and that the iff follows. No new
`blaster` call: everything below is Lean's own, over the parts' theorems.

Built in place as `Audit.Gaps.V2.AuditMixIff`, in `./check.sh audit-quick`, or alone,
`./check.sh Audit.Gaps.V2.AuditMixIff`. Expected: no errors; `#print axioms` lists
`blasterProven` (from the parts) and Lean's standard axioms, never `sorryAx`. If either
`rfl` fails, the three preps aren't the same term and the prose composition needs another
look. -/

namespace Lovejoin.V2.AuditStatements
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Utils
open PlutusCore.UPLC.CekMachine (State)

theorem first_prep_is_passes_prep : appliedMixFirst.prop = appliedMixPasses.prop := rfl
theorem second_prep_is_passes_prep : appliedMixSecond.prop = appliedMixPasses.prop := rfl

theorem not_successful_of_unsuccessful (s : State) : isUnsuccessful s → ¬ isSuccessful s := by
  intro h hs
  cases s <;> first | exact h | exact hs

/-- v2's Mix of two at the test launch succeeds iff `mixAccepts`, as one Lean theorem. -/
theorem mix_iff (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) :
    isSuccessful (appliedMixPasses.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ↔
      mixAccepts t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true := by
  constructor
  · intro hs
    rw [mixAccepts_halves, firstAccepts_parts, secondAccepts_parts]
    cases h1 : firstChallengeHolds t011 t111 c11 t012 t112 c12
    · have := mix_needs_the_first_challenge t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h1
      rw [first_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    cases h2 : branchHolds inA1 inB1 outA1 outB1 t011 t111 c11 z11
    · have := mix_needs_the_first_proofs_first_branch t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h2
      rw [first_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    cases h3 : branchHolds inA1 inB1 outA2 outB2 t012 t112 c12 z12
    · have := mix_needs_the_first_proofs_second_branch t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h3
      rw [first_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    cases h4 : secondChallengeHolds t021 t121 c21 t022 t122 c22
    · have := mix_needs_the_second_challenge t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h4
      rw [second_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    cases h5 : branchHolds inA2 inB2 outA1 outB1 t021 t121 c21 z21
    · have := mix_needs_the_second_proofs_first_branch t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h5
      rw [second_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    cases h6 : branchHolds inA2 inB2 outA2 outB2 t022 t122 c22 z22
    · have := mix_needs_the_second_proofs_second_branch t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 h6
      rw [second_prep_is_passes_prep] at this
      exact absurd hs (not_successful_of_unsuccessful _ this)
    rfl
  · exact mix_passes_with_both_proofs t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22

#print axioms mix_iff

end Lovejoin.V2.AuditStatements
