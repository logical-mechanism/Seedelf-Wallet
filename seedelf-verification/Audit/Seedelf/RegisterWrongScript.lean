import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, wrong-script controls for WalletRegister: `registerArgs` on the other two
deployed scripts, which refuse a spend early. The wallet's iff must come back Falsified on each
("✅ Expected Falsified" twice): the theorem depends on which bytes `#prep_uplc` was given. The
near-miss scripts (the wallet with one check removed) are in the Mutant* modules. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfRegisterOnFalse alwaysFalse Seedelf.V1.registerArgs 2500
#prep_uplc auditSeedelfRegisterOnPolicy seedelf Seedelf.V1.registerArgs 2500

-- WS1 on always_false
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegisterOnFalse.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

-- WS2 on the Seedelf policy (mint-only)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfRegisterOnPolicy.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

end SeedelfAudit
