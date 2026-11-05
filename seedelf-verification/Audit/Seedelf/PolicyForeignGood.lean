import Seedelf.Policy
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, PolicyForeign's mint where a mint can pass: `foreignMintArgs` with `goodName`
(GuardsCheap GC6, GC7). FG1, FG2 and FG3 must be Valid; FG4 and FG5 must each print
"✅ Expected Falsified". (On the ledger a policy only runs when its own id is in the mint, so a
one-line mint under another id never reaches it: this pins the script's own check.) -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfForeignMintGood seedelf SeedelfAudit.foreignMintGoodArgs 1500

/-- FG1: foreign_mint_fails, in a scenario whose mint can pass. -/
theorem audit_foreign_mint_good_fails : ∀ (cs : ByteString),
    cs ≠ "p" → isUnsuccessful (auditSeedelfForeignMintGood.prop cs) := by blaster (timeout: 540)

/-- FG2: the mint passes exactly under the policy's own id. -/
theorem audit_foreign_mint_good_iff : ∀ (cs : ByteString),
    isSuccessful (auditSeedelfForeignMintGood.prop cs) ↔ cs = "p" := by blaster (timeout: 540)

/-- FG3: every run returns unit or reaches Error within 1500 steps. -/
theorem audit_foreign_mint_good_unit_or_error : ∀ (cs : ByteString),
    haltsWithUnit (auditSeedelfForeignMintGood.prop cs) ∨ isUnsuccessful (auditSeedelfForeignMintGood.prop cs) := by
  blaster (timeout: 540)

-- FG4 hypothesis dropped: the policy's own mint passes, so it must die
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), isUnsuccessful (auditSeedelfForeignMintGood.prop cs)]

-- FG5 conclusion flip
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), cs ≠ "p" → isSuccessful (auditSeedelfForeignMintGood.prop cs)]

end SeedelfAudit
