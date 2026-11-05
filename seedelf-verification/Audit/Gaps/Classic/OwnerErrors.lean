import Lovejoin.Logic
import Blaster

/-! Audit (lovejoin-classic), not part of the suite. `Lovejoin.Owner`'s iff gives only
`¬ isSuccessful` when `ownerAccepts` is false, and a run cut off at the step limit
satisfies that (README rule 2). This is the failure direction as rule 2 wants it,
`isUnsuccessful`, on `Owner.lean`'s own scenario and limit. -/

namespace Lovejoin.Classic.AuditOwner
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def ownerArgsAudit (a b t z pkh : ByteString) (amt : Integer) : List Term :=
  [toTerm (ownerCtx a b t z (payout pkh amt))]

#prep_uplc appliedOwnerAudit mixLogic ownerArgsAudit 10000

/-- A withdrawal whose box isn't well-formed, or whose proof doesn't verify against this
transaction, reaches `Error`. -/
theorem owner_errors_without_proof : ∀ (a b t z pkh : ByteString) (amt : Integer),
    ownerAccepts a b t z (payout pkh amt) = false →
      isUnsuccessful (appliedOwnerAudit.prop a b t z pkh amt) := by
  blaster

end Lovejoin.Classic.AuditOwner
