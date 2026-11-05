import Lovejoin.Template.OneShotMint
import Lovejoin.Template.FeeContract
import Lovejoin.Template.Steps
import Blaster

/-! Audit (templates), not part of the suite: the converses. `OneShotMint`'s and
`FeeContract`'s ten theorems are all failures, so README rule 3's passing run is
`Template.Steps`' alone, at one pool's values (and, for one_shot_mint, at the 5 ₳ pool's
datum, not the theorems' `saneDatum`). These state it over the theorems' own `.prop`s, for
every pool whose NFT policy isn't ADA's (`read_reference_datum` and `output_at_reference_holder`
can't find a token under `""`):

- one_shot_mint: the honest launch of every family (`nftSeedArgs` at `s' = s`, `i' = i` is
  `nftAmountArgs` at `lovejoin`, 1, `nftPlaceArgs` at reference_holder and `nftDatumArgs` at
  `saneDatum`'s fields) halts;
- fee_contract: with `shard_pays_exactly_the_fee`, a shard pays a Mix's fee iff it loses
  exactly the fee and the fee is at most the cap; with `shard_only_grows`, a replenish
  passes iff the shard grows.

Built in place as `Audit.Gaps.Template.AuditPasses`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.AuditPasses`. Expected: three `✅ Valid`, and
the `#eval` printing `halt after 1941`. -/

namespace Lovejoin.Template.AuditPasses
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Template

/-- The launch every `OneShotMint` family shares, as a mint of the seed's own policy. -/
theorem nft_launch_halts : ∀ (s : ByteString) (i : Integer) (rh P : ByteString),
    P ≠ "" → isSuccessful (appliedNftSeed.prop s i rh P s i) := by blaster

/-- A shard that loses exactly the fee, at most the cap, pays a three-box Mix. -/
theorem shard_pays_a_mix_fee : ∀ (P : ByteString) (cap fi fo f : Integer),
    P ≠ "" → fi - fo = f → f ≤ cap → isSuccessful (appliedFeePay.prop P cap fi fo f) := by blaster

/-- A shard that grows is replenished. -/
theorem shard_grows : ∀ (P : ByteString) (fi fo : Integer),
    P ≠ "" → fi < fo → isSuccessful (appliedFeeReplenish.prop P fi fo) := by blaster

-- The theorems' own launch (`saneDatum`), at the 5 ₳ pool's parameters: the path of
-- `Template.Steps`' launch, so `halt after 1941` (only the datum's values differ).
#eval s!"audit one_shot_mint, saneDatum: {stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 1) (refAt rhHash pool5Policy))}"

end Lovejoin.Template.AuditPasses
