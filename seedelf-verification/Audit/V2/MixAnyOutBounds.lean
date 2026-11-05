import Lovejoin.V2.MixAnyOutputs
import Lovejoin.V2.MixAnyDatums
import Audit.V2.Common
import Blaster

/-! Step limits and results for what a Mix of two must pay. No run of the address, value,
datums or first inline preparation is cut off at 20000 (four theorems, `✅ Valid`), and
every halt of the value preparation is the unit constant (one theorem, `✅ Valid`). At 4000
steps, before walk_outputs reaches a box out (the earliest output failure, box 1 at a key,
errors after 4622), the value theorem is Falsified (one `✅ Expected Falsified`). -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

/-- Every run of the address preparation halts or errors within 20000 steps. -/
theorem audit_mixany_address_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString),
      isSuccessful (appliedMixAnyAddress.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2) ∨
        isUnsuccessful (appliedMixAnyAddress.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2) := by
  blaster (timeout: 540)

/-- So does every run of the value preparation. -/
theorem audit_mixany_value_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
      isSuccessful (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) ∨
        isUnsuccessful (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) := by
  blaster (timeout: 540)

/-- And of the datums preparation. -/
theorem audit_mixany_datums_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixAnyDatums.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ∨
        isUnsuccessful (appliedMixAnyDatums.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- And of the first inline preparation. -/
theorem audit_mixany_inline1_run_ends :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum),
      isSuccessful (appliedMixAnyInline1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 od) ∨
        isUnsuccessful (appliedMixAnyInline1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 od) := by
  blaster (timeout: 540)

/-- Every halt of the value preparation is the unit constant. -/
theorem audit_mixany_value_halts_with_unit :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
      isSuccessful (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) →
        auditHaltsWithUnit (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) := by
  blaster (timeout: 540)

#prep_uplc auditV2MixAnyValueAt4000 mixLogicTemplate valueArgs 4000

-- At 4000 steps no box out has been checked: a wrong value isn't an Error yet.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
    (l1 ≠ bl ∨ l2 ≠ bl) →
      isUnsuccessful (auditV2MixAnyValueAt4000.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2)]

end Lovejoin.V2.Any
