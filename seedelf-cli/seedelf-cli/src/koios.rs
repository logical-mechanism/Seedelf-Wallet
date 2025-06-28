use hex;
use reqwest::{Client, Error, Response};
use seedelf_core::address;
use seedelf_core::constants::ADA_HANDLE_POLICY_ID;
use seedelf_crypto::register::Register;
use serde::Deserialize;
use serde_json::Value;

/// Represents the latest blockchain tip information from Koios.
#[derive(Deserialize, Debug)]
pub struct BlockchainTip {
    pub hash: String,
    pub epoch_no: u64,
    pub abs_slot: u64,
    pub epoch_slot: u64,
    pub block_no: u64,
    pub block_time: u64,
}

/// Fetches the latest blockchain tip from the Koios API.
///
/// Queries the Koios API to retrieve the most recent block's details
/// for the specified network.
///
/// # Arguments
///
/// * `network_flag` - A boolean flag indicating the network:
///     - `true` for Preprod/Testnet.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Vec<BlockchainTip>)` - A vector containing the latest blockchain tip data.
/// * `Err(Error)` - If the API request or JSON parsing fails.
pub async fn tip(network_flag: bool) -> Result<Vec<BlockchainTip>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let url: String = format!("https://{network}.koios.rest/api/v1/tip");

    // Make the GET request and parse the JSON response
    let response: Vec<BlockchainTip> = reqwest::get(&url)
        .await?
        .json::<Vec<BlockchainTip>>()
        .await?;

    Ok(response)
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct Asset {
    pub decimals: u8,
    pub quantity: String,
    pub policy_id: String,
    pub asset_name: String,
    pub fingerprint: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct InlineDatum {
    pub bytes: String,
    pub value: Value, // Flexible for arbitrary JSON
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct UtxoResponse {
    pub tx_hash: String,
    pub tx_index: u64,
    pub address: String,
    pub value: String,
    pub stake_address: Option<String>,
    pub payment_cred: String,
    pub epoch_no: u64,
    pub block_height: u64,
    pub block_time: u64,
    pub datum_hash: Option<String>,
    pub inline_datum: Option<InlineDatum>,
    pub reference_script: Option<Value>, // Flexible for arbitrary scripts
    pub asset_list: Option<Vec<Asset>>,
    pub is_spent: bool,
}

/// Fetches the UTXOs associated with a given payment credential from the Koios API.
///
/// This function collects all UTXOs (Unspent Transaction Outputs) related to the specified
/// payment credential by paginating through the Koios API results.
///
/// # Arguments
///
/// * `payment_credential` - A string slice representing the payment credential to search for.
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod/Testnet.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Vec<UtxoResponse>)` - A vector containing all UTXOs associated with the payment credential.
/// * `Err(Error)` - If the API request or JSON parsing fails.
///
/// # Behavior
///
/// The function paginates through the UTXO results, starting with an offset of zero
/// and incrementing by 1000 until no further results are returned.
pub async fn credential_utxos(
    payment_credential: &str,
    network_flag: bool,
) -> Result<Vec<UtxoResponse>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    // this is searching the wallet contract. We have to collect the entire utxo set to search it.
    let url: String = format!("https://{network}.koios.rest/api/v1/credential_utxos");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_payment_credentials": [payment_credential],
        "_extended": true
    });

    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    let mut offset: i32 = 0;

    loop {
        // Make the POST request
        let response: Response = client
            .post(url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .query(&[("offset", offset.to_string())])
            .json(&payload)
            .send()
            .await?;

        let mut utxos: Vec<UtxoResponse> = response.json().await?;
        // Break the loop if no more results
        if utxos.is_empty() {
            break;
        }

        // Append the retrieved UTXOs to the main list
        all_utxos.append(&mut utxos);

        // Increment the offset by 1000 (page size)
        offset += 1000;
    }

    Ok(all_utxos)
}

/// Fetches the UTXOs associated with a specific address from the Koios API.
///
/// This function retrieves up to 1000 UTXOs for the given address. The `_extended` flag
/// is enabled in the payload to include detailed UTXO information.
///
/// # Arguments
///
/// * `address` - A string slice representing the Cardano address to query.
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod/Testnet.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Vec<UtxoResponse>)` - A vector containing the UTXOs associated with the given address.
/// * `Err(Error)` - If the API request or JSON parsing fails.
///
/// # Notes
///
/// The function assumes a maximum of 1000 UTXOs per address, as per CIP-30 wallets.
/// If an address exceeds this limit, the wallet is likely mismanaged.
pub async fn address_utxos(address: &str, network_flag: bool) -> Result<Vec<UtxoResponse>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    // this will limit to 1000 utxos which is ok for an address as that is a cip30 wallet
    // if you have 1000 utxos in that wallets that cannot pay for anything then something
    // is wrong in that wallet
    let url: String = format!("https://{network}.koios.rest/api/v1/address_utxos");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_addresses": [address],
        "_extended": true
    });

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let utxos: Vec<UtxoResponse> = response.json().await?;

    Ok(utxos)
}

/// Extracts byte values from an `InlineDatum` with detailed logging.
///
/// This function attempts to extract two byte strings from the `fields` array inside the `InlineDatum`.
/// If the extraction fails due to missing keys, incorrect types, or insufficient elements, an error
/// message is logged to standard error.
///
/// # Arguments
///
/// * `inline_datum` - An optional reference to an `InlineDatum`. The `InlineDatum` is expected to contain
///   a `value` key, which maps to an object with a `fields` array of at least two elements.
///
/// # Returns
///
/// * `Some(Register)` - A `Register` instance containing the two extracted byte strings.
/// * `None` - If the extraction fails or `inline_datum` is `None`.
///
/// # Behavior
///
/// Logs errors to `stderr` using `eprintln!` when:
/// - `inline_datum` is `None`.
/// - The `value` key is missing or is not an object.
/// - The `fields` key is missing or is not an array.
/// - The `fields` array has fewer than two elements.
pub fn extract_bytes_with_logging(inline_datum: &Option<InlineDatum>) -> Option<Register> {
    if let Some(datum) = inline_datum {
        if let Value::Object(ref value_map) = datum.value {
            if let Some(Value::Array(fields)) = value_map.get("fields") {
                if let (Some(first), Some(second)) = (fields.first(), fields.get(1)) {
                    let first_bytes: String = first.get("bytes")?.as_str()?.to_string();
                    let second_bytes: String = second.get("bytes")?.as_str()?.to_string();
                    return Some(Register::new(first_bytes, second_bytes));
                } else {
                    eprintln!("Fields array has fewer than two elements.");
                }
            } else {
                eprintln!("`fields` key is missing or not an array.");
            }
        } else {
            eprintln!("`value` is not an object.");
        }
    } else {
        eprintln!("Inline datum is None.");
    }
    None
}

/// Checks if a target policy ID exists in the asset list.
///
/// This function checks whether a specified `target_policy_id` exists
/// within the provided `asset_list`. If the `asset_list` is `None`, the function
/// returns `false`.
///
/// # Arguments
///
/// * `asset_list` - An optional reference to a vector of `Asset` items.
/// * `target_policy_id` - A string slice representing the policy ID to search for.
///
/// # Returns
///
/// * `true` - If the target policy ID exists in the asset list.
/// * `false` - If the target policy ID does not exist or the asset list is `None`.
///
/// # Behavior
///
/// - Safely handles `None` values for `asset_list` using `map_or`.
/// - Uses `iter().any()` to efficiently search for a matching policy ID.
pub fn contains_policy_id(asset_list: &Option<Vec<Asset>>, target_policy_id: &str) -> bool {
    asset_list
        .as_ref() // Convert Option<Vec<Asset>> to Option<&Vec<Asset>>
        .is_some_and(|assets| {
            assets
                .iter()
                .any(|asset| asset.policy_id == target_policy_id)
        })
}

/// Evaluates a transaction using the Koios API.
///
/// This function sends a CBOR-encoded transaction to the Koios API for evaluation.
/// The API uses Ogmios to validate and evaluate the transaction. The target network
/// is determined by the `network_flag`.
///
/// # Arguments
///
/// * `tx_cbor` - A string containing the CBOR-encoded transaction.
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod/Testnet.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Value)` - A JSON response containing the evaluation result.
/// * `Err(Error)` - If the API request fails or the JSON parsing fails.
///
/// # Behavior
///
/// The function constructs a JSON-RPC request payload and sends a POST request
/// to the Koios Ogmios endpoint.
pub async fn evaluate_transaction(tx_cbor: String, network_flag: bool) -> Result<Value, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "evaluateTransaction",
        "params": {
            "transaction": {
                "cbor": tx_cbor
            }
        }
    });

    let url: String = format!("https://{network}.koios.rest/api/v1/ogmios");
    let client: Client = reqwest::Client::new();

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    response.json().await
}

/// Submits a transaction body to witness collateral using a specified API endpoint.
///
/// This function sends a CBOR-encoded transaction body to the collateral witnessing endpoint.
/// The target network (Preprod or Mainnet) is determined by the `network_flag`.
///
/// # Arguments
///
/// * `tx_cbor` - A string containing the CBOR-encoded transaction body.
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Value)` - A JSON response from the API, containing collateral witnessing results.
/// * `Err(Error)` - If the API request fails or the response JSON parsing fails.
///
/// # Behavior
///
/// The function constructs a JSON payload containing the transaction body and sends
/// it to the specified API endpoint using a POST request.
pub async fn witness_collateral(tx_cbor: String, network_flag: bool) -> Result<Value, Error> {
    let network: &str = if network_flag { "preprod" } else { "mainnet" };
    let url: String = format!("https://www.giveme.my/{network}/collateral/");
    let client: Client = reqwest::Client::new();

    let payload: Value = serde_json::json!({
        "tx_body": tx_cbor,
    });

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    response.json().await
}

/// Submits a CBOR-encoded transaction to the Koios API.
///
/// This function decodes the provided CBOR-encoded transaction from a hex string into binary
/// data and sends it to the Koios API for submission. The target network (Preprod or Mainnet)
/// is determined by the `network_flag`.
///
/// # Arguments
///
/// * `tx_cbor` - A string containing the hex-encoded CBOR transaction.
/// * `network_flag` - A boolean flag specifying the network:
///     - `true` for Preprod.
///     - `false` for Mainnet.
///
/// # Returns
///
/// * `Ok(Value)` - A JSON response from the API indicating the result of the transaction submission.
/// * `Err(Error)` - If the API request fails or the response JSON parsing fails.
///
/// # Behavior
///
/// - Decodes the transaction CBOR hex string into raw binary data.
/// - Sends the binary data as the body of a POST request with `Content-Type: application/cbor`.
pub async fn submit_tx(tx_cbor: String, network_flag: bool) -> Result<Value, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let url: String = format!("https://{network}.koios.rest/api/v1/submittx");
    let client: Client = reqwest::Client::new();

    // Decode the hex string into binary data
    let data: Vec<u8> = hex::decode(&tx_cbor).unwrap();

    let response: Response = client
        .post(url)
        .header("Content-Type", "application/cbor")
        .body(data) // Send the raw binary data as the body of the request
        .send()
        .await?;

    response.json().await
}

pub async fn ada_handle_address(
    asset_name: String,
    network_flag: bool,
    cip68_flag: bool,
    variant: u64,
) -> Result<String, String> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let token_name: String = if cip68_flag {
        "000de140".to_string() + &hex::encode(asset_name.clone())
    } else {
        hex::encode(asset_name.clone())
    };
    let url: String = format!(
        "https://{network}.koios.rest/api/v1/asset_nft_address?_asset_policy={ADA_HANDLE_POLICY_ID}&_asset_name={token_name}",
    );
    let client: Client = reqwest::Client::new();

    let response: Response = match client
        .get(url)
        .header("Content-Type", "application/json")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(err) => return Err(format!("HTTP request failed: {err}")),
    };

    let outcome: Value = response.json().await.unwrap();
    let vec_outcome = serde_json::from_value::<Vec<serde_json::Value>>(outcome)
        .expect("Failed to parse outcome as Vec<Value>");

    // Borrow from the longer-lived variable
    let payment_address = match vec_outcome
        .first()
        .and_then(|obj| obj.get("payment_address"))
        .and_then(|val| val.as_str())
    {
        Some(address) => address,
        None => {
            if cip68_flag {
                return Err("Payment address not found".to_string());
            } else {
                return Box::pin(ada_handle_address(
                    asset_name,
                    network_flag,
                    !cip68_flag,
                    variant,
                ))
                .await;
            }
        }
    };

    let wallet_addr: String = address::wallet_contract(network_flag, variant)
        .to_bech32()
        .unwrap();

    if payment_address == wallet_addr {
        Err("ADA Handle Is In Wallet Address".to_string())
    } else {
        Ok(payment_address.to_string())
    }
}

pub async fn utxo_info(utxo: &str, network_flag: bool) -> Result<Vec<UtxoResponse>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    // this will limit to 1000 utxos which is ok for an address as that is a cip30 wallet
    // if you have 1000 utxos in that wallets that cannot pay for anything then something
    // is wrong in that wallet
    let url: String = format!("https://{network}.koios.rest/api/v1/utxo_info");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_utxo_refs": [utxo],
        "_extended": true
    });

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let utxos: Vec<UtxoResponse> = response.json().await?;

    Ok(utxos)
}

// make it so it only works for nfts
pub async fn nft_utxo(
    policy_id: String,
    token_name: String,
    network_flag: bool,
) -> Result<Vec<UtxoResponse>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let url: String = format!("https://{network}.koios.rest/api/v1/asset_utxos");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_asset_list": [[policy_id, token_name]],
        "_extended": true
    });

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let utxos: Vec<UtxoResponse> = response.json().await?;

    if utxos.len() > 1 {
        return Ok(vec![]);
    }

    Ok(utxos)
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct ResolvedDatum {
    pub datum_hash: Option<String>,
    pub creation_tx_hash: String,
    pub value: Value,
    pub bytes: Option<String>,
}

pub async fn datum_from_datum_hash(
    datum_hash: String,
    network_flag: bool,
) -> Result<Vec<ResolvedDatum>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let url: String = format!("https://{network}.koios.rest/api/v1/datum_info");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_datum_hashes": [datum_hash],
    });

    // Make the POST request
    let response: Response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let datums: Vec<ResolvedDatum> = response.json().await?;
    Ok(datums)
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct History {
    pub tx_hash: String,
    pub epoch_no: u64,
    pub block_height: Option<u64>,
    pub block_time: i64,
}

pub async fn asset_history(
    policy_id: String,
    token_name: String,
    network_flag: bool,
    limit: u64,
) -> Result<Vec<History>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let url: String = format!(
        "https://{network}.koios.rest/api/v1/asset_txs?_asset_policy={policy_id}&_asset_name={token_name}&_after_block_height=50000&_history=true&limit={limit}"
    );
    let client: Client = reqwest::Client::new();

    // Make the POST request
    let response: Response = client
        .get(url)
        .header("content-type", "application/json")
        .send()
        .await?;

    let data: Vec<History> = response.json().await.unwrap();
    Ok(data)
}

pub fn extract_bytes_from_value_with_logging(value: &Value) -> Option<Register> {
    if value.is_null() {
        // Don't log anything — null is expected sometimes
        return None;
    }
    if let Value::Object(map) = value {
        if let Some(Value::Object(val)) = map.get("value") {
            if let Some(Value::Array(fields)) = val.get("fields") {
                if let (Some(first), Some(second)) = (fields.first(), fields.get(1)) {
                    let first_bytes = first.get("bytes")?.as_str()?.to_string();
                    let second_bytes = second.get("bytes")?.as_str()?.to_string();
                    return Some(Register::new(first_bytes, second_bytes));
                } else {
                    eprintln!("Inline datum fields array too short.");
                }
            } else {
                eprintln!("`value.fields` is missing or not an array.");
            }
        } else {
            eprintln!("`inline_datum.value` is missing or not an object.");
        }
    } else {
        eprintln!("`inline_datum` is not an object.");
    }
    None
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct TxInfoResponse {
    pub tx_hash: String,
    pub block_height: u64,
    pub inputs: Vec<serde_json::Value>,
    pub outputs: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct TxResponse {
    pub tx_hash: String,
    pub block_height: u64,
    pub input_registers: Vec<Register>,
    pub output_registers: Vec<Register>,
}

impl TxResponse {
    pub fn from_info_response(info: TxInfoResponse) -> Self {
        let input_registers = info
            .inputs
            .iter()
            .filter_map(|input| {
                input
                    .get("inline_datum")
                    .and_then(extract_bytes_from_value_with_logging)
            })
            .collect();

        let output_registers = info
            .outputs
            .iter()
            .filter_map(|output| {
                output
                    .get("inline_datum")
                    .and_then(extract_bytes_from_value_with_logging)
            })
            .collect();

        TxResponse {
            tx_hash: info.tx_hash,
            block_height: info.block_height,
            input_registers,
            output_registers,
        }
    }
}

/// Return transaction history of some address.
pub async fn address_transactions(
    network_flag: bool,
    address: String,
) -> Result<Vec<TxResponse>, Error> {
    let network: &str = if network_flag { "preprod" } else { "api" };
    let address_tx_url: String = format!("https://{network}.koios.rest/api/v1/address_txs");

    let tx_info_url: String = format!("https://{network}.koios.rest/api/v1/tx_info");
    let client: Client = reqwest::Client::new();

    // Prepare the request payload
    let address_payload: Value = serde_json::json!({
        "_addresses": [address],
    });

    let mut all_txs: Vec<TxResponse> = Vec::new();
    let mut offset: i32 = 0;
    let shift: i32 = 65;

    loop {
        let address_response: Response = client
            .post(address_tx_url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .query(&[("offset", offset.to_string()), ("limit", shift.to_string())])
            .json(&address_payload)
            .send()
            .await?;

        let utxos: Vec<History> = address_response.json().await?;
        // Break the loop if no more results
        if utxos.is_empty() {
            break;
        }

        let tx_hashes: Vec<String> = utxos.iter().map(|h| h.tx_hash.clone()).collect();

        let tx_info_payload: Value = serde_json::json!({
            "_tx_hashes": tx_hashes,
            "_inputs": true,
            "_metadata": false,
            "_assets": false,
            "_withdrawals": false,
            "_certs": false,
            "_scripts": true,
            "_bytecode": false
        });

        let tx_info_response: Response = client
            .post(tx_info_url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .json(&tx_info_payload)
            .send()
            .await?;

        let txs: Vec<TxInfoResponse> = tx_info_response.json().await?;
        let mut tx_responses: Vec<TxResponse> = txs
            .into_iter()
            .map(TxResponse::from_info_response)
            .collect();

        // Append the retrieved UTXOs to the main list
        all_txs.append(&mut tx_responses);

        // Increment the offset by shift
        offset += shift;
    }

    Ok(all_txs)
}
