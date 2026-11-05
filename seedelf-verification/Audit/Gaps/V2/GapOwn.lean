import Lovejoin.V2.Mix
import Lovejoin.Template.Launch
import Lovejoin.Logic

/-! v2's Owner withdrawal for any pool, in shapes `V2.OwnAny*` doesn't have: every
`OwnAny` scenario has a payer's key input after the boxes and two outputs. The wallet's own
withdrawal has neither: one box, nothing else in (giveme.my's collateral isn't a
`txInfoInputs` entry), and one Seedelf register out (seedelf-core's `lovejoin` module:
"boxes into one fresh Seedelf register, paid from the boxes"). So: that (`solo`), an input
at any credential with no datum before the box (`first`: a payer's key sorted first, or a
UTxO at mix_box with no datum), and two well-formed boxes with one proof (`twoOne`). The
specs are `V2.OwnAny1Spec`'s, over these transactions' outputs and input refs. Written by
the v2-scenario audit's `gen-gaps.py`. -/

namespace Lovejoin.V2.OwnGap
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Classic (schnorrVerifies wellFormed serialised)
open Lovejoin.Template (nftName)

/-- `n` lovelace alone. -/
def adaGap (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

/-- The pool's `ReferenceDatum`, as `V2.OwnAny*`'s: validate_owner reads only `M`. -/
def refDatumGap (M : ByteString) : Data :=
  .Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputGap (P M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumGap M), none⟩⟩

/-- A box of 10 ₳ at mix_box `M`, its datum `(a, b)` inline. -/
def boxGap (M a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, adaGap 10000000, .OutputDatum (mixDatum a b), none⟩

def gref1 : TxOutRef := ⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩
def gref2 : TxOutRef := ⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩
def grefFirst : TxOutRef := ⟨ofHex "0000000000000000000000000000000000000000000000000000000000000000", 0⟩

/-- The withdrawal's one output: a Seedelf register `(g, u)` of `amt` at the wallet contract `s`. -/
def registerGap (s g u : ByteString) (amt : Integer) : TxOut :=
  ⟨⟨.ScriptCredential s, none⟩, adaGap amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩

/-- An input at `c` holding `xv` lovelace, with no datum. -/
def otherGap (c : Credential) (xv : Integer) : TxOut :=
  ⟨⟨c, none⟩, adaGap xv, .NoOutputDatum, none⟩

/-- An Owner withdrawal with its inputs and outputs given, one proof `(t, z)`. -/
def ownGapCtx (P M : ByteString) (ins : List TxInInfo) (outs : List TxOut) (t z : ByteString) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := ins,
    txInfoReferenceInputs := [refInputGap P M],
    txInfoOutputs         := outs,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- The wallet's own withdrawal: one box, nothing else in, one register out. -/
def soloCtx (P M a1 b1 t1 z1 s g u : ByteString) (amt : Integer) : ScriptContext :=
  ownGapCtx P M [⟨gref1, boxGap M a1 b1⟩] [registerGap s g u amt] t1 z1

def soloArgs (P M a1 b1 t1 z1 s g u : ByteString) (amt : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (soloCtx P M a1 b1 t1 z1 s g u amt)]

/-- Its `ctx`: `blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ M)`. -/
def soloHash (M s g u : ByteString) (amt : Integer) : Option ByteString :=
  match serialised (IsData.toData ([registerGap s g u amt] : List TxOut)), serialised (Data.List [IsData.toData gref1]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) M))
  | _, _ => none

def soloProof (M s g u : ByteString) (amt : Integer) (a b t z : ByteString) : Bool :=
  match soloHash M s g u amt with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- An input at `c` with no datum sorted before the box, then the box; one register out. -/
def firstCtx (P M a1 b1 t1 z1 : ByteString) (c : Credential) (xv : Integer) (s g u : ByteString) (amt : Integer) : ScriptContext :=
  ownGapCtx P M [⟨grefFirst, otherGap c xv⟩, ⟨gref1, boxGap M a1 b1⟩] [registerGap s g u amt] t1 z1

def firstArgs (P M a1 b1 t1 z1 : ByteString) (c : Credential) (xv : Integer) (s g u : ByteString) (amt : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (firstCtx P M a1 b1 t1 z1 c xv s g u amt)]

def firstHash (M s g u : ByteString) (amt : Integer) : Option ByteString :=
  match serialised (IsData.toData ([registerGap s g u amt] : List TxOut)),
        serialised (Data.List [IsData.toData grefFirst, IsData.toData gref1]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) M))
  | _, _ => none

def firstProof (M s g u : ByteString) (amt : Integer) (a b t z : ByteString) : Bool :=
  match firstHash M s g u amt with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- Two boxes in and one proof; one register out. -/
def twoOneCtx (P M a1 b1 a2 b2 t1 z1 s g u : ByteString) (amt : Integer) : ScriptContext :=
  ownGapCtx P M [⟨gref1, boxGap M a1 b1⟩, ⟨gref2, boxGap M a2 b2⟩] [registerGap s g u amt] t1 z1

def twoOneArgs (P M a1 b1 a2 b2 t1 z1 s g u : ByteString) (amt : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (twoOneCtx P M a1 b1 a2 b2 t1 z1 s g u amt)]

end Lovejoin.V2.OwnGap
