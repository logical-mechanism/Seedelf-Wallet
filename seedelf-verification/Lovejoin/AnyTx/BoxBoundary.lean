import Lovejoin.AnyTx.Common
import Blaster

/-! Boundary cases of mix_box's own-input search and inline datum gate. The transaction
fields outside the searched inputs and withdrawals are arbitrary Data. The two-input
cases put one unrelated input before the spend; the suffix case has arbitrary trailing
inputs and withdrawals after the matching entries. -/

namespace Lovejoin.AnyTx.BoxBoundary
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx

def missingArgs (L : ByteString) (r : TxRest) (sigs red ref rd p po q qo wdrl : Data) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r (.List [priorIn p po, priorIn q qo]) wdrl sigs red ref rd)]

def datumArgs (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v od rs wdrl : Data) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r (.List [priorIn p po, ownBox ref addr v od rs]) wdrl sigs red ref rd)]

def suffixArgs (L a b : ByteString) (r : TxRest) (sigs red ref rd addr v rs amount : Data)
    (ins : List Data) (wdrl : List (Data × Data)) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r
    (.List (ownBox ref addr v (.Constr 2 [.Constr 0 [.B a, .B b]]) rs :: ins))
    (.Map ((logicKey L, amount) :: wdrl)) sigs red ref rd)]

#prep_uplc boxMissing mixBoxTemplate missingArgs 3000
#prep_uplc boxDatum mixBoxTemplate datumArgs 3000
#prep_uplc boxSuffix mixBoxTemplate suffixArgs 3000

/-- A context that does not contain the input being spent fails closed. -/
theorem missing_input (L : ByteString) (r : TxRest) (sigs red ref rd p po q qo wdrl : Data) :
    p ≠ ref → q ≠ ref → isUnsuccessful (boxMissing.prop L r sigs red ref rd p po q qo wdrl) := by blaster

/-- A no-datum input is recoverable, independent of the resolved datum and withdrawals. -/
theorem no_datum_recovery (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs wdrl : Data) :
    p ≠ ref → returnsUnit (boxDatum.prop L r sigs red ref rd p po addr v (.Constr 0 []) rs wdrl) := by blaster

/-- A datum hash is recoverable even if the resolved datum appears to be a box. -/
theorem datum_hash_recovery (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs wdrl hash : Data) :
    p ≠ ref → returnsUnit (boxDatum.prop L r sigs red ref rd p po addr v (.Constr 1 [hash]) rs wdrl) := by blaster

/-- Once both matches are found, arbitrary trailing inputs and withdrawals do not change the gate. -/
theorem matching_heads (L a b : ByteString) (r : TxRest) (sigs red ref rd addr v rs amount : Data)
    (ins : List Data) (wdrl : List (Data × Data)) :
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    returnsUnit (boxSuffix.prop L a b r sigs red ref rd addr v rs amount ins wdrl) := by blaster

end Lovejoin.AnyTx.BoxBoundary
