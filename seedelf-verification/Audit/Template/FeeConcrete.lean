import Lovejoin.Template.FeeContract
import Lovejoin.Template.Steps
import Audit.Classic.Common

/-! fee_contract's template (`Lovejoin.Template.FeeContract`), concretely, through the `exec`
twins of its five props, at the 5 ₳ pool's NFT: the theorems' own scenarios, so the halting
runs show each failure theorem's scenario can pass. Expected: 7 `#guard`s pass, no output. -/

namespace Audit.Template
open Audit.Classic (haltedUnitB erroredB)
open Lovejoin.Template (pool5Policy)

-- [G-G1] A three-box Mix's 0.8 ₳ fee from a 5 ₳ shard, under a 1 ₳ cap: halts with unit.
#guard haltedUnitB (appliedFeePay.exec pool5Policy 1000000 5000000 4200000 800000)
-- [G-G2] The shard a lovelace short: errors.
#guard erroredB (appliedFeePay.exec pool5Policy 1000000 5000000 4199999 800000)
-- [G-G3] An exact fee of 1.2 ₳, above the cap: errors.
#guard erroredB (appliedFeePay.exec pool5Policy 1000000 6000000 4800000 1200000)
-- [G-G4] The same Mix of two boxes: errors.
#guard erroredB (appliedFeeTwoBoxes.exec pool5Policy 1000000 5000000 4200000 800000)
-- [G-G5] Under mix_logic's Owner redeemer: errors.
#guard erroredB (appliedFeeOwner.exec pool5Policy 1000000 5000000 4200000 800000)
-- [G-G6] With no mix_logic redeemer: errors.
#guard erroredB (appliedFeeNoMix.exec pool5Policy 1000000 5000000 4200000 800000)
-- [G-G7] Replenished from 5 ₳ to 6 ₳ it halts; to 5 ₳ it errors.
#guard haltedUnitB (appliedFeeReplenish.exec pool5Policy 5000000 6000000) &&
  erroredB (appliedFeeReplenish.exec pool5Policy 5000000 5000000)

end Audit.Template
