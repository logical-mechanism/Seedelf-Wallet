import PlutusCore.UPLC

/-! Shared by the Classic and Template audit modules: predicates on a run's final `State`.

`isSuccessful` is any halt (`PlutusCore.UPLC.Utils`): a closure or a `False` constant counts.
The ledger accepts a Plutus V3 script only when it returns the unit constant, so
`HaltsWithUnit` is what a "succeeds" should mean on chain. Both read the state through a match,
never as a whole `State` (README rule 6). The `…B` versions are `Bool`s for `#guard`, which
runs the computable `NAME.exec` with the builtins' own implementations.

This module has no checks. -/

namespace Audit.Classic
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.Term (Const)

/-- The run halted with the unit constant. -/
def HaltsWithUnit (s : State) : Prop :=
  match s with
  | .Halt (.VCon .Unit) => True
  | _ => False

/-- For `#guard`: halted with the unit constant. -/
def haltedUnitB (s : State) : Bool :=
  match s with
  | .Halt (.VCon .Unit) => true
  | _ => false

/-- For `#guard`: reached `Error` (a rejection, not a run cut off at the step limit). -/
def erroredB (s : State) : Bool :=
  match s with
  | .Error => true
  | _ => false

end Audit.Classic
