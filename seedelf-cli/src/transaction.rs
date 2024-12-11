use crate::{constants::{
    MAINNET_COLLATERAL_UTXO, MAINNET_SEEDELF_REFERENCE_UTXO, MAINNET_WALLET_REFERENCE_UTXO,
    PREPROD_COLLATERAL_UTXO, PREPROD_SEEDELF_REFERENCE_UTXO, PREPROD_WALLET_REFERENCE_UTXO, SEEDELF_POLICY_ID
}, schnorr, address, register::Register};
use pallas_primitives::Fragment;
use pallas_txbuilder::{Input, Output};
use pallas_crypto;
use serde_json::Value;


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

pub fn seedelf_token_name(label: String, inputs: Option<&Vec<Input>>) -> Vec<u8> {
    let label_hex = hex::encode(label);
    // find the smallest input, first in lexicogrpahical order
    let smallest_input = inputs
        .and_then(|inputs| {
            inputs.iter().min_by(|a, b| {
                a.tx_hash
                    .0
                    .cmp(&b.tx_hash.0)
                    .then(a.txo_index.cmp(&b.txo_index))
            })
        })
        .unwrap();
    // format the tx index
    let formatted_index = format!("{:02x}", smallest_input.txo_index);
    let tx_hash_hex = hex::encode(smallest_input.tx_hash.0);
    let prefix = "5eed0e1f".to_string();
    let concatenated = format!("{}{}{}{}", prefix, label_hex, formatted_index, tx_hash_hex);
    hex::decode(&concatenated[..64.min(concatenated.len())]).unwrap()
}

pub fn computation_fee(mem_units: u64, cpu_units: u64) -> u64 {
    (577 * mem_units / 10_000) + (721 * cpu_units / 10_000_000)
}

pub fn extract_budgets(value: &Value) -> Vec<(u64, u64)> {
    let mut budgets = Vec::new();

    // Ensure the value contains the expected "result" array
    if let Some(result_array) = value.get("result").and_then(|r| r.as_array()) {
        for item in result_array {
            if let Some(budget) = item.get("budget") {
                if let (Some(cpu), Some(memory)) = (
                    budget.get("cpu").and_then(|c| c.as_u64()),
                    budget.get("memory").and_then(|m| m.as_u64()),
                ) {
                    budgets.push((cpu, memory));
                }
            }
        }
    }

    budgets
}

pub fn total_computation_fee(budgets: Vec<(u64, u64)>) -> u64 {
    let mut fee: u64 = 0;
    for (cpu, mem) in budgets.into_iter() {
        fee += computation_fee(mem, cpu);
    }
    fee
}

pub fn seedelf_minimum_lovelace() -> u64 {
    let token_name: Vec<u8> = [94, 237, 14, 31, 1, 66, 250, 134, 20, 230, 198, 12, 121, 19, 73, 107, 154, 156, 226, 154, 138, 103, 76, 134, 93, 156, 23, 169, 169, 167, 201, 55].to_vec();
    let staging_output: Output = Output::new(address::wallet_contract(true), 5_000_000)
        .set_inline_datum(Register::create(schnorr::random_scalar()).rerandomize().to_vec())
        .add_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name,
            1,
        )
        .unwrap();
    
    // use the staging output to calculate the minimum required lovelace
    calculate_min_required_utxo(staging_output)
}

pub fn wallet_minimum_lovelace() -> u64 {
    let staging_output: Output = Output::new(address::wallet_contract(true), 5_000_000)
        .set_inline_datum(Register::create(schnorr::random_scalar()).rerandomize().to_vec());
    // use the staging output to calculate the minimum required lovelace
    calculate_min_required_utxo(staging_output)
}