import Lovejoin.OwnClassic3Spec
import Lovejoin.V2.Scripts
import Blaster

/-! The classic Owner withdrawal of three boxes, on the same arguments (`argsOwn`) with the step
limit or the script changed. Each is expected Falsified: **this module must print
3 "✅ Expected Falsified" lines**.

- [C-L1] Passes with the limit one below the honest run (`OwnClassic3Steps`: halts after 6189).
- [C-L2] The first box theorem with the limit one below box 1's failing run (z1 changed errors
  after 5207): a run cut off there isn't `Error`.
- [C-W1] Passes on v2's mix_logic. -/

namespace Audit.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own3 (ownerAcceptsOwn proofHolds)

#prep_uplc auditClassicOwn3PassesAt6188 mixLogic Lovejoin.Classic.Own3.argsOwn 6188
#prep_uplc auditClassicOwn3BoxesAt5206 mixLogic Lovejoin.Classic.Own3.argsOwn 5206
#prep_uplc auditClassicOwn3OnV2 mixLogicV2 Lovejoin.Classic.Own3.argsOwn 20000

-- [C-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isSuccessful (auditClassicOwn3PassesAt6188.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false →
    isUnsuccessful (auditClassicOwn3BoxesAt5206.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

-- [C-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
    isSuccessful (auditClassicOwn3OnV2.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

end Audit.Classic.Own3
