import Seedelf.Policy
import Seedelf.AnyTx
import Seedelf.AnyTxCover

/-! The policy in every transaction: what the `Policy…AnyTx` modules share. `Slice/`'s
`Common` repeats these definitions word for word, since its own package can't import this one.

The policy (84967d91…) reads two of the TxInfo's 16 fields: the inputs (index 0), for the
first one's output reference alone, and the mint (index 4), which it walks (`assets.flatten`).
Every other field is a `Data` of its own here, as in AnyTx.lean, and so are the signatories.
In the bytes (`aiken uplc decode`), the purpose is tested first, then the policy id and the
redeemer (a `B`, the personal tag) are decoded, before the TxInfo is read. Then `xor` takes
both blocks, the burn's first: each flattens the mint and expects exactly one line, and the
mint's names the token after the first input, slicing the tag and the name.

The encoding (CardanoLedgerApiBlaster, V3/Contexts.lean): a minting purpose is
`Constr 0 [B policy]`; an input is `Constr 0 [Constr 0 [B txid, I idx], output]`; a mint is
`Map [(B policy, Map [(B name, I amount), …]), …]`. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)

/-- The policy runs as `own`, with the redeemer `redeemer`, in the transaction `info`. -/
def mintIn (info redeemer : Data) (own : ByteString) : Data :=
  .Constr 0 [info, redeemer, .Constr 0 [.B own]]

/-- The TxInfo with `inputs` at index 0 and `mint` at 4, the signatories `sigs` at 8, and every
other field `r`'s. `r`'s own `inputs` and `mint` aren't used. -/
def TxRest.withMint (r : TxRest) (sigs inputs mint : Data) : Data :=
  .Constr 0 [inputs, r.referenceInputs, r.outputs, r.fee, mint, r.certs, r.withdrawals,
    r.validRange, sigs, r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury,
    r.donation]

/-- `withMint` is `infoWith` of `r` with its inputs and mint replaced. -/
theorem TxRest.withMint_eq (r : TxRest) (sigs inputs mint : Data) :
    r.withMint sigs inputs mint = ({ r with inputs := inputs, mint := mint } : TxRest).infoWith sigs :=
  rfl

/-- Every TxInfo is `withMint` of its other fields, its signatories, its inputs and its mint. -/
theorem TxRest.ofTxInfo_withMint (tx : TxInfo) :
    IsData.toData tx = (TxRest.ofTxInfo tx).withMint (IsData.toData tx.txInfoSignatories)
      (IsData.toData tx.txInfoInputs) (IsData.toData tx.txInfoMint) := rfl

/-- Every minting context is `mintIn` of its parts. -/
theorem mintIn_of_minting (tx : TxInfo) (redeemer : Data) (own : ByteString) :
    IsData.toData (⟨tx, redeemer, .MintingScript own⟩ : ScriptContext) =
      mintIn (IsData.toData tx) redeemer own := rfl

/-- A first input `txid#idx`, holding `out`, and then `rest`. -/
def inputsFrom (txid : ByteString) (idx : Integer) (out : Data) (rest : List Data) : Data :=
  .List (.Constr 0 [.Constr 0 [.B txid, .I idx], out] :: rest)

/-- A mint as the ledger encodes it: each policy, with its names and amounts. -/
def mintOf (lines : List (ByteString × List (ByteString × Integer))) : Data :=
  .Map (lines.map fun l => (.B l.1, .Map (l.2.map fun t => (.B t.1, .I t.2))))

/-- How many lines a mint has: its names, over all its policies. -/
def lineCount (lines : List (ByteString × List (ByteString × Integer))) : Nat :=
  (lines.map fun l => l.2.length).sum

/-- One line, `amt` of `pid.tkn`, written out. -/
def oneLine (pid tkn : ByteString) (amt : Integer) : Data :=
  .Map [(.B pid, .Map [(.B tkn, .I amt)])]

theorem oneLine_eq (pid tkn : ByteString) (amt : Integer) :
    oneLine pid tkn amt = mintOf [(pid, [(tkn, amt)])] := rfl

end Seedelf.V1
