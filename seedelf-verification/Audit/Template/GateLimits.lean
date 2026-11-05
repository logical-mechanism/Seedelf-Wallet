import Lovejoin.Template.MixBoxGate
import Audit.Classic.Common
import Blaster

/-! mix_box's template gate with the step limit, the withdrawal or the script changed, and a
negative control for the unit-result theorems. Expected: **5 "✅ Expected Falsified" lines and
1 "✅ Valid" line**.

- [H-L1] `well_formed_box_moves_with_mix_logic` at 1059 (it halts after 1060 at every L).
- [H-L2] `well_formed_box_needs_mix_logic` at 1028 (it errors after 1029): cut off isn't `Error`.
- [H-W1] The classic mix_logic's withdrawal for every L: a box at another L doesn't open with it.
  A Valid result would mean the gate ignores L.
- [H-W2] `well_formed_box_moves_with_mix_logic`'s arguments on the classic mix_box, which is the
  template already applied: it takes L as its context and fails.
- [H-N1] The template given the context alone, no L: the context fills the L slot and the run
  halts at once with a closure waiting for the real context. `isSuccessful` calls that a
  success (`audit_underapplied_gate_halts`, Valid); the ledger would reject it, and
  `HaltsWithUnit` says so ([H-N1] Falsified). That is what the unit-result theorems in the
  `…Gaps` modules rule out for the real scenarios. -/

namespace Audit.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)
open Lovejoin.Classic (mixLogicHash)

/-- L first, then a box spent with the classic mix_logic's withdrawal, whatever L is. -/
def gateClassicWdrlArgsT (L a b : ByteString) (n : Integer) : List Term :=
  toTerm L :: Lovejoin.Classic.gateArgs a b [(.ScriptCredential mixLogicHash, n)]

/-- The box's context alone, without L. -/
def gateUnderAppliedArgs (a b : ByteString) : List Term := Lovejoin.Classic.gateArgs a b []

#prep_uplc auditTemplateGateLogicAt1059 mixBoxTemplate Lovejoin.Template.gateLogicArgsT 1059
#prep_uplc auditTemplateGateNoneAt1028 mixBoxTemplate Lovejoin.Template.gateNoneArgsT 1028
#prep_uplc auditTemplateGateClassicWdrl mixBoxTemplate Audit.Template.gateClassicWdrlArgsT 1500
#prep_uplc auditTemplateGateLogicOnClassic mixBox Lovejoin.Template.gateLogicArgsT 1500
#prep_uplc auditTemplateGateUnderApplied mixBoxTemplate Audit.Template.gateUnderAppliedArgs 1500

-- [H-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (auditTemplateGateLogicAt1059.prop L a b n)]

-- [H-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (auditTemplateGateNoneAt1028.prop L a b)]

-- [H-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (auditTemplateGateClassicWdrl.prop L a b n)]

-- [H-W2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (auditTemplateGateLogicOnClassic.prop L a b n)]

-- [H-N1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  isSuccessful (auditTemplateGateUnderApplied.prop a b) → HaltsWithUnit (auditTemplateGateUnderApplied.prop a b)]

/-- The closure the under-applied template halts with counts as `isSuccessful`. -/
theorem audit_underapplied_gate_halts : ∀ (a b : ByteString),
    isSuccessful (auditTemplateGateUnderApplied.prop a b) := by
  blaster (timeout: 540)

end Audit.Template
