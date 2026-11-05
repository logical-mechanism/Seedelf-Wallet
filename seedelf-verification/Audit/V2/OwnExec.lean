import Lovejoin.V2.OwnAny1Spec
import Lovejoin.V2.OwnAny4Spec
import Audit.V2.Common
import Blaster

/-! v2's Owner withdrawals of one and four boxes, for any pool, restated over
`cekExecuteProgram` itself (see `Audit.V2.MixAnyExec`): for each, the first box's "needs"
theorem (box 2's at four) and Passes. Four theorems, each `✅ Valid`. -/

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `own_any1_needs_the_first_box_proof`, over `cekExecuteProgram`. -/
theorem audit_own_any1_needs_the_first_box_proof_over_cek :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a1 b1 = true → proofHolds M s g u amt kc ch a1 b1 t1 z1 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (argsOwn P M a1 b1 t1 z1 kp pin s g u amt kc ch) 10000) := by
  blaster (timeout: 540)

/-- `own_any1_passes_with_every_proof`, over `cekExecuteProgram`. -/
theorem audit_own_any1_passes_with_every_proof_over_cek :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true →
      ownerAcceptsOwn M a1 b1 t1 z1 s g u amt kc ch = true →
        isSuccessful (cekExecuteProgram mixLogicTemplate.script (argsOwn P M a1 b1 t1 z1 kp pin s g u amt kc ch) 10000) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own1

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `own_any4_needs_the_second_box_proof`, over `cekExecuteProgram`. -/
theorem audit_own_any4_needs_the_second_box_proof_over_cek :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      wellFormed a2 b2 = true → proofHolds M s g u amt kc ch a2 b2 t2 z2 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (argsOwn P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) 25000) := by
  blaster (timeout: 540)

/-- `own_any4_passes_with_every_proof`, over `cekExecuteProgram`. -/
theorem audit_own_any4_passes_with_every_proof_over_cek :
    ∀ (P M : ByteString) (a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
      P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true →
      ownerAcceptsOwn M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 s g u amt kc ch = true →
        isSuccessful (cekExecuteProgram mixLogicTemplate.script (argsOwn P M a1 b1 a2 b2 a3 b3 a4 b4 t1 z1 t2 z2 t3 z3 t4 z4 kp pin s g u amt kc ch) 25000) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own4
