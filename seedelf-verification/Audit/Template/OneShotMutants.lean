import Lovejoin.Template.OneShotMint
import Lovejoin.Template.Steps
import Audit.Template.MutantScripts
import Audit.Classic.Common
import Blaster

/-! Mutation test for `nft_needs_the_seed`: one_shot_mint's template without `seed_consumed` in
its final `and` (`Audit.Template.MutantScripts`), on the theorems' own argument functions.
Expected: 1 `#guard` passes, **1 "✅ Expected Falsified" line and 1 "✅ Valid" line**.

- [F-M0] Concretely, at the 5 ₳ pool's parameters with the seed's index changed (the run
  `Template.Steps` shows the template refusing), the mutant mints: it is a working policy that
  lost one check, not a broken one.
- [F-M1] `nft_needs_the_seed` on the mutant. A Valid result would mean the theorem can't tell
  a policy that ignores the seed from the deployed one, so "the NFT mints once" would be unproved.
- `audit_nft_amount_holds_without_the_seed_check`: `nft_is_one_token_named_lovejoin` on the
  mutant, still Valid: the mutant kills the seed theorem and only it. -/

namespace Audit.Template
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (haltedUnitB)
open Lovejoin.Template (nftName pool5Seed rhHash pool5Policy)

#prep_uplc auditTemplateNftSeedNoSeed auditTemplateOneShotMintNoSeed Lovejoin.Template.nftSeedArgs 5000
#prep_uplc auditTemplateNftAmountNoSeed auditTemplateOneShotMintNoSeed Lovejoin.Template.nftAmountArgs 5000

-- [F-M0]
#guard haltedUnitB (auditTemplateNftSeedNoSeed.exec pool5Seed 0 rhHash pool5Policy pool5Seed 1)

-- [F-M1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
  (s' ≠ s ∨ i' ≠ i) → isUnsuccessful (auditTemplateNftSeedNoSeed.prop s i rh P s' i')]

theorem audit_nft_amount_holds_without_the_seed_check :
    ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
      (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (auditTemplateNftAmountNoSeed.prop s i rh P nm qty) := by
  blaster (timeout: 540)

end Audit.Template
