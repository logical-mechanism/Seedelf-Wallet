import Audit.Gaps.Classic.OwnWallet1
import Blaster

/-! Audit (lovejoin-classic): in the wallet's own withdrawal shape (`Audit.Gaps.Classic.OwnWallet1`),
a well-formed box whose proof verifies leaves. -/

namespace Lovejoin.Classic.AuditW1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedAuditW1Passes mixLogic argsW 10000

theorem audit_w1_passes_with_the_proof : ∀ (a b t z s g u : ByteString) (amt : Integer),
    wellFormed a b = true → proofHoldsW s g u amt a b t z = true →
      isSuccessful (appliedAuditW1Passes.prop a b t z s g u amt) := by
  blaster (timeout: 540)

end Lovejoin.Classic.AuditW1
