import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister's failure directions. The iff's right-to-left direction only
says a bad spend doesn't halt within 2500 steps (README rule 2: `¬ isSuccessful` holds of a cut-off
run too). RN1 and RN2 (expected Valid) say it reaches Error. RN3–RN5 replace RN1's hypothesis with
one the script never checks, and RN6–RN7 show RN1's and RN2's hypotheses are satisfiable: each of
the five must print "✅ Expected Falsified". -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- RN1: without the one-time key's signature, a Register spend reaches Error. -/
theorem audit_register_needs_signer : ∀ (g u z gr vkh signer : ByteString),
    vkh ≠ signer → isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by blaster (timeout: 540)

/-- RN2: without a proof that checks, it reaches Error. -/
theorem audit_register_needs_proof : ∀ (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = false → isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by
  blaster (timeout: 540)

-- RN3 hypothesis mutant: z ≠ g_r, which the script never compares
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    z ≠ gr → isUnsuccessful (appliedRegister.prop g u z gr vkh signer)]

-- RN4 hypothesis mutant: g ≠ u (true of every real register)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    g ≠ u → isUnsuccessful (appliedRegister.prop g u z gr vkh signer)]

-- RN5 hypothesis mutant: vkh ≠ z
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    vkh ≠ z → isUnsuccessful (appliedRegister.prop g u z gr vkh signer)]

-- RN6 vacuity of RN1: its hypothesis holds of some inputs
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (vkh signer : ByteString), vkh ≠ signer → False]

-- RN7 vacuity of RN2: the spec can be false in the model (were it always true, RN2 would be empty)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh : ByteString), schnorrAccepts g u z gr vkh = false → False]

end SeedelfAudit
