import Lake
open Lake DSL

package «SeedelfVerification» where
  moreGlobalServerArgs := #["--threads=4"]
  moreLeanArgs := #["--threads=4"]
  -- Chunk 41: our forks until upstream merges the fixes. Remove each when it lands.
  -- Lean-blaster: beta 46c8479 plus the #454 fix. PlutusCoreBlaster: main 1c23de8 plus
  -- the opaque ByteStringToInteger and Fq1.t as a Nat (its `seedelf` branch).
  require Blaster from git
    "https://github.com/logicalmechanism/Lean-blaster" @ "25c0ee0904c089333a56ff7036d184da0d9209cb"
  require PlutusCore from git
    "https://github.com/logicalmechanism/PlutusCoreBlaster" @ "1524b7ad2b2763ee1fb62b691506f1bdc3c7c299"
  -- Brings PlutusCoreBlaster (UPLC + CEK in Lean) and Blaster (the SMT tactic) with it.
  require CardanoLedgerApi from git
    "https://github.com/input-output-hk/CardanoLedgerApiBlaster" @ "9938562fd452351655fe2f6b63e583c62422687c"

@[default_target]
lean_lib «Seedelf» where

-- Minimal reproductions of the Blaster and PlutusCoreBlaster gaps that block
-- Seedelf's proofs, for upstream issues: `./check.sh upstream`.
lean_lib «Upstream» where
