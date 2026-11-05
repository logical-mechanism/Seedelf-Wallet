import Lovejoin.AnyTx.LogicOwnerHash

/-! Compose the Owner transaction-context hash and pairwise verification. -/
namespace Lovejoin.AnyTx.LogicOwnerContextPairing
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)
open Lovejoin.AnyTx.LogicOwnerPairing
open Lovejoin.AnyTx.LogicProofPairs

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def beforeFinishBody : Term := subterm templateBody LogicOwnerFinish.finishAt.dropLast

set_option maxHeartbeats 0

/-- Feed the checked transaction hash into an arbitrary final Owner computation. -/
theorem hash_then_run (preSlots : Fin 31 → CekValue) (preRest : Environment)
    (slots : Fin 41 → CekValue) (predRest : Environment)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : PlutusCore.Integer.Integer) (refFields : List Data) (mixHash ctx : ByteString)
    (result : Option CekValue)
    (hInfo : preSlots ⟨20, by decide⟩ = .VCon (.Data (withInputs r (IsData.toData inputs) refs sigs)))
    (hRefDatum : preSlots ⟨5, by decide⟩ = .VCon (.Data (.Constr refTag refFields)))
    (hOutput : ∀ a b c : Data, ∀ others : List Data,
      Ap default (preSlots ⟨14, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hMix : Ap default (preSlots ⟨12, by decide⟩) (.VCon (.ConstDataList refFields))
      (some (.VCon (.Data (.B mixHash)))))
    (hCtxSpec : ownerHash mixHash r.outputs (inputs.map fun input => IsData.toData input.txInInfoOutRef) = some ctx)
    (hEnv : LogicOwnerVerifier.predicateEnv slots predRest =
      .VCon (.ByteString ctx) :: LogicInputRefs.refsEnv preSlots preRest)
    (hFinish : Ev default LogicOwnerFinish.finishBody (LogicOwnerVerifier.predicateEnv slots predRest) result) :
    Ev default beforeFinishBody (LogicInputRefs.refsEnv preSlots preRest) result := by
  have hHash := LogicOwnerHash.hash_matches_owner_spec preSlots preRest r inputs refs sigs
    refTag refFields mixHash ctx hInfo hRefDatum hOutput hMix hCtxSpec
  rw [hEnv] at hFinish
  cek_v3_using [hHash, hFinish]

/-- At the actual compiled Owner hash-and-pair boundary, successful hashing
feeds the transaction-bound context into the compiled Schnorr checker. The
explicit environment and supported-pair premises remain to be derived from the
whole validator and arbitrary ledger-valid inputs. -/
theorem hash_then_check (preSlots : Fin 31 → CekValue) (preRest : Environment)
    (slots : Fin 41 → CekValue) (predRest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : PlutusCore.Integer.Integer) (refFields : List Data) (mixHash ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data)
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
    (hPairs : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs → supportedConcretePair datum proof) :
    Ev default beforeFinishBody (LogicInputRefs.refsEnv preSlots preRest)
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)) := by
  have hHash := LogicOwnerHash.hash_matches_owner_spec preSlots preRest r inputs refs sigs
    refTag refFields mixHash ctx hInfo hRefDatum hOutput hMix hCtxSpec
  have hFinish := LogicOwnerFinish.finish_checks_schnorr slots predRest selectorRest challengeRest scalarRest
    selectorSlots scalarTop scalarMiddle ctx c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11
    c9 c8 c3 c2 c1 c0 rest boxes proofs hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
    hBoxes hProofs hWrapper hPairs
  rw [hEnv] at hFinish
  cek_v3_using [hHash, hFinish]

/-- If a computation characterized by the Owner pairing model returns true,
the lists have equal length and every encoded aligned Schnorr proof verifies. -/
theorem true_requires_schnorr_pairs (body : Term) (env : Environment) (ctx : ByteString)
    (boxes proofs : List Data)
    (hModel : Ev default body env
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)))
    (hTrue : Ev default body env (some (.VCon (.Bool true)))) :
    boxes.length = proofs.length ∧
      ∀ a b t z : ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hResult := ev_true_of_model body env _ hModel hTrue
  have hAll := (allPairsPartial_true_iff (ownerCheck ctx) boxes proofs).mp hResult
  refine ⟨hAll.1, ?_⟩
  intro a b t z hp
  have hv := hAll.2 _ hp
  simpa [ownerCheck] using hv

end Lovejoin.AnyTx.LogicOwnerContextPairing

#print axioms Lovejoin.AnyTx.LogicOwnerContextPairing.hash_then_check
#print axioms Lovejoin.AnyTx.LogicOwnerContextPairing.true_requires_schnorr_pairs
