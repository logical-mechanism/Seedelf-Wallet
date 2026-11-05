import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister's step limit, at the measured boundary. Steps.lean (and
GuardsRegister GR3) measure the honest spend halting after exactly 1281 steps. The same scenario
prepared one step short must lose the success direction (RT1, "✅ Expected Falsified"), by
exhaustion (RT2, Valid); at exactly 1281 the iff must hold (RT3, Valid), while the other-signer
runs, which reach Error at 1306, are still running (RT4, "✅ Expected Falsified"). Together they
show the symbolic model counts steps as the concrete machine does, on the accepting path. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfRegister1280 wallet Seedelf.V1.registerArgs 1280
#prep_uplc auditSeedelfRegister1281 wallet Seedelf.V1.registerArgs 1281

-- RT1 one step short of 1281: an accepted spend no longer halts
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = true → vkh = signer →
      isSuccessful (auditSeedelfRegister1280.prop g u z gr vkh signer)]

/-- RT2: it is cut off, not refused. -/
theorem audit_register_cut_off_at_1280 : ∀ (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = true → vkh = signer →
      isExhausted (auditSeedelfRegister1280.prop g u z gr vkh signer) := by blaster (timeout: 540)

/-- RT3: at exactly 1281 the wallet's iff holds. -/
theorem audit_register_iff_at_1281 : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegister1281.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer) := by blaster (timeout: 540)

-- RT4 at 1281 the other-signer runs (Error at 1306) are still running
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegister1281.prop g u z gr vkh signer) ∨
      isUnsuccessful (auditSeedelfRegister1281.prop g u z gr vkh signer)]

end SeedelfAudit
