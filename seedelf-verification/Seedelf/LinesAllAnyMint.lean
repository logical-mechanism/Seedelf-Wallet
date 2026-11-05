import Seedelf.PolicyLinesAll

/-! # Any mint that isn't one line fails

PolicyLinesAll proves the rule for mints as the ledger encodes them (`mintOf lines`). The bytes
don't need that shape to fail. The flatten decodes each policy with `unBData` and each name map
with `unMapData`, and conses the names and amounts unchecked, so here the mint is any `Data` at
all, ill-formed ones and the empty mint included: unless it flattens to exactly one line, the
policy reaches `Error`. `flatPairs` is that flatten as a function, `none` where the bytes refuse a
policy or a name map. Kernel-checked, no Blaster. -/

namespace Seedelf.V1.LinesAll
open Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3 (TxInfo ScriptContext)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine

/-- What the flatten makes of any mint's pairs: a line for each name, or `none` where a policy
isn't a `B` or its names aren't a `Map`. -/
def flatPairs : List (Data × Data) → Option (List Data)
  | [] => some []
  | (.B pid, .Map toks) :: rest => (flatPairs rest).map (toks.map (lineOf pid) ++ ·)
  | _ :: _ => none

/-- On a mint as the ledger encodes it, `flatPairs` is `flatLines`. -/
theorem flatPairs_pairsOf (lines : List (ByteString × List (ByteString × Integer))) :
    flatPairs (pairsOf lines) = some (flatLines lines) := by
  induction lines with
  | nil => rfl
  | cons l ls ih =>
    show Option.map (fun x => List.map (lineOf l.1) (l.2.map fun t => (Data.B t.1, Data.I t.2)) ++ x)
      (flatPairs (pairsOf ls)) = _
    rw [ih]
    rfl

/-- Each line `flatPairs` makes is a list of three. -/
theorem mem_flatPairs {ps : List (Data × Data)} {L : List Data} (h : flatPairs ps = some L)
    {d : Data} (hd : d ∈ L) : ∃ a b c, d = .List [a, b, c] := by
  induction ps generalizing L with
  | nil =>
    have e : [] = L := Option.some.inj h
    subst e
    cases hd
  | cons p ps ih =>
    obtain ⟨k, v⟩ := p
    cases k with
    | B pid =>
      cases v with
      | Map toks =>
        cases hr : flatPairs ps with
        | none =>
          rw [flatPairs, hr] at h
          cases h
        | some L' =>
          rw [flatPairs, hr] at h
          have e : toks.map (lineOf pid) ++ L' = L := Option.some.inj h
          subst e
          rcases List.mem_append.mp hd with hd | hd
          · obtain ⟨t, _, rfl⟩ := List.mem_map.mp hd
            exact ⟨_, _, _, rfl⟩
          · exact ih hr hd
      | _ => simp [flatPairs] at h
    | _ => simp [flatPairs] at h

set_option maxHeartbeats 0

/-- The outer loop on any pairs: it returns `flatPairs`'s lines, or errors where it is `none`. -/
theorem outer_loop_any (a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (ps : List (Data × Data)) :
    Ev default outerBody
      (.VCon (.ConstPairDataList ps) ::
        .VLam outerLoop (outerEnv a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 rest) ::
        outerEnv a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 rest)
      ((flatPairs ps).map fun L => .VCon (.ConstDataList L)) := by
  induction ps with
  | nil => cek
  | cons p ps ih =>
    obtain ⟨k, v⟩ := p
    cases k with
    | B pid =>
      cases v with
      | Map toks =>
        cases hr : flatPairs ps with
        | none =>
          rw [hr] at ih
          simp only [flatPairs, hr]
          cek_using [ih, inner_loop]
        | some L =>
          rw [hr] at ih
          simp only [flatPairs, hr]
          cek_using [ih, inner_loop]
      | _ => cek
    | _ => cek

/-- The flatten closure, applied to any pairs. -/
theorem flatten_apply_any (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (ps : List (Data × Data)) :
    Ap default (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 ::
        builtinsEnv rest))
      (.VCon (.ConstPairDataList ps))
      ((flatPairs ps).map fun L => .VCon (.ConstDataList L)) := by
  apply ap_lam
  cek_using [outer_loop_any]

/-- A redeemer that isn't a `B` fails, whatever the mint: the bytes decode it before they read
the TxInfo. -/
theorem policy_fails_redeemer_not_B (r : TxRest) (sigs inputs mint redeemer : Data)
    (own : ByteString) (h : ∀ tag, redeemer ≠ .B tag) :
    ∃ n, cekExecuteProgram seedelf.script
      [toTerm (mintIn (r.withMint sigs inputs mint) redeemer own)] n = State.Error := by
  apply exec_error_of_ev
  cases redeemer with
  | B tag => exact absurd rfl (h tag)
  | _ => cek

/-- **Any mint that isn't one line fails.** Whatever `Data` the mint is, unless it is a map
that flattens to exactly one line, the policy reaches `Error`, with any other TxInfo field,
signatories, inputs, redeemer and policy id. -/
theorem policy_fails_unless_one_line :
    ∀ (r : TxRest) (sigs inputs redeemer : Data) (own : ByteString) (mint : Data),
      (∀ ps L, mint = .Map ps → flatPairs ps = some L → L.length ≠ 1) →
      ∃ n, cekExecuteProgram seedelf.script
        [toTerm (mintIn (r.withMint sigs inputs mint) redeemer own)] n = State.Error := by
  intro r sigs inputs redeemer own mint h
  cases redeemer with
  | B tag =>
    apply exec_error_of_ev
    cases mint with
    | Map ps =>
      cases hfp : flatPairs ps with
      | none =>
        have hF : ∀ (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment),
            Ap default (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 ::
                builtinsEnv rest)) (.VCon (.ConstPairDataList ps)) none := by
          intro a1 a2 a3 a4 a5 a6 a7 a8 a9 rest
          have hA := flatten_apply_any a1 a2 a3 a4 a5 a6 a7 a8 a9 rest ps
          rw [hfp] at hA
          exact hA
        cek_using [hF]
      | some L =>
        have hL := h ps L rfl hfp
        have hF : ∀ (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment),
            Ap default (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 ::
                builtinsEnv rest)) (.VCon (.ConstPairDataList ps))
              (some (.VCon (.ConstDataList L))) := by
          intro a1 a2 a3 a4 a5 a6 a7 a8 a9 rest
          have hA := flatten_apply_any a1 a2 a3 a4 a5 a6 a7 a8 a9 rest ps
          rw [hfp] at hA
          exact hA
        rcases L with _ | ⟨x, _ | ⟨y, zs⟩⟩
        · -- No line: `headList` refuses the empty list.
          cek_using [hF]
        · exact absurd rfl hL
        · -- Two or more: `chooseList` on the rest picks the error.
          obtain ⟨a, b, c, rfl⟩ := mem_flatPairs hfp (d := x) (by simp)
          cek_using [hF]
    | _ => cek
  | _ => exact policy_fails_redeemer_not_B r sigs inputs mint _ own (fun _ e => nomatch e)

/-- In the ledger's own terms: every V3 minting context, as CardanoLedgerApiBlaster encodes it
(its `MintValue` any pairs at all), fails unless its mint flattens to exactly one line, with any
redeemer, run as any policy id. -/
theorem policy_fails_unless_one_line_ctx (tx : TxInfo) (redeemer : Data) (own : ByteString)
    (h : ∀ L, flatPairs tx.txInfoMint = some L → L.length ≠ 1) :
    ∃ n, cekExecuteProgram seedelf.script
      [toTerm (⟨tx, redeemer, .MintingScript own⟩ : ScriptContext)] n = State.Error := by
  have hm := policy_fails_unless_one_line (TxRest.ofTxInfo tx)
    (IsData.toData tx.txInfoSignatories) (IsData.toData tx.txInfoInputs) redeemer own
    (IsData.toData tx.txInfoMint) (fun ps L e hL => by
      have e' : Data.Map tx.txInfoMint = Data.Map ps := e
      injection e' with e''
      subst e''
      exact h L hL)
  rw [← TxRest.ofTxInfo_withMint, ← mintIn_of_minting] at hm
  exact hm

/-- The target again, from the general rule: two lines or more flatten to two lines or more. -/
example : ∀ (r : TxRest) (sigs inputs redeemer : Data) (own : ByteString)
    (lines : List (ByteString × List (ByteString × Integer))),
    2 ≤ lineCount lines →
    ∃ n, cekExecuteProgram seedelf.script
      [toTerm (mintIn (r.withMint sigs inputs (mintOf lines)) redeemer own)] n = State.Error := by
  intro r sigs inputs redeemer own lines h2
  refine policy_fails_unless_one_line r sigs inputs redeemer own (mintOf lines) ?_
  intro ps L e hL
  have e' : Data.Map (pairsOf lines) = Data.Map ps := e
  injection e' with e''
  subst e''
  rw [flatPairs_pairsOf] at hL
  have e3 : flatLines lines = L := Option.some.inj hL
  subst e3
  have := flatLines_length lines
  omega

end Seedelf.V1.LinesAll

#print axioms Seedelf.V1.LinesAll.policy_fails_unless_one_line
#print axioms Seedelf.V1.LinesAll.policy_fails_unless_one_line_ctx
