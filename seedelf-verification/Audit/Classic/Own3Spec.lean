import Lovejoin.OwnClassic3Boxes
import Lovejoin.OwnClassic3Passes
import Audit.Classic.Own3Specs
import Blaster

/-! Negative controls for the classic pool's Owner withdrawal of three boxes:
`own_classic3_needs_the_{first,second,third}_box_proof` (Boxes) and
`own_classic3_passes_with_every_proof` (Passes). Every check is expected Falsified: **this
module must print 8 "✅ Expected Falsified" lines**, cheapest first.

- [C-V1..2] Vacuity, on the spec alone.
- [C-S1..3] Passes, its hypothesis weakened: box 3's proof dropped; box 2's proof checked
  against box 1's points (a Valid one would mean proofs can be moved between boxes); the payer's
  ref left out of `ctx`.
- [C-H1..2] Boxes with its failure hypothesis replaced: box 2's proof failing against box 1's
  points, and an unrelated inequality.
- [C-F1] Passes concluding `isUnsuccessful`. -/

namespace Audit.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own3 (ownerAcceptsOwn proofHolds)

-- [C-V1] Passes' hypotheses can hold.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true → False]

-- [C-V2] The third box theorem's hypotheses can hold.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a3 b3 t3 z3 : ByteString)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a3 b3 = true → proofHolds s g u amt kc ch a3 b3 t3 z3 = false → False]

-- [C-S1] Passes with box 3's proof dropped.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsDrop3 a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-S2] Passes with box 2's proof checked against box 1's points.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsCrossed a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-S3] Passes with the payer's ref left out of ctx.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsNoPayer a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isSuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-H1] The second box theorem, box 2's proof failing against box 1's points instead of its own.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a2 b2 = true → proofHolds s g u amt kc ch a1 b1 t2 z2 = false →
    isUnsuccessful (appliedOwnClassic3Boxes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-H2] The first box theorem, failing because the payer's key isn't the change's.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → kp ≠ kc →
    isUnsuccessful (appliedOwnClassic3Boxes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-F1] Passes concluding failure.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isUnsuccessful (appliedOwnClassic3Passes.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

end Audit.Classic.Own3
