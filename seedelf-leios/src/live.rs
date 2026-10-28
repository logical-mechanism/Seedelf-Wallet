//! Against Musashi, through the relay in Docker (`leios-relay`, IOG's
//! `cardano-node-testnet:rc-2026w43`, synced in `~/leios-musashi/data`):
//! its `cardano-cli` queries and submits, and files go through
//! `~/leios-musashi/work`, which the container sees as `/work`. The key, the
//! pool and every run's record live in `~/leios-musashi`, never in the repo.
//!
//! ```text
//! live key            make the throwaway key (once) and print its address
//! live status         the node's tip, its mempool, the key's ADA
//! live params         the chain's parameters now, against the genesis
//! live decode         the wallet's transactions through the node's own Dijkstra decoder
//! live faucet         ask the faucet once (it may want a person)
//! live split N ADA    N outputs of ADA each, from the largest UTxO
//! live launch         launch an ADA pool of 5 ₳ boxes, from the key's account
//! live deposit N      N boxes into the pool
//! live chain W [all|K] [burst N]
//!                     a chain, W wide, two waves deep: the whole chain sent at
//!                     once, or K at a time as the wallet sends today; a burst
//!                     of N small payments first, to fill the RB ahead of it
//! ```

use crate::{dijkstra, measure, params};
use anyhow::{Context, Result, anyhow, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction};
use rand_core::{OsRng, RngCore};
use seedelf_core::build::{add_witnesses, linear_fee, tx_id};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, Protocol, Terms};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CONTAINER: &str = "leios-relay";
/// What a pool's box holds: any amount but the classic pool's 10 ₳ makes an
/// ADA pool on Lovejoin's generalized scripts.
const BOX_LOVELACE: u64 = 5_000_000;

pub fn run(args: &[String]) -> Result<()> {
    let arg = |i: usize| args.get(i).map(String::as_str);
    match arg(0) {
        Some("key") => key(),
        Some("status") => status(),
        Some("params") => params_check(),
        Some("decode") => decode(),
        Some("faucet") => faucet(),
        Some("split") => split(
            arg(1).context("how many")?.parse()?,
            arg(2).context("how much ADA each")?.parse::<u64>()? * 1_000_000,
        ),
        Some("launch") => launch(),
        Some("deposit") => deposit(arg(1).context("how many boxes")?.parse()?),
        Some("chain") => {
            let width: usize = arg(1).context("how wide")?.parse()?;
            let window = match arg(2) {
                None | Some("all") => usize::MAX,
                Some(k) => k.parse()?,
            };
            let burst = match (arg(3), arg(4)) {
                (Some("burst"), Some(n)) => n.parse()?,
                _ => 0,
            };
            chain(width, window, burst)
        }
        _ => bail!("live: key | status | params | decode | faucet | split N ADA | launch | deposit N | chain W [all|K] [burst N]"),
    }
}

fn home() -> Result<PathBuf> {
    Ok(PathBuf::from(std::env::var("HOME")?).join("leios-musashi"))
}

/// `cardano-cli` in the relay's container, its answer as text.
fn cli(args: &[&str]) -> Result<String> {
    let out = Command::new("docker")
        .arg("exec")
        .arg(CONTAINER)
        .arg("cardano-cli")
        .args(args)
        .output()
        .context("docker exec")?;
    if !out.status.success() {
        bail!(
            "cardano-cli {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8(out.stdout)?)
}

fn cli_json(args: &[&str]) -> Result<Value> {
    Ok(serde_json::from_str(&cli(args)?)?)
}

/// The throwaway key.
struct Key {
    sk: SecretKey,
    /// The secret's bytes, for `cardano-cli`'s own signing-key file.
    raw: [u8; 32],
    address: Address,
}

impl Key {
    fn sign(&self, tx: &[u8]) -> Result<Vec<u8>> {
        let id = tx_id(tx)?;
        add_witnesses(tx, &[(self.sk.public_key(), self.sk.sign(id))])
    }
}

fn key_file() -> Result<PathBuf> {
    Ok(home()?.join("keys").join("payment.skey"))
}

fn load_key() -> Result<Key> {
    let hex_key = std::fs::read_to_string(key_file()?).context("no key yet: `live key` makes one")?;
    let bytes: [u8; 32] = hex::decode(hex_key.trim())?
        .try_into()
        .map_err(|_| anyhow!("a key is 32 bytes"))?;
    let sk = SecretKey::from(bytes);
    let hash = Hasher::<224>::hash(sk.public_key().as_ref());
    Ok(Key {
        sk,
        raw: bytes,
        address: crate::synth::key_address(hash),
    })
}

fn key() -> Result<()> {
    let path = key_file()?;
    if !path.exists() {
        std::fs::create_dir_all(path.parent().expect("a folder"))?;
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        std::fs::write(&path, hex::encode(bytes))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    println!("{}", load_key()?.address.to_bech32()?);
    Ok(())
}

/// Every UTxO at `address`, as Koios rows (what core's builders take).
fn utxos(address: &Address) -> Result<Vec<UtxoResponse>> {
    let bech = address.to_bech32()?;
    let answer = cli_json(&["query", "utxo", "--address", &bech, "--output-json"])?;
    let mut rows = Vec::new();
    for (at, v) in answer.as_object().context("a map of UTxOs")? {
        let (tx_hash, index) = at.split_once('#').context("txid#index")?;
        let mut assets = Vec::new();
        let mut lovelace = 0;
        for (policy, names) in v["value"].as_object().context("a value")? {
            if policy == "lovelace" {
                lovelace = names.as_u64().context("lovelace")?;
                continue;
            }
            for (name, q) in names.as_object().context("assets")? {
                assets.push(json!({ "policy_id": policy, "asset_name": name, "quantity": q.to_string(), "decimals": 0, "fingerprint": "" }));
            }
        }
        let inline = v["inlineDatumRaw"].as_str().map(|raw| json!({ "bytes": raw, "value": v["inlineDatum"] }));
        rows.push(serde_json::from_value(json!({
            "tx_hash": tx_hash, "tx_index": index.parse::<u64>()?,
            "address": v["address"], "value": lovelace.to_string(),
            "stake_address": null, "payment_cred": payment_cred(address),
            "epoch_no": 0, "block_height": 0, "block_time": 0,
            "datum_hash": null, "inline_datum": inline,
            "reference_script": null, "asset_list": assets, "is_spent": false,
        }))?);
    }
    rows.sort_by_key(|r: &UtxoResponse| std::cmp::Reverse(r.value.parse::<u64>().unwrap_or(0)));
    Ok(rows)
}

fn payment_cred(address: &Address) -> String {
    match address {
        Address::Shelley(s) => hex::encode(s.payment().as_hash().as_ref()),
        _ => String::new(),
    }
}

/// The chain's parameters as core's builders take them, read from the node.
fn chain_params() -> Result<ProtocolParameters> {
    let pp = cli_json(&["query", "protocol-parameters"])?;
    let row = json!({
        "min_fee_a": pp["txFeePerByte"], "min_fee_b": pp["txFeeFixed"],
        "coins_per_utxo_size": pp["utxoCostPerByte"].to_string(),
        "key_deposit": pp["stakeAddressDeposit"], "drep_deposit": pp["dRepDeposit"],
        "price_mem": pp["executionUnitPrices"]["priceMemory"],
        "price_step": pp["executionUnitPrices"]["priceSteps"],
        "min_fee_ref_script_cost_per_byte": pp["minFeeRefScriptCostPerByte"],
        "cost_models": {
            "PlutusV1": pp["costModels"]["PlutusV1"],
            "PlutusV2": pp["costModels"]["PlutusV2"],
            "PlutusV3": pp["costModels"]["PlutusV3"],
        },
    });
    ProtocolParameters::from_koios(&row)
}

fn status() -> Result<()> {
    println!("{}", cli(&["query", "tip"])?);
    println!("{}", cli(&["query", "tx-mempool", "info"])?);
    if let Ok(key) = load_key() {
        let rows = utxos(&key.address)?;
        let total: u64 = rows.iter().map(|r| r.value.parse::<u64>().unwrap_or(0)).sum();
        println!("{}: {} UTxOs, {:.6} ADA", key.address.to_bech32()?, rows.len(), total as f64 / 1e6);
    }
    Ok(())
}

fn params_check() -> Result<()> {
    let pp = cli_json(&["query", "protocol-parameters"])?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("musashi").join("protocol-parameters.json");
    std::fs::write(&path, serde_json::to_string_pretty(&pp)?)?;
    let genesis = params::musashi()?;
    let now = chain_params()?;
    println!("saved {}", path.display());
    println!(
        "Plutus V3 cost model: {} entries, {} the genesis's (mainnet's)",
        now.cost_model_v3.len(),
        if now.cost_model_v3 == genesis.cost_model_v3 { "the same as" } else { "NOT" }
    );
    for key in [
        "maxBlockBodySize",
        "maxTxSize",
        "maxTxExecutionUnits",
        "maxBlockExecutionUnits",
        "maxEndorserBlockTxsSize",
        "maxEndorserBlockReferencesSize",
        "maxEndorserBlockExecutionUnits",
        "maxRefScriptSizePerEndorserBlock",
        "maxRefScriptSizePerBlock",
        "leiosVotePeriodLength",
        "leiosDiffusionPeriodLength",
        "leiosAnnouncementPeriodLength",
        "refInputsCostPerDatumByte",
        "refInputsCostPerMultiAssetPolicy",
        "protocolVersion",
    ] {
        println!("{key}: {}", pp.get(key).map_or("(not listed)".into(), |v| v.to_string()));
    }
    Ok(())
}

/// A text envelope for a transaction kept as CBOR, in `era`.
fn envelope(tx: &[u8], era: &str) -> Value {
    json!({ "type": format!("Tx {era}"), "description": "", "cborHex": hex::encode(tx) })
}

/// Writes `tx` where the container sees it, and returns that path.
fn put(tx: &[u8], name: &str) -> Result<String> {
    let work = home()?.join("work");
    std::fs::create_dir_all(&work)?;
    std::fs::write(work.join(name), serde_json::to_string(&envelope(tx, "DijkstraEra"))?)?;
    Ok(format!("/work/{name}"))
}

/// The wallet's transactions through the node's own decoder: as built, then
/// mended.
fn decode() -> Result<()> {
    let p = params::musashi()?;
    let set = measure::all(&p)?;
    let mut rows: Vec<&measure::Measured> = set.txs.iter().collect();
    for (_, chain) in &set.chains {
        rows.extend(chain.iter().take(2));
    }
    for m in rows {
        let file = put(&m.tx, "decode.json")?;
        let built = cli(&["dijkstra", "transaction", "txid", "--tx-file", &file]);
        println!("{}", m.kind);
        println!("  as built: {}", built.as_ref().map_or_else(|e| first_line(&e.to_string()), |id| format!("decodes, {}", id.trim())));
        if m.redeemers() > 0 {
            if let Some(change) = m.change {
                let mended = dijkstra::mend(&m.tx, &p, change, m.signers, &m.known)?;
                let file = put(&mended.tx, "decode.json")?;
                let again = cli(&["dijkstra", "transaction", "txid", "--tx-file", &file]);
                println!("  mended:   {}", again.as_ref().map_or_else(|e| first_line(&e.to_string()), |id| format!("decodes, {}", id.trim())));
            }
        }
    }
    Ok(())
}

fn first_line(s: &str) -> String {
    s.lines().filter(|l| !l.trim().is_empty()).take(3).collect::<Vec<_>>().join(" / ")
}

fn faucet() -> Result<()> {
    let key = load_key()?;
    let url = format!(
        "https://faucet.leios.play.dev.cardano.org/send-money?type=default&address={}",
        key.address.to_bech32()?
    );
    let out = Command::new("curl").args(["-sS", "-m", "60", "-w", "\nHTTP %{http_code}\n", &url]).output()?;
    println!("{}", String::from_utf8_lossy(&out.stdout));
    Ok(())
}

/// Seconds since the epoch.
fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn submit(tx: &[u8], name: &str) -> Result<()> {
    let file = put(tx, &format!("{name}.json"))?;
    cli(&["dijkstra", "transaction", "submit", "--tx-file", &file]).map(|_| ())
}

/// Waits until `tx_hash#index` is on the ledger.
fn wait_for(tx_hash: &[u8; 32], index: u64, most: Duration) -> Result<()> {
    let at = format!("{}#{index}", hex::encode(tx_hash));
    let started = Instant::now();
    while started.elapsed() < most {
        let answer = cli_json(&["query", "utxo", "--tx-in", &at, "--output-json"])?;
        if answer.as_object().is_some_and(|m| !m.is_empty()) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    bail!("{at} isn't on the ledger after {} s", most.as_secs())
}

/// A key-signed payment from `inputs` to `outputs`, the change back to the
/// key: no script, so nothing for Dijkstra to mend.
fn pay(key: &Key, p: &ProtocolParameters, inputs: &[UtxoResponse], outputs: &[(Address, u64)]) -> Result<Vec<u8>> {
    let total: u64 = inputs.iter().map(|r| r.value.parse::<u64>().unwrap_or(0)).sum();
    let paid: u64 = outputs.iter().map(|(_, l)| l).sum();
    let stage = |fee: u64| -> Result<Vec<u8>> {
        let mut tx = StagingTransaction::new();
        for r in inputs {
            tx = tx.input(Input::new(Hash::new(hex::decode(&r.tx_hash)?.try_into().map_err(|_| anyhow!("hash"))?), r.tx_index));
        }
        for (a, l) in outputs {
            tx = tx.output(Output::new(a.clone(), *l));
        }
        let change = total.checked_sub(paid + fee).context("not enough to pay that")?;
        tx = tx.output(Output::new(key.address.clone(), change)).fee(fee);
        Ok(tx.build_conway_raw().map_err(|e| anyhow!("{e:?}"))?.tx_bytes.0)
    };
    let mut fee = 200_000;
    for _ in 0..4 {
        let signed = key.sign(&stage(fee)?)?;
        let needed = linear_fee(p, signed.len() as u64);
        if needed <= fee {
            break;
        }
        fee = needed;
    }
    key.sign(&stage(fee)?)
}

fn split(n: usize, each: u64) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let rows = utxos(&key.address)?;
    let largest = rows.first().context("the key holds nothing yet")?;
    let outputs = vec![(key.address.clone(), each); n];
    let tx = pay(&key, &p, std::slice::from_ref(largest), &outputs)?;
    let id = tx_id(&tx)?;
    submit(&tx, &format!("split-{}", hex::encode(id)))?;
    println!("split {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(600))?;
    println!("on the ledger");
    Ok(())
}

/// The pool this harness launched, rebuilt from its launch's own bytes.
fn pool() -> Result<Protocol> {
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(home()?.join("pool.json")).context("no pool yet: `live launch`")?)?;
    let tx = hex::decode(saved["tx"].as_str().context("tx")?)?;
    let seed_hash: [u8; 32] = hex::decode(saved["seed"].as_str().context("seed")?)?
        .try_into()
        .map_err(|_| anyhow!("seed"))?;
    lovejoin::launched_pool(true, &tx, (seed_hash, saved["seed_index"].as_u64().context("seed index")?))
}

fn launch() -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let ada_alone = |rows: Vec<UtxoResponse>| -> Vec<UtxoResponse> {
        rows.into_iter().filter(|r| r.asset_list.as_ref().is_none_or(|a| a.is_empty())).collect()
    };
    let rows = ada_alone(utxos(&key.address)?);
    let collateral = rows
        .iter()
        .find(|r| r.value == "5000000")
        .context("no 5 ₳ UTxO for collateral: `live split` some")?
        .clone();
    let chain = measure::chain(&p)?;
    let terms = Terms {
        token: None,
        box_lovelace: BOX_LOVELACE,
        max_fee: 1_000_000,
    };
    // The launch as core builds it, for its seed and its scripts. Core
    // registers `mix_logic` with Shelley's certificate 0, which Dijkstra
    // decodes no more ("Certificates without deposits are no longer
    // supported"), so it's registered first, on its own, with Conway's
    // certificate 7 and the publish redeemer that certificate needs the
    // script's witness for: Lovejoin's `mix_logic` allows RegisterCredential.
    let dry = lovejoin::launch_from_account(&chain, &rows, Some(&collateral), &terms, true, &key.address, None)?;
    let seed = dry.seed;
    register_script(&key, &dry.derived.mix_logic, seed, &rows, &collateral, p.key_deposit)?;

    let rows = ada_alone(utxos(&key.address)?);
    let built = lovejoin::launch_from_account(&chain, &rows, Some(&collateral), &terms, false, &key.address, None)?;
    if built.seed != seed {
        bail!("the launch would spend another seed now: run it again");
    }
    let known: Vec<Resolved> = rows.iter().map(eval::resolve_row).collect::<Result<_>>()?;
    let finished = built.measure_locally()?;
    let tx = finished.tx.tx_bytes.0;
    let outputs = eval::resolve_outputs(&tx)?.len();
    let mended = dijkstra::mend(&tx, &p, outputs - 1, 1, &known)?;
    let signed = key.sign(&mended.tx)?;
    let id = tx_id(&signed)?;
    submit(&signed, &format!("launch-{}", hex::encode(id)))?;
    println!("launch {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(900))?;
    let pool = lovejoin::launched_pool(true, &signed, seed)?;
    std::fs::write(
        home()?.join("pool.json"),
        serde_json::to_string_pretty(&json!({
            "tx": hex::encode(&signed), "seed": hex::encode(seed.0), "seed_index": seed.1,
            "mix_box": hex::encode(pool.mix_box_hash), "mix_logic": hex::encode(pool.mix_logic_hash),
            "id": hex::encode(pool.id),
        }))?,
    )?;
    println!("pool {} on the ledger: mix_box {}", hex::encode(pool.id), hex::encode(pool.mix_box_hash));
    Ok(())
}

/// Registers `script`'s stake credential with certificate 7 (a deposit, and
/// the script's own witness, its publish redeemer), built by the node's
/// `cardano-cli`, paid from a UTxO that isn't the launch's `seed`.
fn register_script(
    key: &Key,
    script: &lovejoin::templates::Script,
    seed: ([u8; 32], u64),
    rows: &[UtxoResponse],
    collateral: &UtxoResponse,
    deposit: u64,
) -> Result<()> {
    let work = home()?.join("work");
    let mut wrapped = minicbor::Encoder::new(Vec::new());
    wrapped.bytes(&script.cbor)?;
    let envelope = json!({ "type": "PlutusScriptV3", "description": "", "cborHex": hex::encode(wrapped.into_writer()) });
    std::fs::write(work.join("mix_logic.plutus"), serde_json::to_string(&envelope)?)?;
    let hash = cli(&["hash", "script", "--script-file", "/work/mix_logic.plutus"])?;
    if hash.trim() != hex::encode(script.hash) {
        bail!("the node hashes mix_logic as {}, the wallet as {}", hash.trim(), hex::encode(script.hash));
    }
    let deposit = deposit.to_string();
    cli(&[
        "dijkstra", "stake-address", "registration-certificate",
        "--stake-script-file", "/work/mix_logic.plutus",
        "--key-reg-deposit-amt", &deposit,
        "--out-file", "/work/register.cert",
    ])?;
    let at = |r: &UtxoResponse| format!("{}#{}", r.tx_hash, r.tx_index);
    let seed_at = format!("{}#{}", hex::encode(seed.0), seed.1);
    let pay = rows
        .iter()
        .rev()
        .find(|r| at(r) != seed_at && at(r) != at(collateral) && r.value.parse::<u64>().unwrap_or(0) >= 10_000_000)
        .context("no UTxO of 10 ₳ or more besides the seed and the collateral")?;
    let address = key.address.to_bech32()?;
    let (pay_at, col_at) = (at(pay), at(collateral));
    cli(&[
        "dijkstra", "transaction", "build",
        "--tx-in", &pay_at,
        "--tx-in-collateral", &col_at,
        "--certificate-file", "/work/register.cert",
        "--certificate-script-file", "/work/mix_logic.plutus",
        "--certificate-redeemer-value", "0",
        "--change-address", &address,
        "--out-file", "/work/register.body",
    ])?;
    let skey = json!({ "type": "PaymentSigningKeyShelley_ed25519", "description": "", "cborHex": format!("5820{}", hex::encode(key.raw)) });
    std::fs::write(work.join("payment.skey.json"), serde_json::to_string(&skey)?)?;
    let signed = cli(&[
        "dijkstra", "transaction", "sign",
        "--tx-body-file", "/work/register.body",
        "--signing-key-file", "/work/payment.skey.json",
        "--out-file", "/work/register.signed",
    ]);
    let _ = std::fs::remove_file(work.join("payment.skey.json"));
    signed?;
    cli(&["dijkstra", "transaction", "submit", "--tx-file", "/work/register.signed"])?;
    let id: Value = serde_json::from_str(&cli(&["dijkstra", "transaction", "txid", "--tx-file", "/work/register.signed"])?)?;
    let id: [u8; 32] = hex::decode(id["txhash"].as_str().context("txhash")?)?
        .try_into()
        .map_err(|_| anyhow!("a hash"))?;
    println!("mix_logic's registration {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(900))?;
    Ok(())
}

/// The pool's boxes on the ledger now.
fn boxes(pool: &Protocol) -> Result<Vec<PoolBox>> {
    let rows = utxos(&pool.mix_box_address())?;
    Ok(rows.iter().filter_map(|r| PoolBox::from_row(r, pool)).collect())
}

fn deposit(n: usize) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let pool = pool()?;
    let rows = utxos(&key.address)?;
    let coin = Coin::from_row(rows.first().context("nothing to pay with")?)?;
    // The pool's other boxes: nobody's, as far as a mix can tell.
    let owners = (0..n)
        .map(|_| Register::create(seedelf_crypto::schnorr::random_scalar())?.rerandomize())
        .collect::<Result<Vec<_>>>()?;
    let made = lovejoin::deposit(&p, &pool, &[coin], &owners, &key.address, 1)?;
    let signed = key.sign(&made.tx.tx_bytes.0)?;
    let id = tx_id(&signed)?;
    submit(&signed, &format!("deposit-{}", hex::encode(id)))?;
    println!("deposit of {n} boxes {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(900))?;
    println!("on the ledger: the pool holds {} boxes", boxes(&pool)?.len());
    Ok(())
}

/// One of the chain's transactions, signed, and where it went.
struct Step {
    kind: String,
    tx: Vec<u8>,
    id: [u8; 32],
    sent: Option<f64>,
    landed: Option<Landing>,
}

#[derive(Debug, Clone)]
struct Landing {
    at: f64,
    slot: u64,
    block: u64,
    hash: String,
}

/// A chain built as `lovejoin::chain_across` builds one, a mix at a time, each
/// mended for Dijkstra before the next is built on its real outputs: a mend
/// changes the transaction's id, and the next spends by id.
fn build_chain(key: &Key, p: &ProtocolParameters, pool: &Protocol, width: usize) -> Result<Vec<Step>> {
    let rows = utxos(&key.address)?;
    let collateral_row = rows.iter().find(|r| r.value == "5000000").context("no 5 ₳ collateral: `live split`")?;
    let fee_row = rows.iter().find(|r| r.value.parse::<u64>().unwrap_or(0) >= 30_000_000).context("no UTxO of 30 ₳ or more to pay with")?;
    let collateral = Coin::from_row(collateral_row)?;
    let mut fresh = boxes(pool)?;
    // Draw the others at random, as `fresh_for` does.
    for i in (1..fresh.len()).rev() {
        fresh.swap(i, (OsRng.next_u64() % (i as u64 + 1)) as usize);
    }
    let needed = (width - 1) * (1 + width);
    if fresh.len() < needed {
        bail!("the pool holds {} boxes; a {width}-wide chain two deep draws {needed}: `live deposit`", fresh.len());
    }
    let owner = Register::create(seedelf_crypto::schnorr::random_scalar())?.rerandomize()?;
    let made = lovejoin::deposit(p, pool, &[Coin::from_row(fee_row)?], std::slice::from_ref(&owner), &key.address, 1)?;
    let deposit = key.sign(&made.tx.tx_bytes.0)?;
    let mut steps = vec![Step {
        kind: "deposit".into(),
        id: *tx_id(&deposit)?,
        tx: deposit.clone(),
        sent: None,
        landed: None,
    }];
    let deposited = eval::resolve_outputs(&deposit)?;
    let mut change = Coin {
        lovelace: made.change.lovelace,
        utxo: deposited.last().context("change")?.clone(),
    };
    let mut wave: Vec<PoolBox> = vec![PoolBox::from_resolved(deposited[0].clone(), pool).context("our box")?];
    let mut count = 0;
    for _ in 0..2 {
        let mut next = Vec::new();
        for ours in &wave {
            let mut inputs = vec![ours.clone()];
            for _ in 1..width {
                inputs.push(fresh.pop().expect("counted"));
            }
            let payer = Payer {
                fee: change.clone(),
                collateral: Some(collateral.clone()),
                address: key.address.clone(),
                signers: 1,
            };
            let mixed = lovejoin::mix(p, pool, &inputs, &payer)?;
            let mut known: Vec<Resolved> = inputs.iter().map(|b| b.utxo.clone()).collect();
            known.push(change.utxo.clone());
            known.push(collateral.utxo.clone());
            known.extend(pool.references.iter().cloned());
            let mended = dijkstra::mend(&mixed.tx.tx_bytes.0, p, width, 1, &known)?;
            let signed = key.sign(&mended.tx)?;
            let outputs = eval::resolve_outputs(&signed)?;
            for o in outputs.iter().take(width) {
                next.push(PoolBox::from_resolved(o.clone(), pool).context("a mixed box")?);
            }
            change = Coin {
                lovelace: mixed.change.lovelace - (mended.fee_after - mended.fee_before),
                utxo: outputs[width].clone(),
            };
            count += 1;
            steps.push(Step {
                kind: format!("mix {count}"),
                id: *tx_id(&signed)?,
                tx: signed,
                sent: None,
                landed: None,
            });
        }
        wave = next;
    }
    Ok(steps)
}

/// The slots of the blocks our node adopted that certified an EB, from its
/// log (`Mempool.SwitchedToCertifyingView` names the new tip).
fn certifying_slots(since: f64) -> Result<Vec<u64>> {
    let log = std::fs::read_to_string(home()?.join("data").join("node.log"))?;
    let mut slots = Vec::new();
    for line in log.lines().rev() {
        if !line.contains("SwitchedToCertifyingView") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let at = v["at"].as_str().unwrap_or("");
        if parse_time(at).is_some_and(|t| t < since - 60.0) {
            break;
        }
        if let Some(slot) = v["data"]["tip"]["slot"].as_u64() {
            slots.push(slot);
        }
    }
    Ok(slots)
}

/// An RFC 3339 time (as the node logs it) in seconds since the epoch.
fn parse_time(at: &str) -> Option<f64> {
    let out = Command::new("date").args(["-u", "-d", at, "+%s.%N"]).output().ok()?;
    String::from_utf8(out.stdout).ok()?.trim().parse().ok()
}

fn in_mempool(id: &[u8; 32]) -> Result<bool> {
    let answer = cli_json(&["query", "tx-mempool", "tx-exists", &hex::encode(id)])?;
    Ok(answer["exists"].as_bool().unwrap_or(false))
}

/// A burst of `n` small payments to the key itself, chained, sent ahead of the
/// chain so the RB fills before it.
fn burst(key: &Key, p: &ProtocolParameters, n: usize) -> Result<()> {
    if n == 0 {
        return Ok(());
    }
    let rows = utxos(&key.address)?;
    let mut from = rows.first().context("nothing to pay with")?.clone();
    let started = Instant::now();
    for i in 0..n {
        let lovelace: u64 = from.value.parse()?;
        let tx = pay(key, p, std::slice::from_ref(&from), &[(key.address.clone(), 2_000_000)])?;
        let id = tx_id(&tx)?;
        submit(&tx, &format!("burst-{i}"))?;
        let outputs = eval::resolve_outputs(&tx)?;
        let fee = minicbor::decode::<pallas_primitives::conway::Tx>(&tx)
            .map(|t| t.transaction_body.fee)
            .unwrap_or(0);
        from = crate::synth::row(*id, 1, &key.address, lovelace - 2_000_000 - fee, None);
        let _ = outputs;
    }
    println!("burst of {n} sent in {:.1} s", started.elapsed().as_secs_f64());
    Ok(())
}

fn chain(width: usize, window: usize, burst_n: usize) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let pool = pool()?;
    let mut steps = build_chain(&key, &p, &pool, width)?;
    println!(
        "chain {width} wide: {} transactions, built and signed; sending {}",
        steps.len(),
        if window == usize::MAX { "all at once".to_string() } else { format!("{window} at a time") }
    );
    burst(&key, &p, burst_n)?;
    let started = now();
    let mut last_tip: Option<Landing> = None;
    let deadline = Instant::now() + Duration::from_secs(1800);
    loop {
        let tip = cli_json(&["query", "tip"])?;
        let here = Landing {
            at: now(),
            slot: tip["slot"].as_u64().unwrap_or(0),
            block: tip["block"].as_u64().unwrap_or(0),
            hash: tip["hash"].as_str().unwrap_or("").to_string(),
        };
        // What left the mempool since the last look landed in the block
        // adopted since.
        for s in steps.iter_mut().filter(|s| s.sent.is_some() && s.landed.is_none()) {
            if !in_mempool(&s.id)? {
                s.landed = Some(here.clone());
                println!("  {} on the ledger at block {} (slot {})", s.kind, here.block, here.slot);
            }
        }
        let flying = steps.iter().filter(|s| s.sent.is_some() && s.landed.is_none()).count();
        let mut room = window.saturating_sub(flying);
        for s in steps.iter_mut().filter(|s| s.sent.is_none()) {
            if room == 0 {
                break;
            }
            submit(&s.tx, &format!("{}-{}", s.kind.replace(' ', "-"), hex::encode(&s.id[..4])))?;
            s.sent = Some(now());
            room -= 1;
            println!("  sent {} {}", s.kind, hex::encode(s.id));
        }
        if steps.iter().all(|s| s.landed.is_some()) {
            break;
        }
        if Instant::now() > deadline {
            bail!("the chain isn't all on the ledger after 30 minutes");
        }
        last_tip = Some(here);
        std::thread::sleep(Duration::from_millis(700));
    }
    let _ = last_tip;
    // Make sure: the last mix's change is on the ledger, so all of it is.
    let last = steps.last().expect("a chain");
    wait_for(&last.id, width as u64, Duration::from_secs(60))?;
    let certifying = certifying_slots(started)?;
    let mut record = Vec::new();
    println!("\n| Tx | Sent (s) | On the ledger (s) | Block | Slot | How |");
    println!("|---|---:|---:|---:|---:|---|");
    for s in &steps {
        let l = s.landed.as_ref().expect("landed");
        let via = if certifying.contains(&l.slot) { "certified EB" } else { "RB" };
        println!(
            "| {} | {:.1} | {:.1} | {} | {} | {via} |",
            s.kind,
            s.sent.unwrap_or(0.0) - started,
            l.at - started,
            l.block,
            l.slot
        );
        record.push(json!({
            "kind": s.kind, "id": hex::encode(s.id), "sent": s.sent, "landed_at": l.at,
            "block": l.block, "slot": l.slot, "hash": l.hash, "via": via,
            "size": s.tx.len(),
        }));
    }
    let runs = home()?.join("runs");
    std::fs::create_dir_all(&runs)?;
    let name = format!(
        "{}-w{width}-{}{}.json",
        started as u64,
        if window == usize::MAX { "all".into() } else { format!("k{window}") },
        if burst_n > 0 { format!("-burst{burst_n}") } else { String::new() }
    );
    std::fs::write(runs.join(&name), serde_json::to_string_pretty(&json!({ "width": width, "window": window, "burst": burst_n, "txs": record }))?)?;
    println!("\nrecorded in {}", runs.join(name).display());
    Ok(())
}
