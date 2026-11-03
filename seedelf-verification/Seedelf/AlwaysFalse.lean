import Seedelf.Scripts
import Seedelf.Scenario
import Blaster

/-! always_false (6777ba4d…): whatever it's given, it fails. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- Any purpose and any redeemer, in an empty transaction. -/
def anyPurposeArgs (redeemer : Data) (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, redeemer, info⟩ : ScriptContext)]

#prep_uplc appliedAlwaysFalse alwaysFalse anyPurposeArgs 500

/-- Reaches `Error`: a run cut off by the step limit wouldn't count. -/
theorem always_false_always_fails :
  ∀ (redeemer : Data) (info : ScriptInfo),
    isUnsuccessful (appliedAlwaysFalse.prop redeemer info) := by blaster

end Seedelf.V1
