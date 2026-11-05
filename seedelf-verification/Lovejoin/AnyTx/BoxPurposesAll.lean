import Lovejoin.AnyTx.BoxSemantics
import Lovejoin.Template.AnyTxPurposes

/-! The compiled mix_box rejects every non-spending V3 purpose, independently of
transaction fields and purpose payload. Together with BoxSemantics this covers all
V3 purpose constructors without a transaction-size or evaluator-step bound. -/
namespace Lovejoin.AnyTx.BoxPurposesAll
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.UPLC.CekValue (CekValue)
open Lovejoin.AnyTx.BoxSemantics
open Lovejoin.AnyTx.BoxCover
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template.AnyTx (purposeCtx)

set_option maxHeartbeats 0

theorem minting_errors (L : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (purposeCtx 0 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem rewarding_errors (L : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (purposeCtx 2 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem certifying_errors (L : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (purposeCtx 3 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem voting_errors (L : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (purposeCtx 4 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem proposing_errors (L : ByteString) (info red : Data) (fs : List Data) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (purposeCtx 5 info red fs)] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- Exact acceptance condition for every typed V3 context. -/
def contextPasses (L : ByteString) (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .SpendingScript ref _ =>
    ∃ (before after : List (Data × Data)) (addr value script : Data) (datum : OutputDatum),
      inputPairs ctx.scriptContextTxInfo.txInfoInputs =
        before ++ (IsData.toData ref, .Constr 0 [addr, value, IsData.toData datum, script]) :: after ∧
      (∀ pair ∈ before, pair.1 ≠ IsData.toData ref) ∧
      datumPassesLedger L ctx.scriptContextTxInfo.txInfoWdrl datum
  | _ => False

/-- Full mix_box acceptance characterization over all typed V3 script contexts. -/
theorem every_context_iff (L : ByteString) (ctx : ScriptContext) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔ contextPasses L ctx := by
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | SpendingScript ref datum =>
    exact every_spend_ledger_iff L tx red ref datum
  | MintingScript cs =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := minting_errors L (IsData.toData tx) red [IsData.toData cs]
      exact (exec_never_halts hm n (.VCon .Unit)) hn
    · intro h; exact False.elim h
  | RewardingScript cred =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := rewarding_errors L (IsData.toData tx) red [IsData.toData cred]
      exact (exec_never_halts hm n (.VCon .Unit)) hn
    · intro h; exact False.elim h
  | CertifyingScript idx cert =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := certifying_errors L (IsData.toData tx) red [IsData.toData idx, IsData.toData cert]
      exact (exec_never_halts hm n (.VCon .Unit)) hn
    · intro h; exact False.elim h
  | VotingScript voter =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := voting_errors L (IsData.toData tx) red [IsData.toData voter]
      exact (exec_never_halts hm n (.VCon .Unit)) hn
    · intro h; exact False.elim h
  | ProposingScript idx proposal =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := proposing_errors L (IsData.toData tx) red [IsData.toData idx, IsData.toData proposal]
      exact (exec_never_halts hm n (.VCon .Unit)) hn
    · intro h; exact False.elim h

end Lovejoin.AnyTx.BoxPurposesAll

#print axioms Lovejoin.AnyTx.BoxPurposesAll.minting_errors

/-- info: 'Lovejoin.AnyTx.BoxPurposesAll.every_context_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.BoxPurposesAll.every_context_iff
