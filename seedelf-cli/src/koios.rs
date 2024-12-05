use reqwest::Error;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Debug)]
pub struct BlockchainTip {
    pub hash: String,
    pub epoch_no: u64,
    pub abs_slot: u64,
    pub epoch_slot: u64,
    pub block_no: u64,
    pub block_time: u64,
}

/// Fetch the latest blockchain tip from Koios API
pub async fn tip(network_flag: bool) -> Result<Vec<BlockchainTip>, Error> {
    let network = if network_flag {
        "preprod"
    } else {
        "api"
    };
    let url = format!("https://{}.koios.rest/api/v1/tip", network);

    // Make the GET request and parse the JSON response
    let response = reqwest::get(&url)
        .await?
        .json::<Vec<BlockchainTip>>()
        .await?;

    Ok(response)
}


#[derive(Debug, Deserialize)]
pub struct Asset {
    pub decimals: u8,
    pub quantity: String,
    pub policy_id: String,
    pub asset_name: String,
    pub fingerprint: String,
}

#[derive(Debug, Deserialize)]
pub struct InlineDatum {
    pub bytes: String,
    pub value: Value, // Flexible for arbitrary JSON
}


#[derive(Debug, Deserialize)]
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
    pub reference_script: Option<Value>,
    pub asset_list: Option<Vec<Asset>>,
    pub is_spent: bool,
}

pub async fn credential_utxos(payment_credential: &str, network_flag: bool) -> Result<Vec<UtxoResponse>, Error> {
    let network = if network_flag {
        "preprod"
    } else {
        "api"
    };
    let url = format!("https://{}.koios.rest/api/v1/credential_utxos", network);
    let client = reqwest::Client::new();

    // Prepare the request payload
    let payload = serde_json::json!({
        "_payment_credentials": [payment_credential],
        "_extended": true
    });

    // Make the POST request
    let response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let utxos: Vec<UtxoResponse> = response.json().await?;
    Ok(utxos)
}

pub async fn address_utxos(address: &str, network_flag: bool) -> Result<Vec<UtxoResponse>, Error> {
    let network = if network_flag {
        "preprod"
    } else {
        "api"
    };
    let url = format!("https://{}.koios.rest/api/v1/address_utxos", network);
    let client = reqwest::Client::new();

    // Prepare the request payload
    let payload = serde_json::json!({
        "_addresses": [address],
        "_extended": true
    });

    // Make the POST request
    let response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let utxos: Vec<UtxoResponse> = response.json().await?;
    Ok(utxos)
}

pub fn extract_bytes_with_logging(inline_datum: Option<InlineDatum>) -> Option<(String, String)> {
    if let Some(datum) = inline_datum {
        if let Value::Object(ref value_map) = datum.value {
            if let Some(Value::Array(fields)) = value_map.get("fields") {
                if let (Some(first), Some(second)) = (fields.get(0), fields.get(1)) {
                    let first_bytes = first.get("bytes")?.as_str()?.to_string();
                    let second_bytes = second.get("bytes")?.as_str()?.to_string();
                    return Some((first_bytes, second_bytes));
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

// Function to check if a policy ID exists in the asset list
pub fn contains_policy_id(asset_list: Option<Vec<Asset>>, target_policy_id: &str) -> bool {
    asset_list
        .as_ref() // Convert Option<Vec<Asset>> to Option<&Vec<Asset>>
        .map_or(false, |assets| {
            assets.iter().any(|asset| asset.policy_id == target_policy_id)
        })
}