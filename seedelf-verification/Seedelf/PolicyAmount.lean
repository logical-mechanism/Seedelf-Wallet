import Seedelf.Policy
import Blaster

/-! Only the amount is symbolic: a run takes about 1290 steps (Steps.lean), and
at that depth each symbolic value the policy compares multiplies the symbolic
run (four took it past 8 GB). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- Any amount of a 5eed0e1f token under policy `p`, first input `01#0`, no tag. -/
def amountArgs (n : Integer) : List Term :=
  [toTerm (mintCtx "p" "p" "\x5e\xed\x0e\x1f\x01" "\x01" "" 0 n)]

#prep_uplc appliedAmount seedelf amountArgs 1500

/-- Only 1 and -1 can pass: any other amount reaches `Error`. -/
theorem other_amounts_fail :
  ∀ (n : Integer), n ≠ 1 → n ≠ -1 → isUnsuccessful (appliedAmount.prop n) := by blaster

end Seedelf.V1
