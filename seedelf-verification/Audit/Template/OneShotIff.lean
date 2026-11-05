import Lovejoin.Template.OneShotMint
import Blaster

/-! The converses of one_shot_mint's failure theorems, so each scenario's condition is an iff:
the mint succeeds exactly when the theorem's hypothesis is false. Theorems, expected Valid:
**this module must print 4 "✅ Valid" lines** and build.

**Why `P ≠ ""`.** The scenarios' reference output holds 2 ₳ and the NFT `(P, lovejoin)`. With
P the empty policy (ADA's), `quantity_of(value, P, name)` finds the ADA entry first, so the
NFT is never found and every mint in the scenario fails. Aiken's evaluator on the template's
bytes agrees (this audit's scratch runs: P = "" crashes, P = `aa` and the 5 ₳ pool's policy
return unit). A real policy is 28 bytes, so this costs nothing, but it means the failure
results hold at P = "" for that reason, not theirs.

A "Goal was falsified" error names another case where the scenario fails for a reason the
original doesn't state: read its counterexample (run with `(gen-cex: 1)`). -/

namespace Audit.Template
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)

/-- `nft_is_one_token_named_lovejoin`'s converse: the right name and one token mint. -/
theorem audit_nft_amount_iff : ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
    P ≠ "" → (isSuccessful (appliedNftAmount.prop s i rh P nm qty) ↔ (nm = nftName ∧ qty = 1)) := by
  blaster (timeout: 540)

/-- `nft_needs_the_seed`'s converse: with the seed spent it mints. -/
theorem audit_nft_seed_iff : ∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
    P ≠ "" → (isSuccessful (appliedNftSeed.prop s i rh P s' i') ↔ (s' = s ∧ i' = i)) := by
  blaster (timeout: 540)

/-- `nft_lands_at_reference_holder`'s converse. -/
theorem audit_nft_place_iff : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    P ≠ "" → (isSuccessful (appliedNftPlace.prop s i rh P c st r) ↔ (c = .ScriptCredential rh ∧ st = none ∧ r = none)) := by
  blaster (timeout: 540)

/-- `nft_needs_a_sane_datum`'s converse: every sane datum mints. -/
theorem audit_nft_datum_iff : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
    P ≠ "" →
      (isSuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf) ↔
        (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
          ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
            (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq ≤ 18446744073709551615)))) := by
  blaster (timeout: 540)

end Audit.Template
