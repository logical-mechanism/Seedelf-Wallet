import Lovejoin.AnyTx.LogicOwnerBoundaryPartial
import Lovejoin.AnyTx.LogicInputCover

/-! The compiled junction between box collection and the Owner/Mix branches. -/
namespace Lovejoin.AnyTx.LogicOwnerEntry
open PlutusCore.UPLC.Term (Term Program Version)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open Seedelf.V1.LinesAll
open PlutusCore.UPLC.CekMachine
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def entryAt : List Nat := LogicInputHelpers.collectorAt.take 52
def entryBody : Term := subterm templateBody entryAt
def collectorCall : Term := subterm templateBody (entryAt ++ [0,0])
def hashArg : Term := subterm templateBody (entryAt ++ [0,0,1])
def byteBody : Term := subterm templateBody (entryAt ++ [0,0,0,1,0])
def middleArg : Term := subterm templateBody (entryAt ++ [0,1])
def middleBody : Term := subterm templateBody (entryAt ++ [0,1,0])
def lastArg : Term := subterm templateBody (entryAt ++ [0,2])
def branchBody : Term := subterm templateBody (entryAt ++ [1,0,0,0])
def ownerCondition : Term := subterm templateBody (entryAt ++ [1,0,0,0,0,0,0])

set_option maxHeartbeats 0

/-- Feed the mix hash and byte classifier into the compiled box collector. -/
theorem collector_call (env : Environment) (hash : CekValue) (boxes : List Data)
    (hHash : Ev default hashArg env (some hash))
    (hCollector : Ev default LogicInputHelpers.collectorBody
      (hash :: .VLam byteBody env :: env) (some (.VCon (.ConstDataList boxes)))) :
    Ev default collectorCall env (some (.VCon (.ConstDataList boxes))) := by
  cek_v3_using [hHash, hCollector]

/-- Once its three fields have been evaluated, the compiled entry dispatches
into its branch body with the collected boxes in the first field's slot. -/
theorem entry_of_parts (env : Environment) (boxes : List Data) (middle last : CekValue)
    (result : Option CekValue)
    (hCollect : Ev default collectorCall env (some (.VCon (.ConstDataList boxes))))
    (hMiddle : Ev default middleArg env (some middle))
    (hLast : Ev default lastArg env (some last))
    (hBranch : Ev default branchBody (last :: middle :: .VCon (.ConstDataList boxes) :: env) result) :
    Ev default entryBody env result := by
  cek_v3_using [hCollect, hMiddle, hLast, hBranch]
  cases result with
  | none => exact values_none
  | some value => exact values_nil

/-- The true side of the compiled dispatch enters the existing Owner prologue. -/
theorem branch_owner (env : Environment) (result : Option CekValue)
    (hCondition : Ev default ownerCondition env (some (.VCon (.Bool true))))
    (hIf : Ev default (.Var 27) env
      (some (.VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))))
    (hOwner : Ev default LogicOwnerConditions.prologueBody env result) :
    Ev default branchBody env result := by
  cek_v3_using [hCondition, hIf, hOwner]

/-- An Owner redeemer makes the compiled branch selector choose Owner. -/
theorem owner_condition (env : Environment) (proofs : List Data)
    (hRedeemer : Ev default (.Var 17) env (some (.VCon (.Data (.Constr 0 [.List proofs])))))
    (hEquals : Ev default (.Var 19) env
      (some (.VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))))
    (hFst : Ev default (.Var 28) env (some (.VBuiltin .FstPair [] (.One .ArgV)))) :
    Ev default ownerCondition env (some (.VCon (.Bool true))) := by
  cek_v3_using [hRedeemer, hEquals, hFst]

/-- The middle dispatch argument is the compiled closure. -/
theorem middle_is_closure (env : Environment) :
    Ev default middleArg env (some (.VLam middleBody env)) := by
  cek_v3

/-- The final dispatch argument applies the closure in environment slot four to itself. -/
theorem last_from_slot (env : Environment) (fn last : CekValue)
    (hFn : Ev default (.Var 4) env (some fn))
    (hApply : Ap default fn fn (some last)) :
    Ev default lastArg env (some last) := by
  cek_v3_using [hFn, hApply]

/-- Once the Owner prologue has a partial Boolean execution model, a true result
at the earlier collector/dispatch junction forces that prologue to be true. -/
theorem entry_true_implies_owner_true (env : Environment) (boxes : List Data) (last : CekValue)
    (result : Option Bool)
    (hCollect : Ev default collectorCall env (some (.VCon (.ConstDataList boxes))) )
    (hLast : Ev default lastArg env (some last))
    (hCondition : Ev default ownerCondition
      (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env) (some (.VCon (.Bool true))))
    (hIf : Ev default (.Var 27) (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (some (.VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))))
    (hModel : Ev default LogicOwnerConditions.prologueBody
      (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (result.map fun flag => .VCon (.Bool flag)))
    (hTrue : Ev default entryBody env (some (.VCon (.Bool true)))) :
    Ev default LogicOwnerConditions.prologueBody
      (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env) (some (.VCon (.Bool true))) := by
  have hBranch := branch_owner _ _ hCondition hIf hModel
  have hEntry := entry_of_parts env boxes (.VLam middleBody env) last _ hCollect (middle_is_closure env) hLast hBranch
  have hResult := LogicProofPairs.ev_true_of_model entryBody env result hEntry hTrue
  rw [hResult] at hModel
  exact hModel

/-- The compiled execution reaches the selected Owner prologue. -/
theorem entry_reaches_owner (env : Environment) (boxes : List Data) (last : CekValue)
    (hCollect : Ev default collectorCall env (some (.VCon (.ConstDataList boxes))))
    (hLast : Ev default lastArg env (some last))
    (hCondition : Ev default ownerCondition
      (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env) (some (.VCon (.Bool true))))
    (hIf : Ev default (.Var 27) (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (some (.VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV)))))) :
    Reaches default (.Eval [] env entryBody)
      (.Eval [] (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
        LogicOwnerConditions.prologueBody) := by
  repeat' first
    | exact Reaches.refl _ _
    | apply Reaches.trans (hCollect.run _)
    | apply Reaches.trans (hLast.run _)
    | apply Reaches.trans (hCondition.run _)
    | apply Reaches.trans (hIf.run _)
    | apply Reaches.trans (Reaches.single (by rfl))

theorem entry_reaches_owner_on_stack (stack : Stack) (env : Environment) (boxes : List Data) (last : CekValue)
    (hCollect : Ev default collectorCall env (some (.VCon (.ConstDataList boxes))))
    (hLast : Ev default lastArg env (some last))
    (hCondition : Ev default ownerCondition
      (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env) (some (.VCon (.Bool true))))
    (hIf : Ev default (.Var 27) (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (some (.VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV)))))) :
    Reaches default (.Eval stack env entryBody)
      (.Eval stack (last :: .VLam middleBody env :: .VCon (.ConstDataList boxes) :: env)
        LogicOwnerConditions.prologueBody) := by
  repeat' first
    | exact Reaches.refl _ _
    | apply Reaches.trans (hCollect.run _)
    | apply Reaches.trans (hLast.run _)
    | apply Reaches.trans (hCondition.run _)
    | apply Reaches.trans (hIf.run _)
    | apply Reaches.trans (Reaches.single (by rfl))



theorem halt_after_reached_eval (start : State) (env : Environment) (body : PlutusCore.UPLC.Term.Term) (v : CekValue)
    (hReach : Reaches default start (.Eval [] env body))
    (hHalt : ∃ n, stepN default start n = .Halt v) :
    ∃ n, stepN default (.Eval [] env body) n = .Halt v := by
  obtain ⟨n, hn⟩ := hReach
  obtain ⟨m, hm⟩ := hHalt
  rcases Nat.le_total n m with hle | hle
  · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
    rw [hk, stepN_add, hn] at hm
    exact ⟨k, hm⟩
  · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
    have hfix := stepN_fix default start m (Or.inl ⟨v, hm⟩) k
    rw [← hk, hn, hm] at hfix
    cases hfix


theorem ev_true_of_halt (body : Term) (env : Environment) (result : Option Bool)
    (hModel : Ev default body env (result.map fun b => .VCon (.Bool b)))
    (hHalt : ∃ n, stepN default (.Eval [] env body) n = .Halt (.VCon (.Bool true))) :
    result = some true := by
  cases result with
  | none =>
    obtain ⟨n, hn⟩ := hModel.run []
    obtain ⟨m, hm⟩ := hHalt
    exact False.elim ((stepN_ne_halt_of_error hn m (.VCon (.Bool true))) hm)
  | some value =>
    obtain ⟨n, hn⟩ := hModel.run []
    obtain ⟨m, hm⟩ := hHalt
    have hv : stepN default (.Eval [] env body) (n + 1) = .Halt (.VCon (.Bool value)) := by
      rw [stepN_add, hn]
      rfl
    have heq : value = true := by
      rcases Nat.le_total (n + 1) m with hle | hle
      · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
        rw [hk, stepN_fix default _ _ (Or.inl ⟨_, hv⟩), hv] at hm
        cases hm
        rfl
      · obtain ⟨k, hk⟩ := Nat.exists_eq_add_of_le hle
        rw [hk, stepN_fix default _ _ (Or.inl ⟨_, hm⟩), hm] at hv
        cases hv
        rfl
    cases heq
    rfl

/-- The collector receives the mix-script hash extracted from the reference datum. -/
theorem hash_argument (env : Environment) (tag : Integer) (fields : List Data) (mixHash : ByteString)
    (selector : CekValue)
    (hDatum : Ev default (.Var 0) env (some (.VCon (.Data (.Constr tag fields)))))
    (hSelector : Ev default (.Var 7) env (some selector))
    (hSnd : Ev default (.Var 26) env (some (.VBuiltin .SndPair [] (.One .ArgV))))
    (hExtract : Ap default selector (.VCon (.ConstDataList fields))
      (some (.VCon (.Data (.B mixHash))))) :
    Ev default hashArg env (some (.VCon (.ByteString mixHash))) := by
  cek_v3_using [hDatum, hSelector, hSnd, hExtract]

/-- If the surrounding program accepts, a reached partial Boolean model cannot error or return false when false is rejected. -/
theorem program_success_forces_model_true (version : Version) (body : Term) (args : List Term)
    (stack : Stack) (env : Environment) (inner : Term) (result : Option Bool)
    (hPath : Reaches default (.Eval [] [] (applyParams body args)) (.Eval stack env inner))
    (hModel : Ev default inner env (result.map fun b => .VCon (.Bool b)))
    (hRejectFalse : Reaches default (.Return stack (.VCon (.Bool false))) .Error)
    (hSuccess : ∃ n, cekExecuteProgram (.Program version body) args n = .Halt (.VCon .Unit)) :
    result = some true := by
  have hNoError : ¬ Reaches default (.Eval [] [] (applyParams body args)) .Error := by
    intro hError
    obtain ⟨m, hm⟩ := hError
    obtain ⟨n, hn⟩ := hSuccess
    have hExec : cekExecuteProgram (.Program version body) args m = .Error := by
      exact (runStepsPreservingState_eq_stepN _ _ _).trans hm
    exact (exec_never_halts hExec n (.VCon .Unit)) hn
  cases result with
  | none =>
    have hError := hPath.trans (hModel.run stack)
    exact False.elim (hNoError hError)
  | some flag =>
    cases flag with
    | false =>
      have hError := (hPath.trans (hModel.run stack)).trans hRejectFalse
      exact False.elim (hNoError hError)
    | true => rfl

end Lovejoin.AnyTx.LogicOwnerEntry

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.collector_call
#print axioms Lovejoin.AnyTx.LogicOwnerEntry.entry_of_parts

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.branch_owner

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.owner_condition

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.entry_true_implies_owner_true

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.entry_reaches_owner

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.halt_after_reached_eval
#print axioms Lovejoin.AnyTx.LogicOwnerEntry.ev_true_of_halt

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.hash_argument

/--
info: 'Lovejoin.AnyTx.LogicOwnerEntry.entry_reaches_owner_on_stack' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerEntry.entry_reaches_owner_on_stack

#print axioms Lovejoin.AnyTx.LogicOwnerEntry.program_success_forces_model_true
