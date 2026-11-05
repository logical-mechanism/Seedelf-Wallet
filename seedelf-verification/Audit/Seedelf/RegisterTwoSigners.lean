import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletRegister with two signers. WalletRegister fixes one signer, so
`list.has(extra_signatories, vkh)` only ever meets a one-element list. Here the signatories are
`[s1, s2]`, both symbolic (the list's length is concrete: README rule 4). R2-1, R2-2 and R2-3 must
be Valid; R2-4, R2-5 and R2-6 must each print "✅ Expected Falsified", which shows the proof sees
the list walked past its head. The longest run here is about 1330 steps (two misses), well
inside 2500; GuardsRegister GR5 runs both orders concretely. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfRegister2 wallet SeedelfAudit.register2Args 2500

/-- R2-1: with two signers, a Register UTxO moves iff the proof checks and vkh is either one. -/
theorem audit_register_two_signers_iff : ∀ (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2)) := by blaster (timeout: 540)

/-- R2-2: every run returns unit or reaches Error within the limit. -/
theorem audit_register_two_signers_unit_or_error : ∀ (g u z gr vkh s1 s2 : ByteString),
    haltsWithUnit (auditSeedelfRegister2.prop g u z gr vkh s1 s2) ∨
      isUnsuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) := by blaster (timeout: 540)

/-- R2-3: signed by neither, it reaches Error. -/
theorem audit_register_two_signers_needs_one : ∀ (g u z gr vkh s1 s2 : ByteString),
    vkh ≠ s1 → vkh ≠ s2 → isUnsuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) := by
  blaster (timeout: 540)

-- R2-4 only the first signer looked at: vkh = s2 ≠ s1 passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = s1)]

-- R2-5 only the last: vkh = s1 ≠ s2 passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = s2)]

-- R2-6 both required: one of them is enough
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (auditSeedelfRegister2.prop g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = s1 ∧ vkh = s2)]

end SeedelfAudit
