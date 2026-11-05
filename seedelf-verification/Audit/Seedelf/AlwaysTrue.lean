import PlutusCore.UPLC
import Seedelf.Scenario
import Audit.Seedelf.Defs

/-! Audit · Seedelf: a control script, never deployed. `(program 1.1.0 (lam ctx (con unit ())))`
(Audit/Seedelf/Scripts/always_true.uplc), encoded by `aiken uplc encode --cbor --hex` as one CBOR
layer, the format of Seedelf/Scripts/*.hex. It returns unit on anything: the wrong script for the
failure theorems (AlwaysFalse, Purpose). The path is relative to seedelf-verification/, as
Seedelf/Scripts.lean's are. -/

#import_uplc auditSeedelfAlwaysTrue PlutusV3 single_cbor_hex "Audit/Seedelf/Scripts/always_true.hex"

namespace SeedelfAudit
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open Seedelf.V1

-- AT1 it does return unit, by compiled evaluation
#guard haltsUnitB (cekExecuteProgram auditSeedelfAlwaysTrue.script
  [toTerm (⟨emptyTx, Data.I 0, .MintingScript ""⟩ : ScriptContext)] 500)

end SeedelfAudit
