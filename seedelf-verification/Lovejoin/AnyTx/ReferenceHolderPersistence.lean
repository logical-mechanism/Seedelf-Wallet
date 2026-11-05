import Lovejoin.AnyTx.PurposesKernel

/-! A transaction-level consequence of the compiled reference holder's rejection.
The ledger's script-routing and UTxO resolution obligations are explicit premises;
this module does not model a chain or establish NFT supply. -/
namespace Lovejoin.AnyTx.ReferenceHolderPersistence
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll (exec_never_halts)

/-- When the ledger routes every holder input to the proved reference-holder
script and requires it to succeed, no input at that credential can be spent. -/
theorem routed_holder_inputs_absent (tx : TxInfo) (holderHash : ByteString)
    (hRouting : ∀ input ∈ tx.txInfoInputs,
      input.txInInfoResolved.txOutAddress.addressCredential = .ScriptCredential holderHash →
      ∃ red : Data, ∃ datum : Option Data, ∃ n,
        cekExecuteProgram referenceHolder.script
          [toTerm (IsData.toData (⟨tx, red, .SpendingScript input.txInInfoOutRef datum⟩ : ScriptContext))]
          n = .Halt (.VCon .Unit)) :
    ∀ input ∈ tx.txInfoInputs,
      input.txInInfoResolved.txOutAddress.addressCredential ≠ .ScriptCredential holderHash := by
  intro input hi hh
  obtain ⟨red, datum, n, hs⟩ := hRouting input hi hh
  obtain ⟨m, he⟩ := PurposesKernel.reference_holder_every_context_errors
    (⟨tx, red, .SpendingScript input.txInInfoOutRef datum⟩ : ScriptContext)
  exact (exec_never_halts he n (.VCon .Unit)) hs

/-- If the ledger resolves a particular reference to the holder output, an
accepted, correctly routed transaction cannot consume that reference. -/
theorem routed_holder_reference_not_consumed (tx : TxInfo) (holderHash : ByteString) (ref : TxOutRef)
    (hResolution : ∀ input ∈ tx.txInfoInputs, input.txInInfoOutRef = ref →
      input.txInInfoResolved.txOutAddress.addressCredential = .ScriptCredential holderHash)
    (hRouting : ∀ input ∈ tx.txInfoInputs,
      input.txInInfoResolved.txOutAddress.addressCredential = .ScriptCredential holderHash →
      ∃ red : Data, ∃ datum : Option Data, ∃ n,
        cekExecuteProgram referenceHolder.script
          [toTerm (IsData.toData (⟨tx, red, .SpendingScript input.txInInfoOutRef datum⟩ : ScriptContext))]
          n = .Halt (.VCon .Unit)) :
    ∀ input ∈ tx.txInfoInputs, input.txInInfoOutRef ≠ ref := by
  intro input hi href
  exact routed_holder_inputs_absent tx holderHash hRouting input hi (hResolution input hi href)

end Lovejoin.AnyTx.ReferenceHolderPersistence

/--
info: 'Lovejoin.AnyTx.ReferenceHolderPersistence.routed_holder_inputs_absent' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.ReferenceHolderPersistence.routed_holder_inputs_absent
/--
info: 'Lovejoin.AnyTx.ReferenceHolderPersistence.routed_holder_reference_not_consumed' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.ReferenceHolderPersistence.routed_holder_reference_not_consumed
