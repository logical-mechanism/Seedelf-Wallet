import Audit.Gaps.Classic.OwnWallet1
import Blaster

/-! Audit (lovejoin-classic): in the wallet's own withdrawal shape (`Audit.Gaps.Classic.OwnWallet1`),
a well-formed box whose proof doesn't verify against this transaction fails. -/

namespace Lovejoin.Classic.AuditW1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedAuditW1Boxes mixLogic argsW 10000

theorem audit_w1_needs_the_box_proof : ∀ (a b t z s g u : ByteString) (amt : Integer),
    wellFormed a b = true → proofHoldsW s g u amt a b t z = false →
      isUnsuccessful (appliedAuditW1Boxes.prop a b t z s g u amt) := by
  blaster (timeout: 540)

end Lovejoin.Classic.AuditW1
