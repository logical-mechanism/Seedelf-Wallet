import Lovejoin.V2.MixAnyOut
import Blaster

/-! A Mix of 2's boxes out carry well-formed inline datums, for any v2 ADA pool: `V2.MixDatums`,
there at the test launch with two boxes, here on mix_logic's template, with every other
field symbolic. So every box the pool pays out is one a key can later withdraw. The
passing run is `V2.MixAnyOutSteps`' honest one. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMixAnyDatums mixLogicTemplate anyArgs 20000
#prep_uplc appliedMixAnyInline1 mixLogicTemplate inlineArgs1 20000
#prep_uplc appliedMixAnyInline2 mixLogicTemplate inlineArgs2 20000

/-- A Mix whose box out's datum isn't two unequal 48-byte points fails. -/
theorem mixany_boxes_carry_well_formed_datums :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      (wellFormed oa1 ob1 = false ∨ wellFormed oa2 ob2 = false) →
        isUnsuccessful (appliedMixAnyDatums.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

/-- So does one whose first box out's datum isn't inline. -/
theorem mixany_first_box_datum_inline :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum),
      notInline od = true →
        isUnsuccessful (appliedMixAnyInline1.prop P M bl a1 b1 a2 b2 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 od) := by
  blaster (timeout: 540)

/-- So does one whose second box out's datum isn't inline. -/
theorem mixany_second_box_datum_inline :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (od : OutputDatum),
      notInline od = true →
        isUnsuccessful (appliedMixAnyInline2.prop P M bl a1 b1 a2 b2 oa1 ob1 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 od) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
