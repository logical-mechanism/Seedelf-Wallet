import Seedelf.WalletNoLock
import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletNoLock (`spendable_*`). The no-datum run halts after exactly 360 steps
and Constr 0 [B, B, B] after 597, the longest no-lock shape (Steps.lean; GuardsCheap GC3, GC4).
NL1, NL2, NL3, NL5 and NL7 must each print "✅ Expected Falsified"; NL4 and NL6 must be Valid.
No hypotheses, so no hypothesis mutants; NL2 stands in for a spec mutant (the datum shape is the
"spec": the Register shape is the one that doesn't always pass). NoLockUnit1/2 add the unit
results, NoLockCover the coverage of the 18 shapes. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfNoDatum359 wallet Seedelf.V1.noDatumArgs 359
#prep_uplc auditSeedelfNoDatum360 wallet Seedelf.V1.noDatumArgs 360
#prep_uplc auditSeedelfFields3At596 wallet Seedelf.V1.fields3Args 596
#prep_uplc auditSeedelfFields3At597 wallet Seedelf.V1.fields3Args 597
#prep_uplc auditSeedelfNoDatumOnFalse alwaysFalse Seedelf.V1.noDatumArgs 800

-- NL1 conclusion flip: a no-datum spend reaches Error
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (z gr vkh s : ByteString), isUnsuccessful (appliedNoDatum.prop z gr vkh s)]

-- NL2 the one shape that may not pass: not every Register spend halts
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh s : ByteString), isSuccessful (appliedRegister.prop g u z gr vkh s)]

-- NL3 step limit one short of 360
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (z gr vkh s : ByteString), isSuccessful (auditSeedelfNoDatum359.prop z gr vkh s)]

/-- NL4: at exactly 360 every no-datum spend halts. -/
theorem audit_no_datum_at_360 : ∀ (z gr vkh s : ByteString),
    isSuccessful (auditSeedelfNoDatum360.prop z gr vkh s) := by blaster (timeout: 540)

-- NL5 the longest shape one short of 597: the B, B path is still running
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (x y w : Data) (rest : List Data) (z gr vkh s : ByteString),
    isSuccessful (auditSeedelfFields3At596.prop x y w rest z gr vkh s)]

/-- NL6: at exactly 597 every spend with three or more fields halts, whatever the fields. -/
theorem audit_fields3_at_597 : ∀ (x y w : Data) (rest : List Data) (z gr vkh s : ByteString),
    isSuccessful (auditSeedelfFields3At597.prop x y w rest z gr vkh s) := by blaster (timeout: 540)

-- NL7 wrong script: the same arguments on always_false
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (z gr vkh s : ByteString), isSuccessful (auditSeedelfNoDatumOnFalse.prop z gr vkh s)]

end SeedelfAudit
