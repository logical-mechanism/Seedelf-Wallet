import Lovejoin.V2.Mix3
import Lovejoin.V2.MixSpec

/-! v2's Mix at n = 3, its spec: `MixSpec`'s with three boxes in and three out, unrolled.
`branchHolds` (with a box out's point as the script stores it), `xor32`, `zero32` and
`boxValueData` don't depend on n, so they're `MixSpec`'s. The context, the header (its n
byte `03`), the challenge and the fold of the `c`s take three. Input i's branch j is
`(t0ij, t1ij, cij, zij)`.

`mixAccepts3` is the `&&` of each box's `inputAccepts3`, and each of those the `&&` of its
four checks, so the theorems on each check (`Mix3First`, `Mix3Second`, `Mix3Third`)
cover every way a Mix can fail, with no tie-in lemma. -/

namespace Lovejoin.V2.N3
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (serialised)

/-- validate_mix's `ctx` for three boxes out: their datums' serialisations, the box value's
three times, then mix_box's hash, hashed. -/
def mixContext3 : Option ByteString :=
  match serialised (mixDatum aOut1 bOut1), serialised (mixDatum aOut2 bOut2), serialised (mixDatum aOut3 bOut3),
        serialised boxValueData with
  | some d1, some d2, some d3, some v =>
      some (blake2b_256 (appendByteString (appendByteString
        (appendByteString (appendByteString (appendByteString "" d1) d2) d3)
        (appendByteString (appendByteString (appendByteString "" v) v) v)) mixBoxHash))
  | _, _, _, _ => none

/-- hash.ak's header with its prefix, n = 3: `domain_tag_v1 ‖ #03 ‖ #03 ‖ a ‖ b`. -/
def sigmaOrHeader3 (a b : ByteString) : ByteString :=
  appendByteString (appendByteString (appendByteString (appendByteString
    ("lovejoin/sigmajoin/v1/" : ByteString) "\x03") "\x03") a) b

/-- verify_pre's `c_global` at n = 3: the header, each box out's `a' ‖ b'`, each branch's
`t0 ‖ t1`, then `ctx`, hashed. -/
def challenge3 (a b t01 t11 t02 t12 t03 t13 ctx : ByteString) : ByteString :=
  let withBranches := appendByteString (appendByteString (appendByteString (appendByteString
    (appendByteString (appendByteString (sigmaOrHeader3 a b) aOut1) bOut1) aOut2) bOut2) aOut3) bOut3
  let withCommitments := appendByteString (appendByteString (appendByteString (appendByteString
    (appendByteString (appendByteString withBranches t01) t11) t02) t12) t03) t13
  blake2b_256 (appendByteString withCommitments ctx)

/-- The fold of xor32 over three branches' `c`s, from 32 zero bytes. -/
def xorOfChallenges3 (c1 c2 c3 : ByteString) : Option ByteString :=
  match xor32 zero32 c1 with
  | some x =>
      match xor32 x c2 with
      | some y => xor32 y c3
      | none => none
  | none => none

/-- A box in's challenge: its branches' `c`s xor to `c_global`. -/
def challengeHolds3 (a b t01 t11 c1 t02 t12 c2 t03 t13 c3 : ByteString) : Bool :=
  match mixContext3, xorOfChallenges3 c1 c2 c3 with
  | some ctx, some x => challenge3 a b t01 t11 t02 t12 t03 t13 ctx == x
  | _, _ => false

/-- verify_pre for the box in `(a, b)` and its three branches: the challenge, then each
branch against its box out. -/
def inputAccepts3 (a b t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 : ByteString) : Bool :=
  challengeHolds3 a b t01 t11 c1 t02 t12 c2 t03 t13 c3 &&
    branchHolds a b aOut1 bOut1 t01 t11 c1 z1 &&
    branchHolds a b aOut2 bOut2 t02 t12 c2 z2 &&
    branchHolds a b aOut3 bOut3 t03 t13 c3 z3

/-- validate_mix on the KAT's three boxes: each box in's proof verifies. -/
def mixAccepts3 (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : Bool :=
  inputAccepts3 aIn1 bIn1 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 &&
    inputAccepts3 aIn2 bIn2 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 &&
    inputAccepts3 aIn3 bIn3 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33

def mix3Args (t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : List Term :=
  [toTerm (mixCtx3 (proofs3Redeemer t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

end Lovejoin.V2.N3
