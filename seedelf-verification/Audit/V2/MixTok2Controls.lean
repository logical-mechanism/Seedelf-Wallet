import Lovejoin.V2.MixTok2Box1
import Lovejoin.V2.MixTok2Box2
import Lovejoin.V2.MixTok2Passes
import Audit.V2.Common
import Blaster

/-! Negative controls and mutants for v2's general Mix of two in a token pool. Eight `✅
Expected Falsified`; a Valid one fails the build.

1. The Passes hypotheses are satisfiable. 2, 3. Each box's preparation can succeed.
4. Passes, its conclusion flipped, asked at one instance (below). 5. Passes with box in 2's
second branch dropped from the spec. 6. Passes without `tq ≠ 0`: a pool of quantity 0 has
`box_value` lovelace alone, so a box holding `(tp, tn, 0)` fails; the side condition is the
script's. 7. Box 2's first branch checked against box out 2 instead of 1. 8. Box 1's theorem
with the hypothesis `tq ≠ bl`, two pool parameters the script never compares. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

set_option linter.unusedVariables false in
/-- `mixAcceptsPool` without box in 2's second branch. -/
def auditMixAcceptsTok2No22 (M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  inputAcceptsPool M bl tp tn tq oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 &&
    (challengeHoldsPool M bl tp tn tq oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 t022 t122 c22 &&
      branchHolds a2 b2 oa1 ob1 t021 t121 c21 z21)

-- 1. The Passes hypotheses are satisfiable.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      False]

-- 2. MixTok2Box1's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    ¬ isSuccessful (appliedMixTok2Box1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 3. MixTok2Box2's run can succeed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    ¬ isSuccessful (appliedMixTok2Box2.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 4. Passes, its conclusion flipped. Over every input it timed out (⚠️ Undetermined,
-- 2026-11-03), and a counterexample needs only one: here both boxes in share their points and
-- their branches, (t0j, t1j, cj, zj) for box out j, so Z3 needn't build two different boxes.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a b oa1 ob1 oa2 ob2 t01 t11 c1 z1 t02 t12 c2 z2 : ByteString),
    P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
    wellFormed a b = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsPool M bl tp tn tq a b a b oa1 ob1 oa2 ob2 t01 t11 c1 z1 t02 t12 c2 z2 t01 t11 c1 z1 t02 t12 c2 z2 = true →
      isUnsuccessful (appliedMixTok2Passes.prop P M bl tp tn tq a b a b oa1 ob1 oa2 ob2 t01 t11 c1 z1 t02 t12 c2 z2 t01 t11 c1 z1 t02 t12 c2 z2)]

-- 5. Passes, box in 2's second branch dropped from the spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 → tp ≠ "" → tq ≠ 0 →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    auditMixAcceptsTok2No22 M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (appliedMixTok2Passes.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 6. Passes without tq ≠ 0.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    P ≠ "" → bl ≠ 0 → tp ≠ "" →
    wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true →
    mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true →
      isSuccessful (appliedMixTok2Passes.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 7. Box 2's first branch checked against box out 2.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    branchHolds a2 b2 oa2 ob2 t021 t121 c21 z21 = false →
      isUnsuccessful (appliedMixTok2Box2.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

-- 8. An unrelated hypothesis: tq ≠ bl.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
    tq ≠ bl →
      isUnsuccessful (appliedMixTok2Box1.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22)]

end Lovejoin.V2.Tok2
