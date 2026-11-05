import Lovejoin.V2.OwnAny1Boxes
import Lovejoin.V2.OwnAny1Passes
import Audit.V2.Common
import Blaster

/-! Negative controls and mutants for v2's Owner withdrawal of one box, for any pool
(`V2.OwnAny1*`). Six `✅ Expected Falsified`, two theorems `✅ Valid`.

1. The Passes hypotheses are satisfiable. 2. The Boxes preparation can succeed.
3. Passes, its conclusion flipped. 4. Passes without `wellFormed` (both the hypothesis and
the spec's conjunct): a malformed box isn't one of validate_owner's, so `n = 0` fails.
5. The Boxes theorem over `auditSchnorrCBase` (`c·a` for `c·u`). 6. The Boxes theorem with
its proof hypothesis replaced by `t1 ≠ z1`. 7. No run of the Passes preparation is cut off
at 10000; 8. every halt is the unit constant. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

/-- `proofHolds` over `auditSchnorrCBase`. -/
def auditProofHoldsCBase (M : ByteString) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) (a b t z : ByteString) : Bool :=
  match ctxOwn M s g u amt kc ch with
  | some ctx => auditSchnorrCBase a b t z ctx
  | none => false

-- 1. The Passes hypotheses are satisfiable.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true →
    ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
      False]

-- 2. The Boxes run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    ¬ isSuccessful (appliedOwnAny1Boxes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- 3. Passes, its conclusion flipped.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true →
    ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
      isUnsuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- 4. Passes without wellFormed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → proofHolds M s g u amt kc ch a1 b1 t1 z1 = true →
      isSuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- 5. The Boxes theorem over a wrong equation (c·a for c·u).
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    wellFormed a1 b1 = true → auditProofHoldsCBase M s g u amt kc ch a1 b1 t1 z1 = false →
      isUnsuccessful (appliedOwnAny1Boxes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- 6. The Boxes theorem with an unrelated hypothesis: t1 ≠ z1.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    wellFormed a1 b1 = true → t1 ≠ z1 →
      isUnsuccessful (appliedOwnAny1Boxes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

/-- 7. Every run of `OwnAny1Passes`' preparation halts or errors within 10000 steps. -/
theorem audit_own_any1_run_ends :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) ∨
        isUnsuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- 8. Every halt of `OwnAny1Passes`' preparation is the unit constant. -/
theorem audit_own_any1_halts_with_unit :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) →
        auditHaltsWithUnit (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own1
