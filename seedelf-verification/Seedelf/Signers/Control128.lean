import Seedelf.Signers.Signers128
import Blaster

/-! Negative controls for `Signers128`, each expected Falsified: a control that comes back Valid
prints "❌ Unexpected Valid" and fails the build. Both are over `Signers128`'s builder, prepared
again here.
- The iff with the last signatory left out of the disjunction. A proof that checks, signed by the
  128th alone, passes, so the solver must see the key found last of 128.
- Every run returns unit or reaches `Error`, at 10195 steps, one short of the miss's 10196. A
  proof that checks, signed by none of the 128, is still running there: neither. So the limit
  `Signers128` proves its runs inside is one the miss needs. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.Utils

/-- `isExhausted`, as a `Bool` for a `#guard`: still running at the limit, neither halted nor
failed. -/
def endsCutOff (s : State) : Bool :=
  match s with
  | .Eval .. | .Return .. => true
  | _ => false

#prep_uplc appliedSigControl128 wallet anyTxRegister128Args 11460
#prep_uplc appliedSigControl128Cut wallet anyTxRegister128Args 10195

-- Each builder's own run at its own limit. At 11460, as in Signers128: the key last of 128
-- passes, missed it reaches Error. At 10195 the key last still passes (after 10171 steps), and
-- missed it is cut off.
#guard endsWithUnit (appliedSigControl128.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1)
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
    (signerKey 116) (signerKey 117) (signerKey 118) (signerKey 119) (signerKey 120) (signerKey 121)
    (signerKey 122) (signerKey 123) (signerKey 124) (signerKey 125) (signerKey 126) (signerKey 127)
    vkh0)
#guard endsInError (appliedSigControl128.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1)
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
    (signerKey 116) (signerKey 117) (signerKey 118) (signerKey 119) (signerKey 120) (signerKey 121)
    (signerKey 122) (signerKey 123) (signerKey 124) (signerKey 125) (signerKey 126) (signerKey 127)
    (signerKey 128))
#guard endsWithUnit (appliedSigControl128Cut.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1)
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
    (signerKey 116) (signerKey 117) (signerKey 118) (signerKey 119) (signerKey 120) (signerKey 121)
    (signerKey 122) (signerKey 123) (signerKey 124) (signerKey 125) (signerKey 126) (signerKey 127)
    vkh0)
#guard endsCutOff (appliedSigControl128Cut.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1)
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
    (signerKey 116) (signerKey 117) (signerKey 118) (signerKey 119) (signerKey 120) (signerKey 121)
    (signerKey 122) (signerKey 123) (signerKey 124) (signerKey 125) (signerKey 126) (signerKey 127)
    (signerKey 128))

-- The last signatory left out: a proof that checks, signed by s128 alone, passes.
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83 s84 s85
      s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105 s106
      s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121 s122 s123 s124 s125
      s126 s127 s128 : ByteString),
    isSuccessful (appliedSigControl128.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
      s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34
      s35 s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57
      s58 s59 s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80
      s81 s82 s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102
      s103 s104 s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121
      s122 s123 s124 s125 s126 s127 s128) ↔
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
        vkh = s112 ∨ vkh = s113 ∨ vkh = s114 ∨ vkh = s115 ∨ vkh = s116 ∨ vkh = s117 ∨ vkh = s118 ∨
        vkh = s119 ∨ vkh = s120 ∨ vkh = s121 ∨ vkh = s122 ∨ vkh = s123 ∨ vkh = s124 ∨ vkh = s125 ∨
        vkh = s126 ∨ vkh = s127))]

-- One step short of the miss: a proof that checks, signed by none of the 128, is still running.
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83 s84 s85
      s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105 s106
      s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121 s122 s123 s124 s125
      s126 s127 s128 : ByteString),
    returnsUnit (appliedSigControl128Cut.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
      s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34
      s35 s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57
      s58 s59 s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80
      s81 s82 s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102
      s103 s104 s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121
      s122 s123 s124 s125 s126 s127 s128) ∨
      isUnsuccessful (appliedSigControl128Cut.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10
        s11 s12 s13 s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33
        s34 s35 s36 s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56
        s57 s58 s59 s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79
        s80 s81 s82 s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101
        s102 s103 s104 s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119
        s120 s121 s122 s123 s124 s125 s126 s127 s128)]

end Seedelf.V1
