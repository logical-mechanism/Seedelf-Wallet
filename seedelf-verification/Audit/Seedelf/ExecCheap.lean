import Seedelf.AlwaysFalse
import Seedelf.WalletPurpose
import Seedelf.WalletNoLock
import Blaster

/-! Audit · Seedelf, theorems over `cekExecuteProgram` itself, with no `#prep_uplc`: each is an
existing theorem restated over what `NAME.exec` is by definition (GuardsRegister GR6), so it no
longer rests on `NAME.prop` being the optimizer's faithful image of it. Blaster still optimizes the
goal, now inside the tactic. The cheap families first; RegisterExec has WalletRegister's.
EX1, EX3 and EX4 must be Valid; EX2 and EX5 must each print "✅ Expected Falsified". -/

namespace SeedelfAudit
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- EX1: always_false_always_fails, over cekExecuteProgram. -/
theorem audit_always_false_exec : ∀ (redeemer : Data) (info : ScriptInfo),
    isUnsuccessful (cekExecuteProgram alwaysFalse.script (anyPurposeArgs redeemer info) 500) := by
  blaster (timeout: 540)

-- EX2 its conclusion flipped
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (redeemer : Data) (info : ScriptInfo),
    isSuccessful (cekExecuteProgram alwaysFalse.script (anyPurposeArgs redeemer info) 500)]

/-- EX3: wallet_fails_minting, over cekExecuteProgram. -/
theorem audit_wallet_fails_minting_exec : ∀ (cs : ByteString),
    isUnsuccessful (cekExecuteProgram wallet.script (mintingArgs cs) 500) := by blaster (timeout: 540)

/-- EX4: spendable_no_datum, over cekExecuteProgram. -/
theorem audit_spendable_no_datum_exec : ∀ (z gr vkh s : ByteString),
    isSuccessful (cekExecuteProgram wallet.script (noDatumArgs z gr vkh s) 800) := by blaster (timeout: 540)

-- EX5 its conclusion flipped
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (z gr vkh s : ByteString),
    isUnsuccessful (cekExecuteProgram wallet.script (noDatumArgs z gr vkh s) 800)]

end SeedelfAudit
