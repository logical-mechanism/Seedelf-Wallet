import Lovejoin.Box
import Blaster

/-! The gate. A box whose inline datum is a well-formed `MixDatum` (`Constr 0 [B a, B b]`,
both 48 bytes, `a ≠ b`) moves only when mix_logic's credential withdraws, which is what
makes mix_logic run (withdraw-zero). Any withdrawal amount does; another script's or a
key's doesn't. With no withdrawal, a box moves iff its datum isn't well-formed: Rule 2's
recovery. The datum bytes are symbolic; the withdrawals take one of four fixed shapes,
since a symbolic map is a list the script walks. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def gateArgs (a b : ByteString) (wdrl : Withdrawals) : List Term :=
  [toTerm (inlineBoxCtx (mixDatum a b) wdrl)]

def gateNoneArgs (a b : ByteString) := gateArgs a b []
def gateLogicArgs (a b : ByteString) (n : Integer) := gateArgs a b [(.ScriptCredential mixLogicHash, n)]
def gateScriptArgs (a b c : ByteString) (n : Integer) := gateArgs a b [(.ScriptCredential c, n)]
def gateKeyArgs (a b c : ByteString) (n : Integer) := gateArgs a b [(.PubKeyCredential c, n)]

#prep_uplc appliedGateNone mixBox gateNoneArgs 1500
#prep_uplc appliedGateLogic mixBox gateLogicArgs 1500
#prep_uplc appliedGateScript mixBox gateScriptArgs 1500
#prep_uplc appliedGateKey mixBox gateKeyArgs 1500

/-- With no withdrawal, a box moves iff its datum isn't a well-formed `MixDatum`. -/
theorem box_moves_alone_iff_malformed : ∀ (a b : ByteString),
    isSuccessful (appliedGateNone.prop a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by blaster

/-- A well-formed box alone reaches `Error`. -/
theorem well_formed_box_needs_mix_logic : ∀ (a b : ByteString),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateNone.prop a b) := by blaster

/-- mix_logic's withdrawal, of any amount, lets it through (mix_logic then decides). -/
theorem well_formed_box_moves_with_mix_logic : ∀ (a b : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedGateLogic.prop a b n) := by blaster

/-- Another script's withdrawal doesn't. -/
theorem well_formed_box_refuses_another_script : ∀ (a b c : ByteString) (n : Integer),
    c ≠ mixLogicHash →
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateScript.prop a b c n) := by blaster

/-- Nor does a key's, whatever its hash. -/
theorem well_formed_box_refuses_a_key : ∀ (a b c : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedGateKey.prop a b c n) := by blaster

end Lovejoin.Classic
