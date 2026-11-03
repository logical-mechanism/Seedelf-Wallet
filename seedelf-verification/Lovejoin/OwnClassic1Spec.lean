import Lovejoin.OwnClassic1
import Lovejoin.Logic

/-! The classic pool's Owner withdrawal of 1, for the classic pool, its spec: validate_owner's `ctx`
over this transaction's outputs and every input's reference, then each
box's Schnorr proof against it (`Lovejoin.Classic.schnorrVerifies`). A malformed box isn't
one of validate_owner's (`collect_well_formed_mix_inputs` skips it), so each box's check is
`wellFormed` and its proof. Written by `gen-lovejoin-owner.py`. -/

namespace Lovejoin.Classic.Own1
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (schnorrVerifies wellFormed serialised)

/-- validate_owner's `ctx`: `blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_box)`. -/
def ctxOwn (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Option ByteString :=
  match serialised (IsData.toData (ownOutputs s g u amt kc ch)), serialised (Data.List [IsData.toData ref1, IsData.toData payerRef]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

/-- A box's proof verifies against this transaction's `ctx`. -/
def proofHolds (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) (a b t z : ByteString) : Bool :=
  match ctxOwn s g u amt kc ch with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- validate_owner: every box well-formed, and its proof verifies. -/
def ownerAcceptsOwn (a1 b1 t1 z1 : ByteString) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHolds s g u amt kc ch a1 b1 t1 z1)

def argsOwn (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : List Term :=
  [toTerm (ownCtx a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Lovejoin.Classic.Own1
