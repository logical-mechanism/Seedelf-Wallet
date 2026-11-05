import Lovejoin.AnyTx.LogicOwnerBoundaryPartial
import Lovejoin.AnyTx.LogicOwnerShape
import Lovejoin.AnyTx.LogicInputFilter
import Lovejoin.AnyTx.LogicInputExtended
import Lovejoin.AnyTx.LogicInputCover

/-! Relate whole-validator proof parsing to the supported input collector. -/
namespace Lovejoin.AnyTx.LogicOwnerShapesJoin
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicInputFilter
open Lovejoin.Template (nftName)

theorem zip_members {α β : Type} (xs : List α) (ys : List β) (x : α) (y : β)
    (h : (x, y) ∈ xs.zip ys) : x ∈ xs ∧ y ∈ ys := by
  induction xs generalizing ys with
  | nil => simp at h
  | cons a xs ih =>
    cases ys with
    | nil => simp at h
    | cons b ys =>
      simp only [List.zip_cons_cons, List.mem_cons, Prod.mk.injEq] at h
      rcases h with h | h
      · rcases h with ⟨rfl, rfl⟩
        simp
      · have hm := ih ys h
        simp [hm.1, hm.2]

/-- The collector's selected datums and a parsed Owner proof list have the
constructor shapes required by the compiled verifier, at every aligned index. -/
theorem supported_pairs_have_shapes (inputs : List InputShape) (parsed : List (ByteString × ByteString)) :
    ∀ datum proof, (datum, proof) ∈ (inputs.filterMap inputShapeDatum).zip (LogicOwnerParse.proofList parsed) →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  intro datum proof hp
  have ⟨hd, hproof⟩ := zip_members _ _ _ _ hp
  obtain ⟨input, _, hi⟩ := List.mem_filterMap.mp hd
  obtain ⟨pair, _, hp⟩ := List.mem_map.mp hproof
  cases input with
  | key | foreign | noDatum | datumHash | junk => simp [inputShapeDatum] at hi
  | box ref stake value script a b =>
    simp only [inputShapeDatum, Option.some.injEq] at hi
    refine ⟨a, b, pair.1, pair.2, hi.symm, ?_⟩
    simpa [LogicOwnerParse.proofList, proofData] using hp.symm

/-- Full-validator Owner acceptance supplies the proof-list half of the pair
shapes for any input list represented by the collector's supported shapes. -/
theorem acceptance_supplies_pair_shapes (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data) (inputs : List InputShape)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∀ datum proof, (datum, proof) ∈ (inputs.filterMap inputShapeDatum).zip proofs →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  obtain ⟨parsed, hp⟩ := LogicOwnerShape.acceptance_requires_well_formed_proof_list P tx acct proofs hSuccess
  rw [hp]
  exact supported_pairs_have_shapes inputs parsed

theorem extended_pairs_have_shapes (inputs : List LogicInputExtended.Shape) (parsed : List (ByteString × ByteString)) :
    ∀ datum proof, (datum, proof) ∈ (inputs.filterMap LogicInputExtended.shapeDatum).zip (LogicOwnerParse.proofList parsed) →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  intro datum proof hp
  have ⟨hd, hproof⟩ := zip_members _ _ _ _ hp
  obtain ⟨input, _, hi⟩ := List.mem_filterMap.mp hd
  obtain ⟨pair, _, hp⟩ := List.mem_map.mp hproof
  cases input with
  | key | foreign | noDatum | datumHash | junk | nonbyteFirst | nonbyteSecond | invalidBox | wrongTag | wrongArity => simp [LogicInputExtended.shapeDatum] at hi
  | box ref stake value script a b =>
    simp only [LogicInputExtended.shapeDatum, Option.some.injEq] at hi
    refine ⟨a, b, pair.1, pair.2, hi.symm, ?_⟩
    simpa [LogicOwnerParse.proofList, proofData] using hp.symm

/-- Full-validator Owner acceptance supplies the proof-list half of the pair
shapes for any input list represented by the collector's supported shapes. -/
theorem acceptance_supplies_extended_pair_shapes (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data) (inputs : List LogicInputExtended.Shape)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∀ datum proof, (datum, proof) ∈ (inputs.filterMap LogicInputExtended.shapeDatum).zip proofs →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  obtain ⟨parsed, hp⟩ := LogicOwnerShape.acceptance_requires_well_formed_proof_list P tx acct proofs hSuccess
  rw [hp]
  exact extended_pairs_have_shapes inputs parsed


/-- Whole-validator Owner acceptance and any typed input list supply the
extended collector representation and the corresponding aligned pair shapes. -/
theorem acceptance_supplies_ledger_pair_shapes (P M : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ inputs : List LogicInputExtended.Shape,
      inputs.map (LogicInputExtended.shapeData M) = tx.txInfoInputs.map IsData.toData ∧
      (∀ input ∈ inputs, LogicInputExtended.shapeValid M input) ∧
      ∀ datum proof, (datum, proof) ∈ (inputs.filterMap LogicInputExtended.shapeDatum).zip proofs →
        ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] := by
  obtain ⟨inputs, hInputs, hValid⟩ := LogicInputCover.ledger_inputs M tx.txInfoInputs
  exact ⟨inputs, hInputs, hValid, acceptance_supplies_extended_pair_shapes P tx acct proofs inputs hSuccess⟩

end Lovejoin.AnyTx.LogicOwnerShapesJoin

/--
info: 'Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_pair_shapes' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_pair_shapes

/--
info: 'Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_extended_pair_shapes' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_extended_pair_shapes

/--
info: 'Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_ledger_pair_shapes' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerShapesJoin.acceptance_supplies_ledger_pair_shapes
