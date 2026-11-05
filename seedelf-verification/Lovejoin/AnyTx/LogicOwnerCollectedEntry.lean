import Lovejoin.AnyTx.LogicOwnerEntry
import Lovejoin.AnyTx.LogicOwnerShapesJoin

/-! Connect all typed ledger inputs to the compiled Owner dispatch junction. -/
namespace Lovejoin.AnyTx.LogicOwnerCollectedEntry
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open PlutusCore.UPLC.CekMachine
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx.LogicInputFilter
open Lovejoin.AnyTx.LogicInputHelpers
open Lovejoin.AnyTx.LogicInputExtended

def collectorEnv (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue)
    (selectorSlots : Fin 19 → CekValue) (byteSlots : Fin 31 → CekValue)
    (selectorRest byteRest rest : Environment) : Environment :=
  let top : Fin 14 → CekValue := fun i =>
    if i.val = 0 then .VCon (.ByteString mixHash)
    else if i.val = 1 then bytesValue byteSlots byteRest
    else if i.val = 7 then .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)
    else if i.val = 8 then .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV)
    else if i.val = 10 then LogicReferenceFilter.selectorValue selectorSlots selectorRest
    else if i.val = 11 then thirdValue selectorSlots selectorRest
    else defaultTop i
  let middle : Fin 11 → CekValue := fun i =>
    if i.val = 3 then .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV)
    else if i.val = 4 then .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)
    else defaultMiddle i
  filterEnv top middle
    (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)

/-- For every typed ledger input list, the actual collector call produces the
ordered selected box datums when its environment and reference hash agree. -/
theorem collector_call_ledger (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue)
    (selectorSlots : Fin 19 → CekValue) (byteSlots : Fin 31 → CekValue)
    (selectorRest byteRest rest env : Environment) (r : TxRest) (refs sigs : Data) (inputs : List TxInInfo)
    (hInfo : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map IsData.toData)) refs sigs)))
    (hEnv : collectorEnv mixHash defaultTop defaultMiddle selectorSlots byteSlots selectorRest byteRest rest =
      .VCon (.ByteString mixHash) :: .VLam LogicOwnerEntry.byteBody env :: env)
    (hHash : Ev default LogicOwnerEntry.hashArg env (some (.VCon (.ByteString mixHash)))) :
    ∃ shapes : List Shape, shapes.map (shapeData mixHash) = inputs.map IsData.toData ∧
      (∀ shape ∈ shapes, shapeValid mixHash shape) ∧
      Ev default LogicOwnerEntry.collectorCall env
        (some (.VCon (.ConstDataList (shapes.filterMap shapeDatum)))) := by
  obtain ⟨shapes, hInputs, hValid, hCollector⟩ :=
    LogicInputCover.collector_reads_ledger_inputs mixHash defaultTop defaultMiddle selectorSlots byteSlots
      selectorRest byteRest rest r refs sigs inputs hInfo
  have hCollector' : Ev default LogicInputHelpers.collectorBody
      (collectorEnv mixHash defaultTop defaultMiddle selectorSlots byteSlots selectorRest byteRest rest)
      (some (.VCon (.ConstDataList (shapes.filterMap shapeDatum)))) := hCollector
  rw [hEnv] at hCollector'
  exact ⟨shapes, hInputs, hValid, LogicOwnerEntry.collector_call env (.VCon (.ByteString mixHash)) _ hHash hCollector'⟩

/-- Full Owner acceptance supplies the parsed proof shapes alongside the actual
compiled collector result for all of the transaction's typed inputs. -/
theorem acceptance_supplies_collected_pairs (P mixHash : ByteString)
    (tx : TxInfo) (acct : Credential) (proofs : List Data)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue)
    (selectorSlots : Fin 19 → CekValue) (byteSlots : Fin 31 → CekValue)
    (selectorRest byteRest rest env : Environment) (r : TxRest) (refs sigs : Data)
    (hInfo : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (tx.txInfoInputs.map IsData.toData)) refs sigs)))
    (hEnv : collectorEnv mixHash defaultTop defaultMiddle selectorSlots byteSlots selectorRest byteRest rest =
      .VCon (.ByteString mixHash) :: .VLam LogicOwnerEntry.byteBody env :: env)
    (hHash : Ev default LogicOwnerEntry.hashArg env (some (.VCon (.ByteString mixHash))))
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ shapes : List Shape, shapes.map (shapeData mixHash) = tx.txInfoInputs.map IsData.toData ∧
      (∀ shape ∈ shapes, shapeValid mixHash shape) ∧
      Ev default LogicOwnerEntry.collectorCall env (some (.VCon (.ConstDataList (shapes.filterMap shapeDatum)))) ∧
      ∀ datum proof, (datum, proof) ∈ (shapes.filterMap shapeDatum).zip proofs →
        ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  obtain ⟨shapes, hInputs, hValid, hCollector⟩ := collector_call_ledger mixHash defaultTop defaultMiddle
    selectorSlots byteSlots selectorRest byteRest rest env r refs sigs tx.txInfoInputs hInfo hEnv hHash
  exact ⟨shapes, hInputs, hValid, hCollector,
    LogicOwnerShapesJoin.acceptance_supplies_extended_pair_shapes P tx acct proofs shapes hSuccess⟩

end Lovejoin.AnyTx.LogicOwnerCollectedEntry

#print axioms Lovejoin.AnyTx.LogicOwnerCollectedEntry.collector_call_ledger

/--
info: 'Lovejoin.AnyTx.LogicOwnerCollectedEntry.acceptance_supplies_collected_pairs' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerCollectedEntry.acceptance_supplies_collected_pairs
