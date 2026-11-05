import Lovejoin.AnyTx.LogicInputFilter
import Lovejoin.AnyTx.LogicReferenceFilter

/-! Compiled helper closures used by the mix-input classifier. -/
namespace Lovejoin.AnyTx.LogicInputHelpers
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open CardanoLedgerApi.V3
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)
open Lovejoin.AnyTx.LogicInputFilter

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def thirdAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0]
def thirdBody : Term := subterm templateBody (thirdAt ++ [0])
def thirdValue (slots : Fin 19 → CekValue) (rest : Environment) : CekValue :=
  .VLam thirdBody (LogicReferenceFilter.selectorEnv slots rest)

def bytesAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]
def bytesBody : Term := subterm templateBody (bytesAt ++ [0])
def bytesValue (slots : Fin 31 → CekValue) (rest : Environment) : CekValue :=
  .VLam bytesBody (List.ofFn slots ++
    .VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)

def collectorAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
def collectorBody : Term := subterm templateBody (collectorAt ++ [0,0])

set_option maxHeartbeats 0

/-- The compiled selector returns the third element. -/
theorem third_select (slots : Fin 19 → CekValue) (rest : Environment)
    (a b c : Data) (others : List Data) :
    Ap default (thirdValue slots rest) (.VCon (.ConstDataList (a :: b :: c :: others)))
      (some (.VCon (.Data c))) := by
  apply ap_lam
  cek_v3

/-- The compiled byte-data classifier accepts any byte string. -/
theorem bytes_accept (slots : Fin 31 → CekValue) (rest : Environment) (x : ByteString) :
    Ap default (bytesValue slots rest) (.VCon (.Data (.B x))) (some (.VCon (.Bool true))) := by
  apply ap_lam
  cek_v3

/-- Instantiate the input collector with the actual compiled selectors and
byte classifier. Other closure slots are arbitrary because these helpers do not
inspect them. -/
theorem supported_with_compiled_helpers (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (byteSlots : Fin 31 → CekValue) (helperRest rest : Environment)
    (inputs : List InputShape) (hValid : ∀ input ∈ inputs, inputShapeValid mixHash input) :
    let top : Fin 14 → CekValue := fun i =>
      if i.val = 0 then .VCon (.ByteString mixHash)
      else if i.val = 1 then bytesValue byteSlots helperRest
      else if i.val = 7 then .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)
      else if i.val = 8 then .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV)
      else if i.val = 10 then LogicReferenceFilter.selectorValue selectorSlots helperRest
      else if i.val = 11 then thirdValue selectorSlots helperRest
      else defaultTop i
    let middle : Fin 11 → CekValue := fun i =>
      if i.val = 3 then .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV)
      else if i.val = 4 then .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)
      else defaultMiddle i
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default filterBody
      (.VCon (.ConstDataList (inputs.map (inputShapeData mixHash))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (inputs.filterMap inputShapeDatum)))) := by
  dsimp only
  apply filter_supported
  · rfl
  · exact LogicReferenceFilter.selector_second selectorSlots helperRest
  · exact third_select selectorSlots helperRest
  · rfl
  · rfl
  · rfl
  · rfl
  · exact bytes_accept byteSlots helperRest
  · exact hValid

/-- The compiled collector wrapper reads the transaction input list and returns
the same ordered box datums for the supported arbitrary input layouts. -/
theorem collector_reads_inputs (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (byteSlots : Fin 31 → CekValue) (helperRest rest : Environment)
    (r : TxRest) (refs sigs : Data) (inputs : List InputShape)
    (hValid : ∀ input ∈ inputs, inputShapeValid mixHash input)
    (hInfo : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map (inputShapeData mixHash))) refs sigs))) :
    let top : Fin 14 → CekValue := fun i =>
      if i.val = 0 then .VCon (.ByteString mixHash)
      else if i.val = 1 then bytesValue byteSlots helperRest
      else if i.val = 7 then .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV)
      else if i.val = 8 then .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV)
      else if i.val = 10 then LogicReferenceFilter.selectorValue selectorSlots helperRest
      else if i.val = 11 then thirdValue selectorSlots helperRest
      else defaultTop i
    let middle : Fin 11 → CekValue := fun i =>
      if i.val = 3 then .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV)
      else if i.val = 4 then .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV)
      else defaultMiddle i
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default collectorBody env (some (.VCon (.ConstDataList (inputs.filterMap inputShapeDatum)))) := by
  have hFilter := supported_with_compiled_helpers mixHash defaultTop defaultMiddle selectorSlots byteSlots
    helperRest rest inputs hValid
  have hInfo' : defaultMiddle (2 : Fin 11) = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map (inputShapeData mixHash))) refs sigs)) := hInfo
  dsimp only at *
  repeat' first
    | rw [hInfo]
    | rw [hInfo']
    | apply hFilter
    | cek_v3_step
  all_goals try (simp [hInfo, Lovejoin.AnyTx.withInputs])
  repeat' first
    | rw [hInfo]
    | rw [hInfo']
    | apply hFilter
    | cek_v3_step

end Lovejoin.AnyTx.LogicInputHelpers

#print axioms Lovejoin.AnyTx.LogicInputHelpers.third_select
#print axioms Lovejoin.AnyTx.LogicInputHelpers.bytes_accept
#print axioms Lovejoin.AnyTx.LogicInputHelpers.collector_reads_inputs
/--
info: 'Lovejoin.AnyTx.LogicInputHelpers.supported_with_compiled_helpers' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputHelpers.supported_with_compiled_helpers
