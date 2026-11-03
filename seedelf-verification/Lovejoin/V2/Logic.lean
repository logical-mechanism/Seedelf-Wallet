import Lovejoin.V2.Mix
import Lovejoin.Logic

/-! v2 mix_logic (60294352…): the Owner withdrawal's scenario and spec. `validate_owner`,
`schnorr.ak`, `hash.ak` and `bls.ak` are the classic pool's line for line: c1239fb to
5cc3631 changes only the Mix's output walk, the `ReferenceDatum`'s fields and xor32. So
the spec is `Lovejoin.Classic`'s, with v2's mix_box hash in `ctx`. The transaction reads
the test launch's reference input, spends one 10 ₳ box and pays one output. The
withdrawal is mix_logic's own, of 0. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open Lovejoin.Classic (schnorrVerifies wellFormed serialised)
open Seedelf.V1 (emptyTx)

def boxRef : TxOutRef := ⟨"", 0⟩

/-- An Owner withdrawal: the box `(a, b)` at `boxRef` spent, one proof `(t, z)`, `out` paid. -/
def ownerCtx (a b t z : ByteString) (out : TxOut) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨boxRef, box a b⟩],
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := [out],
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- validate_owner's `ctx`: `blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_script_hash)`. -/
def ownerContext (outputs refs : Data) : Option ByteString :=
  match serialised outputs, serialised refs with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

/-- validate_owner with one box: well-formed, and its proof verifies against this
transaction's outputs and inputs, as `Lovejoin.Classic.ownerAccepts` reads them. -/
def ownerAccepts (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

end Lovejoin.V2
