import Audit.Gaps.V2.ChkMixAnyLaunch
import Blaster

/-! Audit check (mix-scenario-shape, not part of the suite): `V2.MixAnyFirst`'s and
`V2.MixAnySecond`'s six checks, with the launch's fee cap `fc`, mix_logic and fee_contract
hashes `hl` and `hf`, and the reference UTxO's lovelace `rv` and holder `rh` symbolic too. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedChkMixAnyLaunchFails mixLogicTemplate chkLaunchArgs 20000

theorem chk_launch_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

theorem chk_launch_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

theorem chk_launch_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

theorem chk_launch_needs_the_second_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

theorem chk_launch_needs_the_second_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

theorem chk_launch_needs_the_second_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (fc rv : Integer) (hl hf rh : ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedChkMixAnyLaunchFails.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 fc rv hl hf rh) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
