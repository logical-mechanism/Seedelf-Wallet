import Lovejoin.Template.Steps
import Blaster

/-! Checker (mix-box-gate-single-input), not part of the suite: mix_box's template gate, for
every mix_logic hash L, with the box the third of four inputs and two withdrawals. Every
`Template.MixBoxGate` and `MixBoxNoLock` scenario has the box as the only input and at most
one withdrawal, so a script that read the first or last input's datum instead of its own
passes all 29.

The other three inputs are a key's, with no datum (Rule 2's "moves" shape), in the ledger's
sorted order around the box at ⟨"u", 1⟩: ⟨"t", 1⟩ (the box's index, another id), ⟨"u", 0⟩
(the box's id, another index), and ⟨"v", 0⟩ after it. So a script reading the first or the
last input, or matching an input by its id alone or its index alone, reads a datum-less input
and lets a well-formed box go. Script withdrawals come first, as the ledger orders them. The
list shapes are concrete (README rule 4); L, the datum's bytes, the other credentials and the
amounts are symbolic.

Built in place as `Audit.Gaps.Template.CheckGateShapes`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.CheckGateShapes`. Expected: four `✅ Valid`,
and the `#eval`s at the classic L: none → error, L's second → halt, others → error,
a = b → halt, each a few dozen steps past `Template.Steps`' one-input runs (error after 1029,
halt after 1060, error after 1089, halt after 889) and under the limit of 2000. -/

namespace Lovejoin.Template.CheckGateShapes
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (box mixDatum mixLogicHash notG1)
open Seedelf.V1 (g1)

def boxRefU : TxOutRef := ⟨"u", 1⟩

/-- A key's input with no datum, at `ref`. -/
def keyIn (ref : TxOutRef) : TxInInfo :=
  ⟨ref, ⟨⟨.PubKeyCredential "k", none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 5000000)])], .NoOutputDatum, none⟩⟩

/-- Spending the box at `boxRefU`, its datum `MixDatum (a, b)` inline, the third of four
inputs, with withdrawals `wdrl`. -/
def fourInputCtx (a b : ByteString) (wdrl : Withdrawals) : ScriptContext :=
  let own : TxInInfo := ⟨boxRefU, box (.OutputDatum (mixDatum a b))⟩
  ⟨{ Seedelf.V1.emptyTx with
      txInfoInputs := [keyIn ⟨"t", 1⟩, keyIn ⟨"u", 0⟩, own, keyIn ⟨"v", 0⟩],
      txInfoWdrl := wdrl },
   Data.Constr 0 [], .SpendingScript boxRefU (some (mixDatum a b))⟩

def noneArgs (L a b : ByteString) : List Term := [toTerm L, toTerm (fourInputCtx a b [])]
/-- Another script's withdrawal (`d`, possibly L itself), then L's. -/
def logicSecondArgs (L a b d : ByteString) (m n : Integer) : List Term :=
  [toTerm L, toTerm (fourInputCtx a b [(.ScriptCredential d, m), (.ScriptCredential L, n)])]
/-- Another script's withdrawal (`d`) and a key's (`c`, whatever its hash), neither L's script. -/
def othersArgs (L a b c d : ByteString) (m n : Integer) : List Term :=
  [toTerm L, toTerm (fourInputCtx a b [(.ScriptCredential d, m), (.PubKeyCredential c, n)])]

#prep_uplc appliedCheckGate4None mixBoxTemplate noneArgs 2000
#prep_uplc appliedCheckGate4LogicSecond mixBoxTemplate logicSecondArgs 2000
#prep_uplc appliedCheckGate4Others mixBoxTemplate othersArgs 2000

/-- With no withdrawal, the box moves iff its datum isn't a well-formed `MixDatum`, whatever L. -/
theorem gate4_alone_iff_malformed : ∀ (L a b : ByteString),
    isSuccessful (appliedCheckGate4None.prop L a b) ↔
      ¬ (lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b) := by blaster

/-- A well-formed box among datum-less key inputs, with no withdrawal, reaches `Error`. -/
theorem gate4_needs_L : ∀ (L a b : ByteString),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedCheckGate4None.prop L a b) := by blaster

/-- L's withdrawal second, after another script's, lets it through. -/
theorem gate4_opens_with_L_second : ∀ (L a b d : ByteString) (m n : Integer),
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isSuccessful (appliedCheckGate4LogicSecond.prop L a b d m n) := by blaster

/-- Another script's and a key's withdrawals, neither L's script credential, don't. -/
theorem gate4_refuses_others : ∀ (L a b c d : ByteString) (m n : Integer),
    d ≠ L →
    lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b →
      isUnsuccessful (appliedCheckGate4Others.prop L a b c d m n) := by blaster

-- Rule 3, at the classic L: the same contexts run concretely.
#eval s!"check gate4, well-formed, none:      {stepsWith mixBoxTemplate atClassic (fourInputCtx g1 notG1 [])}"
#eval s!"check gate4, well-formed, L second:  {stepsWith mixBoxTemplate atClassic (fourInputCtx g1 notG1 [(.ScriptCredential "o", 0), (.ScriptCredential mixLogicHash, 0)])}"
#eval s!"check gate4, well-formed, others:    {stepsWith mixBoxTemplate atClassic (fourInputCtx g1 notG1 [(.ScriptCredential "o", 0), (.PubKeyCredential mixLogicHash, 0)])}"
#eval s!"check gate4, a = b, none:            {stepsWith mixBoxTemplate atClassic (fourInputCtx g1 g1 [])}"

end Lovejoin.Template.CheckGateShapes
