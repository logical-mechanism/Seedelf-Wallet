import Lovejoin.V2.Scripts
import Seedelf.Scenario

/-! v2 mix_logic (60294352…) on a Mix of two boxes into two: Lovejoin's own KAT
`mix_real_proofs_ada_pool_n2_passes` (`mix_kat.test.ak`, at 5cc3631), as a full
ScriptContext.

- The test launch's reference input (`default_reference_input`): 2 ₳ and the NFT at
  reference_holder `cdcd…`, with the ADA pool's `ReferenceDatum` (10 ₳ boxes, no token, a
  0.8 ₳ fee cap, mix_box `5555…`, mix_logic `6666…`, fee_contract `7777…`).
- The KAT's two boxes in, its two boxes out, then its 5 ₳ change to a key.
- The KAT's real sigma-OR proofs, made by Lovejoin's TS prover.

A Mix's `ctx` hashes only the outputs' datums, the box value and mix_box's hash, so these
bytes are all the proofs need. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)

def referenceHolderHash : ByteString := ofHex "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
def nftPolicy : ByteString := ofHex "abababababababababababababababababababababababababababab"
def mixBoxHash : ByteString := ofHex "55555555555555555555555555555555555555555555555555555555"
def mixLogicHash : ByteString := ofHex "66666666666666666666666666666666666666666666666666666666"
def feeHash : ByteString := ofHex "77777777777777777777777777777777777777777777777777777777"
def userKey : ByteString := ofHex "99999999999999999999999999999999999999999999999999999999"

/-- The ADA pool's `ReferenceDatum`: `box_lovelace`, `token_policy`, `token_name`,
`token_quantity`, `max_fee_per_mix_lovelace`, then the three hashes. -/
def referenceDatum : Data :=
  .Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000, .B mixBoxHash, .B mixLogicHash, .B feeHash]

/-- The test launch's reference UTxO. -/
def referenceInput : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B nftPolicy, Data.Map [(Data.B "lovejoin", Data.I 1)])],
    .OutputDatum referenceDatum, none⟩⟩

/-- `MixDatum { a, b }` as Data. -/
def mixDatum (a b : ByteString) : Data := .Constr 0 [.B a, .B b]

/-- A box of `lovelace` at mix_box, its datum `(a, b)` inline, with no stake credential or
reference script. -/
def box (a b : ByteString) (lovelace : Integer := 10000000) : TxOut :=
  ⟨⟨.ScriptCredential mixBoxHash, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I lovelace)])],
   .OutputDatum (mixDatum a b), none⟩

/-- The KAT's two boxes in, at `a0a0…#0` and `a1a1…#0`. -/
def inputs : List TxInInfo :=
  [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩,
    box (ofHex "b928f3beb93519eecf0145da903b40a4c97dca00b21f12ac0df3be9116ef2ef27b2ae6bcd4c5bc2d54ef5a70627efcb7")
        (ofHex "a6e5f7f4d52b2042153f1a0b0bb88a116a39370408f4fee2a9bb7181f3632dee528122882050d9ec416cac2e3b260459")⟩,
   ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩,
    box (ofHex "99cdf3807146e68e041314ca93e1fee0991224ec2a74beb2866816fd0826ce7b6263ee31e953a86d1b72cc2215a57793")
        (ofHex "8366fea2d3d7cd341ee789fa10f803e96c24ed7106e7d1fff3109d9f86fd897a3fb3352d1fc7328f3b75c7549258b89b")⟩]

/-- The KAT's two boxes out, the first holding `first` lovelace (10 ₳ in the KAT). -/
def boxesOut (first : Integer := 10000000) : List TxOut :=
  [box (ofHex "a2d25c15e557379e810ec2631ee5aafbd3b66debc2d175a9d2cc20c52730d4ffe06c063403f6549f4c12f9e17c6e5e6e")
       (ofHex "868eb931121f4a6505181f28259db1208367eda315ec89525f285122c118aa62a65b6c259f497b1e20534ee3f26b976d") first,
   box (ofHex "85b512992a9fa3d1e4be92ccd12c5525abe55079cfc70a7d1aaf6db54b475402fbb72dd4b6b2edbbc84d9112f6110a52")
       (ofHex "8cf8c209b63db57b5662836168336dc2c78097a98ee99c37c0374b43308e237e8061c7e6f33a469c32d57ed78a26bbe9")]

/-- The KAT's change after the boxes: 5 ₳ to a key. -/
def change : TxOut :=
  ⟨⟨.PubKeyCredential userKey, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 5000000)])], .NoOutputDatum, none⟩

/-- A sigma-OR branch `(t0, t1, c, z)` as Data. -/
def branch (t0 t1 c z : ByteString) : Data := .Constr 0 [.B t0, .B t1, .B c, .B z]

/-- `Mix { proofs }`, each proof a list of branches. -/
def mixRedeemer (proofs : List (List Data)) : Data :=
  .Constr 1 [.List (proofs.map fun branches => .Constr 0 [.List branches])]

/-- The KAT's two proofs, with each branch's `c` given: input 1's branches take `c11` and
`c12`, input 2's `c21` and `c22`. Every `t0`, `t1` and `z` is the KAT's. -/
def katProofs (c11 c12 c21 c22 : ByteString) : List (List Data) :=
  [[branch (ofHex "aa57049c1dd893b253147efbae26d3be241cbf6e3eb029ba58a51a97dcec0578f575424137fb3e33088259007c36c463")
           (ofHex "b17d33abef270622c8ba5b5ce3a118a52afd6312b56d199550dce4d5a7a286a147fbd0b3daafd890d1abd4d0148c70a0")
           c11 (ofHex "1f68751f34d21bb3fed0d9a391fcfc632e9f20f71520e5c602e7deb35e61cd0d"),
    branch (ofHex "b9409315230f07fdd133f572f909460d6aaee47b25a89200ff7b905eb9835e50f73fdd9ed093ad635f6ec3b8a2758416")
           (ofHex "a2637c4d68106ce5a4cf1e669b70c5c1f458988a17cab9e10d33cced4ab52cd6bc56758434a763595a21864996cff94c")
           c12 (ofHex "517744a18027d39276157b757bcf7bfb924a84903fbfa3138a89c48a1726499c")],
   [branch (ofHex "b270340c955fa3daf6d0ff29592d20758bad10d512220f980b0c2114db43083578ede4650f09c70f0fff693a37ae5b40")
           (ofHex "b5bd06b653e924ebec3bc0b7e1cb50bb598945a703a67773dcf9f8b6f89e1985c1a3a02e3d51f022e680819ba913b4d3")
           c21 (ofHex "1e141398a071fabe146321243d98ab2823295880179d433c58f825491a102ee7"),
    branch (ofHex "81498187cf3d90edac08a26fa7a632f060c741abdd9dd4fdbe3ed3987eee9526ab32d401b19ff7df8e65efbf5b1ed735")
           (ofHex "ab9f81ba42aa93faf2b3fd6900faa8b2ff942648e3d417cd2393917d360844110f1bcb6e92ebdbd2657aee42d489a85d")
           c22 (ofHex "4edb0fb70d87ce6f0c113717b89b222642296e151ba68f2d1753a6118c794c00")]]

/-- The KAT's own challenges. -/
def katC11 : ByteString := ofHex "56a67ef60452564d376bce75074c937103b75f8eed1eb9e9cf0d433b8ca0ba61"
def katC12 : ByteString := ofHex "c7fa2360dcdd4ca87b3e737d35db20bd3ac675f16f4a1476f583fba51ab080be"
def katC21 : ByteString := ofHex "122cd30a0545fc651abf0933850e1b7bbb70f4cb4a7c8eeb720f858136bddff7"
def katC22 : ByteString := ofHex "cf5d2d26aba0201cad132607d2e1f29e028fc3cd7db3561ff0e757f4c54789cd"

/-- A Mix: the reference input, the KAT's two boxes in, `outs` paid, mix_logic's own
withdrawal of 0, and `redeemer`. The fee is the KAT's; mix_logic doesn't read it. -/
def mixCtx (redeemer : Data) (outs : List TxOut := boxesOut ++ [change]) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := inputs,
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := outs,
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- The KAT's Mix, its own redeemer. -/
def katMix : ScriptContext := mixCtx (mixRedeemer (katProofs katC11 katC12 katC21 katC22))

end Lovejoin.V2
