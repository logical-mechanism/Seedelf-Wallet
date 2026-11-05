import PlutusCore.UPLC

/-! Lovejoin's token-pool templates with xor32's two length checks ("v2"): the local-only
clone `../../lovejoin-v2` at 5cc3631, which is 8131b1d (the templates seedelf-core pins)
plus the fix, built with Aiken v1.1.24. Only mix_logic's bytes differ from 8131b1d's:
unapplied 7fb45b75…, where 8131b1d's is 62befd1e….

mix_logic is applied to the test launch Lovejoin's own KATs use (`test_fixtures.ak`: the
NFT policy `abab…`, the name `lovejoin`), and hashes to 60294352…. `extract-lovejoin-v2.sh`
checks all five templates' unapplied hashes, then that one.

As in `Lovejoin.Scripts`, only the import lives here. -/

namespace Lovejoin.V2

#import_uplc mixLogicV2 PlutusV3 single_cbor_hex "Lovejoin/V2/Scripts/mix_logic.hex"

end Lovejoin.V2
