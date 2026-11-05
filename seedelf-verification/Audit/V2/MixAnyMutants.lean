import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses
import Audit.V2.Common
import Blaster

/-! Mutants of v2's general Mix of two in an ADA pool: each existing theorem with one thing
changed, over its own preparation. Each must come back Falsified, six `✅ Expected
Falsified`; a Valid one fails the build.

1. Passes with box in 1's second branch dropped from the spec, and 2. box in 2's first:
   the script checks each branch, so a spec without one accepts Mixes that fail.
3. `MixAnyFirst`'s first-branch theorem with `auditBranchHoldsT1` (the first equation's
   `T0` replaced by `T1`): the theorem pins the equation's terms. Asked over every input, it
   timed out (⚠️ Undetermined, 2026-11-03). A counterexample needs only one, so it's asked
   where both boxes in share their points and their branches, (t0j, t1j, cj, zj) for box
   out j, and Z3 needn't build two different boxes.
4. `MixAnySecond`'s second-branch theorem against box out 1 instead of box out 2: the
   theorem pins which box out each branch answers to.
5. `MixAnyFirst`'s theorem with its hypothesis replaced by `z11 ≠ z12`, and 6.
   `MixAnySecond`'s by `t021 ≠ t022`: fields the script never compares. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

set_option linter.unusedVariables false in
/-- `mixAcceptsAny` without box in 1's second branch. -/
def auditMixAcceptsAnyNo12 (M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  (challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 &&
    branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11) &&
    inputAcceptsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 z21 t022 t122 c22 z22

set_option linter.unusedVariables false in
/-- `mixAcceptsAny` without box in 2's first branch. -/
def auditMixAcceptsAnyNo21 (M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  inputAcceptsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 &&
    (challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 &&
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22)

-- 1. Passes, box in 1's second branch dropped from the spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    auditMixAcceptsAnyNo12 M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 2. Passes, box in 2's first branch dropped from the spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    auditMixAcceptsAnyNo21 M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 3. The first branch's theorem over a wrong equation (T1 for T0), where both boxes in share
-- their points and branches (above).
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 t01 t11 c1 z1 t02 t12 c2 z2 : ByteString),
    auditBranchHoldsT1 a b oa1 ob1 t01 t11 c1 z1 = false →
      isUnsuccessful (appliedMixAnyFirst.prop P M bl a b a b oa1 ob1 oa2 ob2 t01 t11 c1 z1 t02 t12 c2 z2 t01 t11 c1 z1 t02 t12 c2 z2)]

-- 4. Box 2's second branch checked against box out 1.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a2 b2 oa1 ob1 t022 t122 c22 z22 = false →
      isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 5. An unrelated hypothesis: z11 ≠ z12.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    z11 ≠ z12 →
      isUnsuccessful (appliedMixAnyFirst.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 6. An unrelated hypothesis: t021 ≠ t022.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    t021 ≠ t022 →
      isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

end Lovejoin.V2.Any
