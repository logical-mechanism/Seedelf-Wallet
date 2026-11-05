import Lovejoin.Owner
import Blaster

/-! The classic Owner withdrawal: a conclusion flip and the binding, stated over the script
itself rather than the spec. Each is expected Falsified: **this module must print
3 "✅ Expected Falsified" lines**.

- [A-F1] The iff's ← direction with `isUnsuccessful` for `isSuccessful`. Falsified means a
  proof the spec accepts makes the script halt, so success and failure aren't both provable.
- [A-B1] A run that succeeds paying `pkh` also succeeds paying `pkh'`, the same proof.
- [A-B2] The same with another amount.
  A Valid [A-B1] or [A-B2] would mean the script's acceptance doesn't depend on the payout in
  the model: the module doc's "bound to the outputs it pays" would be unsupported. They run two
  copies of the symbolic script, so they cost about twice the iff. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (ownerAccepts payout)

-- [A-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  ownerAccepts a b t z (payout pkh amt) = true → isUnsuccessful (appliedOwner.prop a b t z pkh amt)]

-- [A-B1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh pkh' : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) → isSuccessful (appliedOwner.prop a b t z pkh' amt)]

-- [A-B2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt amt' : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) → isSuccessful (appliedOwner.prop a b t z pkh amt')]

end Audit.Classic
