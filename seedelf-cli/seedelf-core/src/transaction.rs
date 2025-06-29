use crate::address;
use crate::assets::Assets;
use crate::constants::{
    CPU_COST_DENOMINATOR, CPU_COST_NUMERATOR, MAINNET_COLLATERAL_UTXO, MEM_COST_DENOMINATOR,
    MEM_COST_NUMERATOR, OVERHEAD_COST, PREPROD_COLLATERAL_UTXO, UTXO_COST_PER_BYTE,
};
use anyhow::{Context, Result, anyhow};
use hex_literal::hex;
use pallas_addresses::Address;
use pallas_crypto::hash::Hash;
use pallas_primitives::Fragment;
use pallas_txbuilder::{Input, Output};
use seedelf_crypto::{register::Register, schnorr};
use serde_json::Value;

/// Calculates the minimum required UTXO for a given output.
///
/// This function calculates the minimum required UTXO value based on the size of the serialized output.
/// The calculation uses the post-Alonzo (Babbage) form of the output and incorporates
/// the overhead cost and cost per byte.
///
/// # Arguments
///
/// * `output` - An `Output` representing the transaction output.
///
/// # Returns
///
/// * `u64` - The minimum required UTXO value in lovelace.
pub fn calculate_min_required_utxo(output: Output) -> Result<u64> {
    // we need the output in the post alonzo form so we can encode it
    let output_cbor_length: u64 = output
        .build_babbage_raw()
        .context("Failed To Construct Babbage CBOR")?
        .encode_fragment()
        .map_err(|e| anyhow!("Failed to encode PlutusData fragment: {e}"))?
        .len()
        .try_into()
        .context("Failed To Get CBOR Length")?;
    // sum the overhead and length times the cost per byte
    Ok((OVERHEAD_COST + output_cbor_length) * UTXO_COST_PER_BYTE)
}

/// Creates a collateral input for a transaction based on the network.
///
/// This function selects a pre-defined collateral UTXO based on the network flag
/// and creates an `Input` using the UTXO hash and an index of `0`.
///
/// # Arguments
///
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Input` - A transaction input constructed from the specified collateral UTXO.
pub fn collateral_input(network_flag: bool) -> Input {
    let utxo: [u8; 32] = if network_flag {
        PREPROD_COLLATERAL_UTXO
    } else {
        MAINNET_COLLATERAL_UTXO
    };
    Input::new(pallas_crypto::hash::Hash::new(utxo), 0)
}

/// Creates a reference UTXO input for the Seedelf contract.
///
/// This function selects a pre-defined reference UTXO based on the network flag
/// and creates an `Input` using the UTXO hash and a fixed index of `1`.
///
/// # Arguments
///
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Input` - A transaction input constructed from the specified reference UTXO.
pub fn reference_utxo(reference_utxo: [u8; 32]) -> Input {
    Input::new(Hash::new(reference_utxo), 1)
}

/// Generates the SeedElf token name.
///
/// This function constructs a token name by concatenating a prefix, a provided label,
/// the smallest input's transaction index (formatted as hex), and its transaction hash.
/// The smallest input is determined lexicographically based on its transaction hash
/// and index. The result is a byte vector derived from the concatenated string.
///
/// # Arguments
///
/// * `label` - A string label to include in the token name.
/// * `inputs` - An optional reference to a vector of `Input` structs. The smallest input is selected based on lexicographical order of the transaction hash and the index.
///
/// # Returns
///
/// * `Vec<u8>` - A vector of bytes representing the constructed token name.
pub fn seedelf_token_name(label: String, inputs: Option<&Vec<Input>>) -> Result<Vec<u8>> {
    let mut label_hex: String = hex::encode(label);
    label_hex.truncate(30);
    // find the smallest input, first in lexicogrpahical order
    let smallest_input: &Input = inputs
        .and_then(|inputs| {
            inputs.iter().min_by(|a, b| {
                a.tx_hash
                    .0
                    .cmp(&b.tx_hash.0)
                    .then(a.txo_index.cmp(&b.txo_index))
            })
        })
        .context("Smallest Input Not Found")?;
    // format the tx index
    let formatted_index: String = format!("{:02x}", smallest_input.txo_index);
    let tx_hash_hex: String = hex::encode(smallest_input.tx_hash.0);
    let prefix: String = "5eed0e1f".to_string();
    let concatenated: String = format!("{prefix}{label_hex}{formatted_index}{tx_hash_hex}");
    hex::decode(&concatenated[..64.min(concatenated.len())]).context("Can Decode Token Name")
}

/// Computes the computation fee for a transaction.
///
/// This function calculates the total computation fee based on the memory and CPU units consumed.
/// It applies a cost model where memory and CPU costs are scaled using pre-defined numerators
/// and denominators.
///
/// # Arguments
///
/// * `mem_units` - The number of memory units consumed.
/// * `cpu_units` - The number of CPU units consumed.
///
/// # Returns
///
/// * `u64` - The total computation fee as a sum of the memory and CPU costs.
pub fn computation_fee(mem_units: u64, cpu_units: u64) -> u64 {
    (MEM_COST_NUMERATOR * mem_units / MEM_COST_DENOMINATOR)
        + (CPU_COST_NUMERATOR * cpu_units / CPU_COST_DENOMINATOR)
}

/// Extracts CPU and memory budgets from a JSON value.
///
/// This function parses a JSON structure to extract CPU and memory usage budgets
/// from an array located under the `"result"` key. Each item in the array is expected
/// to have a `"budget"` object containing `"cpu"` and `"memory"` fields.
///
/// # Arguments
///
/// * `value` - A reference to a `serde_json::Value` containing the JSON data.
///
/// # Returns
///
/// * `Vec<(u64, u64)>` - A vector of tuples, where each tuple contains:
///     - `u64` - CPU budget.
///     - `u64` - Memory budget.
pub fn extract_budgets(value: &Value) -> Vec<(u64, u64)> {
    let mut budgets: Vec<(u64, u64)> = Vec::new();

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

/// Calculates the total computation fee for a list of CPU and memory budgets.
///
/// This function iterates through a vector of `(CPU, Memory)` tuples and computes
/// the fee for each pair using the `computation_fee` function. The resulting fees
/// are summed to produce the total computation fee.
///
/// # Arguments
///
/// * `budgets` - A vector of tuples where each tuple contains:
///     - `u64` - CPU units.
///     - `u64` - Memory units.
///
/// # Returns
///
/// * `u64` - The total computation fee for all provided budgets.
pub fn total_computation_fee(budgets: Vec<(u64, u64)>) -> u64 {
    let mut fee: u64 = 0;
    for (cpu, mem) in budgets.into_iter() {
        fee += computation_fee(mem, cpu);
    }
    fee
}

/// Calculates the minimum lovelace required for a SeedElf transaction.
///
/// This function constructs a staged transaction output that includes:
/// - A long token name.
/// - Inline datum.
/// - A specific asset tied to a SeedElf policy ID.
///
/// The function then calculates the minimum required lovelace using the
/// `calculate_min_required_utxo` function.
///
/// # Returns
///
/// * `u64` - The minimum lovelace required for the transaction output.
pub fn seedelf_minimum_lovelace() -> Result<u64> {
    // a very long token name
    let token_name: Vec<u8> = [
        94, 237, 14, 31, 1, 66, 250, 134, 20, 230, 198, 12, 121, 19, 73, 107, 154, 156, 226, 154,
        138, 103, 76, 134, 93, 156, 23, 169, 169, 167, 201, 55,
    ]
    .to_vec();
    let policy_id: [u8; 28] = hex!("84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255");
    let staging_output: Output = Output::new(address::wallet_contract(true, 1), 5_000_000)
        .set_inline_datum(
            Register::create(schnorr::random_scalar())
                .rerandomize()
                .to_vec(),
        )
        .add_asset(Hash::new(policy_id), token_name, 1)
        .context("Staging Output Failed")?;

    // use the staging output to calculate the minimum required lovelace
    calculate_min_required_utxo(staging_output)
}

/// Calculates the minimum lovelace required for a wallet transaction output with assets.
///
/// This function constructs a staged transaction output that includes:
/// - Inline datum.
/// - A list of assets (policy IDs, token names, and amounts).
///
/// The function iterates over the provided `Assets` to add each asset to the output
/// and then calculates the minimum required lovelace using `calculate_min_required_utxo`.
///
/// # Arguments
///
/// * `tokens` - An `Assets` struct containing a list of assets (policy ID, token name, and amount).
///
/// # Returns
///
/// * `u64` - The minimum lovelace required for the transaction output.
pub fn wallet_minimum_lovelace_with_assets(tokens: Assets) -> Result<u64> {
    let mut staging_output: Output = Output::new(address::wallet_contract(true, 1), 5_000_000)
        .set_inline_datum(
            Register::create(schnorr::random_scalar())
                .rerandomize()
                .to_vec(),
        );

    for asset in tokens.items {
        staging_output = staging_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .context("Staging Output Failed")?;
    }

    // use the staging output to calculate the minimum required lovelace
    calculate_min_required_utxo(staging_output)
}

/// Calculates the minimum lovelace required for a given address with assets.
///
/// This function constructs a transaction output for the specified address with a base
/// lovelace amount and iterates over the provided list of assets to add them to the output.
/// It then calculates the minimum required lovelace using `calculate_min_required_utxo`.
///
/// # Arguments
///
/// * `address` - A string slice containing the Bech32-encoded address.
/// * `tokens` - An `Assets` struct containing a list of assets (policy ID, token name, and amount).
///
/// # Returns
///
/// * `u64` - The minimum lovelace required for the transaction output.
pub fn address_minimum_lovelace_with_assets(address: &str, tokens: Assets) -> Result<u64> {
    let addr: Address =
        Address::from_bech32(address).context("Address Failed To Convert To Bech32")?;
    let mut staging_output: Output = Output::new(addr, 5_000_000);

    for asset in tokens.items {
        staging_output = staging_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .context("Staging Output Failed")?;
    }

    // use the staging output to calculate the minimum required lovelace
    calculate_min_required_utxo(staging_output)
}
