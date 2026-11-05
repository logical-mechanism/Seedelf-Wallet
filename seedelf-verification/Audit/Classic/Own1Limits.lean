import Lovejoin.OwnClassic1Spec
import Lovejoin.V2.Scripts
import Blaster

/-! The classic Owner withdrawal of one box, on the same arguments (`argsOwn`) with the step
limit or the script changed. Each is expected Falsified: **this module must print
3 "✅ Expected Falsified" lines**.

- [B-L1] Passes with the limit one below the honest run (`OwnClassic1Steps`: halts after 3319).
- [B-L2] Boxes with the limit one below the failing run (z1 changed errors after 3207). Boxes
  says `isUnsuccessful`, which a run cut off at the limit isn't: a Valid result here would mean
  the model counts exhaustion as failure, and every failure theorem would hold for nothing.
- [B-W1] Passes on v2's mix_logic, which can't find its NFT here. -/

namespace Audit.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own1 (ownerAcceptsOwn proofHolds)

#prep_uplc auditClassicOwn1PassesAt3318 mixLogic Lovejoin.Classic.Own1.argsOwn 3318
#prep_uplc auditClassicOwn1BoxesAt3206 mixLogic Lovejoin.Classic.Own1.argsOwn 3206
#prep_uplc auditClassicOwn1OnV2 mixLogicV2 Lovejoin.Classic.Own1.argsOwn 10000

-- [B-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
    isSuccessful (auditClassicOwn1PassesAt3318.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false →
    isUnsuccessful (auditClassicOwn1BoxesAt3206.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
    isSuccessful (auditClassicOwn1OnV2.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Audit.Classic.Own1
