import Lovejoin.Logic
import Blaster

/-! The Owner withdrawal, with one box: it succeeds iff the box's datum is well-formed
and its Schnorr proof verifies against this transaction's `ctx`, the hash of its outputs
and input refs. So a proof is bound to the outputs it pays: here one output, whose key
and amount are symbolic. Under the opaque hash a proof made for one payout isn't known to
pass for another, so it can't be replayed to pay someone else.

The box's bytes, the proof and the payout are symbolic; the reference input is the
deployed one, the box the transaction's only input. The step limit sits above the
concrete runs `Steps.lean` measures. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def ownerArgs (a b t z pkh : ByteString) (amt : Integer) : List Term :=
  [toTerm (ownerCtx a b t z (payout pkh amt))]

#prep_uplc appliedOwner mixLogic ownerArgs 10000

/-- An owner withdraws a box iff the box is well-formed and the proof verifies for this
transaction's outputs and inputs. -/
theorem owner_withdraws_iff_proof : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwner.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true := by
  blaster

end Lovejoin.Classic
