import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses
import Audit.V2.Common
import Blaster

/-! Step limits and results for v2's general Mix of two in an ADA pool. Five theorems, each
`✅ Valid`, and two `✅ Expected Falsified`.

- No run of the three preparations is cut off at their limit, 20000: each halts or errors.
  So for this scenario the bounded-run caveat goes, and `MixAnyFirst`/`MixAnySecond` with
  `MixAnyPasses` are the whole iff, not only for runs that finish.
- Every halt of the Passes preparation is the unit constant: `isSuccessful` there means
  what the ledger accepts, not only "halted with some value".
- The limit is sharp: at 11496 steps, one under the KAT's 11497, the Passes theorem is
  Falsified; at 11497 it's Valid. So the symbolic run takes the concrete run's steps
  exactly (a Valid at 11496 would mean they differ; a Falsified at 11497, that some
  passing run is longer than the KAT's).
- At 7000 steps, before any proof check (the earliest, the challenge, errors after 7869),
  the first-branch theorem is Falsified: `isUnsuccessful` isn't reached for free. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

/-- Every run of `MixAnyPasses`' preparation halts or errors within 20000 steps. -/
theorem audit_mix_any_passes_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ∨
        isUnsuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- So does every run of `MixAnyFirst`'s. -/
theorem audit_mix_any_first_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixAnyFirst.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ∨
        isUnsuccessful (appliedMixAnyFirst.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- And of `MixAnySecond`'s. -/
theorem audit_mix_any_second_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ∨
        isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- Every halt of `MixAnyPasses`' preparation is the unit constant. -/
theorem audit_mix_any_halts_with_unit :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) →
        auditHaltsWithUnit (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

#prep_uplc auditV2MixAnyAt11496 mixLogicTemplate anyArgs 11496

-- One step under the KAT's 11497, a passing Mix can't finish.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (auditV2MixAnyAt11496.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

#prep_uplc auditV2MixAnyAt11497 mixLogicTemplate anyArgs 11497

/-- At the KAT's own count, every passing Mix finishes. -/
theorem audit_mix_any_passes_at_11497 :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (auditV2MixAnyAt11497.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

#prep_uplc auditV2MixAnyAt7000 mixLogicTemplate anyArgs 7000

-- At 7000 steps no proof check has run: a failing branch isn't an Error yet.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
      isUnsuccessful (auditV2MixAnyAt7000.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

end Lovejoin.V2.Any
