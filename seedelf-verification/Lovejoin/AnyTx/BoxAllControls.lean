import Lovejoin.AnyTx.BoxPurposesAll
import Lovejoin.Template.AnyTxPurposes

/-! Concrete controls for long searches. These exercise the evaluator separately
from the proofs and do not impose a bound on the general theorems. -/
namespace Lovejoin.AnyTx.BoxAllControls
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1)
open Lovejoin.AnyTx
open Lovejoin.Template.AnyTx (endWith)

private def rest : TxRest :=
  ⟨.I 1, .I 2, .I 3, .I 4, .I 5, .I 6, .I 7, .I 8, .I 9, .I 10, .I 11, .I 12, .I 13, .I 14, .I 15⟩
private def ref : Data := refAt 0
private def prefixes : List Data := List.replicate 25 (priorIn (refAt 1) (.I 123))
private def withdrawals : List (Data × Data) := List.replicate 25 (.Constr 0 [.B testL], .I 9)
private def run (ins : List Data) (wdrl : List (Data × Data)) : String :=
  endWith mixBoxTemplate [toTerm testL]
    (boxSpendCtx rest (.List ins) (.Map wdrl) (.I 42) (.I 17) ref (.Constr 0 [.I 99])) 100000
private def box (datum : Data) : Data := ownBox ref (.I 1) (.I 2) (.Constr 2 [datum]) (.I 3)
private def validDatum : Data := .Constr 0 [.B g1, .B otherPoint]

#guard run (prefixes ++ [box validDatum]) (withdrawals ++ [(logicKey testL, .I 0)]) == "unit"
#guard run (prefixes ++ [box validDatum]) withdrawals == "error"
#guard run (prefixes ++ [box (.Constr 0 [.B g1, .B g1])]) withdrawals == "unit"
#guard run prefixes (withdrawals ++ [(logicKey testL, .I 0)]) == "error"

end Lovejoin.AnyTx.BoxAllControls
