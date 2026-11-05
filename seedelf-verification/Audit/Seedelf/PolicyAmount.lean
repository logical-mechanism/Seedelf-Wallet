import Seedelf.PolicyAmount
import Blaster

/-! Audit · Seedelf, PolicyAmount (`other_amounts_fail`), over its own `appliedAmount.prop`.
PA1, PA2, PA4 and PA5 must each print "✅ Expected Falsified"; PA3 and PA6 must be Valid.

PA3 is a SURVIVOR, and expected Valid: drop `n ≠ 1` and the theorem still holds. `amountArgs`
mints 5eed0e1f01 off first input "\x01"#0, but `generate` names that input's token
5eed0e1f ‖ 00 ‖ 01, so no mint can pass in this scenario (GuardsCheap GC5; Aiken's evaluator,
Scripts/policy_scenarios.sh: "amount scenario, n=1 → Error"). `other_amounts_fail` therefore only
exercises the burn block's `amt == -1`, never the mint block's `1 == amt`: a policy without that
check would pass it. PolicyAmountGood restates it where a mint can pass. -/

namespace SeedelfAudit
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Seedelf.V1

-- PA1 hypothesis mutant, n ≠ -1 dropped: a burn of one passes here
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ 1 → isUnsuccessful (appliedAmount.prop n)]

-- PA2 hypothesis mutant, a condition the script never tests (n ≠ 2): n = -1 passes
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ 2 → isUnsuccessful (appliedAmount.prop n)]

/-- PA3, the survivor: in this scenario even a mint of one fails. -/
theorem audit_amount_scenario_never_mints : ∀ (n : Integer),
    n ≠ -1 → isUnsuccessful (appliedAmount.prop n) := by blaster (timeout: 540)

-- PA4 vacuity: the hypotheses hold of some n
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ 1 → n ≠ -1 → False]

-- PA5 conclusion flip
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (n : Integer), n ≠ 1 → n ≠ -1 → isSuccessful (appliedAmount.prop n)]

/-- PA6, the scenario's pairing run (README rule 3): a burn of one passes. -/
theorem audit_amount_scenario_burns : isSuccessful (appliedAmount.prop (-1)) := by blaster (timeout: 540)

end SeedelfAudit
