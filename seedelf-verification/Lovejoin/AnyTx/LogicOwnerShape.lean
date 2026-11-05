import Lovejoin.AnyTx.LogicOwnerNoCarrier

/-! A whole-validator consequence of the Owner proof parser, independent of
reference-input layouts or ledger-validity assumptions. -/
namespace Lovejoin.AnyTx.LogicOwnerShape
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll (exec_never_halts)
open Lovejoin.AnyTx
open Lovejoin.Template (nftName)

/-- If the compiled Owner validator succeeds, every raw proof in the redeemer
has exactly the two-bytestring proof encoding. This establishes structure only;
the cryptographic verification and input-to-proof pairing remain separate. -/
theorem acceptance_requires_well_formed_proof_list (P : ByteString) (tx : TxInfo)
    (acct : Credential) (proofs : List Data)
    (hSuccess : ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData
        (⟨tx, .Constr 0 [.List proofs], .RewardingScript acct⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) :
    ∃ parsed : List (ByteString × ByteString), proofs = LogicOwnerParse.proofList parsed := by
  rcases LogicOwnerNoCarrier.proof_list_cover proofs with ⟨parsed, hp⟩ | ⟨before, bad, after, hp, hb⟩
  · exact ⟨parsed, hp⟩
  · have herr := LogicOwnerMalformed.invalid_proof_errors P (TxRest.ofTxInfo tx)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
      (IsData.toData tx.txInfoSignatories) (IsData.toData acct) bad before after hb
    obtain ⟨m, hm⟩ := herr
    obtain ⟨n, hs⟩ := hSuccess
    change cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [withInputs (TxRest.ofTxInfo tx)
        (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoReferenceInputs)
        (IsData.toData tx.txInfoSignatories), .Constr 0 [.List proofs], .Constr 2 [IsData.toData acct]])]
      n = .Halt (.VCon .Unit) at hs
    rw [hp] at hs
    exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hs)

end Lovejoin.AnyTx.LogicOwnerShape

/--
info: 'Lovejoin.AnyTx.LogicOwnerShape.acceptance_requires_well_formed_proof_list' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicOwnerShape.acceptance_requires_well_formed_proof_list
