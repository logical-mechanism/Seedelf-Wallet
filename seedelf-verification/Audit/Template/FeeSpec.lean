import Lovejoin.Template.FeeContract
import Blaster

/-! Negative controls for fee_contract's template (`Lovejoin.Template.FeeContract`), whose five
theorems are all failures. Every check is expected Falsified: **this module must print
8 "✅ Expected Falsified" lines**, cheapest first.

- [G-V1] Vacuity: `shard_pays_exactly_the_fee`'s hypothesis can hold.
- [G-P1] A shard paying a Mix's fee can pass. Its scenario is `shard_needs_three_boxes`',
  `shard_pays_no_withdrawal`'s and `shard_needs_mix_logic`'s with one thing changed (two boxes,
  the Owner redeemer, no mix_logic redeemer), so it is their passing run too.
- [G-P2] A replenishment can pass.
- [G-H1] `shard_pays_exactly_the_fee` with `f ≥ cap` for `f > cap`: a fee equal to the cap is
  allowed. A Valid one would mean the cap's bound isn't where the script puts it.
- [G-H2] … with `fi - fo ≠ f + 1`: a hypothesis the script doesn't check.
- [G-H3] `shard_only_grows` with `fo ≤ fi + 1`: growing by one lovelace is allowed.
- [G-F1..2] `shard_pays_exactly_the_fee` and `shard_only_grows` concluding `isSuccessful`. -/

namespace Audit.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

-- [G-V1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (cap fi fo f : Integer),
  (fi - fo ≠ f ∨ f > cap) → False]

-- [G-P1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  ¬ isSuccessful (appliedFeePay.prop P cap fi fo f)]

-- [G-P2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (fi fo : Integer),
  ¬ isSuccessful (appliedFeeReplenish.prop P fi fo)]

-- [G-H1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  (fi - fo ≠ f ∨ f ≥ cap) → isUnsuccessful (appliedFeePay.prop P cap fi fo f)]

-- [G-H2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  (fi - fo ≠ f + 1 ∨ f > cap) → isUnsuccessful (appliedFeePay.prop P cap fi fo f)]

-- [G-H3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (fi fo : Integer),
  fo ≤ fi + 1 → isUnsuccessful (appliedFeeReplenish.prop P fi fo)]

-- [G-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  (fi - fo ≠ f ∨ f > cap) → isSuccessful (appliedFeePay.prop P cap fi fo f)]

-- [G-F2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (fi fo : Integer),
  fo ≤ fi → isSuccessful (appliedFeeReplenish.prop P fi fo)]

end Audit.Template
