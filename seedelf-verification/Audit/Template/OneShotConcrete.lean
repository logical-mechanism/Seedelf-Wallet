import Lovejoin.Template.OneShotMint
import Lovejoin.Template.Steps
import Audit.Classic.Common

/-! one_shot_mint's template (`Lovejoin.Template.OneShotMint`), concretely, through the `exec`
twins of its five props, at the mainnet 5 ₳ pool's own parameters (its seed `d4c72bc2…#0`,
reference_holder, its policy). These are the theorems' own scenarios, so each `exec` that
halts shows that scenario can succeed under the real builtins: the failure theorems aren't true
because the scenario always fails. `Template.Steps` prints its runs on another builder and
checks nothing. Expected: 7 `#guard`s pass, no output. -/

namespace Audit.Template
open CardanoLedgerApi.V3
open Audit.Classic (haltedUnitB erroredB)
open Lovejoin.Template (nftName pool5Seed rhHash pool5Policy)

-- [F-G1] One token named `lovejoin` at reference_holder, the seed spent: halts with unit.
#guard haltedUnitB (appliedNftAmount.exec pool5Seed 0 rhHash pool5Policy nftName 1)
-- [F-G2] Minting two: errors.
#guard erroredB (appliedNftAmount.exec pool5Seed 0 rhHash pool5Policy nftName 2)
-- [F-G3] Another name: errors.
#guard erroredB (appliedNftAmount.exec pool5Seed 0 rhHash pool5Policy "lovejoim" 1)
-- [F-G4] With the seed spent it halts; with the seed's index changed it errors.
#guard haltedUnitB (appliedNftSeed.exec pool5Seed 0 rhHash pool5Policy pool5Seed 0) &&
  erroredB (appliedNftSeed.exec pool5Seed 0 rhHash pool5Policy pool5Seed 1)
-- [F-G5] At reference_holder it halts; at a key with the same hash it errors.
#guard haltedUnitB (appliedNftPlace.exec pool5Seed 0 rhHash pool5Policy (.ScriptCredential rhHash) none none) &&
  erroredB (appliedNftPlace.exec pool5Seed 0 rhHash pool5Policy (.PubKeyCredential rhHash) none none)
-- [F-G6] The 5 ₳ pool's numbers (5 ₳ boxes, a 1.5 ₳ cap) halt; a cap equal to the box errors.
#guard haltedUnitB (appliedNftDatum.exec pool5Seed 0 rhHash pool5Policy 5000000 "" "" 0 1500000) &&
  erroredB (appliedNftDatum.exec pool5Seed 0 rhHash pool5Policy 5000000 "" "" 0 5000000)
-- [F-G7] Two names under the policy: errors.
#guard erroredB (appliedNftTwoNames.exec pool5Seed 0 rhHash pool5Policy nftName "x" 1 1)

end Audit.Template
