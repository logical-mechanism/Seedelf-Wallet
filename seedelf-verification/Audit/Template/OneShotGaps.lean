import Lovejoin.Template.OneShotMint
import Audit.Classic.Common
import Blaster

/-! Gaps in one_shot_mint's template theorems, closed for their scenarios. Theorems, expected
Valid: **this module must print 7 "✅ Valid" lines** and build.

- `audit_nft_*_runs_end` (4): every run of each scenario ends within 5000 steps, so the iffs in
  `Audit.Template.OneShotIff` hold for every input, not only runs that finish.
- `audit_nft_amount_halts_with_unit`, `audit_nft_datum_halts_with_unit`: every halt is unit.
- `audit_nft_amount_fails_on_exec`: `nft_is_one_token_named_lovejoin` over
  `appliedNftAmount.exec` (see `Audit.Classic.OwnerExec`). -/

namespace Audit.Template
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (HaltsWithUnit)
open Lovejoin.Template (nftName)

theorem audit_nft_amount_runs_end : ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
    isSuccessful (appliedNftAmount.prop s i rh P nm qty) ∨ isUnsuccessful (appliedNftAmount.prop s i rh P nm qty) := by
  blaster (timeout: 540)

theorem audit_nft_seed_runs_end : ∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
    isSuccessful (appliedNftSeed.prop s i rh P s' i') ∨ isUnsuccessful (appliedNftSeed.prop s i rh P s' i') := by
  blaster (timeout: 540)

theorem audit_nft_place_runs_end : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    isSuccessful (appliedNftPlace.prop s i rh P c st r) ∨ isUnsuccessful (appliedNftPlace.prop s i rh P c st r) := by
  blaster (timeout: 540)

theorem audit_nft_datum_runs_end : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
    isSuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf) ∨
      isUnsuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf) := by
  blaster (timeout: 540)

theorem audit_nft_amount_halts_with_unit : ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
    isSuccessful (appliedNftAmount.prop s i rh P nm qty) → HaltsWithUnit (appliedNftAmount.prop s i rh P nm qty) := by
  blaster (timeout: 540)

theorem audit_nft_datum_halts_with_unit : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
    isSuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf) →
      HaltsWithUnit (appliedNftDatum.prop s i rh P bl tp tn tq mf) := by
  blaster (timeout: 540)

theorem audit_nft_amount_fails_on_exec : ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
    (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (appliedNftAmount.exec s i rh P nm qty) := by
  blaster (timeout: 540)

end Audit.Template
