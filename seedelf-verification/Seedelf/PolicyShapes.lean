import Seedelf.PolicyAnyTx

/-! The policy's every-transaction families are every case, by Lean theorems rather than by
reading. The `Policy…AnyTx` modules and Slice/ each fix a shape of the context, in PolicyAnyTx's
encoding, and leave the rest any `Data`; here each split they rely on is shown to be every case
of a V3 context, as CardanoLedgerApiBlaster's types and encoding have it (V3/Contexts.lean).
Kernel-checked, no blaster.

- `policy_every_context`: every V3 context is a minting one, `mintIn` of its TxInfo, its
  redeemer and its policy id (`mintIn_of_minting`), or another purpose's, `Constr k _` for k = 1
  to 5, as PolicyPurposeAnyTx takes it.
- `policy_every_redeemer`: every redeemer is a `B`, the personal tag, or one of
  `nonTagRedeemer`'s four, PolicyRedeemerAnyTx's `I`, `List`, `Map` and `Constr`.
- `TxRest.ofTxInfo_withMint` (PolicyAnyTx): every TxInfo is `withMint` of its other fields, its
  signatories, its inputs and its mint. `policy_every_inputs`: every input list but the empty
  one is `inputsFrom` of its first input's id, index and output, and the rest.
- `policy_every_mint`: CardanoLedgerApiBlaster's `Value` is a raw `List (Data × Data)`, and only
  `validMintValue` (V3/Contexts.lean, its model of the ledger's rule for `txInfoMint`) gives a
  mint a shape. It holds of `[(B cs, Map [(B tn, I n), …]), …]` alone: every policy id a `B`,
  every name a `B`, every amount an `I` and never 0, every policy one name at least, names and
  policies strictly ascending, the first policy above "" (no Ada). So a valid mint is
  `mintOf lines` with no policy empty: its layout, each policy's number of names, is a
  composition of its line count.
- `policy_one_line_iff`: with no policy empty, `lineCount lines = 1` exactly when the mint is
  `oneLine pid tkn amt`, Slice/'s rule. An empty policy would break it (the `example` after it),
  and `validMintValue` has none.
- `policy_ledger_hypotheses`: the ledger's rule for a TxInfo (`validTxInfo`) gives the two
  hypotheses used here, an input and a valid mint.
- `policy_every_context_cover`, `policy_every_valid_context`: so every context the ledger
  accepts is in `policyFamilies`: another purpose's; a mint whose redeemer isn't a `B`, with any
  TxInfo; or a mint tagged `B tag` in `withMint _ _ (inputsFrom txid idx out rest) (mintOf lines)`,
  of other than one line (the `PolicyLines…AnyTx` modules) or of one, `oneLine pid tkn amt`
  (Slice/).

Unlike the wallet's (AnyTxShapes), this cover needs the ledger's rules for two fields the
policy reads, in CardanoLedgerApiBlaster's model of them: `validInputs` for the first input,
which the policy names the token after, and `validMintValue` for the mint, which it walks. The
`#guard_msgs` at the end fail the build if a theorem here ever depends on more axioms. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3.Contexts (ScriptContext TxInInfo MintValue validMintValue validInputs
  validTxInfo validScriptContext)
open CardanoLedgerApi.V3.Contexts.validMintValue (validMintTokens validCurrencySymbol)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)

/-! ### Every purpose -/

/-- Every V3 context is a minting one, in its own TxInfo with its own redeemer, or another
purpose's. -/
theorem policy_every_context (ctx : ScriptContext) :
    (∃ own : ByteString,
      IsData.toData ctx = mintIn (IsData.toData ctx.scriptContextTxInfo) ctx.scriptContextRedeemer own) ∨
    ∃ (k : Integer) (fs : List Data), (k = 1 ∨ k = 2 ∨ k = 3 ∨ k = 4 ∨ k = 5) ∧
      IsData.toData ctx =
        .Constr 0 [IsData.toData ctx.scriptContextTxInfo, ctx.scriptContextRedeemer, .Constr k fs] := by
  obtain ⟨tx, redeemer, si⟩ := ctx
  cases si with
  | MintingScript own => exact Or.inl ⟨own, rfl⟩
  | SpendingScript _ _ => exact Or.inr ⟨1, _, Or.inl rfl, rfl⟩
  | RewardingScript _ => exact Or.inr ⟨2, _, Or.inr (Or.inl rfl), rfl⟩
  | CertifyingScript _ _ => exact Or.inr ⟨3, _, Or.inr (Or.inr (Or.inl rfl)), rfl⟩
  | VotingScript _ => exact Or.inr ⟨4, _, Or.inr (Or.inr (Or.inr (Or.inl rfl))), rfl⟩
  | ProposingScript _ _ => exact Or.inr ⟨5, _, Or.inr (Or.inr (Or.inr (Or.inr rfl))), rfl⟩

/-! ### Every redeemer -/

/-- PolicyRedeemerAnyTx's four redeemers, a disjunct a builder: every one but a `B`. -/
def nonTagRedeemer (rd : Data) : Prop :=
  (∃ i, rd = .I i) ∨ (∃ l, rd = .List l) ∨ (∃ m, rd = .Map m) ∨ ∃ k fs, rd = .Constr k fs

/-- Every redeemer is a `B`, the personal tag, or one of the four. -/
theorem policy_every_redeemer : ∀ rd : Data, (∃ tag, rd = .B tag) ∨ nonTagRedeemer rd
  | .B tag => Or.inl ⟨tag, rfl⟩
  | .I i => Or.inr (Or.inl ⟨i, rfl⟩)
  | .List l => Or.inr (Or.inr (Or.inl ⟨l, rfl⟩))
  | .Map m => Or.inr (Or.inr (Or.inr (Or.inl ⟨m, rfl⟩)))
  | .Constr k fs => Or.inr (Or.inr (Or.inr (Or.inr ⟨k, fs, rfl⟩)))

/-- And no `B` is among the four: they are exactly the redeemers but a tag. -/
theorem nonTagRedeemer_not_tag (tag : ByteString) : ¬ nonTagRedeemer (.B tag) := by
  unfold nonTagRedeemer
  rintro (⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩)

/-! ### Every input list -/

/-- Every input list but the empty one is `inputsFrom` its first input's id, index and output,
and the rest. -/
theorem policy_every_inputs : ∀ ins : List TxInInfo, ins ≠ [] →
    ∃ (txid : ByteString) (idx : Integer) (out : Data) (rest : List Data),
      IsData.toData ins = inputsFrom txid idx out rest
  | [], h => absurd rfl h
  | ⟨⟨txid, idx⟩, out⟩ :: _, _ => ⟨txid, idx, IsData.toData out, _, rfl⟩

/-- The ledger's rule for the inputs (`validInputs`) asks for one at least. -/
theorem inputs_ne_nil_of_validInputs (ctx : ScriptContext) (h : validInputs ctx = true) :
    ctx.scriptContextTxInfo.txInfoInputs ≠ [] := by
  intro hnil
  simp [validInputs, hnil] at h

/-! ### Every mint -/

/-- `validMintValue`'s check of one policy's names: each a `B`, each amount an `I`. -/
private theorem names_of_validMintTokens : ∀ (tns : List (Data × Data)) (prev : ByteString),
    validMintTokens tns prev = true →
      ∃ ts : List (ByteString × Integer), tns = ts.map fun t => (.B t.1, .I t.2) := by
  intro tns
  induction tns with
  | nil => intro _ _; exact ⟨[], rfl⟩
  | cons p xs ih =>
    intro prev h
    obtain ⟨a, b⟩ := p
    -- every entry but `(B tn, I n)` fails the check
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validMintTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validMintTokens] at h; done)
    simp only [validMintTokens, Bool.and_eq_true] at h
    obtain ⟨ts, rfl⟩ := ih tn h.2
    exact ⟨(tn, n) :: ts, rfl⟩

/-- `validMintValue`'s check of the policies: each a `B` with a `Map` of one name at least. -/
private theorem lines_of_validCurrencySymbol : ∀ (v : List (Data × Data)) (prev : ByteString),
    validCurrencySymbol v prev = true →
      ∃ lines : List (ByteString × List (ByteString × Integer)),
        v = lines.map (fun l => (.B l.1, .Map (l.2.map fun t => (.B t.1, .I t.2)))) ∧
          ∀ l ∈ lines, l.2 ≠ [] := by
  intro v
  induction v with
  | nil => intro _ _; exact ⟨[], rfl, fun _ h => nomatch h⟩
  | cons p xs ih =>
    intro prev h
    obtain ⟨a, b⟩ := p
    -- every entry but `(B cs, Map ((B tn, I n) :: tokens))` fails the check
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true] at h
    obtain ⟨ts, rfl⟩ := names_of_validMintTokens tokens tn h.1.2
    obtain ⟨lines, rfl, hne⟩ := ih cs h.2
    refine ⟨(cs, (tn, n) :: ts) :: lines, rfl, fun l hl => ?_⟩
    rcases List.mem_cons.mp hl with rfl | hl
    · exact List.cons_ne_nil _ _
    · exact hne l hl

/-- A mint the ledger accepts (`validMintValue`) is `mintOf` its lines, every policy with one
name at least. -/
theorem policy_every_mint (v : MintValue) (h : validMintValue v = true) :
    ∃ lines : List (ByteString × List (ByteString × Integer)),
      IsData.toData v = mintOf lines ∧ ∀ l ∈ lines, l.2 ≠ [] := by
  obtain ⟨lines, hv, hne⟩ := lines_of_validCurrencySymbol v _ h
  subst hv
  exact ⟨lines, rfl, hne⟩

private theorem length_pos_of_ne_nil {α : Type} : ∀ {l : List α}, l ≠ [] → 0 < l.length
  | [], h => absurd rfl h
  | _ :: _, _ => Nat.succ_pos _

private theorem lineCount_cons (l : ByteString × List (ByteString × Integer))
    (rest : List (ByteString × List (ByteString × Integer))) :
    lineCount (l :: rest) = l.2.length + lineCount rest := rfl

/-- With no policy empty, as in every mint the ledger accepts, a mint is one line exactly when
it's `oneLine`. -/
theorem policy_one_line_iff (lines : List (ByteString × List (ByteString × Integer)))
    (hne : ∀ l ∈ lines, l.2 ≠ []) :
    lineCount lines = 1 ↔ ∃ (pid tkn : ByteString) (amt : Integer), mintOf lines = oneLine pid tkn amt := by
  constructor
  · intro h1
    rcases lines with _ | ⟨⟨pid, ts⟩, rest⟩
    · exact absurd h1 (by decide)
    · rw [lineCount_cons] at h1
      have hts := length_pos_of_ne_nil (hne (pid, ts) List.mem_cons_self)
      -- a second policy would be a second line at least
      have hrest : rest = [] := by
        rcases rest with _ | ⟨l2, rest'⟩
        · rfl
        · rw [lineCount_cons] at h1
          have := length_pos_of_ne_nil (hne l2 (List.mem_cons.mpr (Or.inr List.mem_cons_self)))
          omega
      subst hrest
      rcases ts with _ | ⟨⟨tkn, amt⟩, _ | ⟨t2, ts'⟩⟩
      · exact absurd hts (Nat.lt_irrefl 0)
      · exact ⟨pid, tkn, amt, rfl⟩
      · simp [lineCount] at h1
  · rintro ⟨pid, tkn, amt, h⟩
    rcases lines with _ | ⟨⟨p, ts⟩, _ | ⟨l2, rest⟩⟩
    · simp [mintOf, oneLine] at h
    · rcases ts with _ | ⟨t, _ | ⟨t2, ts'⟩⟩
      · simp [mintOf, oneLine] at h
      · rfl
      · simp [mintOf, oneLine] at h
    · simp [mintOf, oneLine] at h

-- The hypothesis is needed: an empty policy, which no valid mint has, leaves one line in a mint
-- that isn't `oneLine`.
example : lineCount [("p", []), ("q", [("t", 1)])] = 1 ∧
    ∀ pid tkn amt, mintOf [("p", []), ("q", [("t", 1)])] ≠ oneLine pid tkn amt :=
  ⟨rfl, fun _ _ _ h => by simp [mintOf, oneLine] at h⟩

/-! ### The ledger's hypotheses -/

/-- A context the ledger accepts (`validScriptContext`) has a TxInfo it accepts. -/
theorem validTxInfo_of_validScriptContext (ctx : ScriptContext) (h : validScriptContext ctx = true) :
    validTxInfo ctx = true := by
  simp only [validScriptContext, Bool.and_eq_true] at h
  exact h.2

/-- A TxInfo the ledger accepts (`validTxInfo`) has an input, and a mint it accepts. -/
theorem policy_ledger_hypotheses (ctx : ScriptContext) (h : validTxInfo ctx = true) :
    ctx.scriptContextTxInfo.txInfoInputs ≠ [] ∧
      validMintValue ctx.scriptContextTxInfo.txInfoMint = true := by
  simp only [validTxInfo, Bool.and_eq_true, and_assoc] at h
  obtain ⟨hin, -, -, -, hmint, -⟩ := h
  exact ⟨inputs_ne_nil_of_validInputs ctx hin, hmint⟩

/-! ### Every context -/

/-- The policy's families, each as its modules build the context `c`: another purpose's
(PolicyPurposeAnyTx); a mint whose redeemer isn't a `B`, any TxInfo (PolicyRedeemerAnyTx); or a
mint tagged `B tag`, in a TxInfo with a first input `txid#idx`, of no empty policy and other than
one line (the `PolicyLines…AnyTx` modules), or of one line (Slice/). -/
def policyFamilies (c : Data) : Prop :=
  (∃ (k : Integer) (info redeemer : Data) (fs : List Data), (k = 1 ∨ k = 2 ∨ k = 3 ∨ k = 4 ∨ k = 5) ∧
    c = .Constr 0 [info, redeemer, .Constr k fs]) ∨
  (∃ (info rd : Data) (own : ByteString), nonTagRedeemer rd ∧ c = mintIn info rd own) ∨
  (∃ (r : TxRest) (sigs : Data) (txid : ByteString) (idx : Integer) (out : Data) (rest : List Data)
      (lines : List (ByteString × List (ByteString × Integer))) (tag own : ByteString),
    (∀ l ∈ lines, l.2 ≠ []) ∧ lineCount lines ≠ 1 ∧
    c = mintIn (r.withMint sigs (inputsFrom txid idx out rest) (mintOf lines)) (.B tag) own) ∨
  ∃ (r : TxRest) (sigs : Data) (txid : ByteString) (idx : Integer) (out : Data) (rest : List Data)
      (pid tkn : ByteString) (amt : Integer) (tag own : ByteString),
    c = mintIn (r.withMint sigs (inputsFrom txid idx out rest) (oneLine pid tkn amt)) (.B tag) own

/-- Every V3 context with an input and a mint the ledger accepts is in one of the policy's
families. -/
theorem policy_every_context_cover (ctx : ScriptContext)
    (hin : ctx.scriptContextTxInfo.txInfoInputs ≠ [])
    (hmint : validMintValue ctx.scriptContextTxInfo.txInfoMint = true) :
    policyFamilies (IsData.toData ctx) := by
  rcases policy_every_context ctx with ⟨own, hctx⟩ | ⟨k, fs, hk, hctx⟩
  · rcases policy_every_redeemer ctx.scriptContextRedeemer with ⟨tag, htag⟩ | hrd
    · obtain ⟨txid, idx, out, rest, hins⟩ := policy_every_inputs _ hin
      obtain ⟨lines, hm, hne⟩ := policy_every_mint _ hmint
      have hmintIn : IsData.toData ctx =
          mintIn ((TxRest.ofTxInfo ctx.scriptContextTxInfo).withMint
            (IsData.toData ctx.scriptContextTxInfo.txInfoSignatories) (inputsFrom txid idx out rest)
            (mintOf lines)) (.B tag) own := by
        rw [hctx, TxRest.ofTxInfo_withMint, hins, hm, htag]
      by_cases h1 : lineCount lines = 1
      · obtain ⟨pid, tkn, amt, hone⟩ := (policy_one_line_iff lines hne).mp h1
        rw [hone] at hmintIn
        exact Or.inr (Or.inr (Or.inr ⟨_, _, txid, idx, out, rest, pid, tkn, amt, tag, own, hmintIn⟩))
      · exact Or.inr (Or.inr (Or.inl ⟨_, _, txid, idx, out, rest, lines, tag, own, hne, h1, hmintIn⟩))
    · exact Or.inr (Or.inl ⟨_, _, own, hrd, hctx⟩)
  · exact Or.inl ⟨k, _, _, fs, hk, hctx⟩

/-- So every context the ledger accepts (`validScriptContext`) is in one of the policy's
families. -/
theorem policy_every_valid_context (ctx : ScriptContext) (h : validScriptContext ctx = true) :
    policyFamilies (IsData.toData ctx) :=
  have hl := policy_ledger_hypotheses ctx (validTxInfo_of_validScriptContext ctx h)
  policy_every_context_cover ctx hl.1 hl.2

/-! ### Axioms: Lean's own, no `sorry`, `blasterProven` or `ofReduceBool` -/

/-- info: 'Seedelf.V1.policy_every_context' does not depend on any axioms -/
#guard_msgs in #print axioms policy_every_context
/-- info: 'Seedelf.V1.policy_every_redeemer' does not depend on any axioms -/
#guard_msgs in #print axioms policy_every_redeemer
/-- info: 'Seedelf.V1.nonTagRedeemer_not_tag' does not depend on any axioms -/
#guard_msgs in #print axioms nonTagRedeemer_not_tag
/-- info: 'Seedelf.V1.policy_every_inputs' does not depend on any axioms -/
#guard_msgs in #print axioms policy_every_inputs
/-- info: 'Seedelf.V1.inputs_ne_nil_of_validInputs' depends on axioms: [propext] -/
#guard_msgs in #print axioms inputs_ne_nil_of_validInputs
/-- info: 'Seedelf.V1.policy_every_mint' depends on axioms: [propext] -/
#guard_msgs in #print axioms policy_every_mint
/-- info: 'Seedelf.V1.policy_one_line_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms policy_one_line_iff
/-- info: 'Seedelf.V1.validTxInfo_of_validScriptContext' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms validTxInfo_of_validScriptContext
/-- info: 'Seedelf.V1.policy_ledger_hypotheses' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms policy_ledger_hypotheses
/-- info: 'Seedelf.V1.policy_every_context_cover' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms policy_every_context_cover
/-- info: 'Seedelf.V1.policy_every_valid_context' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms policy_every_valid_context

end Seedelf.V1
