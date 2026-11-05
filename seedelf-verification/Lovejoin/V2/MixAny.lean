import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of two boxes, for any v2 ADA pool and any boxes: `V2.Mix`'s KAT
transaction with the pool's NFT policy `P`, its mix_box `M`, its box value `bl` and every
box's points left as parameters. The theorems run mix_logic's template (`Template.Scripts`)
applied to `P` and `lovejoin`, so they hold for every v2 launch, the owner's new pool's
included. At the test launch's `P`, `M` and `bl` with the KAT's points this is `V2.Mix`'s
`katMix` (`V2.MixAnySteps` runs both). The reference datum's other fields (no token, the
fee cap, mix_logic's and fee_contract's hashes) are the test launch's: validate_mix reads
only the box value and `M`. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- An ADA pool's `ReferenceDatum`, boxes of `bl` at mix_box `M`. -/
def refDatumAny (bl : Integer) (M : ByteString) : Data :=
  .Constr 0 [.I bl, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputAny (P : ByteString) (bl : Integer) (M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumAny bl M), none⟩⟩

/-- A box of `bl` at mix_box `M`, its datum `(a, b)` inline. -/
def boxAny (M : ByteString) (bl : Integer) (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I bl)])], .OutputDatum (mixDatum a b), none⟩

/-- A Mix of two boxes in, `(a1, b1)` and `(a2, b2)`, into two out, `(oa1, ob1)` and
`(oa2, ob2)`, then `V2.Mix`'s change. The rest is the KAT's. -/
def mixCtxAny (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxAny M bl a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxAny M bl a2 b2⟩],
    txInfoReferenceInputs := [refInputAny P bl M],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

end Lovejoin.V2.Any
