import Lovejoin.V2.MixAny3
import Lovejoin.V2.MixSpec

/-! v2's Mix of 3, for any v2 ADA pool and any boxes, its spec: `V2.MixAnySpec`'s at n = 3.
`branchHolds` (a box out's point as the script stores it), `xor32` and `zero32` are
`MixSpec`'s. Written by `gen-lovejoin-mix.py`.

`mixAcceptsPool` is the `&&` of each box's `inputAcceptsPool`, and each of those the `&&`
of its challenge and its branches, so the theorems on each check cover every way a Mix
can fail, with no tie-in lemma. -/

namespace Lovejoin.V2.Any3
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (serialised)
open Lovejoin.Template (nftName)

/-- `value.box_value` for an ADA pool: `assets.from_lovelace(bl)`, `zero` for 0. -/
def boxValuePool (bl : Integer) : Data :=
  if bl == 0 then .Map [] else .Map [(.B "", .Map [(.B "", .I bl)])]

/-- validate_mix's `ctx`: the boxes out's datums, the box value's 3 times, then `M`, hashed. -/
def mixContextPool (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) : Option ByteString :=
  match serialised (mixDatum oa1 ob1), serialised (mixDatum oa2 ob2), serialised (mixDatum oa3 ob3), serialised (boxValuePool bl) with
  | some d1, some d2, some d3, some v =>
      some (blake2b_256 (appendByteString (appendByteString (appendByteString (appendByteString (appendByteString "" d1) d2) d3) (appendByteString (appendByteString (appendByteString "" v) v) v)) M))
  | _, _, _, _ => none

/-- hash.ak's header with its prefix: `domain_tag_v1 ‖ #03 ‖ n (1 byte) ‖ a ‖ b`, n = 3. -/
def sigmaOrHeaderPool (a b : ByteString) : ByteString :=
  appendByteString (appendByteString (appendByteString (appendByteString
    ("lovejoin/sigmajoin/v1/" : ByteString) "\x03") "\x03") a) b

/-- verify_pre's `c_global` for the box in `(a, b)`. -/
def challengePool (a b oa1 ob1 oa2 ob2 oa3 ob3 t01 t11 t02 t12 t03 t13 ctx : ByteString) : ByteString :=
  let withBranches := (appendByteString (appendByteString (appendByteString (appendByteString (appendByteString (appendByteString (sigmaOrHeaderPool a b) oa1) ob1) oa2) ob2) oa3) ob3)
  let withCommitments := (appendByteString (appendByteString (appendByteString (appendByteString (appendByteString (appendByteString withBranches t01) t11) t02) t12) t03) t13)
  blake2b_256 (appendByteString withCommitments ctx)

/-- The fold of xor32 over the branches' `c`s, from 32 zero bytes. -/
def xorOfChallengesPool (c1 c2 c3 : ByteString) : Option ByteString :=
  match xor32 zero32 c1 with
  | some x1 =>
      match xor32 x1 c2 with
      | some x2 =>
          xor32 x2 c3
      | none => none
  | none => none

/-- A box in's challenge: its branches' `c`s xor to `c_global`. -/
def challengeHoldsPool (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 oa3 ob3 a b t01 t11 c1 t02 t12 c2 t03 t13 c3 : ByteString) : Bool :=
  match mixContextPool M bl oa1 ob1 oa2 ob2 oa3 ob3, xorOfChallengesPool c1 c2 c3 with
  | some ctx, some x => challengePool a b oa1 ob1 oa2 ob2 oa3 ob3 t01 t11 t02 t12 t03 t13 ctx == x
  | _, _ => false

/-- verify_pre for the box in `(a, b)`: the challenge, then each branch against its box out. -/
def inputAcceptsPool (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 oa3 ob3 a b t01 t11 c1 z1 t02 t12 c2 z2 t03 t13 c3 z3 : ByteString) : Bool :=
  challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a b t01 t11 c1 t02 t12 c2 t03 t13 c3 &&
    branchHolds a b oa1 ob1 t01 t11 c1 z1 &&
    branchHolds a b oa2 ob2 t02 t12 c2 z2 &&
    branchHolds a b oa3 ob3 t03 t13 c3 z3

/-- validate_mix: each box in's proof verifies. -/
def mixAcceptsPool (M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : Bool :=
  inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a2 b2 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 &&
    inputAcceptsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a3 b3 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33

/-- mix_logic's template's arguments: the pool's NFT, then the Mix. -/
def argsPool (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxPool P M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 (proofsRedeemerPool t011 t111 c11 z11 t012 t112 c12 z12 t013 t113 c13 z13 t021 t121 c21 z21 t022 t122 c22 z22 t023 t123 c23 z23 t031 t131 c31 z31 t032 t132 c32 z32 t033 t133 c33 z33))]

end Lovejoin.V2.Any3
