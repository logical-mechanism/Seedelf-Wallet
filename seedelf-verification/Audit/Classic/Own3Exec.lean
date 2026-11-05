import Lovejoin.OwnClassic3Passes
import Blaster

/-! `Lovejoin.Classic.Own3.own_classic3_passes_with_every_proof` restated over
`appliedOwnClassic3Passes.exec` (see `Audit.Classic.OwnerExec`). Expected Valid:
**1 "✅ Valid" line**. It redoes a 20000-step preparation inside the tactic. -/

namespace Audit.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own3 (ownerAcceptsOwn)

theorem audit_own3_passes_on_exec :
    ∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
      ownerAcceptsOwn a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 s g u amt kc ch = true →
        isSuccessful (appliedOwnClassic3Passes.exec a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Audit.Classic.Own3
