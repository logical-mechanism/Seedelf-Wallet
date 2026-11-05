import Lovejoin.AnyTx.LogicOwnerFinish
import Lovejoin.AnyTx.LogicInputRefs
import Lovejoin.AnyTx.LogicInputHelpers

/-! The transaction context hash computed by the compiled Owner branch. -/
namespace Lovejoin.AnyTx.LogicOwnerHash
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def hashAt : List Nat := LogicOwnerFinish.finishAt.dropLast ++ [1]
def hashBody : Term := subterm templateBody hashAt

set_option maxHeartbeats 0

/-- The Owner branch hashes its complete outputs and every input reference,
followed by the mix script hash. Serialization premises are explicit here. -/
theorem hash_context (slots : Fin 31 → CekValue) (rest : Environment)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : PlutusCore.Integer.Integer) (refFields : List Data) (mixHash outputBytes refBytes : ByteString)
    (hInfo : slots ⟨20, by decide⟩ = .VCon (.Data
      (withInputs r (IsData.toData inputs) refs sigs)))
    (hRefDatum : slots ⟨5, by decide⟩ = .VCon (.Data (.Constr refTag refFields)))
    (hOutput : ∀ a b c : Data, ∀ others : List Data,
      Ap default (slots ⟨14, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hMix : Ap default (slots ⟨12, by decide⟩) (.VCon (.ConstDataList refFields))
      (some (.VCon (.Data (.B mixHash)))))
    (hSerializeOutputs : Ap default (.VBuiltin .SerializeData [] (.One .ArgV))
      (.VCon (.Data r.outputs)) (some (.VCon (.ByteString outputBytes))))
    (hSerializeRefs : Ap default (.VBuiltin .SerializeData [] (.One .ArgV))
      (.VCon (.Data (.List (inputs.map fun input => IsData.toData input.txInInfoOutRef))))
      (some (.VCon (.ByteString refBytes)))) :
    Ev default hashBody (LogicInputRefs.refsEnv slots rest)
      (some (.VCon (.ByteString (blake2b_256 (appendByteString (appendByteString outputBytes refBytes) mixHash))))) := by
  have hRefs := LogicInputRefs.ledger_refs slots rest inputs
  have he := Lovejoin.AnyTx.BoxCover.inputs_encoding inputs
  repeat' first
    | rw [hInfo]
    | rw [hRefDatum]
    | rw [he]
    | apply hOutput
    | apply hMix
    | apply hSerializeOutputs
    | apply hSerializeRefs
    | apply hRefs
    | cek_v3_step

/-- Successful specification-level serialization is the same CEK builtin result. -/
theorem serialize_data (data : Data) (bytes : ByteString)
    (h : Lovejoin.Classic.serialised data = some bytes) :
    Ap default (.VBuiltin .SerializeData [] (.One .ArgV))
      (.VCon (.Data data)) (some (.VCon (.ByteString bytes))) := by
  apply ap_builtin
  cases he : PlutusCore.UPLC.BuiltinFunctions.Data.encodeDataOpaque data with
  | none => simp [Lovejoin.Classic.serialised, he] at h
  | some encoded =>
    have hb : (⟨encoded⟩ : ByteString) = bytes := by
      simpa [Lovejoin.Classic.serialised, he] using h
    subst bytes
    simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
      PlutusCore.UPLC.BuiltinFunctions.Data.serializeData, he]

/-- The compiled context hash agrees with the existing transaction-level Owner
hash specification whenever serialization succeeds. -/
theorem hash_matches_owner_spec (slots : Fin 31 → CekValue) (rest : Environment)
    (r : TxRest) (inputs : List TxInInfo) (refs sigs : Data)
    (refTag : PlutusCore.Integer.Integer) (refFields : List Data) (mixHash ctx : ByteString)
    (hInfo : slots ⟨20, by decide⟩ = .VCon (.Data
      (withInputs r (IsData.toData inputs) refs sigs)))
    (hRefDatum : slots ⟨5, by decide⟩ = .VCon (.Data (.Constr refTag refFields)))
    (hOutput : ∀ a b c : Data, ∀ others : List Data,
      Ap default (slots ⟨14, by decide⟩) (.VCon (.ConstDataList (a :: b :: c :: others))) (some (.VCon (.Data c))))
    (hMix : Ap default (slots ⟨12, by decide⟩) (.VCon (.ConstDataList refFields))
      (some (.VCon (.Data (.B mixHash)))))
    (hCtx : ownerHash mixHash r.outputs (inputs.map fun input => IsData.toData input.txInInfoOutRef) = some ctx) :
    Ev default hashBody (LogicInputRefs.refsEnv slots rest) (some (.VCon (.ByteString ctx))) := by
  cases ho : Lovejoin.Classic.serialised r.outputs with
  | none => simp [ownerHash, ho] at hCtx
  | some outputBytes =>
    cases hr : Lovejoin.Classic.serialised (.List (inputs.map fun input => IsData.toData input.txInInfoOutRef)) with
    | none => simp [ownerHash, ho, hr] at hCtx
    | some refBytes =>
      have he : blake2b_256 (appendByteString (appendByteString outputBytes refBytes) mixHash) = ctx := by
        simpa [ownerHash, ho, hr] using hCtx
      rw [← he]
      exact hash_context slots rest r inputs refs sigs refTag refFields mixHash outputBytes refBytes
        hInfo hRefDatum hOutput hMix (serialize_data r.outputs outputBytes ho)
        (serialize_data (.List (inputs.map fun input => IsData.toData input.txInInfoOutRef)) refBytes hr)

end Lovejoin.AnyTx.LogicOwnerHash

#print axioms Lovejoin.AnyTx.LogicOwnerHash.hash_context
#print axioms Lovejoin.AnyTx.LogicOwnerHash.hash_matches_owner_spec
