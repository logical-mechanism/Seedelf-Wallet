import Lovejoin.AnyTx.LogicOwnerCollectedEntry
/-! Reach the Owner proof parser continuation for arbitrary proof-list lengths. -/
namespace Lovejoin.AnyTx.LogicOwnerParserReach
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.ByteString (ByteString)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.LogicOwnerParse
set_option maxHeartbeats 0
set_option maxRecDepth 4000

open Lean Elab Tactic Meta in
elab "normalize_reach" : tactic => withMainContext do
  let goal ← getMainGoal
  let ty ← instantiateMVars (← goal.getType)
  let args := ty.getAppArgs
  unless args.size == 3 do throwError "expected Reaches goal"
  let start ← whnf args[1]!
  let newType := mkApp3 (mkConst ``Reaches) args[0]! start args[2]!
  replaceMainGoal [← goal.change newType]

/-- Every list of well-formed proofs reaches the parser continuation. -/
theorem list_reaches_continuation (continuation : CekValue) (c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (predRest loopRest : Environment) (originalList : CekValue) (xs : List (ByteString × ByteString)) (stack : Stack) :
    Reaches default
      (.Eval stack
        (.VCon (.ConstDataList (proofList xs)) ::
          .VLam loopLoop (.VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
          .VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) loopBody)
      (.Return (.ForceFrame :: stack) continuation) := by
  induction xs generalizing stack with
  | nil =>
    simp only [proofList, List.map_nil]
    repeat' first
      | exact Reaches.refl _ _
      | (apply Reaches.trans (Reaches.single (by rfl)); normalize_reach)
  | cons x xs ih =>
    rcases x with ⟨t, z⟩
    simp only [proofList, List.map_cons]
    repeat' first
      | exact Reaches.refl _ _
      | apply Reaches.trans (ih _)
      | (apply Reaches.trans (Reaches.single (by rfl)); normalize_reach)

end Lovejoin.AnyTx.LogicOwnerParserReach
/--
info: 'Lovejoin.AnyTx.LogicOwnerParserReach.list_reaches_continuation' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerParserReach.list_reaches_continuation
