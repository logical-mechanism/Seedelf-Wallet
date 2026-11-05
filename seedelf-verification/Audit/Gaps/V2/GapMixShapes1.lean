import Audit.Gaps.V2.GapMixShapes
import Blaster

/-! A Mix of two for any ADA pool whose box out 1 carries an inline datum of a shape other
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

#prep_uplc appliedGapShapeBytes1 mixLogicTemplate gapShapeBytesArgs1 20000
#prep_uplc appliedGapShapeInt1 mixLogicTemplate gapShapeIntArgs1 20000
#prep_uplc appliedGapShapeList1 mixLogicTemplate gapShapeListArgs1 20000
#prep_uplc appliedGapShapeMap1 mixLogicTemplate gapShapeMapArgs1 20000
#prep_uplc appliedGapShapeConstrPos1 mixLogicTemplate gapShapeConstrPosArgs1 20000
#prep_uplc appliedGapShapeConstrNeg1 mixLogicTemplate gapShapeConstrNegArgs1 20000
#prep_uplc appliedGapShapeFields01 mixLogicTemplate gapShapeFields0Args1 20000
#prep_uplc appliedGapShapeFields11 mixLogicTemplate gapShapeFields1Args1 20000
#prep_uplc appliedGapShapeFields31 mixLogicTemplate gapShapeFields3Args1 20000

theorem gap_mix_box1_datum_bytes_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (s : ByteString),
      isUnsuccessful (appliedGapShapeBytes1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 s) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_int_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (i : Integer),
      isUnsuccessful (appliedGapShapeInt1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 i) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_list_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (l : List Data),
      isUnsuccessful (appliedGapShapeList1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 l) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_map_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (m : List (Data × Data)),
      isUnsuccessful (appliedGapShapeMap1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 m) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_constrpos_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data),
      isUnsuccessful (appliedGapShapeConstrPos1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 n fs) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_constrneg_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (n : Nat) (fs : List Data),
      isUnsuccessful (appliedGapShapeConstrNeg1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 n fs) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_fields0_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isUnsuccessful (appliedGapShapeFields01.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_fields1_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x : Data),
      isUnsuccessful (appliedGapShapeFields11.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 x) := by
  blaster (timeout: 540)

theorem gap_mix_box1_datum_fields3_fails :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (x y w : Data) (rest : List Data),
      isUnsuccessful (appliedGapShapeFields31.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 x y w rest) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
