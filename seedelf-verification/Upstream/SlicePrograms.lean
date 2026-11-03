import PlutusCore.UPLC

/-! The slice-scaling programs (`uplc/`): slice a bytestring argument to K
bytes, then count a loop down from 40 and return the slice's length. The
concrete runs cost the same for every K (`aiken uplc eval`: 95,976 memory
units), so what `#prep_uplc` spends beyond `noslice` comes from the symbolic
slice. -/

namespace Upstream
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Const Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

#import_uplc noslice PlutusV3 textual "Upstream/uplc/noslice.uplc"
#import_uplc slice1 PlutusV3 textual "Upstream/uplc/slice1.uplc"
#import_uplc slice4 PlutusV3 textual "Upstream/uplc/slice4.uplc"
#import_uplc slice16 PlutusV3 textual "Upstream/uplc/slice16.uplc"
#import_uplc slice32 PlutusV3 textual "Upstream/uplc/slice32.uplc"

def bsArg (bs : ByteString) : List Term := [Term.Const (Const.ByteString bs)]

/-- Steps until the run halts or fails, or where it stood after `fuel`. -/
def stepsOf (s : PlutusScript) (args : List Term) (fuel : Nat := 20000) : String :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → Nat → String
      | 0, _, n => s!"exhausted at {n}"
      | k + 1, st, n =>
        match st with
        | .Halt _ => s!"halt after {n}"
        | .Error => s!"error after {n}"
        | _ => go k (step default st) (n + 1)
    go fuel (initialState (applyParams body args)) 0

def thirtySix : ByteString := ⟨String.mk ((List.range 36).map fun i => Char.ofNat (i + 1))⟩

#eval s!"noslice: {stepsOf noslice (bsArg thirtySix)}"
#eval s!"slice32: {stepsOf slice32 (bsArg thirtySix)}"

end Upstream
