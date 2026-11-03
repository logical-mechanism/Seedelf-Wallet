import Lovejoin.V2.Logic
import Blaster

/-! v2's Owner withdrawal, with one box: it succeeds iff the box's datum is well-formed
and its Schnorr proof verifies against this transaction's `ctx`, the hash of its outputs
and input refs. It's `Lovejoin.Owner`'s property on v2's bytes, so a proof is bound to
the outputs it pays, and can't be replayed to pay someone else.

The box's bytes, the proof and the payout's key and amount are symbolic. The reference
input is the test launch's, and the box is the transaction's only input. The step limit
sits above `V2.Steps`' concrete runs. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout)

def ownerArgsV2 (a b t z pkh : ByteString) (amt : Integer) : List Term :=
  [toTerm (ownerCtx a b t z (payout pkh amt))]

#prep_uplc appliedOwnerV2 mixLogic ownerArgsV2 10000

/-- An owner withdraws a box iff the box is well-formed and the proof verifies for this
transaction's outputs and inputs. -/
theorem owner_withdraws_iff_proof : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwnerV2.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true := by
  blaster

end Lovejoin.V2
