import Lake
open Lake DSL

package «SeedelfVerification» where
  moreGlobalServerArgs := #["--threads=4"]
  moreLeanArgs := #["--threads=4"]
  -- Chunk 41: our forks until upstream merges the fixes. Remove each when it lands.
  -- Lean-blaster: beta 46c8479 plus the #454 fix. PlutusCoreBlaster: main 1c23de8 plus
  -- the opaque ByteStringToInteger, Fq1.t as a Nat, the BLS12-381 builtins' operands in
  -- order and #27's opaque SerializeData (its `seedelf` branch; #27 for Lovejoin, chunk 42).
  -- PlutusCoreBlaster is the fork's `opaque-xor`: seedelf 1e38b23, with the #71 and #72
  -- review rounds, plus an opaque XorByteString for Lovejoin's xor32 (chunk 42).
  require Blaster from git
    "https://github.com/logicalmechanism/Lean-blaster" @ "25c0ee0904c089333a56ff7036d184da0d9209cb"
  require PlutusCore from git
    "https://github.com/logicalmechanism/PlutusCoreBlaster" @ "68c5399b7ded5726cf1e22f644c42a551a05f9d2"
  -- Brings PlutusCoreBlaster (UPLC + CEK in Lean) and Blaster (the SMT tactic) with it.
  require CardanoLedgerApi from git
    "https://github.com/input-output-hk/CardanoLedgerApiBlaster" @ "9938562fd452351655fe2f6b63e583c62422687c"

@[default_target]
lean_lib «Seedelf» where

-- Lovejoin: the classic mainnet pool and v2 (chunk 42): `./extract-lovejoin.sh` and
-- `./extract-lovejoin-v2.sh`, then `./check.sh lovejoin` and `./check.sh lovejoin-v2`.
lean_lib «Lovejoin» where

-- Minimal reproductions of the Blaster and PlutusCoreBlaster gaps that block
-- Seedelf's proofs, for upstream issues: `./check.sh upstream`.
lean_lib «Upstream» where

-- The audit of the proofs above: mutation and negative-control suites, and the
-- modules that close the gaps it found. `./check.sh audit-quick` first; Audit/README.md.
lean_lib «Audit» where
