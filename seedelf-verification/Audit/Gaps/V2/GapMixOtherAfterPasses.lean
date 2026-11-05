import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool, with an input that isn't a box after the boxes (a payer's key, a script's UTxO, or one at mix_box with no datum): with both proofs verifying it succeeds, under
`V2.MixAnyPasses`' conditions. With `V2.GapMixOtherAfter`, the Mix's iff holds with that input
there. Written by the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixOtherAfterPasses mixLogicTemplate gapOtherAfterArgs 20000

theorem gap_mixotherafter_passes :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c : Credential) (xv : Integer),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedGapMixOtherAfterPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c xv) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
