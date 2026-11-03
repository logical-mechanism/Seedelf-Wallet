import Lovejoin.V2.Mix
import Lovejoin.Logic

/-! v2's Mix, its spec: what `validate_mix` and `sigma_or.verify_pre` check of the KAT's
two proofs, line for line, with n = 2 unrolled. The outputs, the inputs and the box
value are the KAT's (`V2.Mix`), so the spec takes only the proofs' fields: input i's
branch j is `(t0ij, t1ij, cij, zij)`.

The builtins are called as the script calls them (README rule 7): `serialise_data`,
`bytearray_to_integer` and `xor_bytearray` through their opaque aliases, the hash and
the G1 operations opaque, `scalar.from_int` as `Int.fmod`, `g1.scale(p, k)` as
`scalarMul k p`, and each point's uncompression where the script uncompresses it. An
uncompression is a pure function of its bytes, so taking it again for each branch is the
same term as the script's one. -/

namespace Lovejoin.V2
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque xorByteStringOpaque)
open Lovejoin.Classic (q serialised)

/-- The ADA pool's box value as Data: `assets.from_lovelace(10 ₳)`. -/
def boxValueData : Data := .Map [(.B "", .Map [(.B "", .I 10000000)])]

/-- validate_mix's `ctx`: `blake2b_256(datums ‖ values ‖ mix_script_hash)`, where `datums`
appends each box out's `serialise_data(inline datum)` and `values` the box value's
serialisation once a box, both from `#""`. -/
def mixContext : Option ByteString :=
  match serialised (mixDatum outA1 outB1), serialised (mixDatum outA2 outB2), serialised boxValueData with
  | some d1, some d2, some v =>
      some (blake2b_256 (appendByteString (appendByteString
        (appendByteString (appendByteString "" d1) d2) (appendByteString (appendByteString "" v) v)) mixBoxHash))
  | _, _, _ => none

/-- hash.ak's header with its prefix: `domain_tag_v1 ‖ #03 ‖ n (1 byte) ‖ a ‖ b`, n = 2. -/
def sigmaOrHeader (a b : ByteString) : ByteString :=
  appendByteString (appendByteString (appendByteString (appendByteString
    ("lovejoin/sigmajoin/v1/" : ByteString) "\x03") "\x02") a) b

/-- verify_pre's `c_global`: the header, each statement's `ap ‖ bp` (the boxes out), each
branch's `t0 ‖ t1`, then `ctx`, hashed. -/
def challenge (a b t01 t11 t02 t12 ctx : ByteString) : ByteString :=
  let withBranches := appendByteString (appendByteString (appendByteString (appendByteString
    (sigmaOrHeader a b) outA1) outB1) outA2) outB2
  let withCommitments := appendByteString (appendByteString (appendByteString (appendByteString
    withBranches t01) t11) t02) t12
  blake2b_256 (appendByteString withCommitments ctx)

/-- 32 zero bytes, written out as the script's constant is. Through `ofHex`, a recursive
parser, the spec's xor fold needn't start from the same term as the script's, and
`MixFirst`'s first build came back Falsified with every field zero. -/
def zero32 : ByteString := ⟨"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"⟩

/-- xor32, as the script runs it: both operands 32 bytes, then the builtin with `False`. -/
def xor32 (left right : ByteString) : Option ByteString :=
  if lengthOfByteString left == 32 && lengthOfByteString right == 32 then
    some ⟨xorByteStringOpaque false left.data right.data⟩
  else none

/-- The fold of xor32 over the two branches' `c`s, from 32 zero bytes. -/
def xorOfChallenges (c1 c2 : ByteString) : Option ByteString :=
  match xor32 zero32 c1 with
  | some x => xor32 x c2
  | none => none

/-- One branch against its statement `(ap, bp)`, for the input `(a, b)`: `z` 32 bytes below
the field order, then `z·a = t0 + c·ap` and `z·b = t1 + c·bp`, `c` read modulo the order. -/
def branchHolds (a b ap bp t0 t1 c z : ByteString) : Bool :=
  match bls12_381_G1_uncompress a, bls12_381_G1_uncompress b, bls12_381_G1_uncompress ap,
        bls12_381_G1_uncompress bp, bls12_381_G1_uncompress t0, bls12_381_G1_uncompress t1 with
  | .ok A, .ok B, .ok AP, .ok BP, .ok T0, .ok T1 =>
      let zi := byteStringToIntegerOpaque true z.data
      if lengthOfByteString z == 32 && decide (zi < q) then
        let zs := Int.fmod zi q
        let cs := Int.fmod (byteStringToIntegerOpaque true c.data) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul zs A) (bls12_381_G1_add T0 (bls12_381_G1_scalarMul cs AP)) &&
          bls12_381_G1_equal (bls12_381_G1_scalarMul zs B) (bls12_381_G1_add T1 (bls12_381_G1_scalarMul cs BP))
      else false
  | _, _, _, _, _, _ => false

/-- verify_pre for the input `(a, b)` and its two branches: the branches' `c`s xor to
`c_global`, and each branch holds against its box out. -/
def verifyPre (a b t01 t11 c1 z1 t02 t12 c2 z2 ctx : ByteString) : Bool :=
  match xorOfChallenges c1 c2 with
  | some x =>
      challenge a b t01 t11 t02 t12 ctx == x &&
        branchHolds a b outA1 outB1 t01 t11 c1 z1 && branchHolds a b outA2 outB2 t02 t12 c2 z2
  | none => false

/-- validate_mix on the KAT's transaction: each box in's proof verifies against the boxes
out, under the one `ctx`. -/
def mixAccepts (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  match mixContext with
  | some ctx =>
      verifyPre inA1 inB1 t011 t111 c11 z11 t012 t112 c12 z12 ctx &&
        verifyPre inA2 inB2 t021 t121 c21 z21 t022 t122 c22 z22 ctx
  | none => false

/-- The redeemer for those fields. -/
def proofsRedeemer (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Data :=
  mixRedeemer [[branch t011 t111 c11 z11, branch t012 t112 c12 z12],
               [branch t021 t121 c21 z21, branch t022 t122 c22 z22]]

end Lovejoin.V2
