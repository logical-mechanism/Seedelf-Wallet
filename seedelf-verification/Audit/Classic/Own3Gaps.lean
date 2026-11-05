import Lovejoin.OwnClassic3Boxes
import Lovejoin.OwnClassic3Passes
import Audit.Classic.Common
import Blaster

/-! Gaps in the classic Owner withdrawal of three boxes, closed for its scenario. Theorems,
expected Valid: **this module must print 3 "✅ Valid" lines** and build.

- `audit_own3_runs_end`: every run ends within the limit (20000), halted or in `Error`.
- `audit_own3_halts_with_unit`: every halt is the unit constant.
- `audit_own3_malformed_box_fails`: if any of the three boxes isn't well-formed, the withdrawal
  fails (fewer well-formed boxes than proofs). With `Boxes` and `Passes`, the withdrawal then
  succeeds iff `ownerAcceptsOwn`, for every input, not only well-formed boxes. -/

namespace Audit.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)
open Lovejoin.Classic (wellFormed)

theorem audit_own3_runs_end :
    ∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) ∨
        isUnsuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

theorem audit_own3_halts_with_unit :
    ∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) →
        HaltsWithUnit (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

theorem audit_own3_malformed_box_fails :
    ∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      (wellFormed a1 b1 = false ∨ wellFormed a2 b2 = false ∨ wellFormed a3 b3 = false) →
        isUnsuccessful (appliedOwnClassic3Boxes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Audit.Classic.Own3
