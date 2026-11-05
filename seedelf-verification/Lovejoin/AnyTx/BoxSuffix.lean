import Lovejoin.AnyTx.Common
import Blaster

/-! A spend whose matching input is second and whose matching withdrawal is second.
Both lists may contain arbitrary trailing entries, which the validator need not inspect. -/

namespace Lovejoin.AnyTx.BoxSuffix
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx

def args (L a b c : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs amount1 amount2 : Data)
    (ins : List Data) (wdrl : List (Data × Data)) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r
    (.List (priorIn p po :: ownBox ref addr v (.Constr 2 [.Constr 0 [.B a, .B b]]) rs :: ins))
    (.Map ((.Constr 1 [.B c], amount1) :: (logicKey L, amount2) :: wdrl)) sigs red ref rd)]

def noWithdrawalsArgs (L : ByteString) (r : TxRest)
    (sigs red ref rd p po addr v rs datum : Data) (ins : List Data) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r
    (.List (priorIn p po :: ownBox ref addr v (.Constr 2 [datum]) rs :: ins))
    (.Map []) sigs red ref rd)]

def twoOthersArgs (L a b c d : ByteString) (r : TxRest)
    (sigs red ref rd p po addr v rs n m : Data) (ins : List Data) : List Term :=
  [toTerm L, toTerm (boxSpendCtx r
    (.List (priorIn p po :: ownBox ref addr v (.Constr 2 [.Constr 0 [.B a, .B b]]) rs :: ins))
    (.Map [(.Constr 0 [.B c], n), (.Constr 1 [.B d], m)]) sigs red ref rd)]

#prep_uplc boxSuffixAfter mixBoxTemplate args 4000
#prep_uplc boxNoWithdrawals mixBoxTemplate noWithdrawalsArgs 4000
#prep_uplc boxTwoOthers mixBoxTemplate twoOthersArgs 4000

/-- A different script's withdrawal and an unrelated input cannot hide the two matches. -/
theorem matches_after_other_entries (L a b c : ByteString) (r : TxRest)
    (sigs red ref rd p po addr v rs amount1 amount2 : Data)
    (ins : List Data) (wdrl : List (Data × Data)) :
    p ≠ ref → c ≠ L → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    returnsUnit (boxSuffixAfter.prop L a b c r sigs red ref rd p po addr v rs amount1 amount2 ins wdrl) := by blaster

/-- Any inline datum, with arbitrary later inputs, is recoverable iff it is not a box. -/
theorem inline_no_withdrawals (L : ByteString) (r : TxRest)
    (sigs red ref rd p po addr v rs datum : Data) (ins : List Data) :
    p ≠ ref → (returnsUnit (boxNoWithdrawals.prop L r sigs red ref rd p po addr v rs datum ins) ↔
      isBoxDatum datum = false) := by blaster

/-- A key and a different script credential cannot authorize a valid box. -/
theorem two_other_withdrawals (L a b c d : ByteString) (r : TxRest)
    (sigs red ref rd p po addr v rs n m : Data) (ins : List Data) :
    p ≠ ref → d ≠ L → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (boxTwoOthers.prop L a b c d r sigs red ref rd p po addr v rs n m ins) := by blaster

end Lovejoin.AnyTx.BoxSuffix
