import Seedelf.Steps
import Seedelf.WalletRegister
import Audit.Seedelf.Defs

/-! Audit · Seedelf, concrete cross-checks of WalletRegister: `#guard`s by compiled evaluation of
`appliedRegister.exec` and `cekExecuteProgram`, with the crypto builtins' own implementations (no
optimizer, no solver), on Steps.lean's honest proof and wallet_register.sh's changes of it. A false
one fails the build; Steps.lean only prints. Slower than GuardsCheap: each run does BLS12-381
arithmetic in Lean. -/

namespace SeedelfAudit
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open Seedelf.V1

-- GR1 the honest proof returns unit; a changed z, another signer, and a proof bound to
-- another key each reach Error (wallet_register.sh's four runs, now checked)
#guard haltsUnitB (appliedRegister.exec g1 u0 z0 gr0 vkh0 vkh0)
#guard errorsB (appliedRegister.exec g1 u0 zChanged gr0 vkh0 vkh0)
#guard errorsB (appliedRegister.exec g1 u0 z0 gr0 vkh0 otherKey)
#guard errorsB (appliedRegister.exec g1 u0 z0 gr0 otherKey otherKey)

-- GR2 the spec agrees at the same points: true on the honest proof, false on the two changes
-- that break the proof (the other-signer run breaks `vkh = signer` instead)
#guard schnorrAccepts g1 u0 z0 gr0 vkh0
#guard !(schnorrAccepts g1 u0 zChanged gr0 vkh0)
#guard !(schnorrAccepts g1 u0 z0 gr0 otherKey)

-- GR3 the step boundary RegisterSteps pins symbolically: running at 1280, unit at 1281
#guard exhaustedB (cekExecuteProgram wallet.script (registerArgs g1 u0 z0 gr0 vkh0 vkh0) 1280)
#guard haltsUnitB (cekExecuteProgram wallet.script (registerArgs g1 u0 z0 gr0 vkh0 vkh0) 1281)

-- GR4 the longest one-signer run (another signer): running at 1305, Error at 1306 (RegisterSteps2)
#guard exhaustedB (cekExecuteProgram wallet.script (registerArgs g1 u0 z0 gr0 vkh0 otherKey) 1305)
#guard errorsB (cekExecuteProgram wallet.script (registerArgs g1 u0 z0 gr0 vkh0 otherKey) 1306)

-- GR5 two signers, the key hash second or first: unit; neither: Error (RegisterTwoSigners)
#guard haltsUnitB (cekExecuteProgram wallet.script (register2Args g1 u0 z0 gr0 vkh0 otherKey vkh0) 2500)
#guard haltsUnitB (cekExecuteProgram wallet.script (register2Args g1 u0 z0 gr0 vkh0 vkh0 otherKey) 2500)
#guard errorsB (cekExecuteProgram wallet.script (register2Args g1 u0 z0 gr0 vkh0 otherKey otherKey) 2500)

-- GR6 `appliedRegister.exec` is cekExecuteProgram on the wallet's bytes, registerArgs and 2500,
-- by definition: what the exec-form theorems (RegisterExec) are stated over. Kernel-checked.
example : appliedRegister.exec = fun g u z gr vkh signer =>
    cekExecuteProgram wallet.script (registerArgs g u z gr vkh signer) 2500 := rfl

end SeedelfAudit
