import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister spec mutants (2 of 2): the challenge and the equation, each
changed once. Every `#blaster` must print "✅ Expected Falsified". Since the hashes, the scalar
decode and the G1 operations are opaque, each is Falsified exactly when the mutant feeds them
different arguments from the script's: these show the proof pins the challenge's input, its hash,
its decode, and the equation term by term, in the script's order (README rule 7). -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

-- RH1 the challenge over g ‖ u ‖ g_r ‖ vkh (u and g_r swapped)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsHashGURV g u z gr vkh = true ∧ vkh = signer)]

-- RH2 the challenge without vkh: the rollback-replay pad (CLAUDE.md's third invariant)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsNoVkh g u z gr vkh = true ∧ vkh = signer)]

-- RH3 the challenge through blake2b_256
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsBlake256 g u z gr vkh = true ∧ vkh = signer)]

-- RH4 z and c decoded little-endian
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsLittleEndian g u z gr vkh = true ∧ vkh = signer)]

-- RH5 the equation without u^c: g^z = g_r
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsNoUc g u z gr vkh = true ∧ vkh = signer)]

-- RH6 add's operands swapped (u^c · g_r): Fix 4's regression, still distinguished
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (acceptsAddSwapped g u z gr vkh = true ∧ vkh = signer)]

end SeedelfAudit
