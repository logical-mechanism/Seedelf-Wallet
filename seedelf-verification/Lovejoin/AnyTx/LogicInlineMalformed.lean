import Lovejoin.AnyTx.LogicLedgerInline

namespace Lovejoin.AnyTx.LogicInlineMalformed
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicReferenceFilter (filterEnv filterLoop filterBody)
open Lovejoin.AnyTx.LogicCarrierCover
open Lovejoin.Template (nftName)
open Classical
open Lovejoin.AnyTx.LogicLedgerInline
set_option maxHeartbeats 0

/-- A sole carrier with an integer inline datum rejects this owner withdrawal. -/
theorem owner_integer_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data) (bad : PlutusCore.Integer.Integer)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.I bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3

/-- A sole carrier with an integer inline datum rejects this mix withdrawal. -/
theorem mix_integer_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data) (bad : PlutusCore.Integer.Integer)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.I bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3



/-- A sole carrier with a bytes inline datum rejects this owner withdrawal. -/
theorem owner_bytes_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data) (bad : ByteString)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.B bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3

/-- A sole carrier with a bytes inline datum rejects this mix withdrawal. -/
theorem mix_bytes_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data) (bad : ByteString)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.B bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3



/-- A sole carrier with a list inline datum rejects this owner withdrawal. -/
theorem owner_list_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data) (bad : List Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.List bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3

/-- A sole carrier with a list inline datum rejects this mix withdrawal. -/
theorem mix_list_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data) (bad : List Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.List bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3



/-- A sole carrier with a map inline datum rejects this owner withdrawal. -/
theorem owner_map_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data) (bad : List (Data × Data))
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.Map bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicOwnerParse.owner_proof_list_validates, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3

/-- A sole carrier with a map inline datum rejects this mix withdrawal. -/
theorem mix_map_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data) (bad : List (Data × Data))
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [.Map bad], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List (proofs)], .Constr 2 [acct]])] n = .Error := by
  have hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true := by
    change decide (P.data ≤ P.data) = true
    simp [String.le_refl]
  have hN : PlutusCore.ByteString.lessThanEqualsByteString nftName nftName = true := by
    change decide (nftName.data ≤ nftName.data) = true
    simp [String.le_refl]
  apply exec_error_of_ev
  cek_v3_using [LogicMixParse.mix_arbitrary_proof_list_errors, filter_single_slots]
  all_goals try (intros; apply ap_lam; cek_v3)
  all_goals try assumption
  all_goals try cek_v3
  all_goals try assumption
  all_goals try cek_v3


/-- Owner rejects a non-constructor inline reference datum for any parsed proof list. -/
theorem owner_nonconstructor_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script bad : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [bad], script]]])
    (hBad : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List (LogicOwnerParse.proofList proofs)], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (hBad tag fields rfl)
  | Map bad => exact owner_map_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | List bad => exact owner_list_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | I bad => exact owner_integer_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | B bad => exact owner_bytes_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected

/-- Mix rejects a non-constructor inline reference datum for arbitrary raw proofs. -/
theorem mix_nonconstructor_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script bad : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [bad], script]]])
    (hBad : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 1 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  cases bad with
  | Constr tag fields => exact False.elim (hBad tag fields rfl)
  | Map bad => exact mix_map_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | List bad => exact mix_list_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | I bad => exact mix_integer_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected
  | B bad => exact mix_bytes_datum_errors P r ins sigs acct refs proofs ref addr value script bad hOrdered hSelected

/-- The same Owner result includes malformed raw proof lists. -/
theorem owner_raw_nonconstructor_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script bad : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 2 [bad], script]]])
    (hBad : ∀ tag fields, bad ≠ .Constr tag fields) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, malformed, after, hp, hb⟩
  · rw [hp]
    exact owner_nonconstructor_errors P r ins sigs acct refs ps ref addr value script bad hOrdered hSelected hBad
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct malformed before after hb

/-- In a ledger-valid Owner withdrawal, the unique NFT reference carries an
inline constructor datum. The constructor's fields are not characterized here. -/
theorem owner_requires_constructor_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ LogicLedgerUniqueness.hasNft P nftName input ∧
      (∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields)) ∧
      ∀ other ∈ tx.txInfoReferenceInputs, LogicLedgerUniqueness.hasNft P nftName other → other = input := by
  classical
  obtain ⟨input, hi, hn, ⟨datum, hd⟩, hu⟩ :=
    LogicLedgerInline.owner_requires_inline_carrier P tx acct proofs hValid hSuccess
  obtain ⟨items, he, ho, hm⟩ := LogicLedgerUniqueness.valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (LogicLedgerValueCover.valid_reference_inputs_values (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  have hOne := LogicCarrierCoverSafety.owner_acceptance_requires_unique_carrier P tx acct items proofs ho he hSuccess
  have hs := LogicLedgerInline.selected_input P tx.txInfoReferenceInputs items input hi hn hm hOne
  have hShape : ∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields) := by
    by_cases hShape : ∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields)
    · exact hShape
    exfalso
    have hBad : ∀ tag fields, datum ≠ .Constr tag fields := by
      intro tag fields hEq
      apply hShape
      exact ⟨tag, fields, by simpa [hEq] using hd⟩
    cases input with
    | mk ref out =>
      cases out with
      | mk addr value od script =>
        cases od with
        | NoOutputDatum => cases hd
        | OutputDatumHash hash => cases hd
        | OutputDatum actual =>
          cases hd
          have herr := owner_raw_nonconstructor_errors P (TxRest.ofTxInfo tx)
            (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct)
            items proofs (IsData.toData ref) (IsData.toData addr) (.Map value) (IsData.toData script)
            datum ho hs hBad
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hSuccess⟩ := hSuccess
          change cekExecuteProgram mixLogicTemplate.script
            [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
              (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
              (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])]
            n = .Halt (.VCon .Unit) at hSuccess
          rw [he] at hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hSuccess)
  exact ⟨input, hi, hn, hShape, hu⟩


/-- In a ledger-valid Mix withdrawal, the unique NFT reference carries an
inline constructor datum. The constructor's fields are not characterized here. -/
theorem mix_requires_constructor_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ LogicLedgerUniqueness.hasNft P nftName input ∧
      (∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields)) ∧
      ∀ other ∈ tx.txInfoReferenceInputs, LogicLedgerUniqueness.hasNft P nftName other → other = input := by
  classical
  obtain ⟨input, hi, hn, ⟨datum, hd⟩, hu⟩ :=
    LogicLedgerInline.mix_requires_inline_carrier P tx acct proofs hValid hSuccess
  obtain ⟨items, he, ho, hm⟩ := LogicLedgerUniqueness.valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (LogicLedgerValueCover.valid_reference_inputs_values (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  have hOne := LogicCarrierCoverSafety.mix_acceptance_requires_unique_carrier P tx acct items proofs ho he hSuccess
  have hs := LogicLedgerInline.selected_input P tx.txInfoReferenceInputs items input hi hn hm hOne
  have hShape : ∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields) := by
    by_cases hShape : ∃ tag fields, input.txInInfoResolved.txOutDatum = .OutputDatum (.Constr tag fields)
    · exact hShape
    exfalso
    have hBad : ∀ tag fields, datum ≠ .Constr tag fields := by
      intro tag fields hEq
      apply hShape
      exact ⟨tag, fields, by simpa [hEq] using hd⟩
    cases input with
    | mk ref out =>
      cases out with
      | mk addr value od script =>
        cases od with
        | NoOutputDatum => cases hd
        | OutputDatumHash hash => cases hd
        | OutputDatum actual =>
          cases hd
          have herr := mix_nonconstructor_errors P (TxRest.ofTxInfo tx)
            (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoSignatories) (IsData.toData acct)
            items proofs (IsData.toData ref) (IsData.toData addr) (.Map value) (IsData.toData script)
            datum ho hs hBad
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hSuccess⟩ := hSuccess
          change cekExecuteProgram mixLogicTemplate.script
            [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
              (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
              (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])]
            n = .Halt (.VCon .Unit) at hSuccess
          rw [he] at hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hSuccess)
  exact ⟨input, hi, hn, hShape, hu⟩

end Lovejoin.AnyTx.LogicInlineMalformed

/--
info: 'Lovejoin.AnyTx.LogicInlineMalformed.owner_requires_constructor_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInlineMalformed.owner_requires_constructor_carrier
/--
info: 'Lovejoin.AnyTx.LogicInlineMalformed.mix_requires_constructor_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicInlineMalformed.mix_requires_constructor_carrier
