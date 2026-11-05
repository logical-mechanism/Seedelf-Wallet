import Lovejoin.OwnClassic1Passes
import Blaster

/-! `Lovejoin.Classic.Own1.own_classic1_passes_with_every_proof` restated over
`appliedOwnClassic1Passes.exec`, so the statement names `cekExecuteProgram` itself, not
`#prep_uplc`'s optimized copy (see `Audit.Classic.OwnerExec`). Expected Valid: **1 "✅ Valid"
line**. "unsolved goals" is a tooling limit to report, "Goal was falsified" a finding. -/

namespace Audit.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own1 (ownerAcceptsOwn)

theorem audit_own1_passes_on_exec :
    ∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true →
      ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
        isSuccessful (appliedOwnClassic1Passes.exec a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Audit.Classic.Own1
