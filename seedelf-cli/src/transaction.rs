use crate::constants::{
    MAINNET_COLLATERAL_UTXO, MAINNET_SEEDELF_REFERENCE_UTXO, MAINNET_WALLET_REFERENCE_UTXO,
    PREPROD_COLLATERAL_UTXO, PREPROD_SEEDELF_REFERENCE_UTXO, PREPROD_WALLET_REFERENCE_UTXO,
};
use pallas_primitives::Fragment;
use pallas_txbuilder::{Input, Output};

pub fn calculate_min_required_utxo(output: Output) -> u64 {
    // we need the output in the post alonzo form so we can encode it
    let output_cbor_length: u64 = output
        .build_babbage_raw()
        .unwrap()
        .encode_fragment()
        .unwrap()
        .len()
        .try_into()
        .unwrap();
    // 160 is overhead constant, 4310 is the utxoCostPerByte
    let overhead_cost: u64 = 160;
    let utxo_cost_per_byte: u64 = 4310;
    // sum the overhead and length times the cost per byte
    (overhead_cost + output_cbor_length) * utxo_cost_per_byte
}

pub fn collateral_input(network_flag: bool) -> Input {
    let utxo = if network_flag {
        PREPROD_COLLATERAL_UTXO
    } else {
        MAINNET_COLLATERAL_UTXO
    };
    Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(utxo)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        0,
    )
}

pub fn seedelf_reference_utxo(network_flag: bool) -> Input {
    let utxo = if network_flag {
        PREPROD_SEEDELF_REFERENCE_UTXO
    } else {
        MAINNET_SEEDELF_REFERENCE_UTXO
    };
    Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(utxo)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        1,
    )
}

pub fn wallet_reference_utxo(network_flag: bool) -> Input {
    let utxo = if network_flag {
        PREPROD_WALLET_REFERENCE_UTXO
    } else {
        MAINNET_WALLET_REFERENCE_UTXO
    };
    Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(utxo)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        1,
    )
}
