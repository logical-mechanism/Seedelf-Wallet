import Lake
open Lake DSL

-- The Seedelf policy's rule in every transaction, over PlutusCoreBlaster with the
-- SliceByteString builtin opaque: the clone's local-only `local/opaque-slice` (96261cc),
-- which is the main package's pin (68c5399) plus that alias. Its own package, so the main
-- package's pin, and every Seedelf and Lovejoin proof on it, stay as they are. Blaster and
-- CardanoLedgerApiBlaster are pinned as in ../lakefile.lean. `../check.sh seedelf-slice`.
package «Slice» where
  moreGlobalServerArgs := #["--threads=4"]
  moreLeanArgs := #["--threads=4"]
  require Blaster from git
    "https://github.com/logicalmechanism/Lean-blaster" @ "25c0ee0904c089333a56ff7036d184da0d9209cb"
  require PlutusCore from git
    "/home/logic/Documents/LogicalMechanism/blaster-forks/PlutusCoreBlaster" @ "96261ccb9b936ab6229e9e3700d342f8568eb319"
  require CardanoLedgerApi from git
    "https://github.com/input-output-hk/CardanoLedgerApiBlaster" @ "9938562fd452351655fe2f6b63e583c62422687c"

@[default_target]
lean_lib «Slice» where
