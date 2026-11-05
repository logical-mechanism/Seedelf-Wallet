import Lovejoin.V2.MixAnyOut
import Audit.V2.Common
import Blaster

/-! Three of what a Mix of two must pay, restated over `cekExecuteProgram` itself (see
`Audit.V2.MixAnyExec`): the address, the value and the datums. Three theorems, each
`✅ Valid`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

/-- `mixany_pays_its_boxes_to_mix_box`, over `cekExecuteProgram`. -/
theorem audit_mixany_pays_its_boxes_to_mix_box_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString),
      (c1 ≠ .ScriptCredential M ∨ s1 ≠ none ∨ r1 ≠ none ∨ c2 ≠ .ScriptCredential M ∨ s2 ≠ none ∨ r2 ≠ none) →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (addressArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2) 20000) := by
  blaster (timeout: 540)

/-- `mixany_boxes_hold_the_box_value`, over `cekExecuteProgram`. -/
theorem audit_mixany_boxes_hold_the_box_value_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
      (l1 ≠ bl ∨ l2 ≠ bl) →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (valueArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) 20000) := by
  blaster (timeout: 540)

/-- `mixany_boxes_carry_well_formed_datums`, over `cekExecuteProgram`. -/
theorem audit_mixany_boxes_carry_well_formed_datums_over_cek :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      (wellFormed oa1 ob1 = false ∨ wellFormed oa2 ob2 = false) →
        isUnsuccessful (cekExecuteProgram mixLogicTemplate.script (anyArgs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) 20000) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
