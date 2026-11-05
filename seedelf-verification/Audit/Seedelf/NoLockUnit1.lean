import Seedelf.WalletNoLock
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletNoLock's unit results (1 of 2). `spendable_*` says each run halts; the
ledger accepts a V3 script only if it returns unit, so a halt with any other value would be a lock.
Each theorem here is the same shape returning unit. All nine must be Valid. Over the existing
`#prep_uplc`s; each costs about what its `spendable_*` did. -/

namespace SeedelfAudit
open PlutusCore.UPLC.Utils
open Seedelf.V1

theorem audit_unit_no_datum : ∀ z gr vkh s, haltsWithUnit (appliedNoDatum.prop z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_bytes : ∀ b z gr vkh s, haltsWithUnit (appliedBytes.prop b z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_int : ∀ i z gr vkh s, haltsWithUnit (appliedInt.prop i z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_list : ∀ l z gr vkh s, haltsWithUnit (appliedList.prop l z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_map : ∀ m z gr vkh s, haltsWithUnit (appliedMap.prop m z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_constr_pos : ∀ n fs z gr vkh s, haltsWithUnit (appliedConstrPos.prop n fs z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_constr_neg : ∀ n fs z gr vkh s, haltsWithUnit (appliedConstrNeg.prop n fs z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_fields0 : ∀ z gr vkh s, haltsWithUnit (appliedFields0.prop z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_fields1 : ∀ x z gr vkh s, haltsWithUnit (appliedFields1.prop x z gr vkh s) := by blaster (timeout: 540)

end SeedelfAudit
