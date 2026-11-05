import Lovejoin.Owner
import Lovejoin.Steps
import Audit.Classic.Common

/-! The classic Owner withdrawal, concretely, through `appliedOwner.exec`: the computable twin of
the `appliedOwner.prop` that `Lovejoin.Classic.owner_withdraws_iff_proof` is stated over (the
same script, argument function and step limit, 10000). `Lovejoin.Steps` prints these runs
through its own stepper and nothing checks them; here a wrong answer fails the build.

The vector is `Lovejoin.Steps.ownerVector`, the proof `concrete/lovejoin_owner.sh` checks with
Aiken's evaluator, bound to 9 ₳ paid to `ownerPkh0`. Expected: 5 `#guard`s pass, no output.
A failure reads "Expression … did not evaluate to `true`". -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open Lovejoin.Classic (ownerVector ownerAccepts payout)
open Seedelf.V1 (g1 ofHex)

def ownerPkh0 : ByteString := ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb"
/-- Another key: `ownerPkh0` with its first byte changed. -/
def ownerPkh1 : ByteString := ofHex "ff112233445566778899aabbccddeeff00112233445566778899aabb"
def ownerZ1 : ByteString := ofHex "0000000000000000000000000000000000000000000000000000000000000001"

-- [A-G1] The vector exists: uncompress, scalarMul, compress and the serialiser all ran.
#guard Option.isSome ownerVector

-- [A-G2] The honest proof halts with unit, and the spec says true: the hypotheses of the
-- iff's ← direction hold under the real builtins, not only for some reading of the opaque ones.
#guard match ownerVector with
  | some (b, t, z) =>
      haltedUnitB (appliedOwner.exec g1 b t z ownerPkh0 9000000) && ownerAccepts g1 b t z (payout ownerPkh0 9000000)
  | none => false

-- [A-G3] The same proof with the payout a lovelace more errors, and the spec says false.
#guard match ownerVector with
  | some (b, t, z) =>
      erroredB (appliedOwner.exec g1 b t z ownerPkh0 9000001) && !ownerAccepts g1 b t z (payout ownerPkh0 9000001)
  | none => false

-- [A-G4] The same proof paying the same amount to another key errors, and the spec says false:
-- the replay the module doc rules out, on the real hash.
#guard match ownerVector with
  | some (b, t, z) =>
      erroredB (appliedOwner.exec g1 b t z ownerPkh1 9000000) && !ownerAccepts g1 b t z (payout ownerPkh1 9000000)
  | none => false

-- [A-G5] z changed errors, and the spec says false.
#guard match ownerVector with
  | some (b, t, _) =>
      erroredB (appliedOwner.exec g1 b t ownerZ1 ownerPkh0 9000000) && !ownerAccepts g1 b t ownerZ1 (payout ownerPkh0 9000000)
  | none => false

end Audit.Classic
