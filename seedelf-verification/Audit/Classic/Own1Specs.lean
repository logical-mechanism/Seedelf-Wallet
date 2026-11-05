import Lovejoin.OwnClassic1Spec

/-! Mutants of `Lovejoin.Classic.Own1`'s spec (`OwnClassic1Spec.lean`), the classic pool's Owner
withdrawal of one box with a payer's key input beside it and two outputs. Each is that file's
code with one change, named in its docstring. No checks here. -/

namespace Audit.Classic.Own1
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open Lovejoin.Classic (schnorrVerifies wellFormed serialised mixBoxHash)
open Lovejoin.Classic.Own1 (adaOwn ownOutputs ref1 payerRef)

/-- `ctxOwn` over the box's ref alone: the payer's input ref left out. -/
def ctxNoPayer (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Option ByteString :=
  match serialised (IsData.toData (ownOutputs s g u amt kc ch)), serialised (Data.List [IsData.toData ref1]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

def proofHoldsNoPayer (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) (a b t z : ByteString) : Bool :=
  match ctxNoPayer s g u amt kc ch with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- `ownOutputs` in the other order: the change, then the register. -/
def ownOutputsSwapped (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : List TxOut :=
  [⟨⟨.PubKeyCredential kc, none⟩, adaOwn ch, .NoOutputDatum, none⟩,
   ⟨⟨.ScriptCredential s, none⟩, adaOwn amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩]

/-- `ctxOwn` over `ownOutputsSwapped`. -/
def ctxSwapped (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Option ByteString :=
  match serialised (IsData.toData (ownOutputsSwapped s g u amt kc ch)), serialised (Data.List [IsData.toData ref1, IsData.toData payerRef]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) mixBoxHash))
  | _, _ => none

def proofHoldsSwapped (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) (a b t z : ByteString) : Bool :=
  match ctxSwapped s g u amt kc ch with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- [B-S1] `ownerAcceptsOwn` over `ctxNoPayer`. -/
def ownerAcceptsNoPayer (a1 b1 t1 z1 : ByteString) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHoldsNoPayer s g u amt kc ch a1 b1 t1 z1)

/-- [B-S2] `ownerAcceptsOwn` over `ctxSwapped`. -/
def ownerAcceptsOutputsSwapped (a1 b1 t1 z1 : ByteString) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : Bool :=
  (wellFormed a1 b1 && proofHoldsSwapped s g u amt kc ch a1 b1 t1 z1)

end Audit.Classic.Own1
