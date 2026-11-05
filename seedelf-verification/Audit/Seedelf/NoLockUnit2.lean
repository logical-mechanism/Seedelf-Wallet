import Seedelf.WalletNoLock
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, WalletNoLock's unit results (2 of 2). As NoLockUnit1. All nine must be Valid. -/

namespace SeedelfAudit
open PlutusCore.UPLC.Utils
open Seedelf.V1

theorem audit_unit_fields3 : ∀ x y w rest z gr vkh s, haltsWithUnit (appliedFields3.prop x y w rest z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_first_constr : ∀ k fs y z gr vkh s, haltsWithUnit (appliedFirstConstr.prop k fs y z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_first_map : ∀ m y z gr vkh s, haltsWithUnit (appliedFirstMap.prop m y z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_first_list : ∀ l y z gr vkh s, haltsWithUnit (appliedFirstList.prop l y z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_first_i : ∀ i y z gr vkh s, haltsWithUnit (appliedFirstI.prop i y z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_second_constr : ∀ g k fs z gr vkh s, haltsWithUnit (appliedSecondConstr.prop g k fs z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_second_map : ∀ g m z gr vkh s, haltsWithUnit (appliedSecondMap.prop g m z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_second_list : ∀ g l z gr vkh s, haltsWithUnit (appliedSecondList.prop g l z gr vkh s) := by blaster (timeout: 540)
theorem audit_unit_second_i : ∀ g i z gr vkh s, haltsWithUnit (appliedSecondI.prop g i z gr vkh s) := by blaster (timeout: 540)

end SeedelfAudit
