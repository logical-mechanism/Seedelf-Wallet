import Lovejoin.Template.Launch

/-! fee_contract's template on a shard's spend: the shard (its datum unit, inline), the
boxes beside it, the pool's reference input, one fee output and the transaction's fee.
The template's parameters (the pool's NFT and `lovejoin`) come first, as the program's
arguments. fee_contract reads the pool's script hashes from the `ReferenceDatum` and
counts boxes by address alone, so stand-in hashes do. -/

namespace Lovejoin.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)

def mHash : ByteString := ofHex "55555555555555555555555555555555555555555555555555555555"
def lHash : ByteString := ofHex "66666666666666666666666666666666666666666666666666666666"
def fHash : ByteString := ofHex "77777777777777777777777777777777777777777777777777777777"

def unitData : Data := .Constr 0 []

/-- `n` lovelace alone. -/
def ada (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

/-- The pool's reference input: its NFT `(P, lovejoin)` and an ADA pool's datum, with the
fee cap `cap`. -/
def feeRefInput (P : ByteString) (cap : Integer) : TxInInfo :=
  ⟨⟨"r", 0⟩, refOut (.ScriptCredential "rh") none P nftName (refDatum 10000000 "" "" 0 cap mHash lHash fHash) none⟩

def shardRef : TxOutRef := ⟨"s", 0⟩

/-- A shard of `n` lovelace at fee_contract, its datum unit, inline. -/
def shard (n : Integer) : TxOut := ⟨⟨.ScriptCredential fHash, none⟩, ada n, .OutputDatum unitData, none⟩

/-- A box at mix_box, the `k`th. -/
def boxIn (k : Integer) : TxInInfo := ⟨⟨"b", k⟩, ⟨⟨.ScriptCredential mHash, none⟩, ada 10000000, .OutputDatum unitData, none⟩⟩

def threeBoxes : List TxInInfo := [boxIn 0, boxIn 1, boxIn 2]
def twoBoxes : List TxInInfo := [boxIn 0, boxIn 1]

/-- fee_contract's redeemers, and mix_logic's `Mix` and `Owner` (no proofs: fee_contract
reads only which). -/
def payMixFee : Data := .Constr 0 []
def replenish : Data := .Constr 1 []
def mixRedeemerData : Data := .Constr 1 [.List []]
def ownerRedeemerData : Data := .Constr 0 [.List []]

/-- A shard's spend: the shard of `fi` lovelace with `boxes` beside it, the fee output of
`fo`, the fee `f`, mix_logic's redeemer `mixRed` if it runs, and fee_contract's `red`. -/
def feeCtx (P : ByteString) (cap fi : Integer) (boxes : List TxInInfo) (fo f : Integer) (mixRed : Option Data)
    (red : Data) : ScriptContext :=
  let redeemers : RedeemerMap := match mixRed with
    | some r => [(.Rewarding (.ScriptCredential lHash), r)]
    | none => []
  let tx := { emptyTx with
    txInfoInputs          := ⟨shardRef, shard fi⟩ :: boxes,
    txInfoReferenceInputs := [feeRefInput P cap],
    txInfoOutputs         := [shard fo],
    txInfoFee             := f,
    txInfoRedeemers       := redeemers }
  ⟨tx, red, .SpendingScript shardRef (some unitData)⟩

end Lovejoin.Template
