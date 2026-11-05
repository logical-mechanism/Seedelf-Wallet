import Lovejoin.Owner
import Audit.Classic.Common
import Blaster

/-! Two gaps in `Lovejoin.Classic.owner_withdraws_iff_proof`, closed for its scenario. Both are
theorems, expected Valid: **this module must print 2 "✅ Valid" lines** and build.

- `audit_owner_runs_end`: every run ends within the module's 10000 steps, halted or in `Error`.
  The iff's → direction ("success ⇒ the proof verifies") says nothing of a run cut off at the
  limit; with this, every input the spec rejects really errors (the bounded-run caveat goes, for
  this scenario).
- `audit_owner_halts_with_unit`: every halt is the unit constant. `isSuccessful` is any halt;
  the ledger accepts a V3 script only when it returns unit, so with this the ← direction says
  the ledger accepts the withdrawal.

A "Goal was falsified" error would be a finding: a run of the scenario that ends neither way
within 10000 steps, or halts with something other than unit. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

theorem audit_owner_runs_end : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwner.prop a b t z pkh amt) ∨ isUnsuccessful (appliedOwner.prop a b t z pkh amt) := by
  blaster (timeout: 540)

theorem audit_owner_halts_with_unit : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwner.prop a b t z pkh amt) → HaltsWithUnit (appliedOwner.prop a b t z pkh amt) := by
  blaster (timeout: 540)

end Audit.Classic
