import Lovejoin.V2.MixTok2Spec
import Blaster

/-! v2's Mix of 2, for any v2 token pool and any boxes, its last part: with every proof verifying it
succeeds, given what the script needs of the pool and the boxes (as in `V2.MixAnyPasses`):
the NFT's policy isn't ADA's, the box value isn't 0, the token isn't ADA and its quantity isn't 0,
and every box's datum is two unequal 48-byte points. A pool's datum is always so
(`Template.OneShotMint`'s `nft_needs_a_sane_datum`). Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMixTok2Passes mixLogicTemplate argsPool 25000

/-- A Mix of 2 in a sane v2 token pool, its boxes well-formed and every proof verifying, succeeds. -/
theorem mixtok2_passes_with_every_proof :
    ∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedMixTok2Passes.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

end Lovejoin.V2.Tok2
