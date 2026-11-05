import PlutusCore.UPLC

/-! The Seedelf policy (84967d91…), byte for byte: the main package's
`Seedelf/Scripts/seedelf.hex`, which `../extract.sh` writes from commit 5b82530's
`contracts/` after checking it against the on-chain hash. One CBOR layer, as the
ledger hashes it.

This package runs on PlutusCoreBlaster's local-only `local/opaque-slice`, where
the SliceByteString builtin calls an `opaque` alias (`lakefile.lean`). The bytes
are the same; only how a symbolic run sees a slice differs. `check.sh` builds
from `Slice/`, so the path reaches the main package's copy, not a second one. -/

namespace Seedelf.V1

#import_uplc seedelfSlicePolicy PlutusV3 single_cbor_hex "../Seedelf/Scripts/seedelf.hex"

end Seedelf.V1
