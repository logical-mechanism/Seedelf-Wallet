import Audit.Gaps.Classic.Gate2
import Lovejoin.Steps

/-! Audit (lovejoin-classic): `Gate2`'s shapes concretely, to size its limit (2000) against
`Lovejoin.Steps`' one-input runs (1029, 1060, 1089). -/

namespace Lovejoin.Classic.AuditGate
open PlutusCore.Data (Data)
open Seedelf.V1 (stepsUsed g1)

#eval s!"gate2, well-formed, none:          {stepsUsed mixBox (gate2Ctx g1 notG1 "k" [] (.Constr 0 []))}"
#eval s!"gate2, well-formed, logic second:  {stepsUsed mixBox (gate2Ctx g1 notG1 "k" [(.PubKeyCredential "c", 0), (.ScriptCredential mixLogicHash, 0)] (.I 42))}"
#eval s!"gate2, well-formed, two others:    {stepsUsed mixBox (gate2Ctx g1 notG1 "k" [(.PubKeyCredential "c", 0), (.ScriptCredential "d", 0)] (.I 42))}"
#eval s!"gate2, a = b, none:                {stepsUsed mixBox (gate2Ctx g1 g1 "k" [] (.I 42))}"

end Lovejoin.Classic.AuditGate
