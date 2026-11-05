import Audit.Gaps.V2.MixTok3Values
import Blaster

/-! A token pool's third box out holds the pool's own token, in a Mix of 3: with the pool's
parameters, every box's points and every proof field symbolic, a Mix fails if that box out
holds another token in the pool's place, lovelace alone, two policies' tokens, or two names
under one policy. With `V2.MixTok3Outputs`, a box out holding at most two tokens beside its
lovelace fails unless it holds exactly the box value. The passing run is
`V2.MixTok3ValuesSteps`' honest one. Written by `gen-lovejoin-mix-values.py`. -/

namespace Lovejoin.V2.Tok3
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixTok3Swap3 mixLogicTemplate swapArgs3 45000
#prep_uplc appliedMixTok3Bare3 mixLogicTemplate bareArgs3 45000
#prep_uplc appliedMixTok3TwoTokens3 mixLogicTemplate twoTokensArgs3 45000
#prep_uplc appliedMixTok3TwoNames3 mixLogicTemplate twoNamesArgs3 45000

/-- A Mix fails if its third box out holds one token that isn't the pool's own at its quantity, or other
lovelace: another policy's token, another name, another quantity. -/
theorem mixtok3_third_box_holds_the_pools_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer),
      (l ≠ bl ∨ p ≠ tp ∨ nm ≠ tn ∨ q ≠ tq) →
        isUnsuccessful (appliedMixTok3Swap3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 l p nm q) := by
  blaster (timeout: 540)

/-- A Mix fails if its third box out holds lovelace alone, the pool's token kept back. -/
theorem mixtok3_third_box_needs_the_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer),
      tp ≠ "" → tq ≠ 0 →
        isUnsuccessful (appliedMixTok3Bare3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 l) := by
  blaster (timeout: 540)

/-- A Mix fails if its third box out holds two policies' tokens: another beside the pool's, before or after it,
or two with the pool's withheld. -/
theorem mixtok3_third_box_holds_at_most_one_policy :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p1 n1 : ByteString) (q1 : Integer) (p2 n2 : ByteString) (q2 : Integer),
      isUnsuccessful (appliedMixTok3TwoTokens3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 l p1 n1 q1 p2 n2 q2) := by
  blaster (timeout: 540)

/-- A Mix fails if its third box out holds two names under one policy: a second name under the pool's, before or
after its token. -/
theorem mixtok3_third_box_holds_at_most_one_name :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l : Integer) (p n1 : ByteString) (q1 : Integer) (n2 : ByteString) (q2 : Integer),
      isUnsuccessful (appliedMixTok3TwoNames3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 l p n1 q1 n2 q2) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok3
