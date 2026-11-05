import Lovejoin.AnyTx.LogicOwnerPairing

/-! The compiled Owner branch's final call to its pairwise Schnorr checker. -/
namespace Lovejoin.AnyTx.LogicOwnerFinish
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)
open Lovejoin.AnyTx.LogicProofPairs
open Lovejoin.AnyTx.LogicOwnerPairing

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def finishAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0]
def finishBody : Term := subterm templateBody (finishAt ++ [0])
def wrapperLoop : Term := subterm templateBody (LogicProofPairs.wrapperAt ++ [0])

def wrapperEnv (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) : Environment :=
  c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
  c3 :: c2 :: c1 :: c0 :: rest

/-- The final Owner call propagates the result of its pair-wrapper invocation. -/
theorem finish_of_wrapper (slots : Fin 41 → CekValue) (predRest : Environment)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data) (result : Option CekValue)
    (hBoxes : slots ⟨5, by decide⟩ = .VCon (.ConstDataList boxes))
    (hProofs : slots ⟨2, by decide⟩ = .VCon (.ConstDataList proofs))
    (hWrapper : slots ⟨9, by decide⟩ = .VLam wrapperLoop
      (wrapperEnv c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest))
    (hPair : Ev default wrapperBody
      (LogicOwnerVerifier.predicateValue slots predRest :: .VCon (.ConstDataList proofs) :: .VCon (.ConstDataList boxes) ::
        wrapperEnv c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest) result) :
    Ev default finishBody (LogicOwnerVerifier.predicateEnv slots predRest) result := by
  repeat' first
    | rw [hBoxes]
    | rw [hProofs]
    | rw [hWrapper]
    | apply hPair
    | cek_v3_step
  cases result with
  | none => exact values_none
  | some value => exact values_nil

/-- At the final Owner call boundary, the compiled branch invokes the actual
Schnorr predicate for each aligned pair. Upstream input collection, context
hashing and the full validator are separate obligations. -/
theorem finish_checks_schnorr (slots : Fin 41 → CekValue)
    (predRest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots selectorRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hBoxes : slots ⟨5, by decide⟩ = .VCon (.ConstDataList boxes))
    (hProofs : slots ⟨2, by decide⟩ = .VCon (.ConstDataList proofs))
    (hWrapper : slots ⟨9, by decide⟩ = .VLam wrapperLoop
      (wrapperEnv c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest))
    (hPairs : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs → supportedConcretePair datum proof) :
    Ev default finishBody (LogicOwnerVerifier.predicateEnv slots predRest)
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)) := by
  have hPair := wrapper_checks_compiled_schnorr slots predRest selectorRest challengeRest scalarRest
    selectorSlots scalarTop scalarMiddle ctx c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11
    c9 c8 c3 c2 c1 c0 rest boxes proofs hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead hPairs
  repeat' first
    | rw [hBoxes]
    | rw [hProofs]
    | rw [hWrapper]
    | apply hPair
    | cek_v3_step
  cases allPairsPartial (ownerCheck ctx) boxes proofs with
  | none => exact values_none
  | some flag => exact values_nil

end Lovejoin.AnyTx.LogicOwnerFinish

#print axioms Lovejoin.AnyTx.LogicOwnerFinish.finish_checks_schnorr
