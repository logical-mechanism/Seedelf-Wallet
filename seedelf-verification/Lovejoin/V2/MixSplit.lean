import Lovejoin.V2.MixSpec

/-! v2's Mix iff (`MixProofs`) in three parts, for the solver: a Mix fails if box in 1's
proof doesn't verify (`MixFirst`), and if box in 2's doesn't (`MixSecond`). With both
verifying, it succeeds (`MixPasses`). Each part keeps every field of both proofs
symbolic. `mixAccepts` is the two halves' `&&` (`MixPasses`' `mixAccepts_halves`), so
the three together are `MixProofs`' iff, failure stated as `isUnsuccessful`. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term)

/-- Box in 1's proof, as `mixAccepts` checks it. -/
def firstAccepts (t011 t111 c11 z11 t012 t112 c12 z12 : ByteString) : Bool :=
  match mixContext with
  | some ctx => verifyPre inA1 inB1 t011 t111 c11 z11 t012 t112 c12 z12 ctx
  | none => false

/-- Box in 2's. -/
def secondAccepts (t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : Bool :=
  match mixContext with
  | some ctx => verifyPre inA2 inB2 t021 t121 c21 z21 t022 t122 c22 z22 ctx
  | none => false

def splitArgs (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm (mixCtx (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2
