import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of 4 boxes, for any v2 ADA pool and any boxes: `V2.MixAny`'s scenario at
n = 4. The pool's NFT policy `P`, its mix_box `M`, its
box value `bl` and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `ada_n4_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.MixAny4Steps`. -/

namespace Lovejoin.V2.Any4
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

/-- A Mix of 4 boxes in, `(a1, b1)` to `(a4, b4)`, into 4 out, `(oa1, ob1)` to `(oa4, ob4)`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 a4 b4 oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxPool M bl a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxPool M bl a2 b2⟩,
                              ⟨⟨ofHex "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2", 0⟩, boxPool M bl a3 b3⟩,
                              ⟨⟨ofHex "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", 0⟩, boxPool M bl a4 b4⟩],
    txInfoReferenceInputs := [refInputPool P bl M],
    txInfoOutputs         := [boxPool M bl oa1 ob1, boxPool M bl oa2 ob2, boxPool M bl oa3 ob3, boxPool M bl oa4 ob4, change],
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
def katT011 : ByteString := ofHex "b23552c3866fc9552b0e5c5ac345f3b2ec68b03865c7fff66caf9b0a08ad8d5481e1b7a259e68c0306247943c3a3b03a"
def katT111 : ByteString := ofHex "a1db6229e550f4e716475219ac8239b28ca7a0a589720d10877de2c757804fca24a8e049306a34eeb81a5eb5799c27e0"
def katC11 : ByteString := ofHex "ea633fbaa65564671212c8aef8c3569f5691b323b6b9afda88067fbda8d4b1da"
def katZ11 : ByteString := ofHex "1f0439163749443c88312ba77bb5862782bd7b10378ef03e4498e3d16b760fe5"
def katT012 : ByteString := ofHex "99f7a56ac81cc6ca506cdc919e1cce2990dd8c49f205dff0dff6475a436c86b39414d0b097ba5f3e9da287e731e168f8"
def katT112 : ByteString := ofHex "a16156ca5dd44c5fd19b5661bceebf69f3931b24c2d5f9b3c7688ac0aa525678e3b05442a20cbb2bed5edf8cd1106b35"
def katC12 : ByteString := ofHex "129a15352aa2c0c2b622efd74326bfc03eab5ea8afb781f323c6ede1c4f5598f"
def katZ12 : ByteString := ofHex "46f3501de9bba6a62161e19bbf708c682f9a3abd24af52aa941858f42ae7d3b2"
def katT013 : ByteString := ofHex "ae20846f28f0c08297bdb8f967d8f7d1682fe6e8956d43167a389246e2f0018fce7ae3dcec10ab5e3671f92904b017f6"
def katT113 : ByteString := ofHex "91e17fac601ad08ce6b5047647415698d303e0756e871abd6d83c0607ec8eef687f5780e068e2b838b819080c7fba0a3"
def katC13 : ByteString := ofHex "532eceb66c49363352d8199b3e0a701ef3dc3fc076c6fe4abe6cae14970112df"
def katZ13 : ByteString := ofHex "0ed4df41eca0ca27aa5dc6bc78e9074d413fd20999cfb150edcb65902f86d0bd"
def katT014 : ByteString := ofHex "9588c1492a93b7ebffa6312f7f45b699031a03a0804082b3d9a912d6adaf0800374bc34e007b71b9ce5e55158c060674"
def katT114 : ByteString := ofHex "88a0fc76788a2393c73a08d03a983469a28a65d6485fa3c04c77388e689a5c28dc49addb772f82a8f695954ec9e7bdf1"
def katC14 : ByteString := ofHex "6f35df77e6f2a4eb526c795836d8d9449bca252439f23248770f2e97386959fb"
def katZ14 : ByteString := ofHex "3f5658f85e776577b8ebcd91f2f6210b0d2b199e74283e050668985704696eed"
def katT021 : ByteString := ofHex "99c5b5233b191c0fddc59bf2794f6e693d3bc8706b5d30fcfe8deb5d20a5fe1c8aff9d1e0c0b4871ef579399f43fb2a9"
def katT121 : ByteString := ofHex "adee1c28f32bb23b2c755a847ff78c2cd09f169e1a6aec5d749b949e320096d7d13110cd47fb03984de0b2546666218a"
def katC21 : ByteString := ofHex "a1b27322801812454a71383a679cd223d8e9def0ed4fdbf0a3ca2e5657a5661b"
def katZ21 : ByteString := ofHex "0c33650ccba4eb8932b303c62e528b17ba04631a380a953c2142c0818ba7a298"
def katT022 : ByteString := ofHex "b470ea8994d09ef67fe78616bc91e1dc84c5d24adaf17a717a43ce734ebe4f9e2b9a6d0847f2cc4984a766ce824fd28e"
def katT122 : ByteString := ofHex "b7b8d2392c009009f0fb528cd4c479582e6567c1b18dee2e9bdd067aee415c97ebd274ee2e19b9bd5722899e2aabc916"
def katC22 : ByteString := ofHex "99cc4afb4075484661fbf494a4ee7632d8e2dc5feb00ed8f3687899e35032ea3"
def katZ22 : ByteString := ofHex "529ffadf9850dec801c31135e9a5f1e6a1ab3a7fa750868625b7eac5a9ddf209"
def katT023 : ByteString := ofHex "a8803a426879c6432d0162cc09208dade7fb6d0a100f8cb6aac0e13954979113f411991331d93a20537981402515827b"
def katT123 : ByteString := ofHex "9971eb26ac82f30c8c6eb0866ce726fc40f02560c0f932e2fecd6515406b85a1c8a4f4aaff01cbb2c45e3dc2d186c504"
def katC23 : ByteString := ofHex "393c40e61076f4f80062c7f71d1c8f9b251434b259110feb0655baa5ebb1e270"
def katZ23 : ByteString := ofHex "5af290973cd4c6002a964552bd270ba8b4095154cd3c0a5abe3a6c61ad480adc"
def katT024 : ByteString := ofHex "abb14208536d409bfb94df3b3f9ad88dcd5a96aff9a062768aab49ce664681fd037eaef14e43b33220ec7cb526fb4f15"
def katT124 : ByteString := ofHex "8d7b14a016251d08b07fb0ffa490f7674c4ef6a26147c8d7250cb39287b2901a56568543c21375bd7c22c7bed6a596b5"
def katC24 : ByteString := ofHex "9891ffeb47544c827f86cd69ab561709f0c7fdc7eedbfd615a11c6abf4928dec"
def katZ24 : ByteString := ofHex "5af66777b47a341b3f65e44aec2af18a7315d347cf00c2da150ce968877b161d"
def katT031 : ByteString := ofHex "80e08cad46d5293f9f2e1286c51b98150ee4b06618e474d56437229752f630d6c30281416c58360fc06c765d39942438"
def katT131 : ByteString := ofHex "96e3f69b026b2092b79cc2c855cc1fe45e30db1be05f047dfda914f7405e52a3058f1875af90daeeb81c714c91d20533"
def katC31 : ByteString := ofHex "46da83f37da58728fb497a1c4e142d25d0cf576a028da36975751d1ef3a8ab4d"
def katZ31 : ByteString := ofHex "60c79afd63ff477efb1434bfdad48c60ff0eef173a5d5fd60a9cd28c4c306272"
def katT032 : ByteString := ofHex "ad9d09962128671db726e93267fe0a6faa336f8b86f5ad6745a5431311a1d84235a9cd82f3cb97c87708bb0a152d45fe"
def katT132 : ByteString := ofHex "99f12c86c899d7bbc23b549f2d9f4344719f6e0b4dfc766c8157efaaa1cb5285fa9bc2acf6c8d13d5bf458ef55b9f1c2"
def katC32 : ByteString := ofHex "639a47254cdf7b47803df95eb29b2a1a0cf65a14457855341c4d5e498b6a6cf0"
def katZ32 : ByteString := ofHex "5aa6048366befece01bc492a6d36854143395d28667c515bd97b4b7b38447208"
def katT033 : ByteString := ofHex "b404904f6bc99441af20f74e4a764d5a42c5166518607cb43289554ed1ba09b006864bf4bddc013bf596591998a1d533"
def katT133 : ByteString := ofHex "b06a4826a6aae434a2e1e498c0e7740503d067f27fba60fa400d48c482068ebf7dcee368ff740f9b1c244e14dd56ded7"
def katC33 : ByteString := ofHex "36ffd4a949f92d4fd237eda0fdb6b047e0b24907754803c25b89effa1c109af5"
def katZ33 : ByteString := ofHex "0d0e065bb86d958452abff87bc0679211590038127c46386c63cad507f6f126f"
def katT034 : ByteString := ofHex "ad9deb388bcd95c1f5e70c055e96f35547ea8b83f746b44e4676da9b2ff06f4f67676614f875c3123d99740dbfad195a"
def katT134 : ByteString := ofHex "b24e1caf47ddacc8dcbd9683fadc47583c983f2e965f3d7ab43f2186494b8b78b2f1bfac37b802349cd354609e5f7c9a"
def katC34 : ByteString := ofHex "bb1c1d6e0378ea94857a8727eade3a3358a2433a18c46a3ee03ae3352abf0361"
def katZ34 : ByteString := ofHex "01ab70de9104cac59677277a798c9e95a0a9fe0e1619b395040387accb2bd05e"
def katT041 : ByteString := ofHex "8740c80272d711441553a649f47d5960c857b6739a74da321662b0c31a1d63c300bd9a385531cc414d95583bf13ce14d"
def katT141 : ByteString := ofHex "80e02fca584a500649fc9e481fbc5471bf3ed21168a346ee39f1bd4e374e4f67329211c3260d7e60050eb8165270d251"
def katC41 : ByteString := ofHex "ada6d4afe70743668d62c8d8fc8219b6dbfa370aed6fddf371ab6caba2635786"
def katZ41 : ByteString := ofHex "54f11683632442a1237e4541cac6393cfdc503fa0ca1fe7c2c47d92049a9c690"
def katT042 : ByteString := ofHex "b9d0cbc4b24c3ebe2cf7b7ad5e27df04540c6ac9998b0bf30608ca4f088a0b52695881c9877aa7a1f7da6444a1aa422c"
def katT142 : ByteString := ofHex "a06cfa4430b4be5ce8e692696e8b47b0c57f38f760b13e2c23cc5f96fc4201201eb63b8c7d44aa95c0e22c050a398639"
def katC42 : ByteString := ofHex "adfa094bd8d31172eb330703dcd91d14184600b202c2ec17a8117c52726fb7ec"
def katZ42 : ByteString := ofHex "2ac843fe8bfbf4e1efff4457d77bae49e0d8a832f27f15c6675ea45c03c86e87"
def katT043 : ByteString := ofHex "98697313f09ba75a5d4a585dc215be9f81228df02d4e1a664669ea14d01a3b9f4c0ce3016e5b119dc715067bee0e29a1"
def katT143 : ByteString := ofHex "b4695a3b81cc53d9cfdaa596dc38efae070e1ac9167c654753cd991fb43bb4dc6904786b234bd52e8de14e394d81d8f3"
def katC43 : ByteString := ofHex "5106a2364735bc565f2357a814ced1f1eb0756e3fe740eaf6bd1fab5b5204e86"
def katZ43 : ByteString := ofHex "0d528af11831fc972d3e6c082beb7f99fd99bc27c92248d97d04b7bd29527217"
def katT044 : ByteString := ofHex "b85146bb92dd7337e094870056224ac3ecddd0d8ad56c59e43b14311d53290c67059ef990fe25508269793115d4809d3"
def katT144 : ByteString := ofHex "8f8fee0e2a639a4247cde3c342695827437de23fdb8f28a74cb9be4d22b8897e144c66b2bbd07ffbc08e3b7bfc4d1571"
def katC44 : ByteString := ofHex "5a194293b212d0ecfb6456f84478a81969088f91522ccc4bb611e3c58c5c696b"
def katZ44 : ByteString := ofHex "0cf20eebb5e93cd41378b9d1d617e163db7f144757eddde003f90d076df15bd3"

end Lovejoin.V2.Any4
