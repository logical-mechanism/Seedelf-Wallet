import Lovejoin.Template.FeeContract
import Audit.Classic.Common
import Blaster

/-! Gaps in fee_contract's template theorems, closed for their scenarios. Theorems, expected
Valid: **this module must print 5 "✅ Valid" lines** and build.

- `audit_shard_pay_runs_end`, `audit_shard_replenish_runs_end`: every run ends within 8000 steps,
  so `Audit.Template.FeeIff`'s iffs hold for every input.
- `audit_shard_pay_halts_with_unit`, `audit_shard_replenish_halts_with_unit`: every halt is unit.
- `audit_shard_pays_exactly_on_exec`: `shard_pays_exactly_the_fee` over `appliedFeePay.exec`. -/

namespace Audit.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)

theorem audit_shard_pay_runs_end : ∀ (P : ByteString) (cap fi fo f : Integer),
    isSuccessful (appliedFeePay.prop P cap fi fo f) ∨ isUnsuccessful (appliedFeePay.prop P cap fi fo f) := by
  blaster (timeout: 540)

theorem audit_shard_replenish_runs_end : ∀ (P : ByteString) (fi fo : Integer),
    isSuccessful (appliedFeeReplenish.prop P fi fo) ∨ isUnsuccessful (appliedFeeReplenish.prop P fi fo) := by
  blaster (timeout: 540)

theorem audit_shard_pay_halts_with_unit : ∀ (P : ByteString) (cap fi fo f : Integer),
    isSuccessful (appliedFeePay.prop P cap fi fo f) → HaltsWithUnit (appliedFeePay.prop P cap fi fo f) := by
  blaster (timeout: 540)

theorem audit_shard_replenish_halts_with_unit : ∀ (P : ByteString) (fi fo : Integer),
    isSuccessful (appliedFeeReplenish.prop P fi fo) → HaltsWithUnit (appliedFeeReplenish.prop P fi fo) := by
  blaster (timeout: 540)

theorem audit_shard_pays_exactly_on_exec : ∀ (P : ByteString) (cap fi fo f : Integer),
    (fi - fo ≠ f ∨ f > cap) → isUnsuccessful (appliedFeePay.exec P cap fi fo f) := by
  blaster (timeout: 540)

end Audit.Template
