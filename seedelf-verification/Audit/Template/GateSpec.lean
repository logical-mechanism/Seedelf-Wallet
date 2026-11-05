import Lovejoin.Template.MixBoxGate
import Blaster

/-! Negative controls for mix_box's template gate (`Lovejoin.Template.MixBoxGate`, L symbolic).
Every check is expected Falsified: **this module must print 5 "✅ Expected Falsified" lines**.

- [H-V1] Vacuity: the hypotheses (well-formed, another credential than L) can hold.
- [H-S1] `box_moves_alone_iff_malformed` without `a ≠ b`.
- [H-H1] `well_formed_box_refuses_another_script` with `c ≠ the classic mix_logic's hash` in place
  of `c ≠ L`. This is the check that the template's theorem really is about L: a Valid result
  would mean every pool's box refuses its own mix_logic, or that L never reached the solver.
- [H-H2] `well_formed_box_needs_mix_logic` without `a ≠ b`.
- [H-F1] `well_formed_box_moves_with_mix_logic` concluding `isUnsuccessful`. -/

namespace Audit.Template
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (mixLogicHash)

-- [H-V1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b c : ByteString),
  c ≠ L → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b → False]

-- [H-S1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString),
  isSuccessful (appliedGateNoneT.prop L a b) ↔ ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48)]

-- [H-H1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b c : ByteString) (n : Integer),
  c ≠ mixLogicHash →
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (appliedGateScriptT.prop L a b c n)]

-- [H-H2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 →
    isUnsuccessful (appliedGateNoneT.prop L a b)]

-- [H-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (L a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (appliedGateLogicT.prop L a b n)]

end Audit.Template
