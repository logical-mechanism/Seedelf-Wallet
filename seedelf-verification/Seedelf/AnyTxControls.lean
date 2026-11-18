import Seedelf.AlwaysFalseAnyTx
import Seedelf.WalletPurposeAnyTx
import Seedelf.WalletNoLockAnyTx
import Seedelf.WalletRedeemerAnyTx
import Blaster

/-! Negative controls for always_false's and the wallet's other families in every transaction
(`AlwaysFalseAnyTx`, `WalletPurposeAnyTx`, `WalletNoLockAnyTx`, `WalletRedeemerAnyTx`), each
expected Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid"
and fails the build. Each is one of its family's theorems with the outcome turned around, over the
same builder as that theorem. A control probes the one builder it names: each Blaster goal is its
own query, so the family's other builders go unprobed (one of the purpose's 5, of NoLock's 18 and
of the redeemer's 22 has one). Were that builder's background contradictory (Lean-blaster #194),
every statement over it would come back Valid, the control too.
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
