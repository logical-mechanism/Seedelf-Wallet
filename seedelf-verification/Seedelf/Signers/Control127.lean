import Seedelf.Signers.Signers127
import Blaster

/-! A negative control for `Signers127` (gen-seedelf-signers.py writes this file), expected
Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid" and fails
the build. It is the module's iff with the last signatory left out of the disjunction, over
`Signers127`'s own builder: a proof that checks, signed by s127 alone, passes, so the solver must
see the key found last of 127. Were that builder's background contradictory (Lean-blaster #194),
both of `Signers127`'s theorems would come back Valid whatever the bytes do, and so would this. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

-- The last signatory, s127, left out.
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82 s83 s84 s85
      s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104 s105 s106
      s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121 s122 s123 s124 s125
      s126 s127 : ByteString),
    isSuccessful (appliedSig127.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36
      s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59
      s60 s61 s62 s63 s64 s65 s66 s67 s68 s69 s70 s71 s72 s73 s74 s75 s76 s77 s78 s79 s80 s81 s82
      s83 s84 s85 s86 s87 s88 s89 s90 s91 s92 s93 s94 s95 s96 s97 s98 s99 s100 s101 s102 s103 s104
      s105 s106 s107 s108 s109 s110 s111 s112 s113 s114 s115 s116 s117 s118 s119 s120 s121 s122 s123
      s124 s125 s126 s127) ↔
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
        vkh = s126))]

end Seedelf.V1
