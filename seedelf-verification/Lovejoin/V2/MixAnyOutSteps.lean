import Lovejoin.V2.MixAnyOut
import Lovejoin.Template.Steps

/-! `V2.MixAnyOut`'s builders against Lovejoin's KAT, concretely, on mix_logic's template at
the test launch: with the scenario's outputs (`honest`) the Mix must halt, the passing run
the theorems pair with. Each line after changes one output, as a theorem in
`V2.MixAnyOutputs` or `V2.MixAnyDatums` does, and must error. Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.Template (stepsWith nftName)

/-- The KAT's Mix at the test launch, with its outputs given. -/
def runOut (outs : List TxOut) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outs (proofsRedeemer katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 120000

#eval "Any out, honest:                " ++ runOut [boxAny mixBoxHash 10000000 outA1 outB1, boxAny mixBoxHash 10000000 outA2 outB2, change]
#eval "Any out, box 1 at a key:        " ++ runOut [outWith (.PubKeyCredential userKey) none (boxPairs 10000000) (.OutputDatum (mixDatum outA1 outB1)) none, boxAny mixBoxHash 10000000 outA2 outB2, change]
#eval "Any out, box 2 a lovelace more: " ++ runOut [boxAny mixBoxHash 10000000 outA1 outB1, outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 10000001)])] (.OutputDatum (mixDatum outA2 outB2)) none, change]
#eval "Any out, box 1 another token:   " ++ runOut [outWith (.ScriptCredential mixBoxHash) none [(Data.B "", Data.Map [(Data.B "", Data.I 10000000)]), (Data.B (ofHex "77777777777777777777777777777777777777777777777777777777"), Data.Map [(Data.B "X", Data.I 1)])] (.OutputDatum (mixDatum outA1 outB1)) none, boxAny mixBoxHash 10000000 outA2 outB2, change]
#eval "Any out, only 1 output:         " ++ runOut [boxAny mixBoxHash 10000000 outA1 outB1]
#eval "Any out, another box after:     " ++ runOut [boxAny mixBoxHash 10000000 outA1 outB1, boxAny mixBoxHash 10000000 outA2 outB2, boxAny mixBoxHash 10000000 outA1 outB1, change]
#eval "Any out, box 1 by hash:         " ++ runOut [outWith (.ScriptCredential mixBoxHash) none (boxPairs 10000000) (.OutputDatumHash (ofHex "0000000000000000000000000000000000000000000000000000000000000000")) none, boxAny mixBoxHash 10000000 outA2 outB2, change]
#eval "Any out, box 2 no datum:        " ++ runOut [boxAny mixBoxHash 10000000 outA1 outB1, outWith (.ScriptCredential mixBoxHash) none (boxPairs 10000000) .NoOutputDatum none, change]
#eval "Any out, box 1 a = b:           " ++ runOut [boxAny mixBoxHash 10000000 outB1 outB1, boxAny mixBoxHash 10000000 outA2 outB2, change]

end Lovejoin.V2.Any
