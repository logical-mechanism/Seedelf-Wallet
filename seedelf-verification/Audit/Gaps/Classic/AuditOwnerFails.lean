import Lovejoin.Owner
import Blaster

/-! Audit (statements), for the owner to run: the classic pool's `owner_withdraws_iff_proof`,
its security direction unbounded (an `Error`, not just "not a success within 10000 steps").
Same prep (`appliedOwner`), same scenario.

Runs with `./check.sh audit-gaps` (alone, `./check.sh Audit.Gaps.Classic.AuditOwnerFails`).
Expected: one `✅ Valid`. -/

namespace Lovejoin.Classic.AuditStatements
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

theorem owner_fails_without_proof : ∀ (a b t z pkh : ByteString) (amt : Integer),
    ownerAccepts a b t z (payout pkh amt) = false →
      isUnsuccessful (appliedOwner.prop a b t z pkh amt) := by blaster

end Lovejoin.Classic.AuditStatements
