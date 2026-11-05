import Lovejoin.V2.Owner
import Blaster

/-! Audit (statements), for the owner to run: v2's `owner_withdraws_iff_proof`, its security
direction unbounded. Same prep (`appliedOwnerV2`), same scenario.

Built in place as `Audit.Gaps.V2.AuditOwnerFailsV2`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.V2.AuditOwnerFailsV2`. Expected: one `✅ Valid`. -/

namespace Lovejoin.V2.AuditStatements
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout)

theorem owner_fails_without_proof : ∀ (a b t z pkh : ByteString) (amt : Integer),
    ownerAccepts a b t z (payout pkh amt) = false →
      isUnsuccessful (appliedOwnerV2.prop a b t z pkh amt) := by blaster

end Lovejoin.V2.AuditStatements
