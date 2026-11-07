import Lovejoin.Every.MintRoot
import Lovejoin.Every.Typed

/-! # one_shot_mint in every transaction

What one_shot_mint, applied to a launch's seed (transaction id and index) and the reference
holder's hash, accepts, for every V3 script context: a mint exactly when `launchResult` holds
(`MintRoot.lean`), and nothing else (`PurposesKernel`). Kernel-checked, with no list length and no
step limit. -/

namespace Lovejoin.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.Template.AnyTx (purposeCtx)

/-- A mint is accepted exactly when the launch passes, for any TxInfo and redeemer `Data`. -/
theorem launch_iff (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (info red : Data)
    (P : ByteString) :
    (∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (purposeCtx 0 info red [.B P])] n = .Halt (.VCon .Unit)) ↔
      launchResult seedTx seedIx rh info P = some true := by
  have h := launch_root seedTx seedIx rh info red P
  cases hr : launchResult seedTx seedIx rh info P with
  | some b =>
    cases b with
    | true =>
      rw [hr] at h
      exact ⟨fun _ => rfl, fun _ => exec_halt_of_ev h⟩
    | false =>
      rw [hr] at h
      have he : ∃ m, cekExecuteProgram oneShotMintTemplate.script
          [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (purposeCtx 0 info red [.B P])] m = .Error :=
        exec_error_of_ev h
      obtain ⟨m, hm⟩ := he
      exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩
  | none =>
    rw [hr] at h
    have he : ∃ m, cekExecuteProgram oneShotMintTemplate.script
        [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (purposeCtx 0 info red [.B P])] m = .Error :=
      exec_error_of_ev h
    obtain ⟨m, hm⟩ := he
    exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩

/-- one_shot_mint's acceptance condition for a typed V3 context. -/
def mintPasses (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .MintingScript cs => launchResult seedTx seedIx rh (IsData.toData ctx.scriptContextTxInfo) cs = some true
  | _ => False

/-- An error for some fuel is no `()` for any. -/
theorem mint_never_unit {args : List PlutusCore.UPLC.Term.Term} {m : Nat}
    (hm : cekExecuteProgram oneShotMintTemplate.script args m = .Error) :
    (∃ n, cekExecuteProgram oneShotMintTemplate.script args n = .Halt (.VCon .Unit)) ↔ False :=
  ⟨fun ⟨n, hn⟩ => exec_never_halts hm n _ hn, False.elim⟩

/-- **one_shot_mint, every typed V3 context:** the program returns `()` exactly when
`mintPasses` holds. -/
theorem mint_every_context_iff (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (ctx : ScriptContext) :
    (∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      mintPasses seedTx seedIx rh ctx := by
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | MintingScript cs => exact launch_iff seedTx seedIx rh (IsData.toData tx) red cs
  | SpendingScript ref d =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.mint_spending_errors seedTx seedIx rh (IsData.toData tx) red
      [IsData.toData ref, IsData.toData d]
    exact mint_never_unit hm
  | RewardingScript cred =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.mint_rewarding_errors seedTx seedIx rh (IsData.toData tx) red
      [IsData.toData cred]
    exact mint_never_unit hm
  | CertifyingScript idx cert =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.mint_certifying_errors seedTx seedIx rh (IsData.toData tx) red
      [.I idx, IsData.toData cert]
    exact mint_never_unit hm
  | VotingScript v =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.mint_voting_errors seedTx seedIx rh (IsData.toData tx) red
      [IsData.toData v]
    exact mint_never_unit hm
  | ProposingScript idx p =>
    obtain ⟨m, hm⟩ := Lovejoin.AnyTx.PurposesKernel.mint_proposing_errors seedTx seedIx rh (IsData.toData tx) red
      [IsData.toData idx, IsData.toData p]
    exact mint_never_unit hm

end Lovejoin.Every

/-- info: 'Lovejoin.Every.mint_every_context_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.mint_every_context_iff

/-- info: 'Lovejoin.Every.every_context_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.every_context_iff
