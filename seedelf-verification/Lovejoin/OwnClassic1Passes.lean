import Lovejoin.OwnClassic1Spec
import Blaster

/-! The classic pool's Owner withdrawal of 1, for the classic pool, the converse: well-formed boxes
whose proofs all verify leave.
With `Lovejoin.OwnClassic1Boxes`, a withdrawal of 1 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnClassic1Passes mixLogic argsOwn 10000

/-- A withdrawal of 1 well-formed box whose proofs all verify succeeds. -/
theorem own_classic1_passes_with_every_proof :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true →
      ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
        isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.Classic.Own1
