import Lovejoin.Template.FeeContract
import Blaster

/-! The converses of fee_contract's two conditional theorems, so each scenario's condition is an
iff. Theorems, expected Valid: **this module must print 2 "✅ Valid" lines** and build.

`P ≠ ""` for the reason `Audit.Template.OneShotIff` gives: with the empty policy the reference
input's ADA entry hides the NFT, so the scenario can't read the pool's datum and fails whatever
the amounts (Aiken's evaluator agrees on the template's bytes). A "Goal was falsified" names
another case where the scenario fails for a reason the theorem doesn't state. -/

namespace Audit.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

/-- `shard_pays_exactly_the_fee`'s converse: a shard losing exactly the fee, at most the cap,
pays a three-box Mix. -/
theorem audit_shard_pays_iff : ∀ (P : ByteString) (cap fi fo f : Integer),
    P ≠ "" → (isSuccessful (appliedFeePay.prop P cap fi fo f) ↔ (fi - fo = f ∧ f ≤ cap)) := by
  blaster (timeout: 540)

/-- `shard_only_grows`'s converse: any growth is a valid replenishment. -/
theorem audit_shard_replenish_iff : ∀ (P : ByteString) (fi fo : Integer),
    P ≠ "" → (isSuccessful (appliedFeeReplenish.prop P fi fo) ↔ fi < fo) := by
  blaster (timeout: 540)

end Audit.Template
