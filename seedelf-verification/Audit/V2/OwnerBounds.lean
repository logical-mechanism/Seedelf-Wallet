import Lovejoin.V2.Owner
import Audit.V2.Common
import Blaster

/-! Step limits for v2's Owner withdrawal of one box, and its iff over `cekExecuteProgram`.
At 3194 steps, one under the valid run's 3195 (`V2.Steps`), the iff is Falsified (one `✅
Expected Falsified`); at 3195 it's Valid, and over the CEK machine itself at the module's
10000 (two theorems, `✅ Valid`). -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout schnorrVerifies wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `V2.Owner`'s `exec` is the CEK machine's run, by definition. -/
theorem audit_owner_exec_is_the_run :
    appliedOwnerV2.exec = fun (a b t z pkh : ByteString) (amt : Integer) => cekExecuteProgram mixLogicV2.script (ownerArgsV2 a b t z pkh amt) 10000 := rfl

#prep_uplc auditV2OwnerAt3194 mixLogicV2 ownerArgsV2 3194

-- One step under the valid run's 3195, a valid withdrawal can't finish.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (auditV2OwnerAt3194.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

#prep_uplc auditV2OwnerAt3195 mixLogicV2 ownerArgsV2 3195

/-- At the valid run's own count, the iff holds. -/
theorem audit_owner_withdraws_iff_proof_at_3195 :
    ∀ (a b t z pkh : ByteString) (amt : Integer),
      isSuccessful (auditV2OwnerAt3195.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

/-- `owner_withdraws_iff_proof`, over `cekExecuteProgram` itself. -/
theorem audit_owner_withdraws_iff_proof_over_cek :
    ∀ (a b t z pkh : ByteString) (amt : Integer),
      isSuccessful (cekExecuteProgram mixLogicV2.script (ownerArgsV2 a b t z pkh amt) 10000) ↔ ownerAccepts a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

end Lovejoin.V2
