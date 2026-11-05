import Lovejoin.AnyTx.OwnerOne
import Lovejoin.AnyTx.OwnerTwo

/-! Kernel-checked assembly of the Owner success and failure directions. The
underlying CEK results use Blaster. -/
namespace Lovejoin.AnyTx.OwnerIff
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.AnyTx (ownProof)
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)

private theorem unit_and_error_impossible (s : State) (h : returnsUnit s) (e : isUnsuccessful s) : False := by
  cases s <;> simp_all [returnsUnit, isUnsuccessful, isErrorState]

theorem one_box_iff (P M a b t z key : ByteString) (f : Fields)
    (hP : P ≠ "") (wf : wellFormed a b = true) :
    returnsUnit (ownerOne.prop P M a b t z key f) ↔
      ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = true := by
  constructor
  · intro hs
    cases hp : ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z with
    | true => rfl
    | false => exact False.elim (unit_and_error_impossible _ hs
        (Lovejoin.AnyTx.OwnerOne.box_needs_proof P M a b t z key f wf hp))
  · exact Lovejoin.AnyTx.OwnerOne.valid_proof_passes P M a b t z key f hP wf

theorem two_boxes_iff (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields)
    (hP : P ≠ "") (w1 : wellFormed a1 b1 = true) (w2 : wellFormed a2 b2 = true) :
    returnsUnit (twoOwners.prop P M a1 b1 a2 b2 t1 z1 t2 z2 key f b) ↔
      (ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a1 b1 t1 z1 = true ∧
       ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a2 b2 t2 z2 = true) := by
  constructor
  · intro hs
    constructor
    · cases hp : ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a1 b1 t1 z1 with
      | true => rfl
      | false => exact False.elim (unit_and_error_impossible _ hs
          (Lovejoin.AnyTx.OwnerTwo.first_box_needs_proof P M a1 b1 a2 b2 t1 z1 t2 z2 key f b w1 w2 hp))
    · cases hp : ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a2 b2 t2 z2 with
      | true => rfl
      | false => exact False.elim (unit_and_error_impossible _ hs
          (Lovejoin.AnyTx.OwnerTwo.second_box_needs_proof P M a1 b1 a2 b2 t1 z1 t2 z2 key f b w1 w2 hp))
  · rintro ⟨h1, h2⟩
    exact Lovejoin.AnyTx.OwnerTwo.both_valid_proofs_pass P M a1 b1 a2 b2 t1 z1 t2 z2 key f b hP w1 w2 h1 h2

end Lovejoin.AnyTx.OwnerIff
