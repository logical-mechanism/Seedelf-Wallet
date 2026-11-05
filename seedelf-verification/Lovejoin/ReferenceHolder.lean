import Lovejoin.Scripts
import Seedelf.Scenario
import Blaster

/-! reference_holder (288fea77…): whatever it's given, it fails, so the pool's NFT and
its `ReferenceDatum` never leave it. The same script is every pool's: it takes no
parameters. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (emptyTx)

/-- Any purpose and any redeemer, in an empty transaction. -/
def anyPurposeArgs (redeemer : Data) (info : ScriptInfo) : List Term :=
  [toTerm (⟨emptyTx, redeemer, info⟩ : ScriptContext)]

#prep_uplc appliedReferenceHolder referenceHolder anyPurposeArgs 500

/-- Reaches `Error`: a run cut off by the step limit wouldn't count. -/
theorem reference_holder_always_fails :
  ∀ (redeemer : Data) (info : ScriptInfo),
    isUnsuccessful (appliedReferenceHolder.prop redeemer info) := by blaster

end Lovejoin.Classic
