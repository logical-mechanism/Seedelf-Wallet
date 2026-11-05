import Lovejoin.V2.MixTok3Spec
import Blaster

/-! v2's Mix of 3, for any v2 token pool and any boxes, box in 3: if its proof doesn't verify, the
Mix fails, whatever the pool's parameters, every box's points and every proof field are.
Its 4 checks are 4 theorems: the challenge, then each branch. With the other boxes'
modules and `MixTok3Passes`, a Mix of 3 succeeds iff `mixAcceptsPool`. The passing run is
`V2.MixTok3Steps`'. Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.Tok3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixTok3Box3 mixLogicTemplate argsPool 45000

/-- A Mix whose third box's `c`s don't xor to its `c_global` fails. -/
theorem mixtok3_needs_the_third_challenge :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      challengeHoldsPool M bl tp tn tq oa1 ob1 oa2 ob2 oa3 ob3 a3 b3 t031 t131 c31 t032 t132 c32 t033 t133 c33 = false →
        isUnsuccessful (appliedMixTok3Box3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's first branch doesn't hold against the first box out. -/
theorem mixtok3_needs_the_third_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a3 b3 oa1 ob1 t031 t131 c31 z31 = false →
        isUnsuccessful (appliedMixTok3Box3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's second branch doesn't hold against the second box out. -/
theorem mixtok3_needs_the_third_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a3 b3 oa2 ob2 t032 t132 c32 z32 = false →
        isUnsuccessful (appliedMixTok3Box3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose third box's third branch doesn't hold against the third box out. -/
theorem mixtok3_needs_the_third_proofs_third_branch :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      branchHolds a3 b3 oa3 ob3 t033 t133 c33 z33 = false →
        isUnsuccessful (appliedMixTok3Box3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok3
