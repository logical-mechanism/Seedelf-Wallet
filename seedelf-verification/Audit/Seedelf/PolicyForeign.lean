import Seedelf.PolicyForeign
import Blaster

/-! Audit · Seedelf, PolicyForeign (`foreign_mint_fails`, `foreign_burn_fails`), over their own
props. PF2, PF3, PF4 and PF5 must each print "✅ Expected Falsified"; PF1 and PF6 must be Valid.

PF1 is a SURVIVOR, and expected Valid: drop `cs ≠ "p"` from foreign_mint_fails and it still holds.
`foreignMintArgs` mints 5eed0e1f01 off "\x01"#0, a name `generate` never gives that input, so the
mint fails under any policy id, the policy's own included (GuardsCheap GC7; Aiken's evaluator,
Scripts/policy_scenarios.sh: "foreign mint, cs=p → Error"). foreign_mint_fails never exercises the
mint block's `policy_id == pid`. PolicyForeignGood restates it where a mint can pass. The burn
theorem is sound: its hypothesis is needed (PF2). -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- PF1, the survivor: the mint scenario fails whatever the policy id. -/
theorem audit_foreign_mint_scenario_never_mints : ∀ (cs : ByteString),
    isUnsuccessful (appliedForeignMint.prop cs) := by blaster (timeout: 540)

-- PF2 foreign_burn_fails with its hypothesis dropped: the policy's own burn passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), isUnsuccessful (appliedForeignBurn.prop cs)]

-- PF3 its hypothesis replaced by one the script never tests (cs ≠ "q"): cs = "p" passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), cs ≠ "q" → isUnsuccessful (appliedForeignBurn.prop cs)]

-- PF4 conclusion flip
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), cs ≠ "p" → isSuccessful (appliedForeignBurn.prop cs)]

-- PF5 vacuity: the hypothesis holds of some cs
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), cs ≠ "p" → False]

/-- PF6, the burn scenario's pairing run: under the policy's own id it passes. -/
theorem audit_foreign_burn_scenario_own_policy_burns : isSuccessful (appliedForeignBurn.prop "p") := by
  blaster (timeout: 540)

end SeedelfAudit
