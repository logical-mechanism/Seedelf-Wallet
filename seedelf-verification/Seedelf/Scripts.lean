import PlutusCore.UPLC

/-! Variant 1, byte for byte: commit 5b82530's `contracts/`, seed `acabcafe`
applied. Each hex file is the script as the ledger hashes it (one CBOR layer):
wallet 94bca9c0…, seedelf 84967d91…, always_false 6777ba4d….

Only the import lives here. Each script's `#prep_uplc` is in its own module,
over a scenario that leaves symbolic just what its properties read: a fully
symbolic `ScriptContext` makes the symbolic CEK run branch on every list and
datum it meets, and took 52 GB before it was killed. -/

namespace Seedelf.V1

#import_uplc wallet      PlutusV3 single_cbor_hex "Seedelf/Scripts/wallet.hex"
#import_uplc seedelf     PlutusV3 single_cbor_hex "Seedelf/Scripts/seedelf.hex"
#import_uplc alwaysFalse PlutusV3 single_cbor_hex "Seedelf/Scripts/always_false.hex"

end Seedelf.V1
