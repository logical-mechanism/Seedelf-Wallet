import Lovejoin.AnyTx.LogicOwnerConditions

/-! Composed compiled Owner prologue, context hash and Schnorr checks. -/
namespace Lovejoin.AnyTx.LogicOwnerBoundary
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicOwnerPairing

/-- A true result at the compiled Owner prologue requires a nonempty box list,
one proof per box, and the transaction-bound Schnorr check for each aligned
encoded pair. This theorem is at an internal execution boundary: the explicit
environment, collector, supported-point and transaction-context hypotheses are
not yet derived from full-validator success. -/
theorem prologue_true_requires_transaction_proofs
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
    (hPairs : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs → supportedConcretePair datum proof)
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
    (hTrue : Ev default LogicOwnerConditions.prologueBody ((LogicInputRefs.refsEnv preSlots preRest).drop 2)
      (some (.VCon (.Bool true)))) :
    0 < boxes.length ∧ proofs.length = boxes.length ∧
      ∀ a b t z : ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hSplit := LogicOwnerConditions.split_slots preSlots preRest boxes proofs hN hPreProofs
  have hNext := LogicOwnerContextPairing.hash_then_check preSlots preRest slots predRest selectorRest challengeRest scalarRest
    selectorSlots scalarTop scalarMiddle r inputs refs sigs refTag refFields mixHash ctx
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest boxes proofs
    hInfo hRefDatum hOutput hMix hCtxSpec hEnv hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
    hBoxes hProofs hWrapper hPairs
  have hCounts := LogicOwnerConditions.prologue_true_requires_counts preSlots preRest _ boxes proofs lengthFn
    hSplit hN hPreProofs hLengthFn hCollected hRedeemer hIf hLengthBoxes hLengthProofs hTrue
  have hChecks := LogicOwnerConditions.prologue_true_requires_schnorr preSlots preRest _ boxes proofs lengthFn ctx
    hSplit hN hPreProofs hLengthFn hCollected hRedeemer hIf hLengthBoxes hLengthProofs hNext hTrue
  exact ⟨hCounts.1, hCounts.2, hChecks.2⟩

end Lovejoin.AnyTx.LogicOwnerBoundary

#print axioms Lovejoin.AnyTx.LogicOwnerBoundary.prologue_true_requires_transaction_proofs
