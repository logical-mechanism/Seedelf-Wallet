import Lovejoin.V2.MixAny
import Lovejoin.V2.MixSpec

/-! v2's Mix of two boxes, for any v2 ADA pool and any boxes, its spec: `MixSpec`'s with
the pool's `M` and box value `bl`, and every box's points, as parameters. `branchHolds`,
`xorOfChallenges` and `sigmaOrHeader` are `MixSpec`'s already. The box value is
`assets.from_lovelace(bl)` as the stdlib builds it: `from_asset` gives `zero` for 0. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (serialised)
open Lovejoin.Template (nftName)

/-- `assets.from_lovelace(bl)` as Data. -/
def boxValueAny (bl : Integer) : Data :=
  if bl == 0 then .Map [] else .Map [(.B "", .Map [(.B "", .I bl)])]

/-- validate_mix's `ctx`: the boxes out's datums, the box value's twice, then `M`, hashed. -/
def mixContextAny (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 : ByteString) : Option ByteString :=
  match serialised (mixDatum oa1 ob1), serialised (mixDatum oa2 ob2), serialised (boxValueAny bl) with
  | some d1, some d2, some v =>
      some (blake2b_256 (appendByteString (appendByteString
        (appendByteString (appendByteString "" d1) d2) (appendByteString (appendByteString "" v) v)) M))
  | _, _, _ => none

/-- verify_pre's `c_global` for the box in `(a, b)`. -/
def challengeAny (a b oa1 ob1 oa2 ob2 t01 t11 t02 t12 ctx : ByteString) : ByteString :=
  let withBranches := appendByteString (appendByteString (appendByteString (appendByteString
    (sigmaOrHeader a b) oa1) ob1) oa2) ob2
  let withCommitments := appendByteString (appendByteString (appendByteString (appendByteString
    withBranches t01) t11) t02) t12
  blake2b_256 (appendByteString withCommitments ctx)

/-- A box in's challenge: its branches' `c`s xor to `c_global`. -/
def challengeHoldsAny (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 a b t01 t11 c1 t02 t12 c2 : ByteString) : Bool :=
  match mixContextAny M bl oa1 ob1 oa2 ob2, xorOfChallenges c1 c2 with
  | some ctx, some x => challengeAny a b oa1 ob1 oa2 ob2 t01 t11 t02 t12 ctx == x
  | _, _ => false

/-- verify_pre for the box in `(a, b)`: the challenge, then each branch against its box out. -/
def inputAcceptsAny (M : ByteString) (bl : Integer) (oa1 ob1 oa2 ob2 a b t01 t11 c1 z1 t02 t12 c2 z2 : ByteString) : Bool :=
  challengeHoldsAny M bl oa1 ob1 oa2 ob2 a b t01 t11 c1 t02 t12 c2 &&
    branchHolds a b oa1 ob1 t01 t11 c1 z1 && branchHolds a b oa2 ob2 t02 t12 c2 z2

/-- validate_mix: each box in's proof verifies. -/
def mixAcceptsAny (M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  inputAcceptsAny M bl oa1 ob1 oa2 ob2 a1 b1 t011 t111 c11 z11 t012 t112 c12 z12 &&
    inputAcceptsAny M bl oa1 ob1 oa2 ob2 a2 b2 t021 t121 c21 z21 t022 t122 c22 z22

/-- mix_logic's template's arguments: the pool's NFT, then the Mix. -/
def anyArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2.Any
