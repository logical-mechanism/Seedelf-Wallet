import Lovejoin.V2.OwnAny3Spec
import Blaster

/-! v2's Owner withdrawal of 3, for any v2 pool: no well-formed box leaves
without its own proof, bound to this transaction's outputs and inputs, whatever the pool,
the boxes' points, the proofs, the payer's input and both outputs are. One theorem per
box. The passing run is `Lovejoin.V2.OwnAny3Steps`'. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny3Boxes mixLogicTemplate argsOwn 20000

/-- A withdrawal whose first box is well-formed and its proof doesn't verify fails. -/
theorem own_any3_needs_the_first_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds M s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (appliedOwnAny3Boxes.prop P M a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose second box is well-formed and its proof doesn't verify fails. -/
theorem own_any3_needs_the_second_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a2 b2 = true → proofHolds M s g u amt kc ch a2 b2 t2 z2 = false →
        isUnsuccessful (appliedOwnAny3Boxes.prop P M a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose third box is well-formed and its proof doesn't verify fails. -/
theorem own_any3_needs_the_third_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a3 b3 = true → proofHolds M s g u amt kc ch a3 b3 t3 z3 = false →
        isUnsuccessful (appliedOwnAny3Boxes.prop P M a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own3
