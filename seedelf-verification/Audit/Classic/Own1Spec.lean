import Lovejoin.OwnClassic1Boxes
import Lovejoin.OwnClassic1Passes
import Audit.Classic.Own1Specs
import Blaster

/-! Negative controls for the classic pool's Owner withdrawal of one box:
`own_classic1_needs_the_first_box_proof` (Boxes) and `own_classic1_passes_with_every_proof`
(Passes). Every check is expected Falsified: **this module must print 8 "✅ Expected
Falsified" lines**, cheapest first.

- [B-V1..2] Vacuity, on the spec alone: each theorem's hypotheses can hold together.
- [B-S1..3] Passes with its hypothesis weakened by one change: the payer's input ref left out of
  `ctx`, the outputs hashed in the other order, the box's well-formedness dropped. A Valid one
  would say the script doesn't check what that change removes.
- [B-H1..2] Boxes with its failure hypothesis replaced: by one the script doesn't check at all
  (the payer's key differs from the change's), and by "the proof fails against the `ctx` that
  leaves the payer's ref out". A Valid one would make Boxes true for a reason other than the
  proof.
- [B-F1] Passes concluding `isUnsuccessful`. -/

namespace Audit.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own1 (ownerAcceptsOwn proofHolds)

-- [B-V1] Passes' hypotheses can hold.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (s g u : ByteString) (amt : Integer)
    (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true → False]

-- [B-V2] Boxes' hypotheses can hold.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (s g u : ByteString) (amt : Integer)
    (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false → False]

-- [B-S1] Passes, the proof verifying against a ctx without the payer's input ref.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsNoPayer a1 b1 t1 z1 s g u amt kc ch = true →
    isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-S2] Passes, the proof verifying against the outputs in the other order.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOutputsSwapped a1 b1 t1 z1 s g u amt kc ch = true →
    isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-S3] Passes without the box's well-formedness: the proof alone.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  proofHolds s g u amt kc ch a1 b1 t1 z1 = true →
    isSuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-H1] Boxes, failing because the payer's key isn't the change's: nothing the script checks.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → kp ≠ kc →
    isUnsuccessful (appliedOwnClassic1Boxes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-H2] Boxes, failing because the proof doesn't verify against the ctx without the payer's ref.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → proofHoldsNoPayer s g u amt kc ch a1 b1 t1 z1 = false →
    isUnsuccessful (appliedOwnClassic1Boxes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-F1] Passes concluding failure.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
    isUnsuccessful (appliedOwnClassic1Passes.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Audit.Classic.Own1
