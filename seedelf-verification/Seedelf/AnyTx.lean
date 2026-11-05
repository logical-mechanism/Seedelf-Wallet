import Seedelf.Scripts
import Seedelf.Scenario

/-! Every transaction: what the `…AnyTx` modules share.

CardanoLedgerApiBlaster's own examples quantify over a whole symbolic `SpendingInput`. Over
these scripts that made the symbolic run branch on every list and datum it met, and it took
52 GB (Scripts.lean). Here the context is `Data`, built as the ledger encodes it, and every
field a script doesn't read is a `Data` of its own: any value at all, values the ledger never
produces included. Only what a script walks or takes apart stays fixed: the number of
signatories (none to three here, 4 to 128 in `Signers/`, one module a length: a 16,384-byte
transaction holds at most 125), and the shape of the redeemer and the datum, one scenario per
shape as in WalletNoLock. `AnyTxCover` shows every V3 spend's context has this form, so each
scenario holds of every spend with its signatories, redeemer and datum, and `AnyTxShapes` that
the scenarios are every context there is.

The encoding (CardanoLedgerApiBlaster, V3/Contexts.lean and IsData/Class.lean):
- the context is `Constr 0 [txInfo, redeemer, scriptInfo]`;
- the TxInfo is `Constr 0` of 16 fields, with the signatories, a `List` of `B`s, at index 8;
- a spend's purpose is `Constr 1 [outRef, datum]`, its datum `Constr 0 [d]` (some) or
  `Constr 1 []` (none). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

/-- A transaction's 15 TxInfo fields besides its signatories, in the ledger's order. -/
structure TxRest where
  inputs : Data
  referenceInputs : Data
  outputs : Data
  fee : Data
  mint : Data
  certs : Data
  withdrawals : Data
  validRange : Data
  redeemers : Data
  datums : Data
  txId : Data
  votes : Data
  proposals : Data
  treasury : Data
  donation : Data

/-- The TxInfo with `sigs` at index 8, where the signatories go. -/
def TxRest.infoWith (r : TxRest) (sigs : Data) : Data :=
  .Constr 0 [r.inputs, r.referenceInputs, r.outputs, r.fee, r.mint, r.certs, r.withdrawals,
    r.validRange, sigs, r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury,
    r.donation]

/-- The TxInfo signed by `sigs` (each a `B`). -/
def TxRest.info (r : TxRest) (sigs : List Data) : Data := r.infoWith (.List sigs)

/-- A spend of the output `ref`, whose datum is `datum` (as the ledger encodes an option), with
the redeemer `redeemer`, in the transaction `info`. -/
def spendIn (info redeemer ref datum : Data) : Data :=
  .Constr 0 [info, redeemer, .Constr 1 [ref, datum]]

/-- `some d`, as the ledger encodes a spend's datum. -/
def datumSome (d : Data) : Data := .Constr 0 [d]

/-- `none`, as the ledger encodes a spend's datum. -/
def datumNone : Data := .Constr 1 []

/-- The run halted with the unit constant: what the ledger accepts of a V3 script.
`isSuccessful` is a halt with any value. Read through a match (README rule 6). -/
def returnsUnit (s : State) : Prop :=
  match s with
  | .Halt (.VCon .Unit) => True
  | _ => False

/-- `returnsUnit`, as a `Bool`, for a `#guard` on a `NAME.exec` run. -/
def endsWithUnit (s : State) : Bool :=
  match s with
  | .Halt (.VCon .Unit) => true
  | _ => false

/-- `isUnsuccessful`, as a `Bool`, for a `#guard` on a `NAME.exec` run. -/
def endsInError (s : State) : Bool :=
  match s with
  | .Error => true
  | _ => false

/-- How a concrete run of `s` on the context `ctx` ends, and after how many steps: "unit",
"halt" (another value), "error", or "exhausted" past `fuel`. The machine is `#prep_uplc`'s,
as in Steps.lean. -/
def endOf (s : PlutusScript) (ctx : Data) (fuel : Nat := 20000) : String × Nat :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → Nat → String × Nat
      | 0, _, n => ("exhausted", n)
      | k + 1, st, n =>
        match st with
        | .Halt (.VCon .Unit) => ("unit", n)
        | .Halt _ => ("halt", n)
        | .Error => ("error", n)
        | _ => go k (step default st) (n + 1)
    go fuel (initialState (applyParams body [toTerm ctx])) 0

end Seedelf.V1
