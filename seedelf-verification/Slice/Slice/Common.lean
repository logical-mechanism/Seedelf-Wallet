import Slice.Scripts
import CardanoLedgerApi.V3

/-! What the slice modules share, and the policy's rule as a spec.

The first part is copies, word for word and under the same names, of the main package's
`ofHex` (Seedelf/Scenario.lean), `TxRest`, `TxRest.infoWith`, `returnsUnit`, `endsWithUnit`,
`endsInError` and `endOf` (Seedelf/AnyTx.lean), `seedelfPrefix`, `exampleTxid` and
`seedelfName` (Seedelf/Policy.lean), and `mintIn`, `TxRest.withMint`, `inputsFrom` and
`oneLine` (Seedelf/PolicyAnyTx.lean). This package can't import the main one: it pins
PlutusCoreBlaster's `local/opaque-slice` where the main package pins `local/opaque-xor`, and one
build can't hold both. Being the same definitions, they encode a context as the main package
does, so PolicyAnyTx's `TxRest.ofTxInfo_withMint` and `mintIn_of_minting` (every minting
context is `mintIn` of its TxInfo, and every TxInfo `withMint` of its fields, by `rfl`) cover
these too.

Then `policyAccepts`, the policy's rule for one mint line, which `Rule` proves the deployed
bytes run in every transaction. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer addInteger subtractInteger equalsInteger)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)
open PlutusCore.UPLC.BuiltinFunctions.ByteString (sliceByteStringOpaque)

/-! ### Copies -/

def ofHex (h : String) : ByteString :=
  let digit (c : Char) : Nat :=
    if c.isDigit then c.toNat - '0'.toNat else c.toLower.toNat - 'a'.toNat + 10
  let rec go : List Char → List Char
    | a :: b :: rest => Char.ofNat (digit a * 16 + digit b) :: go rest
    | _ => []
  ⟨String.mk (go h.toList)⟩

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

def seedelfPrefix : ByteString := "\x5e\xed\x0e\x1f"

/-- An input id from token_name.ak's tests, 32 bytes as on chain. -/
def exampleTxid : ByteString := ofHex "4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880"

/-- `token_name.generate` as variant 1 computes it; `none` where
`consByteString` aborts (an index past 255). -/
def seedelfName (txid : ByteString) (idx : Integer) (tag : ByteString) : Option ByteString :=
  if 0 ≤ idx ∧ idx ≤ 255 then
    some (sliceByteString 0 32
      (appendByteString (appendByteString seedelfPrefix (sliceByteString 0 15 tag))
        (ByteString.cons idx.toNat.toUInt8 txid)))
  else none

/-- The policy runs as `own`, with the redeemer `redeemer`, in the transaction `info`. -/
def mintIn (info redeemer : Data) (own : ByteString) : Data :=
  .Constr 0 [info, redeemer, .Constr 0 [.B own]]

/-- The TxInfo with `inputs` at index 0 and `mint` at 4, the signatories `sigs` at 8, and every
other field `r`'s. `r`'s own `inputs` and `mint` aren't used. -/
def TxRest.withMint (r : TxRest) (sigs inputs mint : Data) : Data :=
  .Constr 0 [inputs, r.referenceInputs, r.outputs, r.fee, mint, r.certs, r.withdrawals,
    r.validRange, sigs, r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury,
    r.donation]

/-- A first input `txid#idx`, holding `out`, and then `rest`. -/
def inputsFrom (txid : ByteString) (idx : Integer) (out : Data) (rest : List Data) : Data :=
  .List (.Constr 0 [.Constr 0 [.B txid, .I idx], out] :: rest)

/-- One line, `amt` of `pid.tkn`, written out. -/
def oneLine (pid tkn : ByteString) (amt : Integer) : Data :=
  .Map [(.B pid, .Map [(.B tkn, .I amt)])]

/-! ### The rule -/

/-- The deployed policy's rule for a mint of one line, `amt` of `pid.tkn`, run as `own` with
the personal tag `tag`, in a transaction whose first input is `txid#idx` (`aiken uplc
decode`). `xor` takes both blocks, the burn's first, and either one's error is the script's.

- The burn's block: the line is `own`'s, its name's first four bytes are 5eed0e1f
  (`bytearray.take(tkn, 4)`), and it burns one. On this layout nothing in it can fail.
- The mint's block: the name `generate` gives the first input. The tag's first 15 bytes come
  first, then `consByteString idx txid`, which fails off a byte under V3's semantics
  (`consByteStringV2`), so a burn fails there too; then the whole is cut to 32 bytes. The line
  must be `own`'s, have that name and mint one.
- `xor(burn, mint)` as the bytes compute it: `or` first, then `not and`.

Written in the bytes' own order with their own builtins (README rule 7). Each slice is the
alias the SliceByteString builtin runs, called as the builtin calls it,
`sliceByteStringOpaque start length bytes`, so a property over it holds for any slice: it says
what the bytes check. The lengths are those the solver sees: the bytes run
`bytearray.slice(bs, 0, end)` as `sliceByteString 0 ((end - 0) + 1) bs`, so 15 for the tag and
32 for the name (guarded below). -/
def policyAccepts (own pid tkn tag txid : ByteString) (amt idx : Integer) : Bool :=
  let burn :=
    equalsByteString pid own &&
      (equalsByteString ⟨sliceByteStringOpaque 0 4 tkn.data⟩ seedelfPrefix &&
        equalsInteger amt (-1))
  match consByteStringV2 idx txid with
  | .error _ => false
  | .ok indexed =>
    let name : ByteString :=
      ⟨sliceByteStringOpaque 0 32
        (appendByteString (appendByteString seedelfPrefix ⟨sliceByteStringOpaque 0 15 tag.data⟩)
          indexed).data⟩
    let mint := equalsByteString own pid && (equalsByteString name tkn && equalsInteger 1 amt)
    if burn || mint then !(burn && mint) else false

-- The lengths: the bytes' slice helper, `sliceByteString start ((end - start) + 1)`, through
-- PlutusCore's own integer builtins, for the tag's `slice(personal, 0, 14)` and the name's
-- `slice(…, 0, 31)`.
#guard addInteger (subtractInteger 14 0) 1 == 15
#guard addInteger (subtractInteger 31 0) 1 == 32

-- Compiled, the alias is the slice itself, so a `#guard` or `#eval` of the spec computes what
-- the chain does: the alias agrees with `sliceByteString` on a long name, a short one and a
-- tag past 15 bytes.
#guard sliceByteStringOpaque 0 4 (ofHex "5eed0e1f004172bf").data == seedelfPrefix.data
#guard sliceByteStringOpaque 0 4 (ofHex "5eed0e").data == (ofHex "5eed0e").data
#guard sliceByteStringOpaque 0 15 (ofHex "0102030405060708090a0b0c0d0e0f1011").data ==
  (sliceByteString 0 15 (ofHex "0102030405060708090a0b0c0d0e0f1011")).data

end Seedelf.V1
