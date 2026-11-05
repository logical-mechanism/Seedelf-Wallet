import Lovejoin.V2.MixAnyPasses
import Audit.V2.Common
import Blaster

/-! v2's Mix of two in any ADA pool, its iff restated over `cekExecuteProgram` itself:
mix_logic's template, `anyArgs`, 20000 steps. The existing theorems are over each
`#prep_uplc`'s `prop`, the optimizer's output, and nothing proves that equal to the run
(`exec`). Here the tactic optimizes the CEK machine's own run, so each statement is about
the machine, as `PlutusCoreBlaster`'s `Tests/Bitwise/ByteStringToIntegerSymbolic` does.
Seven theorems, each `✅ Valid`: the six "needs" of `MixAnyFirst` and `MixAnySecond`, then
Passes. Each re-runs the symbolic execution, so each costs about a preparation. First, by
`rfl`, that a preparation's `exec` is this run: the `#guard`s, which run `exec`, run it. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `MixAnyPasses`' `exec` is the CEK machine's run, by definition. -/
theorem audit_mix_any_passes_exec_is_the_run :
    appliedMixAnyPasses.exec = fun (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) => cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000 := rfl

/-- `mix_any_needs_the_first_challenge`, over `cekExecuteProgram` itself. -/
theorem audit_mix_any_needs_the_first_challenge_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_needs_the_first_proofs_first_branch`, over `cekExecuteProgram`. -/
theorem audit_mix_any_needs_the_first_proofs_first_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_needs_the_first_proofs_second_branch`, over `cekExecuteProgram`. -/
theorem audit_mix_any_needs_the_first_proofs_second_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_needs_the_second_challenge`, over `cekExecuteProgram`. -/
theorem audit_mix_any_needs_the_second_challenge_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_needs_the_second_proofs_first_branch`, over `cekExecuteProgram`. -/
theorem audit_mix_any_needs_the_second_proofs_first_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_needs_the_second_proofs_second_branch`, over `cekExecuteProgram`. -/
theorem audit_mix_any_needs_the_second_proofs_second_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

/-- `mix_any_passes_with_both_proofs`, over `cekExecuteProgram`. -/
theorem audit_mix_any_passes_with_both_proofs_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
