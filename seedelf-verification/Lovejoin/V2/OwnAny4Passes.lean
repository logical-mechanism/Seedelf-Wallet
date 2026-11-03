import Lovejoin.V2.OwnAny4Spec
import Blaster

/-! v2's Owner withdrawal of 4, for any v2 pool, the converse: well-formed boxes
whose proofs all verify leave, given the NFT's policy isn't ADA's (`read_reference_datum` can't find it there).
With `Lovejoin.V2.OwnAny4Boxes`, a withdrawal of 4 well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny4Passes mixLogicTemplate argsOwn 25000

/-- A withdrawal of 4 well-formed boxes whose proofs all verify succeeds. -/
theorem own_any4_passes_with_every_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
      ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
        isSuccessful (appliedOwnAny4Passes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own4
