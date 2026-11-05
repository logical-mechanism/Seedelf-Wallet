import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool, with an input between the boxes whose datum `(xa, xb)` is inline but which isn't a box (at another credential, or at mix_box malformed): with both proofs verifying it succeeds, under
`V2.MixAnyPasses`' conditions. With `V2.GapMixDatumBetween`, the Mix's iff holds with that input
there. Written by the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixDatumBetweenPasses mixLogicTemplate gapDatumBetweenArgs 20000

theorem gap_mixdatumbetween_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xa xb : ByteString),
      (c ≠ .ScriptCredential M ∨ wellFormed xa xb = false) →
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedGapMixDatumBetweenPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xa xb) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
