import Lovejoin.Logic
import Lovejoin.Template.Scripts
import Lovejoin.Template.Launch
import Seedelf.AnyTx
import Seedelf.AnyTxSteps

/-! Lovejoin v2 in every transaction: what the `Lovejoin.AnyTx` modules share
(`gen-lovejoin-anytx.py` writes the rest). As in Seedelf's `AnyTx`, the context is `Data`
built as the ledger encodes it, and every field a script doesn't read is a `Data` of its own:
any value at all, values the ledger never produces included. What each script reads, from v2's
bytes (`aiken uplc decode`):

- mix_box: the inputs up to its own, found by reference, and on the gate branch the
  withdrawals up to mix_logic's credential. Never an amount, never anything after.
- mix_logic's Owner branch: every input (its payment credential; at mix_box, its datum; its
  reference, into the hash), every reference input (the pool's NFT, then the carrier's datum),
  and the outputs, hashed whole. Nothing else in the transaction.

So a theorem fixes only the lengths of the lists a script walks and the shape of what it takes
apart: how many inputs come before a box and of which kind, the reference inputs' layout, and
how many withdrawals come before mix_logic's. -/

namespace Lovejoin.AnyTx
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Seedelf.V1 (TxRest g1 ofHex)
open Lovejoin.Classic (wellFormed serialised schnorrVerifies fsHashSchnorr q)
open Lovejoin.Template (nftName)

/-! ### Transactions -/

/-- A TxInfo with these inputs, reference inputs and signatories, every other field `r`'s. -/
def withInputs (r : TxRest) (ins refs sigs : Data) : Data :=
  .Constr 0 [ins, refs, r.outputs, r.fee, r.mint, r.certs, r.withdrawals, r.validRange, sigs,
    r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury, r.donation]

/-- A TxInfo with these inputs, withdrawals and signatories, every other field `r`'s. -/
def withInputsWdrl (r : TxRest) (ins wdrl sigs : Data) : Data :=
  .Constr 0 [ins, r.referenceInputs, r.outputs, r.fee, r.mint, r.certs, wdrl, r.validRange, sigs,
    r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury, r.donation]

/-- An input: its reference, and the output it spends, at the payment credential `cred` with
the stake part `st`, the value `v`, the datum `d` and the reference script `rs`. -/
def input (ref cred st v d rs : Data) : Data :=
  .Constr 0 [ref, .Constr 0 [.Constr 0 [cred, st], v, d, rs]]

/-- A box: an input at mix_box `M`, its datum `(a, b)` inline. -/
def boxIn (ref : Data) (M : ByteString) (st v rs : Data) (a b : ByteString) : Data :=
  input ref (.Constr 1 [.B M]) st v (.Constr 2 [.Constr 0 [.B a, .B b]]) rs

/-- An input at the payment credential `Constr c [B h]`: a key's (`c = 0`), or a script's. -/
def otherIn (ref : Data) (c : Integer) (h : ByteString) (st v d rs : Data) : Data :=
  input ref (.Constr c [.B h]) st v d rs

/-- An input at mix_box `M` whose inline datum `x` isn't a well-formed box (a sweep's, say). -/
def junkIn (ref : Data) (M : ByteString) (st v x rs : Data) : Data :=
  input ref (.Constr 1 [.B M]) st v (.Constr 2 [x]) rs

/-- `try_decode_well_formed_data`: an inline datum mix_logic counts as a box. -/
def isBoxDatum : Data → Bool
  | .Constr 0 [.B a, .B b] => wellFormed a b
  | _ => false

/-- The pool's reference input: the NFT `(P, nftName)` after the lovelace entry `va`, and the
`ReferenceDatum` inline, mix_box `M` at field 5 and every other field any value of its kind. -/
def carrierRef (rref raddr va rrs : Data) (P M : ByteString) (bv : Integer) (tp tn : ByteString)
    (tq fc : Integer) (lh fh : ByteString) : Data :=
  .Constr 0 [rref, .Constr 0 [raddr, .Map [(.B "", va), (.B P, .Map [(.B nftName, .I 1)])],
    .Constr 2 [.Constr 0 [.I bv, .B tp, .B tn, .I tq, .I fc, .B M, .B lh, .B fh]], rrs]]

/-- Another reference input (a reference script's, say): lovelace alone, any address, datum
and reference script. -/
def otherRef (nref naddr va nd nrs : Data) : Data :=
  .Constr 0 [nref, .Constr 0 [naddr, .Map [(.B "", va)], nd, nrs]]

/-- A box's Owner proof `(t, z)` as the redeemer lists it. -/
def proofData (t z : ByteString) : Data := .Constr 0 [.B t, .B z]

/-- An Owner withdrawal in any transaction: mix_logic's withdrawal purpose, any account. -/
def ownerCtx (r : TxRest) (ins refs sigs acct : Data) (proofs : List Data) : Data :=
  .Constr 0 [withInputs r ins refs sigs, .Constr 0 [.List proofs], .Constr 2 [acct]]

/-- A spend of the box at `ref` (its resolved datum `rd`, any redeemer `red`), in any
transaction: the inputs `ins`, the withdrawals `wdrl`. -/
def boxSpendCtx (r : TxRest) (ins wdrl sigs red ref rd : Data) : Data :=
  .Constr 0 [withInputsWdrl r ins wdrl sigs, red, .Constr 1 [ref, rd]]

/-- The box being spent, at `ref`, its output's own datum field `od`. -/
def ownBox (ref addr v od rs : Data) : Data := .Constr 0 [ref, .Constr 0 [addr, v, od, rs]]

/-- An input ahead of it: mix_box compares only its reference with the box's. -/
def priorIn (p o : Data) : Data := .Constr 0 [p, o]

/-- mix_logic's withdrawal, as the ledger keys it: `Script(L)`. -/
def logicKey (L : ByteString) : Data := .Constr 1 [.B L]

/-! ### Specs -/

/-- validate_owner's `ctx` in any transaction: `blake2b_256(serialise(outputs) ‖ serialise(every
input's reference) ‖ M)`, through the builtin's own encoder. -/
def ownerHash (M : ByteString) (outs : Data) (refs : List Data) : Option ByteString :=
  match serialised outs, serialised (.List refs) with
  | some o, some rr => some (blake2b_256 (appendByteString (appendByteString o rr) M))
  | _, _ => none

/-- A box's proof verifies against that `ctx`. -/
def ownProof (M : ByteString) (outs : Data) (refs : List Data) (a b t z : ByteString) : Bool :=
  match ownerHash M outs refs with
  | some h => schnorrVerifies a b t z h
  | none => false

/-! ### Concrete runs -/

/-- The Schnorr proof `(t, z)` for the box `(g1, x·g1)` with nonce `r`, bound to `h`
(`Lovejoin.V2.Own1.prove`). An honest proof, made with the builtins' own implementations. -/
def proveFor (x r : Integer) (b h : ByteString) : Option (ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t h).data)) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (t, ⟨z⟩)

/-- Box i's second point, `x·g1` with x = 0x5eed0e1f + i. -/
def honestB (x : Integer) : Option ByteString := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  pure (bls12_381_G1_compress (bls12_381_G1_scalarMul x G))

def testP : ByteString := ofHex "abababababababababababababababababababababababababababab"
def testM : ByteString := ofHex "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
def testL : ByteString := ofHex "66666666666666666666666666666666666666666666666666666666"
def testKey : ByteString := ofHex "1111111111111111111111111111111111111111111111111111111111"
/-- A concrete reference, `txid#i`. -/
def refAt (i : Integer) : Data := .Constr 0 [.B (ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"), .I i]
/-- A value of `n` lovelace alone. -/
def adaValue (n : Integer) : Data := .Map [(.B "", .Map [(.B "", .I n)])]
/-- A box's 48-byte other point, for runs where its proof is never checked. -/
def otherPoint : ByteString := ofHex "a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"

end Lovejoin.AnyTx
