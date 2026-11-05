import Lovejoin.V2.MixAny4Box1
import Lovejoin.V2.MixAny4Box2
import Lovejoin.V2.MixAny4Box3
import Lovejoin.V2.MixAny4Box4
import Lovejoin.V2.MixAny4Passes
import Audit.V2.Common
import Blaster

/-! Negative controls for v2's general Mix of four in an ADA pool, as `Audit.V2.MixAnyVacuity`
has them at n = 2: the Passes hypotheses are satisfiable, each box's preparation can
succeed, and Passes with its conclusion flipped. Six `✅ Expected Falsified`.

All six are asked at one instance, where the four boxes in share their points `(a, b)` and
their branches, `(t0j, t1j, cj, zj)` for box out j. A control needs one counterexample, and
there Z3 needn't build four different boxes. Over every input, 2 to 6 timed out (⚠️
Undetermined, 2026-11-03): each needs a four-box run that doesn't error. 1 has no run, and
passed over every input too. -/

namespace Lovejoin.V2.Any4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

-- 1. The Passes hypotheses are satisfiable.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a b = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
    mixAcceptsPool M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 = true →
      False]

-- 2. MixAny4Box1's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    ¬ isSuccessful (appliedMixAny4Box1.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 3. MixAny4Box2's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    ¬ isSuccessful (appliedMixAny4Box2.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 4. MixAny4Box3's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    ¬ isSuccessful (appliedMixAny4Box3.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 5. MixAny4Box4's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    ¬ isSuccessful (appliedMixAny4Box4.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

-- 6. Passes, its conclusion flipped.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 600)
  [∀ (P M : ByteString) (bl : Integer) (a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 : ByteString),
    P ≠ "" → bl ≠ 0 →
    wellFormed a b = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true → wellFormed oa4 ob4 = true →
    mixAcceptsPool M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 = true →
      isUnsuccessful (appliedMixAny4Passes.prop P M bl a b a b a b a b oa1 ob1 oa2 ob2 oa3 ob3 oa4 ob4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4 t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 t04 t14 c4 z4)]

end Lovejoin.V2.Any4
