import Lovejoin.V2.MixSpec

/-! v2's Mix, n = 2: the KAT's transaction succeeds iff each box in's sigma-OR proof
verifies against the boxes out (`mixAccepts`, line for line with `verify_pre`), with
every field of both proofs symbolic: 4 branches of `(t0, t1, c, z)`. So a Mix moves
boxes only with a proof for each, bound to the outputs it pays, and nothing else gets it
through.

As one iff it ran past 30 minutes, so it's in three parts: a Mix fails if box in 1's
proof doesn't verify (`MixFirst`), and if box in 2's doesn't (`MixSecond`). With both
verifying, it succeeds (`MixPasses`). Each part keeps every field of both proofs
symbolic. `mixAccepts` is the two halves' `&&` (`MixPasses`' `mixAccepts_halves`), so
the three together are the iff, failure stated as `isUnsuccessful`.

With `MixOutputs` and `MixDatums` (what a Mix must pay) and `MixChallenges` (the fix),
this is step 5's (b) on v2. The crypto is opaque: the theorems say the script checks
exactly these equations, not that they're hard to fake. Each part's step limit sits
above the KAT's run in `V2.Steps` (11497), where `mixAccepts` is `true` on the KAT's own
proofs. Each runs `blaster (timeout: 1200) (verbose: 1)`: a solver past 20 minutes
leaves the goal unsolved, so the module fails, and the log times each phase. -/

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

/-- Box in 1's challenge: its branches' `c`s xor to `c_global`. -/
def firstChallengeHolds (t011 t111 c11 t012 t112 c12 : ByteString) : Bool :=
  match mixContext, xorOfChallenges c11 c12 with
  | some ctx, some x => challenge inA1 inB1 t011 t111 t012 t112 ctx == x
  | _, _ => false

/-- Box in 2's. -/
def secondChallengeHolds (t021 t121 c21 t022 t122 c22 : ByteString) : Bool :=
  match mixContext, xorOfChallenges c21 c22 with
  | some ctx, some x => challenge inA2 inB2 t021 t121 t022 t122 ctx == x
  | _, _ => false

def splitArgs (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm (mixCtx (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

end Lovejoin.V2
