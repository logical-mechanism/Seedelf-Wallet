import Seedelf.Steps
import Seedelf.PolicyAmount
import Seedelf.PolicyForeign

/-! Impact judge, finding `steps-runs-printed-not-guarded` (scratch, not part of the repo):
the control that shows which guard has teeth.

`PolicyAmount` and `PolicyForeign` are failure-only. Their pairing is Steps.lean's
`policy, mint #0` line, which halts, but in another context (first input `txid#0`, the name
`nameAt0`). Their own builder names the token `5eed0e1f01` for the first input `01#0`, where
the policy computes `5eed0e1f0001`, so their own mint at the passing point errors
(policy-mint-scenarios-misnamed). Aiken's evaluator agrees on the deployed policy
(the audit scratch folder's `policy_pairs.sh`: n = 1 crashes, n = -1 returns unit, the right
name with n = 1 returns unit).

So a `#guard` on the Steps string passes, and a `#guard` on the theorem's own `NAME.exec`
at its passing point fails: only the second catches the slip.

Run with `./check.sh audit-quick`. A failing `#guard` fails the build, so the two that bite, at
the `appliedAmount.exec 1` and `appliedForeignMint.exec "p"` lines, are negated here
(`#guard !…`): each holds exactly when the plain guard fails with `Expression … did not
evaluate to `true``. Expected: exit 0, no error (all three guards pass silently). -/

namespace StepsGuardsBite
open PlutusCore.UPLC.CekMachine (State)

def accepted : State → Bool
  | .Halt (.VCon .Unit) => true
  | _ => false

def halted (r : String) : Bool := r.startsWith "halt after"

end StepsGuardsBite

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

-- Passes: the Steps line rule 3 points at.
#guard StepsGuardsBite.halted (stepsUsed seedelf (mintCtx "p" "p" nameAt0 txid "" 0 1))
-- Bites, so negated: PolicyAmount's own builder at n = 1 isn't accepted.
#guard !StepsGuardsBite.accepted (appliedAmount.exec 1)
-- Bites, so negated: PolicyForeign's own mint builder at cs = "p" isn't accepted.
#guard !StepsGuardsBite.accepted (appliedForeignMint.exec "p")

end Seedelf.V1

#eval "StepsGuardsBite: done"
