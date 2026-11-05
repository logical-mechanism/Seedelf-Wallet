import Audit.Gaps.V2.GapMixShapes
import Blaster

/-! A Mix of two for any ADA pool whose box out 2 carries an inline datum of a shape other
than `Constr 0 [B _, B _]` fails, whatever the pool, the boxes and the proofs are: walk_outputs'
`decode_mix_datum_strict` (`expect mix_datum: MixDatum = inline_data`) checks the
constructor, that there are exactly two fields and that both are bytes. Shapes
FirstConstr, FirstMap, FirstList, FirstI, SecondConstr, SecondMap, SecondList, SecondI. The concrete runs are `V2.GapMixShapesSteps`'. Written by
the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

#prep_uplc appliedGapShapeFirstConstr2 mixLogicTemplate gapShapeFirstConstrArgs2 20000
#prep_uplc appliedGapShapeFirstMap2 mixLogicTemplate gapShapeFirstMapArgs2 20000
#prep_uplc appliedGapShapeFirstList2 mixLogicTemplate gapShapeFirstListArgs2 20000
#prep_uplc appliedGapShapeFirstI2 mixLogicTemplate gapShapeFirstIArgs2 20000
#prep_uplc appliedGapShapeSecondConstr2 mixLogicTemplate gapShapeSecondConstrArgs2 20000
#prep_uplc appliedGapShapeSecondMap2 mixLogicTemplate gapShapeSecondMapArgs2 20000
#prep_uplc appliedGapShapeSecondList2 mixLogicTemplate gapShapeSecondListArgs2 20000
#prep_uplc appliedGapShapeSecondI2 mixLogicTemplate gapShapeSecondIArgs2 20000
#prep_uplc appliedGapAnyTwoPairs2 mixLogicTemplate gapAnyTwoPairsArgs2 20000

theorem gap_mix_box2_datum_firstconstr_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (k : Integer) (fs : List Data) (y : Data),
      isUnsuccessful (appliedGapShapeFirstConstr2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 k fs y) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_firstmap_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)) (y : Data),
      isUnsuccessful (appliedGapShapeFirstMap2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 m y) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_firstlist_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data) (y : Data),
      isUnsuccessful (appliedGapShapeFirstList2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l y) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_firsti_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer) (y : Data),
      isUnsuccessful (appliedGapShapeFirstI2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 i y) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_secondconstr_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (k : Integer) (fs : List Data),
      isUnsuccessful (appliedGapShapeSecondConstr2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 a k fs) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_secondmap_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (m : List (Data × Data)),
      isUnsuccessful (appliedGapShapeSecondMap2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 a m) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_secondlist_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (l : List Data),
      isUnsuccessful (appliedGapShapeSecondList2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 a l) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_secondi_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (a : ByteString) (i : Integer),
      isUnsuccessful (appliedGapShapeSecondI2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 a i) := by
  blaster (timeout: 540)

/-- An ADA pool's box out 2 holding any token, whatever its lovelace, fails. -/
theorem gap_mix_box2_holds_no_token_at_all :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : Integer) (p nm : ByteString) (q : Integer),
      isUnsuccessful (appliedGapAnyTwoPairs2.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l p nm q) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
