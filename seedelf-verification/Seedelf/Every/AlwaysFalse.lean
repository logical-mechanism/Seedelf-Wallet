import Seedelf.Every.Base

/-! # always_false (6777ba4d…) on any argument

It reads three fields off its argument, which errors on anything shorter, then reaches `ERROR`
whatever they hold. Kernel-checked, any `Data` at all, no step limit. -/

namespace Seedelf.Every
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-- always_false as deployed, its seed applied. -/
def afBody : Term := match alwaysFalse.script with | .Program _ b => b

set_option maxHeartbeats 0

theorem always_false_root (d : Data) : Ev default (applyParams afBody [toTerm d]) [] none := by
  rcases d with ⟨t, _ | ⟨a, _ | ⟨b, _ | ⟨c, rest⟩⟩⟩⟩ | _ | _ | _ | _ <;> w_go [] []

/-- **always_false, any argument:** the deployed program reaches `Error`, and halts for no fuel. -/
theorem always_false_errors (d : Data) :
    (∃ m, cekExecuteProgram alwaysFalse.script [toTerm d] m = .Error) ∧
      ∀ n V, cekExecuteProgram alwaysFalse.script [toTerm d] n ≠ .Halt V := by
  obtain ⟨m, hm⟩ := exec_error_of_ev (always_false_root d)
  exact ⟨⟨m, hm⟩, fun n V => exec_never_halts hm n V⟩

end Seedelf.Every

/-- info: 'Seedelf.Every.always_false_errors' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Seedelf.Every.always_false_errors
