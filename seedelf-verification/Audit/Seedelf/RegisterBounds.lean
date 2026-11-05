import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister: the gap-closing theorems and the vacuity controls.

- RB1–RB3 (expected Valid). `isSuccessful ↔ spec` proves "success ⇒ spec" only for runs that end
  within 2500 steps. RB1 says every run does, so no Register spend succeeds past the limit, where
  the chain's budget would let it run on. RB2 says every halt is the unit constant, so
  `isSuccessful` is what the ledger accepts. RB3 is both at once.
- RB4–RB7 (each must print "✅ Expected Falsified"): both sides of the iff are inhabited, the unit
  halt is reachable, and the success direction's conclusion can't be flipped. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- RB1: no Register spend is cut off by the step limit. -/
theorem audit_register_no_exhaustion : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ∨
      isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by blaster (timeout: 540)

/-- RB2: every halt returns unit. -/
theorem audit_register_halts_with_unit : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) →
      haltsWithUnit (appliedRegister.prop g u z gr vkh signer) := by blaster (timeout: 540)

/-- RB3: every run returns unit or reaches Error. -/
theorem audit_register_unit_or_error : ∀ (g u z gr vkh signer : ByteString),
    haltsWithUnit (appliedRegister.prop g u z gr vkh signer) ∨
      isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by blaster (timeout: 540)

-- RB4 vacuity: some Register spend halts
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString), ¬ isSuccessful (appliedRegister.prop g u z gr vkh signer)]

-- RB5 vacuity: some Register spend reaches Error
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString), ¬ isUnsuccessful (appliedRegister.prop g u z gr vkh signer)]

-- RB6 vacuity of the unit predicate: some spend returns unit
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString), ¬ haltsWithUnit (appliedRegister.prop g u z gr vkh signer)]

-- RB7 conclusion flip: a proof that checks, signed by vkh, reaches Error
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = true → vkh = signer →
      isUnsuccessful (appliedRegister.prop g u z gr vkh signer)]

end SeedelfAudit
