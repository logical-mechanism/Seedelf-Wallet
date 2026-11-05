import Seedelf.WalletRegister
import Blaster

/-! Audit · Seedelf, WalletRegister's core property over `cekExecuteProgram` itself, with no
`#prep_uplc`: the wallet's deployed bytes (`wallet.script`), `registerArgs`, 2500 steps. This is
`appliedRegister.exec` by definition (GuardsRegister GR6, kernel-checked), so the statement is about
the CEK machine on the deployed script, not about the term `#prep_uplc` stored. Blaster unfolds the
2500-step run inside the tactic, as `#prep_uplc` did; expect WalletRegister's cost or more, so give
it its own run (CAP=12G LIMIT=30m). Must be Valid. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- EX6: a Register UTxO moves iff the proof checks and the one-time key signed, over the
machine itself. -/
theorem audit_wallet_register_spend_iff_exec : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (cekExecuteProgram wallet.script (registerArgs g u z gr vkh signer) 2500) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer) := by blaster (timeout: 540)

end SeedelfAudit
