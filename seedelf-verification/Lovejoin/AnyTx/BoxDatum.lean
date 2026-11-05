import Lovejoin.AnyTx.Common
import Blaster

/-! Inline datum shape coverage for mix_box when its own input is second and there
are no withdrawals. The inline payload is arbitrary Data, not just two byte strings. -/

namespace Lovejoin.AnyTx.BoxDatum
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx

def args (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs datum : Data) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r
    (.List [priorIn p po, ownBox ref addr v (.Constr 2 [datum]) rs])
    (.Map []) sigs red ref rd)]

#prep_uplc boxInlineAny mixBoxTemplate args 3000

/-- With no withdrawals an inline datum is recoverable exactly when it is not a box. -/
theorem inline_iff_not_box (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs datum : Data) :
    p ≠ ref → (returnsUnit (boxInlineAny.prop L r sigs red ref rd p po addr v rs datum) ↔
      isBoxDatum datum = false) := by blaster

end Lovejoin.AnyTx.BoxDatum
