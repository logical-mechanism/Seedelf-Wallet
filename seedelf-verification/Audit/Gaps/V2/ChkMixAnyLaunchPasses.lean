import Audit.Gaps.V2.ChkMixAnyLaunch
import Blaster

/-! Audit check (mix-scenario-shape, not part of the suite): `V2.MixAnyPasses`' converse, with
the launch's fee cap `fc`, mix_logic and fee_contract hashes `hl` and `hf`, and the reference
UTxO's lovelace `rv` and holder `rh` symbolic too, and no hypothesis on any of them. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedChkMixAnyLaunchPasses mixLogicTemplate chkLaunchArgs 20000

theorem chk_launch_passes_with_both_proofs :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedChkMixAnyLaunchPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
