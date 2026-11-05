import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of 3 boxes, for any v2 ADA pool and any boxes: `V2.MixAny`'s scenario at
n = 3. The pool's NFT policy `P`, its mix_box `M`, its
box value `bl` and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `ada_n3_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.MixAny3Steps`. -/

namespace Lovejoin.V2.Any3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- The pool's `ReferenceDatum`. -/
def refDatumPool (bl : Integer) (M : ByteString) : Data :=
  .Constr 0 [.I bl, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputPool (P : ByteString) (bl : Integer) (M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumPool bl M), none⟩⟩

/-- A box at mix_box `M` holding the box value, its datum `(a, b)` inline. -/
def boxPool (M : ByteString) (bl : Integer) (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I bl)])], .OutputDatum (mixDatum a b), none⟩

/-- A Mix of 3 boxes in, `(a1, b1)` to `(a3, b3)`, into 3 out, `(oa1, ob1)` to `(oa3, ob3)`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl a2 b2⟩,
                              ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, boxPool M bl a3 b3⟩],
    txInfoReferenceInputs := [refInputPool P bl M],
    txInfoOutputs         := [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Mix { proofs }`, input i's branch j `(t0ij, t1ij, cij, zij)`. -/
def proofsRedeemerPool (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : Data :=
  mixRedeemer
  [[branch t011 t111 c11 z11, branch t012 t112 c12 z12, branch t013 t113 c13 z13],
   [branch t021 t121 c21 z21, branch t022 t122 c22 z22, branch t023 t123 c23 z23],
   [branch t031 t131 c31 z31, branch t032 t132 c32 z32, branch t033 t133 c33 z33]]

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
def katT011 : ByteString := ofHex "ac9800eefb06e97c19ebb56b4d958a954857ec422ecab1ab563b1743a0930e40362a6b0c02dab0508e093b24708d6a86"
def katT111 : ByteString := ofHex "959ac0a36fcfaeeabc754ca0c1e0e4b2bcc4ea2a042ed5fb875f94ff28c225e31c6f664f24c9c939cd7404d4ebb3553c"
def katC11 : ByteString := ofHex "a93da59afd0dc907c8a43a0b8f2438f115bbdd28dee78d07f316d8de1da066ac"
def katZ11 : ByteString := ofHex "72a1e10505138ffbfd696d0b5e54a6e36e3ef77cab44e5f09ee862c0a8a91f70"
def katT012 : ByteString := ofHex "90c487a4b461a70b190055aa863e9667498898f9bd575a01dec83358a32e0d4e380e43529764b6f1a7f1e9ada1b4255a"
def katT112 : ByteString := ofHex "974570fb208006767681cfa2b2851109d7dd59357cb62900410f6ff0444af09c075f3888b09664424c1c587e6f8a5a11"
def katC12 : ByteString := ofHex "a60e620188f05dc04983b37f052816db48113d14a4d3b6e9a93b91e52edc90b4"
def katZ12 : ByteString := ofHex "354a04a15b1d5b6ae8a6006d354c5d8e12b00d53b27f0fb6b865974e7a8815d5"
def katT013 : ByteString := ofHex "a9b100da2b05fe38f07323d9b97a05acc496c4c1d3e0c80885095866f9b3db483ce6c3bf3916fa86cd88c74b827fdc6a"
def katT113 : ByteString := ofHex "8f2055f83b076d3b777fe5139cfe11f6dfa8351103ae3618f6de195eb21c86d2741f645f29609784419d5ae78a2d23ea"
def katC13 : ByteString := ofHex "85666ae04af1a56ea089c6b98d3c2fa18ea298ab28a84ce1c918c7ab6fb67227"
def katZ13 : ByteString := ofHex "63c2a66a2920f6bd2dd57ec054fe1d65d3c4f56bdd5dbe07793e20d562d09f91"
def katT021 : ByteString := ofHex "a34126f249d3476308cd9b52a9851ec19cf5e6ff90b43aee1aa5aac191e76a59125c2b51f0aa7f8467e93665f48bd97b"
def katT121 : ByteString := ofHex "b0befb650ff45126103e4c86b67fa735839e8817ec5fb3f5865dd78a6d52624d846e964fda8755e68bd0bb433e36a8ec"
def katC21 : ByteString := ofHex "49fda3f5220f01646c830f43a7e89566f7ed4ae6f91c11523507e2e03acdb572"
def katZ21 : ByteString := ofHex "08914b1ce072c717ba1e1ab6868ff7dc2870db2abd5406785573cd3b61b0fa76"
def katT022 : ByteString := ofHex "82e14c6811656564da0606668435859e4716f5dfcf9fbcb830b99d8cd44c27597fb07370040471d9fad20fc2537241e7"
def katT122 : ByteString := ofHex "aa23501a91eace5d6cbaa6464b7e16f89d9657fa06c942f7c00785b063dff578438270b1ecf9da3a66591e94363fb2cd"
def katC22 : ByteString := ofHex "e9b5ec3c3c075a95275a48f1af27b26949e2ef35c76f0b3764e41897db609b68"
def katZ22 : ByteString := ofHex "0a1c2b53ce72eaa4b40e045442d7064c9a918af9ef90f00443e075dd74c2b514"
def katT023 : ByteString := ofHex "b9d97562307200fdc9c38c32d4cf58f39e7c8fd2db44642ee5d40c487a5f2ddb6e1c399f6d1e97ac40c15d2ed74d4127"
def katT123 : ByteString := ofHex "a3a807ba43556502bc42d5d3e52c169db771fceef0f05546aaa2c42d7db63dae775448ea868a6f1d9839f74c12ca9c5a"
def katC23 : ByteString := ofHex "183cb830d3463cc435c44173eeb941613b0ab269186d3a91e5336b24f4459613"
def katZ23 : ByteString := ofHex "1d5d05d97fabe39a2c19332043647bb86db03afc863e7046628232ce0cc3659d"
def katT031 : ByteString := ofHex "a8c9e7cd9f063f84d05df810761a57e9a9e099957f8d7fed3ce3043d335eeb56d4311ffb4c3d4eac3a17982fe27fe745"
def katT131 : ByteString := ofHex "b08a69db101177f5f255789e8ff6d5210d1d032b86f36f2ea0d8663cc3c3f9c4e83735f76895d1f4e2b1cf1c8f3f20d5"
def katC31 : ByteString := ofHex "29a0a216306c0a165b88103d60e9a577ec0cc9e64000c4559f4d378ee8019e56"
def katZ31 : ByteString := ofHex "5121752cd18be550a9dc817d22998dd9930244b1991118b66475e67cb6dc259f"
def katT032 : ByteString := ofHex "a16875a3035e0a29cb9d3e089f262bf379c065770d7ed7528998d13b2e900c9b588343ac5a1d1bb651349122551ea2e2"
def katT132 : ByteString := ofHex "802154e5ebb2ed0cc4fda1b2659123d5e48aacc4d750411e93efb2a55849bad711eb9851fe29f223d9d08d5c44832b40"
def katC32 : ByteString := ofHex "24598a8435880e33c686caaccae123869b0ad446d0272cf156fa21ebacf1beeb"
def katZ32 : ByteString := ofHex "1cf69281e1b72bf0bba7b11b1bf515d00ad77dba4f54796803f47828b8cedf73"
def katT033 : ByteString := ofHex "91c422a97f0625011019847772d1ad395d5d2621be79f2fce35067de2a6ee8da8c9475d5d7f74059806c81922ae716e5"
def katT133 : ByteString := ofHex "b7be88877f18d297d16a45a16c05b093695d88d087954e575004bec7dd3fe57b9c49cf1ea908fb1fac8b5c99222f6eb5"
def katC33 : ByteString := ofHex "5c8fc07dc1806c4865a43a4b630238ec66ff8ed9eafb31bce17fc872ada04ed9"
def katZ33 : ByteString := ofHex "384f5c18270dc9376163d2f8207f08e5e8f4d4818da6dd9a7e4fcda95995cb69"

end Lovejoin.V2.Any3
