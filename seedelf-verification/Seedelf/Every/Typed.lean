import Seedelf.Every.Root
import Seedelf.AnyTxCover

/-! # The wallet in every transaction, in the source's terms

`wallet_exec_iff` says what the deployed program does on any context `Data`: it returns `()`
exactly when `walletBool` holds, and otherwise reaches `Error` and never halts. `wallet_accepts_iff`
says it for every typed V3 `ScriptContext`, in `wallet.ak`'s own terms (`walletAccepts`):
- `spend(maybe_register, proof, …)` and nothing else (`else(_) { fail }`);
- the redeemer a `Proof { z_b, g_r_b, vkh }`;
- `None` accepts, and so does a datum that isn't a `Register`;
- a `Register { generator, public_value }` moves exactly when `schnorr.prove(…)` holds and
  `list.has(transaction.extra_signatories, proof.vkh)`.

Kernel-checked: no Blaster, no step limit, any number of signatories, no ledger assumption. -/

namespace Seedelf.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open CardanoLedgerApi.V1.Credential (PubKeyHash)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll

/-! ### The program -/

/-- **The wallet on any context `Data`:** the deployed program returns `()` for some fuel exactly
when `walletBool` holds. -/
theorem wallet_exec_iff (ctx : Data) :
    (∃ n, cekExecuteProgram wallet.script [toTerm ctx] n = .Halt (.VCon .Unit)) ↔
      walletBool ctx = some true := by
  have h := wallet_root ctx
  cases hr : walletBool ctx with
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
theorem wallet_exec_error (ctx : Data) (h : walletBool ctx ≠ some true) :
    (∃ m, cekExecuteProgram wallet.script [toTerm ctx] m = .Error) ∧
      ∀ n V, cekExecuteProgram wallet.script [toTerm ctx] n ≠ .Halt V := by
  have hroot := wallet_root ctx
  have hn : unitIf (walletBool ctx) = none := by
    revert h; cases walletBool ctx with
    | none => intro _; rfl
    | some b => cases b <;> simp [unitIf]
  rw [hn] at hroot
  obtain ⟨m, hm⟩ := exec_error_of_ev hroot
  exact ⟨⟨m, hm⟩, fun n V => exec_never_halts hm n V⟩

/-! ### The source's terms -/

/-- `schnorr.prove(generator, public_value, z_b, g_r_b, vkh)`: the three points decompress, z and
the Fiat-Shamir challenge c = blake2b_224(g ‖ g_r ‖ u ‖ vkh) decode into the scalar field
(`expect Some`), and g^z = g_r · u^c. The crypto is opaque: this is what the bytes check. -/
def schnorrProve (g u z gr vkh : ByteString) : Bool :=
  match bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | .ok G, .ok U, .ok R =>
    let zi : Integer := bigEndian z
    let c : Integer := bigEndian (challenge g u gr vkh)
    decide (0 ≤ zi ∧ zi < Seedelf.V1.q) && decide (0 ≤ c ∧ c < Seedelf.V1.q) &&
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _ => false

/-- The redeemer as a `Proof { z_b, g_r_b, vkh }`: constructor 0 of exactly three bytestrings. -/
def proofOf : Data → Option (ByteString × ByteString × ByteString)
  | .Constr rt rfs =>
    if rt = 0 then (match rfs with | [.B z, .B gr, .B vkh] => some (z, gr, vkh) | _ => none) else none
  | _ => none

/-- `if register is Register`: constructor 0 of exactly two bytestrings. -/
def registerOf : Data → Option (ByteString × ByteString)
  | .Constr dt dfs =>
    if dt = 0 then (match dfs with | [.B g, .B u] => some (g, u) | _ => none) else none
  | _ => none

/-- What the wallet accepts, `wallet.ak` at variant 1. -/
def walletAccepts (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .SpendingScript _ maybeRegister =>
    match proofOf ctx.scriptContextRedeemer with
    | some (z, gr, vkh) =>
      match maybeRegister with
      | some d =>
        match registerOf d with
        | some (g, u) => schnorrProve g u z gr vkh = true ∧ vkh ∈ ctx.scriptContextTxInfo.txInfoSignatories
        | none => True
      | none => True
    | none => False
  | _ => False

/-! ### From the program's terms to the source's -/

/-- The compiled check is `schnorr.prove`. -/
theorem proveOpt_true_iff (g u z gr vkh : ByteString) :
    proveOpt g u z gr vkh = some true ↔ schnorrProve g u z gr vkh = true := by
  simp only [proveOpt, schnorrProve]
  -- A free integer, so no step can decide `n < q` by reduction (chunk 45's `ownerPred_typed`).
  generalize bigEndian z = zi
  generalize bigEndian (challenge g u gr vkh) = ci
  cases h0 : PlutusCore.Integer.lessThanEqualsInteger 0 zi <;>
  cases hq : PlutusCore.Integer.lessThanInteger zi Seedelf.V1.q <;>
  cases h0c : PlutusCore.Integer.lessThanEqualsInteger 0 ci <;>
  cases hqc : PlutusCore.Integer.lessThanInteger ci Seedelf.V1.q <;>
  cases hG : bls12_381_G1_uncompress g <;> cases hU : bls12_381_G1_uncompress u <;>
  cases hR : bls12_381_G1_uncompress gr <;>
  simp_all [PlutusCore.Integer.lessThanEqualsInteger, PlutusCore.Integer.lessThanInteger] <;>
  intros <;> (first | omega | exact absurd ‹_› (Int.not_lt.2 ‹_›) | exact absurd ‹_› (Int.not_le.2 ‹_›))

/-- The signatories, encoded: a `List` of `B`s (AnyTxShapes' `signatories_encoding`). -/
theorem sigs_encoding (sigs : List PubKeyHash) : IsData.toData sigs = .List (sigs.map .B) := by
  induction sigs with
  | nil => rfl
  | cons s rest ih =>
    exact congrArg (fun d : Data => match d with | .List l => Data.List (.B s :: l) | d => d) ih

/-- The walk over the encoded signatories is `list.has`. -/
theorem signedBy_map (vkh : ByteString) (l : List PubKeyHash) :
    signedBy vkh (l.map .B) = some (decide (vkh ∈ l)) := by
  induction l with
  | nil => simp [signedBy]
  | cons b l ih =>
    simp only [List.map, signedBy, ih, PlutusCore.ByteString.equalsByteString]
    by_cases h : b = vkh
    · subst h; simp
    · have h' : (b == vkh) = false := by simpa using h
      simp only [h', Bool.false_eq_true, ↓reduceIte, List.mem_cons]
      simp [Ne.symm h]

/-- The TxInfo's signatories' check is `list.has(transaction.extra_signatories, vkh)`. -/
theorem signedOpt_tx (tx : TxInfo) (vkh : ByteString) :
    signedOpt (IsData.toData tx) vkh = some (decide (vkh ∈ tx.txInfoSignatories)) := by
  rw [Seedelf.V1.TxRest.ofTxInfo_infoWith, sigs_encoding]
  exact signedBy_map vkh tx.txInfoSignatories

/-- A Register's spend is `prove(…)? && list.has(…)?`. -/
theorem registerOpt_true_iff (tx : TxInfo) (g u z gr vkh : ByteString) :
    registerOpt (IsData.toData tx) g u z gr vkh = some true ↔
      schnorrProve g u z gr vkh = true ∧ vkh ∈ tx.txInfoSignatories := by
  unfold registerOpt
  rw [← proveOpt_true_iff]
  cases proveOpt g u z gr vkh with
  | none => simp [afterProve]
  | some b => cases b <;> simp [afterProve, signedOpt_tx]

/-- `Some(d)`: a Register's spend, or anything else accepting. -/
theorem datumOpt_true_iff (tx : TxInfo) (z gr vkh : ByteString) (d : Data) :
    datumOpt (IsData.toData tx) z gr vkh d = some true ↔
      match registerOf d with
      | some (g, u) => schnorrProve g u z gr vkh = true ∧ vkh ∈ tx.txInfoSignatories
      | none => True := by
  rcases d with ⟨dt, dfs⟩ | _ | _ | _ | _
  all_goals try (simp [datumOpt, registerOf]; done)
  by_cases h0 : dt = 0
  · subst h0
    rcases dfs with _ | ⟨_ | _ | _ | _ | g, _ | ⟨_ | _ | _ | _ | u, _ | ⟨_, _⟩⟩⟩
    all_goals try (simp [datumOpt, registerOf, PlutusCore.Integer.equalsInteger]; done)
    simp only [datumOpt, registerOf, PlutusCore.Integer.equalsInteger, beq_self_eq_true, ↓reduceIte]
    exact registerOpt_true_iff tx g u z gr vkh
  · have h0' : PlutusCore.Integer.equalsInteger 0 dt = false := by
      simp [PlutusCore.Integer.equalsInteger, Ne.symm h0]
    simp [datumOpt, registerOf, h0, h0']

/-- A spend. -/
theorem spend_iff (tx : TxInfo) (red : Data) (ref : TxOutRef) (d : Option Data) :
    walletBool (IsData.toData (⟨tx, red, .SpendingScript ref d⟩ : ScriptContext)) = some true ↔
      walletAccepts ⟨tx, red, .SpendingScript ref d⟩ := by
  rw [Seedelf.V1.spendIn_of_spend]
  simp only [Seedelf.V1.spendIn, walletBool, walletAccepts, PlutusCore.Integer.equalsInteger, beq_self_eq_true,
    ↓reduceIte]
  rcases red with ⟨rt, rfs⟩ | _ | _ | _ | _
  all_goals try (simp [proofOf]; done)
  by_cases h0 : rt = 0
  · subst h0
    rcases rfs with _ | ⟨_ | _ | _ | _ | z, _ | ⟨_ | _ | _ | _ | gr, _ | ⟨_ | _ | _ | _ | vkh, _ | ⟨_, _⟩⟩⟩⟩
    all_goals try (simp [proofOf]; done)
    simp only [proofOf, beq_self_eq_true, ↓reduceIte]
    cases d with
    | none => simp [IsData.toData, CardanoLedgerApi.IsData.Class.mkDataConstr]
    | some dd =>
      simp only [IsData.toData, CardanoLedgerApi.IsData.Class.mkDataConstr, beq_self_eq_true, ↓reduceIte,
        someOpt]
      exact datumOpt_true_iff tx z gr vkh dd
  · have h0' : (0 == rt) = false := by simp [Ne.symm h0]
    simp [proofOf, h0, h0']

/-- An error for some fuel is no `()` for any. -/
theorem never_unit {args : List PlutusCore.UPLC.Term.Term} {m : Nat}
    (hm : cekExecuteProgram wallet.script args m = .Error) :
    (∃ n, cekExecuteProgram wallet.script args n = .Halt (.VCon .Unit)) ↔ False :=
  ⟨fun ⟨n, hn⟩ => exec_never_halts hm n _ hn, False.elim⟩

/-- **The wallet, every typed V3 context:** the deployed program returns `()` exactly when
`walletAccepts` holds, `wallet.ak`'s spend in its own terms; otherwise it reaches `Error`
(`wallet_exec_error`). -/
theorem wallet_accepts_iff (ctx : ScriptContext) :
    (∃ n, cekExecuteProgram wallet.script [toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      walletAccepts ctx := by
  rw [wallet_exec_iff]
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | SpendingScript ref d => exact spend_iff tx red ref d
  | _ => simp [IsData.toData, CardanoLedgerApi.IsData.Class.mkDataConstr, walletBool, walletAccepts,
      PlutusCore.Integer.equalsInteger]

end Seedelf.Every

/-- info: 'Seedelf.Every.wallet_accepts_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Seedelf.Every.wallet_accepts_iff

/-- info: 'Seedelf.Every.wallet_exec_error' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Seedelf.Every.wallet_exec_error
