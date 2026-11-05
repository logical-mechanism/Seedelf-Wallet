import Lovejoin.V2.MixAny4Out
import Lovejoin.Template.Steps

/-! `V2.MixAny4Out`'s builders against Lovejoin's KAT, concretely, on mix_logic's template at
the test launch: with the scenario's outputs (`honest`) the Mix must halt, the passing run
the theorems pair with. Each line after changes one output, as a theorem in
`V2.MixAny4Outputs` or `V2.MixAny4Datums` does, and must error. Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Any4
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.Template (stepsWith nftName)

/-- The KAT's Mix at the test launch, with its outputs given. -/
def runOut (outs : List TxOut) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 outs (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)) 120000

#eval "Any4 out, honest:                " ++ runOut [boxPool mixBoxHash 10000000 katOA1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, change]
#eval "Any4 out, box 1 at a key:        " ++ runOut [outWith (.PubKeyCredential userKey) none (boxPairs 10000000) (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, change]
#eval "Any4 out, box 4 a lovelace more: " ++ runOut [boxPool mixBoxHash 10000000 katOA1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 10000001)])] (.OutputDatum (mixDatum katOA4 katOB4)) none, change]
#eval "Any4 out, box 1 another token:   " ++ runOut [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 10000000)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B "X", Data.I 1)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, change]
#eval "Any4 out, only 3 outputs:        " ++ runOut [boxPool mixBoxHash 10000000 katOA1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3]
#eval "Any4 out, another box after:     " ++ runOut [boxPool mixBoxHash 10000000 katOA1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, boxPool mixBoxHash 10000000 katOA1 katOB1, change]
#eval "Any4 out, box 1 by hash:         " ++ runOut [outWith (.ScriptCredential mixBoxHash) none (boxPairs 10000000) (.OutputDatumHash (ofHex "0000000000000000000000000000000000000000000000000000000000000000")) none, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, change]
#eval "Any4 out, box 4 no datum:        " ++ runOut [boxPool mixBoxHash 10000000 katOA1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, outWith (.ScriptCredential mixBoxHash) none (boxPairs 10000000) .NoOutputDatum none, change]
#eval "Any4 out, box 1 a = b:           " ++ runOut [boxPool mixBoxHash 10000000 katOB1 katOB1, boxPool mixBoxHash 10000000 katOA2 katOB2, boxPool mixBoxHash 10000000 katOA3 katOB3, boxPool mixBoxHash 10000000 katOA4 katOB4, change]

end Lovejoin.V2.Any4
