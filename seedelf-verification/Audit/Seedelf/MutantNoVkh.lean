import Seedelf.Steps
import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, a near-miss wrong script: the deployed wallet with vkh left out of the
Fiat-Shamir challenge, blake2b_224(g ‖ g_r ‖ u) (one term, Scripts/mutate.py; never deployed):
the rollback-replay vector CLAUDE.md's third invariant names. The wallet's own theorem must come
back Falsified on it (MV2), and the spec with the same challenge Valid (MV3). With RegisterHash
RH2 (that spec Falsified on the deployed bytes) it is a two-by-two: the proof tells the two
challenges apart, both ways. -/

#import_uplc auditSeedelfWalletNoVkh PlutusV3 single_cbor_hex "Audit/Seedelf/Scripts/wallet_no_vkh_in_challenge.hex"

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfNoVkh auditSeedelfWalletNoVkh Seedelf.V1.registerArgs 2500

-- MV1 concretely: the mutant refuses the honest proof, whose challenge included vkh
#guard errorsB (auditSeedelfNoVkh.exec g1 u0 z0 gr0 vkh0 vkh0)

-- MV2 wallet_register_spend_iff on the mutant
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoVkh.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

/-- MV3: the mutant moves iff its own challenge's proof checks and vkh signed. -/
theorem audit_mutant_no_vkh_iff : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoVkh.prop g u z gr vkh signer) ↔
      (acceptsNoVkh g u z gr vkh = true ∧ vkh = signer) := by blaster (timeout: 540)

end SeedelfAudit
