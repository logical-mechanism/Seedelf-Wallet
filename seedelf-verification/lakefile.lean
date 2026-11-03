import Lake
open Lake DSL

package «SeedelfVerification» where
  moreGlobalServerArgs := #["--threads=4"]
  moreLeanArgs := #["--threads=4"]
  -- Chunk 41: our forks until upstream merges the fixes. Remove each when it lands.
  -- Lean-blaster: beta 46c8479 plus the #454 fix. PlutusCoreBlaster: main 1c23de8 plus
  -- the opaque ByteStringToInteger, Fq1.t as a Nat, the BLS12-381 builtins' operands in
  -- order and #27's opaque SerializeData (its `seedelf` branch; #27 for Lovejoin, chunk 42).
  -- Here, on the local-only branch, PlutusCoreBlaster is the local clone's
  -- `local/opaque-xor` (seedelf 7fc0aa3 plus an opaque XorByteString), which is never
  -- pushed: chunk 42's xor32 work motivated it.
  require Blaster from git
    "https://github.com/logicalmechanism/Lean-blaster" @ "25c0ee0904c089333a56ff7036d184da0d9209cb"
  require PlutusCore from git
    "/home/logic/Documents/LogicalMechanism/blaster-forks/PlutusCoreBlaster" @ "96a36cb8d82bf9bdbb9276aa1b7cf42f53f394b8"
  -- Brings PlutusCoreBlaster (UPLC + CEK in Lean) and Blaster (the SMT tactic) with it.
  require CardanoLedgerApi from git
    "https://github.com/input-output-hk/CardanoLedgerApiBlaster" @ "9938562fd452351655fe2f6b63e583c62422687c"

@[default_target]
lean_lib «Seedelf» where

-- Lovejoin's classic mainnet pool (local branch lovejoin-verification, chunk 42):
-- `./extract-lovejoin.sh`, then `./check.sh lovejoin`.
lean_lib «Lovejoin» where

-- Minimal reproductions of the Blaster and PlutusCoreBlaster gaps that block
-- Seedelf's proofs, for upstream issues: `./check.sh upstream`.
lean_lib «Upstream» where
