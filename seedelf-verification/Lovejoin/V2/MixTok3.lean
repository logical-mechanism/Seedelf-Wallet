import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of 3 boxes, for any v2 token pool and any boxes: `V2.MixAny`'s scenario at
n = 3, its boxes holding the pool's token too. The pool's NFT policy `P`, its mix_box `M`, its
box value (lovelace `bl`, and `tq` of the token `(tp, tn)`) and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `token_n3_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.MixTok3Steps`. -/

namespace Lovejoin.V2.Tok3
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

/-- A Mix of 3 boxes in, `(a1, b1)` to `(a3, b3)`, into 3 out, `(oa1, ob1)` to `(oa3, ob3)`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl tp tn tq a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl tp tn tq a2 b2⟩,
                              ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, boxPool M bl tp tn tq a3 b3⟩],
    txInfoReferenceInputs := [refInputPool P bl tp tn tq M],
    txInfoOutputs         := [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Mix { proofs }`, input i's branch j `(t0ij, t1ij, cij, zij)`. -/
def proofsRedeemerPool (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : Data :=
  mixRedeemer
  [[branch t011 t111 c11 z11, branch t012 t112 c12 z12, branch t013 t113 c13 z13],
   [branch t021 t121 c21 z21, branch t022 t122 c22 z22, branch t023 t123 c23 z23],
   [branch t031 t131 c31 z31, branch t032 t132 c32 z32, branch t033 t133 c33 z33]]

/-- The token-pool KAT launch's token policy (`test_fixtures.ak`). -/
def tokPolicy : ByteString := ofHex "34343434343434343434343434343434343434343434343434343434"
def tokName : ByteString := "TOKEN"

/-- The KAT's points and proofs. -/
def katA1 : ByteString := ofHex "b928f3beb93519eecf0145da903b40a4c97dca00b21f12ac0df3be9116ef2ef27b2ae6bcd4c5bc2d54ef5a70627efcb7"
def katB1 : ByteString := ofHex "a6e5f7f4d52b2042153f1a0b0bb88a116a39370408f4fee2a9bb7181f3632dee528122882050d9ec416cac2e3b260459"
def katA2 : ByteString := ofHex "99cdf3807146e68e041314ca93e1fee0991224ec2a74beb2866816fd0826ce7b6263ee31e953a86d1b72cc2215a57793"
def katB2 : ByteString := ofHex "8366fea2d3d7cd341ee789fa10f803e96c24ed7106e7d1fff3109d9f86fd897a3fb3352d1fc7328f3b75c7549258b89b"
def katA3 : ByteString := ofHex "80fd75ebcc0a21649e3177bcce15426da0e4f25d6828fbf4038d4d7ed3bd4421de3ef61d70f794687b12b2d571971a55"
def katB3 : ByteString := ofHex "8441837d1df387f43189d6e8e911cfd795489405f9deca1481f0b70d03355c9e5f6cafcc9fcdb4062ac2632f6b721fc7"
def katOA1 : ByteString := ofHex "845ce6fb2e8285e31f0d59f163b7837778a6034e95c4d696c50701d1c755a9e5b5ac38e835534e767caabf2f56c392db"
def katOB1 : ByteString := ofHex "9634857b10498517d2e67cabf066112bbbd4f8497ecf844bfc09b656d4e0d402d8e2e70441aafc304a316e8a883f0382"
def katOA2 : ByteString := ofHex "85b512992a9fa3d1e4be92ccd12c5525abe55079cfc70a7d1aaf6db54b475402fbb72dd4b6b2edbbc84d9112f6110a52"
def katOB2 : ByteString := ofHex "8cf8c209b63db57b5662836168336dc2c78097a98ee99c37c0374b43308e237e8061c7e6f33a469c32d57ed78a26bbe9"
def katOA3 : ByteString := ofHex "a2d25c15e557379e810ec2631ee5aafbd3b66debc2d175a9d2cc20c52730d4ffe06c063403f6549f4c12f9e17c6e5e6e"
def katOB3 : ByteString := ofHex "868eb931121f4a6505181f28259db1208367eda315ec89525f285122c118aa62a65b6c259f497b1e20534ee3f26b976d"
def katT011 : ByteString := ofHex "a94cc1ec8808b1b2f6a2af0bab027076421bb35cf8252c1f816e24a7eea231cb4447de4a2ffeab8da6d9d38dfe112c31"
def katT111 : ByteString := ofHex "8e7b11397c6f2d5d643e0b78468662a367238580b392cbcdbada341e2851e6576c31db75ec33f052111f43ff1734a733"
def katC11 : ByteString := ofHex "8e5b609733adf6f28dc2c17b7361cf7083b2e686d71f7096eb13722587b6681f"
def katZ11 : ByteString := ofHex "2bc3305b80ca6b65c8688d58021b7f28fd1e72c88284a8b07afef4d74a3461c5"
def katT012 : ByteString := ofHex "b2e992f6e90c4dc33b8b10d3daa54736af8cee441e5dc8b796719775ecaf8b69ef47d0ef8401840c51eb43899313eb25"
def katT112 : ByteString := ofHex "870bc5c25a0f35f197a278428a262c046aae6170ae554e8f7d9624c3acb89d87e69f8f54ff4c195d034cac14e1a946e7"
def katC12 : ByteString := ofHex "87b2c4651dba382e4a877b6eb99504327bbd05cd92dbcd350710ed1bcd158223"
def katZ12 : ByteString := ofHex "718b3549e5c360f6e8c9881b32bd308596a905a1b0ee0782a997a3c493fdb4f8"
def katT013 : ByteString := ofHex "831abd7c349b612bfbc0d980c97efd6bfc816155ab6ac0c6a9c204666510c272dd20459b5843a86c13e9829c6db29356"
def katT113 : ByteString := ofHex "b15377ad47ea6d28c97ad54c095c96f7f5095af851da6535c94aa2843624913ae24bf29b469b3a0d9b5a7d63b53a0a93"
def katC13 : ByteString := ofHex "4c5c61102c5cedebb0fdaada992a7698ca3e6f515c9ac12807f93a4a10920bc0"
def katZ13 : ByteString := ofHex "18081f9d31e488fddbbe4f07a2fa08b27fca064152cd9391fc75b2ff6c816ce7"
def katT021 : ByteString := ofHex "8fa2a575d8539d0046e2520b1f58d058da7495ddf55412f1374a03151b23eefa1df32e5ecfa4c89b7b77f0b7bd3b3b31"
def katT121 : ByteString := ofHex "8179046120ad754a8ed9ff732d71e3d238b7987b714a0b46fa6d3eb3cd8f910e8e300b4f491e655e18c506982e30c3d7"
def katC21 : ByteString := ofHex "f7a4702987c53e3e2e791a5d85a76583272764f2dbb6df0bdd27c4e9811fbd51"
def katZ21 : ByteString := ofHex "06ef2f1e0ca009b1b2751f123f2cb72c70c381f756daa13c6661c5a499594c29"
def katT022 : ByteString := ofHex "8d818d69c5fec6711f6b67ada1f960851be73cc1df4c5092361134becdae41740e3f75ba8445c5f824910551d8e7c9ab"
def katT122 : ByteString := ofHex "8cd0e0fe873815a307c975556d4d10b343c6381267a9367ebcf7fba885b1b952539dd2af4505eac3576a77cccda46c76"
def katC22 : ByteString := ofHex "10a8d00e419408e9c62eddac64a99cea4b8736e7596bb13a35e101847aaebf62"
def katZ22 : ByteString := ofHex "61d49afe33a930058f6b23f76cd2337d55a3a32df8b3840daecbada51ec7bbc4"
def katT023 : ByteString := ofHex "a6037f56a735b0667bfb1e014b3eb8b3cc7f520e36216e024e6dec15b77d06d52c4015f0762b633e61b10a1fb3c61732"
def katT123 : ByteString := ofHex "860a97e060cc8998788f76cdd6085041905d1e62ceb480972021e74bde8b7e91e0bd7d36b5d1a2cd826d33b3759d8942"
def katC23 : ByteString := ofHex "949430dcde20aa57ab15625c3314c0574854e67646f90abad5985ab54fa786ac"
def katZ23 : ByteString := ofHex "557c8c71cd14bacb80a4827b1787de2271a8b22ce288d871a0889ccec27ca46d"
def katT031 : ByteString := ofHex "8b5fe23b207db1c64d0b7c291f6b738970fe20b0888b8ab56b5e728b58729425fe95bc031e538833a4e9e981f6badfdf"
def katT131 : ByteString := ofHex "a3dd21c2038963073a5d3d4f9ebfe0037820268b96e6de1a295f58582da55f41ba57b3296feb4a6bf51a46429cc1f735"
def katC31 : ByteString := ofHex "dc1186f9d578ad819577163d412fb6a0dbc468bae9cb702fbe878c82f00cf73a"
def katZ31 : ByteString := ofHex "5a7fa96156e5935bce9941d36bf2fc8a5c8a8ec2162451479738f27f96d63422"
def katT032 : ByteString := ofHex "95ef3d5a190dc8182bf628473129915e5ee202d72015965a175d287ecac0add0cc4372a7be95e3a17e30d6f346ad1d8e"
def katT132 : ByteString := ofHex "b977c407b5874b59d7ac0a7a70ccfd4acae170e9b259e0b671dce2a74ca876ee8a1f0890508b3ff06aaace0cd7b5860f"
def katC32 : ByteString := ofHex "ef95cdc0f8763a55c2ab14f5ba0889101f224c265e32db3e79354c0a568b09a7"
def katZ32 : ByteString := ofHex "1b93ff1a95da33d91bccb28bf897f52448431441ecf5ea16b36d15fb7d6d9665"
def katT033 : ByteString := ofHex "b2b6f8ed8a365b75858557b1bac73b996cf2bd1d1d9d3cb6b1fdec64b19e7ec9b9f051a4069eb13abaed16f33e2b9bcc"
def katT133 : ByteString := ofHex "919c702f61fabd99d5828e3389668f63743065dfbe6d0b98c8bcbe87c09e920fc62ffba9858c6d4dc4208d38c5c96185"
def katC33 : ByteString := ofHex "a9ae45d0d33ed892faedc5b15465b4aeeec42078054da2422a6502b109ff7a4b"
def katZ33 : ByteString := ofHex "627e9f1b2b8d976e97c6835b13672f6c3c521b7b5616fa14c679ccad960b36a3"

end Lovejoin.V2.Tok3
