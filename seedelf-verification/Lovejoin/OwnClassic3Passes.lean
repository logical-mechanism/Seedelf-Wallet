import Lovejoin.OwnClassic3Spec
import Blaster

/-! The classic pool's Owner withdrawal of 3, for the classic pool, the converse: well-formed boxes
whose proofs all verify leave.
With `Lovejoin.OwnClassic3Boxes`, a withdrawal of 3 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnClassic3Passes mixLogic argsOwn 20000

/-- A withdrawal of 3 well-formed boxes whose proofs all verify succeeds. -/
theorem own_classic3_passes_with_every_proof :
    ∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
      ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
        isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.Classic.Own3
