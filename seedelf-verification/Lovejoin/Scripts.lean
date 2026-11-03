import PlutusCore.UPLC

/-! Lovejoin's classic mainnet pool, byte for byte: Lovejoin c1239fb's
`artifacts/mainnet/`, the 2026-09-26 deployment (Aiken v1.1.24). `extract-lovejoin.sh`
checks each against the hash seedelf-core pins, and mix_box and mix_logic against the
reference scripts seedelf-core holds as they sit on chain: mix_box c145c10f…,
mix_logic 0dad3046…, fee_contract a072c7e8…, one_shot_mint f5592689… (the pool's NFT
policy), reference_holder 288fea77….

As in `Seedelf.Scripts`, only the import lives here. -/

namespace Lovejoin.Classic

#import_uplc mixBox          PlutusV3 single_cbor_hex "Lovejoin/Scripts/mix_box.hex"
#import_uplc mixLogic        PlutusV3 single_cbor_hex "Lovejoin/Scripts/mix_logic.hex"
#import_uplc feeContract     PlutusV3 single_cbor_hex "Lovejoin/Scripts/fee_contract.hex"
#import_uplc oneShotMint     PlutusV3 single_cbor_hex "Lovejoin/Scripts/one_shot_mint.hex"
#import_uplc referenceHolder PlutusV3 single_cbor_hex "Lovejoin/Scripts/reference_holder.hex"

end Lovejoin.Classic
