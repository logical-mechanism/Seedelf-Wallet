import Lovejoin.AnyTx.LogicLedgerCarrier
import Lovejoin.AnyTx.LogicValueOf
import Lovejoin.AnyTx.BoxSemantics

/-! Composition of the compiled mix_box and mix_logic rules on one V3 TxInfo.
The ledger routing premise is explicit: when the withdrawal exists, it runs the
corresponding mix_logic script with the stated redeemer. -/
namespace Lovejoin.AnyTx.LogicBoxComposition
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.BoxCover
open Lovejoin.AnyTx.BoxSemantics
open Lovejoin.Template (nftName)

/-- A successfully spent, well-formed inline box forces the matching mix_logic
withdrawal, for any number of earlier or later inputs and withdrawals. -/
theorem wellformed_box_requires_withdrawal (L : ByteString) (tx : TxInfo) (red : Data)
    (ref : TxOutRef) (resolved : Option Data) (before after : List (Data × Data))
    (addr value script datum : Data)
    (hInputs : inputPairs tx.txInfoInputs = before ++
      (IsData.toData ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)
    (hBefore : ∀ pair ∈ before, pair.1 ≠ IsData.toData ref)
    (hDatum : isBoxDatum datum = true)
    (hBox : ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ amount : Integer, ((.ScriptCredential L : Credential), amount) ∈ (show List (Credential × Integer) from tx.txInfoWdrl) := by
  rw [spend_encoding, hInputs] at hBox
  have hPass := (found_iff L (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoSignatories) red
    (IsData.toData ref) (IsData.toData resolved) addr value script before after
    (withdrawalPairs tx.txInfoWdrl) hBefore (.OutputDatum datum)).mp hBox
  have hLedger := (datumPasses_ledger L tx.txInfoWdrl (.OutputDatum datum)).mp hPass
  simp [datumPassesLedger, hDatum] at hLedger
  exact hLedger

/-- Under ledger routing of the owner withdrawal to this mix_logic template,
a successful spend of a well-formed box requires the pool NFT reference. -/
theorem owner_routed_box_spend_requires_nft (P L : ByteString) (tx : TxInfo) (red : Data)
    (ref : TxOutRef) (resolved : Option Data) (before after : List (Data × Data))
    (addr value script datum : Data) (proofs : List Data)
    (hInputs : inputPairs tx.txInfoInputs = before ++
      (IsData.toData ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)
    (hBefore : ∀ pair ∈ before, pair.1 ≠ IsData.toData ref)
    (hDatum : isBoxDatum datum = true)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) = true)
    (hBox : ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit))
    (hRouting : ∀ amount : Integer,
      ((.ScriptCredential L : Credential), amount) ∈ (show List (Credential × Integer) from tx.txInfoWdrl) →
      ∃ n, cekExecuteProgram mixLogicTemplate.script
        [toTerm P, toTerm nftName, toTerm (IsData.toData
          (⟨tx, .Constr 0 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names := by
  obtain ⟨amount, hw⟩ := wellformed_box_requires_withdrawal L tx red ref resolved before after
    addr value script datum hInputs hBefore hDatum hBox
  have hrefs : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext) = true :=
    LogicLedgerCarrier.valid_reference_inputs_of_valid_context
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) hValid
  exact LogicLedgerCarrier.owner_success_requires_nft_reference P tx (.ScriptCredential L) proofs hrefs (hRouting amount hw)

/-- Under ledger routing of the mix withdrawal to this mix_logic template,
a successful spend of a well-formed box requires the pool NFT reference. -/
theorem mix_routed_box_spend_requires_nft (P L : ByteString) (tx : TxInfo) (red : Data)
    (ref : TxOutRef) (resolved : Option Data) (before after : List (Data × Data))
    (addr value script datum : Data) (proofs : List Data)
    (hInputs : inputPairs tx.txInfoInputs = before ++
      (IsData.toData ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)
    (hBefore : ∀ pair ∈ before, pair.1 ≠ IsData.toData ref)
    (hDatum : isBoxDatum datum = true)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) = true)
    (hBox : ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit))
    (hRouting : ∀ amount : Integer,
      ((.ScriptCredential L : Credential), amount) ∈ (show List (Credential × Integer) from tx.txInfoWdrl) →
      ∃ n, cekExecuteProgram mixLogicTemplate.script
        [toTerm P, toTerm nftName, toTerm (IsData.toData
          (⟨tx, .Constr 1 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs, ∃ names : List (Data × Data),
      ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from input.txInInfoResolved.txOutValue) ∧
      ((.B nftName, .I 1) : Data × Data) ∈ names := by
  obtain ⟨amount, hw⟩ := wellformed_box_requires_withdrawal L tx red ref resolved before after
    addr value script datum hInputs hBefore hDatum hBox
  have hrefs : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext) = true :=
    LogicLedgerCarrier.valid_reference_inputs_of_valid_context
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) hValid
  exact LogicLedgerCarrier.mix_success_requires_nft_reference P tx (.ScriptCredential L) proofs hrefs (hRouting amount hw)

/-- Under ledger routing of the owner withdrawal to this mix_logic template,
a successful spend of a well-formed box requires the pool NFT reference. -/
theorem owner_routed_box_spend_requires_value_one (P L : ByteString) (tx : TxInfo) (red : Data)
    (ref : TxOutRef) (resolved : Option Data) (before after : List (Data × Data))
    (addr value script datum : Data) (proofs : List Data)
    (hInputs : inputPairs tx.txInfoInputs = before ++
      (IsData.toData ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)
    (hBefore : ∀ pair ∈ before, pair.1 ≠ IsData.toData ref)
    (hDatum : isBoxDatum datum = true)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) = true)
    (hBox : ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit))
    (hRouting : ∀ amount : Integer,
      ((.ScriptCredential L : Credential), amount) ∈ (show List (Credential × Integer) from tx.txInfoWdrl) →
      ∃ n, cekExecuteProgram mixLogicTemplate.script
        [toTerm P, toTerm nftName, toTerm (IsData.toData
          (⟨tx, .Constr 0 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Value.valueOf P nftName input.txInInfoResolved.txOutValue = 1 := by
  obtain ⟨amount, hw⟩ := wellformed_box_requires_withdrawal L tx red ref resolved before after
    addr value script datum hInputs hBefore hDatum hBox
  have hrefs : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 0 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext) = true :=
    LogicLedgerCarrier.valid_reference_inputs_of_valid_context
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) hValid
  exact LogicValueOf.owner_success_requires_value_one P tx (.ScriptCredential L) proofs hrefs (hRouting amount hw)

/-- Under ledger routing of the mix withdrawal to this mix_logic template,
a successful spend of a well-formed box requires the pool NFT reference. -/
theorem mix_routed_box_spend_requires_value_one (P L : ByteString) (tx : TxInfo) (red : Data)
    (ref : TxOutRef) (resolved : Option Data) (before after : List (Data × Data))
    (addr value script datum : Data) (proofs : List Data)
    (hInputs : inputPairs tx.txInfoInputs = before ++
      (IsData.toData ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)
    (hBefore : ∀ pair ∈ before, pair.1 ≠ IsData.toData ref)
    (hDatum : isBoxDatum datum = true)
    (hValid : CardanoLedgerApi.V3.Contexts.validScriptContext
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) = true)
    (hBox : ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit))
    (hRouting : ∀ amount : Integer,
      ((.ScriptCredential L : Credential), amount) ∈ (show List (Credential × Integer) from tx.txInfoWdrl) →
      ∃ n, cekExecuteProgram mixLogicTemplate.script
        [toTerm P, toTerm nftName, toTerm (IsData.toData
          (⟨tx, .Constr 1 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ input ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Value.valueOf P nftName input.txInInfoResolved.txOutValue = 1 := by
  obtain ⟨amount, hw⟩ := wellformed_box_requires_withdrawal L tx red ref resolved before after
    addr value script datum hInputs hBefore hDatum hBox
  have hrefs : CardanoLedgerApi.V3.Contexts.validReferenceInputs
      (⟨tx, .Constr 1 [.List proofs], .RewardingScript (.ScriptCredential L)⟩ : ScriptContext) = true :=
    LogicLedgerCarrier.valid_reference_inputs_of_valid_context
      (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) hValid
  exact LogicValueOf.mix_success_requires_value_one P tx (.ScriptCredential L) proofs hrefs (hRouting amount hw)

end Lovejoin.AnyTx.LogicBoxComposition

#print axioms Lovejoin.AnyTx.LogicBoxComposition.wellformed_box_requires_withdrawal

/--
info: 'Lovejoin.AnyTx.LogicBoxComposition.owner_routed_box_spend_requires_nft' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBoxComposition.owner_routed_box_spend_requires_nft
/--
info: 'Lovejoin.AnyTx.LogicBoxComposition.mix_routed_box_spend_requires_nft' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBoxComposition.mix_routed_box_spend_requires_nft

/--
info: 'Lovejoin.AnyTx.LogicBoxComposition.owner_routed_box_spend_requires_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBoxComposition.owner_routed_box_spend_requires_value_one
/--
info: 'Lovejoin.AnyTx.LogicBoxComposition.mix_routed_box_spend_requires_value_one' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicBoxComposition.mix_routed_box_spend_requires_value_one
