import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister spec mutants (1 of 2): `wallet_register_spend_iff` with one
conjunct dropped or the scalar decode's bound changed. Each `#blaster` must print
"✅ Expected Falsified"; a mutant that survives fails the build with "❌ Unexpected Valid".
The last check is an equivalent mutant and must be Valid. Over `appliedRegister.prop` (no new
`#prep_uplc`); WalletRegister's own theorem takes about a second. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

-- RS1 the signer conjunct dropped: an accepted proof signed by another key reaches Error
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔ schnorrAccepts g u z gr vkh = true]

-- RS2 the Schnorr conjunct dropped: a rejected proof, signed by vkh, reaches Error
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔ vkh = signer]

-- RS3 z and c decoded with no upper bound: a decode at or past q fails the script
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsNoBound g u z gr vkh = true ∧ vkh = signer)]

-- RS4 the bound off by one (n ≤ q): a decode of exactly q fails the script
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsBoundLe g u z gr vkh = true ∧ vkh = signer)]

/-- RS5, an equivalent mutant (expected Valid): without `0 ≤ n`, which the alias's `Nat` result
makes redundant. Falsified would mean the model lets the conversion go negative. -/
theorem audit_register_iff_without_zero_test : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsNoZeroTest g u z gr vkh = true ∧ vkh = signer) := by blaster (timeout: 540)

end SeedelfAudit
