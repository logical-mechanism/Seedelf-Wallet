import Lovejoin.V2.MixTok3Out
import Blaster

/-! A Mix of 3's boxes out carry well-formed inline datums, for any v2 token pool: `V2.MixDatums`,
there at the test launch with two boxes, here on mix_logic's template, with every other
field symbolic. So every box the pool pays out is one a key can later withdraw. The
passing run is `V2.MixTok3OutSteps`' honest one. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Tok3
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMixTok3Datums mixLogicTemplate argsPool 45000
#prep_uplc appliedMixTok3Inline1 mixLogicTemplate inlineArgs1 45000
#prep_uplc appliedMixTok3Inline2 mixLogicTemplate inlineArgs2 45000
#prep_uplc appliedMixTok3Inline3 mixLogicTemplate inlineArgs3 45000

/-- A Mix whose box out's datum isn't two unequal 48-byte points fails. -/
theorem mixtok3_boxes_carry_well_formed_datums :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString),
      (wellFormed oa1 ob1 = false ∨ wellFormed oa2 ob2 = false ∨ wellFormed oa3 ob3 = false) →
        isUnsuccessful (appliedMixTok3Datums.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33) := by
  blaster (timeout: 540)

/-- So does one whose first box out's datum isn't inline. -/
theorem mixtok3_first_box_datum_inline :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (od : OutputDatum),
      notInline od = true →
        isUnsuccessful (appliedMixTok3Inline1.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 od) := by
  blaster (timeout: 540)

/-- So does one whose second box out's datum isn't inline. -/
theorem mixtok3_second_box_datum_inline :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (od : OutputDatum),
      notInline od = true →
        isUnsuccessful (appliedMixTok3Inline2.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 od) := by
  blaster (timeout: 540)

/-- So does one whose third box out's datum isn't inline. -/
theorem mixtok3_third_box_datum_inline :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) (od : OutputDatum),
      notInline od = true →
        isUnsuccessful (appliedMixTok3Inline3.prop P M bl tp tn tq a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 od) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok3
