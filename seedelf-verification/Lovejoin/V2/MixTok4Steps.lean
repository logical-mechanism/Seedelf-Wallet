import Lovejoin.V2.MixTok4Spec
import Lovejoin.Template.Steps

/-! The general Mix of 4 in a token pool (`V2.MixTok4`) against Lovejoin's KAT, concretely, on
mix_logic's template at the test launch (`abab…`, mix_box `5555…`), its token `3434…`'s TOKEN:

- The KAT must halt: the passing run the theorems pair with. Its step count sizes
  their limit, 70000. `mixAcceptsPool` on it must be `true`.
- With box in 1's first `z` changed, or box in 4's last, the template must error and
  the spec say `false`. -/

namespace Lovejoin.V2.Tok4
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def zOnePool : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

def atTestLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"Tok4, the KAT:            {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)) 120000}"
#eval s!"Tok4, mixAcceptsPool:     {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44}"
#eval s!"Tok4, z11 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 (proofsRedeemerPool katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)) 120000}, spec {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44}"
#eval s!"Tok4, z44 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 zOnePool)) 120000}, spec {mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 zOnePool}"

end Lovejoin.V2.Tok4
