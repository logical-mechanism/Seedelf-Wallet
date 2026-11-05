import Slice.Steps
import Blaster

/-! The run the policy's rule is proved of, and the first inputs off a byte.

The policy (84967d91…) runs as `own` with the redeemer `B tag`, the personal tag, on a mint of
one line, `amt` of `pid.tkn`, in a transaction whose first input is `txid#idx`. Every field the
bytes don't read is any `Data`: the first input's output `out`, the other inputs `rest`, the
signatories `sigs` and the TxInfo's 13 other fields `r` (`TxRest.withMint`). The bytes read the
inputs only for the first one's output reference, and the mint, which they flatten and expect
to be exactly one line (`aiken uplc decode`). Everything they read is symbolic: `own`, `pid`,
`tkn`, `tag`, `txid`, `amt` and `idx`.

So the layout is: a minting purpose, a redeemer that's a `B`, a mint of one line and a first
input. Every V3 minting context has that form when its redeemer is a bytestring and its mint is
one line (PolicyAnyTx's `mintIn_of_minting` and `TxRest.ofTxInfo_withMint`, over the same
definitions, and the ledger's encoding of a TxInInfo, `Constr 0 [Constr 0 [B id, I index],
out]`); the ledger refuses a transaction without inputs. Other purposes, redeemers and mints
are the `Policy…AnyTx` modules'.

Three things shape how it's proved:

- **The slices** run through an `opaque` alias (Slice/lakefile.lean), so every theorem here
  holds for any interpretation of the slice: it says the bytes check `policyAccepts`.
- **The index's byte.** `consByteString idx txid` makes the name's index byte a `Char` out of a
  `UInt8`, a `BitVec`. Over a symbolic index Blaster rejects it ("Inductive datatype with
  instance parameters not supported: `BitVec`"), and `#prep_uplc` fills the `Char`'s proofs
  with `sorry`. Off a byte (`¬ 0 ≤ idx`, `¬ idx ≤ 255`) the bytes fail before making it, and
  stated so, the hypotheses are the bytes' own test and Blaster drops that branch: those two
  theorems are here, over a symbolic index. Each index from 0 to 255 is a theorem of its own,
  with the index concrete (`Index0` to `Index3`), and `Rule` puts them together, kernel-checked.
- **The token name's bytes are a `String`**, `⟨tkn⟩`, where the other bytestrings are
  `ByteString`s. With the name a symbolic `ByteString`, the symbolic run went past 8 GB in
  under a minute even with every other value concrete, though it branches no more; as a
  `String`, or `a ++ b`, it takes 280 MB in two seconds, and so does the run with every value
  symbolic. Every `ByteString` is `⟨s⟩` of its `String`, and `Rule` restates the rule over
  `ByteString` names.

The theorems are about the run itself, `sliceRuleRun`, not a `#prep_uplc` copy of it: Blaster
reduces it in each proof, and one function under every theorem lets `Rule` combine them.

1500 steps: every concrete run ends inside it (Steps, at most 1287). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekMachine (State cekExecuteProgram)
open PlutusCore.UPLC.Utils

/-- One mint line, `amt` of `pid.tkn`, under the policy run as `own` with the tag `tag`; the
first input is `txid#idx`, holding `out`, then `rest`; the signatories `sigs` and every other
field are `r`'s. -/
def sliceRuleArgs (r : TxRest) (sigs out : Data) (rest : List Data) (own pid tkn tag txid : ByteString)
    (amt idx : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs (inputsFrom txid idx out rest) (oneLine pid tkn amt)) (.B tag) own)]

/-- The deployed policy on `sliceRuleArgs`, the token name given by its bytes, at 1500 steps. -/
def sliceRuleRun (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt idx : Integer) : State :=
  cekExecuteProgram seedelfSlicePolicy.script (sliceRuleArgs r sigs out rest own pid ⟨tkn⟩ tag txid amt idx) 1500

/-- The rule, of one run: it succeeds iff `accepted`, and it returns unit, which the ledger
accepts, or reaches `Error`. -/
def RuleHolds (s : State) (accepted : Bool) : Prop :=
  (isSuccessful s ↔ accepted = true) ∧ (returnsUnit s ∨ isUnsuccessful s)

/-- The rule at the first input's index `idx`, in every transaction. -/
def RuleAt (idx : Integer) : Prop :=
  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer),
    RuleHolds (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) (policyAccepts own pid ⟨tkn⟩ tag txid amt idx)

-- The builder makes Steps' contexts, which Aiken's evaluator ran (README rule 3).
example : sliceRuleArgs busyMint busySigs busyOut busyRest policyId policyId name0 "" exampleTxid 1 0 =
    [toTerm mintAt0.ctx] := rfl

/-- The run of a Steps case. -/
def MintCase.ruleRun (c : MintCase) : State :=
  sliceRuleRun busyMint busySigs busyOut busyRest policyId policyId c.tkn.data c.tag exampleTxid c.amt c.idx

-- The run itself at its limit, in Steps' busy transaction: the honest mints and burn return
-- unit; a wrong name, two of a token, and #256 or -1 reach Error.
#guard endsWithUnit mintAt0.ruleRun
#guard endsWithUnit mintAcab.ruleRun
#guard endsWithUnit mintLongTag.ruleRun
#guard endsWithUnit mintAt255.ruleRun
#guard endsWithUnit burnAt0.ruleRun
#guard endsInError mintWrongName.ruleRun
#guard endsInError mintTwo.ruleRun
#guard endsInError burnAt256.ruleRun
#guard endsInError burnAtNeg1.ruleRun

/-- Below a byte, the first input's index fails every mint and burn: the rule holds there,
`policyAccepts` refusing too. -/
theorem policy_one_line_below_a_byte : ∀ (idx : Integer), ¬ (0 ≤ idx) → RuleAt idx := by blaster

/-- And above one, where an honest burn fails too, as off #256 (README, *Found along the way*),
now in every transaction. -/
theorem policy_one_line_above_a_byte : ∀ (idx : Integer), ¬ (idx ≤ 255) → RuleAt idx := by blaster

end Seedelf.V1
