import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 117 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister117Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
    s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35
    s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59
    s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83
    s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105
    s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5, .B s6, .B s7,
    .B s8, .B s9, .B s10, .B s11, .B s12, .B s13, .B s14, .B s15, .B s16, .B s17, .B s18, .B s19,
    .B s20, .B s21, .B s22, .B s23, .B s24, .B s25, .B s26, .B s27, .B s28, .B s29, .B s30, .B s31,
    .B s32, .B s33, .B s34, .B s35, .B s36, .B s37, .B s38, .B s39, .B s40, .B s41, .B s42, .B s43,
    .B s44, .B s45, .B s46, .B s47, .B s48, .B s49, .B s50, .B s51, .B s52, .B s53, .B s54, .B s55,
    .B s56, .B s57, .B s58, .B s59, .B s60, .B s61, .B s62, .B s63, .B s64, .B s65, .B s66, .B s67,
    .B s68, .B s69, .B s70, .B s71, .B s72, .B s73, .B s74, .B s75, .B s76, .B s77, .B s78, .B s79,
    .B s80, .B s81, .B s82, .B s83, .B s84, .B s85, .B s86, .B s87, .B s88, .B s89, .B s90, .B s91,
    .B s92, .B s93, .B s94, .B s95, .B s96, .B s97, .B s98, .B s99, .B s100, .B s101, .B s102,
    .B s103, .B s104, .B s105, .B s106, .B s107, .B s108, .B s109, .B s110, .B s111, .B s112,
    .B s113, .B s114, .B s115, .B s116, .B s117])]

#prep_uplc appliedSig117 wallet anyTxRegister117Args 10690

-- The builder's own run at its own limit: the key last of 117 passes (after 9401 steps);
-- missed among 117, the longest run, it reaches Error (after 9426).
#guard endsWithUnit (appliedSig117.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1)
    (signerKey 2) (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7)
    (signerKey 8) (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13)
    (signerKey 14) (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19)
    (signerKey 20) (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25)
    (signerKey 26) (signerKey 27) (signerKey 28) (signerKey 29) (signerKey 30) (signerKey 31)
    (signerKey 32) (signerKey 33) (signerKey 34) (signerKey 35) (signerKey 36) (signerKey 37)
    (signerKey 38) (signerKey 39) (signerKey 40) (signerKey 41) (signerKey 42) (signerKey 43)
    (signerKey 44) (signerKey 45) (signerKey 46) (signerKey 47) (signerKey 48) (signerKey 49)
    (signerKey 50) (signerKey 51) (signerKey 52) (signerKey 53) (signerKey 54) (signerKey 55)
    (signerKey 56) (signerKey 57) (signerKey 58) (signerKey 59) (signerKey 60) (signerKey 61)
    (signerKey 62) (signerKey 63) (signerKey 64) (signerKey 65) (signerKey 66) (signerKey 67)
    (signerKey 68) (signerKey 69) (signerKey 70) (signerKey 71) (signerKey 72) (signerKey 73)
    (signerKey 74) (signerKey 75) (signerKey 76) (signerKey 77) (signerKey 78) (signerKey 79)
    (signerKey 80) (signerKey 81) (signerKey 82) (signerKey 83) (signerKey 84) (signerKey 85)
    (signerKey 86) (signerKey 87) (signerKey 88) (signerKey 89) (signerKey 90) (signerKey 91)
    (signerKey 92) (signerKey 93) (signerKey 94) (signerKey 95) (signerKey 96) (signerKey 97)
    (signerKey 98) (signerKey 99) (signerKey 100) (signerKey 101) (signerKey 102) (signerKey 103)
    (signerKey 104) (signerKey 105) (signerKey 106) (signerKey 107) (signerKey 108) (signerKey 109)
    (signerKey 110) (signerKey 111) (signerKey 112) (signerKey 113) (signerKey 114) (signerKey 115)
    (signerKey 116) vkh0)
#guard endsInError (appliedSig117.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12) (signerKey 13) (signerKey 14)
    (signerKey 15) (signerKey 16) (signerKey 17) (signerKey 18) (signerKey 19) (signerKey 20)
    (signerKey 21) (signerKey 22) (signerKey 23) (signerKey 24) (signerKey 25) (signerKey 26)
    (signerKey 27) (signerKey 28) (signerKey 29) (signerKey 30) (signerKey 31) (signerKey 32)
    (signerKey 33) (signerKey 34) (signerKey 35) (signerKey 36) (signerKey 37) (signerKey 38)
    (signerKey 39) (signerKey 40) (signerKey 41) (signerKey 42) (signerKey 43) (signerKey 44)
    (signerKey 45) (signerKey 46) (signerKey 47) (signerKey 48) (signerKey 49) (signerKey 50)
    (signerKey 51) (signerKey 52) (signerKey 53) (signerKey 54) (signerKey 55) (signerKey 56)
    (signerKey 57) (signerKey 58) (signerKey 59) (signerKey 60) (signerKey 61) (signerKey 62)
    (signerKey 63) (signerKey 64) (signerKey 65) (signerKey 66) (signerKey 67) (signerKey 68)
    (signerKey 69) (signerKey 70) (signerKey 71) (signerKey 72) (signerKey 73) (signerKey 74)
    (signerKey 75) (signerKey 76) (signerKey 77) (signerKey 78) (signerKey 79) (signerKey 80)
    (signerKey 81) (signerKey 82) (signerKey 83) (signerKey 84) (signerKey 85) (signerKey 86)
    (signerKey 87) (signerKey 88) (signerKey 89) (signerKey 90) (signerKey 91) (signerKey 92)
    (signerKey 93) (signerKey 94) (signerKey 95) (signerKey 96) (signerKey 97) (signerKey 98)
    (signerKey 99) (signerKey 100) (signerKey 101) (signerKey 102) (signerKey 103) (signerKey 104)
    (signerKey 105) (signerKey 106) (signerKey 107) (signerKey 108) (signerKey 109) (signerKey 110)
    (signerKey 111) (signerKey 112) (signerKey 113) (signerKey 114) (signerKey 115) (signerKey 116)
    (signerKey 117))

/-- With 117 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_117_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83 s84 s85
      s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105 s106
      s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 : ByteString),
    isSuccessful (appliedSig117.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36
      s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59
      s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82
      s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104
      s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10 ∨ vkh = s11 ∨ vkh = s12 ∨ vkh = s13 ∨
        vkh = s14 ∨ vkh = s15 ∨ vkh = s16 ∨ vkh = s17 ∨ vkh = s18 ∨ vkh = s19 ∨ vkh = s20 ∨
        vkh = s21 ∨ vkh = s22 ∨ vkh = s23 ∨ vkh = s24 ∨ vkh = s25 ∨ vkh = s26 ∨ vkh = s27 ∨
        vkh = s28 ∨ vkh = s29 ∨ vkh = s30 ∨ vkh = s31 ∨ vkh = s32 ∨ vkh = s33 ∨ vkh = s34 ∨
        vkh = s35 ∨ vkh = s36 ∨ vkh = s37 ∨ vkh = s38 ∨ vkh = s39 ∨ vkh = s40 ∨ vkh = s41 ∨
        vkh = s42 ∨ vkh = s43 ∨ vkh = s44 ∨ vkh = s45 ∨ vkh = s46 ∨ vkh = s47 ∨ vkh = s48 ∨
        vkh = s49 ∨ vkh = s50 ∨ vkh = s51 ∨ vkh = s52 ∨ vkh = s53 ∨ vkh = s54 ∨ vkh = s55 ∨
        vkh = s56 ∨ vkh = s57 ∨ vkh = s58 ∨ vkh = s59 ∨ vkh = s60 ∨ vkh = s61 ∨ vkh = s62 ∨
        vkh = s63 ∨ vkh = s64 ∨ vkh = s65 ∨ vkh = s66 ∨ vkh = s67 ∨ vkh = s68 ∨ vkh = s69 ∨
        vkh = s70 ∨ vkh = s71 ∨ vkh = s72 ∨ vkh = s73 ∨ vkh = s74 ∨ vkh = s75 ∨ vkh = s76 ∨
        vkh = s77 ∨ vkh = s78 ∨ vkh = s79 ∨ vkh = s80 ∨ vkh = s81 ∨ vkh = s82 ∨ vkh = s83 ∨
        vkh = s84 ∨ vkh = s85 ∨ vkh = s86 ∨ vkh = s87 ∨ vkh = s88 ∨ vkh = s89 ∨ vkh = s90 ∨
        vkh = s91 ∨ vkh = s92 ∨ vkh = s93 ∨ vkh = s94 ∨ vkh = s95 ∨ vkh = s96 ∨ vkh = s97 ∨
        vkh = s98 ∨ vkh = s99 ∨ vkh = s100 ∨ vkh = s101 ∨ vkh = s102 ∨ vkh = s103 ∨ vkh = s104 ∨
        vkh = s105 ∨ vkh = s106 ∨ vkh = s107 ∨ vkh = s108 ∨ vkh = s109 ∨ vkh = s110 ∨ vkh = s111 ∨
        vkh = s112 ∨ vkh = s113 ∨ vkh = s114 ∨ vkh = s115 ∨ vkh = s116 ∨ vkh = s117)) := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_117_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83 s84 s85
      s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105 s106
      s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 : ByteString),
    returnsUnit (appliedSig117.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36
      s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59
      s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82
      s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104
      s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117) ∨
      isUnsuccessful (appliedSig117.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12
        s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35
        s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58
        s59 s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81
        s82 s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103
        s104 s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117) := by blaster

end Seedelf.V1
