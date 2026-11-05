import Lovejoin.V2.OwnAny3Spec
import Blaster

/-! v2's Owner withdrawal of 3, for any v2 pool, the converse: well-formed boxes
whose proofs all verify leave, given the NFT's policy isn't ADA's (`read_reference_datum` can't find it there).
With `Lovejoin.V2.OwnAny3Boxes`, a withdrawal of 3 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny3Passes mixLogicTemplate argsOwn 20000

/-- A withdrawal of 3 well-formed boxes whose proofs all verify succeeds. -/
theorem own_any3_passes_with_every_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
      ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
        isSuccessful (appliedOwnAny3Passes.prop P M a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own3
