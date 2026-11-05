import Lovejoin.Owner
import Audit.Classic.OwnerSpecs
import Blaster

/-! Negative controls for `Lovejoin.Classic.owner_withdraws_iff_proof`:
`isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true`.

Every check here is expected Falsified, so a surviving mutant fails the build with
"❌ Unexpected Valid". An Undetermined result is only a warning: **this module must print
7 "✅ Expected Falsified" lines**, cheapest first.

- [A-V1..3] use the spec alone, no script: it can say true, it can say false, and a proof it
  accepts for one payee it need not accept for another (the binding, in the spec).
- [A-S1..4] the iff with one part of the spec changed. Since the original iff is Valid, each is
  Falsified exactly when the change matters to the script, so a Valid one says that part of the
  spec, as the script reads it, constrains nothing. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (ownerAccepts payout)

-- [A-V1] The spec can say true, so the iff isn't `isSuccessful ↔ False`.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  ownerAccepts a b t z (payout pkh amt) = false]

-- [A-V2] The spec can say false.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  ownerAccepts a b t z (payout pkh amt) = true]

-- [A-V3] A proof the spec accepts for one payee, it need not accept for another.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh pkh' : ByteString) (amt : Integer),
  ownerAccepts a b t z (payout pkh amt) = true → ownerAccepts a b t z (payout pkh' amt) = true]

-- [A-S1] Without the box's well-formedness: a = b, or a wrong length, would pass.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoWF a b t z (payout pkh amt) = true]

-- [A-S2] ctx without the outputs: the payout unbound.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoOutputs a b t z (payout pkh amt) = true]

-- [A-S3] ctx without the input refs: audit finding F-4's binding.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsNoRefs a b t z (payout pkh amt) = true]

-- [A-S4] ctx ending in mix_logic's hash, not mix_box's.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAcceptsLogicHash a b t z (payout pkh amt) = true]

end Audit.Classic
