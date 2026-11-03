import Lovejoin.Template.Fee
import Lovejoin.Steps

/-! How many steps Blaster's CEK machine takes on concrete runs of mix_box's template, to
size the template modules' limits (see `Seedelf.Steps`). At the classic L, each line must
end as `Lovejoin.Steps`' mix_box line does, step for step: the deployed script is this
template applied to L. At v2's test launch L (`6666…`), a well-formed box moves with
that L's withdrawal and not with the classic one's.

one_shot_mint's template at the mainnet 5 ₳ pool's own parameters (its seed d4c72bc2…#0,
reference_holder) on that pool's launch, its datum as it sits on chain: it must halt.
Minting two, or without the seed, must error.

fee_contract's template at the 5 ₳ pool's NFT: a shard of 5 ₳ paying a three-box Mix's
0.8 ₳ fee under a 1 ₳ cap must halt, and a lovelace short must error. Replenished from
5 ₳ to 6 ₳, it must halt. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)
open Lovejoin.Classic (inlineBoxCtx spendBoxCtx mixDatum mixLogicHash notG1)
open Seedelf.V1 (g1)

/-- `Seedelf.V1.stepsUsed` with the script's parameters applied before the context. -/
def stepsWith (s : PlutusScript) (params : List Term) (ctx : ScriptContext) (fuel : Nat := 20000) : String :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → Nat → String
      | 0, _, n => s!"exhausted at {n}"
      | k + 1, st, n =>
        match st with
        | .Halt _ => s!"halt after {n}"
        | .Error => s!"error after {n}"
        | _ => go k (step default st) (n + 1)
    go fuel (initialState (applyParams body (params ++ [toTerm ctx]))) 0

def v2L : ByteString := Seedelf.V1.ofHex "66666666666666666666666666666666666666666666666666666666"

def atClassic := [toTerm mixLogicHash]
def atV2 := [toTerm v2L]

#eval s!"template, classic L, minting purpose:  {stepsWith mixBoxTemplate atClassic ⟨Seedelf.V1.emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"template, classic L, well-formed, none:  {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [])}"
#eval s!"template, classic L, well-formed, logic: {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"
#eval s!"template, classic L, well-formed, other: {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential "o", 0)])}"
#eval s!"template, classic L, a = b:              {stepsWith mixBoxTemplate atClassic (inlineBoxCtx (mixDatum g1 g1) [])}"
#eval s!"template, classic L, no datum:           {stepsWith mixBoxTemplate atClassic (spendBoxCtx .NoOutputDatum none [])}"
#eval s!"template, v2 L, well-formed, v2's:       {stepsWith mixBoxTemplate atV2 (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential v2L, 0)])}"
#eval s!"template, v2 L, well-formed, classic's:  {stepsWith mixBoxTemplate atV2 (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"

def pool5Seed : ByteString := Seedelf.V1.ofHex "d4c72bc25582a0e5caff6395f708cfd173535fae3c61d8ecbccbd1ad447add22"
def rhHash : ByteString := Seedelf.V1.ofHex "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4"
def pool5Policy : ByteString := Seedelf.V1.ofHex "dc6abe3b0b184e09d11cfa918f7b57cde9ea1f61c49700894d3fe117"
/-- The 5 ₳ pool's `ReferenceDatum`, decoded from its reference output (lovejoin-pools.json). -/
def pool5Datum : Data :=
  refDatum 5000000 "" "" 0 1500000 (Seedelf.V1.ofHex "91ded8d686fb9358d226b59accc894fc332b04e80749007c84bde373")
    (Seedelf.V1.ofHex "aaeb76ac5f17d60789bba6b6b9a0b825953d1685cd90de016196040d")
    (Seedelf.V1.ofHex "20aae4761e1b54e852fa7067aa0e51eee2d991346c6c9579373c330d")
def atPool5 : List Term := [toTerm pool5Seed, toTerm (0 : Integer), toTerm rhHash]

#eval s!"one_shot_mint, the 5 ₳ pool's launch:   {stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 1) (refAt rhHash pool5Policy pool5Datum))}"
#eval s!"one_shot_mint, minting two:              {stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 2) (refAt rhHash pool5Policy pool5Datum))}"
#eval s!"one_shot_mint, without the seed:         {stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 1⟩ pool5Policy (mintOf pool5Policy nftName 1) (refAt rhHash pool5Policy pool5Datum))}"

def atPool5Fee : List Term := [toTerm pool5Policy, toTerm nftName]

#eval s!"fee_contract, a Mix's fee:               {stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 threeBoxes 4200000 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"fee_contract, a lovelace short:          {stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 threeBoxes 4199999 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"fee_contract, replenished:               {stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 [] 6000000 0 none replenish)}"

end Lovejoin.Template
