import Seedelf.PolicyAnyTx
import Seedelf.AnyTxSteps

/-! The policy's concrete runs in the `Policy…AnyTx` encoding, as `#guard`s: each must end as
stated, or the build fails. The transaction is AnyTxSteps' busy one with its inputs and mint
replaced (`TxRest.withMint`). In it an honest mint of one Seedelf, named by `seedelfName` after
the first input, returns unit, and so does an honest burn of one: the passing runs that the
failure families are paired with, in their encoding (README rule 3).

The failure families, each in that same transaction: a mint of no lines, mints of two to five
lines in every arrangement over policies, the five other purposes, and redeemers that aren't a
`B`. Each reaches `Error`. Step counts check what the `Policy…AnyTx` modules rely on in the
bytes (`aiken uplc decode`):
- the purpose is tested before the redeemer or the TxInfo is read: each other purpose errors at
  the same step when the TxInfo is `I 7` and the redeemer `I 0`;
- the policy id, then the redeemer as a `B`, are decoded before the TxInfo is read: a redeemer
  that isn't a `B` errors at the same step when the TxInfo is `I 7`;
- `xor` evaluates the burn block first, and it flattens the mint and errors unless there is
  exactly one line, before the mint block reads the inputs: a mint of no lines, or of two to
  five, errors at the same step when the inputs are `I 7`. A burn of one line with the inputs
  `I 7` errors: the mint block reads them once the burn block has passed.

They size the limits. The other purposes error after 156 steps and the other redeemers after 184,
inside PolicyPurposeAnyTx's and PolicyRedeemerAnyTx's 500. A mint of no lines errors after 277,
and the longest arrangement of five lines, five policies of one name each, after 1224, inside
the `PolicyLines…AnyTx` modules' 1500, the policy's other modules' limit. The honest mint and
burn return unit after 1287 and 1279. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (State)

/-- The run is still going, neither halted nor failed (`isExhausted`), as a `Bool`: for a
negative control's `#guard`, a run cut one step short of its end. -/
def stillRunning (s : State) : Bool :=
  match s with
  | .Eval .. | .Return .. => true
  | _ => false

/-- The policy's id on chain, 84967d91… (seedelf-core's constants). -/
def polId : ByteString := ofHex "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255"

/-- What busyTx's one input holds: a Register UTxO at the wallet. -/
def busyOut : Data :=
  .Constr 0 [.Constr 0 [.Constr 1 [.B "s"], .Constr 1 []], .Map [(.B "", .Map [(.B "", .I 5000000)])],
    .Constr 2 [.Constr 0 [.B g1, .B u0]], .Constr 1 []]

example : busyTx.inputs = inputsFrom txid 0 busyOut [] := rfl

/-- busyTx, signed by `vkh0`, with `inputs` and `mint` in place of its own. -/
def polTx (inputs mint : Data) : Data := busyTx.withMint (.List [.B vkh0]) inputs mint

/-- The personal tag token_name.ak's tests use. -/
def polTag : ByteString := ofHex "acab"

/-- The name an honest mint tagged `polTag` takes after busyTx's input, `txid#0`. -/
def polMintName : ByteString := (seedelfName txid 0 polTag).getD ""

-- `seedelfName` gives token_name.ak's names: real_token_name2, and real_token_name1 (nameAt0).
#guard polMintName == ofHex "5eed0e1facab004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce"
#guard nameAt0 == ofHex "5eed0e1f004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce2361"

/-- An honest mint's TxInfo: busyTx minting one Seedelf, named after its first input `txid#0`
with the tag `polTag`. -/
def polMintInfo : Data := polTx busyTx.inputs (oneLine polId polMintName 1)

/-- An honest mint: `polMintInfo`, with the tag as the redeemer. -/
def polMint : Data := mintIn polMintInfo (.B polTag) polId

/-- An honest burn: the Seedelf `nameAt0` (minted off `txid#0` untagged, Steps.lean), in a
transaction whose first input is `txid#1`, with the empty redeemer seedelf-core sends. -/
def polBurn : Data :=
  mintIn (polTx (inputsFrom txid 1 busyOut []) (oneLine polId nameAt0 (-1))) (.B "") polId

#guard (endOf seedelf polMint).1 == "unit"
#guard (endOf seedelf polBurn).1 == "unit"

/-! Mints of other than one line. -/

/-- The compositions of `n`, its splits into positive parts in order, 2^(n-1) of them: a mint's
layouts over policies, each part a policy's number of names. -/
def compositions : Nat → List (List Nat)
  | 0 => [[]]
  | 1 => [[1]]
  | n + 2 => (compositions (n + 1)).flatMap fun
      | a :: rest => [(a + 1) :: rest, 1 :: a :: rest]
      | [] => []

#guard [0, 1, 2, 3, 4, 5].map (fun n => (compositions n).length) == [1, 1, 2, 4, 8, 16]
#guard [0, 1, 2, 3, 4, 5].all fun n =>
  (compositions n).all (fun c => c.sum == n && c.all (· != 0)) && (compositions n).eraseDups == compositions n

/-- The `i`th policy's `k` names in `polLinesAs`: the honest mint's name first, then `x1`, `x2`, …,
each an amount of one. -/
def polNames (i k : Nat) : List (ByteString × Integer) :=
  (List.range k).map fun j =>
    (if i = 0 ∧ j = 0 then polMintName else (("x" ++ toString j : String) : ByteString), 1)

def polPolicies : Nat → List Nat → List (ByteString × List (ByteString × Integer))
  | _, [] => []
  | i, k :: ks =>
    (if i = 0 then polId else (("q" ++ toString i : String) : ByteString), polNames i k) :: polPolicies (i + 1) ks

/-- A mint laid out as `c`: the honest mint's line first, under `polId`, then further names and
policies `q1`, `q2`, …. -/
def polLinesAs (c : List Nat) : Data := mintOf (polPolicies 0 c)

-- At one line it's the honest mint, which returns unit (README rule 3).
#guard polLinesAs [1] == oneLine polId polMintName 1
#guard [0, 2, 3, 4, 5].all fun n => (compositions n).all fun c => lineCount (polPolicies 0 c) == n

/-- The honest mint's transaction and tag, with the mint `mint` and the inputs `inputs`. -/
def polLinesCtx (inputs mint : Data) : Data := mintIn (polTx inputs mint) (.B polTag) polId

#guard (endOf seedelf (polLinesCtx busyTx.inputs (polLinesAs [1]))).1 == "unit"

-- No lines, and every arrangement of two to five: Error, at the same step when the inputs are
-- `I 7`, so the inputs weren't read.
#guard [0, 2, 3, 4, 5].all fun n => (compositions n).all fun c =>
  let e := endOf seedelf (polLinesCtx busyTx.inputs (polLinesAs c))
  e.1 == "error" && e == endOf seedelf (polLinesCtx (.I 7) (polLinesAs c))

-- One line, the honest burn's, with the inputs `I 7`: the burn block passes, and the mint block
-- reads the inputs.
#guard (endOf seedelf (mintIn (polTx (.I 7) (oneLine polId nameAt0 (-1))) (.B "") polId)).1 == "error"

/-- The most steps any arrangement of `n` lines takes. -/
def polLinesMostSteps (n : Nat) : Nat :=
  ((compositions n).map fun c => (endOf seedelf (polLinesCtx busyTx.inputs (polLinesAs c))).2).foldl max 0

/-! The other purposes, and redeemers that aren't a `B`. -/

/-- The honest mint's TxInfo and tag, with the purpose `Constr k fs` in place of its own. -/
def polPurposeCtx (k : Integer) (fs : List Data) : Data :=
  .Constr 0 [polMintInfo, .B polTag, .Constr k fs]

/-- Each other V3 purpose, in the ledger's shape: spending busyTx's input with its Register
datum, rewarding a script credential, certifying its stake registration, a stake pool's vote,
an info action's proposal. -/
def polOtherPurposes : List (Integer × List Data) :=
  [(1, [spentRef, registerDatum]), (2, [.Constr 1 [.B "w"]]),
    (3, [.I 0, .Constr 0 [.Constr 1 [.B "w"], .Constr 1 []]]), (4, [.Constr 2 [.B "pool"]]),
    (5, [.I 0, .Constr 0 [.I 100000000000, .Constr 0 [.B "k"], .Constr 6 []]])]

-- Each reaches Error, at the same step when the TxInfo is `I 7` and the redeemer `I 0`.
#guard polOtherPurposes.all fun (k, fs) =>
  let e := endOf seedelf (polPurposeCtx k fs)
  e.1 == "error" && e == endOf seedelf (.Constr 0 [.I 7, .I 0, .Constr k fs])

/-- A redeemer of each other kind than `B`. -/
def polOtherRedeemers : List Data :=
  [.I 0, .List [.B polTag], .Map [(.B polTag, .I 0)], .Constr 0 [.B polTag]]

-- Each reaches Error in the honest mint's place, at the same step when the TxInfo is `I 7`.
#guard polOtherRedeemers.all fun rd =>
  let e := endOf seedelf (mintIn polMintInfo rd polId)
  e.1 == "error" && e == endOf seedelf (mintIn (.I 7) rd polId)

-- The policy id is decoded first, then the redeemer, then the TxInfo is read: a purpose whose
-- policy id isn't a `B` errors at the same step whatever the redeemer, before a redeemer that
-- isn't a `B` does, which errors before the TxInfo `I 7` does under a `B` redeemer.
#guard endOf seedelf (.Constr 0 [.I 7, .I 0, .Constr 0 [.I 0]]) ==
  endOf seedelf (.Constr 0 [.I 7, .B polTag, .Constr 0 [.I 0]])
#guard (endOf seedelf (.Constr 0 [.I 7, .I 0, .Constr 0 [.I 0]])).2 < (endOf seedelf (mintIn (.I 7) (.I 0) polId)).2
#guard (endOf seedelf (mintIn (.I 7) (.I 0) polId)).2 < (endOf seedelf (mintIn (.I 7) (.B polTag) polId)).2
#guard (endOf seedelf (mintIn (.I 7) (.B polTag) polId)).1 == "error"

-- Inside the limits: 500 for the other purposes and redeemers, 1500 for the lines.
#guard polOtherPurposes.all fun (k, fs) => (endOf seedelf (polPurposeCtx k fs)).2 < 500
#guard polOtherRedeemers.all fun rd => (endOf seedelf (mintIn polMintInfo rd polId)).2 < 500
#guard [0, 2, 3, 4, 5].all fun n => polLinesMostSteps n < 1500

#eval s!"policy, honest mint:       {showEnd (endOf seedelf polMint)}"
#eval s!"policy, honest burn:       {showEnd (endOf seedelf polBurn)}"
#eval s!"policy, lines (n, most steps): {[0, 2, 3, 4, 5].map fun n => (n, polLinesMostSteps n)}"
#eval s!"policy, lines 5 (layout, steps): {(compositions 5).map fun c => (c, (endOf seedelf (polLinesCtx busyTx.inputs (polLinesAs c))).2)}"
#eval s!"policy, other purposes:    {polOtherPurposes.map fun (k, fs) => (k, showEnd (endOf seedelf (polPurposeCtx k fs)))}"
#eval s!"policy, other redeemers:   {polOtherRedeemers.map fun rd => showEnd (endOf seedelf (mintIn polMintInfo rd polId))}"
#eval s!"policy, TxInfo I 7, redeemer B: {showEnd (endOf seedelf (mintIn (.I 7) (.B polTag) polId))}"

end Seedelf.V1
