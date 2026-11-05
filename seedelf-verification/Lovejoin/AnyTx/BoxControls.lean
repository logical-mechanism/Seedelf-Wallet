import Lovejoin.AnyTx.BoxGate
import Lovejoin.AnyTx.BoxBoundary
import Lovejoin.AnyTx.BoxSuffix
import Lovejoin.Template.AnyTxPurposes

/-! Concrete CEK controls for the generalized mix_box scenarios. The surrounding fields
are intentionally varied, and the success and failure runs differ in the gate condition. -/

namespace Lovejoin.AnyTx.BoxControls
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1)
open Lovejoin.AnyTx
open Lovejoin.Template.AnyTx (endWith)

private def rest : TxRest :=
  ⟨.I 1, .I 2, .I 3, .I 4, .I 5, .I 6, .I 7, .I 8, .I 9, .I 10, .I 11, .I 12, .I 13, .I 14, .I 15⟩
private def ref : Data := refAt 0
private def prior : Data := refAt 1
private def boxDatum : Data := .Constr 2 [.Constr 0 [.B g1, .B otherPoint]]
private def noDatum : Data := .Constr 0 []
private def datumHash : Data := .Constr 1 [.B "hash"]
private def run (ins wdrl : Data) : String :=
  endWith mixBoxTemplate [toTerm testL]
    (boxSpendCtx rest ins wdrl (.I 42) (.I 17) ref (.Constr 0 [.I 99]))
private def entries (datum : Data) : Data :=
  .List [priorIn prior (.I 123), ownBox ref (.I 1) (.I 2) datum (.I 3)]

#guard run (entries boxDatum) (.Map []) == "error"
#guard run (entries boxDatum) (.Map [(logicKey testL, .I 0)]) == "unit"
#guard run (entries boxDatum) (.Map [(.Constr 1 [.B testP], .I 0)]) == "error"
#guard run (entries (.Constr 2 [.Constr 0 [.B g1, .B g1]])) (.Map []) == "unit"
#guard run (entries (.Constr 2 [.Constr 0 [.B "short", .B otherPoint]])) (.Map []) == "unit"
#guard run (entries (.Constr 2 [.Constr 1 [.B g1, .B otherPoint]])) (.Map []) == "unit"
#guard run (entries (.Constr 2 [.Constr 0 [.B g1, .B otherPoint, .I 0]])) (.Map []) == "unit"
#guard run (entries noDatum) (.Map []) == "unit"
#guard run (entries datumHash) (.Map []) == "unit"
#guard run (.List [priorIn prior (.I 123)]) (.Map [(logicKey testL, .I 0)]) == "error"
#guard run (entries boxDatum) (.Map [(.Constr 0 [.B testKey], .I 9), (logicKey testL, .I 0)]) == "unit"

end Lovejoin.AnyTx.BoxControls
