import Lake
open Lake DSL

package «SeedelfVerification» where
  moreGlobalServerArgs := #["--threads=4"]
  moreLeanArgs := #["--threads=4"]
  -- Brings PlutusCoreBlaster (UPLC + CEK in Lean) and Blaster (the SMT tactic) with it.
  require CardanoLedgerApi from git
    "https://github.com/input-output-hk/CardanoLedgerApiBlaster" @ "9938562fd452351655fe2f6b63e583c62422687c"

@[default_target]
lean_lib «Seedelf» where
