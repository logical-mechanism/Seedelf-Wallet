import Audit.Gaps.Classic.Gate2
import Blaster

/-! Audit (lovejoin-classic): `MixBoxGate`'s properties with the box the second of two
inputs, two withdrawals and any redeemer. -/

namespace Lovejoin.Classic.AuditGate
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def g2NoneArgs (a b k : ByteString) (r : Data) : List Term := [toTerm (gate2Ctx a b k [] r)]
def g2LogicSecondArgs (a b k c : ByteString) (n m : Integer) (r : Data) : List Term :=
  [toTerm (gate2Ctx a b k [(.PubKeyCredential c, n), (.ScriptCredential mixLogicHash, m)] r)]
def g2OthersArgs (a b k c d : ByteString) (n m : Integer) (r : Data) : List Term :=
  [toTerm (gate2Ctx a b k [(.PubKeyCredential c, n), (.ScriptCredential d, m)] r)]

#prep_uplc appliedAuditGate2None mixBox g2NoneArgs 2000
#prep_uplc appliedAuditGate2LogicSecond mixBox g2LogicSecondArgs 2000
#prep_uplc appliedAuditGate2Others mixBox g2OthersArgs 2000

/-- With no withdrawal, the box moves iff its datum isn't well-formed, whatever the redeemer. -/
theorem audit_gate2_alone_iff_malformed : ∀ (a b k : ByteString) (r : Data),
    isSuccessful (appliedAuditGate2None.prop a b k r) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by blaster

/-- A well-formed box with no withdrawal reaches `Error`, whatever the redeemer. -/
theorem audit_gate2_needs_mix_logic : ∀ (a b k : ByteString) (r : Data),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedAuditGate2None.prop a b k r) := by blaster

/-- mix_logic's withdrawal second, after a key's, lets a well-formed box through. -/
theorem audit_gate2_mix_logic_second : ∀ (a b k c : ByteString) (n m : Integer) (r : Data),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedAuditGate2LogicSecond.prop a b k c n m r) := by blaster

/-- A key's withdrawal and another script's, neither mix_logic's, don't. -/
theorem audit_gate2_two_others_refused : ∀ (a b k c d : ByteString) (n m : Integer) (r : Data),
    d ≠ mixLogicHash →
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedAuditGate2Others.prop a b k c d n m r) := by blaster

end Lovejoin.Classic.AuditGate
