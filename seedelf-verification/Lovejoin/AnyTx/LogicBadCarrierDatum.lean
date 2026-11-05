import Lovejoin.AnyTx.LogicVariableNecessary

/-! A unique carrier with no inline datum cannot authorize either withdrawal. -/
namespace Lovejoin.AnyTx.LogicBadCarrierDatum
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
open Lovejoin.AnyTx.LogicCarrierVariable
open Lovejoin.Template (nftName)
set_option maxHeartbeats 0

theorem filter_single_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString name pair.1 = false)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (first : Data)
    (hSingle : matchingCandidates P name refs = [first]) :
    Ev default filterBody
      (.VCon (.ConstDataList (refs.map (candidateData P name))) ::
        .VLam filterLoop ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6] ++ selector :: c72 :: c29 :: c28 :: .VBuiltin .EqualsInteger [.VCon (.Integer 1)] (.One .ArgV) :: c26 :: [m0, m1, m2, m3, m4, m5, m6, m7] ++
          .VCon (.ByteString name) :: .VCon (.ByteString P) :: .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
          .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.ConstDataList [first]))) := by
  let top : Fin 7 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6] : List CekValue).getD i.val t0
  let middle : Fin 8 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7] : List CekValue).getD i.val m0
  simpa [filterEnv, top, middle, List.ofFn, hSingle] using
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hPolicies hNames



/-- A sole carrier without a datum rejects this owner withdrawal. -/
theorem owner_no_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
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

/-- A sole carrier without a datum rejects this mix withdrawal. -/
theorem mix_no_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
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

/-- A sole carrier with a datum hash rejects this owner withdrawal. -/
theorem owner_datum_hash_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script hash : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
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

/-- A sole carrier with a datum hash rejects this mix withdrawal. -/
theorem mix_datum_hash_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
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

/-- The no_datum carrier case rejects every raw Owner proof list. -/
theorem owner_raw_no_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_no_datum_errors P r ins sigs acct refs ps ref addr value script hPolicies hNames hSelected
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct bad before after hb

/-- The datum_hash carrier case rejects every raw Owner proof list. -/
theorem owner_raw_datum_hash_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_datum_hash_errors P r ins sigs acct refs ps ref addr value script hash hPolicies hNames hSelected
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct bad before after hb

/-- Typed owner withdrawals fail when the sole carrier has no datum. -/
theorem owner_typed_no_datum_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]])
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_raw_no_datum_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hPolicies hNames hSelected

/-- Typed owner withdrawals fail when the sole carrier has datum hash. -/
theorem owner_typed_datum_hash_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]])
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact owner_raw_datum_hash_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hash hPolicies hNames hSelected

/-- Typed mix withdrawals fail when the sole carrier has no datum. -/
theorem mix_typed_no_datum_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]])
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_no_datum_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hPolicies hNames hSelected

/-- Typed mix withdrawals fail when the sole carrier has datum hash. -/
theorem mix_typed_datum_hash_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hPolicies : ∀ item ∈ refs, ∀ pair ∈ item.beforePolicies,
      PlutusCore.ByteString.lessThanEqualsByteString P pair.1 = false)
    (hNames : ∀ item ∈ refs, ∀ pair ∈ item.beforeNames,
      PlutusCore.ByteString.lessThanEqualsByteString nftName pair.1 = false)
    (hSelected : matchingCandidates P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]])
    (hRefs : IsData.toData tx.txInfoReferenceInputs = Data.List (refs.map (candidateData P nftName))) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Error := by
  change ∃ n, cekExecuteProgram mixLogicTemplate.script
    [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories), .Constr 1 [.List proofs], .Constr 2 [IsData.toData acct]])] n = .Error
  rw [hRefs]
  exact mix_datum_hash_errors P (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoInputs)
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hash hPolicies hNames hSelected

end Lovejoin.AnyTx.LogicBadCarrierDatum

/--
info: 'Lovejoin.AnyTx.LogicBadCarrierDatum.owner_typed_no_datum_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBadCarrierDatum.owner_typed_no_datum_errors
/--
info: 'Lovejoin.AnyTx.LogicBadCarrierDatum.mix_typed_datum_hash_errors' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBadCarrierDatum.mix_typed_datum_hash_errors
