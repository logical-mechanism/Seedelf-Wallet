import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses
import Audit.V2.Common
import Blaster

/-! Negative controls for v2's general Mix of two in an ADA pool: each must come back
Falsified, four `✅ Expected Falsified`. A Valid one fails the build (`❌ Unexpected Valid`).

1. The Passes theorem's hypotheses don't imply `False`: it isn't vacuous in the model.
2. `MixAnyFirst`'s run succeeds for some arguments, and 3. so does `MixAnySecond`'s: their
   theorems are proved over their own preparations, so a preparation that always failed
   would make them hold for nothing (`¬ isSuccessful` is only a probe here: README rule 2).
4. The Passes theorem with its conclusion flipped to `isUnsuccessful`. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

-- 1. The Passes hypotheses are satisfiable.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      False]

-- 2. MixAnyFirst's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    ¬ isSuccessful (appliedMixAnyFirst.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 3. MixAnySecond's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    ¬ isSuccessful (appliedMixAnySecond.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 4. Passes, its conclusion flipped.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isUnsuccessful (appliedMixAnyPasses.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

end Lovejoin.V2.Any
