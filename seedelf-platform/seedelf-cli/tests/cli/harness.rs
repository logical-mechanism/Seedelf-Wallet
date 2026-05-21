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
use pallas_addresses::Address;
use pallas_primitives::alonzo::{MaybeIndefArray, PlutusData};
use pallas_primitives::conway::DatumOption;
use pallas_traverse::MultiEraTx;
use seedelf_core::assets::{Asset as CoreAsset, Assets};
use seedelf_core::constants::{Config, get_config};
use seedelf_core::transaction::{
    address_minimum_lovelace_with_assets, wallet_minimum_lovelace_with_assets,
};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
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
fn register_inline_datum(reg: &Register) -> InlineDatum {
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

// ----------------------------------------------------------------------------
// fixture ledger — resolves the values behind a transaction's inputs
// ----------------------------------------------------------------------------

/// The resolved value sitting on a fixture UTxO.
#[derive(Clone, Debug, Default)]
pub struct ResolvedValue {
    pub lovelace: u64,
    /// `(policy_id_hex, token_name_hex) -> quantity`.
    pub assets: BTreeMap<(String, String), u64>,
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

/// Custom responder for `credential_utxos`, which the CLI paginates: it returns
/// the canned UTxO set for `offset=0` and an empty page for any later offset so
/// the pagination loop terminates.
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
        let budgets: Vec<Value> = (0..n)
            .map(|i| {
                json!({
                    "validator": {"index": i, "purpose": "spend"},
                    "budget": {"cpu": 250_000_000u64, "memory": 800_000u64}
                })
            })
            .collect();
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

/// Decode a transaction CBOR hex string into an owned, asserted-against view.
pub fn decode_tx(cbor_hex: &str) -> DecodedTx {
    let bytes = hex::decode(cbor_hex).expect("tx cbor hex");
    let tx = MultiEraTx::decode(&bytes).expect("decode transaction");

    let inputs = tx
        .inputs()
        .iter()
        .map(|i| (hex::encode(*i.hash()), i.index()))
        .collect();

    let outputs = tx
        .outputs()
        .iter()
        .map(|o| {
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
        })
        .collect();

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
