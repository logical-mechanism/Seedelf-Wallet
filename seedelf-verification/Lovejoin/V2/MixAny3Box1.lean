import Lovejoin.V2.MixAny3Spec
import Blaster

/-! v2's Mix of 3, for any v2 ADA pool and any boxes, box in 1: if its proof doesn't verify, the
Mix fails, whatever the pool's parameters, every box's points and every proof field are.
Its 4 checks are 4 theorems: the challenge, then each branch. With the other boxes'
modules and `MixAny3Passes`, a Mix of 3 succeeds iff `mixAcceptsPool`. The passing run is
`V2.MixAny3Steps`'. Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.Any3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixAny3Box1 mixLogicTemplate argsPool 40000

/-- A Mix whose first box's `c`s don't xor to its `c_global` fails. -/
theorem mixany3_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a1 b1 t011 t111 c11 t012 t112 c12 t013 t113 c13 = false →
        isUnsuccessful (appliedMixAny3Box1.prop P M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose first box's first branch doesn't hold against the first box out. -/
theorem mixany3_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedMixAny3Box1.prop P M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose first box's second branch doesn't hold against the second box out. -/
theorem mixany3_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedMixAny3Box1.prop P M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose first box's third branch doesn't hold against the third box out. -/
theorem mixany3_needs_the_first_proofs_third_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a1 b1 oa3 ob3 t013 t113 c13 z13 = false →
        isUnsuccessful (appliedMixAny3Box1.prop P M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any3
