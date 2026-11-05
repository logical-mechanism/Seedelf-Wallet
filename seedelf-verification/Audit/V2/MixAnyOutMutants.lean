import Lovejoin.V2.MixAnyOutputs
import Lovejoin.V2.MixAnyDatums
import Audit.V2.Common
import Blaster

/-! Mutants of what a Mix of two must pay, and the passing runs of two builders. Four
`✅ Expected Falsified`, two theorems `✅ Valid`.

1. The address theorem with mix_box `M` replaced by the NFT policy `P`: it pins the address.
2. The value theorem with its hypothesis replaced by `oa1 ≠ oa2`, which the script never
   checks.
3. The datums theorem over `auditWellFormed47`: it pins 48 bytes.
4. The first inline theorem with `od ≠ .NoOutputDatum`, which admits inline datums.
5. The value builder with both boxes out holding `bl` passes, and 6. the address builder
   with both at mix_box, unstaked, without a reference script: each failure theorem's
   passing run, symbolically, on its own preparation. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

-- 1. The address theorem with P for M.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString),
    (c1 ≠ .ScriptCredential P ∨ s1 ≠ none ∨ r1 ≠ none ∨ c2 ≠ .ScriptCredential P ∨ s2 ≠ none ∨ r2 ≠ none) →
      isUnsuccessful (appliedMixAnyAddress.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2)]

-- 2. The value theorem with an unrelated hypothesis.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
    oa1 ≠ oa2 →
      isUnsuccessful (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2)]

-- 3. The datums theorem with 47-byte points.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    (auditWellFormed47 oa1 ob1 = false ∨ wellFormed oa2 ob2 = false) →
      isUnsuccessful (appliedMixAnyDatums.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 4. The first inline theorem, any datum but none.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum),
    od ≠ .NoOutputDatum →
      isUnsuccessful (appliedMixAnyInline1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 od)]

/-- 5. Both boxes out holding the box value, the value builder's Mix passes. -/
theorem audit_mixany_value_builder_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 : Integer),
      l1 = bl → l2 = bl →
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedMixAnyValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2) := by
  blaster (timeout: 540)

/-- 6. Both boxes out at mix_box, unstaked, without a reference script, the address builder's Mix passes. -/
theorem audit_mixany_address_builder_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString),
      c1 = .ScriptCredential M → c2 = .ScriptCredential M → s1 = none → s2 = none → r1 = none → r2 = none →
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedMixAnyAddress.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
