import Lovejoin.V2.MixAnySpec
import Blaster

/-! v2's Mix of two, for any v2 ADA pool and any boxes, box in 2: if its proof doesn't
verify, the Mix fails, whatever the pool's NFT, mix_box and box value, every box's points
and every field of both proofs are. Its three checks are three theorems, as in
`V2.MixFirst`. With `MixAnyFirst`, `MixAnySecond` and `MixAnyPasses`, a Mix of two in
any v2 ADA pool succeeds iff `mixAcceptsAny`. The passing run is `V2.MixAnySteps`'. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixAnySecond mixLogicTemplate anyArgs 20000

/-- A Mix whose second box's `c`s don't xor to its `c_global` fails. -/
theorem mix_any_needs_the_second_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      challengeHoldsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 = false →
        isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540) (verbose: 1)

/-- So does one whose second box's first branch doesn't hold against the first box out. -/
theorem mix_any_needs_the_second_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21 = false →
        isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540) (verbose: 1)

/-- Or its second branch, against the second box out. -/
theorem mix_any_needs_the_second_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a2 b2 oa2 ob2 t022 t122 c22 z22 = false →
        isUnsuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540) (verbose: 1)

end Lovejoin.V2.Any
