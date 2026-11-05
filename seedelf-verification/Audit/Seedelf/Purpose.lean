import Seedelf.WalletPurpose
import Audit.Seedelf.Defs
import Audit.Seedelf.AlwaysTrue
import Blaster

/-! Audit · Seedelf, WalletPurpose (`wallet_fails_*`). A non-spending run reaches Error after
exactly 163 steps (Steps.lean; GuardsCheap GC2): the purpose is the first thing the wallet reads,
so every non-spending purpose takes the same path, and minting stands for all five here.
P1, P2, P4 and P6 must each print "✅ Expected Falsified"; P3 and P5 must be Valid. P5 is README
rule 3 in Lean: the purpose theorems' own context, as a spend, passes, so only the purpose fails
them. No hypotheses, so no hypothesis mutants. -/

namespace SeedelfAudit
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- `purposeArgs`' context (emptyTx, redeemer `Constr 0 [B "", B "", B ""]`) as a spend of `#0`
with no datum. -/
def spendingPurposeArgs : List Term := purposeArgs (.SpendingScript ⟨"", 0⟩ none)

#prep_uplc auditSeedelfMinting162 wallet Seedelf.V1.mintingArgs 162
#prep_uplc auditSeedelfMinting163 wallet Seedelf.V1.mintingArgs 163
#prep_uplc auditSeedelfMintingOnTrue auditSeedelfAlwaysTrue Seedelf.V1.mintingArgs 500
#prep_uplc auditSeedelfSpendingPurpose wallet SeedelfAudit.spendingPurposeArgs 500

-- P1 conclusion flip: a minting run halts
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), isSuccessful (appliedMinting.prop cs)]

-- P2 step limit one short of 163: no minting run has reached Error yet
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), isUnsuccessful (auditSeedelfMinting162.prop cs)]

/-- P3: at exactly 163 every minting run has. -/
theorem audit_wallet_minting_at_163 : ∀ (cs : ByteString),
    isUnsuccessful (auditSeedelfMinting163.prop cs) := by blaster (timeout: 540)

-- P4 wrong script: the same arguments on a script that returns unit
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (cs : ByteString), isUnsuccessful (auditSeedelfMintingOnTrue.prop cs)]

/-- P5: the purpose theorems' context as a spend with no datum returns unit. -/
theorem audit_wallet_purpose_context_spends : haltsWithUnit auditSeedelfSpendingPurpose.prop := by
  blaster (timeout: 540)

-- P6 its flip
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [isUnsuccessful auditSeedelfSpendingPurpose.prop]

end SeedelfAudit
