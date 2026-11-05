import Lovejoin.V2.MixAnyOut
import Audit.V2.Common
import Blaster

/-! Wrong-script controls for v2's general Mix of two in an ADA pool: the same arguments
functions on other scripts. Five `✅ Expected Falsified` and two theorems `✅ Valid`; the
`#guard`s first.

- Concretely: the KAT halts on mutants M1 and M2, so each is otherwise sane, and M2 accepts
  the KAT with box out 2 a lovelace more, which mix_logic's template refuses.
- 1. A script that accepts everything: the first-branch theorem is Falsified, and 7. so is
  `mixany_boxes_carry_well_formed_datums`. 2. One that fails everything: Passes is Falsified.
- M1 (each branch checks `z·a = t0 + c·a'` alone): 3. the first-branch theorem is
  Falsified, and 4. Passes stays Valid (M1 accepts a superset). So the branch theorem rests
  on the script's second equation, not on the spec alone.
- M2 (no `output.value == box_value`): 5. `mixany_boxes_hold_the_box_value` is Falsified,
  and 6. on M2 a Mix with valid proofs succeeds whatever its boxes out hold: `ctx` hashes
  the cached box value's bytes, not the outputs', so the proofs never see the amounts. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)

#guard auditHaltsUnit (cekExecuteProgram auditV2MixLogicOneEq.script (anyArgs nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 20000)
#guard auditHaltsUnit (cekExecuteProgram auditV2MixLogicNoValue.script (anyArgs nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 20000)
#guard auditHaltsUnit (cekExecuteProgram auditV2MixLogicNoValue.script (valueArgs nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 10000000 10000001) 20000)
#guard auditErrors (cekExecuteProgram mixLogicTemplate.script (valueArgs nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 10000000 10000001) 20000)

#prep_uplc auditV2AcceptAllAny Audit.V2.auditAcceptAll anyArgs 200
#prep_uplc auditV2RejectAllAny Audit.V2.auditRejectAll anyArgs 200

-- 1. A script that accepts everything.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
      isUnsuccessful (auditV2AcceptAllAny.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 2. A script that fails everything.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (auditV2RejectAllAny.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 7. The datums theorem on a script that accepts everything.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    (wellFormed oa1 ob1 = false ∨ wellFormed oa2 ob2 = false) →
      isUnsuccessful (auditV2AcceptAllAny.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

#prep_uplc auditV2OneEqAny auditV2MixLogicOneEq anyArgs 20000

-- 3. M1: the first-branch theorem.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
      isUnsuccessful (auditV2OneEqAny.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

/-- 4. M1 still passes every Mix the template passes. -/
theorem audit_mix_any_one_equation_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (auditV2OneEqAny.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

#prep_uplc auditV2NoValueValue auditV2MixLogicNoValue valueArgs 20000

-- 5. M2: mixany_boxes_hold_the_box_value.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
    (l1 ≠ bl ∨ l2 ≠ bl) →
      isUnsuccessful (auditV2NoValueValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2)]

/-- 6. On M2, a Mix with valid proofs succeeds whatever lovelace its boxes out hold. -/
theorem audit_mix_any_no_value_check_leaks :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (auditV2NoValueValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
