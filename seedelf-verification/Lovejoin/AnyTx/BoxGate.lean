import Lovejoin.AnyTx.Common
import Blaster

/-! mix_box's spend gate with arbitrary transaction fields. These cases locate the spent
input after one unrelated input; they exercise empty withdrawals and withdrawals before
and at the mix_logic credential. Fields read by the search have the displayed shapes.
This is not a cover of every possible input or withdrawal list. -/

namespace Lovejoin.AnyTx.BoxGate
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx

def ctx (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b : ByteString) (wdrl : Data) : Data :=
  boxSpendCtx r (.List [priorIn p po, ownBox ref addr v (.Constr 2 [.Constr 0 [.B a, .B b]]) rs])
    wdrl sigs red ref rd

def noneArgs (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b : ByteString) : List Term :=
  [toTerm L, toTerm (ctx r sigs red ref rd p po addr v rs a b (.Map []))]

def otherArgs (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b c : ByteString) (amount : Data) : List Term :=
  [toTerm L, toTerm (ctx r sigs red ref rd p po addr v rs a b
    (.Map [(.Constr 1 [.B c], amount)]))]

def logicAfterArgs (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b c : ByteString) (amount1 amount2 : Data) : List Term :=
  [toTerm L, toTerm (ctx r sigs red ref rd p po addr v rs a b
    (.Map [(.Constr 0 [.B c], amount1), (logicKey L, amount2)]))]

#prep_uplc boxNone mixBoxTemplate noneArgs 3000
#prep_uplc boxOther mixBoxTemplate otherArgs 3000
#prep_uplc boxLogicAfter mixBoxTemplate logicAfterArgs 3000

/-- A well-formed inline box fails without a withdrawal, regardless of the other fields. -/
theorem no_withdrawal (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b : ByteString) :
    p ≠ ref → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (boxNone.prop L r sigs red ref rd p po addr v rs a b) := by blaster

/-- A different script credential does not authorize the box. -/
theorem wrong_script (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b c : ByteString) (amount : Data) :
    p ≠ ref → c ≠ L → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    isUnsuccessful (boxOther.prop L r sigs red ref rd p po addr v rs a b c amount) := by blaster

/-- A preceding key withdrawal does not hide mix_logic's withdrawal. -/
theorem logic_after_key (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b c : ByteString) (amount1 amount2 : Data) :
    p ≠ ref → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    returnsUnit (boxLogicAfter.prop L r sigs red ref rd p po addr v rs a b c amount1 amount2) := by blaster

/-- With no withdrawals, the gate accepts precisely malformed point pairs. -/
theorem no_withdrawal_iff_malformed (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b : ByteString) :
    p ≠ ref → (returnsUnit (boxNone.prop L r sigs red ref rd p po addr v rs a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b)) := by blaster

/-- A script credential equal to L is enough, for any withdrawal amount. -/
theorem matching_script (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data)
    (a b : ByteString) (amount : Data) :
    p ≠ ref → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
    returnsUnit (boxOther.prop L r sigs red ref rd p po addr v rs a b L amount) := by blaster

end Lovejoin.AnyTx.BoxGate
