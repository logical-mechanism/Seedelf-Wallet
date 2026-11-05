import Lovejoin.V2.Owner
import Lovejoin.V2.OwnAny1Spec
import Lovejoin.V2.OwnAny4Spec
import Audit.V2.Common
import Blaster

/-! Wrong-script controls for v2's Owner withdrawals. Four `✅ Expected Falsified`, two
theorems `✅ Valid`.

1. A script that accepts everything: `own_any1_needs_the_first_box_proof` is Falsified.
2. One that fails everything: `own_any1_passes_with_every_proof` is Falsified.
3. The classic pool's deployed mix_logic (0dad3046…) on v2's one-box scenario: it can't find
   its own reference NFT there, so `owner_withdraws_iff_proof` is Falsified.
4. Mutant M3 (validate_owner verifies only the first proof), four boxes: box 2's "needs"
   theorem is Falsified, 5. Passes stays Valid (M3 accepts a superset), and 6. with one
   box M3 is the template, so box 1's "needs" theorem stays Valid. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2AcceptAllOwn1 Audit.V2.auditAcceptAll argsOwn 200
#prep_uplc auditV2RejectAllOwn1 Audit.V2.auditRejectAll argsOwn 200

-- 1. A script that accepts everything.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    wellFormed a1 b1 = true → proofHolds M s g u amt kc ch a1 b1 t1 z1 = false →
      isUnsuccessful (auditV2AcceptAllOwn1.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- 2. A script that fails everything.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    P ≠ "" → wellFormed a1 b1 = true →
    ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
      isSuccessful (auditV2RejectAllOwn1.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Lovejoin.V2.Own1

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout)

#prep_uplc auditV2OwnerOnClassic mixLogic ownerArgsV2 10000

-- 3. The classic pool's mix_logic on v2's Owner scenario.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (auditV2OwnerOnClassic.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

end Lovejoin.V2

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OwnerFirstOwn4 auditV2MixLogicOwnerFirst argsOwn 25000

-- 4. M3, four boxes: box 2's proof isn't checked.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
    wellFormed a2 b2 = true → proofHolds M s g u amt kc ch a2 b2 t2 z2 = false →
      isUnsuccessful (auditV2OwnerFirstOwn4.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch)]

/-- 5. M3 still passes every withdrawal of four the template passes. -/
theorem audit_owner_first_proof_passes_four :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
      ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
        isSuccessful (auditV2OwnerFirstOwn4.prop P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own4

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#prep_uplc auditV2OwnerFirstOwn1 auditV2MixLogicOwnerFirst argsOwn 10000

/-- 6. With one box, M3 is the template: box 1's proof is still needed. -/
theorem audit_owner_first_proof_needs_the_one_box_proof :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds M s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (auditV2OwnerFirstOwn1.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own1
