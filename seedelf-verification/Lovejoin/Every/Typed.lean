import Lovejoin.Every.Withdraw
import Lovejoin.AnyTx.LogicPublishKernel

/-! # mix_logic in every transaction

What mix_logic, applied to a pool's NFT policy `P` and name, accepts, for every V3 script
context: a withdrawal exactly when `withdrawResult` holds (the Owner or the Mix, `Withdraw.lean`),
a certificate exactly when it is a registration (`LogicPublishKernel`), and nothing else
(`PurposesKernel`). Kernel-checked, with no list length and no step limit. -/

namespace Lovejoin.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (purposeCtx isRegistrationData)

/-- A withdrawal is accepted exactly when its redeemer passes, for any TxInfo, redeemer and
credential `Data`. -/
theorem withdraw_iff (P : ByteString) (info red cred : Data) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 2 info red [cred])] n = .Halt (.VCon .Unit)) ↔
      withdrawResult P info red = some true := by
  have h := withdraw_root P info red cred
  cases hr : withdrawResult P info red with
  | some b =>
    cases b with
    | true =>
      rw [hr] at h
      exact ⟨fun _ => rfl, fun _ => exec_halt_of_ev h⟩
    | false =>
      rw [hr] at h
      have he : ∃ m, cekExecuteProgram mixLogicTemplate.script
          [toTerm P, toTerm nftName, toTerm (purposeCtx 2 info red [cred])] m = .Error := exec_error_of_ev h
      obtain ⟨m, hm⟩ := he
      exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩
  | none =>
    rw [hr] at h
    have he : ∃ m, cekExecuteProgram mixLogicTemplate.script
        [toTerm P, toTerm nftName, toTerm (purposeCtx 2 info red [cred])] m = .Error := exec_error_of_ev h
    obtain ⟨m, hm⟩ := he
    exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩

/-- mix_logic's acceptance condition for a typed V3 context. -/
def logicPasses (P : ByteString) (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .RewardingScript _ =>
    withdrawResult P (IsData.toData ctx.scriptContextTxInfo) ctx.scriptContextRedeemer = some true
  | .CertifyingScript _ cert => isRegistrationData (IsData.toData cert) = true
  | _ => False

/-- An error for some fuel is no `()` for any. -/
theorem never_unit {args : List PlutusCore.UPLC.Term.Term} {m : Nat}
    (hm : cekExecuteProgram mixLogicTemplate.script args m = .Error) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script args n = .Halt (.VCon .Unit)) ↔ False :=
  ⟨fun ⟨n, hn⟩ => exec_never_halts hm n _ hn, False.elim⟩

/-- **mix_logic, every typed V3 context:** the program returns `()` exactly when
`logicPasses` holds. -/
theorem every_context_iff (P : ByteString) (ctx : ScriptContext) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔ logicPasses P ctx := by
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | RewardingScript cred => exact withdraw_iff P (IsData.toData tx) red (IsData.toData cred)
  | CertifyingScript idx cert =>
    exact Lovejoin.AnyTx.LogicPublishKernel.publish_iff_registration P (IsData.toData tx) red idx (IsData.toData cert)
  | MintingScript cs =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.logic_minting_errors P (IsData.toData tx) red [IsData.toData cs]
    exact never_unit hm
  | SpendingScript ref d =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.logic_spending_errors P (IsData.toData tx) red
      [IsData.toData ref, IsData.toData d]
    exact never_unit hm
  | VotingScript v =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.logic_voting_errors P (IsData.toData tx) red [IsData.toData v]
    exact never_unit hm
  | ProposingScript idx p =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.logic_proposing_errors P (IsData.toData tx) red
      [IsData.toData idx, IsData.toData p]
    exact never_unit hm

end Lovejoin.Every

/-- info: 'Lovejoin.Every.every_context_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.every_context_iff
