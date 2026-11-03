import Lovejoin.V2.MixAny3Spec
import Lovejoin.Template.Steps

/-! The general Mix of 3 in a ADA pool (`V2.MixAny3`) against Lovejoin's KAT, concretely, on
mix_logic's template at the test launch (`abab…`, mix_box `5555…`):

- The KAT must halt: the passing run the theorems pair with. Its step count sizes
  their limit, 40000. `mixAcceptsPool` on it must be `true`.
- With box in 1's first `z` changed, or box in 3's last, the template must error and
  the spec say `false`. -/

namespace Lovejoin.V2.Any3
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def zOnePool : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

def atTestLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"Any3, the KAT:            {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33)) 120000}"
#eval s!"Any3, mixAcceptsPool:     {mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33}"
#eval s!"Any3, z11 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 (proofsRedeemerPool katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33)) 120000}, spec {mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33}"
#eval s!"Any3, z33 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 zOnePool)) 120000}, spec {mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 zOnePool}"

end Lovejoin.V2.Any3
