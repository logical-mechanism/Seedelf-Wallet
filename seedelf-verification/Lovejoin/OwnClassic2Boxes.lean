import Lovejoin.OwnClassic2Spec
import Blaster

/-! The classic pool's Owner withdrawal of 2, for the classic pool: no well-formed box leaves
without its own proof, bound to this transaction's outputs and inputs, whatever
the boxes' points, the proofs, the payer's input and both outputs are. One theorem per
box. The passing run is `Lovejoin.OwnClassic2Steps`'. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnClassic2Boxes mixLogic argsOwn 15000

/-- A withdrawal whose first box is well-formed and its proof doesn't verify fails. -/
theorem own_classic2_needs_the_first_box_proof :
    ∀ (a1 b1 a2 b2 t1 z1 t2 z2 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (appliedOwnClassic2Boxes.prop a1 b1 a2 b2 t1 z1 t2 z2 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose second box is well-formed and its proof doesn't verify fails. -/
theorem own_classic2_needs_the_second_box_proof :
    ∀ (a1 b1 a2 b2 t1 z1 t2 z2 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a2 b2 = true → proofHolds s g u amt kc ch a2 b2 t2 z2 = false →
        isUnsuccessful (appliedOwnClassic2Boxes.prop a1 b1 a2 b2 t1 z1 t2 z2 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.Classic.Own2
