import Lovejoin.MixBoxGate
import Blaster

/-! Negative controls for the classic mix_box's gate (`Lovejoin.MixBoxGate`). Every check is
expected Falsified: **this module must print 8 "✅ Expected Falsified" lines**, cheapest first.

- [D-V1] Vacuity: the well-formed hypotheses (with another script's credential) can hold.
- [D-S1..3] `box_moves_alone_iff_malformed` with its right-hand side changed: `a ≠ b` dropped,
  48 replaced by 47 for `a`, `b`'s length dropped.
- [D-H1] `well_formed_box_refuses_another_script` with `c ≠ mix_box's hash` for `c ≠ mix_logic's`:
  a Valid one would mean the gate refuses mix_logic's own withdrawal too.
- [D-H2] `well_formed_box_needs_mix_logic` without `a ≠ b`.
- [D-F1] `well_formed_box_moves_with_mix_logic` concluding `isUnsuccessful`.
- [D-F2] `well_formed_box_refuses_a_key` concluding `isSuccessful`. -/

namespace Audit.Classic
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (mixBoxHash mixLogicHash)

-- [D-V1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b c : ByteString),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b → c ≠ mixLogicHash → False]

-- [D-S1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  isSuccessful (appliedGateNone.prop a b) ↔ ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48)]

-- [D-S2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  isSuccessful (appliedGateNone.prop a b) ↔ ¬ (lengthOfByteString a = 47 ∧ lengthOfByteString b = 48 ∧ a ≠ b)]

-- [D-S3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  isSuccessful (appliedGateNone.prop a b) ↔ ¬ (lengthOfByteString a = 48 ∧ a ≠ b)]

-- [D-H1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b c : ByteString) (n : Integer),
  c ≠ mixBoxHash →
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (appliedGateScript.prop a b c n)]

-- [D-H2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 →
    isUnsuccessful (appliedGateNone.prop a b)]

-- [D-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (appliedGateLogic.prop a b n)]

-- [D-F2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b c : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (appliedGateKey.prop a b c n)]

end Audit.Classic
