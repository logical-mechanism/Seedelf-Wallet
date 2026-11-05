import Lovejoin.OwnClassic3Spec
import Lovejoin.OwnClassic3Steps
import Audit.Classic.MutantScripts
import Audit.Classic.Common
import Blaster

/-! Audit finding F-4 is about withdrawals of several boxes: without the input refs in `ctx`,
a proof seen for one box could be replayed for another with the same datum. Here the
three-box withdrawal's second box theorem runs on the mix_logic mutant that leaves the refs out
(`Audit.Classic.MutantScripts`). Expected: 1 `#guard` passes and **1 "✅ Expected Falsified"
line**.

- [C-M0] Concretely, `OwnClassic3Steps`' honest proofs error on the mutant.
- [C-M1] A Valid result would mean the three-box theorems can't see whether the refs are
  hashed: F-4's fix would be unproved. -/

namespace Audit.Classic.Own3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (erroredB)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own3 (proofHolds honest kP kS kC kG kU)
open Seedelf.V1 (g1)

#prep_uplc auditClassicOwn3NoRefs auditClassicMixLogicNoRefs Lovejoin.Classic.Own3.argsOwn 20000

-- [C-M0]
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3] =>
      erroredB (auditClassicOwn3NoRefs.exec g1 b1 g1 b2 g1 b3 t1 z1 t2 z2 t3 z3 kP 3000000 kS kG kU 20000000 kC 1000000)
  | _ => false

-- [C-M1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString)
    (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a2 b2 = true → proofHolds s g u amt kc ch a2 b2 t2 z2 = false →
    isUnsuccessful (auditClassicOwn3NoRefs.prop a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 kp pin s g u amt kc ch)]

end Audit.Classic.Own3
