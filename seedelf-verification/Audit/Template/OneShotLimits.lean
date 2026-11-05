import Lovejoin.Template.OneShotMint
import Blaster

/-! one_shot_mint's template on its own argument functions with the step limit one below the
runs `Lovejoin.Template.Steps` measures at the 5 ₳ pool's parameters. Each is expected
Falsified: **this module must print 3 "✅ Expected Falsified" lines**.

- [F-L1] The mint's success at 1940 (the launch halts after 1941). `P ≠ ""` is the iff's
  hypothesis in `Audit.Template.OneShotIff`.
- [F-L2] `nft_is_one_token_named_lovejoin` at 1627 (minting two errors after 1628): a mint cut
  off there isn't `Error`, so the theorem needs its run to reach the error.
- [F-L3] `nft_needs_the_seed` at 1606 (without the seed it errors after 1607). -/

namespace Audit.Template
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)

#prep_uplc auditTemplateNftAmountAt1940 oneShotMintTemplate Lovejoin.Template.nftAmountArgs 1940
#prep_uplc auditTemplateNftAmountAt1627 oneShotMintTemplate Lovejoin.Template.nftAmountArgs 1627
#prep_uplc auditTemplateNftSeedAt1606 oneShotMintTemplate Lovejoin.Template.nftSeedArgs 1606

-- [F-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString),
  P ≠ "" → isSuccessful (auditTemplateNftAmountAt1940.prop s i rh P nftName 1)]

-- [F-L2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
  (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (auditTemplateNftAmountAt1627.prop s i rh P nm qty)]

-- [F-L3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
  (s' ≠ s ∨ i' ≠ i) → isUnsuccessful (auditTemplateNftSeedAt1606.prop s i rh P s' i')]

end Audit.Template
