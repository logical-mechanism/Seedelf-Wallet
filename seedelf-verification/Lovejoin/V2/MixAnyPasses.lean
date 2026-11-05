import Lovejoin.V2.MixAnySpec
import Blaster

/-! v2's Mix of two, for any v2 ADA pool and any boxes, its last part: with both proofs
verifying it succeeds, given what the script needs of the pool and the boxes. The NFT's
policy isn't ADA's (`""`, which `read_reference_datum` can't find), the box value isn't
0, and every box's datum is well-formed: two 48-byte points, unequal
(`try_decode_well_formed_data` for a box in, `decode_mix_datum_strict` for a box out). A
pool's datum always has a box value above 0 (`Template.OneShotMint`'s
`nft_needs_a_sane_datum`). -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMixAnyPasses mixLogicTemplate anyArgs 20000

/-- A Mix of two in a v2 ADA pool, its boxes well-formed and both proofs verifying, succeeds. -/
theorem mix_any_passes_with_both_proofs :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      P ≠ "" → bl ≠ 0 →
      wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
      mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
        isSuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540) (verbose: 1)

end Lovejoin.V2.Any
