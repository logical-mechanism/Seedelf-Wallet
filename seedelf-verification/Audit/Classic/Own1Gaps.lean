import Lovejoin.OwnClassic1Boxes
import Lovejoin.OwnClassic1Passes
import Audit.Classic.Common
import Blaster

/-! Gaps in the classic Owner withdrawal of one box, closed for its scenario. Theorems, expected
Valid: **this module must print 4 "✅ Valid" lines** and build.

- `audit_own1_runs_end`: every run ends within the limit (10000), halted or in `Error`.
- `audit_own1_halts_with_unit`: every halt is the unit constant, what the ledger accepts.
- `audit_own1_malformed_box_fails`: a box whose datum isn't well-formed fails the withdrawal.
  The doc's iff is for well-formed boxes; this covers the rest (`collect_well_formed_mix_inputs`
  drops the box, and one proof for no box fails).
- `audit_own1_iff`: so, for every input, the withdrawal succeeds iff `ownerAcceptsOwn`. -/

namespace Audit.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own1 (ownerAcceptsOwn)

theorem audit_own1_runs_end :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) ∨
        isUnsuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

theorem audit_own1_halts_with_unit :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) →
        HaltsWithUnit (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

theorem audit_own1_malformed_box_fails :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = false →
        isUnsuccessful (appliedOwnClassic1Boxes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

theorem audit_own1_iff :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) ↔
        ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true := by
  blaster (timeout: 540)

end Audit.Classic.Own1
