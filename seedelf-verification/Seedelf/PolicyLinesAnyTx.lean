import Seedelf.PolicyAnyTxSteps
import Blaster

/-! Mints of other than one line, in every transaction: no lines, two and three. Both of the
policy's blocks flatten the mint (`assets.flatten`) and expect exactly one line, and `xor`
evaluates the burn block first (`aiken uplc decode`; PolicyAnyTxSteps checks it by step count).
With no lines its `headList` fails, and with two or more its `chooseList` on the rest does, so
the run reaches `Error` before the mint block reads the inputs. Of the TxInfo, the burn block
reads only the mint.

So here every policy id, name and amount is symbolic; the policy id the policy runs as, the
redeemer, the signatories and the inputs are any; and every other field is any `Data`
(`TxRest.withMint`). Only the layout the policy walks is fixed: how many policies, with how many
names each. Each builder writes its layout's mint out, beside an `example` that it is that
`mintOf`, and is named after its layout, its policies' name counts in order: `polLines21Args`
is a policy with two names, then a policy with one. The layouts are the compositions of 2 and of
3, every one (`compositions`). The ledger's V3 mint is a map of policies, each with at least one
`(B name, I amount)` (CardanoLedgerApiBlaster's `validMintValue`; Conway's
`{+ policy_id => {+ asset_name => nonZeroInt64}}`), so every mint of n lines is the `mintOf` of
one composition of n, and every minting context is `mintIn` of `withMint` of such a mint
(`minting_context_layout`, below, kernel-checked). Four lines are PolicyLinesFourAnyTx and five
PolicyLinesFiveAnyTx; six and more aren't proved, since the ledger bounds a mint's lines only by
the transaction's size and budget. One line is the policy's rule itself (Slice/).

1500 steps, the policy's other modules' limit: the longest run here, three policies of one name
each, errors after 854 (PolicyAnyTxSteps). Each builder's own run at the limit, the honest mint
of PolicyAnyTxSteps with the further lines of `polLinesAs`, reaches `Error`; with one line, the
same transaction passes. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def polLines0Args (r : TxRest) (sigs inputs rd : Data) (own : ByteString) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own : ByteString) :
    polLines0Args r sigs inputs rd own =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [])) rd own)] := rfl

def polLines2Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 : ByteString) (a1 a2 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 : ByteString) (a1 a2 : Integer) :
    polLines2Args r sigs inputs rd own p1 n1 n2 a1 a2 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)])])) rd own)] := rfl

def polLines11Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 : ByteString) (a1 a2 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 : ByteString) (a1 a2 : Integer) :
    polLines11Args r sigs inputs rd own p1 n1 p2 n2 a1 a2 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)])])) rd own)] := rfl

def polLines3Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 : ByteString) (a1 a2 a3 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 : ByteString) (a1 a2 a3 : Integer) :
    polLines3Args r sigs inputs rd own p1 n1 n2 n3 a1 a2 a3 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3)])])) rd own)] := rfl

def polLines12Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 : ByteString) (a1 a2 a3 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 : ByteString) (a1 a2 a3 : Integer) :
    polLines12Args r sigs inputs rd own p1 n1 p2 n2 n3 a1 a2 a3 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3)])])) rd own)] := rfl

def polLines21Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 : ByteString) (a1 a2 a3 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 : ByteString) (a1 a2 a3 : Integer) :
    polLines21Args r sigs inputs rd own p1 n1 n2 p2 n3 a1 a2 a3 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3)])])) rd own)] := rfl

def polLines111Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 : ByteString) (a1 a2 a3 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 : ByteString) (a1 a2 a3 : Integer) :
    polLines111Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 a1 a2 a3 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3)])])) rd own)] := rfl

#prep_uplc appliedPolLines0 seedelf polLines0Args 1500
#prep_uplc appliedPolLines2 seedelf polLines2Args 1500
#prep_uplc appliedPolLines11 seedelf polLines11Args 1500
#prep_uplc appliedPolLines3 seedelf polLines3Args 1500
#prep_uplc appliedPolLines12 seedelf polLines12Args 1500
#prep_uplc appliedPolLines21 seedelf polLines21Args 1500
#prep_uplc appliedPolLines111 seedelf polLines111Args 1500

-- The layouts above, in order: no lines, then the compositions of 2 and of 3, each once.
#guard compositions 2 == [[2], [1, 1]] && compositions 3 == [[3], [1, 2], [2, 1], [1, 1, 1]]

-- Each builder's own run at its own limit (README rule 3), in PolicyAnyTxSteps' busy transaction:
-- the honest mint's line, then `polLinesAs`' further names and policies, reaches Error.
#guard endsInError (appliedPolLines0.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId)
#guard endsInError (appliedPolLines2.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" 1 1)
#guard endsInError (appliedPolLines11.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" 1 1)
#guard endsInError (appliedPolLines3.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" 1 1 1)
#guard endsInError (appliedPolLines12.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" 1 1 1)
#guard endsInError (appliedPolLines21.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" 1 1 1)
#guard endsInError (appliedPolLines111.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" 1 1 1)

theorem policy_fails_no_lines :
  ∀ r sigs inputs rd own,
    isUnsuccessful (appliedPolLines0.prop r sigs inputs rd own) := by blaster
theorem policy_fails_lines_2 :
  ∀ r sigs inputs rd own p1 n1 n2 a1 a2,
    isUnsuccessful (appliedPolLines2.prop r sigs inputs rd own p1 n1 n2 a1 a2) := by blaster
theorem policy_fails_lines_11 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 a1 a2,
    isUnsuccessful (appliedPolLines11.prop r sigs inputs rd own p1 n1 p2 n2 a1 a2) := by blaster
theorem policy_fails_lines_3 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 a1 a2 a3,
    isUnsuccessful (appliedPolLines3.prop r sigs inputs rd own p1 n1 n2 n3 a1 a2 a3) := by blaster
theorem policy_fails_lines_12 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 a1 a2 a3,
    isUnsuccessful (appliedPolLines12.prop r sigs inputs rd own p1 n1 p2 n2 n3 a1 a2 a3) := by blaster
theorem policy_fails_lines_21 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 a1 a2 a3,
    isUnsuccessful (appliedPolLines21.prop r sigs inputs rd own p1 n1 n2 p2 n3 a1 a2 a3) := by blaster
theorem policy_fails_lines_111 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 a1 a2 a3,
    isUnsuccessful (appliedPolLines111.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 a1 a2 a3) := by blaster

-- A negative control: one step short of its Error, after 854 steps (PolicyAnyTxSteps), the
-- longest run here is still going, and the same theorem over it comes back Falsified. So the
-- theorems above hold because the runs reach Error inside the limit.
#prep_uplc appliedPolLines111Cut seedelf polLines111Args 853
#guard stillRunning (appliedPolLines111Cut.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" 1 1 1)
#guard endsInError (cekExecuteProgram seedelf.script (polLines111Args busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" 1 1 1) 854)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 a1 a2 a3,
    isUnsuccessful (appliedPolLines111Cut.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 a1 a2 a3)]


/-! Every mint the ledger accepts has one of these layouts, or those of PolicyLinesFourAnyTx and
PolicyLinesFiveAnyTx, or one line, or more than five: CardanoLedgerApiBlaster's V3
`validMintValue`, its model of the ledger's rule for a mint, accepts only a map of policies,
each a `B` with at least one name, every name a `B` with an `I` amount. With PolicyAnyTx's
`mintIn_of_minting` and `TxRest.ofTxInfo_withMint`, every minting context whose mint it accepts
is `mintIn` of `withMint` of its other fields and such a mint. Kernel-checked, no blaster. -/

section Cover
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3

/-- A policy's names, when `validMintValue` accepts them: each a `B`, with an `I` amount. -/
theorem mint_names_of_valid (tns : List (Data × Data)) (prev : ByteString)
    (h : CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens tns prev = true) :
    ∃ ts : List (ByteString × Integer), tns = ts.map fun t => (.B t.1, .I t.2) := by
  induction tns generalizing prev with
  | nil => exact ⟨[], rfl⟩
  | cons x xs ih =>
    obtain ⟨a, b⟩ := x
    cases a <;> cases b <;> try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens] at h; done)
    simp [CardanoLedgerApi.V3.Contexts.validMintValue.validMintTokens] at h
    obtain ⟨ts, rfl⟩ := ih _ h.2
    exact ⟨(_, _) :: ts, rfl⟩

/-- A mint's policies, when `validMintValue` accepts them: each a `B`, with at least one name. -/
theorem mint_policies_of_valid (v : List (Data × Data)) (prev : ByteString)
    (h : CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol v prev = true) :
    ∃ lines : List (ByteString × List (ByteString × Integer)),
      v = lines.map (fun l => (.B l.1, .Map (l.2.map fun t => (.B t.1, .I t.2)))) ∧
        ∀ l ∈ lines, l.2 ≠ [] := by
  induction v generalizing prev with
  | nil => exact ⟨[], rfl, by simp⟩
  | cons x xs ih =>
    obtain ⟨a, b⟩ := x
    cases a <;> cases b <;> try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
    rename_i cs m
    cases m with
    | nil => simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h
    | cons y ys =>
      obtain ⟨c, d⟩ := y
      cases c <;> cases d <;> try (simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h; done)
      rename_i tn n
      simp [CardanoLedgerApi.V3.Contexts.validMintValue.validCurrencySymbol] at h
      obtain ⟨ts, rfl⟩ := mint_names_of_valid _ _ h.1.2
      obtain ⟨lines, rfl, hne⟩ := ih _ h.2
      refine ⟨(cs, (tn, n) :: ts) :: lines, rfl, ?_⟩
      simp only [List.forall_mem_cons]
      exact ⟨List.cons_ne_nil _ _, hne⟩

/-- Every mint the ledger accepts is `mintOf` of lines with at least one name under each policy:
its layout over policies is a composition of its number of lines. -/
theorem mint_layout_of_valid (v : CardanoLedgerApi.V3.Contexts.MintValue)
    (h : CardanoLedgerApi.V3.Contexts.validMintValue v = true) :
    ∃ lines : List (ByteString × List (ByteString × Integer)),
      IsData.toData v = mintOf lines ∧ ∀ l ∈ lines, l.2 ≠ [] := by
  obtain ⟨lines, hv, hne⟩ := mint_policies_of_valid v _ h
  exact ⟨lines, by subst hv; rfl, hne⟩

/-- So every minting context whose mint the ledger accepts is a `Policy…AnyTx` scenario: `mintIn`
of its TxInfo's other fields, its signatories, its inputs, and `mintOf` of such lines. -/
theorem minting_context_layout (tx : TxInfo) (rd : Data) (own : ByteString)
    (h : CardanoLedgerApi.V3.Contexts.validMintValue tx.txInfoMint = true) :
    ∃ lines : List (ByteString × List (ByteString × Integer)), (∀ l ∈ lines, l.2 ≠ []) ∧
      IsData.toData (⟨tx, rd, .MintingScript own⟩ : ScriptContext) =
        mintIn ((TxRest.ofTxInfo tx).withMint (IsData.toData tx.txInfoSignatories)
          (IsData.toData tx.txInfoInputs) (mintOf lines)) rd own := by
  obtain ⟨lines, hm, hne⟩ := mint_layout_of_valid tx.txInfoMint h
  exact ⟨lines, hne, by rw [mintIn_of_minting, TxRest.ofTxInfo_withMint, hm]⟩

-- Kernel-checked: no `blasterProven`, no `sorryAx`.
#print axioms minting_context_layout

end Cover

end Seedelf.V1
