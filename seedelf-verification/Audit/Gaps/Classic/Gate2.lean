import Lovejoin.Box

/-! Audit (lovejoin-classic), not part of the suite: mix_box's gate on shapes `MixBoxGate`
and `MixBoxNoLock` fix. The box is the second of two inputs (a key's input first), there
are two withdrawals, and the redeemer is any `Data`. `pairs.has_key` and `list.find` walk
these lists, so each shape is concrete; only the bytes, keys, amounts and redeemer are
symbolic. -/

namespace Lovejoin.Classic.AuditGate
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open Seedelf.V1 (emptyTx)

/-- The box at `⟨"\x02", 0⟩` after a key `k`'s input at `⟨"\x01", 0⟩`, withdrawals `wdrl`,
redeemer `r`. -/
def gate2Ctx (a b k : ByteString) (wdrl : Withdrawals) (r : Data) : ScriptContext :=
  let me : TxOutRef := ⟨"\x02", 0⟩
  let other : TxInInfo :=
    ⟨⟨"\x01", 0⟩, ⟨⟨.PubKeyCredential k, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 5000000)])], .NoOutputDatum, none⟩⟩
  let tx := { emptyTx with txInfoInputs := [other, ⟨me, box (.OutputDatum (mixDatum a b))⟩], txInfoWdrl := wdrl }
  ⟨tx, r, .SpendingScript me (some (mixDatum a b))⟩

end Lovejoin.Classic.AuditGate
