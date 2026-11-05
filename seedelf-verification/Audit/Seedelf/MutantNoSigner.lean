import Seedelf.Steps
import Seedelf.WalletRegister
import Audit.Seedelf.Defs
import Blaster

/-! Audit · Seedelf, a near-miss wrong script: the deployed wallet with its signer check,
`list.has(transaction.extra_signatories, proof.vkh)`, replaced by `True` (one term, written by
Scripts/mutate.py from the deployed bytes' `aiken uplc decode`; never deployed). Its hex decodes
back to the mutant (Scripts/alpha.py), and Aiken's evaluator runs it as described
(Scripts/wallet_mutants.sh). The wallet's own theorem must come back Falsified on it (MS2), and
the spec without the signer conjunct Valid (MS3): the proof sees the signer check, and would have
caught a wallet without one. -/

#import_uplc auditSeedelfWalletNoSigner PlutusV3 single_cbor_hex "Audit/Seedelf/Scripts/wallet_no_signer.hex"

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.UPLC.Utils
open Seedelf.V1

#prep_uplc auditSeedelfNoSigner auditSeedelfWalletNoSigner Seedelf.V1.registerArgs 2500

-- MS1 concretely: the mutant returns unit on the honest proof signed by another key, which the
-- deployed bytes refuse (GuardsRegister GR1)
#guard haltsUnitB (auditSeedelfNoSigner.exec g1 u0 z0 gr0 vkh0 otherKey)

-- MS2 wallet_register_spend_iff on the mutant
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoSigner.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

/-- MS3: the mutant moves iff the proof checks, whoever signed. -/
theorem audit_mutant_no_signer_iff : ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (auditSeedelfNoSigner.prop g u z gr vkh signer) ↔
      schnorrAccepts g u z gr vkh = true := by blaster (timeout: 540)

end SeedelfAudit
