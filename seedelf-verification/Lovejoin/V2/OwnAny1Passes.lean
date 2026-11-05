import Lovejoin.V2.OwnAny1Spec
import Blaster

/-! v2's Owner withdrawal of 1, for any v2 pool, the converse: well-formed boxes
whose proofs all verify leave, given the NFT's policy isn't ADA's (`read_reference_datum` can't find it there).
With `Lovejoin.V2.OwnAny1Boxes`, a withdrawal of 1 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny1Passes mixLogicTemplate argsOwn 10000

/-- A withdrawal of 1 well-formed box whose proofs all verify succeeds. -/
theorem own_any1_passes_with_every_proof :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true →
      ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
        isSuccessful (appliedOwnAny1Passes.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own1
