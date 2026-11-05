import Lovejoin.V2.OwnAny4Spec
import Blaster

/-! v2's Owner withdrawal of 4, for any v2 pool: no well-formed box leaves
without its own proof, bound to this transaction's outputs and inputs, whatever the pool,
the boxes' points, the proofs, the payer's input and both outputs are. One theorem per
box. The passing run is `Lovejoin.V2.OwnAny4Steps`'. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedOwnAny4Boxes mixLogicTemplate argsOwn 25000

/-- A withdrawal whose first box is well-formed and its proof doesn't verify fails. -/
theorem own_any4_needs_the_first_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds M s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose second box is well-formed and its proof doesn't verify fails. -/
theorem own_any4_needs_the_second_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a2 b2 = true → proofHolds M s g u amt kc ch a2 b2 t2 z2 = false →
        isUnsuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose third box is well-formed and its proof doesn't verify fails. -/
theorem own_any4_needs_the_third_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a3 b3 = true → proofHolds M s g u amt kc ch a3 b3 t3 z3 = false →
        isUnsuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- A withdrawal whose fourth box is well-formed and its proof doesn't verify fails. -/
theorem own_any4_needs_the_fourth_box_proof :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a4 b4 = true → proofHolds M s g u amt kc ch a4 b4 t4 z4 = false →
        isUnsuccessful (appliedOwnAny4Boxes.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own4
