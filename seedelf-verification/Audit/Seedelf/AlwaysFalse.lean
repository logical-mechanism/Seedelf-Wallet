import Seedelf.AlwaysFalse
import Audit.Seedelf.AlwaysTrue
import Blaster

/-! Audit · Seedelf, AlwaysFalse (`always_false_always_fails`). always_false reaches Error after
exactly 100 steps on any context (Steps.lean; GuardsCheap GC1), since it only takes the context's
three fields apart. AF1, AF2 and AF4 must each print "✅ Expected Falsified"; AF3 must be Valid.
No hypotheses, so no hypothesis mutants; no spec beyond the conclusion, so the flip (AF1) and the
wrong script (AF4) stand in for spec mutants. -/

namespace SeedelfAudit
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfAlwaysFalse99 alwaysFalse Seedelf.V1.anyPurposeArgs 99
#prep_uplc auditSeedelfAlwaysFalse100 alwaysFalse Seedelf.V1.anyPurposeArgs 100
#prep_uplc auditSeedelfAnyPurposeOnTrue auditSeedelfAlwaysTrue Seedelf.V1.anyPurposeArgs 500

-- AF1 conclusion flip: always_false halts
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (redeemer : Data) (info : ScriptInfo), isSuccessful (appliedAlwaysFalse.prop redeemer info)]

-- AF2 step limit one short of 100: no run has reached Error yet
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (redeemer : Data) (info : ScriptInfo), isUnsuccessful (auditSeedelfAlwaysFalse99.prop redeemer info)]

/-- AF3: at exactly 100 every run has. -/
theorem audit_always_false_at_100 : ∀ (redeemer : Data) (info : ScriptInfo),
    isUnsuccessful (auditSeedelfAlwaysFalse100.prop redeemer info) := by blaster (timeout: 540)

-- AF4 wrong script: the same arguments on a script that returns unit
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (redeemer : Data) (info : ScriptInfo), isUnsuccessful (auditSeedelfAnyPurposeOnTrue.prop redeemer info)]

end SeedelfAudit
