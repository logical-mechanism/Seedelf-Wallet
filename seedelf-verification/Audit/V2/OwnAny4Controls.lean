import Lovejoin.V2.OwnAny4Boxes
import Lovejoin.V2.OwnAny4Passes
import Audit.V2.Common
import Blaster

/-! Negative controls and mutants for v2's Owner withdrawal of four boxes, for any pool
(`V2.OwnAny4*`). Five `✅ Expected Falsified`, two theorems `✅ Valid`.

1. The Passes hypotheses are satisfiable. 2. The Boxes preparation can succeed.
3. Passes, its conclusion flipped. 4. Passes with box 3's proof dropped from the spec.
5. Box 2's theorem with its proof hypothesis replaced by `t2 ≠ t3`. 6. No run of the Passes
preparation is cut off at 25000; 7. every halt is the unit constant. -/

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

set_option linter.unusedVariables false in
/-- `ownerAcceptsOwn` without box 3's proof. -/
def auditOwnerAcceptsOwnNo3 (M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHolds M s g u amt kc ch a1 b1 t1 z1) &&
    (wellFormed a2 b2 && proofHolds M s g u amt kc ch a2 b2 t2 z2) &&
    wellFormed a3 b3 &&
    (wellFormed a4 b4 && proofHolds M s g u amt kc ch a4 b4 t4 z4)

-- 1. The Passes hypotheses are satisfiable.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
    ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
      False]

-- 2. The Boxes run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    ¬ isSuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

-- 3. Passes, its conclusion flipped.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
    ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
      isUnsuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

-- 4. Passes, box 3's proof dropped from the spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
    auditOwnerAcceptsOwnNo3 M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
      isSuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

-- 5. Box 2's theorem with an unrelated hypothesis: t2 ≠ t3.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    wellFormed a2 b2 = true → t2 ≠ t3 →
      isUnsuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

/-- 6. Every run of `OwnAny4Passes`' preparation halts or errors within 25000 steps. -/
theorem audit_own_any4_run_ends :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) ∨
        isUnsuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- 7. Every halt of `OwnAny4Passes`' preparation is the unit constant. -/
theorem audit_own_any4_halts_with_unit :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) →
        auditHaltsWithUnit (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own4
