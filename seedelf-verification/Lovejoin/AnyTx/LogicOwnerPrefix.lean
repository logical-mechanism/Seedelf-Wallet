import Lovejoin.AnyTx.LogicOwnerParserReach
import Lovejoin.AnyTx.LogicCarrierCover
import Lovejoin.AnyTx.LogicOwnerCollectedEntry
/-! Reach the Owner collector from a whole validator invocation. -/
namespace Lovejoin.AnyTx.LogicOwnerPrefix
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicCarrierCover
open Lovejoin.AnyTx.LogicOwnerParse (proofList)
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0
set_option maxRecDepth 4000
open Lean Elab Tactic Meta in
elab "advance_reach" : tactic => withMainContext do
  let goal ← getMainGoal
  let ty ← instantiateMVars (← goal.getType)
  let args := ty.getAppArgs
  unless args.size == 3 do throwError "expected Reaches goal"
  let start ← whnf args[1]!
  let f := start.getAppFn
  unless f.isConstOf ``State.Eval || f.isConstOf ``State.Return do throwError "stuck on {start}"
  let newType := mkApp3 (mkConst ``Reaches) args[0]! start args[2]!
  replaceMainGoal [← goal.change newType]

def slot {n : Nat} (env : Environment) (offset : Nat) (i : Fin n) : CekValue :=
  env.getD (i.val + offset) (.VCon .Unit)
def topSlot (env : Environment) (i : Fin 14) : CekValue :=
  env.getD (i.val - 2) (.VCon .Unit)
def captured : CekValue → Environment
  | .VLam _ env => env
  | _ => []
def selectorCaptured (env : Environment) : Environment := captured (env.getD 8 (.VCon .Unit))

/-- A singleton well-formed carrier reaches the collector with its actual environment; false results are rejected. -/
theorem whole_prefix (P M : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString))
    (rref raddr va rrs : Data) (bv : Integer) (tp tn : ByteString) (tq fc : Integer) (lh fh : ByteString)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSingle : matching P nftName refs = [carrierRef rref raddr va rrs P M bv tp tn tq fc lh fh]) :
    ∃ stack env, Reaches default
      (.Eval [] [] (applyParams LogicOwnerEntry.templateBody
        [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
          (.List (refs.map (candidateData P nftName))) sigs,
          .Constr 0 [.List (proofList proofs)], .Constr 2 [acct]])]))
      (.Eval stack env LogicOwnerEntry.entryBody) ∧
      Reaches default (.Return stack (.VCon (.Bool false))) .Error ∧
      LogicOwnerCollectedEntry.collectorEnv M (topSlot env) (slot env 13) (slot (selectorCaptured env) 0)
        (slot env 0) (env.drop 31) (env.drop 32) (env.drop 32) =
        .VCon (.ByteString M) :: .VLam LogicOwnerEntry.byteBody env :: env ∧
      slot env 13 (2 : Fin 11) = .VCon (.Data
        (withInputs r ins (.List (refs.map (candidateData P nftName))) sigs)) ∧
      Ev default LogicOwnerEntry.hashArg env (some (.VCon (.ByteString M))) := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_, ?_⟩
  rotate_left 2
  repeat' first
    | exact Reaches.refl _ _
    | exact Reaches.single (by rfl)
    | (apply Reaches.trans (LogicOwnerParserReach.list_reaches_continuation _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ proofs _); advance_reach)
    | (refine Reaches.trans ((filter_singleton_slots _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ P nftName _ ?_ refs hOrdered hP hN _ hSingle).run _) ?_ <;> first | (intros; apply ap_lam; cek_v3) | advance_reach)
    | (apply Reaches.trans (Reaches.single (by rfl)); advance_reach)
  all_goals first | rfl | cek_v3
end Lovejoin.AnyTx.LogicOwnerPrefix

/-- info: 'Lovejoin.AnyTx.LogicOwnerPrefix.whole_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerPrefix.whole_prefix
