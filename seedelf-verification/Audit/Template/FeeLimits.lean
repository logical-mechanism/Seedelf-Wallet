import Lovejoin.Template.FeeContract
import Blaster

/-! fee_contract's template on its own argument functions with the step limit one below the runs
`Lovejoin.Template.Steps` measures at the 5 ₳ pool's NFT. Each is expected Falsified: **this
module must print 3 "✅ Expected Falsified" lines**.

- [G-L1] A Mix's exact fee within the cap, at 4392 (it halts after 4393).
- [G-L2] `shard_pays_exactly_the_fee` at 4319 (a lovelace short errors after 4320): cut off
  isn't `Error`.
- [G-L3] A replenishment that grows, at 2932 (it halts after 2933). -/

namespace Audit.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc auditTemplateFeePayAt4392 feeContractTemplate Lovejoin.Template.feePayArgs 4392
#prep_uplc auditTemplateFeePayAt4319 feeContractTemplate Lovejoin.Template.feePayArgs 4319
#prep_uplc auditTemplateFeeReplenishAt2932 feeContractTemplate Lovejoin.Template.feeReplenishArgs 2932

-- [G-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  P ≠ "" → fi - fo = f → f ≤ cap → isSuccessful (auditTemplateFeePayAt4392.prop P cap fi fo f)]

-- [G-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (cap fi fo f : Integer),
  (fi - fo ≠ f ∨ f > cap) → isUnsuccessful (auditTemplateFeePayAt4319.prop P cap fi fo f)]

-- [G-L3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (P : ByteString) (fi fo : Integer),
  P ≠ "" → fi < fo → isSuccessful (auditTemplateFeeReplenishAt2932.prop P fi fo)]

end Audit.Template
