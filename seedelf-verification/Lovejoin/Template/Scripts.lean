import PlutusCore.UPLC

/-! mix_box's template, unapplied: `aiken build`'s `mix_box.mix_box.spend`, 2365a62d…, the
same at 8131b1d and at 5cc3631 (`templates_are_frozen`'s hash). Every pool runs it applied
to its own mix_logic hash L, one `Data` constant: the classic pool's c145c10f… is it at
the classic L 0dad3046…, and a v2 launch runs it at v2's. `extract-lovejoin-v2.sh` checks
the hash, and the classic one.

The theorems on it take L as the program's first argument, symbolic, so they hold for
every pool on it at once. -/

namespace Lovejoin.Template

#import_uplc mixBoxTemplate PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/mix_box.hex"

end Lovejoin.Template
