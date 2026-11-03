import Lovejoin.Template.Scripts
import Lovejoin.Steps

/-! How many steps Blaster's CEK machine takes on concrete runs of mix_box's template, to
size the template modules' limits (see `Seedelf.Steps`). At the classic L, each line must
end as `Lovejoin.Steps`' mix_box line does, the template taking a step or two more for
its parameter. At v2's test launch L (`6666…`), a well-formed box moves with that L's
withdrawal and not with the classic one's. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)
open Lovejoin.Classic (inlineBoxCtx spendBoxCtx mixDatum mixLogicHash notG1)
open Seedelf.V1 (g1)

/-- `Seedelf.V1.stepsUsed` with the script's parameters applied before the context. -/
def stepsWith (s : PlutusScript) (params : List Term) (ctx : ScriptContext) (fuel : Nat := 20000) : String :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → Nat → String
      | 0, _, n => s!"exhausted at {n}"
      | k + 1, st, n =>
        match st with
        | .Halt _ => s!"halt after {n}"
        | .Error => s!"error after {n}"
        | _ => go k (step default st) (n + 1)
    go fuel (initialState (applyParams body (params ++ [toTerm ctx]))) 0

def v2L : ByteString := Seedelf.V1.ofHex "66666666666666666666666666666666666666666666666666666666"

def atClassic := [toTerm mixLogicHash]
def atV2 := [toTerm v2L]

#eval s!"template, classic L, minting purpose:  {stepsWith mixBoxTemplate atClassic ⟨Seedelf.V1.emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"template, classic L, well-formed, none:  {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [])}"
#eval s!"template, classic L, well-formed, logic: {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"
#eval s!"template, classic L, well-formed, other: {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential "o", 0)])}"
#eval s!"template, classic L, a = b:              {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 g1) [])}"
#eval s!"template, classic L, no datum:           {stepsWith mixBoxTemplate atClassic (spendBoxCtx .NoOutputDatum none [])}"
#eval s!"template, v2 L, well-formed, v2's:       {stepsWith mixBoxTemplate atV2 (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential v2L, 0)])}"
#eval s!"template, v2 L, well-formed, classic's:  {stepsWith mixBoxTemplate atV2 (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"

end Lovejoin.Template
