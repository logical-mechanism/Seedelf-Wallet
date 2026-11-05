import Audit.Gaps.V2.GapMixShapes
import Lovejoin.Template.Steps

/-! `V2.GapMixShapes`' shapes as box out 1's datum, concretely, on mix_logic's template at the
test launch with the KAT's proofs: each must error, before any proof is read (as
`V2.MixAnyOutSteps`' `box 1 a = b` errors after 5136). Aiken's evaluator, on the same bytes
and contexts, crashes each at about 90M CPU of the honest run's 2.75B, and as box out 2's
at about 226M (the audit's `run_mix_shapes_ada.py`). -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Lovejoin.Template (stepsWith nftName)

/-- The KAT's Mix at the test launch with box out 1's datum `d`, inline. -/
def gapShapeRun (d : Data) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
      [outWith (.ScriptCredential mixBoxHash) none (boxPairs 10000000) (.OutputDatum d) none,
       boxAny mixBoxHash 10000000 outA2 outB2, change] katRedeemer) 120000

#eval "gap shape, Bytes:        " ++ gapShapeRun (.B outA1)
#eval "gap shape, Int:          " ++ gapShapeRun (.I 7)
#eval "gap shape, List:         " ++ gapShapeRun (.List [.B outA1, .B outB1])
#eval "gap shape, Map:          " ++ gapShapeRun (.Map [])
#eval "gap shape, ConstrPos:    " ++ gapShapeRun (.Constr 1 [.B outA1, .B outB1])
#eval "gap shape, ConstrNeg:    " ++ gapShapeRun (.Constr (Int.negSucc 0) [.B outA1, .B outB1])
#eval "gap shape, Fields0:      " ++ gapShapeRun (.Constr 0 [])
#eval "gap shape, Fields1:      " ++ gapShapeRun (.Constr 0 [.B outA1])
#eval "gap shape, Fields3:      " ++ gapShapeRun (.Constr 0 [.B outA1, .B outB1, .I 0])
#eval "gap shape, FirstConstr:  " ++ gapShapeRun (.Constr 0 [.Constr 0 [], .B outB1])
#eval "gap shape, FirstMap:     " ++ gapShapeRun (.Constr 0 [.Map [], .B outB1])
#eval "gap shape, FirstList:    " ++ gapShapeRun (.Constr 0 [.List [], .B outB1])
#eval "gap shape, FirstI:       " ++ gapShapeRun (.Constr 0 [.I 1, .B outB1])
#eval "gap shape, SecondConstr: " ++ gapShapeRun (.Constr 0 [.B outA1, .Constr 0 []])
#eval "gap shape, SecondMap:    " ++ gapShapeRun (.Constr 0 [.B outA1, .Map []])
#eval "gap shape, SecondList:   " ++ gapShapeRun (.Constr 0 [.B outA1, .List []])
#eval "gap shape, SecondI:      " ++ gapShapeRun (.Constr 0 [.B outA1, .I 1])

end Lovejoin.V2.Any
