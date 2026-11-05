import Lovejoin.Template.FeeContract
import Lovejoin.Template.Steps
import Audit.Template.MutantScripts
import Audit.Classic.Common
import Blaster

/-! Mutation tests for fee_contract's template: two mutants, each missing one check
(`Audit.Template.MutantScripts`), on the theorems' own argument functions. Each mutant should
kill the theorem about its check and only that one. Expected: 2 `#guard`s pass,
**2 "✅ Expected Falsified" lines and 2 "✅ Valid" lines**.

- [G-M0a..b] Concretely, at the 5 ₳ pool's NFT: the no-cap mutant pays an exact 1.2 ₳ fee above
  the 1 ₳ cap, and the two-boxes mutant pays a two-box Mix's fee; the template refuses both
  (`Audit.Template.FeeConcrete`).
- [G-M1] `shard_pays_exactly_the_fee` on the no-cap mutant. Valid would mean the theorem can't
  see the cap: a shard drained by an oversized fee would pass unnoticed.
- [G-M2] `shard_needs_three_boxes` on the two-boxes mutant. Valid would mean the theorem can't
  see the three-box floor.
- `audit_shard_needs_three_boxes_without_the_cap`, `audit_shard_pays_exactly_with_two_boxes_allowed`:
  each mutant still satisfies the other theorem. -/

namespace Audit.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (haltedUnitB)
open Lovejoin.Template (pool5Policy)

#prep_uplc auditTemplateFeePayNoCap auditTemplateFeeNoCap Lovejoin.Template.feePayArgs 8000
#prep_uplc auditTemplateFeeTwoBoxesNoCap auditTemplateFeeNoCap Lovejoin.Template.feeTwoBoxesArgs 8000
#prep_uplc auditTemplateFeeTwoBoxesTwo auditTemplateFeeTwoBoxes Lovejoin.Template.feeTwoBoxesArgs 8000
#prep_uplc auditTemplateFeePayTwo auditTemplateFeeTwoBoxes Lovejoin.Template.feePayArgs 8000

-- [G-M0a]
#guard haltedUnitB (auditTemplateFeePayNoCap.exec pool5Policy 1000000 6000000 4800000 1200000)
-- [G-M0b]
#guard haltedUnitB (auditTemplateFeeTwoBoxesTwo.exec pool5Policy 1000000 5000000 4200000 800000)

-- [G-M1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  (fi - fo ≠ f ∨ f > cap) → isUnsuccessful (auditTemplateFeePayNoCap.prop P cap fi fo f)]

-- [G-M2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  isUnsuccessful (auditTemplateFeeTwoBoxesTwo.prop P cap fi fo f)]

theorem audit_shard_needs_three_boxes_without_the_cap : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (auditTemplateFeeTwoBoxesNoCap.prop P cap fi fo f) := by
  blaster (timeout: 540)

theorem audit_shard_pays_exactly_with_two_boxes_allowed : ∀ (P : ByteString) (cap fi fo f : Integer),
    (fi - fo ≠ f ∨ f > cap) → isUnsuccessful (auditTemplateFeePayTwo.prop P cap fi fo f) := by
  blaster (timeout: 540)

end Audit.Template
