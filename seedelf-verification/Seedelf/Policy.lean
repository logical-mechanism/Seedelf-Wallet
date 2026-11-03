import Seedelf.Scripts
import Seedelf.Scenario

/-! The Seedelf policy (84967d91…): what its modules share. Each property has
its own module with its own `#prep_uplc`, leaving symbolic only what it needs:
every symbolic equality splits the symbolic run, and a killed build loses all
of a module's results. A concrete mint or burn takes about 730 CEK steps
(72,834 memory units at 100 a step, `aiken uplc eval`), hence 900. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)

/-- One input `txid#idx`; the mint is one line, `n` of `cs.tn`; the redeemer
is the personal tag; the policy runs as `own`. -/
def mintCtx (own cs tn txid tag : ByteString) (idx n : Integer) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs := [⟨⟨txid, idx⟩, someOutput⟩],
    txInfoMint   := [(Data.B cs, Data.Map [(Data.B tn, Data.I n)])] }
  ⟨tx, Data.B tag, .MintingScript own⟩

def seedelfPrefix : ByteString := "\x5e\xed\x0e\x1f"

/-- A 5eed0e1f name with a symbolic rest. A wholly symbolic name doesn't scale:
`sliceByteString` is `take`/`drop` on the `List Char`, so slicing a symbolic
string splits the symbolic run on its length, and each branch carries the rest
of a ~1300-step run (`take(tn, 4)` alone took a run past 8 GB). A concrete
prefix slices without looking at the rest. -/
def prefixed (rest : ByteString) : ByteString := appendByteString seedelfPrefix rest

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

end Seedelf.V1
