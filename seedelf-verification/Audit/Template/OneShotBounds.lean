import Lovejoin.Template.OneShotMint
import Blaster

/-! Boundary mutants for `nft_needs_a_sane_datum`: each moves one bound of the sane condition by
one, so the mutant claims a datum the script accepts fails. With the vacuity check and a
conclusion flip, every check is expected Falsified: **this module must print
5 "✅ Expected Falsified" lines**.

- [F-V1] The theorem's hypothesis (an insane datum) can hold.
- [F-B1] The fee cap below `bl - 1` instead of below `bl`: a cap of `bl - 1` is sane.
- [F-B2] The token quantity strictly below 2⁶⁴ − 1: the maximum itself is sane.
- [F-B3] A token name of at most 31 bytes: 32 is sane.
  A Valid one would mean the theorem doesn't pin that bound where the script puts it.
- [F-F1] `nft_is_one_token_named_lovejoin` concluding `isSuccessful`. -/

namespace Audit.Template
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)

-- [F-V1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (bl : Integer) (tp tn : ByteString) (tq mf : Integer),
  ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
      ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
        (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq ≤ 18446744073709551615))) →
    False]

-- [F-B1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
  ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl - 1 ∧
      ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
        (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq ≤ 18446744073709551615))) →
    isUnsuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf)]

-- [F-B2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
  ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
      ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
        (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq < 18446744073709551615))) →
    isUnsuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf)]

-- [F-B3]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
  ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
      ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
        (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 31 ∧ tq > 0 ∧ tq ≤ 18446744073709551615))) →
    isUnsuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf)]

-- [F-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
  (nm ≠ nftName ∨ qty ≠ 1) → isSuccessful (appliedNftAmount.prop s i rh P nm qty)]

end Audit.Template
