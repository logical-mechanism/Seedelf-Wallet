import Lovejoin.V2.MixTok2Spec
import Lovejoin.Template.Steps

/-! The general Mix of 2 in a token pool (`V2.MixTok2`) against Lovejoin's KAT, concretely, on
mix_logic's template at the test launch (`abab…`, mix_box `5555…`), its token `3434…`'s TOKEN:

- The KAT must halt: the passing run the theorems pair with. Its step count sizes
  their limit, 25000. `mixAcceptsPool` on it must be `true`.
- With box in 1's first `z` changed, or box in 2's last, the template must error and
  the spec say `false`. -/

namespace Lovejoin.V2.Tok2
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def zOnePool : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

def atTestLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"Tok2, the KAT:            {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 120000}"
#eval s!"Tok2, mixAcceptsPool:     {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"
#eval s!"Tok2, z11 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 (proofsRedeemerPool katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 120000}, spec {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"
#eval s!"Tok2, z22 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOnePool)) 120000}, spec {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOnePool}"

end Lovejoin.V2.Tok2
