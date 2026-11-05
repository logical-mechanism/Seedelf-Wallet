import Seedelf.Steps
import Seedelf.AlwaysFalse
import Seedelf.WalletPurpose
import Seedelf.WalletNoLock
import Seedelf.PolicyAmount
import Seedelf.PolicyForeign
import Audit.Seedelf.Defs

/-! Audit · Seedelf, concrete cross-checks without crypto: `#guard`s by compiled evaluation of
`NAME.exec` and `cekExecuteProgram` (no optimizer, no solver). A false one fails the build;
Steps.lean only prints. Each pins a fact a symbolic check in the suite relies on. -/

namespace SeedelfAudit
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open Seedelf.V1

-- GC1 always_false: still running after 99 steps, Error at 100 (AlwaysFalse AF2/AF3)
#guard exhaustedB (cekExecuteProgram alwaysFalse.script (anyPurposeArgs (.I 0) (.MintingScript "")) 99)
#guard errorsB (cekExecuteProgram alwaysFalse.script (anyPurposeArgs (.I 0) (.MintingScript "")) 100)

-- GC2 the wallet on a minting purpose: running at 162, Error at 163 (Purpose P2/P3)
#guard exhaustedB (cekExecuteProgram wallet.script (mintingArgs "") 162)
#guard errorsB (cekExecuteProgram wallet.script (mintingArgs "") 163)

-- GC3 no datum: running at 359, unit at 360 (NoLock NL3/NL4)
#guard exhaustedB (cekExecuteProgram wallet.script (noDatumArgs "\x01" g1 "k" "k") 359)
#guard haltsUnitB (cekExecuteProgram wallet.script (noDatumArgs "\x01" g1 "k" "k") 360)

-- GC4 Constr 0 [B, B, B]: running at 596, unit at 597 (NoLock NL5/NL6)
#guard exhaustedB (cekExecuteProgram wallet.script (fields3Args (.B g1) (.B g1) (.B g1) [] "\x01" g1 "k" "k") 596)
#guard haltsUnitB (cekExecuteProgram wallet.script (fields3Args (.B g1) (.B g1) (.B g1) [] "\x01" g1 "k" "k") 597)

-- GC5 PolicyAmount's own scenario: a burn of one passes, but a mint of one fails, since its
-- name 5eed0e1f01 isn't generate's for "\x01"#0. The survivor PA3 rests on this.
#guard haltsUnitB (appliedAmount.exec (-1))
#guard errorsB (appliedAmount.exec 1)
#guard errorsB (appliedAmount.exec 2)

-- GC6 goodName is the name generate gives (the spec's own `seedelfName`), and with it a mint of
-- one and a burn of one pass and a mint of two fails (PolicyAmountGood)
#guard seedelfName "\x01" 0 "" == some goodName
#guard haltsUnitB (cekExecuteProgram seedelf.script (amountGoodArgs 1) 1500)
#guard haltsUnitB (cekExecuteProgram seedelf.script (amountGoodArgs (-1)) 1500)
#guard errorsB (cekExecuteProgram seedelf.script (amountGoodArgs 2) 1500)
#guard errorsB (cekExecuteProgram seedelf.script (amountGoodArgs 0) 1500)

-- GC7 PolicyForeign's mint scenario fails even under the policy's own id (the survivor PF1); its
-- burn scenario passes under it (PF6); with goodName, the mint passes under "p" only
#guard errorsB (appliedForeignMint.exec "p")
#guard haltsUnitB (appliedForeignBurn.exec "p")
#guard haltsUnitB (cekExecuteProgram seedelf.script (foreignMintGoodArgs "p") 1500)
#guard errorsB (cekExecuteProgram seedelf.script (foreignMintGoodArgs "q") 1500)

end SeedelfAudit
