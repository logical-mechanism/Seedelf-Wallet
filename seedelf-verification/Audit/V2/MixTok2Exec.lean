import Lovejoin.V2.MixTok2Spec
import Audit.V2.Common
import Blaster

/-! v2's Mix of two in any token pool, three of its theorems restated over `cekExecuteProgram`
itself (see `Audit.V2.MixAnyExec`): box 1's first branch, box 2's second, and Passes. Three
theorems, each `✅ Valid`. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `mixtok2_needs_the_first_proofs_first_branch`, over `cekExecuteProgram`. -/
theorem audit_mixtok2_needs_the_first_proofs_first_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (argsPool P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 25000) := by
  blaster (timeout: 540)

/-- `mixtok2_needs_the_second_proofs_second_branch`, over `cekExecuteProgram`. -/
theorem audit_mixtok2_needs_the_second_proofs_second_branch_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (argsPool P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 25000) := by
  blaster (timeout: 540)

/-- `mixtok2_passes_with_every_proof`, over `cekExecuteProgram`. -/
theorem audit_mixtok2_passes_with_every_proof_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (cekExecuteProgram mixLogicTemplate.script (argsPool P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 25000) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok2
