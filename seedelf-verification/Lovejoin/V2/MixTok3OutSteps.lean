import Lovejoin.V2.MixTok3Out
import Lovejoin.Template.Steps

/-! `V2.MixTok3Out`'s builders against Lovejoin's KAT, concretely, on mix_logic's template at
the test launch: with the scenario's outputs (`honest`) the Mix must halt, the passing run
the theorems pair with. Each line after changes one output, as a theorem in
`V2.MixTok3Outputs` or `V2.MixTok3Datums` does, and must error. Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Tok3
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.Template (stepsWith nftName)

/-- The KAT's Mix at the test launch, with its outputs given. -/
def runOut (outs : List TxOut) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katA3 katB3 outs (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33)) 120000

#eval "Tok3 out, honest:                " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, change]
#eval "Tok3 out, box 1 at a key:        " ++ runOut [outWith (.PubKeyCredential userKey) none (boxPairs 2000000 tokPolicy tokName 1000000) (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, change]
#eval "Tok3 out, box 3 a lovelace more: " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000001)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA3 katOB3)) none, change]
#eval "Tok3 out, box 1 another token:   " ++ runOut [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B "X", Data.I 1)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, change]
#eval "Tok3 out, only 2 outputs:        " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2]
#eval "Tok3 out, another box after:     " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, change]
#eval "Tok3 out, box 1 by hash:         " ++ runOut [outWith (.ScriptCredential mixBoxHash) none (boxPairs 2000000 tokPolicy tokName 1000000) (.OutputDatumHash (ofHex "0000000000000000000000000000000000000000000000000000000000000000")) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, change]
#eval "Tok3 out, box 3 no datum:        " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, outWith (.ScriptCredential mixBoxHash) none (boxPairs 2000000 tokPolicy tokName 1000000) .NoOutputDatum none, change]
#eval "Tok3 out, box 1 a = b:           " ++ runOut [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOB1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA3 katOB3, change]

end Lovejoin.V2.Tok3
