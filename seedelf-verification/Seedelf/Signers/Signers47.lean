import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 47 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister47Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
    s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35
    s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5, .B s6, .B s7,
    .B s8, .B s9, .B s10, .B s11, .B s12, .B s13, .B s14, .B s15, .B s16, .B s17, .B s18, .B s19,
    .B s20, .B s21, .B s22, .B s23, .B s24, .B s25, .B s26, .B s27, .B s28, .B s29, .B s30, .B s31,
    .B s32, .B s33, .B s34, .B s35, .B s36, .B s37, .B s38, .B s39, .B s40, .B s41, .B s42, .B s43,
    .B s44, .B s45, .B s46, .B s47])]

#prep_uplc appliedSig47 wallet anyTxRegister47Args 5790

-- The builder's own run at its own limit: the key last of 47 passes (after 4501 steps);
-- missed among 47, the longest run, it reaches Error (after 4526).
#guard endsWithUnit (appliedSig47.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13) (signerKey 14)
    (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19) (signerKey 20)
    (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25) (signerKey 26)
    (signerKey 27) (signerKey 28) (signerKey 29) (signerKey 30) (signerKey 31) (signerKey 32)
    (signerKey 33) (signerKey 34) (signerKey 35) (signerKey 36) (signerKey 37) (signerKey 38)
    (signerKey 39) (signerKey 40) (signerKey 41) (signerKey 42) (signerKey 43) (signerKey 44)
    (signerKey 45) (signerKey 46) vkh0)
#guard endsInError (appliedSig47.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13) (signerKey 14)
    (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19) (signerKey 20)
    (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25) (signerKey 26)
    (signerKey 27) (signerKey 28) (signerKey 29) (signerKey 30) (signerKey 31) (signerKey 32)
    (signerKey 33) (signerKey 34) (signerKey 35) (signerKey 36) (signerKey 37) (signerKey 38)
    (signerKey 39) (signerKey 40) (signerKey 41) (signerKey 42) (signerKey 43) (signerKey 44)
    (signerKey 45) (signerKey 46) (signerKey 47))

/-- With 47 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_47_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 : ByteString),
    isSuccessful (appliedSig47.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36
      s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10 ∨ vkh = s11 ∨ vkh = s12 ∨ vkh = s13 ∨
        vkh = s14 ∨ vkh = s15 ∨ vkh = s16 ∨ vkh = s17 ∨ vkh = s18 ∨ vkh = s19 ∨ vkh = s20 ∨
        vkh = s21 ∨ vkh = s22 ∨ vkh = s23 ∨ vkh = s24 ∨ vkh = s25 ∨ vkh = s26 ∨ vkh = s27 ∨
        vkh = s28 ∨ vkh = s29 ∨ vkh = s30 ∨ vkh = s31 ∨ vkh = s32 ∨ vkh = s33 ∨ vkh = s34 ∨
        vkh = s35 ∨ vkh = s36 ∨ vkh = s37 ∨ vkh = s38 ∨ vkh = s39 ∨ vkh = s40 ∨ vkh = s41 ∨
        vkh = s42 ∨ vkh = s43 ∨ vkh = s44 ∨ vkh = s45 ∨ vkh = s46 ∨ vkh = s47)) := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_47_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 : ByteString),
    returnsUnit (appliedSig47.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14
      s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37
      s38 s39 s40 s41 s42 s43 s44 s45 s46 s47) ∨
      isUnsuccessful (appliedSig47.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12
        s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35
        s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47) := by blaster

end Seedelf.V1
