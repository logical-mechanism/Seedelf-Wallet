import Seedelf.Every.PolicyRoot
import Seedelf.Every.Typed
import Seedelf.Policy

/-! # The policy in every transaction, in the source's terms

`policy_exec_iff` says what the deployed policy does on any context `Data`; `policy_accepts_iff`
says it for every typed V3 `ScriptContext`, in `seedelf.ak`'s own terms (`policyAccepts`):
- `mint(personal_tag, policy_id, transaction)` and nothing else (`else(_) { fail }`);
- `expect [(pid, tkn, amt)] = assets.flatten(mint)`: exactly one line, in both blocks;
- `expect [input, ..] = inputs`, and `token_name.generate` (`seedelfName`), which fails past a byte;
- `xor` of the burn (`pid == policy_id`, `bytearray.take(tkn, 4) == seedelf`, `amt == -1`) and the
  mint (`policy_id == pid`, `token_name == tkn`, `1 == amt`).
Every expectation's failure is the script's. Kernel-checked: no Blaster, no step limit, any mint,
any inputs, PlutusCoreBlaster's own byte slice. -/

namespace Seedelf.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString sliceByteString equalsByteString consByteStringV2)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-! ### The program -/

/-- **The policy on any context `Data`:** the deployed program returns `()` for some fuel exactly
when `policyBool` holds. -/
theorem policy_exec_iff (ctx : Data) :
    (∃ n, cekExecuteProgram seedelf.script [toTerm ctx] n = .Halt (.VCon .Unit)) ↔
      policyBool ctx = some true := by
  have h := policy_root ctx
  cases hr : policyBool ctx with
  | some b =>
    cases b with
    | true =>
      rw [hr] at h
      exact ⟨fun _ => rfl, fun _ => exec_halt_of_ev h⟩
    | false =>
      rw [hr] at h
      obtain ⟨m, hm⟩ := exec_error_of_ev h
      exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩
  | none =>
    rw [hr] at h
    obtain ⟨m, hm⟩ := exec_error_of_ev h
    exact ⟨fun ⟨n, hn⟩ => (exec_never_halts hm n _ hn).elim, fun h => by cases h⟩

/-- Otherwise the program reaches `Error`, and then halts for no fuel at all, with no value. -/
theorem policy_exec_error (ctx : Data) (h : policyBool ctx ≠ some true) :
    (∃ m, cekExecuteProgram seedelf.script [toTerm ctx] m = .Error) ∧
      ∀ n V, cekExecuteProgram seedelf.script [toTerm ctx] n ≠ .Halt V := by
  have hroot := policy_root ctx
  have hn : unitIf (policyBool ctx) = none := by
    revert h; cases policyBool ctx with
    | none => intro _; rfl
    | some b => cases b <;> simp [unitIf]
  rw [hn] at hroot
  obtain ⟨m, hm⟩ := exec_error_of_ev hroot
  exact ⟨⟨m, hm⟩, fun n V => exec_never_halts hm n V⟩

/-! ### The source's terms -/

/-- `expect [(pid, tkn, amt)] = assets.flatten(mint)`: the mint's one line, or the expectation's
failure. -/
def flatLine (mint : List (Data × Data)) : Option (ByteString × ByteString × Integer) :=
  match flatPairs mint with
  | some [.List [.B pid, .B tkn, .I amt]] => some (pid, tkn, amt)
  | _ => none

/-- `seedelf.ak` at variant 1, for a typed V3 context. -/
def policyAccepts (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo, ctx.scriptContextRedeemer with
  | .MintingScript own, .B tag =>
    match flatLine ctx.scriptContextTxInfo.txInfoMint, ctx.scriptContextTxInfo.txInfoInputs with
    | some (pid, tkn, amt), input :: _ =>
      match Seedelf.V1.seedelfName input.txInInfoOutRef.txOutRefId input.txInInfoOutRef.txOutRefIdx tag with
      | some name =>
        let burn := pid = own ∧ sliceByteString 0 4 tkn = Seedelf.V1.seedelfPrefix ∧ amt = -1
        let mint := own = pid ∧ name = tkn ∧ (1 : Integer) = amt
        (burn ∨ mint) ∧ ¬(burn ∧ mint)
      | none => False
    | _, _ => False
  | _, _ => False

/-! ### From the program's terms to the source's -/

/-- The burn block's answer, from its line. -/
def burnB (own pid tkn : ByteString) (amt : Integer) : Bool :=
  if equalsByteString pid own then
    (if equalsByteString (sliceByteString 0 4 tkn) Seedelf.V1.seedelfPrefix then
      PlutusCore.Integer.equalsInteger amt (-1) else false) else false

/-- The mint block's answer, from its line and the generated name. -/
def mintB (own pid tkn : ByteString) (amt : Integer) (name : ByteString) : Bool :=
  if equalsByteString own pid then
    (if equalsByteString name tkn then PlutusCore.Integer.equalsInteger 1 amt else false) else false

theorem lineFields_tx (tx : TxInfo) : lineFields (IsData.toData tx) =
    (match flatPairs tx.txInfoMint with | some [.List l] => some l | _ => none) := rfl

/-- On a typed TxInfo, the burn block reads `flatLine`: the flatten only makes lines of three. -/
theorem burnOpt_tx (tx : TxInfo) (own : ByteString) :
    burnOpt (IsData.toData tx) own = (flatLine tx.txInfoMint).map fun t => burnB own t.1 t.2.1 t.2.2 := by
  unfold burnOpt flatLine
  rw [lineFields_tx]
  cases hf : flatPairs tx.txInfoMint with
  | none => rfl
  | some L =>
    rcases L with _ | ⟨x, _ | ⟨y, L⟩⟩
    · rfl
    · obtain ⟨a, b, c, rfl⟩ := mem_flatPairs hf (List.mem_singleton.2 rfl)
      rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
        rcases c with _ | _ | _ | amt | _ <;> rfl
    · -- Two lines or more: the first is a list of three too, so both matches can decide.
      obtain ⟨a, b, c, rfl⟩ := mem_flatPairs hf (List.mem_cons_self ..)
      rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
        rcases c with _ | _ | _ | amt | _ <;> rfl

/-- The mint block likewise, its first input's reference as the ledger encodes it. -/
theorem mintOpt_tx (tx : TxInfo) (own tag : ByteString) :
    mintOpt (IsData.toData tx) own tag =
      match flatLine tx.txInfoMint, tx.txInfoInputs with
      | some (pid, tkn, amt), input :: _ =>
        match consByteStringV2 input.txInInfoOutRef.txOutRefIdx input.txInInfoOutRef.txOutRefId with
        | .ok c => some (mintB own pid tkn amt (tokenName tag c))
        | .error _ => none
      | _, _ => none := by
  rcases tx with ⟨ins, refs, outs, fee, mint, certs, wdrl, range, sigs, rdms, dats, tid, votes, props, tre, don⟩
  unfold mintOpt flatLine
  rw [lineFields_tx]
  cases hf : flatPairs mint with
  | none => cases ins with
    | nil => rfl
    | cons input rest => rcases input with ⟨⟨txid, idx⟩, out⟩; rfl
  | some L =>
    rcases L with _ | ⟨x, _ | ⟨y, L⟩⟩
    · cases ins with
      | nil => rfl
      | cons input rest => rcases input with ⟨⟨txid, idx⟩, out⟩; rfl
    · obtain ⟨a, b, c, rfl⟩ := mem_flatPairs hf (List.mem_singleton.2 rfl)
      cases ins with
      | nil =>
        rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
          rcases c with _ | _ | _ | amt | _ <;> rfl
      | cons input rest =>
        rcases input with ⟨⟨txid, idx⟩, out⟩
        rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
          rcases c with _ | _ | _ | amt | _ <;> first | rfl | (cases consByteStringV2 idx txid <;> rfl)
    · obtain ⟨a, b, c, rfl⟩ := mem_flatPairs hf (List.mem_cons_self ..)
      cases ins with
      | nil =>
        rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
          rcases c with _ | _ | _ | amt | _ <;> rfl
      | cons input rest =>
        rcases input with ⟨⟨txid, idx⟩, out⟩
        rcases a with _ | _ | _ | _ | pid <;> rcases b with _ | _ | _ | _ | tkn <;>
          rcases c with _ | _ | _ | amt | _ <;> rfl

/-- `token_name.generate` is `consByteString`'s name. -/
theorem seedelfName_eq (txid : ByteString) (idx : Integer) (tag : ByteString) :
    Seedelf.V1.seedelfName txid idx tag =
      match consByteStringV2 idx txid with
      | .ok c => some (tokenName tag c)
      | .error _ => none := by
  unfold Seedelf.V1.seedelfName consByteStringV2
  by_cases h : 0 ≤ idx ∧ idx ≤ 255
  · have hb : (decide (0 ≤ idx) && decide (idx ≤ 255)) = true := by simp [h.1, h.2]
    simp only [if_pos h, hb, ↓reduceIte, tokenName]
    rfl
  · have hb : (decide (0 ≤ idx) && decide (idx ≤ 255)) = false := by
      by_cases h1 : 0 ≤ idx
      · have h2 : ¬ idx ≤ 255 := fun h2 => h ⟨h1, h2⟩
        simp [h1, h2]
      · simp [h1]
    simp only [if_neg h, hb, Bool.false_eq_true, ↓reduceIte]

theorem burnB_iff (own pid tkn : ByteString) (amt : Integer) :
    burnB own pid tkn amt = true ↔
      pid = own ∧ sliceByteString 0 4 tkn = Seedelf.V1.seedelfPrefix ∧ amt = -1 := by
  unfold burnB
  cases h1 : equalsByteString pid own <;> cases h2 : equalsByteString (sliceByteString 0 4 tkn) Seedelf.V1.seedelfPrefix <;>
    simp_all [equalsByteString, PlutusCore.Integer.equalsInteger]

theorem mintB_iff (own pid tkn : ByteString) (amt : Integer) (name : ByteString) :
    mintB own pid tkn amt name = true ↔ own = pid ∧ name = tkn ∧ (1 : Integer) = amt := by
  unfold mintB
  cases h1 : equalsByteString own pid <;> cases h2 : equalsByteString name tkn <;>
    simp_all [equalsByteString, PlutusCore.Integer.equalsInteger]

theorem xor_iff (b m : Bool) :
    ((b || m) && !(b && m)) = true ↔ (b = true ∨ m = true) ∧ ¬(b = true ∧ m = true) := by
  cases b <;> cases m <;> simp

/-- A mint. -/
theorem mint_iff (tx : TxInfo) (red : Data) (own : ByteString) :
    policyBool (IsData.toData (⟨tx, red, .MintingScript own⟩ : ScriptContext)) = some true ↔
      policyAccepts ⟨tx, red, .MintingScript own⟩ := by
  show policyBool (.Constr 0 [IsData.toData tx, red, .Constr 0 [.B own]]) = some true ↔ _
  simp only [policyBool, policyAccepts, PlutusCore.Integer.equalsInteger, beq_self_eq_true, ↓reduceIte]
  rcases red with ⟨_, _⟩ | _ | _ | _ | tag
  all_goals try (simp; done)
  simp only [burnOpt_tx, mintOpt_tx]
  cases hl : flatLine tx.txInfoMint with
  | none => simp
  | some t =>
    obtain ⟨pid, tkn, amt⟩ := t
    cases hi : tx.txInfoInputs with
    | nil => simp
    | cons input rest =>
      simp only [Option.map_some]
      rw [seedelfName_eq]
      cases hc : consByteStringV2 input.txInInfoOutRef.txOutRefIdx input.txInInfoOutRef.txOutRefId with
      | error e => simp
      | ok c =>
        simp only [Option.some.injEq]
        rw [xor_iff, burnB_iff, mintB_iff]

/-- **The policy, every typed V3 context:** the deployed program returns `()` exactly when
`policyAccepts` holds, `seedelf.ak`'s mint in its own terms; otherwise it reaches `Error`
(`policy_exec_error`). -/
theorem policy_accepts_iff (ctx : ScriptContext) :
    (∃ n, cekExecuteProgram seedelf.script [toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      policyAccepts ctx := by
  rw [policy_exec_iff]
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | MintingScript own => exact mint_iff tx red own
  | _ => simp [IsData.toData, CardanoLedgerApi.IsData.Class.mkDataConstr, policyBool, policyAccepts,
      PlutusCore.Integer.equalsInteger]

end Seedelf.Every

/-- info: 'Seedelf.Every.policy_accepts_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Seedelf.Every.policy_accepts_iff

/-- info: 'Seedelf.Every.policy_exec_error' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Seedelf.Every.policy_exec_error
