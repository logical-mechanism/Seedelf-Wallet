import Lovejoin.V2.MixTok2Spec
import Blaster

/-! v2's Mix of 2, for any v2 token pool and any boxes, box in 1: if its proof doesn't verify, the
Mix fails, whatever the pool's parameters, every box's points and every proof field are.
Its 3 checks are 3 theorems: the challenge, then each branch. With the other boxes'
modules and `MixTok2Passes`, a Mix of 2 succeeds iff `mixAcceptsPool`. The passing run is
`V2.MixTok2Steps`'. Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixTok2Box1 mixLogicTemplate argsPool 25000

/-- A Mix whose first box's `c`s don't xor to its `c_global` fails. -/
theorem mixtok2_needs_the_first_challenge :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      challengeHoldsPool M bl tp tn tq oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 t012 t112 c12 = false →
        isUnsuccessful (appliedMixTok2Box1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- So does one whose first box's first branch doesn't hold against the first box out. -/
theorem mixtok2_needs_the_first_proofs_first_branch :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a1 b1 oa1 ob1 t011 t111 c11 z11 = false →
        isUnsuccessful (appliedMixTok2Box1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- So does one whose first box's second branch doesn't hold against the second box out. -/
theorem mixtok2_needs_the_first_proofs_second_branch :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      branchHolds a1 b1 oa2 ob2 t012 t112 c12 z12 = false →
        isUnsuccessful (appliedMixTok2Box1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok2
