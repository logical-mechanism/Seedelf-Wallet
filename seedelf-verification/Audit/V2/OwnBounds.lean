import Lovejoin.V2.OwnAny1Spec
import Lovejoin.V2.OwnAny4Spec
import Audit.V2.Common
import Blaster

/-! Step limits for v2's Owner withdrawals of one and four boxes: one step under each honest
run (3415 and 7708 steps, `V2.OwnAny1Steps`, `V2.OwnAny4Steps`), the Passes theorem is
Falsified. Two `✅ Expected Falsified`. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OwnAny1At3414 mixLogicTemplate argsOwn 3414

-- One step under the honest 3415, a valid withdrawal of one can't finish.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true →
    ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
      isSuccessful (auditV2OwnAny1At3414.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Lovejoin.V2.Own1

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OwnAny4At7707 mixLogicTemplate argsOwn 7707

-- One step under the honest 7708, a valid withdrawal of four can't finish.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
    ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
      isSuccessful (auditV2OwnAny4At7707.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

end Lovejoin.V2.Own4
