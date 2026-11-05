import Lovejoin.Owner
import Blaster

/-! `Lovejoin.Classic.owner_withdraws_iff_proof` restated over `appliedOwner.exec`, which
`#prep_uplc` defines as `fun … => cekExecuteProgram mixLogic.script (ownerArgs …) 10000`, where
the original is over `appliedOwner.prop`, the command's optimized copy of it that nothing proves
equal to `exec`. Here the statement Lean checks names `cekExecuteProgram` itself, and the
optimizer runs inside the tactic, which every theorem trusts anyway.

Expected Valid: **1 "✅ Valid" line**. It redoes the preparation's work inside the tactic, so it
costs about what `Lovejoin.Owner` did. If it ends in "unsolved goals" (Undetermined), that's
Blaster not reducing `exec` the way `#prep_uplc` does, not a counterexample: report it. A
"Goal was falsified" would be a finding: `prop` and `exec` disagree. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (ownerAccepts payout)

theorem audit_owner_iff_on_exec : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwner.exec a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

end Audit.Classic
