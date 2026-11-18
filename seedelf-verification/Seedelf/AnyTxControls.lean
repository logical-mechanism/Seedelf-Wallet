import Seedelf.AlwaysFalseAnyTx
import Seedelf.WalletPurposeAnyTx
import Seedelf.WalletNoLockAnyTx
import Seedelf.WalletRedeemerAnyTx
import Blaster

/-! Negative controls for always_false's and the wallet's other families in every transaction
(`AlwaysFalseAnyTx`, `WalletPurposeAnyTx`, `WalletNoLockAnyTx`, `WalletRedeemerAnyTx`), each
expected Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid"
and fails the build. Each is one of its family's theorems with the outcome turned around, over the
family's own builder, so the solver meets the same script as the theorems do. Were that background
contradictory (Lean-blaster #194), every statement over it would come back Valid, these too.
- always_false, said to return unit on every argument: it errors.
- The wallet on a minting purpose, said to return unit: it errors.
- A UTxO with no datum, said to reach `Error`: it returns unit.
- A proof whose third field is an integer, said to return unit: it errors. -/

namespace Seedelf.V1
open PlutusCore.UPLC.Utils

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ ctx, returnsUnit (appliedAlwaysFalseAnyContext.prop ctx)]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ info redeemer fs, returnsUnit (appliedAnyTxMinting.prop info redeemer fs)]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ info ref z gr vkh, isUnsuccessful (appliedAnyTxNoDatum.prop info ref z gr vkh)]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ a b i info ref d, returnsUnit (appliedAnyRedeemerThirdI.prop a b i info ref d)]

end Seedelf.V1
