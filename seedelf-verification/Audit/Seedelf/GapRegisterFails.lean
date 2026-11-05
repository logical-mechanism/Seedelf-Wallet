import Seedelf.WalletRegister
import Blaster

/-! Audit (statements), for the owner to run: `wallet_register_spend_iff`'s security direction,
unbounded. The iff yields `¬ spec → ¬ isSuccessful`, which a run cut off at the step limit
(`isExhausted`) also satisfies: README rule 2's form. An `Error` is final, so these two say a
Register UTxO never moves without the Schnorr proof and the one-time key's signature, however
long the run. Same prep (`appliedRegister`, 2500 steps), same scenario.

Built in place as `Audit.Seedelf.GapRegisterFails`, in `./check.sh audit-seedelf`, or alone,
`./check.sh Audit.Seedelf.GapRegisterFails`. Expected: two `✅ Valid` (each with the
`blasterProven` warning). -/

namespace Seedelf.V1.AuditStatements
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils

theorem wallet_register_fails_without_the_proof :
  ∀ (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = false →
      isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by blaster

theorem wallet_register_fails_without_the_signer :
  ∀ (g u z gr vkh signer : ByteString),
    vkh ≠ signer →
      isUnsuccessful (appliedRegister.prop g u z gr vkh signer) := by blaster

end Seedelf.V1.AuditStatements
