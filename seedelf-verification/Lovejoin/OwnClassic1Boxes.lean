import Lovejoin.OwnClassic1Spec
import Blaster

/-! The classic pool's Owner withdrawal of 1, for the classic pool: no well-formed box leaves
without its own proof, bound to this transaction's outputs and inputs, whatever
the boxes' points, the proofs, the payer's input and both outputs are. One theorem per
box. The passing run is `Lovejoin.OwnClassic1Steps`'. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnClassic1Boxes mixLogic argsOwn 10000

/-- A withdrawal whose first box is well-formed and its proof doesn't verify fails. -/
theorem own_classic1_needs_the_first_box_proof :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (appliedOwnClassic1Boxes.prop a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.Classic.Own1
