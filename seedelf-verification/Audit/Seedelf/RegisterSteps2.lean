import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister's longest run. A one-signer Register spend's longest path is
an accepted proof signed by another key: Error after 1306 steps (Steps.lean, GuardsRegister GR4).
So the no-exhaustion theorem must fail one step short (RT5, "✅ Expected Falsified") and hold at
exactly 1306 (RT6, Valid): the symbolic model's longest path is the concrete one, and RB1's
margin at 2500 is real. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfRegister1305 wallet Seedelf.V1.registerArgs 1305
#prep_uplc auditSeedelfRegister1306 wallet Seedelf.V1.registerArgs 1306

-- RT5 at 1305 some run is still going
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegister1305.prop g u z gr vkh signer) ∨
      isUnsuccessful (auditSeedelfRegister1305.prop g u z gr vkh signer)]

/-- RT6: at exactly 1306 every run has ended. -/
theorem audit_register_all_end_by_1306 : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegister1306.prop g u z gr vkh signer) ∨
      isUnsuccessful (auditSeedelfRegister1306.prop g u z gr vkh signer) := by blaster (timeout: 540)

end SeedelfAudit
