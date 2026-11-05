import Lovejoin.Template.OneShotMint
import Blaster

/-! Negative controls for one_shot_mint's template (`Lovejoin.Template.OneShotMint`). Its five
theorems are all failures (`isUnsuccessful`): a mint fails unless … . A failure theorem is
empty if its scenario fails anyway, so each needs a run that passes beside it (README rule 3);
here that run is symbolic. Every check is expected Falsified: **this module must print
8 "✅ Expected Falsified" lines**.

- [F-P1..4] Positive controls: each scenario has a run that halts (`¬ isSuccessful` for every
  input is false). [F-P1]'s scenario is also `nft_is_alone_under_its_policy`'s with one name
  instead of two, so it is that theorem's passing run too. A Valid one means the failure theorem
  on that scenario holds because nothing in it can pass.
- [F-H1..4] Each failure hypothesis replaced by a near miss the script doesn't check: the name
  `lovejoim`, a quantity other than 2, an index other than i + 1, reference_holder's hash
  replaced by the policy's. A Valid one would mean the theorem's hypothesis isn't what decides. -/

namespace Audit.Template
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)

-- [F-P1] nft_is_one_token_named_lovejoin's (and nft_is_alone_under_its_policy's) scenario can pass.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
  ¬ isSuccessful (appliedNftAmount.prop s i rh P nm qty)]

-- [F-P2] nft_needs_the_seed's scenario can pass.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
  ¬ isSuccessful (appliedNftSeed.prop s i rh P s' i')]

-- [F-P3] nft_lands_at_reference_holder's scenario can pass.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
  ¬ isSuccessful (appliedNftPlace.prop s i rh P c st r)]

-- [F-P4] nft_needs_a_sane_datum's scenario can pass.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
  ¬ isSuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf)]

-- [F-H1] nft_is_one_token_named_lovejoin with the name `lovejoim`.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
  (nm ≠ ("lovejoim" : ByteString) ∨ qty ≠ 1) → isUnsuccessful (appliedNftAmount.prop s i rh P nm qty)]

-- [F-H2] nft_is_one_token_named_lovejoin with the quantity 2.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
  (nm ≠ nftName ∨ qty ≠ 2) → isUnsuccessful (appliedNftAmount.prop s i rh P nm qty)]

-- [F-H3] nft_needs_the_seed with the index i + 1.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
  (s' ≠ s ∨ i' ≠ i + 1) → isUnsuccessful (appliedNftSeed.prop s i rh P s' i')]

-- [F-H4] nft_lands_at_reference_holder with the policy's hash for reference_holder's.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
  (c ≠ .ScriptCredential P ∨ st ≠ none ∨ r ≠ none) → isUnsuccessful (appliedNftPlace.prop s i rh P c st r)]

end Audit.Template
