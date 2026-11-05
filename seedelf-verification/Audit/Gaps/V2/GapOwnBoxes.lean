import Audit.Gaps.V2.GapOwn
import Blaster

/-! v2's Owner withdrawal for any pool, in `V2.GapOwn`'s shapes: a well-formed box whose proof
doesn't verify against the transaction's outputs and input refs fails, in the wallet's own
withdrawal and with an input at any credential sorted before the box; and a second
well-formed box with one proof fails, whatever the proof. The passing runs are
`V2.GapOwnSteps`'. Written by the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.OwnGap
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapOwnSolo mixLogicTemplate soloArgs 10000
#prep_uplc appliedGapOwnFirst mixLogicTemplate firstArgs 10000
#prep_uplc appliedGapOwnTwoOne mixLogicTemplate twoOneArgs 15000

/-- The wallet's own withdrawal fails without the box's proof. -/
theorem gap_own_solo_needs_the_proof :
    ∀ (P M a1 b1 t1 z1 s g u : ByteString) (amt : Integer),
      wellFormed a1 b1 = true → soloProof M s g u amt a1 b1 t1 z1 = false →
        isUnsuccessful (appliedGapOwnSolo.prop P M a1 b1 t1 z1 s g u amt) := by
  blaster (timeout: 540)

/-- So does one with an input at any credential before the box. -/
theorem gap_own_first_needs_the_proof :
    ∀ (P M a1 b1 t1 z1 : ByteString) (c : Credential) (xv : Integer) (s g u : ByteString) (amt : Integer),
      wellFormed a1 b1 = true → firstProof M s g u amt a1 b1 t1 z1 = false →
        isUnsuccessful (appliedGapOwnFirst.prop P M a1 b1 t1 z1 c xv s g u amt) := by
  blaster (timeout: 540)

/-- Two well-formed boxes with one proof fail: no box leaves uncounted. -/
theorem gap_own_counts_every_box :
    ∀ (P M a1 b1 a2 b2 t1 z1 s g u : ByteString) (amt : Integer),
      wellFormed a1 b1 = true → wellFormed a2 b2 = true →
        isUnsuccessful (appliedGapOwnTwoOne.prop P M a1 b1 a2 b2 t1 z1 s g u amt) := by
  blaster (timeout: 540)

end Lovejoin.V2.OwnGap
