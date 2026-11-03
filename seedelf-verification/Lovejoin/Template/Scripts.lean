import PlutusCore.UPLC

/-! mix_box's template, unapplied: `aiken build`'s `mix_box.mix_box.spend`, 2365a62d…, the
same at 8131b1d and at 5cc3631 (`templates_are_frozen`'s hash). Every pool runs it applied
to its own mix_logic hash L, one `Data` constant: the classic pool's c145c10f… is it at
the classic L 0dad3046…, and a v2 launch runs it at v2's. `extract-lovejoin-v2.sh` checks
the hash, and the classic one.

one_shot_mint's template, 6878ed6f…, the same at 8131b1d and 5cc3631, takes a launch's
seed and reference_holder's hash: at the mainnet 5 ₳ pool's seed it's that pool's NFT
policy, dc6abe3b…, which `extract-lovejoin-v2.sh` checks too.

The theorems on them take the parameters as the program's first arguments, symbolic, so
they hold for every pool on them at once. -/

namespace Lovejoin.Template

#import_uplc mixBoxTemplate PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/mix_box.hex"
#import_uplc oneShotMintTemplate PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/one_shot_mint.hex"

end Lovejoin.Template
