import Lovejoin.Owner
import Audit.Classic.OwnerSpecs
import Blaster

/-! More spec mutants for `Lovejoin.Classic.owner_withdraws_iff_proof`, inside schnorr.ak's
`verify` (see `Audit.Classic.OwnerSpecA` for how to read them). Each is expected Falsified:
**this module must print 4 "✅ Expected Falsified" lines**.

- [A-S5] z's range check dropped: a non-canonical z (z ≥ the field order) would pass.
- [A-S6] z's length check dropped.
- [A-S7] the equation without its commitment term: `z·a = c·b` for `z·a = t + c·b`.
- [A-S8] the Fiat-Shamir preimage with `a` and `b` swapped (README rule 7: an opaque hash
  sees a different input). -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout)

-- [A-S5]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoRange a b t z (payout pkh amt) = true]

-- [A-S6]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoLength a b t z (payout pkh amt) = true]

-- [A-S7]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoT a b t z (payout pkh amt) = true]

-- [A-S8]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsSwapped a b t z (payout pkh amt) = true]

end Audit.Classic
