use anyhow::{Context, Result, anyhow};
use hex;
use pallas_codec::minicbor::{Decoder, data::Type};
use reqwest::{Client, Error, Response};
use seedelf_crypto::register::Register;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use std::sync::{LazyLock, RwLock};

/// Shared HTTP client with sane timeouts. Reuses TCP connections across calls.
static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    let builder = Client::builder();
    // reqwest's browser client (wasm32, used by the web wallet) has no
    // connect or overall timeout; the browser applies its own.
    #[cfg(not(target_arch = "wasm32"))]
    let builder = builder
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30));
    builder.build().expect("Failed to build reqwest client")
});

/// Optional base-URL overrides for the Koios REST host and the giveme.my
/// collateral service.
///
/// Both are `None` in production, so the real hosts are always used and
/// behavior is unchanged. The sole purpose of this seam is to let integration
/// tests redirect every network call at a local mock server — see
/// [`override_endpoints`].
#[derive(Default)]
struct EndpointOverride {
    koios: Option<String>,
    collateral: Option<String>,
}

static ENDPOINT_OVERRIDE: RwLock<EndpointOverride> = RwLock::new(EndpointOverride {
    koios: None,
    collateral: None,
});

/// Test seam: redirect the Koios REST base URL and/or the collateral-service
/// base URL at a different host (e.g. `http://127.0.0.1:PORT`).
///
/// Production code never calls this; with the defaults left in place the real
/// `https://{network}.koios.rest` and `https://www.giveme.my` hosts are used.
/// Pass `None` for an argument to restore its real host.
pub fn override_endpoints(koios_base: Option<String>, collateral_base: Option<String>) {
    let mut guard = ENDPOINT_OVERRIDE
        .write()
        .expect("endpoint override lock poisoned");
    guard.koios = koios_base;
    guard.collateral = collateral_base;
}

/// Build a Koios REST URL for `path` (no leading slash), honoring the test
/// override when one is set.
fn koios_url(network_flag: bool, path: &str) -> String {
    if let Some(base) = ENDPOINT_OVERRIDE
        .read()
        .expect("endpoint override lock poisoned")
        .koios
        .as_deref()
    {
        return format!("{base}/api/v1/{path}");
    }
    let network: &str = if network_flag { "preprod" } else { "api" };
    format!("https://{network}.koios.rest/api/v1/{path}")
}

/// Build the collateral-service URL, honoring the test override when one is set.
fn collateral_url(network_flag: bool) -> String {
    let network: &str = if network_flag { "preprod" } else { "mainnet" };
    if let Some(base) = ENDPOINT_OVERRIDE
        .read()
        .expect("endpoint override lock poisoned")
        .collateral
        .as_deref()
    {
        return format!("{base}/{network}/collateral/");
    }
    format!("https://www.giveme.my/{network}/collateral/")
}

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
    let url: String = koios_url(network_flag, "tip");

    let response: Vec<BlockchainTip> = HTTP_CLIENT
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<BlockchainTip>>()
        .await?;

    Ok(response)
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Asset {
    pub decimals: u8,
    pub quantity: String,
    pub policy_id: String,
    pub asset_name: String,
    pub fingerprint: String,
}

/// An inline datum as Koios lists it: its CBOR, which is what's read (see
/// [`register_of_datum`]), and the same datum as JSON.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct InlineDatum {
    pub bytes: String,
    /// `null` when it's too deeply nested to read: see [`lenient_value`].
    #[serde(default, deserialize_with = "lenient_value")]
    pub value: Value,
}

/// Reads a datum's JSON on its own, or `null` when it's too deeply nested for
/// serde_json, which stops at 128 levels for a whole response. Taking it raw
/// first skips it without that limit, so anyone paying an address a deep
/// datum can't make every response listing that address unreadable.
fn lenient_value<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
    let raw = Box::<RawValue>::deserialize(deserializer)?;
    Ok(serde_json::from_str(raw.get()).unwrap_or(Value::Null))
}

/// A reference script on a UTxO, as Koios lists it, less its JSON `value`: a
/// native script's nests two levels a level, so a deep one would make
/// serde_json refuse the whole response. A field that isn't kept is skipped
/// without the limit.
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct ReferenceScript {
    #[serde(default)]
    pub hash: Option<String>,
    /// Its size in bytes.
    #[serde(default)]
    pub size: Option<u64>,
    /// `plutusV1`, `plutusV2`, `plutusV3`, `timelock` or `multisig`.
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    /// The script's CBOR, hex.
    #[serde(default)]
    pub bytes: Option<String>,
}

/// A row's reference script, if it has one. One in a shape this doesn't
/// expect still counts as a script, so it's never taken for none.
fn some_script<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<ReferenceScript>, D::Error> {
    let raw = Option::<Box<RawValue>>::deserialize(deserializer)?;
    Ok(raw.map(|raw| serde_json::from_str(raw.get()).unwrap_or_default()))
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
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
    #[serde(default, deserialize_with = "some_script")]
    pub reference_script: Option<ReferenceScript>,
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
    // this is searching the wallet contract. We have to collect the entire utxo set to search it.
    let url: String = koios_url(network_flag, "credential_utxos");

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_payment_credentials": [payment_credential],
        "_extended": true
    });

    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    let mut offset: i32 = 0;

    loop {
        // Make the POST request
        let response: Response = HTTP_CLIENT
            .post(url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .query(&[("offset", offset.to_string())])
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;

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
    // this will limit to 1000 utxos which is ok for an address as that is a cip30 wallet
    // if you have 1000 utxos in that wallets that cannot pay for anything then something
    // is wrong in that wallet
    let url: String = koios_url(network_flag, "address_utxos");

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_addresses": [address],
        "_extended": true
    });

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

    let utxos: Vec<UtxoResponse> = response.json().await?;

    Ok(utxos)
}

/// Extracts the `Register` from an `InlineDatum` with logging.
///
/// The register is read from the datum's CBOR `bytes` (see
/// [`register_of_datum`]), never from its JSON `value`, which may be `null`
/// for a deep datum.
///
/// # Arguments
///
/// * `inline_datum` - An optional reference to an `InlineDatum`.
///
/// # Returns
///
/// * `Some(Register)` - The register: constructor 0 holding two 48-byte fields.
/// * `None` - If `inline_datum` is `None` or isn't a register.
///
/// # Behavior
///
/// Logs to `stderr` using `eprintln!` when it returns `None`.
pub fn extract_bytes_with_logging(inline_datum: &Option<InlineDatum>) -> Option<Register> {
    let Some(datum) = inline_datum else {
        eprintln!("Inline datum is None.");
        return None;
    };
    let register = hex::decode(&datum.bytes)
        .ok()
        .and_then(|cbor| register_of_datum(&cbor));
    if register.is_none() {
        eprintln!("The inline datum isn't a register.");
    }
    register
}

/// The register in a datum's CBOR: constructor 0 holding exactly two 48-byte
/// byte strings, with nothing after, however the CBOR spells them (a definite
/// or indefinite list, bytes whole or in chunks, constructor 0's general form
/// `102([0, fields])`): the shapes Koios would show as constructor 0 with two
/// fields. It's read token by token, never by a recursive decoder, so a deeply
/// nested datum is only "not a register". Whether the points are valid is left
/// to the caller.
pub fn register_of_datum(cbor: &[u8]) -> Option<Register> {
    let mut d = Decoder::new(cbor);
    match d.tag().ok()?.as_u64() {
        121 => {}
        102 => {
            if d.array().ok()? != Some(2) || d.u64().ok()? != 0 {
                return None;
            }
        }
        _ => return None,
    }
    let fields = d.array().ok()?;
    if fields.is_some_and(|n| n != 2) {
        return None;
    }
    let generator = point_bytes(&mut d)?;
    let public_value = point_bytes(&mut d)?;
    if fields.is_none() {
        // An indefinite list: a break must end it after the two fields.
        if d.datatype().ok()? != Type::Break {
            return None;
        }
        d.set_position(d.position() + 1);
    }
    (d.position() == cbor.len())
        .then(|| Register::new(hex::encode(generator), hex::encode(public_value)))
}

/// One of a register's fields: 48 bytes, whole or in chunks.
fn point_bytes(d: &mut Decoder) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(48);
    for chunk in d.bytes_iter().ok()? {
        bytes.extend_from_slice(chunk.ok()?);
        if bytes.len() > 48 {
            return None;
        }
    }
    (bytes.len() == 48).then_some(bytes)
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

    let url: String = koios_url(network_flag, "ogmios");

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?;

    // Ogmios answers a transaction it can't evaluate (a script fails, an
    // input is unknown) with 400 and a JSON-RPC `error` saying why. Pass
    // that on to the caller instead of a bare status.
    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return response.json().await;
    }
    response.error_for_status()?.json().await
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
    let url: String = collateral_url(network_flag);

    let payload: Value = serde_json::json!({
        "tx": tx_cbor,
    });

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

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
pub async fn submit_tx(tx_cbor: String, network_flag: bool) -> Result<Value> {
    let url: String = koios_url(network_flag, "submittx");

    // Decode the hex string into binary data
    let data: Vec<u8> = hex::decode(&tx_cbor).context("Invalid hex in tx cbor")?;

    let response: Response = HTTP_CLIENT
        .post(url)
        .header("Content-Type", "application/cbor")
        .body(data) // Send the raw binary data as the body of the request
        .send()
        .await
        .context("Failed to submit transaction")?
        .error_for_status()
        .context("Koios rejected the transaction")?;

    response
        .json()
        .await
        .context("Failed to parse submit_tx response")
}

pub async fn ada_handle_address(
    asset_name: String,
    network_flag: bool,
    cip68_flag: bool,
    _variant: u64,
    wallet_addr: String,
    ada_handle_policy_id: &str,
) -> Result<String, String> {
    // Candidate token-name encodings to try, in order. A non-CIP68 lookup
    // falls back to the CIP68 (000de140-prefixed) name — at most two attempts,
    // iterated rather than recursed so there is no unbounded call depth.
    let cip68_name: String = "000de140".to_string() + &hex::encode(&asset_name);
    let candidates: Vec<String> = if cip68_flag {
        vec![cip68_name]
    } else {
        vec![hex::encode(&asset_name), cip68_name]
    };

    for token_name in candidates {
        // Build query params via `.query()` so values are URL-encoded rather
        // than interpolated raw into the URL string.
        let url: String = koios_url(network_flag, "asset_nft_address");
        let response: Response = match HTTP_CLIENT
            .get(url)
            .query(&[
                ("_asset_policy", ada_handle_policy_id),
                ("_asset_name", token_name.as_str()),
            ])
            .header("Content-Type", "application/json")
            .send()
            .await
            .and_then(|r| r.error_for_status())
        {
            Ok(resp) => resp,
            Err(err) => return Err(format!("HTTP request failed: {err}")),
        };

        let outcome: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse ADA handle response: {e}"))?;
        let vec_outcome = serde_json::from_value::<Vec<serde_json::Value>>(outcome)
            .map_err(|e| format!("Failed to parse outcome as array: {e}"))?;

        if let Some(payment_address) = vec_outcome
            .first()
            .and_then(|obj| obj.get("payment_address"))
            .and_then(|val| val.as_str())
        {
            return if payment_address == wallet_addr {
                Err("ADA Handle Is In Wallet Address".to_string())
            } else {
                Ok(payment_address.to_string())
            };
        }
    }

    Err("Payment address not found".to_string())
}

pub async fn utxo_info(utxo: &str, network_flag: bool) -> Result<Vec<UtxoResponse>, Error> {
    // this will limit to 1000 utxos which is ok for an address as that is a cip30 wallet
    // if you have 1000 utxos in that wallets that cannot pay for anything then something
    // is wrong in that wallet
    let url: String = koios_url(network_flag, "utxo_info");

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_utxo_refs": [utxo],
        "_extended": true
    });

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

    let utxos: Vec<UtxoResponse> = response.json().await?;

    Ok(utxos)
}

// make it so it only works for nfts
pub async fn nft_utxo(
    policy_id: String,
    token_name: String,
    network_flag: bool,
) -> Result<Vec<UtxoResponse>, Error> {
    let url: String = koios_url(network_flag, "asset_utxos");

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_asset_list": [[policy_id, token_name]],
        "_extended": true
    });

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

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
    let url: String = koios_url(network_flag, "datum_info");

    // Prepare the request payload
    let payload: Value = serde_json::json!({
        "_datum_hashes": [datum_hash],
    });

    // Make the POST request
    let response: Response = HTTP_CLIENT
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

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
) -> Result<Vec<History>> {
    let url: String = koios_url(
        network_flag,
        &format!(
            "asset_txs?_asset_policy={policy_id}&_asset_name={token_name}&_after_block_height=50000&_history=true&limit={limit}"
        ),
    );

    let response: Response = HTTP_CLIENT
        .get(url)
        .header("content-type", "application/json")
        .send()
        .await
        .context("Failed to fetch asset history")?
        .error_for_status()
        .context("Koios returned an error for asset history")?;

    let data: Vec<History> = response
        .json()
        .await
        .context("Failed to parse asset history response")?;
    Ok(data)
}

#[derive(Debug, Deserialize, Clone, Default)]
struct TxInfoResponse {
    tx_hash: String,
    block_height: u64,
    inputs: Vec<TxInfoOutput>,
    outputs: Vec<TxInfoOutput>,
}

/// An input or output in `tx_info`: only its inline datum is kept. Every
/// other field, a reference script's JSON among them, is skipped unread, so
/// its depth can't make the response unreadable.
#[derive(Debug, Deserialize, Clone, Default)]
struct TxInfoOutput {
    #[serde(default)]
    inline_datum: Option<InlineDatum>,
}

impl TxInfoOutput {
    /// The register it's under, if any; no datum is expected sometimes, so
    /// nothing is logged.
    fn register(&self) -> Option<Register> {
        let cbor = hex::decode(&self.inline_datum.as_ref()?.bytes).ok()?;
        register_of_datum(&cbor)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TxResponse {
    pub tx_hash: String,
    pub block_height: u64,
    pub input_registers: Vec<Register>,
    pub output_registers: Vec<Register>,
}

impl TxResponse {
    fn from_info_response(info: TxInfoResponse) -> Self {
        let input_registers = info
            .inputs
            .iter()
            .filter_map(TxInfoOutput::register)
            .collect();

        let output_registers = info
            .outputs
            .iter()
            .filter_map(TxInfoOutput::register)
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
    let address_tx_url: String = koios_url(network_flag, "address_txs");

    let tx_info_url: String = koios_url(network_flag, "tx_info");

    // Prepare the request payload
    let address_payload: Value = serde_json::json!({
        "_addresses": [address],
    });

    let mut all_txs: Vec<TxResponse> = Vec::new();
    let mut offset: i32 = 0;
    let shift: i32 = 65;

    loop {
        let address_response: Response = HTTP_CLIENT
            .post(address_tx_url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .query(&[("offset", offset.to_string()), ("limit", shift.to_string())])
            .json(&address_payload)
            .send()
            .await?
            .error_for_status()?;

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

        let tx_info_response: Response = HTTP_CLIENT
            .post(tx_info_url.clone())
            .header("accept", "application/json")
            .header("content-type", "application/json")
            .json(&tx_info_payload)
            .send()
            .await?
            .error_for_status()?;

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

/// Current-epoch protocol parameters used to price transactions.
///
/// Gov can change cost models and unit prices independently per network now,
/// so we fetch these per command rather than baking them in.
#[derive(Debug, Clone)]
pub struct ProtocolParameters {
    /// The linear fee: `min_fee_a` lovelace per byte plus `min_fee_b`.
    pub min_fee_a: u64,
    pub min_fee_b: u64,
    pub coins_per_utxo_size: u64,
    /// What registering a stake key locks up, returned when it's unregistered.
    pub key_deposit: u64,
    /// What registering a DRep locks up, returned when it retires. `None`
    /// when Koios leaves it out: only registering a DRep needs it, and that
    /// refuses to guess.
    pub drep_deposit: Option<u64>,
    pub price_mem: f64,
    pub price_step: f64,
    pub cost_model_v3: Vec<i64>,
    /// What a byte of reference script costs, before Conway's tiers (see
    /// `seedelf_core::build::reference_script_fee`): a fraction, exactly as
    /// the ledger keeps it.
    pub min_fee_ref_script_cost_per_byte: Ratio,
}

/// A fraction, `numerator / denominator`, as the ledger keeps a price.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ratio {
    pub numerator: u64,
    pub denominator: u64,
}

impl Ratio {
    /// A whole number.
    pub const fn whole(n: u64) -> Self {
        Ratio {
            numerator: n,
            denominator: 1,
        }
    }

    /// A number as Koios writes it, a JSON number or a string, exactly:
    /// `12.5` is 25/2. `None` for anything else, a negative number too.
    fn exact(value: &Value) -> Option<Self> {
        let text = match value {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => return None,
        };
        let (mantissa, exponent) = match text.split_once(['e', 'E']) {
            Some((m, e)) => (m, e.parse::<i32>().ok()?),
            None => (text.as_str(), 0),
        };
        let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
        let digits = format!("{whole}{fraction}");
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let scale = exponent.checked_sub(i32::try_from(fraction.len()).ok()?)?;
        let mut numerator: u128 = digits.parse().ok()?;
        let mut denominator: u128 = 1;
        if scale >= 0 {
            numerator = numerator.checked_mul(10u128.checked_pow(scale.unsigned_abs())?)?;
        } else {
            denominator = 10u128.checked_pow(scale.unsigned_abs())?;
        }
        let (mut a, mut b) = (numerator, denominator);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        Some(Ratio {
            numerator: u64::try_from(numerator / a.max(1)).ok()?,
            denominator: u64::try_from(denominator / a.max(1)).ok()?,
        })
    }
}

impl std::fmt::Display for Ratio {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.denominator == 1 {
            write!(f, "{}", self.numerator)
        } else {
            write!(f, "{}/{}", self.numerator, self.denominator)
        }
    }
}

/// The most [`ProtocolParameters::from_koios`] takes for each parameter,
/// generously above mainnet's and preprod's in 2026 (44 and 155,381 lovelace,
/// 4,310 a byte, a 2 ₳ deposit, a 500 ₳ DRep deposit, prices of 0.0577 and
/// 0.0000721, 15 lovelace a byte of reference script). The ledger takes any overpayment, so a wrong
/// answer from Koios would otherwise raise every fee, minimum and deposit the
/// wallet pays, unseen.
pub const MAX_MIN_FEE_A: u64 = 1_000;
pub const MAX_MIN_FEE_B: u64 = 2_000_000;
pub const MAX_COINS_PER_UTXO_SIZE: u64 = 20_000;
pub const MAX_KEY_DEPOSIT: u64 = 10_000_000;
pub const MAX_DREP_DEPOSIT: u64 = 5_000_000_000;
pub const MAX_PRICE_MEM: f64 = 0.577;
pub const MAX_PRICE_STEP: f64 = 0.000721;
pub const MAX_MIN_FEE_REF_SCRIPT_COST_PER_BYTE: u64 = 150;

impl ProtocolParameters {
    /// Reads the parameters from one row of Koios's `epoch_params` response.
    /// Split from [`epoch_params`] so callers that fetch Koios JSON
    /// themselves (the web wallet, through WebAssembly) parse it the same way.
    /// Refuses any parameter over its limit (see [`MAX_MIN_FEE_A`] and the
    /// rest).
    pub fn from_koios(params: &Value) -> Result<Self> {
        // Koios gives lovelace amounts as numbers or as strings.
        let lovelace = |field: &str, most: u64| -> Result<u64> {
            let value: u64 = params[field]
                .as_u64()
                .or_else(|| params[field].as_str().and_then(|s| s.parse().ok()))
                .ok_or_else(|| anyhow!("Missing {field}"))?;
            if value > most {
                return Err(looks_wrong(field, value, most));
            }
            Ok(value)
        };
        let price = |field: &str, most: f64| -> Result<f64> {
            let value: f64 = params[field]
                .as_f64()
                .ok_or_else(|| anyhow!("Missing {field}"))?;
            if !(0.0..=most).contains(&value) {
                return Err(looks_wrong(field, value, most));
            }
            Ok(value)
        };
        let min_fee_a: u64 = lovelace("min_fee_a", MAX_MIN_FEE_A)?;
        let min_fee_b: u64 = lovelace("min_fee_b", MAX_MIN_FEE_B)?;
        let coins_per_utxo_size: u64 = lovelace("coins_per_utxo_size", MAX_COINS_PER_UTXO_SIZE)?;
        let key_deposit: u64 = lovelace("key_deposit", MAX_KEY_DEPOSIT)?;
        let drep_deposit = match &params["drep_deposit"] {
            Value::Null => None,
            _ => Some(lovelace("drep_deposit", MAX_DREP_DEPOSIT)?),
        };
        let price_mem: f64 = price("price_mem", MAX_PRICE_MEM)?;
        let price_step: f64 = price("price_step", MAX_PRICE_STEP)?;
        let per_byte = "min_fee_ref_script_cost_per_byte";
        if params[per_byte].as_f64().is_some_and(|v| v < 0.0) {
            return Err(looks_wrong(
                per_byte,
                &params[per_byte],
                MAX_MIN_FEE_REF_SCRIPT_COST_PER_BYTE,
            ));
        }
        let min_fee_ref_script_cost_per_byte =
            Ratio::exact(&params[per_byte]).ok_or_else(|| anyhow!("Missing {per_byte}"))?;
        if u128::from(min_fee_ref_script_cost_per_byte.numerator)
            > u128::from(MAX_MIN_FEE_REF_SCRIPT_COST_PER_BYTE)
                * u128::from(min_fee_ref_script_cost_per_byte.denominator)
        {
            return Err(looks_wrong(
                per_byte,
                min_fee_ref_script_cost_per_byte,
                MAX_MIN_FEE_REF_SCRIPT_COST_PER_BYTE,
            ));
        }
        let cost_model_v3: Vec<i64> = params["cost_models"]["PlutusV3"]
            .as_array()
            .ok_or_else(|| anyhow!("Missing PlutusV3 cost model"))?
            .iter()
            .map(|v| v.as_i64().ok_or_else(|| anyhow!("Non-integer cost entry")))
            .collect::<Result<Vec<_>>>()?;

        Ok(ProtocolParameters {
            min_fee_a,
            min_fee_b,
            coins_per_utxo_size,
            key_deposit,
            drep_deposit,
            price_mem,
            price_step,
            cost_model_v3,
            min_fee_ref_script_cost_per_byte,
        })
    }
}

/// A parameter from Koios over its limit, in words.
fn looks_wrong(
    field: &str,
    value: impl std::fmt::Display,
    most: impl std::fmt::Display,
) -> anyhow::Error {
    anyhow!(
        "The network's {field} from Koios looks wrong: {value}, where at most {most} is expected. Nothing was built; try again later"
    )
}

/// Fetch the current epoch's protocol parameters from Koios.
pub async fn epoch_params(network_flag: bool) -> Result<ProtocolParameters> {
    let url: String = koios_url(network_flag, "epoch_params?limit=1");

    let response: Vec<Value> = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .context("Failed To Fetch Epoch Params")?
        .error_for_status()
        .context("Koios returned an error for epoch_params")?
        .json()
        .await
        .context("Failed To Parse Epoch Params")?;
    let params: Value = response
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Empty Epoch Params Response"))?;

    ProtocolParameters::from_koios(&params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_deep_datum_or_script_in_a_transaction_leaves_the_history_readable() {
        let register = Register::create(seedelf_crypto::schnorr::random_scalar()).unwrap();
        let levels = 100_000;
        let deep_datum = format!(
            r#"{{"bytes":"{}00","value":{}{{"int":0}}{}}}"#,
            "81".repeat(levels),
            r#"{"list":["#.repeat(levels),
            "]}".repeat(levels),
        );
        let deep_script = format!(
            r#"{{"hash":"ab","size":1,"type":"timelock","bytes":"00","value":{}{{"type":"sig"}}{}}}"#,
            r#"{"type":"all","scripts":["#.repeat(levels),
            "]}".repeat(levels),
        );
        let ours = format!(
            r#"{{"bytes":"{}","value":{{"constructor":0}}}}"#,
            hex::encode(register.to_vec().unwrap())
        );
        // As `tx_info` lists a transaction, with `_scripts`.
        let page = format!(
            r#"[{{"tx_hash":"00","block_height":7,"inputs":[{{"inline_datum":{deep_datum},"reference_script":null}},{{"inline_datum":null}}],"outputs":[{{"inline_datum":{ours},"reference_script":{deep_script}}}],"plutus_contracts":[{{"input":{{"redeemer":{{"datum":{{"value":{deep_datum}}}}}}}}}]}}]"#
        );
        let txs: Vec<TxInfoResponse> = serde_json::from_str(&page).unwrap();
        let tx = TxResponse::from_info_response(txs.into_iter().next().unwrap());
        assert!(tx.input_registers.is_empty());
        assert_eq!(tx.output_registers, vec![register]);
    }
}
