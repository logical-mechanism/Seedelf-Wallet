import Audit.Gaps.V2.GapOwn
import Blaster

/-! v2's Owner withdrawal for any pool, in `V2.GapOwn`'s shapes, the converse: a well-formed box
whose proof verifies leaves, in the wallet's own withdrawal and with an input at any
credential before it, given the NFT's policy isn't ADA's. With `V2.GapOwnBoxes`, each
withdrawal succeeds iff its spec. Written by the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.OwnGap
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapOwnSoloPasses mixLogicTemplate soloArgs 10000
#prep_uplc appliedGapOwnFirstPasses mixLogicTemplate firstArgs 10000

theorem gap_own_solo_passes :
    ∀ (P M a1 b1 t1 z1 s g u : ByteString) (amt : Integer),
      P ≠ "" → wellFormed a1 b1 = true → soloProof M s g u amt a1 b1 t1 z1 = true →
        isSuccessful (appliedGapOwnSoloPasses.prop P M a1 b1 t1 z1 s g u amt) := by
  blaster (timeout: 540)

theorem gap_own_first_passes :
    ∀ (P M a1 b1 t1 z1 : ByteString) (c : Credential) (xv : Integer) (s g u : ByteString) (amt : Integer),
      P ≠ "" → wellFormed a1 b1 = true → firstProof M s g u amt a1 b1 t1 z1 = true →
        isSuccessful (appliedGapOwnFirstPasses.prop P M a1 b1 t1 z1 c xv s g u amt) := by
  blaster (timeout: 540)

end Lovejoin.V2.OwnGap
