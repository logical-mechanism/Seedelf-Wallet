import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 28 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister28Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
    s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5, .B s6, .B s7,
    .B s8, .B s9, .B s10, .B s11, .B s12, .B s13, .B s14, .B s15, .B s16, .B s17, .B s18, .B s19,
    .B s20, .B s21, .B s22, .B s23, .B s24, .B s25, .B s26, .B s27, .B s28])]

#prep_uplc appliedSig28 wallet anyTxRegister28Args 4460

-- The builder's own run at its own limit: the key last of 28 passes (after 3171 steps);
-- missed among 28, the longest run, it reaches Error (after 3196).
#guard endsWithUnit (appliedSig28.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13) (signerKey 14)
    (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19) (signerKey 20)
    (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25) (signerKey 26)
    (signerKey 27) vkh0)
#guard endsInError (appliedSig28.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13) (signerKey 14)
    (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19) (signerKey 20)
    (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25) (signerKey 26)
    (signerKey 27) (signerKey 28))

/-- With 28 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_28_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 : ByteString),
    isSuccessful (appliedSig28.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10 ∨ vkh = s11 ∨ vkh = s12 ∨ vkh = s13 ∨
        vkh = s14 ∨ vkh = s15 ∨ vkh = s16 ∨ vkh = s17 ∨ vkh = s18 ∨ vkh = s19 ∨ vkh = s20 ∨
        vkh = s21 ∨ vkh = s22 ∨ vkh = s23 ∨ vkh = s24 ∨ vkh = s25 ∨ vkh = s26 ∨ vkh = s27 ∨
        vkh = s28)) := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_28_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 : ByteString),
    returnsUnit (appliedSig28.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14
      s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28) ∨
      isUnsuccessful (appliedSig28.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12
        s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28) := by blaster

end Seedelf.V1
