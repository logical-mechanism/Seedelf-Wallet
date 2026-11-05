import Lovejoin.V2.OwnAny2Spec
import Blaster

/-! v2's Owner withdrawal of 2, for any v2 pool, the converse: well-formed boxes
whose proofs all verify leave, given the NFT's policy isn't ADA's (`read_reference_datum` can't find it there).
With `Lovejoin.V2.OwnAny2Boxes`, a withdrawal of 2 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny2Passes mixLogicTemplate argsOwn 15000

/-- A withdrawal of 2 well-formed boxes whose proofs all verify succeeds. -/
theorem own_any2_passes_with_every_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 t1 z1 t2 z2 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true →
      ownerAcceptsOwn M a1 b1 a2 b2 t1 z1 t2 z2 s g u amt kc ch = true →
        isSuccessful (appliedOwnAny2Passes.prop P M a1 b1 a2 b2 t1 z1 t2 z2 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own2
