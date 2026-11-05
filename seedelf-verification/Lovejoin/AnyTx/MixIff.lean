import Lovejoin.AnyTx.MixTwo
import Lovejoin.AnyTx.MixTokenTwo

/-! Assemble the per-challenge, per-branch and passing theorems for the two-box
layouts. The assembly is kernel checked; the component proofs use Blaster. -/
namespace Lovejoin.AnyTx.MixIff
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)
open Lovejoin.AnyTx.MixTwo (Tail Proof)

private theorem unit_and_error_impossible (s : State) (h : returnsUnit s) (e : isUnsuccessful s) : False := by
  cases s <;> simp_all [returnsUnit, isUnsuccessful, isErrorState]

/-- An accepted ADA Mix in this layout has both valid Sigma-OR proofs. -/
theorem ada_success_requires_proofs (P M : ByteString) (bl : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields) (o : Tail) (p : Proof)
    (hs : returnsUnit (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p)) :
    Lovejoin.V2.Any.mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 = true := by
  cases hm : Lovejoin.V2.Any.mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 with
  | true => rfl
  | false =>
    exfalso
    unfold Lovejoin.V2.Any.mixAcceptsAny Lovejoin.V2.Any.inputAcceptsAny at hm
    simp only [Bool.and_eq_false_iff] at hm
    rcases hm with ((h | h) | h) | ((h | h) | h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.first_challenge P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.first_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.first_other_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.second_challenge P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.second_other_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTwo.second_branch P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)

theorem ada_iff (P M : ByteString) (bl : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields) (o : Tail) (p : Proof)
    (hP : P ≠ "") (hbl : bl ≠ 0) (w1 : wellFormed a1 b1 = true) (w2 : wellFormed a2 b2 = true)
    (wo1 : wellFormed oa1 ob1 = true) (wo2 : wellFormed oa2 ob2 = true) :
    returnsUnit (mixTwo.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) ↔
    Lovejoin.V2.Any.mixAcceptsAny M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 = true :=
  ⟨ada_success_requires_proofs P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p,
    Lovejoin.AnyTx.MixTwo.valid_mix P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p hP hbl w1 w2 wo1 wo2⟩


/-- An accepted token Mix in this layout has both valid Sigma-OR proofs. -/
theorem token_success_requires_proofs (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields) (o : Tail) (p : Proof)
    (hs : returnsUnit (mixTokenTwo.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p)) :
    Lovejoin.V2.Tok2.mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 = true := by
  cases hm : Lovejoin.V2.Tok2.mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 with
  | true => rfl
  | false =>
    exfalso
    unfold Lovejoin.V2.Tok2.mixAcceptsPool Lovejoin.V2.Tok2.inputAcceptsPool at hm
    simp only [Bool.and_eq_false_iff] at hm
    rcases hm with ((h | h) | h) | ((h | h) | h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.first_challenge P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.first_branch P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.first_other_branch P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.second_challenge P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.second_other_branch P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)
    · exact unit_and_error_impossible _ hs (Lovejoin.AnyTx.MixTokenTwo.second_branch P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p h)

theorem token_iff (P M : ByteString) (bl : Integer) (tp tn : ByteString) (tq : Integer)
    (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString) (f : Fields) (b : BoxFields) (o : Tail) (p : Proof)
    (hP : P ≠ "") (hbl : bl ≠ 0) (htp : tp ≠ "") (htq : tq ≠ 0) (w1 : wellFormed a1 b1 = true) (w2 : wellFormed a2 b2 = true)
    (wo1 : wellFormed oa1 ob1 = true) (wo2 : wellFormed oa2 ob2 = true) :
    returnsUnit (mixTokenTwo.prop P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p) ↔
    Lovejoin.V2.Tok2.mixAcceptsPool M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 p.t011 p.t111 p.c11 p.z11
      p.t012 p.t112 p.c12 p.z12 p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 = true :=
  ⟨token_success_requires_proofs P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p,
    Lovejoin.AnyTx.MixTokenTwo.valid_mix P M bl tp tn tq a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p hP hbl htp htq w1 w2 wo1 wo2⟩

end Lovejoin.AnyTx.MixIff
