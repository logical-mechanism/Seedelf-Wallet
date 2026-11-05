import Lovejoin.OwnClassic3Spec

/-! Mutants of `Lovejoin.Classic.Own3`'s spec (`OwnClassic3Spec.lean`), the classic pool's Owner
withdrawal of three boxes with a payer's key input and two outputs. Each is that file's code
with one change, named in its docstring. No checks here. -/

namespace Audit.Classic.Own3
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open Lovejoin.Classic (schnorrVerifies wellFormed serialised mixBoxHash)
open Lovejoin.Classic.Own3 (ownOutputs ref1 ref2 ref3 proofHolds)

/-- `ctxOwn` over the boxes' refs alone: the payer's input ref left out. -/
def ctxNoPayer (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Option ByteString :=
  match serialised (IsData.toData (ownOutputs s g u amt kc ch)),
      serialised (Data.List [IsData.toData ref1, IsData.toData ref2, IsData.toData ref3]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

def proofHoldsNoPayer (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) (a b t z : ByteString) : Bool :=
  match ctxNoPayer s g u amt kc ch with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- [C-S1] `ownerAcceptsOwn` with box 3's proof dropped (its well-formedness kept). -/
def ownerAcceptsDrop3 (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 _t3 _z3 : ByteString) (s g u : ByteString) (amt : Integer)
    (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHolds s g u amt kc ch a1 b1 t1 z1) &&
    (wellFormed a2 b2 && proofHolds s g u amt kc ch a2 b2 t2 z2) &&
    wellFormed a3 b3

/-- [C-S2] `ownerAcceptsOwn` with box 2's proof checked against box 1's points. -/
def ownerAcceptsCrossed (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (s g u : ByteString) (amt : Integer)
    (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHolds s g u amt kc ch a1 b1 t1 z1) &&
    (wellFormed a2 b2 && proofHolds s g u amt kc ch a1 b1 t2 z2) &&
    (wellFormed a3 b3 && proofHolds s g u amt kc ch a3 b3 t3 z3)

/-- [C-S3] `ownerAcceptsOwn` over `ctxNoPayer`. -/
def ownerAcceptsNoPayer (a1 b1 a2 b2 a3 b3 t1 z1 t2 z2 t3 z3 : ByteString) (s g u : ByteString) (amt : Integer)
    (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHoldsNoPayer s g u amt kc ch a1 b1 t1 z1) &&
    (wellFormed a2 b2 && proofHoldsNoPayer s g u amt kc ch a2 b2 t2 z2) &&
    (wellFormed a3 b3 && proofHoldsNoPayer s g u amt kc ch a3 b3 t3 z3)

end Audit.Classic.Own3
