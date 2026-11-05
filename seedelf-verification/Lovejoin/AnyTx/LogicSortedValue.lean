import Lovejoin.AnyTx.LogicValueOf

/-! Ordering consequences of the ledger model's output-value validity predicate. -/
namespace Lovejoin.AnyTx.LogicSortedValue
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V1.Contexts.validTxOutValue (validTokens validCurrencySymbol)

private theorem byte_lt_trans {a b c : ByteString} (hab : a < b) (hbc : b < c) : a < c := by
  change a.data < c.data
  exact String.lt_trans hab hbc

/-- Every token in a valid tail is strictly later than the preceding name. -/
theorem valid_tokens_later (xs : List (Data × Data)) (prev key : ByteString) (value : Data)
    (h : validTokens xs prev = true) (hm : ((.B key, value) : Data × Data) ∈ xs) : prev < key := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | qty | _ <;> try (simp [validTokens] at h; done)
    simp only [validTokens, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq] at hm
    rcases hm with ⟨he, _⟩ | hm
    · subst key
      exact h.1.1
    · exact byte_lt_trans h.1.1 (ih tn h.2 hm)

/-- Every policy in a valid tail is strictly later than the preceding policy. -/
theorem valid_policies_later (xs : List (Data × Data)) (prev key : ByteString) (value : Data)
    (h : validCurrencySymbol xs prev = true) (hm : ((.B key, value) : Data × Data) ∈ xs) : prev < key := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq] at hm
    rcases hm with ⟨he, _⟩ | hm
    · subst key
      exact h.1.1.1
    · exact byte_lt_trans h.1.1.1 (ih cs h.2 hm)

/-- In a valid token tail, lookup returns the quantity of any matching entry. -/
theorem valid_tokens_find (xs : List (Data × Data)) (prev key : ByteString) (qty : Integer)
    (h : validTokens xs prev = true) (hm : ((.B key, .I qty) : Data × Data) ∈ xs) :
    CardanoLedgerApi.V1.Value.valueOf.find_token key xs = qty := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validTokens] at h; done)
    simp only [validTokens, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.I.injEq] at hm
    by_cases hk : key = tn
    · subst tn
      rcases hm with ⟨_, rfl⟩ | hm
      · simp [CardanoLedgerApi.V1.Value.valueOf.find_token]
      · have hlt := valid_tokens_later xs key key (.I qty) h.2 hm
        exact False.elim ((PlutusCore.ByteString.ByteString.lt_irrefl key) hlt)
    · have ht : ((.B key, .I qty) : Data × Data) ∈ xs := by
        rcases hm with ⟨he, _⟩ | hm
        · exact False.elim (hk he)
        · exact hm
      simpa [CardanoLedgerApi.V1.Value.valueOf.find_token, hk] using ih tn h.2 ht

/-- A valid policy's complete token map returns the quantity of a matching entry. -/
theorem valid_names_find (first : ByteString) (firstQty : Integer) (tail : List (Data × Data))
    (name : ByteString) (qty : Integer) (h : validTokens tail first = true)
    (hm : ((.B name, .I qty) : Data × Data) ∈ (.B first, .I firstQty) :: tail) :
    CardanoLedgerApi.V1.Value.valueOf.find_token name ((.B first, .I firstQty) :: tail) = qty := by
  simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.I.injEq] at hm
  by_cases hk : name = first
  · subst first
    rcases hm with ⟨_, rfl⟩ | hm
    · simp [CardanoLedgerApi.V1.Value.valueOf.find_token]
    · have hlt := valid_tokens_later tail name name (.I qty) h hm
      exact False.elim ((PlutusCore.ByteString.ByteString.lt_irrefl name) hlt)
  · have ht : ((.B name, .I qty) : Data × Data) ∈ tail := by
      rcases hm with ⟨he, _⟩ | hm
      · exact False.elim (hk he)
      · exact hm
    simpa [CardanoLedgerApi.V1.Value.valueOf.find_token, hk] using valid_tokens_find tail first name qty h ht

/-- In a valid policy tail, ledger valueOf returns a matching NFT quantity. -/
theorem valid_policies_find (xs : List (Data × Data)) (prev P name : ByteString)
    (names : List (Data × Data)) (qty : Integer)
    (h : validCurrencySymbol xs prev = true)
    (hp : ((.B P, .Map names) : Data × Data) ∈ xs)
    (hn : ((.B name, .I qty) : Data × Data) ∈ names) :
    CardanoLedgerApi.V1.Value.valueOf.visit P name xs = qty := by
  induction xs generalizing prev with
  | nil => simp at hp
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.Map.injEq] at hp
    by_cases hk : P = cs
    · subst cs
      rcases hp with ⟨_, hnames⟩ | hp
      · subst names
        simpa [CardanoLedgerApi.V1.Value.valueOf.visit] using valid_names_find tn n tokens name qty h.1.2 hn
      · have hlt := valid_policies_later xs P P (.Map names) h.2 hp
        exact False.elim ((PlutusCore.ByteString.ByteString.lt_irrefl P) hlt)
    · have ht : ((.B P, .Map names) : Data × Data) ∈ xs := by
        rcases hp with ⟨he, _⟩ | hp
        · exact False.elim (hk he)
        · exact hp
      simpa [CardanoLedgerApi.V1.Value.valueOf.visit, hk] using ih cs h.2 ht

/-- A byte-keyed policy head followed by a valid tail preserves valueOf membership. -/
theorem valid_policy_head_find (first firstName : ByteString) (firstQty : Integer)
    (tokens policies : List (Data × Data)) (P name : ByteString) (names : List (Data × Data)) (qty : Integer)
    (hTokens : validTokens tokens firstName = true) (hPolicies : validCurrencySymbol policies first = true)
    (hp : ((.B P, .Map names) : Data × Data) ∈ (.B first, .Map ((.B firstName, .I firstQty) :: tokens)) :: policies)
    (hn : ((.B name, .I qty) : Data × Data) ∈ names) :
    CardanoLedgerApi.V1.Value.valueOf P name ((.B first, .Map ((.B firstName, .I firstQty) :: tokens)) :: policies) = qty := by
  simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.Map.injEq] at hp
  by_cases hk : P = first
  · subst first
    rcases hp with ⟨_, hnames⟩ | hp
    · subst names
      simpa [CardanoLedgerApi.V1.Value.valueOf, CardanoLedgerApi.V1.Value.valueOf.visit] using
        valid_names_find firstName firstQty tokens name qty hTokens hn
    · have hlt := valid_policies_later policies P P (.Map names) hPolicies hp
      exact False.elim ((PlutusCore.ByteString.ByteString.lt_irrefl P) hlt)
  · have ht : ((.B P, .Map names) : Data × Data) ∈ policies := by
      rcases hp with ⟨he, _⟩ | hp
      · exact False.elim (hk he)
      · exact hp
    simpa [CardanoLedgerApi.V1.Value.valueOf, CardanoLedgerApi.V1.Value.valueOf.visit, hk] using
      valid_policies_find policies first P name names qty hPolicies ht hn

/-- In every valid output value, an NFT entry determines valueOf exactly. -/
theorem valid_output_membership_value_of (v : CardanoLedgerApi.V1.Value) (P name : ByteString)
    (names : List (Data × Data)) (qty : Integer)
    (h : CardanoLedgerApi.V1.Contexts.validTxOutValue v = true)
    (hp : ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from v))
    (hn : ((.B name, .I qty) : Data × Data) ∈ names) :
    CardanoLedgerApi.V1.Value.valueOf P name v = qty := by
  simp only [CardanoLedgerApi.V1.Contexts.validTxOutValue] at h
  split at h
  next _ qtyAda tail =>
    simp only [Bool.and_eq_true] at h
    exact valid_policy_head_find "" "" qtyAda [] tail P name names qty rfl h.2 hp hn
  next => contradiction

/-- A valid token tail contains only byte-name/integer entries. -/
theorem valid_token_member_shape (xs : List (Data × Data)) (prev : ByteString)
    (h : validTokens xs prev = true) (item : Data × Data) (hm : item ∈ xs) :
    ∃ key : ByteString, ∃ qty : Integer, item = (.B key, .I qty) := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validTokens] at h; done)
    simp only [validTokens, Bool.and_eq_true] at h
    simp only [List.mem_cons] at hm
    rcases hm with rfl | hm
    · exact ⟨tn, n, rfl⟩
    · exact ih tn h.2 hm

/-- A valid policy tail contains only byte-policy/map entries. -/
theorem valid_policy_member_shape (xs : List (Data × Data)) (prev : ByteString)
    (h : validCurrencySymbol xs prev = true) (item : Data × Data) (hm : item ∈ xs) :
    ∃ key : ByteString, ∃ names : List (Data × Data), item = (.B key, .Map names) := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true] at h
    simp only [List.mem_cons] at hm
    rcases hm with rfl | hm
    · exact ⟨cs, (.B tn, .I n) :: tokens, rfl⟩
    · exact ih cs h.2 hm

/-- Strict order for byte-keyed encoded map entries. -/
def keyLt (a b : Data × Data) : Prop :=
  ∃ ka kb : ByteString, a.1 = .B ka ∧ b.1 = .B kb ∧ ka < kb

/-- The validity predicate implies pairwise sorted token keys. -/
theorem valid_tokens_pairwise (xs : List (Data × Data)) (prev : ByteString)
    (h : validTokens xs prev = true) : xs.Pairwise keyLt := by
  induction xs generalizing prev with
  | nil => exact .nil
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validTokens] at h; done)
    rcases b with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validTokens] at h; done)
    simp only [validTokens, Bool.and_eq_true] at h
    apply List.Pairwise.cons
    · intro item hm
      obtain ⟨key, qty, rfl⟩ := valid_token_member_shape xs tn h.2 item hm
      exact ⟨tn, key, rfl, rfl, valid_tokens_later xs tn key (.I qty) h.2 hm⟩
    · exact ih tn h.2

/-- The validity predicate implies pairwise sorted policy keys. -/
theorem valid_policies_pairwise (xs : List (Data × Data)) (prev : ByteString)
    (h : validCurrencySymbol xs prev = true) : xs.Pairwise keyLt := by
  induction xs generalizing prev with
  | nil => exact .nil
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true] at h
    apply List.Pairwise.cons
    · intro item hm
      obtain ⟨key, names, rfl⟩ := valid_policy_member_shape xs cs h.2 item hm
      exact ⟨cs, key, rfl, rfl, valid_policies_later xs cs key (.Map names) h.2 hm⟩
    · exact ih cs h.2

/-- A valid name map is pairwise sorted including its first element. -/
theorem valid_names_pairwise (first : ByteString) (qty : Integer) (tail : List (Data × Data))
    (h : validTokens tail first = true) : ((.B first, .I qty) :: tail).Pairwise keyLt := by
  apply List.Pairwise.cons
  · intro item hm
    obtain ⟨key, value, rfl⟩ := valid_token_member_shape tail first h item hm
    exact ⟨first, key, rfl, rfl, valid_tokens_later tail first key (.I value) h hm⟩
  · exact valid_tokens_pairwise tail first h

/-- Every policy entry in a valid policy tail has a pairwise sorted name map. -/
theorem valid_policy_member_names_pairwise (xs : List (Data × Data)) (prev P : ByteString)
    (names : List (Data × Data)) (h : validCurrencySymbol xs prev = true)
    (hm : ((.B P, .Map names) : Data × Data) ∈ xs) : names.Pairwise keyLt := by
  induction xs generalizing prev with
  | nil => simp at hm
  | cons entry xs ih =>
    obtain ⟨a, b⟩ := entry
    rcases a with ⟨_, _⟩ | _ | _ | _ | cs <;> try (simp [validCurrencySymbol] at h; done)
    rcases b with ⟨_, _⟩ | m | _ | _ | _ <;> try (simp [validCurrencySymbol] at h; done)
    rcases m with _ | ⟨⟨c, e⟩, tokens⟩
    · simp [validCurrencySymbol] at h
    rcases c with ⟨_, _⟩ | _ | _ | _ | tn <;> try (simp [validCurrencySymbol] at h; done)
    rcases e with ⟨_, _⟩ | _ | _ | n | _ <;> try (simp [validCurrencySymbol] at h; done)
    simp only [validCurrencySymbol, Bool.and_eq_true] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.Map.injEq] at hm
    rcases hm with ⟨_, rfl⟩ | hm
    · exact valid_names_pairwise tn n tokens h.1.2
    · exact ih cs h.2 hm

/-- A ledger-valid output value has pairwise sorted policy keys. -/
theorem valid_output_policies_pairwise (v : CardanoLedgerApi.V1.Value)
    (h : CardanoLedgerApi.V1.Contexts.validTxOutValue v = true) :
    (show List (Data × Data) from v).Pairwise keyLt := by
  simp only [CardanoLedgerApi.V1.Contexts.validTxOutValue] at h
  split at h
  next _ qty tail =>
    simp only [Bool.and_eq_true] at h
    apply List.Pairwise.cons
    · intro item hm
      obtain ⟨key, names, rfl⟩ := valid_policy_member_shape tail "" h.2 item hm
      exact ⟨"", key, rfl, rfl, valid_policies_later tail "" key (.Map names) h.2 hm⟩
    · exact valid_policies_pairwise tail "" h.2
  next => contradiction

/-- Every policy's name map in a ledger-valid output is pairwise sorted. -/
theorem valid_output_names_pairwise (v : CardanoLedgerApi.V1.Value) (P : ByteString)
    (names : List (Data × Data)) (h : CardanoLedgerApi.V1.Contexts.validTxOutValue v = true)
    (hm : ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from v)) : names.Pairwise keyLt := by
  simp only [CardanoLedgerApi.V1.Contexts.validTxOutValue] at h
  split at h
  next _ qty tail =>
    simp only [Bool.and_eq_true] at h
    simp only [List.mem_cons, Prod.mk.injEq, Data.B.injEq, Data.Map.injEq] at hm
    rcases hm with ⟨_, rfl⟩ | hm
    · exact valid_names_pairwise "" qty [] rfl
    · exact valid_policy_member_names_pairwise tail "" P names h.2 hm
  next => contradiction

/-- In a strictly sorted encoded map, if the compiled search stops at a key
at or after the target, a distinct target cannot occur later in the map. -/
theorem stop_excludes_later_target (before tail : List (Data × Data))
    (target stop : ByteString) (stopValue targetValue : Data)
    (hSorted : (before ++ (.B stop, stopValue) :: tail).Pairwise keyLt)
    (hStop : PlutusCore.ByteString.lessThanEqualsByteString target stop = true) :
    ((.B target, targetValue) : Data × Data) ∉ tail := by
  intro hm
  have hSuffix := (List.pairwise_append.mp hSorted).2.1
  have hRel : keyLt (.B stop, stopValue) (.B target, targetValue) :=
    (List.pairwise_cons.mp hSuffix).1 _ hm
  obtain ⟨a, b, ha, hb, hab⟩ := hRel
  dsimp only at ha hb
  cases ha
  cases hb
  have hNot : ¬ target.data ≤ stop.data := String.not_le.mpr hab
  have hLe : target.data ≤ stop.data := by
    change decide (target.data ≤ stop.data) = true at hStop
    exact of_decide_eq_true hStop
  exact hNot hLe

/-- On a sorted byte-keyed map, a present key is reached by the compiled
ordered search after a prefix of earlier keys. -/
theorem sorted_search_finds_member (target : ByteString) (value : Data) (xs : List (ByteString × Data))
    (hSorted : (Lovejoin.AnyTx.LogicNameLookup.namePairs xs).Pairwise keyLt)
    (hMember : ((.B target, value) : Data × Data) ∈ Lovejoin.AnyTx.LogicNameLookup.namePairs xs) :
    ∃ before tail, xs = before ++ (target, value) :: tail ∧
      ∀ p ∈ before, PlutusCore.ByteString.lessThanEqualsByteString target p.1 = false := by
  obtain ⟨before, after, he, hb, hs⟩ := Lovejoin.AnyTx.LogicLedgerValueCover.search_cut target xs
  have hNotBefore : ((.B target, value) : Data × Data) ∉ Lovejoin.AnyTx.LogicNameLookup.namePairs before := by
    intro hm
    obtain ⟨⟨key, v⟩, hi, hv⟩ := List.mem_map.mp hm
    have hk : key = target := Data.B.inj (Prod.mk.inj hv).1
    subst key
    have hrefl : PlutusCore.ByteString.lessThanEqualsByteString target target = true := by
      change decide (target.data ≤ target.data) = true
      simp [String.le_refl]
    have hfalse := hb (target, v) hi
    rw [hrefl] at hfalse
    contradiction
  rcases hs with hnil | ⟨key, stopValue, tail, hafter, hstop⟩
  · subst after
    have hmap : Lovejoin.AnyTx.LogicNameLookup.namePairs xs = Lovejoin.AnyTx.LogicNameLookup.namePairs before := by
      simp [he, Lovejoin.AnyTx.LogicNameLookup.namePairs]
    rw [hmap] at hMember
    exact False.elim (hNotBefore hMember)
  · subst after
    have hmap : Lovejoin.AnyTx.LogicNameLookup.namePairs xs =
        Lovejoin.AnyTx.LogicNameLookup.namePairs before ++ (.B key, stopValue) ::
          Lovejoin.AnyTx.LogicNameLookup.namePairs tail := by
      simp [he, Lovejoin.AnyTx.LogicNameLookup.namePairs, List.map_append]
    rw [hmap] at hSorted hMember
    have hNoTail := stop_excludes_later_target (Lovejoin.AnyTx.LogicNameLookup.namePairs before)
      (Lovejoin.AnyTx.LogicNameLookup.namePairs tail) target key stopValue value hSorted hstop
    simp only [List.mem_append, List.mem_cons, Prod.mk.injEq, Data.B.injEq] at hMember
    rcases hMember with hpre | ⟨hkey, hvalue⟩ | htail
    · exact False.elim (hNotBefore hpre)
    · subst key
      subst stopValue
      exact ⟨before, tail, he, hb⟩
    · exact False.elim (hNoTail htail)

/-- A target NFT entry in a valid output is reached by both ordered searches,
after arbitrary earlier policies and names. -/
theorem valid_nft_search_shape (v : CardanoLedgerApi.V1.Value) (P name : ByteString)
    (names : List (Data × Data))
    (hValid : CardanoLedgerApi.V1.Contexts.validTxOutValue v = true)
    (hPolicy : ((.B P, .Map names) : Data × Data) ∈ (show List (Data × Data) from v))
    (hName : ((.B name, .I 1) : Data × Data) ∈ names) :
    ∃ beforePolicies beforeNames : List (ByteString × Data), ∃ afterPolicies afterNames : List (Data × Data),
      (show List (Data × Data) from v) = Lovejoin.AnyTx.LogicPolicyLookup.policyPairs beforePolicies ++
        (.B P, .Map (Lovejoin.AnyTx.LogicNameLookup.namePairs beforeNames ++ (.B name, .I 1) :: afterNames)) :: afterPolicies ∧
      (∀ p ∈ beforePolicies, PlutusCore.ByteString.lessThanEqualsByteString P p.1 = false) ∧
      (∀ p ∈ beforeNames, PlutusCore.ByteString.lessThanEqualsByteString name p.1 = false) := by
  obtain ⟨lines, hv⟩ := Lovejoin.AnyTx.LogicLedgerValueCover.valid_output_value_shape v hValid
  have hMap : Lovejoin.AnyTx.LogicNameLookup.namePairs (Lovejoin.AnyTx.LogicLedgerValueCover.policyBefore lines) =
      (show List (Data × Data) from v) := by
    rw [hv]
    simp [Lovejoin.AnyTx.LogicNameLookup.namePairs, Lovejoin.AnyTx.LogicLedgerValueCover.policyBefore,
      Lovejoin.AnyTx.LogicLedgerValueCover.policyData, List.map_map, Function.comp_def]
  have hPolicyOriginal := hPolicy
  have hSort := valid_output_policies_pairwise v hValid
  rw [← hMap] at hSort hPolicy
  obtain ⟨beforeP, afterP, hSplitP, hBeforeP⟩ :=
    sorted_search_finds_member P (.Map names) _ hSort hPolicy
  have hNamesShape : ∃ tokens : List (ByteString × Integer), names = Lovejoin.AnyTx.LogicLedgerValueCover.tokenData tokens := by
    have hPolicyInLines : ((.B P, .Map names) : Data × Data) ∈
        Lovejoin.AnyTx.LogicLedgerValueCover.policyData lines := by simpa [hv] using hPolicyOriginal
    obtain ⟨⟨key, tokens⟩, _, hEq⟩ := List.mem_map.mp hPolicyInLines
    exact ⟨tokens, (Data.Map.inj (Prod.mk.inj hEq).2).symm⟩
  obtain ⟨tokens, ht⟩ := hNamesShape
  have hNamesMap : Lovejoin.AnyTx.LogicNameLookup.namePairs (Lovejoin.AnyTx.LogicLedgerValueCover.nameBefore tokens) = names := by
    rw [ht]
    simp [Lovejoin.AnyTx.LogicNameLookup.namePairs, Lovejoin.AnyTx.LogicLedgerValueCover.nameBefore,
      Lovejoin.AnyTx.LogicLedgerValueCover.tokenData, List.map_map, Function.comp_def]
  have hNamesSort : names.Pairwise keyLt := valid_output_names_pairwise v P names hValid hPolicyOriginal
  rw [← hNamesMap] at hNamesSort hName
  obtain ⟨beforeN, afterN, hSplitN, hBeforeN⟩ :=
    sorted_search_finds_member name (.I 1) _ hNamesSort hName
  refine ⟨beforeP, beforeN, Lovejoin.AnyTx.LogicNameLookup.namePairs afterP,
    Lovejoin.AnyTx.LogicNameLookup.namePairs afterN, ?_, hBeforeP, hBeforeN⟩
  rw [← hMap, hSplitP]
  simp only [Lovejoin.AnyTx.LogicNameLookup.namePairs, Lovejoin.AnyTx.LogicPolicyLookup.policyPairs, List.map_append, List.map_cons]
  rw [← hNamesMap, hSplitN]
  simp [Lovejoin.AnyTx.LogicNameLookup.namePairs, List.map_append]

end Lovejoin.AnyTx.LogicSortedValue

#print axioms Lovejoin.AnyTx.LogicSortedValue.valid_output_membership_value_of

#print axioms Lovejoin.AnyTx.LogicSortedValue.valid_output_names_pairwise

#print axioms Lovejoin.AnyTx.LogicSortedValue.stop_excludes_later_target

#print axioms Lovejoin.AnyTx.LogicSortedValue.sorted_search_finds_member

#print axioms Lovejoin.AnyTx.LogicSortedValue.valid_nft_search_shape
