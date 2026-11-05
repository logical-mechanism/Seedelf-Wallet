import Seedelf.Policy
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, PolicyAmount where a mint can pass: `amountArgs` with the token name
`generate` gives for first input "\x01"#0 (`goodName`, 5eed0e1f0001; GuardsCheap GC6 checks it
against `seedelfName` and runs a mint of one, a burn of one and a mint of two). Only the amount is
symbolic, as in PolicyAmount; the run is about 1290 steps, inside 1500.
PG1, PG2 and PG3 must be Valid; PG4 and PG5 must each print "✅ Expected Falsified". -/

namespace SeedelfAudit
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfAmountGood seedelf SeedelfAudit.amountGoodArgs 1500

/-- PG1: exactly a mint of one and a burn of one pass. -/
theorem audit_amount_good_iff : ∀ (n : Integer),
    isSuccessful (auditSeedelfAmountGood.prop n) ↔ (n = 1 ∨ n = -1) := by blaster (timeout: 540)

/-- PG2: other_amounts_fail, in a scenario whose mint can pass. -/
theorem audit_amount_good_others_fail : ∀ (n : Integer),
    n ≠ 1 → n ≠ -1 → isUnsuccessful (auditSeedelfAmountGood.prop n) := by blaster (timeout: 540)

/-- PG3: every run returns unit or reaches Error within 1500 steps. -/
theorem audit_amount_good_unit_or_error : ∀ (n : Integer),
    haltsWithUnit (auditSeedelfAmountGood.prop n) ∨ isUnsuccessful (auditSeedelfAmountGood.prop n) := by
  blaster (timeout: 540)

-- PG4 hypothesis mutant, n ≠ 1 dropped: now a mint of one passes, so it must die
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ -1 → isUnsuccessful (auditSeedelfAmountGood.prop n)]

-- PG5 hypothesis mutant, n ≠ -1 dropped: a burn of one passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ 1 → isUnsuccessful (auditSeedelfAmountGood.prop n)]

end SeedelfAudit
