import Lovejoin.Template.Steps
import Blaster

/-! Audit (templates), not part of the suite: mix_box's gate when the box isn't the
transaction's only input. In every `Template.MixBoxGate` and `MixBoxNoLock` scenario the
box is the only input, so `list.find(self.inputs, fn(input) { input.output_reference == utxo })`
is never exercised: a script reading the first or the last input's datum passes all 29.
Audit finding F-2 rests on that lookup. Here a well-formed box sits beside a key input with
no datum (Rule 2's "moves" shape), first or second, and still needs L's withdrawal.

Built in place as `Audit.Gaps.Template.AuditGateInputs`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.AuditGateInputs`. Expected: four `✅ Valid`,
and the `#eval`s as written beside them. -/

namespace Lovejoin.Template.AuditGateInputs
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template
open Lovejoin.Classic (box mixDatum notG1)
open Seedelf.V1 (g1)

def boxRefB : TxOutRef := ⟨"b", 0⟩
/-- A key's input with no datum, at `ref`. -/
def keyInput (ref : TxOutRef) : TxInInfo :=
  ⟨ref, ⟨⟨.PubKeyCredential "k", none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 5000000)])], .NoOutputDatum, none⟩⟩

/-- Spending the box at `boxRefB`, its datum `MixDatum (a, b)` inline, beside a key input
before it (`keyFirst`) or after it. -/
def twoInputCtx (keyFirst : Bool) (a b : ByteString) (wdrl : Withdrawals) : ScriptContext :=
  let own : TxInInfo := ⟨boxRefB, box (.OutputDatum (mixDatum a b))⟩
  let ins := if keyFirst then [keyInput ⟨"a", 0⟩, own] else [own, keyInput ⟨"c", 0⟩]
  ⟨{ Seedelf.V1.emptyTx with txInfoInputs := ins, txInfoWdrl := wdrl }, Data.Constr 0 [],
   .SpendingScript boxRefB (some (mixDatum a b))⟩

def keyFirstNoneArgs (L a b : ByteString) : List Term := [toTerm L, toTerm (twoInputCtx true a b [])]
def keyLastNoneArgs (L a b : ByteString) : List Term := [toTerm L, toTerm (twoInputCtx false a b [])]
def keyFirstLogicArgs (L a b : ByteString) (n : Integer) : List Term :=
  [toTerm L, toTerm (twoInputCtx true a b [(.ScriptCredential L, n)])]
def keyLastLogicArgs (L a b : ByteString) (n : Integer) : List Term :=
  [toTerm L, toTerm (twoInputCtx false a b [(.ScriptCredential L, n)])]

#prep_uplc appliedAuditGateKeyFirstNone mixBoxTemplate keyFirstNoneArgs 1500
#prep_uplc appliedAuditGateKeyLastNone mixBoxTemplate keyLastNoneArgs 1500
#prep_uplc appliedAuditGateKeyFirstLogic mixBoxTemplate keyFirstLogicArgs 1500
#prep_uplc appliedAuditGateKeyLastLogic mixBoxTemplate keyLastLogicArgs 1500

theorem gate_holds_with_a_key_input_first : ∀ (L a b : ByteString),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedAuditGateKeyFirstNone.prop L a b) := by blaster

theorem gate_holds_with_a_key_input_last : ∀ (L a b : ByteString),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedAuditGateKeyLastNone.prop L a b) := by blaster

theorem gate_opens_with_a_key_input_first : ∀ (L a b : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedAuditGateKeyFirstLogic.prop L a b n) := by blaster

theorem gate_opens_with_a_key_input_last : ∀ (L a b : ByteString) (n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedAuditGateKeyLastLogic.prop L a b n) := by blaster

-- Rule 3, at the classic L: both orders error alone and halt with L's withdrawal, a few
-- steps past `Template.Steps`' one-input runs (error after 1029, halt after 1060).
#eval s!"audit gate, key first, none:  {stepsWith mixBoxTemplate atClassic (twoInputCtx true g1 notG1 [])}"
#eval s!"audit gate, key last, none:   {stepsWith mixBoxTemplate atClassic (twoInputCtx false g1 notG1 [])}"
#eval s!"audit gate, key first, logic: {stepsWith mixBoxTemplate atClassic (twoInputCtx true g1 notG1 [(.ScriptCredential Lovejoin.Classic.mixLogicHash, 0)])}"
#eval s!"audit gate, key last, logic:  {stepsWith mixBoxTemplate atClassic (twoInputCtx false g1 notG1 [(.ScriptCredential Lovejoin.Classic.mixLogicHash, 0)])}"

end Lovejoin.Template.AuditGateInputs
