import Lovejoin.AnyTx.LogicInputExtended

/-! Complete typed-ledger input cover for the compiled box collector. -/
namespace Lovejoin.AnyTx.LogicInputCover
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open Lovejoin.AnyTx.LogicInputExtended
open Lovejoin.AnyTx.LogicInputFilter
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.LogicInputHelpers
open Lovejoin.AnyTx.CekCase

theorem two_fields (M : ByteString) (ref stake value script first second : Data) :
    ∃ shape : Shape, shapeData M shape = Lovejoin.AnyTx.otherIn ref 1 M stake value
      (.Constr 2 [.Constr 0 [first, second]]) script ∧ shapeValid M shape := by
  by_cases hf : ∃ a : ByteString, first = .B a
  · obtain ⟨a, rfl⟩ := hf
    by_cases hs : ∃ b : ByteString, second = .B b
    · obtain ⟨b, rfl⟩ := hs
      by_cases ha : PlutusCore.ByteString.lengthOfByteString a = 48
      · by_cases hb : PlutusCore.ByteString.lengthOfByteString b = 48
        · by_cases heq : a = b
          · exact ⟨.invalidBox ref stake value script a b, rfl, Or.inr (Or.inr heq)⟩
          · exact ⟨.box ref stake value script a b, rfl, ha, hb, heq⟩
        · exact ⟨.invalidBox ref stake value script a b, rfl, Or.inr (Or.inl hb)⟩
      · exact ⟨.invalidBox ref stake value script a b, rfl, Or.inl ha⟩
    · refine ⟨.nonbyteSecond ref stake value script a second, rfl, ?_⟩
      intro x hx
      exact hs ⟨x, hx⟩
  · refine ⟨.nonbyteFirst ref stake value script first second, rfl, ?_⟩
    intro x hx
    exact hf ⟨x, hx⟩

theorem inline_datum (M : ByteString) (ref stake value script datum : Data) :
    ∃ shape : Shape, shapeData M shape = Lovejoin.AnyTx.otherIn ref 1 M stake value
      (.Constr 2 [datum]) script ∧ shapeValid M shape := by
  cases datum with
  | I i => exact ⟨.junk ref stake value script (.I i), rfl, by intro tag fields h; cases h⟩
  | B bytes => exact ⟨.junk ref stake value script (.B bytes), rfl, by intro tag fields h; cases h⟩
  | List xs => exact ⟨.junk ref stake value script (.List xs), rfl, by intro tag fields h; cases h⟩
  | Map xs => exact ⟨.junk ref stake value script (.Map xs), rfl, by intro tag fields h; cases h⟩
  | Constr tag fields =>
    by_cases ht : tag = 0
    · subst tag
      by_cases hn : fields.length = 2
      · cases fields with
        | nil => simp at hn
        | cons a rest =>
          cases rest with
          | nil => simp at hn
          | cons b tail =>
            cases tail with
            | nil => exact two_fields M ref stake value script a b
            | cons c more => simp at hn
      · exact ⟨.wrongArity ref stake value script fields, rfl, hn⟩
    · exact ⟨.wrongTag ref stake value script tag fields, rfl, ht⟩

/-- Every typed ledger input has an extended collector representation. -/
theorem ledger_input (M : ByteString) (input : TxInInfo) :
    ∃ shape : Shape, shapeData M shape = IsData.toData input ∧ shapeValid M shape := by
  cases input with
  | mk ref out =>
    cases out with
    | mk addr value datum script =>
      cases addr with
      | mk credential stake =>
        cases credential with
        | PubKeyCredential key =>
          exact ⟨.key (IsData.toData ref) (IsData.toData stake) (IsData.toData value)
            (IsData.toData datum) (IsData.toData script) key, rfl, trivial⟩
        | ScriptCredential hash =>
          by_cases heq : hash = M
          · subst hash
            cases datum with
            | NoOutputDatum =>
              exact ⟨.noDatum (IsData.toData ref) (IsData.toData stake) (IsData.toData value)
                (IsData.toData script), rfl, trivial⟩
            | OutputDatumHash hash =>
              exact ⟨.datumHash (IsData.toData ref) (IsData.toData stake) (IsData.toData value)
                (IsData.toData script) (.B hash), rfl, trivial⟩
            | OutputDatum data =>
              exact inline_datum M (IsData.toData ref) (IsData.toData stake) (IsData.toData value)
                (IsData.toData script) data
          · exact ⟨.foreign (IsData.toData ref) (IsData.toData stake) (IsData.toData value)
              (IsData.toData datum) (IsData.toData script) hash, rfl, heq⟩

/-- Every list of typed ledger inputs has an order-preserving valid representation. -/
theorem ledger_inputs (M : ByteString) (inputs : List TxInInfo) :
    ∃ shapes : List Shape, shapes.map (shapeData M) = inputs.map IsData.toData ∧
      ∀ shape ∈ shapes, shapeValid M shape := by
  induction inputs with
  | nil => exact ⟨[], rfl, by simp⟩
  | cons input inputs ih =>
    obtain ⟨shape, hs, hv⟩ := ledger_input M input
    obtain ⟨shapes, hss, hvs⟩ := ih
    refine ⟨shape :: shapes, ?_, ?_⟩
    · simp only [List.map_cons, hs, hss]
    · intro candidate hc
      simp only [List.mem_cons] at hc
      rcases hc with rfl | hc
      · exact hv
      · exact hvs candidate hc

/-- The compiled collector reads and filters any typed ledger input list. -/
theorem collector_reads_ledger_inputs (mixHash : ByteString)
    (defaultTop : Fin 14 → CekValue) (defaultMiddle : Fin 11 → CekValue) (selectorSlots : Fin 19 → CekValue)
    (byteSlots : Fin 31 → CekValue) (selectorRest byteRest rest : Environment)
    (r : TxRest) (refs sigs : Data) (inputs : List TxInInfo)
    (hInfo : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (inputs.map IsData.toData)) refs sigs))) :
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
    ∃ shapes : List Shape, shapes.map (shapeData mixHash) = inputs.map IsData.toData ∧
      (∀ shape ∈ shapes, shapeValid mixHash shape) ∧
      Ev default collectorBody env (some (.VCon (.ConstDataList (shapes.filterMap shapeDatum)))) := by
  obtain ⟨shapes, hShapes, hValid⟩ := ledger_inputs mixHash inputs
  refine ⟨shapes, hShapes, hValid, ?_⟩
  have hInfo' : defaultMiddle ⟨2, by decide⟩ = .VCon (.Data
      (Lovejoin.AnyTx.withInputs r (.List (shapes.map (shapeData mixHash))) refs sigs)) := by
    rw [hShapes]
    exact hInfo
  exact LogicInputExtended.extended_collector_reads_inputs mixHash defaultTop defaultMiddle selectorSlots
    byteSlots selectorRest byteRest rest r refs sigs shapes hValid hInfo'

end Lovejoin.AnyTx.LogicInputCover
#print axioms Lovejoin.AnyTx.LogicInputCover.ledger_inputs

/--
info: 'Lovejoin.AnyTx.LogicInputCover.collector_reads_ledger_inputs' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInputCover.collector_reads_ledger_inputs
