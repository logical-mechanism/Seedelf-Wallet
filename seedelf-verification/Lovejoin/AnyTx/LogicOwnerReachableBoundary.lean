import Lovejoin.AnyTx.LogicOwnerConditions
import Lovejoin.AnyTx.LogicOwnerPairingPartial
import Lovejoin.AnyTx.LogicOwnerEntry

/-! Composed compiled Owner prologue, context hash and Schnorr checks. -/
namespace Lovejoin.AnyTx.LogicOwnerReachableBoundary
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open PlutusCore.UPLC.CekMachine
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicProofPairs
open Lovejoin.AnyTx.LogicOwnerConditions

/-- A true result at the compiled Owner prologue requires a nonempty box list,
one proof per box, and the transaction-bound Schnorr check for each aligned
encoded pair. This theorem is at an internal execution boundary: the explicit
environment, collector, constructor-shape and transaction-context hypotheses are
not yet derived from full-validator success. -/
theorem prologue_halt_requires_counts (slots : Fin 31 → CekValue) (rest outer : Environment)
    (boxes proofs : List Data) (lengthFn : CekValue)
    (hSplit : LogicInputRefs.refsEnv slots rest =
      .VCon (.Integer (.ofNat boxes.length)) :: .VCon (.ConstDataList proofs) :: outer)
    (hN : slots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hProofs : slots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : slots ⟨2, by decide⟩ = lengthFn)
    (hBoxes : slots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : slots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : slots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hHalt : ∃ n, stepN default (.Eval [] outer prologueBody) n = .Halt (.VCon (.Bool true))) :
    0 < boxes.length ∧ proofs.length = boxes.length := by
  have hPositive : 0 < boxes.length := by
    by_cases hZero : boxes.length = 0
    · have hZeroSlot : slots ⟨0, by decide⟩ = .VCon (.Integer 0) := by simpa [hZero] using hN
      have hError := no_boxes_errors slots rest hZeroSlot hIf
      have hOuterError := prologue_enter slots rest outer boxes proofs lengthFn none hSplit hLengthFn hBoxes
        hRedeemer hLengthBoxes hError
      have hImpossible := LogicOwnerEntry.ev_true_of_halt prologueBody outer none hOuterError hHalt
      cases hImpossible
    · exact Nat.pos_iff_ne_zero.mpr hZero
  have hNonempty : (1 : Integer) ≤ .ofNat boxes.length := Int.ofNat_le.mpr hPositive
  have hCount : proofs.length = boxes.length := by
    by_cases hEqual : proofs.length = boxes.length
    · exact hEqual
    · have hMismatch : (Int.ofNat proofs.length : Integer) ≠ .ofNat boxes.length := by
        intro he
        exact hEqual (Int.ofNat_inj.mp he)
      have hError := wrong_count_errors slots rest proofs (.ofNat boxes.length) lengthFn
        hN hProofs hLengthFn hIf hLengthProofs hNonempty hMismatch
      have hOuterError := prologue_enter slots rest outer boxes proofs lengthFn none hSplit hLengthFn hBoxes
        hRedeemer hLengthBoxes hError
      have hImpossible := LogicOwnerEntry.ev_true_of_halt prologueBody outer none hOuterError hHalt
      cases hImpossible
  exact ⟨hPositive, hCount⟩


/-- At the compiled prologue, a halted true result requires all transaction-bound proofs. -/
theorem prologue_halt_requires_transaction_proofs
    (preSlots : Fin 31 → CekValue) (preRest : Environment)
    (slots : Fin 41 → CekValue) (predRest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : Integer) (refFields : List Data) (mixHash ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data) (lengthFn : CekValue)
    (hInfo : preSlots ⟨20, by decide⟩ = .VCon (.Data (withInputs r (IsData.toData inputs) refs sigs)))
    (hRefDatum : preSlots ⟨5, by decide⟩ = .VCon (.Data (.Constr refTag refFields)))
    (hOutput : ∀ a b c : Data, ∀ others : List Data,
      Ap default (preSlots ⟨14, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hMix : Ap default (preSlots ⟨12, by decide⟩) (.VCon (.ConstDataList refFields))
      (some (.VCon (.Data (.B mixHash)))))
    (hCtxSpec : ownerHash mixHash r.outputs (inputs.map fun input => IsData.toData input.txInInfoOutRef) = some ctx)
    (hEnv : LogicOwnerVerifier.predicateEnv slots predRest =
      .VCon (.ByteString ctx) :: LogicInputRefs.refsEnv preSlots preRest)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots selectorRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hBoxes : slots ⟨5, by decide⟩ = .VCon (.ConstDataList boxes))
    (hProofs : slots ⟨2, by decide⟩ = .VCon (.ConstDataList proofs))
    (hWrapper : slots ⟨9, by decide⟩ = .VLam LogicOwnerFinish.wrapperLoop
      (LogicOwnerFinish.wrapperEnv c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest))
    (hShapes : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z])
    (hN : preSlots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hPreProofs : preSlots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : preSlots ⟨2, by decide⟩ = lengthFn)
    (hCollected : preSlots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : preSlots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : preSlots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hHalt : ∃ n, stepN default (.Eval [] ((LogicInputRefs.refsEnv preSlots preRest).drop 2)
      LogicOwnerConditions.prologueBody) n = .Halt (.VCon (.Bool true))) :
    0 < boxes.length ∧ proofs.length = boxes.length ∧
      ∀ a b t z : ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hSplit := LogicOwnerConditions.split_slots preSlots preRest boxes proofs hN hPreProofs
  have hPair := LogicOwnerPairingPartial.wrapper_checks_all_bytes slots predRest selectorRest challengeRest scalarRest
    selectorSlots scalarTop scalarMiddle ctx c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11
    c9 c8 c3 c2 c1 c0 rest boxes proofs hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead hShapes
  have hFinish := LogicOwnerFinish.finish_of_wrapper slots predRest c29 c28 c27 c26 c20 c19 c18 c17 c16 c15
    c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest boxes proofs _ hBoxes hProofs hWrapper hPair
  have hNext := LogicOwnerContextPairing.hash_then_run preSlots preRest slots predRest r inputs refs sigs
    refTag refFields mixHash ctx _ hInfo hRefDatum hOutput hMix hCtxSpec hEnv hFinish
  have hCounts := prologue_halt_requires_counts preSlots preRest _ boxes proofs lengthFn
    hSplit hN hPreProofs hLengthFn hCollected hRedeemer hIf hLengthBoxes hLengthProofs hHalt
  have hNonempty : (1 : Int) ≤ Int.ofNat boxes.length := Int.ofNat_le.mpr hCounts.1
  have hModel := LogicOwnerConditions.prologue_pass preSlots preRest _ boxes proofs lengthFn _
    hSplit hN hPreProofs hLengthFn hCollected hRedeemer hIf hLengthBoxes hLengthProofs hNonempty hCounts.2 hNext
  have hResult := LogicOwnerEntry.ev_true_of_halt LogicOwnerConditions.prologueBody
    ((LogicInputRefs.refsEnv preSlots preRest).drop 2) _ hModel hHalt
  have hTrue : Ev default LogicOwnerConditions.prologueBody ((LogicInputRefs.refsEnv preSlots preRest).drop 2)
      (some (.VCon (.Bool true))) := by
    rw [hResult] at hModel
    exact hModel
  have hChecks := LogicOwnerPairingPartial.true_requires_schnorr LogicOwnerConditions.prologueBody
    ((LogicInputRefs.refsEnv preSlots preRest).drop 2) ctx boxes proofs hModel hTrue
  exact ⟨hCounts.1, hCounts.2, hChecks.2⟩

/-- A true result at the compiled collection/dispatch junction implies all aligned transaction proofs. -/
theorem entry_halt_requires_transaction_proofs
    (env : Environment) (last : CekValue)
    (preSlots : Fin 31 → CekValue) (preRest : Environment)
    (slots : Fin 41 → CekValue) (predRest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : Integer) (refFields : List Data) (mixHash ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data) (lengthFn : CekValue)
    (hInfo : preSlots ⟨20, by decide⟩ = .VCon (.Data (withInputs r (IsData.toData inputs) refs sigs)))
    (hRefDatum : preSlots ⟨5, by decide⟩ = .VCon (.Data (.Constr refTag refFields)))
    (hOutput : ∀ a b c : Data, ∀ others : List Data,
      Ap default (preSlots ⟨14, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hMix : Ap default (preSlots ⟨12, by decide⟩) (.VCon (.ConstDataList refFields))
      (some (.VCon (.Data (.B mixHash)))))
    (hCtxSpec : ownerHash mixHash r.outputs (inputs.map fun input => IsData.toData input.txInInfoOutRef) = some ctx)
    (hEnv : LogicOwnerVerifier.predicateEnv slots predRest =
      .VCon (.ByteString ctx) :: LogicInputRefs.refsEnv preSlots preRest)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots selectorRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hBoxes : slots ⟨5, by decide⟩ = .VCon (.ConstDataList boxes))
    (hProofs : slots ⟨2, by decide⟩ = .VCon (.ConstDataList proofs))
    (hWrapper : slots ⟨9, by decide⟩ = .VLam LogicOwnerFinish.wrapperLoop
      (LogicOwnerFinish.wrapperEnv c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest))
    (hShapes : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z])
    (hN : preSlots ⟨0, by decide⟩ = .VCon (.Integer (.ofNat boxes.length)))
    (hPreProofs : preSlots ⟨1, by decide⟩ = .VCon (.ConstDataList proofs))
    (hLengthFn : preSlots ⟨2, by decide⟩ = lengthFn)
    (hCollected : preSlots ⟨4, by decide⟩ = .VCon (.ConstDataList boxes))
    (hRedeemer : preSlots ⟨19, by decide⟩ = .VCon (.Data (.Constr 0 [.List proofs])))
    (hIf : preSlots ⟨29, by decide⟩ = .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))
    (hLengthBoxes : Ap default lengthFn (.VCon (.ConstDataList boxes))
      (some (.VCon (.Integer (.ofNat boxes.length)))))
    (hLengthProofs : Ap default lengthFn (.VCon (.ConstDataList proofs))
      (some (.VCon (.Integer (.ofNat proofs.length)))))
    (hOuter : (LogicInputRefs.refsEnv preSlots preRest).drop 2 =
      last :: .VLam LogicOwnerEntry.middleBody env :: .VCon (.ConstDataList boxes) :: env)
    (hCollect : Ev default LogicOwnerEntry.collectorCall env (some (.VCon (.ConstDataList boxes))))
    (hLast : Ev default LogicOwnerEntry.lastArg env (some last))
    (hCondition : Ev default LogicOwnerEntry.ownerCondition
      (last :: .VLam LogicOwnerEntry.middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (some (.VCon (.Bool true))))
    (hEntryIf : Ev default (.Var 27)
      (last :: .VLam LogicOwnerEntry.middleBody env :: .VCon (.ConstDataList boxes) :: env)
      (some (.VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))))))
    (hHalt : ∃ n, stepN default (.Eval [] env LogicOwnerEntry.entryBody) n = .Halt (.VCon (.Bool true))) :
    0 < boxes.length ∧ proofs.length = boxes.length ∧
      ∀ a b t z : ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hReach := LogicOwnerEntry.entry_reaches_owner env boxes last hCollect hLast hCondition hEntryIf
  have hOwnerHalt := LogicOwnerEntry.halt_after_reached_eval (.Eval [] env LogicOwnerEntry.entryBody)
    (last :: .VLam LogicOwnerEntry.middleBody env :: .VCon (.ConstDataList boxes) :: env)
    LogicOwnerConditions.prologueBody (.VCon (.Bool true)) hReach hHalt
  rw [← hOuter] at hOwnerHalt
  exact prologue_halt_requires_transaction_proofs preSlots preRest slots predRest selectorRest challengeRest scalarRest
    selectorSlots scalarTop scalarMiddle r inputs refs sigs refTag refFields mixHash ctx
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest boxes proofs lengthFn
    hInfo hRefDatum hOutput hMix hCtxSpec hEnv hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
    hBoxes hProofs hWrapper hShapes hN hPreProofs hLengthFn hCollected hRedeemer hIf hLengthBoxes hLengthProofs hOwnerHalt

end Lovejoin.AnyTx.LogicOwnerReachableBoundary

/--
info: 'Lovejoin.AnyTx.LogicOwnerReachableBoundary.prologue_halt_requires_transaction_proofs' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerReachableBoundary.prologue_halt_requires_transaction_proofs

#print axioms Lovejoin.AnyTx.LogicOwnerReachableBoundary.entry_halt_requires_transaction_proofs
