import Lovejoin.AnyTx.LogicCarrierPredicate

/-! The compiled carrier test when the target policy sorts before another entry. -/
namespace Lovejoin.AnyTx.LogicAbsentPolicyAfter
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (inputData)
open Lovejoin.AnyTx.LogicReferenceFilter

def absentPolicyInput (ref addr datum script : Data) (policies : List (ByteString × Data)) (nextPolicy : ByteString) (nextValue : Data) (afterPolicies : List (Data × Data)) : Data :=
  inputData ref (.Constr 0 [addr, .Map (LogicPolicyLookup.policyPairs policies ++ (.B nextPolicy, nextValue) :: afterPolicies), datum, script])
set_option maxHeartbeats 0

/-- The compiled policy search stops at a later nonmatching key and rejects the input. -/
theorem predicate_rejects (top : Fin 7 → CekValue) (selector c72 c29 c28 c26 : CekValue)
    (middle : Fin 8 → CekValue) (P name : ByteString) (rest : Environment)
    (ref addr datum script : Data) (policies : List (ByteString × Data)) (nextPolicy : ByteString) (nextValue : Data) (afterPolicies : List (Data × Data)) (tail : List Data)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (hPolicies : ∀ pair ∈ policies, PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hAfter : PlutusCore.ByteString.lessThanEqualsByteString P nextPolicy = true)
    (hNe : PlutusCore.ByteString.equalsByteString P nextPolicy = false) :
    let item := absentPolicyInput ref addr datum script policies nextPolicy nextValue afterPolicies
    let env := filterEnv top selector (.VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV))
      c72 c29 c28 c26 middle (.VCon (.ByteString name)) (.VCon (.ByteString P)) rest
    Ev default carrierPredicate
      (.VCon (.ConstDataList tail) :: .VCon (.Data item) :: .VCon (.ConstDataList (item :: tail)) ::
        .VLam filterLoop env :: env) (some (.VCon (.Bool false))) := by
  dsimp only
  cek_v3_using [LogicPolicyLookup.absent_before_later_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3_using [LogicPolicyLookup.absent_before_later_slots, hSelect]
  all_goals try assumption
  all_goals try cek_v3

end Lovejoin.AnyTx.LogicAbsentPolicyAfter

#print axioms Lovejoin.AnyTx.LogicAbsentPolicyAfter.predicate_rejects
