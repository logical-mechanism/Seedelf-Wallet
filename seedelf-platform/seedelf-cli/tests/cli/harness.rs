//! Shared scaffolding for the offline mock-Koios CLI integration tests.
//!
//! Every transaction-building command interleaves Koios REST calls with a
//! Pallas `StagingTransaction` build inside its `run()`. These tests drive the
//! real `run()` functions with a local mock server standing in for Koios, then
//! decode the transaction the command tried to submit and assert it is sound:
//! value is conserved, no output sits below its min-UTxO, and every wallet
//! output carries a datum that decodes back to a valid `Register`.
//!
//! The mock server, the wallet-unlock scalar, and the base-URL overrides are
//! all process-global, so every test in this binary is `#[serial]`.

#![allow(dead_code)] // shared helpers; not every test exercises every helper.

use std::collections::BTreeMap;

use blstrs::Scalar;
use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    StakeAddress,
};
use pallas_crypto::hash::Hasher;
use pallas_primitives::alonzo::{MaybeIndefArray, PlutusData};
use pallas_primitives::conway::{DatumOption, RedeemerTag};
use pallas_traverse::{MultiEraOutput, MultiEraTx};
use seedelf_core::assets::{Asset as CoreAsset, Assets};
use seedelf_core::constants::{COLLATERAL_HASH, Config, get_config};
use seedelf_core::transaction::{
    address_minimum_lovelace_with_assets, wallet_minimum_lovelace_with_assets,
};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{prove, random_scalar};
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, ReferenceScript, UtxoResponse};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

/// All tests run against the contract `variant` 1 on the preprod network.
pub const VARIANT: u64 = 1;
pub const PREPROD: bool = true;

/// Real preprod `epoch_params` response (captured once); the 350-entry
/// PlutusV3 cost model is impractical to hand-write.
const EPOCH_PARAMS_FIXTURE: &str = include_str!("fixtures/epoch_params.json");

/// A representative seedelf token name captured from preprod (32 bytes,
/// `5eed0e1f`-prefixed).
pub const SAMPLE_SEEDELF: &str = "5eed0e1f0272b6c6cde1a5652ecf4480d4f70b3a0601b4a40b3ed3fd096d7b8a";

// ----------------------------------------------------------------------------
// configuration helpers
// ----------------------------------------------------------------------------

pub fn config() -> Config {
    get_config(VARIANT, PREPROD).expect("variant 1 config")
}

pub fn seedelf_policy() -> String {
    config().contract.seedelf_policy_id
}

/// The wallet contract (script) address that wallet UTxOs and change live at.
pub fn wallet_address() -> Address {
    seedelf_core::address::wallet_contract(PREPROD, config().contract.wallet_contract_hash)
}

pub fn wallet_address_bech32() -> String {
    wallet_address().to_bech32().expect("wallet bech32")
}

/// The KEY address carrying the wallet contract's hash: Koios lists its UTxOs
/// with the contract's, since it asks by the 28 bytes alone, and no key can
/// spend from it (chunk 51, x2#2).
pub fn key_address_with_the_contracts_hash() -> String {
    Address::from(ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(PaymentKeyHash::new(config().contract.wallet_contract_hash)),
        ShelleyDelegationPart::Null,
    ))
    .to_bech32()
    .expect("key address bech32")
}

/// A deterministic, non-script preprod address usable as a payer / payee.
pub fn external_address() -> Address {
    seedelf_core::address::dapp_address("11".repeat(28), PREPROD).expect("external address")
}

pub fn external_address_bech32() -> String {
    external_address().to_bech32().expect("external bech32")
}

/// The preprod dApp address derived from a wallet scalar — the address the
/// `external sweep` command pulls UTxOs from.
pub fn dapp_address_for(scalar: Scalar) -> Address {
    let vkey = seedelf_crypto::convert::secret_key_to_public_key(scalar);
    seedelf_core::address::dapp_address(vkey, PREPROD).expect("dapp address")
}

/// 32-byte tx hash fixtures: `tx_hash(n)` is distinct and valid hex per `n`.
pub fn tx_hash(n: u64) -> String {
    format!("{n:064x}")
}

// ----------------------------------------------------------------------------
// UTxO fixture builders
// ----------------------------------------------------------------------------

/// A native-token amount on a fixture UTxO: `(policy_id_hex, token_name_hex, qty)`.
pub type TokenAmount = (String, String, u64);

fn koios_asset(policy: &str, name: &str, qty: u64) -> Asset {
    Asset {
        decimals: 0,
        quantity: qty.to_string(),
        policy_id: policy.to_string(),
        asset_name: name.to_string(),
        fingerprint: String::new(),
    }
}

fn asset_list(tokens: &[TokenAmount]) -> Option<Vec<Asset>> {
    if tokens.is_empty() {
        None
    } else {
        Some(
            tokens
                .iter()
                .map(|(p, n, q)| koios_asset(p, n, *q))
                .collect(),
        )
    }
}

/// Encode a `Register` the way Koios reports an inline datum: the raw PlutusData
/// CBOR in `bytes`, and the decoded constructor in `value` (what the CLI parses
/// via `extract_bytes_with_logging`).
pub fn register_inline_datum(reg: &Register) -> InlineDatum {
    InlineDatum {
        bytes: hex::encode(reg.to_vec().expect("register cbor")),
        value: json!({
            "constructor": 0,
            "fields": [
                {"bytes": reg.generator},
                {"bytes": reg.public_value},
            ]
        }),
    }
}

/// A fresh re-randomized `Register` owned by `scalar` — the datum a real wallet
/// UTxO carries.
pub fn owned_register(scalar: Scalar) -> Register {
    Register::create(scalar)
        .expect("register create")
        .rerandomize()
        .expect("register rerandomize")
}

/// A wallet-contract UTxO owned by `scalar`, carrying no seedelf token. These
/// are the UTxOs `collect_wallet_utxos` selects to spend.
pub fn wallet_utxo(scalar: Scalar, n: u64, lovelace: u64, tokens: &[TokenAmount]) -> UtxoResponse {
    UtxoResponse {
        tx_hash: tx_hash(n),
        tx_index: 0,
        address: wallet_address_bech32(),
        value: lovelace.to_string(),
        stake_address: None,
        payment_cred: hex::encode(config().contract.wallet_contract_hash),
        epoch_no: 290,
        block_height: 3_000_000,
        block_time: 1_700_000_000,
        datum_hash: None,
        inline_datum: Some(register_inline_datum(&owned_register(scalar))),
        reference_script: None,
        asset_list: asset_list(tokens),
        is_spent: false,
    }
}

/// A wallet-contract UTxO that holds a seedelf identity token. The CLI looks
/// these up by token name to fund / transfer to / remove a seedelf.
pub fn seedelf_utxo(scalar: Scalar, n: u64, lovelace: u64, seedelf_name: &str) -> UtxoResponse {
    let mut utxo = wallet_utxo(scalar, n, lovelace, &[]);
    utxo.asset_list = Some(vec![koios_asset(&seedelf_policy(), seedelf_name, 1)]);
    utxo
}

/// A plain (non-script) address UTxO with no datum — what `address_utxos`
/// returns for a payer / dApp address.
pub fn address_utxo(addr: &str, n: u64, lovelace: u64, tokens: &[TokenAmount]) -> UtxoResponse {
    UtxoResponse {
        tx_hash: tx_hash(n),
        tx_index: 0,
        address: addr.to_string(),
        value: lovelace.to_string(),
        stake_address: None,
        payment_cred: String::new(),
        epoch_no: 290,
        block_height: 3_000_000,
        block_time: 1_700_000_000,
        datum_hash: None,
        inline_datum: None,
        reference_script: None,
        asset_list: asset_list(tokens),
        is_spent: false,
    }
}

/// A wallet-contract UTxO with an empty datum — the dead UTxO `util extract`
/// rescues.
pub fn empty_datum_utxo(n: u64, lovelace: u64, tokens: &[TokenAmount]) -> UtxoResponse {
    UtxoResponse {
        tx_hash: tx_hash(n),
        tx_index: 0,
        address: wallet_address_bech32(),
        value: lovelace.to_string(),
        stake_address: None,
        payment_cred: hex::encode(config().contract.wallet_contract_hash),
        epoch_no: 290,
        block_height: 3_000_000,
        block_time: 1_700_000_000,
        datum_hash: None,
        inline_datum: None,
        reference_script: None,
        asset_list: asset_list(tokens),
        is_spent: false,
    }
}

/// `utxo` holding a reference script of `size` bytes, as Koios lists one. The
/// CLI only measures it, so its bytes needn't be a real script.
pub fn with_reference_script(mut utxo: UtxoResponse, size: usize) -> UtxoResponse {
    utxo.reference_script = Some(ReferenceScript {
        hash: Some("ab".repeat(28)),
        size: Some(size as u64),
        kind: Some("plutusV3".to_string()),
        bytes: Some("00".repeat(size)),
    });
    utxo
}

/// A stranger's junk token, 2^63 − 1 of it: the most one mint makes. Anyone can
/// send it to any address, or to the contract under a re-randomization of
/// someone's register, and three UTxOs of it total more than a u64, and so one
/// output, can hold (chunk 51, r4#1 and r4#2).
pub fn junk() -> TokenAmount {
    ("cc".repeat(28), hex::encode("JUNK"), i64::MAX as u64)
}

/// `count` distinct tokens, one of each, named by a single byte, 200 to a
/// policy, the policies numbered from `first`: a pile of tokens, which takes
/// more bytes and more ADA in the outputs a payment splits it into (20 tokens
/// to an output) than in the one UTxO it came in.
pub fn pile(first: u8, count: usize) -> Vec<TokenAmount> {
    (0..count)
        .map(|i| {
            let policy = first + (i / 200) as u8;
            (
                format!("{policy:02x}").repeat(28),
                format!("{:02x}", i % 200),
                1,
            )
        })
        .collect()
}

// ----------------------------------------------------------------------------
// fixture ledger — resolves the values behind a transaction's inputs
// ----------------------------------------------------------------------------

/// The resolved value sitting on a fixture UTxO.
#[derive(Clone, Debug, Default)]
pub struct ResolvedValue {
    pub lovelace: u64,
    /// `(policy_id_hex, token_name_hex) -> quantity`.
    pub assets: BTreeMap<(String, String), u64>,
    /// The register its inline datum holds, if it holds one.
    pub register: Option<Register>,
}

/// Maps every fixture outpoint to its value so a decoded transaction's inputs
/// can be resolved for the value-conservation check.
#[derive(Default)]
pub struct Ledger {
    map: BTreeMap<(String, u64), ResolvedValue>,
}

impl Ledger {
    fn record(&mut self, utxos: &[UtxoResponse]) {
        for utxo in utxos {
            let mut value = ResolvedValue {
                lovelace: utxo.value.parse().expect("utxo lovelace"),
                register: utxo.inline_datum.as_ref().and_then(|datum| {
                    seedelf_koios::koios::register_of_datum(&hex::decode(&datum.bytes).ok()?)
                }),
                ..ResolvedValue::default()
            };
            if let Some(list) = &utxo.asset_list {
                for asset in list {
                    *value
                        .assets
                        .entry((asset.policy_id.clone(), asset.asset_name.clone()))
                        .or_default() += asset.quantity.parse::<u64>().expect("asset qty");
                }
            }
            self.map
                .insert((utxo.tx_hash.clone(), utxo.tx_index), value);
        }
    }

    fn resolve(&self, tx_hash: &str, index: u64) -> ResolvedValue {
        self.map
            .get(&(tx_hash.to_string(), index))
            .unwrap_or_else(|| panic!("transaction spends unknown input {tx_hash}#{index}"))
            .clone()
    }
}

// ----------------------------------------------------------------------------
// mock Koios server
// ----------------------------------------------------------------------------

/// Custom responder for `credential_utxos`: the canned UTxO set for a request
/// with no offset (or offset 0), and an empty page for any later offset. The
/// CLI pages after the last row read, never by offset (seedelf-koios
/// `utxo_pages`; tests/koios_pages.rs pins it), so a fixture shorter than a
/// page is read in one request.
struct PaginatedUtxos(Vec<UtxoResponse>);

impl Respond for PaginatedUtxos {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let offset = request
            .url
            .query_pairs()
            .find(|(k, _)| k == "offset")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_else(|| "0".to_string());
        let body = if offset == "0" {
            serde_json::to_value(&self.0).expect("utxo json")
        } else {
            json!([])
        };
        ResponseTemplate::new(200).set_body_json(body)
    }
}

/// A running mock-Koios test environment. Holds the mock server, the injected
/// wallet scalar, and a ledger of every fixture UTxO it has served.
pub struct Scenario {
    pub server: MockServer,
    pub scalar: Scalar,
    pub ledger: Ledger,
}

impl Scenario {
    /// Start a mock server, generate a wallet scalar, wire every network seam
    /// at the mock, and mount the always-needed endpoints (`epoch_params` and
    /// the GitHub update check).
    pub async fn start() -> Self {
        let server = MockServer::start().await;
        let scalar = random_scalar();

        seedelf_koios::koios::override_endpoints(Some(server.uri()), Some(server.uri()));
        seedelf_display::version_control::override_github_base(Some(server.uri()));
        seedelf_cli::setup::inject_wallet_scalar(Some(scalar));

        Mock::given(method("GET"))
            .and(path("/api/v1/epoch_params"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(EPOCH_PARAMS_FIXTURE, "application/json"),
            )
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(
                "/repos/logical-mechanism/Seedelf-Wallet/releases/latest",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"tag_name": "0.0.1"})))
            .mount(&server)
            .await;

        Scenario {
            server,
            scalar,
            ledger: Ledger::default(),
        }
    }

    /// Serve `epoch_params` with the reference-script price set to `per_byte`
    /// lovelace, over the recorded preprod value (15).
    pub async fn mount_reference_script_price(&self, per_byte: u64) {
        self.mount_params(|params| params["min_fee_ref_script_cost_per_byte"] = json!(per_byte))
            .await;
    }

    /// Serve `epoch_params` as recorded, with `change` made to its one row:
    /// a fee parameter raised, say.
    pub async fn mount_params(&self, change: impl FnOnce(&mut Value)) {
        let mut params: Value = serde_json::from_str(EPOCH_PARAMS_FIXTURE).expect("epoch params");
        change(&mut params[0]);
        Mock::given(method("GET"))
            .and(path("/api/v1/epoch_params"))
            .respond_with(ResponseTemplate::new(200).set_body_json(params))
            // Ahead of the recorded one `start` mounts.
            .with_priority(1)
            .mount(&self.server)
            .await;
    }

    /// How many requests the mock was sent for `path` (`/api/v1/ogmios`, say).
    pub async fn requests_to(&self, path: &str) -> usize {
        self.server
            .received_requests()
            .await
            .expect("request recording enabled")
            .iter()
            .filter(|r| r.url.path() == path)
            .count()
    }

    /// Mount `credential_utxos` (the wallet-contract UTxO set) and record the
    /// UTxOs in the ledger.
    pub async fn mount_credential_utxos(&mut self, utxos: Vec<UtxoResponse>) {
        self.ledger.record(&utxos);
        Mock::given(method("POST"))
            .and(path("/api/v1/credential_utxos"))
            .respond_with(PaginatedUtxos(utxos))
            .mount(&self.server)
            .await;
    }

    /// Mount `address_utxos` and record the UTxOs in the ledger.
    pub async fn mount_address_utxos(&mut self, utxos: Vec<UtxoResponse>) {
        self.ledger.record(&utxos);
        Mock::given(method("POST"))
            .and(path("/api/v1/address_utxos"))
            .respond_with(ResponseTemplate::new(200).set_body_json(&utxos))
            .mount(&self.server)
            .await;
    }

    /// Mount `utxo_info` and record the UTxOs in the ledger.
    pub async fn mount_utxo_info(&mut self, utxos: Vec<UtxoResponse>) {
        self.ledger.record(&utxos);
        Mock::given(method("POST"))
            .and(path("/api/v1/utxo_info"))
            .respond_with(ResponseTemplate::new(200).set_body_json(&utxos))
            .mount(&self.server)
            .await;
    }

    /// Mount the Ogmios `evaluateTransaction` endpoint with `n` canned
    /// execution-unit budgets.
    pub async fn mount_evaluate(&self, n: usize) {
        self.mount_evaluate_budgets(&vec![(250_000_000, 800_000); n])
            .await;
    }

    /// Mount the Ogmios `evaluateTransaction` endpoint with these budgets,
    /// `(cpu, memory)` for spends 0, 1, … in turn.
    pub async fn mount_evaluate_budgets(&self, budgets: &[(u64, u64)]) {
        let budgets: Vec<Value> = budgets
            .iter()
            .enumerate()
            .map(|(i, (cpu, memory))| {
                json!({
                    "validator": {"index": i, "purpose": "spend"},
                    "budget": {"cpu": cpu, "memory": memory}
                })
            })
            .collect();
        Mock::given(method("POST"))
            .and(path("/api/v1/ogmios"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"result": budgets})))
            .mount(&self.server)
            .await;
    }

    /// Mount Ogmios `evaluateTransaction` for a mint: one budget per spent
    /// input, plus the seedelf policy's, as Ogmios labels them.
    pub async fn mount_evaluate_mint(&self, spends: usize) {
        let mut budgets: Vec<Value> = (0..spends)
            .map(|i| {
                json!({
                    "validator": {"index": i, "purpose": "spend"},
                    "budget": {"cpu": 250_000_000u64, "memory": 800_000u64}
                })
            })
            .collect();
        budgets.push(json!({
            "validator": {"index": 0, "purpose": "mint"},
            "budget": {"cpu": 90_000_000u64, "memory": 300_000u64}
        }));
        Mock::given(method("POST"))
            .and(path("/api/v1/ogmios"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"result": budgets})))
            .mount(&self.server)
            .await;
    }

    /// Mount the collateral-witness service with a dummy 64-byte signature.
    /// The CLI attaches the witness without verifying it.
    pub async fn mount_collateral(&self) {
        Mock::given(method("POST"))
            .and(path("/preprod/collateral/"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"witness": "ab".repeat(64)})),
            )
            .mount(&self.server)
            .await;
    }

    /// Mount `submittx`, which echoes back a fixed tx hash on success.
    pub async fn mount_submit(&self) {
        Mock::given(method("POST"))
            .and(path("/api/v1/submittx"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!(tx_hash(999))))
            .mount(&self.server)
            .await;
    }

    /// Arm the web-server capture seam. `create`, `fund`, and `extract` end by
    /// serving a CIP30 signing site instead of submitting; with the seam armed
    /// they record the built CBOR and return immediately.
    pub fn arm_web_capture(&self) {
        seedelf_cli::web_server::arm_cbor_capture();
    }

    /// The transaction CBOR captured from the web-server seam.
    pub fn captured_cbor(&self) -> String {
        seedelf_cli::web_server::take_captured_cbor()
            .expect("command did not reach the signing web server")
    }

    /// The raw transaction CBOR captured at the `submittx` boundary — the tx
    /// the command actually tried to broadcast.
    pub async fn submitted_cbor(&self) -> String {
        let requests = self
            .server
            .received_requests()
            .await
            .expect("request recording enabled");
        let body = requests
            .iter()
            .find(|r| r.url.path() == "/api/v1/submittx")
            .map(|r| r.body.clone())
            .expect("no transaction was submitted");
        hex::encode(body)
    }
}

impl Drop for Scenario {
    fn drop(&mut self) {
        // Reset the process-global seams so a later test in this binary starts
        // from a clean slate even if it forgets to re-arm them.
        seedelf_koios::koios::override_endpoints(None, None);
        seedelf_display::version_control::override_github_base(None);
        seedelf_cli::setup::inject_wallet_scalar(None);
        seedelf_cli::web_server::take_captured_cbor();
    }
}

/// The recorded preprod parameters the mock serves, read as the CLI reads
/// them, with no mock running.
pub fn recorded_params() -> ProtocolParameters {
    let params: Value = serde_json::from_str(EPOCH_PARAMS_FIXTURE).expect("epoch params");
    ProtocolParameters::from_koios(&params[0]).expect("the recorded parameters")
}

/// Fetch protocol parameters through the mock — the exact params the command
/// under test saw.
pub async fn protocol_params() -> ProtocolParameters {
    seedelf_koios::koios::epoch_params(PREPROD)
        .await
        .expect("epoch params")
}

// ----------------------------------------------------------------------------
// decoded-transaction view
// ----------------------------------------------------------------------------

#[derive(Debug)]
pub struct DecodedOutput {
    pub address: Address,
    pub lovelace: u64,
    /// `(policy_id_hex, token_name_hex) -> quantity`.
    pub assets: BTreeMap<(String, String), u64>,
    /// The inline datum decoded back into a `Register`, when present.
    pub register: Option<Register>,
    pub has_datum: bool,
}

#[derive(Debug)]
pub struct DecodedTx {
    pub inputs: Vec<(String, u64)>,
    pub outputs: Vec<DecodedOutput>,
    pub fee: u64,
    /// `(policy_id_hex, token_name_hex) -> signed mint quantity`.
    pub mint: BTreeMap<(String, String), i128>,
    pub collateral: Vec<(String, u64)>,
    /// Where what's left of the collateral goes if a script fails.
    pub collateral_return: Option<DecodedOutput>,
}

fn register_from_datum(datum: DatumOption) -> Option<Register> {
    let DatumOption::Data(wrapped) = datum else {
        return None;
    };
    let plutus: &PlutusData = &wrapped;
    let PlutusData::Constr(constr) = plutus else {
        return None;
    };
    let fields = match &constr.fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |pd: &PlutusData| -> Option<String> {
        match pd {
            PlutusData::BoundedBytes(b) => {
                let slice: &[u8] = b;
                Some(hex::encode(slice))
            }
            _ => None,
        }
    };
    Some(Register::new(
        bytes(fields.first()?)?,
        bytes(fields.get(1)?)?,
    ))
}

fn decode_output(o: &MultiEraOutput) -> DecodedOutput {
    let mut assets = BTreeMap::new();
    for policy in o.value().assets() {
        for asset in policy.assets() {
            if let Some(qty) = asset.output_coin() {
                *assets
                    .entry((hex::encode(*policy.policy()), hex::encode(asset.name())))
                    .or_insert(0) += qty;
            }
        }
    }
    let datum = o.datum();
    DecodedOutput {
        address: o.address().expect("output address"),
        lovelace: o.value().coin(),
        assets,
        has_datum: datum.is_some(),
        register: datum.and_then(|d| register_from_datum(d.into())),
    }
}

/// Decode a transaction CBOR hex string into an owned, asserted-against view.
pub fn decode_tx(cbor_hex: &str) -> DecodedTx {
    let bytes = hex::decode(cbor_hex).expect("tx cbor hex");
    let tx = MultiEraTx::decode(&bytes).expect("decode transaction");

    let inputs = tx
        .inputs()
        .iter()
        .map(|i| (hex::encode(*i.hash()), i.index()))
        .collect();

    let outputs = tx.outputs().iter().map(decode_output).collect();

    let mut mint: BTreeMap<(String, String), i128> = BTreeMap::new();
    for policy in tx.mints() {
        for asset in policy.assets() {
            if let Some(qty) = asset.mint_coin() {
                *mint
                    .entry((hex::encode(*policy.policy()), hex::encode(asset.name())))
                    .or_insert(0) += qty as i128;
            }
        }
    }

    DecodedTx {
        inputs,
        outputs,
        fee: tx.fee().expect("transaction declares a fee"),
        mint,
        collateral: tx
            .collateral()
            .iter()
            .map(|i| (hex::encode(*i.hash()), i.index()))
            .collect(),
        collateral_return: tx.collateral_return().as_ref().map(decode_output),
    }
}

impl DecodedTx {
    /// Outputs paid to `address`.
    pub fn outputs_to<'a>(&'a self, address: &Address) -> Vec<&'a DecodedOutput> {
        self.outputs
            .iter()
            .filter(|o| &o.address == address)
            .collect()
    }

    pub fn total_output_lovelace(&self) -> u64 {
        self.outputs.iter().map(|o| o.lovelace).sum()
    }
}

// ----------------------------------------------------------------------------
// assertions
// ----------------------------------------------------------------------------

/// Assert the Cardano value-conservation rule:
/// `sum(resolved inputs) == sum(outputs) + fee` for lovelace, and
/// `sum(inputs) + mint == sum(outputs)` for every native token.
pub fn assert_value_conserved(tx: &DecodedTx, ledger: &Ledger) {
    assert!(!tx.inputs.is_empty(), "transaction has no inputs");

    let mut in_lovelace: u64 = 0;
    let mut in_assets: BTreeMap<(String, String), i128> = BTreeMap::new();
    for (hash, index) in &tx.inputs {
        let resolved = ledger.resolve(hash, *index);
        in_lovelace += resolved.lovelace;
        for (key, qty) in resolved.assets {
            *in_assets.entry(key).or_insert(0) += qty as i128;
        }
    }

    let out_lovelace = tx.total_output_lovelace();
    let mut out_assets: BTreeMap<(String, String), i128> = BTreeMap::new();
    for output in &tx.outputs {
        for (key, qty) in &output.assets {
            *out_assets.entry(key.clone()).or_insert(0) += *qty as i128;
        }
    }

    assert_eq!(
        in_lovelace,
        out_lovelace + tx.fee,
        "lovelace not conserved: inputs {in_lovelace} != outputs {out_lovelace} + fee {}",
        tx.fee
    );

    let mut keys: std::collections::BTreeSet<(String, String)> =
        in_assets.keys().cloned().collect();
    keys.extend(out_assets.keys().cloned());
    keys.extend(tx.mint.keys().cloned());
    for key in keys {
        let input = in_assets.get(&key).copied().unwrap_or(0);
        let minted = tx.mint.get(&key).copied().unwrap_or(0);
        let output = out_assets.get(&key).copied().unwrap_or(0);
        assert_eq!(
            input + minted,
            output,
            "token {key:?} not conserved: inputs {input} + mint {minted} != outputs {output}"
        );
    }
}

/// Assert no output sits below its minimum-UTxO floor.
pub fn assert_no_sub_min_outputs(tx: &DecodedTx, params: &ProtocolParameters) {
    let wallet = wallet_address();
    for (i, output) in tx.outputs.iter().enumerate() {
        let mut assets = Assets::new();
        for ((policy, name), qty) in &output.assets {
            assets = assets
                .add(CoreAsset::new(policy.clone(), name.clone(), *qty).expect("core asset"))
                .expect("merge asset");
        }
        let minimum = if output.address == wallet {
            wallet_minimum_lovelace_with_assets(params, assets).expect("wallet min utxo")
        } else {
            address_minimum_lovelace_with_assets(
                params,
                &output.address.to_bech32().expect("output bech32"),
                assets,
            )
            .expect("address min utxo")
        };
        assert!(
            output.lovelace >= minimum,
            "output {i} ({} lovelace) is below its min-UTxO of {minimum}",
            output.lovelace
        );
    }
}

/// Assert wallet-contract outputs carry a valid, owned `Register` datum and
/// that plain-address outputs carry no datum.
pub fn assert_wallet_output_datums(tx: &DecodedTx, scalar: Scalar) {
    let wallet = wallet_address();
    for (i, output) in tx.outputs.iter().enumerate() {
        if output.address == wallet {
            let register = output
                .register
                .as_ref()
                .unwrap_or_else(|| panic!("wallet output {i} is missing a Register datum"));
            assert!(
                register.is_valid().expect("register validity"),
                "wallet output {i} carries a non-prime-order Register (dead UTxO)"
            );
            assert!(
                register.is_owned(scalar).expect("register ownership"),
                "wallet output {i} carries a Register not owned by the wallet"
            );
        } else {
            assert!(
                !output.has_datum,
                "plain-address output {i} unexpectedly carries a datum"
            );
        }
    }
}

/// Run the three command-agnostic soundness checks: value conservation,
/// min-UTxO, and wallet-output datums.
pub fn assert_sound_transaction(tx: &DecodedTx, scenario: &Scenario, params: &ProtocolParameters) {
    assert_value_conserved(tx, &scenario.ledger);
    assert_no_sub_min_outputs(tx, params);
    assert_wallet_output_datums(tx, scenario.scalar);
}

/// The collateral a transaction puts up, the address's 5 ADA less its
/// return, covers the ledger's 150% of its fee: the fee is even, so 3/2 of it
/// is whole. An odd fee's ⌊3/2 × fee⌋ falls half a lovelace short, and the
/// node refuses the transaction (chunk 51, t1b#5).
pub fn assert_collateral_covers_the_fee(tx: &DecodedTx) {
    let back = tx.collateral_return.as_ref().expect("a collateral return");
    let put_up = 5_000_000 - back.lovelace;
    assert!(
        tx.fee.is_multiple_of(2) && 2 * put_up >= 3 * tx.fee,
        "the fee must be even and the collateral cover 150% of it: a fee of {}, a collateral of {put_up}",
        tx.fee
    );
}

/// The one-time key a Seedelf spend is signed with, hex, after asserting
/// what binds the spend to it (chunk 51, t1b#12): it's the one required
/// signer besides the collateral service, it signs, and every spent input's
/// redeemer names it and carries a proof that verifies for that input's
/// register. The deployed contract takes a proof whose key is among the
/// signers, so a key anyone could know would let anyone replay the proofs.
pub fn one_time_key_of(cbor_hex: &str, ledger: &Ledger) -> String {
    let bytes = hex::decode(cbor_hex).expect("tx cbor hex");
    let tx = MultiEraTx::decode(&bytes).expect("decode transaction");

    let collateral = hex::encode(COLLATERAL_HASH);
    let signers: Vec<String> = tx
        .required_signers()
        .collect::<Vec<_>>()
        .into_iter()
        .map(|signer| signer.to_string())
        .collect();
    assert!(
        signers.contains(&collateral),
        "the collateral service is a required signer: {signers:?}"
    );
    let others: Vec<&String> = signers.iter().filter(|s| **s != collateral).collect();
    assert_eq!(
        others.len(),
        1,
        "one key signs beside the collateral service: {signers:?}"
    );
    let key = others[0].clone();
    let witnesses: Vec<String> = tx
        .vkey_witnesses()
        .iter()
        .map(|w| Hasher::<224>::hash(&w.vkey).to_string())
        .collect();
    assert!(
        witnesses.contains(&key),
        "the one-time key {key} signs: {witnesses:?}"
    );

    let inputs = tx.inputs_sorted_set();
    let mut proven = 0;
    for redeemer in tx.redeemers() {
        if !matches!(redeemer.tag(), RedeemerTag::Spend) {
            continue;
        }
        let input = &inputs[redeemer.index() as usize];
        let register = ledger
            .resolve(&hex::encode(*input.hash()), input.index())
            .register
            .expect("a spent input's register");
        let PlutusData::Constr(proof) = redeemer.data() else {
            panic!("a spend's redeemer is a proof");
        };
        let fields: Vec<String> = match &proof.fields {
            MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
        }
        .iter()
        .map(|field| match field {
            PlutusData::BoundedBytes(b) => {
                let slice: &[u8] = b;
                hex::encode(slice)
            }
            other => panic!("a proof's fields are bytes: {other:?}"),
        })
        .collect();
        let [z, g_r, vkh] = fields.as_slice() else {
            panic!("a proof is z, g_r and the key's hash: {fields:?}");
        };
        assert_eq!(
            vkh,
            &key,
            "input {}'s proof names the one-time key",
            redeemer.index()
        );
        assert!(
            prove(&register.generator, &register.public_value, z, g_r, vkh).expect("a proof"),
            "input {}'s proof verifies for its register, bound to the one-time key",
            redeemer.index()
        );
        proven += 1;
    }
    assert_eq!(proven, inputs.len(), "every input spent is proven");
    key
}

/// Addresses no payment goes to: a script's (the wallet contract's own), a
/// stake address, and a key address on the other network (mainnet). A
/// payment there with no datum can lock for good, or never arrives.
pub fn not_payable_addresses() -> Vec<String> {
    let Address::Shelley(external) = external_address() else {
        panic!("the external address is a Shelley address");
    };
    vec![
        wallet_address_bech32(),
        StakeAddress::try_from(external)
            .expect("its stake address")
            .to_bech32()
            .expect("stake bech32"),
        seedelf_core::address::dapp_address("11".repeat(28), false)
            .expect("a mainnet address")
            .to_bech32()
            .expect("mainnet bech32"),
    ]
}
