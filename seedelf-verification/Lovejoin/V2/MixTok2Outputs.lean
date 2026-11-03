import Lovejoin.V2.MixTok2Out
import Blaster

/-! No value leaves the pool in a Mix of 2, for any v2 token pool: `V2.MixOutputs`, there at the
test launch with two boxes, here on mix_logic's template. Whatever the pool's parameters,
the boxes' points and the proofs are, a Mix fails unless its first 2 outputs are each at
mix_box, with no stake credential or reference script, holding exactly the box value, and
no later output is another box there. The passing run is `V2.MixTok2OutSteps`' honest
one, and `V2.MixTok2`'s iff is the same Mix (`mixCtxOuts_is_the_mix`). Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Tok2
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc appliedMixTok2Address mixLogicTemplate addressArgs 25000
#prep_uplc appliedMixTok2Value mixLogicTemplate valueArgs 25000
#prep_uplc appliedMixTok2Token1 mixLogicTemplate tokenArgs1 25000
#prep_uplc appliedMixTok2Token2 mixLogicTemplate tokenArgs2 25000
#prep_uplc appliedMixTok2Fewer mixLogicTemplate fewerArgs 25000
#prep_uplc appliedMixTok2Tail mixLogicTemplate tailArgs 25000

/-- A Mix whose box out is anywhere but mix_box, or has a stake credential or a
reference script, fails: a key's address, another script's, mix_box's with a stake part. -/
theorem mixtok2_pays_its_boxes_to_mix_box :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString),
      (c1 ≠ .ScriptCredential M ∨ s1 ≠ none ∨ r1 ≠ none ∨ c2 ≠ .ScriptCredential M ∨ s2 ≠ none ∨ r2 ≠ none) →
        isUnsuccessful (appliedMixTok2Address.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 c1 c2 s1 s2 r1 r2) := by
  blaster (timeout: 540)

/-- So does one whose box out holds other than the box value's lovelace and token quantity. -/
theorem mixtok2_boxes_hold_the_box_value :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l1 l2 q1 q2 : Integer),
      (l1 ≠ bl ∨ q1 ≠ tq ∨ l2 ≠ bl ∨ q2 ≠ tq) →
        isUnsuccessful (appliedMixTok2Value.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l1 l2 q1 q2) := by
  blaster (timeout: 540)

/-- Or whose first box out holds any token beside the box value. -/
theorem mixtok2_first_box_holds_no_other_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedMixTok2Token1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 p nm q) := by
  blaster (timeout: 540)

/-- Or whose second box out holds any token beside the box value. -/
theorem mixtok2_second_box_holds_no_other_token :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedMixTok2Token2.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 p nm q) := by
  blaster (timeout: 540)

/-- A Mix of 2 with only 1 output fails: walk_outputs needs a box out for each box in. -/
theorem mixtok2_needs_every_box_out :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isUnsuccessful (appliedMixTok2Fewer.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- So does one paying another box to mix_box after its 2: a box enters the pool only
with a proof. -/
theorem mixtok2_pays_no_other_box_to_mix_box :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (xa xb : ByteString),
      isUnsuccessful (appliedMixTok2Tail.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 xa xb) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok2
