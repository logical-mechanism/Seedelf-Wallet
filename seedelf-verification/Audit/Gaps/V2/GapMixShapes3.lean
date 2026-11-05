import Audit.Gaps.V2.GapMixShapes
import Blaster

/-! A Mix of two for any ADA pool whose box out 2 carries an inline datum of a shape other
than `Constr 0 [B _, B _]` fails, whatever the pool, the boxes and the proofs are: walk_outputs'
`decode_mix_datum_strict` (`expect mix_datum: MixDatum = inline_data`) checks the
constructor, that there are exactly two fields and that both are bytes. Shapes
Bytes, Int, List, Map, ConstrPos, ConstrNeg, Fields0, Fields1, Fields3. The concrete runs are `V2.GapMixShapesSteps`'. Written by
the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

#prep_uplc appliedGapShapeBytes2 mixLogicTemplate gapShapeBytesArgs2 20000
#prep_uplc appliedGapShapeInt2 mixLogicTemplate gapShapeIntArgs2 20000
#prep_uplc appliedGapShapeList2 mixLogicTemplate gapShapeListArgs2 20000
#prep_uplc appliedGapShapeMap2 mixLogicTemplate gapShapeMapArgs2 20000
#prep_uplc appliedGapShapeConstrPos2 mixLogicTemplate gapShapeConstrPosArgs2 20000
#prep_uplc appliedGapShapeConstrNeg2 mixLogicTemplate gapShapeConstrNegArgs2 20000
#prep_uplc appliedGapShapeFields02 mixLogicTemplate gapShapeFields0Args2 20000
#prep_uplc appliedGapShapeFields12 mixLogicTemplate gapShapeFields1Args2 20000
#prep_uplc appliedGapShapeFields32 mixLogicTemplate gapShapeFields3Args2 20000

theorem gap_mix_box2_datum_bytes_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (s : ByteString),
      isUnsuccessful (appliedGapShapeBytes2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 s) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_int_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer),
      isUnsuccessful (appliedGapShapeInt2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 i) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_list_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data),
      isUnsuccessful (appliedGapShapeList2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_map_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)),
      isUnsuccessful (appliedGapShapeMap2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 m) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_constrpos_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data),
      isUnsuccessful (appliedGapShapeConstrPos2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 n fs) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_constrneg_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data),
      isUnsuccessful (appliedGapShapeConstrNeg2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 n fs) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_fields0_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isUnsuccessful (appliedGapShapeFields02.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_fields1_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x : Data),
      isUnsuccessful (appliedGapShapeFields12.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 x) := by
  blaster (timeout: 540)

theorem gap_mix_box2_datum_fields3_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x y w : Data) (rest : List Data),
      isUnsuccessful (appliedGapShapeFields32.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 x y w rest) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
