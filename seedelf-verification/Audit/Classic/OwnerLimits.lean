import Lovejoin.Owner
import Lovejoin.V2.Scripts
import Blaster

/-! The classic Owner iff on the same arguments with one other thing changed: the step limit, or
the script. Each is expected Falsified: **this module must print 2 "✅ Expected Falsified"
lines**.

- [A-L1] The step limit one below the honest run: `Lovejoin.Steps` measures a real proof
  halting after 3099 steps, so at 3098 no accepting run finishes. A Valid result would mean
  the symbolic accepting run is shorter than the concrete one, so the measured counts that
  size every limit don't describe what the proofs ran.
- [A-W1] The same arguments on v2's mix_logic (`mixLogicV2`, the test launch's NFT), which finds
  no NFT of its own in the classic reference input and fails. A Valid result would mean the
  iff doesn't depend on which script runs. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (ownerAccepts payout)

#prep_uplc auditClassicOwnerAt3098 mixLogic Lovejoin.Classic.ownerArgs 3098
#prep_uplc auditClassicOwnerOnV2 mixLogicV2 Lovejoin.Classic.ownerArgs 10000

-- [A-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (auditClassicOwnerAt3098.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

-- [A-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (auditClassicOwnerOnV2.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

end Audit.Classic
