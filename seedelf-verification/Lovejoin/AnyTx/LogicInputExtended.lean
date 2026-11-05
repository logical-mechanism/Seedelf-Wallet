import Lovejoin.AnyTx.LogicInputMalformed
import Lovejoin.AnyTx.LogicInputHelpers

/-! Unbounded input collection, including malformed constructor datums. -/
namespace Lovejoin.AnyTx.LogicInputExtended
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open CardanoLedgerApi.V3
open Seedelf.V1 (TxRest)
open Lovejoin.AnyTx.LogicInputHelpers
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicInputFilter
set_option maxHeartbeats 0

inductive Shape where
  | key (ref stake value datum script : Data) (key : ByteString)
  | foreign (ref stake value datum script : Data) (other : ByteString)
  | noDatum (ref stake value script : Data)
  | datumHash (ref stake value script hash : Data)
  | junk (ref stake value script datum : Data)
  | box (ref stake value script : Data) (a b : ByteString)
  | nonbyteFirst (ref stake value script bad other : Data)
  | nonbyteSecond (ref stake value script : Data) (a : ByteString) (bad : Data)
  | invalidBox (ref stake value script : Data) (a b : ByteString)
  | wrongTag (ref stake value script : Data) (tag : PlutusCore.Integer.Integer) (fields : List Data)
  | wrongArity (ref stake value script : Data) (fields : List Data)

def shapeData (mixHash : ByteString) : Shape → Data
  | .key ref stake value datum script key => Lovejoin.AnyTx.otherIn ref 0 key stake value datum script
  | .foreign ref stake value datum script other => Lovejoin.AnyTx.otherIn ref 1 other stake value datum script
  | .noDatum ref stake value script => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 0 []) script
  | .datumHash ref stake value script hash => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 1 [hash]) script
  | .junk ref stake value script datum => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [datum]) script
  | .box ref stake value script a b => Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
  | .nonbyteFirst ref stake value script bad other => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [bad, other]]) script
  | .nonbyteSecond ref stake value script a bad => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [.B a, bad]]) script
  | .invalidBox ref stake value script a b => Lovejoin.AnyTx.boxIn ref mixHash stake value script a b
  | .wrongTag ref stake value script tag fields => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr tag fields]) script
  | .wrongArity ref stake value script fields => Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 fields]) script

def shapeDatum : Shape → Option Data
  | .box _ _ _ _ a b => some (.Constr 0 [.B a, .B b])
  | _ => none

def shapeValid (mixHash : ByteString) : Shape → Prop
  | .nonbyteFirst _ _ _ _ bad _ => ∀ x : ByteString, bad ≠ .B x
  | .nonbyteSecond _ _ _ _ _ bad => ∀ x : ByteString, bad ≠ .B x
  | .invalidBox _ _ _ _ a b => PlutusCore.ByteString.lengthOfByteString a ≠ 48 ∨
      PlutusCore.ByteString.lengthOfByteString b ≠ 48 ∨ a = b
  | .wrongTag _ _ _ _ tag _ => tag ≠ 0
  | .wrongArity _ _ _ _ fields => fields.length ≠ 2
  | .foreign _ _ _ _ _ other => other ≠ mixHash
  | .junk _ _ _ _ datum => ∀ tag fields, datum ≠ .Constr tag fields
  | .box _ _ _ _ a b => PlutusCore.ByteString.lengthOfByteString a = 48 ∧
      PlutusCore.ByteString.lengthOfByteString b = 48 ∧ a ≠ b
  | _ => True

/-- The compiled collection loop handles arbitrary interleavings and counts
of these input shapes, retaining exactly the well-formed box datums in order.
The closure hypotheses identify the helper values used by the compiled script. -/
theorem filter_extended (top : Fin 14 → CekValue) (middle : Fin 11 → CekValue) (rest : Environment)
    (mixHash : ByteString)
    (hHash : top ⟨0, by decide⟩ = .VCon (.ByteString mixHash))
    (hSelect : ∀ x y : Data, ∀ others : List Data,
      Ap default (top ⟨10, by decide⟩) (.VCon (.ConstDataList (x :: y :: others))) (some (.VCon (.Data y))))
    (hThird : ∀ x y z : Data, ∀ others : List Data,
      Ap default (top ⟨11, by decide⟩) (.VCon (.ConstDataList (x :: y :: z :: others))) (some (.VCon (.Data z))))
    (hEqTwo : middle ⟨4, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 2)] (.One .ArgV))
    (hEqZero : middle ⟨3, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV))
    (hEq48 : top ⟨8, by decide⟩ = .VBuiltin .EqualsInteger [.VCon (.Integer 48)] (.One .ArgV))
    (hConstr : top ⟨7, by decide⟩ = .VBuiltin .ConstrData [.VCon (.Integer 0)] (.One .ArgV))
    (hBytes : ∀ x, Ap default (top ⟨1, by decide⟩) (.VCon (.Data (.B x))) (some (.VCon (.Bool true))))
    (hBadBytes : ∀ datum : Data, (∀ x : ByteString, datum ≠ .B x) →
      Ap default (top ⟨1, by decide⟩) (.VCon (.Data datum)) (some (.VCon (.Bool false))))
    (inputs : List Shape) (hValid : ∀ input ∈ inputs, shapeValid mixHash input) :
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default filterBody
      (.VCon (.ConstDataList (inputs.map (shapeData mixHash))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (inputs.filterMap shapeDatum)))) := by
  induction inputs with
  | nil => exact filter_nil top middle _
  | cons input inputs ih =>
    have hInput := hValid input (by simp)
    have hTail : ∀ x ∈ inputs, shapeValid mixHash x := by
      intro x hx
      exact hValid x (by simp [hx])
    have hi := ih hTail
    cases input with
    | key ref stake value datum script key =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 0 key stake value datum script) (inputs.map (shapeData mixHash))
        (inputs.filterMap shapeDatum)
        (predicate_key_input top middle _ ref stake value datum script key _ hSelect) hi
    | foreign ref stake value datum script other =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 other stake value datum script) (inputs.map (shapeData mixHash))
        (inputs.filterMap shapeDatum)
        (predicate_foreign_script top middle _ ref stake value datum script other mixHash _ hHash hInput hSelect) hi
    | noDatum ref stake value script =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 0 []) script) (inputs.map (shapeData mixHash))
        (inputs.filterMap shapeDatum)
        (predicate_mix_no_datum top middle _ ref stake value script mixHash _ hHash hSelect hThird hEqTwo) hi
    | datumHash ref stake value script hash =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 1 [hash]) script) (inputs.map (shapeData mixHash))
        (inputs.filterMap shapeDatum)
        (predicate_mix_datum_hash top middle _ ref stake value script hash mixHash _ hHash hSelect hThird hEqTwo) hi
    | junk ref stake value script datum =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [datum]) script) (inputs.map (shapeData mixHash))
        (inputs.filterMap shapeDatum)
        (predicate_inline_nonconstructor top middle rest ref stake value script datum mixHash _ hHash hSelect hThird hEqTwo hInput) hi
    | box ref stake value script a b =>
      obtain ⟨ha, hb, hab⟩ := hInput
      simpa [shapeData, shapeDatum] using filter_keep top middle _
        (Lovejoin.AnyTx.boxIn ref mixHash stake value script a b) (.Constr 0 [.B a, .B b])
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (predicate_wellformed_box top middle rest ref stake value script mixHash a b _ hHash hSelect hThird
          hEqTwo hEqZero hEq48 hConstr hBytes ha hb hab) hi

    | nonbyteFirst ref stake value script bad other =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [bad, other]]) script)
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (LogicInputMalformed.predicate_nonbyte_first top middle rest ref stake value script mixHash bad other _
          hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes (hBadBytes bad hInput)) hi
    | nonbyteSecond ref stake value script a bad =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 [.B a, bad]]) script)
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (LogicInputMalformed.predicate_nonbyte_second top middle rest ref stake value script mixHash a bad _
          hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes (hBadBytes bad hInput)) hi
    | invalidBox ref stake value script a b =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.boxIn ref mixHash stake value script a b)
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (LogicInputMalformed.predicate_invalid_box top middle rest ref stake value script mixHash a b _
          hHash hSelect hThird hEqTwo hEqZero hEq48 hConstr hBytes hInput) hi
    | wrongTag ref stake value script tag fields =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr tag fields]) script)
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (LogicInputMalformed.predicate_wrong_tag top middle rest ref stake value script mixHash tag fields _
          hHash hSelect hThird hEqTwo hEqZero hInput) hi
    | wrongArity ref stake value script fields =>
      simpa [shapeData, shapeDatum] using filter_skip top middle _
        (Lovejoin.AnyTx.otherIn ref 1 mixHash stake value (.Constr 2 [.Constr 0 fields]) script)
        (inputs.map (shapeData mixHash)) (inputs.filterMap shapeDatum)
        (LogicInputMalformed.predicate_wrong_arity top middle rest ref stake value script mixHash fields _
          hHash hSelect hThird hEqTwo hEqZero hInput) hi

theorem rejects_nonbyte (slots : Fin 31 → CekValue) (rest : Environment) (datum : Data)
    (hBad : ∀ x : ByteString, datum ≠ .B x) :
    Ap default (bytesValue slots rest) (.VCon (.Data datum)) (some (.VCon (.Bool false))) := by
  cases datum with
  | B x => exact False.elim (hBad x rfl)
  | Constr tag fields => apply ap_lam; cek_v3
  | Map entries => apply ap_lam; cek_v3
  | List entries => apply ap_lam; cek_v3
  | I i => apply ap_lam; cek_v3

theorem extended_with_compiled_helpers (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (byteSlots : Fin 31 → CekValue) (selectorRest byteRest rest : Environment)
    (inputs : List Shape) (hValid : ∀ input ∈ inputs, shapeValid mixHash input) :
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
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default filterBody
      (.VCon (.ConstDataList (inputs.map (shapeData mixHash))) :: .VLam filterLoop env :: env)
      (some (.VCon (.ConstDataList (inputs.filterMap shapeDatum)))) := by
  dsimp only
  apply filter_extended
  · rfl
  · exact LogicReferenceFilter.selector_second selectorSlots selectorRest
  · exact third_select selectorSlots selectorRest
  · rfl
  · rfl
  · rfl
  · rfl
  · exact bytes_accept byteSlots byteRest
  · exact rejects_nonbyte byteSlots byteRest
  · exact hValid

/-- The compiled collector wrapper reads the transaction input list and returns
the same ordered box datums for the supported arbitrary input layouts. -/
theorem extended_collector_reads_inputs (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (byteSlots : Fin 31 → CekValue) (selectorRest byteRest rest : Environment)
    (r : TxRest) (refs sigs : Data) (inputs : List Shape)
    (hValid : ∀ input ∈ inputs, shapeValid mixHash input)
    (hInfo : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map (shapeData mixHash))) refs sigs))) :
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
    let env := filterEnv top middle
      (.VBuiltin .ChooseData [] (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.More .ArgV (.One .ArgV)))))) :: rest)
    Ev default collectorBody env (some (.VCon (.ConstDataList (inputs.filterMap shapeDatum)))) := by
  have hFilter := extended_with_compiled_helpers mixHash defaultTop defaultMiddle selectorSlots byteSlots
    selectorRest byteRest rest inputs hValid
  have hInfo' : defaultMiddle (2 : Fin 11) = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map (shapeData mixHash))) refs sigs)) := hInfo
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


end Lovejoin.AnyTx.LogicInputExtended

#print axioms Lovejoin.AnyTx.LogicInputExtended.filter_extended

/--
info: 'Lovejoin.AnyTx.LogicInputExtended.extended_collector_reads_inputs' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputExtended.extended_collector_reads_inputs
