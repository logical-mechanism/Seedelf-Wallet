import Lovejoin.Every.MintTyped

/-! # The readable statements: what they share

`Typed.lean` and `MintTyped.lean` prove that mix_logic and one_shot_mint accept exactly when
their raw specs hold, functions over `Data` read back from the compiled code. The `Readable*`
modules restate those specs over the ledger's typed contexts, in the Aiken source's terms, and
prove each restatement equal to its raw spec on `IsData.toData` of a context. They are plain Lean
about the spec functions: no CEK step, and no fact about the crypto.

This file has the typed lists as `IsData` encodes them, `pairs_match_and_all` as `AllPairs`, and
the ordered value searches as the ledger's `valueOf` on a value the ledger accepts. -/

namespace Lovejoin.Every.Readable
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open Lovejoin.Every

/-! ### Typed lists, as `IsData` encodes them -/

theorem inputs_data (xs : List TxInInfo) : IsData.toData xs = .List (xs.map IsData.toData) := by
  change Data.List (CardanoLedgerApi.V3.Contexts.txInfoInputsToListData xs) = _
  congr 1
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    change IsData.toData x :: CardanoLedgerApi.V3.Contexts.txInfoInputsToListData xs = _
    rw [ih]; rfl

theorem outputs_data (xs : List TxOut) : IsData.toData xs = .List (xs.map IsData.toData) := by
  change Data.List (CardanoLedgerApi.V2.Contexts.txInfoOutputsToListData xs) = _
  congr 1
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    change IsData.toData x :: CardanoLedgerApi.V2.Contexts.txInfoOutputsToListData xs = _
    rw [ih]; rfl

theorem cred_data (h : ByteString) :
    IsData.toData (CardanoLedgerApi.V1.Credential.Credential.ScriptCredential h) = .Constr 1 [.B h] := rfl
theorem none_data {α : Type} [IsData α] : IsData.toData (none : Option α) = .Constr 1 [] := rfl
theorem some_data {α : Type} [IsData α] (x : α) : IsData.toData (some x) = .Constr 0 [IsData.toData x] := rfl

/-- `list.length`, as the program counts. -/
theorem countOf_eq (xs : List Data) : countOf xs = (xs.length : Integer) := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    simp only [countOf, ih, PlutusCore.Integer.addInteger, List.length_cons]
    change (1 : Int) + (xs.length : Int) = ((xs.length + 1 : Nat) : Int)
    omega

theorem countOf_map (f : α → Data) (xs : List α) : countOf (xs.map f) = (xs.length : Integer) := by
  rw [countOf_eq, List.length_map]

/-! ### `pairs_match_and_all` -/

/-- `pairs_match_and_all(xs, ys, pred)`: the lists are the same length and every pair passes. -/
def AllPairs (R : α → β → Prop) : List α → List β → Prop
  | [], [] => True
  | x :: xs, y :: ys => R x y ∧ AllPairs R xs ys
  | _, _ => False

/-- `AllPairs` says what it reads as: as many of one as of the other, and each pair passes. -/
theorem allPairs_iff (R : α → β → Prop) (xs : List α) (ys : List β) :
    AllPairs R xs ys ↔ xs.length = ys.length ∧ ∀ p ∈ xs.zip ys, R p.1 p.2 := by
  induction xs generalizing ys with
  | nil => cases ys <;> simp [AllPairs]
  | cons x xs ih =>
    cases ys with
    | nil => simp [AllPairs]
    | cons y ys => simp [AllPairs, ih, List.zip_cons_cons, and_left_comm]

theorem allPairs_length {R : α → β → Prop} {xs : List α} {ys : List β} (h : AllPairs R xs ys) :
    xs.length = ys.length := ((allPairs_iff R xs ys).1 h).1

/-- The program's pairwise check over encoded lists is `AllPairs` of the check on each pair. -/
theorem pairsAll_map (f : Data → Data → Option Bool) (g : α → Data) (h : β → Data)
    (xs : List α) (ys : List β) :
    pairsAll f (xs.map g) (ys.map h) = some true ↔ AllPairs (fun x y => f (g x) (h y) = some true) xs ys := by
  induction xs generalizing ys with
  | nil => cases ys <;> simp [pairsAll, AllPairs]
  | cons x xs ih =>
    cases ys with
    | nil => simp [pairsAll, AllPairs]
    | cons y ys =>
      simp only [List.map_cons, pairsAll, AllPairs]
      cases hf : f (g x) (h y) with
      | none => simp
      | some b => cases b <;> simp [ih]

theorem allPairs_congr {R S : α → β → Prop} (hRS : ∀ x y, R x y ↔ S x y) :
    ∀ (xs : List α) (ys : List β), AllPairs R xs ys ↔ AllPairs S xs ys
  | [], [] => Iff.rfl
  | [], _ :: _ => Iff.rfl
  | _ :: _, [] => Iff.rfl
  | x :: xs, y :: ys => by simp only [AllPairs, hRS x y, allPairs_congr hRS xs ys]

/-! ### Byte strings, as the searches compare them -/

theorem bytes_le_true {a b : ByteString} (h : PlutusCore.ByteString.lessThanEqualsByteString a b = true) :
    ¬ b < a := of_decide_eq_true h

theorem bytes_le_false {a b : ByteString} (h : PlutusCore.ByteString.lessThanEqualsByteString a b = false) :
    b < a := by
  have h' : ¬ (a ≤ b) := of_decide_eq_false h
  exact Classical.not_not.1 h'

theorem bytes_eq_true {a b : ByteString} : PlutusCore.ByteString.equalsByteString a b = true ↔ a = b :=
  beq_iff_eq

theorem bytes_lt_irrefl (a : ByteString) : ¬ a < a := String.lt_irrefl a.data

theorem bytes_lt_trans {a b c : ByteString} (hab : a < b) (hbc : b < c) : a < c := by
  change a.data < c.data
  exact String.lt_trans hab hbc

/-! ### Maps as the ledger keeps them -/

/-- A map with byte keys in strictly increasing order: how the ledger keeps a value's policies
and each policy's names. -/
def Asc : List (Data × Data) → Prop
  | [] => True
  | (.B k, _) :: rest => (∀ p ∈ rest, ∀ k', p.1 = .B k' → k < k') ∧ Asc rest
  | _ :: _ => False

/-- `assets.tokens(value, policy)`: the names under `P`, or none. -/
def tokensUnder (P : ByteString) : List (Data × Data) → List (Data × Data)
  | [] => []
  | (k, v) :: rest =>
    if k = .B P then (match v with | .Map m => m | _ => []) else tokensUnder P rest

theorem tokensUnder_absent (P : ByteString) :
    ∀ (xs : List (Data × Data)), (∀ p ∈ xs, p.1 ≠ .B P) → tokensUnder P xs = []
  | [], _ => rfl
  | (k, v) :: rest, h => by
    have hk : k ≠ .B P := h (k, v) (by simp)
    simp only [tokensUnder, hk, if_false]
    exact tokensUnder_absent P rest (fun p hp => h p (by simp [hp]))

theorem find_token_absent (N : ByteString) :
    ∀ (xs : List (Data × Data)), (∀ p ∈ xs, p.1 ≠ .B N) →
      CardanoLedgerApi.V1.Value.valueOf.find_token N xs = 0
  | [], _ => rfl
  | (k, v) :: rest, h => by
    have hk : Data.B N ≠ k := fun he => h (k, v) (by simp) he.symm
    simp only [CardanoLedgerApi.V1.Value.valueOf.find_token, hk, if_false]
    exact find_token_absent N rest (fun p hp => h p (by simp [hp]))

/-- Past a key at or above the target, no later key is the target. -/
theorem later_ne {k P : ByteString} {rest : List (Data × Data)}
    (hlater : ∀ p ∈ rest, ∀ k', p.1 = .B k' → k < k') (hle : ¬ k < P) :
    ∀ p ∈ rest, p.1 ≠ .B P := by
  intro p hp he
  exact hle (hlater p hp P he)

/-- The policy search on a sorted map of maps is `tokensUnder`. -/
theorem policyEntry_asc (P : ByteString) :
    ∀ (xs : List (Data × Data)), Asc xs → (∀ p ∈ xs, ∃ m, p.2 = .Map m) →
      policyEntry P xs = some (tokensUnder P xs)
  | [], _, _ => rfl
  | (.B k, v) :: rest, ⟨hlater, hasc⟩, hmaps => by
    obtain ⟨m, hm⟩ := hmaps (.B k, v) (by simp)
    dsimp only at hm
    subst hm
    simp only [policyEntry, tokensUnder]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString P k with
    | true =>
      cases heq : PlutusCore.ByteString.equalsByteString P k with
      | true =>
        have := bytes_eq_true.1 heq
        subst this
        simp
      | false =>
        have hne : P ≠ k := fun he => by simp [he, PlutusCore.ByteString.equalsByteString] at heq
        have hk : (Data.B k ≠ Data.B P) := fun he => hne (Data.B.inj he).symm
        simp only [if_true, if_false, hk, Bool.false_eq_true]
        rw [tokensUnder_absent P rest (later_ne hlater (bytes_le_true hle))]
    | false =>
      have hlt := bytes_le_false hle
      have hk : (Data.B k ≠ Data.B P) := fun he => by injection he with he; subst he; exact bytes_lt_irrefl _ hlt
      simp only [if_false, hk]
      exact policyEntry_asc P rest hasc (fun p hp => hmaps p (by simp [hp]))
  | (.Constr _ _, _) :: _, h, _ => h.elim
  | (.Map _, _) :: _, h, _ => h.elim
  | (.List _, _) :: _, h, _ => h.elim
  | (.I _, _) :: _, h, _ => h.elim

/-- The name search on a sorted map of integers is the ledger's `find_token`. -/
theorem nameEntry_asc (N : ByteString) :
    ∀ (xs : List (Data × Data)), Asc xs → (∀ p ∈ xs, ∃ i, p.2 = .I i) →
      nameEntry N xs = some (CardanoLedgerApi.V1.Value.valueOf.find_token N xs)
  | [], _, _ => rfl
  | (.B k, v) :: rest, ⟨hlater, hasc⟩, hints => by
    obtain ⟨i, hi⟩ := hints (.B k, v) (by simp)
    dsimp only at hi
    subst hi
    simp only [nameEntry, CardanoLedgerApi.V1.Value.valueOf.find_token]
    cases hle : PlutusCore.ByteString.lessThanEqualsByteString N k with
    | true =>
      cases heq : PlutusCore.ByteString.equalsByteString N k with
      | true =>
        have := bytes_eq_true.1 heq
        subst this
        simp
      | false =>
        have hne : N ≠ k := fun he => by simp [he, PlutusCore.ByteString.equalsByteString] at heq
        have hk : (Data.B N ≠ Data.B k) := fun he => hne (Data.B.inj he)
        simp only [if_true, if_false, hk, Bool.false_eq_true]
        rw [find_token_absent N rest (later_ne hlater (bytes_le_true hle))]
    | false =>
      have hlt := bytes_le_false hle
      have hk : (Data.B N ≠ Data.B k) := fun he => by injection he with he; subst he; exact bytes_lt_irrefl _ hlt
      simp only [if_false, hk]
      exact nameEntry_asc N rest hasc (fun p hp => hints p (by simp [hp]))
  | (.Constr _ _, _) :: _, h, _ => h.elim
  | (.Map _, _) :: _, h, _ => h.elim
  | (.List _, _) :: _, h, _ => h.elim
  | (.I _, _) :: _, h, _ => h.elim

/-- The ledger's `valueOf` on a map of maps: the name's quantity among the policy's tokens. -/
theorem visit_eq (P N : ByteString) :
    ∀ (xs : List (Data × Data)), (∀ p ∈ xs, ∃ m, p.2 = .Map m) →
      CardanoLedgerApi.V1.Value.valueOf.visit P N xs =
        CardanoLedgerApi.V1.Value.valueOf.find_token N (tokensUnder P xs)
  | [], _ => rfl
  | (k, v) :: rest, hmaps => by
    obtain ⟨m, hm⟩ := hmaps (k, v) (by simp)
    dsimp only at hm
    subst hm
    simp only [CardanoLedgerApi.V1.Value.valueOf.visit, tokensUnder]
    by_cases hk : k = .B P
    · subst hk; simp
    · have hk' : (Data.B P == k) = false := by
        simp only [beq_eq_false_iff_ne]; exact fun he => hk he.symm
      simp only [hk', hk, if_false, Bool.false_eq_true]
      exact visit_eq P N rest (fun p hp => hmaps p (by simp [hp]))

/-! ### Values the ledger accepts -/

/-- A value as the ledger keeps one: policies sorted, each a sorted map of integer quantities. -/
def ValueShape (v : List (Data × Data)) : Prop :=
  Asc v ∧ ∀ p ∈ v, ∃ m, p.2 = .Map m ∧ Asc m ∧ ∀ q ∈ m, ∃ i, q.2 = .I i

theorem valid_tokens : ∀ (xs : List (Data × Data)) (prev : ByteString),
    CardanoLedgerApi.V1.Contexts.validTxOutValue.validTokens xs prev = true →
      Asc xs ∧ (∀ p ∈ xs, ∀ k, p.1 = .B k → prev < k) ∧ ∀ p ∈ xs, ∃ i, p.2 = .I i
  | [], _, _ => ⟨trivial, by simp, by simp⟩
  | (a, b) :: xs, prev, h => by
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validTokens] at h; done)
    simp only [CardanoLedgerApi.V1.Contexts.validTxOutValue.validTokens, Bool.and_eq_true,
      decide_eq_true_eq] at h
    obtain ⟨hasc, hlater, hints⟩ := valid_tokens xs tn h.2
    refine ⟨⟨hlater, hasc⟩, ?_, ?_⟩
    · intro p hp k hk
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · cases hk; exact h.1.1
      · exact bytes_lt_trans h.1.1 (hlater p hp k hk)
    · intro p hp
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · exact ⟨n, rfl⟩
      · exact hints p hp

theorem valid_policies : ∀ (xs : List (Data × Data)) (prev : ByteString),
    CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol xs prev = true →
      ValueShape xs ∧ ∀ p ∈ xs, ∀ k, p.1 = .B k → prev < k
  | [], _, _ => ⟨⟨trivial, by simp⟩, by simp⟩
  | (a, b) :: xs, prev, h => by
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;>
      try (simp [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol] at h; done)
    simp only [CardanoLedgerApi.V1.Contexts.validTxOutValue.validCurrencySymbol, Bool.and_eq_true,
      decide_eq_true_eq] at h
    obtain ⟨⟨⟨hlt, _⟩, htok⟩, hrest⟩ := h
    obtain ⟨⟨hasc, hmaps⟩, hlater⟩ := valid_policies xs cs hrest
    obtain ⟨tasc, tlater, tints⟩ := valid_tokens tokens tn htok
    refine ⟨⟨⟨hlater, hasc⟩, ?_⟩, ?_⟩
    · intro p hp
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · refine ⟨_, rfl, ⟨tlater, tasc⟩, ?_⟩
        intro q hq
        simp only [List.mem_cons] at hq
        rcases hq with rfl | hq
        · exact ⟨n, rfl⟩
        · exact tints q hq
      · exact hmaps p hp
    · intro p hp k hk
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · cases hk; exact hlt
      · exact bytes_lt_trans hlt (hlater p hp k hk)

/-- Every output value the ledger accepts (`validTxOutValue`: ADA first, then sorted policies
of sorted names) has the shape the searches need. -/
theorem valid_value_shape (v : CardanoLedgerApi.V1.Value)
    (h : CardanoLedgerApi.V1.Contexts.validTxOutValue v = true) : ValueShape v := by
  change List (Data × Data) at v
  unfold CardanoLedgerApi.V1.Contexts.validTxOutValue at h
  split at h
  next _ n xs' =>
    simp only [Bool.and_eq_true, decide_eq_true_eq] at h
    obtain ⟨⟨hasc, hmaps⟩, hlater⟩ := valid_policies xs' _ h.2
    refine ⟨⟨hlater, hasc⟩, ?_⟩
    intro p hp
    simp only [List.mem_cons] at hp
    rcases hp with rfl | hp
    · exact ⟨_, rfl, ⟨by simp, trivial⟩, by simp⟩
    · exact hmaps p hp
  next => contradiction

theorem valid_mint_tokens : ∀ (xs : List (Data × Data)) (prev : ByteString),
    CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens xs prev = true →
      Asc xs ∧ (∀ p ∈ xs, ∀ k, p.1 = .B k → prev < k) ∧ ∀ p ∈ xs, ∃ i, p.2 = .I i
  | [], _, _ => ⟨trivial, by simp, by simp⟩
  | (a, b) :: xs, prev, h => by
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens] at h; done)
    simp only [CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens, Bool.and_eq_true,
      decide_eq_true_eq] at h
    obtain ⟨hasc, hlater, hints⟩ := valid_mint_tokens xs tn h.2
    refine ⟨⟨hlater, hasc⟩, ?_, ?_⟩
    · intro p hp k hk
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · cases hk; exact h.1.1
      · exact bytes_lt_trans h.1.1 (hlater p hp k hk)
    · intro p hp
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · exact ⟨n, rfl⟩
      · exact hints p hp

theorem valid_mint_policies : ∀ (xs : List (Data × Data)) (prev : ByteString),
    CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol xs prev = true →
      ValueShape xs ∧ ∀ p ∈ xs, ∀ k, p.1 = .B k → prev < k
  | [], _, _ => ⟨⟨trivial, by simp⟩, by simp⟩
  | (a, b) :: xs, prev, h => by
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;>
      try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
    simp only [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol, Bool.and_eq_true,
      decide_eq_true_eq] at h
    obtain ⟨⟨⟨hlt, _⟩, htok⟩, hrest⟩ := h
    obtain ⟨⟨hasc, hmaps⟩, hlater⟩ := valid_mint_policies xs cs hrest
    obtain ⟨tasc, tlater, tints⟩ := valid_mint_tokens tokens tn htok
    refine ⟨⟨⟨hlater, hasc⟩, ?_⟩, ?_⟩
    · intro p hp
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · refine ⟨_, rfl, ⟨tlater, tasc⟩, ?_⟩
        intro q hq
        simp only [List.mem_cons] at hq
        rcases hq with rfl | hq
        · exact ⟨n, rfl⟩
        · exact tints q hq
      · exact hmaps p hp
    · intro p hp k hk
      simp only [List.mem_cons] at hp
      rcases hp with rfl | hp
      · cases hk; exact hlt
      · exact bytes_lt_trans hlt (hlater p hp k hk)

/-- Every mint the ledger accepts (V3's `validMintValue`: sorted policies of sorted, nonzero
quantities) has the same shape. -/
theorem valid_mint_shape (v : MintValue)
    (h : CardanoLedgerApi.V3.Contexts.validMintValue v = true) : ValueShape v :=
  (valid_mint_policies v _ h).1

theorem tokensUnder_shape (P : ByteString) :
    ∀ (v : List (Data × Data)), ValueShape v →
      Asc (tokensUnder P v) ∧ ∀ q ∈ tokensUnder P v, ∃ i, q.2 = .I i
  | [], _ => ⟨trivial, by simp [tokensUnder]⟩
  | (k, b) :: rest, ⟨hasc, hmaps⟩ => by
    obtain ⟨m, hm, masc, mints⟩ := hmaps (k, b) (by simp)
    dsimp only at hm
    subst hm
    simp only [tokensUnder]
    split
    · exact ⟨masc, mints⟩
    · have hasc' : Asc rest := by
        rcases k with ⟨_, _⟩ | _ | _ | _ | _ <;> first | exact hasc.elim | exact hasc.2
      exact tokensUnder_shape P rest ⟨hasc', fun p hp => hmaps p (by simp [hp])⟩

/-- On a value of that shape, the policy search is `tokensUnder`. -/
theorem policy_search (P : ByteString) (v : List (Data × Data)) (hv : ValueShape v) :
    policyEntry P v = some (tokensUnder P v) :=
  policyEntry_asc P v hv.1 (fun p hp => (hv.2 p hp).imp fun _ h => h.1)

/-- On a value of that shape, the name search after the policy search is the ledger's
`valueOf`. -/
theorem name_search (P N : ByteString) (v : CardanoLedgerApi.V1.Value) (hv : ValueShape v) :
    nameEntry N (tokensUnder P v) = some (CardanoLedgerApi.V1.Value.valueOf P N v) := by
  obtain ⟨tasc, tints⟩ := tokensUnder_shape P v hv
  rw [nameEntry_asc N _ tasc tints]
  change _ = some (CardanoLedgerApi.V1.Value.valueOf.visit P N v)
  rw [visit_eq P N v (fun p hp => (hv.2 p hp).imp fun _ h => h.1)]

/-- one_shot_mint's searches are mix_logic's. -/
theorem tokensOf_eq (P : ByteString) : ∀ v, tokensOf P v = policyEntry P v
  | [] => rfl
  | (k, v) :: rest => by
    simp only [tokensOf, policyEntry]
    rcases k with _ | _ | _ | _ | kb <;> try rfl
    rw [tokensOf_eq P rest]
    try rfl

theorem qtyOf_eq (N : ByteString) : ∀ v, qtyOf N v = nameEntry N v
  | [] => rfl
  | (k, v) :: rest => by
    simp only [qtyOf, nameEntry]
    rcases k with _ | _ | _ | _ | kb <;> try rfl
    rw [qtyOf_eq N rest]
    try rfl

end Lovejoin.Every.Readable
