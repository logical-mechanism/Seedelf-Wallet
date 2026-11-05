import Lovejoin.MixBoxGate
import Lovejoin.Template.Scripts
import Lovejoin.Template.Steps
import Blaster

/-! The classic gate's theorems on their own argument functions with the step limit changed, and
on another pool's mix_box. Each is expected Falsified: **this module must print
4 "✅ Expected Falsified" lines**. The counts are `Lovejoin.Steps`'.

- [D-L1] `well_formed_box_moves_with_mix_logic` at 1059 (it halts after 1060).
- [D-L2] `well_formed_box_needs_mix_logic` at 1028 (it errors after 1029): cut off isn't `Error`.
- [D-L3] `box_moves_alone_iff_malformed` at 888: a box with `a = b` halts after 889, so the
  iff's "malformed ⇒ moves" fails below that.
- [D-W1] `well_formed_box_moves_with_mix_logic`'s arguments on mix_box's template applied to v2's
  test L (`6666…`), another pool's mix_box: the classic mix_logic's withdrawal doesn't open it
  (`Lovejoin.Template.Steps`: errors after 1089). -/

namespace Audit.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- `gateLogicArgs` (the classic mix_logic's withdrawal) with v2's test L first, as a pool on
mix_box's template at that L takes it. -/
def gateLogicAtV2LArgs (a b : ByteString) (n : Integer) : List Term :=
  toTerm Lovejoin.Template.v2L :: Lovejoin.Classic.gateLogicArgs a b n

#prep_uplc auditClassicGateLogicAt1059 mixBox Lovejoin.Classic.gateLogicArgs 1059
#prep_uplc auditClassicGateNoneAt1028 mixBox Lovejoin.Classic.gateNoneArgs 1028
#prep_uplc auditClassicGateNoneAt888 mixBox Lovejoin.Classic.gateNoneArgs 888
#prep_uplc auditClassicGateLogicAtV2L mixBoxTemplate Audit.Classic.gateLogicAtV2LArgs 1500

-- [D-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (auditClassicGateLogicAt1059.prop a b n)]

-- [D-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (auditClassicGateNoneAt1028.prop a b)]

-- [D-L3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString),
  isSuccessful (auditClassicGateNoneAt888.prop a b) ↔
    ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b)]

-- [D-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b : ByteString) (n : Integer),
  lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isSuccessful (auditClassicGateLogicAtV2L.prop a b n)]

end Audit.Classic
