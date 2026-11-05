import Lovejoin.AnyTx.BoxGateAll
import Lovejoin.AnyTx.BoxInlineAll

/-! Complete inline-datum rule for mix_box, assembled from kernel-checked
unbounded CEK proofs. The spent input is located after an arbitrary nonmatching
prefix; later inputs and the complete withdrawal map have arbitrary length. -/
namespace Lovejoin.AnyTx.BoxComplete
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Lovejoin.Classic (wellFormed)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.BoxSearch (inputList)

/-- The successful decode has exactly two distinct 48-byte fields. -/
theorem boxDatum_true (datum : Data) (h : isBoxDatum datum = true) :
    ∃ a b, datum = .Constr 0 [.B a, .B b] ∧
      lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b := by
  cases datum with
  | B x => simp [isBoxDatum] at h
  | I x => simp [isBoxDatum] at h
  | List xs => simp [isBoxDatum] at h
  | Map xs => simp [isBoxDatum] at h
  | Constr tag xs =>
    cases tag with
    | negSucc n => simp [isBoxDatum] at h
    | ofNat n =>
      cases n with
      | succ n => cases h
      | zero =>
        cases xs with
        | nil => simp [isBoxDatum] at h
        | cons x rest =>
          cases rest with
          | nil => simp [isBoxDatum] at h
          | cons y rest =>
            cases rest with
            | cons z zs => simp [isBoxDatum] at h
            | nil =>
              cases x with
              | I i => simp [isBoxDatum] at h
              | List xs => simp [isBoxDatum] at h
              | Map xs => simp [isBoxDatum] at h
              | Constr k fs => simp [isBoxDatum] at h
              | B a =>
                cases y with
                | I i => simp [isBoxDatum] at h
                | List xs => simp [isBoxDatum] at h
                | Map xs => simp [isBoxDatum] at h
                | Constr k fs => simp [isBoxDatum] at h
                | B b =>
                  simp [isBoxDatum, wellFormed] at h
                  exact ⟨a, b, rfl, h.1.1, h.1.2, h.2⟩

/-- For any inline datum, unit is returned exactly for a malformed datum or a
withdrawal by mix_logic. The theorem is unbounded in both traversed lists. -/
theorem inline_gate_iff (L : ByteString) (r : TxRest)
    (sigs red ref rd addr value script : Data) (before after wdrl : List (Data × Data))
    (hBefore : ∀ pair ∈ before, pair.1 ≠ ref) (datum : Data) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)))
        (.Map wdrl) sigs red ref rd)] n = .Halt (.VCon .Unit)) ↔
      (isBoxDatum datum = false ∨ ∃ amount, (logicKey L, amount) ∈ wdrl) := by
  cases hd : isBoxDatum datum with
  | false =>
    constructor
    · intro _; exact Or.inl rfl
    · intro _; exact BoxInlineAll.malformed_inline_recovers L r sigs red ref rd (.Map wdrl) addr value script before after hBefore datum hd
  | true =>
    obtain ⟨a, b, rfl, ha, hb, hne⟩ := boxDatum_true datum hd
    constructor
    · intro hs
      exact Or.inr ((BoxGateAll.wellformed_gate_iff L a b r sigs red ref rd addr value script before after wdrl hBefore ha hb hne).mp hs)
    · rintro (bad | has)
      · cases bad
      · exact (BoxGateAll.wellformed_gate_iff L a b r sigs red ref rd addr value script before after wdrl hBefore ha hb hne).mpr has

end Lovejoin.AnyTx.BoxComplete

#print axioms Lovejoin.AnyTx.BoxComplete.inline_gate_iff
