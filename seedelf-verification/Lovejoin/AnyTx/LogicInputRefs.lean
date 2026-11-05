import Lovejoin.AnyTx.LogicLength
import Lovejoin.AnyTx.BoxCover

/-! The compiled Owner branch builds its hash context by mapping every transaction
input to its output reference. This module proves that exact UPLC loop for input
lists of any length, independently of their resolved outputs. -/
namespace Lovejoin.AnyTx.LogicInputRefs
open PlutusCore.Data (Data)
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open Lovejoin.AnyTx.BoxCover (inputPairs)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm inputData inputList)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def refsAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,1,1,0,1,1,1,1,1]
def refsSelf : Term := subterm templateBody refsAt
def refsLoop : Term := subterm templateBody (refsAt ++ [0])
def refsBody : Term := subterm templateBody (refsAt ++ [0,0])

theorem self_shape : refsSelf = .Lam refsLoop := rfl
theorem loop_shape : refsLoop = .Lam refsBody := rfl

/-- The closure's 31 unused slots and five list/pair builtins. -/
def refsEnv (slots : Fin 31 → CekValue) (rest : Environment) : Environment :=
  List.ofFn slots ++
  .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) ::
  .VBuiltin .TailList [] (.One .ArgV) :: rest

set_option maxHeartbeats 0

/-- The compiled Owner reference traversal preserves every reference, in order. -/
theorem refs_all (slots : Fin 31 → CekValue) (rest : Environment) (xs : List (Data × Data)) :
    Ev default refsBody
      (.VCon (.ConstDataList (inputList xs)) :: .VLam refsLoop (refsEnv slots rest) :: refsEnv slots rest)
      (some (.VCon (.ConstDataList (xs.map Prod.fst)))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    rcases x with ⟨ref, output⟩
    simp only [inputList, List.map_cons]
    cek_v3_using [ih]

/-- The data-level traversal returns the ledger references for every typed input. -/
theorem ledger_refs (slots : Fin 31 → CekValue) (rest : Environment) (inputs : List TxInInfo) :
    Ev default refsBody
      (.VCon (.ConstDataList (inputList (inputPairs inputs))) ::
        .VLam refsLoop (refsEnv slots rest) :: refsEnv slots rest)
      (some (.VCon (.ConstDataList (inputs.map fun i => IsData.toData i.txInInfoOutRef)))) := by
  simpa [inputPairs, List.map_map, Function.comp_def] using refs_all slots rest (inputPairs inputs)

end Lovejoin.AnyTx.LogicInputRefs

/-- info: 'Lovejoin.AnyTx.LogicInputRefs.refs_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputRefs.refs_all

#print axioms Lovejoin.AnyTx.LogicInputRefs.ledger_refs
