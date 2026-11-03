import Lovejoin.V2.MixAny4Spec
import Blaster

/-! v2's Mix of 4, for any v2 ADA pool and any boxes, its last part: with every proof verifying it
succeeds, given what the script needs of the pool and the boxes (as in `V2.MixAnyPasses`):
the NFT's policy isn't ADA's, the box value isn't 0,
and every box's datum is two unequal 48-byte points. A pool's datum is always so
(`Template.OneShotMint`'s `nft_needs_a_sane_datum`). Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.Any4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMixAny4Passes mixLogicTemplate argsPool 60000

/-- A Mix of 4 in a sane v2 ADA pool, its boxes well-formed and every proof verifying, succeeds. -/
theorem mixany4_passes_with_every_proof :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true → wellFormed a4 b4 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
      mixAcceptsPool M bl a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 = true →
        isSuccessful (appliedMixAny4Passes.prop P M bl a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any4
