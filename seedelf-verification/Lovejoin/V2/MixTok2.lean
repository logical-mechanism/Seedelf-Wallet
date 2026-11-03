import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of 2 boxes, for any v2 token pool and any boxes: `V2.MixAny`'s scenario at
n = 2, its boxes holding the pool's token too. The pool's NFT policy `P`, its mix_box `M`, its
box value (lovelace `bl`, and `tq` of the token `(tp, tn)`) and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `token_n2_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.MixTok2Steps`. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- The pool's `ReferenceDatum`. -/
def refDatumPool (bl : Integer) (tp tn : ByteString) (tq : Integer) (M : ByteString) : Data :=
  .Constr 0 [.I bl, .B tp, .B tn, .I tq, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputPool (P : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumPool bl tp tn tq M), none⟩⟩

/-- A box at mix_box `M` holding the box value, its datum `(a, b)` inline. -/
def boxPool (M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I bl)]), (Data.B tp, Data.Map [(Data.B tn, Data.I tq)])], .OutputDatum (mixDatum a b), none⟩

/-- A Mix of 2 boxes in, `(a1, b1)` to `(a2, b2)`, into 2 out, `(oa1, ob1)` to `(oa2, ob2)`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl tp tn tq a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl tp tn tq a2 b2⟩],
    txInfoReferenceInputs := [refInputPool P bl tp tn tq M],
    txInfoOutputs         := [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Mix { proofs }`, input i's branch j `(t0ij, t1ij, cij, zij)`. -/
def proofsRedeemerPool (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Data :=
  mixRedeemer
  [[branch t011 t111 c11 z11, branch t012 t112 c12 z12],
   [branch t021 t121 c21 z21, branch t022 t122 c22 z22]]

/-- The token-pool KAT launch's token policy (`test_fixtures.ak`). -/
def tokPolicy : ByteString := ofHex "34343434343434343434343434343434343434343434343434343434"
def tokName : ByteString := "TOKEN"

/-- The KAT's points and proofs. -/
def katA1 : ByteString := ofHex "b928f3beb93519eecf0145da903b40a4c97dca00b21f12ac0df3be9116ef2ef27b2ae6bcd4c5bc2d54ef5a70627efcb7"
def katB1 : ByteString := ofHex "a6e5f7f4d52b2042153f1a0b0bb88a116a39370408f4fee2a9bb7181f3632dee528122882050d9ec416cac2e3b260459"
def katA2 : ByteString := ofHex "99cdf3807146e68e041314ca93e1fee0991224ec2a74beb2866816fd0826ce7b6263ee31e953a86d1b72cc2215a57793"
def katB2 : ByteString := ofHex "8366fea2d3d7cd341ee789fa10f803e96c24ed7106e7d1fff3109d9f86fd897a3fb3352d1fc7328f3b75c7549258b89b"
def katOA1 : ByteString := ofHex "a2d25c15e557379e810ec2631ee5aafbd3b66debc2d175a9d2cc20c52730d4ffe06c063403f6549f4c12f9e17c6e5e6e"
def katOB1 : ByteString := ofHex "868eb931121f4a6505181f28259db1208367eda315ec89525f285122c118aa62a65b6c259f497b1e20534ee3f26b976d"
def katOA2 : ByteString := ofHex "85b512992a9fa3d1e4be92ccd12c5525abe55079cfc70a7d1aaf6db54b475402fbb72dd4b6b2edbbc84d9112f6110a52"
def katOB2 : ByteString := ofHex "8cf8c209b63db57b5662836168336dc2c78097a98ee99c37c0374b43308e237e8061c7e6f33a469c32d57ed78a26bbe9"
def katT011 : ByteString := ofHex "aa28614ee10f3192a86c0c42b2f61ccee80851d85a7c7da8d5261952f5eec7e713d0f6c7c3d9bab6259bb905f722f5f2"
def katT111 : ByteString := ofHex "913e0fc0fea6d8e87e7bd184774c2220dcf67e7ff0b918f54047c179e4df23a6be15f62f8a7ae5dfa419264ef26ae69a"
def katC11 : ByteString := ofHex "9217936ce0cfd0434851a825b11bdc563319a795228a6f529e47da6c9bb9cc43"
def katZ11 : ByteString := ofHex "343e411808e9a2eeb36d727c7e081afa1f5a0f09ad057a4b948c22146d79e94c"
def katT012 : ByteString := ofHex "aca9a031a89c5d9b0a73a6c108d2131217dedc55299d0c020a37056bbb1e365d07b4687da7d13ecc34df058b66824b70"
def katT112 : ByteString := ofHex "8e3c1e28633db311f0ef546aab2ff1e96883c4c1439dcd554e10eaabf337d1302698ccc2ec1232df319328dbcda8d856"
def katC12 : ByteString := ofHex "2825cc40124d909e84a422ef99e5f3996ccb2f564517ce03a2951d8a968c520a"
def katZ12 : ByteString := ofHex "379cac98aedca776d21c7b0baa9e02f8c8d1a2b800b33a510af9e50e880c3988"
def katT021 : ByteString := ofHex "99c1acc8e1a0d0ed961fd49e7b4d2b435eda85fca9be5a056d521819c65b3f51e68607af88ebb44ba5fc744e8faf2365"
def katT121 : ByteString := ofHex "ade1e0062ce5e9f9df54b17201ca19003f45058cd4dfac8961d096518a91952f78c047b1cf942b043ea4a78cb47d50df"
def katC21 : ByteString := ofHex "325f6af211877b8a5740aaf8e15af0bd69dbb3eab8ad7512ec8d498af7534a47"
def katZ21 : ByteString := ofHex "36eebce9407f0f340b1d7ccf2abc611d68f9474ccd8b9c0f6a9372d38f12b834"
def katT022 : ByteString := ofHex "a8acf1718578768d139b4d0f188fc9714478177aa4693af6fa268418d53fe5dc9dfea531859c7bcd4ea9678a0a7feb50"
def katT122 : ByteString := ofHex "82c2b16d0383afc4a5365aa4079d1b40e483eae1f725bba92ee92afb2a5f1f0e9dac7ebddd5d9e784f62057e2df17206"
def katC22 : ByteString := ofHex "560bebe5cb769740cad4fbf599fe5938bb824ebac51c1f8a5a7007d874ebcbce"
def katZ22 : ByteString := ofHex "6e0691d1204039c659ba18fc8b22e85c6a2409afc108c2664bc7c4e73748bbd6"

end Lovejoin.V2.Tok2
