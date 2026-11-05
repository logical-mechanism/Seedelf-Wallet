import Lovejoin.MixBoxGate
import Audit.Classic.Common
import Blaster

/-! Gaps in the classic gate (`Lovejoin.MixBoxGate`), closed for its scenarios. Theorems,
expected Valid: **this module must print 5 "✅ Valid" lines** and build.

- `audit_gate_none_runs_end`, `audit_gate_logic_runs_end`: every run ends within 1500 steps, so
  `box_moves_alone_iff_malformed`'s → direction covers every box, and a malformed box with
  mix_logic's withdrawal (which no theorem names) ends too.
- `audit_gate_none_halts_with_unit`, `audit_gate_logic_halts_with_unit`: every halt is unit.
- `audit_gate_iff_on_exec`: `box_moves_alone_iff_malformed` over `appliedGateNone.exec`, so it is
  about `cekExecuteProgram` itself (see `Audit.Classic.OwnerExec`). -/

namespace Audit.Classic
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

theorem audit_gate_none_runs_end : ∀ (a b : ByteString),
    isSuccessful (appliedGateNone.prop a b) ∨ isUnsuccessful (appliedGateNone.prop a b) := by
  blaster (timeout: 540)

theorem audit_gate_logic_runs_end : ∀ (a b : ByteString) (n : Integer),
    isSuccessful (appliedGateLogic.prop a b n) ∨ isUnsuccessful (appliedGateLogic.prop a b n) := by
  blaster (timeout: 540)

theorem audit_gate_none_halts_with_unit : ∀ (a b : ByteString),
    isSuccessful (appliedGateNone.prop a b) → HaltsWithUnit (appliedGateNone.prop a b) := by
  blaster (timeout: 540)

theorem audit_gate_logic_halts_with_unit : ∀ (a b : ByteString) (n : Integer),
    isSuccessful (appliedGateLogic.prop a b n) → HaltsWithUnit (appliedGateLogic.prop a b n) := by
  blaster (timeout: 540)

theorem audit_gate_iff_on_exec : ∀ (a b : ByteString),
    isSuccessful (appliedGateNone.exec a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by
  blaster (timeout: 540)

end Audit.Classic
