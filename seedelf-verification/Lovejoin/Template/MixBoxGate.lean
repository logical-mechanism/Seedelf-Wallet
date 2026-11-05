import Lovejoin.Template.Scripts
import Lovejoin.MixBoxGate
import Blaster

/-! `Lovejoin.MixBoxGate` on mix_box's template, for every mix_logic hash L: a box whose
inline datum is a well-formed `MixDatum` moves only with L's withdrawal, of any amount;
another script's or a key's doesn't. With no withdrawal, a box moves iff its datum isn't
well-formed. L, the datum's bytes and the other credential are symbolic. So the gate
holds for the classic pool, a v2 launch and every other pool on this template at once.

The scenarios are `Lovejoin.Classic`'s, with L the program's first argument. mix_box
finds its own input by reference, so the box's address doesn't enter. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (gateArgs)

def gateNoneArgsT (L a b : ByteString) : List Term := toTerm L :: gateArgs a b []
def gateLogicArgsT (L a b : ByteString) (n : Integer) : List Term := toTerm L :: gateArgs a b [(.ScriptCredential L, n)]
def gateScriptArgsT (L a b c : ByteString) (n : Integer) : List Term := toTerm L :: gateArgs a b [(.ScriptCredential c, n)]
def gateKeyArgsT (L a b c : ByteString) (n : Integer) : List Term := toTerm L :: gateArgs a b [(.PubKeyCredential c, n)]

#prep_uplc appliedGateNoneT mixBoxTemplate gateNoneArgsT 1500
#prep_uplc appliedGateLogicT mixBoxTemplate gateLogicArgsT 1500
#prep_uplc appliedGateScriptT mixBoxTemplate gateScriptArgsT 1500
#prep_uplc appliedGateKeyT mixBoxTemplate gateKeyArgsT 1500

/-- With no withdrawal, a box moves iff its datum isn't a well-formed `MixDatum`, whatever L. -/
theorem box_moves_alone_iff_malformed : ∀ (L a b : ByteString),
    isSuccessful (appliedGateNoneT.prop L a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by blaster

/-- A well-formed box alone reaches `Error`. -/
theorem well_formed_box_needs_mix_logic : ∀ (L a b : ByteString),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateNoneT.prop L a b) := by blaster

/-- L's withdrawal, of any amount, lets it through (mix_logic then decides). -/
theorem well_formed_box_moves_with_mix_logic : ∀ (L a b : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedGateLogicT.prop L a b n) := by blaster

/-- Another script's withdrawal doesn't. -/
theorem well_formed_box_refuses_another_script : ∀ (L a b c : ByteString) (n : Integer),
    c ≠ L →
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateScriptT.prop L a b c n) := by blaster

/-- Nor does a key's, whatever its hash. -/
theorem well_formed_box_refuses_a_key : ∀ (L a b c : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateKeyT.prop L a b c n) := by blaster

end Lovejoin.Template
