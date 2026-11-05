import Seedelf.Scripts
import Seedelf.AnyTx
import Seedelf.AnyTxSteps
import Blaster

/-! always_false (6777ba4d…) on every input there is: its one argument, the context, is any
`Data` at all, every V3 context included. It holds the reference scripts, so none of them can
be spent. 500 steps, as AlwaysFalse. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyContextArgs (ctx : Data) : List Term := [toTerm ctx]

#prep_uplc appliedAlwaysFalseAnyContext alwaysFalse anyContextArgs 500

-- Its own run at its own limit: a valid Seedelf spend's context, and a value that isn't one.
#guard endsInError (appliedAlwaysFalseAnyContext.exec (busySpend z0 [.B vkh0]))
#guard endsInError (appliedAlwaysFalseAnyContext.exec (.I 0))

/-- Whatever it's given, it reaches `Error`. -/
theorem always_false_fails_on_any_context :
  ∀ (ctx : Data), isUnsuccessful (appliedAlwaysFalseAnyContext.prop ctx) := by blaster

end Seedelf.V1
