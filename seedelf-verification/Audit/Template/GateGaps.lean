import Lovejoin.Template.MixBoxGate
import Audit.Classic.Common
import Blaster

/-! Gaps in mix_box's template gate, closed for its scenarios, L symbolic. Theorems, expected
Valid: **this module must print 5 "✅ Valid" lines** and build.

- `audit_gate_none_runs_end_t`, `audit_gate_logic_runs_end_t`: every run ends within 1500 steps.
- `audit_gate_none_halts_with_unit_t`, `audit_gate_logic_halts_with_unit_t`: every halt is unit.
- `audit_gate_iff_on_exec_t`: `box_moves_alone_iff_malformed` over `appliedGateNoneT.exec`. -/

namespace Audit.Template
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)

theorem audit_gate_none_runs_end_t : ∀ (L a b : ByteString),
    isSuccessful (appliedGateNoneT.prop L a b) ∨ isUnsuccessful (appliedGateNoneT.prop L a b) := by
  blaster (timeout: 540)

theorem audit_gate_logic_runs_end_t : ∀ (L a b : ByteString) (n : Integer),
    isSuccessful (appliedGateLogicT.prop L a b n) ∨ isUnsuccessful (appliedGateLogicT.prop L a b n) := by
  blaster (timeout: 540)

theorem audit_gate_none_halts_with_unit_t : ∀ (L a b : ByteString),
    isSuccessful (appliedGateNoneT.prop L a b) → HaltsWithUnit (appliedGateNoneT.prop L a b) := by
  blaster (timeout: 540)

theorem audit_gate_logic_halts_with_unit_t : ∀ (L a b : ByteString) (n : Integer),
    isSuccessful (appliedGateLogicT.prop L a b n) → HaltsWithUnit (appliedGateLogicT.prop L a b n) := by
  blaster (timeout: 540)

theorem audit_gate_iff_on_exec_t : ∀ (L a b : ByteString),
    isSuccessful (appliedGateNoneT.exec L a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by
  blaster (timeout: 540)

end Audit.Template
