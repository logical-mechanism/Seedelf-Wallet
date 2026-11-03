import Lovejoin.V2.MixTok3Out
import Blaster

/-! No value leaves the pool in a Mix of 3, for any v2 token pool: `V2.MixOutputs`, there at the
test launch with two boxes, here on mix_logic's template. Whatever the pool's parameters,
the boxes' points and the proofs are, a Mix fails unless its first 3 outputs are each at
mix_box, with no stake credential or reference script, holding exactly the box value, and
no later output is another box there. The passing run is `V2.MixTok3OutSteps`' honest
one, and `V2.MixTok3`'s iff is the same Mix (`mixCtxOuts_is_the_mix`). Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Tok3
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixTok3Address mixLogicTemplate addressArgs 45000
#prep_uplc appliedMixTok3Value mixLogicTemplate valueArgs 45000
#prep_uplc appliedMixTok3Token1 mixLogicTemplate tokenArgs1 45000
#prep_uplc appliedMixTok3Token2 mixLogicTemplate tokenArgs2 45000
#prep_uplc appliedMixTok3Token3 mixLogicTemplate tokenArgs3 45000
#prep_uplc appliedMixTok3Fewer mixLogicTemplate fewerArgs 45000
#prep_uplc appliedMixTok3Tail mixLogicTemplate tailArgs 45000

/-- A Mix whose box out is anywhere but mix_box, or has a stake credential or a
reference script, fails: a key's address, another script's, mix_box's with a stake part. -/
theorem mixtok3_pays_its_boxes_to_mix_box :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (c1 c2 c3 : Credential) (s1 s2 s3 : Option StakingCredential) (r1 r2 r3 : Option ByteString),
      (c1 ≠ .ScriptCredential M ∨ s1 ≠ none ∨ r1 ≠ none ∨ c2 ≠ .ScriptCredential M ∨ s2 ≠ none ∨ r2 ≠ none ∨ c3 ≠ .ScriptCredential M ∨ s3 ≠ none ∨ r3 ≠ none) →
        isUnsuccessful (appliedMixTok3Address.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 c1 c2 c3 s1 s2 s3 r1 r2 r3) := by
  blaster (timeout: 540)

/-- So does one whose box out holds other than the box value's lovelace and token quantity. -/
theorem mixtok3_boxes_hold_the_box_value :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (l1 l2 l3 q1 q2 q3 : Integer),
      (l1 ≠ bl ∨ q1 ≠ tq ∨ l2 ≠ bl ∨ q2 ≠ tq ∨ l3 ≠ bl ∨ q3 ≠ tq) →
        isUnsuccessful (appliedMixTok3Value.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 l1 l2 l3 q1 q2 q3) := by
  blaster (timeout: 540)

/-- Or whose first box out holds any token beside the box value. -/
theorem mixtok3_first_box_holds_no_other_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedMixTok3Token1.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 p nm q) := by
  blaster (timeout: 540)

/-- Or whose second box out holds any token beside the box value. -/
theorem mixtok3_second_box_holds_no_other_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedMixTok3Token2.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 p nm q) := by
  blaster (timeout: 540)

/-- Or whose third box out holds any token beside the box value. -/
theorem mixtok3_third_box_holds_no_other_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedMixTok3Token3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 p nm q) := by
  blaster (timeout: 540)

/-- A Mix of 3 with only 2 outputs fails: walk_outputs needs a box out for each box in. -/
theorem mixtok3_needs_every_box_out :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      isUnsuccessful (appliedMixTok3Fewer.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one paying another box to mix_box after its 3: a box enters the pool only
with a proof. -/
theorem mixtok3_pays_no_other_box_to_mix_box :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (xa xb : ByteString),
      isUnsuccessful (appliedMixTok3Tail.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 xa xb) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok3
