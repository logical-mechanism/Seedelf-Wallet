import Lovejoin.OwnClassic2Spec
import Blaster

/-! The classic pool's Owner withdrawal of 2, for the classic pool, the converse: well-formed boxes
whose proofs all verify leave.
With `Lovejoin.OwnClassic2Boxes`, a withdrawal of 2 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnClassic2Passes mixLogic argsOwn 15000

/-- A withdrawal of 2 well-formed boxes whose proofs all verify succeeds. -/
theorem own_classic2_passes_with_every_proof :
    ∀ (a1 b1 a2 b2 t1 z1 t2 z2 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true →
      ownerAcceptsOwn a1 b1 a2 b2 t1 z1 t2 z2 s g u amt kc ch = true →
        isSuccessful (appliedOwnClassic2Passes.prop a1 b1 a2 b2 t1 z1 t2 z2 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.Classic.Own2
