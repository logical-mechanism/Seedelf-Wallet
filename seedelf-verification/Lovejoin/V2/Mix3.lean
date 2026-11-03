import Lovejoin.V2.Mix

/-! v2 mix_logic (60294352…) on a Mix of three boxes into three, the wallet's default
width: Lovejoin's KAT `mix_real_proofs_ada_pool_n3_passes` (`mix_kat.test.ak`, at
5cc3631), as a full ScriptContext. The reference input, the change and the fee are
`V2.Mix`'s, as `run_mix` gives every KAT. The boxes in, the boxes out and the nine
branches are the n = 3 test's, written out from that file by a script and checked
against it. -/

namespace Lovejoin.V2.N3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)

/-- The points of the KAT's three boxes in: `(aIn1, bIn1)` to `(aIn3, bIn3)`. -/
def aIn1 : ByteString := ofHex "b928f3beb93519eecf0145da903b40a4c97dca00b21f12ac0df3be9116ef2ef27b2ae6bcd4c5bc2d54ef5a70627efcb7"
def bIn1 : ByteString := ofHex "a6e5f7f4d52b2042153f1a0b0bb88a116a39370408f4fee2a9bb7181f3632dee528122882050d9ec416cac2e3b260459"
def aIn2 : ByteString := ofHex "99cdf3807146e68e041314ca93e1fee0991224ec2a74beb2866816fd0826ce7b6263ee31e953a86d1b72cc2215a57793"
def bIn2 : ByteString := ofHex "8366fea2d3d7cd341ee789fa10f803e96c24ed7106e7d1fff3109d9f86fd897a3fb3352d1fc7328f3b75c7549258b89b"
def aIn3 : ByteString := ofHex "80fd75ebcc0a21649e3177bcce15426da0e4f25d6828fbf4038d4d7ed3bd4421de3ef61d70f794687b12b2d571971a55"
def bIn3 : ByteString := ofHex "8441837d1df387f43189d6e8e911cfd795489405f9deca1481f0b70d03355c9e5f6cafcc9fcdb4062ac2632f6b721fc7"

/-- The KAT's three boxes in, at `a0a0…#0`, `a1a1…#0` and `a2a2…#0`. -/
def inputs3 : List TxInInfo :=
  [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, box aIn1 bIn1⟩,
   ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, box aIn2 bIn2⟩,
   ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, box aIn3 bIn3⟩]

/-- The points of the KAT's three boxes out: `(aOut1, bOut1)` to `(aOut3, bOut3)`. -/
def aOut1 : ByteString := ofHex "845ce6fb2e8285e31f0d59f163b7837778a6034e95c4d696c50701d1c755a9e5b5ac38e835534e767caabf2f56c392db"
def bOut1 : ByteString := ofHex "9634857b10498517d2e67cabf066112bbbd4f8497ecf844bfc09b656d4e0d402d8e2e70441aafc304a316e8a883f0382"
def aOut2 : ByteString := ofHex "85b512992a9fa3d1e4be92ccd12c5525abe55079cfc70a7d1aaf6db54b475402fbb72dd4b6b2edbbc84d9112f6110a52"
def bOut2 : ByteString := ofHex "8cf8c209b63db57b5662836168336dc2c78097a98ee99c37c0374b43308e237e8061c7e6f33a469c32d57ed78a26bbe9"
def aOut3 : ByteString := ofHex "a2d25c15e557379e810ec2631ee5aafbd3b66debc2d175a9d2cc20c52730d4ffe06c063403f6549f4c12f9e17c6e5e6e"
def bOut3 : ByteString := ofHex "868eb931121f4a6505181f28259db1208367eda315ec89525f285122c118aa62a65b6c259f497b1e20534ee3f26b976d"

/-- The KAT's three boxes out, the first holding `first` lovelace (10 ₳ in the KAT). -/
def boxesOut3 (first : Integer := 10000000) : List TxOut :=
  [box aOut1 bOut1 first, box aOut2 bOut2, box aOut3 bOut3]

/-- The KAT's proofs' fields: input i's branch j is `(kat3T0ij, kat3T1ij, kat3Cij, kat3Zij)`. -/
def kat3T011 : ByteString := ofHex "ac9800eefb06e97c19ebb56b4d958a954857ec422ecab1ab563b1743a0930e40362a6b0c02dab0508e093b24708d6a86"
def kat3T111 : ByteString := ofHex "959ac0a36fcfaeeabc754ca0c1e0e4b2bcc4ea2a042ed5fb875f94ff28c225e31c6f664f24c9c939cd7404d4ebb3553c"
def kat3C11 : ByteString := ofHex "a93da59afd0dc907c8a43a0b8f2438f115bbdd28dee78d07f316d8de1da066ac"
def kat3Z11 : ByteString := ofHex "72a1e10505138ffbfd696d0b5e54a6e36e3ef77cab44e5f09ee862c0a8a91f70"
def kat3T012 : ByteString := ofHex "90c487a4b461a70b190055aa863e9667498898f9bd575a01dec83358a32e0d4e380e43529764b6f1a7f1e9ada1b4255a"
def kat3T112 : ByteString := ofHex "974570fb208006767681cfa2b2851109d7dd59357cb62900410f6ff0444af09c075f3888b09664424c1c587e6f8a5a11"
def kat3C12 : ByteString := ofHex "a60e620188f05dc04983b37f052816db48113d14a4d3b6e9a93b91e52edc90b4"
def kat3Z12 : ByteString := ofHex "354a04a15b1d5b6ae8a6006d354c5d8e12b00d53b27f0fb6b865974e7a8815d5"
def kat3T013 : ByteString := ofHex "a9b100da2b05fe38f07323d9b97a05acc496c4c1d3e0c80885095866f9b3db483ce6c3bf3916fa86cd88c74b827fdc6a"
def kat3T113 : ByteString := ofHex "8f2055f83b076d3b777fe5139cfe11f6dfa8351103ae3618f6de195eb21c86d2741f645f29609784419d5ae78a2d23ea"
def kat3C13 : ByteString := ofHex "85666ae04af1a56ea089c6b98d3c2fa18ea298ab28a84ce1c918c7ab6fb67227"
def kat3Z13 : ByteString := ofHex "63c2a66a2920f6bd2dd57ec054fe1d65d3c4f56bdd5dbe07793e20d562d09f91"
def kat3T021 : ByteString := ofHex "a34126f249d3476308cd9b52a9851ec19cf5e6ff90b43aee1aa5aac191e76a59125c2b51f0aa7f8467e93665f48bd97b"
def kat3T121 : ByteString := ofHex "b0befb650ff45126103e4c86b67fa735839e8817ec5fb3f5865dd78a6d52624d846e964fda8755e68bd0bb433e36a8ec"
def kat3C21 : ByteString := ofHex "49fda3f5220f01646c830f43a7e89566f7ed4ae6f91c11523507e2e03acdb572"
def kat3Z21 : ByteString := ofHex "08914b1ce072c717ba1e1ab6868ff7dc2870db2abd5406785573cd3b61b0fa76"
def kat3T022 : ByteString := ofHex "82e14c6811656564da0606668435859e4716f5dfcf9fbcb830b99d8cd44c27597fb07370040471d9fad20fc2537241e7"
def kat3T122 : ByteString := ofHex "aa23501a91eace5d6cbaa6464b7e16f89d9657fa06c942f7c00785b063dff578438270b1ecf9da3a66591e94363fb2cd"
def kat3C22 : ByteString := ofHex "e9b5ec3c3c075a95275a48f1af27b26949e2ef35c76f0b3764e41897db609b68"
def kat3Z22 : ByteString := ofHex "0a1c2b53ce72eaa4b40e045442d7064c9a918af9ef90f00443e075dd74c2b514"
def kat3T023 : ByteString := ofHex "b9d97562307200fdc9c38c32d4cf58f39e7c8fd2db44642ee5d40c487a5f2ddb6e1c399f6d1e97ac40c15d2ed74d4127"
def kat3T123 : ByteString := ofHex "a3a807ba43556502bc42d5d3e52c169db771fceef0f05546aaa2c42d7db63dae775448ea868a6f1d9839f74c12ca9c5a"
def kat3C23 : ByteString := ofHex "183cb830d3463cc435c44173eeb941613b0ab269186d3a91e5336b24f4459613"
def kat3Z23 : ByteString := ofHex "1d5d05d97fabe39a2c19332043647bb86db03afc863e7046628232ce0cc3659d"
def kat3T031 : ByteString := ofHex "a8c9e7cd9f063f84d05df810761a57e9a9e099957f8d7fed3ce3043d335eeb56d4311ffb4c3d4eac3a17982fe27fe745"
def kat3T131 : ByteString := ofHex "b08a69db101177f5f255789e8ff6d5210d1d032b86f36f2ea0d8663cc3c3f9c4e83735f76895d1f4e2b1cf1c8f3f20d5"
def kat3C31 : ByteString := ofHex "29a0a216306c0a165b88103d60e9a577ec0cc9e64000c4559f4d378ee8019e56"
def kat3Z31 : ByteString := ofHex "5121752cd18be550a9dc817d22998dd9930244b1991118b66475e67cb6dc259f"
def kat3T032 : ByteString := ofHex "a16875a3035e0a29cb9d3e089f262bf379c065770d7ed7528998d13b2e900c9b588343ac5a1d1bb651349122551ea2e2"
def kat3T132 : ByteString := ofHex "802154e5ebb2ed0cc4fda1b2659123d5e48aacc4d750411e93efb2a55849bad711eb9851fe29f223d9d08d5c44832b40"
def kat3C32 : ByteString := ofHex "24598a8435880e33c686caaccae123869b0ad446d0272cf156fa21ebacf1beeb"
def kat3Z32 : ByteString := ofHex "1cf69281e1b72bf0bba7b11b1bf515d00ad77dba4f54796803f47828b8cedf73"
def kat3T033 : ByteString := ofHex "91c422a97f0625011019847772d1ad395d5d2621be79f2fce35067de2a6ee8da8c9475d5d7f74059806c81922ae716e5"
def kat3T133 : ByteString := ofHex "b7be88877f18d297d16a45a16c05b093695d88d087954e575004bec7dd3fe57b9c49cf1ea908fb1fac8b5c99222f6eb5"
def kat3C33 : ByteString := ofHex "5c8fc07dc1806c4865a43a4b630238ec66ff8ed9eafb31bce17fc872ada04ed9"
def kat3Z33 : ByteString := ofHex "384f5c18270dc9376163d2f8207f08e5e8f4d4818da6dd9a7e4fcda95995cb69"

/-- `Mix { proofs }` for nine branches' fields, input by input. -/
def proofs3Redeemer (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : Data :=
  mixRedeemer
  [[branch t011 t111 c11 z11, branch t012 t112 c12 z12, branch t013 t113 c13 z13],
   [branch t021 t121 c21 z21, branch t022 t122 c22 z22, branch t023 t123 c23 z23],
   [branch t031 t131 c31 z31, branch t032 t132 c32 z32, branch t033 t133 c33 z33]]

/-- A Mix of the KAT's three boxes in: `V2.Mix`'s `mixCtx` with them. -/
def mixCtx3 (redeemer : Data) (outs : List TxOut := boxesOut3 ++ [change]) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := inputs3,
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := outs,
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- The KAT's redeemer, its own nine branches. -/
def kat3Redeemer : Data := proofs3Redeemer kat3T011 kat3T111 kat3C11 kat3Z11 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 kat3Z33

/-- The KAT's Mix. -/
def kat3Mix : ScriptContext := mixCtx3 kat3Redeemer

end Lovejoin.V2.N3
