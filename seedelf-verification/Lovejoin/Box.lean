import Lovejoin.Scripts
import Seedelf.Scenario

/-! mix_box (c145c10f…): what its modules share. A spend of one box, its transaction's
only input, in an otherwise empty transaction (`Seedelf.Scenario`). mix_box reads only
its own input's typed datum and the withdrawals: the redeemer and the spend's resolved
datum are ignored (audit finding F-2 is why it reads the typed datum). -/

namespace Lovejoin.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)

def mixBoxHash : ByteString := ofHex "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad"
def mixLogicHash : ByteString := ofHex "0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e"

def boxRef : TxOutRef := ⟨"", 0⟩

/-- A 10 ₳ box at mix_box, with no stake credential or reference script. -/
def box (datum : OutputDatum) : TxOut :=
  ⟨⟨.ScriptCredential mixBoxHash, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 10000000)])], datum, none⟩

/-- Spending the box at `boxRef`, with `resolved` the datum the ledger hands the script
(the inline one, or a hash's witness), `wdrl` the withdrawals and `redeemer` the
redeemer, which mix_box ignores. -/
def spendBoxCtx (datum : OutputDatum) (resolved : Option Data) (wdrl : Withdrawals)
    (redeemer : Data := Data.Constr 0 []) : ScriptContext :=
  let tx := { emptyTx with txInfoInputs := [⟨boxRef, box datum⟩], txInfoWdrl := wdrl }
  ⟨tx, redeemer, .SpendingScript boxRef resolved⟩

/-- A box whose datum `d` is inline. -/
def inlineBoxCtx (d : Data) (wdrl : Withdrawals) (redeemer : Data := Data.Constr 0 []) : ScriptContext :=
  spendBoxCtx (.OutputDatum d) (some d) wdrl redeemer

/-- `MixDatum { a, b }` as Data. -/
def mixDatum (a b : ByteString) : Data := .Constr 0 [.B a, .B b]

end Lovejoin.Classic
