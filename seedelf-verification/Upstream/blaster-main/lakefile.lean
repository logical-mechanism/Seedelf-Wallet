import Lake
open Lake DSL

-- Upstream/ExceptParams.lean against Lean-blaster `main`, where
-- `genIndParams` doesn't hash-cons the inductive's type. Pure Blaster: no
-- PlutusCore. `../../check.sh upstream-main` builds it under the memory cap.
package «BlasterMain» where
  require Blaster from git
    "https://github.com/input-output-hk/Lean-blaster" @ "a16614e5e44a693664043552f259235f15f1c884"

lean_lib «BlasterMain» where
