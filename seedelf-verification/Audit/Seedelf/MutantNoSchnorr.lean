import Seedelf.Steps
import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, a near-miss wrong script: the deployed wallet with its Schnorr check,
`schnorr.prove(...)`, replaced by `True` (one term, Scripts/mutate.py; never deployed). The
wallet's own theorem must come back Falsified on it (MN2), and `vkh = signer` alone Valid (MN3):
the proof sees the Schnorr check, and would have caught a wallet without one. -/

#import_uplc auditSeedelfWalletNoSchnorr PlutusV3 single_cbor_hex "Audit/Seedelf/Scripts/wallet_no_schnorr.hex"

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfNoSchnorr auditSeedelfWalletNoSchnorr Seedelf.V1.registerArgs 2500

-- MN1 concretely: the mutant returns unit on a changed z, which the deployed bytes refuse
#guard haltsUnitB (auditSeedelfNoSchnorr.exec g1 u0 zChanged gr0 vkh0 vkh0)

-- MN2 wallet_register_spend_iff on the mutant
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoSchnorr.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

/-- MN3: the mutant moves iff vkh signed, whatever the proof. -/
theorem audit_mutant_no_schnorr_iff : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoSchnorr.prop g u z gr vkh signer) ↔ vkh = signer := by
  blaster (timeout: 540)

end SeedelfAudit
