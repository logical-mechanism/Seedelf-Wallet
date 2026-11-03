import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of 4 boxes, for any v2 token pool and any boxes: `V2.MixAny`'s scenario at
n = 4, its boxes holding the pool's token too. The pool's NFT policy `P`, its mix_box `M`, its
box value (lovelace `bl`, and `tq` of the token `(tp, tn)`) and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `token_n4_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.MixTok4Steps`. -/

namespace Lovejoin.V2.Tok4
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

/-- A Mix of 4 boxes in, `(a1, b1)` to `(a4, b4)`, into 4 out, `(oa1, ob1)` to `(oa4, ob4)`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl tp tn tq a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl tp tn tq a2 b2⟩,
                              ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, boxPool M bl tp tn tq a3 b3⟩,
                              ⟨⟨ofHex "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", 0⟩, boxPool M bl tp tn tq a4 b4⟩],
    txInfoReferenceInputs := [refInputPool P bl tp tn tq M],
    txInfoOutputs         := [boxPool M bl tp tn tq oa1 ob1, boxPool M bl tp tn tq oa2 ob2, boxPool M bl tp tn tq oa3 ob3, boxPool M bl tp tn tq oa4 ob4, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Mix { proofs }`, input i's branch j `(t0ij, t1ij, cij, zij)`. -/
def proofsRedeemerPool (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t014 t114 c14 z14 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t024 t124 c24 z24 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 t034 t134 c34 z34 t041 t141 c41 z41 t042 t142 c42 z42 t043 t143 c43 z43 t044 t144 c44 z44 : ByteString) : Data :=
  mixRedeemer
  [[branch t011 t111 c11 z11, branch t012 t112 c12 z12, branch t013 t113 c13 z13, branch t014 t114 c14 z14],
   [branch t021 t121 c21 z21, branch t022 t122 c22 z22, branch t023 t123 c23 z23, branch t024 t124 c24 z24],
   [branch t031 t131 c31 z31, branch t032 t132 c32 z32, branch t033 t133 c33 z33, branch t034 t134 c34 z34],
   [branch t041 t141 c41 z41, branch t042 t142 c42 z42, branch t043 t143 c43 z43, branch t044 t144 c44 z44]]

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
def katA4 : ByteString := ofHex "851f8a0b82a6d86202a61cbc3b0f3db7d19650b914587bde4715ccd372e1e40cab95517779d840416e1679c84a6db24e"
def katB4 : ByteString := ofHex "acc19711366e78a785b19c2e8c4e5833d6fe6e2589f18f10d6dff042d212eb4146a32cf62f2fbdb9d7a2ba3c3ec96fc8"
def katOA1 : ByteString := ofHex "95412cdf4aa7dcb9b28dd93605ef197e9704536523b1e919f523d6831c3c640b057da5321a21d018606d8cad818c0d8e"
def katOB1 : ByteString := ofHex "99c6ac3afef39ddf770df07647feaf2f961d4e7290f2089b9996ca0ffe7ca7913d149e7c392273e4aea68af34f6a90e9"
def katOA2 : ByteString := ofHex "85b512992a9fa3d1e4be92ccd12c5525abe55079cfc70a7d1aaf6db54b475402fbb72dd4b6b2edbbc84d9112f6110a52"
def katOB2 : ByteString := ofHex "8cf8c209b63db57b5662836168336dc2c78097a98ee99c37c0374b43308e237e8061c7e6f33a469c32d57ed78a26bbe9"
def katOA3 : ByteString := ofHex "a2d25c15e557379e810ec2631ee5aafbd3b66debc2d175a9d2cc20c52730d4ffe06c063403f6549f4c12f9e17c6e5e6e"
def katOB3 : ByteString := ofHex "868eb931121f4a6505181f28259db1208367eda315ec89525f285122c118aa62a65b6c259f497b1e20534ee3f26b976d"
def katOA4 : ByteString := ofHex "845ce6fb2e8285e31f0d59f163b7837778a6034e95c4d696c50701d1c755a9e5b5ac38e835534e767caabf2f56c392db"
def katOB4 : ByteString := ofHex "9634857b10498517d2e67cabf066112bbbd4f8497ecf844bfc09b656d4e0d402d8e2e70441aafc304a316e8a883f0382"
def katT011 : ByteString := ofHex "92c19128f09f860a4c36a4a48f62ff081da2784366eb76efb9c1e52ecd35362e190877540008f788bbcbaee4cfa82b29"
def katT111 : ByteString := ofHex "aaca5382f42442a09abae789d05d2b26bc2d7a43419fbd778a775716dd2c3700c0b30beb54e786f27662db4cd64eb168"
def katC11 : ByteString := ofHex "3f6dd209c99cb53405756e93a6d275a01c966b5500f4bcc44aedb34f6134adb2"
def katZ11 : ByteString := ofHex "67ba830fd594982347a0e9b9350e93839bd59b372735945b667caff489513881"
def katT012 : ByteString := ofHex "97968af308acd3228106f65a7ed4cc57217e37ce129bf525c6d06cf72f8e7cbdc64552501ab492d762743fc9f0a44765"
def katT112 : ByteString := ofHex "8eb0ee2d34eb21357cc67caa1e364b36e1f8b1da54a292392e125ede43b440a8c6c07f496794b8d53e328befb2d284a5"
def katC12 : ByteString := ofHex "e50f7d24ec815f6646c12b442593a4231b288a79d4e779bd057f25c539d59a5d"
def katZ12 : ByteString := ofHex "17d73c3e1807cce18cb80a8f5c341b1826f6baa463d9a3e6dd2b863c750f6374"
def katT013 : ByteString := ofHex "8cbd0c9586cacb3c31143ec271544250cc9286fb0caf76c30b93b9951f948cdf7e4de3c46028ab5bec578af2f6bca830"
def katT113 : ByteString := ofHex "982626142a690b10ca0cdb45b77f2aaf765b0c95bb9ff005623f7c7a03c2fde62b17b37dcfee11d199b0b3487af463f8"
def katC13 : ByteString := ofHex "ec67db8f6ab1d87d6b655c1fd954443bef851fd6315e2a3124c2fb8ddc761ea1"
def katZ13 : ByteString := ofHex "011326462c11979f529fd0e93fb94409fce61f70add11d14ec13b1cc387f29ca"
def katT014 : ByteString := ofHex "a2db9688e037d76b128d7162569359a064ad6795fbcc50ca22c012ccf09f8801b1a9b3194b358f5234b070222128e6c8"
def katT114 : ByteString := ofHex "ac2a1e2f111b3452abda580a8bfc1fbee9b69c8f1f2c8d674d7cdc45f6e1c626e7b67d73a590535931ab5420121a12a8"
def katC14 : ByteString := ofHex "b565e7062d84678073ebeacbe418e965a8ee2f795f836cbfbc7def9fea8377c7"
def katZ14 : ByteString := ofHex "2379e551465889c3b857e5c86ffe857c7bdb81a26ab4849668f003bb9c5e0b68"
def katT021 : ByteString := ofHex "ad900b7943d48e1d4a74989ddd3103f0d02eb17fb6479af40a7e447c599932fe9d3654db0d160ebd6c07a4b1c422ff01"
def katT121 : ByteString := ofHex "8a9d1627aa617d3edbab8a8c3ddc07ffb86eeadd277dcfa9ec0ccd047500e704c798129df1fd75ce1d29c5b684123e67"
def katC21 : ByteString := ofHex "ec77e26f6685aa259660b9b223603b4b29612746ca1c8819cd9cf208c1a662f1"
def katZ21 : ByteString := ofHex "1aa4a894b5b286ce503aad85cdf9586beabf5f95637bf4bea1d9b2dd4520392d"
def katT022 : ByteString := ofHex "a1df1f1de637beb6d8d1706636176a105119ee2e1de06102f8d86fdfc8a58d757561485b70fef758d733baa25dd9c63e"
def katT122 : ByteString := ofHex "ad86f62215ae98df17c657f223e95bc781e57ba5f212e3538b08f6097f2a980559654d0163d6532e0d5e1d974463ba2a"
def katC22 : ByteString := ofHex "d4709286f2fc90ea37d7c029a4fbc47ff4a6c68bb1e67e36b77f0abc37c53b3a"
def katZ22 : ByteString := ofHex "4a789afc6ea5f9cc42985872277fc207b0c64ab7252ec522c107f0b42a5909a5"
def katT023 : ByteString := ofHex "ae667c715d0fb352e2a63375fc0a9b5f61d29098aae3dfbbe601996f0f2a8a87c4e0ddc2337496ecd8495238be938657"
def katT123 : ByteString := ofHex "ac13cc486f13bcf3489d9216bbf62c404c6bf29111f441a1c08be783165175140e484f63c98b50692235569dcdea5e55"
def katC23 : ByteString := ofHex "008cc509ee911fc19c367b48bde2604a0a2d600559efc60cb1731ffed2a4e26d"
def katZ23 : ByteString := ofHex "09429d0c86aa82ce93ac0906fb03609f771353924ea3018cd1486d9c8d40b6df"
def katT024 : ByteString := ofHex "9844a97a147588819d4550cf757a631f8be353b4b5d9adb14025727a207cbf5deba9c981a647874b0624f7d85c24c0dd"
def katT124 : ByteString := ofHex "afdf8a37d34e8bfbd7fd785f10c54f5b662f43c1fdebb61344e942a506c40e7edc87be31a17c146f333e73fc256596c5"
def katC24 : ByteString := ofHex "bdf8528360a197e3a7fc4706620f72e57bdff845892ac5b0521dc18c0b944c59"
def katZ24 : ByteString := ofHex "68fde06805ce027c441a274237457f0f177e9c0bc0dab806acf674df5361ea56"
def katT031 : ByteString := ofHex "95138cc686ab129134a1dfb3a94a2e674473b877e241a7a287428f58be1804d1add24438f8a9a8f3aee35764c9b3544c"
def katT131 : ByteString := ofHex "a8ca6cd0b0ff7c155318e94b5176eef4a96003e05b09fc2c42be94d355faa595d9a65b01a1f2596b29e373d79155d531"
def katC31 : ByteString := ofHex "ada689cd9e1182f36e6cba16bdf3b24f7f9ee0467d4cc4fe1a7f4fb300bc11ee"
def katZ31 : ByteString := ofHex "12729cca1f22bd7d0d391f6ae420d341ba5ab5db1c5795bb16c7dfcda53f523c"
def katT032 : ByteString := ofHex "b91024e6e08a441f64cb708edcc5bdf0781f5f40ebd11cac9a98d0d7c53ff8f64007c8985badcee7f5d493bd53fbaf37"
def katT132 : ByteString := ofHex "aa7bc64c7827ef8b93d26b5ccb0084b5af2689149ab8a0232136700e144131bedd6ee01daee25e425fb0702cde488366"
def katC32 : ByteString := ofHex "a1e58966ce254f0bf9c4988ba59c1ca5c300bdeed8ee0f5983908f381818064e"
def katZ32 : ByteString := ofHex "1d270443ae07b5fd1c5088ecb19bea4d001dd294919dc024b7b7ec8a9bbdf711"
def katT033 : ByteString := ofHex "8071cfba0c60a2990d25a00242d0ade6db8f088494d3e8b3db252208a09a90afa51d162443bd5f867c7883ba44e1a612"
def katT133 : ByteString := ofHex "99747fb543d578f7f60bab923a20fd96f02fe1cd9bd158cc84f3341fb34e55ec5ec6f1e1a6a8a2712b3747a6f0af074a"
def katC33 : ByteString := ofHex "b7ac1de3d6dd870029f1e3275f8c898005f22491779fee4cbe9379b02ff44b43"
def katZ33 : ByteString := ofHex "279614bc70fd56bc3f87fed8e828964a29024db5d146619520c461bb5e32e388"
def katT034 : ByteString := ofHex "82218c647a56747773e6e8836e4b0e62142fd891905f7cd5d5b053786c697548feff61d737d6a7e2e4f76e051690935d"
def katT134 : ByteString := ofHex "b926f1d86841e92fb4ec97b5366cfd0bb1049d7347301924dda14f33e3e2f720c4fd95b37f35a2cd8670bbaae1b0b9c5"
def katC34 : ByteString := ofHex "24ab68e069bbef4a97bc411ca2c5bd79e5693b925cb3a4589d65575d29a1d369"
def katZ34 : ByteString := ofHex "1601866af017fec834a50a06706c4712e7e88c0f8389bd809ff6f116e1467bd6"
def katT041 : ByteString := ofHex "91a61a867630ce6b622ee3c568601aabb2191bb77af77e472c3df425ff77cd0c30b57a5c510dd7d8f0a7fa210f77ff6b"
def katT141 : ByteString := ofHex "b4e48880d0b6f83b54551db6563db8488bd671af4ab23a8d2d5d672bd843ccfe7e996299695124cc019c79764b1e8147"
def katC41 : ByteString := ofHex "4279af532098b21bbbb3e6f7cfd5048034167c4114b5c893f44aacb7b6d9a9d9"
def katZ41 : ByteString := ofHex "10c85a111d0552712835056124b09be70d6c9f597e9095d2a828f9a01f69e850"
def katT042 : ByteString := ofHex "b0bf480bfb3c07bab91a618abdce0f0ad834ff881d29aa983d73dc72dca7dae24641fb255dba441a63656d7f01e2e610"
def katT142 : ByteString := ofHex "b2964499055ed196407498c030ba50e058974bd64f80066217d06b093dad1722d15fdb0e60bbf35ff586983218b9cc49"
def katC42 : ByteString := ofHex "16ab88e8f84c2abb4173d9f5b938fa4fb2595438601b1facd27e4c69313ec50e"
def katZ42 : ByteString := ofHex "71bdce23639ab56bb636879b064042a4ecec6eed97ebcca95e732ea2630b6f45"
def katT043 : ByteString := ofHex "8b358108f01c5f83f68ba644ae65ca449126d6ece1a5954aaaae67911017cd164237dd0fa521a6908776b12a775aa89a"
def katT143 : ByteString := ofHex "a697fe889e2e5d1f84bc6d6f08dd3512eb38a9283bb4b476e2ab0424f414b539f69790b27c1218d9910914cbd3f7d7aa"
def katC43 : ByteString := ofHex "820e3082209cd17b8e5d1fe289e1a671f658a29e51d7295c8e127447f2347981"
def katZ43 : ByteString := ofHex "311415039f77723ec330b0e96f0a44a969aa896ec933ea48998d8c75127e759e"
def katT044 : ByteString := ofHex "b024a96f9bf2cc802740a46ebdfce3f03aff3b0002e3e8b13c94901a57cf0cf30f30c66c9dfcb932de95b7ffa0164407"
def katT144 : ByteString := ofHex "86b56883a056dd8130a9fd008d3319f1b7f3192e432744556db899f4ab12a7656419fff3f3396171f5680816e858b874"
def katC44 : ByteString := ofHex "c8a23c4da4439da754868a9cdc356ed7d899c3da8c656e696e536443713917fb"
def katZ44 : ByteString := ofHex "41bb57312e34f5e59bc80ee7d4c7e957024a492e40be04c10d571c2d4c7bb73d"

end Lovejoin.V2.Tok4
