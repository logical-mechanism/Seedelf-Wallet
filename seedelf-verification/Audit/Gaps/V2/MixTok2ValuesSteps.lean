import Audit.Gaps.V2.MixTok2Values
import Lovejoin.Template.Steps

/-! `V2.MixTok2Values`' shapes on Lovejoin's token KAT (2 ₳ and 1,000,000 of `3434…`'s TOKEN a
box), concretely, on mix_logic's template at the test launch. Expected: `honest` halts after
11798 steps (`V2.MixTok2OutSteps`' own); each box 1 line errors after 5103 and each
box 2 line after 5953, the steps `V2.MixTok2OutSteps`' value lines error at, before
any proof is read. Written by `gen-lovejoin-mix-values.py`. -/

namespace Lovejoin.V2.Tok2
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.Template (stepsWith nftName)

/-- The token KAT's Mix at the test launch, with its outputs given. -/
def runValues (outs : List TxOut) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 outs (proofsRedeemerPool katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 120000

#eval "Tok2 values, honest:                          " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, token withheld:           " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, another policy's token:   " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, token renamed:            " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B "TOKEM", Data.I 1000000)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, a policy before:          " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "11111111111111111111111111111111111111111111111111111111"), Data.Map [(Data.B "X", Data.I 1)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, two others, none its own: " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "11111111111111111111111111111111111111111111111111111111"), Data.Map [(Data.B "X", Data.I 1)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B "X", Data.I 1)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, a name after:             " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000), (Data.B "TOKEO", Data.I 1)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 1, a name before:            " ++ runValues [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B "AAA", Data.I 1), (Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA1 katOB1)) none, boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA2 katOB2, change]
#eval "Tok2 values, box 2, token withheld:           " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, another policy's token:   " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, token renamed:            " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B "TOKEM", Data.I 1000000)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, a policy before:          " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "11111111111111111111111111111111111111111111111111111111"), Data.Map [(Data.B "X", Data.I 1)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, two others, none its own: " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B (ofHex "11111111111111111111111111111111111111111111111111111111"), Data.Map [(Data.B "X", Data.I 1)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B "X", Data.I 1)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, a name after:             " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B tokName, Data.I 1000000), (Data.B "TOKEO", Data.I 1)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]
#eval "Tok2 values, box 2, a name before:            " ++ runValues [boxPool mixBoxHash 2000000 tokPolicy tokName 1000000 katOA1 katOB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B tokPolicy, Data.Map [(Data.B "AAA", Data.I 1), (Data.B tokName, Data.I 1000000)])] (.OutputDatum (mixDatum katOA2 katOB2)) none, change]

end Lovejoin.V2.Tok2
