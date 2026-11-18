import Seedelf.Signers.Signers64
import Blaster

/-! A negative control for `Signers64` (gen-seedelf-signers.py writes this file), expected
Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid" and fails
the build. It is the module's iff with the last signatory left out of the disjunction, over
`Signers64`'s own builder: a proof that checks, signed by s64 alone, passes, so the solver must
see the key found last of 64. Were that builder's background contradictory (Lean-blaster #194),
both of `Signers64`'s theorems would come back Valid whatever the bytes do, and so would this. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

-- The last signatory, s64, left out.
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15 s16
      s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36 s37 s38 s39
      s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59 s60 s61 s62
      s63 s64 : ByteString),
    isSuccessful (appliedSig64.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13
      s14 s15 s16 s17 s18 s19 s20 s21 s22 s23 s24 s25 s26 s27 s28 s29 s30 s31 s32 s33 s34 s35 s36
      s37 s38 s39 s40 s41 s42 s43 s44 s45 s46 s47 s48 s49 s50 s51 s52 s53 s54 s55 s56 s57 s58 s59
      s60 s61 s62 s63 s64) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10 ∨ vkh = s11 ∨ vkh = s12 ∨ vkh = s13 ∨
        vkh = s14 ∨ vkh = s15 ∨ vkh = s16 ∨ vkh = s17 ∨ vkh = s18 ∨ vkh = s19 ∨ vkh = s20 ∨
        vkh = s21 ∨ vkh = s22 ∨ vkh = s23 ∨ vkh = s24 ∨ vkh = s25 ∨ vkh = s26 ∨ vkh = s27 ∨
        vkh = s28 ∨ vkh = s29 ∨ vkh = s30 ∨ vkh = s31 ∨ vkh = s32 ∨ vkh = s33 ∨ vkh = s34 ∨
        vkh = s35 ∨ vkh = s36 ∨ vkh = s37 ∨ vkh = s38 ∨ vkh = s39 ∨ vkh = s40 ∨ vkh = s41 ∨
        vkh = s42 ∨ vkh = s43 ∨ vkh = s44 ∨ vkh = s45 ∨ vkh = s46 ∨ vkh = s47 ∨ vkh = s48 ∨
        vkh = s49 ∨ vkh = s50 ∨ vkh = s51 ∨ vkh = s52 ∨ vkh = s53 ∨ vkh = s54 ∨ vkh = s55 ∨
        vkh = s56 ∨ vkh = s57 ∨ vkh = s58 ∨ vkh = s59 ∨ vkh = s60 ∨ vkh = s61 ∨ vkh = s62 ∨
        vkh = s63))]

end Seedelf.V1
