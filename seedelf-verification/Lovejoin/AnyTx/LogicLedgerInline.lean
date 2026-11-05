import Lovejoin.AnyTx.LogicCarrierCoverSafety
import Lovejoin.AnyTx.LogicLedgerUniqueness

/-! A unique carrier with no inline datum cannot authorize either withdrawal. -/
namespace Lovejoin.AnyTx.LogicLedgerInline
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
set_option maxHeartbeats 0

theorem filter_single_slots (t0 t1 t2 t3 t4 t5 t6 : CekValue) (selector c72 c29 c28 c26 : CekValue)
    (m0 m1 m2 m3 m4 m5 m6 m7 : CekValue) (P name : ByteString) (rest : Environment)
    (hSelect : ∀ a b : Data, ∀ others : List Data,
      Ap default selector (.VCon (.ConstDataList (a :: b :: others))) (some (.VCon (.Data b))))
    (refs : List Candidate)
    (hOrdered : ∀ item ∈ refs, ordered P name item)
    (hP : PlutusCore.ByteString.lessThanEqualsByteString P P = true)
    (hN : PlutusCore.ByteString.lessThanEqualsByteString name name = true)
    (first : Data)
    (hSingle : matching P name refs = [first]) :
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
    filter_exact top selector c72 c29 c28 c26 middle P name rest hSelect hP hN refs hOrdered



/-- A sole carrier without a datum rejects this owner withdrawal. -/
theorem owner_no_datum_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List (ByteString × ByteString)) (ref addr value script : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
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
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
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
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
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
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
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
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_no_datum_errors P r ins sigs acct refs ps ref addr value script hOrdered hSelected
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct bad before after hb

/-- The datum_hash carrier case rejects every raw Owner proof list. -/
theorem owner_raw_datum_hash_errors (P : ByteString) (r : TxRest) (ins sigs acct : Data)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]]) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs r ins
        (.List (refs.map (candidateData P nftName))) sigs,
        .Constr 0 [.List proofs], .Constr 2 [acct]])] n = .Error := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨ps, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · rw [hp]
    exact owner_datum_hash_errors P r ins sigs acct refs ps ref addr value script hash hOrdered hSelected
  · rw [hp]
    exact LogicOwnerMalformed.invalid_proof_errors P r ins (.List (refs.map (candidateData P nftName)))
      sigs acct bad before after hb

/-- Typed owner withdrawals fail when the sole carrier has no datum. -/
theorem owner_typed_no_datum_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]])
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
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hOrdered hSelected

/-- Typed owner withdrawals fail when the sole carrier has datum hash. -/
theorem owner_typed_datum_hash_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]])
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
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hash hOrdered hSelected

/-- Typed mix withdrawals fail when the sole carrier has no datum. -/
theorem mix_typed_no_datum_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 0 [], script]]])
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
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hOrdered hSelected

/-- Typed mix withdrawals fail when the sole carrier has datum hash. -/
theorem mix_typed_datum_hash_errors (P : ByteString) (tx : TxInfo) (acct : Credential)
    (refs : List Candidate) (proofs : List Data) (ref addr value script hash : Data)
    (hOrdered : ∀ item ∈ refs, ordered P nftName item)
    (hSelected : matching P nftName refs = [.Constr 0 [ref, .Constr 0 [addr, value, .Constr 1 [hash], script]]])
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
    (IsData.toData tx.txInfoSignatories) (IsData.toData acct) refs proofs ref addr value script hash hOrdered hSelected

/-- If a covered input contains the NFT and the filter is a singleton, that
singleton is the encoded input itself. -/
theorem selected_input (P : ByteString) (inputs : List TxInInfo) (items : List Candidate)
    (input : TxInInfo) (hi : input ∈ inputs)
    (hn : LogicLedgerUniqueness.hasNft P nftName input)
    (hm : matching P nftName items =
      (inputs.filter fun i => decide (LogicLedgerUniqueness.hasNft P nftName i)).map IsData.toData)
    (hOne : ∃ carrier, matching P nftName items = [carrier]) :
    matching P nftName items = [IsData.toData input] := by
  classical
  have hmem : IsData.toData input ∈ matching P nftName items := by
    rw [hm]
    apply List.mem_map.mpr
    exact ⟨input, List.mem_filter.mpr ⟨hi, by simp [hn]⟩, rfl⟩
  obtain ⟨carrier, hc⟩ := hOne
  rw [hc] at hmem
  simp only [List.mem_singleton] at hmem
  simpa [hmem] using hc

/-- Successful Owner execution with valid reference inputs requires its unique
NFT-bearing reference output to carry an inline datum. -/
theorem owner_requires_inline_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ LogicLedgerUniqueness.hasNft P nftName input ∧
      (∃ datum, input.txInInfoResolved.txOutDatum = .OutputDatum datum) ∧
      ∀ other ∈ tx.txInfoReferenceInputs, LogicLedgerUniqueness.hasNft P nftName other → other = input := by
  classical
  obtain ⟨input, hi, hn, hu⟩ := LogicLedgerUniqueness.owner_requires_unique_nft_reference P tx acct proofs hValid hSuccess
  obtain ⟨items, he, ho, hm⟩ := LogicLedgerUniqueness.valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (LogicLedgerValueCover.valid_reference_inputs_values (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  have hOne := LogicCarrierCoverSafety.owner_acceptance_requires_unique_carrier P tx acct items proofs ho he hSuccess
  have hs := selected_input P tx.txInfoReferenceInputs items input hi hn hm hOne
  have hd : ∃ datum, input.txInInfoResolved.txOutDatum = .OutputDatum datum := by
    cases input with
    | mk ref out =>
      cases out with
      | mk addr value datum script =>
        cases datum with
        | NoOutputDatum =>
          have herr := owner_typed_no_datum_errors P tx acct items proofs (IsData.toData ref)
            (IsData.toData addr) (.Map value) (IsData.toData script) ho hs he
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hn⟩ := hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
        | OutputDatumHash hash =>
          have herr := owner_typed_datum_hash_errors P tx acct items proofs (IsData.toData ref)
            (IsData.toData addr) (.Map value) (IsData.toData script) (IsData.toData hash) ho hs he
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hn⟩ := hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
        | OutputDatum datum => exact ⟨datum, rfl⟩
  exact ⟨input, hi, hn, hd, hu⟩


/-- Successful Mix execution with valid reference inputs requires its unique
NFT-bearing reference output to carry an inline datum. -/
theorem mix_requires_inline_carrier (P : ByteString) (tx : TxInfo) (acct : Credential)
    (proofs : List Data)
    (hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) = true)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input, input ∈ tx.txInfoReferenceInputs ∧ LogicLedgerUniqueness.hasNft P nftName input ∧
      (∃ datum, input.txInInfoResolved.txOutDatum = .OutputDatum datum) ∧
      ∀ other ∈ tx.txInfoReferenceInputs, LogicLedgerUniqueness.hasNft P nftName other → other = input := by
  classical
  obtain ⟨input, hi, hn, hu⟩ := LogicLedgerUniqueness.mix_requires_unique_nft_reference P tx acct proofs hValid hSuccess
  obtain ⟨items, he, ho, hm⟩ := LogicLedgerUniqueness.valid_inputs_exact_cover P nftName tx.txInfoReferenceInputs
    (LogicLedgerValueCover.valid_reference_inputs_values (⟨tx, .Constr 1 [.List proofs], .RewardingScript acct⟩ : ScriptContext) hValid)
  have hOne := LogicCarrierCoverSafety.mix_acceptance_requires_unique_carrier P tx acct items proofs ho he hSuccess
  have hs := selected_input P tx.txInfoReferenceInputs items input hi hn hm hOne
  have hd : ∃ datum, input.txInInfoResolved.txOutDatum = .OutputDatum datum := by
    cases input with
    | mk ref out =>
      cases out with
      | mk addr value datum script =>
        cases datum with
        | NoOutputDatum =>
          have herr := mix_typed_no_datum_errors P tx acct items proofs (IsData.toData ref)
            (IsData.toData addr) (.Map value) (IsData.toData script) ho hs he
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hn⟩ := hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
        | OutputDatumHash hash =>
          have herr := mix_typed_datum_hash_errors P tx acct items proofs (IsData.toData ref)
            (IsData.toData addr) (.Map value) (IsData.toData script) (IsData.toData hash) ho hs he
          obtain ⟨m, hm⟩ := herr
          obtain ⟨n, hn⟩ := hSuccess
          exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
        | OutputDatum datum => exact ⟨datum, rfl⟩
  exact ⟨input, hi, hn, hd, hu⟩

end Lovejoin.AnyTx.LogicLedgerInline


/--
info: 'Lovejoin.AnyTx.LogicLedgerInline.owner_requires_inline_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerInline.owner_requires_inline_carrier
/--
info: 'Lovejoin.AnyTx.LogicLedgerInline.mix_requires_inline_carrier' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLedgerInline.mix_requires_inline_carrier
