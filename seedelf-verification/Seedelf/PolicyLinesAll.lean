import Seedelf.LinesAllLoops
import Seedelf.AnyTxSteps

/-! # Two lines or more fail, at every length

The Seedelf policy (84967d91…) flattens the mint and expects exactly one line: a second line in
the same transaction would be a second token, a duplicate-name hazard. Here every mint of two
lines or more fails, of any length (the chain's budget allows about 3,000 lines), with every
TxInfo field but the mint any `Data`, values the ledger never produces included, and any
signatories, inputs, redeemer and policy id.

How the bytes fail. The purpose is tested first, then the policy id and the redeemer are decoded:
a redeemer that isn't a `B` errors there. Then `xor` takes the burn block first, which flattens
the mint (LinesAllLoops, for every mint), takes the first line, and errors at
`chooseList (tailList …)` unless the rest is empty, all before the mint block runs. The inputs
are never read.

The proof runs the deployed bytes on PlutusCoreBlaster's CEK machine: `cekExecuteProgram`, whose
semantics is its `default`, the post-Conway V3 variant (`defaultFunSemanticsVariantE`) the chain
runs. LinesAllCek's evaluator steps through the program a node at a time, under any stack, and
LinesAllLoops' flatten lemma stands in for the loops. Kernel-checked: no Blaster, no `sorry`, no
`native_decide`, so these hold on Lean's kernel's word, not Z3's, and for every length, not
within a step limit. -/

namespace Seedelf.V1.LinesAll
open Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3 (TxInfo ScriptContext)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.Utils (isSuccessful isUnsuccessful)

/-! ## The flattened mint's shape -/

/-- The flattened mint has a line for each name. -/
theorem flatLines_length (lines : List (ByteString × List (ByteString × Integer))) :
    (flatLines lines).length = lineCount lines := by
  induction lines with
  | nil => rfl
  | cons l ls ih =>
    simp only [flatLines, List.length_append, List.length_map, ih, lineCount, List.map_cons,
      List.sum_cons]

/-- Each line is a list of three. -/
theorem mem_flatLines {d : Data} {lines : List (ByteString × List (ByteString × Integer))}
    (h : d ∈ flatLines lines) : ∃ a b c, d = .List [a, b, c] := by
  induction lines with
  | nil => cases h
  | cons l ls ih =>
    rw [flatLines, List.mem_append] at h
    rcases h with h | h
    · obtain ⟨t, _, rfl⟩ := List.mem_map.mp h
      exact ⟨_, _, _, rfl⟩
    · exact ih h

/-- A mint of two lines or more flattens to a list of three, then at least one more line. -/
theorem flatLines_shape (lines : List (ByteString × List (ByteString × Integer)))
    (h : 2 ≤ lineCount lines) :
    ∃ a b c y zs, flatLines lines = .List [a, b, c] :: y :: zs := by
  have hlen := flatLines_length lines
  have hmem : ∀ d ∈ flatLines lines, ∃ a b c, d = Data.List [a, b, c] :=
    fun _ hd => mem_flatLines hd
  generalize flatLines lines = L at hlen hmem ⊢
  match L, hlen, hmem with
  | x :: y :: zs, _, hmem =>
    obtain ⟨a, b, c, rfl⟩ := hmem x (by simp)
    exact ⟨a, b, c, y, zs, rfl⟩
  | [], hlen, _ => simp at hlen; omega
  | [_], hlen, _ => simp at hlen; omega

/-! ## The policy -/

set_option maxHeartbeats 0

/-- **Two lines or more fail.** Every transaction whose mint has two lines or more, of any
length, with any other TxInfo field, signatories, inputs, redeemer and policy id: the policy
reaches `Error`. -/
theorem policy_fails_two_or_more_lines :
    ∀ (r : TxRest) (sigs inputs redeemer : Data) (own : ByteString)
      (lines : List (ByteString × List (ByteString × Integer))),
      2 ≤ lineCount lines →
      ∃ n, cekExecuteProgram seedelf.script
        [toTerm (mintIn (r.withMint sigs inputs (mintOf lines)) redeemer own)] n = State.Error := by
  intro r sigs inputs redeemer own lines h2
  obtain ⟨a, b, c, y, zs, hflat⟩ := flatLines_shape lines h2
  -- The flatten lemma, with the flattened mint's first two lines written out.
  have hF : ∀ (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment),
      Ap default (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 ::
          builtinsEnv rest))
        (.VCon (.ConstPairDataList (pairsOf lines)))
        (some (.VCon (.ConstDataList (.List [a, b, c] :: y :: zs)))) := by
    intro a1 a2 a3 a4 a5 a6 a7 a8 a9 rest
    rw [← hflat]
    exact flatten_apply a1 a2 a3 a4 a5 a6 a7 a8 a9 rest lines
  apply exec_error_of_ev
  -- A redeemer other than a `B` errors before the mint is read; a `B` reaches the flatten.
  cases redeemer <;> cek_using [hF]

/-- No fuel makes it succeed: the run never halts, so it never returns a value. -/
theorem policy_never_succeeds_two_or_more_lines :
    ∀ (r : TxRest) (sigs inputs redeemer : Data) (own : ByteString)
      (lines : List (ByteString × List (ByteString × Integer))),
      2 ≤ lineCount lines → ∀ n,
      ¬ isSuccessful (cekExecuteProgram seedelf.script
        [toTerm (mintIn (r.withMint sigs inputs (mintOf lines)) redeemer own)] n) := by
  intro r sigs inputs redeemer own lines h2 n
  obtain ⟨n₀, h₀⟩ := policy_fails_two_or_more_lines r sigs inputs redeemer own lines h2
  generalize he : cekExecuteProgram seedelf.script
    [toTerm (mintIn (r.withMint sigs inputs (mintOf lines)) redeemer own)] n = s
  cases s with
  | Halt V => exact absurd he (exec_never_halts h₀ n V)
  | Eval _ _ _ => exact id
  | Return _ _ => exact id
  | Error => exact id

/-- The failure as the Blaster modules state theirs: `isUnsuccessful` at some fuel. -/
theorem policy_unsuccessful_two_or_more_lines :
    ∀ (r : TxRest) (sigs inputs redeemer : Data) (own : ByteString)
      (lines : List (ByteString × List (ByteString × Integer))),
      2 ≤ lineCount lines →
      ∃ n, isUnsuccessful (cekExecuteProgram seedelf.script
        [toTerm (mintIn (r.withMint sigs inputs (mintOf lines)) redeemer own)] n) := by
  intro r sigs inputs redeemer own lines h2
  obtain ⟨n, hn⟩ := policy_fails_two_or_more_lines r sigs inputs redeemer own lines h2
  exact ⟨n, by rw [hn]; trivial⟩

/-- In the ledger's own terms: every V3 minting context, as CardanoLedgerApiBlaster encodes it,
whose mint is `lines`, of two lines or more, fails, with any redeemer, run as any policy id. -/
theorem policy_fails_two_or_more_lines_ctx (tx : TxInfo) (redeemer : Data) (own : ByteString)
    (lines : List (ByteString × List (ByteString × Integer)))
    (hmint : tx.txInfoMint = pairsOf lines) (h2 : 2 ≤ lineCount lines) :
    ∃ n, cekExecuteProgram seedelf.script
      [toTerm (⟨tx, redeemer, .MintingScript own⟩ : ScriptContext)] n = State.Error := by
  have h := policy_fails_two_or_more_lines (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoSignatories) (IsData.toData tx.txInfoInputs) redeemer own lines h2
  have hm : mintOf lines = IsData.toData tx.txInfoMint := by
    rw [mintOf_eq, ← hmint]
    rfl
  rw [hm, ← TxRest.ofTxInfo_withMint, ← mintIn_of_minting] at h
  exact h

/-! ## Paired with a run that passes (README rule 3)

The same encoding with one honest line, named after its first input as variant 1 names it,
returns unit, by the same evaluator and kernel-checked: the failures above are the second line's,
not the encoding's. Concretely too, beside a run of the same context with a second line. -/

/-- One honest line, `nameAt0` under `p`, its first input `txid#0`, in Steps.lean's busy
transaction (AnyTxSteps), run as `p` with the empty tag. -/
def honestMint : Data :=
  mintIn (busyTx.withMint (.List [.B vkh0]) (inputsFrom txid 0 (.I 0) [])
    (mintOf [("p", [(nameAt0, 1)])])) (.B "") "p"

/-- The same, with a second line under `p`. -/
def honestMintPlusOne : Data :=
  mintIn (busyTx.withMint (.List [.B vkh0]) (inputsFrom txid 0 (.I 0) [])
    (mintOf [("p", [(nameAt0, 1), ("x", 1)])])) (.B "") "p"

#guard (endOf seedelf honestMint).1 == "unit"
#guard (endOf seedelf honestMintPlusOne).1 == "error"

/-- The honest one-line mint returns unit. -/
theorem honest_one_line_returns_unit :
    ∃ n, cekExecuteProgram seedelf.script [toTerm honestMint] n = State.Halt (.VCon .Unit) := by
  apply exec_halt_of_ev
  cek

end Seedelf.V1.LinesAll

#print axioms Seedelf.V1.LinesAll.policy_fails_two_or_more_lines
#print axioms Seedelf.V1.LinesAll.policy_never_succeeds_two_or_more_lines
#print axioms Seedelf.V1.LinesAll.policy_unsuccessful_two_or_more_lines
#print axioms Seedelf.V1.LinesAll.policy_fails_two_or_more_lines_ctx
#print axioms Seedelf.V1.LinesAll.honest_one_line_returns_unit
